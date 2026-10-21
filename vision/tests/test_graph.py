"""Wall graph building (06 §8.1 steps 9-10): pure coordinates, no images."""

import contextlib
import math
import random
import time
import tracemalloc
from collections.abc import Callable, Iterable
from typing import Any

import numpy as np
import pytest

from app.pipeline import graph as graphmod
from app.pipeline.graph import (
    EVIDENCE,
    MAX_RAW_WALLS,
    TooComplexError,
    build_wall_graph,
)
from app.schemas.candidates import RawWall, WallCandidate, WallGraph, WallSource
from app.utils.geometry import Pt

Snapshot = tuple[list[tuple[str, Pt]], list[tuple[Any, ...]], list[tuple[str, float, float]]]

R = 8.0
T = 12.0
L = 1000.0


def raw(
    p0: Pt,
    p1: Pt,
    t: float = T,
    source: WallSource = "filled",
    openings: Iterable[tuple[float, float]] = (),
) -> RawWall:
    return RawWall(p0, p1, t, source, tuple(openings))


def build(
    walls: list[RawWall],
    *,
    r: float = R,
    t: float = T,
    long_side: float = L,
    theta0: float = 0.0,
    check: Callable[[], None] | None = None,
) -> WallGraph:
    return build_wall_graph(walls, r=r, t_median=t, L=long_side, theta0_deg=theta0, check_deadline=check)


# Endpoint jitter (dx, dy) of the eight rectangle endpoints; every corner pair stays within r = 8.
JITTER = [
    (2.5, -1.5),
    (-2.0, 3.0),
    (1.0, 2.5),
    (-3.0, -1.0),
    (2.0, 2.0),
    (-1.5, -2.5),
    (3.0, 1.0),
    (-2.5, 0.5),
]


def rect_walls(
    w: float = 1000.0, h: float = 600.0, jitter: list[Pt] | None = None, t: float = T
) -> list[RawWall]:
    corners = [(0.0, 0.0), (w, 0.0), (w, h), (0.0, h)]
    out: list[RawWall] = []
    for i in range(4):
        a, b = corners[i], corners[(i + 1) % 4]
        ja = jitter[2 * i] if jitter else (0.0, 0.0)
        jb = jitter[2 * i + 1] if jitter else (0.0, 0.0)
        out.append(raw((a[0] + ja[0], a[1] + ja[1]), (b[0] + jb[0], b[1] + jb[1]), t))
    return out


def node_at(g: WallGraph, x: float, y: float, tol: float = 1e-6) -> str:
    hits = [k for k, p in g.nodes.items() if math.hypot(p[0] - x, p[1] - y) <= tol]
    assert len(hits) == 1, (x, y, g.nodes)
    return hits[0]


def wall_between(g: WallGraph, n1: str, n2: str) -> WallCandidate:
    hits = [w for w in g.walls if {w.a_node, w.b_node} == {n1, n2}]
    assert len(hits) == 1
    return hits[0]


def snapshot(g: WallGraph) -> Snapshot:
    return (
        sorted(g.nodes.items()),
        [
            (w.id, w.a, w.b, w.a_node, w.b_node, w.thickness_px, w.source, w.free_ends, w.openings_px)
            for w in g.walls
        ],
        [(x.wall_id, x.u0, x.u1) for x in g.gaps],
    )


def test_rectangle_jitter() -> None:
    walls = rect_walls(jitter=JITTER)
    g = build(walls)
    assert len(g.nodes) == 4
    assert len(g.walls) == 4
    assert all(w.free_ends == 0 for w in g.walls)
    # Vertical walls are the right (index 1) and left (index 3) ones; horizontal: top (0) and bottom (2).
    right_x = (walls[1].p0[0] + walls[1].p1[0]) / 2
    left_x = (walls[3].p0[0] + walls[3].p1[0]) / 2
    top_y = (walls[0].p0[1] + walls[0].p1[1]) / 2
    bottom_y = (walls[2].p0[1] + walls[2].p1[1]) / 2
    xs = sorted(p[0] for p in g.nodes.values())
    ys = sorted(p[1] for p in g.nodes.values())
    assert xs == [pytest.approx(left_x, abs=1e-9)] * 2 + [pytest.approx(right_x, abs=1e-9)] * 2
    assert ys == [pytest.approx(top_y, abs=1e-9)] * 2 + [pytest.approx(bottom_y, abs=1e-9)] * 2
    # Right angles: every wall is exactly axis-parallel.
    for w in g.walls:
        assert w.a[0] == w.b[0] or w.a[1] == w.b[1]
    assert [w.id for w in g.walls] == ["W1", "W2", "W3", "W4"]
    assert sorted(g.nodes) == ["N1", "N2", "N3", "N4"]
    assert g.nodes["N1"] == (pytest.approx(left_x), pytest.approx(top_y))  # (y, x) order: top-left first


def test_t_junction_split() -> None:
    walls = [*rect_walls(), raw((500.0, 0.0), (500.0, 600.0))]
    g = build(walls)
    assert len(g.walls) == 7
    assert len(g.nodes) == 6
    top_mid = node_at(g, 500.0, 0.0)
    bottom_mid = node_at(g, 500.0, 600.0)
    tl, tr = node_at(g, 0.0, 0.0), node_at(g, 1000.0, 0.0)
    bl, br = node_at(g, 0.0, 600.0), node_at(g, 1000.0, 600.0)
    wall_between(g, tl, top_mid)
    wall_between(g, top_mid, tr)
    wall_between(g, bl, bottom_mid)
    wall_between(g, bottom_mid, br)
    wall_between(g, top_mid, bottom_mid)
    assert all(w.free_ends == 0 for w in g.walls)


def test_t_junction_with_jitter_snaps_stem_onto_both_walls() -> None:
    walls = [*rect_walls(), raw((503.0, 4.0), (497.0, 596.0))]
    g = build(walls)
    assert len(g.walls) == 7
    assert len(g.nodes) == 6
    stem_x = 500.0
    assert sum(1 for p in g.nodes.values() if p[0] == pytest.approx(stem_x)) == 2
    # The split halves stay on the original horizontal line.
    assert {p[1] for p in g.nodes.values()} == {0.0, 600.0}


def test_l_closure_extension() -> None:
    # The right wall stops 10 px short of the bottom wall's centre line.
    walls = [
        raw((0.0, 0.0), (1000.0, 0.0)),
        raw((1000.0, 0.0), (1000.0, 590.0)),
        raw((0.0, 600.0), (1000.0, 600.0)),
        raw((0.0, 0.0), (0.0, 600.0)),
    ]
    g = build(walls, r=6.0, t=12.0)
    assert len(g.nodes) == 4
    assert len(g.walls) == 4
    assert all(w.free_ends == 0 for w in g.walls)
    br = node_at(g, 1000.0, 600.0)
    right = [w for w in g.walls if br in (w.a_node, w.b_node) and w.a[0] == 1000.0 and w.b[0] == 1000.0]
    assert len(right) == 1


def test_free_end_extends_into_t_junction_on_wall_interior() -> None:
    walls = [raw((0.0, 100.0), (500.0, 100.0)), raw((250.0, 0.0), (250.0, 90.0))]
    g = build(walls, r=6.0, t=12.0)
    assert len(g.walls) == 3
    junction = node_at(g, 250.0, 100.0)
    stem = [w for w in g.walls if junction in (w.a_node, w.b_node) and w.a[0] == w.b[0]]
    assert len(stem) == 1
    assert stem[0].free_ends == 1  # the stem's top end is still free
    assert sorted(w.free_ends for w in g.walls) == [1, 1, 1]


def test_free_end_beyond_reach_is_not_extended() -> None:
    walls = [raw((0.0, 100.0), (500.0, 100.0)), raw((250.0, 0.0), (250.0, 75.0))]  # 25 px short > r + t = 18
    g = build(walls, r=6.0, t=12.0)
    assert len(g.walls) == 2
    assert all(w.free_ends == 2 for w in g.walls)


def test_extension_ignores_nearly_parallel_walls() -> None:
    # The end is 3 px off the centre line along a 10 degree ray: reachable, but too shallow to count as a hit.
    shallow = [raw((0.0, 100.0), (500.0, 100.0)), raw((101.5, 79.6), (200.0, 97.0))]
    assert len(build(shallow, r=1.0, t=20.0).walls) == 2
    steep = [raw((0.0, 100.0), (500.0, 100.0)), raw((200.0, 40.0), (200.0, 97.0))]
    assert len(build(steep, r=1.0, t=20.0).walls) == 3  # same gap, perpendicular: extended and split


