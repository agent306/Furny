"""Dimension lines, dimension spans and heuristic text association (06 §8.4 steps 1-5)."""

import itertools
import math
import time

import numpy as np
import pytest

from app.pipeline import dimensions as dimmod
from app.pipeline.binarize import Preprocessed, preprocess
from app.pipeline.dimensions import associate_dimension_texts, find_dimension_lines, find_dimension_spans
from app.pipeline.ocr_stage import OcrResult
from app.pipeline.segments import detect_segments
from app.pipeline.textparse import parse_token
from app.schemas.candidates import Segment, TextToken
from app.utils.geometry import Rect
from tests.support import synth
from tests.support.synth import SDimChain, SWall, render_plan
from tests.test_normalize import make_ctx
from tests.test_preprocess import page_of

REGION = Rect(0, 0, 2400, 700)  # L = 2400: ticks 12..72 px, dimension lines >= 96 px
TICK_X = [300, 1200, 2100]
LINE_Y = 300


def seg(sid: str, p0: tuple[float, float], p1: tuple[float, float], width: float = 2.0) -> Segment:
    return Segment(sid, p0, p1, width, width <= 3.6, "lsd")


def tok(tid: str, text: str, cx: float, cy: float, height: float = 22.0, angle: int = 0) -> TextToken:
    """A token centred on (cx, cy); `height` is the glyph height, the text is 13 px per character wide."""
    length = 13.0 * len(text)
    w, h = (length, height) if angle == 0 else (height, length)
    x0, y0, x1, y1 = cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2
    if angle == 0:
        quad = ((x0, y0), (x1, y0), (x1, y1), (x0, y1))
    else:  # reads bottom-to-top: starts at the lower left
        quad = ((x0, y1), (x0, y0), (x1, y0), (x1, y1))
    return TextToken(tid, text, quad, (x0, y0, x1, y1), angle, 0.99, height, parse_token(text))  # type: ignore[arg-type]


def slash(sid: str, x: float, y: float = LINE_Y, half: float = 7.0) -> Segment:
    return seg(sid, (x - half, y + half), (x + half, y - half))


def chain_segments(ticks: list[int], y: float = LINE_Y) -> list[Segment]:
    line = seg("S1", (ticks[0] - 1.0, y), (ticks[-1] + 1.0, y))
    return [line, *(slash(f"S{n}", t, y) for n, t in enumerate(ticks, 2))]


def labels_over(ticks: list[int], texts: list[str], y: float = LINE_Y) -> list[TextToken]:
    return [
        tok(f"T{n}", text, (t0 + t1) / 2, y - 19)
        for n, ((t0, t1), text) in enumerate(zip(itertools.pairwise(ticks), texts, strict=False), 1)
    ]


def test_chain_detected() -> None:
    tokens = labels_over(TICK_X, ["9000", "9000"])
    lines = find_dimension_lines(chain_segments(TICK_X), tokens, REGION)
    assert [ln.id for ln in lines] == ["L1"]
    line = lines[0]
    assert line.segment_id == "S1"
    assert line.p0 == (299.0, LINE_Y)
    assert line.tick_positions == pytest.approx([1.0, 901.0, 1801.0], abs=0.01)  # px from p0

    spans = find_dimension_spans(lines, tokens, REGION)
    assert [s.id for s in spans] == ["D1", "D2", "D3"]
    assert [s.kind for s in spans] == ["chain_segment", "chain_segment", "overall"]
    assert [(s.p0[0], s.p1[0]) for s in spans] == pytest.approx([(300, 1200), (1200, 2100), (300, 2100)])
    assert all(s.axis == "x" and s.line_id == "L1" and s.p0[1] == LINE_Y for s in spans)
    assert [s.near_text_ids for s in spans] == [["T1"], ["T2"], ["T1", "T2"]]


def test_two_ticks_single_span() -> None:
    ticks = [300, 1200]
    tokens = labels_over(ticks, ["9000"])
    lines = find_dimension_lines(chain_segments(ticks), tokens, REGION)
    spans = find_dimension_spans(lines, tokens, REGION)
    assert len(spans) == 1
    assert spans[0].kind == "overall"
    assert spans[0].near_text_ids == ["T1"]


