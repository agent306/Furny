"""Assembly (06 §8.7 steps 1-9), post-scale filters (§8.6) and validate-and-repair (03 §1.1), Task 21.

Preflight rulings applied: K14 (``confidence_overrides`` / ``reason_overrides``), K19 (warnings
``rooms_without_names`` / ``walls_unconnected``, reasons ``name_guessed`` / ``size_mismatch`` /
``unconnected`` / ``llm_unsure``) and the schema-strictness ruling (ids, record keys, ``#RRGGBB`` colours,
angles in [0, 360)).
"""

import re
from dataclasses import replace

import numpy as np
import pytest

from app.api.errors import VisionError
from app.pipeline.assemble import ConfidenceMap, assemble_document, snap_thickness
from app.pipeline.normalize import NormalizedPage
from app.pipeline.scale import ScaleResult
from app.pipeline.textparse import parse_token
from app.pipeline.validate import validate_and_repair
from app.schemas.api import RecognizeDefaults, RecognizeHints, RecognizeOptions
from app.schemas.candidates import (
    CandidateSet,
    GapCandidate,
    OpeningCandidate,
    RoomFace,
    TextToken,
    WallCandidate,
)
from app.schemas.labeling import (
    LabelingResult,
    MissedOpening,
    MissedRoom,
    OpeningLabel,
    RoomLabel,
    TextLabel_,
    WallLabel,
)
from app.schemas.meta import PageImage, RoomLabelCheck
from app.schemas.plan import Opening, PlanDocument, PlanMeta, RoomMeta, Wall, WallNode
from app.utils.geometry import Pt, Rect
from app.utils.ids import new_id
from tests.test_normalize import make_ctx

K = 10.5
W_PX, H_PX = 1000, 800
ID_RE = re.compile(r"^(n|w|o|r|t)_[0-9a-z]{10}$")

# --- builders -------------------------------------------------------------------------------------------


def wall(
    wid: str, a: Pt, b: Pt, na: str, nb: str, *, t: float = 11.0, ev: float = 0.85, free: int = 0
) -> WallCandidate:
    return WallCandidate(wid, a, b, na, nb, t, "double_line", ev, free, ())


def face(fid: str, x0: float, y0: float, x1: float, y1: float, *, open_face: bool = False) -> RoomFace:
    poly = ((x0, y0), (x1, y0), (x1, y1), (x0, y1))
    return RoomFace(
        fid,
        poly,
        ((x0 + x1) / 2, (y0 + y1) / 2),
        (x1 - x0 + 1) * (y1 - y0 + 1),
        (x0, y0, x1, y1),
        (),
        open_face,
    )


def token(tid: str, text: str, at: Pt) -> TextToken:
    x, y = at
    box = (x - 20.0, y - 8.0, x + 20.0, y + 8.0)
    quad = ((box[0], box[1]), (box[2], box[1]), (box[2], box[3]), (box[0], box[3]))
    return TextToken(tid, text, quad, box, 0, 0.99, 16.0, parse_token(text))


def op(
    oid: str,
    wall_id: str,
    u0: float,
    u1: float,
    kind: str = "door",
    type_: str = "single_swing",
    support: float = 0.7,
) -> OpeningCandidate:
    return OpeningCandidate(oid, wall_id, u0, u1, kind, type_, "start", "left", support)  # type: ignore[arg-type]


def rect_walls(free: int = 0) -> list[WallCandidate]:
    """A 400 x 300 px room at (100, 200): W1 top, W2 right, W3 bottom, W4 left."""
    return [
        wall("W1", (100, 200), (500, 200), "N1", "N2", free=free),
        wall("W2", (500, 200), (500, 500), "N2", "N3", free=free),
        wall("W3", (100, 500), (500, 500), "N4", "N3", free=free),
        wall("W4", (100, 200), (100, 500), "N1", "N4", free=free),
    ]


def make_candidates(**kw: object) -> CandidateSet:
    base = CandidateSet(
        texts=[],
        segments=[],
        dimension_lines=[],
        spans=[],
        nodes={"N1": (100.0, 200.0), "N2": (500.0, 200.0), "N3": (500.0, 500.0), "N4": (100.0, 500.0)},
        walls=rect_walls(),
        gaps=[],
        openings=[],
        rooms=[face("R1", 106, 206, 494, 494)],
        theta0=0.0,
        t_thin=2.0,
        t_median=11.0,
        region=Rect(50, 150, 900, 450),
        drawing_kind_cv="architectural_line_drawing",
    )
    return replace(base, **kw)


def make_labels(**kw: object) -> LabelingResult:
    base = LabelingResult(
        unit_system="metric",
        drawing_kind="architectural_line_drawing",
        texts=[],
        dimensions=[],
        rooms=[
            RoomLabel(
                id="R1",
                include=True,
                name="Bedroom",
                type="bedroom",
                name_text_id=None,
                size_text=None,
                width_mm=None,
                depth_mm=None,
            )
        ],
        missed_rooms=[],
        walls=[],
        openings=[],
        missed_openings=[],
        known_dimension_match=None,
        notes=None,
    )
    return base.model_copy(update=kw)