def test_duplicates_removed_on_same_node_pair() -> None:
    # Too far apart to merge as one collinear detection (offset 4 > t/2), but the ends share nodes.
    walls = [
        raw((0.0, 0.0), (400.0, 0.0), t=6.0),
        raw((0.0, 4.0), (400.0, 4.0), t=6.0, source="double_line"),
        raw((0.0, 0.0), (0.0, 300.0), t=6.0),
        raw((400.0, 0.0), (400.0, 300.0), t=6.0),
    ]
    g = build(walls, t=6.0)
    assert len(g.nodes) == 4
    assert len(g.walls) == 3
    top = [w for w in g.walls if w.a[1] == w.b[1]]
    assert len(top) == 1
    assert top[0].source == "filled"  # the stronger source wins


def test_duplicate_choice_does_not_depend_on_input_order() -> None:
    a = raw((0.0, 0.0), (400.0, 0.0), t=6.0)
    b = raw((0.0, 4.0), (400.0, 4.0), t=7.0)  # same source, same node pair, other thickness and line
    for walls in ([a, b], [b, a]):
        g = build(walls, t=6.0)
        assert len(g.walls) == 1
        assert g.walls[0].thickness_px == 6.0
        assert g.walls[0].a[1] == 0.0


def test_collinear_overlapping_detections_merge_into_one_wall() -> None:
    walls = [
        raw((0.0, 0.0), (600.0, 0.0), source="double_line", openings=[(100.0, 200.0)]),
        raw((400.0, 1.0), (1000.0, 1.5), source="filled", openings=[(0.0, 50.0)]),
        raw((50.0, -1.0), (350.0, 0.0), source="single_line"),
    ]
    g = build(walls)
    assert len(g.walls) == 1
    w = g.walls[0]
    assert (w.a[0], w.b[0]) == (pytest.approx(0.0, abs=1.0), pytest.approx(1000.0, abs=1.0))
    assert w.source == "filled"
    assert w.free_ends == 2
    assert w.openings_px == (
        (pytest.approx(100.0, abs=1.0), pytest.approx(200.0, abs=1.0)),
        (pytest.approx(400.0, abs=1.0), pytest.approx(450.0, abs=1.0)),
    )


def test_collinear_walls_separated_by_gap_stay_separate() -> None:
    walls = [raw((0.0, 0.0), (400.0, 0.0)), raw((460.0, 0.0), (900.0, 0.0))]
    g = build(walls)
    assert len(g.walls) == 2
    assert [w.free_ends for w in g.walls] == [2, 2]
    assert len(g.nodes) == 4


def test_short_wall_removed_unless_bridging() -> None:
    # A 15 px stub (< 2t = 24) dangling off a long wall is removed, and the split it caused is undone.
    for stub in (raw((250.0, 0.0), (250.0, 15.0)), raw((250.0, 5.0), (250.0, 20.0))):
        g = build([raw((0.0, 0.0), (500.0, 0.0)), stub])
        assert len(g.walls) == 1
        assert len(g.nodes) == 2
        assert g.walls[0].free_ends == 2

    # A 15 px wall joining two otherwise separate parts is kept (a jog: the two long walls are 15 px apart).
    left, right = raw((0.0, 0.0), (300.0, 0.0)), raw((300.0, 15.0), (600.0, 15.0))
    jog = raw((300.0, 0.0), (300.0, 15.0))
    assert len(build([left, right], r=6.0).walls) == 2
    g = build([left, right, jog], r=6.0)
    assert len(g.walls) == 3
    short = [w for w in g.walls if math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) < 24]
    assert len(short) == 1
    assert short[0].free_ends == 0


def test_dangling_short_walls_are_removed_in_a_cascade() -> None:
    # Two short walls in a row hang off a long one; the outer one dangles first, then the inner one.
    long_wall = raw((0.0, 0.0), (500.0, 0.0))
    chain = [raw((250.0, 0.0), (250.0, 14.0)), raw((250.0, 14.0), (264.0, 14.0))]
    g = build([long_wall, *chain])
    assert len(g.walls) == 1
    assert len(g.nodes) == 2


def test_short_wall_threshold_is_two_t_or_one_percent_of_long_side() -> None:
    stub = [raw((0.0, 0.0), (500.0, 0.0)), raw((250.0, 0.0), (250.0, 30.0))]
    assert len(build(stub, t=12.0, long_side=1000.0).walls) == 3  # 30 px >= max(24, 10)
    assert len(build(stub, t=12.0, long_side=4000.0).walls) == 1  # 30 px < max(24, 40): L governs
    assert len(build(stub, t=16.0, long_side=1000.0).walls) == 1  # 30 px < 2 t = 32: t governs


def test_short_wall_on_a_cycle_is_kept() -> None:
    # A 21 px chamfer closes the top-left corner of a rectangle: short, but both ends are attached.
    walls = [
        raw((15.0, 0.0), (500.0, 0.0)),
        raw((500.0, 0.0), (500.0, 300.0)),
        raw((500.0, 300.0), (0.0, 300.0)),
        raw((0.0, 300.0), (0.0, 15.0)),
        raw((0.0, 15.0), (15.0, 0.0)),
    ]
    g = build(walls, r=6.0, t=12.0)
    assert len(g.walls) == 5
    assert all(w.free_ends == 0 for w in g.walls)


def test_isolated_tiny_wall_is_removed() -> None:
    g = build([raw((0.0, 0.0), (500.0, 0.0)), raw((100.0, 300.0), (100.0, 315.0))])
    assert len(g.walls) == 1


def make_complex_plan() -> list[RawWall]:
    walls = rect_walls(jitter=JITTER)
    walls += [
        raw(
            (503.0, 4.0),
            (497.0, 596.0),
            t=8.0,
            source="double_line",
            openings=[(100.0, 180.0), (250.0, 330.0)],
        ),
        raw((0.0, 300.0), (500.0, 300.0), source="single_line"),
        raw((250.0, 300.0), (700.0, 300.0), source="single_line"),  # overlaps the previous one
        raw((1000.0, 300.0), (760.0, 300.0), t=10.0),
        raw((760.0, 300.0), (1000.0, 120.0), t=10.0),  # diagonal
        raw((700.0, 0.0), (700.0, 280.0), source="vector"),  # free end 20 px short -> too far
        raw((900.0, 0.0), (900.0, 90.0)),
        # Two equal-length detections of one free-standing wall: the merge must not depend on their order.
        raw((100.0, 450.0), (400.0, 450.0), t=9.0, source="double_line"),
        raw((100.0, 451.3), (400.0, 451.3), t=11.0, source="single_line", openings=[(30.0, 90.0)]),
    ]
    return walls


def test_ids_deterministic_under_shuffling_and_endpoint_swaps() -> None:
    base = make_complex_plan()
    ref = snapshot(build(base))
    assert len(ref[1]) > 8
    rng = random.Random(12345)
    for _ in range(15):
        perm = list(base)
        rng.shuffle(perm)
        assert snapshot(build(perm)) == ref
    # Swapping p0/p1 (with openings measured from the new p0) describes the same drawing.
    flipped = []
    for w in base:
        length = math.hypot(w.p1[0] - w.p0[0], w.p1[1] - w.p0[1])
        ops = tuple(sorted((length - u1, length - u0) for u0, u1 in w.openings_px))
        flipped.append(RawWall(w.p1, w.p0, w.thickness_px, w.source, ops))
    rng.shuffle(flipped)
    got = snapshot(build(flipped))
    assert [(w[0], w[3], w[4]) for w in got[1]] == [(w[0], w[3], w[4]) for w in ref[1]]
    for gw, rw in zip(got[1], ref[1], strict=True):
        assert gw[1] == pytest.approx(rw[1], abs=1e-6)
        assert gw[2] == pytest.approx(rw[2], abs=1e-6)


def test_ids_follow_geometric_order() -> None:
    g = build(rect_walls())
    assert g.nodes == {"N1": (0.0, 0.0), "N2": (1000.0, 0.0), "N3": (0.0, 600.0), "N4": (1000.0, 600.0)}
    assert [(w.a_node, w.b_node) for w in g.walls] == [("N1", "N2"), ("N1", "N3"), ("N2", "N4"), ("N3", "N4")]
    assert [w.id for w in g.walls] == ["W1", "W2", "W3", "W4"]


