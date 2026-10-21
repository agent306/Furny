# Task 6 report: pipeline context, debug sink, source I/O, fetch and upload

Status: DONE (commit f40d109 "feat(vision): pipeline context, debug sink, presigned-URL I/O")

## Implemented
- `app/utils/timing.py`: `monotonic_ms()` (floor of monotonic ns / 1e6).
- `app/utils/http.py`: `SourceIO` Protocol; `HttpIO(client=None, sleep=time.sleep)`; `LocalIO()` (file:// fetch/put).
  - fetch streams via `client.stream("GET", url, timeout=timeout_s)`, accumulates against the cap (`file_too_large` as soon as the running total exceeds it; also rejects early on a declared Content-Length over the cap). Non-200 / `httpx.HTTPError` / `InvalidURL` -> `source_unavailable` (retryable via ERROR_TABLE). Messages never contain the URL (presigned credential).
  - put: 3 attempts, sleeps 1 then 2 (the spec's 4 s is unreachable; recorded in a code comment, belongs in the gap list per the brief), `Content-Type` header, 60 s timeout; retries on non-2xx and transport errors; then `upload_failed`.
  - LocalIO: non-file scheme or OSError -> `source_unavailable` / `upload_failed`; cap enforced by reading max_bytes+1.
- `app/pipeline/debug.py`: `DebugSink(enabled)`; `add_png`, `add_json` (default encoder handles pydantic, dataclasses, numpy, sets), `flush(put_urls, io)`. Disabled -> stores nothing, flush returns []. Index >= 8 ignored at add time; index >= len(put_urls) skipped at flush; VisionError on PUT is logged (`furny.vision.debug`, artifact name + error code, no URL) and the artifact omitted. Returns `DebugArtifact` built with keywords (preflight nit).
- `app/pipeline/context.py`: `PipelineContext` (plain mutable class, so T27 can mutate `deadline`), `for_request`, `remaining`, `check_deadline` (-> `deadline_exceeded` 504, retryable False), `stage` (accumulates, records also on exception), `warn` (dedupe on code+params; entity ids of a repeat are merged into the first).
- `app/pipeline/fetch.py`: `fetch_source` (deadline check before and after the io call) and `upload_bytes` (deadline check before).
- `app/main.py`: `app.state.io_factory = lambda: HttpIO()`.

## Rulings applied
- K1 (cwd/git paths). I4 / "strengthen the T6 timings test": `test_stage_timings_accumulate` enters `ctx.stage("ocr")` twice (sleeps 10 ms, 20 ms), asserts `timings["ocr"] >= 30` (plus < 1000 and only that key). Floor-based `monotonic_ms` guarantees no off-by-one below 30.
- `DebugArtifact` constructed with keywords. httpx.MockTransport only, no network.
- K2/K5/K12/K18 not applicable to this task.

## TDD evidence
- RED: `uv run pytest tests/test_fetch.py tests/test_context.py -q` before implementation -> 2 collection errors, `ModuleNotFoundError: No module named 'app.pipeline.context'` (expected: modules not yet written).
- GREEN: same command after implementation -> `24 passed in 0.38s`; test_context repeated 3x, 10 passed each (no flakiness).

## Gates
- Full suite `uv run pytest -q`: 130 passed (before the final docstring-only tweak; new files re-run: 24 passed).
- `uv run ruff check .` clean; `uv run ruff format --check .` 38 files formatted; `uv run mypy app` no issues (27 files).

## Tests (24)
test_fetch.py: fetch_ok, stream_cap (generator, yielded <= 12 of 20 chunks), exactly-at-cap allowed, declared content-length over cap, non_200, connect_error, timeout passed through, put_retries (sleeps [1,2], 3 requests, Content-Type image/png, body), put retry on transport error, put_gives_up (3 attempts, upload_failed), local_io roundtrip/cap/missing/wrong scheme, local put failure, fetch_source/upload_bytes delegate, deadline checked before io.
test_context.py: deadline, mutable deadline, stage accumulation, stage on exception, warn dedupe, warn entity-id merge, debug sink disabled / enabled (PNG magic, JSON roundtrip with numpy scalar) / out-of-range indexes / PUT failure logged (capsys; presigned query not leaked) and omitted.

## Concerns / notes (non-blocking)
- `io_factory = lambda: HttpIO()` creates an `httpx.Client` per call and nothing closes it; the T29/T31 routes may want to close it (no `close()` on the Protocol per the brief).
- `HttpIO` does not follow redirects (httpx default); presigned S3 GETs normally do not redirect. Change if a real source needs it.
- `fetch_source` does not shrink `timeout_s` to `ctx.remaining()`; a 30 s fetch can overrun a nearly-expired deadline by up to 30 s (post-call check then raises). Brief only asked for check_deadline wrapping.
- Gap list entry: PUT backoff 1/2/4 s in 06 §14.2 vs 3 attempts => 4 s never used.