def room_label(rid: str = "R1", **kw: object) -> RoomLabel:
    base = RoomLabel(
        id=rid,
        include=True,
        name="Bedroom",
        type="bedroom",
        name_text_id=None,
        size_text=None,
        width_mm=None,
        depth_mm=None,
    )
    return base.model_copy(update=kw)


def make_scale(k: float = K, confidence: float = 0.9) -> ScaleResult:
    return ScaleResult(
        mm_per_px=k,
        method="dimension_chain",
        residual_pct=1.0,
        samples=3,
        rejected=0,
        confidence=confidence,
        anisotropy_corrected=False,
        y_factor=1.0,
        room_label_check=RoomLabelCheck(rooms=0, median_discrepancy_pct=None),
        used_samples=[],
        inlier_flags=[],
        consistent_chains=0,
    )


def make_page() -> NormalizedPage:
    info = PageImage(
        width=W_PX,
        height=H_PX,
        source_page=1,
        dpi=None,
        rectified=False,
        deskew_deg=0.0,
        resample_factor=1.0,
    )
    image = np.full((H_PX, W_PX, 3), 255, np.uint8)
    return NormalizedPage(image, info, np.eye(3), "raster", False)


def make_options(provider: str = "anthropic", **kw: object) -> RecognizeOptions:
    return RecognizeOptions(
        provider=provider,  # type: ignore[arg-type]
        effort="medium",
        agentic_crops=False,
        fallback_to_none_on_error=True,
        **kw,  # type: ignore[arg-type]
    )


def run(
    candidates: CandidateSet | None = None,
    labels: LabelingResult | None = None,
    scale: ScaleResult | None = None,
    options: RecognizeOptions | None = None,
    **kw: object,
):  # type: ignore[no-untyped-def]
    return assemble_document(
        make_page(),
        candidates or make_candidates(),
        labels or make_labels(),
        scale or make_scale(),
        options or make_options(),
        make_ctx(),
        **kw,  # type: ignore[arg-type]
    )


def codes(result) -> dict[str, dict]:  # type: ignore[no-untyped-def]
    return {w.code: w.params for w in result.warnings}


def by_cand(result, cid: str):  # type: ignore[no-untyped-def]
    return result.id_map[cid]


# --- coordinates, ids, thickness ------------------------------------------------------------------------


def test_coordinates_and_ids() -> None:
    r = run()
    doc = r.document
    n1 = doc.nodes[r.id_map["N1"]]
    assert (n1.x, n1.y) == (1050, 2100)
    ids = [*doc.nodes, *doc.walls, *doc.rooms, *doc.openings, *doc.annotations.labels]
    assert ids and all(ID_RE.match(i) for i in ids)
    assert all(doc.nodes[i].id == i for i in doc.nodes) and all(doc.walls[i].id == i for i in doc.walls)
    assert r.id_map["W1"].startswith("w_") and r.id_map["R1"].startswith("r_")
    assert len(doc.nodes) == 4 and len(doc.walls) == 4 and len(doc.rooms) == 1


def test_snap_thickness() -> None:
    assert snap_thickness(11 * 10.5) == 115
    assert snap_thickness(223) == 230
    assert snap_thickness(130) == 130
    assert snap_thickness(40) == 50
    assert snap_thickness(1200) == 1000


def test_absurd_scale_fails_cleanly() -> None:
    with pytest.raises(VisionError) as e:
        run(scale=make_scale(k=5000.0))
    assert e.value.code == "too_complex" and e.value.http_status == 422


# --- walls ----------------------------------------------------------------------------------------------


def test_wall_fields() -> None:
    r = run()
    w1 = r.document.walls[r.id_map["W1"]]
    assert (w1.height, w1.justification, w1.color_hex, w1.thickness) == (2700, "center", None, 115)
    assert w1.material == "brick"
    assert {w.kind for w in r.document.walls.values()} == {"exterior"}
    hinted = make_options(hints=RecognizeHints(wall_height_mm=3000))
    assert {w.height for w in run(options=hinted).document.walls.values()} == {3000}
    half = make_labels(walls=[WallLabel(id="W1", verdict="wall", kind="half")])
    r = run(labels=half)
    assert [(w.kind, w.height) for w in r.document.walls.values() if w.kind == "half"] == [("half", 1000)]
    assert r.document.walls[r.id_map["W1"]].height == 1000