@pytest.mark.parametrize(
    ("source", "evidence"), [("filled", 1.0), ("vector", 1.0), ("double_line", 0.85), ("single_line", 0.5)]
)
def test_evidence(source: WallSource, evidence: float) -> None:
    g = build([raw((0.0, 0.0), (500.0, 0.0), source=source)])
    assert g.walls[0].evidence == evidence
    assert EVIDENCE == {"filled": 1.0, "vector": 1.0, "double_line": 0.85, "single_line": 0.5}


# --- diagonal walls --------------------------------------------------------------------------------


def test_diagonal_wall_between_two_axis_walls() -> None:
    # Chamfered corner: vertical x = 0 down to y = 300, 45 deg wall to (100, 400), horizontal y = 400 on.
    walls = [
        raw((1.0, 0.0), (-1.0, 298.0)),  # vertical, mean x = 0
        raw((2.0, 301.0), (99.0, 397.0)),  # 45 degrees, ends a little off the axis walls
        raw((100.0, 401.0), (400.0, 399.0)),  # horizontal, mean y = 400
    ]
    g = build(walls)
    assert len(g.nodes) == 4
    assert len(g.walls) == 3
    # Node 1: x fixed by the vertical wall, y where the diagonal crosses x = 0 (its line: y = x + 300.x).
    diag = [w for w in g.walls if w.a[0] != w.b[0] and w.a[1] != w.b[1]]
    assert len(diag) == 1
    n_upper = g.nodes[diag[0].a_node]
    n_lower = g.nodes[diag[0].b_node]
    assert n_upper[0] == pytest.approx(0.0, abs=1e-9)
    assert n_lower[1] == pytest.approx(400.0, abs=1e-9)
    # Both nodes sit on the diagonal's own centre line (slope ~1 through its raw endpoints).
    (x0, y0), (x1, y1) = walls[1].p0, walls[1].p1
    slope = (y1 - y0) / (x1 - x0)
    assert n_upper[1] == pytest.approx(y0 + slope * (0.0 - x0), abs=1e-6)
    assert n_lower[0] == pytest.approx(x0 + (400.0 - y0) / slope, abs=1e-6)
    # Axis walls stay exactly axis-parallel.
    axis = [w for w in g.walls if w is not diag[0]]
    assert all(w.a[0] == w.b[0] or w.a[1] == w.b[1] for w in axis)


def test_two_diagonals_meet_at_least_squares_intersection() -> None:
    # An apex at (100, 0) of lines y = x - 100 ... use slopes +1 and -1 with endpoints jittered.
    walls = [
        raw((0.0, 100.0), (97.0, 3.0)),  # line x + y = 100
        raw((104.0, 4.0), (200.0, 100.0)),  # line y = x - 100
    ]
    g = build(walls, r=12.0)
    assert len(g.nodes) == 3
    apex = [p for p in g.nodes.values() if p[1] < 50]
    assert len(apex) == 1
    assert apex[0][0] == pytest.approx(100.0, abs=1e-6)
    assert apex[0][1] == pytest.approx(0.0, abs=1e-6)


def test_axis_wall_end_and_diagonal_keep_axis_coordinate() -> None:
    # Vertical wall + diagonal: x from the vertical wall (exact), y from the intersection with the diagonal.
    walls = [raw((50.0, 0.0), (50.0, 200.0)), raw((52.0, 203.0), (150.0, 300.0))]
    g = build(walls, r=8.0)
    corner = [p for p in g.nodes.values() if 100 < p[1] < 260]
    assert len(corner) == 1
    assert corner[0][0] == pytest.approx(50.0, abs=1e-9)
    slope = (300.0 - 203.0) / (150.0 - 52.0)
    assert corner[0][1] == pytest.approx(203.0 + slope * (50.0 - 52.0), abs=1e-6)


def test_near_axis_tolerance_is_three_degrees() -> None:
    def tilt(deg: float) -> WallCandidate:
        w = build([raw((0.0, 0.0), (500.0, 500.0 * math.tan(math.radians(deg))))]).walls[0]
        return w

    assert tilt(2.8).a[1] == tilt(2.8).b[1]  # snapped flat
    assert tilt(3.3).a[1] != tilt(3.3).b[1]  # kept as a diagonal


# --- opening bookkeeping ---------------------------------------------------------------------------


def test_openings_rebased_when_wall_is_split() -> None:
    walls = [
        raw((0.0, 0.0), (1000.0, 0.0), openings=[(100.0, 200.0), (450.0, 600.0), (800.0, 900.0)]),
        raw((500.0, 0.0), (500.0, 400.0)),
    ]
    g = build(walls)
    assert len(g.walls) == 3
    left = next(w for w in g.walls if w.a == (0.0, 0.0) and w.b == (500.0, 0.0))
    right = next(w for w in g.walls if w.a == (500.0, 0.0) and w.b == (1000.0, 0.0))
    stem = next(w for w in g.walls if w.a == (500.0, 0.0) and w.b == (500.0, 400.0))
    assert left.openings_px == ((100.0, 200.0), (450.0, 500.0))  # the straddling interval is cut
    assert right.openings_px == ((0.0, 100.0), (300.0, 400.0))  # ... and re-based on the right half's a
    assert stem.openings_px == ()
    gaps = sorted((x.wall_id, x.u0, x.u1) for x in g.gaps)
    assert gaps == sorted(
        [
            (left.id, 100.0, 200.0),
            (left.id, 450.0, 500.0),
            (right.id, 0.0, 100.0),
            (right.id, 300.0, 400.0),
        ]
    )


def test_openings_follow_wall_orientation_flips() -> None:
    # Given right-to-left (p0 at x = 1000): the interval (100, 200) from p0 lies at x in [800, 900].
    g = build([raw((1000.0, 0.0), (0.0, 0.0), openings=[(100.0, 200.0)])])
    assert g.walls[0].a == (0.0, 0.0)
    assert g.walls[0].openings_px == ((800.0, 900.0),)
    assert [(x.wall_id, x.u0, x.u1) for x in g.gaps] == [("W1", 800.0, 900.0)]


def test_openings_merged_and_clipped() -> None:
    g = build(
        [
            raw(
                (0.0, 0.0),
                (300.0, 0.0),
                openings=[(250.0, 400.0), (50.0, 120.0), (100.0, 160.0), (-30.0, 20.0)],
            )
        ]
    )
    assert g.walls[0].openings_px == ((0.0, 20.0), (50.0, 160.0), (250.0, 300.0))


def test_openings_split_at_t_junction_on_vertical_wall_and_reversed_stem() -> None:
    walls = [
        raw((0.0, 600.0), (0.0, 0.0), openings=[(100.0, 250.0)]),  # world y in [350, 500]
        raw((200.0, 400.0), (0.0, 400.0)),  # T onto the vertical wall at y = 400
    ]
    g = build(walls)
    upper = next(w for w in g.walls if w.a == (0.0, 0.0))
    lower = next(w for w in g.walls if w.a == (0.0, 400.0) and w.b == (0.0, 600.0))
    assert upper.openings_px == ((350.0, 400.0),)
    assert lower.openings_px == ((0.0, 100.0),)


# --- robustness ------------------------------------------------------------------------------------


def test_zero_length_and_self_merging_walls_are_dropped() -> None:
    walls = [
        raw((0.0, 0.0), (500.0, 0.0)),
        raw((300.0, 200.0), (300.0, 200.0)),  # zero length
        raw((100.0, 400.0), (103.0, 404.0)),  # both endpoints merge into one node (5 px < r)
        raw((500.0, 0.0), (500.0, 300.0)),
    ]
    g = build(walls)
    assert len(g.walls) == 2
    assert len(g.nodes) == 3
    assert not any(p == (300.0, 200.0) for p in g.nodes.values())


def test_empty_input() -> None:
    g = build([])
    assert g.nodes == {} and g.walls == [] and g.gaps == []


@pytest.mark.parametrize("bad", [math.nan, math.inf, -math.inf])
def test_non_finite_input_rejected(bad: float) -> None:
    with pytest.raises(ValueError, match="finite"):
        build([raw((0.0, 0.0), (500.0, 0.0)), raw((0.0, bad), (0.0, 300.0))])
    with pytest.raises(ValueError, match="finite"):
        build([raw((0.0, 0.0), (bad, 0.0))])
    with pytest.raises(ValueError, match="finite"):
        build([raw((0.0, 0.0), (500.0, 0.0), t=bad)])
    with pytest.raises(ValueError, match="finite"):
        build([raw((0.0, 0.0), (500.0, 0.0), openings=[(10.0, bad)])])


