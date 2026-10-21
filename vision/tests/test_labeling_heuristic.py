"""Task 19: the labeler interface, the heuristic labeler (provider ``none``, 06 §9.7) and the vendor protocol.

Fixture ``CandidateSet``s are built in code: a 1000 x 800 plan region, ``t_median`` 10, room faces as
rectangles and tokens from ``parse_token`` so the parsed kinds are the real ones.
"""

from app.pipeline.labeling.base import Labeler, LabelingOutcome
from app.pipeline.labeling.heuristic import HeuristicLabeler
from app.pipeline.labeling.vendor import RecognitionVendor
from app.pipeline.textparse import parse_token
from app.schemas.api import KnownDimension, RecognizeHints
from app.schemas.candidates import (
    CandidateSet,
    DimensionSpan,
    OpeningCandidate,
    RoomFace,
    TextToken,
    WallCandidate,
)
from app.schemas.labeling import MissedRoom
from app.schemas.meta import MetaWarning
from app.utils.geometry import Rect
from tests.test_normalize import make_ctx

REGION = Rect(0, 0, 1000, 800)
T = 10.0
SIZE_TEXT = "10'0\"X11'0\""


def token(tid: str, text: str, cx: float, cy: float, height: float = 20.0, angle: int = 0) -> TextToken:
    w = 0.6 * height * max(len(text), 1)
    x0, y0, x1, y1 = cx - w / 2, cy - height / 2, cx + w / 2, cy + height / 2
    quad = ((x0, y0), (x1, y0), (x1, y1), (x0, y1))
    return TextToken(tid, text, quad, (x0, y0, x1, y1), 0, 0.99, height, parse_token(text))  # type: ignore[arg-type]


def face(fid: str, box: tuple[float, float, float, float], texts: tuple[str, ...] = ()) -> RoomFace:
    x0, y0, x1, y1 = box
    poly = ((x0, y0), (x1, y0), (x1, y1), (x0, y1))
    return RoomFace(fid, poly, ((x0 + x1) / 2, (y0 + y1) / 2), (x1 - x0) * (y1 - y0), box, texts, False)


def span(sid: str, p0: tuple[float, float], p1: tuple[float, float], near: list[str]) -> DimensionSpan:
    return DimensionSpan(sid, p0, p1, "x", "chain_segment", near, "L1")


def wall(wid: str, source: str = "filled") -> WallCandidate:
    return WallCandidate(wid, (0, 0), (100, 0), "N1", "N2", T, source, 1.0, 0, ())  # type: ignore[arg-type]


def opening(oid: str, kind: str, support: float) -> OpeningCandidate:
    return OpeningCandidate(oid, "W1", 10, 50, kind, "single_swing", "start", "left", support)  # type: ignore[arg-type]


def cands(
    texts: list[TextToken],
    rooms: list[RoomFace] | None = None,
    spans: list[DimensionSpan] | None = None,
    walls: list[WallCandidate] | None = None,
    openings: list[OpeningCandidate] | None = None,
) -> CandidateSet:
    return CandidateSet(
        texts=texts, segments=[], dimension_lines=[], spans=spans or [], nodes={}, walls=walls or [],
        gaps=[], openings=openings or [], rooms=rooms or [], theta0=0.0, t_thin=2.0, t_median=T,
        region=REGION, drawing_kind_cv="colored_brochure",
    )  # fmt: skip


def run(c: CandidateSet, hints: RecognizeHints | None = None) -> tuple[LabelingOutcome, list[str]]:
    ctx = make_ctx()
    outcome = HeuristicLabeler().label(None, c, hints or RecognizeHints(), ctx)  # type: ignore[arg-type]
    return outcome, [w.code for w in ctx.warnings]


def imperial_tokens() -> list[TextToken]:
    return [
        token(f"T{k}", text, 100 + 60 * k, 750) for k, text in enumerate(["8'6\"", "9'0\"", "12'0\""], 10)
    ]


def bedroom_plan() -> CandidateSet:
    """Face R1 with BEDROOM (height 30) and the size text, three more feet-inch tokens elsewhere."""
    name = token("T1", "BEDROOM", 250, 200, height=30)
    size = token("T2", SIZE_TEXT, 250, 260)
    return cands([name, size, *imperial_tokens()], [face("R1", (100, 100, 400, 400), ("T1", "T2"))])


# --- interface -------------------------------------------------------------------------------------------


