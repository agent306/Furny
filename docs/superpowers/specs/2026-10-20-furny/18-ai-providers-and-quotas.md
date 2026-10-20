# 18 — AI Providers, Credits, Budgets and Usage Metering

Read the master document, `01-architecture.md`, `02-data-model.md`, `03-design-documents.md` and `06-blueprint-import.md` (referenced here as **06**) first. This file is normative for: the AI provider abstraction inside the Python vision service (Anthropic, OpenAI, OpenAI-compatible local, none), provider configuration and capability discovery, how Laravel chooses a provider for a run, the AI credit ledger semantics, grants, limits, the global USD budget, cost computation, usage metering, and every related UI, command, event and error.

Where something is needed that is not yet in `02`/`12`/`13`/`14`/`17`, it is used here and listed in the final **Appendix**.

---

## 0. Summary of decisions

| # | Decision | Rationale |
|---|---|---|
| Q1 | **Laravel never calls an LLM.** All provider SDKs and credentials live only in the vision service. Laravel learns what is available through `GET /v1/capabilities`. | One place for secrets; the LLM step needs the image toolchain (crop tool loop). (01 §1.1) |
| Q2 | Providers: `anthropic` (default model `claude-opus-5-5`), `openai` (model set by the operator, never hard-coded), `openai_compatible` (Ollama / vLLM / LM Studio; capabilities declared by flags), `none` (pure CV + OCR + heuristics). | Owner requirement (master D5). |
| Q3 | One provider-neutral conversation/tool abstraction in Python; adapters translate. Prompts are provider-agnostic text (06 §9.3). | Swap providers without touching the pipeline. |
| Q4 | Final answers use **structured outputs** (JSON Schema) where supported; otherwise JSON-in-prompt + pydantic validation + one repair round. | Reliable machine-readable labels. |
| Q5 | Credit ledger uses **reservation → (release + consumption)** double entry. A run reserves at start; success writes a release and a consumption of the credits actually used; a system failure writes only a release; post-success refunds use `refund`. | Balance is reduced immediately (no concurrent overspend), every state is auditable, and per-import sums are checkable invariants. |
| Q6 | Monthly credits **top up to** `monthly_credits` (never accumulate beyond it). One `monthly_grant` row per customer per period, even when the top-up is 0. | Bounded liability, no hoarding of unused allowance, simple message ("topped up to 3 every month"); the zero-delta row makes the daily job idempotent. |
| Q7 | Daily recognition limit counts **runs started per calendar day in the business timezone**, including provider `none`; system failures give the run back. | Protects CPU and money; customers aren't punished for our failures. |
| Q8 | Global budget = sum of `ai_usage_events.cost_micro_usd` in the current **calendar month (business timezone)**, applied to everyone (staff too). Exhausted → `fallback_none` (default) or `block`. | Owner's hard monthly cost guard. |
| Q9 | Cost is estimated from token counts × `ai.price_table`; cache read/write tokens are priced at the input rate. | Conservative (slight overestimate); one simple formula for all providers. |
| Q10 | Anthropic: streaming Messages API, adaptive thinking (always on for Opus 5.5), explicit `output_config.effort`, strict tools, `output_config.format` JSON schema, `tool_choice` only `auto`/`none` (forced choice is rejected), no assistant prefill, `refusal` handled, server-side refusal fallback enabled by default. | Current API rules for `claude-opus-5-5`. |
| Q11 | OpenAI and OpenAI-compatible use the `openai` SDK **Chat Completions** API (not Responses). | Chat Completions is the one API surface every OpenAI-compatible local server implements. |
| Q12 | DXF imports are always charged like provider `none` (default 0 credits); the LLM is used there only for cheap text-only layer mapping. | Predictable price; DXF needs little AI. |

---

## 1. Scope and principles

1. The **feature** metered in v1 is `blueprint_recognition` (plus `provider_test` for the admin connection test, Appendix). The ledger and usage tables are generic (`feature`, `reference`) so the phase-2 furniture assistant can reuse them.
2. Customers see **credits** only, never USD. Staff with `ai.usage.view` see USD costs.
3. Every LLM call is made inside one `/v1/recognize` (or `/v1/providers/test`) request; the vision service returns token usage; Laravel prices it and stores one `ai_usage_events` row per run.
4. Effort setting values are `low|medium|high` (02 §13); higher levels (`xhigh`, `max`) are not exposed in v1.

---

## 2. Provider catalogue

| Provider | SDK (vision) | Configured when | Default model | Vision | Tools (crop loop) | Native JSON schema | Effort parameter |
|---|---|---|---|---|---|---|---|
| `anthropic` | `anthropic` (official Python SDK) | `ANTHROPIC_API_KEY` non-empty | `ANTHROPIC_MODEL` (default `claude-opus-5-5`) | yes | yes (strict tools) | yes (`output_config.format`) | `output_config.effort` |
| `openai` | `openai` (official Python SDK) | `OPENAI_API_KEY` **and** `OPENAI_MODEL` non-empty | `OPENAI_MODEL` (required; no built-in default) | yes | yes (strict function tools) | yes (`response_format` `json_schema`, `strict: true`) | `reasoning_effort` when `OPENAI_SEND_REASONING_EFFORT=true` |
| `openai_compatible` | `openai` with `base_url` | `OPENAI_COMPAT_BASE_URL` **and** `OPENAI_COMPAT_MODEL` non-empty | `OPENAI_COMPAT_MODEL` (e.g. a Qwen-VL family model served by Ollama/vLLM/LM Studio) | `OPENAI_COMPAT_SUPPORTS_VISION` | `OPENAI_COMPAT_SUPPORTS_TOOLS` | `OPENAI_COMPAT_SUPPORTS_JSON_SCHEMA` | `reasoning_effort` only when `OPENAI_COMPAT_SEND_REASONING_EFFORT=true` |
| `none` | — | always | — | n/a (heuristic labeler) | n/a | n/a | n/a |

Not in scope: Gemini (its normalized `[ymin,xmin,ymax,xmax]` 0–1000 boxes would need a different coordinate contract), Bedrock/Vertex/Foundry clients, PHP AI SDKs.

---

## 3. Model, effort, image and token mapping

