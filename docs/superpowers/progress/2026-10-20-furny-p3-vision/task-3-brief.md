### Task 3: API core: errors, auth, concurrency slots, app factory, `/healthz`

**Files:**
- Create: `vision/app/api/errors.py`, `vision/app/api/deps.py`, `vision/app/api/health.py`, `vision/app/main.py`
- Test: `vision/tests/test_api.py`

**Spec refs:** `06 §5.2`, `06 §5.3`, `06 §5.7` (`/healthz`), `06 §14.2`, `17 §4.1`

**Interfaces:**
- Consumes: `Settings`, `get_settings`, `configure_logging`, `request_id_var` (Task 2).
- Produces:
  - `class VisionError(Exception)`, constructed as `__init__(code: str, message: str = "", *, http_status: int | None = None, retryable: bool | None = None, details: dict[str, Any] | None = None, usage: Any = None, headers: dict[str, str] | None = None)`. Status and retryability default from `ERROR_TABLE: dict[str, tuple[int, bool]]`.
  - `error_response(err: VisionError) -> JSONResponse`.
  - `require_token` (FastAPI dependency).
  - `heavy_slot` and `light_slot` (async generator dependencies).
  - `create_app(settings: Settings | None = None, *, ocr_factory: Callable[[], Any] | None = None) -> FastAPI`, plus module-level `app = create_app()` created lazily via `def __getattr__`. `app.main:app` must work under uvicorn without constructing settings at import time in tests.
  - `app.state` attributes: `settings`, `heavy_sem`, `light_sem`, `ocr`, `ocr_loaded: bool`, `provider_factory`, `io_factory`. The last two are set to `None` here and filled in Tasks 22 and 6.

- [ ] **Step 1: Write the failing test** `tests/test_api.py`. Use a fixture `make_client(**settings_overrides)` that builds `create_app(Settings(vision_service_token=TOKEN, **ov), ocr_factory=lambda: object())`, adds dummy routes with `app.add_api_route` (one per dependency: `require_token`, `heavy_slot`, `light_slot`, a pydantic-body POST, and a route that raises `RuntimeError("boom")`), and enters `with TestClient(app)`.
  - `test_healthz_no_auth`: returns 200 `{"status": "ok", "version": "1.0.0", "ocrLoaded": True}` once loaded.
  - `test_healthz_503_until_ocr_loaded`: `ocr_factory` blocks on a `threading.Event` → 503 with `ocrLoaded: False`; after `event.set()` and polling ≤ 2 s → 200.
  - `test_auth`: missing header, `Bearer wrong` and `Basic x` each give 401 with body `{"error": {"code": "unauthorized", "message": ..., "retryable": False, "details": {}, "usage": None}}`; the correct token gives 200.
  - `test_busy`: with `vision_heavy_slot_wait_s=0.1` and `app.state.heavy_sem` acquired in the test, the heavy route returns 503, header `Retry-After == "20"`, body `code == "busy"` and `retryable is True`.
  - `test_validation_error_is_400`: body code `invalid_request`, with `details.errors` a list of `{loc, msg}`.
  - `test_unexpected_exception_is_500`: code `internal_error`, `retryable` true, and `"boom"` not in the response text.
  - `test_request_id_echoed`: the `X-Request-Id: abc` request header is echoed in the response header.
  - `test_error_table`: pins every 06 §14.2 row, for example `ERROR_TABLE["file_too_large"] == (413, False)`, `["dwg_not_supported"] == (415, False)`, `["no_walls_detected"] == (422, False)`, `["source_unavailable"] == (502, True)`, `["provider_error"] == (502, True)`, `["upload_failed"] == (502, True)`, `["busy"] == (503, True)`, `["deadline_exceeded"] == (504, False)`, `["internal_error"] == (500, True)`, `["invalid_page"] == (400, False)`, `["provider_not_configured"] == (400, False)`. It also pins the 06 §5.8 codes `decode_failed` (422), `too_large` (413) and `unsupported` (415).
- [ ] **Step 2: Run it, expect FAIL.** Command: `uv run pytest tests/test_api.py -q`. Expected: `ImportError`.
- [ ] **Step 3: Implement.**
  - **`deps.py`.**
    - `require_token` parses the `Authorization` header (case-insensitive scheme `Bearer`) and compares the token with `hmac.compare_digest`.
    - `heavy_slot` does `await asyncio.wait_for(sem.acquire(), settings.vision_heavy_slot_wait_s)` and raises `VisionError("busy", headers={"Retry-After": "20"})` on timeout; it releases in `finally`.
    - `light_slot` uses the same waiting rule on the `Semaphore(2)`. The spec does not state the light-slot rule; it is recorded in the gap list.
  - **Semaphores** are created in the lifespan, so each uvicorn worker process gets its own.
  - **Lifespan.**
    - `cv2.setNumThreads(2)` and `configure_logging(settings.vision_log_level)`.
    - Initialise Sentry only when `SENTRY_DSN` is set.
    - Start background OCR loading with `asyncio.create_task(anyio.to_thread.run_sync(factory))`, setting `ocr_loaded = True` when done. The default factory is wired in Task 12.
  - **Request-id middleware.** Reads `X-Request-Id` (otherwise `uuid4().hex`), sets the context variable, echoes the header, and logs one access line `{msg: "request", path, status, durationMs}`.
  - **Exception handlers** for `VisionError`, `RequestValidationError` (→ `invalid_request`) and `Exception` (→ `internal_error` with message `"Internal error"`; the stack goes to the logs).
- [ ] **Step 4: Run tests, expect PASS.** Same command as Step 2.
- [ ] **Step 5: Quality gates.** `uv run ruff check . && uv run ruff format --check . && uv run mypy app`
- [ ] **Step 6: Commit.** `git add vision/app/api vision/app/main.py vision/tests/test_api.py` then `git commit -m "feat(vision): app factory, bearer auth, busy slots, error mapping, healthz" -m "$FURNY_TRAILER"`.

---