def test_bar_ticks_and_extension_lines() -> None:
    # Bar ticks are perpendicular and mid-crossing; extension lines only touch the line with one end.
    bars = [seg("S2", (300, LINE_Y - 8), (300, LINE_Y + 8)), seg("S3", (900, LINE_Y - 8), (900, LINE_Y + 8))]
    line = seg("S1", (299, LINE_Y), (901, LINE_Y))
    tokens = labels_over([300, 900], ["6000"])
    found = find_dimension_lines([line, *bars], tokens, REGION)
    assert len(found) == 1
    assert found[0].tick_positions == pytest.approx([1.0, 601.0], abs=0.01)

    ext = [
        seg("S2", (300, LINE_Y + 1.5), (300, LINE_Y + 250)),
        seg("S3", (900, LINE_Y - 1.8), (900, LINE_Y - 250)),
    ]
    found = find_dimension_lines([line, *ext], tokens, REGION)
    assert len(found) == 1
    assert found[0].tick_positions == pytest.approx([1.0, 601.0], abs=0.01)

    gap = [
        seg("S2", (300, LINE_Y + 3.5), (300, LINE_Y + 250)),
        seg("S3", (900, LINE_Y + 3.5), (900, LINE_Y + 250)),
    ]
    assert (
        len(find_dimension_lines([line, *gap], tokens, REGION)) == 1
    )  # LSD-sized gap: 2 px + half the width + 1
    far = [
        seg("S2", (300, LINE_Y + 6), (300, LINE_Y + 250)),
        seg("S3", (900, LINE_Y + 6), (900, LINE_Y + 250)),
    ]
    assert find_dimension_lines([line, *far], tokens, REGION) == []


def test_tick_geometry_limits() -> None:
    line = seg("S1", (299, LINE_Y), (901, LINE_Y))
    tokens = labels_over([300, 900], ["6000"])

    def count(ticks: list[Segment]) -> int:
        found = find_dimension_lines([line, *ticks], tokens, REGION)
        return len(found[0].tick_positions) if found else 0

    assert count([slash("S2", 300), slash("S3", 900)]) == 2
    # Too short (< 0.005 L = 12 px), too long (> 0.03 L = 72 px, not touching), off-angle (20 degrees).
    short = [slash("S2", 300, half=4.0), slash("S3", 900, half=4.0)]
    assert count(short) == 0
    long_ = [
        seg("S2", (270, LINE_Y + 40), (330, LINE_Y - 40)),
        seg("S3", (870, LINE_Y + 40), (930, LINE_Y - 40)),
    ]
    assert count(long_) == 0
    flat = [seg("S2", (290, LINE_Y + 3), (310, LINE_Y - 3)), seg("S3", (890, LINE_Y + 3), (910, LINE_Y - 3))]
    assert count(flat) == 0
    # The line must cross the tick within its middle 80 %: a tick that merely starts at it does not count.
    hanging = [
        seg("S2", (300, LINE_Y + 1), (314, LINE_Y - 13)),
        seg("S3", (900, LINE_Y + 1), (914, LINE_Y - 13)),
    ]
    assert count(hanging) == 0
    # A line shorter than 0.04 L is no dimension line.
    stub = seg("S1", (299, LINE_Y), (380, LINE_Y))
    assert find_dimension_lines([stub, slash("S2", 300), slash("S3", 380)], tokens, REGION) == []


def test_thick_segments_are_not_dimension_lines() -> None:
    thick = Segment("S1", (299, LINE_Y), (901, LINE_Y), 12.0, False, "lsd")
    tokens = labels_over([300, 900], ["6000"])
    assert find_dimension_lines([thick, slash("S2", 300), slash("S3", 900)], tokens, REGION) == []