@pytest.mark.parametrize(
    "kw", [{"r": math.nan}, {"t": math.nan}, {"long_side": math.nan}, {"r": 0.0}, {"t": -1.0}]
)
def test_bad_parameters_rejected(kw: dict[str, float]) -> None:
    with pytest.raises(ValueError):
        build([raw((0.0, 0.0), (500.0, 0.0))], **kw)


def test_deadline_is_polled_and_its_error_propagates() -> None:
    calls = 0

    class ExpiredError(Exception):
        pass

    def check() -> None:
        nonlocal calls
        calls += 1

    build_wall_graph(make_complex_plan(), r=R, t_median=T, L=L, check_deadline=check)
    assert calls > 0

    def boom() -> None:
        raise ExpiredError

    with pytest.raises(ExpiredError):
        build_wall_graph(make_complex_plan(), r=R, t_median=T, L=L, check_deadline=boom)


def lattice(n: int, step: float, seed: int) -> list[RawWall]:
    rng = random.Random(seed)
    out = []

    def j() -> float:
        return rng.uniform(-2.0, 2.0)

    for iy in range(n):
        for ix in range(n):
            x, y = ix * step, iy * step
            if ix + 1 < n:
                out.append(raw((x + j(), y + j()), (x + step + j(), y + j()), t=10.0))
            if iy + 1 < n:
                out.append(raw((x + j(), y + j()), (x + j(), y + step + j()), t=10.0))
    rng.shuffle(out)
    return out


def test_perf_two_thousand_walls() -> None:
    walls = lattice(32, 100.0, seed=7)
    assert len(walls) == 1984
    walls += [raw((15.0, 3050.0), (15.0 + 40.0 * i, 3050.0)) for i in range(1, 17)]  # 2000 walls
    started = time.perf_counter()
    g = build_wall_graph(walls, r=8.0, t_median=10.0, L=3200.0)
    elapsed = time.perf_counter() - started
    assert elapsed < 2.0, elapsed
    assert len(g.nodes) >= 32 * 32
    assert len(g.walls) >= 1984
    assert all(w.free_ends <= 2 for w in g.walls)


# --- placement rules (06 8.1 step 9) ---------------------------------------------------------------


def test_node_x_is_the_mean_of_all_incident_vertical_walls() -> None:
    # Two collinear verticals at x = 100 and x = 104 (4 px apart: separate walls for t = 6) meet a horizontal.
    walls = [
        raw((100.0, 0.0), (100.0, 200.0), t=6.0),
        raw((104.0, 200.0), (104.0, 400.0), t=6.0),
        raw((0.0, 200.0), (101.0, 200.0), t=6.0),
    ]
    g = build(walls, t=6.0)
    junction = node_at(g, 102.0, 200.0)
    assert len(g.nodes) == 4
    assert g.nodes[junction] == (102.0, 200.0)


def test_node_y_is_the_mean_of_all_incident_horizontal_walls() -> None:
    walls = [
        raw((0.0, 100.0), (200.0, 100.0), t=6.0),
        raw((200.0, 106.0), (400.0, 106.0), t=6.0),
        raw((200.0, 0.0), (200.0, 101.0), t=6.0),
    ]
    g = build(walls, t=6.0)
    node_at(g, 200.0, 103.0)


def test_long_tilted_wall_end_is_not_dragged_by_the_axis_snap() -> None:
    # 1.15 degrees off vertical: an axis wall, but its mean x is 30 px from each end (> 2 r).
    g = build([raw((0.0, 0.0), (60.0, 3000.0))], long_side=3000.0)
    assert sorted(g.nodes.values()) == [(0.0, 0.0), (60.0, 3000.0)]
    # A slightly tilted wall (within 2 r) still snaps to right angles.
    g = build([raw((0.0, 0.0), (6.0, 3000.0))], long_side=3000.0)
    assert g.walls[0].a[0] == g.walls[0].b[0] == 3.0
    # The same holds for a horizontal wall.
    g = build([raw((0.0, 0.0), (3000.0, 60.0))], long_side=3000.0)
    assert sorted(g.nodes.values()) == [(0.0, 0.0), (3000.0, 60.0)]
    g = build([raw((0.0, 0.0), (3000.0, 6.0))], long_side=3000.0)
    assert g.walls[0].a[1] == g.walls[0].b[1] == 3.0


def _node_near(g: WallGraph, x: float, y: float, tol: float) -> Pt:
    hits = [p for p in g.nodes.values() if math.hypot(p[0] - x, p[1] - y) <= tol]
    assert len(hits) == 1, g.nodes
    return hits[0]


def _line_intersection(p: Pt, a_deg: float, q: Pt, b_deg: float) -> Pt:
    da, db = (
        (math.cos(math.radians(a_deg)), math.sin(math.radians(a_deg))),
        (
            math.cos(math.radians(b_deg)),
            math.sin(math.radians(b_deg)),
        ),
    )
    det = da[0] * -db[1] + db[0] * da[1]
    t = ((q[0] - p[0]) * -db[1] + db[0] * (q[1] - p[1])) / det
    return (p[0] + t * da[0], p[1] + t * da[1])


def _far(g: WallGraph, near: Pt, tol: float) -> list[Pt]:
    return [p for p in g.nodes.values() if math.hypot(p[0] - near[0], p[1] - near[1]) > tol]


def test_axis_wall_and_shallow_diagonal_with_near_intersection_use_the_centroid() -> None:
    # A 6 degree diagonal is within 10 degrees of the horizontal wall: the intersection (x ~ 308.8, within
    # 2 r of the centroid) is ill-conditioned and not used, the free coordinate comes from the centroid.
    a = math.radians(6.0)
    d0 = (304.0, -0.5)
    walls = [raw((0.0, 0.0), (300.0, 0.0)), raw(d0, (d0[0] + 300 * math.cos(a), d0[1] + 300 * math.sin(a)))]
    g = build(walls)
    assert (302.0, 0.0) in g.nodes.values()  # u: centroid of (300, 0), (304, -0.5) is 302; v: the wall's y


def test_axis_wall_and_diagonal_with_far_intersection_use_the_centroid() -> None:
    # 12 degrees: well-conditioned, but the lines meet 25 px from the centroid (> 2 r): not trusted.
    a = math.radians(12.0)
    d0 = (304.0, -5.0)
    walls = [raw((0.0, 0.0), (300.0, 0.0)), raw(d0, (d0[0] + 300 * math.cos(a), d0[1] + 300 * math.sin(a)))]
    g = build(walls)
    meet_x = d0[0] - d0[1] / math.tan(a)
    assert math.hypot(meet_x - 302.0, 2.5) > 2 * R
    assert (302.0, 0.0) in g.nodes.values()
    assert not any(abs(p[0] - meet_x) < 1.0 for p in g.nodes.values())


def test_diagonal_pair_nearly_parallel_with_near_intersection_uses_the_centroid() -> None:
    # 5 degrees apart: the least-squares point (~ (9.8, 6.8)) is within 2 r but ill-conditioned.
    p, q = (0.0, 0.0), (4.0, 2.0)
    w1 = raw(p, (200.0 * math.cos(math.radians(35)), 200.0 * math.sin(math.radians(35))))
    w2 = raw(q, (q[0] - 150.0 * math.cos(math.radians(40)), q[1] - 150.0 * math.sin(math.radians(40))))
    meet = _line_intersection(p, 35.0, q, 40.0)
    assert 1.0 < math.hypot(meet[0] - 2.0, meet[1] - 1.0) < 2 * R
    g = build([w1, w2])
    assert (2.0, 1.0) in g.nodes.values()


def test_diagonal_pair_12_degrees_apart_with_far_intersection_uses_the_centroid() -> None:
    p, q = (0.0, 0.0), (5.0, -3.0)
    w1 = raw(p, (200.0 * math.cos(math.radians(35)), 200.0 * math.sin(math.radians(35))))
    w2 = raw(q, (q[0] - 150.0 * math.cos(math.radians(47)), q[1] - 150.0 * math.sin(math.radians(47))))
    meet = _line_intersection(p, 35.0, q, 47.0)
    centroid = (2.5, -1.5)
    assert math.hypot(meet[0] - centroid[0], meet[1] - centroid[1]) > 2 * R
    g = build([w1, w2])
    assert _node_near(g, *centroid, 1e-9) == centroid
    assert not _far(g, centroid, 1e9) and all(
        math.hypot(n[0] - meet[0], n[1] - meet[1]) > 5 for n in g.nodes.values()
    )


