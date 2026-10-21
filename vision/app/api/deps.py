"""Request dependencies: bearer auth and concurrency slots (06 §5.2, §5.3)."""

import asyncio
import hmac
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import cast

from fastapi import Request

from app.api.errors import VisionError
from app.config import Settings

RETRY_AFTER_S = "20"


async def require_token(request: Request) -> None:
    """Require `Authorization: Bearer <VISION_SERVICE_TOKEN>` (constant-time compare)."""
    settings = cast(Settings, request.app.state.settings)
    scheme, _, token = (request.headers.get("authorization") or "").strip().partition(" ")
    expected = settings.vision_service_token.get_secret_value().encode()
    # Always compare, so a wrong scheme and a wrong token take the same path.
    token_ok = hmac.compare_digest(token.strip().encode(), expected)
    if scheme.lower() != "bearer" or not token_ok:
        raise VisionError("unauthorized", "Missing or invalid bearer token")


@asynccontextmanager
async def _slot(sem: asyncio.Semaphore, wait_s: float) -> AsyncIterator[None]:
    try:
        await asyncio.wait_for(sem.acquire(), wait_s)
    except TimeoutError:
        raise VisionError(
            "busy", "The analyzer is busy; retry shortly", headers={"Retry-After": RETRY_AFTER_S}
        ) from None
    try:
        yield
    finally:
        sem.release()


async def heavy_slot(request: Request) -> AsyncIterator[None]:
    """Per-process heavy slot (`Semaphore(1)`) for recognize and normalize."""
    settings = cast(Settings, request.app.state.settings)
    async with _slot(request.app.state.heavy_sem, settings.vision_heavy_slot_wait_s):
        yield


async def light_slot(request: Request) -> AsyncIterator[None]:
    """Per-process light slot (`Semaphore(2)`) for inspect and images/normalize.

    06 §5.2 gives no wait rule for the light slot; it reuses `vision_heavy_slot_wait_s`.
    """
    settings = cast(Settings, request.app.state.settings)
    async with _slot(request.app.state.light_sem, settings.vision_heavy_slot_wait_s):
        yield