def test_no_text_not_dimension() -> None:
    segments = chain_segments(TICK_X)
    assert find_dimension_lines(segments, [], REGION) == []
    far = tok("T1", "9000", 750, LINE_Y - 19 - 60)  # 79 px from the line > 2.5 x 22 = 55
    assert find_dimension_lines(segments, [far], REGION) == []
    near = tok("T1", "9000", 750, LINE_Y - 19 - 20)  # 39 px
    assert len(find_dimension_lines(segments, [near], REGION)) == 1
    not_numeric = tok("T1", "KITCHEN", 750, LINE_Y - 19)
    assert find_dimension_lines(segments, [not_numeric], REGION) == []
    beyond_end = tok("T1", "9000", 2300, LINE_Y - 19)
    assert find_dimension_lines(segments, [beyond_end], REGION) == []


def test_orientation_match() -> None:
    ticks = [300, 1200]
    good = tok("T1", "9000", 520, LINE_Y - 19)
    rotated = tok("T2", "9000", 980, LINE_Y - 19, angle=90)
    lines = find_dimension_lines(chain_segments(ticks), [good, rotated], REGION)
    spans = find_dimension_spans(lines, [good, rotated], REGION)
    assert [s.near_text_ids for s in spans] == [["T1"]]
    only_rotated = find_dimension_lines(chain_segments(ticks), [rotated], REGION)
    assert len(only_rotated) == 1  # step 1 only asks for a numeric token nearby
    assert [s.near_text_ids for s in find_dimension_spans(only_rotated, [rotated], REGION)] == [[]]


def test_vertical_and_diagonal_axes() -> None:
    x = 400.0
    line = seg("S1", (x, 100), (x, 701))
    ticks = [seg("S2", (x - 7, 100 - 7), (x + 7, 100 + 7)), seg("S3", (x - 7, 700 + 7), (x + 7, 700 - 7))]
    label = tok("T1", "6000", x - 19, 400, angle=90)
    found = find_dimension_lines([line, *ticks], [label], Rect(0, 0, 700, 900))
    spans = find_dimension_spans(found, [label], Rect(0, 0, 700, 900))
    assert [(s.axis, s.near_text_ids) for s in spans] == [("y", ["T1"])]

    a, b = (100.0, 100.0), (700.0, 400.0)  # about 26.6 degrees
    ux, uy = (b[0] - a[0]) / math.hypot(600, 300), (b[1] - a[1]) / math.hypot(600, 300)
    diag = [seg("S1", a, b)] + [
        seg(f"S{n + 2}", (px - 8 * uy, py + 8 * ux), (px + 8 * uy, py - 8 * ux))
        for n, (px, py) in enumerate((a, b))
    ]
    label = tok("T1", "6000", 400, 220 - 19)
    found = find_dimension_lines(diag, [label], Rect(0, 0, 800, 600))
    spans = find_dimension_spans(found, [label], Rect(0, 0, 800, 600))
    assert [(s.axis, s.near_text_ids) for s in spans] == [("other", [])]


def test_ids_follow_geometric_order() -> None:
    upper, lower = 200.0, 500.0
    segments = chain_segments([300, 900], lower)
    segments += [
        Segment(f"S{n + 10}", s.p0, s.p1, s.width_px, s.is_thin, s.source)
        for n, s in enumerate(chain_segments([300, 900], upper))
    ]
    tokens = [*labels_over([300, 900], ["6000"], lower), tok("T9", "6000", 600, upper - 19)]
    lines = find_dimension_lines(segments, tokens, REGION)
    assert [(ln.id, ln.p0[1]) for ln in lines] == [("L1", upper), ("L2", lower)]
    spans = find_dimension_spans(lines, tokens, REGION)
    assert [(s.id, s.line_id) for s in spans] == [("D1", "L1"), ("D2", "L2")]


def test_duplicate_collinear_segments_make_one_line() -> None:
    segments = chain_segments(TICK_X)
    segments.append(seg("S9", (299, LINE_Y + 1), (1200, LINE_Y + 1)))
    lines = find_dimension_lines(segments, labels_over(TICK_X, ["9000", "9000"]), REGION)
    assert len(lines) == 1
    assert lines[0].segment_id == "S1"


