### Task 25: OpenAI and OpenAI-compatible adapters

**Files:**
- Create: `vision/app/providers/openai_provider.py`, `vision/app/providers/openai_compatible_provider.py`
- Test: `vision/tests/providers/test_openai.py`, `vision/tests/providers/test_compat_adapter.py`

**Spec refs:** `18 §3`, `18 §7.2`, `18 §7.3`, `18 §17.1` (openai/compat rows)

**Interfaces:**
- Produces:
  - `OpenAIProvider(settings, model, *, http_client=None, max_retries=2)`, with tests passing `openai.DefaultHttpxClient(transport=httpx2.MockTransport(h))`.
  - `OpenAICompatibleProvider(settings, model, *, http_client=None, max_retries=2)`, a subclass.
  - `to_openai_messages(conversation, *, image_detail: bool, max_images: int) -> list[dict[str, Any]]`.

- [ ] **Step 1: Write the failing test.**
  - `test_openai_request_shape`:
    - `max_completion_tokens == 32000`
    - `response_format == {"type": "json_schema", "json_schema": {"name": "floor_plan_labels", "schema": S, "strict": True}}`
    - tools `[{"type": "function", "function": {…, "strict": True}}]` with `tool_choice == "auto"`
    - `reasoning_effort == "high"`
    - image parts as `{"type": "image_url", "image_url": {"url": "data:image/png;base64,…", "detail": "high"}}`
    - the system message first
  - `test_openai_reasoning_effort_dropped`: a 400 whose message contains `reasoning_effort` → retried once without it, and later calls omit it.
  - `test_openai_tool_images_resent`: `ToolResultsMessage` with an image → one `{"role": "tool", "tool_call_id": id, "content": "…"}` (error text prefixed `"ERROR: "`), followed by a user message `[{"type": "text", "text": "Images returned by tool call {id}:"}, image…]`.
  - `test_openai_refusal_and_length`: `message.refusal` set → `ProviderRefusal`; `finish_reason "length"` → `ProviderInvalidOutput`; tool-call arguments that are not JSON → a `ToolCall` with `arguments == {"__invalid_json__": raw}`, which the agent answers with an `is_error` result.
  - `test_openai_usage`: `prompt_tokens`, `completion_tokens` and `prompt_tokens_details.cached_tokens` mapped; `model` comes from `resp.model`.
  - `test_openai_error_mapping`: same table as Task 24, using `openai` exception classes.
  - `test_compat_shape_flags_off`: no `tools`, `tool_choice` or `response_format`; uses `max_tokens: 8192` (not `max_completion_tokens`); no `detail` key on images; no `reasoning_effort`; base URL and key from settings.
  - `test_compat_flags_on`: `OPENAI_COMPAT_SUPPORTS_JSON_SCHEMA=true` → `response_format` with strict.
  - `test_compat_max_images`: `max_images_per_request = 1` with 3 accumulated images → only the newest image is kept, and older ones are replaced by `{"type": "text", "text": "[image omitted]"}`.
  - `test_compat_usage_missing`: no `usage` in the response → token counts 0 and `model` = the configured model.
- [ ] **Step 2: Run it, expect FAIL.** Command: `uv run pytest tests/providers/test_openai.py tests/providers/test_compat_adapter.py -q`.
- [ ] **Step 3: Implement** per 18 §7.2 and §7.3.
  - Non-streaming `client.chat.completions.create(**kwargs)`.
  - `native = choice.message.model_dump(exclude_none=True)`.
  - Capabilities come from settings flags; for OpenAI they are all true, with `max_image_px` 2048 and 10 images.
- [ ] **Step 4: Run tests, expect PASS.** Same command as Step 2.
- [ ] **Step 5: Quality gates.** `uv run ruff check . && uv run ruff format --check . && uv run mypy app`
- [ ] **Step 6: Commit.** `git add vision/app/providers/openai_provider.py vision/app/providers/openai_compatible_provider.py vision/tests/providers/test_openai.py vision/tests/providers/test_compat_adapter.py` then `git commit -m "feat(vision): OpenAI and OpenAI-compatible Chat Completions providers" -m "$FURNY_TRAILER"`.

---

