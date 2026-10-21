# Task 24 report: Anthropic adapter (`claude-opus-5-5`)

Status: DONE

## Implemented
- `vision/app/providers/anthropic_provider.py`: `AnthropicProvider(settings, model, *, http_client=None, max_retries=2)` (registry contract `Adapter(settings, resolved_model)`), `to_anthropic_messages`.
  - Request per 18 §7.1: `thinking {"type":"adaptive"}`, `output_config {effort, format?}`, top-level `cache_control`, system block list, strict + `eager_input_streaming` tools, `tool_choice` only `auto`/`none` (omitted when there are no tools), no prefill, no `budget_tokens`.
  - Server fallback: `client.beta.messages.stream(..., betas=["server-side-fallback-2026-07-01"], fallbacks="default")` when `anthropic_server_fallback` and not `_fallback_disabled`, else `client.messages.stream`. The installed SDK 1.17.0 accepts every keyword natively (checked by signature), so no `extra_body` was needed.
  - A 400 whose message mentions `fallbacks` sets `_fallback_disabled`, logs a static warning and retries once.
  - Exception mapping per the §7.1 table. Extras: an `error` event inside a 200 stream (SDK raises `APIStatusError` with status < 400) maps to `provider_overloaded`; other 4xx map to `ProviderBadRequest`.
  - Every `ProviderError` goes through `registry.record_provider_error` (the registry filters to auth, `model_not_found`, `provider_unreachable`).
  - Per-call `timeout_s` is passed as `anthropic.Timeout(timeout_s, connect=10)`.
- `vision/tests/providers/sse.py`: `anthropic_sse(message) -> bytes`.
- `vision/tests/providers/test_anthropic.py`: 19 cases (parametrised error mapping).
- Carry 4 in `vision/app/api/providers.py`: `_MASKED_KEY` regex `sk-[\w*…-]{6,}` applied in `_scrub`; the adapter call is wrapped in `anyio.fail_after(TEST_TIMEOUT_S)` with `abandon_on_cancel=True`; a timeout returns `ok=false`, `llm_timeout`, `usage=null`. Tests added to `test_provider_test_endpoint.py` (4 masked-key forms, 1 hung adapter).

## Files changed
- A `vision/app/providers/anthropic_provider.py`
- A `vision/tests/providers/sse.py`
- A `vision/tests/providers/test_anthropic.py`
- M `vision/app/api/providers.py`
- M `vision/tests/providers/test_provider_test_endpoint.py`
- A this report

## TDD evidence
RED
- `pytest tests/providers/test_anthropic.py`: `ModuleNotFoundError: No module named 'app.providers.anthropic_provider'` (collection error).
- `pytest tests/providers/test_provider_test_endpoint.py` (before the carry-4 change): `5 failed, 13 passed` (4 masked-key cases, 1 hung-provider case; the hang took 10 s, i.e. no cut-off).

GREEN
- `pytest tests/providers/test_anthropic.py`: `19 passed`.
- `pytest tests/providers` after the carry-4 change: `79 passed`.

## Gate (WSL, p3 venv)
`ruff check .` pass, `ruff format --check .` pass (117 files), `mypy app` pass (70 files), `pytest -q`: `1270 passed, 1 skipped, 3 xfailed` (220 s). No failures, no walls_closure flake.

## Carries
1. K9: `native` is the full response content with the `fallback` block in place, dumped `model_dump(mode="json", by_alias=True, exclude_none=True)` (key `from`). The test asserts `native == content` and that the replayed request content equals it. `text` = text blocks after the last fallback block, and usage = sum over `usage.iterations` (types `message` and `fallback_message`), both recorded as deviations; `model` is the served model (`claude-opus-4-8`; the SDK stream accumulator sets it from the fallback block).
2. K10: the ConnectError case asserts `provider_unreachable` and `registry.last_error("anthropic")` is recorded (also 401/403/404). 429/500/529/timeout are asserted not recorded.
3. Constructed as `AnthropicProvider(settings, resolved_model)`; `registry.get_provider("anthropic", None, settings)` test included.
4. Done as above.

## Deviations / decisions
- `tool_calls` also come only from blocks after the last fallback block (the brief specified this for `text` only). Rationale: tool_use blocks before a fallback belong to the model that declined and were never meant to be executed.
- Test comparison is dict equality; the SDK dumps keys in model field order, so serialised JSON key order can differ from the server's order (semantically identical content).
- `thinking` is always sent as adaptive, with `effort` always set (spec).
- No dependency changes.

## Concerns
- If a fallback block has `trigger.category = null`, `exclude_none=True` drops the key, so the replayed block's `trigger` becomes `{}` (not byte-identical for that case). K9 mandates `exclude_none=True`; not verified against the live API.
- If `_fallback_disabled` flips after history already holds a fallback block, the non-beta endpoint would receive it; this is very unlikely (the flag flips on the first request).
- `abandon_on_cancel` leaves a hung adapter thread running until the SDK timeout (<= `timeout_s`).
- Live tests were not requested and none exist.
- Files written with the Write tool on Windows came out CRLF; they were normalised to LF (repo uses `eol=lf`).
