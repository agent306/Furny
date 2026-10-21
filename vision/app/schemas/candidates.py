"""Intermediate (pre-assembly) candidate types shared by the pipeline stages (06 section 7-8).

Extended task by task; this module currently holds ``ParsedText`` only.
"""

from dataclasses import dataclass
from typing import Literal

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
