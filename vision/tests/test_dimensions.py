"""Dimension lines, dimension spans and heuristic text association (06 §8.4 steps 1-5)."""

import hashlib
import itertools
import math
import time

import cv2
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
from tests.support.inkdraw import polar, stroke
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
    # In the ink the line reaches the ticks (the segment is shorter by LSD's end rounding).
    ink = np.zeros((700, 2400), np.uint8)
    ink[LINE_Y - 1 : LINE_Y + 2, 300:901] = 255
    for x in (300, 900):
        ink[LINE_Y - 8 : LINE_Y + 9, x - 1 : x + 2] = 255
    assert len(find_dimension_lines([line], tokens, REGION, ink=ink)) == 1
    ink[:] = 0
    ink[LINE_Y - 1 : LINE_Y + 2, 300:901] = 255
    for x in (286, 914):  # 14 px beyond the ends of the segment, detached from the line: another object
        ink[LINE_Y - 8 : LINE_Y + 9, x - 1 : x + 2] = 255
    assert find_dimension_lines([line], tokens, REGION, ink=ink) == []


# --- raster ticks from the ink (component-based, 06 §8.4 step 1) --------------------------------------

PHASES = range(6)  # every ink case runs at six y positions of the line ...
JITTER = (
    0.0,
    0.5,
    -0.5,
    0.3,
    -0.3,
    0.8,
)  # ... with the segment this far off the ink's centre (LSD is not exact)
TICKS = [300, 750, 1200]


def phase_y(phase: int) -> int:
    return LINE_Y + phase


def ink_ticks(
    ink: np.ndarray,
    y: float,
    lw: float,
    *,
    phase: int = 0,
    x0: int = 299,
    x1: int = 1201,
    region: Rect = REGION,
) -> list[int]:
    """Absolute x of the ticks of a labelled line from `x0` to `x1` at row `y` of `ink`."""
    line = seg("S1", (x0, y + JITTER[phase]), (x1, y + JITTER[phase]), float(lw))
    label = tok("T1", "9000", (x0 + x1) / 2, y - 19)
    lines = find_dimension_lines([line], [label], region, ink=ink)
    return [round(lines[0].p0[0] + t) for t in lines[0].tick_positions] if lines else []


def plan(size: tuple[int, int] = (700, 2400)) -> np.ndarray:
    return np.zeros(size, np.uint8)


def tick_stroke(ink: np.ndarray, style: str, x: float, y: float, width: float, length: float = 17.0) -> None:
    if style == "bar":
        stroke(ink, (x, y - length / 2), (x, y + length / 2), width)
    else:
        stroke(ink, *polar((x, y), 45 if style == "slash" else 135, length), width)


@pytest.mark.parametrize("style", ["bar", "slash", "backslash"])
@pytest.mark.parametrize("tick_width", [1, 2, 3])
@pytest.mark.parametrize("line_width", [1, 2, 3])
def test_ink_ticks_found_at_every_phase(style: str, tick_width: int, line_width: int) -> None:
    for phase in PHASES:
        y = phase_y(phase)
        ink = plan()
        stroke(ink, (299, y), (1201, y), line_width)
        for x in TICKS:
            tick_stroke(ink, style, x, y, tick_width)
        found = ink_ticks(ink, y, line_width, phase=phase)
        assert found == pytest.approx(TICKS, abs=3), (style, tick_width, line_width, phase, found)


@pytest.mark.parametrize("stroke_width", [1, 2, 3])
def test_no_false_tick_from_a_long_stroke_at_any_angle(stroke_width: int) -> None:
    angles = [a * 2.5 for a in range(73) if not 80 <= a * 2.5 <= 100]  # 80..100 degrees are ticks by rule
    failures = []
    for phase in PHASES:
        y = phase_y(phase)
        for angle in angles:
            ink = plan()
            stroke(ink, (299, y), (1201, y), 2)
            for x in (300, 1200):
                stroke(ink, (x, y - 8), (x, y + 8), 2)
            stroke(ink, *polar((750, y), angle, 300), stroke_width)
            found = ink_ticks(ink, y, 2, phase=phase)
            if found != pytest.approx([300, 1200], abs=3):
                failures.append((phase, angle, found))
    assert not failures, failures[:10]


def test_perpendicular_stroke_of_any_length_is_a_tick() -> None:
    for phase in PHASES:
        y = phase_y(phase)
        ink = plan()
        stroke(ink, (299, y), (1201, y), 2)
        for x in (300, 1200):
            stroke(ink, (x, y - 8), (x, y + 8), 2)
        stroke(ink, (750, y - 150), (750, y + 150), 2)  # an extension line running through the line
        assert ink_ticks(ink, y, 2, phase=phase) == pytest.approx(TICKS, abs=3), phase


def test_dense_chain_finds_every_tick() -> None:
    region = Rect(0, 0, 5000, 1000)  # L = 5000: ticks every 100 px = 2 % of L, 30 px long (0.006 L)
    expected = list(range(300, 4801, 100))
    for phase in PHASES:
        y = phase_y(phase) + 100
        ink = plan((1000, 5000))
        stroke(ink, (299, y), (4801, y), 2)
        for x in expected:
            stroke(ink, *polar((x, y), 45, 30), 2)
        found = ink_ticks(ink, y, 2, phase=phase, x0=299, x1=4801, region=region)
        assert found == pytest.approx(expected, abs=3), (phase, len(found))


@pytest.mark.parametrize("gap", [25, 40])
def test_stacked_chains_both_find_their_ticks(gap: int) -> None:
    for phase in PHASES:
        inner = phase_y(phase) + 100
        outer = inner - gap
        ink = plan()
        for y in (inner, outer):
            stroke(ink, (299, y), (1501, y), 2)
        xs = [300, 900, 1500]
        for x in xs:
            stroke(ink, (x, inner + 50), (x, outer - 8), 2)  # extension line through the inner chain
            for y in (inner, outer):
                stroke(ink, *polar((x, y), 45, 17), 2)
        offset = JITTER[phase]
        segments = [
            seg("S1", (299, inner + offset), (1501, inner + offset)),
            seg("S2", (299, outer + offset), (1501, outer + offset)),
        ]
        tokens = [tok("T1", "9000", 600, inner - 19), tok("T2", "9000", 600, outer - 19)]
        lines = find_dimension_lines(segments, tokens, REGION, ink=ink)
        assert len(lines) == 2, (gap, phase)
        for line in lines:
            assert [line.p0[0] + t for t in line.tick_positions] == pytest.approx(xs, abs=3), (
                gap,
                phase,
                line.id,
            )


