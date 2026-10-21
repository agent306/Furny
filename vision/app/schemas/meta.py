"""Pydantic mirror of ImportResultMeta (06 section 6), stored verbatim in blueprint_imports.result_meta."""

from typing import Annotated, Any, Literal, get_args

from pydantic import Field, field_validator

from app.schemas.base import CamelModel
from app.schemas.plan import Point

ProviderName = Literal["anthropic", "openai", "openai_compatible", "none"]
ScaleMethod = Literal[
    "dimension_chain", "room_label", "scale_note", "dxf_units", "user_hint", "default_guess"
]
StageKey = Literal[
    "fetch",
    "decode",
    "normalize",
    "preprocess",
    "ocr",
    "segments",
    "walls",
    "dimensions",
    "rooms",
    "openings",
    "labeling",
    "scale",
    "assemble",
    "validate",
    "upload",
    "dxf",
]
SourceKind = Literal["raster", "pdf_vector", "pdf_raster", "dxf", "heic"]
DrawingKind = Literal[
    "architectural_line_drawing",
    "colored_brochure",
    "hand_sketch",
    "photo_of_drawing",
    "cad_vector",
    "not_a_floor_plan",
    "unknown",
]
FallbackReason = Literal[
    "llm_error",
    "llm_refused",
    "llm_timeout",
    "llm_invalid_output",
    "provider_not_configured",
    "vision_unsupported",
    "provider_auth_failed",
]
WarningCode = Literal[
    "low_resolution",
    "image_downscaled",
    "photo_rectified",
    "page_corners_not_found",
    "deskewed",
    "scale_guessed",
    "scale_from_room_labels",
    "scale_room_label_mismatch",
    "scale_anisotropy_corrected",
    "scale_high_residual",
    "unit_system_guessed",
    "known_dimension_unmatched",
    "room_names_merged",
    "rooms_without_names",
    "walls_unconnected",
    "openings_dropped_overlap",
    "entities_outside_unit_removed",
    "llm_failed_fallback_none",
    "llm_partial",
    "llm_output_repaired",
    "too_many_candidates_truncated",
    "plan_region_ambiguous",
    "not_a_floor_plan_suspected",
    "dxf_units_guessed",
    "dxf_layers_guessed",
    "plan_validation_warning",
]
ReasonCode = Literal[
    "thin_evidence",
    "single_line_wall",
    "unconnected",
    "off_axis",
    "llm_unsure",
    "llm_disagrees",
    "no_name",
    "name_guessed",
    "size_mismatch",
    "gap_only",
    "type_guessed",
    "small_area",
    "open_face",
]

Unit = Annotated[float, Field(ge=0, le=1)]


class MetaWarning(CamelModel):
    code: WarningCode
    params: dict[str, str | int | float] = Field(default_factory=dict)
    entity_ids: list[str] = Field(default_factory=list)


class PageImage(CamelModel):
    width: int
    height: int
    source_page: int
    dpi: float | None
    rectified: bool
    deskew_deg: float
    resample_factor: float


class PlanRegion(CamelModel):
    x: float
    y: float
    w: float
    h: float


class ScaleSample(CamelModel):
    text: str
    value_mm: float
    a: Point
    b: Point
    inlier: bool
    kind: Literal["chain_segment", "overall", "room_width", "room_depth"]


class RoomLabelCheck(CamelModel):
    rooms: int
    median_discrepancy_pct: float | None


class ScaleMeta(CamelModel):
    mm_per_pixel: float
    method: ScaleMethod
    residual_pct: float | None
    samples: int
    rejected: int
    confidence: Unit
    anisotropy_corrected: bool
    room_label_check: RoomLabelCheck
    used_samples: Annotated[list[ScaleSample], Field(max_length=60)]


class ConfidenceMeta(CamelModel):
    walls: dict[str, Unit]
    openings: dict[str, Unit]
    rooms: dict[str, Unit]
    overall: Unit


class OcrTokenStats(CamelModel):
    count: int
    mean_confidence: float
    metric_dimension_tokens: int
    imperial_tokens: int
    room_name_tokens: int
    area_tokens: int
    sample: Annotated[list[str], Field(max_length=20)]


class MetaCounts(CamelModel):
    walls: int
    openings: int
    rooms: int
    texts: int
    candidates_walls: int


class DxfInspect(CamelModel):
    insunits: int
    layer_count: int
    entity_count: int


class InspectMeta(CamelModel):
    """Added by Laravel after /v1/inspect."""

    is_likely_photo: bool
    suggested_corners: list[tuple[float, float]] | None
    dxf: DxfInspect | None = None


class ReviewState(CamelModel):
    """Added by Laravel when the user reviews the import."""

    reviewed_ids: list[str]
    scale_confirmed: bool
    unit_confirmed: bool
    rescale_factor: float


class ImportResultMeta(CamelModel):
    meta_version: Literal[1]
    service_version: str
    pipeline_version: str
    source_kind: SourceKind
    provider_requested: ProviderName
    provider_used: ProviderName
    model: str | None
    fallback_reason: FallbackReason | None
    drawing_kind: DrawingKind
    page_image: PageImage
    plan_region: PlanRegion
    scale: ScaleMeta
    detected_unit_system: Literal["metric", "imperial", "unknown"]
    confidence: ConfidenceMeta
    reasons: dict[str, list[ReasonCode]]
    warnings: list[MetaWarning]
    # Partial<Record<StageKey, ms>> & {totalMs}: every key is a StageKey except the required totalMs.
    timings: dict[str, int]
    ocr_tokens: OcrTokenStats
    counts: MetaCounts
    inspect: InspectMeta | None = None
    review: ReviewState | None = None

    @field_validator("timings")
    @classmethod
    def _check_timings(cls, value: dict[str, int]) -> dict[str, int]:
        if "totalMs" not in value:
            raise ValueError("timings must contain totalMs")
        stage_keys = set(get_args(StageKey))
        unknown = sorted(k for k in value if k != "totalMs" and k not in stage_keys)
        if unknown:
            raise ValueError(f"unknown timing keys: {', '.join(unknown)}")
        return value

    def wire(self) -> dict[str, Any]:
        """As the base ``wire()``, but omit the Laravel-added ``inspect``/``review`` while unset."""
        out = super().wire()
        for key in ("inspect", "review"):
            if out.get(key) is None:
                out.pop(key, None)
        return out
