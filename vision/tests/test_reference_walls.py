"""Wall extraction on the two reference blueprints (Task 16b), end to end (`tests/support/reference.py`).

Truths:
- ``<stem>.walls.json`` is the P2 engine fixture geometry (the brief's acceptance truth), registered by a
  similarity on the four outer corners;
- ``<stem>.drawing-walls.json`` is traced from the images themselves (diagnostic truth, see the Task 16b
  report: the P2 fixtures are simplified recreations whose interior walls are up to ~1 m away from the
  drawn ones, and the HDB photo is ~4 % anisotropic, so no similarity registers it to 0.5 t).
"""

import numpy as np
import pytest

from tests.support.reference import (
    IMAGES,
    ChainResult,
    bounded_faces,
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
    """The brief's recall / precision targets, against the walls traced from the image itself."""
    r = chains[stem]
    m = wall_metrics(load_truth(stem, r.page, "drawing-walls"), r.graph)
    recall, precision = TARGETS[stem]
    assert m.recall >= recall, m
    assert m.precision >= precision, m


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


@pytest.mark.xfail(
    strict=True,
    reason="Task 16b blocker: the P2 fixtures are simplified recreations of the drawings (walls up to ~1 m "
    "off; HDB photo ~4 % anisotropic, similarity residuals up to 23 px > 0.5 t); needs a controller ruling",
)
@pytest.mark.parametrize("stem", list(IMAGES))
def test_p2_truth_recall_and_precision(chains: dict[str, ChainResult], stem: str) -> None:
    r = chains[stem]
    m = wall_metrics(load_truth(stem, r.page), r.graph)
    recall, precision = TARGETS[stem]
    assert m.recall >= recall and m.precision >= precision, m


@pytest.mark.xfail(
    strict=True,
    reason="Task 16b blocker: windows and slider doors between walls of different drawing styles (bold line, "
    "black block, double line) or wider than 18 t are not bridged by 06 §8.1 step 8; needs a ruling",
)
def test_hdb_outline_is_closed_and_rooms_are_faces(chains: dict[str, ChainResult]) -> None:
    r = chains["hdb-3room"]
    L = r.pre.region.long_side
    faces = [f for f in bounded_faces(r.graph) if f.area >= (0.03 * L) ** 2]
    assert outer_cycle_free_ends(r.graph) == 0
    assert len(faces) >= 8


def test_metrics_score_a_perfect_extraction() -> None:
    """The scorer itself: the truth scored against itself is 1 / 1, a copy shifted by less than 0.5 t still
    matches, and one far away does not."""
    from app.schemas.candidates import WallCandidate, WallGraph

    r = run_chain("brochure-2bhk")
    truth = load_truth("brochure-2bhk", r.page, "drawing-walls")

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