def test_heuristic_labeler_satisfies_the_protocols() -> None:
    labeler: Labeler = HeuristicLabeler()
    assert callable(labeler.label)

    class Vendor:
        name = "acme"

        def recognize(self, image_png: bytes, hints: RecognizeHints, timeout_s: float) -> object:
            return None

    vendor: RecognitionVendor = Vendor()
    assert vendor.name == "acme"


# --- units -----------------------------------------------------------------------------------------------


def test_imperial_rooms() -> None:
    out, warnings = run(bedroom_plan())
    r = out.result
    assert r.unit_system == "imperial"
    assert "unit_system_guessed" not in warnings
    [room] = r.rooms
    assert room.id == "R1" and room.include is True
    assert (room.name, room.type, room.name_text_id) == ("Bedroom", "bedroom", "T1")
    assert room.size_text == SIZE_TEXT
    assert (room.width_mm, room.depth_mm) == (3048, 3353)
    roles = {t.id: t.role for t in r.texts}
    assert roles["T1"] == "room_name" and roles["T2"] == "room_size"
    assert next(t for t in r.texts if t.id == "T1").normalized_text == "Bedroom"


def metric_plan() -> CandidateSet:
    texts = [token(f"T{k}", str(n), 100 + 150 * k, 40) for k, n in enumerate([3000, 2400, 5400], 1)]
    spans = [
        span("D1", (100, 60), (250, 60), ["T1"]),
        span("D2", (250, 60), (400, 60), ["T2"]),
        span("D3", (100, 60), (400, 60), ["T3"]),
    ]
    spans[2] = DimensionSpan("D3", (100, 60), (400, 60), "x", "overall", ["T3"], "L1")
    spans[1] = span("D2", (250, 60), (400, 60), ["T2"])
    return cands(texts, spans=spans)


def test_metric_from_spans() -> None:
    out, warnings = run(metric_plan())
    r = out.result
    assert r.unit_system == "metric" and "unit_system_guessed" not in warnings
    assert {t.id: t.role for t in r.texts} == {"T1": "dimension", "T2": "dimension", "T3": "dimension"}
    by_text = {d.text_id: d for d in r.dimensions}
    assert len(by_text) == 3
    assert all(d.span_id is not None and d.value_mm is not None for d in by_text.values())
    assert [(d.text_id, d.span_id, d.value_mm) for d in r.dimensions]  # one label per associated token
    assert {d.value_mm for d in r.dimensions} == {3000, 2400, 5400}
    assert {d.kind for d in r.dimensions} <= {"chain_segment", "overall"}


def test_dimension_labels_outside_the_plan_region_keep_their_role() -> None:
    """The outer dimension chains lie in the annotation margin (Task 14b ruling B1): their labels are
    dimensions, not ``ignore``; a number no span lists outside the region is ``ignore``."""
    c = metric_plan()
    margin = [token(f"T{k}", str(n), 100 + 150 * k, -30) for k, n in enumerate([3000, 2400, 5400], 1)]
    stray = token("T9", "1800", 500, -30)
    out, _ = run(
        cands(
            [*margin, stray],
            spans=[span(s.id, (s.p0[0], -10), (s.p1[0], -10), s.near_text_ids) for s in c.spans],
        )
    )
    roles = {t.id: t.role for t in out.result.texts}
    assert roles == {"T1": "dimension", "T2": "dimension", "T3": "dimension", "T9": "ignore"}
    assert out.result.unit_system == "metric"


def test_unknown_unit_warns() -> None:
    out, warnings = run(
        cands([token("T1", "BEDROOM", 250, 200)], [face("R1", (100, 100, 400, 400), ("T1",))])
    )
    assert out.result.unit_system == "unknown"
    assert warnings == ["unit_system_guessed"]


def test_two_imperial_tokens_are_not_enough() -> None:
    out, warnings = run(cands(imperial_tokens()[:2]))
    assert out.result.unit_system == "unknown" and "unit_system_guessed" in warnings


def test_metric_size_pairs_are_not_imperial_evidence() -> None:
    texts = [token(f"T{k}", "3.0 x 3.6", 100 + 100 * k, 700) for k in range(3)]
    assert run(cands(texts))[0].result.unit_system == "unknown"


def test_hint_wins() -> None:
    hints = RecognizeHints(unit_system="metric")
    out, warnings = run(bedroom_plan(), hints)
    assert out.result.unit_system == "metric" and warnings == []
    # the size text still parses to millimetres, whatever the unit system
    assert (out.result.rooms[0].width_mm, out.result.rooms[0].depth_mm) == (3048, 3353)


