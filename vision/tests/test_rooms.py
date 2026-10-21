"""Room faces (06 §8.6 steps 1-7) and the ``CandidateSet`` (Task 18).

The brief's door and passage cases run the Task 16 plan (``test_segments_walls.plan``: a 1800 x 1200 px
rectangle, t 14, with a partition at x 1200) through walls -> graph -> openings -> rooms. The other cases
hand ``find_room_faces`` a drawn wall mask and a hand-built graph, so each rule is seen on its own.
"""

import dataclasses
from collections.abc import Sequence

import cv2
import numpy as np
import pytest

from app.pipeline.openings import find_openings
from app.pipeline.rooms import find_room_faces
from app.schemas.candidates import (
    CandidateSet,
    DimensionLine,
    DimensionSpan,
    GapCandidate,
    OpeningCandidate,
    RoomFace,
    Segment,
    WallCandidate,
    WallGraph,
)
from app.utils.geometry import Rect
from tests.support.synth import SDoor, SGap, render_plan
from tests.test_segments_walls import PARTITION, SIZE, plan, run, token

T = 14
REGION = Rect(100, 100, 2200, 1600)  # around the plan's outline (300, 300)-(2100, 1500)
SHAPE = (1800, 2400)  # rows, columns
EMPTY = WallGraph({}, [], [])


def chain_faces(
    *, doors: Sequence[SDoor] = (), gaps: Sequence[SGap] = ()
) -> tuple[list[RoomFace], np.ndarray, list[OpeningCandidate], Rect]:
    """The Task 16 plan through walls -> graph -> openings -> ``find_room_faces``."""
    r = run(render_plan(SIZE, plan("filled"), doors=doors, gaps=gaps))
    openings = find_openings(r.graph, r.pre, r.segments, r.pre.ink)
    rooms, face_map = find_room_faces(r.ext.mask, r.graph, openings, [], r.pre.region, r.ext.t_median)
    return rooms, face_map, openings, r.pre.region


def outline_mask() -> np.ndarray:
    """The plan's outline drawn as a 14 px wall mask (no partition)."""
    mask = np.zeros(SHAPE, np.uint8)
    cv2.rectangle(mask, (300, 300), (2100, 1500), 255, T)
    return mask


def wall(
    wid: str, a: tuple[float, float], b: tuple[float, float], an: str, bn: str, free: int = 0
) -> WallCandidate:
    return WallCandidate(wid, a, b, an, bn, float(T), "filled", 1.0, free, ())


def inside(face: RoomFace, pt: tuple[float, float]) -> float:
    contour = np.array(face.polygon_px, np.float32).reshape(-1, 1, 2)
    return float(cv2.pointPolygonTest(contour, pt, False))


def assert_inside_region(face: RoomFace, region: Rect) -> None:
    x0, y0, x1, y1 = face.bbox
    assert region.x < x0 and region.y < y0 and x1 < region.x + region.w - 1 and y1 < region.y + region.h - 1


# --- the brief's cases ----------------------------------------------------------------------------------


def test_two_rooms_with_door_closure() -> None:
    """A 70 px door in the partition (closure 70 <= 6 t = 84): two closed faces, the outside discarded."""
    rooms, face_map, openings, region = chain_faces(doors=[SDoor(PARTITION, 500, 70)])
    assert [o.kind for o in openings] == ["door"]  # precondition: the door is found
    assert [f.id for f in rooms] == ["R1", "R2"]
    for f in rooms:
        assert_inside_region(f, region)
        assert inside(f, f.anchor_px) > 0  # strictly inside its own polygon
        assert f.open is False
        assert f.area_px == pytest.approx(886 * 1186, rel=0.03)
    assert rooms[0].anchor_px[::-1] <= rooms[1].anchor_px[::-1]  # ids follow the anchors' (y, x)
    left, right = sorted(rooms, key=lambda f: f.bbox[0])
    assert left.bbox[2] < 1200 < right.bbox[0]
    assert face_map.dtype == np.int32 and face_map.shape == SHAPE


def test_open_face_flag() -> None:
    """A 120 px passage (> 6 t = 84): the two faces only close thanks to that closure, so both are open."""
    rooms, _, openings, _ = chain_faces(gaps=[SGap(PARTITION, 500, 120)])
    assert [o.kind for o in openings] == ["opening"]
    assert len(rooms) == 2
    assert all(f.open for f in rooms)


def test_border_and_sliver_discarded() -> None:
    """The outside (touching the region border), a 400 x 10 px sliver (aspect 40 > 15) and a 60 x 60 px
    pocket (3600 px < 0.002 x region area = 7040) are no faces; a 120 x 120 px pocket is one."""
    mask = outline_mask()
    cv2.line(mask, (1200, 300), (1200, 1500), 255, T)
    cv2.rectangle(mask, (1400, 1000), (1900, 1100), 255, -1)
    mask[1045:1055, 1450:1850] = 0  # the sliver
    cv2.rectangle(mask, (600, 1000), (700, 1100), 255, -1)
    mask[1020:1080, 620:680] = 0  # the small pocket
    cv2.rectangle(mask, (800, 1000), (1000, 1200), 255, -1)
    mask[1040:1160, 840:960] = 0  # the kept pocket
    rooms, face_map = find_room_faces(mask, EMPTY, [], [], REGION, float(T))
    assert len(rooms) == 3
    assert sorted(round(f.area_px) for f in rooms)[0] == 120 * 120
    for f in rooms:
        assert_inside_region(f, REGION)
    assert face_map[1050, 1600] == 0 and face_map[1050, 650] == 0
    assert face_map[200, 200] == 0  # the outside


