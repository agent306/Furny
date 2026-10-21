"""The heuristic labeler, provider ``none`` (06 section 9.7): fills ``LabelingResult`` without AI.

Text roles come from the parsed kind, room names from the faces (a name token centred on a wall belongs to
the face it touches, Task 18 carry M4), units from the evidence in the texts. Walls and openings keep their
CV kinds: wall ``kind`` stays ``None`` (assembly decides by geometry, 06 section 8.7 step 5) and the door
and window types stay ``None`` (assembly takes the CV type).
"""

import re
from dataclasses import replace
from typing import Literal

import cv2
import numpy as np

from app.pipeline.context import PipelineContext
from app.pipeline.dimensions import associate_dimension_texts
from app.pipeline.labeling.base import LabelingOutcome
from app.pipeline.normalize import NormalizedPage
from app.pipeline.ocr_stage import in_region
from app.pipeline.textparse import normalize_text, parse_token
from app.schemas.api import RecognizeHints
from app.schemas.candidates import CandidateSet, DimensionSpan, RoomFace, TextToken
from app.schemas.labeling import (
    DimensionLabel,
    KnownDimensionMatch,
    LabelingResult,
    MissedRoom,
    OpeningLabel,
    RoomLabel,
    TextLabel_,
    WallLabel,
)
from app.utils.roomnames import room_display_name, title_case_name

UnitSystemLit = Literal["metric", "imperial", "unknown"]

UNIT_EVIDENCE_MIN = 3  # tokens that make a unit system (06 section 9.7)
BOUNDARY_TOLERANCE_T = 1.0  # a name centred this close (in t_median) to a face's boundary belongs to it
CORRIDOR_BORDER_T = 2.0  # corridors / open-to-sky this close (in t_median) to the plan region are outside
SIZE_BELOW_TEXT_HEIGHTS = 2.0  # a size text within this many text heights below the name is the room's
UNSURE_SUPPORT = 0.4  # doors and windows with less evidence are "unsure" (passages have none: support 0)
NUMERIC_KINDS = ("mm_number", "metric_length", "feet_inch")
METRIC_KINDS = ("mm_number", "metric_length")
# Unit evidence weights (spec 19, task 19 fix round 1): a span-listed metric dimension outweighs the room
# sizes and notes of a plan drawn in feet; a garbled foot mark is the weakest sign.
METRIC_WEIGHT = 2.0
IMPERIAL_WEIGHT = 1.0
GARBLED_IMPERIAL_WEIGHT = 0.5
NAME_MERGE_GAP_HEIGHTS = (
    1.5  # adjacent name words on one baseline closer than this (in text heights) are one name
)
NAME_MERGE_HEIGHT_RATIO = 0.7  # ... when their glyph heights are alike
OUTSIDE_TYPES = ("corridor", "ots")
KNOWN_DIM_NOUNS = ("overall", "total")
KNOWN_DIM_AXES = ("width", "length", "depth")


_SQFT = re.compile(r"SQ\.?\s*FT|SFT|SQFT")


def _imperial_weight(t: TextToken) -> float:
    """What a token says for a plan drawn in feet: a feet-inch value, an imperial size pair or an area in
    sq.ft (weight 1); a digit token with a foot / inch mark the parser could not read (OCR garbles
    ``10'0"x11'0"`` into ``8'1x50``) weighs half; anything else 0."""
    p = t.parsed
    if p.kind == "feet_inch" or (p.kind == "size_pair" and p.pair_imperial):
        return IMPERIAL_WEIGHT
    text = normalize_text(t.text)
    if p.kind == "area":
        return IMPERIAL_WEIGHT if _SQFT.search(text) else 0.0
    if p.kind == "other" and any(c.isdigit() for c in text) and ("'" in text or '"' in text):
        return GARBLED_IMPERIAL_WEIGHT
    return 0.0


def _display(t: TextToken) -> str:
    """A room-name token's name: the canonical dictionary name when the match was fuzzy (``TOILE``)."""
    return room_display_name(t.text, t.parsed.room_name) if t.parsed.room_name else title_case_name(t.text)


def _centre(t: TextToken) -> tuple[float, float]:
    return ((t.box[0] + t.box[2]) / 2, (t.box[1] + t.box[3]) / 2)


def _boundary_distance(face: RoomFace, pt: tuple[float, float]) -> float:
    """Distance from ``pt`` to the face's polygon outline (0 on it, also when ``pt`` is inside)."""
    contour = np.asarray(face.polygon_px, np.float32).reshape(-1, 1, 2)
    return abs(float(cv2.pointPolygonTest(contour, (float(pt[0]), float(pt[1])), True)))


