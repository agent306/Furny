# Task 25 report: OpenAI and OpenAI-compatible adapters

Status: DONE (one low-risk deviation set, see below).

## Implemented
- `vision/app/providers/openai_provider.py`: `OpenAIProvider(settings, model, *, http_client=None, max_retries=2)` on non-streaming `chat.completions.create`; `to_openai_messages(conversation, *, image_detail, max_images)`; error mapping (`openai` exceptions per 18 §7.2); `reasoning_effort` 400 retry once then `send_effort=False`; refusal / length / content_filter handling; tool-argument sentinel `{"__invalid_json__": raw}`; usage mapping; `record_provider_error` on every `ProviderError`.
- `vision/app/providers/openai_compatible_provider.py`: subclass overriding five hooks only (effort flag, credentials/base URL, output cap, per-call timeout, usage model) plus `max_tokens_param="max_tokens"` and `image_detail=False`. Tools, `tool_choice` and `response_format` are omitted when the capability flag is off (capabilities come from `registry.capabilities_for`).
- Carry 4: `_MASKED_KEY` in `vision/app/api/providers.py` is now `\bsk-[\w*….-]{6,}`.
- Tests: `tests/providers/test_openai.py` (18 test functions, parametrized), `tests/providers/test_compat_adapter.py` (13), shared `tests/providers/openai_support.py` (mock-transport harness), plus 2 `_MASKED_KEY` cases in `test_provider_test_endpoint.py`.

## TDD evidence
RED (before implementation):
```
ModuleNotFoundError: No module named 'app.providers.openai_provider'
ModuleNotFoundError: No module named 'app.providers.openai_compatible_provider'
2 errors during collection
```
RED for the regex carry (before the fix):
```
FAILED tests/providers/test_provider_test_endpoint.py::test_scrub_masks_the_whole_three_dot_key_and_spares_words_ending_in_sk
- key [REDACTED]...wXyZ rejected; ask ta[REDACTED] or de[REDACTED]
```
GREEN: `60 passed` for the three touched files; full gate below.

## Gate (WSL, venv furny-vision-p3)
- `ruff check .`: All checks passed. `ruff format --check .`: 122 files already formatted. `mypy app` (strict): no issues in 72 source files.
- `pytest -q`: 1312 passed, 1 skipped, 3 xfailed (pre-existing), 0 failed. No walls_closure flake this run.
- No dependency change, so `uv.lock` / `requirements.txt` untouched.

## Carries
1. K10: every `ProviderError` goes through `registry.record_provider_error(self.name, err.code)`. Tests: ConnectError records `provider_unreachable`, 401 records `provider_auth_failed`, 404 records `model_not_found` (both providers; compat under its own name, openai key stays empty). 429/500/timeout/400 are not recorded.
2. K16: sentinel is `{"__invalid_json__": raw}`, tested for truncated JSON and for valid JSON that is not an object. The literal is duplicated from `app.pipeline.labeling.tools.INVALID_JSON_SENTINEL` (importing it would pull cv2 into providers).
3. Structure follows the Anthropic adapter (constructor with `http_client`/`max_retries`, `registry.capabilities_for`, `_map_error`, mock-transport tests with exact bodies, registry contract tests).
4. `_MASKED_KEY` fixed; tests: `task-manager` and `desk-lamp-9` untouched, `sk-ant-api03-AbCd...wXyZ` fully scrubbed (direct `_scrub` test; the parametrized endpoint test also got the three-dot variant).
5. Model is never hard-coded: the model comes from the constructor; test uses an arbitrary name.

## Deviations / decisions
- Output tokens: `min(max_output_tokens, settings cap)` (`OPENAI_MAX_OUTPUT_TOKENS` / `OPENAI_COMPAT_MAX_OUTPUT_TOKENS`). Spec table gives the setting as the value; the caller param can only lower it. Brief's 32000 / 8192 both hold.
- Compat per-call timeout is `OPENAI_COMPAT_TIMEOUT_S` regardless of the `timeout_s` argument (18 §3: 300 s for compat). A caller that wants a shorter compat deadline must rely on its own outer timeout.
- Compat usage `model` is always the configured model (18 §7.3); OpenAI uses `resp.model`, falling back to the configured one if absent.
- `finish_reason "content_filter"` maps to `ProviderRefusal(category="content_filter")` (spec silent).
- Tool calls present with `finish_reason "stop"` (some local servers) count as `tool_use`; the calls decide, not the finish reason. Empty-string tool arguments become `{}` (no-arg tools), not the sentinel.
- No `choices` in the response raises `ProviderInvalidOutput`.
- `_new_images` is imported from `anthropic_provider.py` (private helper reused, not moved).
- Image cap `max_images` is applied inside `to_openai_messages` for OpenAI too (cap 10, never reached by our run limits).

## Concerns
- `native = message.model_dump(exclude_none=True)` replays any extra fields a compat server returns (for example `reasoning_content`) back to it. This matches the append-only rule; if a local server rejects unknown assistant keys it needs a follow-up.
- Empty tool-message content is sent as `""` when a tool result has only images (spec text says joined text parts). OpenAI accepts it; some local servers might not.
