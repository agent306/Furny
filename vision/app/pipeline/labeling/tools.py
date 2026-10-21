"""Agentic tools the labeler offers a model: ``crop_image`` and ``list_candidates`` (06 §9.5).

Every coordinate in and out is an absolute integer overview pixel (``annotate.Overview``).
"""

import math
from typing import Literal

import cv2
from pydantic import BaseModel, ConfigDict, ValidationError

from app.pipeline.annotate import (
    Kind,
    Overview,
    compact_json,
    draw_marks,
    entries,
    to_image_part,
)
from app.pipeline.normalize import NormalizedPage
from app.providers.base import TextPart, ToolCall, ToolResult, ToolSpec
from app.schemas.candidates import CandidateSet
from app.utils.geometry import Rect

INVALID_JSON_SENTINEL = "__invalid_json__"  # adapters put unparseable tool-argument JSON under this key
MIN_CROP_PX = 16
MAX_CROP_SCALE = 4.0
MAX_UPSAMPLE = 2.0  # never more than 2x native resolution
LIST_LIMIT = 200

CROP_IMAGE_SPEC = ToolSpec(
    name="crop_image",
    description=(
        "Return a zoomed crop of the floor-plan drawing. x, y, w, h are in the pixel space of the full "
        "overview images. scale is the magnification relative to the overview (1 to 4). Set annotated=true "
        "to draw the candidate IDs on the crop."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "x": {"type": "integer"},
            "y": {"type": "integer"},
            "w": {"type": "integer"},
            "h": {"type": "integer"},
            "scale": {"type": "number"},
            "annotated": {"type": "boolean"},
        },
        "required": ["x", "y", "w", "h", "scale", "annotated"],
        "additionalProperties": False,
    },
)

LIST_CANDIDATES_SPEC = ToolSpec(
    name="list_candidates",
    description=(
        "List candidates of one kind as JSON, optionally only those whose position lies inside a rectangle "
        "given in overview pixels."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "kind": {"type": "string", "enum": ["texts", "walls", "openings", "rooms", "dimensionSpans"]},
            "region": {
                "anyOf": [
                    {"type": "null"},
                    {
                        "type": "object",
                        "properties": {
                            "x": {"type": "integer"},
                            "y": {"type": "integer"},
                            "w": {"type": "integer"},
                            "h": {"type": "integer"},
                        },
                        "required": ["x", "y", "w", "h"],
                        "additionalProperties": False,
                    },
                ]
            },
        },
        "required": ["kind", "region"],
        "additionalProperties": False,
    },
)


class _Region(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")
    x: int
    y: int
    w: int
    h: int


class _CropArgs(_Region):
    scale: float
    annotated: bool


class _ListArgs(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")
    kind: Literal["texts", "walls", "openings", "rooms", "dimensionSpans"]
    region: _Region | None


def _error(call: ToolCall, message: str) -> ToolResult:
    return ToolResult(call_id=call.id, content=[TextPart(message)], is_error=True)


def _problems(exc: ValidationError) -> str:
    return "invalid arguments: " + "; ".join(
        f"{'.'.join(str(p) for p in e['loc']) or 'arguments'}: {e['msg']}" for e in exc.errors()
    )


class ToolExecutor:
    """Runs the model's tool calls against one page's overview and candidates."""

    def __init__(
        self,
        page: NormalizedPage,
        overview: Overview,
        candidates: CandidateSet,
        *,
        max_image_px: int,
        max_crops: int,
    ) -> None:
        self.page = page
        self.overview = overview
        self.candidates = candidates
        self.max_image_px = max_image_px
        self.max_crops = max_crops
        self.crops_used = 0

    def specs(self) -> list[ToolSpec]:
        return [CROP_IMAGE_SPEC, LIST_CANDIDATES_SPEC]

    def execute(self, call: ToolCall) -> ToolResult:
        if INVALID_JSON_SENTINEL in call.arguments:
            return _error(call, "invalid JSON arguments")
        if call.name == CROP_IMAGE_SPEC.name:
            return self._crop(call)
        if call.name == LIST_CANDIDATES_SPEC.name:
            return self._list(call)
        return _error(call, f"unknown tool {call.name}")

    def _crop(self, call: ToolCall) -> ToolResult:
        if self.crops_used >= self.max_crops:
            return _error(call, "crop budget exhausted, answer now")
        try:
            a = _CropArgs.model_validate(call.arguments)
        except ValidationError as exc:
            return _error(call, _problems(exc))
        if a.w < MIN_CROP_PX or a.h < MIN_CROP_PX:
            return _error(call, f"w and h must be at least {MIN_CROP_PX}")
        scale = min(MAX_CROP_SCALE, max(1.0, a.scale))
        ov = self.overview
        x0, y0 = max(0, a.x), max(0, a.y)
        x1, y1 = min(ov.width, a.x + a.w), min(ov.height, a.y + a.h)
        if x1 <= x0 or y1 <= y0:
            return _error(call, f"region lies outside the {ov.width}x{ov.height} overview")
        w, h = x1 - x0, y1 - y0

        # Source rectangle in normalized px = overview rect / s + offset.
        height, width = self.page.image.shape[:2]
        sx0 = min(width - 1, max(0, math.floor(ov.offset[0] + x0 / ov.s)))
        sy0 = min(height - 1, max(0, math.floor(ov.offset[1] + y0 / ov.s)))
        sx1 = min(width, max(sx0 + 1, math.ceil(ov.offset[0] + x1 / ov.s)))
        sy1 = min(height, max(sy0 + 1, math.ceil(ov.offset[1] + y1 / ov.s)))
        native = self.page.image[sy0:sy1, sx0:sx1]
        nh, nw = native.shape[:2]

        wanted_long = max(w, h) * scale
        cap = min(self.max_image_px, MAX_UPSAMPLE * max(nw, nh))
        factor = min(1.0, cap / wanted_long)
        cw, ch = max(1, round(w * scale * factor)), max(1, round(h * scale * factor))
        interp = cv2.INTER_CUBIC if cw > nw or ch > nh else cv2.INTER_AREA
        img = cv2.resize(native, (cw, ch), interpolation=interp)
        if a.annotated:
            draw_marks(img, self.candidates, ov, cw / w, origin=(float(x0), float(y0)))
        self.crops_used += 1
        text = (
            f"Crop of overview region x={x0}, y={y0}, w={w}, h={h}. This image is {cw}x{ch} px; "
            f"a point (u, v) in it corresponds to overview point (x + u*{w}/{cw}, y + v*{h}/{ch})."
        )
        return ToolResult(call_id=call.id, content=[to_image_part(img), TextPart(text)])

    def _list(self, call: ToolCall) -> ToolResult:
        try:
            a = _ListArgs.model_validate(call.arguments)
        except ValidationError as exc:
            return _error(call, _problems(exc))
        kind: Kind = a.kind
        region = Rect(a.region.x, a.region.y, a.region.w, a.region.h) if a.region else None
        found, total = entries(kind, self.candidates, self.overview, limit=LIST_LIMIT, region=region)
        text = compact_json({kind: [e.item for e in found], "truncated": total > LIST_LIMIT})
        return ToolResult(call_id=call.id, content=[TextPart(text)])
