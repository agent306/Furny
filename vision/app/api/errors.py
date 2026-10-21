"""Vision error type, HTTP status table (06 §14.2, §5.8) and exception handlers."""

import logging
from typing import Any, cast

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.responses import Response

logger = logging.getLogger("furny.vision.api")

# code -> (HTTP status, retryable). 06 §14.2 plus the 06 §5.8 image-normalize codes.
ERROR_TABLE: dict[str, tuple[int, bool]] = {
    # 400
    "invalid_request": (400, False),
    "invalid_page": (400, False),
    "provider_not_configured": (400, False),
    # 401
    "unauthorized": (401, False),
    # 413
    "file_too_large": (413, False),
    "image_too_large": (413, False),
    "too_large": (413, False),
    # 415
    "unsupported_type": (415, False),
    "dwg_not_supported": (415, False),
    "unsupported": (415, False),
    # 422
    "corrupt_file": (422, False),
    "pdf_encrypted": (422, False),
    "pdf_too_many_pages": (422, False),
    "image_too_small": (422, False),
    "dxf_too_complex": (422, False),
    "not_a_floor_plan": (422, False),
    "no_walls_detected": (422, False),
    "too_complex": (422, False),
    "decode_failed": (422, False),
    # 502
    "source_unavailable": (502, True),
    "provider_error": (502, True),
    "upload_failed": (502, True),
    # 503
    "busy": (503, True),
    # 504
    "deadline_exceeded": (504, False),
    # 500
    "internal_error": (500, True),
}


class VisionError(Exception):
    """An error with a stable machine code; rendered as `{"error": {...}}` (06 §14.2)."""

    def __init__(
        self,
        code: str,
        message: str = "",
        *,
        http_status: int | None = None,
        retryable: bool | None = None,
        details: dict[str, Any] | None = None,
        usage: Any = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        if code not in ERROR_TABLE and http_status is None:
            raise ValueError(f"unknown error code {code!r}: add it to ERROR_TABLE or pass http_status")
        table_status, table_retryable = ERROR_TABLE.get(code, (500, False))
        self.code = code
        self.message = message or code.replace("_", " ")
        self.http_status = http_status if http_status is not None else table_status
        self.retryable = retryable if retryable is not None else table_retryable
        self.details: dict[str, Any] = details if details is not None else {}
        self.usage = usage
        self.headers: dict[str, str] = headers if headers is not None else {}
        super().__init__(f"{code}: {self.message}")


def error_response(err: VisionError) -> JSONResponse:
    body = {
        "error": {
            "code": err.code,
            "message": err.message,
            "retryable": err.retryable,
            "details": err.details,
            "usage": err.usage,
        }
    }
    return JSONResponse(jsonable_encoder(body), status_code=err.http_status, headers=err.headers or None)


def unexpected_error_response(exc: BaseException) -> JSONResponse:
    """500 `internal_error` with a fixed message; the stack trace goes to the logs only."""
    logger.error("unhandled exception", exc_info=(type(exc), exc, exc.__traceback__))
    return error_response(VisionError("internal_error", "Internal error"))


async def _vision_error_handler(_request: Request, exc: Exception) -> Response:
    return error_response(cast(VisionError, exc))


async def _validation_error_handler(_request: Request, exc: Exception) -> Response:
    errors = [
        {"loc": list(e["loc"]), "msg": str(e["msg"])} for e in cast(RequestValidationError, exc).errors()
    ]
    return error_response(
        VisionError("invalid_request", "Request validation failed", details={"errors": errors})
    )


async def _unexpected_error_handler(_request: Request, exc: Exception) -> Response:
    return unexpected_error_response(exc)


def install_exception_handlers(app: FastAPI) -> None:
    app.add_exception_handler(VisionError, _vision_error_handler)
    app.add_exception_handler(RequestValidationError, _validation_error_handler)
    app.add_exception_handler(Exception, _unexpected_error_handler)
