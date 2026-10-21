"""Debug artifact sink (06 §13): up to 8 named PNG/JSON artifacts, PUT to presigned URLs on flush."""

import dataclasses
import json
import logging
from typing import Any

import cv2
import numpy as np
from pydantic import BaseModel

from app.api.errors import VisionError
from app.schemas.api import DebugArtifact
from app.utils.http import SourceIO

logger = logging.getLogger("furny.vision.debug")

MAX_ARTIFACTS = 8
PNG = "image/png"
JSON = "application/json"


def _json_default(obj: Any) -> Any:
    if isinstance(obj, BaseModel):
        return obj.model_dump(mode="json", by_alias=True)
    if dataclasses.is_dataclass(obj) and not isinstance(obj, type):
        return dataclasses.asdict(obj)
    if isinstance(obj, np.generic):
        return obj.item()
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    if isinstance(obj, set | frozenset):
        return sorted(obj, key=repr)
    return repr(obj)


class DebugSink:
    """Collects artifacts by slot index while enabled; a disabled sink stores and uploads nothing."""

    def __init__(self, enabled: bool) -> None:
        self.enabled = enabled
        self._items: dict[int, tuple[str, str, bytes]] = {}

    def _store(self, index: int, name: str, content_type: str, data: bytes) -> None:
        if 0 <= index < MAX_ARTIFACTS:
            self._items[index] = (name, content_type, data)

    def add_png(self, index: int, name: str, img: np.ndarray) -> None:
        if not self.enabled or not 0 <= index < MAX_ARTIFACTS:
            return
        ok, encoded = cv2.imencode(".png", img)
        if not ok:
            logger.warning("debug png encode failed", extra={"artifact": name})
            return
        self._store(index, name, PNG, encoded.tobytes())

    def add_json(self, index: int, name: str, obj: Any) -> None:
        if not self.enabled or not 0 <= index < MAX_ARTIFACTS:
            return
        data = json.dumps(obj, default=_json_default, ensure_ascii=False).encode("utf-8")
        self._store(index, name, JSON, data)

    def flush(self, put_urls: list[str], io: SourceIO) -> list[DebugArtifact]:
        """PUT each stored artifact to `put_urls[index]`; failures are logged and the artifact omitted."""
        written: list[DebugArtifact] = []
        if not self.enabled:
            return written
        for index in sorted(self._items):
            if index >= len(put_urls):
                continue
            name, content_type, data = self._items[index]
            try:
                io.put(put_urls[index], data, content_type)
            except VisionError as exc:
                logger.warning(
                    "debug artifact upload failed", extra={"artifact": name, "errorCode": exc.code}
                )
                continue
            written.append(DebugArtifact(index=index, name=name, content_type=content_type))
        return written
