"""Intermediate (pre-assembly) candidate types shared by the pipeline stages (06 section 7-8).

Extended task by task; this module currently holds ``ParsedText``, ``TextToken``, ``Segment``,
``DimensionLine``, ``DimensionSpan``, ``RawWall``, ``WallCandidate``, ``GapCandidate``, ``WallGraph``,
``OpeningCandidate``, ``RoomFace`` and ``CandidateSet``.
"""

import math
from dataclasses import dataclass, replace
from typing import Literal

from app.schemas.meta import DrawingKind
from app.utils.geometry import Pt, Rect, seg_angle_deg

TextKind = Literal[
    "mm_number",
    "metric_length",
    "feet_inch",
    "size_pair",
    "area",
    "scale_note",
    "room_name",
    "opening_tag",
    "other",
]


@dataclass(frozen=True, slots=True)
class ParsedText:
    """Result of parsing one OCR/vector text token (06 section 7.8). Only the fields of ``kind`` are set.

    ``room_name`` is the matched dictionary key (uppercase); ``room_type`` is its ``RoomType`` value.
    """

    kind: TextKind
    mm: int | None = None
    pair_mm: tuple[int, int] | None = None
    pair_imperial: bool = False
    area_mm2: int | None = None
    scale_n: int | None = None
    room_name: str | None = None
    room_type: str | None = None
    tag: str | None = None


@dataclass(frozen=True, slots=True)
class TextToken:
    """One OCR / vector text token (06 section 7.7), in normalized-page pixels.

    ``quad`` runs from the text's start-top corner clockwise (reading direction first); ``box`` is its
    axis-aligned bounding box ``(x0, y0, x1, y1)``; ``height_px`` is the glyph height: the box height for
    ``angle == 0`` and the box width for ``angle == 90``.
    """

    id: str
    text: str
    quad: tuple[Pt, Pt, Pt, Pt]
    box: tuple[float, float, float, float]
    angle: Literal[0, 90]
    score: float
    height_px: float
    parsed: ParsedText


SegmentSource = Literal["lsd", "hough", "vector"]


@dataclass(frozen=True, slots=True)
class Segment:
    """A straight line stroke in normalized-page pixels (06 section 7.9).

    ``width_px`` is the stroke width (``2 x dt`` for raster pages, the PDF line width for vector pages);
    ``is_thin`` marks line work (``width_px <= 1.8 x t_thin``) as opposed to wall-scale strokes.
    """

    id: str
    p0: Pt
    p1: Pt
    width_px: float
    is_thin: bool
    source: SegmentSource

    @property
    def length(self) -> float:
        return math.hypot(self.p1[0] - self.p0[0], self.p1[1] - self.p0[1])

    @property
    def angle_deg(self) -> float:
        """Undirected angle in [0, 180), image axes (y down)."""
        return seg_angle_deg(self.p0[0], self.p0[1], self.p1[0], self.p1[1])


@dataclass(frozen=True, slots=True)
class DimensionLine:
    """A dimension line (06 section 8.4 step 1): a thin segment with >= 2 ticks and a numeric label nearby.

    ``p0``/``p1`` are the endpoints of the underlying segment ``segment_id``; ``tick_positions`` are the
    sorted distances of the ticks from ``p0`` along the line, in pixels.
    """

    id: str
    p0: Pt
    p1: Pt
    tick_positions: list[float]
    segment_id: str


@dataclass(frozen=True, slots=True)
class DimensionSpan:
    """The stretch between two ticks of a dimension line (06 section 8.4 steps 2-4), in pixels.

    ``near_text_ids`` lists the numeric tokens that may carry the span's value.
    """

    id: str
    p0: Pt
    p1: Pt
    axis: Literal["x", "y", "other"]
    kind: Literal["chain_segment", "overall"]
    near_text_ids: list[str]
    line_id: str


WallSource = Literal["filled", "double_line", "single_line", "vector"]