def test_wall_kinds_and_material() -> None:
    # an interior wall inside the unit: 5 px = 55 mm (partition, drywall); 18 px = 189 mm -> 200 (interior)
    c = make_candidates(
        nodes={
            "N1": (100.0, 200.0),
            "N2": (500.0, 200.0),
            "N3": (500.0, 500.0),
            "N4": (100.0, 500.0),
            "N5": (300.0, 200.0),
            "N6": (300.0, 500.0),
        },
        walls=[*rect_walls(), wall("W5", (300, 200), (300, 500), "N5", "N6", t=5.0)],
        rooms=[face("R1", 106, 206, 294, 494), face("R2", 306, 206, 494, 494)],
    )
    labels = make_labels(rooms=[room_label("R1"), room_label("R2", name="Kitchen", type="kitchen")])
    r = run(c, labels)
    w5 = r.document.walls[r.id_map["W5"]]
    assert (w5.kind, w5.material, w5.thickness) == ("partition", "drywall", 55)
    thick = replace(c, walls=[*rect_walls(), wall("W5", (300, 200), (300, 500), "N5", "N6", t=18.0)])
    w5 = run(thick, labels).document.walls
    assert {(w.kind, w.material) for w in w5.values() if w.thickness == 200} == {("interior", "brick")}


# --- openings -------------------------------------------------------------------------------------------


def test_openings() -> None:
    c = make_candidates(
        openings=[op("O1", "W1", 100, 187), op("O2", "W3", 50, 170, type_="single_swing")],
        texts=[token("T1", "D1", (243, 180))],
    )
    labels = make_labels(
        rooms=[room_label(name="Bedroom", type="bedroom")],
        texts=[TextLabel_(id="T1", role="opening_tag", normalized_text="D1")],
    )
    r = run(c, labels)
    doors = r.document.openings
    o1, o2 = doors[r.id_map["O1"]], doors[r.id_map["O2"]]
    assert o1.width == 910 and o1.offset == round(143.5 * K) and o1.label == "D1"
    assert (o1.kind, o1.type, o1.height, o1.sill_height) == ("door", "single_swing", 2100, 0)
    assert o2.width == 1260 and o2.type == "double_swing" and o2.label is None
    assert not any(o.type == "main_entrance" for o in doors.values())  # no living / foyer room


def test_sliding_door_stays_sliding() -> None:
    c = make_candidates(openings=[op("O1", "W1", 100, 220)])
    r = run(
        c,
        make_labels(openings=[OpeningLabel(id="O1", verdict="door", door_type="sliding", window_type=None)]),
    )
    assert next(iter(r.document.openings.values())).type == "sliding"


def test_windows_and_passages() -> None:
    c = make_candidates(
        openings=[
            op("O1", "W1", 150, 270, "window", "casement", 0.8),
            op("O2", "W3", 150, 250, "opening", "opening", 0.0),
        ]
    )
    r = run(c)
    win, gap = r.document.openings[r.id_map["O1"]], r.document.openings[r.id_map["O2"]]
    assert (win.kind, win.sill_height, win.height) == ("window", 900, 1200)
    assert (gap.kind, gap.type, gap.height, gap.sill_height) == ("opening", "opening", 2100, 0)
    tall = make_options(
        hints=RecognizeHints(wall_height_mm=2000),
        defaults=RecognizeDefaults(window_height_mm=1500, window_sill_mm=900),
    )
    r = run(c, options=tall)
    win = r.document.openings[r.id_map["O1"]]
    assert (win.sill_height, win.height) == (900, 1100)  # sill + height <= the 2000 mm wall
    half = run(c, make_labels(walls=[WallLabel(id="W1", verdict="wall", kind="half")]))
    win = half.document.openings[half.id_map["O1"]]
    assert win.sill_height + win.height <= 1000


def test_main_entrance_once() -> None:
    c = make_candidates(openings=[op("O1", "W1", 10, 97), op("O2", "W2", 105, 200), op("O3", "W4", 20, 110)])
    labels = make_labels(rooms=[room_label(name="Living", type="living")])
    r = run(c, labels)
    types = {cid: r.document.openings[r.id_map[cid]].type for cid in ("O1", "O2", "O3")}
    # the room anchor is (300, 350) px: W2's door centres at (500, 352), the nearest of the three
    assert types == {"O1": "single_swing", "O2": "main_entrance", "O3": "single_swing"}


def test_missed_opening_inserted_and_adopted() -> None:
    missed = MissedOpening(kind="door", wall_id="W1", x=300, y=200)
    r = run(labels=make_labels(missed_openings=[missed]))
    (o,) = r.document.openings.values()
    assert (o.kind, o.width, o.offset, o.type) == ("door", 900, round(200 * K), "single_swing")
    assert r.confidence.openings[o.id] == 0.35 and r.confidence.reasons[o.id] == ["type_guessed"]
    # a free gap candidate within 1.5 m is adopted instead (confidence 0.5)
    c = make_candidates(gaps=[GapCandidate("W1", 250.0, 330.0)])
    r = run(c, make_labels(missed_openings=[missed]))
    (o,) = r.document.openings.values()
    assert o.width == 840 and r.confidence.openings[o.id] == 0.5
    # a gap that an opening candidate already covers is used: the missed door is inserted
    c = make_candidates(gaps=[GapCandidate("W1", 250.0, 330.0)], openings=[op("O1", "W1", 250, 330)])
    r = run(c, make_labels(missed_openings=[missed]))
    assert sorted(r.confidence.openings.values()) == [0.35, 0.72]