def test_association_prefers_nearest_midpoint() -> None:
    tokens = labels_over(TICK_X, ["9000", "9000"])
    lines = find_dimension_lines(chain_segments(TICK_X), tokens, REGION)
    spans = find_dimension_spans(lines, tokens, REGION)
    # Each label lists its chain span and the overall span; its own chain span has the nearer midpoint.
    assert associate_dimension_texts(spans, tokens) == {"T1": "D1", "T2": "D2"}
    # Centred on the overall span's midpoint, the overall span wins over both chain spans.
    middle = tok("T3", "18000", 1200, LINE_Y - 19)
    spans = find_dimension_spans(lines, [*tokens, middle], REGION)
    assert associate_dimension_texts(spans, [middle]) == {"T3": "D3"}


def test_association_tie_prefers_shorter_span() -> None:
    def span(sid: str, x0: float, x1: float) -> dimmod.DimensionSpan:
        return dimmod.DimensionSpan(sid, (x0, LINE_Y), (x1, LINE_Y), "x", "chain_segment", ["T1"], "L1")

    token = tok("T1", "4000", 500, LINE_Y - 19)
    short, long_ = span("D1", 200, 600), span("D2", 300, 900)  # midpoints 400 and 600: both 100 px away
    assert associate_dimension_texts([short, long_], [token]) == {"T1": "D1"}
    assert associate_dimension_texts([long_, short], [token]) == {"T1": "D1"}
    # A strictly nearer midpoint beats a shorter span.
    near = span("D3", 100, 1000)  # midpoint 550, 50 px away
    assert associate_dimension_texts([short, near], [token]) == {"T1": "D3"}
    # Tokens that no span lists are left out.
    stray = tok("T2", "4000", 500, LINE_Y - 19)
    assert associate_dimension_texts([short], [token, stray]) == {"T1": "D1"}


# --- raster pages: ticks are found by probing the ink -------------------------------------------------


def raster(
    dims: list[SDimChain], size: tuple[int, int] = (2400, 700), walls: list[SWall] | None = None
) -> tuple[Preprocessed, list[Segment]]:
    walls = walls if walls is not None else [SWall((300, 400), (2100, 400), 12)]
    img = render_plan(size, walls, dims=dims)
    page = page_of(img)
    pre = preprocess(page, make_ctx())
    ocr = OcrResult(tokens=[], text_mask=np.zeros(pre.ink.shape, np.uint8), ink_notext=pre.ink)
    return pre, detect_segments(page, pre, ocr, make_ctx())


@pytest.mark.parametrize("tick_style", ["slash", "bar"])
def test_raster_chain_ticks_from_ink(tick_style: str) -> None:
    chain = SDimChain((300, 320), "x", TICK_X, ["9000", "9000"], tick_style)  # type: ignore[arg-type]
    pre, segments = raster([chain])
    tokens = labels_over(TICK_X, ["9000", "9000"], 320)

    # LSD drops the 16 px ticks (below its minimum length): segments alone see no ticks.
    assert find_dimension_lines(segments, tokens, pre.region) == []

    lines = find_dimension_lines(segments, tokens, pre.region, ink=pre.ink)
    assert len(lines) == 1
    xs = [lines[0].p0[0] + t for t in lines[0].tick_positions]
    assert xs == pytest.approx(TICK_X, abs=3.0)
    spans = find_dimension_spans(lines, tokens, pre.region)
    assert [s.kind for s in spans] == ["chain_segment", "chain_segment", "overall"]
    assert [s.axis for s in spans] == ["x"] * 3


def test_raster_vertical_chain() -> None:
    ticks = [100, 400, 700]
    chain = SDimChain((355, 100), "y", ticks, ["3000", "3000"])
    pre, segments = raster([chain], (800, 900), [SWall((400, 50), (400, 850), 12)])
    tokens = [
        tok(f"T{n}", "3000", 355 - 19, (a + b) / 2, angle=90)
        for n, (a, b) in enumerate(itertools.pairwise(ticks), 1)
    ]
    lines = find_dimension_lines(segments, tokens, pre.region, ink=pre.ink)
    assert len(lines) == 1
    ys = [lines[0].p0[1] + t for t in lines[0].tick_positions]
    assert ys == pytest.approx(ticks, abs=3.0)
    spans = find_dimension_spans(lines, tokens, pre.region)
    assert {s.axis for s in spans} == {"y"}
    assert spans[0].near_text_ids == ["T1"]


