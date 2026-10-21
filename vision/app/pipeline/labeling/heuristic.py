"""The heuristic labeler, provider ``none`` (06 section 9.7): fills ``LabelingResult`` without AI.

Text roles come from the parsed kind, room names from the faces (a name token centred on a wall belongs to
the face it touches, Task 18 carry M4), units from the evidence in the texts. Walls and openings keep their
CV kinds: wall ``kind`` stays ``None`` (assembly decides by geometry, 06 section 8.7 step 5) and the door
and window types stay ``None`` (assembly takes the CV type).
"""

from typing import Literal

import cv2
import numpy as np

from app.pipeline.context import PipelineContext
from app.pipeline.dimensions import associate_dimension_texts
from app.pipeline.labeling.base import LabelingOutcome
from app.pipeline.normalize import NormalizedPage
from app.pipeline.ocr_stage import in_region
from app.pipeline.textparse import normalize_text
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
from app.utils.roomnames import title_case_name

UnitSystemLit = Literal["metric", "imperial", "unknown"]

UNIT_EVIDENCE_MIN = 3  # tokens that make a unit system (06 section 9.7)
BOUNDARY_TOLERANCE_T = 1.0  # a name centred this close (in t_median) to a face's boundary belongs to it
CORRIDOR_BORDER_T = 2.0  # corridors / open-to-sky this close (in t_median) to the plan region are outside
SIZE_BELOW_TEXT_HEIGHTS = 2.0  # a size text within this many text heights below the name is the room's
UNSURE_SUPPORT = 0.4  # openings with less evidence are "unsure"
NUMERIC_KINDS = ("mm_number", "metric_length", "feet_inch")
OUTSIDE_TYPES = ("corridor", "ots")
KNOWN_DIM_NOUNS = ("overall", "total")
KNOWN_DIM_AXES = ("width", "length", "depth")


def _imperial_evidence(t: TextToken) -> bool:
    """A feet-inch value, an imperial size pair, or a digit token carrying a foot / inch mark that the parser
    could not read (OCR garbles ``10'0"x11'0"`` into ``8'1x50``): all show the plan is drawn in feet."""
    p = t.parsed
    if p.kind == "feet_inch" or (p.kind == "size_pair" and p.pair_imperial):
        return True
    if p.kind != "other":
        return False
    text = normalize_text(t.text)
    return any(c.isdigit() for c in text) and ("'" in text or '"' in text)


def _centre(t: TextToken) -> tuple[float, float]:
    return ((t.box[0] + t.box[2]) / 2, (t.box[1] + t.box[3]) / 2)


def _boundary_distance(face: RoomFace, pt: tuple[float, float]) -> float:
    """Distance from ``pt`` to the face's polygon outline (0 on it, also when ``pt`` is inside)."""
    contour = np.asarray(face.polygon_px, np.float32).reshape(-1, 1, 2)
    return abs(float(cv2.pointPolygonTest(contour, (float(pt[0]), float(pt[1])), True)))


def _name_faces(tokens: list[TextToken], faces: list[RoomFace], t_median: float) -> dict[str, str]:
    """Room-name token id -> id of the face it belongs to: the face listing it, else the face whose outline
    lies within ``1 t`` of its centre (the nearer anchor when it touches two). Others are left out."""
    listed = {tid: f.id for f in faces for tid in f.contains_text_ids}
    out: dict[str, str] = {}
    for t in tokens:
        if t.id in listed:
            out[t.id] = listed[t.id]
            continue
        c = _centre(t)
        touching = [f for f in faces if _boundary_distance(f, c) <= BOUNDARY_TOLERANCE_T * t_median]
        if touching:
            nearest = min(
                touching, key=lambda f: (np.hypot(f.anchor_px[0] - c[0], f.anchor_px[1] - c[1]), f.id)
            )
            out[t.id] = nearest.id
    return out


def _below_name(name: TextToken, size: TextToken) -> bool:
    """``size`` sits under ``name``, no further than 2 text heights, roughly in its column."""
    (cx, cy), (sx, sy) = _centre(name), _centre(size)
    gap = size.box[1] - name.box[3]
    reach = SIZE_BELOW_TEXT_HEIGHTS * name.height_px
    half = max(name.box[2] - name.box[0], size.box[2] - size.box[0])
    return sy > cy and -name.height_px / 2 <= gap <= reach and abs(sx - cx) <= half


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

        names = [t for t in tokens if t.id in plan_ids and t.parsed.kind == "room_name"]
        face_of = _name_faces(names, c.rooms, c.t_median)
        result = LabelingResult(
            unit_system=unit_system,
            drawing_kind="architectural_line_drawing"
            if c.drawing_kind_cv == "unknown"
            else c.drawing_kind_cv,
            texts=[self._text_label(t, plan_ids, assoc) for t in tokens],
            dimensions=self._dimensions(tokens, assoc, span_by_id, unit_system),
            rooms=self._rooms(c, tokens, names, face_of, unit_system),
            missed_rooms=[
                MissedRoom(
                    name=title_case_name(t.text),
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
                    verdict="unsure" if o.support < UNSURE_SUPPORT else o.kind,
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
        if hints.unit_system is not None:
            return hints.unit_system
        imperial = sum(1 for t in tokens if _imperial_evidence(t))
        metric = sum(1 for t in tokens if t.parsed.kind == "mm_number" and t.id in assoc)
        if imperial >= UNIT_EVIDENCE_MIN:
            return "imperial"
        if metric >= UNIT_EVIDENCE_MIN:
            return "metric"
        return "unknown"

    @staticmethod
    def _text_label(t: TextToken, plan_ids: set[str], assoc: dict[str, str]) -> TextLabel_:
        kind = t.parsed.kind
        # The outer dimension chains' labels lie in the annotation margin around the plan region (Task 14b
        # ruling B1): a number a span lists is a dimension wherever it is; any other token out there is noise.
        dimension = kind in NUMERIC_KINDS and t.id in assoc
        if t.id not in plan_ids and not dimension:
            return TextLabel_(id=t.id, role="ignore", normalized_text=None)
        if kind == "room_name":
            return TextLabel_(id=t.id, role="room_name", normalized_text=title_case_name(t.text))
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
        by_id = {t.id: t for t in tokens}
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
            size = None
            if main is not None:
                inside = [by_id[i] for i in face.contains_text_ids if i in by_id and by_id[i] in sizes]
                below = [s for s in sizes if s.id not in listed and _below_name(main, s)]
                pool = inside or below
                if pool:
                    cx, cy = _centre(main)
                    size = min(pool, key=lambda s: (np.hypot(_centre(s)[0] - cx, _centre(s)[1] - cy), s.id))
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
                    name=title_case_name(main.text) if main else None,
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
