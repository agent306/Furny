"""Task 16c: wall-outline closure on synthetic plans (ruling B2 and the fixes found on the HDB reference).

- bold strokes partly in ``thick`` keep their stretch outside it, and a wide segment does not swallow a
  bold stroke beside it (the two lost HDB corner pieces);
- a jogged wall between two collinear blocks is no opening; a path ending beside a black block's centre
  line keeps its junction; a partition ending in an offset block joins it;
- bold strokes measure step-8 gaps against ``t_wall``; runs of different styles are bridged across a
  window, a slider or a door (ruling B2);
- extension lines outside the outline are no walls.
"""

import cv2
import numpy as np
import pytest

from app.pipeline import walls as wallmod
from app.schemas.candidates import WallGraph
from tests.support.synth import SDoor, SGap, SWall, render_plan
from tests.test_segments_walls import BOLD_DIMS, SIZE, plan, run


def free_ends(graph: WallGraph) -> int:
    return sum(w.free_ends for w in graph.walls)


def test_bold_stroke_partly_in_thick_keeps_its_stretch_outside() -> None:
    """The bold outline's left wall is drawn 10 px wide (thick) over 60 % of its length and 7 px (bold, not
    thick) over the rest: one LSD segment, mostly in `thick`. Its 7 px stretch is still a wall."""
    walls = plan("filled", t=7)
    walls[3] = SWall((300, 1500), (300, 780), 10)  # the left wall's lower 60 %, thick
    walls.append(SWall((300, 780), (300, 300), 7))  # ... and its upper 40 %, bold
    r = run(render_plan(SIZE, walls, dims=BOLD_DIMS, line_px=3), use_dimensions=False)
    assert r.pre.thick[1000:1100, 295:306].any() and not r.pre.thick[400:500, 290:310].any()  # precondition
    left = [w for w in r.graph.walls if abs(w.a[0] - 300) < 5 and abs(w.b[0] - 300) < 5]
    assert sum(abs(w.b[1] - w.a[1]) for w in left) == pytest.approx(1200, abs=15)
    assert free_ends(r.graph) == 0


def test_wide_segment_does_not_swallow_the_bold_stroke_beside_it() -> None:
    """A 30 px black wall continues an 8 px bold stroke, both flush with one face (the HDB top-right
    corner). LSD sees that face as one edge along both; snapped to the black wall's centre it ran 300 px
    too far, and the collinear merge absorbed the bold stroke as an edge remnant. Trimmed to its stroke
    first, it leaves the bold stroke a segment and a wall of its own."""
    block = SWall((1600, 900), (1600, 1300), 30)
    stroke = SWall((1611, 500), (1611, 900), 8)
    r = run(render_plan(SIZE, [*plan("filled"), block, stroke]), use_dimensions=False)
    bold = [s for s in r.segments if not s.is_thin and abs(s.p0[0] - 1611) < 3 and abs(s.p1[0] - 1611) < 3]
    assert bold and max(abs(s.p1[1] - s.p0[1]) for s in bold) > 300
    assert any(
        abs(w.p0[0] - 1611) < 4 and abs(w.p1[0] - 1611) < 4 and abs(w.p1[1] - w.p0[1]) > 300
        for w in r.ext.raw
    )


def jogged_left_wall() -> list[SWall]:
    """A room whose left wall jogs: a 40 px column (x 300), a 14 px wall 12 px to the right of its centre
    line, and a 40 px block on the column's line again (the HDB left wall)."""
    return [
        SWall((300, 300), (1700, 300), 14),
        SWall((1700, 300), (1700, 1300), 14),
        SWall((1700, 1300), (300, 1300), 14),
        SWall((300, 1300), (300, 1040), 40),
        SWall((300, 1040), (300, 960), 40),  # the block
        SWall((312, 960), (312, 380), 14),  # the jogged wall
        SWall((300, 380), (300, 300), 40),  # the column
    ]


def test_jogged_wall_between_two_collinear_blocks_is_no_opening() -> None:
    """The column and the block are collinear, 2.5 t .. 18 t apart, and their centre line between them is
    paper: the gap test used to read that as an empty gap and record an opening spanning the wall 12 px
    beside it. The gap's strip (0.45 t to either side) holds that wall, so it is no opening."""
    r = run(render_plan(SIZE, jogged_left_wall()))
    left = [w for w in r.graph.walls if max(w.a[0], w.b[0]) < 330]
    assert not [w for w in left if w.openings_px], left
    assert free_ends(r.graph) == 0


