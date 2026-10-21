"""Task 19: the labeler interface, the heuristic labeler (provider ``none``, 06 §9.7) and the vendor protocol.

Fixture ``CandidateSet``s are built in code: a 1000 x 800 plan region, ``t_median`` 10, room faces as
rectangles and tokens from ``parse_token`` so the parsed kinds are the real ones.
"""

import pytest

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
from tests.support.labeling import checked
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
    checked(outcome.result)
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


def test_the_protocols_type_the_labeler_and_a_vendor() -> None:
    """Both protocols are structural (the type checker holds the labeler and a vendor to them); a labeler
    behind the ``Labeler`` type returns a ``LabelingOutcome``."""

    class Vendor:
        name = "acme"

        def recognize(self, image_png: bytes, hints: RecognizeHints, timeout_s: float) -> object:
            return None

    labeler: Labeler = HeuristicLabeler()
    vendor: RecognitionVendor = Vendor()
    outcome = labeler.label(None, cands([]), RecognizeHints(), make_ctx())  # type: ignore[arg-type]
    assert isinstance(outcome, LabelingOutcome)
    assert vendor.recognize(b"", RecognizeHints(), 1.0) is None and vendor.name == "acme"


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


def chain(values: list[int | str], x0: float = 100, step: float = 150, y: float = 40) -> CandidateSet:
    """A dimension chain: one token per value, each listed by its own span below it."""
    texts, spans = [], []
    for k, value in enumerate(values, 1):
        x = x0 + step * (k - 1)
        texts.append(token(f"T{k}", str(value), x + step / 2, y))
        spans.append(span(f"D{k}", (x, y + 20), (x + step, y + 20), [f"T{k}"]))
    return cands(texts, spans=spans)


def metric_plan() -> CandidateSet:
    return chain([3000, 2400, 5400])


def test_metric_from_spans() -> None:
    out, warnings = run(metric_plan())
    r = out.result
    assert r.unit_system == "metric" and "unit_system_guessed" not in warnings
    assert {t.id: t.role for t in r.texts} == {"T1": "dimension", "T2": "dimension", "T3": "dimension"}
    by_text = {d.text_id: d for d in r.dimensions}
    assert {k: (d.span_id, d.value_mm) for k, d in by_text.items()} == {
        "T1": ("D1", 3000), "T2": ("D2", 2400), "T3": ("D3", 5400),
    }  # fmt: skip
    assert {d.kind for d in r.dimensions} <= {"chain_segment", "overall"}


def test_dimension_labels_outside_the_plan_region_keep_their_role() -> None:
    """The outer dimension chains lie in the annotation margin (Task 14b ruling B1): their labels are
    dimensions, not ``ignore``; a number no span lists outside the region is ``ignore``."""
    c = chain([3000, 2400, 5400], y=-30)  # tokens above the region (y < 0), spans just below them
    stray = token("T9", "1800", 500, -30)
    out, _ = run(cands([*c.texts, stray], spans=c.spans))
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


# --- fix round 1: units are weighed ----------------------------------------------------------------------


def mixed_plan() -> CandidateSet:
    """Twelve span-listed millimetre dimensions and three rooms sized in feet-inch."""
    c = chain([3000 + 100 * k for k in range(12)], step=80)
    faces = [
        face(f"R{k}", (100 + 300 * (k - 1), 100, 380 + 300 * (k - 1), 400), (f"T{20 + k}",))
        for k in (1, 2, 3)
    ]
    sizes = [token(f"T{20 + k}", f"{8 + k}'0\"X10'0\"", 240 + 300 * (k - 1), 300) for k in (1, 2, 3)]
    return cands([*c.texts, *sizes], faces, c.spans)


def test_mixed_units_are_weighed_not_counted() -> None:
    """12 millimetre dimensions (weight 24) against 3 feet-inch sizes (weight 3): a metric plan; every
    dimension keeps its value and each size text still converts by its own marks."""
    r = run(mixed_plan())[0].result
    assert r.unit_system == "metric"
    assert [d.value_mm for d in r.dimensions] == [3000 + 100 * k for k in range(12)]
    assert [(room.width_mm, room.depth_mm) for room in r.rooms] == [(2743, 3048), (3048, 3048), (3353, 3048)]


