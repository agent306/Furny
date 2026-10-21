### Task 22: Provider core: neutral types, errors, registry, capabilities, usage, fakes, `/v1/capabilities`, `/v1/providers/test`

**Files:**
- Create: `vision/app/providers/base.py`, `vision/app/providers/errors.py`, `vision/app/providers/registry.py`, `vision/app/providers/none_provider.py`, `vision/app/providers/usage.py`, `vision/app/providers/testing.py`
- Create: `vision/app/api/capabilities.py`, `vision/app/api/providers.py`
- Modify: `vision/app/main.py` (include routers; `app.state.provider_factory = lambda name, model: registry.get_provider(name, model, settings)`)
- Test: `vision/tests/providers/test_capabilities.py`, `vision/tests/providers/test_provider_test_endpoint.py`, `vision/tests/providers/test_usage_totals.py`

**Spec refs:** `18 §2`, `18 §5.1`, `18 §5.3`, `18 §6` (all), `18 §7.4`, `18 §7.5` (lastError), `18 §14`

**Interfaces:**
- Produces, verbatim from 18 §6.1 in `base.py`:
  - `ProviderName`, `Effort`, `ProviderCapabilities`
  - `TextPart`, `ImagePart`, `Part`, `ToolSpec`, `JsonSchemaSpec`, `ToolCall`, `ToolResult`
  - `UserMessage`, `ToolResultsMessage`, `AssistantMessage`, `Message`
  - `UsageCall`, `TurnResult`, `LLMProvider` (ABC)
- Produces, in `errors.py`: the 18 §6.2 classes plus `fallback_reason_for(err: ProviderError) -> FallbackReason`.
- Produces, in `registry.py`:
  - `provider_capabilities(settings) -> list[ProviderInfo]`.
  - `get_provider(name, model, settings) -> LLMProvider | None`. It instantiates lazily by importing the adapter module by name (Tasks 24 and 25 add them) and caches per `(name, model)`.
  - `record_provider_error(name, code, now=None)` and `last_error(name, now=None)` (60 min window).
- Produces, in `usage.py`: `usage_call_out(c: UsageCall) -> UsageCallOut` and `build_usage(provider: ProviderName, model: str | None, calls: list[UsageCall], fell_back: bool) -> Usage`.
- Produces, in `testing.py` (not registered):
  - `FakeProvider(script: list[TurnResult | Exception | Callable[[list[Message]], TurnResult]], capabilities=..., name="anthropic", model="fake-model")`, which records `self.calls` (the kwargs of each `complete`).
  - `ReplayProvider(result_json: dict[str, Any], capabilities=...)`, which returns a `TurnResult` with `text = json.dumps(result_json)`.
  - `make_turn(text=None, tool_calls=(), stop_reason="end_turn", purpose="labeling") -> TurnResult`.

- [ ] **Step 1: Write the failing test.**
  - `test_capabilities` (18 §17.1). Use `TestClient` with Settings built per case:
    - Only `ANTHROPIC_API_KEY` → `anthropic` and `none` have `configured: true`; `openai` has `configured: false` with `missing == ["OPENAI_API_KEY", "OPENAI_MODEL"]`; `openai_compatible` has `missing == ["OPENAI_COMPAT_BASE_URL", "OPENAI_COMPAT_MODEL"]`.
    - `OPENAI_API_KEY` without `OPENAI_MODEL` → not configured, `missing == ["OPENAI_MODEL"]`.
    - Compat flags reflected: `supportsTools` false, `maxImagePx` 1280, `maxImagesPerRequest` 1.
    - `anthropic` entry: `defaultModel == "claude-opus-5-5"`, `maxImagePx == 2576`, `maxImagesPerRequest == 20`, `supportsEffort` true.
    - `none` entry: everything false, image values 0.
    - `ocr == {"engine": "rapidocr", "loaded": True}`.
    - `limits == {"maxSourceBytes": 26214400, "maxDxfBytes": 15728640, "maxPdfPages": 20, "maxPixels": 40000000, "recognizeDeadlineS": 570}`.
    - The key value `sk-ant-xyz-secret` is not in `response.text`.
    - Missing bearer → 401.
  - `test_last_error_window`: `record_provider_error("anthropic", "provider_auth_failed", now=t0)` → shown as `{code, at}` in capabilities at t0 + 59 min, and gone at t0 + 61 min.
  - `test_get_provider_errors`: an unconfigured name → `VisionError("provider_not_configured")` with status 400; `get_provider("none", None, s) is None`.
  - `test_provider_test_endpoint`, with `app.state.provider_factory` overridden to return a `FakeProvider`:
    - The answer `{"ok": true, "quadrant": "top_left"}` → 200 `{ok: True, provider, model, latencyMs: int, visionVerified: True, jsonSchemaVerified: True, usage: {purpose: "provider_test", …}, error: None}`.
    - The first call's parts are one `ImagePart` (a 64×64 PNG whose pixel (10, 10) is black and pixel (50, 50) white) plus `TextPart("Is the black square in the top-left quadrant? Answer with the JSON object.")`, with `system == "You are a connectivity check."` and `effort == "low"`.
    - A provider without vision → no image and text `Reply with ok = true and quadrant = "top_left".`
    - `ProviderAuthError` raised → 200 `ok: False`, `error.code == "provider_auth_failed"`, `last_error` recorded.
    - Provider `none` → `ok: True` with no call.
  - `test_usage_totals`: three succeeded calls plus one failed final call → `totals.requests == 4`, token sums correct, `status == "failed"`. All succeeded with `fell_back=False` → `"succeeded"`. Provider `none` → `{provider: "none", model: None, calls: [], totals: zeros, status: "succeeded"}`.
- [ ] **Step 2: Run it, expect FAIL.** Command: `uv run pytest tests/providers -q`.
- [ ] **Step 3: Implement** per 18 §5 and §6.
  - `/v1/providers/test` runs `provider.complete` in a worker thread with `timeout_s=60` and `JsonSchemaSpec("connectivity_check", schema)` when `supports_json_schema`. Otherwise it appends `JSON_SCHEMA_INSTRUCTION_TEMPLATE`; prompts land in Task 26, so a local copy of that constant is acceptable here until Task 26 replaces it with the import.
  - The answer is parsed with `parse_json_object`.
  - No slot: the spec defines none for this endpoint; this is recorded in the gap list.
  - The adapter import table in the registry is `{"anthropic": "app.providers.anthropic_provider:AnthropicProvider", "openai": "app.providers.openai_provider:OpenAIProvider", "openai_compatible": "app.providers.openai_compatible_provider:OpenAICompatibleProvider"}`.
- [ ] **Step 4: Run tests, expect PASS.** Same command as Step 2.
- [ ] **Step 5: Quality gates.** `uv run ruff check . && uv run ruff format --check . && uv run mypy app`
- [ ] **Step 6: Commit.** `git add vision/app/providers vision/app/api/capabilities.py vision/app/api/providers.py vision/app/main.py vision/tests/providers` then `git commit -m "feat(vision): provider abstraction, registry, capabilities and provider test" -m "$FURNY_TRAILER"`.

---