def test_missed_opening_off_wall_ignored() -> None:
    far = MissedOpening(kind="door", wall_id="W1", x=2000, y=200)
    assert not run(labels=make_labels(missed_openings=[far])).document.openings


# --- rooms ----------------------------------------------------------------------------------------------


def test_rooms() -> None:
    r = run(labels=make_labels(rooms=[room_label(name=None, type=None)]))
    room = next(iter(r.document.rooms.values()))
    assert (room.name, room.type, room.floor_finish, room.show_area, room.label_offset) == (
        "Room",
        "other",
        "tile",
        True,
        None,
    )
    assert room.floor_color_hex is None and (room.anchor.x, room.anchor.y) == (3150, 3675)
    assert r.confidence.reasons[room.id] == ["no_name"]
    assert codes(r)["rooms_without_names"] == {"count": 1}
    # the type comes from the name when the label has none
    r = run(labels=make_labels(rooms=[room_label(name="Master Bedroom", type=None)]))
    assert next(iter(r.document.rooms.values())).type == "master_bedroom"
    # a type without a name gives the type's English name
    r = run(labels=make_labels(rooms=[room_label(name=None, type="kitchen")]))
    room = next(iter(r.document.rooms.values()))
    assert (room.name, room.type) == ("Kitchen", "kitchen")
    assert r.confidence.reasons[room.id] == ["name_guessed"]


def test_room_without_label_is_unnamed() -> None:
    r = run(labels=make_labels(rooms=[]))
    assert next(iter(r.document.rooms.values())).name == "Room"


def test_extra_names_become_labels() -> None:
    c = make_candidates(
        rooms=[replace(face("R1", 106, 206, 494, 494), contains_text_ids=("T1", "T2", "T3"))],
        texts=[
            token("T1", "LIVING", (200, 300)),
            token("T2", "DINING", (400, 400)),
            token("T3", "LIVING", (220, 300)),
        ],
    )
    labels = make_labels(
        rooms=[room_label(name="Living", type="living", name_text_id="T1")],
        texts=[
            TextLabel_(id="T1", role="room_name", normalized_text="Living"),
            TextLabel_(id="T2", role="room_name", normalized_text="Dining"),
            TextLabel_(id="T3", role="room_name", normalized_text="Living"),
        ],
    )
    r = run(c, labels)
    (lab,) = r.document.annotations.labels.values()
    assert (lab.text, lab.font_size, lab.rotation) == ("Dining", 250, 0)
    assert (lab.position.x, lab.position.y) == (round(400 * K), round(400 * K))
    assert ID_RE.match(lab.id) and lab.id.startswith("t_")
    assert codes(r)["room_names_merged"] == {"names": "Dining"}


def test_missed_room_names_unnamed_face_or_merges() -> None:
    missed = MissedRoom(name="Study", type="study", x=300, y=350)
    r = run(labels=make_labels(rooms=[room_label(name=None, type=None)], missed_rooms=[missed]))
    room = next(iter(r.document.rooms.values()))
    assert (room.name, room.type) == ("Study", "study") and room.id not in r.confidence.reasons
    r = run(labels=make_labels(missed_rooms=[missed]))  # the face is named: a merged-name label
    assert next(iter(r.document.rooms.values())).name == "Bedroom"
    assert [x.text for x in r.document.annotations.labels.values()] == ["Study"]
    assert "room_names_merged" in codes(r)
    outside = MissedRoom(name="Study", type="study", x=900, y=700)
    r = run(labels=make_labels(missed_rooms=[outside]))
    assert not r.document.annotations.labels


# --- exclusions and filters -----------------------------------------------------------------------------


def test_exclusions() -> None:
    nodes = {
        "N1": (100.0, 200.0),
        "N2": (500.0, 200.0),
        "N3": (500.0, 500.0),
        "N4": (100.0, 500.0),
        "N5": (600.0, 200.0),
        "N6": (600.0, 500.0),
    }
    c = make_candidates(
        nodes=nodes,
        walls=[*rect_walls(), wall("W5", (600, 200), (600, 500), "N5", "N6")],
        rooms=[
            face("R1", 106, 206, 494, 494),
            face("R2", 506, 206, 594, 494),
            face("R3", 606, 206, 694, 494),
        ],
    )
    labels = make_labels(
        rooms=[room_label("R1"), room_label("R2", include=False), room_label("R3", include=False)]
    )
    r = run(c, labels)
    assert len(r.document.rooms) == 1 and len(r.document.walls) == 4  # W5 sits between excluded faces
    assert "W5" not in r.id_map
    assert codes(r)["entities_outside_unit_removed"] == {"walls": 1, "rooms": 2}
    assert not any(n in r.id_map for n in ("N5", "N6"))


