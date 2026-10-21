"""HTTP API models of the vision service (06 sections 5.4-5.8, 18 sections 5.1 and 5.3).

Wire names are camelCase (``CamelModel``); the JSON examples of the spec validate and round-trip.
"""

from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import Field, model_serializer
from pydantic_core.core_schema import SerializerFunctionWrapHandler

from app.schemas.base import CamelModel
from app.schemas.meta import (
    DxfInspect,
    ImportResultMeta,
    PageImage,
    ProviderName,
    SourceKind,
    Unit,
    WarningCode,
)
from app.schemas.plan import PlanDocument

Effort = Literal["low", "medium", "high"]
UnitSystem = Literal["metric", "imperial"]
# Four normalized (0..1) points of the preview frame: TL, TR, BR, BL.
Corners = Annotated[list[tuple[Unit, Unit]], Field(min_length=4, max_length=4)]
# Inspect reports DXF statistics with the same shape the stored meta keeps (06 sections 5.4, 6).
DxfInfo = DxfInspect

# --- source, output, hints, options -------------------------------------------------------------


class SourceRef(CamelModel):
    url: str
    filename: str
    mime_type: str
    source_kind: SourceKind | None = None


class RecognizeOutput(CamelModel):
    normalized_put_url: str
    debug_put_urls: list[str] = Field(default_factory=list, max_length=8)


class NormalizeOutput(CamelModel):
    normalized_put_url: str


class KnownDimension(CamelModel):
    label: Annotated[str, Field(max_length=80)]
    mm: Annotated[int, Field(ge=100, le=100_000)]


class RecognizeHints(CamelModel):
    unit_system: UnitSystem | None = None
    known_dimension: KnownDimension | None = None
    wall_height_mm: Annotated[int, Field(ge=2000, le=6000)] | None = None
    is_photo: bool = False
    corners: Corners | None = None


class RecognizeDefaults(CamelModel):
    """Plan defaults from the ``units`` settings group (02 section 13); millimetres."""

    wall_height_mm: int = 2700
    exterior_wall_thickness_mm: int = 230
    interior_wall_thickness_mm: int = 115
    door_width_mm: int = 900
    door_height_mm: int = 2100
    window_width_mm: int = 1200
    window_height_mm: int = 1200
    window_sill_mm: int = 900


class RecognizeOptions(CamelModel):
    provider: ProviderName
    model: str | None = None
    effort: Effort
    agentic_crops: bool
    fallback_to_none_on_error: bool
    selected_page: Annotated[int, Field(ge=1)] = 1
    hints: RecognizeHints = Field(default_factory=RecognizeHints)
    defaults: RecognizeDefaults = Field(default_factory=RecognizeDefaults)
    locale: str = "en"
    debug: bool = True


class NormalizeHints(CamelModel):
    is_photo: bool = False
    corners: Corners | None = None


class NormalizeOptions(CamelModel):
    selected_page: Annotated[int, Field(ge=1)] = 1
    hints: NormalizeHints = Field(default_factory=NormalizeHints)


# --- usage ----------------------------------------------------------------------------------------


class UsageCallOut(CamelModel):
    purpose: Literal["labeling", "agent_turn", "finalize", "repair", "dxf_layers", "provider_test"]
    model: str
    input_tokens: int
    output_tokens: int
    cache_read_input_tokens: int
    cache_creation_input_tokens: int
    images: int
    duration_ms: int
    stop_reason: str
    status: Literal["succeeded", "failed"]


class UsageTotals(CamelModel):
    requests: int
    input_tokens: int
    output_tokens: int
    images: int
    duration_ms: int


class Usage(CamelModel):
    provider: ProviderName
    model: str | None
    calls: list[UsageCallOut]
    totals: UsageTotals
    status: Literal["succeeded", "failed"]


class DebugArtifact(CamelModel):
    index: int
    name: str
    content_type: str


# --- /v1/recognize --------------------------------------------------------------------------------


class RecognizeRequest(CamelModel):
    request_id: str
    source: SourceRef
    output: RecognizeOutput
    options: RecognizeOptions