def _name_faces(
    tokens: list[TextToken], faces: list[RoomFace], t_median: float, parts: dict[str, tuple[str, ...]]
) -> dict[str, str]:
    """Room-name token id -> id of the face it belongs to: the face listing it (or one of the words it was
    merged from), else the face whose outline lies within ``1 t`` of its centre (the nearer anchor when it
    touches two). Others are left out."""
    listed = {tid: f.id for f in faces for tid in f.contains_text_ids}
    out: dict[str, str] = {}
    for t in tokens:
        face_id = next((listed[i] for i in (t.id, *parts.get(t.id, ())) if i in listed), None)
        if face_id is not None:
            out[t.id] = face_id
            continue
        c = _centre(t)
        touching = [f for f in faces if _boundary_distance(f, c) <= BOUNDARY_TOLERANCE_T * t_median]
        if touching:
            nearest = min(
                touching, key=lambda f: (np.hypot(f.anchor_px[0] - c[0], f.anchor_px[1] - c[1]), f.id)
            )
            out[t.id] = nearest.id
    return out


def _key_words(t: TextToken) -> int:
    """Words of the dictionary key a token matched (0 when it is no room name)."""
    return len(re.split(r"[\s-]+", t.parsed.room_name)) if t.parsed.room_name else 0


def _joined(a: TextToken, b: TextToken) -> TextToken:
    """``a`` followed by ``b`` as one token (id of ``a``), parsed anew."""
    x0, y0 = min(a.box[0], b.box[0]), min(a.box[1], b.box[1])
    x1, y1 = max(a.box[2], b.box[2]), max(a.box[3], b.box[3])
    text = f"{a.text} {b.text}"
    return replace(
        a,
        text=text,
        quad=((x0, y0), (x1, y0), (x1, y1), (x0, y1)),
        box=(x0, y0, x1, y1),
        score=min(a.score, b.score),
        height_px=max(a.height_px, b.height_px),
        parsed=parse_token(text),
    )


def _mergeable(a: TextToken, b: TextToken) -> bool:
    """``b`` is the next word of ``a``'s line: alike heights, centres on one baseline, a gap of at most 1.5
    text heights (a slight overlap allowed)."""
    height = max(a.height_px, b.height_px)
    gap = b.box[0] - a.box[2]
    return (
        min(a.height_px, b.height_px) >= NAME_MERGE_HEIGHT_RATIO * height
        and abs(_centre(a)[1] - _centre(b)[1]) <= 0.5 * height
        and -0.5 * height <= gap <= NAME_MERGE_GAP_HEIGHTS * height
    )


def _merge_names(
    tokens: list[TextToken], face_of_listed: dict[str, str]
) -> tuple[list[TextToken], dict[str, tuple[str, ...]]]:
    """Join the words of a name the OCR split (``MASTER`` + ``BEDROOM``, ``LIVING`` + ``ROOM``): adjacent
    word tokens on one baseline whose concatenation matches a longer dictionary key than either word does.
    Returns the plan's tokens with each joined pair replaced by one token (id of the left word) and, per
    joined token, the ids of all its words."""
    words = [
        t
        for t in tokens
        if t.angle == 0
        and t.parsed.kind in ("room_name", "other")
        and t.text.replace(".", "").replace("/", "").replace("-", "").isalpha()
    ]
    parts: dict[str, tuple[str, ...]] = {}
    merged = True
    while merged:
        merged = False
        for a in sorted(words, key=lambda t: (_centre(t)[1], t.box[0], t.id)):
            nexts = sorted(
                (b for b in words if b is not a and _mergeable(a, b)), key=lambda b: (b.box[0], b.id)
            )
            for b in nexts:
                ids = (*parts.get(a.id, (a.id,)), *parts.get(b.id, (b.id,)))
                joined = _joined(a, b)
                better = joined.parsed.kind == "room_name" and _key_words(joined) > max(
                    _key_words(a), _key_words(b)
                )
                if better and len({face_of_listed[i] for i in ids if i in face_of_listed}) <= 1:
                    parts[a.id] = ids
                    words = [joined if t is a else t for t in words if t is not b]
                    merged = True
                    break
            if merged:
                break
    replaced = {t.id: t for t in words}
    gone = {i for ids in parts.values() for i in ids}
    return [replaced.get(t.id, t) for t in tokens if t.id not in gone or t.id in parts], parts