def test_contains_text_ids() -> None:
    """Tokens centred in the left room are listed in that face only."""
    mask = outline_mask()
    cv2.line(mask, (1200, 300), (1200, 1500), 255, T)
    tokens = [
        token("T1", "BEDROOM", 750, 900),
        token("T2", "3000", 600, 1200),
        token("T3", "KITCHEN", 1650, 900),
        token("T4", "1200", 1200, 1600),  # outside every face
    ]
    rooms, _ = find_room_faces(mask, EMPTY, [], tokens, REGION, float(T))
    left, right = sorted(rooms, key=lambda f: f.bbox[0])
    assert left.contains_text_ids == ("T1", "T2")
    assert right.contains_text_ids == ("T3",)


def test_face_id_map() -> None:
    """The int32 face-id map holds k on the pixels of ``R{k}``, at its anchor too, and 0 elsewhere."""
    mask = outline_mask()
    cv2.line(mask, (300, 800), (2100, 800), 255, T)  # two rooms stacked: ids follow the anchors' (y, x)
    rooms, face_map = find_room_faces(mask, EMPTY, [], [], REGION, float(T))
    assert [f.id for f in rooms] == ["R1", "R2"]
    assert rooms[0].anchor_px[1] < 800 < rooms[1].anchor_px[1]
    for k, f in enumerate(rooms, 1):
        x, y = f.anchor_px
        assert face_map[round(y), round(x)] == k
        assert (face_map == k).sum() == pytest.approx(f.area_px)
    assert face_map[800, 1000] == 0 and face_map[150, 150] == 0
    assert set(np.unique(face_map).tolist()) == {0, 1, 2}


def test_candidate_set_scale_y() -> None:
    """``scale_y(1.05)`` multiplies node, wall, room and span y coordinates and keeps x."""
    room = RoomFace(
        "R1",
        ((10.0, 20.0), (50.0, 20.0), (50.0, 60.0)),
        (30.0, 40.0),
        800.0,
        (10.0, 20.0, 50.0, 60.0),
        (),
        False,
    )
    span = DimensionSpan("D1", (0.0, 100.0), (0.0, 300.0), "y", "overall", [], "L1")
    cs = candidate_set(rooms=[room], spans=[span])
    scaled = cs.scale_y(1.05)
    assert scaled.nodes == {"N1": (10.0, 21.0), "N2": (10.0, 420.0)}
    w = scaled.walls[0]
    assert (w.a, w.b) == ((10.0, 21.0), (10.0, 420.0))
    assert w.openings_px == (pytest.approx((105.0, 210.0)),)  # along a vertical wall, lengths scale too
    assert scaled.gaps[0].u0 == pytest.approx(105.0) and scaled.gaps[0].u1 == pytest.approx(210.0)
    assert (scaled.openings[0].u0, scaled.openings[0].u1) == (pytest.approx(105.0), pytest.approx(210.0))
    r = scaled.rooms[0]
    assert r.polygon_px == ((10.0, 21.0), (50.0, 21.0), (50.0, 63.0))
    assert r.anchor_px == (30.0, 42.0)
    assert r.bbox == (10.0, 21.0, 50.0, 63.0)
    assert r.area_px == pytest.approx(840.0)
    assert (scaled.spans[0].p0, scaled.spans[0].p1) == ((0.0, 105.0), (0.0, 315.0))
    assert scaled.texts[0].box == (
        pytest.approx(5.0),
        pytest.approx(21.0),
        pytest.approx(25.0),
        pytest.approx(31.5),
    )
    assert scaled.segments[0].p1 == (40.0, 84.0)
    assert scaled.dimension_lines[0].p1 == (0.0, 315.0)
    assert scaled.dimension_lines[0].tick_positions == [pytest.approx(0.0), pytest.approx(210.0)]
    assert scaled.region == Rect(0, 0, 1000, 840)
    assert cs.nodes["N1"] == (10.0, 20.0)  # a copy: the original is unchanged
    assert scaled.scale_y(1.0) == scaled