def test_stray_quote_marks_do_not_make_a_metric_plan_imperial() -> None:
    stray = [
        token(f"T{k}", text, 100 + 100 * k, 700) for k, text in enumerate(["2400'", "'3000", '900"'], 40)
    ]
    assert [t.parsed.kind for t in stray] == ["other"] * 3
    plan = cands([*metric_plan().texts, *stray], spans=metric_plan().spans)
    r = run(plan)[0].result
    assert r.unit_system == "metric" and {d.value_mm for d in r.dimensions} == {3000, 2400, 5400}


def test_metric_lengths_with_spans_make_a_metric_plan() -> None:
    plan = chain(["3.2 m", "2400 mm", "5.4m"])
    assert [t.parsed.kind for t in plan.texts] == ["metric_length"] * 3
    out, warns = run(plan)
    assert out.result.unit_system == "metric" and warns == []
    assert [d.value_mm for d in out.result.dimensions] == [3200, 2400, 5400]
    assert {t.role for t in out.result.texts} == {"dimension"}


def test_imperial_needs_more_weight_than_the_metric_dimensions() -> None:
    feet = imperial_tokens()  # three feet-inch values: weight 3
    one = chain([3000])  # one span-listed dimension: weight 2
    r = run(cands([*one.texts, *feet], spans=one.spans))[0].result
    assert r.unit_system == "imperial" and [d.value_mm for d in r.dimensions] == [None]
    two = chain(
        [3000, 2400]
    )  # weight 4 against 3: not imperial, and two dimensions are not enough for metric
    out, warns = run(cands([*two.texts, *feet], spans=two.spans))
    assert out.result.unit_system == "unknown" and warns == ["unit_system_guessed"]


def test_millimetre_numbers_no_span_lists_are_no_evidence() -> None:
    texts = [token(f"T{k}", str(1000 + k), 100 + 80 * k, 700) for k in range(5)]
    out, warns = run(cands(texts))
    assert out.result.unit_system == "unknown" and warns == ["unit_system_guessed"]


def test_sq_ft_areas_count_as_imperial_and_sq_m_areas_do_not() -> None:
    feet = [token("T1", "8'6\"", 100, 700), token("T2", "9'0\"", 200, 700)]
    sqft = run(cands([*feet, token("T3", "912 SQ.FT", 300, 700)]))[0].result.unit_system
    sqm = run(cands([*feet, token("T3", "85 M2", 300, 700)]))[0].result.unit_system
    assert (sqft, sqm) == ("imperial", "unknown")


def test_quote_marks_without_digits_are_no_evidence() -> None:
    texts = [token(f"T{k}", text, 100 + 100 * k, 700) for k, text in enumerate(["FLAT'S", "MR'S", '"NOTE"'])]
    assert [t.parsed.kind for t in texts] == ["other"] * 3
    assert run(cands(texts))[0].result.unit_system == "unknown"


# --- fix round 1: names ----------------------------------------------------------------------------------


def named_face(*words: TextToken) -> CandidateSet:
    return cands(list(words), [face("R1", (100, 100, 600, 400), tuple(w.id for w in words))])


def test_split_names_are_joined() -> None:
    """``MASTER`` + ``BEDROOM`` (gap 10 px, half a text height) read as the one name."""
    first, second = token("T1", "MASTER", 200, 200), token("T2", "BEDROOM", 288, 200)
    assert first.parsed.kind == "other" and second.parsed.room_name == "BEDROOM"
    r = run(named_face(first, second))[0].result
    [room] = r.rooms
    assert (room.name, room.type, room.name_text_id) == ("Master Bedroom", "master_bedroom", "T1")
    assert {t.id: (t.role, t.normalized_text) for t in r.texts} == {
        "T1": ("room_name", "Master Bedroom"), "T2": ("room_name", "Master Bedroom"),
    }  # fmt: skip
    assert r.missed_rooms == []


