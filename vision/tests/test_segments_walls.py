"""Wall extraction (06 §8.1 steps 1-8) into raw walls, the wall graph and gap candidates."""

import ast
import dataclasses
import itertools
import math
import time
from pathlib import Path

import cv2
import numpy as np
import pytest

from app.api.errors import VisionError
from app.pipeline import walls as wallmod
from app.pipeline.binarize import Preprocessed, preprocess
from app.pipeline.dimensions import find_dimension_lines
from app.pipeline.normalize import NormalizedPage
from app.pipeline.ocr_stage import OcrResult
from app.pipeline.pdf import VectorPage, VPolygon, VSeg
from app.pipeline.segments import detect_segments
from app.pipeline.textparse import parse_token
from app.pipeline.walls import (
    WallExtraction,
    debug_walls_png,
    extract_walls,
    walls_to_graph,
)
from app.schemas.candidates import DimensionLine, RawWall, Segment, TextToken, WallCandidate, WallGraph
from app.utils.geometry import Rect
from tests.support.synth import SDimChain, SDoor, SGap, SWall, render_plan
from tests.test_normalize import make_ctx
from tests.test_preprocess import page_of

SIZE = (2400, 1800)
CORNERS = [(300, 300), (2100, 300), (2100, 1500), (300, 1500)]
PARTITION = 4  # index of the partition in `plan()`


def plan(style: str = "filled", t: int = 14) -> list[SWall]:
    """The brief's plan: a 1800 x 1200 rectangle with a partition at x = 1200 (7 walls, 6 nodes)."""
    walls = [SWall(CORNERS[i], CORNERS[(i + 1) % 4], t, style=style) for i in range(4)]  # type: ignore[arg-type]
    return [*walls, SWall((1200, 300), (1200, 1500), t, style=style)]  # type: ignore[arg-type]


@dataclasses.dataclass
class Run:
    page: NormalizedPage
    pre: Preprocessed
    segments: list[Segment]
    ext: WallExtraction
    graph: WallGraph


def run(
    img: np.ndarray,
    *,
    tokens: list[TextToken] | None = None,
    page: NormalizedPage | None = None,
    t_thin: float | None = None,
    use_dimensions: bool = True,
) -> Run:
    """The pipeline up to the wall graph on a synthetic render (tokens stand in for OCR)."""
    page = page or page_of(img)
    pre = preprocess(page, make_ctx())
    if t_thin is not None:
        pre = dataclasses.replace(pre, t_thin=t_thin)
    tokens = tokens or []
    mask = np.zeros(pre.ink.shape, np.uint8)
    for tk in tokens:
        x0, y0, x1, y1 = (round(v) for v in tk.box)
        mask[max(0, y0 - 2) : y1 + 3, max(0, x0 - 2) : x1 + 3] = 255
    ink_notext = pre.ink.copy()
    ink_notext[mask > 0] = 0
    ocr = OcrResult(tokens=tokens, text_mask=mask, ink_notext=ink_notext)
    segments = detect_segments(page, pre, ocr, make_ctx())
    dims = find_dimension_lines(segments, tokens, pre.region, ink=ink_notext) if use_dimensions else []
    ext = extract_walls(page, pre, segments, dims, make_ctx(), ink=ink_notext, tokens=tokens)
    return Run(page, pre, segments, ext, walls_to_graph(ext, pre.region))


def angle_of(w: WallCandidate | RawWall) -> float:
    a, b = (w.a, w.b) if isinstance(w, WallCandidate) else (w.p0, w.p1)
    return math.degrees(math.atan2(b[1] - a[1], b[0] - a[0])) % 180.0


def length_of(w: WallCandidate | RawWall) -> float:
    a, b = (w.a, w.b) if isinstance(w, WallCandidate) else (w.p0, w.p1)
    return math.hypot(b[0] - a[0], b[1] - a[1])


def vertical_at(graph: WallGraph, x: float, tol: float = 4.0) -> list[WallCandidate]:
    return [w for w in graph.walls if abs(w.a[0] - x) <= tol and abs(w.b[0] - x) <= tol]


def assert_plan_topology(graph: WallGraph, tol: float = 3.0) -> None:
    assert len(graph.walls) == 7
    assert len(graph.nodes) == 6
    expected = [*CORNERS, (1200, 300), (1200, 1500)]
    for ex, ey in expected:
        assert min(math.hypot(x - ex, y - ey) for x, y in graph.nodes.values()) <= tol, (ex, ey)
    assert all(w.free_ends == 0 for w in graph.walls)


# --- the brief's cases ----------------------------------------------------------------------------------


def test_filled_rectangle_with_partition() -> None:
    r = run(render_plan(SIZE, plan("filled")))
    assert_plan_topology(r.graph)
    assert {w.source for w in r.graph.walls} == {"filled"}
    assert all(w.evidence == 1.0 for w in r.graph.walls)
    assert all(w.thickness_px == pytest.approx(14, abs=2) for w in r.graph.walls)
    assert r.graph.gaps == []
    assert r.ext.theta0 == pytest.approx(0.0, abs=0.5) or r.ext.theta0 == pytest.approx(90.0, abs=0.5)
    assert r.ext.t_median == pytest.approx(14, abs=2)
    # The masks are page sized; every wall pixel is labelled as filled.
    assert r.ext.mask.shape == r.pre.ink.shape and r.ext.mask.dtype == np.uint8
    assert set(np.unique(r.ext.source_mask).tolist()) == {0, 1}
    assert np.array_equal(r.ext.mask > 0, r.ext.source_mask > 0)
    # One raw wall per wall run: the top and bottom walls are not split at the partition.
    long_horizontal = [
        w for w in r.ext.raw if length_of(w) > 1700 and min(angle_of(w), 180 - angle_of(w)) < 1
    ]
    assert len(long_horizontal) == 2