@dataclass(frozen=True, slots=True)
class RawWall:
    """A straight wall centre line before graph building (06 section 8.1 steps 1-8), in pixels.

    ``openings_px`` are intervals ``(u0, u1)`` of known gaps (door/window candidates) measured along the
    centre line from ``p0``; ``build_wall_graph`` re-bases them onto the final wall.
    """

    p0: Pt
    p1: Pt
    thickness_px: float
    source: WallSource
    openings_px: tuple[tuple[float, float], ...] = ()


@dataclass(frozen=True, slots=True)
class WallCandidate:
    """A wall of the snapped graph (06 section 8.1 steps 9-10), in pixels.

    ``a``/``b`` are the positions of nodes ``a_node``/``b_node``; ``a`` precedes ``b`` in the nodes'
    (y, x) order. ``free_ends`` counts the ends (0..2) whose node touches no other wall.
    ``openings_px`` are disjoint sorted intervals ``(u0, u1)`` along the centre line from ``a``.
    """

    id: str
    a: Pt
    b: Pt
    a_node: str
    b_node: str
    thickness_px: float
    source: WallSource
    evidence: float
    free_ends: int
    openings_px: tuple[tuple[float, float], ...]


@dataclass(frozen=True, slots=True)
class GapCandidate:
    """An opening candidate ``[u0, u1]`` along wall ``wall_id`` from its ``a`` end, in pixels."""

    wall_id: str
    u0: float
    u1: float


@dataclass(frozen=True, slots=True)
class WallGraph:
    """Snapped wall graph: ``nodes`` by id (``N1..``), ``walls`` sorted by id (``W1..``), ``gaps``."""

    nodes: dict[str, Pt]
    walls: list[WallCandidate]
    gaps: list[GapCandidate]


OpeningKind = Literal["door", "window", "opening"]


@dataclass(frozen=True, slots=True)
class OpeningCandidate:
    """A door, window or passage in wall ``wall_id`` (06 section 8.5), over ``[u0, u1]`` px along its centre
    line from the wall's ``a`` end.

    ``type`` is a ``DoorType`` for doors (``single_swing``, ``double_swing``, ``bifold``), a ``WindowType``
    for windows (``casement``, ``sliding_window``, or ``fixed`` for a grey wall panel, ruling R17-b) and
    ``"opening"`` for passages. ``hinge`` is the jamb the leaf turns on (``start`` = ``u0``) and ``swing``
    the side it opens to (``left`` = ``+n``, the wall's left normal, 04 section 2.1); both keep their
    defaults (``start``, ``left``) when nothing is hinged.

    ``support`` (0..1) is the measured evidence: for a swing door, the share of its arc's 24 samples on
    thin ink plus 0.15 for a straight leaf (a door inferred from its leaf, ruling R17-a, always has the
    leaf); for a double swing door, the mean of its two arcs'; 1.0 for a bi-fold (its V of leaves is the
    evidence); for a window, the mean coverage of its two best frame lines, or for a grey panel its
    contrast (its grey above the wall's, as a share of paper above the wall's); 0.0 for a passage.
    """

    id: str
    wall_id: str
    u0: float
    u1: float
    kind: OpeningKind
    type: str
    hinge: Literal["start", "end"]
    swing: Literal["left", "right"]
    support: float


@dataclass(frozen=True, slots=True)
class RoomFace:
    """A room face (06 section 8.6): a component of the free space inside the plan region that the walls and
    the opening closures enclose, in pixels.

    ``polygon_px`` is its outer contour simplified with ``approxPolyDP(0.5 t_median)``; ``anchor_px`` the
    maximum of its distance transform (the pole of inaccessibility, strictly inside); ``area_px`` its pixel
    count; ``bbox`` ``(x0, y0, x1, y1)`` of its pixels; ``contains_text_ids`` the tokens centred inside it.
    ``open`` is set when it only closes thanks to passage closures longer than ``6 t`` (reason
    ``open_face``): passages and gaps between collinear walls, never doors or windows (ruling R18-c).
    """

    id: str
    polygon_px: tuple[Pt, ...]
    anchor_px: Pt
    area_px: float
    bbox: tuple[float, float, float, float]
    contains_text_ids: tuple[str, ...]
    open: bool