def test_no_exclusion_keeps_walls_without_faces() -> None:
    c = make_candidates(rooms=[])
    r = run(c, make_labels(rooms=[]))
    assert len(r.document.walls) == 4 and "entities_outside_unit_removed" not in codes(r)


def test_not_wall_and_not_opening_dropped() -> None:
    c = make_candidates(openings=[op("O1", "W1", 100, 187), op("O2", "W2", 105, 200)])
    labels = make_labels(
        walls=[WallLabel(id="W2", verdict="not_wall", kind=None)],
        openings=[OpeningLabel(id="O1", verdict="not_opening", door_type=None, window_type=None)],
    )
    r = run(c, labels)
    assert len(r.document.walls) == 3 and not r.document.openings  # O2 left with its wall


def test_metric_filters() -> None:
    tiny, huge = face("R2", 600, 600, 650, 650), face("R3", 0, 0, 1500, 1300)  # 0.29 m2 and 215 m2
    c = make_candidates(rooms=[face("R1", 106, 206, 494, 494), tiny, huge])
    labels = make_labels(rooms=[room_label("R1"), room_label("R2"), room_label("R3")])
    assert len(run(c, labels).document.rooms) == 1
    # walls: 4 px = 42 mm and 60 px = 630 mm are thin_evidence; dropped when the evidence is < 0.6
    walls = [*rect_walls()[:2], wall("W3", (100, 500), (500, 500), "N4", "N3", t=4.0, ev=0.85)]
    walls.append(wall("W4", (100, 200), (100, 500), "N1", "N4", t=60.0, ev=0.5))
    r = run(make_candidates(walls=walls))
    assert len(r.document.walls) == 3 and "W4" not in r.id_map
    assert r.confidence.reasons[r.id_map["W3"]] == ["thin_evidence"]
    # openings outside 300-6000 mm
    c = make_candidates(openings=[op("O1", "W1", 100, 120), op("O2", "W1", 0, 600), op("O3", "W3", 150, 250)])
    r = run(c)
    assert "O3" in r.id_map and "O1" not in r.id_map and "O2" not in r.id_map  # 210 mm and 6300 mm


# --- confidence -----------------------------------------------------------------------------------------


def test_confidence_pins_wall() -> None:
    walls = [replace(w, free_ends=1) if w.id == "W1" else w for w in rect_walls()]
    labels = make_labels(walls=[WallLabel(id="W1", verdict="wall", kind=None)])
    r = run(make_candidates(walls=walls), labels)
    w1 = r.id_map["W1"]
    assert r.confidence.walls[w1] == 0.87 and r.confidence.reasons[w1] == ["unconnected"]
    assert r.confidence.walls[r.id_map["W2"]] == 0.87  # 0.35 x 0.85 + 0.25 + 0.2 + 0.2 x 0.6 (no verdict)
    assert r.confidence.walls[r.id_map["W3"]] == 0.87
    # heuristic labeler: llm = 0.6; unsure from the LLM: 0.5 and llm_unsure
    unsure = make_labels(walls=[WallLabel(id="W1", verdict="unsure", kind=None)])
    r = run(make_candidates(walls=walls), unsure)
    assert r.confidence.walls[r.id_map["W1"]] == round(0.35 * 0.85 + 0.25 + 0.12 + 0.1, 2)
    assert r.confidence.reasons[r.id_map["W1"]] == ["unconnected", "llm_unsure"]
    assert codes(r)["walls_unconnected"] == {"count": 1}


def test_confidence_off_axis_and_single_line() -> None:
    diag = WallCandidate("W1", (100, 200), (500, 260), "N1", "N2", 11.0, "single_line", 0.5, 0, ())
    walls = [diag, *rect_walls()[1:]]
    r = run(make_candidates(walls=walls))
    w1 = r.id_map["W1"]
    assert r.confidence.reasons[w1] == ["single_line_wall", "off_axis"]
    assert r.confidence.walls[w1] == round(0.35 * 0.5 + 0.25 * 0.6 + 0.2 + 0.2 * 0.6, 2)