# --- plan orientation (theta0) ---------------------------------------------------------------------


def _rotate(p: Pt, deg: float) -> Pt:
    c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    return (p[0] * c - p[1] * s, p[0] * s + p[1] * c)


def _rotated_plan(deg: float) -> list[RawWall]:
    base = [
        *rect_walls(jitter=JITTER),
        raw((503.0, 4.0), (497.0, 596.0), openings=[(100.0, 180.0)]),
        raw((0.0, 300.0), (500.0, 300.0)),
    ]
    return [
        RawWall(_rotate(w.p0, deg), _rotate(w.p1, deg), w.thickness_px, w.source, w.openings_px) for w in base
    ]


def test_theta0_rotated_plan_equals_the_unrotated_graph_rotated() -> None:
    ref = build(_rotated_plan(0.0))
    got = build(_rotated_plan(7.0), theta0=7.0)
    assert len(ref.walls) == len(got.walls) == 10
    assert sorted(ref.nodes) == sorted(got.nodes)
    for name, p in ref.nodes.items():
        q = _rotate(p, 7.0)
        assert got.nodes[name] == (pytest.approx(q[0], abs=1e-6), pytest.approx(q[1], abs=1e-6))

    # Node ids agree; wall ids follow the image-frame order, which rotating permutes: match by node pair.
    def by_pair(g: WallGraph) -> dict[tuple[str, str], WallCandidate]:
        return {(w.a_node, w.b_node): w for w in g.walls}

    ref_walls, got_walls = by_pair(ref), by_pair(got)
    assert sorted(ref_walls) == sorted(got_walls)
    for pair, rw in ref_walls.items():
        assert got_walls[pair].free_ends == rw.free_ends
        flat = [v for iv in got_walls[pair].openings_px for v in iv]
        assert flat == pytest.approx([v for iv in rw.openings_px for v in iv], abs=1e-6)
    # Without theta0 the same plan is all diagonal: nothing snaps to right angles.
    skew = build(_rotated_plan(7.0))
    assert skew.nodes != got.nodes


def test_theta0_is_compared_modulo_90() -> None:
    plan = _rotated_plan(-1.0)
    a = build(plan, theta0=89.0)
    assert a == build(plan, theta0=-1.0)
    assert a == build(plan, theta0=179.0)
    for w in a.walls:
        angle = math.degrees(math.atan2(w.b[1] - w.a[1], w.b[0] - w.a[0])) % 90.0
        assert angle == pytest.approx(89.0, abs=1e-6)  # every wall is exactly on the rotated axes


def test_theta0_must_be_finite() -> None:
    with pytest.raises(ValueError, match="finite"):
        build([raw((0.0, 0.0), (500.0, 0.0))], theta0=math.nan)


# --- crossings -------------------------------------------------------------------------------------


def test_plus_crossing_of_two_through_walls_is_split() -> None:
    g = build([raw((0.0, 100.0), (400.0, 100.0)), raw((200.0, 0.0), (200.0, 300.0))])
    assert len(g.nodes) == 5
    assert len(g.walls) == 4
    centre = node_at(g, 200.0, 100.0)
    assert all(centre in (w.a_node, w.b_node) for w in g.walls)
    assert sorted(w.free_ends for w in g.walls) == [1, 1, 1, 1]


def test_x_crossing_of_two_diagonals_is_split() -> None:
    g = build([raw((0.0, 0.0), (400.0, 400.0)), raw((400.0, 0.0), (0.0, 400.0))])
    assert len(g.nodes) == 5
    assert len(g.walls) == 4
    centre = node_at(g, 200.0, 200.0, tol=1e-6)
    assert all(centre in (w.a_node, w.b_node) for w in g.walls)


def test_crossing_with_an_offset_and_a_third_wall_shares_one_node() -> None:
    walls = [
        raw((0.0, 100.0), (400.0, 100.0)),
        raw((203.0, 0.0), (197.0, 300.0)),
        raw((0.0, 104.0), (400.0, 98.0)),  # nearly the same horizontal, 4 px off: no merge across t / 2
    ]
    g = build(walls, t=6.0)
    around = [p for p in g.nodes.values() if math.hypot(p[0] - 200.0, p[1] - 101.0) < 12.0]
    assert len(around) == 1


def test_overshooting_end_is_trimmed_to_a_t_junction() -> None:
    # The vertical wall pokes 12 px (> r) through the horizontal one: the stub is pruned, leaving a T.
    g = build([raw((0.0, 100.0), (500.0, 100.0)), raw((250.0, 0.0), (250.0, 112.0))])
    assert len(g.walls) == 3
    assert max(p[1] for p in g.nodes.values()) == 100.0
    assert sum(w.free_ends for w in g.walls) == 3


def test_end_poking_through_within_r_is_only_a_t_junction() -> None:
    g = build([raw((0.0, 100.0), (500.0, 100.0)), raw((250.0, 0.0), (250.0, 105.0))])
    assert len(g.walls) == 3 and len(g.nodes) == 4  # no extra crossing node 5 px from the end


def test_extension_never_trims_an_end_that_pokes_through() -> None:
    # r = 20 makes reach 32: a 28 px stub past the wall is real wall (>= 2 t), not something to pull back.
    walls = [raw((0.0, 100.0), (800.0, 100.0)), raw((400.0, 0.0), (400.0, 128.0))]
    g = build(walls, r=20.0, t=12.0)
    assert len(g.walls) == 4
    assert max(p[1] for p in g.nodes.values()) == 128.0
    assert sorted(w.free_ends for w in g.walls) == [1, 1, 1, 1]


def test_parallel_walls_do_not_cross() -> None:
    g = build([raw((0.0, 0.0), (500.0, 0.0)), raw((0.0, 40.0), (500.0, 40.0))])
    assert len(g.walls) == 2 and len(g.nodes) == 4


# --- gaps within r ---------------------------------------------------------------------------------


def test_collinear_walls_with_a_gap_within_r_merge_into_one_wall_with_an_opening() -> None:
    walls = [raw((0.0, 0.0), (400.0, 0.0), t=6.0), raw((415.0, 0.0), (800.0, 0.0), t=6.0)]
    g = build_wall_graph(walls, r=18.0, t_median=6.0, L=3000.0)
    assert len(g.walls) == 1 and len(g.nodes) == 2
    w = g.walls[0]
    assert w.free_ends == 2
    assert len(w.openings_px) == 1
    assert w.openings_px[0] == (pytest.approx(400.0, abs=1e-6), pytest.approx(415.0, abs=1e-6))
    assert [(x.wall_id, x.u0, x.u1) for x in g.gaps] == [("W1", w.openings_px[0][0], w.openings_px[0][1])]


def test_gap_merge_needs_collinearity_within_half_a_thickness() -> None:
    walls = [raw((0.0, 0.0), (400.0, 0.0), t=6.0), raw((415.0, 4.0), (800.0, 4.0), t=6.0)]  # 4 px off > t / 2
    g = build_wall_graph(walls, r=18.0, t_median=6.0, L=3000.0)
    assert len(g.walls) == 2 and len(g.nodes) == 3  # snapped together at a node instead
    assert not g.gaps


def test_gap_offset_limit_uses_t_median_even_for_thicker_walls() -> None:
    walls = [raw((0.0, 0.0), (400.0, 0.0), t=12.0), raw((415.0, 4.0), (800.0, 4.0), t=12.0)]
    g = build_wall_graph(walls, r=18.0, t_median=6.0, L=3000.0)  # 4 px off > t_median / 2 = 3
    assert not g.gaps and len(g.walls) == 2


def test_gap_longer_than_r_stays_open() -> None:
    walls = [raw((0.0, 0.0), (400.0, 0.0), t=6.0), raw((420.0, 0.0), (800.0, 0.0), t=6.0)]
    g = build_wall_graph(walls, r=18.0, t_median=6.0, L=3000.0)
    assert len(g.walls) == 2 and not g.gaps


def test_overlapping_facing_ends_merge_without_an_opening() -> None:
    walls = [raw((0.0, 0.0), (410.0, 0.0), t=6.0), raw((400.0, 0.0), (800.0, 0.0), t=6.0)]
    g = build_wall_graph(walls, r=18.0, t_median=6.0, L=3000.0)
    assert len(g.walls) == 1 and not g.gaps and not g.walls[0].openings_px