| Setting | `anthropic` | `openai` | `openai_compatible` |
|---|---|---|---|
| `ai.effort` low/medium/high | `output_config: {effort: <same>}` (always sent explicitly; Opus 5.5's API default is `medium`, ours is `high`) | `reasoning_effort: <same>` if enabled; on a 400 mentioning `reasoning_effort` the adapter retries once without it and stops sending it for the process lifetime | same as openai, only if enabled |
| Thinking | `thinking: {type: "adaptive"}` (cannot be disabled on Opus 5.5; never send `disabled` or `budget_tokens`) | model-defined | model-defined |
| Max output tokens per call | `ANTHROPIC_MAX_OUTPUT_TOKENS` = 32000 (streaming) | `max_completion_tokens` = `OPENAI_MAX_OUTPUT_TOKENS` = 32000 | `max_tokens` = `OPENAI_COMPAT_MAX_OUTPUT_TOKENS` = 8192 |
| Overview image long edge `max_image_px` | `ANTHROPIC_MAX_IMAGE_PX` = 2576 (high-resolution tier; set 1568 for older models) | `OPENAI_MAX_IMAGE_PX` = 2048 | `OPENAI_COMPAT_MAX_IMAGE_PX` = 1280 |
| `max_images_per_request` | 20 | 10 | `OPENAI_COMPAT_MAX_IMAGES_PER_REQUEST` = 1 |
| Image encoding | PNG base64; if a PNG exceeds 4.5 MB → JPEG quality 90 (API limit 5 MB/image) | PNG data URL, `detail: "high"`; > 4.5 MB → JPEG 90 | PNG data URL (no `detail` field); > 4.5 MB → JPEG 90 |
| Per-call timeout | `VISION_LLM_CALL_TIMEOUT_S` = 180 | 180 | `OPENAI_COMPAT_TIMEOUT_S` = 300 |

Rules that apply to all providers:
- Images are always pre-resized by the vision service (06 §9.2); PDFs are never sent to a provider (rasterised by us).
- Coordinates exchanged with any model are absolute integer pixels of the image as sent (never normalized 0–1000). LLM coordinates are only hints (06 §8.7 steps 2–3); wall geometry always comes from CV.
- Per run at most: 2 overview images + `VISION_AGENT_MAX_CROPS` (8) crops; `VISION_AGENT_MAX_TURNS` (10) model calls; one repair call.
- If `max_images_per_request` would be exceeded by accumulated history (compat with tools), the adapter drops the oldest crop images from earlier tool-result messages, replacing them with the text `[image omitted]` (Anthropic/OpenAI never reach this limit with our caps).

---

## 4. Vision service configuration (environment)

`vision/app/config.py`: `class Settings(BaseSettings)` (`pydantic-settings`, `env_file=None`, case-insensitive). All values below; secrets only here (Laravel has none of them).

| Variable | Type / default | Meaning |
|---|---|---|
| `VISION_SERVICE_TOKEN` | str, **required** (≥ 32 chars; startup fails otherwise) | Bearer token shared with Laravel |
| `VISION_LOG_LEVEL` | `info` | |
| `VISION_RECOGNIZE_DEADLINE_S` | 570 | Hard deadline per `/v1/recognize` |
| `VISION_LLM_STAGE_BUDGET_S` | 420 | Max wall time of the labeling stage |
| `VISION_LLM_CALL_TIMEOUT_S` | 180 | Per model call (Anthropic/OpenAI) |
| `VISION_AGENT_MAX_TURNS` | 10 | Model calls per agent loop |
| `VISION_AGENT_MAX_CROPS` | 8 | `crop_image` calls per run |
| `VISION_MAX_SOURCE_BYTES` | 26214400 | Fetch cap (DXF uses 15728640) |
| `VISION_MAX_PIXELS` | 40000000 | Downscale threshold |
| `VISION_HEAVY_SLOT_WAIT_S` | 2 | Wait before answering 503 busy |
| `ANTHROPIC_API_KEY` | str, optional | Enables `anthropic` |
| `ANTHROPIC_MODEL` | `claude-opus-5-5` | Default when Laravel sends `model: null` |
| `ANTHROPIC_BASE_URL` | optional | Proxy/gateway |
| `ANTHROPIC_MAX_IMAGE_PX` | 2576 | |
| `ANTHROPIC_MAX_OUTPUT_TOKENS` | 32000 | |
| `ANTHROPIC_SERVER_FALLBACK` | `true` | Send `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`) so a safety-classifier refusal is retried server-side on a fallback model |
| `OPENAI_API_KEY` | optional | Enables `openai` (with `OPENAI_MODEL`) |
| `OPENAI_MODEL` | optional; **required when `OPENAI_API_KEY` is set** (startup logs an error and marks the provider not configured otherwise) | |
| `OPENAI_BASE_URL` | optional | Organisation gateway |
| `OPENAI_MAX_IMAGE_PX` | 2048 | |
| `OPENAI_MAX_OUTPUT_TOKENS` | 32000 | |
| `OPENAI_SEND_REASONING_EFFORT` | `true` | |
| `OPENAI_COMPAT_BASE_URL` | optional, e.g. `http://ollama:11434/v1`, `http://vllm:8000/v1`, `http://lmstudio:1234/v1` | Enables `openai_compatible` (with model) |
| `OPENAI_COMPAT_API_KEY` | `not-needed` | Sent as bearer (most local servers ignore it) |
| `OPENAI_COMPAT_MODEL` | optional; required to enable | |
| `OPENAI_COMPAT_SUPPORTS_VISION` | `true` | Image input accepted |
| `OPENAI_COMPAT_SUPPORTS_TOOLS` | `false` | Function calling reliable enough for the crop loop |
| `OPENAI_COMPAT_SUPPORTS_JSON_SCHEMA` | `false` | `response_format: json_schema` honoured |
| `OPENAI_COMPAT_MAX_IMAGE_PX` | 1280 | |
| `OPENAI_COMPAT_MAX_IMAGES_PER_REQUEST` | 1 | |
| `OPENAI_COMPAT_MAX_OUTPUT_TOKENS` | 8192 | |
| `OPENAI_COMPAT_SEND_REASONING_EFFORT` | `false` | |
| `OPENAI_COMPAT_TIMEOUT_S` | 300 | Local models are slow |

Defaults for `openai_compatible` flags are conservative (vision on, tools and JSON schema off) so an unknown local model still works in single-pass mode with prompt-JSON.

---

## 5. Capability discovery and connection test

### 5.1 `GET /v1/capabilities` (bearer auth)

```json
{
  "serviceVersion": "1.0.0",
  "pipelineVersion": "1.0.0",
  "providers": [
    { "name": "anthropic", "configured": true, "defaultModel": "claude-opus-5-5",
      "supportsVision": true, "supportsTools": true, "supportsJsonSchema": true, "supportsEffort": true,
      "maxImagePx": 2576, "maxImagesPerRequest": 20,
      "lastError": null },
    { "name": "openai", "configured": false, "defaultModel": null, "supportsVision": true, "supportsTools": true,
      "supportsJsonSchema": true, "supportsEffort": true, "maxImagePx": 2048, "maxImagesPerRequest": 10,
      "lastError": null, "missing": ["OPENAI_API_KEY", "OPENAI_MODEL"] },
    { "name": "openai_compatible", "configured": true, "defaultModel": "qwen2.5vl:32b",
      "supportsVision": true, "supportsTools": false, "supportsJsonSchema": false, "supportsEffort": false,
      "maxImagePx": 1280, "maxImagesPerRequest": 1, "lastError": { "code": "provider_unreachable", "at": "2026-10-20T10:12:00Z" } },
    { "name": "none", "configured": true, "defaultModel": null, "supportsVision": false, "supportsTools": false,
      "supportsJsonSchema": false, "supportsEffort": false, "maxImagePx": 0, "maxImagesPerRequest": 0, "lastError": null }
  ],
  "ocr": { "engine": "rapidocr", "loaded": true },
  "limits": { "maxSourceBytes": 26214400, "maxDxfBytes": 15728640, "maxPdfPages": 20, "maxPixels": 40000000, "recognizeDeadlineS": 570 }
}
```
- `missing` lists unset env var **names** only (never values) for unconfigured providers.
- `lastError`: the most recent `provider_auth_failed`, `provider_unreachable` or `model_not_found` seen by this worker within the last 60 minutes (in-memory; per worker).
- No network calls are made to providers by this endpoint (fast, free).

### 5.2 Laravel caching

`VisionClient::capabilities()` caches the response in Redis key `vision:capabilities` for 300 s and the last successful response in `vision:capabilities:last` for 24 h. If the call fails, `capabilities()` returns the `:last` copy flagged `stale: true`; if none exists, a synthetic response where only `none` is configured. `VisionCapabilitiesData` (spatie data) mirrors the JSON.

### 5.3 `POST /v1/providers/test` (bearer auth; admin "Test connection")