@dataclass(frozen=True)
class CandidateSet:
    """Everything the CV stages found on one page (06 sections 7.7-8.6), in normalized-page pixels: the input
    of labeling, scale and assembly. ``drawing_kind_cv`` is the preprocess classification."""

    texts: list[TextToken]
    segments: list[Segment]
    dimension_lines: list[DimensionLine]
    spans: list[DimensionSpan]
    nodes: dict[str, Pt]
    walls: list[WallCandidate]
    gaps: list[GapCandidate]
    openings: list[OpeningCandidate]
    rooms: list[RoomFace]
    theta0: float
    t_thin: float
    t_median: float
    region: Rect
    drawing_kind_cv: DrawingKind

    def scale_y(self, factor: float) -> "CandidateSet":
        """A copy with every y coordinate multiplied by ``factor`` (06 section 8.2 step 7, anisotropy).

        Lengths measured along a line (opening and gap intervals along a wall, tick positions along a
        dimension line) follow their line's new length; room areas scale by ``factor``. Stroke widths, wall
        thicknesses and text heights of horizontal text are lengths across, not coordinates, and are kept.
        """

        def pt(p: Pt) -> Pt:
            return (p[0], p[1] * factor)

        def stretch(a: Pt, b: Pt) -> float:
            """New length per old length along ``a -> b``."""
            old = math.hypot(b[0] - a[0], b[1] - a[1])
            return math.hypot(b[0] - a[0], (b[1] - a[1]) * factor) / old if old > 0 else 1.0

        wall_k = {w.id: stretch(w.a, w.b) for w in self.walls}

        def along(wid: str, u: float) -> float:
            return u * wall_k.get(wid, 1.0)

        def text(t: TextToken) -> TextToken:
            x0, y0, x1, y1 = t.box
            q0, q1, q2, q3 = t.quad
            height = t.height_px * factor if t.angle == 90 else t.height_px
            return replace(
                t,
                quad=(pt(q0), pt(q1), pt(q2), pt(q3)),
                box=(x0, y0 * factor, x1, y1 * factor),
                height_px=height,
            )

        def line(d: DimensionLine) -> DimensionLine:
            k = stretch(d.p0, d.p1)
            return replace(d, p0=pt(d.p0), p1=pt(d.p1), tick_positions=[u * k for u in d.tick_positions])

        def room(r: RoomFace) -> RoomFace:
            x0, y0, x1, y1 = r.bbox
            return replace(
                r,
                polygon_px=tuple(pt(p) for p in r.polygon_px),
                anchor_px=pt(r.anchor_px),
                area_px=r.area_px * factor,
                bbox=(x0, y0 * factor, x1, y1 * factor),
            )

        region = self.region
        y0, y1 = round(region.y * factor), round((region.y + region.h) * factor)
        return replace(
            self,
            texts=[text(t) for t in self.texts],
            segments=[replace(s, p0=pt(s.p0), p1=pt(s.p1)) for s in self.segments],
            dimension_lines=[line(d) for d in self.dimension_lines],
            spans=[replace(s, p0=pt(s.p0), p1=pt(s.p1)) for s in self.spans],
            nodes={k: pt(p) for k, p in self.nodes.items()},
            walls=[
                replace(
                    w,
                    a=pt(w.a),
                    b=pt(w.b),
                    openings_px=tuple((along(w.id, u0), along(w.id, u1)) for u0, u1 in w.openings_px),
                )
                for w in self.walls
            ],
            gaps=[replace(g, u0=along(g.wall_id, g.u0), u1=along(g.wall_id, g.u1)) for g in self.gaps],
            openings=[
                replace(o, u0=along(o.wall_id, o.u0), u1=along(o.wall_id, o.u1)) for o in self.openings
            ],
            rooms=[room(r) for r in self.rooms],
            region=Rect(region.x, y0, region.w, y1 - y0),
        )