def test_confidence_pins_door() -> None:
    c = make_candidates(openings=[op("O1", "W1", 150, 250, support=0.7)])
    r = run(c)
    assert r.confidence.openings[r.id_map["O1"]] == 0.72
    agree = make_labels(openings=[OpeningLabel(id="O1", verdict="door", door_type=None, window_type=None)])
    r = run(c, agree)
    assert r.confidence.openings[r.id_map["O1"]] == 0.87
    window = make_labels(openings=[OpeningLabel(id="O1", verdict="window", door_type=None, window_type=None)])
    r = run(c, window)
    o = r.document.openings[r.id_map["O1"]]
    assert (o.kind, o.type, o.sill_height) == ("window", "casement", 900)
    assert r.confidence.openings[o.id] == 0.6
    assert r.confidence.reasons[o.id] == ["llm_disagrees", "type_guessed"]
    typed = make_labels(
        openings=[OpeningLabel(id="O1", verdict="window", door_type=None, window_type="fixed")]
    )
    r = run(c, typed)
    assert r.document.openings[r.id_map["O1"]].type == "fixed"
    assert r.confidence.reasons[r.id_map["O1"]] == ["llm_disagrees"]
    unsure = make_labels(openings=[OpeningLabel(id="O1", verdict="unsure", door_type=None, window_type=None)])
    r = run(c, unsure)
    assert r.confidence.openings[r.id_map["O1"]] == 0.62 and r.confidence.reasons[r.id_map["O1"]] == [
        "llm_unsure"
    ]
    # the heuristic labeler is not an LLM: no bonus, no penalty
    r = run(c, agree, options=make_options("none"))
    assert r.confidence.openings[r.id_map["O1"]] == 0.72


def test_confidence_window_and_passage() -> None:
    c = make_candidates(
        openings=[
            op("O1", "W1", 150, 250, "window", "casement", 0.8),
            op("O2", "W3", 150, 250, "opening", "opening", 0.0),
        ]
    )
    r = run(c)
    assert r.confidence.openings[r.id_map["O1"]] == 0.75
    assert r.confidence.openings[r.id_map["O2"]] == 0.45 and r.confidence.reasons[r.id_map["O2"]] == [
        "gap_only"
    ]


def test_confidence_pins_room() -> None:
    r = run(options=make_options("none"))
    rid = r.id_map["R1"]
    assert r.confidence.rooms[rid] == 0.88 and rid not in r.confidence.reasons
    small = make_candidates(rooms=[face("R1", 106, 206, 225, 325)])  # 120 x 120 px = 1.59 m2
    r = run(small, options=make_options("none"))
    rid = r.id_map["R1"]
    assert r.confidence.rooms[rid] == 0.7 and r.confidence.reasons[rid] == ["small_area"]
    # an LLM run without a size label: 0.7 for the size check
    llm = run()
    assert llm.confidence.rooms[llm.id_map["R1"]] == 0.91


def test_confidence_room_size_check_and_open_face() -> None:
    # the face interior is 389 x 289 px = 4084 x 3035 mm at 10.5 mm/px
    ok = make_labels(rooms=[room_label(size_text="4.1x3.0", width_mm=4100, depth_mm=3000)])
    r = run(labels=ok)
    assert r.confidence.rooms[r.id_map["R1"]] == 1.0
    bad = make_labels(rooms=[room_label(size_text="6x6", width_mm=6000, depth_mm=6000)])
    r = run(labels=bad)
    assert r.confidence.rooms[r.id_map["R1"]] == 0.82 and r.confidence.reasons[r.id_map["R1"]] == [
        "size_mismatch"
    ]
    open_face = make_candidates(rooms=[face("R1", 106, 206, 494, 494, open_face=True)])
    r = run(open_face)
    assert r.confidence.reasons[r.id_map["R1"]] == ["open_face"]
    assert r.confidence.rooms[r.id_map["R1"]] == round(0.4 * 0.5 + 0.3 + 0.3 * 0.7, 2)


def test_overall_weighting() -> None:
    walls = [replace(w, free_ends=2) if w.id == "W1" else w for w in rect_walls()]
    c = make_candidates(walls=walls, openings=[op("O1", "W3", 150, 250, support=0.7)])
    r = run(c)
    conf = r.confidence
    lengths = {"W1": 400, "W2": 300, "W3": 400, "W4": 300}
    wmean = sum(conf.walls[r.id_map[k]] * v for k, v in lengths.items()) / sum(lengths.values())
    expected = (
        0.4 * wmean + 0.2 * conf.rooms[r.id_map["R1"]] + 0.1 * conf.openings[r.id_map["O1"]] + 0.3 * 0.9
    )
    assert conf.overall == pytest.approx(expected, abs=0.011)
    assert conf.overall == round(conf.overall, 2)
    empty = run(make_candidates(rooms=[]), make_labels(rooms=[]))  # no rooms, no openings: 0.5 each
    c2 = empty.confidence
    wm = sum(c2.walls[empty.id_map[k]] * v for k, v in lengths.items()) / sum(lengths.values())
    assert c2.overall == pytest.approx(0.4 * wm + 0.2 * 0.5 + 0.1 * 0.5 + 0.3 * 0.9, abs=0.011)


def test_confidence_overrides() -> None:
    c = make_candidates(openings=[op("O1", "W3", 150, 250)])
    r = run(
        c,
        confidence_overrides={"W1": 0.95, "O1": 0.5, "R1": 1.7},
        reason_overrides={"W2": ["single_line_wall"], "W1": []},
    )
    assert r.confidence.walls[r.id_map["W1"]] == 0.95
    assert r.confidence.openings[r.id_map["O1"]] == 0.5 and r.confidence.rooms[r.id_map["R1"]] == 1.0
    assert r.confidence.reasons[r.id_map["W2"]] == ["single_line_wall"]
    plain = run(c)
    assert r.confidence.overall != plain.confidence.overall


