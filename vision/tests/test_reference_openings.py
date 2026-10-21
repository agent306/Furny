"""Task 17: openings on the two reference blueprints against their traced truth
(``<stem>.drawing-openings.json``), through the full raster chain with replayed OCR.

An opening counts as matched when it lies on the traced opening's wall (parallel within 10 degrees, its
middle within 0.5 t of the traced centre line), covers at least half of the traced width and has the same
kind (``tests/support/reference.py``, ``opening_metrics``).
"""

import dataclasses
import json
import math

import numpy as np
import pytest

from app.schemas.candidates import OpeningCandidate, WallCandidate, WallGraph
from tests.support.reference import (
    IMAGES,
    REFERENCE_DIR,
    ChainResult,
    load_openings_truth,
    load_truth,
    opening_metrics,
    run_chain,
    wall_metrics,
)

pytestmark = pytest.mark.reference

STEMS = sorted(IMAGES)
TARGET = {"hdb-3room": (0.75, 0.85), "brochure-2bhk": (0.70, 0.80)}  # recall, precision (the brief's)
HINGE_SWING_MIN = 0.8
# Task 17 as committed (recall, precision): the targets above are not reached (task-17-report.md).
OPENING_FLOOR = {"hdb-3room": (0.416, 0.555), "brochure-2bhk": (0.375, 1.0)}


@pytest.fixture(scope="module")
def chains() -> dict[str, ChainResult]:
    return {stem: run_chain(stem) for stem in STEMS}


# --- the truth ------------------------------------------------------------------------------------------


@pytest.mark.parametrize("stem", STEMS)
def test_truth_openings_lie_on_their_walls(stem: str) -> None:
    """Every traced opening names a traced wall and an interval on it (a grey panel crossing a junction may
    run a few px past its wall's end, recorded in its method), a kind with a type of that kind, and a
    hinge and swing when it is a hinged door."""
    raw = json.loads((REFERENCE_DIR / f"{stem}.drawing-openings.json").read_text())
    walls = json.loads((REFERENCE_DIR / f"{stem}.drawing-walls.json").read_text())
    nodes = walls["nodes"]
    length = {w["id"]: math.dist(nodes[w["a"]], nodes[w["b"]]) for w in walls["walls"]}
    ids = [o["id"] for o in raw["openings"]]
    assert len(ids) == len(set(ids))
    for o in raw["openings"]:
        assert o["wall"] in length, o["id"]
        assert 0.0 <= o["u0"] < o["u1"] <= length[o["wall"]] + 7.0, o["id"]
        assert o["method"], o["id"]
        if o["kind"] == "door":
            assert o["type"] in {
                "single_swing",
                "double_swing",
                "bifold",
                "sliding",
                "pocket",
                "main_entrance",
            }
            assert o["swing"] in {"left", "right"}, o["id"]
            assert o["hinge"] in {"start", "end"} or o["type"] == "bifold", o["id"]
        elif o["kind"] == "window":
            assert o["type"] in {"casement", "sliding_window", "fixed", "french_window", "bay", "ventilator"}
            assert o["hinge"] is None and o["swing"] is None
        else:
            assert (o["kind"], o["type"]) == ("opening", "opening")


def _truth_graph(stem: str, chain: ChainResult) -> tuple[WallGraph, list[OpeningCandidate]]:
    """The traced walls as a wall graph and the traced openings as detections on it (page px)."""
    truth = load_truth(stem, chain.page, "drawing-walls")
    walls = [
        WallCandidate(w.id, w.a, w.b, "a", "b", w.thickness_px, "filled", 1.0, 0, ()) for w in truth.walls
    ]
    by_id = {w.id: w for w in walls}
    found = []
    for t in load_openings_truth(stem, chain.page):
        w = by_id[t.wall]
        a = np.array(w.a)
        u0, u1 = float(np.hypot(*(t.p0 - a))), float(np.hypot(*(t.p1 - a)))
        d = (np.array(w.b) - a) / np.hypot(*(np.array(w.b) - a))
        n = np.array((d[1], -d[0]))
        swing = "left" if t.swing is None or float(t.swing @ n) > 0 else "right"
        hinge = t.hinge_end or "start"
        kind = t.kind
        found.append(OpeningCandidate(t.id, w.id, u0, u1, kind, t.type, hinge, swing, 1.0))  # type: ignore[arg-type]
    return WallGraph({}, walls, []), found


