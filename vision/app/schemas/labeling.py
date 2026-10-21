"""LLM output schemas: floor-plan labeling (06 section 9.4) and DXF layer mapping (06 section 10.4).

Every field is required; optionality is expressed as ``| None`` so the schema stays valid for the strict
modes of every provider. Ranges are not declared here: ``labeling/llm.py::sanitize`` clamps after parsing.
"""

from typing import Literal

from app.schemas.base import CamelModel

RoomTypeLit = Literal[
    "living",
    "dining",
    "kitchen",
    "bedroom",
    "master_bedroom",
    "bathroom",
    "toilet",
    "balcony",
    "utility",
    "store",
    "study",
    "pooja",
    "foyer",
    "corridor",
    "dress",
    "deck",
    "ots",
    "garage",
    "other",
]
DoorTypeLit = Literal["single_swing", "double_swing", "sliding", "pocket", "bifold", "main_entrance"]
WindowTypeLit = Literal["casement", "sliding_window", "fixed", "french_window", "bay", "ventilator"]


class TextLabel_(CamelModel):  # noqa: N801 - name fixed by 06 section 9.4
    id: str
    role: Literal["room_name", "room_size", "dimension", "area", "opening_tag", "title", "other", "ignore"]
    normalized_text: str | None


class DimensionLabel(CamelModel):
    text_id: str
    span_id: str | None
    value_mm: int | None
    kind: Literal["chain_segment", "overall", "room_interior", "unknown"]


class RoomLabel(CamelModel):
    id: str  # R...
    include: bool
    name: str | None
    type: RoomTypeLit | None
    name_text_id: str | None
    size_text: str | None  # as written, e.g. 10'0"x11'0"
    width_mm: int | None  # parsed size, first number
    depth_mm: int | None  # second number


class MissedRoom(CamelModel):
    name: str
    type: RoomTypeLit
    x: int
    y: int


class WallLabel(CamelModel):
    id: str
    verdict: Literal["wall", "not_wall", "unsure"]
    kind: Literal["exterior", "interior", "partition", "half"] | None


class OpeningLabel(CamelModel):
    id: str
    verdict: Literal["door", "window", "opening", "not_opening", "unsure"]
    door_type: DoorTypeLit | None
    window_type: WindowTypeLit | None


class MissedOpening(CamelModel):
    kind: Literal["door", "window", "opening"]
    wall_id: str
    x: int
    y: int


class KnownDimensionMatch(CamelModel):
    wall_id: str | None
    span_id: str | None


class LabelingResult(CamelModel):
    unit_system: Literal["metric", "imperial", "unknown"]
    drawing_kind: Literal[
        "architectural_line_drawing",
        "colored_brochure",
        "hand_sketch",
        "photo_of_drawing",
        "cad_vector",
        "not_a_floor_plan",
    ]
    texts: list[TextLabel_]
    dimensions: list[DimensionLabel]
    rooms: list[RoomLabel]
    missed_rooms: list[MissedRoom]
    walls: list[WallLabel]
    openings: list[OpeningLabel]
    missed_openings: list[MissedOpening]
    known_dimension_match: KnownDimensionMatch | None
    notes: str | None  # <= 500 chars, stored in debug only


class LayerRoleItem(CamelModel):
    name: str
    role: Literal["wall", "door", "window", "room_label", "dimension", "furniture", "other"]


class LayerMapping(CamelModel):
    layers: list[LayerRoleItem]
