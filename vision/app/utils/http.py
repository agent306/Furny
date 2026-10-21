"""Source I/O over presigned URLs (06 §7.1, §14.2) and local files (`file://`, for evals and tests)."""

import logging
import time
from collections.abc import Callable
from pathlib import Path
from typing import Protocol
from urllib.parse import unquote, urlparse

import httpx

from app.api.errors import VisionError

logger = logging.getLogger("furny.vision.io")

PUT_ATTEMPTS = 3
# 06 §14.2 says "3 attempts, 1/2/4 s": with three attempts only two waits happen, so 4 s is never reached.
PUT_BACKOFF_S: tuple[float, ...] = (1, 2)
PUT_TIMEOUT_S = 60.0


class SourceIO(Protocol):
    def fetch(self, url: str, max_bytes: int, timeout_s: float = 30) -> bytes: ...

    def put(self, url: str, data: bytes, content_type: str) -> None: ...


def _too_large(max_bytes: int) -> VisionError:
    return VisionError("file_too_large", f"Source exceeds {max_bytes} bytes", details={"maxBytes": max_bytes})


class HttpIO:
    """GET (streamed, byte-capped) and PUT (retried) against presigned URLs.

    Error messages never include the URL: it is a bearer credential.
    """

    def __init__(
        self,
        client: httpx.Client | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._client = client or httpx.Client()
        self._sleep = sleep

    def fetch(self, url: str, max_bytes: int, timeout_s: float = 30) -> bytes:
        try:
            with self._client.stream("GET", url, timeout=timeout_s) as response:
                if response.status_code != 200:
                    raise VisionError(
                        "source_unavailable",
                        f"Source download returned HTTP {response.status_code}",
                        details={"status": response.status_code},
                    )
                declared = response.headers.get("content-length", "")
                if declared.isdigit() and int(declared) > max_bytes:
                    raise _too_large(max_bytes)
                chunks: list[bytes] = []
                size = 0
                for chunk in response.iter_bytes():
                    size += len(chunk)
                    if size > max_bytes:
                        raise _too_large(max_bytes)
                    chunks.append(chunk)
        except (httpx.HTTPError, httpx.InvalidURL) as exc:
            raise VisionError("source_unavailable", f"Source download failed ({type(exc).__name__})") from exc
        return b"".join(chunks)

    def put(self, url: str, data: bytes, content_type: str) -> None:
        last = "unknown"
        for attempt in range(PUT_ATTEMPTS):
            if attempt:
                self._sleep(PUT_BACKOFF_S[attempt - 1])
            try:
                response = self._client.put(
                    url, content=data, headers={"Content-Type": content_type}, timeout=PUT_TIMEOUT_S
                )
            except (httpx.HTTPError, httpx.InvalidURL) as exc:
                last = type(exc).__name__
                continue
            if response.is_success:
                return
            last = f"HTTP {response.status_code}"
        raise VisionError(
            "upload_failed", f"Upload failed after {PUT_ATTEMPTS} attempts ({last})", details={"last": last}
        )


def _local_path(url: str) -> Path | None:
    parsed = urlparse(url)
    if parsed.scheme != "file":
        return None
    return Path(unquote(parsed.path))


class LocalIO:
    """`file://` URLs on both fetch and put (offline evals, tests)."""

    def fetch(self, url: str, max_bytes: int, timeout_s: float = 30) -> bytes:
        path = _local_path(url)
        if path is None:
            raise VisionError("source_unavailable", "LocalIO only reads file:// URLs")
        try:
            with path.open("rb") as handle:
                data = handle.read(max_bytes + 1)
        except OSError as exc:
            raise VisionError("source_unavailable", f"Local read failed ({type(exc).__name__})") from exc
        if len(data) > max_bytes:
            raise _too_large(max_bytes)
        return data

    def put(self, url: str, data: bytes, content_type: str) -> None:
        path = _local_path(url)
        if path is None:
            raise VisionError("upload_failed", "LocalIO only writes file:// URLs")
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        except OSError as exc:
            raise VisionError("upload_failed", f"Local write failed ({type(exc).__name__})") from exc