def test_double_line_walls() -> None:
    r = run(render_plan(SIZE, plan("double")))
    assert_plan_topology(r.graph)
    assert {w.source for w in r.graph.walls} == {"double_line"}
    assert all(w.evidence == 0.85 for w in r.graph.walls)
    assert all(w.thickness_px == pytest.approx(14, abs=3) for w in r.graph.walls)
    assert set(np.unique(r.ext.source_mask).tolist()) == {0, 2}


def test_single_line_sketch() -> None:
    r = run(render_plan(SIZE, plan("single", t=2)))
    region = r.pre.region
    # Precondition: the fill and double masks are (nearly) empty, so the sketch rule applies.
    assert (r.pre.thick > 0).sum() < 0.002 * region.w * region.h
    assert_plan_topology(r.graph)
    assert {w.source for w in r.graph.walls} == {"single_line"}
    assert all(w.evidence == 0.5 for w in r.graph.walls)
    assert set(np.unique(r.ext.source_mask).tolist()) == {0, 3}
    # Single lines are drawn 3 x t_thin wide.
    assert all(w.thickness_px == pytest.approx(3 * r.pre.t_thin, abs=1.5) for w in r.graph.walls)


def test_single_line_rule_needs_an_empty_wall_mask() -> None:
    """A long thin line (furniture, a hatch border) next to real walls is not a sketch wall."""
    walls = [*plan("filled"), SWall((500, 1100), (1000, 1100), 2, style="single")]
    r = run(render_plan(SIZE, walls))
    assert {w.source for w in r.graph.walls} == {"filled"}
    assert len(r.graph.walls) == 7
    assert not any(abs(w.a[1] - 1100) < 5 and abs(w.b[1] - 1100) < 5 for w in r.graph.walls)


@pytest.mark.parametrize("hinge", ["start", "end"])
def test_gap_candidate(hinge: str) -> None:
    img = render_plan(SIZE, plan("filled"), doors=[SDoor(PARTITION, 500, 90, hinge=hinge)])  # type: ignore[arg-type]
    r = run(img)
    assert len(r.graph.walls) == 7  # leaf and arc are thin line work, not walls
    assert len(r.graph.gaps) == 1
    gap = r.graph.gaps[0]
    host = next(w for w in r.graph.walls if w.id == gap.wall_id)
    assert vertical_at(r.graph, 1200) == [host]
    assert gap.u1 - gap.u0 == pytest.approx(90, abs=4)
    y0 = min(host.a[1], host.b[1])
    assert y0 + gap.u0 == pytest.approx(800, abs=4)  # the door spans y = 800 .. 890
    assert host.openings_px == ((gap.u0, gap.u1),)
    # The opening arrives on ONE raw wall that spans the whole partition.
    partition_raw = [w for w in r.ext.raw if min(abs(angle_of(w) - 90), 999) < 1 and abs(w.p0[0] - 1200) < 4]
    assert len(partition_raw) == 1
    assert len(partition_raw[0].openings_px) == 1


def test_small_break_is_closed() -> None:
    img = render_plan(SIZE, plan("filled"), gaps=[SGap(PARTITION, 500, 20)])  # 20 < 1.5 t = 21
    r = run(img)
    assert r.graph.gaps == []
    assert_plan_topology(r.graph)


@pytest.mark.parametrize(("width", "gaps"), [(32, 0), (38, 1), (240, 1), (260, 0)])
def test_gap_width_limits(width: int, gaps: int) -> None:
    """Gap candidates need 2.5 t <= g <= 18 t (t = 14: 35 .. 252 px); breaks between 1.5 t and 2.5 t and
    beyond 18 t split the wall instead."""
    r = run(render_plan(SIZE, plan("filled"), gaps=[SGap(PARTITION, 400, width)]))
    assert len(r.graph.gaps) == gaps
    partition = vertical_at(r.graph, 1200)
    if gaps:
        assert r.graph.gaps[0].u1 - r.graph.gaps[0].u0 == pytest.approx(width, abs=4)
        assert len(partition) == 1
        assert r.graph.gaps[0].wall_id == partition[0].id
    else:
        assert len(partition) == 2
        assert sorted(w.free_ends for w in partition) == [1, 1]


def test_gap_needs_similar_thickness() -> None:
    walls = [SWall((300, 600), (1000, 600), 14), SWall((1100, 600), (2100, 600), 30)]
    r = run(render_plan(SIZE, walls))
    assert r.graph.gaps == []
    assert len(r.graph.walls) == 2


def test_gap_crossed_by_a_wall_is_no_opening() -> None:
    walls = [
        SWall((300, 600), (1000, 600), 14),
        SWall((1100, 600), (2100, 600), 14),
        SWall((1050, 300), (1050, 900), 14),  # crosses the 100 px break
    ]
    r = run(render_plan(SIZE, walls))
    assert r.graph.gaps == []