def _below_name(name: TextToken, size: TextToken) -> bool:
    """``size`` sits under ``name``, no further than 2 text heights, roughly in its column."""
    cx, sx = _centre(name)[0], _centre(size)[0]
    gap = size.box[1] - name.box[3]
    reach = SIZE_BELOW_TEXT_HEIGHTS * name.height_px
    half = max(name.box[2] - name.box[0], size.box[2] - size.box[0])
    return -name.height_px / 2 <= gap <= reach and abs(sx - cx) <= half


def _room_size(
    face: RoomFace, name: TextToken | None, sizes: list[TextToken], listed: set[str]
) -> TextToken | None:
    """The size text of a room: a size pair its face lists, else (for a named room) one no face lists within
    2 text heights below the name; the one nearest to the name (or face anchor) when several."""
    inside = [s for s in sizes if s.id in face.contains_text_ids]
    below = [s for s in sizes if s.id not in listed and _below_name(name, s)] if name is not None else []
    cx, cy = _centre(name) if name is not None else face.anchor_px
    return min(
        inside or below, key=lambda s: (np.hypot(_centre(s)[0] - cx, _centre(s)[1] - cy), s.id), default=None
    )


class HeuristicLabeler:
    """Provider ``none``: deterministic labels from the candidates alone."""

    def label(
        self, page: NormalizedPage, candidates: CandidateSet, hints: RecognizeHints, ctx: PipelineContext
    ) -> LabelingOutcome:
        c = candidates
        tokens = c.texts
        plan_ids = {t.id for t in in_region(tokens, c.region)}
        assoc = associate_dimension_texts(c.spans, tokens)
        span_by_id = {s.id: s for s in c.spans}

        unit_system = self._unit_system(tokens, assoc, hints)
        if unit_system == "unknown":
            ctx.warn("unit_system_guessed")

        listed = {tid: f.id for f in c.rooms for tid in f.contains_text_ids}
        plan_tokens, parts = _merge_names([t for t in tokens if t.id in plan_ids], listed)
        names = [t for t in plan_tokens if t.parsed.kind == "room_name"]
        face_of = _name_faces(names, c.rooms, c.t_median, parts)
        word_of = {i: t for t in names for i in parts.get(t.id, ())}  # each word of a joined name -> the name
        result = LabelingResult(
            unit_system=unit_system,
            drawing_kind="architectural_line_drawing"
            if c.drawing_kind_cv == "unknown"
            else c.drawing_kind_cv,
            texts=[self._text_label(t, plan_ids, assoc, word_of) for t in tokens],
            dimensions=self._dimensions(tokens, assoc, span_by_id, unit_system),
            rooms=self._rooms(c, tokens, names, face_of, unit_system),
            missed_rooms=[
                MissedRoom(
                    name=_display(t),
                    type=t.parsed.room_type,
                    x=round(_centre(t)[0]),
                    y=round(_centre(t)[1]),
                )
                for t in names
                if t.id not in face_of
            ],
            walls=[
                WallLabel(id=w.id, verdict="unsure" if w.source == "single_line" else "wall", kind=None)
                for w in c.walls
            ],
            openings=[
                OpeningLabel(
                    id=o.id,
                    verdict="unsure" if o.kind != "opening" and o.support < UNSURE_SUPPORT else o.kind,
                    door_type=None,
                    window_type=None,
                )
                for o in c.openings
            ],
            missed_openings=[],
            known_dimension_match=self._known_dimension(hints, ctx),
            notes=None,
        )
        return LabelingOutcome(result, "none", None, None, [], False)

    @staticmethod
    def _unit_system(tokens: list[TextToken], assoc: dict[str, str], hints: RecognizeHints) -> UnitSystemLit:
        """The hint; else the evidence, weighed: imperial needs >= 3 imperial tokens whose weight exceeds the
        metric dimensions' (a span-listed ``mm_number`` / ``metric_length`` weighs 2), metric needs >= 3 of
        those, else unknown."""
        if hints.unit_system is not None:
            return hints.unit_system
        imperial = [w for t in tokens if (w := _imperial_weight(t)) > 0]
        metric = [t for t in tokens if t.parsed.kind in METRIC_KINDS and t.id in assoc]
        if len(imperial) >= UNIT_EVIDENCE_MIN and sum(imperial) > METRIC_WEIGHT * len(metric):
            return "imperial"
        if len(metric) >= UNIT_EVIDENCE_MIN:
            return "metric"
        return "unknown"

    @staticmethod
    def _text_label(
        t: TextToken, plan_ids: set[str], assoc: dict[str, str], word_of: dict[str, TextToken]
    ) -> TextLabel_:
        if t.id in word_of:  # a word of a name the OCR split: every word carries the whole name
            return TextLabel_(id=t.id, role="room_name", normalized_text=_display(word_of[t.id]))
        kind = t.parsed.kind
        # The outer dimension chains' labels lie in the annotation margin around the plan region (Task 14b
        # ruling B1): a number a span lists is a dimension wherever it is; any other token out there is noise.
        dimension = kind in NUMERIC_KINDS and t.id in assoc
        if t.id not in plan_ids and not dimension:
            return TextLabel_(id=t.id, role="ignore", normalized_text=None)
        if kind == "room_name":
            return TextLabel_(id=t.id, role="room_name", normalized_text=_display(t))
        role = (
            "dimension"
            if dimension
            else {
                "size_pair": "room_size",
                "area": "area",
                "opening_tag": "opening_tag",
                "scale_note": "title",
            }.get(kind, "other")
        )
        return TextLabel_(id=t.id, role=role, normalized_text=normalize_text(t.text))

    @staticmethod
    def _dimensions(
        tokens: list[TextToken],
        assoc: dict[str, str],
        span_by_id: dict[str, DimensionSpan],
        unit_system: UnitSystemLit,
    ) -> list[DimensionLabel]:
        out = []
        for t in tokens:
            span_id = assoc.get(t.id)
            if span_id is None or t.parsed.kind not in NUMERIC_KINDS:
                continue
            plain = t.parsed.kind == "mm_number"
            out.append(
                DimensionLabel(
                    text_id=t.id,
                    span_id=span_id,
                    value_mm=None if plain and unit_system == "imperial" else t.parsed.mm,
                    kind=span_by_id[span_id].kind,
                )
            )
        return out

    @staticmethod
    def _rooms(
        c: CandidateSet,
        tokens: list[TextToken],
        names: list[TextToken],
        face_of: dict[str, str],
        unit_system: UnitSystemLit,
    ) -> list[RoomLabel]:
        sizes = [t for t in tokens if t.parsed.kind == "size_pair" and t.parsed.pair_mm is not None]
        listed = {tid for f in c.rooms for tid in f.contains_text_ids}
        region_edges = (c.region.x, c.region.y, c.region.x + c.region.w, c.region.y + c.region.h)
        tolerance = CORRIDOR_BORDER_T * c.t_median
        out = []
        for face in c.rooms:
            named = [t for t in names if face_of.get(t.id) == face.id]
            # the tallest name wins; ties go to the topmost, then the leftmost
            named.sort(key=lambda t: (-t.height_px, _centre(t)[1], _centre(t)[0], t.id))
            main = named[0] if named else None
            size = _room_size(face, main, sizes, listed)
            touches = (
                face.bbox[0] - region_edges[0] <= tolerance
                or face.bbox[1] - region_edges[1] <= tolerance
                or region_edges[2] - face.bbox[2] <= tolerance
                or region_edges[3] - face.bbox[3] <= tolerance
            )
            outside = bool(named) and all(t.parsed.room_type in OUTSIDE_TYPES for t in named)
            pair = size.parsed.pair_mm if size is not None else None
            if size is not None and unit_system == "imperial" and not size.parsed.pair_imperial:
                pair = None  # a pair read as millimetres on a plan in feet lost its foot marks: no size
            out.append(
                RoomLabel(
                    id=face.id,
                    include=not (outside and touches),
                    name=_display(main) if main else None,
                    type=main.parsed.room_type if main else None,
                    name_text_id=main.id if main else None,
                    size_text=size.text if size else None,
                    width_mm=pair[0] if pair else None,
                    depth_mm=pair[1] if pair else None,
                )
            )
        return out

    @staticmethod
    def _known_dimension(hints: RecognizeHints, ctx: PipelineContext) -> KnownDimensionMatch | None:
        known = hints.known_dimension
        if known is None:
            return None
        text = known.label.lower()
        if any(n in text for n in KNOWN_DIM_NOUNS) and any(a in text for a in KNOWN_DIM_AXES):
            return KnownDimensionMatch(wall_id=None, span_id=None)
        ctx.warn("known_dimension_unmatched", {"label": known.label})
        return None
