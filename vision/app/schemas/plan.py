"""Pydantic mirror of the PlanDocument contract (03 section 1). All lengths are integer mm."""

from typing import Annotated, Literal

from pydantic import Field

from app.schemas.base import CamelModel

# Integer millimetres; ``Coord`` is a plan-space coordinate (03 1.1: within +/-1 000 000 mm).
Mm = int
Coord = Annotated[int, Field(ge=-1_000_000, le=1_000_000)]
Deg = float

RoomType = Literal[
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
DoorType = Literal["single_swing", "double_swing", "sliding", "pocket", "bifold", "main_entrance"]
WindowType = Literal["casement", "sliding_window", "fixed", "french_window", "bay", "ventilator"]


class Point(CamelModel):
    x: Coord
    y: Coord


class PlanMeta(CamelModel):
    default_wall_height: Mm
    default_wall_thickness: Mm
    floor_thickness: Mm
    north_angle: Deg | None
    created_with: Literal["editor", "import", "trace"]


class WallNode(CamelModel):
    id: str
    x: Coord
    y: Coord


class Wall(CamelModel):
    id: str
    a: str
    b: str
    thickness: Annotated[int, Field(ge=50, le=1000)]
    height: Annotated[int, Field(ge=300, le=10000)]
    kind: Literal["exterior", "interior", "partition", "half"]
    justification: Literal["center"]
    material: Literal["brick", "concrete", "drywall", "glass", "other"]
    color_hex: str | None


class Opening(CamelModel):
    id: str
    wall_id: str
    kind: Literal["door", "window", "opening"]
    type: DoorType | WindowType | Literal["opening"]
    offset: Mm
    width: Annotated[int, Field(ge=300, le=6000)]
    height: Mm
    sill_height: Annotated[int, Field(ge=0, le=3000)]
    hinge: Literal["start", "end"]
    swing: Literal["left", "right"]
    label: str | None


class RoomMeta(CamelModel):
    id: str
    anchor: Point
    name: str
    type: RoomType
    floor_finish: Literal["tile", "wood", "marble", "carpet", "concrete", "other"]
    floor_color_hex: str | None
    label_offset: Point | None
    show_area: bool


class WallAttachment(CamelModel):
    wall_id: str
    side: Literal["left", "right"]


class FurniturePlacement(CamelModel):
    id: str
    design_id: str
    x: Coord
    y: Coord
    rotation: Deg
    elevation: Mm
    mirrored: bool
    wall_attachment: WallAttachment | None


class Fixture(CamelModel):
    id: str
    # FixtureKey is a closed enum owned by the editor (05 section 9); P3 never emits fixtures,
    # so the key is carried as an opaque string here.
    library_key: str
    x: Coord
    y: Coord
    rotation: Deg
    width: Mm
    depth: Mm
    height: Mm
    elevation: Mm
    label: str | None


class DimensionAttachment(CamelModel):
    kind: Literal["wall"]
    wall_id: str
    face: Literal["left", "right", "center"]


class DimensionAnnotation(CamelModel):
    id: str
    a: Point
    b: Point
    offset: Mm
    attached_to: DimensionAttachment | None


class TextLabel(CamelModel):
    id: str
    position: Point
    text: Annotated[str, Field(max_length=200)]
    font_size: Mm
    rotation: Deg


class Annotations(CamelModel):
    dimensions: dict[str, DimensionAnnotation] = Field(default_factory=dict)
    labels: dict[str, TextLabel] = Field(default_factory=dict)


class BackgroundImage(CamelModel):
    import_id: str | None
    media_uuid: str
    pixel_width: int
    pixel_height: int
    mm_per_pixel: Annotated[float, Field(gt=0)]
    position: Point
    rotation: Deg
    opacity: Annotated[float, Field(ge=0, le=1)]
    visible: bool
    locked: bool


class View2D(CamelModel):
    center_x: Mm
    center_y: Mm
    zoom: float


class View3D(CamelModel):
    camera: Literal["orbit", "top", "walk"]
    position: tuple[float, float, float]
    target: tuple[float, float, float]


class ViewState(CamelModel):
    # Explicit aliases: pydantic's to_camel would produce "mode2D" / "mode3D".
    mode2d: View2D | None = Field(alias="mode2d")
    mode3d: View3D | None = Field(alias="mode3d")
    last_mode: Literal["2d", "3d"]


class PlanDocument(CamelModel):
    schema_version: Literal[1]
    meta: PlanMeta
    nodes: dict[str, WallNode]
    walls: dict[str, Wall]
    openings: dict[str, Opening]
    rooms: dict[str, RoomMeta]
    placements: dict[str, FurniturePlacement] = Field(default_factory=dict)
    fixtures: dict[str, Fixture] = Field(default_factory=dict)
    annotations: Annotations
    background: BackgroundImage | None
    view: ViewState
