"""Wall extraction on the reference blueprints (Tasks 16b / 16c), end to end (`tests/support/reference.py`).

Truth: ``<stem>.drawing-walls.json``, the walls traced from the images themselves (ruling B1; the HDB
truth was corrected in Task 16c to the controller's centre-line convention, see its ``method`` note).
``<stem>.walls.json`` (the P2 engine fixture geometry, a simplified recreation of each drawing) is kept for
topology and room names only; its four registered outer corners locate the plan in the region tests.
"""

import numpy as np
import pytest

from tests.support.reference import (
    IMAGES,
    ChainResult,
    bounded_faces,
    enclosed_share,
    load_page,
    load_truth,
    outer_cycle_free_ends,
    run_chain,
    wall_metrics,
)

pytestmark = pytest.mark.reference

TARGETS = {"hdb-3room": (0.85, 0.85), "brochure-2bhk": (0.75, 0.75)}  # recall, precision (brief)


@pytest.fixture(scope="module")
def chains() -> dict[str, ChainResult]:
    return {stem: run_chain(stem) for stem in IMAGES}


@pytest.mark.parametrize("stem", list(IMAGES))
def test_full_chain_is_fast(chains: dict[str, ChainResult], stem: str) -> None:
    assert chains[stem].seconds["total"] < 10.0, chains[stem].seconds


def _to_page(result: ChainResult, pts: list[list[float]]) -> np.ndarray:
    a = np.hstack([np.array(pts, np.float64), np.ones((len(pts), 1))]) @ np.asarray(result.page.transform).T
    return np.asarray(a[:, :2] / a[:, 2:3])


def test_hdb_region_is_the_whole_plan(chains: dict[str, ChainResult]) -> None:
    """Ruling R4: the region holds the whole outline (it collapsed onto one black column before)."""
    r = chains["hdb-3room"]
    corners = _to_page(r, load_truth("hdb-3room", r.page).raw["registration"]["source_px"])
    for x, y in corners:
        assert r.pre.region.contains((x, y))
    assert r.pre.region.w > 0.75 * r.page.image.shape[1]


def test_brochure_region_excludes_the_key_plan_and_the_site_strip(chains: dict[str, ChainResult]) -> None:
    """Ruling R4 / 06 §16.3: the flat only; the site strip across the corridor (its walls start at source
    y 355) and the key plan below it are excluded, and no wall has its midpoint in the bottom 25 % of the
    image."""
    r = chains["brochure-2bhk"]
    corners = _to_page(r, load_truth("brochure-2bhk", r.page).raw["registration"]["source_px"])
    for x, y in corners:
        assert r.pre.region.contains((x, y))
    strip_top = _to_page(r, [[200.0, 355.0]])[0, 1]
    assert r.pre.region.y + r.pre.region.h < strip_top
    h = r.page.image.shape[0]
    assert all((w.a[1] + w.b[1]) / 2 < 0.75 * h for w in r.graph.walls)


@pytest.mark.parametrize("stem", list(IMAGES))
def test_traced_truth_recall_and_precision(chains: dict[str, ChainResult], stem: str) -> None:
    """The brief's recall / precision targets, against the walls traced from the image itself (the HDB
    truth corrected in Task 16c); the brochure must not fall below 0.90 / 0.85 (Task 16c)."""
    r = chains[stem]
    m = wall_metrics(load_truth(stem, r.page, "drawing-walls"), r.graph)
    recall, precision = TARGETS[stem]
    assert m.recall >= recall, m
    assert m.precision >= precision, m
    if stem == "brochure-2bhk":
        assert m.recall >= 0.90 and m.precision >= 0.85, m


def test_hdb_truth_closes_into_the_rooms() -> None:
    """The corrected HDB truth (Task 16c) is a closed wall graph: its centre lines bound the 10 room-like
    spaces (3 bedrooms, 3 toilets, the store, living with the open kitchen, the balcony and the 600 recess)
    plus the bay above toilet 3, and every changed wall carries the convention's kinds."""
    import json

    from shapely.geometry import LineString, Point
    from shapely.ops import polygonize, unary_union

    from tests.support.reference import REFERENCE_DIR

    raw = json.loads((REFERENCE_DIR / "hdb-3room.drawing-walls.json").read_text())
    nodes = raw["nodes"]
    faces = list(polygonize(unary_union([LineString([nodes[w["a"]], nodes[w["b"]]]) for w in raw["walls"]])))
    rooms = {  # a point inside each space, source px
        "toilet 1": (358, 272),
        "toilet 2": (707, 271),
        "toilet 3": (1048, 269),
        "bedroom 1": (522, 337),
        "bedroom 2": (844, 344),
        "bedroom 3": (980, 612),
        "store": (334, 422),
        "living / kitchen": (443, 588),
        "balcony": (670, 861),
        "600 recess": (860, 865),
        "bay": (1027, 147),
    }
    for name, p in rooms.items():
        assert sum(f.contains(Point(p)) for f in faces) == 1, name
    assert len(faces) == len(rooms)
    assert "convention" in raw["method"]
    assert {w["kind"] for w in raw["walls"]} == {"exterior", "interior", "half", "black", "jog"}