def test_living_room_split_in_two_words() -> None:
    first, second = token("T1", "LIVING", 200, 200), token("T2", "ROOM", 285, 200)
    [room] = run(named_face(first, second))[0].result.rooms
    assert (room.name, room.type) == ("Living Room", "living")


def test_words_further_apart_than_one_and_a_half_heights_stay_apart() -> None:
    near = run(named_face(token("T1", "MASTER", 200, 200), token("T2", "BEDROOM", 295, 200)))[0].result
    far = run(named_face(token("T1", "MASTER", 200, 200), token("T2", "BEDROOM", 316, 200)))[0].result
    assert near.rooms[0].name == "Master Bedroom"  # gap 29 <= 1.5 x 20
    assert (far.rooms[0].name, far.rooms[0].type) == ("Bedroom", "bedroom")  # gap 36 > 30
    assert {t.id: t.role for t in far.texts} == {"T1": "other", "T2": "room_name"}


def test_two_rooms_side_by_side_are_not_one_name() -> None:
    """``BEDROOM`` next to ``TOILET`` joins to no longer key: they stay two names."""
    a, b = token("T1", "BEDROOM", 200, 200), token("T2", "TOILET", 290, 200)
    r = run(cands([a, b], [face("R1", (100, 100, 600, 400), ("T1", "T2"))]))[0].result
    assert r.rooms[0].name == "Bedroom"
    assert r.rooms[0].name_text_id == "T1"


def test_words_on_different_lines_or_heights_are_not_joined() -> None:
    lower = token("T2", "BEDROOM", 288, 232)  # a line below
    assert run(named_face(token("T1", "MASTER", 200, 200), lower))[0].result.rooms[0].name == "Bedroom"
    small = token("T2", "BEDROOM", 288, 200, height=12)  # a different size
    assert run(named_face(token("T1", "MASTER", 200, 200), small))[0].result.rooms[0].name == "Bedroom"


def test_words_in_two_faces_are_not_joined() -> None:
    a, b = token("T1", "MASTER", 200, 200), token("T2", "BEDROOM", 288, 200)
    c = cands([a, b], [face("R1", (100, 100, 244, 400), ("T1",)), face("R2", (244, 100, 600, 400), ("T2",))])
    assert [r.name for r in run(c)[0].result.rooms] == [None, "Bedroom"]


def test_a_joined_name_outside_every_face_is_one_missed_room() -> None:
    first, second = token("T1", "MASTER", 700, 500), token("T2", "BEDROOM", 788, 500)
    out, _ = run(cands([first, second], [face("R1", (100, 100, 400, 400))]))
    assert [(m.name, m.type) for m in out.result.missed_rooms] == [("Master Bedroom", "master_bedroom")]


def test_numbers_stay_on_fuzzy_names() -> None:
    texts = ["BEDROM 2", "BEDROOM 3", "TOILE 1"]
    names = [run(named_face(token("T1", text, 250, 200)))[0].result.rooms[0].name for text in texts]
    assert names == ["Bedroom 2", "Bedroom 3", "Toilet 1"]


def test_abbreviations_get_the_default_name_of_their_type() -> None:
    expected = {
        "OTS": ("OTS", "ots"),
        "WC": ("Toilet", "toilet"),
        "MBR": ("Master Bedroom", "master_bedroom"),
    }
    for text, (name, kind) in expected.items():
        t = token("T1", text, 250, 200)
        [room] = run(cands([t], [face("R1", (100, 100, 400, 400), ("T1",))]))[0].result.rooms
        assert (room.name, room.type) == (name, kind), text
    lost = run(cands([token("T1", "OTS", 700, 500)]))[0].result.missed_rooms
    assert [(m.name, m.type) for m in lost] == [("OTS", "ots")]


# --- fix round 1: survivors of the review's mutation run -------------------------------------------------


