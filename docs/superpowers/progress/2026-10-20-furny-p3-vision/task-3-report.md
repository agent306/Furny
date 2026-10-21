# Task 3 report: API core (errors, auth, slots, app factory, /healthz)

Status: DONE_WITH_CONCERNS (minor decisions below)

## Implemented
- `vision/app/api/errors.py`: `ERROR_TABLE` (06 §14.2 plus §5.8 codes `decode_failed`, `too_large`, `unsupported`), `VisionError` with the brief's signature (status/retryable default from the table; an unknown code without `http_status` raises `ValueError`), `error_response`, and handlers for `VisionError`, `RequestValidationError` (`invalid_request`, `details.errors = [{loc, msg}]`, input never echoed) and `Exception` (`internal_error`, message "Internal error", stack to the log).
- `vision/app/api/deps.py`: `require_token` (case-insensitive `Bearer`, `hmac.compare_digest` on bytes, so non-ASCII tokens give 401 not 500), `heavy_slot` / `light_slot` (`wait_for(sem.acquire(), vision_heavy_slot_wait_s)`, `busy` + `Retry-After: 20`, release in `finally`).
- `vision/app/api/health.py`: `GET /healthz`, 200 `{"status":"ok","version":"1.0.0","ocrLoaded":true}`, else 503 with `status:"loading"`, `ocrLoaded:false`.
- `vision/app/main.py`: `create_app(settings=None, *, ocr_factory=None)`. Lifespan: `cv2.setNumThreads(2)`, `configure_logging`, Sentry only if `sentry_dsn`, semaphores created in the lifespan (Semaphore(1)/(2)), background OCR load via `asyncio.create_task(anyio.to_thread.run_sync(factory, abandon_on_cancel=True))` that sets `app.state.ocr`/`ocr_loaded`. `app.state`: settings, heavy_sem, light_sem, ocr, ocr_loaded, provider_factory=None, io_factory=None. Pure-ASGI request-id middleware (header or uuid4 hex, echoed, contextvar, one access line `{msg:"request", path, status, durationMs}`; the path has no query string). Lazy module `__getattr__` for `app.main:app` (verified under real uvicorn: /healthz returns 503 "loading" with no factory).

## Tests
- RED: with the four new modules moved aside, `uv run pytest tests/test_api.py -q` gave `ModuleNotFoundError: No module named 'app.api.deps'` (collection error). Note: I wrote the implementation before the test file's first run, then did the RED check by hiding the modules.
- GREEN: `uv run pytest tests/test_api.py -q` -> 25 passed. Full suite `uv run pytest -q` -> 45 passed, pristine. `ruff check .`, `ruff format --check .` (after format), `mypy app` (15 files) all clean.
- Brief tests present: healthz no auth, 503 until loaded (Event), auth (missing/`Bearer wrong`/`Basic x` -> exact body), busy (503, Retry-After 20, retryable), validation 400, unexpected 500 (no "boom" in body), request id echo, error table (pinned in full). Extras: healthz stays 503 when OCR load fails, docs/openapi are 404, light slot (2 permits then busy), heavy slot released after a handler error, VisionError body/defaults/overrides, stack goes to logs (capsys), generated request id, access log line, Sentry init only with DSN (and `max_request_body_size="never"`, no PII), lazy module `app`.

## Files
vision/app/api/errors.py, deps.py, health.py; vision/app/main.py; vision/tests/test_api.py. Commit 09f289c.

## Decisions / concerns
1. Default OCR factory: none yet (brief: wired in Task 12). With `ocr_factory=None` no loading happens, a warning is logged and `/healthz` stays 503. Task 12 must pass/wire the default factory in `create_app`.
2. Light slot wait reuses `vision_heavy_slot_wait_s` (spec silent; belongs in the gap list per brief).
3. 503 healthz body uses `status:"loading"` (spec only defines the 200 body).
4. Docs, redoc and openapi are disabled (they would be unauthenticated endpoints).
5. The 500 path is caught in the middleware (so the response carries `X-Request-Id` and an access line is logged); the `Exception` handler is also registered as a safety net. Tests use `TestClient(raise_server_exceptions=False)` per the safety-net path.
6. Sentry is initialised with `max_request_body_size="never"` and `send_default_pii=False` because request bodies contain presigned URLs (06 §5.3).
7. Commit trailer uses `Claude Sonnet 5.5` (the session attribution reminder) rather than the `Opus 5.5` line in context.md.
8. Starlette's own 404/405 `HTTPException` responses keep the default `{"detail": ...}` shape (not in the brief).

## Fix round 1: Sentry hardening incomplete
- Change (`vision/app/main.py` `_init_sentry`): `sentry_sdk.init` now also passes `include_local_variables=False` (no frame locals such as source/target URLs) and a `before_send` hook that runs the event through `RedactionFilter.redact_value` (app/logging.py), which redacts secret env values (`*_API_KEY`/`*_TOKEN`) and `?...X-Amz-...` query strings in exception values, messages, request data and extras recursively.
- Tests: `test_sentry_only_initialised_with_dsn` now also asserts `include_local_variables is False`; new `test_sentry_before_send_scrubs_secrets_and_presigned_urls` (event with an X-Amz URL in message, exception value and request data plus an API key in an exception value; asserts no `X-Amz`, signature or secret remains, `[REDACTED]` present, non-secret fields unchanged). The real `sentry_sdk.init` accepts the kwargs (checked with a fake DSN).
- Command: `cd /home/user/furny-p3/vision && uv run pytest tests/test_api.py -q; uv run pytest -q; uv run ruff check .; uv run ruff format --check .; uv run mypy app`
- Output: `26 passed` (api), `46 passed` (full); ruff check "All checks passed!"; ruff format unchanged; mypy "Success: no issues found in 15 source files".