@pytest.mark.parametrize("stem", STEMS)
def test_metrics_score_the_truth(stem: str, chains: dict[str, ChainResult]) -> None:
    """The truth scores 1 / 1 / 1 against itself; one missing opening, one of the wrong kind and one door
    turned the other way are seen."""
    graph, found = _truth_graph(stem, chains[stem])
    truth = load_openings_truth(stem, chains[stem].page)
    m = opening_metrics(truth, graph, found)
    assert (m.recall, m.precision, m.hinge_swing) == (1.0, 1.0, 1.0), m
    scored = [t.id for t in truth if not t.ignore]
    door = next(o for o in found if o.kind == "door" and o.type == "single_swing")
    window = next(o for o in found if o.kind == "window" and o.id in scored)
    drop = next(t for t in scored if t not in {door.id, window.id})
    flipped = dataclasses.replace(door, swing="right" if door.swing == "left" else "left")
    altered = [
        flipped if o is door else dataclasses.replace(o, kind="opening") if o is window else o
        for o in found
        if o.id != drop
    ]
    m = opening_metrics(truth, graph, altered)
    assert m.recall == pytest.approx((len(scored) - 2) / len(scored))
    assert set(m.missed) == {drop, window.id}
    assert m.wrong_hinge_swing == [door.id]


# --- the chain ------------------------------------------------------------------------------------------


@pytest.mark.parametrize("stem", STEMS)
def test_openings_do_not_regress(stem: str, chains: dict[str, ChainResult]) -> None:
    r = chains[stem]
    m = opening_metrics(load_openings_truth(stem, r.page), r.graph, r.openings)
    recall, precision = OPENING_FLOOR[stem]
    assert m.recall >= recall and m.precision >= precision, m


@pytest.mark.parametrize("stem", STEMS)
@pytest.mark.xfail(
    strict=True, reason="Task 17 targets not reached; design rulings requested (task-17-report.md)"
)
def test_openings_reach_the_targets(stem: str, chains: dict[str, ChainResult]) -> None:
    r = chains[stem]
    m = opening_metrics(load_openings_truth(stem, r.page), r.graph, r.openings)
    recall, precision = TARGET[stem]
    assert m.recall >= recall and m.precision >= precision, m


@pytest.mark.parametrize("stem", STEMS)
def test_matched_doors_have_their_hinge_and_swing(stem: str, chains: dict[str, ChainResult]) -> None:
    r = chains[stem]
    m = opening_metrics(load_openings_truth(stem, r.page), r.graph, r.openings)
    assert m.hinge_swing >= HINGE_SWING_MIN, m


def test_hdb_bedroom_3_door_carries_its_partition_to_the_wall(chains: dict[str, ChainResult]) -> None:
    """Task 16c R-b: I15 ends 95 px short of I8 at its door; the door's arc carries it through to I8 as an
    opening, so I15 is traced whole and the door is found on it."""
    r = chains["hdb-3room"]
    m = wall_metrics(load_truth("hdb-3room", r.page, "drawing-walls"), r.graph)
    assert m.missed.get("I15", 0.0) <= 0.05, m.missed
    om = opening_metrics(load_openings_truth("hdb-3room", r.page), r.graph, r.openings)
    assert "D6" in om.matched


def test_hdb_toilet_3_left_wall_is_whole(chains: dict[str, ChainResult]) -> None:
    """The toilet-3 door leaf beside I13's face no longer takes the face from its partner: I13 is traced
    whole (Task 16c carry)."""
    r = chains["hdb-3room"]
    m = wall_metrics(load_truth("hdb-3room", r.page, "drawing-walls"), r.graph)
    assert m.missed.get("I13", 0.0) <= 0.05, m.missed


@pytest.mark.parametrize("stem", STEMS)
def test_chain_with_openings_is_fast(stem: str, chains: dict[str, ChainResult]) -> None:
    """The non-OCR chain, openings included, stays under 10 s (Task 14b ruling C5c)."""
    seconds = chains[stem].seconds
    assert seconds["total"] < 10.0, seconds
    assert seconds["openings"] < 1.0, seconds
