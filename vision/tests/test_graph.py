"""Wall graph building (06 §8.1 steps 9-10): pure coordinates, no images."""

import math
import random
import time

import pytest

from app.pipeline.graph import EVIDENCE, build_wall_graph
from app.schemas.candidates import RawWall, WallGraph

R = 8.0
T = 12.0
L = 1000.0


def raw(p0, p1, t=T, source="filled", openings=()):  # type: ignore[no-untyped-def]
    return RawWall(p0, p1, t, source, tuple(openings))


def build(walls, *, r=R, t=T, long_side=L):  # type: ignore[no-untyped-def]
    return build_wall_graph(walls, r=r, t_median=t, L=long_side)


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


def rect_walls(w=1000.0, h=600.0, jitter=None, t=T):  # type: ignore[no-untyped-def]
    corners = [(0.0, 0.0), (w, 0.0), (w, h), (0.0, h)]
    out = []
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


def wall_between(g: WallGraph, n1: str, n2: str):  # type: ignore[no-untyped-def]
    hits = [w for w in g.walls if {w.a_node, w.b_node} == {n1, n2}]
    assert len(hits) == 1
    return hits[0]


def snapshot(g: WallGraph):  # type: ignore[no-untyped-def]
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

    # A 15 px wall joining two otherwise separate parts is kept.
    left, right = raw((0.0, 0.0), (300.0, 0.0)), raw((315.0, 0.0), (600.0, 0.0))
    assert len(build([left, right], r=6.0).walls) == 2  # the 15 px gap alone is no wall
    g = build([left, right, raw((300.0, 0.0), (315.0, 0.0))], r=6.0)
    assert len(g.walls) == 3
    short = [w for w in g.walls if math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) < 24]
    assert len(short) == 1
    assert short[0].free_ends == 0


def test_short_wall_inside_a_cycle_is_removed() -> None:
    # Rectangle whose left wall is split by a tiny 15 px wall: it does not join separate parts.
    walls = [
        raw((0.0, 0.0), (500.0, 0.0)),
        raw((500.0, 0.0), (500.0, 300.0)),
        raw((500.0, 300.0), (0.0, 300.0)),
        raw((0.0, 300.0), (0.0, 15.0)),
        raw((0.0, 15.0), (0.0, 0.0)),
    ]
    g = build(walls, r=6.0, t=12.0)
    assert len(g.walls) == 4  # the 15 px piece is gone; the left wall's top end is now free
    assert sorted(w.free_ends for w in g.walls) == [0, 0, 1, 1]


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
def test_evidence(source: str, evidence: float) -> None:
    g = build([raw((0.0, 0.0), (500.0, 0.0), source=source)])  # type: ignore[arg-type]
    assert g.walls[0].evidence == evidence
    assert EVIDENCE == {"filled": 1.0, "vector": 1.0, "double_line": 0.85, "single_line": 0.5}


# --- diagonal walls --------------------------------------------------------------------------------------


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


def test_nearly_parallel_diagonals_fall_back_to_centroid() -> None:
    walls = [raw((0.0, 0.0), (300.0, 100.0)), raw((302.0, 101.0), (600.0, 202.0))]
    g = build(walls, r=8.0)
    assert len(g.nodes) == 3
    mid = [p for p in g.nodes.values() if 100 < p[0] < 500]
    assert len(mid) == 1
    assert math.hypot(mid[0][0] - 301.0, mid[0][1] - 100.5) < 1e-6


def test_near_axis_tolerance() -> None:
    # 2 degrees off the x axis is "horizontal" (snapped flat); 5 degrees is a diagonal (kept slanted).
    flat = build([raw((0.0, 0.0), (500.0, 17.0))])
    assert flat.walls[0].a[1] == flat.walls[0].b[1]
    slanted = build([raw((0.0, 0.0), (500.0, 44.0))])
    assert slanted.walls[0].a[1] != slanted.walls[0].b[1]


# --- opening bookkeeping ---------------------------------------------------------------------------------


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


# --- robustness ------------------------------------------------------------------------------------------


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
