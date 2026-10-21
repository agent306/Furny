"""Deadline-aware wrappers around `SourceIO` (06 §7.1, §14.2)."""

from app.pipeline.context import PipelineContext


def fetch_source(url: str, max_bytes: int, ctx: PipelineContext, timeout_s: float = 30) -> bytes:
    """Download `url` (aborting past `max_bytes`); never starts, or returns, past the deadline."""
    ctx.check_deadline()
    data = ctx.io.fetch(url, max_bytes, timeout_s)
    ctx.check_deadline()
    return data


def upload_bytes(url: str, data: bytes, content_type: str, ctx: PipelineContext) -> None:
    """PUT `data` to a presigned URL (retried by the io); never starts past the deadline."""
    ctx.check_deadline()
    ctx.io.put(url, data, content_type)