def test_hdb_outline_is_closed(chains: dict[str, ChainResult]) -> None:
    """Ruling B2: the HDB outer outline closes. No free wall end lies on the outer cycle (the truth's outer
    outline walls) and the extracted faces cover the dwelling the truth outlines."""
    r = chains["hdb-3room"]
    truth = load_truth("hdb-3room", r.page, "drawing-walls")
    assert outer_cycle_free_ends(r.graph, truth) == 0
    assert enclosed_share(r.graph, truth) >= 0.95


@pytest.mark.xfail(
    strict=True,
    reason="Task 16c blocker (NEEDS_CONTEXT): 3 bounded faces. The interior partitions break on rules beyond "
    "ruling B2: 1.5-2.5 t gaps (neither merged nor openings: the living-room slider, the brochure's toilet "
    "window), doors at a partition's end against a perpendicular wall (bedroom 3), face lines erased under "
    "labels (toilets 1 and 2) and dimension ticks or lines cutting partition faces (bedroom 2, toilet 3)",
)
def test_hdb_rooms_are_faces(chains: dict[str, ChainResult]) -> None:
    r = chains["hdb-3room"]
    L = r.pre.region.long_side
    assert len([f for f in bounded_faces(r.graph) if f.area >= (0.03 * L) ** 2]) >= 7


def test_brochure_outline_free_ends(chains: dict[str, ChainResult]) -> None:
    """The brief: brochure outer-cycle free ends <= 7 (the count before Task 16c, on Task 16b's definition);
    on the outer-outline definition the brochure has 2 (the toilet window's jambs, a 1.5-2.5 t gap)."""
    r = chains["brochure-2bhk"]
    assert outer_cycle_free_ends(r.graph, load_truth("brochure-2bhk", r.page, "drawing-walls")) <= 2


def test_metrics_score_a_perfect_extraction() -> None:
    """The scorer itself: the truth scored against itself is 1 / 1, a copy shifted by less than 0.5 t still
    matches, and one far away does not."""
    from app.schemas.candidates import WallCandidate, WallGraph

    truth = load_truth("brochure-2bhk", load_page("brochure-2bhk"), "drawing-walls")

    def graph(shift: float) -> WallGraph:
        walls = [
            WallCandidate(
                w.id,
                (w.a[0], w.a[1] + shift),
                (w.b[0], w.b[1] + shift),
                "a",
                "b",
                w.thickness_px,
                "filled",
                1.0,
                0,
                (),
            )
            for w in truth.walls
        ]
        return WallGraph(nodes={}, walls=walls, gaps=[])

    exact = wall_metrics(truth, graph(0.0))
    assert exact.recall == pytest.approx(1.0) and exact.precision == pytest.approx(1.0)
    near = wall_metrics(truth, graph(0.45 * min(w.thickness_px for w in truth.walls)))
    assert near.recall == pytest.approx(1.0)
    far = wall_metrics(truth, graph(10_000.0))
    assert far.recall == 0.0 and far.precision == 0.0
    assert far.extracted_len == pytest.approx(far.truth_len)


def _truth_graph(stem: str, drop: str | None = None) -> tuple[object, object]:
    """The truth as a wall graph (its walls, nodes shared by position), without wall ``drop``."""
    from app.schemas.candidates import WallCandidate, WallGraph

    truth = load_truth(stem, load_page(stem), "drawing-walls")
    walls = [w for w in truth.walls if w.id != drop]
    ids: dict[tuple[float, float], str] = {}
    for w in walls:
        for p in (w.a, w.b):
            ids.setdefault(p, f"N{len(ids) + 1}")
    degree = {n: 0 for n in ids.values()}
    for w in walls:
        degree[ids[w.a]] += 1
        degree[ids[w.b]] += 1
    out = [
        WallCandidate(
            w.id,
            w.a,
            w.b,
            ids[w.a],
            ids[w.b],
            w.thickness_px,
            "filled",
            1.0,
            int(degree[ids[w.a]] == 1) + int(degree[ids[w.b]] == 1),
            (),
        )
        for w in walls
    ]
    return WallGraph(nodes={n: p for p, n in ids.items()}, walls=out, gaps=[]), truth


@pytest.mark.parametrize("stem", list(IMAGES))
def test_outer_cycle_metrics_score_the_truth(stem: str) -> None:
    """The truth scores 0 outer-cycle free ends and encloses itself; with an outer wall removed (HDB: the
    living room's left wall piece X9b, brochure: W1) the free ends it leaves on the outline count."""
    graph, truth = _truth_graph(stem)
    assert outer_cycle_free_ends(graph, truth) == 0  # type: ignore[arg-type]
    assert enclosed_share(graph, truth) == pytest.approx(1.0)  # type: ignore[arg-type]
    broken, _ = _truth_graph(stem, drop={"hdb-3room": "X9b", "brochure-2bhk": "W1"}[stem])
    assert outer_cycle_free_ends(broken, truth) == 2  # type: ignore[arg-type]
