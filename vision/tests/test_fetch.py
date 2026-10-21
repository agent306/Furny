"""Source I/O: streamed capped fetch, retried PUT, local files, deadline-aware wrappers (06 §7.1, §14.2)."""

from pathlib import Path

import httpx
import pytest

from app.api.errors import VisionError
from app.pipeline.context import PipelineContext
from app.pipeline.fetch import fetch_source, upload_bytes
from app.utils.http import HttpIO, LocalIO

URL = "https://bucket.example/plan.png?X-Amz-Signature=abc"


def _io(handler: httpx.MockTransport | None = None, **kwargs: object) -> HttpIO:
    assert handler is not None
    return HttpIO(client=httpx.Client(transport=handler), **kwargs)  # type: ignore[arg-type]


def test_fetch_ok() -> None:
    body = bytes(range(250)) * 4
    io = _io(httpx.MockTransport(lambda request: httpx.Response(200, content=body)))
    assert io.fetch(URL, max_bytes=10_000) == body


def test_stream_cap() -> None:
    chunk = b"x" * 100_000
    total_chunks = 20  # 2 MB
    yielded = 0

    def body():  # type: ignore[no-untyped-def]
        nonlocal yielded
        for _ in range(total_chunks):
            yielded += 1
            yield chunk

    io = _io(httpx.MockTransport(lambda request: httpx.Response(200, content=body())))
    with pytest.raises(VisionError) as exc:
        io.fetch(URL, max_bytes=1_000_000)
    assert exc.value.code == "file_too_large"
    assert exc.value.http_status == 413
    # 10 chunks fit exactly; the 11th crosses the cap; at most one more may already be in flight.
    assert yielded <= 12
    assert yielded < total_chunks


def test_stream_exactly_at_cap_is_allowed() -> None:
    io = _io(httpx.MockTransport(lambda request: httpx.Response(200, content=b"y" * 500)))
    assert len(io.fetch(URL, max_bytes=500)) == 500


def test_declared_content_length_over_cap_rejected_early() -> None:
    io = _io(httpx.MockTransport(lambda request: httpx.Response(200, content=b"z" * 600)))
    with pytest.raises(VisionError) as exc:
        io.fetch(URL, max_bytes=500)
    assert exc.value.code == "file_too_large"


def test_fetch_non_200() -> None:
    io = _io(httpx.MockTransport(lambda request: httpx.Response(404, content=b"nope")))
    with pytest.raises(VisionError) as exc:
        io.fetch(URL, max_bytes=1000)
    assert exc.value.code == "source_unavailable"
    assert exc.value.retryable is True
    assert exc.value.http_status == 502
    assert "X-Amz" not in exc.value.message


def test_fetch_connect_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    io = _io(httpx.MockTransport(handler))
    with pytest.raises(VisionError) as exc:
        io.fetch(URL, max_bytes=1000)
    assert exc.value.code == "source_unavailable"
    assert exc.value.retryable is True


def test_fetch_passes_timeout() -> None:
    seen: list[dict[str, object]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.extensions["timeout"])
        return httpx.Response(200, content=b"ok")

    _io(httpx.MockTransport(handler)).fetch(URL, max_bytes=10, timeout_s=7)
    assert seen[0]["read"] == 7


def test_put_retries() -> None:
    statuses = iter([500, 500, 200])
    requests: list[httpx.Request] = []
    sleeps: list[float] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(next(statuses))

    io = _io(httpx.MockTransport(handler), sleep=sleeps.append)
    io.put(URL, b"PNGDATA", "image/png")
    assert sleeps == [1, 2]
    assert len(requests) == 3
    assert all(r.method == "PUT" for r in requests)
    assert all(r.headers["Content-Type"] == "image/png" for r in requests)
    assert all(r.content == b"PNGDATA" for r in requests)


def test_put_retries_on_transport_error() -> None:
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        if calls == 1:
            raise httpx.ReadTimeout("slow", request=request)
        return httpx.Response(200)

    sleeps: list[float] = []
    _io(httpx.MockTransport(handler), sleep=sleeps.append).put(URL, b"d", "application/json")
    assert calls == 2
    assert sleeps == [1]


def test_put_gives_up() -> None:
    calls = 0
    sleeps: list[float] = []

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(500)

    io = _io(httpx.MockTransport(handler), sleep=sleeps.append)
    with pytest.raises(VisionError) as exc:
        io.put(URL, b"d", "image/png")
    assert exc.value.code == "upload_failed"
    assert exc.value.retryable is True
    assert calls == 3
    assert sleeps == [1, 2]
    assert "X-Amz" not in exc.value.message


def test_local_io_roundtrip(tmp_path: Path) -> None:
    io = LocalIO()
    url = (tmp_path / "out" / "a.bin").as_uri()
    io.put(url, b"hello", "application/octet-stream")
    assert io.fetch(url, max_bytes=100) == b"hello"
    with pytest.raises(VisionError) as too_big:
        io.fetch(url, max_bytes=4)
    assert too_big.value.code == "file_too_large"
    with pytest.raises(VisionError) as missing:
        io.fetch((tmp_path / "missing.bin").as_uri(), max_bytes=100)
    assert missing.value.code == "source_unavailable"
    with pytest.raises(VisionError) as wrong_scheme:
        io.fetch("https://example.com/x", max_bytes=100)
    assert wrong_scheme.value.code == "source_unavailable"


def test_local_io_put_failure(tmp_path: Path) -> None:
    blocker = tmp_path / "file"
    blocker.write_bytes(b"x")
    with pytest.raises(VisionError) as exc:
        LocalIO().put((blocker / "child.bin").as_uri(), b"d", "image/png")
    assert exc.value.code == "upload_failed"


class _RecordingIO:
    def __init__(self) -> None:
        self.fetched: list[tuple[str, int, float]] = []
        self.put_calls: list[tuple[str, bytes, str]] = []

    def fetch(self, url: str, max_bytes: int, timeout_s: float = 30) -> bytes:
        self.fetched.append((url, max_bytes, timeout_s))
        return b"data"

    def put(self, url: str, data: bytes, content_type: str) -> None:
        self.put_calls.append((url, data, content_type))


def test_fetch_source_and_upload_delegate() -> None:
    io = _RecordingIO()
    ctx = PipelineContext.for_request(30, io, debug=False)
    assert fetch_source("u", 10, ctx, timeout_s=5) == b"data"
    upload_bytes("p", b"x", "image/png", ctx)
    assert io.fetched == [("u", 10, 5)]
    assert io.put_calls == [("p", b"x", "image/png")]


def test_fetch_and_upload_check_deadline_first() -> None:
    io = _RecordingIO()
    ctx = PipelineContext.for_request(-1, io, debug=False)
    with pytest.raises(VisionError) as fetch_exc:
        fetch_source("u", 10, ctx)
    assert fetch_exc.value.code == "deadline_exceeded"
    with pytest.raises(VisionError) as put_exc:
        upload_bytes("p", b"x", "image/png", ctx)
    assert put_exc.value.code == "deadline_exceeded"
    assert io.fetched == []
    assert io.put_calls == []
