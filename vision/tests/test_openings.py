"""Openings (06 §8.5): door arcs, windows and passages in the gaps of the wall graph (Task 17).

The brief's cases run on one room whose top wall runs a = (100, 500) -> b = (900, 500): d = (1, 0) and the
left normal n = (0, -1), up on screen (04 §2.1), so a leaf opening upward swings ``left``.
"""

import dataclasses
import math

import cv2
import numpy as np
import pytest

from app.pipeline.openings import find_openings
from app.schemas.candidates import OpeningCandidate, WallCandidate, WallGraph
from tests.support.synth import SDoor, SGap, SWall, SWindow, render_plan
from tests.test_segments_walls import PARTITION, Run, plan, run, token
from tests.test_segments_walls import SIZE as SIZE_PLAN

SIZE = (1000, 1200)
TOP = 0  # index of the wall a = (100, 500) -> b = (900, 500) in `room()`


def room(t: int = 14) -> list[SWall]:
    pts = [(100, 500), (900, 500), (900, 1100), (100, 1100)]
    return [SWall(pts[i], pts[(i + 1) % 4], t) for i in range(4)]


def top_wall(graph: WallGraph) -> WallCandidate:
    """The graph wall along y = 500."""
    (wall,) = [w for w in graph.walls if abs(w.a[1] - 500) < 5 and abs(w.b[1] - 500) < 5]
    return wall


def as_drawn(o: OpeningCandidate, wall: WallCandidate) -> OpeningCandidate:
    """``o`` read on the wall as drawn, a = (100, 500) -> b = (900, 500). The graph orders a wall's nodes by
    (y, x), so a pixel of tilt can turn the top wall around; its hinge, swing and positions turn with it."""
    if wall.a[0] < wall.b[0]:
        return o
    length = math.dist(wall.a, wall.b)
    return dataclasses.replace(
        o,
        u0=length - o.u1,
        u1=length - o.u0,
        hinge="end" if o.hinge == "start" else "start",
        swing="right" if o.swing == "left" else "left",
    )


def openings_on_top(img: np.ndarray) -> tuple[Run, WallCandidate, list[OpeningCandidate]]:
    r = run(img)
    wall = top_wall(r.graph)
    ops = find_openings(r.graph, r.pre, r.segments, r.pre.ink)  # no text: ink_notext is the ink
    return r, wall, [as_drawn(o, wall) for o in ops if o.wall_id == wall.id]


def test_door_arc_start_left() -> None:
    img = render_plan(SIZE, room(), doors=[SDoor(TOP, 300, 90, hinge="start", side=1)])
    _, _, ops = openings_on_top(img)
    (o,) = ops
    assert (o.kind, o.type, o.hinge, o.swing) == ("door", "single_swing", "start", "left")
    assert o.support >= 0.55
    assert o.u0 == pytest.approx(300, abs=4) and o.u1 == pytest.approx(390, abs=4)


def test_door_arc_end_right() -> None:
    img = render_plan(SIZE, room(), doors=[SDoor(TOP, 300, 90, hinge="end", side=-1)])
    _, _, ops = openings_on_top(img)
    (o,) = ops
    assert (o.kind, o.type, o.hinge, o.swing) == ("door", "single_swing", "end", "right")
    assert o.support >= 0.55


def test_double_swing() -> None:
    img = render_plan(SIZE, room(), doors=[SDoor(TOP, 300, 140, double=True, side=-1)])
    _, _, ops = openings_on_top(img)
    (o,) = ops
    assert (o.kind, o.type, o.swing) == ("door", "double_swing", "right")
    assert o.u1 - o.u0 == pytest.approx(140, abs=6)


def test_window_casement() -> None:
    img = render_plan(SIZE, room(), windows=[SWindow(TOP, 300, 120, lines=2)])
    _, _, ops = openings_on_top(img)
    (o,) = ops
    assert (o.kind, o.type) == ("window", "casement")
    assert o.u0 == pytest.approx(300, abs=6) and o.u1 == pytest.approx(420, abs=6)


def test_window_sliding() -> None:
    img = render_plan(SIZE, room(), windows=[SWindow(TOP, 300, 120, lines=3, offset_sashes=True)])
    _, _, ops = openings_on_top(img)
    (o,) = ops
    assert (o.kind, o.type) == ("window", "sliding_window")
    assert o.u0 == pytest.approx(300, abs=6) and o.u1 == pytest.approx(420, abs=6)


