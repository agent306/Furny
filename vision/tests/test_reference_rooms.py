"""Task 18: room faces on the two reference blueprints against their traced rooms
(``<stem>.drawing-rooms.json``), through the full raster chain (walls -> graph -> openings ->
``find_room_faces``) with replayed OCR.

A truth room is matched when exactly one face contains its interior point and that face holds no other
truth room's point (an open room sharing the face of the room it opens onto excepted;
``tests/support/reference.py``, ``room_metrics``).
"""

import json

import cv2
import numpy as np
import pytest
from shapely.geometry import Point, Polygon
from shapely.ops import unary_union

from app.pipeline.ocr_stage import in_region
from app.pipeline.textparse import parse_token
from app.schemas.candidates import RoomFace
from tests.support.reference import (
    IMAGES,
    REFERENCE_DIR,
    ChainResult,
    RoomMetrics,
    load_page,
    load_rooms_truth,
    room_metrics,
    run_chain,
)

pytestmark = pytest.mark.reference

STEMS = sorted(IMAGES)
# Regression floors: the matched rooms Task 18 reached with 06 §8.6 on the current walls stage. The HDB's
# remaining rooms need walls the walls stage does not extract (I11, I12, I14, I16, I17; task-18-report.md).
ROOMS_FLOOR = {"hdb-3room": 3, "brochure-2bhk": 3}  # ledges excluded (review M1 ruling)
HDB_TARGET = 7  # carried to Task 34 with the walls residuals (ruling R18-a): a strict xfail until then
LABEL_SHARE_MIN = 0.8


@pytest.fixture(scope="module")
def chains() -> dict[str, ChainResult]:
    return {stem: run_chain(stem) for stem in STEMS}


def metrics(r: ChainResult) -> RoomMetrics:
    return room_metrics(load_rooms_truth(r.stem, r.page), r.rooms, in_region(r.ocr.tokens, r.pre.region))


# --- the truth ------------------------------------------------------------------------------------------


@pytest.mark.parametrize("stem", STEMS)
def test_truth_rooms_are_consistent(stem: str) -> None:
    """Unique ids; each point inside its own polygon and no other; polygons do not overlap; a label is a
    room name or null; an open room names the closed room it opens onto."""
    raw = json.loads((REFERENCE_DIR / f"{stem}.drawing-rooms.json").read_text())
    rooms = raw["rooms"]
    ids = [r["id"] for r in rooms]
    assert len(ids) == len(set(ids))
    polys = {r["id"]: Polygon(r["polygon"]) for r in rooms}
    for r in rooms:
        assert polys[r["id"]].is_valid
        assert [k for k, p in polys.items() if p.contains(Point(r["point"]))] == [r["id"]]
        assert r["label"] is None or parse_token(r["label"]).kind == "room_name", r["label"]
        assert r["open"] == ("opens_onto" in r)
        assert r.get("kind", "room") in {"room", "ledge"}
        if r["open"]:
            host = next(h for h in rooms if h["id"] == r["opens_onto"])
            assert not host["open"]
    for a in rooms:
        for b in rooms:
            if a["id"] < b["id"]:
                assert polys[a["id"]].intersection(polys[b["id"]]).area < 1.0, (a["id"], b["id"])
    assert {"traced", "points", "labels", "open", "not_rooms", "judgement_calls"} <= set(raw["method"])