def triangle(ink: np.ndarray, apex: tuple[int, int], length: int, base: int, direction: int, y: int) -> None:
    pts = np.array(
        [
            [apex[0], y],
            [apex[0] + direction * length, y - base // 2],
            [apex[0] + direction * length, y + base // 2],
        ]
    )
    cv2.fillPoly(ink, [pts.astype(np.int32)], 255)


@pytest.mark.parametrize(("length", "base"), [(8, 8), (10, 6), (16, 8)])
@pytest.mark.parametrize("line_width", [2, 3])
def test_solid_arrowheads_are_ticks(length: int, base: int, line_width: int) -> None:
    for phase in PHASES:
        y = phase_y(phase)
        ink = plan()
        stroke(ink, (300, y), (1200, y), line_width)
        triangle(ink, (300, y), length, base, 1, y)  # tips on the extension lines, pointing outwards
        triangle(ink, (1200, y), length, base, -1, y)
        found = ink_ticks(ink, y, line_width, phase=phase, x0=299, x1=1201)
        assert found == pytest.approx([300, 1200], abs=10), (
            length,
            base,
            line_width,
            phase,
            found,
        )  # tip .. base


@pytest.mark.parametrize("diameter", [7, 9, 11, 14])
@pytest.mark.parametrize("line_width", [2, 3])
def test_dots_are_ticks(diameter: int, line_width: int) -> None:
    yy, xx = np.mgrid[0:700, 0:2400]
    for phase in PHASES:
        y = phase_y(phase)
        ink = plan()
        stroke(ink, (299, y), (1201, y), line_width)
        for x in (300, 1200):
            ink[(xx - x) ** 2 + (yy - y) ** 2 <= (diameter / 2) ** 2] = 255
        found = ink_ticks(ink, y, line_width, phase=phase)
        assert found == pytest.approx([300, 1200], abs=3), (diameter, line_width, phase, found)


def test_big_dot_is_not_a_tick() -> None:
    yy, xx = np.mgrid[0:700, 0:2400]
    for phase in PHASES:
        y = phase_y(phase)
        ink = plan()
        stroke(ink, (299, y), (1201, y), 2)
        for x in (300, 1200):
            ink[(xx - x) ** 2 + (yy - y) ** 2 <= 15**2] = 255  # 31 px across: area beyond (0.006 L)^2
        assert ink_ticks(ink, y, 2, phase=phase) == [], phase


def test_thick_wall_crossing_the_line_is_not_a_tick() -> None:
    for phase in PHASES:
        y = phase_y(phase)
        ink = plan()
        stroke(ink, (299, y), (1201, y), 2)
        for x in (300, 1200):
            stroke(ink, (x, y - 8), (x, y + 8), 2)
        stroke(ink, (750, y - 90), (750, y + 90), 12)
        stroke(ink, (900, y - 200), (900, y + 200), 12)
        assert ink_ticks(ink, y, 2, phase=phase) == pytest.approx([300, 1200], abs=3), phase


@pytest.mark.parametrize("overshoot", [0, 2, 4, 8, 12])
def test_ink_extension_lines_overshoot(overshoot: int) -> None:
    for phase in PHASES:
        y = phase_y(phase)
        ink = plan()
        stroke(ink, (299, y), (1201, y), 2)
        for x in (300, 1200):
            stroke(ink, (x, y - 90), (x, y + overshoot), 2)
        assert ink_ticks(ink, y, 2, phase=phase) == pytest.approx([300, 1200], abs=3), (overshoot, phase)


def test_text_glyphs_beside_the_line_are_not_ticks() -> None:
    for phase in PHASES:
        y = phase_y(phase)
        ink = plan()
        stroke(ink, (299, y), (1201, y), 2)
        stroke(ink, (300, y - 8), (300, y + 8), 2)
        stroke(ink, (1200, y - 8), (1200, y + 8), 2)
        for x in range(310, 1190, 22):  # "1" stems, two empty rows above and below the line
            ink[y - 15 : y - 4, x : x + 2] = 255
            ink[y + 5 : y + 16, x + 11 : x + 13] = 255
        assert ink_ticks(ink, y, 2, phase=phase) == pytest.approx([300, 1200], abs=3), phase


def test_diagonal_strokes_need_tick_length_and_must_stay_in_the_band() -> None:
    def ticks(length: float, *, one_sided: bool = False) -> list[int]:
        y = LINE_Y
        ink = plan()
        stroke(ink, (299, y), (1201, y), 2)
        for x in (300, 1200):
            stroke(ink, (x, y - 8), (x, y + 8), 2)
        if one_sided:  # starts on the line and runs off to the upper right
            stroke(ink, (750, y), (750 + length * 0.7071, y - length * 0.7071), 2)
        else:
            stroke(
                ink, *polar((750, y), 45, length), 1 if length < 12 else 2
            )  # thin: a short thick stroke is a blob
        return ink_ticks(ink, y, 2)

    assert ticks(8) == pytest.approx([300, 1200], abs=3)
    assert ticks(17) == pytest.approx(TICKS, abs=3)
    assert ticks(60) == pytest.approx(TICKS, abs=3)
    assert ticks(90) == pytest.approx([300, 1200], abs=3)  # longer than 0.03 L = 72 px
    # 70 px is within the tick length range but runs out of the band (+-42 px): a stroke, not a tick.
    assert ticks(70, one_sided=True) == pytest.approx([300, 1200], abs=3)
    assert ticks(40, one_sided=True) == pytest.approx(TICKS, abs=3)


def test_slash_tick_length_scales_with_the_page() -> None:
    y = LINE_Y
    ink = plan()
    stroke(ink, (299, y), (1201, y), 2)
    for x in (300, 1200):
        stroke(ink, (x, y - 20), (x, y + 20), 2)
    stroke(ink, *polar((750, y), 45, 17), 1)
    assert ink_ticks(ink, y, 2, region=Rect(0, 0, 2400, 700)) == pytest.approx(TICKS, abs=3)  # 12 .. 72 px
    # On a 5000 px page a slash tick is 25 .. 150 px long: 17 px is a speck, the bars are still ticks.
    assert ink_ticks(ink, y, 2, region=Rect(0, 0, 5000, 700)) == pytest.approx([300, 1200], abs=3)


@pytest.mark.parametrize("length", [80, 100, 140])
def test_shallow_crossing_strokes_are_not_ticks(length: int) -> None:
    failures = []
    for angle in (32, 35, 38, 40, 140, 145):
        for stroke_width in (1, 2, 3):
            for phase in PHASES:
                y = phase_y(phase)
                ink = plan()
                stroke(ink, (299, y), (1201, y), 2)
                for x in (300, 1200):
                    stroke(ink, (x, y - 8), (x, y + 8), 2)
                stroke(ink, *polar((750, y), angle, length), stroke_width)
                found = ink_ticks(ink, y, 2, phase=phase)
                if found != pytest.approx([300, 1200], abs=3):
                    failures.append((angle, stroke_width, phase, found))
    assert not failures, failures[:8]


@pytest.mark.parametrize("angle", [35, 40, 140, 145])
def test_real_ticks_at_shallow_angles_are_exact(angle: int) -> None:
    for tick_width in (1, 2, 3):
        for phase in PHASES:
            y = phase_y(phase)
            ink = plan()
            stroke(ink, (299, y), (1201, y), 2)
            for x in TICKS:
                stroke(ink, *polar((x, y), angle, 17), tick_width)
            found = ink_ticks(ink, y, 2, phase=phase)
            assert found == pytest.approx(TICKS, abs=2), (
                angle,
                tick_width,
                phase,
                found,
            )  # a blob would be ~4 off


@pytest.mark.parametrize("angle", [45, 135])
@pytest.mark.parametrize("gap", [25, 40])
def test_stacked_slash_chains_find_each_tick_once(gap: int, angle: int) -> None:
    xs = [300, 900, 1500]
    failures = []
    for line_width, tick_width, ext_width in itertools.product((1, 2, 3), repeat=3):
        for phase in PHASES:
            inner = phase_y(phase) + 100
            outer = inner - gap
            ink = plan()
            for y in (inner, outer):
                stroke(ink, (299, y), (1501, y), line_width)
            for x in xs:
                stroke(ink, (x, inner + 50), (x, outer - 8), ext_width)
                for y in (inner, outer):
                    stroke(ink, *polar((x, y), angle, 17), tick_width)
            offset = JITTER[phase]
            segments = [
                seg("S1", (299, inner + offset), (1501, inner + offset), float(line_width)),
                seg("S2", (299, outer + offset), (1501, outer + offset), float(line_width)),
            ]
            tokens = [tok("T1", "9000", 600, inner - 19), tok("T2", "9000", 600, outer - 19)]
            lines = find_dimension_lines(segments, tokens, REGION, ink=ink)
            got = [[round(line.p0[0] + t) for t in line.tick_positions] for line in lines]
            if len(lines) != 2 or any(g != pytest.approx(xs, abs=3) for g in got):
                failures.append((line_width, tick_width, ext_width, phase, got))
    assert not failures, failures[:8]


ARROWHEADS = [(8, 8), (10, 6), (12, 5), (16, 8)]


@pytest.mark.parametrize(("length", "base"), ARROWHEADS)
@pytest.mark.parametrize("line_width", [2, 3])
def test_arrowhead_with_extension_line_is_one_tick(length: int, base: int, line_width: int) -> None:
    for phase in PHASES:
        y = phase_y(phase)
        ink = plan()
        stroke(ink, (300, y), (1200, y), line_width)
        for x, direction in ((300, 1), (1200, -1)):
            triangle(ink, (x, y), length, base, direction, y)
            stroke(ink, (x, y - 30), (x, y + 30), 2)  # the extension line runs through the tip
        found = ink_ticks(ink, y, line_width, phase=phase, x0=299, x1=1201)
        assert found == pytest.approx([300, 1200], abs=6), (length, base, line_width, phase, found)


@pytest.mark.parametrize("extension_lines", [True, False])
@pytest.mark.parametrize(("length", "base"), ARROWHEADS)
@pytest.mark.parametrize("line_width", [2, 3])
def test_chain_with_arrowheads_at_every_boundary(
    length: int, base: int, line_width: int, extension_lines: bool
) -> None:
    xs = [300, 750, 1200]
    for phase in PHASES:
        y = phase_y(phase)
        ink = plan()
        stroke(ink, (300, y), (1200, y), line_width)
        for i, x in enumerate(xs):
            if i < len(xs) - 1:
                triangle(ink, (x, y), length, base, 1, y)
            if i > 0:
                triangle(ink, (x, y), length, base, -1, y)  # interior heads meet tip to tip
            if extension_lines:
                stroke(ink, (x, y - 30), (x, y + 30), 1)
        found = ink_ticks(ink, y, line_width, phase=phase, x0=299, x1=1201)
        if not extension_lines and base <= line_width + 3:
            continue  # too flat to rise above the line: no mark to find
        assert found == pytest.approx(xs, abs=6), (length, base, line_width, extension_lines, phase, found)


@pytest.mark.parametrize("direction", [1, -1])  # 1: body on the line, tip at its end; -1: body beyond the end
@pytest.mark.parametrize(("length", "base"), [(10, 6), (12, 6), (16, 8), (20, 10)])
@pytest.mark.parametrize("line_width", [2, 3])
def test_arrowhead_tips_are_located_within_6_px(
    length: int, base: int, line_width: int, direction: int
) -> None:
    for phase in PHASES:
        y = phase_y(phase)
        ink = plan()
        stroke(ink, (300, y), (1200, y), line_width)
        triangle(ink, (300, y), length, base, direction, y)
        triangle(ink, (1200, y), length, base, -direction, y)
        found = ink_ticks(ink, y, line_width, phase=phase, x0=299, x1=1201)
        assert found == pytest.approx([300, 1200], abs=6), (length, base, line_width, direction, phase, found)


def _vector_scene(rng: np.random.Generator) -> tuple[Rect, list[Segment], list[TextToken]]:
    region = Rect(0, 0, 2400, 700)
    segments: list[Segment] = []
    tokens: list[TextToken] = []
    for _ in range(int(rng.integers(1, 5))):
        y = float(rng.integers(40, 660))
        x0 = float(rng.integers(0, 600))
        x1 = x0 + float(rng.integers(150, 1700))
        width = float(rng.choice([1.0, 2.0, 3.0, 4.0, 6.0]))
        segments.append(Segment(f"S{len(segments)}", (x0, y), (x1, y), width, True, "vector"))
        for _ in range(int(rng.integers(0, 7))):
            x = float(rng.uniform(x0 - 8, x1 + 8))
            half = float(rng.uniform(3, 30))
            angle = math.radians(float(rng.choice([45, 90, 135, 70, 20, 90])))
            dx, dy = math.cos(angle) * half, math.sin(angle) * half
            tick_width = float(rng.choice([1.0, 2.0, 3.0]))
            segments.append(
                Segment(f"S{len(segments)}", (x - dx, y + dy), (x + dx, y - dy), tick_width, True, "vector")
            )
        if rng.random() < 0.7:
            tokens.append(
                tok(f"T{len(tokens)}", "6000", float(rng.uniform(x0, x1)), y - float(rng.uniform(5, 50)))
            )
    for _ in range(int(rng.integers(0, 6))):
        x, y = float(rng.integers(0, 2300)), float(rng.integers(0, 600))
        end = (x + float(rng.integers(3, 300)), y + float(rng.integers(-40, 40)))
        segments.append(Segment(f"S{len(segments)}", (x, y), end, 2.0, True, "vector"))
    return region, segments, tokens


def test_vector_path_output_is_unchanged() -> None:
    """Without ink, dimension lines, spans and associations are exactly those of the segment-only
    implementation of commit 5512b3c (the digest was taken from that code on these 300 scenes)."""
    rng = np.random.default_rng(20261021)
    digest = hashlib.sha256()
    found = 0
    for _ in range(300):
        region, segments, tokens = _vector_scene(rng)
        lines = find_dimension_lines(segments, tokens, region)
        spans = find_dimension_spans(lines, tokens, region)
        found += len(lines)
        digest.update(repr((lines, spans, associate_dimension_texts(spans, tokens))).encode())
    assert found == 301
    assert digest.hexdigest() == "bb5adcb858b2af6d783ed6c8d82bab1701750d9eb5b5004d7b06f1c58d753b59"


def test_glyph_one_empty_row_from_the_line_is_not_a_tick() -> None:
    for phase in PHASES:
        y = phase_y(phase)
        ink = plan()
        stroke(ink, (299, y), (1201, y), 2)
        for x in (300, 1200):
            stroke(ink, (x, y - 8), (x, y + 8), 2)
        for x in range(310, 1190, 22):  # stems with one empty row between them and the line
            ink[y - 19 : y - 2, x : x + 2] = 255  # tick-sized; one empty row (y - 2)
            ink[y + 3 : y + 20, x + 11 : x + 13] = 255
        assert ink_ticks(ink, y, 2, phase=phase) == pytest.approx([300, 1200], abs=3), phase


SUB_PIXEL = (0.0, 0.17, 0.33, 0.5, 0.67, 0.83)  # fractional line positions, one per phase


@pytest.mark.parametrize("style", ["slash", "backslash"])
@pytest.mark.parametrize("step_x", [600, 750])
@pytest.mark.parametrize("line_width", [2, 3])
def test_slash_ticks_on_a_line_with_a_one_pixel_step(style: str, step_x: int, line_width: int) -> None:
    """The line's rows are found per column: a 1 px step in the line does not hide the ticks of the part
    lying a row lower than the rest."""
    for phase in PHASES:
        y = phase_y(phase)
        ink = plan()
        ink[y : y + line_width, 299:step_x] = 255
        ink[y + 1 : y + 1 + line_width, step_x:1202] = 255
        for x in (300, 1200):
            tick_stroke(ink, style, x, y + (line_width - 1) / 2 + (x > step_x), line_width)
        found = ink_ticks(ink, y + (line_width - 1) / 2 + 0.5, line_width, phase=phase)
        assert found == pytest.approx([300, 1200], abs=3), (style, step_x, line_width, phase, found)


@pytest.mark.parametrize("drift", [0.25, 0.5, 0.75, 1.0, 1.5])
@pytest.mark.parametrize("line_width", [2, 3])
def test_slash_ticks_on_a_line_drifting_against_its_segment(drift: float, line_width: int) -> None:
    """The ink is tilted against the (horizontal) segment by `drift` px over its length."""
    for phase in PHASES:
        y = phase_y(phase) + SUB_PIXEL[phase]
        ink = plan()
        stroke(ink, (299, y - drift / 2), (1201, y + drift / 2), line_width)
        for x in (300, 1200):
            tick_stroke(ink, "slash", x, y + drift * ((x - 299) / 902 - 0.5), line_width)
        line = seg("S1", (299, y), (1201, y), float(line_width))
        lines = find_dimension_lines([line], [tok("T1", "9000", 750, y - 19)], REGION, ink=ink)
        found = [round(lines[0].p0[0] + t) for t in lines[0].tick_positions] if lines else []
        assert found == pytest.approx([300, 1200], abs=6), (drift, line_width, phase, found)


@pytest.mark.parametrize("gap", [8, 16, 28])
def test_end_dot_is_not_absorbed_by_a_mark_beyond_the_end(gap: int) -> None:
    """An extension line past the end of the segment (where the line's ink runs on) is dropped and
    absorbs nothing: the dot at the end stays a tick."""
    yy, xx = np.mgrid[0:700, 0:2400]
    for phase in PHASES:
        y = phase_y(phase)
        ink = plan()
        stroke(ink, (299, y), (1300, y), 2)
        for x in (300, 750):
            stroke(ink, (x, y - 8), (x, y + 8), 2)
        ink[(xx - 1200) ** 2 + (yy - y) ** 2 <= 16] = 255
        stroke(ink, (1200 + gap, y - 60), (1200 + gap, y + 60), 1)
        line = seg("S1", (299, y + JITTER[phase]), (1201, y + JITTER[phase]))
        tokens = [tok("T1", "6000", 525, y - 19), tok("T2", "6000", 975, y - 19)]
        lines = find_dimension_lines([line], tokens, REGION, ink=ink)
        found = [round(lines[0].p0[0] + t) for t in lines[0].tick_positions] if lines else []
        assert found == pytest.approx(TICKS, abs=4), (gap, phase, found)


@pytest.mark.parametrize(("length", "base"), [(10, 6), (12, 6)])
@pytest.mark.parametrize("line_width", [2, 3])
def test_arrowheads_off_the_line_axis_by_a_fraction_of_a_pixel(
    length: int, base: int, line_width: int
) -> None:
    """The heads are drawn on whole rows and the line up to 0.8 px off their axis: they are found, tip
    within 6 px, at every offset."""
    for phase, offset in zip(PHASES, (0.0, 0.3, 0.5, -0.3, 0.8, -0.5), strict=True):
        y = phase_y(phase)
        ink = plan()
        stroke(ink, (299, y + offset), (1201, y + offset), line_width)
        triangle(ink, (300, y), length, base, 1, y)
        triangle(ink, (1200, y), length, base, -1, y)
        line = seg("S1", (299, y + offset), (1201, y + offset), float(line_width))
        lines = find_dimension_lines([line], [tok("T1", "9000", 750, y - 19)], REGION, ink=ink)
        found = [round(lines[0].p0[0] + t) for t in lines[0].tick_positions] if lines else []
        assert found == pytest.approx([300, 1200], abs=6), (length, base, line_width, offset, found)


@pytest.mark.parametrize("line_width", [1, 2, 3])
def test_lone_glyph_stems_one_empty_row_from_the_line_are_not_ticks(line_width: int) -> None:
    """Stems on one side only (no partner below to pair with), one empty row from the line's own ink."""
    for phase in PHASES:
        y = phase_y(phase) + SUB_PIXEL[phase]
        ink = plan()
        stroke(ink, (299, y), (1201, y), line_width)
        for x in (300, 1200):
            stroke(ink, (x, y - 8), (x, y + 8), line_width)
        rows = np.flatnonzero(ink[:, 700])
        for i, x in enumerate(range(330, 1180, 60)):
            if i % 2:
                ink[rows[-1] + 2 : rows[-1] + 19, x : x + 2] = 255
            else:
                ink[rows[0] - 18 : rows[0] - 1, x : x + 2] = 255
        line = seg("S1", (299, y), (1201, y), float(line_width))
        lines = find_dimension_lines([line], [tok("T1", "9000", 750, y - 30)], REGION, ink=ink)
        found = [round(lines[0].p0[0] + t) for t in lines[0].tick_positions] if lines else []
        assert found == pytest.approx([300, 1200], abs=3), (line_width, phase, found)


def _rotated(centre: tuple[float, float], point: tuple[float, float], angle: float) -> tuple[float, float]:
    c, s = math.cos(angle), math.sin(angle)
    dx, dy = point[0] - centre[0], point[1] - centre[1]
    return centre[0] + dx * c - dy * s, centre[1] + dx * s + dy * c


@pytest.mark.parametrize("degrees", [3, 20])
def test_bar_ticks_at_the_ends_of_a_thin_tilted_line(degrees: int) -> None:
    """A 1.5 px line at a small angle resamples into short runs on alternating rows: where they are too
    short to clear, a bar tick and the stub of line it sits on form one component straddling the line.
    That is no half of a stroke; the bar is found by the blob rule."""
    rng = np.random.default_rng(1)
    angle = math.radians(degrees)
    for trial in range(10):
        centre = (800 + rng.uniform(-1, 1), 800 + rng.uniform(-1, 1))
        ink = np.zeros((1600, 1600), np.uint8)
        a, b = _rotated(centre, (400, 800), angle), _rotated(centre, (1200, 800), angle)
        stroke(ink, a, b, 1.5)
        ends = [_rotated(centre, (401, 800), angle), _rotated(centre, (1199, 800), angle)]
        for t in ends:
            stroke(ink, _rotated(t, (t[0], t[1] - 8), angle), _rotated(t, (t[0], t[1] + 8), angle), 1.5)
        nx, ny = -math.sin(angle), math.cos(angle)
        e0, e1 = rng.uniform(-0.5, 0.5), rng.uniform(-0.5, 0.5)
        p0, p1 = (a[0] + nx * e0, a[1] + ny * e0), (b[0] + nx * e1, b[1] + ny * e1)
        middle = ((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2)
        lines = find_dimension_lines(
            [seg("S1", p0, p1, 1.5)],
            [tok("T1", "9000", middle[0], middle[1] - 19)],
            Rect(0, 0, 2400, 700),
            ink=ink,
        )
        found = sorted(lines[0].tick_positions) if lines else []
        expected = [math.dist(p0, t) for t in ends]
        assert found == pytest.approx(expected, abs=5), (degrees, trial, found, expected)


def test_dashed_line_gives_no_misplaced_ticks() -> None:
    """Dashes (40 px) shorter than 0.03 L leave no solid line to clear. The line's rows are then a guess
    without a margin: a bar and the dash it sits on straddle them, are no half of a stroke, and the dash is
    not read as the taper of an arrowhead (which put ticks 40 px inside the ends)."""
    for phase in PHASES:
        y = phase_y(phase) + SUB_PIXEL[phase]
        ink = plan()
        for x in range(299, 1201, 48):
            stroke(ink, (x, y), (min(x + 40, 1201), y), 2)
        for x in (300, 1200):
            stroke(ink, (x, y - 8), (x, y + 8), 2)
        found = ink_ticks(ink, y, 2, phase=phase)
        assert found in ([], pytest.approx([300, 1200], abs=3)), (phase, found)


def test_span_association_tie_uses_list_position_not_id_strings() -> None:
    token = tok("T1", "4000", 500, LINE_Y - 19)
    spans = [
        dimmod.DimensionSpan(
            f"D{n}", (200.0, LINE_Y + 10 * n), (800.0, LINE_Y + 10 * n), "x", "chain_segment", ["T1"], f"L{n}"
        )
        for n in range(2, 13)  # D2 .. D12: identical midpoint and length; "D10" sorts before "D2" as a string
    ]
    assert associate_dimension_texts(spans, [token]) == {"T1": "D2"}


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
    ink = plan()
    stroke(ink, (299, LINE_Y), (1201, LINE_Y), 2)
    with pytest.raises(_StopError):
        find_dimension_lines(
            [seg("S1", (299, LINE_Y), (1201, LINE_Y))],
            [tok("T1", "9000", 750, LINE_Y - 19)],
            REGION,
            ink=ink,
            check_deadline=stop,
        )


def test_many_long_segments_stay_fast() -> None:
    rng = np.random.default_rng(7)
    size = (6000, 4000)
    region = Rect(0, 0, *size)  # L = 6000: ticks 30 ... 180 px
    ink = np.zeros((size[1], size[0]), np.uint8)
    segments: list[Segment] = []
    for n in range(3000):  # long thin strokes everywhere, some of them on top of each other
        x, y = int(rng.integers(0, 5000)), int(rng.integers(0, 3950))
        length = int(rng.integers(300, 900))
        segments.append(seg(f"S{n}", (x, y), (x + length, y)))
        ink[y - 1 : y + 2, x : x + length] = 255
    for n in range(40):  # dimension chains with slash ticks
        y = 60 + 90 * n
        segments += [
            seg(f"C{n}", (299, y), (1501, y)),
            slash(f"A{n}", 300, y, 15),
            slash(f"B{n}", 1500, y, 15),
        ]
        ink[y - 1 : y + 2, 299:1502] = 255
        for x in (300, 1500):
            ink[y - 15 : y + 16, x - 1 : x + 2] = 255
    tokens = [
        tok(f"T{n}", "6000", int(rng.integers(0, 6000)), int(rng.integers(0, 4000))) for n in range(400)
    ]
    tokens += [tok(f"U{n}", "6000", 900, 60 + 90 * n - 19) for n in range(40)]
    started = time.perf_counter()
    lines = find_dimension_lines(segments, tokens, region, ink=ink)
    assert time.perf_counter() - started < 15.0  # guards pathological cost, not a budget (~4 s typical)
    assert len(lines) >= 40


def test_specks_on_the_line_are_not_ticks() -> None:
    for phase in PHASES:
        y = phase_y(phase)
        ink = plan()
        stroke(ink, (299, y), (1201, y), 2)
        for x in (300, 1200):
            stroke(ink, (x, y - 8), (x, y + 8), 2)
        for x in (500, 700, 900):  # scan noise: one or two pixels stuck to the line
            ink[y - 3, x] = 255
            ink[y + 3, x + 1] = ink[y + 4, x + 1] = 255
        assert ink_ticks(ink, y, 2, phase=phase) == pytest.approx([300, 1200], abs=3), phase


def test_ticks_beyond_the_ends_of_the_segment_are_dropped() -> None:
    y = LINE_Y
    ink = plan()
    stroke(ink, (260, y), (900, y), 2)  # the ink line runs 40 px past the segment, with a bar at its end
    for x in (260, 900):
        stroke(ink, (x, y - 8), (x, y + 8), 2)
    assert ink_ticks(ink, y, 2, x0=300, x1=900) == []  # one tick left: no dimension line
    stroke(ink, (280, y - 8), (280, y + 8), 2)
    assert ink_ticks(ink, y, 2, x0=300, x1=900) == []  # 20 px beyond: still outside
    stroke(ink, (296, y - 8), (296, y + 8), 2)
    assert ink_ticks(ink, y, 2, x0=300, x1=900) == pytest.approx([296, 900], abs=3)


# --- raster candidates and filters (Task 14b) ------------------------------------------------------------


def gray_of(ink: np.ndarray, faint: np.ndarray | None = None) -> np.ndarray:
    """A page gray image: paper 250, `ink` 40, `faint` 215 (a light line the ink threshold misses)."""
    gray = np.full(ink.shape, 250, np.uint8)
    if faint is not None:
        gray[faint > 0] = 215
    gray[ink > 0] = 40
    return gray


def raster_ticks(
    segments: list[Segment],
    tokens: list[TextToken],
    ink: np.ndarray,
    gray: np.ndarray | None = None,
) -> list[list[int]]:
    """Absolute ticks (x for horizontal lines, y for vertical ones) of each raster dimension line."""
    lines = find_dimension_lines(segments, tokens, REGION, ink=ink, gray=gray, t_thin=2.0)
    out = []
    for ln in lines:
        vertical = abs(ln.p1[1] - ln.p0[1]) > abs(ln.p1[0] - ln.p0[0])
        u = (np.array(ln.p1) - np.array(ln.p0)) / math.dist(ln.p0, ln.p1)
        out.append([round(float((np.array(ln.p0) + u * t)[1 if vertical else 0])) for t in ln.tick_positions])
    return out


def slashed_line(ink: np.ndarray, x0: int, x1: int, ticks: list[int], y: int = LINE_Y) -> None:
    stroke(ink, (x0, y), (x1, y), 2)
    for x in ticks:
        stroke(ink, *polar((x, y), 45, 17), 2)


def test_line_cut_under_its_label_is_one_line() -> None:
    """LSD loses the line under its label (the text mask): the two pieces are chained across the label's
    box into one line with all its ticks."""
    ink = plan()
    slashed_line(ink, 299, 1201, TICKS)
    label = tok("T1", "9000", 525, LINE_Y - 4)  # written across the line, which the text mask cut
    x0, y0, x1, y1 = (round(v) for v in label.box)
    ink[y0 - 2 : y1 + 3, x0 - 2 : x1 + 3] = 0
    pieces = [seg("S1", (299, LINE_Y), (x0 - 3, LINE_Y)), seg("S2", (x1 + 3, LINE_Y), (1201, LINE_Y))]
    assert raster_ticks(pieces, [label], ink) == [pytest.approx(TICKS, abs=3)]


def test_faint_line_is_chained_through_its_gaps_by_the_gray_image() -> None:
    """A light line the ink threshold broke up between its ticks: the gray image shows it running on, so its
    pieces are one line; without the gray image they stay apart."""
    ink, faint = plan(), plan()
    stroke(faint, (299, LINE_Y), (1201, LINE_Y), 2)
    kept = ((299, 450), (560, 820), (930, 1201))  # the parts the ink kept: gaps of 110 px < 0.06 L
    for a, b in kept:
        stroke(ink, (a, LINE_Y), (b, LINE_Y), 2)
    for x in TICKS:
        stroke(ink, *polar((x, LINE_Y), 45, 17), 2)
    pieces = [seg(f"S{k}", (a, LINE_Y), (b, LINE_Y)) for k, (a, b) in enumerate(kept)]
    labels = [tok("T1", "9000", 525, LINE_Y - 19), tok("T2", "9000", 975, LINE_Y - 19)]
    assert raster_ticks(pieces, labels, ink, gray_of(ink, faint)) == [pytest.approx(TICKS, abs=3)]
    assert raster_ticks(pieces, labels, ink) == []


def test_pieces_drawn_with_another_pen_are_not_chained() -> None:
    """A light face line running on from a dimension line's end is not part of it."""
    ink, faint = plan(), plan()
    slashed_line(ink, 640, 1201, [650, 1200])
    stroke(faint, (380, LINE_Y), (636, LINE_Y), 2)
    stroke(ink, (380, LINE_Y), (636, LINE_Y), 2)  # in the ink too: only the gray image tells them apart
    gray = gray_of(ink)
    gray[faint > 0] = 200
    pieces = [seg("S1", (380, LINE_Y), (636, LINE_Y)), seg("S2", (640, LINE_Y), (1201, LINE_Y))]
    lines = find_dimension_lines(pieces, [tok("T1", "9000", 925, LINE_Y - 19)], REGION, ink=ink, gray=gray)
    assert len(lines) == 1
    assert min(lines[0].p0[0], lines[0].p1[0]) == pytest.approx(640, abs=3)


def test_line_runs_on_under_a_label_to_its_end_tick() -> None:
    """The line's last piece is lost under a label written on it near the end; the chain runs on along the
    gray image to the end tick."""
    ink = plan()
    slashed_line(ink, 299, 1201, TICKS)
    label = tok("T1", "900", 1150, LINE_Y - 4)
    x0, y0, x1, y1 = (round(v) for v in label.box)
    gray = gray_of(ink)
    ink[y0 - 2 : y1 + 3, x0 - 2 : x1 + 3] = 0
    pieces = [seg("S1", (299, LINE_Y), (x0 - 3, LINE_Y))]
    assert raster_ticks(pieces, [label, tok("T2", "9000", 525, LINE_Y - 19)], ink, gray) == [
        pytest.approx(TICKS, abs=3)
    ]


def face_scene(partner_gap: int) -> tuple[np.ndarray, list[Segment]]:
    """A face line at LINE_Y with partitions meeting it from below (perpendicular "ticks" at 300 / 1200)
    and a parallel line `partner_gap` px below it (0: none)."""
    ink = plan()
    stroke(ink, (299, LINE_Y), (1201, LINE_Y), 2)
    segments = [seg("S1", (299, LINE_Y), (1201, LINE_Y))]
    for x in (300, 1200):
        stroke(ink, (x, LINE_Y), (x, LINE_Y + 150), 2)
        segments.append(seg(f"S{x}", (x, LINE_Y), (x, LINE_Y + 150)))
    if partner_gap:
        stroke(ink, (310, LINE_Y + partner_gap), (1190, LINE_Y + partner_gap), 2)
        segments.append(seg("S9", (310, LINE_Y + partner_gap), (1190, LINE_Y + partner_gap)))
    return ink, segments


def test_line_paired_like_a_wall_face_is_no_dimension_line() -> None:
    """A partition face (its partner face 12 px away, the strip between them empty) with partitions meeting
    it and a label nearby is no dimension line; alone it would be one."""
    label = [tok("T1", "9000", 750, LINE_Y - 19)]
    ink, segments = face_scene(0)
    assert len(raster_ticks(segments, label, ink)) == 1
    ink, segments = face_scene(12)
    assert raster_ticks(segments, label, ink) == []


def test_label_between_two_lines_keeps_the_dimension_line() -> None:
    """Text in the strip between two parallel lines: that strip is no wall, the line is a dimension line."""
    ink, segments = face_scene(40)
    label = [tok("T1", "9000", 750, LINE_Y + 20)]
    found = find_dimension_lines(segments, label, REGION, ink=ink, t_thin=2.0)
    assert any(abs(ln.p0[1] - LINE_Y) < 2 for ln in found)


def test_dimension_line_beside_a_partition_stays_one() -> None:
    """A dimension line drawn 18 px beside a double-line partition: the partition's near face pairs with its
    own other face (6 px on), so the dimension line is no face."""
    ink, segments = face_scene(18)
    stroke(ink, (310, LINE_Y + 24), (1190, LINE_Y + 24), 2)
    segments.append(seg("S10", (310, LINE_Y + 24), (1190, LINE_Y + 24)))
    label = [tok("T1", "9000", 750, LINE_Y - 19)]
    assert len(raster_ticks(segments, label, ink)) == 1


def test_label_must_be_written_along_a_raster_line() -> None:
    """Raster pages: a label written across the line (angle 90 beside an x line) does not make it a
    dimension line (06 §8.4 step 3's orientation rule applied in step 1)."""
    ink = plan()
    slashed_line(ink, 299, 1201, TICKS)
    line = [seg("S1", (299, LINE_Y), (1201, LINE_Y))]
    assert len(raster_ticks(line, [tok("T1", "9000", 525, LINE_Y - 19)], ink)) == 1
    assert raster_ticks(line, [tok("T1", "9000", 525, LINE_Y - 19, angle=90)], ink) == []


def test_line_below_a_chain_does_not_borrow_its_label() -> None:
    """A line 30 px below a dimension chain, crossed by the chain's extension lines, with the chain's label
    in reach: the label stands on the chain, the line owns no label and is no dimension line."""
    ink = plan()
    slashed_line(ink, 299, 1201, TICKS)
    stroke(ink, (299, LINE_Y + 30), (1201, LINE_Y + 30), 2)
    for x in TICKS:
        stroke(ink, (x, LINE_Y - 8), (x, LINE_Y + 150), 2)  # extension lines from the plan below
    segments = [seg("S1", (299, LINE_Y), (1201, LINE_Y)), seg("S2", (299, LINE_Y + 30), (1201, LINE_Y + 30))]
    found = find_dimension_lines(segments, [tok("T1", "9000", 525, LINE_Y - 19)], REGION, ink=ink, t_thin=2.0)
    assert [round(ln.p0[1]) for ln in found] == [LINE_Y]


def test_through_strokes_are_no_ticks_on_a_slash_ticked_line() -> None:
    """A line drawn with slash ticks takes a door jamb running through it as no tick; the same jamb on a
    line with bare extension-line ticks is one (fix2: a perpendicular stroke of any length is a tick)."""
    ink = plan()
    slashed_line(ink, 299, 1201, TICKS)
    stroke(ink, (500, LINE_Y - 150), (500, LINE_Y + 150), 2)
    line = [seg("S1", (299, LINE_Y), (1201, LINE_Y))]
    label = [tok("T1", "9000", 650, LINE_Y - 19)]
    assert raster_ticks(line, label, ink) == [pytest.approx(TICKS, abs=3)]
    bare = plan()
    stroke(bare, (299, LINE_Y), (1201, LINE_Y), 2)
    for x in (*TICKS, 500):
        stroke(bare, (x, LINE_Y - 150), (x, LINE_Y + 150), 2)
    assert raster_ticks(line, label, bare) == [pytest.approx([300, 500, 750, 1200], abs=3)]


def test_dimension_line_ending_across_another_is_no_tick_of_it() -> None:
    """A vertical dimension line ends 6 px past a horizontal one: no tick of the horizontal line there."""
    ink = plan()
    slashed_line(ink, 299, 1201, [300, 1200])
    stroke(ink, (750, 100), (750, LINE_Y + 6), 2)
    for y in (110, 250):
        stroke(ink, *polar((750, y), 45, 17), 2)
    segments = [seg("S1", (299, LINE_Y), (1201, LINE_Y)), seg("S2", (750, 100), (750, LINE_Y + 6))]
    labels = [tok("T1", "9000", 525, LINE_Y - 19), tok("T2", "9000", 731, 180, angle=90)]
    found = sorted(raster_ticks(segments, labels, ink), key=len)
    assert found == [pytest.approx([110, 250], abs=3), pytest.approx([300, 1200], abs=3)]


def test_wall_at_the_line_end_is_a_tick_and_one_crossing_it_is_not() -> None:
    """A line dimensioned to the face of a solid wall: the face is a tick. A wall the line runs through is
    no tick."""
    ink = plan()
    slashed_line(ink, 300, 1201, [750, 1200])
    ink[LINE_Y - 100 : LINE_Y + 100, 280:300] = 255  # the line starts at this wall's face
    ink[LINE_Y - 100 : LINE_Y + 100, 900:920] = 255  # ... and runs through this one
    line = [seg("S1", (300, LINE_Y), (1201, LINE_Y))]
    assert raster_ticks(line, [tok("T1", "9000", 525, LINE_Y - 19)], ink) == [pytest.approx(TICKS, abs=3)]


def test_chain_is_not_bridged_across_a_solid_wall() -> None:
    """A chain interrupted by a solid wall is two dimension lines, each ending at the wall's face."""
    ink = plan()
    slashed_line(ink, 299, 600, [300])
    slashed_line(ink, 640, 1201, [1200])
    ink[LINE_Y - 100 : LINE_Y + 100, 600:640] = 255
    pieces = [seg("S1", (299, LINE_Y), (600, LINE_Y)), seg("S2", (640, LINE_Y), (1201, LINE_Y))]
    labels = [tok("T1", "3000", 450, LINE_Y - 19), tok("T2", "6000", 920, LINE_Y - 19)]
    found = sorted(raster_ticks(pieces, labels, ink, gray_of(ink)))
    assert found == [pytest.approx([300, 600], abs=3), pytest.approx([640, 1200], abs=3)]


def test_slashes_on_extension_lines_running_through_mark_the_line() -> None:
    """Slash ticks drawn on extension lines that run through the line (one stroke each) still mark it as a
    slash-ticked line, so a bare door jamb running through it is no tick."""
    ink = plan()
    stroke(ink, (299, LINE_Y), (1201, LINE_Y), 2)
    for x in TICKS:
        stroke(ink, (x, LINE_Y - 150), (x, LINE_Y + 150), 2)
        stroke(ink, *polar((x, LINE_Y), 45, 17), 2)
    stroke(ink, (500, LINE_Y - 150), (500, LINE_Y + 150), 2)
    line = [seg("S1", (299, LINE_Y), (1201, LINE_Y))]
    assert raster_ticks(line, [tok("T1", "9000", 650, LINE_Y - 19)], ink) == [pytest.approx(TICKS, abs=3)]


def test_single_character_token_on_a_tick_does_not_erase_it() -> None:
    """Ruling C5a: OCR reading a slash tick as "1" (one character, kind `other`) leaves it out of the text
    mask, so the tick stays in `ink_notext`; a multi-character token there is still masked."""
    from app.pipeline.ocr_stage import text_mask

    ink = plan()
    slashed_line(ink, 299, 1201, TICKS)
    label = tok("T1", "9000", 525, LINE_Y - 19)
    line = [seg("S1", (299, LINE_Y), (1201, LINE_Y))]
    for text, expected in (("1", TICKS), ("11", [300, 750])):
        misread = tok("T2", text, 1200, LINE_Y, height=18.0)  # over the end tick
        notext = ink.copy()
        notext[text_mask(ink.shape, [label, misread]) > 0] = 0
        assert raster_ticks(line, [label, misread], notext) == [pytest.approx(expected, abs=3)], text


# --- label ownership on either side of the line (Task 14b fix round 1, review I1) -----------------------


def test_label_below_a_chain_is_not_taken_by_a_crossed_line_below_it() -> None:
    """Labels written below a chain, a line 30 px under it crossed by short bars: the label is as near to
    both; the chain, whose ticks carry slashes, owns it, and the crossed line is no dimension line."""
    for phase in PHASES:
        y = phase_y(phase)
        ink = plan()
        slashed_line(ink, 299, 1201, TICKS, y)
        stroke(ink, (299, y + 30), (1201, y + 30), 2)
        for x in TICKS:
            stroke(ink, (x, y - 150), (x, y + 8), 2)  # extension lines from a plan above
            stroke(ink, (x, y + 22), (x, y + 38), 2)  # bars crossing the lower line
        off = JITTER[phase]
        segments = [
            seg("S1", (299, y + off), (1201, y + off)),
            seg("S2", (299, y + 30 + off), (1201, y + 30 + off)),
        ]
        label = [tok("T1", "9000", 525, y + 15, height=16)]
        found = find_dimension_lines(segments, label, REGION, ink=ink, t_thin=2.0)
        assert [round(ln.p0[1] - off) for ln in found] == [y], phase


def stacked_chain_case(gap: int, phase: int, below: bool, vertical: bool) -> tuple[list[float], list[float]]:
    """Two stacked slash-ticked chains `gap` px apart with extension lines from the plan running through the
    inner one to 8 px past the outer one; two labels on the inner chain's intervals and one on the outer
    chain, written on the side `below` (right of a vertical line) or above (left). Returns the expected and
    found line offsets across (y of horizontal lines, x of vertical ones)."""
    base = 600 + phase if vertical else phase_y(phase)
    sign = 1 if below else -1  # the outer chain lies on the labels' side: away from the plan
    inner, outer = base, base + sign * gap
    plan_side = inner - sign * 50
    size = (1600, 1600) if vertical else (700, 2400)
    ink = plan(size)
    along = [200, 700, 1200] if vertical else [300, 900, 1500]
    lo, hi = along[0] - 1, along[-1] + 1

    def pt(a: float, c: float) -> tuple[float, float]:
        return (c, a) if vertical else (a, c)

    for c in (inner, outer):
        stroke(ink, pt(lo, c), pt(hi, c), 2)
    for a in along:
        stroke(ink, pt(a, plan_side), pt(a, outer + sign * 8), 2)
        for c in (inner, outer):
            stroke(ink, *polar(pt(a, c), 45, 17), 2)
    off = JITTER[phase]
    segments = [
        seg("S1", pt(lo, inner + off), pt(hi, inner + off)),
        seg("S2", pt(lo, outer + off), pt(hi, outer + off)),
    ]
    angle = 90 if vertical else 0
    mid = [(along[0] + along[1]) / 2, (along[1] + along[2]) / 2]
    tokens = [
        tok("T1", "6000", *pt(mid[0], inner + sign * 14), height=16, angle=angle),
        tok("T2", "6000", *pt(mid[1], inner + sign * 14), height=16, angle=angle),
        tok("T3", "12000", *pt(along[1], outer + sign * 14), height=16, angle=angle),
    ]
    region = Rect(0, 0, size[1], size[0])
    lines = find_dimension_lines(segments, tokens, region, ink=ink, t_thin=2.0)
    found = sorted(round((ln.p0[0] if vertical else ln.p0[1]) - off) for ln in lines)
    return sorted([inner, outer]), found


@pytest.mark.parametrize("gap", [30, 40, 50])
@pytest.mark.parametrize("below", [True, False])
def test_stacked_horizontal_chains_keep_their_labels_on_either_side(gap: int, below: bool) -> None:
    """Review I1 (c1c and its control c1d): labels below (or above) each of two stacked chains; both chains
    are dimension lines whichever side the text stands on."""
    for phase in PHASES:
        expected, found = stacked_chain_case(gap, phase, below, vertical=False)
        assert found == expected, (gap, below, phase, found)


@pytest.mark.parametrize("gap", [30, 40, 50])
@pytest.mark.parametrize("right", [True, False])
def test_stacked_vertical_chains_keep_their_labels_on_either_side(gap: int, right: bool) -> None:
    """Review I1 (c2b and its control c2c): text reading upwards right (or left) of each of two stacked
    vertical chains."""
    for phase in PHASES:
        expected, found = stacked_chain_case(gap, phase, right, vertical=True)
        assert found == expected, (gap, right, phase, found)


# --- tick accuracy (Task 14b fix round 1, review M1) ------------------------------------------------------


def test_slash_of_a_chain_is_no_tick_of_an_extension_line_crossing_it() -> None:
    """A dimension line crossing a chain at one of the chain's slashes does not keep that slash as its own
    tick; the chain keeps it, and a slashed crossing where the other line has no tick stays (controls)."""
    chain = (seg("C", (0, 100), (600, 100)), [(0.0, True), (200.0, True), (400.0, True), (600.0, True)])
    across = (seg("X", (200, 60), (200, 300)), [(40.0, True), (240.0, True)])  # crosses at the chain's 200
    beside = (seg("Y", (300, 60), (300, 300)), [(40.0, True), (240.0, True)])  # crosses between the slashes
    kept = dict((line.id, ticks) for line, ticks in dimmod._drop_crossings([chain, across, beside]))
    assert kept["X"] == [(240.0, True)]
    assert kept["C"] == chain[1]
    assert kept["Y"] == beside[1]


def test_door_jamb_pair_is_no_tick_of_a_slash_ticked_line() -> None:
    """Two bare strokes 6 px apart (a door jamb's faces) crossing a slash-ticked line are no ticks."""
    for phase in PHASES:
        y = phase_y(phase)
        ink = plan()
        slashed_line(ink, 299, 1201, TICKS, y)
        for x in (500, 506):
            stroke(ink, (x, y - 150), (x, y + 20), 2)
        line = [seg("S1", (299, y + JITTER[phase]), (1201, y + JITTER[phase]))]
        assert raster_ticks(line, [tok("T1", "9000", 650, y - 19)], ink) == [pytest.approx(TICKS, abs=3)], (
            phase
        )


def test_bare_stroke_just_past_the_end_mark_is_no_tick() -> None:
    """A slash-ticked line running on 14 px past its end tick into a face line: the face is no tick."""
    for phase in PHASES:
        y = phase_y(phase)
        ink = plan()
        slashed_line(ink, 299, 1215, TICKS, y)
        stroke(ink, (1214, y - 150), (1214, y + 3), 2)  # the face line it runs into, from the plan side
        line = [seg("S1", (299, y + JITTER[phase]), (1215, y + JITTER[phase]))]
        assert raster_ticks(line, [tok("T1", "9000", 525, y - 19)], ink) == [pytest.approx(TICKS, abs=3)], (
            phase
        )


def test_faint_end_runs_on_to_its_extension_line() -> None:
    """A line fading out before its first extension line (the ink and the segment stop 30 px short; the gray
    image shows it, too light for the same pen): it still reaches that tick."""
    ink, faint = plan(), plan()
    slashed_line(ink, 330, 1201, [750, 1200])
    stroke(ink, (300, LINE_Y - 150), (300, LINE_Y + 8), 2)  # the extension line, with its slash
    stroke(ink, *polar((300, LINE_Y), 45, 17), 2)
    stroke(faint, (299, LINE_Y), (330, LINE_Y), 2)
    gray = gray_of(ink)
    gray[(faint > 0) & (ink == 0)] = 232
    line = [seg("S1", (330, LINE_Y), (1201, LINE_Y))]
    assert raster_ticks(line, [tok("T1", "9000", 525, LINE_Y - 19)], ink, gray) == [
        pytest.approx(TICKS, abs=3)
    ]


def test_overall_label_goes_to_its_own_line_not_a_chain_of_the_same_extent() -> None:
    """06 §8.4 step 5 with Task 14b's tie: an overall line 40 px below a chain of the same extent; the
    overall label (under it), beside both, goes to the overall line's span (it is a text height nearer),
    not to the chain's overall span, which comes first in id order."""
    chain = chain_segments(TICK_X)
    overall = [
        seg("S9", (TICK_X[0] - 1.0, LINE_Y + 40), (TICK_X[-1] + 1.0, LINE_Y + 40)),
        slash("S10", TICK_X[0], LINE_Y + 40),
        slash("S11", TICK_X[-1], LINE_Y + 40),
    ]
    tokens = [*labels_over(TICK_X, ["9000", "9000"]), tok("T9", "18000", 1150, LINE_Y + 52)]
    lines = find_dimension_lines([*chain, *overall], tokens, REGION)
    spans = find_dimension_spans(lines, tokens, REGION)
    assert sum("T9" in s.near_text_ids for s in spans if s.kind == "overall") == 2  # both overall spans
    owner = {s.id: s for s in spans}[associate_dimension_texts(spans, tokens)["T9"]]
    assert owner.p0[1] == pytest.approx(LINE_Y + 40) and owner.kind == "overall"