def test_sub_pixel_gap_merges_without_an_opening() -> None:
    walls = [raw((0.0, 0.0), (400.0, 0.0), t=6.0), raw((400.6, 0.0), (800.0, 0.0), t=6.0)]
    g = build_wall_graph(walls, r=18.0, t_median=6.0, L=3000.0)
    assert len(g.walls) == 1 and not g.gaps


def test_gap_beside_a_junction_is_not_bridged() -> None:
    # A wall T-joins in the gap: the two collinear halves are the two sides of a junction, not a door.
    walls = [
        raw((0.0, 0.0), (300.0, 0.0), t=6.0),
        raw((312.0, 0.0), (600.0, 0.0), t=6.0),
        raw((306.0, 3.0), (306.0, 300.0), t=6.0),
    ]
    g = build_wall_graph(walls, r=18.0, t_median=6.0, L=3000.0)
    assert not g.gaps
    assert len(g.walls) == 3


def test_three_collinear_pieces_chain_their_gaps() -> None:
    walls = [
        raw((0.0, 0.0), (200.0, 0.0), t=6.0),
        raw((210.0, 0.0), (400.0, 0.0), t=6.0),
        raw((415.0, 0.0), (600.0, 0.0), t=6.0),
    ]
    g = build_wall_graph(walls, r=18.0, t_median=6.0, L=3000.0)
    assert len(g.walls) == 1
    assert [(round(a, 6), round(b, 6)) for a, b in g.walls[0].openings_px] == [(200.0, 210.0), (400.0, 415.0)]


# --- surviving-mutant pins -------------------------------------------------------------------------


def test_extension_takes_the_nearest_hit() -> None:
    walls = [
        raw((0.0, 100.0), (500.0, 100.0)),
        raw((0.0, 110.0), (500.0, 110.0)),
        raw((250.0, 0.0), (250.0, 90.0)),  # reach r + t = 20: both walls are in range, 10 and 20 px ahead
    ]
    g = build(walls)
    node_at(g, 250.0, 100.0)
    assert not any(p == (250.0, 110.0) for p in g.nodes.values())


def test_extension_hit_may_lie_slightly_beyond_the_target_end_only() -> None:
    target = raw((0.0, 100.0), (100.0, 100.0))
    near = build([target, raw((106.0, 40.0), (106.0, 90.0))])  # 6 px past the end (<= r): L closure
    assert [w.free_ends for w in near.walls if w.a[0] == w.b[0]] == [1]
    far = build([target, raw((125.0, 40.0), (125.0, 90.0))])  # 25 px past: the end stays where it is
    stem = next(w for w in far.walls if w.a[0] == w.b[0])
    assert stem.b == (125.0, 90.0) and stem.free_ends == 2


def test_t_split_distance_bound_is_r() -> None:
    # The diagonal's end is 12 px from the horizontal wall (> r) and too shallow to extend onto it.
    a = math.radians(10.0)
    walls = [
        raw((0.0, 0.0), (500.0, 0.0)),
        raw((250.0, 12.0), (250.0 + 400 * math.cos(a), 12.0 + 400 * math.sin(a))),
    ]
    g = build(walls)
    assert len(g.walls) == 2
    near = [
        raw((0.0, 0.0), (500.0, 0.0)),
        raw((250.0, 7.0), (250.0 + 400 * math.cos(a), 7.0 + 400 * math.sin(a))),
    ]
    assert len(build(near).walls) == 3  # 7 px <= r: split and joined


def test_dedupe_unions_the_openings_of_walls_on_one_node_pair() -> None:
    walls = [
        raw((0.0, 0.0), (400.0, 0.0), t=6.0, openings=[(50.0, 100.0)]),
        raw((0.0, 4.0), (400.0, 4.0), t=6.0, openings=[(200.0, 260.0)]),
        raw((0.0, 0.0), (0.0, 300.0), t=6.0),
        raw((400.0, 0.0), (400.0, 300.0), t=6.0),
    ]
    g = build(walls, t=6.0)
    top = next(w for w in g.walls if w.a[1] == w.b[1])
    assert [(round(a), round(b)) for a, b in top.openings_px] == [(50, 100), (200, 260)]


def test_merged_thickness_and_position_are_weighted_by_length() -> None:
    walls = [raw((0.0, 0.0), (600.0, 0.0), t=6.0), raw((100.0, 2.0), (300.0, 2.0), t=12.0)]
    g = build(walls)
    assert len(g.walls) == 1
    assert g.walls[0].thickness_px == pytest.approx((600 * 6.0 + 200 * 12.0) / 800)
    assert g.walls[0].a[1] == g.walls[0].b[1] == pytest.approx(200 * 2.0 / 800)


def test_collinear_angle_limit_is_three_degrees() -> None:
    base = raw((0.0, 0.0), (600.0, 0.0))

    def short(deg: float) -> RawWall:  # a 60 px wall starting on the long one, tilted by deg
        a = math.radians(deg)
        return raw((100.0, 0.0), (100.0 + 60.0 * math.cos(a), 60.0 * math.sin(a)), t=12.0)

    assert len(build([base, short(2.0)]).walls) == 1  # fused
    assert len(build([base, short(5.0)]).walls) == 3  # T-joined, not fused


def test_opening_slivers_are_dropped_and_one_pixel_is_kept() -> None:
    g = build([raw((0.0, 0.0), (500.0, 0.0), openings=[(100.0, 100.9), (200.0, 201.0)])])
    assert g.walls[0].openings_px == ((200.0, 201.0),)
    split = build(
        [raw((0.0, 0.0), (1000.0, 0.0), openings=[(499.5, 560.0)]), raw((500.0, 0.0), (500.0, 400.0))]
    )
    right = next(w for w in split.walls if w.a == (500.0, 0.0) and w.b == (1000.0, 0.0))
    left = next(w for w in split.walls if w.b == (500.0, 0.0))
    assert left.openings_px == ()  # 0.5 px cut off
    assert right.openings_px == ((0.0, 60.0),)


def test_opening_intervals_adjacent_after_a_split_stay_separate() -> None:
    g = build([raw((0.0, 0.0), (1000.0, 0.0), openings=[(300.0, 700.0)]), raw((500.0, 0.0), (500.0, 400.0))])
    assert sorted(x.u1 - x.u0 for x in g.gaps) == [200.0, 200.0]


# --- chaining and scale ----------------------------------------------------------------------------


def fan(n: int, span: float = math.pi) -> list[RawWall]:
    return [
        raw(
            (500.0, 500.0),
            (500.0 + 400.0 * math.cos(span * i / n), 500.0 + 400.0 * math.sin(span * i / n)),
        )
        for i in range(n)
    ]


def test_overlap_merge_does_not_chain_across_a_fan() -> None:
    frame = graphmod._Frame.of(0.0)
    walls = graphmod._ingest(fan(2000), frame, None)
    merged = graphmod._merge_overlaps(walls, 8.0, 12.0, frame, None)
    # Neighbouring spokes chain through the pair test, but only those collinear with the seed fuse.
    assert len(merged) > 1000


def test_fan_of_well_separated_spokes_survives_the_whole_pipeline() -> None:
    g = build(fan(100), long_side=1000.0)  # far ends 12.6 px apart: separate nodes
    assert len(g.walls) == 100
    assert len(g.nodes) == 101


def test_slow_drift_chain_is_not_one_wall() -> None:
    # Ten overlapping 500 px pieces each rotated 1.5 degrees more than the last (15 degrees in total).
    pieces = []
    x, y = 0.0, 0.0
    for k in range(10):
        a = math.radians(1.5 * k)
        pieces.append(raw((x, y), (x + 500.0 * math.cos(a), y + 500.0 * math.sin(a))))
        x, y = x + 250.0 * math.cos(a), y + 250.0 * math.sin(a)
    g = build(pieces, long_side=5000.0)
    assert len(g.walls) > 1


def stacked_walls(n: int, seed: int = 0) -> list[RawWall]:
    rng = random.Random(seed)
    return [
        raw(
            (100.0 + rng.uniform(-3, 3), 100.0 + rng.uniform(-3, 3)),
            (900.0 + rng.uniform(-3, 3), 100.0 + rng.uniform(-3, 3)),
        )
        for _ in range(n)
    ]