# --- meta and background --------------------------------------------------------------------------------


def test_meta_and_background() -> None:
    doc = run().document
    assert doc.schema_version == 1 and doc.meta.created_with == "import"
    assert (doc.meta.default_wall_thickness, doc.meta.floor_thickness) == (115, 150)
    assert (doc.meta.default_wall_height, doc.meta.north_angle) == (2700, None)
    wire = doc.wire()
    assert wire["background"] == {
        "importId": "",
        "mediaUuid": "",
        "pixelWidth": W_PX,
        "pixelHeight": H_PX,
        "mmPerPixel": K,
        "position": {"x": 0, "y": 0},
        "rotation": 0,
        "opacity": 0.5,
        "visible": True,
        "locked": True,
    }
    assert wire["view"] == {"mode2d": None, "mode3d": None, "lastMode": "2d"}
    assert wire["placements"] == {} and wire["fixtures"] == {} and wire["annotations"]["dimensions"] == {}


def test_output_validates() -> None:
    r = run(make_candidates(openings=[op("O1", "W1", 100, 187)]))
    assert PlanDocument.model_validate(r.document.wire()) == r.document


# --- validate-and-repair --------------------------------------------------------------------------------


def hand_doc(length: int = 3000, *, openings: list[tuple[int, int]] | None = None, walls: int = 1):
    """A plan of ``walls`` separate horizontal walls of ``length`` mm, each with the given (offset, width)
    openings on the first wall. Returns (doc, confidence map, wall id, opening ids)."""
    nodes: dict[str, WallNode] = {}
    wls: dict[str, Wall] = {}
    ops: dict[str, Opening] = {}
    for i in range(walls):
        a, b = new_id("n"), new_id("n")
        nodes[a] = WallNode(id=a, x=0, y=i * 100)
        nodes[b] = WallNode(id=b, x=length, y=i * 100)
        wid = new_id("w")
        wls[wid] = Wall(
            id=wid,
            a=a,
            b=b,
            thickness=115,
            height=2700,
            kind="interior",
            justification="center",
            material="brick",
            color_hex=None,
        )
    first = next(iter(wls))
    for offset, width in openings or []:
        oid = new_id("o")
        ops[oid] = Opening(
            id=oid,
            wall_id=first,
            kind="door",
            type="single_swing",
            offset=offset,
            width=width,
            height=2100,
            sill_height=0,
            hinge="start",
            swing="left",
            label=None,
        )
    doc = PlanDocument.model_validate(
        {
            "schemaVersion": 1,
            "meta": PlanMeta(
                default_wall_height=2700,
                default_wall_thickness=115,
                floor_thickness=150,
                north_angle=None,
                created_with="import",
            ).wire(),
            "nodes": {k: v.wire() for k, v in nodes.items()},
            "walls": {k: v.wire() for k, v in wls.items()},
            "openings": {k: v.wire() for k, v in ops.items()},
            "rooms": {},
            "annotations": {"dimensions": {}, "labels": {}},
            "background": None,
            "view": {"mode2d": None, "mode3d": None, "lastMode": "2d"},
        }
    )
    conf = ConfidenceMap(
        walls={k: 0.9 for k in wls},
        openings={k: 0.6 for k in ops},
        rooms={},
        overall=0.8,
        reasons={},
    )
    return doc, conf, first, list(ops)


def test_validate_clamp_and_drop() -> None:
    doc, conf, _, (oid,) = hand_doc(3000, openings=[(200, 900)])
    fixed, warnings = validate_and_repair(doc, confidence=conf, drawing_kind="architectural_line_drawing")
    assert fixed.openings[oid].offset == 450 and not warnings
    doc, conf, _, _ = hand_doc(900, openings=[(450, 900)])
    fixed, _ = validate_and_repair(doc, confidence=conf, drawing_kind="architectural_line_drawing")
    assert not fixed.openings and not conf.openings  # the confidence map is pruned in place
    doc, conf, _, (a, b) = hand_doc(4000, openings=[(1000, 900), (1500, 900)])
    conf.openings[a] = 0.8
    fixed, warnings = validate_and_repair(doc, confidence=conf, drawing_kind="architectural_line_drawing")
    assert list(fixed.openings) == [a]
    (w,) = warnings
    assert (w.code, w.params, w.entity_ids) == ("openings_dropped_overlap", {"count": 1}, [b])
    doc, conf, _, (a, b) = hand_doc(4000, openings=[(1000, 900), (1900, 900)])  # touching is allowed
    fixed, warnings = validate_and_repair(doc, confidence=conf, drawing_kind="architectural_line_drawing")
    assert len(fixed.openings) == 2 and not warnings


