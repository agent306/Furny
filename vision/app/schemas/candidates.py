"""Intermediate (pre-assembly) candidate types shared by the pipeline stages (06 section 7-8).

Extended task by task; this module currently holds ``ParsedText``, ``TextToken``, ``Segment``,
``DimensionLine``, ``DimensionSpan``, ``RawWall``, ``WallCandidate``, ``GapCandidate`` and ``WallGraph``.
"""

import math
from dataclasses import dataclass
from typing import Literal

from app.utils.geometry import Pt, seg_angle_deg

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
