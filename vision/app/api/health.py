"""`GET /healthz` (06 §5.7): unauthenticated; 503 until the OCR model is loaded."""

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app import __version__

router = APIRouter()


@router.get("/healthz")
async def healthz(request: Request) -> JSONResponse:
    loaded = bool(request.app.state.ocr_loaded)
    return JSONResponse(
        {"status": "ok" if loaded else "loading", "version": __version__, "ocrLoaded": loaded},
        status_code=200 if loaded else 503,
    )