class RecognizeResponse(CamelModel):
    document: PlanDocument
    meta: ImportResultMeta
    usage: Usage
    debug_artifacts: list[DebugArtifact]

    def wire(self) -> dict[str, Any]:
        """As the base ``wire()``, but ``meta.inspect``/``meta.review`` (added by Laravel) stay absent."""
        out = super().wire()
        out["meta"] = self.meta.wire()
        return out


# --- /v1/inspect ----------------------------------------------------------------------------------


class ApiWarning(CamelModel):
    """Warning of inspect/normalize responses: ``{code, params}`` (recognize meta: ``MetaWarning``)."""

    code: WarningCode
    params: dict[str, str | int | float] = Field(default_factory=dict)


class EncodedImage(CamelModel):
    content_type: str
    base64: str
    width: int
    height: int


class PreviewImage(EncodedImage):
    page: int


class InspectPage(CamelModel):
    index: int
    width_pt: float | None
    height_pt: float | None
    is_vector: bool
    thumbnail: EncodedImage


class PhotoInfo(CamelModel):
    is_likely_photo: bool
    suggested_corners: Corners | None


class InspectRequest(CamelModel):
    source: SourceRef


class InspectResponse(CamelModel):
    source_kind: SourceKind
    page_count: int
    pages: list[InspectPage]
    preview: PreviewImage
    photo: PhotoInfo | None
    dxf: DxfInfo | None
    warnings: list[ApiWarning]


# --- /v1/normalize --------------------------------------------------------------------------------


class NormalizeRequest(CamelModel):
    request_id: str
    source: SourceRef
    output: NormalizeOutput
    options: NormalizeOptions = Field(default_factory=NormalizeOptions)


class ScaleNoteOut(CamelModel):
    mm_per_pixel: float
    text: str


class NormalizeResponse(CamelModel):
    page_image: PageImage
    scale_note: ScaleNoteOut | None
    warnings: list[ApiWarning]


# --- /v1/images/normalize -------------------------------------------------------------------------


class ImageNormalizeRequest(CamelModel):
    source_url: str
    target_url: str
    format: Literal["jpeg", "png", "webp"]
    quality: Annotated[int, Field(ge=1, le=100)]
    max_edge: Annotated[int, Field(ge=64, le=8192)]
    apply_orientation: bool


class ImageNormalizeResponse(CamelModel):
    width: int
    height: int
    bytes: int


# --- /v1/capabilities, /v1/providers/test ---------------------------------------------------------


class ProviderLastError(CamelModel):
    code: str
    at: datetime


class ProviderInfo(CamelModel):
    name: ProviderName
    configured: bool
    default_model: str | None
    supports_vision: bool
    supports_tools: bool
    supports_json_schema: bool
    supports_effort: bool
    max_image_px: int
    max_images_per_request: int
    last_error: ProviderLastError | None
    # Names (never values) of unset env vars; only present for unconfigured providers (K3).
    missing: list[str] | None = None

    @model_serializer(mode="wrap")
    def _omit_missing_when_none(self, handler: SerializerFunctionWrapHandler) -> dict[str, Any]:
        data: dict[str, Any] = handler(self)
        if data.get("missing") is None:
            data.pop("missing", None)
        return data


class OcrInfo(CamelModel):
    engine: str
    loaded: bool


class CapabilityLimits(CamelModel):
    max_source_bytes: int
    max_dxf_bytes: int
    max_pdf_pages: int
    max_pixels: int
    recognize_deadline_s: float


class CapabilitiesResponse(CamelModel):
    service_version: str
    pipeline_version: str
    providers: list[ProviderInfo]
    ocr: OcrInfo
    limits: CapabilityLimits


class ProviderTestRequest(CamelModel):
    provider: ProviderName
    model: str | None = None


class ProviderTestError(CamelModel):
    code: str
    message: str


class ProviderTestResponse(CamelModel):
    ok: bool
    provider: ProviderName
    model: str | None
    latency_ms: int
    vision_verified: bool
    json_schema_verified: bool
    usage: UsageCallOut | None
    error: ProviderTestError | None
