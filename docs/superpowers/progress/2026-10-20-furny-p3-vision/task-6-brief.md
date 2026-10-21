### Task 6: Pipeline context, debug sink, source I/O, fetch and upload

**Files:**
- Create: `vision/app/pipeline/context.py`, `vision/app/pipeline/debug.py`, `vision/app/pipeline/fetch.py`, `vision/app/utils/http.py`, `vision/app/utils/timing.py`
- Modify: `vision/app/main.py` (default `app.state.io_factory = lambda: HttpIO()`)
- Test: `vision/tests/test_fetch.py`, `vision/tests/test_context.py`

**Spec refs:** `06 §7` intro, `06 §7.1`, `06 §5.2` (deadlines), `06 §13`, `06 §14.2` (`upload_failed`)

**Interfaces:**
- Produces, in `utils/http.py`:
  - `class SourceIO(Protocol)` with `fetch(url: str, max_bytes: int, timeout_s: float = 30) -> bytes` and `put(url: str, data: bytes, content_type: str) -> None`.
  - `HttpIO(client: httpx.Client | None = None, sleep: Callable[[float], None] = time.sleep)`.
  - `LocalIO()` for `file://` URLs on both fetch and put.
- Produces, in `fetch.py`: `fetch_source(url, max_bytes, ctx, timeout_s=30) -> bytes` and `upload_bytes(url, data, content_type, ctx) -> None`.
- Produces, in `context.py`: `PipelineContext(deadline: float, io: SourceIO, debug: DebugSink, request_id: str | None)` with:
  - `timings: dict[str, int]` and `warnings: list[MetaWarning]`
  - `@classmethod for_request(seconds: float, io: SourceIO, *, debug: bool, request_id: str | None = None)`
  - `remaining() -> float`, `check_deadline() -> None`
  - `stage(name: StageKey) -> ContextManager[None]`
  - `warn(code: WarningCode, params: dict[str, str | int | float] | None = None, entity_ids: Sequence[str] = ()) -> None`
- Produces, in `debug.py`: `DebugSink(enabled: bool)` with `add_png(index: int, name: str, img: np.ndarray)`, `add_json(index: int, name: str, obj: Any)` and `flush(put_urls: list[str], io: SourceIO) -> list[DebugArtifact]`.

- [ ] **Step 1: Write the failing test.** Uses `httpx.MockTransport`.
  - `test_fetch_ok`: a 200 response of 1000 bytes is returned exactly.
  - `test_stream_cap`: a 2 MB streamed body with `max_bytes=1_000_000` raises `VisionError` `file_too_large`. Assert the handler streamed through a generator and fetching stopped after at most 1 extra chunk.
  - `test_fetch_non_200` and `test_fetch_connect_error`: both give `source_unavailable` with `retryable=True`.
  - `test_put_retries`: the handler returns 500, 500, then 200. `HttpIO(sleep=fake)` records sleeps `[1, 2]`, and the request header `Content-Type == "image/png"`.
  - `test_put_gives_up`: 500 three times gives `upload_failed`, after 3 attempts total.
  - `test_local_io_roundtrip(tmp_path)`.
  - `test_deadline`: `ctx = PipelineContext.for_request(0.01, ...)`, sleep 0.02 s, then `ctx.check_deadline()` raises `deadline_exceeded` with status 504 and `retryable=False`.
  - `test_stage_timings_accumulate`: `ctx.timings["ocr"] >= 0`.
  - `test_warn_dedupes`: the same code with the same params is recorded once.
  - `test_debug_sink`: when disabled, `flush` performs no PUTs and returns `[]`. When enabled with 2 artifacts, it PUTs `image/png` and `application/json` bodies to `put_urls[index]` and returns `[DebugArtifact(0, "01-ink.png", "image/png"), …]`. An index ≥ 8 or beyond `len(put_urls)` is ignored. A PUT failure is logged and that artifact omitted (debug output is non-essential).
- [ ] **Step 2: Run it, expect FAIL.** Command: `uv run pytest tests/test_fetch.py tests/test_context.py -q`.
- [ ] **Step 3: Implement.**
  - **`HttpIO.fetch`** uses `client.stream("GET", url, timeout=timeout_s)` and accumulates chunks against the cap.
  - **`HttpIO.put`**: 3 attempts total, sleeping 1 s before attempt 2 and 2 s before attempt 3. 06 §14.2 says "3 attempts, 1/2/4 s", so the 4 s wait is never reached; this is recorded in the gap list.
  - **`fetch_source` and `upload_bytes`** wrap the io calls in `ctx.check_deadline()`.
  - **`timing.py`** provides `monotonic_ms()`.
- [ ] **Step 4: Run tests, expect PASS.** Same command as Step 2.
- [ ] **Step 5: Quality gates.** `uv run ruff check . && uv run ruff format --check . && uv run mypy app`
- [ ] **Step 6: Commit.** `git add vision/app/pipeline/context.py vision/app/pipeline/debug.py vision/app/pipeline/fetch.py vision/app/utils/http.py vision/app/utils/timing.py vision/app/main.py vision/tests/test_fetch.py vision/tests/test_context.py` then `git commit -m "feat(vision): pipeline context, debug sink, presigned-URL I/O" -m "$FURNY_TRAILER"`.

---

