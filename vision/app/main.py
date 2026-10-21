"""App factory (06 §5.1): lifespan (OCR warm-up), request-id/access-log middleware, routers."""

import asyncio
import logging
import time
import uuid
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from typing import Any

import anyio.to_thread
import cv2
from fastapi import FastAPI
from starlette.requests import Request
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app import __version__
from app.api import health
from app.api.errors import install_exception_handlers, unexpected_error_response
from app.config import Settings, get_settings
from app.logging import configure_logging, request_id_var

logger = logging.getLogger("furny.vision.app")
access_logger = logging.getLogger("furny.vision.access")

REQUEST_ID_HEADER = "x-request-id"
MAX_REQUEST_ID_LENGTH = 128


class RequestContextMiddleware:
    """Request id (header or uuid4) into `request_id_var` and the response; one access-log line."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        request_id = (
            Request(scope).headers.get(REQUEST_ID_HEADER, "").strip()[:MAX_REQUEST_ID_LENGTH]
            or uuid.uuid4().hex
        )
        token = request_id_var.set(request_id)
        started = time.perf_counter()
        status = 500
        response_started = False

        async def send_wrapper(message: Message) -> None:
            nonlocal status, response_started
            if message["type"] == "http.response.start":
                response_started = True
                status = message["status"]
                headers = [(k, v) for k, v in message.get("headers", []) if k.lower() != b"x-request-id"]
                headers.append((b"x-request-id", request_id.encode("latin-1", "replace")))
                message = {**message, "headers": headers}
            await send(message)

        try:
            try:
                await self.app(scope, receive, send_wrapper)
            except Exception as exc:
                if response_started:
                    raise
                await unexpected_error_response(exc)(scope, receive, send_wrapper)
        finally:
            access_logger.info(
                "request",
                extra={
                    "path": scope["path"],
                    "status": status,
                    "durationMs": round((time.perf_counter() - started) * 1000),
                },
            )
            request_id_var.reset(token)


def _init_sentry(settings: Settings) -> None:
    if not settings.sentry_dsn:
        return
    import sentry_sdk

    # No request bodies: they carry presigned URLs (06 §5.3).
    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        release=__version__,
        send_default_pii=False,
        max_request_body_size="never",
    )


async def _load_ocr(app: FastAPI, factory: Callable[[], Any]) -> None:
    try:
        app.state.ocr = await anyio.to_thread.run_sync(factory, abandon_on_cancel=True)
    except Exception:
        logger.exception("ocr model failed to load")
        return
    app.state.ocr_loaded = True
    logger.info("ocr model loaded")


def create_app(settings: Settings | None = None, *, ocr_factory: Callable[[], Any] | None = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        cv2.setNumThreads(2)
        configure_logging(settings.vision_log_level)
        _init_sentry(settings)
        # Created here (inside the running loop) so every uvicorn worker process owns its own.
        app.state.heavy_sem = asyncio.Semaphore(1)
        app.state.light_sem = asyncio.Semaphore(2)
        loader: asyncio.Task[None] | None = None
        if ocr_factory is not None:
            loader = asyncio.create_task(_load_ocr(app, ocr_factory))
        else:
            logger.warning("no ocr factory configured; /healthz stays 503")
        try:
            yield
        finally:
            if loader is not None:
                loader.cancel()
                await asyncio.gather(loader, return_exceptions=True)

    # Interactive docs and the OpenAPI schema would be unauthenticated endpoints.
    app = FastAPI(
        title="furny-vision",
        version=__version__,
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.state.settings = settings
    app.state.ocr = None
    app.state.ocr_loaded = False
    app.state.provider_factory = None  # filled in Task 22
    app.state.io_factory = None  # filled in Task 6
    app.add_middleware(RequestContextMiddleware)
    install_exception_handlers(app)
    app.include_router(health.router)
    return app


def __getattr__(name: str) -> Any:
    """`app.main:app` for uvicorn, built on first access so importing the module needs no settings."""
    if name == "app":
        created = create_app()
        globals()["app"] = created
        return created
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