def test_validate_short_duplicate_and_orphans() -> None:
    doc, conf, *_ = hand_doc(3000, walls=2)
    ids = list(doc.walls)
    nodes = dict(doc.nodes)
    short_a, short_b, dup_id, orphan = new_id("n"), new_id("n"), new_id("w"), new_id("n")
    nodes[short_a] = WallNode(id=short_a, x=0, y=900)
    nodes[short_b] = WallNode(id=short_b, x=5, y=900)  # 5 mm: degenerate
    nodes[orphan] = WallNode(id=orphan, x=7, y=7)
    walls = dict(doc.walls)
    short_id = new_id("w")
    walls[short_id] = walls[ids[0]].model_copy(update={"id": short_id, "a": short_a, "b": short_b})
    walls[dup_id] = walls[ids[1]].model_copy(
        update={"id": dup_id, "a": walls[ids[1]].b, "b": walls[ids[1]].a}
    )
    doc = doc.model_copy(update={"nodes": nodes, "walls": walls})
    fixed, _ = validate_and_repair(doc, confidence=conf, drawing_kind="architectural_line_drawing")
    assert set(fixed.walls) == set(ids)  # the 5 mm wall and the reversed duplicate are gone
    assert orphan not in fixed.nodes and short_a not in fixed.nodes and len(fixed.nodes) == 4


def test_validate_clamps_numeric_ranges() -> None:
    doc, conf, _, (oid,) = hand_doc(3000, openings=[(1500, 900)])
    ops = {oid: doc.openings[oid].model_copy(update={"height": 2100, "sill_height": 1500})}
    doc = doc.model_copy(update={"openings": ops})
    fixed, _ = validate_and_repair(doc, confidence=conf, drawing_kind="architectural_line_drawing")
    o = fixed.openings[oid]
    assert o.sill_height + o.height <= 2700


def test_validate_errors() -> None:
    doc, conf, *_ = hand_doc(1000, walls=2001)
    with pytest.raises(VisionError) as e:
        validate_and_repair(doc, confidence=conf, drawing_kind="architectural_line_drawing")
    assert (e.value.code, e.value.http_status) == ("too_complex", 422)
    doc, conf, *_ = hand_doc(3000, walls=1)
    empty = doc.model_copy(update={"walls": {}, "openings": {}})
    with pytest.raises(VisionError) as e:
        validate_and_repair(empty, confidence=conf, drawing_kind="architectural_line_drawing")
    assert (e.value.code, e.value.http_status) == ("no_walls_detected", 422)
    doc, conf, *_ = hand_doc(3000, walls=3)
    with pytest.raises(VisionError) as e:
        validate_and_repair(doc, confidence=conf, drawing_kind="not_a_floor_plan")
    assert (e.value.code, e.value.http_status) == ("not_a_floor_plan", 422)
    doc, conf, *_ = hand_doc(3000, walls=5)
    fixed, warnings = validate_and_repair(doc, confidence=conf, drawing_kind="not_a_floor_plan")
    assert len(fixed.walls) == 5 and [w.code for w in warnings] == ["not_a_floor_plan_suspected"]


def test_validate_too_many_openings() -> None:
    doc, conf, first, _ = hand_doc(3000)
    ops = {}
    for _ in range(1001):
        oid = new_id("o")
        ops[oid] = Opening(
            id=oid,
            wall_id=first,
            kind="door",
            type="single_swing",
            offset=1500,
            width=900,
            height=2100,
            sill_height=0,
            hinge="start",
            swing="left",
            label=None,
        )
    with pytest.raises(VisionError) as e:
        validate_and_repair(doc.model_copy(update={"openings": ops}), confidence=conf, drawing_kind="unknown")
    assert e.value.code == "too_complex"


def test_validate_schema_strictness() -> None:
    # TS strictness (progress ruling): angles in [0, 360), colours '#RRGGBB' or null, ids and record keys
    doc, conf, first, _ = hand_doc(3000)
    wls = {first: doc.walls[first].model_copy(update={"color_hex": "red"})}
    rid = new_id("r")
    rooms = {
        rid: RoomMeta(
            id=rid,
            anchor={"x": 1, "y": 1},
            name="Room",
            type="other",
            floor_finish="tile",  # type: ignore[arg-type]
            floor_color_hex="#abcdef",
            label_offset=None,
            show_area=True,
        )
    }
    meta = doc.meta.model_copy(update={"north_angle": -90.0})
    fixed, _ = validate_and_repair(
        doc.model_copy(update={"walls": wls, "rooms": rooms, "meta": meta}),
        confidence=conf,
        drawing_kind="unknown",
    )
    assert fixed.walls[first].color_hex is None and fixed.rooms[rid].floor_color_hex == "#abcdef"
    assert fixed.meta.north_angle == 270.0
    bad_key = doc.model_copy(update={"walls": {"w_bad": doc.walls[first]}})
    with pytest.raises(VisionError) as e:
        validate_and_repair(bad_key, confidence=conf, drawing_kind="unknown")
    assert e.value.code == "internal_error"