def _timed(fn: Callable[[], Any]) -> tuple[Any, float, float]:
    """Result, seconds and peak traced memory (MB) of one call."""
    started = time.perf_counter()
    out = fn()
    seconds = time.perf_counter() - started
    tracemalloc.start()
    try:
        fn()
        peak = tracemalloc.get_traced_memory()[1] / 1e6
    finally:
        tracemalloc.stop()
    return out, seconds, peak


def test_ten_thousand_stacked_endpoints_are_cheap() -> None:
    pts = np.random.default_rng(0).uniform(-3, 3, (20_000, 2)) + 500.0
    labels, seconds, peak = _timed(lambda: graphmod._cluster(pts, 8.0))
    assert set(labels) == {0}
    assert seconds < 3.0 and peak < 300.0, (seconds, peak)
    g, seconds, peak = _timed(lambda: build(stacked_walls(10_000), long_side=1000.0))
    assert len(g.walls) == 1 and len(g.nodes) == 2
    assert seconds < 3.0 and peak < 300.0, (seconds, peak)


def test_ten_thousand_identical_walls_are_cheap() -> None:
    walls = [raw((100.0, 100.0), (900.0, 100.0)) for _ in range(MAX_RAW_WALLS)]
    g, seconds, peak = _timed(lambda: build(walls, long_side=1000.0))
    assert len(g.walls) == 1
    assert seconds < 3.0 and peak < 300.0, (seconds, peak)


def test_stacked_perpendicular_stubs_around_one_corner_are_cheap() -> None:
    rng = random.Random(3)
    walls = [raw((0.0, 0.0), (800.0, 0.0)), raw((0.0, 0.0), (0.0, 600.0))]
    for _ in range(150):  # short stubs whose ends are all stacked on the corner
        walls.append(
            raw((rng.uniform(-3, 3), rng.uniform(-3, 3)), (rng.uniform(-3, 3) + 30, rng.uniform(-3, 3) + 30))
        )
    g, seconds, peak = _timed(lambda: build(walls, long_side=1000.0))
    assert len(g.walls) >= 2
    assert seconds < 3.0 and peak < 300.0, (seconds, peak)


def test_too_many_raw_walls_raise_too_complex() -> None:
    walls = [raw((0.0, float(i)), (10.0, float(i))) for i in range(MAX_RAW_WALLS + 1)]
    with pytest.raises(TooComplexError) as info:
        build(walls)
    assert isinstance(info.value, ValueError)
    assert info.value.code == "too_complex"


class DeadlineError(Exception):
    pass


def _expire() -> None:
    raise DeadlineError


def test_deadline_aborts_the_endpoint_clustering_stage() -> None:
    pts = np.random.default_rng(1).uniform(0, 1000, (5000, 2))
    with pytest.raises(DeadlineError):
        graphmod._cluster(pts, 8.0, _expire)


def test_deadline_aborts_the_overlap_merge_stage() -> None:
    frame = graphmod._Frame.of(0.0)
    walls = graphmod._ingest(stacked_walls(500), frame, None)
    with pytest.raises(DeadlineError):
        graphmod._merge_overlaps(walls, 8.0, 12.0, frame, _expire)


def test_deadline_is_polled_repeatedly_while_stages_run() -> None:
    calls = 0

    def count() -> None:
        nonlocal calls
        calls += 1

    started = time.perf_counter()
    build(_star(6000), long_side=1000.0, check=count)
    seconds = time.perf_counter() - started
    # Polled repeatedly, but the build throttles the real check to once per 20 ms.
    assert 3 <= calls <= seconds / 0.02 + 5, (calls, seconds)


# --- deadline responsiveness and output bounds ---------------------------------------------------------


def _star(n: int, seed: int = 0) -> list[RawWall]:
    rng = random.Random(seed)
    return [
        raw(
            (500.0 + rng.uniform(-2, 2), 500.0 + rng.uniform(-2, 2)),
            (500.0 + 400.0 * math.cos(2 * math.pi * i / n), 500.0 + 400.0 * math.sin(2 * math.pi * i / n)),
        )
        for i in range(n)
    ]


def _parallel_near(n: int) -> list[RawWall]:
    return [
        raw((i * 0.5, 100.0 + (i % 7) * 1.2), (300.0 + i * 0.5, 100.0 + (i % 7) * 1.2), t=6.0)
        for i in range(n)
    ]


def _crossing_grid(n: int) -> list[RawWall]:
    walls = []
    for i in range(n):
        pos = 10.0 + i * (3000.0 / n)
        walls.append(raw((0.0, pos), (3000.0, pos), t=6.0))
        walls.append(raw((pos, 0.0), (pos, 3000.0), t=6.0))
    return walls


def _random_long(n: int, seed: int = 0) -> list[RawWall]:
    rng = random.Random(seed)
    walls = []
    for _ in range(n):
        a = rng.uniform(0, math.pi)
        x, y = rng.uniform(0, 3000), rng.uniform(0, 3000)
        walls.append(raw((x, y), (x + 1500 * math.cos(a), y + 1500 * math.sin(a)), t=6.0))
    return walls


@pytest.mark.parametrize(
    ("name", "walls", "kw"),
    [
        ("fan", lambda: fan(10_000), {"long_side": 1000.0}),
        ("parallel", lambda: _parallel_near(20_000), {"t": 6.0, "long_side": 3000.0}),
        ("star", lambda: _star(10_000), {"long_side": 1000.0}),
        ("grid", lambda: _crossing_grid(5000), {"t": 6.0, "long_side": 3000.0}),
    ],
)
def test_every_stage_aborts_within_a_second_of_the_deadline(
    name: str, walls: Callable[[], list[RawWall]], kw: dict[str, float]
) -> None:
    inputs = walls()
    started = time.perf_counter()

    def check() -> None:
        if time.perf_counter() - started > 1.0:
            raise DeadlineError

    with contextlib.suppress(DeadlineError, TooComplexError):
        build(inputs, check=check, **kw)  # type: ignore[arg-type]
    elapsed = time.perf_counter() - started
    assert elapsed < 2.0, (name, elapsed)


@pytest.mark.parametrize("make", [lambda: _crossing_grid(250), lambda: _random_long(5000)])
def test_walls_split_into_too_many_pieces_are_rejected_quickly(make: Callable[[], list[RawWall]]) -> None:
    inputs = make()

    def run() -> None:
        with pytest.raises(TooComplexError):
            build(inputs, t=6.0, long_side=3000.0)

    started = time.perf_counter()
    run()
    seconds = time.perf_counter() - started
    tracemalloc.start()
    try:
        run()
        peak = tracemalloc.get_traced_memory()[1] / 1e6
    finally:
        tracemalloc.stop()
    assert seconds < 2.0 and peak < 300.0, (seconds, peak)


def test_crossing_grid_below_the_cap_is_split_completely() -> None:
    g = build(_crossing_grid(40), t=6.0, long_side=3000.0)
    # 40 x 40 crossings; the 10 px stubs before the first ones are pruned, the 65 px ones after the last stay.
    assert len(g.nodes) == 40 * 40 + 2 * 40
    assert len(g.walls) == 2 * 40 * 40
    assert all(w.free_ends <= 1 for w in g.walls)


def test_crossing_grid_above_the_cap_is_too_complex() -> None:
    with pytest.raises(TooComplexError):
        build(_crossing_grid(110), t=6.0, long_side=3000.0)  # 2 * 110 * 111 = 24 420 > 20 000 pieces


# --- bridging: size, crossings ---------------------------------------------------------------------------


def test_gap_below_one_and_a_half_thicknesses_closes_silently() -> None:
    def pieces(gap: float) -> WallGraph:
        walls = [raw((0.0, 0.0), (400.0, 0.0)), raw((400.0 + gap, 0.0), (900.0, 0.0))]
        return build_wall_graph(walls, r=24.0, t_median=12.0, L=3000.0)

    closed = pieces(3.0)
    assert len(closed.walls) == 1 and not closed.gaps  # 3 px < 1.5 t = 18
    just_below = pieces(17.5)
    assert len(just_below.walls) == 1 and not just_below.gaps
    opening = pieces(20.0)
    assert len(opening.walls) == 1
    assert opening.walls[0].openings_px == ((pytest.approx(400.0), pytest.approx(420.0)),)