@pytest.mark.parametrize("stem", STEMS)
def test_room_metric_scores_the_truth_itself(stem: str) -> None:
    """The scorer: faces cut from the truth polygons match every room; one face over two neighbours merges
    them; two faces over one room split it."""
    truth = load_rooms_truth(stem, load_page(stem))

    def face(fid: str, poly: Polygon) -> RoomFace:
        x0, y0, x1, y1 = poly.bounds
        pts = tuple((float(x), float(y)) for x, y in list(poly.exterior.coords)[:-1])
        c = poly.representative_point()
        return RoomFace(fid, pts, (c.x, c.y), poly.area, (x0, y0, x1, y1), (), False)

    polys = [Polygon(t.polygon) for t in truth]
    exact = [face(f"R{k}", p) for k, p in enumerate(polys, 1)]
    m = room_metrics(truth, exact, [])
    assert sorted(m.matched) == sorted(t.id for t in truth if t.kind != "ledge")
    assert not m.merged and not m.split and not m.unmatched

    a, b = next(
        (i, j) for i in range(len(polys)) for j in range(i + 1, len(polys))
        if polys[i].buffer(2).intersects(polys[j]) and not truth[i].opens_onto and not truth[j].opens_onto
        and truth[i].kind == truth[j].kind == "room"
    )  # fmt: skip
    joined = unary_union([polys[a].buffer(1), polys[b].buffer(1)])
    faces = [f for k, f in enumerate(exact) if k not in (a, b)] + [face("RX", joined)]
    m = room_metrics(truth, faces, [])
    assert truth[a].id in m.unmatched and truth[b].id in m.unmatched
    assert sorted(m.merged["RX"]) == sorted([truth[a].id, truth[b].id])

    x0, _, x1, _ = polys[a].bounds
    mid = (x0 + x1) / 2
    left = polys[a].intersection(Polygon([(x0 - 1, -1e4), (mid, -1e4), (mid, 1e4), (x0 - 1, 1e4)]))
    right = polys[a].intersection(Polygon([(mid, -1e4), (x1 + 1, -1e4), (x1 + 1, 1e4), (mid, 1e4)]))
    faces = [f for k, f in enumerate(exact) if k != a] + [face("RL", left), face("RR", right)]
    assert sorted(room_metrics(truth, faces, []).split[truth[a].id]) == ["RL", "RR"]


# --- acceptance -----------------------------------------------------------------------------------------


@pytest.mark.parametrize("stem", STEMS)
def test_matched_rooms_do_not_drop(stem: str, chains: dict[str, ChainResult]) -> None:
    m = metrics(chains[stem])
    assert len(m.matched) >= ROOMS_FLOOR[stem], m


@pytest.mark.xfail(
    strict=True,
    reason="Task 34 target (ruling R18-a): >= 7 of the HDB's 10 rooms (ledges excluded) need walls the walls "
    "stage does not extract -- I11 (toilet 2), I12/I16 (the bay ledge off toilet 3), I14 (toilet 3 / bedroom "
    "3), I17 (the store); with them find_room_faces matches all 10 (task-18-report.md)",
)
def test_hdb_seven_rooms_are_matched(chains: dict[str, ChainResult]) -> None:
    assert len(metrics(chains["hdb-3room"]).matched) >= HDB_TARGET


@pytest.mark.parametrize("stem", STEMS)
def test_labels_lie_in_their_rooms(stem: str, chains: dict[str, ChainResult]) -> None:
    """Each matched room's label token is listed in its face's ``contains_text_ids`` (>= 80 %)."""
    m = metrics(chains[stem])
    assert m.label_hits
    assert m.label_share >= LABEL_SHARE_MIN, m


@pytest.mark.parametrize("stem", STEMS)
def test_faces_are_well_formed(stem: str, chains: dict[str, ChainResult]) -> None:
    """Ids ``R1..`` in the anchors' (y, x) order, anchors strictly inside their polygons and on their own
    pixels of the face-id map, and no face touching the plan region's border."""
    r = chains[stem]
    assert r.face_map is not None and r.face_map.dtype == np.int32
    assert [f.id for f in r.rooms] == [f"R{k}" for k in range(1, len(r.rooms) + 1)]
    anchors = [(f.anchor_px[1], f.anchor_px[0]) for f in r.rooms]
    assert anchors == sorted(anchors)
    reg = r.pre.region
    for k, f in enumerate(r.rooms, 1):
        contour = np.array(f.polygon_px, np.float32).reshape(-1, 1, 2)
        assert cv2.pointPolygonTest(contour, f.anchor_px, False) > 0
        assert r.face_map[round(f.anchor_px[1]), round(f.anchor_px[0])] == k
        x0, y0, x1, y1 = f.bbox
        assert reg.x < x0 and reg.y < y0 and x1 < reg.x + reg.w - 1 and y1 < reg.y + reg.h - 1


@pytest.mark.parametrize("stem", STEMS)
def test_rooms_stage_is_fast(stem: str, chains: dict[str, ChainResult]) -> None:
    assert chains[stem].seconds["rooms"] < 1.0, chains[stem].seconds