def test_wall_ending_beside_a_black_blocks_centre_line_keeps_its_junction(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The outline's top wall meets a black wall whose top is an L-shaped block centred 16 px below the
    wall's line (the HDB black wall's cap): the skeleton curls down into the block's junction, the curl is
    dropped, and the projection of the junction onto the wall's line is 16 px from it. A connector from
    there to the junction keeps the wall attached."""
    walls = [
        SWall((300, 300), (1700, 300), 10),
        SWall((1700, 300), (1700, 1300), 10),
        SWall((1700, 1300), (300, 1300), 10),
        SWall((300, 1300), (300, 300), 10),
        SWall((980, 316), (1040, 316), 32),  # the block's cap
        SWall((1024, 316), (1024, 1300), 32),  # the black wall
    ]
    img = render_plan(SIZE, walls)
    assert free_ends(run(img).graph) == 0
    real = wallmod._close_end

    def without_connector(*args: object, **kwargs: object) -> list[object]:
        real(*args, **kwargs)  # type: ignore[arg-type]
        return []

    monkeypatch.setattr(wallmod, "_close_end", without_connector)
    assert free_ends(run(img).graph) > 0


def test_partition_ending_in_an_offset_block_joins_it(monkeypatch: pytest.MonkeyPatch) -> None:
    """A double-line partition stops 20 px short of a 30 px black block whose centre line lies 10 px
    beside its own (the HDB bedroom-1 wall at the black wall's foot): further apart across than half the
    thinner wall, so not one run, but inside the block's half thickness. A connector joins them."""
    walls = [
        SWall((300, 300), (1700, 300), 14),
        SWall((1700, 300), (1700, 1300), 14),
        SWall((1700, 1300), (300, 1300), 14),
        SWall((300, 1300), (300, 300), 14),
        SWall((300, 800), (990, 800), 14, "double"),
        SWall((1032, 790), (1100, 790), 30),
        SWall((1085, 790), (1085, 1300), 30),
    ]
    img = render_plan(SIZE, walls)
    assert free_ends(run(img).graph) == 0
    monkeypatch.setattr(wallmod, "_link_runs", lambda *a, **k: [])
    assert free_ends(run(img).graph) == 2


def bold_outline(top: SWall) -> list[SWall]:
    """The brief's plan with an 8 px bold outline (``top`` first) and a double-line partition (t_wall)."""
    return [
        top,
        SWall((2100, 300), (2100, 1500), 8),
        SWall((2100, 1500), (300, 1500), 8),
        SWall((300, 1500), (300, 300), 8),
        SWall((1200, 300), (1200, 1500), 14, "double"),
    ]


def test_bold_stroke_gaps_are_measured_against_t_wall(monkeypatch: pytest.MonkeyPatch) -> None:
    """Ruling B2: a 200 px opening in an 8 px bold outline is 25 stroke widths (beyond 18 t) but 12.5 wall
    thicknesses: with t_wall (the double-line partition's 14-16 px) it is an opening of the wall."""
    img = render_plan(
        SIZE,
        bold_outline(SWall((300, 300), (2100, 300), 8)),
        gaps=[SGap(0, 600, 200)],
        dims=BOLD_DIMS,
        line_px=3,
    )
    r = run(img, use_dimensions=False)
    top = [w for w in r.graph.walls if abs(w.a[1] - 300) < 5 and abs(w.b[1] - 300) < 5]
    assert [round(o1 - o0) for w in top for o0, o1 in w.openings_px] == [pytest.approx(200, abs=6)]
    assert free_ends(r.graph) == 0
    monkeypatch.setattr(wallmod, "_wall_thickness", lambda pieces: None)  # the stroke width instead
    assert free_ends(run(img, use_dimensions=False).graph) == 2


def block_door_bold(door: bool) -> np.ndarray:
    """An 8 px bold outline whose bottom wall starts as a 30 px black block (x 300-700) and continues as
    the bold stroke 8 px lower after a 150 px door (or the same gap without a door)."""
    walls = [
        SWall((300, 300), (2100, 300), 8),
        SWall((2100, 300), (2100, 1500), 8),
        SWall((300, 1500), (300, 300), 8),
        SWall((1200, 300), (1200, 1500), 14, "double"),
        SWall((300, 1500), (685, 1500), 30),
        SWall((700, 1508), (2100, 1508), 8) if door else SWall((850, 1508), (2100, 1508), 8),
    ]
    doors = [SDoor(5, 0, 150, hinge="start", side=1)] if door else []
    return render_plan(SIZE, walls, doors=doors, dims=BOLD_DIMS, line_px=3)


def test_block_and_bold_stroke_are_bridged_across_a_door() -> None:
    """Ruling B2: a black block and a bold stroke 8 px apart across, 150 px apart along, with a door swing
    at the jamb: one opening of the block's line, a connector where the stroke's line jogs, no free end.
    Without the door's arc there is no opening evidence and nothing is bridged."""
    r = run(block_door_bold(door=True), use_dimensions=False)
    assert free_ends(r.graph) == 0
    spans = [o1 - o0 for w in r.graph.walls for o0, o1 in w.openings_px if min(w.a[1], w.b[1]) > 1450]
    assert spans == [pytest.approx(150, abs=6)]
    assert free_ends(run(block_door_bold(door=False), use_dimensions=False).graph) == 2


def _run(s0: float, s1: float, off: float, t: float, style: str) -> wallmod._Run:
    u, n = np.array((1.0, 0.0)), np.array((0.0, 1.0))
    source = "double_line" if style == "double" else "filled"
    member = wallmod._Item(s0, s1, off, t, t, source, style, True, True)  # type: ignore[arg-type]
    return wallmod._Run(u, n, s0, s1, [member], [], True, True)


@pytest.mark.parametrize(
    ("lines", "bridged"),
    [
        ([(500, 100, 704, 100), (496, 108, 700, 108)], True),  # two frame lines over the gap
        ([(500, 100, 704, 100)], False),  # one line
        ([(500, 100, 640, 100), (496, 108, 700, 108)], False),  # one covers only 70 % of the gap
        ([(500, 100, 704, 100), (500, 101, 704, 101)], False),  # the same line twice (1 px apart)
        ([(500, 100, 704, 100), (496, 140, 700, 140)], False),  # one far outside the strip
        ([(500, 100, 704, 100), (500, 108, 704, 120)], False),  # one off by more than 3 degrees
    ],
)
def test_frame_lines_are_opening_evidence(lines: list[tuple[int, int, int, int]], bridged: bool) -> None:
    """Ruling B2's opening evidence: >= 2 distinct thin lines parallel within 3 degrees inside the gap's
    strip, each covering >= 80 % of it. The bridge runs along their centre (y 104), between a black block
    (y 100) and a bold stroke (y 107), with connectors where the runs' lines jog from it."""
    a = _run(0.0, 500.0, 100.0, 28.0, "block")
    b = _run(700.0, 1500.0, 107.0, 10.0, "bold")
    thin = np.array(lines, np.float64)
    out = wallmod._link_runs([a, b], thin, np.zeros((300, 1600), np.uint8), 14.0, lambda: None)
    if not bridged:
        assert out == []
        return
    bridge = next(w for w in out if w.openings_px)
    assert bridge.p0 == pytest.approx((500.0, 104.0)) and bridge.p1 == pytest.approx((700.0, 104.0))
    assert bridge.openings_px == ((0.0, pytest.approx(200.0)),) and bridge.thickness_px == 28.0
    assert sorted((w.p0, w.p1) for w in out if not w.openings_px) == [
        ((500.0, 100.0), (500.0, 104.0)),
        ((700.0, 107.0), (700.0, 104.0)),
    ]
    # Styles must differ: two bold strokes are not bridged (their gaps follow step 8 and t_wall).
    assert (
        wallmod._link_runs(
            [a, _run(700.0, 1500.0, 107.0, 10.0, "block")],
            thin,
            np.zeros((300, 1600), np.uint8),
            14.0,
            lambda: None,
        )
        == []
    )


def test_extension_lines_outside_the_outline_are_no_walls(monkeypatch: pytest.MonkeyPatch) -> None:
    """Two extension lines 10 px apart run from the top wall up through the dimension chain above it and
    30 px on (beyond R6's overshoot), so they pair into a double-line wall; the plan's bay keeps them inside
    the solid walls' envelope (the HDB "1200 | 600" pair). Dangling outside the closed outline along lines
    touching the chain's ticks, they are cut out; without the rule they stay."""
    from app.pipeline.walls import extract_walls, walls_to_graph
    from app.schemas.candidates import DimensionLine
    from tests.test_normalize import make_ctx

    walls = [
        SWall((300, 500), (1500, 500), 14),
        SWall((1500, 500), (1500, 300), 14),
        SWall((1500, 300), (2100, 300), 14),
        SWall((2100, 300), (2100, 1500), 14),
        SWall((2100, 1500), (300, 1500), 14),
        SWall((300, 1500), (300, 500), 14),
        SWall((1000, 250), (1000, 493), 2, "single"),  # extension lines
        SWall((1010, 250), (1010, 493), 2, "single"),
        SWall((300, 280), (1500, 280), 2, "single"),  # the dimension chain
    ]
    r = run(render_plan(SIZE, walls), use_dimensions=False)
    chain = max(
        (s for s in r.segments if abs(s.p0[1] - 280) < 3 and abs(s.p1[1] - 280) < 3), key=lambda s: s.length
    )
    dim = DimensionLine(
        "L1", chain.p0, chain.p1, [x - chain.p0[0] for x in (300.0, 1000.0, 1010.0)], chain.id
    )

    def above(graph: WallGraph) -> list[object]:
        return [w for w in graph.walls if min(w.a[1], w.b[1]) < 480 and 990 < w.a[0] < 1020]

    ext = extract_walls(r.page, r.pre, r.segments, [dim], make_ctx(), ink=r.pre.ink)
    assert above(walls_to_graph(ext, r.pre.region)) == []
    assert free_ends(walls_to_graph(ext, r.pre.region)) == 0
    monkeypatch.setattr(wallmod, "_drop_dangling_extensions", lambda raw, *a, **k: (raw, None))
    ext = extract_walls(r.page, r.pre, r.segments, [dim], make_ctx(), ink=r.pre.ink)
    assert len(above(walls_to_graph(ext, r.pre.region))) == 1


def test_face_lines_cut_by_a_dimension_line_are_rejoined() -> None:
    """A dimension line ending on a wall's faces cut both (the HDB "3200" line at the bedroom-2 wall): the
    pieces, measured 1.9 and 3.8 px wide so the segment stage kept them apart, fuse again before pairing.
    Pieces far from any dimension line are left as they are."""
    from app.pipeline import wall_candidates as candmod
    from app.schemas.candidates import Segment

    pieces = [
        Segment("S1", (300.0, 475.0), (955.0, 475.0), 1.9, True, "lsd"),
        Segment("S2", (937.0, 475.0), (974.0, 475.0), 3.8, True, "lsd"),  # overlaps S1
        Segment("S3", (300.0, 485.0), (955.0, 485.0), 1.9, True, "lsd"),
        Segment("S4", (962.0, 485.0), (983.0, 485.0), 3.8, True, "lsd"),  # 7 px gap
    ]
    dim = np.array([[958.0, 180.0, 958.0, 482.0]])  # ends between the two faces
    fused = sorted(
        (round(s.p0[0]), round(s.p1[0]), round(s.p0[1])) for s in candmod._rejoined(pieces, dim, 3.75)
    )
    assert fused == [(300, 974, 475), (300, 983, 485)]
    far = np.array([[1500.0, 180.0, 1500.0, 482.0]])
    assert candmod._rejoined(pieces, far, 3.75) == pieces


def mixed_bottom(second: SWall, first: SWall) -> np.ndarray:
    """The 8 px bold outline with a double-line partition (t_wall 16) whose bottom wall is ``first`` (x 300
    to 685) and ``second`` (from x 850): a plain 165 px gap, no frame lines, no door."""
    walls = [
        SWall((300, 300), (2100, 300), 8),
        SWall((2100, 300), (2100, 1500), 8),
        SWall((300, 1500), (300, 300), 8),
        SWall((1200, 300), (1200, 1500), 14, "double"),
        first,
        second,
    ]
    return render_plan(SIZE, walls, dims=BOLD_DIMS, line_px=3)


@pytest.mark.parametrize(
    ("first", "second"),
    [
        (SWall((300, 1500), (685, 1500), 8), SWall((850, 1500), (2100, 1500), 14, "double")),  # bold | double
        (SWall((300, 1500), (685, 1500), 8), SWall((850, 1504), (2100, 1504), 14, "double")),  # ... 4 px off
        (SWall((300, 1500), (685, 1500), 16), SWall((850, 1500), (2100, 1500), 8)),  # block | bold
        (
            SWall((300, 1500), (685, 1500), 16),
            SWall((850, 1500), (2100, 1500), 14, "double"),
        ),  # block | double
    ],
)
def test_mixed_styles_are_not_bridged_across_a_plain_gap(first: SWall, second: SWall) -> None:
    """Ruling B2 (Task 16c review, Important 1): pieces of different drawing styles are bridged only with
    opening evidence. Step 8 used to bridge a bold stroke and a double line across a plain gap because the
    bold stroke's t_wall made their thicknesses look alike."""
    graph = run(mixed_bottom(second, first), use_dimensions=False).graph
    assert [w.openings_px for w in graph.walls if w.openings_px and min(w.a[1], w.b[1]) > 1450] == []
    assert free_ends(graph) == 2


def test_same_style_bold_strokes_are_bridged_across_a_plain_gap() -> None:
    """The control: two bold strokes across the same 165 px gap are one wall with an opening (B1)."""
    graph = run(
        mixed_bottom(SWall((850, 1500), (2100, 1500), 8), SWall((300, 1500), (685, 1500), 8)),
        use_dimensions=False,
    ).graph
    assert free_ends(graph) == 0
    assert len([w for w in graph.walls if w.openings_px and min(w.a[1], w.b[1]) > 1450]) == 1


def _block_gap_double(texture: str) -> np.ndarray:
    """A 30 px black block (x 300-685) and a double-line wall (from x 850, 4 px lower) across a plain gap,
    with ``texture`` drawn in the room beside the gap: a 45-degree hatch at a 9 px pitch, a 12 px tile
    grid, or a real door (a leaf and its swing hinged at the block's end)."""
    walls = [
        SWall((300, 300), (2100, 300), 8),
        SWall((2100, 300), (2100, 1500), 8),
        SWall((300, 1500), (300, 300), 8),
        SWall((1200, 300), (1200, 1500), 14, "double"),
        SWall((300, 1500), (685, 1500), 30),
        SWall((700, 1504), (2100, 1504), 14, "double")
        if texture == "door"
        else SWall((850, 1504), (2100, 1504), 14, "double"),
    ]
    doors = [SDoor(5, 0, 150, hinge="start", side=1)] if texture == "door" else []
    img = render_plan(SIZE, walls, doors=doors, dims=BOLD_DIMS, line_px=3)
    if texture == "hatch":
        hatch = np.zeros(img.shape[:2], np.uint8)
        for k in range(-400, 400, 9):
            cv2.line(hatch, (600 + k, 1480), (600 + k + 300, 1180), 255, 2)
        box = np.zeros_like(hatch)
        box[1180:1478, 560:1000] = 255
        img[(hatch > 0) & (box > 0)] = 0
    elif texture == "tiles":
        for y in range(1250, 1480, 12):
            img[y : y + 2, 560:1000] = 0
        for x in range(560, 1000, 12):
            img[1250:1480, x : x + 2] = 0
    return img


@pytest.mark.parametrize(("texture", "bridged"), [("hatch", False), ("tiles", False), ("door", True)])
def test_door_arc_evidence_is_one_thin_curve(texture: str, bridged: bool) -> None:
    """Ruling B2's arc evidence (Task 16c review, Important 4): a 45-degree hatch or a fine tile grid
    beside a plain gap crosses any circle about the jamb in short stubs with ink beside them, so it is no
    door swing; a real swing is one thin arc of the gap's radius about the jamb."""
    graph = run(_block_gap_double(texture), use_dimensions=False).graph
    openings = [w for w in graph.walls if w.openings_px and min(w.a[1], w.b[1]) > 1450]
    across = [
        w
        for w in graph.walls
        if min(w.a[1], w.b[1]) > 1480 and min(w.a[0], w.b[0]) < 775 < max(w.a[0], w.b[0])
    ]
    assert bool(openings) is bridged
    assert bool(across) is bridged  # the gap at x 700-850 is spanned only by a bridge


def test_rejoining_many_thin_lines_is_fast_and_polls_the_deadline() -> None:
    """Task 16c review, Important 3: 11.5k thin segments with 100 dimension lines, each with 15 extension
    lines ending on it (a dense A1 plan): rejoining stays well under a second (0.3 s measured; it was 141 s
    as a pairwise loop) and polls the deadline throughout."""
    import time

    from app.pipeline import wall_candidates as candmod
    from app.schemas.candidates import Segment

    rng = np.random.default_rng(1)
    segs = []
    for i in range(10_000):
        x, y = rng.uniform(0, 6000, 2)
        length = rng.uniform(20, 300)
        p1 = (x + length, y) if i % 2 else (x, y + length)
        segs.append(Segment(f"S{i}", (x, y), p1, 2.0, True, "lsd"))
    dims = []
    for j in range(100):
        y = 100.0 + 70 * j
        dims.append((500.0, y, 5500.0, y))
        for e in range(15):
            x = 500 + 5000 * e / 14
            segs.append(Segment(f"E{j}_{e}", (x, y - 6), (x, y + 200), 2.0, True, "lsd"))
    polls: list[int] = []
    start = time.perf_counter()
    candmod._rejoined(segs, np.array(dims), 2.0, lambda: polls.append(1))
    assert time.perf_counter() - start < 1.0
    assert len(polls) >= 20