def test_gap_crossed_by_a_through_wall_is_not_bridged() -> None:
    walls = [
        raw((0.0, 0.0), (400.0, 0.0), t=6.0),
        raw((415.0, 0.0), (900.0, 0.0), t=6.0),
        raw((407.0, -200.0), (407.0, 200.0), t=6.0),  # runs across the gap
    ]
    g = build_wall_graph(walls, r=18.0, t_median=6.0, L=3000.0)
    assert not g.gaps and all(not w.openings_px for w in g.walls)
    horizontal = [w for w in g.walls if w.a[1] == w.b[1]]
    assert len(horizontal) == 2  # two walls meeting the through wall, not one bridged wall
    vertical = [w for w in g.walls if w.a[0] == w.b[0]]
    assert len(vertical) == 2  # the through wall is split where they meet it


# --- pins ---------------------------------------------------------------------------------------------------


def _hub(n_spokes: int, mirrored: bool = False) -> list[RawWall]:
    """One spoke along +x plus ``n_spokes - 1`` pointing left, and a short wall crossing the +x spoke.

    ``mirrored`` flips x, which swaps which end of the walls (in canonical order) is the hub.
    """
    walls = [raw((500.0, 500.0), (800.0, 500.0))]
    for k in range(n_spokes - 1):
        a = math.radians(100.0 + 160.0 * k / (n_spokes - 2))
        walls.append(raw((500.0, 500.0), (500.0 + 300.0 * math.cos(a), 500.0 + 300.0 * math.sin(a))))
    walls.append(raw((518.0, 460.0), (518.0, 540.0)))  # crosses the +x spoke 18 px from the hub
    if mirrored:
        walls = [
            RawWall((1000.0 - w.p0[0], w.p0[1]), (1000.0 - w.p1[0], w.p1[1]), w.thickness_px, w.source)
            for w in walls
        ]
    return walls


@pytest.mark.parametrize("mirrored", [False, True])
def test_crossings_near_a_big_hub_are_ignored_but_not_near_a_small_one(mirrored: bool) -> None:
    small = build(_hub(16, mirrored), long_side=1000.0)  # trim r = 8: the crossing at 18 px counts
    assert len(small.nodes) == 1 + 16 + 2 + 1
    big = build(_hub(64, mirrored), long_side=1000.0)  # trim r * 64 / 16 = 32 px: ignored
    assert len(big.nodes) == 1 + 64 + 2


def test_crossing_angle_threshold_is_three_degrees() -> None:
    def pair(deg: float) -> WallGraph:
        far = 8000.0
        walls = [
            raw((0.0, 0.0), (far, 0.0)),
            raw((0.0, -200.0), (far, -200.0 + far * math.tan(math.radians(deg)))),
        ]
        return build(walls, long_side=far)

    assert len(pair(2.0).walls) == 2  # crosses at 5.7 km but is nearly parallel: no split
    assert len(pair(4.0).walls) == 4


def test_crossing_points_within_r_of_each_other_share_one_node() -> None:
    walls = [
        raw((0.0, 100.0), (400.0, 100.0)),
        raw((200.0, 0.0), (200.0, 300.0)),
        raw((101.5, 0.0), (301.5, 200.0)),  # crosses the other two within 1.5 px of their crossing
    ]
    g = build(walls)
    assert len(g.nodes) == 7 and len(g.walls) == 6
    centre = node_at(g, 200.0, 100.0, tol=3.0)
    assert sum(centre in (w.a_node, w.b_node) for w in g.walls) == 6


def test_free_end_extension_follows_a_rotated_frame() -> None:
    def rot(p: Pt) -> Pt:
        return _rotate(p, 17.0)

    # The vertical wall stops 10 px short of the horizontal one (r = 6, t = 12: reach 18).
    flat = [raw((0.0, 0.0), (500.0, 0.0)), raw((500.0, 300.0), (500.0, 10.0))]
    turned = [RawWall(rot(w.p0), rot(w.p1), w.thickness_px, w.source) for w in flat]
    ref = build(flat, r=6.0, theta0=0.0)
    got = build(turned, r=6.0, theta0=17.0)
    assert len(ref.nodes) == len(got.nodes) == 3
    assert sorted(w.free_ends for w in got.walls) == sorted(w.free_ends for w in ref.walls) == [1, 1]
    for name, p in ref.nodes.items():
        q = rot(p)
        assert got.nodes[name] == (pytest.approx(q[0], abs=1e-6), pytest.approx(q[1], abs=1e-6))


def test_crossing_stage_rejects_on_the_split_estimate_before_building_any_index(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def forbidden(*args: Any, **kwargs: Any) -> None:
        raise AssertionError("an index was built before the crossing load was checked")

    monkeypatch.setattr(graphmod, "_SegIndex", forbidden)
    with pytest.raises(TooComplexError, match="too many pieces"):
        build(_crossing_grid(250), t=6.0, long_side=3000.0)


def test_crossing_stage_stops_when_the_actual_split_count_exceeds_the_cap(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(graphmod, "_estimate_split_walls", lambda *a, **k: 0.0)
    monkeypatch.setattr(graphmod, "_estimate_pairs", lambda *a, **k: 0.0)
    started = time.perf_counter()
    with pytest.raises(TooComplexError, match="too many pieces"):
        build(_crossing_grid(250), t=6.0, long_side=3000.0)
    assert time.perf_counter() - started < 5.0


def test_crossing_stage_rejects_dense_candidate_sets(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(graphmod, "_estimate_split_walls", lambda *a, **k: 0.0)
    monkeypatch.setattr(graphmod, "_MAX_CANDIDATE_PAIRS", 1000.0)
    with pytest.raises(TooComplexError, match="cross or touch"):
        build(_crossing_grid(10), t=6.0, long_side=3000.0)
    assert len(build([raw((0.0, 0.0), (400.0, 0.0)), raw((200.0, -100.0), (200.0, 100.0))]).walls) == 4


def test_pair_estimate_is_an_upper_bound_of_close_pairs() -> None:
    rng = np.random.default_rng(0)
    pts = rng.uniform(0, 300, (3000, 2))
    exact = int(graphmod.cKDTree(pts).count_neighbors(graphmod.cKDTree(pts), 20.0))
    assert exact <= graphmod._estimate_pairs(pts, 20.0, None) <= 4 * exact


def test_direction_of_axis_and_diagonal_walls_follows_theta0() -> None:
    frame = graphmod._Frame.of(17.0)
    c, s = math.cos(math.radians(17.0)), math.sin(math.radians(17.0))
    horizontal = graphmod._Line("h", 0.0, 0.0, 1.0, 0.0)
    vertical = graphmod._Line("v", 0.0, 1.0, 0.0, 0.0)
    assert graphmod._direction(horizontal, (0.0, 0.0), (10.0 * c, 10.0 * s), frame) == pytest.approx((c, s))
    assert graphmod._direction(horizontal, (10.0 * c, 10.0 * s), (0.0, 0.0), frame) == pytest.approx((-c, -s))
    assert graphmod._direction(vertical, (0.0, 0.0), (-10.0 * s, 10.0 * c), frame) == pytest.approx((-s, c))
    # A diagonal at 45 degrees in the rotated frame points at 62 degrees in the image.
    diag = graphmod._Line("d", 0.0, -math.sqrt(0.5), math.sqrt(0.5), 0.0)
    a = math.radians(62.0)
    assert graphmod._direction(diag, (0.0, 0.0), (math.cos(a), math.sin(a)), frame) == pytest.approx(
        (math.cos(a), math.sin(a))
    )


def test_segment_index_bounds_its_sample_count_and_keeps_the_spacing_honest() -> None:
    n = 3000
    p0 = np.array([(0.0, 10.0 * i) for i in range(n)])
    p1 = np.array([(3000.0, 10.0 * i) for i in range(n)])
    index = graphmod._SegIndex(p0, p1, 14.0)
    assert len(index.owner) <= graphmod._MAX_SAMPLES * 1.05
    assert index.step > 14.0
    # A point near the middle of a wall still finds it with the widened spacing.
    assert 1234 in index.near(np.array([[1500.0, 12340.0]]), 3.0)[0]


def test_throttled_deadline_runs_first_then_at_most_every_interval() -> None:
    calls = 0

    def check() -> None:
        nonlocal calls
        calls += 1

    poll = graphmod._throttled(check)
    assert poll is not None
    poll()
    assert calls == 1  # the first poll always reaches the real check
    for _ in range(1000):
        poll()
    assert calls <= 3
    assert graphmod._throttled(None) is None
