"""Pipeline context (deadline, stage timings, warnings) and the debug sink (06 §7, §13)."""

import json
import time

import numpy as np
import pytest

from app.api.errors import VisionError
from app.logging import configure_logging
from app.pipeline.context import PipelineContext
from app.pipeline.debug import DebugSink
from app.schemas.api import DebugArtifact


class FakeIO:
    def __init__(self, fail_urls: frozenset[str] = frozenset()) -> None:
        self.puts: list[tuple[str, bytes, str]] = []
        self.fail_urls = fail_urls

    def fetch(self, url: str, max_bytes: int, timeout_s: float = 30) -> bytes:
        raise AssertionError("not used")

    def put(self, url: str, data: bytes, content_type: str) -> None:
        if url in self.fail_urls:
            raise VisionError("upload_failed", "PUT failed")
        self.puts.append((url, data, content_type))


def test_deadline() -> None:
    ctx = PipelineContext.for_request(0.01, FakeIO(), debug=False)
    assert ctx.remaining() > 0
    time.sleep(0.02)
    assert ctx.remaining() < 0
    with pytest.raises(VisionError) as exc:
        ctx.check_deadline()
    assert exc.value.code == "deadline_exceeded"
    assert exc.value.http_status == 504
    assert exc.value.retryable is False


def test_check_deadline_ok_and_deadline_is_mutable() -> None:
    ctx = PipelineContext.for_request(60, FakeIO(), debug=False, request_id="r1")
    ctx.check_deadline()
    assert ctx.request_id == "r1"
    ctx.deadline -= 120  # Task 27 shortens the deadline in place
    with pytest.raises(VisionError):
        ctx.check_deadline()


def test_stage_timings_accumulate() -> None:
    ctx = PipelineContext.for_request(60, FakeIO(), debug=False)
    with ctx.stage("ocr"):
        time.sleep(0.01)
    with ctx.stage("ocr"):
        time.sleep(0.02)
    assert ctx.timings["ocr"] >= 30
    assert ctx.timings["ocr"] < 1000
    assert set(ctx.timings) == {"ocr"}


def test_stage_records_on_exception() -> None:
    ctx = PipelineContext.for_request(60, FakeIO(), debug=False)
    with pytest.raises(RuntimeError), ctx.stage("walls"):
        time.sleep(0.01)
        raise RuntimeError("x")
    assert ctx.timings["walls"] >= 10


def test_warn_dedupes() -> None:
    ctx = PipelineContext.for_request(60, FakeIO(), debug=False)
    ctx.warn("low_resolution", {"longEdge": 540})
    ctx.warn("low_resolution", {"longEdge": 540})
    ctx.warn("low_resolution", {"longEdge": 600})
    ctx.warn("deskewed")
    assert [(w.code, w.params) for w in ctx.warnings] == [
        ("low_resolution", {"longEdge": 540}),
        ("low_resolution", {"longEdge": 600}),
        ("deskewed", {}),
    ]


def test_warn_entity_ids() -> None:
    ctx = PipelineContext.for_request(60, FakeIO(), debug=False)
    ctx.warn("walls_unconnected", {"count": 2}, entity_ids=["w1", "w2"])
    ctx.warn("walls_unconnected", {"count": 2}, entity_ids=["w2", "w3"])
    assert len(ctx.warnings) == 1
    assert ctx.warnings[0].entity_ids == ["w1", "w2", "w3"]


def _img() -> np.ndarray:
    return np.full((8, 8, 3), 255, dtype=np.uint8)


def test_debug_sink_disabled_does_nothing() -> None:
    io = FakeIO()
    sink = DebugSink(False)
    sink.add_png(0, "01-ink.png", _img())
    sink.add_json(4, "05-ocr.json", {"a": 1})
    assert sink.flush(["u0", "u1", "u2", "u3", "u4"], io) == []
    assert io.puts == []


def test_debug_sink_enabled() -> None:
    io = FakeIO()
    sink = DebugSink(True)
    sink.add_png(0, "01-ink.png", _img())
    sink.add_json(4, "05-ocr.json", {"tokens": [1, 2], "n": np.int64(3)})
    urls = [f"https://put/{i}" for i in range(8)]
    artifacts = sink.flush(urls, io)
    assert artifacts == [
        DebugArtifact(index=0, name="01-ink.png", content_type="image/png"),
        DebugArtifact(index=4, name="05-ocr.json", content_type="application/json"),
    ]
    by_url = {url: (data, ctype) for url, data, ctype in io.puts}
    assert set(by_url) == {urls[0], urls[4]}
    png, png_type = by_url[urls[0]]
    assert png_type == "image/png"
    assert png.startswith(b"\x89PNG\r\n\x1a\n")
    body, json_type = by_url[urls[4]]
    assert json_type == "application/json"
    assert json.loads(body) == {"tokens": [1, 2], "n": 3}


def test_debug_sink_ignores_out_of_range_indexes() -> None:
    io = FakeIO()
    sink = DebugSink(True)
    sink.add_json(0, "a.json", {})
    sink.add_json(1, "b.json", {})  # no URL for index 1
    sink.add_json(8, "i.json", {})  # beyond the 8-artifact maximum
    urls = [f"https://put/{i}" for i in range(10)]
    assert [a.name for a in sink.flush(urls[:1], io)] == ["a.json"]
    sink2 = DebugSink(True)
    sink2.add_json(8, "i.json", {})
    assert sink2.flush(urls, io) == []
    assert [u for u, _, _ in io.puts] == [urls[0]]


def test_debug_sink_put_failure_is_logged_and_omitted(capsys: pytest.CaptureFixture[str]) -> None:
    configure_logging("info")
    io = FakeIO(fail_urls=frozenset({"https://put/1?X-Amz-Signature=secret"}))
    sink = DebugSink(True)
    sink.add_json(0, "a.json", {})
    sink.add_json(1, "b.json", {})
    sink.add_json(2, "c.json", {})
    urls = ["https://put/0", "https://put/1?X-Amz-Signature=secret", "https://put/2"]
    artifacts = sink.flush(urls, io)
    assert [a.name for a in artifacts] == ["a.json", "c.json"]
    out = capsys.readouterr().out
    assert "b.json" in out
    assert "secret" not in out