def test_raster_ticks_found_by_segments_and_ink_are_deduped(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(synth, "DIM_TICK_PX", 50)  # long enough for LSD to report them as segments
    chain = SDimChain((300, 320), "x", TICK_X, ["9000", "9000"], "bar")
    pre, segments = raster([chain])
    tokens = labels_over(TICK_X, ["9000", "9000"], 320)
    by_segments = find_dimension_lines(segments, tokens, pre.region)
    assert len(by_segments) == 1
    assert len(by_segments[0].tick_positions) >= 3
    with_ink = find_dimension_lines(segments, tokens, pre.region, ink=pre.ink)
    assert len(with_ink[0].tick_positions) == 3


def test_raster_crossing_wall_is_not_a_tick() -> None:
    # A wall crossing the dimension line is no tick: its ink run is far longer than 0.03 L. The segment is
    # given whole (detect_segments splits a thin line where a thick wall crosses it).
    walls = [SWall((300, 400), (2100, 400), 12), SWall((750, 200), (750, 400), 12)]
    chain = SDimChain((300, 320), "x", [300, 1200], ["9000"])
    pre, _ = raster([chain], walls=walls)
    line = seg("S1", (299, 319), (1201, 319), 1.9)
    tokens = labels_over([300, 1200], ["9000"], 320)
    lines = find_dimension_lines([line], tokens, pre.region, ink=pre.ink)
    assert len(lines) == 1
    xs = [lines[0].p0[0] + t for t in lines[0].tick_positions]
    assert xs == pytest.approx([300, 1200], abs=3.0)


def test_raster_dot_blob_ticks() -> None:
    ink = np.zeros((700, 2400), np.uint8)
    ink[319:322, 299:1202] = 255  # the dimension line
    yy, xx = np.mgrid[0:700, 0:2400]
    for x in (300, 1200):  # filled dots of diameter 13 <= 0.0068 L (16 px)
        ink[(xx - x) ** 2 + (yy - 320) ** 2 <= 36] = 255
    line = seg("S1", (299, 320), (1201, 320), 3.0)
    tokens = labels_over([300, 1200], ["9000"], 320)
    assert find_dimension_lines([line], tokens, REGION) == []
    lines = find_dimension_lines([line], tokens, REGION, ink=ink)
    assert len(lines) == 1
    assert [lines[0].p0[0] + t for t in lines[0].tick_positions] == pytest.approx([300, 1200], abs=2.0)


# --- fix round 1 ----------------------------------------------------------------------------------------


def labelled_line(y: float, x0: int = 300, x1: int = 900) -> tuple[list[Segment], list[TextToken]]:
    segments = [seg(f"S{y}", (x0 - 1.0, y), (x1 + 1.0, y)), slash(f"A{y}", x0, y), slash(f"B{y}", x1, y)]
    return segments, [tok(f"T{y}", "6000", (x0 + x1) / 2, y - 19)]


def test_span_ids_follow_line_order_with_many_lines() -> None:
    segments: list[Segment] = []
    tokens: list[TextToken] = []
    for n in range(12):
        segs, toks = labelled_line(40.0 + 50 * n)
        segments += segs
        tokens += toks
    region = Rect(0, 0, 2400, 700)
    lines = find_dimension_lines(segments, tokens, region)
    assert [ln.id for ln in lines] == [f"L{n}" for n in range(1, 13)]
    assert [ln.p0[1] for ln in lines] == sorted(ln.p0[1] for ln in lines)
    spans = find_dimension_spans(lines, tokens, region)
    assert [s.id for s in spans] == [f"D{n}" for n in range(1, 13)]
    assert [s.line_id for s in spans] == [ln.id for ln in lines]  # L10 comes after L9, not after L1
    assert [s.p0[1] for s in spans] == [ln.p0[1] for ln in lines]


def test_label_across_check_in_near_text_ids() -> None:
    ticks = [300, 1200]
    near = tok("T1", "9000", 520, LINE_Y - 19)
    far = tok("T2", "9000", 980, LINE_Y - 19 - 80)  # projects inside the span but 99 px > 2.5 x 22 away
    lines = find_dimension_lines(chain_segments(ticks), [near, far], REGION)
    spans = find_dimension_spans(lines, [near, far], REGION)
    assert [s.near_text_ids for s in spans] == [["T1"]]


def test_label_must_be_on_the_line_not_a_stub() -> None:
    # The label sits over the 81 px stub; the stub is shorter than 0.04 L = 96 px, so it is no line.
    stub = seg("S1", (299, LINE_Y), (380, LINE_Y))
    label = tok("T1", "6000", 340, LINE_Y - 19)
    assert find_dimension_lines([stub, slash("S2", 300), slash("S3", 380)], [label], REGION) == []


def test_slanted_tick_at_70_degrees_is_not_a_tick() -> None:
    line = seg("S1", (299, LINE_Y), (901, LINE_Y))
    tokens = labels_over([300, 900], ["6000"])
    r = 10.0  # 20 px long, 20 degrees off the perpendicular: outside both 90 +- 10 and 45 +- 15
    dx, dy = r * math.cos(math.radians(70)), r * math.sin(math.radians(70))
    ticks = [
        seg("S2", (300 - dx, LINE_Y + dy), (300 + dx, LINE_Y - dy)),
        seg("S3", (900 - dx, LINE_Y + dy), (900 + dx, LINE_Y - dy)),
    ]
    assert find_dimension_lines([line, *ticks], tokens, REGION) == []
    dx, dy = r * math.cos(math.radians(82)), r * math.sin(math.radians(82))  # within 90 +- 10
    ticks = [
        seg("S2", (300 - dx, LINE_Y + dy), (300 + dx, LINE_Y - dy)),
        seg("S3", (900 - dx, LINE_Y + dy), (900 + dx, LINE_Y - dy)),
    ]
    assert len(find_dimension_lines([line, *ticks], tokens, REGION)) == 1


def test_ticks_just_beyond_the_line_ends() -> None:
    line = seg("S1", (304, LINE_Y), (896, LINE_Y))  # the ticks at 300 / 900 are 4 px beyond its ends
    bars = [seg("S2", (300, LINE_Y - 8), (300, LINE_Y + 8)), seg("S3", (900, LINE_Y - 8), (900, LINE_Y + 8))]
    tokens = labels_over([300, 900], ["6000"])
    assert len(find_dimension_lines([line, *bars], tokens, REGION)) == 1
    far = [seg("S2", (290, LINE_Y - 8), (290, LINE_Y + 8)), seg("S3", (910, LINE_Y - 8), (910, LINE_Y + 8))]
    assert find_dimension_lines([line, *far], tokens, REGION) == []  # 14 px beyond: another object
    ink = np.zeros((700, 2400), np.uint8)
    ink[LINE_Y - 1 : LINE_Y + 2, 304:897] = 255
    for x in (300, 900):
        ink[LINE_Y - 8 : LINE_Y + 9, x - 1 : x + 2] = 255
    assert len(find_dimension_lines([line], tokens, REGION, ink=ink)) == 1
    ink[:] = 0
    ink[LINE_Y - 1 : LINE_Y + 2, 304:897] = 255
    for x in (290, 910):
        ink[LINE_Y - 8 : LINE_Y + 9, x - 1 : x + 2] = 255
    assert find_dimension_lines([line], tokens, REGION, ink=ink) == []


# --- raster negatives and mutation killers ---


def line_ink(x0: int = 299, x1: int = 1201) -> np.ndarray:
    ink = np.zeros((700, 2400), np.uint8)
    ink[LINE_Y - 1 : LINE_Y + 2, x0:x1] = 255
    return ink


def vstroke(ink: np.ndarray, x: int, y0: int, y1: int, step: int = 1) -> None:
    for y in range(y0, y1 + 1, step):
        ink[y, x - 1 : x + 2] = 255


LINE = seg("S1", (299, LINE_Y), (1201, LINE_Y), 3.0)
LABELS = labels_over([300, 1200], ["9000"])


def ticks_of(ink: np.ndarray) -> list[float]:
    lines = find_dimension_lines([LINE], LABELS, REGION, ink=ink)
    return [round(lines[0].p0[0] + t) for t in lines[0].tick_positions] if lines else []


def test_ink_bar_ticks_baseline() -> None:
    ink = line_ink()
    for x in (300, 1200):
        vstroke(ink, x, LINE_Y - 8, LINE_Y + 8)
    assert ticks_of(ink) == pytest.approx([300, 1200], abs=2)


@pytest.mark.parametrize("extent", [(150, 450), (LINE_Y - 400, LINE_Y + 300)])
def test_long_thin_stroke_crossing_the_line_is_not_a_tick(extent: tuple[int, int]) -> None:
    ink = line_ink()
    for x in (300, 1200):
        vstroke(ink, x, LINE_Y - 8, LINE_Y + 8)
    vstroke(ink, 750, *extent)  # 300 px, 120 px beyond ... crossing the line in the middle
    assert ticks_of(ink) == pytest.approx([300, 1200], abs=2)
    tilted = line_ink()
    for x in (300, 1200):
        vstroke(tilted, x, LINE_Y - 8, LINE_Y + 8)
    for t in range(-150, 151):  # a thin 300 px stroke at 60 degrees
        tilted[round(LINE_Y + t * 0.866), round(750 + t * 0.5)] = 255
    assert ticks_of(tilted) == pytest.approx([300, 1200], abs=2)


@pytest.mark.parametrize("overshoot", [0, 2, 4, 8])
def test_raster_extension_lines_overshoot(overshoot: int) -> None:
    walls = [
        SWall((300, 400), (2100, 400), 12),
        SWall((300, 320), (1200, 320), 2, style="single"),
        SWall((300, 230), (300, 320 + overshoot), 2, style="single"),
        SWall((1200, 230), (1200, 320 + overshoot), 2, style="single"),
    ]
    pre, segments = raster([], walls=walls)
    tokens = labels_over([300, 1200], ["9000"], 320)
    for ink in (None, pre.ink):
        lines = find_dimension_lines(segments, tokens, pre.region, ink=ink)
        assert len(lines) == 1, (overshoot, ink is None)
        xs = [lines[0].p0[0] + t for t in lines[0].tick_positions]
        assert xs == pytest.approx([300, 1200], abs=4.0)


@pytest.mark.parametrize("overshoot", [0, 2, 4, 8, 12])
def test_ink_extension_lines_overshoot(overshoot: int) -> None:
    ink = line_ink()
    for x in (300, 1200):
        vstroke(ink, x, LINE_Y - 90, LINE_Y + overshoot)  # an extension line ending `overshoot` px beyond
    assert ticks_of(ink) == pytest.approx([300, 1200], abs=2)


def test_ink_stroke_crossing_by_20_px_is_not_an_extension_line() -> None:
    ink = line_ink()
    for x in (300, 1200):
        vstroke(ink, x, LINE_Y - 90, LINE_Y + 20)
    assert ticks_of(ink) == []


def test_ink_slanted_stub_is_not_an_extension_line() -> None:
    ink = line_ink()
    for x in (300, 1200):
        for t in range(0, 100):  # 45 degrees, 140 px long, ending on the line
            ink[LINE_Y - t, x + t : x + t + 2] = 255
    assert ticks_of(ink) == []


def test_text_glyphs_beside_the_line_are_not_ticks() -> None:
    ink = line_ink()
    for x in range(310, 1190, 22):  # a row of "1" stems 2 px above the line (gap rows 317, 318)
        ink[LINE_Y - 14 : LINE_Y - 2, x : x + 2] = 255
    assert ticks_of(ink) == []


def test_too_short_run_is_not_a_tick() -> None:
    ink = line_ink()
    for x in (300, 1200):
        vstroke(ink, x, LINE_Y - 4, LINE_Y + 4)  # 9 px < 0.005 L = 12 px
    assert ticks_of(ink) == []


def test_dotted_stroke_is_not_a_tick() -> None:
    ink = line_ink()
    for x in (300, 1200):
        vstroke(ink, x, LINE_Y - 12, LINE_Y + 12, step=2)  # every other row: 50 % inked
    assert ticks_of(ink) == []


def test_off_centre_stroke_is_not_a_tick() -> None:
    ink = line_ink()
    for x in (300, 1200):
        vstroke(ink, x, LINE_Y - 16, LINE_Y + 54)  # 16 px above, 54 px below: not centred, not a stub
    assert ticks_of(ink) == []


def test_big_dot_is_not_a_blob() -> None:
    ink = line_ink()
    yy, xx = np.mgrid[0:700, 0:2400]
    for x in (300, 1200):
        ink[(xx - x) ** 2 + (yy - LINE_Y) ** 2 <= 15**2] = 255  # 31 px across > 0.0068 L = 16 px
    assert ticks_of(ink) == []


def test_small_dot_blob_below_probe_length() -> None:
    ink = line_ink()
    yy, xx = np.mgrid[0:700, 0:2400]
    for x in (300, 1200):
        ink[(xx - x) ** 2 + (yy - LINE_Y) ** 2 <= 25] = 255  # 11 px: shorter than the 12 px probe
    assert ticks_of(ink) == pytest.approx([300, 1200], abs=2)


# --- deadline and cost ---


class _StopError(Exception):
    pass


def test_check_deadline_is_called_and_can_abort() -> None:
    calls: list[int] = []
    segments, tokens = labelled_line(300.0)
    find_dimension_lines(segments, tokens, REGION, check_deadline=lambda: calls.append(1))
    assert len(calls) >= len(segments)  # once per candidate

    def stop() -> None:
        raise _StopError

    with pytest.raises(_StopError):
        find_dimension_lines(segments, tokens, REGION, check_deadline=stop)
    ink = line_ink()
    for x in (300, 1200):
        vstroke(ink, x, LINE_Y - 8, LINE_Y + 8)
    seen = {"n": 0}

    def stop_when_probing() -> None:
        seen["n"] += 1
        if seen["n"] > 1:  # the first call is the single candidate; later ones come from the ink probing
            raise _StopError

    with pytest.raises(_StopError):
        find_dimension_lines([LINE], LABELS, REGION, ink=ink, check_deadline=stop_when_probing)


def test_many_long_segments_stay_fast() -> None:
    rng = np.random.default_rng(7)
    size = (4000, 3000)
    region = Rect(0, 0, *size)
    ink = np.zeros((size[1], size[0]), np.uint8)
    segments: list[Segment] = []
    for n in range(3000):  # long thin strokes everywhere, some of them on top of each other
        x, y = int(rng.integers(0, 3000)), int(rng.integers(0, 2950))
        length = int(rng.integers(300, 900))
        segments.append(seg(f"S{n}", (x, y), (x + length, y)))
        ink[y - 1 : y + 2, x : x + length] = 255
    for n in range(40):  # dimension chains with slash ticks (L = 4000: ticks are 20 ... 120 px long)
        y = 60 + 70 * n
        segments += [
            seg(f"C{n}", (299, y), (1501, y)),
            slash(f"A{n}", 300, y, 12),
            slash(f"B{n}", 1500, y, 12),
        ]
        ink[y - 1 : y + 2, 299:1502] = 255
        for x in (300, 1500):
            ink[y - 15 : y + 16, x - 1 : x + 2] = 255
    tokens = [
        tok(f"T{n}", "6000", int(rng.integers(0, 4000)), int(rng.integers(0, 3000))) for n in range(400)
    ]
    tokens += [tok(f"U{n}", "6000", 900, 60 + 70 * n - 19) for n in range(40)]
    started = time.perf_counter()
    lines = find_dimension_lines(segments, tokens, region, ink=ink)
    assert time.perf_counter() - started < 10.0
    assert len(lines) >= 40