def test_passage() -> None:
    img = render_plan(SIZE, room(), gaps=[SGap(TOP, 300, 90)])
    _, _, ops = openings_on_top(img)
    (o,) = ops
    assert (o.kind, o.type, o.support) == ("opening", "opening", 0.0)
    assert o.u0 == pytest.approx(300, abs=4) and o.u1 == pytest.approx(390, abs=4)


# --- beyond the brief's six ------------------------------------------------------------------------------


def test_one_line_across_a_gap_is_a_passage() -> None:
    """A threshold line is no window: the window test needs two frame lines."""
    img = render_plan(SIZE, room(), gaps=[SGap(TOP, 300, 90)])
    cv2.line(img, (400, 500), (490, 500), (0, 0, 0), 2)
    _, _, ops = openings_on_top(img)
    assert [(o.kind, o.type) for o in ops] == [("opening", "opening")]


def test_solid_wall_without_a_break_has_no_opening() -> None:
    _, _, ops = openings_on_top(render_plan(SIZE, room()))
    assert ops == []


def test_door_hinged_on_the_wall_face_is_found() -> None:
    """Drawings put the hinge on the wall face the leaf opens to, half a thickness off the centre line (the
    HDB doors): the arc is still the door's."""
    t = 14
    img = render_plan(SIZE, room(t), gaps=[SGap(TOP, 300, 90)])
    hinge = (400, 500 - t // 2)  # u0 = 300 on the upper face
    cv2.ellipse(img, hinge, (90, 90), 0, 0, -90, (0, 0, 0), 2)  # from the far jamb up to the open leaf
    cv2.line(img, hinge, (400, 500 - t // 2 - 90), (0, 0, 0), 2)
    _, _, ops = openings_on_top(img)
    (o,) = ops
    assert (o.kind, o.type, o.hinge, o.swing) == ("door", "single_swing", "start", "left")


def test_bifold_door() -> None:
    """A bi-fold door (04: two leaves of ``g / 2`` folded into a V toward the swing side, hinged at a
    jamb)."""
    img = render_plan(SIZE, room(), gaps=[SGap(TOP, 300, 100)])
    jamb, mid, far = (400, 500), (425, 500 + 43), (450, 500)  # leaves of 50 at 60 degrees, folded down
    cv2.line(img, jamb, mid, (0, 0, 0), 2)
    cv2.line(img, mid, far, (0, 0, 0), 2)
    _, _, ops = openings_on_top(img)
    (o,) = ops
    assert (o.kind, o.type, o.hinge, o.swing) == ("door", "bifold", "start", "right")


def test_ids_follow_wall_then_position() -> None:
    walls = room()
    img = render_plan(
        SIZE,
        walls,
        doors=[SDoor(TOP, 500, 90), SDoor(2, 200, 90, side=-1)],  # the bottom wall runs b -> a in the graph
        gaps=[SGap(TOP, 150, 90)],
    )
    r = run(img)
    ops = find_openings(r.graph, r.pre, r.segments, r.pre.ink)
    assert [o.id for o in ops] == [f"O{k}" for k in range(1, len(ops) + 1)]
    order = {w.id: k for k, w in enumerate(r.graph.walls)}
    keys = [(order[o.wall_id], o.u0) for o in ops]
    assert keys == sorted(keys)
    assert len(ops) == 3


def _swing_point(graph: WallGraph, o: OpeningCandidate) -> tuple[float, float]:
    """A point a quarter of the opening's width off the hinge, on the swing side (04 §2.1 normal)."""
    w = next(w for w in graph.walls if w.id == o.wall_id)
    length = math.dist(w.a, w.b)
    d = ((w.b[0] - w.a[0]) / length, (w.b[1] - w.a[1]) / length)
    n = (d[1], -d[0])
    u = o.u0 if o.hinge == "start" else o.u1
    s = 1.0 if o.swing == "left" else -1.0
    q = 0.25 * (o.u1 - o.u0)
    return (w.a[0] + d[0] * u + n[0] * s * q, w.a[1] + d[1] * u + n[1] * s * q)


@pytest.mark.parametrize(("hinge", "side"), [("start", 1), ("start", -1), ("end", 1), ("end", -1)])
def test_hinge_and_swing_on_a_vertical_wall(hinge: str, side: int) -> None:
    """The right wall runs down the screen (d = (0, 1), n = (1, 0)): a leaf on side +1 swings to screen
    right. Checked in screen terms, whatever direction the graph gives the wall."""
    img = render_plan(SIZE, room(), doors=[SDoor(1, 200, 90, hinge=hinge, side=side)])  # type: ignore[arg-type]
    r = run(img)
    ops = find_openings(r.graph, r.pre, r.segments, r.pre.ink)
    (o,) = [o for o in ops if o.kind == "door"]
    hinge_y = 700 if hinge == "start" else 790
    x, y = _swing_point(r.graph, o)
    assert y == pytest.approx(hinge_y, abs=6)
    assert (x > 900) == (side == 1)


# --- Task 16c carries: doors at a partition's end (R-b), door leaves beside a face, bi-fold -----------------


def partition_end_door(hinge: str, side: int, door: bool = True) -> np.ndarray:
    """The brief's plan (`tests.test_segments_walls.plan`) with the partition x = 1200 ending 93 px short of
    the bottom wall's face (y 1493): a door at the partition's free end closes against the bottom wall."""
    walls = plan("filled")
    if not door:
        walls[PARTITION] = SWall((1200, 300), (1200, 1400), 14)
        return render_plan(SIZE_PLAN, walls)
    return render_plan(SIZE_PLAN, walls, doors=[SDoor(PARTITION, 1100, 93, hinge=hinge, side=side)])  # type: ignore[arg-type]


@pytest.mark.parametrize(("hinge", "side"), [("start", 1), ("end", -1)])
def test_door_at_a_partitions_free_end_extends_it_to_the_wall(hinge: str, side: int) -> None:
    """Task 16c R-b: the partition reaches the bottom wall through the door as one opening, so the two
    rooms close; the door is found on it with its hinge and swing."""
    r = run(partition_end_door(hinge, side))
    part = [w for w in r.graph.walls if abs(w.a[0] - 1200) < 5 and abs(w.b[0] - 1200) < 5]
    assert sum(w.free_ends for w in r.graph.walls) == 0
    assert max(max(w.a[1], w.b[1]) for w in part) == pytest.approx(1500, abs=5)
    ops = find_openings(r.graph, r.pre, r.segments, r.pre.ink)
    (o,) = [o for o in ops if o.wall_id in {w.id for w in part}]
    w = next(w for w in part if w.id == o.wall_id)
    assert (o.kind, o.type) == ("door", "single_swing")
    assert o.u1 - o.u0 == pytest.approx(93, abs=8)
    x, y = _swing_point(r.graph, o)
    assert y == pytest.approx(1400 if hinge == "start" else 1493, abs=8)
    assert (x > 1200) == (side == 1)  # the partition runs down the screen: +n is screen right
    del w


def test_partition_end_without_a_door_stays_free() -> None:
    r = run(partition_end_door("start", 1, door=False))
    assert sum(w.free_ends for w in r.graph.walls) == 1


def toilet_with_door_beside_its_wall(t: int = 14) -> tuple[np.ndarray, int]:
    """The HDB toilet 3 in double lines: a partition (x 1000, y 300 .. 1100) and, against its right face, a
    door in the cross wall y 800 whose hinge stands 6 px off that face and whose open leaf runs up along it.
    The leaf is a thin line one leaf-width long beside the face: paired with it first (d = 6 < 14), it took
    the face's stretch and the partition's upper part was lost."""
    v_x = 1000
    walls = [
        SWall((300, 300), (1700, 300), t, style="double"),
        SWall((1700, 300), (1700, 1100), t, style="double"),
        SWall((1700, 1100), (300, 1100), t, style="double"),
        SWall((300, 1100), (300, 300), t, style="double"),
        SWall((v_x, 300), (v_x, 1100), t, style="double"),
        SWall((v_x, 800), (1700, 800), t, style="double"),
    ]
    door = SDoor(5, t // 2 + 6, 110, hinge="start", side=1)  # hinge at x = v_x + 13, the leaf up to y 690
    return render_plan(SIZE_PLAN, walls, doors=[door]), v_x


def test_door_leaf_beside_a_wall_face_does_not_take_the_face() -> None:
    img, v_x = toilet_with_door_beside_its_wall()
    r = run(img)
    part = [w for w in r.graph.walls if abs(w.a[0] - v_x) < 5 and abs(w.b[0] - v_x) < 5]
    assert sum(abs(w.b[1] - w.a[1]) for w in part) == pytest.approx(800, abs=20)
    assert not [w for w in r.graph.walls if abs(w.a[0] - (v_x + 13)) < 4 and abs(w.b[0] - (v_x + 13)) < 4]
    ops = find_openings(r.graph, r.pre, r.segments, r.pre.ink)
    assert [(o.kind, o.type) for o in ops] == [("door", "single_swing")]


# --- real-drawing rules (Task 17, measured on the reference blueprints) -------------------------------------


def test_lines_touching_a_quarter_circles_ends_are_no_door() -> None:
    """A line along the wall at the leaf's distance and one across it at the far jamb (a dimension line and
    a crossing wall's face) touch both ends of a door's quarter circle: no arc, a passage."""
    img = render_plan(SIZE, room(), gaps=[SGap(TOP, 300, 90)])
    cv2.line(img, (380, 500 - 90), (520, 500 - 90), (0, 0, 0), 2)  # along the wall, 90 px up
    cv2.line(img, (490, 495), (490, 380), (0, 0, 0), 2)  # across it at the far jamb (x 490)
    _, _, ops = openings_on_top(img)
    assert [(o.kind, o.type) for o in ops] == [("opening", "opening")]


def test_door_arc_under_a_label_is_still_a_door() -> None:
    """A room label over the middle of the arc: the text mask removes that ink, and those samples are not
    judged (they are neither arc nor paper)."""
    img = render_plan(SIZE, room(), doors=[SDoor(TOP, 300, 90, hinge="start", side=-1)])
    label = token("T1", "BEDROOM", 470, 560, 26.0)  # the arc's middle, about (464, 564)
    cv2.putText(img, "BEDROOM", (420, 570), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 2)
    r = run(img, tokens=[label])
    wall = top_wall(r.graph)
    ink_notext = r.pre.ink.copy()
    x0, y0, x1, y1 = (round(v) for v in label.box)
    ink_notext[max(0, y0 - 2) : y1 + 3, max(0, x0 - 2) : x1 + 3] = 0
    ops = [
        as_drawn(o, wall)
        for o in find_openings(r.graph, r.pre, r.segments, ink_notext)
        if o.wall_id == wall.id
    ]
    assert [(o.kind, o.hinge, o.swing) for o in ops] == [("door", "start", "right")]


def test_gap_under_a_label_is_no_passage() -> None:
    """A label written across a double-line wall (the HDB toilet-1 "1900"): the text mask erases the wall's
    faces under it, and the walls stage sees a gap with nothing in it. It is no evidence of a passage."""
    walls = [SWall(w.a, w.b, 14, style="double") for w in room()]
    img = render_plan(SIZE, walls)
    cv2.putText(img, "1900", (395, 512), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 0, 0), 2)
    label = token("T1", "1900", 445, 500, 30.0)
    r = run(img, tokens=[label])
    wall = top_wall(r.graph)
    ink_notext = r.pre.ink.copy()
    x0, y0, x1, y1 = (round(v) for v in label.box)
    ink_notext[max(0, y0 - 2) : y1 + 3, max(0, x0 - 2) : x1 + 3] = 0  # as `run` masks it
    assert [g for g in r.graph.gaps if g.wall_id == wall.id]  # precondition: the label left a gap
    ops = find_openings(r.graph, r.pre, r.segments, ink_notext)
    assert [o for o in ops if o.wall_id == wall.id] == []


def test_clear_arc_outranks_threshold_lines() -> None:
    """The brochure's entrance: the wall's two faces drawn across the door as a threshold (two frame lines)
    and a clear arc. A clear arc makes a door; lines alone, a window."""
    img = render_plan(SIZE, room(), doors=[SDoor(TOP, 300, 90, hinge="end", side=-1)])
    for y in (496, 504):  # inside the wall's strip, clear of its edges
        cv2.line(img, (400, y), (490, y), (0, 0, 0), 2)
    _, _, ops = openings_on_top(img)
    assert [(o.kind, o.type, o.hinge, o.swing) for o in ops] == [("door", "single_swing", "end", "right")]


def test_window_across_a_junction_is_one_window() -> None:
    """A thin partition meets the solid top wall in the middle of a window: the window's solid-ink break is
    read along the wall line through the junction, not per graph wall."""
    walls = [*room(), SWall((460, 500), (460, 1100), 6, style="double")]
    img = render_plan(SIZE, walls, windows=[SWindow(TOP, 300, 120, lines=2)])
    r = run(img)
    ops = [o for o in find_openings(r.graph, r.pre, r.segments, r.pre.ink) if o.kind == "window"]
    assert len(ops) == 1
    o = ops[0]
    host = next(w for w in r.graph.walls if w.id == o.wall_id)
    xs = sorted(host.a[0] + (host.b[0] - host.a[0]) * u / math.dist(host.a, host.b) for u in (o.u0, o.u1))
    assert xs[1] - xs[0] >= 50  # at least the window's half on its wall


def test_gaps_stay_clear_of_crossing_walls() -> None:
    """A gap reaching a node is trimmed clear of the wall crossing there (half its thickness + 2 px); a
    collinear continuation does not trim it; a gap that is only the junction's own extent is dropped."""
    from app.pipeline import openings as om
    from app.schemas.candidates import WallCandidate

    def wall(
        wid: str, a: tuple[float, float], b: tuple[float, float], na: str, nb: str, t: float
    ) -> WallCandidate:
        return WallCandidate(wid, a, b, na, nb, t, "filled", 1.0, 0, ())

    graph = WallGraph(
        {"N1": (0.0, 0.0), "N2": (300.0, 0.0), "N3": (0.0, 300.0), "N4": (500.0, 0.0)},
        [
            wall("W1", (0.0, 0.0), (300.0, 0.0), "N1", "N2", 10.0),
            wall("W2", (0.0, 0.0), (0.0, 300.0), "N1", "N3", 14.0),  # crosses W1 at N1
            wall("W3", (300.0, 0.0), (500.0, 0.0), "N2", "N4", 10.0),  # continues W1 at N2
        ],
        [],
    )
    frames = {w.id: om._frame(w) for w in graph.walls}
    cands = [("W1", 0.0, 60.0, True), ("W1", 0.0, 20.0, True), ("W1", 250.0, 300.0, True)]
    assert om._off_junctions(graph, frames, cands) == [("W1", 9.0, 60.0, True), ("W1", 250.0, 300.0, True)]


# --- rulings R17-a and R17-b -------------------------------------------------------------------------------


def door_across_an_unbroken_wall(arc: bool = True) -> np.ndarray:
    """The top wall drawn on across a door (the HDB entrance's bold stroke): the leaf stands on the wall's
    lower face at x 400, 90 px into the room; its arc closes on the face at x 490."""
    img = render_plan(SIZE, room())
    hinge = (400, 507)
    cv2.line(img, hinge, (400, 507 + 90), (0, 0, 0), 2)
    if arc:
        cv2.ellipse(img, hinge, (90, 90), 0, 0, 90, (0, 0, 0), 2)
    return img


def test_leaf_and_arc_make_a_door_across_an_unbroken_wall() -> None:
    """Ruling R17-a: a leaf with its swing arc whose hinge is on a wall's line is a door of that wall, even
    where the wall is drawn on across it."""
    r, _, ops = openings_on_top(door_across_an_unbroken_wall())
    assert r.graph.gaps == []  # precondition: no gap to classify
    (o,) = ops
    assert (o.kind, o.type, o.hinge, o.swing) == ("door", "single_swing", "start", "right")
    assert o.u0 == pytest.approx(300, abs=6) and o.u1 == pytest.approx(390, abs=8)


def test_leaf_without_an_arc_is_no_door() -> None:
    _, _, ops = openings_on_top(door_across_an_unbroken_wall(arc=False))
    assert ops == []


def grey_wall_room(panel: bool = True) -> np.ndarray:
    """A colour brochure's walls: slate grey (RGB 109 102 85) with, in the top wall over x 400 .. 460, a
    neutral grey panel (RGB 128 128 128) between black end lines."""
    slate = (85, 102, 109)  # BGR
    pts = [(100, 500), (900, 500), (900, 1100), (100, 1100)]
    img = render_plan(SIZE, [SWall(pts[i], pts[(i + 1) % 4], 20, color=slate) for i in range(4)])
    if panel:
        img[490:511, 400:461] = (128, 128, 128)
        img[490:511, 399:401] = img[490:511, 460:462] = (0, 0, 0)
    return img


@pytest.mark.parametrize("kind", ["colored_brochure", "architectural_line_drawing"])
def test_grey_panel_in_a_grey_wall_is_a_window_of_a_colour_plan(kind: str) -> None:
    """Ruling R17-b: a lighter grey panel inside a grey-filled wall is a window on a colour brochure plan,
    nothing on a line drawing. The panel is solid ink like the wall: there is no break to find."""
    r = run(grey_wall_room())
    pre = dataclasses.replace(r.pre, drawing_kind=kind)
    wall = top_wall(r.graph)
    ops = [
        as_drawn(o, wall) for o in find_openings(r.graph, pre, r.segments, r.pre.ink) if o.wall_id == wall.id
    ]
    if kind == "architectural_line_drawing":
        assert ops == []
        return
    (o,) = ops
    assert (o.kind, o.type) == ("window", "fixed")
    assert o.u0 == pytest.approx(300, abs=6) and o.u1 == pytest.approx(360, abs=6)


def test_uniform_grey_wall_has_no_panel() -> None:
    r = run(grey_wall_room(panel=False))
    pre = dataclasses.replace(r.pre, drawing_kind="colored_brochure")
    assert find_openings(r.graph, pre, r.segments, r.pre.ink) == []