def candidate_set(*, rooms: list[RoomFace], spans: list[DimensionSpan]) -> CandidateSet:
    """A small hand-built ``CandidateSet``: one vertical wall N1 (10, 20) -> N2 (10, 400) with a gap and an
    opening over u 100-200, one token, one segment and one dimension line."""
    w = WallCandidate(
        "W1", (10.0, 20.0), (10.0, 400.0), "N1", "N2", 14.0, "filled", 1.0, 2, ((100.0, 200.0),)
    )
    tok = token("T1", "1200", 15.0, 25.0, height=10.0)
    return CandidateSet(
        texts=[dataclasses.replace(tok, box=(5.0, 20.0, 25.0, 30.0))],
        segments=[Segment("S1", (0.0, 0.0), (40.0, 80.0), 2.0, True, "lsd")],
        dimension_lines=[DimensionLine("L1", (0.0, 100.0), (0.0, 300.0), [0.0, 200.0], "S1")],
        spans=spans,
        nodes={"N1": (10.0, 20.0), "N2": (10.0, 400.0)},
        walls=[w],
        gaps=[GapCandidate("W1", 100.0, 200.0)],
        openings=[OpeningCandidate("O1", "W1", 100.0, 200.0, "door", "single_swing", "start", "left", 0.8)],
        rooms=rooms,
        theta0=0.0,
        t_thin=2.0,
        t_median=14.0,
        region=Rect(0, 0, 1000, 800),
        drawing_kind_cv="architectural_line_drawing",
    )


# --- step 1: closures between collinear walls -----------------------------------------------------------


def split_partition(gap: int) -> tuple[np.ndarray, WallGraph]:
    """The outline plus a partition at x 1200 in two collinear pieces, the upper one ending free at y 800
    and the lower one starting ``gap`` px further down: neither the mask nor the graph closes it."""
    mask = outline_mask()
    cv2.line(mask, (1200, 300), (1200, 800), 255, T)
    cv2.line(mask, (1200, 800 + gap), (1200, 1500), 255, T)
    corners = {"N1": (300.0, 300.0), "N2": (1200.0, 300.0), "N3": (2100.0, 300.0), "N4": (1200.0, 800.0)}
    corners |= {
        "N5": (1200.0, 800.0 + gap),
        "N6": (300.0, 1500.0),
        "N7": (1200.0, 1500.0),
        "N8": (2100.0, 1500.0),
    }
    walls = [
        wall("W1", corners["N1"], corners["N2"], "N1", "N2"),
        wall("W2", corners["N2"], corners["N3"], "N2", "N3"),
        wall("W3", corners["N1"], corners["N6"], "N1", "N6"),
        wall("W4", corners["N2"], corners["N4"], "N2", "N4", free=1),
        wall("W5", corners["N3"], corners["N8"], "N3", "N8"),
        wall("W6", corners["N5"], corners["N7"], "N5", "N7", free=1),
        wall("W7", corners["N6"], corners["N7"], "N6", "N7"),
        wall("W8", corners["N7"], corners["N8"], "N7", "N8"),
    ]
    return mask, WallGraph(corners, walls, [])


@pytest.mark.parametrize(
    ("gap", "faces", "is_open"), [(70, 2, False), (150, 2, True), (240, 2, True), (270, 1, False)]
)
def test_collinear_wall_ends_are_closed_up_to_18_t(gap: int, faces: int, is_open: bool) -> None:
    """06 §8.6 step 1: a remaining end-to-end gap between collinear walls is closed up to 18 t (252 px);
    a closure longer than 6 t (84 px) leaves the faces open."""
    mask, graph = split_partition(gap)
    rooms, _ = find_room_faces(mask, graph, [], [], REGION, float(T))
    assert len(rooms) == faces
    assert all(f.open is is_open for f in rooms)


def test_aligned_junction_ends_are_not_closed() -> None:
    """Two collinear walls whose facing ends are both junctions (a corridor between two rooms whose walls
    line up) are not joined: only a free end marks an unfinished wall."""
    mask = outline_mask()
    cv2.line(mask, (300, 800), (1100, 800), 255, T)
    cv2.line(mask, (1300, 800), (2100, 800), 255, T)
    cv2.line(mask, (1100, 300), (1100, 800), 255, T)
    cv2.line(mask, (1300, 300), (1300, 800), 255, T)
    n = {"A": (300.0, 800.0), "B": (1100.0, 800.0), "C": (1300.0, 800.0), "D": (2100.0, 800.0)}
    n |= {"E": (1100.0, 300.0), "F": (1300.0, 300.0)}
    walls = [
        wall("W1", n["A"], n["B"], "A", "B"),
        wall("W2", n["C"], n["D"], "C", "D"),
        wall("W3", n["E"], n["B"], "E", "B"),
        wall("W4", n["F"], n["C"], "F", "C"),
    ]
    rooms, _ = find_room_faces(mask, WallGraph(n, walls, []), [], [], REGION, float(T))
    assert len(rooms) == 3  # left room, right room, and the corridor joined to the room below


def test_graph_walls_close_the_mask() -> None:
    """A wall the graph holds (an L/T closure or a link made by the walls stage) closes the faces even where
    the mask has no ink."""
    mask = outline_mask()
    cv2.line(mask, (1200, 300), (1200, 1400), 255, T)  # the mask's partition stops 100 px short
    n = {"N1": (1200.0, 300.0), "N2": (1200.0, 1500.0)}
    rooms, _ = find_room_faces(
        mask, WallGraph(n, [wall("W1", n["N1"], n["N2"], "N1", "N2")], []), [], [], REGION, float(T)
    )
    assert len(rooms) == 2
    assert not any(f.open for f in rooms)