Request: `{ "provider": "anthropic", "model": "claude-opus-5-5" | null }`.
Behaviour: one single-pass call with the system prompt `You are a connectivity check.`, user content = a 64×64 PNG (white with a black filled square in the top-left quadrant) + text `Is the black square in the top-left quadrant? Answer with the JSON object.`, output schema `{"ok": boolean, "quadrant": "top_left"|"top_right"|"bottom_left"|"bottom_right"}` (strict), effort `low`, timeout 60 s. For providers without vision the image is omitted and the question becomes `Reply with ok = true and quadrant = "top_left".`
Response 200:
```json
{ "ok": true, "provider": "anthropic", "model": "claude-opus-5-5", "latencyMs": 2310,
  "visionVerified": true, "jsonSchemaVerified": true,
  "usage": { "purpose": "provider_test", "model": "claude-opus-5-5", "inputTokens": 140, "outputTokens": 30,
             "cacheReadInputTokens": 0, "cacheCreationInputTokens": 0, "images": 1, "durationMs": 2310,
             "stopReason": "end_turn", "status": "succeeded" },
  "error": null }
```
On provider failure: 200 with `ok: false`, `error: {code, message}` (message is the provider's error text with secrets stripped). Provider `none` → `ok: true` without a call. Laravel records the usage via `RecordUsage` with feature `provider_test`, `user_id` = admin.

---

## 6. Provider abstraction (Python, `vision/app/providers/`)

### 6.1 Neutral types (`providers/base.py`)

```python
ProviderName = Literal['anthropic', 'openai', 'openai_compatible', 'none']
Effort = Literal['low', 'medium', 'high']

@dataclass(frozen=True)
class ProviderCapabilities:
    supports_vision: bool
    supports_tools: bool
    supports_json_schema: bool
    supports_effort: bool
    max_image_px: int
    max_images_per_request: int

@dataclass(frozen=True)
class TextPart:  text: str
@dataclass(frozen=True)
class ImagePart: data: bytes; media_type: Literal['image/png', 'image/jpeg']
Part = TextPart | ImagePart

@dataclass(frozen=True)
class ToolSpec: name: str; description: str; input_schema: dict    # strict JSON schema (06 §9.5)
@dataclass(frozen=True)
class JsonSchemaSpec: name: str; schema: dict                     # e.g. ("floor_plan_labels", to_strict_schema(LabelingResult))

@dataclass(frozen=True)
class ToolCall: id: str; name: str; arguments: dict
@dataclass(frozen=True)
class ToolResult: call_id: str; content: list[Part]; is_error: bool = False

@dataclass(frozen=True)
class UserMessage: parts: list[Part]
@dataclass(frozen=True)
class ToolResultsMessage: results: list[ToolResult]
@dataclass(frozen=True)
class AssistantMessage:
    native: object            # provider-native assistant content, replayed unchanged (append-only history)
    text: str | None
    tool_calls: list[ToolCall]
Message = UserMessage | ToolResultsMessage | AssistantMessage

@dataclass(frozen=True)
class UsageCall:
    purpose: Literal['labeling', 'agent_turn', 'finalize', 'repair', 'dxf_layers', 'provider_test']
    model: str
    input_tokens: int
    output_tokens: int
    cache_read_input_tokens: int
    cache_creation_input_tokens: int
    images: int
    duration_ms: int
    stop_reason: str
    status: Literal['succeeded', 'failed']

@dataclass(frozen=True)
class TurnResult:
    assistant: AssistantMessage
    stop_reason: Literal['end_turn', 'tool_use', 'max_tokens', 'refusal', 'other']
    usage: UsageCall

class LLMProvider(ABC):
    name: ProviderName
    model: str
    capabilities: ProviderCapabilities

    @abstractmethod
    def complete(self, conversation: list[Message], *, system: str, tools: list[ToolSpec],
                 tool_choice: Literal['auto', 'none'], output_schema: JsonSchemaSpec | None,
                 effort: Effort, max_output_tokens: int, timeout_s: float,
                 purpose: str) -> TurnResult: ...
```

`tool_choice` intentionally has no `any`/`tool` value (forced tool choice is rejected by current Claude models and is never needed: the final answer comes through structured output).

### 6.2 Errors (`providers/errors.py`)

```python
class ProviderError(Exception):            # base; .code: str, .retryable: bool, .usage: list[UsageCall]
class ProviderAuthError(ProviderError):    # code 'provider_auth_failed', retryable False
class ProviderBadRequest(ProviderError):   # code 'provider_bad_request' | 'model_not_found', retryable False
class ProviderUnavailable(ProviderError):  # code 'provider_unreachable' | 'provider_rate_limited' | 'provider_overloaded', retryable True
class ProviderTimeout(ProviderError):      # code 'llm_timeout', retryable True
class ProviderRefusal(ProviderError):      # code 'llm_refused', retryable False; .category: str | None
class ProviderInvalidOutput(ProviderError):# code 'llm_invalid_output' (unparseable/invalid JSON, or truncated by max tokens), retryable False
```
Every error carries the usage of calls already made in the run so tokens are always billed.

Mapping to `ImportResultMeta.fallbackReason` (06 §6): `ProviderAuthError` → `provider_auth_failed`; `ProviderTimeout` → `llm_timeout`; `ProviderRefusal` → `llm_refused`; `ProviderInvalidOutput` → `llm_invalid_output`; all others → `llm_error`.

### 6.3 Registry (`providers/registry.py`)

```python
def provider_capabilities(settings: Settings) -> list[ProviderInfo]          # feeds /v1/capabilities
def get_provider(name: ProviderName, model: str | None, settings: Settings) -> LLMProvider | None
```
`get_provider('none', …)` returns `None` (the pipeline then uses the heuristic labeler). An unconfigured name raises `VisionError('provider_not_configured', 400)`. `model=None` → the provider's default model from env. Provider instances (and their SDK clients) are cached per (name, model) per process.

### 6.4 Usage reporting

The labeling stage collects `UsageCall`s in order; `/v1/recognize` returns them as `usage.calls` plus `usage.totals` (`requests` = number of calls, `inputTokens` = Σ input_tokens, `outputTokens`, `images`, `durationMs`) and `usage.status` (`failed` if any call failed or the run fell back to `none` after an LLM error; else `succeeded`). For provider `none`, `usage = {provider: 'none', model: null, calls: [], totals: zeros, status: 'succeeded'}`.

---

## 7. Adapters

### 7.1 Anthropic (`providers/anthropic_provider.py`)

Client (one per process): `anthropic.Anthropic(api_key=settings.anthropic_api_key, base_url=settings.anthropic_base_url or None, max_retries=2, timeout=httpx.Timeout(settings.vision_llm_call_timeout_s, connect=10.0))`.

Request built by `complete()`:

```python
params = {
    "model": self.model,
    "max_tokens": max_output_tokens,                 # 32000
    "system": [{"type": "text", "text": system}],
    "messages": to_anthropic_messages(conversation),
    "thinking": {"type": "adaptive"},
    "output_config": {"effort": effort} | ({"format": {"type": "json_schema", "schema": output_schema.schema}} if output_schema else {}),
    "cache_control": {"type": "ephemeral"},          # top-level automatic prompt caching (system + tools + early turns are stable)
}
if tools:
    params["tools"] = [{"name": t.name, "description": t.description, "input_schema": t.input_schema,
                        "strict": True, "eager_input_streaming": True} for t in tools]
    params["tool_choice"] = {"type": tool_choice}    # "auto" or "none" only
if settings.anthropic_server_fallback and not self._fallback_disabled:
    stream_cm = client.beta.messages.stream(**params, betas=["server-side-fallback-2026-07-01"], fallbacks="default")
else:
    stream_cm = client.messages.stream(**params)
with stream_cm as stream:
    msg = stream.get_final_message()
```

Message conversion `to_anthropic_messages`:
- `UserMessage` → `{"role": "user", "content": [image blocks first, then text blocks]}`; image block `{"type": "image", "source": {"type": "base64", "media_type": part.media_type, "data": base64.standard_b64encode(part.data).decode()}}`.
- `AssistantMessage` → `{"role": "assistant", "content": native}` where `native` is `msg.content` of the earlier response **unchanged** (thinking blocks included; never edited, reordered or stripped — history is append-only so thinking blocks stay valid).
- `ToolResultsMessage` → one `{"role": "user", "content": [ {"type": "tool_result", "tool_use_id": r.call_id, "is_error": r.is_error, "content": [image blocks…, text blocks…]} for r in results ]}` (all results of one assistant turn in a single user message).
- No assistant prefill is ever appended (rejected by current models).

Response handling:
1. `msg.stop_reason == "refusal"` → `ProviderRefusal(category=msg.stop_details.category if msg.stop_details else None)`; never retried by us (the server-side fallback already had its chance).
2. `"max_tokens"` → `ProviderInvalidOutput('truncated')`.
3. `text` = concatenation of `text` blocks; `tool_calls` = `tool_use` blocks → `ToolCall(id=b.id, name=b.name, arguments=b.input)` (parsed object; the agent validates each against a pydantic model — inputs may be incomplete with eager streaming — and answers invalid ones with an `is_error` tool result).
4. `stop_reason` mapping: `end_turn`/`stop_sequence` → `end_turn`; `tool_use` → `tool_use`; else `other`.
5. Usage: `input_tokens = msg.usage.input_tokens`, `output_tokens = msg.usage.output_tokens`, `cache_read_input_tokens = msg.usage.cache_read_input_tokens or 0`, `cache_creation_input_tokens = msg.usage.cache_creation_input_tokens or 0`, `model = msg.model` (the served model; differs from the requested one when the server-side fallback ran), `images` = image blocks sent in this request's **new** content (overview images or the latest tool results), `duration_ms` measured.

Exception mapping (SDK has already retried 2× with backoff for 408/409/429/5xx/connection errors):

| SDK exception | Neutral error |
|---|---|
| `anthropic.AuthenticationError`, `anthropic.PermissionDeniedError` | `ProviderAuthError` |
| `anthropic.NotFoundError` | `ProviderBadRequest('model_not_found')` |
| `anthropic.BadRequestError` | `ProviderBadRequest` — if the message mentions `fallbacks`, set `_fallback_disabled = True` (process lifetime, log warning) and retry the same request once without it |
| `anthropic.RateLimitError` | `ProviderUnavailable('provider_rate_limited')` |
| `anthropic.InternalServerError`, other `anthropic.APIStatusError` ≥ 500 | `ProviderUnavailable('provider_overloaded')` |
| `anthropic.APITimeoutError` | `ProviderTimeout` |
| `anthropic.APIConnectionError` | `ProviderUnavailable('provider_unreachable')` |

### 7.2 OpenAI (`providers/openai_provider.py`)

Client: `openai.OpenAI(api_key=settings.openai_api_key, base_url=settings.openai_base_url or None, max_retries=2, timeout=settings.vision_llm_call_timeout_s)`.

```python
kwargs = {
    "model": self.model,
    "messages": [{"role": "system", "content": system}] + to_openai_messages(conversation),
    "max_completion_tokens": max_output_tokens,
}
if output_schema:
    kwargs["response_format"] = {"type": "json_schema",
                                 "json_schema": {"name": output_schema.name, "schema": output_schema.schema, "strict": True}}
if tools:
    kwargs["tools"] = [{"type": "function", "function": {"name": t.name, "description": t.description,
                                                         "parameters": t.input_schema, "strict": True}} for t in tools]
    kwargs["tool_choice"] = tool_choice           # "auto" | "none"
if self.send_effort:
    kwargs["reasoning_effort"] = effort
resp = client.chat.completions.create(**kwargs)   # non-streaming; per-call timeout applies
```

Message conversion `to_openai_messages`:
- `UserMessage` → `{"role": "user", "content": [{"type": "image_url", "image_url": {"url": f"data:{mt};base64,{b64}", "detail": "high"}} …, {"type": "text", "text": …}]}`.
- `AssistantMessage` → `native` = `resp.choices[0].message.model_dump(exclude_none=True)` (role, content, tool_calls) replayed unchanged.
- `ToolResultsMessage` → one `{"role": "tool", "tool_call_id": r.call_id, "content": <joined text parts, prefixed "ERROR: " when is_error>}` per result; then, **if any result has images**, one extra `{"role": "user", "content": [{"type": "text", "text": "Images returned by tool call {call_id}:"}, image parts…]}` per such result, in call order. (Chat Completions tool messages cannot carry images.)

Response handling: `choice = resp.choices[0]`; `choice.message.refusal` non-null → `ProviderRefusal(category=None)`; `finish_reason == "length"` → `ProviderInvalidOutput('truncated')`; `finish_reason == "tool_calls"` → `tool_use` with `ToolCall(id, function.name, json.loads(function.arguments))` (JSON decode error → `is_error` tool result "invalid JSON arguments"); `"stop"` → `end_turn` with `text = message.content`. Usage: `input_tokens = usage.prompt_tokens`, `output_tokens = usage.completion_tokens` (includes reasoning tokens), `cache_read_input_tokens = usage.prompt_tokens_details.cached_tokens if present else 0`, `cache_creation_input_tokens = 0`, `model = resp.model`.

`reasoning_effort` rejection: `openai.BadRequestError` whose message contains `reasoning_effort` → retry once without it and set `send_effort = False` for the process lifetime.

Exception mapping: `openai.AuthenticationError`/`PermissionDeniedError` → `ProviderAuthError`; `NotFoundError` → `ProviderBadRequest('model_not_found')`; `BadRequestError` → `ProviderBadRequest`; `RateLimitError` → `ProviderUnavailable('provider_rate_limited')`; `InternalServerError` → `ProviderUnavailable('provider_overloaded')`; `APITimeoutError` → `ProviderTimeout`; `APIConnectionError` → `ProviderUnavailable('provider_unreachable')`.

### 7.3 OpenAI-compatible local (`providers/openai_compatible_provider.py`)

Subclass of the OpenAI adapter with: `base_url = OPENAI_COMPAT_BASE_URL`, `api_key = OPENAI_COMPAT_API_KEY`, timeout `OPENAI_COMPAT_TIMEOUT_S`, `max_tokens` (not `max_completion_tokens`, which many local servers don't know), no `detail` field on images, `send_effort = OPENAI_COMPAT_SEND_REASONING_EFFORT`, and capability flags from env:
- `supports_tools = false` → the labeler uses single-pass mode (06 §9.6); `tools`/`tool_choice` never sent.
- `supports_json_schema = false` → no `response_format`; the labeler appends `JSON_SCHEMA_INSTRUCTION_TEMPLATE` (06 §9.3) with the strict schema to the system prompt. Parsing: strip leading/trailing whitespace and Markdown code fences (```` ```json ````/```` ``` ````), take the substring from the first `{` to the last `}`, `json.loads`, `LabelingResult.model_validate`. On failure: one repair call with `REPAIR_PROMPT_TEMPLATE` listing up to 20 pydantic error lines (`loc: msg`); second failure → `ProviderInvalidOutput`; success after repair adds warning `llm_output_repaired`.
- `supports_json_schema = true` → `response_format` as in §7.2 (`strict: true`).
- `supports_vision = false` → raster labeling uses the heuristic labeler with `fallbackReason = 'vision_unsupported'`; text-only DXF layer mapping still uses the model.
- `max_images_per_request = 1` → only the "marked" overview image is sent (06 §9.2).
- Usage: tokens if the server reports `usage`, else 0; `model` = configured model.

### 7.4 `none` (`providers/none_provider.py`)

`NoneProvider` exists only to keep the registry uniform (`configured: true`, all capabilities false); `complete()` raises `NotImplementedError`. Recognition with `none` uses `HeuristicLabeler` (06 §9.7). Cost 0, no usage calls.

### 7.5 Retries and degradation (all providers)

- Only the SDK's built-in retries (2) are used per call; the agent loop does not retry a failed call (it fails the stage).
- Any `ProviderError` in labeling → if `fallbackToNoneOnError` (from `ai.fallback_to_none_on_error`, default true) the heuristic labeler runs, `providerUsed = 'none'`, warning `llm_failed_fallback_none`, usage status `failed`; else `/v1/recognize` responds 502 `provider_error` (retryable) with the usage collected so far.
- `ProviderAuthError` and `model_not_found` are additionally stored as the provider's `lastError` (§5.1).

---

## 8. Laravel: choosing the provider for a run

### 8.1 Data and action

```php
namespace App\Domain\Ai\Data;
final class RecognitionPlanData extends Data
{
    public function __construct(
        public string $provider,            // anthropic|openai|openai_compatible|none
        public ?string $model,              // null = vision default for that provider
        public string $effort,              // low|medium|high
        public bool $agenticCrops,
        public bool $fallbackToNone,
        public int $credits,                // credits that will be reserved
        public bool $chargeable,            // false for staff (staff_unlimited) or credits = 0
        public bool $budgetFallback,        // provider downgraded to none because the budget is exhausted
        public ?string $reason,             // null|'budget_fallback'|'provider_unavailable'|'dxf'|'basic_requested'
    ) {}
}

namespace App\Domain\Ai\Actions;
final class ResolveRecognitionPlan
{
    public function handle(User $actor, BlueprintImport $import, bool $preview = false, bool $forceBasic = false): RecognitionPlanData;
}
```

### 8.2 Algorithm

1. `$ai = Settings::get(SettingsGroup::Ai)`; `$caps = $vision->capabilities()`.
2. `$provider = $forceBasic ? 'none' : $ai->provider`; reason `basic_requested` when forced.
3. If `$provider !== 'none'` and `$caps` reports it not configured → `$provider = 'none'`, reason `provider_unavailable` (owners are notified once per 6 h via `ai.provider_unavailable`, §16).
4. If `$provider !== 'none'` and `$caps` reports `supportsVision = false` and the import is not DXF → `$provider = 'none'`, reason `provider_unavailable`.
5. Budget (§12): if `$provider !== 'none'` and `BudgetGuard::isExhausted()`:
   - `budget_exhausted_behavior = fallback_none` → `$provider = 'none'`, `budgetFallback = true`, reason `budget_fallback`;
   - `block` → if not `$preview` throw `AiQuotaException::budgetExhausted()` (HTTP 409 `ai_budget_exhausted`); in preview return the plan with reason `budget_fallback` and `provider = none` and let the UI show the block message.
6. Credits: `CreditPricing::creditsFor($provider, $import)` = `credits_per_recognition_none` if `$provider === 'none'` **or** `$import->source_kind === dxf` (reason `dxf`, §8.3); else `credits_per_recognition`.
7. `chargeable = $credits > 0 && !($actor->isStaff() && $ai->staff_unlimited)`.
8. Model: `$provider === 'none'` → null; `$provider === $ai->provider` and `$ai->model` non-blank → `$ai->model`; else `$caps->provider($provider)->defaultModel`.
9. Unless `$preview`:
   - daily limit (§11.1) for non-staff (or staff when `staff_unlimited = false`): `used ≥ max_recognitions_per_day` (and limit > 0) → `AiQuotaException::dailyLimit()` (429 `daily_limit_reached`, details `{limit, resetsAt}`);
   - balance: `chargeable && CreditBalance::available($import->user) < $credits` → `AiQuotaException::insufficientCredits()` (402 `insufficient_credits`, details `{balance, needed}`). (Authoritative re-check under lock in `ReserveCredits`.)
10. Return the plan with `effort = $ai->effort`, `agenticCrops = $ai->agentic_crops`, `fallbackToNone = $ai->fallback_to_none_on_error`.

Preview mode (used for `ImportStatusData.cost`, 06 §4.3, and the "Improve with AI" button) never throws for limits; the UI combines it with `CreditSummaryData` (§15.1).

### 8.3 DXF rule

DXF imports always cost `credits_per_recognition_none` (default 0) whatever the provider; the provider is still passed so the vision service can use it for text-only layer mapping when heuristics fail (06 §10.2). The usage of that call is recorded and counts toward the global budget like any other.

### 8.4 Building the `/v1/recognize` options

`RunBlueprintRecognition` (06 §4.7) sends `provider`, `model`, `effort`, `agenticCrops`, `fallbackToNoneOnError` from the `RecognitionPlanData` captured at start (not re-read at run time), so a settings change while a run is queued does not change its price.

---

## 9. AI credit ledger (`ai_credit_ledger`, 02 §7.1)

### 9.1 Entry kinds

| Kind | Sign | `reference` | `period` | `created_by` | `note` | Written by |
|---|---|---|---|---|---|---|
| `signup_grant` | + | — | — | null | — | `GrantCredits::signup` |
| `monthly_grant` | + or 0 | — | `YYYY-MM` | null | — | `GrantCredits::monthly` |
| `admin_grant` | + | — | — | staff | reason (required) | `GrantCredits::admin` |
| `admin_revoke` | − | — | — | staff | reason (required) | `GrantCredits::revoke` |
| `reservation` | − | BlueprintImport | — | null | — | `ReserveCredits` |
| `reservation_release` | + | BlueprintImport | — | null | — | `CommitCredits`, `RefundCredits::releaseReservation` |
| `consumption` | − | BlueprintImport | — | null | — | `CommitCredits` |
| `refund` | + | BlueprintImport | — | staff | reason (required) | `RefundCredits::refundConsumption` |

Definitions (per user `u`, per import `i`):
- `balance(u) = Σ delta` over all rows of `u` (includes outstanding reservations, so it is the **available** balance).
- `reserved(i) = −Σ delta(reservation, i) − Σ delta(reservation_release, i)` (outstanding reservation, ≥ 0).
- `charged(i) = −Σ delta(consumption, i) − Σ delta(refund, i)` (net consumed, ≥ 0).
- Column `blueprint_imports.credits_reserved` = credits reserved by the latest start (informational); `credits_charged` = `charged(i)` (kept in sync by the actions).

Invariants (tested; §17): `balance(u) ≥ 0` at all times; for every import in a terminal state `reserved(i) = 0`; `charged(i) ≤ credits reserved at the last start`; at most one `monthly_grant` per (user, period) (partial unique index, 02).

All ledger writes: inside `DB::transaction`, after `User::whereKey($userId)->lockForUpdate()->first()` (serialises concurrent writes per user), then `Cache::forget("ai:balance:{$userId}")` and `AiCreditsChanged` broadcast **after commit**.

### 9.2 `ReserveCredits::handle(User $user, int $credits, BlueprintImport $import): void`

Called from `StartBlueprintRecognition` (06 §4.6) only when `chargeable`. Lock user; `balance = SUM(delta)`; `balance < credits` → throw `AiQuotaException::insufficientCredits()`; insert `reservation` (−credits, reference import); `$import->credits_reserved = $credits`.

### 9.3 `CommitCredits::handle(BlueprintImport $import, int $creditsUsed): void`

Called from `CompleteImportRecognition` (06 §4.8) with `$creditsUsed = CreditPricing::creditsFor(meta.providerUsed, $import)` (so a run that fell back to `none` is charged the `none` price). Lock user; `outstanding = reserved(i)`; if `outstanding = 0` → return (staff/free run, or already committed — idempotent). Insert `reservation_release` (+outstanding) and, if `min(creditsUsed, outstanding) > 0`, `consumption` (−min(creditsUsed, outstanding)); set `credits_charged`.

### 9.4 `RefundCredits::releaseReservation(BlueprintImport $import): void`

Called from `MarkImportFailed` (system failures, 06 §4.9) and `CancelImport` (from `queued`). Lock user; `outstanding = reserved(i)`; if > 0 insert `reservation_release` (+outstanding). Idempotent. Never touches consumptions.

### 9.5 `RefundCredits::refundConsumption(BlueprintImport $import, User $staff, string $note): void`

Staff action "Refund credits" on an import (admin import detail or customer AI card), permission `ai.credits.manage`. Requires `charged(i) > 0`. Lock user; insert `refund` (+charged(i)), `created_by = staff`, `note` (3–255 chars); `credits_charged = 0`; activity `ai.credits_refunded`; notification `ai.credits_refunded` to the customer. Not available to customers: discarding an accepted-able result never refunds (06 §11.6).

### 9.6 Balance reads

`App\Domain\Ai\Services\CreditBalance`:
```php
public function available(User $user): int;          // Cache::remember("ai:balance:{id}", 3600, fn () => SUM(delta))
public function pending(User $user): int;            // Σ reserved(i) over the user's imports in queued/preprocessing/recognizing
public function summary(User $user): CreditSummaryData;
```

`CreditSummaryData { balance: int, pending: int, unlimited: bool, monthlyCredits: int, nextTopUpOn: ?string (Y-m-d, first day of next month in business TZ; null when monthly_credits = 0), creditsPerRecognition: int, creditsPerRecognitionNone: int, dailyLimit: int (0 = unlimited), usedToday: int, aiAvailable: bool (provider resolves to non-none in preview) }` — shared as the `credits` prop on import pages (06 §4.3) and the account credits page.

---

## 10. Grants

### 10.1 Signup grant

Listener `App\Domain\Ai\Listeners\GrantSignupCredits` on the Identity domain event `CustomerRegistered` (dispatched by `RegisterCustomer` and by staff-created customer accounts; Appendix). `GrantCredits::signup(User $user)`: if `ai.signup_credits > 0` and the user has no `signup_grant` row → insert `signup_grant` (+signup_credits). Staff users get nothing.

### 10.2 Monthly top-up — `ai:grant-monthly-credits`

Signature: `ai:grant-monthly-credits {--period= : YYYY-MM, default current month in business TZ} {--dry-run}`; scheduled daily 02:00 (01 §7) with `withoutOverlapping()` and `onOneServer()`.

1. `monthly = ai.monthly_credits`; if 0 → print "monthly credits disabled" and exit 0.
2. Iterate customers `type = customer`, `is_active = true`, not soft-deleted, `created_at < end of period`, `chunkById(500)`.
3. Per user, in a transaction with the user row locked: skip if a `monthly_grant` with this `period` exists; `base = balance(u) + pending(u)` (outstanding reservations are counted as owned, so an in-flight run doesn't inflate the top-up); `delta = max(0, monthly − base)`; insert `monthly_grant` (delta, period) — **also when delta = 0** (marks the period as processed); a unique-violation (`23505`) is caught and treated as already done.
4. Output: counts of users processed, topped up, already at/above cap, total credits granted. `--dry-run` computes without inserting.

Effect: a customer with 0 credits on the 1st gets +3; one with 2 gets +1; one with 10 (admin grant) gets 0. Credits never expire.

### 10.3 Admin grant / revoke

`GrantCredits::admin(User $customer, int $amount, string $reason, User $staff)` — amount 1..1000; `GrantCredits::revoke(User $customer, int $amount, string $reason, User $staff)` — amount 1..`balance(u)` (cannot go negative; 422 `revoke_exceeds_balance`). Reason 3–255 chars stored in `note`. Activity log events `ai.credits_granted` / `ai.credits_revoked` with `{amount, reason}`. Grants notify the customer (`ai.credits_granted`); revokes do not. Permission `ai.credits.manage`. Staff users cannot be granted credits (422 `not_a_customer`).

---

## 11. Limits and abuse protection

### 11.1 Daily recognition limit

- Key `ai:recog:{userId}:{Y-m-d}` (date in business TZ), Redis `INCR` in `StartBlueprintRecognition` for every **auto-mode** start (any provider, including `none` and DXF) by a non-exempt user; `EXPIRE 172800`.
- Exempt: staff when `ai.staff_unlimited = true`.
- Check (before INCR, in `ResolveRecognitionPlan` step 9): `GET` value ≥ `max_recognitions_per_day` (> 0) → 429 `daily_limit_reached` with `resetsAt` = next midnight business TZ (ISO-8601).
- Give-back: `MarkImportFailed` (for a started auto-mode run) and `CancelImport` (from `queued`) `DECR` the key of the **current** business date if its value is > 0 (a run that started before midnight and fails after it gives back to the new day — harmless and simpler than tracking the start date).
- Trace mode never counts.

### 11.2 Other limits (all enforced in Laravel unless noted)

| Limit | Value | Error |
|---|---|---|
| Active runs per user | 2 (`imports.max_active_per_user`) | 429 `too_many_active_imports` |
| Start rate | 10 / hour / user (`RateLimiter::for('imports-start')`) | 429 `rate_limited` (`Retry-After`) |
| Presign rate | 20 / hour / user | 429 `rate_limited` |
| Provider test | 10 / minute / staff user (`ai-provider-test`) | 429 `rate_limited` |
| File size / pages / pixels | 06 §2.2 | 06 §14 |
| Re-run on the same upload | charged again (non-staff); staff free when `staff_unlimited` | — |

---

## 12. Global monthly budget

`App\Domain\Ai\Services\BudgetGuard`:
```php
public function limitMicroUsd(): ?int;          // null when ai.global_monthly_budget_usd = 0 (unlimited); else round(usd × 1_000_000)
public function spentMicroUsd(?CarbonImmutable $month = null): int;   // Σ cost_micro_usd in [monthStart, nextMonthStart) business TZ, converted to UTC; cached 60 s in "ai:budget:spent:{Y-m}"
public function isExhausted(): bool;            // limit !== null && spent >= limit
public function percentUsed(): ?float;
```
- In-flight runs are not pre-counted; worst-case overshoot ≈ 2 concurrent runs (≈ USD 0.40 each with `claude-opus-5-5` at ~60K input / ~8K output tokens).
- Applies to every user including staff (`staff_unlimited` exempts from credits and the daily limit only).
- After each `RecordUsage` insert: bust the cache key, then check thresholds 80 % and 100 %: `Cache::add("ai:budget:notified:{Y-m}:{pct}", true, now()->addDays(40))` — when it returns true dispatch `AiBudgetThresholdReached(pct, spentUsd, limitUsd)` → notification `ai.budget_threshold_reached` to all owners (in-app + email).
- Behaviour when exhausted: §8.2 step 5. Customer messages: `fallback_none` → note on the options step "AI analysis is paused for now — we'll use basic recognition (free)." ; `block` → 409 `ai_budget_exhausted` "AI analysis is unavailable right now. You can trace your drawing yourself or try again later."

---

## 13. Usage metering and cost

### 13.1 `RecordUsage::handle(?Model $reference, ?User $user, string $feature, array $usage, int $durationMs): AiUsageEvent`

Writes one `ai_usage_events` row per run:

| Column | Value |
|---|---|
| `user_id` | uploader (recognition) / admin (provider test) |
| `feature` | `blueprint_recognition` \| `provider_test` |
| `provider` | `usage.provider` (the provider whose calls were made = the requested provider; `none` when no LLM was involved) |
| `model` | model of the last call (`usage.calls[-1].model`) or `usage.model`; null for `none` |
| `request_count` | `usage.totals.requests` |
| `input_tokens` | Σ (`inputTokens` + `cacheReadInputTokens` + `cacheCreationInputTokens`) |
| `output_tokens` | Σ `outputTokens` |
| `image_count` | Σ `images` |
| `cost_micro_usd` | §13.2 |
| `duration_ms` | `meta.timings.totalMs` for recognition (whole vision run), `latencyMs` for tests |
| `status` | `usage.status` |
| `reference_*` | the BlueprintImport (null for tests) |

Recorded on: successful recognition (06 §4.8), vision error responses that include `usage` (06 §4.7 step 7), provider tests (§5.3). Runs with provider `none` are recorded with zeros (for run counts in reports).

### 13.2 Cost formula (`App\Domain\Ai\Support\CostCalculator`)

`ai.price_table` rows `{provider, model, input_per_mtok_usd, output_per_mtok_usd}`. Because 1 USD per million tokens = 1 micro-USD per token:

```
cost_micro_usd(call) = round_half_up(in_tokens(call) × input_per_mtok_usd + out_tokens(call) × output_per_mtok_usd)
in_tokens(call)  = inputTokens + cacheReadInputTokens + cacheCreationInputTokens
cost_micro_usd(run) = Σ cost_micro_usd(call)
```
Price lookup per call: exact `(provider, call.model)` → else `(provider, configured ai.model)` → else 0 with `Log::warning` and `Cache::put("ai:price_missing:{provider}:{model}", true, 7 days)` (the AI settings page shows "No price for {model} — costs are recorded as $0"). Arithmetic uses `brick/math` `BigDecimal` to avoid float error. Example: 61 200 input + 8 200 output tokens on `claude-opus-5-5` (4.00/20.00) → 244 800 + 164 000 = 408 800 µUSD = USD 0.41.

---

## 14. Error codes (AI/quotas)

HTTP errors returned by Laravel endpoints (JSON `{code, message, details?}`; `message` is the translated customer text):

| Code | HTTP | Where | Message key `ai.error.{code}` (en) |
|---|---|---|---|
| `insufficient_credits` | 402 | start/rerun | "You don't have enough AI credits ({balance} left, {needed} needed). Run basic recognition for free, or trace the drawing yourself." |
| `daily_limit_reached` | 429 | start/rerun | "You've reached today's limit of {limit} analyses. You can try again after midnight, or trace the drawing yourself." |
| `too_many_active_imports` | 429 | start | "You already have 2 analyses running. Please wait for one to finish." |
| `ai_budget_exhausted` | 409 | start/rerun (block mode) | "AI analysis is unavailable right now. You can trace your drawing yourself or try again later." |
| `rate_limited` | 429 | presign/start/test | "Too many requests. Please wait a moment and try again." |
| `revoke_exceeds_balance` | 422 | admin revoke | "You can revoke at most {balance} credits." |
| `not_a_customer` | 422 | admin grant | "Credits can only be granted to customers." |
| `nothing_to_refund` | 422 | admin refund | "This import has no charged credits to refund." |

Vision-side provider codes (appear in `meta.fallbackReason`, vision error bodies, provider test results, `lastError`): `provider_not_configured`, `provider_auth_failed`, `provider_bad_request`, `model_not_found`, `provider_rate_limited`, `provider_overloaded`, `provider_unreachable`, `llm_timeout`, `llm_refused`, `llm_invalid_output`, `vision_unsupported`. Staff-facing labels: `ai.provider_error.{code}`.

---

## 15. UI

### 15.1 Customer

- **Import options step** (06 §1.1): credits line from `ImportStatusData.cost` + `CreditSummaryData`: "This analysis uses **1** AI credit. You have **3**." / "Free" / staff "Unlimited (staff)". States:
  - balance < cost → line in amber + buttons **Run basic recognition (free)** (A5 `{basic: true}`; hidden if `credits_per_recognition_none > balance`) and **Trace it myself (free)**; primary button disabled.
  - `reason = budget_fallback` → info callout (§12 text); cost shows the `none` price.
  - `reason = provider_unavailable` → no callout for customers (cost shows `none` price, label "Basic recognition").
  - daily limit reached (`usedToday ≥ dailyLimit`) → primary disabled with the §14 message.
- **Header chip** on the project and import pages: sparkles icon + balance ("3 credits"); hidden for staff; tooltip "AI credits are used to analyse blueprints. Topped up to {monthly} on {nextTopUpOn}."
- **Account → AI credits** page (`customer.account.ai-credits`, Inertia `Customer/Account/AiCredits.vue`): large balance, "Pending: {pending} (analysis running)" when > 0, top-up explanation, and a paginated history (20/page) from `CustomerLedgerQuery`: rows `signup_grant`, `monthly_grant` (delta > 0 only), `admin_grant`, `admin_revoke`, `consumption`, `refund`; reservation/release rows are hidden (net effects are visible via consumption). Columns: date (user TZ), description (`ai.ledger.{kind}` with params: filename for import-linked rows, admin reason for grants/revokes/refunds), change (+green/−), link "View import" when referenced.
- Real-time: `AiCreditsChanged` on `users.{id}` updates the chip and page without reload.

### 15.2 Admin — Settings → AI (`admin.settings.ai`, permission `settings.ai.manage`)

Form (FormRequest `UpdateAiSettingsRequest`, saved through the Settings domain's `UpdateSettings` action, activity-logged):

| Field | Control | Validation |
|---|---|---|
| Provider | radio cards for the 4 providers with status badge from capabilities: "Ready", "Not configured — set {missing vars} on the vision service" (disabled), "Error: {lastError}" (selectable, amber) | in enum; must be configured unless `none` |
| Model | text input with datalist (price-table models of that provider + `defaultModel`); placeholder = `defaultModel` | ≤ 100 chars; blank = provider default |
| Effort | select low/medium/high with help "Higher = more accurate, slower, more tokens" | enum |
| Use zoom-in tool loop | switch; disabled with hint when the provider has `supportsTools = false` | bool |
| Fall back to basic recognition if the AI fails | switch | bool |
| Signup credits / Monthly credits / Credits per AI analysis / Credits per basic analysis | number inputs | int 0–1000 |
| Max analyses per customer per day | number (0 = unlimited) | int 0–100 |
| Monthly AI budget (USD) | decimal (0 = unlimited) + live "Spent this month: $x (y %)" | decimal 0–100000, 2 dp |
| When the budget is used up | radio `fallback_none` / `block` | enum |
| Staff use AI without credits | switch | bool |
| Price table | editable rows provider/model/input $/MTok/output $/MTok, add/remove | unique (provider, model); decimals 0–1000, 4 dp |

Buttons: **Save**, **Test connection** (`POST admin.settings.ai.test` → `VisionClient::testProvider(provider, model)`; shows ✓/✗, latency, served model, vision/JSON verification, error text; records usage). Warnings: selected (provider, model) has no price row (non-`none`, non-`openai_compatible` default 0/0 rows count as present); vision service unreachable (capabilities stale) banner.

### 15.3 Admin — customer detail "AI credits" card (`admin.customers.show`, permission `ai.credits.manage` to act, `ai.usage.view` to see costs)

Balance, pending, this month's runs and credits consumed, buttons **Grant credits** / **Revoke credits** (dialog: amount, reason required), full ledger table (all kinds incl. reservations, with `created_by` name and note), per-import **Refund** action on consumption rows.

### 15.4 Admin — AI usage report (`admin.ai.usage`, permission `ai.usage.view`)

`App\Domain\Ai\Queries\AiUsageReportQuery::forMonth(CarbonImmutable $month)` returns: totals (cost USD, runs, AI runs (provider ≠ none), fallbacks (status failed), tests, input/output tokens, images), budget (spent, limit, %), daily series `[{date, costMicroUsd, runs}]`, by provider/model `[{provider, model, runs, inputTokens, outputTokens, costMicroUsd, avgCostMicroUsd, avgDurationMs}]`, top 20 users by cost, latest 50 runs (time, user, provider, model, status, tokens, cost, duration, link to the import). UI: month picker (default current, business TZ), KPI tiles, daily cost bar chart, tables. **Export CSV** (`admin.ai.usage.export?month=YYYY-MM`, streamed, one row per `ai_usage_events` row with cost in USD to 6 dp).

Admin dashboard widget (11): "AI budget: $x of $y this month" progress bar (amber ≥ 80 %, red ≥ 100 %), and a red banner when the configured provider is not configured/erroring.

---

## 16. Events, notifications, commands

| Item | Details |
|---|---|
| `AiCreditsChanged` (broadcast, `users.{userId}`) | `{balance, pending, delta, kind, at}`; dispatched after commit by every ledger write |
| `AiBudgetThresholdReached` | → notification `ai.budget_threshold_reached` (owners; in-app + email) `{percent, spentUsd, limitUsd, month}` |
| `AiProviderUnavailable` | dispatched by `ResolveRecognitionPlan` when it downgrades because the configured provider is unconfigured/erroring; throttled `Cache::add("ai:provider_unavailable:notified", …, 6 h)`; → `ai.provider_unavailable` (owners; in-app + email) `{provider, reason}` |
| `ai.credits_granted` | customer; in-app + email `{amount, balance}` |
| `ai.credits_refunded` | customer; in-app `{amount, filename}` |
| `ai:grant-monthly-credits` | §10.2 |
| Activity log events | `ai.credits_granted`, `ai.credits_revoked`, `ai.credits_refunded`, `settings.ai_updated` |

Files (`app/Domain/Ai/`): `Models/AiCreditLedgerEntry.php` (`const UPDATED_AT = null`, immutable: `updating`/`deleting` model events throw), `Models/AiUsageEvent.php` (`const UPDATED_AT = null`), `Enums/AiProvider.php`, `Enums/LedgerKind.php`, `Enums/AiFeature.php`, `Data/RecognitionPlanData.php`, `Data/CreditSummaryData.php`, `Data/VisionCapabilitiesData.php` (in `App\Support\Vision`), `Actions/ResolveRecognitionPlan.php`, `ReserveCredits.php`, `CommitCredits.php`, `RefundCredits.php`, `GrantCredits.php`, `RecordUsage.php`, `Services/CreditBalance.php`, `Services/BudgetGuard.php`, `Support/CostCalculator.php`, `Support/CreditPricing.php`, `Exceptions/AiQuotaException.php` (renders the §14 JSON), `Events/AiCreditsChanged.php`, `AiBudgetThresholdReached.php`, `AiProviderUnavailable.php`, `Listeners/GrantSignupCredits.php`, `Console/GrantMonthlyCredits.php`, `Queries/AiUsageReportQuery.php`, `Queries/CustomerLedgerQuery.php`; controllers `Admin/AiSettingsController`, `Admin/AiUsageController`, `Admin/CustomerAiCreditsController`, `Customer/AiCreditsController`.

---

## 17. Testing

### 17.1 Python (`vision/tests/providers/`)

SDK clients are constructed with an injected `http_client=httpx.Client(transport=httpx.MockTransport(handler))` so the real SDK serialisation is exercised offline.

| Test | Asserts |
|---|---|
| `test_anthropic_request_shape` | body has `model`, `thinking.type = adaptive`, `output_config.effort` = requested, `output_config.format.type = json_schema` when a schema is given, tools with `strict: true`, `tool_choice.type ∈ {auto, none}`, no assistant-prefill last message, images as base64 blocks before text, beta header `server-side-fallback-2026-07-01` + `fallbacks: "default"` when enabled |
| `test_anthropic_history_append_only` | assistant content of turn 1 is sent back byte-identical in turn 2; tool results of one turn are in one user message |
| `test_anthropic_refusal` | `stop_reason: refusal` → `ProviderRefusal` with category; labeler falls back to heuristic; `fallbackReason = llm_refused` |
| `test_anthropic_fallback_param_rejected` | 400 mentioning `fallbacks` → retried without, flag remembered |
| `test_anthropic_error_mapping` | 401/404/429/500/timeout/connection → neutral errors per §7.1 |
| `test_openai_request_shape` | `response_format.json_schema.strict = true`, function tools `strict`, `reasoning_effort` sent then dropped after a 400, image data URLs with `detail: high`, tool images re-sent in a user message |
| `test_openai_refusal_and_length` | `message.refusal` → refusal; `finish_reason length` → invalid output |
| `test_compat_single_pass_prompt_json` | no tools/response_format sent; fenced JSON parsed; invalid JSON → one repair call → `llm_output_repaired`; second failure → fallback |
| `test_compat_flags` | `supports_vision=false` → heuristic with `vision_unsupported`; `max_images_per_request=1` → one image |
| `test_capabilities` | configured/missing logic for every env combination (incl. `OPENAI_API_KEY` without `OPENAI_MODEL` → not configured); no secret values in the response |
| `test_provider_test_endpoint` | §5.3 response shape; `none` short-circuit |
| `test_usage_totals` | totals and status across agent turns, including a failed final call |

### 17.2 Laravel (Pest)

- `ResolveRecognitionPlan`: every branch of §8.2 (forced basic, unconfigured provider, non-vision provider, budget fallback, budget block (preview vs real), DXF pricing, staff unlimited on/off, model resolution, daily limit, insufficient credits).
- Ledger: reserve/commit/release/refund sequences incl. fallback-to-none partial commit (reserved 1, used 0 → release 1, no consumption), idempotency of commit and release (called twice), concurrency (two parallel `ReserveCredits` with balance 1 → exactly one succeeds; run with two DB connections), invariants after a randomized sequence of 200 operations (property-style test).
- Monthly grant: top-up math (0→3, 2→+1, 10→0 row with delta 0), pending reservations counted, idempotent rerun same period (no new rows), new period grants again, `monthly_credits = 0` no-op, inactive/soft-deleted/staff skipped, `--dry-run` writes nothing.
- Signup grant once; staff excluded.
- Admin grant/revoke validations, notifications, activity log.
- Budget: spent sum within business-TZ month boundaries (events at 23:59 and 00:01 local on the 1st), threshold notifications fire once per month per threshold, unlimited when 0.
- Cost calculator: example in §13.2 exactly 408 800 µUSD; cache tokens priced at input rate; missing price → 0 + flag.
- Daily limit counter: increments on start, give-back on failure/cancel, reset by date, staff exempt.
- Usage recording from success, error-with-usage, provider test.
- Settings page: validation, provider disabled when not configured, test-connection proxy, price-missing warning.
- Customer credits page hides reservation rows; header chip updates on `AiCreditsChanged` (browser test).

---

## 18. Acceptance criteria

1. With only `ANTHROPIC_API_KEY` set, `/v1/capabilities` reports `anthropic` and `none` configured, `openai`/`openai_compatible` not configured with their missing variable names; no secret value appears in any response or log line.
2. A recognition with provider `anthropic` sends `claude-opus-5-5` (unless the admin set another model), adaptive thinking, effort `high`, strict tools, JSON-schema output; the stored usage row has non-zero tokens and a cost computed from the price table.
3. Switching the admin setting to `openai` with `OPENAI_MODEL` set runs recognition through Chat Completions with JSON-schema output; with `openai_compatible` (tools/schema flags off) it runs single-pass with prompt-JSON and succeeds on the reference fixtures.
4. Forcing a provider error (invalid key) with `fallback_to_none_on_error = true` yields a `ready_for_review` import with `providerUsed = none`, warning `llm_failed_fallback_none`, credits charged at the `none` price, a usage row with status `failed`, and an owner notification `ai.provider_unavailable` on the next start.
5. A customer with 3 credits runs 3 AI analyses (balance 0), the 4th start returns 402 with the "basic recognition" option; basic recognition succeeds at 0 credits.
6. A run that fails for a system reason (vision down) leaves the balance unchanged and does not count toward the daily limit.
7. Discarding a successful import does not change the balance; a staff refund restores the charged credits and notifies the customer.
8. `ai:grant-monthly-credits` run twice on the same day creates exactly one `monthly_grant` row per active customer and tops balances up to `monthly_credits`, never above.
9. With `global_monthly_budget_usd` exceeded and behaviour `fallback_none`, new runs use provider `none` (UI shows the paused-AI note); with `block`, start returns 409 `ai_budget_exhausted`; owners receive the 80 % and 100 % notifications exactly once per month.
10. Staff (with `staff_unlimited`) can run unlimited analyses without ledger rows, and their runs appear in the usage report and count toward the budget.
11. The AI usage report totals equal the sum of `ai_usage_events` for the month, and the CSV export matches the table.

---

## Appendix: Proposed additions to other documents

**A. `02-data-model.md`**

1. §7.2 `ai_usage_events.feature` — add value `provider_test` (admin connection test; `reference_*` null).
2. §7.1 `ai_credit_ledger` — note: `monthly_grant` rows may have `delta = 0` (period marker for top-up semantics, 18 §10.2).
3. §13 `ai` group — clarify semantics (no new fields): `model` blank = vision default model for the provider; `provider` seeded as `anthropic`, and at run time a provider that the vision service does not report as configured is treated as `none` (18 §8.2 step 3) — this realises the documented default "anthropic if vision reports it configured, else none"; `effort` maps per 18 §3; `credits_per_recognition_none` also prices DXF imports (18 §8.3); `max_recognitions_per_day = 0` means unlimited.

**B. `01-architecture.md`**

1. §4 `Ai` domain key actions — `RefundCredits` has two methods `releaseReservation` and `refundConsumption`; add `ResolveRecognitionPlan`; services `CreditBalance`, `BudgetGuard`.
2. §4 `Identity` — domain event `CustomerRegistered(User $user)` dispatched after commit by `RegisterCustomer` and by staff-created customer accounts (consumed by `GrantSignupCredits`).
3. §8 — `AiCreditsChanged` payload `{balance, pending, delta, kind, at}`.

**C. `12-notifications.md`** — events: `ai.budget_threshold_reached` (owners; in-app + email; params `percent, spentUsd, limitUsd, month`), `ai.provider_unavailable` (owners; in-app + email; `provider, reason`; throttled 6 h), `ai.credits_granted` (customer; in-app + email; `amount, balance`), `ai.credits_refunded` (customer; in-app; `amount, filename`).

**D. `13-auth-security.md`** — permissions: `ai.credits.manage` (grant/revoke/refund; owner, admin), `ai.usage.view` (usage report and USD costs; owner, admin), `settings.ai.manage` (AI settings + test connection; owner only, or reuse an existing settings permission if 13 defines one). Rate limiters `imports-start` (10/h/user), `ai-provider-test` (10/min/user).

**E. `14-routes-and-api.md`** — `customer.account.ai-credits` (GET page), `admin.settings.ai` (GET/PUT), `admin.settings.ai.test` (POST JSON), `admin.ai.usage` (GET), `admin.ai.usage.export` (GET CSV), `admin.customers.ai-credits.grant` / `.revoke` (POST), `admin.imports.refund` (POST `{note}`); JSON `GET /api/me/ai-credits` (`api.ai.credits`, returns `CreditSummaryData`).

**F. `17-deployment-ops.md`** — vision service env vars exactly as 18 §4 (secrets only on `furny-vision`); Laravel needs only `VISION_SERVICE_URL` and `VISION_SERVICE_TOKEN`.