def test_corridor_on_the_left_and_right_borders_is_excluded() -> None:
    def room(box: tuple[float, float, float, float]) -> bool:
        return run(corridor_plan(box))[0].result.rooms[0].include

    assert room((18, 200, 300, 400)) is False and room((21, 200, 300, 400)) is True
    assert room((200, 200, 982, 400)) is False and room((200, 200, 979, 400)) is True


def test_a_name_within_one_t_of_a_face_but_further_than_half_a_t_belongs_to_it() -> None:
    on_wall = token("T1", "BEDROOM", 409, 250)  # 9 px past R1's edge: > 0.5 t, <= 1 t
    assert run(cands([on_wall], [face("R1", (100, 100, 400, 400))]))[0].result.rooms[0].name == "Bedroom"


def test_equal_height_names_go_to_the_topmost() -> None:
    low, high = token("T1", "STORE", 250, 300), token("T2", "KITCHEN", 250, 150)
    [room] = run(named_face(low, high))[0].result.rooms
    assert room.name_text_id == "T2"
    left, right = token("T1", "STORE", 400, 200), token("T2", "KITCHEN", 200, 200)
    assert run(named_face(left, right))[0].result.rooms[0].name_text_id == "T2"


@pytest.mark.parametrize(
    ("support", "verdict"), [(0.39, "unsure"), (0.4, "door"), (0.45, "door"), (0.0, "unsure")]
)
def test_door_support_threshold(support: float, verdict: str) -> None:
    [o] = run(cands([], openings=[opening("O1", "door", support)]))[0].result.openings
    assert o.verdict == verdict


# name LIVING: centre (250, 200), height 30, box x 196..304, y 185..215; a size text is 20 high
def size_below(cy: float, cx: float = 250, tid: str = "T2") -> TextToken:
    return token(tid, "12'0\"X14'0\"", cx, cy)


@pytest.mark.parametrize(
    ("cy", "cx", "found"),
    [
        (245, 250, True),  # 20 px under the name
        (275, 250, True),  # 50 px under it: within 2 text heights (60)
        (295, 250, False),  # 70 px under it: out of reach
        (205, 250, False),  # overlaps the name's lower half
        (150, 250, False),  # above the name
        (245, 450, False),  # beside the name's column
    ],
)
def test_size_text_below_the_name(cy: float, cx: float, found: bool) -> None:
    name = token("T1", "LIVING", 250, 200, height=30)
    [room] = run(cands([name, size_below(cy, cx)], [face("R1", (100, 100, 600, 400), ("T1",))]))[
        0
    ].result.rooms
    assert (room.size_text is not None) is found


def test_the_size_text_nearest_the_name_wins() -> None:
    name = token("T1", "LIVING", 250, 200, height=30)
    far, near = size_below(262, tid="T2"), token("T3", "9'0\"X9'0\"", 250, 240)
    [room] = run(cands([name, far, near], [face("R1", (100, 100, 600, 400), ("T1",))]))[0].result.rooms
    assert room.size_text == "9'0\"X9'0\"" and room.width_mm == 2743


def test_a_size_text_another_face_lists_is_not_taken() -> None:
    name = token("T1", "LIVING", 250, 200, height=30)
    other = size_below(245)
    c = cands(
        [name, other], [face("R1", (100, 100, 600, 220), ("T1",)), face("R2", (100, 220, 600, 400), ("T2",))]
    )
    assert run(c)[0].result.rooms[0].size_text is None


def test_an_unnamed_face_keeps_the_size_text_it_lists() -> None:
    size = token("T1", SIZE_TEXT, 250, 250)
    [room] = run(cands([size], [face("R1", (100, 100, 400, 400), ("T1",))]))[0].result.rooms
    assert (room.name, room.size_text, room.width_mm, room.depth_mm) == (None, SIZE_TEXT, 3048, 3353)
    outside = run(cands([size], [face("R1", (500, 100, 700, 400))]))[0].result.rooms[0]
    assert outside.size_text is None  # no name to look below, not listed