def test_dimension_lines_not_walls() -> None:
    ticks = [300, 1200, 2100]
    chain = SDimChain((300, 200), "x", ticks, ["9000", "9000"])
    img = render_plan(SIZE, plan("single", t=2), dims=[chain])
    tokens = [
        token(f"T{n}", "9000", (a + b) / 2, 200 - 19) for n, (a, b) in enumerate(itertools.pairwise(ticks), 1)
    ]
    r = run(img, tokens=tokens)
    assert_plan_topology(r.graph)
    assert not any(w.a[1] < 250 or w.b[1] < 250 for w in r.graph.walls)
    # Discriminating: without the dimension line exclusion the chain's line is a (sketch) wall.
    ext = extract_walls(r.page, r.pre, r.segments, [], make_ctx())
    assert any(w.p0[1] < 250 and w.p1[1] < 250 for w in ext.raw)


@pytest.mark.parametrize("from_top", [False, True])
def test_off_axis_short_dropped_long_kept(from_top: bool) -> None:
    rad = math.radians(30)
    if from_top:  # hangs from the top wall, falling to the right
        start, end = (700, 300), (round(700 + 500 * math.cos(rad)), round(300 + 500 * math.sin(rad)))
    else:  # stands on the bottom wall, rising to the right
        start, end = (700, 1500), (round(700 + 500 * math.cos(rad)), round(1500 - 500 * math.sin(rad)))
    stub_start = (2100, 800)
    stub_end = (round(2100 - 40 * math.cos(rad)), round(800 + 40 * math.sin(rad)))
    walls = [*plan("filled"), SWall(start, end, 14), SWall(stub_start, stub_end, 14)]
    r = run(render_plan(SIZE, walls))
    assert r.ext.theta0 == pytest.approx(0.0, abs=0.5) or r.ext.theta0 == pytest.approx(90.0, abs=0.5)
    region_l = r.pre.region.long_side
    assert 40 < 0.03 * region_l < 500
    diagonal = [w for w in r.graph.walls if min(angle_of(w) % 90, 90 - angle_of(w) % 90) > 5]
    assert len(diagonal) == 1
    assert angle_of(diagonal[0]) == pytest.approx(30 if from_top else 150, abs=1.5)
    # From the host wall's centre line to the square cap (t / 2 past the end).
    assert length_of(diagonal[0]) == pytest.approx(507, abs=8)
    stub_mid = ((stub_start[0] + stub_end[0]) / 2, (stub_start[1] + stub_end[1]) / 2)
    for w in r.graph.walls:
        mid = ((w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2)
        assert math.hypot(mid[0] - stub_mid[0], mid[1] - stub_mid[1]) > 25
    # The rectangle and partition are intact (the diagonal adds one wall and splits its host wall).
    assert len(r.graph.walls) == 9
    assert sorted(w.free_ends for w in r.graph.walls) == [0] * 8 + [1]


def test_raw_walls_meet_at_corners_and_junctions() -> None:
    """Corner chamfers of the skeleton are dropped and the walls on both sides extended to their
    intersection, so raw walls end on the plan's nodes (or at the wall end for free ends)."""
    r = run(render_plan(SIZE, plan("filled")))
    expected = [*CORNERS, (1200, 300), (1200, 1500)]
    for w in r.ext.raw:
        for p in (w.p0, w.p1):
            assert min(math.hypot(p[0] - x, p[1] - y) for x, y in expected) <= 2.5, (w.p0, w.p1)


def test_pilaster_spurs_are_pruned() -> None:
    """A 30 x 76 px pilaster straddling a 14 px wall: its skeleton spurs (shorter than 1.5 x the local
    thickness) are pruned, so it adds no stub walls."""
    walls = [*plan("filled"), SWall((700, 1475), (700, 1521), 30)]
    r = run(render_plan(SIZE, walls))
    assert_plan_topology(r.graph)


def room_with_lines(lines: list[SWall], rungs: bool = False) -> np.ndarray:
    """A filled-wall room (so the sketch rule is off) with extra thin lines inside; ``rungs`` adds 2 px
    cross strokes every 5 px between y = 600 and y = 620 for x in 500 .. 1500 (a hatched strip)."""
    pts = [(200, 200), (2200, 200), (2200, 1600), (200, 1600)]
    walls = [SWall(pts[i], pts[(i + 1) % 4], 14) for i in range(4)] + lines
    if rungs:
        walls += [SWall((x, 601), (x, 619), 2, style="single") for x in range(500, 1500, 5)]
    return render_plan(SIZE, walls)


def walls_near_y(raw: list[RawWall], y: float, x: float) -> list[RawWall]:
    out = []
    for w in raw:
        lo, hi = sorted((w.p0[0], w.p1[0]))
        if abs((w.p0[1] + w.p1[1]) / 2 - y) <= 15 and lo - 1 <= x <= hi + 1:
            out.append(w)
    return out


@pytest.mark.parametrize("rungs", [False, True])
def test_double_line_strip_must_be_hollow_or_filled(rungs: bool) -> None:
    pair = [
        SWall((500, 600), (1500, 600), 2, style="single"),
        SWall((500, 620), (1500, 620), 2, style="single"),
    ]
    r = run(room_with_lines(pair, rungs=rungs))
    found = walls_near_y(r.ext.raw, 610, 1000)
    if rungs:  # about 40 % ink between the lines: neither hollow nor filled
        assert found == []
    else:
        assert len(found) == 1
        assert found[0].source == "double_line"
        assert found[0].thickness_px == pytest.approx(20, abs=3)


@pytest.mark.parametrize(
    ("b_from", "b_to", "dy", "t_thin", "paired"),
    [
        (500, 1500, 20, None, True),
        (900, 1600, 20, None, True),  # overlap 600 of 700: 86 %
        (1100, 1800, 20, None, False),  # overlap 400 of 700: 57 % < 60 %
        (500, 1500, 10, 8.0, False),  # d < 1.5 t_thin (12 px; ruling R6)
        (500, 1500, 14, 8.0, True),  # d >= 1.5 t_thin
        (500, 1500, 44, None, True),  # d <= 0.02 L (45.1 px; ruling R6)
        (500, 1500, 48, None, False),  # d > 0.02 L
        (500, 560, 20, None, False),  # the shorter line is < 0.03 L (67.7 px; ruling R6)
        (500, 580, 20, None, True),  # ... and >= 0.03 L
    ],
)
def test_double_line_pair_limits(b_from: int, b_to: int, dy: int, t_thin: float | None, paired: bool) -> None:
    lines = [
        SWall((500, 600), (1500, 600), 2, style="single"),
        SWall((b_from, 600 + dy), (b_to, 600 + dy), 2, style="single"),
    ]
    r = run(room_with_lines(lines), t_thin=t_thin)
    assert r.pre.region.long_side == 2256
    x = (max(500, b_from) + min(1500, b_to)) / 2
    found = [w for w in r.ext.raw if w.source == "double_line"]
    if paired:
        assert len(found) == 1
        assert (found[0].p0[1] + found[0].p1[1]) / 2 == pytest.approx(600 + dy / 2, abs=2)
        lo, hi = sorted((found[0].p0[0], found[0].p1[0]))
        assert lo <= x <= hi
    else:
        assert found == []


def test_double_line_sides_are_used_once() -> None:
    """Greedy pairing by distance: A-B (14 px) and B-C (26 px) take the stretch where B exists; A-C
    (40 px) would re-use the side of A that A-B claimed, so it is not paired."""
    lines = [
        SWall((500, 600), (1500, 600), 2, style="single"),  # A
        SWall((500, 614), (800, 614), 2, style="single"),  # B
        SWall((500, 640), (1500, 640), 2, style="single"),  # C
    ]
    r = run(room_with_lines(lines))
    assert len(walls_near_y(r.ext.raw, 620, 650)) == 1
    assert walls_near_y(r.ext.raw, 620, 1200) == []


def test_vector_pdf_walls() -> None:
    corners = [(200.0, 200.0), (1400.0, 200.0), (1400.0, 1000.0), (200.0, 1000.0)]
    vsegs = [VSeg(corners[i], corners[(i + 1) % 4], 5.0) for i in range(4)]
    vsegs.append(VSeg((800.0, 200.0), (800.0, 1000.0), 5.0))
    vsegs.append(VSeg((300.0, 1100.0), (1300.0, 1100.0), 1.0))  # a hairline: not a wall
    img = render_plan(
        (1600, 1250),
        [
            SWall((int(a[0]), int(a[1])), (int(b[0]), int(b[1])), 5, style="single")
            for a, b in corners_pairs(corners)
        ]
        + [SWall((800, 200), (800, 1000), 5, style="single")],
        line_px=5,
    )
    vector = VectorPage(segments=vsegs, filled=[], words=[], object_count=len(vsegs))
    page = dataclasses.replace(page_of(img, kind="pdf_vector"), vector=vector)
    r = run(img, page=page, t_thin=1.0)
    assert len(r.graph.walls) == 7
    assert {w.source for w in r.graph.walls} == {"vector"}
    assert all(w.evidence == 1.0 for w in r.graph.walls)
    assert all(w.thickness_px == pytest.approx(5, abs=1.5) for w in r.graph.walls)
    assert not any(abs(w.a[1] - 1100) < 5 for w in r.graph.walls)


def test_vector_filled_polygons_are_walls() -> None:
    """Fill-only vector shapes arrive as filled polygons only (no edge segments): solid walls."""
    img = np.full((1250, 1600, 3), 255, np.uint8)
    rects = [
        ((200, 200), (1400, 216)),
        ((200, 984), (1400, 1000)),
        ((200, 200), (216, 1000)),
        ((1384, 200), (1400, 1000)),
    ]
    polys = [VPolygon([(x0, y0), (x1, y0), (x1, y1), (x0, y1)]) for (x0, y0), (x1, y1) in rects]
    for (x0, y0), (x1, y1) in rects:
        img[y0:y1, x0:x1] = 0
    vector = VectorPage(
        segments=[VSeg((0.0, 1240.0), (5.0, 1240.0), 0.5)], filled=polys, words=[], object_count=5
    )
    page = dataclasses.replace(page_of(img, kind="pdf_vector"), vector=vector)
    r = run(img, page=page)
    assert len(r.graph.walls) == 4
    assert {w.source for w in r.graph.walls} == {"vector"}
    assert all(w.thickness_px == pytest.approx(16, abs=2) for w in r.graph.walls)
    assert all(w.free_ends == 0 for w in r.graph.walls)


def corners_pairs(
    corners: list[tuple[float, float]],
) -> list[tuple[tuple[float, float], tuple[float, float]]]:
    return [(corners[i], corners[(i + 1) % 4]) for i in range(4)]


def token(tid: str, text: str, cx: float, cy: float, height: float = 22.0) -> TextToken:
    w = 13.0 * len(text)
    x0, y0, x1, y1 = cx - w / 2, cy - height / 2, cx + w / 2, cy + height / 2
    quad = ((x0, y0), (x1, y0), (x1, y1), (x0, y1))
    return TextToken(tid, text, quad, (x0, y0, x1, y1), 0, 0.99, height, parse_token(text))


# --- binding carries ----------------------------------------------------------------------------------


def test_wide_filled_wall_hollowed_by_sauvola_stays_filled() -> None:
    """An 80 px solid wall on a 3000 px page binarises as two ~25 px bands (Sauvola window 51)."""
    img = render_plan((3000, 2000), [SWall((500, 1000), (2500, 1000), 80, "filled")])
    r = run(img)
    column = r.pre.thick[940:1060, 1500] > 0
    assert column.sum() < 70  # precondition: the thick mask is hollow in the middle
    assert not column[60]
    assert len(r.graph.walls) == 1
    wall = r.graph.walls[0]
    assert wall.source == "filled"
    assert wall.thickness_px == pytest.approx(80, abs=4)
    assert wall.a[1] == pytest.approx(1000, abs=2) and wall.b[1] == pytest.approx(1000, abs=2)
    assert length_of(wall) == pytest.approx(2080, abs=6)  # square caps: t / 2 past both ends


def test_wide_filled_rectangle_keeps_its_topology() -> None:
    img = render_plan((3000, 2000), plan_wide())
    r = run(img)
    assert len(r.graph.walls) == 4
    assert all(w.free_ends == 0 for w in r.graph.walls)
    assert all(w.thickness_px == pytest.approx(70, abs=4) for w in r.graph.walls)
    assert {w.source for w in r.graph.walls} == {"filled"}
    corners = [(500, 400), (2500, 400), (2500, 1600), (500, 1600)]
    for w in r.ext.raw:  # the skeleton's corner chamfers are closed again
        for p in (w.p0, w.p1):
            assert min(math.hypot(p[0] - x, p[1] - y) for x, y in corners) <= 3.0, (w.p0, w.p1)


def plan_wide() -> list[SWall]:
    pts = [(500, 400), (2500, 400), (2500, 1600), (500, 1600)]
    return [SWall(pts[i], pts[(i + 1) % 4], 70) for i in range(4)]


def sketch_with_door(leaf: bool = True) -> np.ndarray:
    """A single-line sketch (L about 1100 px) with a 90 px door whose leaf touches the jamb."""
    pts = [(150, 150), (1150, 150), (1150, 850), (150, 850)]
    walls = [SWall(pts[i], pts[(i + 1) % 4], 2, style="single") for i in range(4)]
    img = render_plan((1300, 1000), walls, doors=[SDoor(0, 400, 90, hinge="start", side=-1)] if leaf else [],
                      gaps=[] if leaf else [SGap(0, 400, 90)])  # fmt: skip
    return img


def test_door_leaf_touching_the_jamb_is_not_a_wall(monkeypatch: pytest.MonkeyPatch) -> None:
    img = sketch_with_door()
    r = run(img)
    region_l = r.pre.region.long_side
    assert 0.05 * region_l <= 90  # precondition: the leaf is long enough to be a sketch wall
    assert len(r.graph.walls) == 4
    assert all(w.free_ends == 0 for w in r.graph.walls)
    assert len(r.graph.gaps) == 1
    gap = r.graph.gaps[0]
    assert gap.u1 - gap.u0 == pytest.approx(90, abs=6)
    # Discriminating: without the leaf-length test the leaf is a dangling sketch wall.
    monkeypatch.setattr(wallmod, "LEAF_MAX", 0.0)
    ext = extract_walls(r.page, r.pre, r.segments, [], make_ctx())
    assert any(abs(w.p0[0] - 550) < 6 and abs(w.p1[0] - 550) < 6 for w in ext.raw)


def test_leaf_length_test_keeps_a_real_wall_at_a_jamb() -> None:
    """A wall that starts at a jamb but is much longer than the door is not a leaf."""
    pts = [(150, 150), (1150, 150), (1150, 850), (150, 850)]
    walls = [SWall(pts[i], pts[(i + 1) % 4], 2, style="single") for i in range(4)]
    walls.append(SWall((550, 150), (550, 500), 2, style="single"))  # 350 px from the hinge jamb
    img = render_plan((1300, 1000), walls, gaps=[SGap(0, 400, 90)])
    r = run(img)
    assert any(abs(w.a[0] - 550) < 6 and abs(w.b[0] - 550) < 6 for w in r.graph.walls)


def test_theta0_is_passed_to_the_graph(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: dict[str, float] = {}
    real = wallmod.build_wall_graph

    def spy(raw: list[RawWall], **kwargs: float) -> WallGraph:
        seen.update({k: v for k, v in kwargs.items() if isinstance(v, float)})
        return real(raw, **kwargs)  # type: ignore[arg-type]

    monkeypatch.setattr(wallmod, "build_wall_graph", spy)
    ext = WallExtraction(
        mask=np.zeros((10, 10), np.uint8),
        source_mask=np.zeros((10, 10), np.uint8),
        raw=[RawWall((0.0, 0.0), (100.0, 17.6), 4.0, "filled")],
        theta0=10.0,
        t_median=4.0,
    )
    walls_to_graph(ext, Rect(0, 0, 1000, 800))
    assert seen["theta0_deg"] == 10.0
    assert seen["r"] == pytest.approx(max(4.0, 0.006 * 1000))
    assert seen["t_median"] == 4.0
    assert seen["L"] == 1000


def test_rotated_plan_snaps_to_theta0() -> None:
    rad = math.radians(10)

    def rot(x: float, y: float) -> tuple[int, int]:
        cx, cy = 1200, 900
        dx, dy = x - cx, y - cy
        return (
            round(cx + dx * math.cos(rad) - dy * math.sin(rad)),
            round(cy + dx * math.sin(rad) + dy * math.cos(rad)),
        )

    pts = [rot(*p) for p in [(500, 500), (1900, 500), (1900, 1300), (500, 1300)]]
    walls = [SWall(pts[i], pts[(i + 1) % 4], 14) for i in range(4)]
    r = run(render_plan(SIZE, walls))
    assert r.ext.theta0 == pytest.approx(10.0, abs=0.5)
    assert len(r.graph.walls) == 4
    for w in r.graph.walls:
        assert min(abs(angle_of(w) - 10), abs(angle_of(w) - 100)) < 0.5


def test_duplicate_raw_walls_are_dropped_before_the_graph(monkeypatch: pytest.MonkeyPatch) -> None:
    """Stacked copies (DXF / vector) never reach the graph (they would crowd its nearest-sample junction
    checks); the run keeps its door opening."""
    base = RawWall((100.0, 500.0), (1100.0, 500.0), 12.0, "vector", ((400.0, 490.0),))
    raw = [base] * 40 + [dataclasses.replace(base, p0=(100.2, 500.1), p1=(1099.8, 500.1))] * 40
    raw.append(RawWall((100.0, 500.0), (100.0, 900.0), 12.0, "vector"))
    ext = WallExtraction(np.zeros((1, 1), np.uint8), np.zeros((1, 1), np.uint8), raw, 0.0, 12.0)
    received: list[int] = []
    real = wallmod.build_wall_graph

    def spy(raw_in: list[RawWall], **kwargs: float) -> WallGraph:
        received.append(len(raw_in))
        return real(raw_in, **kwargs)  # type: ignore[arg-type]

    monkeypatch.setattr(wallmod, "build_wall_graph", spy)
    graph = walls_to_graph(ext, Rect(0, 0, 1200, 1000))
    assert received == [2]
    assert len(graph.walls) == 2
    assert len(graph.gaps) == 1
    assert graph.gaps[0].u1 - graph.gaps[0].u0 == pytest.approx(90, abs=0.5)
    assert len(wallmod.dedupe_raw_walls(raw)) == 2


def test_dedupe_matches_thick_copies_and_keeps_their_openings() -> None:
    a = RawWall((100.0, 500.0), (1100.0, 500.0), 80.0, "filled")
    b = RawWall((1100.0, 516.0), (100.0, 516.0), 80.0, "filled", ((100.0, 190.0),))  # reversed, 16 px off
    c = RawWall((100.0, 600.0), (1100.0, 600.0), 80.0, "filled")  # parallel, 100 px away: not a copy
    out = wallmod.dedupe_raw_walls([b, c, a])
    assert len(out) == 2
    kept = next(w for w in out if w.p0[1] < 550)
    assert len(kept.openings_px) == 1
    u0, u1 = kept.openings_px[0]
    assert u1 - u0 == pytest.approx(90, abs=0.5)
    # The opening sits at x = 1100 - 190 .. 1100 - 100 = 910 .. 1000 along the kept wall.
    assert kept.p0 == a.p0  # the first in canonical order: a runs left to right from x = 100
    assert (kept.p0[0] + u0, kept.p0[0] + u1) == pytest.approx((910, 1000), abs=0.5)


def test_stacked_vector_strokes_make_one_wall() -> None:
    img = np.full((800, 1200, 3), 255, np.uint8)
    seg = VSeg((100.0, 400.0), (1100.0, 400.0), 8.0)
    vector = VectorPage(segments=[seg] * 30, filled=[], words=[], object_count=30)
    page = dataclasses.replace(page_of(img, kind="pdf_vector"), vector=vector)
    r = run(img, page=page, t_thin=1.0)
    assert len(r.ext.raw) == 1
    assert len(r.graph.walls) == 1


def test_extract_walls_checks_the_deadline() -> None:
    r = run(render_plan(SIZE, plan("filled")))
    ctx = make_ctx()
    ctx.deadline = 0.0
    with pytest.raises(VisionError) as err:
        extract_walls(r.page, r.pre, r.segments, [], ctx)
    assert err.value.code == "deadline_exceeded"


def test_tracing_a_large_page_is_fast() -> None:
    """A 6000 x 4000 page with a dense grid of filled walls traces within a few seconds."""
    walls = [SWall((200, y), (5800, y), 16) for y in range(200, 3900, 300)]
    walls += [SWall((x, 200), (x, 3800), 16) for x in range(200, 5900, 400)]
    img = render_plan((6000, 4000), walls)
    page = page_of(img)
    pre = preprocess(page, make_ctx())
    started = time.perf_counter()
    ext = extract_walls(page, pre, [], [], make_ctx())
    elapsed = time.perf_counter() - started
    graph = walls_to_graph(ext, pre.region)
    assert elapsed < 8.0, elapsed  # about 1.2 s here
    assert len(graph.walls) == 13 * 15 * 2 - 13 - 15  # (13 rows x 14 bays) + (15 columns x 12 bays)


def test_debug_png_colours_sources_and_draws_the_graph() -> None:
    pts = [(300, 300), (1100, 300), (1100, 900), (300, 900)]
    walls = [SWall(pts[i], pts[(i + 1) % 4], 14) for i in range(4)]
    walls.append(SWall((300, 600), (1100, 600), 14, style="double"))
    r = run(render_plan((1400, 1100), walls))
    out = debug_walls_png(r.page, r.ext, r.graph)
    assert out.shape == r.page.image.shape and out.dtype == np.uint8
    b, g, red = (out[..., i].astype(int) for i in range(3))
    is_red = (red > 180) & (g < 90) & (b < 90)
    is_blue = (b > 180) & (g < 90) & (red < 90)
    assert is_red[290:310, 400:1000].mean() > 0.5
    assert is_blue[590:610, 400:1000].mean() > 0.3
    assert not is_red[590:610, 400:1000].any()
    # The graph's centre lines are drawn over the mask.
    assert (out[299:302, 400:1000].max(axis=2) < 60).any(axis=0).mean() > 0.9


def test_walls_module_has_no_labeling_or_scale_imports() -> None:
    tree = ast.parse(Path(wallmod.__file__).read_text())
    names = [n.module or "" for n in ast.walk(tree) if isinstance(n, ast.ImportFrom)]
    names += [a.name for n in ast.walk(tree) if isinstance(n, ast.Import) for a in n.names]
    assert not [n for n in names if "labeling" in n or n.endswith("scale")]


def test_empty_page_has_no_walls() -> None:
    r = run(np.full((900, 1200, 3), 255, np.uint8))
    assert r.ext.raw == []
    assert r.graph.walls == [] and r.graph.gaps == []
    assert cv2.countNonZero(r.ext.mask) == 0


# --- Task 16b: reference-image hardening (rulings R2, R6) -----------------------------------------------

BOLD_DIMS = [SDimChain((0, 150), "x", [300, 1200, 2100], ["9000", "9000"])]


def bold_plan() -> np.ndarray:
    """The brief's plan drawn with 7 px bold strokes and 3 px line work (t_thin 3.75, thick kernel 9): the
    strokes are neither thin (<= 6.75 px) nor wide enough for `thick`, like the HDB reference outline."""
    return render_plan(SIZE, plan("filled", t=7), dims=BOLD_DIMS, line_px=3)


def test_bold_outline_strokes_are_filled_walls(monkeypatch: pytest.MonkeyPatch) -> None:
    """Ruling R2: non-thin strokes >= 0.04 L long that are not in `thick` are solid walls of their width."""
    r = run(bold_plan(), use_dimensions=False)
    assert r.pre.t_thin == pytest.approx(3.75)
    assert not r.pre.thick[700:800, 1190:1210].any()  # precondition: the partition is not thick
    assert_plan_topology(r.graph)
    assert {w.source for w in r.graph.walls} == {"filled"}
    assert all(w.thickness_px == pytest.approx(7.6, abs=1.5) for w in r.graph.walls)
    # Discriminating: without the bold-stroke rule there are no walls at all.
    monkeypatch.setattr(wallmod, "BOLD_MIN_LEN_FRAC", 10.0)
    assert run(bold_plan(), use_dimensions=False).graph.walls == []


def test_short_bold_stroke_is_not_a_wall() -> None:
    walls = [*plan("filled", t=7), SWall((600, 800), (660, 800), 7)]  # 60 px < 0.04 L (~83 px)
    r = run(render_plan(SIZE, walls, dims=BOLD_DIMS, line_px=3), use_dimensions=False)
    assert len(r.graph.walls) == 7
    assert not any(abs(w.a[1] - 800) < 10 and abs(w.b[1] - 800) < 10 for w in r.graph.walls)


def test_text_blob_is_not_a_filled_wall() -> None:
    """Ruling R6: a wall-scale ink blob inside a text box (a bold label) is not a filled wall; a wall that
    a label overlaps is kept."""
    blob = SWall((900, 800), (1000, 800), 24)
    label = token("T1", "LIVINGROOM", 950, 800, height=40)
    on_wall = token("T2", "BEDROOM", 1200, 760, height=30)  # overlaps the partition at x = 1200
    img = render_plan(SIZE, [*plan("filled"), blob])
    r = run(img, tokens=[label, on_wall])
    assert len(r.graph.walls) == 7
    assert not any(890 < (w.a[0] + w.b[0]) / 2 < 1010 and abs(w.a[1] - 800) < 20 for w in r.graph.walls)
    # Discriminating: without the text mask the blob is a wall.
    assert any(abs((w.p0[1] + w.p1[1]) / 2 - 800) < 5 for w in run(img).ext.raw)


def _seg(sid: str, p0: tuple[float, float], p1: tuple[float, float]) -> Segment:
    return Segment(sid, p0, p1, 2.0, True, "lsd")


@pytest.mark.parametrize(
    ("x", "top", "seg_top", "expected"),
    [
        (300, 93, 98.4, True),  # runs on 5 px (2.5 t_thin) past the line's far edge; LSD cut the stub
        (300, 93, 93.5, True),  # same, the stub kept in the segment
        (300, 101, 101.5, False),  # stops at the line: a T junction, not an extension line
        (300, 97, 98.4, False),  # runs on < t_thin
        (300, 90, 98.4, False),  # runs on > 3 t_thin
        (300, 50, 50.5, False),  # passes through: the tick is far from both ends of the segment
        (250, 93, 98.4, False),  # not at a tick
    ],
)
def test_extension_line_rule(x: int, top: int, seg_top: float, expected: bool) -> None:
    """t_thin 2: the dimension line is 2 px (rows 99-100, centre 99.5) with ticks at x = 100, 300, 500."""
    ink = np.zeros((400, 600), np.uint8)
    ink[99:101, 100:501] = 255
    ink[top:300, x - 1 : x + 1] = 255
    dim = DimensionLine("L1", (100.0, 99.5), (500.0, 99.5), [0.0, 200.0, 400.0], "S1")
    seg = _seg("S2", (x - 0.5, seg_top), (x - 0.5, 299.5))
    assert wallmod._is_extension(seg, dim, 2.0, ink) is expected
    tilted = _seg("S3", (x - 0.5, seg_top), (x + 70.0, 290.0))  # 20 degrees off perpendicular
    assert wallmod._is_extension(tilted, dim, 2.0, ink) is False


def test_extension_lines_do_not_pair_into_walls() -> None:
    """Ruling R6: two extension lines 12 px apart (two chains' ticks side by side) would pair into a
    double-line wall; they are excluded with their dimension line."""
    lines = [
        SWall((600, 700), (1600, 700), 2, style="single"),  # the dimension line
        SWall((1000, 694), (1000, 1100), 2, style="single"),  # extension lines, overshooting by 6 px
        SWall((1012, 694), (1012, 1100), 2, style="single"),
    ]
    r = run(room_with_lines(lines), use_dimensions=False)
    piece = max(
        (s for s in r.segments if abs(s.p0[1] - 700) < 2 and abs(s.p1[1] - 700) < 2), key=lambda s: s.length
    )
    dim = DimensionLine("L1", (600.0, 700.0), (1600.0, 700.0), [0.0, 400.0, 412.0, 1000.0], piece.id)
    near = [w for w in r.ext.raw if w.source == "double_line" and abs((w.p0[0] + w.p1[0]) / 2 - 1006) < 4]
    assert len(near) == 1  # precondition: without the dimension line they pair
    ext = extract_walls(r.page, r.pre, r.segments, [dim], make_ctx(), ink=r.pre.ink)
    assert not [w for w in ext.raw if w.source == "double_line" and abs((w.p0[0] + w.p1[0]) / 2 - 1006) < 4]


def test_wall_face_taken_for_a_dimension_line_stays_a_wall(monkeypatch: pytest.MonkeyPatch) -> None:
    """A face of a double-line partition passed in as a "dimension line" pairs with the other face: it is
    a wall face, so neither it nor the walls ending on it are removed."""
    r = run(render_plan(SIZE, plan("double")), use_dimensions=False)
    face = next(
        s for s in r.segments if abs(s.p0[0] - 1193) <= 2 and abs(s.p1[0] - 1193) <= 2 and s.length > 900
    )
    dim = DimensionLine("L1", face.p0, face.p1, [0.0, face.length], face.id)
    ext = extract_walls(r.page, r.pre, r.segments, [dim], make_ctx(), ink=r.pre.ink)
    assert_plan_topology(walls_to_graph(ext, r.pre.region))
    monkeypatch.setattr(wallmod, "_wall_face_dims", lambda *a, **k: set())
    ext = extract_walls(r.page, r.pre, r.segments, [dim], make_ctx(), ink=r.pre.ink)
    assert len(walls_to_graph(ext, r.pre.region).walls) < 7


def test_face_line_pairs_on_one_side_only() -> None:
    """A face line with a partner on each side pairs with the nearer one only (06 says once per side; the
    far pair would merge into one thick block centred between the two)."""
    lines = [
        SWall((500, 600), (1500, 600), 2, style="single"),  # A
        SWall((500, 614), (1500, 614), 2, style="single"),  # B: 14 px below A
        SWall((500, 580), (1500, 580), 2, style="single"),  # C: 20 px above A
    ]
    found = [w for w in run(room_with_lines(lines)).ext.raw if w.source == "double_line"]
    assert len(found) == 1
    assert (found[0].p0[1] + found[0].p1[1]) / 2 == pytest.approx(607, abs=2)
    assert found[0].thickness_px == pytest.approx(14, abs=3)


def test_double_lines_outside_the_solid_outline_are_not_walls() -> None:
    inside = [
        SWall((500, 600), (1500, 600), 2, style="single"),
        SWall((500, 620), (1500, 620), 2, style="single"),
    ]
    outside = [
        SWall((500, 1540), (1500, 1540), 2, style="single"),
        SWall((500, 1560), (1500, 1560), 2, style="single"),
    ]
    pts = [(200, 200), (2200, 200), (2200, 1500), (200, 1500)]
    room = [SWall(pts[i], pts[(i + 1) % 4], 14) for i in range(4)]
    r = run(render_plan(SIZE, [*room, *inside, *outside]))
    assert r.pre.region.contains((1000.0, 1560.0))  # precondition: the outside pair is in the region
    doubles = [(w.p0[1] + w.p1[1]) / 2 for w in r.ext.raw if w.source == "double_line"]
    assert doubles == [pytest.approx(610, abs=2)]
    # Without solid walls there is no outline to test against: a pure double-line drawing keeps both.
    only_lines = run(render_plan(SIZE, [*plan("double"), *inside, *outside]))
    ys = [(w.p0[1] + w.p1[1]) / 2 for w in only_lines.ext.raw if abs(w.p0[1] - w.p1[1]) < 2]
    assert any(abs(y - 1550) < 3 for y in ys)


def test_jog_between_column_and_wall_stays_connected(monkeypatch: pytest.MonkeyPatch) -> None:
    """A column block whose wall continues 10 px off its centre line: the short off-axis kink of the
    skeleton is dropped, but the two straight pieces stay connected (no free ends)."""
    walls = [
        SWall((300, 300), (1700, 300), 14),
        SWall((1700, 300), (1700, 1200), 14),
        SWall((1700, 1200), (310, 1200), 14),
        SWall((310, 1200), (310, 440), 14),
        SWall((300, 300), (300, 420), 40),  # the column
    ]
    img = render_plan(SIZE, walls)
    r = run(img)
    assert sum(w.free_ends for w in r.graph.walls) == 0
    monkeypatch.setattr(wallmod, "_join", lambda a, b, dropped: [])
    assert sum(w.free_ends for w in run(img).graph.walls) > 0