def test_imperial_hint_gives_no_mm_values_for_plain_numbers() -> None:
    out, _ = run(metric_plan(), RecognizeHints(unit_system="imperial"))
    assert out.result.unit_system == "imperial"
    assert {d.value_mm for d in out.result.dimensions} == {None}


# --- rooms -----------------------------------------------------------------------------------------------


def test_multiple_names_highest_wins() -> None:
    small = token("T1", "STORE", 200, 150, height=18)
    big = token("T2", "KITCHEN", 250, 250, height=34)
    out, _ = run(cands([small, big], [face("R1", (100, 100, 400, 400), ("T1", "T2"))]))
    [room] = out.result.rooms
    assert (room.name, room.type, room.name_text_id) == ("Kitchen", "kitchen", "T2")
    roles = {t.id: t.role for t in out.result.texts}
    assert roles == {"T1": "room_name", "T2": "room_name"}  # assembly makes the merged label
    assert out.result.missed_rooms == []


def test_face_without_a_name_is_included_unnamed() -> None:
    out, _ = run(cands([], [face("R1", (100, 100, 400, 400))]))
    room = out.result.rooms[0]
    assert room.include is True
    assert (room.name, room.type, room.name_text_id, room.size_text) == (None, None, None, None)
    assert (room.width_mm, room.depth_mm) == (None, None)


def test_size_text_just_below_the_name_outside_the_face_list() -> None:
    """A size pair the face does not list but that sits within 2 text heights below the name is its size."""
    name = token("T1", "LIVING", 250, 200, height=30)
    size = token("T2", "12'0\"X14'0\"", 250, 245)
    far = token("T3", "9'0\"X9'0\"", 250, 360)
    out, _ = run(cands([name, size, far], [face("R1", (100, 100, 400, 400), ("T1",))]))
    room = out.result.rooms[0]
    assert room.size_text == "12'0\"X14'0\"" and room.width_mm == 3658


def test_size_pair_inside_the_face_wins_over_one_below_the_name() -> None:
    name = token("T1", "LIVING", 250, 200, height=30)
    below = token("T2", "12'0\"X14'0\"", 250, 245)
    inside = token("T3", "9'0\"X9'0\"", 250, 360)
    out, _ = run(cands([name, below, inside], [face("R1", (100, 100, 400, 400), ("T1", "T3"))]))
    assert out.result.rooms[0].size_text == "9'0\"X9'0\""


def corridor_plan(box: tuple[float, float, float, float]) -> CandidateSet:
    name = token("T1", "CORRIDOR", (box[0] + box[2]) / 2, (box[1] + box[3]) / 2)
    return cands([name], [face("R1", box, ("T1",))])


def test_corridor_touching_boundary_excluded() -> None:
    near = run(corridor_plan((100, 18, 400, 120)))[0].result.rooms[0]  # 18 px below the region top (<= 2 t)
    assert near.include is False and near.type == "corridor"
    away = run(corridor_plan((100, 21, 400, 120)))[0].result.rooms[0]  # just over 2 t
    assert away.include is True
    inner = run(corridor_plan((100, 300, 400, 400)))[0].result.rooms[0]
    assert inner.include is True


def test_ots_on_the_boundary_is_excluded_and_a_named_room_never() -> None:
    name = token("T1", "OTS", 200, 300)
    r = run(cands([name], [face("R1", (100, 200, 400, 785), ("T1",))]))[0].result.rooms[
        0
    ]  # 15 px off the bottom
    assert r.include is False
    bed = token("T2", "BEDROOM", 200, 300)
    r = run(cands([bed], [face("R1", (100, 200, 400, 785), ("T2",))]))[0].result.rooms[0]
    assert r.include is True
    both = [token("T1", "CORRIDOR", 150, 300), token("T2", "BEDROOM", 300, 300)]
    r = run(cands(both, [face("R1", (100, 200, 400, 785), ("T1", "T2"))]))[0].result.rooms[0]
    assert r.include is True  # the corridor is not its only name


def test_missed_rooms() -> None:
    inside = token("T1", "BEDROOM", 250, 200)
    lost = token("T2", "DINING", 600, 500)
    outside = token("T3", "KITCHEN", 1200, 500)  # right of the plan region
    out, _ = run(cands([inside, lost, outside], [face("R1", (100, 100, 400, 400), ("T1",))]))
    assert out.result.missed_rooms == [MissedRoom(name="Dining", type="dining", x=600, y=500)]
    roles = {t.id: t.role for t in out.result.texts}
    assert roles == {"T1": "room_name", "T2": "room_name", "T3": "ignore"}


