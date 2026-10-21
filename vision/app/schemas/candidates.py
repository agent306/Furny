"""Intermediate (pre-assembly) candidate types shared by the pipeline stages (06 section 7-8).

Extended task by task; this module currently holds ``ParsedText``, ``TextToken`` and ``Segment``.
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
