"""`GET /v1/capabilities` (18 §5.1): configured providers, OCR state and limits. No provider network calls."""

from typing import cast

from fastapi import APIRouter, Depends, Request

from app import PIPELINE_VERSION, __version__
from app.api.deps import require_token
from app.config import Settings
from app.providers import registry
from app.schemas.api import CapabilitiesResponse, CapabilityLimits, OcrInfo

MAX_DXF_BYTES = 15728640
MAX_PDF_PAGES = 20

router = APIRouter(dependencies=[Depends(require_token)])


@router.get("/v1/capabilities")
async def capabilities(request: Request) -> dict[str, object]:
    settings = cast(Settings, request.app.state.settings)
    return CapabilitiesResponse(
        service_version=__version__,
        pipeline_version=PIPELINE_VERSION,
        providers=registry.provider_capabilities(settings),
        ocr=OcrInfo(engine="rapidocr", loaded=bool(request.app.state.ocr_loaded)),
        limits=CapabilityLimits(
            max_source_bytes=settings.vision_max_source_bytes,
            max_dxf_bytes=MAX_DXF_BYTES,
            max_pdf_pages=MAX_PDF_PAGES,
            max_pixels=settings.vision_max_pixels,
            recognize_deadline_s=settings.vision_recognize_deadline_s,
        ),
    ).wire()