# --- Task 18 M4: a token centred on a wall belongs to the face it touches ----------------------------------


def test_name_on_the_wall_belongs_to_the_face_within_one_t() -> None:
    on_wall = token("T1", "BEDROOM", 405, 250)  # centred 5 px beyond R1's boundary, in the 10 px wall
    out, _ = run(cands([on_wall], [face("R1", (100, 100, 400, 400))]))
    assert out.result.missed_rooms == []
    assert out.result.rooms[0].name == "Bedroom" and out.result.rooms[0].name_text_id == "T1"


def test_name_further_than_one_t_from_every_face_is_missed() -> None:
    far = token("T1", "BEDROOM", 411, 250)
    out, _ = run(cands([far], [face("R1", (100, 100, 400, 400))]))
    assert [m.name for m in out.result.missed_rooms] == ["Bedroom"]
    assert out.result.rooms[0].name is None


def test_name_touching_two_faces_goes_to_the_nearer_anchor() -> None:
    # centred 4 px from both R1's edge (x 400) and R2's (x 408)
    t = token("T1", "KITCHEN", 404, 250)
    small_right = face("R2", (408, 100, 700, 400))  # anchor x 554: 150 px away, nearer than R1's 154
    out, _ = run(cands([t], [face("R1", (100, 100, 400, 400)), small_right]))
    assert {r.id: r.name_text_id for r in out.result.rooms} == {"R1": None, "R2": "T1"}
    wide_right = face("R2", (408, 100, 999, 400))  # anchor x 703: R1's anchor is nearer
    out, _ = run(cands([t], [face("R1", (100, 100, 400, 400)), wide_right]))
    assert {r.id: r.name_text_id for r in out.result.rooms} == {"R1": "T1", "R2": None}
    assert out.result.missed_rooms == []


def test_a_token_listed_by_a_face_stays_in_it() -> None:
    inside = token("T1", "BEDROOM", 395, 250)  # in R1, and also within 1 t of R2's boundary
    out, _ = run(
        cands([inside], [face("R1", (100, 100, 400, 400), ("T1",)), face("R2", (402, 100, 700, 400))])
    )
    assert {r.id: r.name_text_id for r in out.result.rooms} == {"R1": "T1", "R2": None}


# --- walls, openings, dimensions, meta -------------------------------------------------------------------


def test_walls_and_openings() -> None:
    c = cands(
        [],
        walls=[
            wall("W1", "filled"),
            wall("W2", "single_line"),
            wall("W3", "double_line"),
            wall("W4", "vector"),
        ],
        openings=[
            opening("O1", "door", 0.8),
            opening("O2", "window", 0.5),
            opening("O3", "door", 0.3),
            opening("O4", "opening", 0.0),
        ],
    )
    r = run(c)[0].result
    assert [(w.id, w.verdict, w.kind) for w in r.walls] == [
        ("W1", "wall", None), ("W2", "unsure", None), ("W3", "wall", None), ("W4", "wall", None),
    ]  # fmt: skip
    assert [(o.id, o.verdict, o.door_type, o.window_type) for o in r.openings] == [
        ("O1", "door", None, None), ("O2", "window", None, None),
        ("O3", "unsure", None, None), ("O4", "opening", None, None),  # a passage: support 0 by definition
    ]  # fmt: skip
    assert r.missed_openings == []


def test_known_dimension() -> None:
    def label(text: str) -> tuple[LabelingOutcome, list[MetaWarning]]:
        ctx = make_ctx()
        hints = RecognizeHints(unit_system="metric", known_dimension=KnownDimension(label=text, mm=9000))
        return HeuristicLabeler().label(None, cands([]), hints, ctx), ctx.warnings  # type: ignore[arg-type]

    out, warns = label("Overall width")
    match = out.result.known_dimension_match
    assert match is not None and match.wall_id is None and match.span_id is None
    assert warns == []
    for text in ("TOTAL LENGTH", "overall depth"):
        assert label(text)[0].result.known_dimension_match is not None

    out, warns = label("Kitchen")
    assert out.result.known_dimension_match is None
    [w] = warns
    assert (w.code, w.params) == ("known_dimension_unmatched", {"label": "Kitchen"})
    assert label("Overall")[0].result.known_dimension_match is None  # needs width / length / depth too

    out, codes = run(cands([]))
    assert out.result.known_dimension_match is None and "known_dimension_unmatched" not in codes


