"""Intermediate (pre-assembly) candidate types shared by the pipeline stages (06 section 7-8).

Extended task by task; this module currently holds ``ParsedText`` and ``TextToken``.
"""

from dataclasses import dataclass
from typing import Literal

from app.utils.geometry import Pt

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
