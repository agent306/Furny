### Task 24: Anthropic adapter (`claude-opus-5-5`)

**Files:**
- Create: `vision/app/providers/anthropic_provider.py`, `vision/tests/providers/sse.py`
- Test: `vision/tests/providers/test_anthropic.py`

**Spec refs:** `18 §3`, `18 §7.1`, `18 §7.5`, `18 §17.1` (anthropic rows)

**Interfaces:**
- Consumes: everything in `providers/base.py` and `errors.py`, `record_provider_error`.
- Produces:
  - `AnthropicProvider(settings: Settings, model: str, *, http_client: Any | None = None, max_retries: int = 2)`. When `http_client` is given it is passed to `anthropic.Anthropic(http_client=...)`; tests pass `anthropic.DefaultHttpxClient(transport=httpx2.MockTransport(handler))`, because SDK 1.x uses `httpx2`.
  - `to_anthropic_messages(conversation) -> list[dict[str, Any]]`.
- Produces, in tests: `sse.anthropic_sse(message: dict[str, Any]) -> bytes`, which serialises a complete Messages API message dict into SSE events:
  - `message_start` (content `[]`, usage)
  - per block: `content_block_start` (empty text / `input: {}` / empty thinking), then `text_delta`, `input_json_delta` (full JSON string), `thinking_delta` and `signature_delta`, then `content_block_stop`
  - `message_delta` (`stop_reason`, `stop_details`, `usage.output_tokens`)
  - `message_stop`

  The response header is `content-type: text/event-stream`.

- [ ] **Step 1: Write the failing test.** Each test builds a handler that records `request.headers` and `json.loads(request.content)`.
  - `test_anthropic_request_shape`. Body assertions:
    - `model == "claude-opus-5-5"`, `max_tokens == 32000`, `stream is True`
    - `thinking == {"type": "adaptive"}`
    - `output_config == {"effort": "high", "format": {"type": "json_schema", "schema": SCHEMA}}`
    - `cache_control == {"type": "ephemeral"}`
    - `system == [{"type": "text", "text": "SYS"}]`
    - tools each have `strict is True` and `eager_input_streaming is True`
    - `tool_choice == {"type": "auto"}`
    - the last message's role is `user`; in the first user message, image blocks come before text, with base64 `source`
    - `"budget_tokens" not in json.dumps(body)`
    - `fallbacks == "default"`

    Header assertion: `"server-side-fallback-2026-07-01" in headers["anthropic-beta"]`. With `tool_choice="none"`, the body has `{"type": "none"}`. With `anthropic_server_fallback=False`, there is no beta header and no `fallbacks` key.
  - `test_anthropic_history_append_only`:
    - Turn 1 returns `[thinking(signature="sig1"), tool_use(id="tu1", name="crop_image", input={…})]`.
    - Turn 2 is sent with `[UserMessage, AssistantMessage(native=…), ToolResultsMessage([r1, r2])]`.
    - The request's `messages[1]["content"]` equals the turn-1 content dicts, including `signature`.
    - `messages[2]` is one user message holding two `tool_result` blocks, with `is_error` set and image blocks inside `content`.
    - Consecutive user-role entries (tool results followed by a finalize `UserMessage`) are merged into one user message with the `tool_result` blocks first.
  - `test_anthropic_refusal`: `stop_reason: "refusal"` with `stop_details: {"type": "refusal", "category": "cyber"}` → raises `ProviderRefusal` with `.category == "cyber"`, and `.usage` holds one failed `UsageCall`.
  - `test_anthropic_max_tokens`: `stop_reason: "max_tokens"` → `ProviderInvalidOutput`.
  - `test_anthropic_fallback_param_rejected`: the first response is 400 `{"type": "error", "error": {"type": "invalid_request_error", "message": "fallbacks: unsupported"}}`. The adapter retries once without the beta header or `fallbacks` and succeeds. A second `complete()` call also omits them (`_fallback_disabled` is remembered).
  - `test_anthropic_error_mapping`, with `max_retries=0`:
    - 401 → `ProviderAuthError` (and `last_error` recorded)
    - 403 → `ProviderAuthError`
    - 404 → `ProviderBadRequest` with `code == "model_not_found"` (recorded)
    - 429 → `ProviderUnavailable` `provider_rate_limited`
    - 500 and 529 → `provider_overloaded`
    - handler raising `httpx2.ReadTimeout` → `ProviderTimeout`
    - `httpx2.ConnectError` → `ProviderUnavailable` `provider_unreachable`
  - `test_anthropic_usage_and_parsing`: `text` is the concatenated text blocks; `tool_calls` hold parsed `arguments`; the `stop_reason` mapping `end_turn`/`stop_sequence` → `end_turn`; usage fields copied (`cache_read_input_tokens` defaults to 0); `model` is the response's served model; `images` counts only image blocks in the newest message.
  - `test_anthropic_fallback_block`: content `[thinking, text("partial"), {"type": "fallback", "from": {"model": "claude-opus-5-5"}, "to": {"model": "claude-opus-4-8"}}, thinking, text("final")]` with `usage.iterations` of two entries →
    - `native` omits thinking and tool_use blocks before the last fallback block
    - `text == "final"` (only text after the last fallback block counts as the answer)
    - usage input and output tokens are summed over `iterations`
    - `model == "claude-opus-4-8"`
- [ ] **Step 2: Run it, expect FAIL.** Command: `uv run pytest tests/providers/test_anthropic.py -q`.
- [ ] **Step 3: Implement** per 18 §7.1.
  - Use `client.beta.messages.stream(**params, betas=["server-side-fallback-2026-07-01"], fallbacks="default")` when enabled, otherwise `client.messages.stream(**params)`, and call `get_final_message()`.
  - If the installed SDK rejects a keyword (`fallbacks`, `cache_control` or `output_config`) at type-check or run time, pass that key through `extra_body={...}` instead; the request-shape test is the arbiter.
  - Native assistant content is the list of response blocks dumped with `model_dump(mode="json", exclude_none=True)`, so it replays byte-identically.
  - Mid-stream fallback handling (the `fallback` block and `usage.iterations`) goes beyond the 18 §7.1 text; it follows the current API rules and is recorded in the gap list.
- [ ] **Step 4: Run tests, expect PASS.** Same command as Step 2.
- [ ] **Step 5: Quality gates.** `uv run ruff check . && uv run ruff format --check . && uv run mypy app`
- [ ] **Step 6: Commit.** `git add vision/app/providers/anthropic_provider.py vision/tests/providers/sse.py vision/tests/providers/test_anthropic.py` then `git commit -m "feat(vision): Anthropic provider with adaptive thinking, strict tools, structured output" -m "$FURNY_TRAILER"`.

---