def test_outcome_meta() -> None:
    out, _ = run(bedroom_plan())
    assert out.provider_used == "none" and out.model is None
    assert out.calls == [] and out.partial is False and out.fallback_reason is None
    assert out.result.notes is None
    assert out.result.missed_openings == []


def test_drawing_kind_from_cv() -> None:
    out, _ = run(cands([]))
    assert out.result.drawing_kind == "colored_brochure"
    c = cands([])
    for kind in ("cad_vector", "photo_of_drawing"):
        assert run(CandidateSet(**{**c.__dict__, "drawing_kind_cv": kind}))[0].result.drawing_kind == kind  # type: ignore[arg-type]
    unknown = CandidateSet(**{**c.__dict__, "drawing_kind_cv": "unknown"})
    assert run(unknown)[0].result.drawing_kind == "architectural_line_drawing"


def test_roles_of_the_other_kinds() -> None:
    texts = [
        token("T1", "912 SQ.FT", 100, 700),
        token("T2", "D1", 200, 700),
        token("T3", "SCALE 1:100", 300, 700),
        token("T4", "FLAT-105", 400, 700),
        token("T5", "1200", 500, 700),  # a number no span lists
        token("T6", "8'6\"", 600, 700),
    ]
    roles = {t.id: t.role for t in run(cands(texts))[0].result.texts}
    assert roles == {
        "T1": "area", "T2": "opening_tag", "T3": "title", "T4": "other", "T5": "other", "T6": "other",
    }  # fmt: skip


def test_garbled_foot_marks_still_show_an_imperial_plan() -> None:
    """OCR turns ``10'0"x11'0"`` into ``8'1x50``: kind ``other``, but a digit token with foot marks."""
    texts = [
        token(f"T{k}", text, 100 + 100 * k, 700) for k, text in enumerate(["8'1x50", "6'6'x7", '51X76"'])
    ]
    assert [t.parsed.kind for t in texts] == ["other"] * 3
    out, warns = run(cands(texts))
    assert out.result.unit_system == "imperial" and warns == []
    assert run(cands([token("T1", "FLAT-105", 100, 700)] * 3))[0].result.unit_system == "unknown"


def test_a_metric_pair_on_an_imperial_plan_gives_no_size() -> None:
    """``100x110`` is ``10'0"x11'0"`` without its marks; read as millimetres it would be a 10 cm room."""
    name = token("T1", "BEDROOM", 250, 200, height=30)
    lost = token("T2", "100\u00d7110", 250, 260)
    assert lost.parsed.kind == "size_pair" and not lost.parsed.pair_imperial
    c = cands([name, lost, *imperial_tokens()], [face("R1", (100, 100, 400, 400), ("T1", "T2"))])
    room = run(c)[0].result.rooms[0]
    assert (room.size_text, room.width_mm, room.depth_mm) == ("100\u00d7110", None, None)
    metric = run(c, RecognizeHints(unit_system="metric"))[0].result.rooms[0]
    assert (metric.width_mm, metric.depth_mm) == (100, 110)


def test_fuzzy_room_names_use_the_dictionary_name() -> None:
    """``TOILE`` matched ``TOILET`` fuzzily: the name is the canonical one. Exact names (also inside a longer
    note) and the ``missedRooms`` entries keep the token's own words."""
    fuzzy = token("T1", "TOILE", 200, 200)
    exact = token("T2", "LIVING ROOM", 600, 200)
    note = token("T3", "5 FEET WIDE CORRIDOR", 600, 600)
    lost = token("T4", "BATHROM", 800, 600)
    assert [t.parsed.room_name for t in (fuzzy, exact, note, lost)] == [
        "TOILET",
        "LIVING ROOM",
        "CORRIDOR",
        "BATHROOM",
    ]
    c = cands(
        [fuzzy, exact, note, lost],
        [face("R1", (100, 100, 400, 400), ("T1",)), face("R2", (500, 100, 700, 400), ("T2",))],
    )
    r = run(c)[0].result
    assert [(x.name, x.type) for x in r.rooms] == [("Toilet", "toilet"), ("Living Room", "living")]
    assert {t.id: t.normalized_text for t in r.texts if t.role == "room_name"} == {
        "T1": "Toilet", "T2": "Living Room", "T3": "5 Feet Wide Corridor", "T4": "Bathroom",
    }  # fmt: skip
    assert [(m.name, m.type) for m in r.missed_rooms] == [
        ("5 Feet Wide Corridor", "corridor"),
        ("Bathroom", "bathroom"),
    ]
