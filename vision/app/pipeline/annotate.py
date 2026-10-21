"""What the LLM sees (06 §9.2): overview images, set-of-marks overlays and the compact candidate JSON.

All coordinates sent to or received from a model are absolute integer overview pixels, relative to the plan
region's top-left corner. ``from_overview`` is the inverse mapping labeler outputs go through before assembly
(06 §8.7 step 2): ``p_norm = p_ov / s + offset``.
"""

import json
import math
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, replace
from typing import Any, Literal, NamedTuple

import cv2
import numpy as np

from app.pipeline.context import PipelineContext
from app.pipeline.normalize import NormalizedPage
from app.providers.base import ImagePart
from app.schemas.candidates import (
    CandidateSet,
    DimensionSpan,
    OpeningCandidate,
    RoomFace,
    TextToken,
    WallCandidate,
)
from app.utils.geometry import Pt, Rect

Kind = Literal["texts", "walls", "openings", "rooms", "dimensionSpans"]

TRUNCATION: dict[str, int] = {"texts": 300, "walls": 400, "openings": 150, "rooms": 80, "dimensionSpans": 200}
MAX_PNG_BYTES = 4_500_000  # 18 §3: a bigger PNG goes out as JPEG q90 (API limit 5 MB per image)
JPEG_QUALITY = 90

STROKE_PX = 2
LABEL_CAP_PX = 14
LABEL_HALO_PX = 3
LABEL_TEXT_THICKNESS = 2
LABEL_OFFSET_PX = 12
LABEL_ATTEMPTS = 3
_FONT = cv2.FONT_HERSHEY_DUPLEX


def _hex_bgr(h: str) -> tuple[int, int, int]:
    return int(h[5:7], 16), int(h[3:5], 16), int(h[1:3], 16)


WALL_BGR = _hex_bgr("#E53935")
OPENING_BGR = _hex_bgr("#2E7D32")
ROOM_BGR = _hex_bgr("#6A1B9A")
TEXT_BGR = _hex_bgr("#1565C0")
SPAN_BGR = _hex_bgr("#EF6C00")
_WHITE = (255, 255, 255)


def _font_scale() -> float:
    """The Hershey DUPLEX scale whose capital letters are ``LABEL_CAP_PX`` tall."""
    (_, cap), _ = cv2.getTextSize("H", _FONT, 1.0, LABEL_TEXT_THICKNESS)
    return LABEL_CAP_PX / cap


FONT_SCALE = _font_scale()


@dataclass(frozen=True, eq=False)
class Overview:
    """The two model images and the candidate listing, in overview pixels.

    ``offset`` is the plan region's top-left in normalized-page pixels; ``s`` the shrink factor.
    ``payload`` is the candidate JSON as a dict, ``candidates_json`` its compact string form.
    """

    s: float
    offset: tuple[int, int]
    width: int
    height: int
    clean: np.ndarray
    marked: np.ndarray
    candidates_json: str
    payload: dict[str, Any]


def to_overview(pt_norm: Pt, ov: Overview) -> tuple[int, int]:
    return round((pt_norm[0] - ov.offset[0]) * ov.s), round((pt_norm[1] - ov.offset[1]) * ov.s)


def from_overview(pt_ov: Pt, ov: Overview) -> Pt:
    return pt_ov[0] / ov.s + ov.offset[0], pt_ov[1] / ov.s + ov.offset[1]


def to_image_part(img: np.ndarray) -> ImagePart:
    ok, png = cv2.imencode(".png", img)
    if not ok:
        raise ValueError("PNG encoding failed")
    if len(png) <= MAX_PNG_BYTES:
        return ImagePart(png.tobytes(), "image/png")
    ok, jpg = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
    if not ok:
        raise ValueError("JPEG encoding failed")
    return ImagePart(jpg.tobytes(), "image/jpeg")


# --- candidate listing ----------------------------------------------------------------------------------


def natural_key(candidate_id: str) -> tuple[str, int]:
    """``T2`` before ``T10``: prefix, then the number."""
    prefix = candidate_id.rstrip("0123456789")
    digits = candidate_id[len(prefix) :]
    return prefix, int(digits) if digits else 0


class Entry(NamedTuple):
    obj: Any
    item: dict[str, Any]
    ref: tuple[int, int]  # the reference point (overview px) region filters test


def _parsed(t: TextToken) -> str:
    p = t.parsed
    if p.kind == "room_name":
        return f"room_name:{(p.room_type or p.room_name or '').lower()}"
    value: object = None
    if p.kind in ("mm_number", "metric_length", "feet_inch"):
        value = p.mm
    elif p.kind == "size_pair" and p.pair_mm is not None:
        value = f"{p.pair_mm[0]}x{p.pair_mm[1]}"
    elif p.kind == "area":
        value = p.area_mm2
    elif p.kind == "scale_note":
        value = p.scale_n
    elif p.kind == "opening_tag":
        value = p.tag
    return "other" if p.kind == "other" or value is None else f"{p.kind}:{value}"


def _opening_ends(o: OpeningCandidate, walls: Mapping[str, WallCandidate]) -> tuple[Pt, Pt] | None:
    w = walls.get(o.wall_id)
    if w is None:
        return None
    length = math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1])
    if length == 0:
        return None
    ux, uy = (w.b[0] - w.a[0]) / length, (w.b[1] - w.a[1]) / length
    return (w.a[0] + ux * o.u0, w.a[1] + uy * o.u0), (w.a[0] + ux * o.u1, w.a[1] + uy * o.u1)


def _mid(a: tuple[int, int], b: tuple[int, int]) -> tuple[int, int]:
    return round((a[0] + b[0]) / 2), round((a[1] + b[1]) / 2)


def _build_entry(kind: Kind, o: Any, walls: Mapping[str, WallCandidate], ov: Overview) -> Entry | None:
    def pt(p: Pt) -> tuple[int, int]:
        return to_overview(p, ov)

    item: dict[str, Any]
    if kind == "texts":
        t: TextToken = o
        x0, y0 = pt((t.box[0], t.box[1]))
        x1, y1 = pt((t.box[2], t.box[3]))
        item = {
            "id": t.id,
            "text": t.text,
            "box": [x0, y0, x1, y1],
            "angle": t.angle,
            "score": round(t.score, 2),
            "parsed": _parsed(t),
        }
        return Entry(o, item, _mid((x0, y0), (x1, y1)))
    if kind == "walls":
        w: WallCandidate = o
        a, b = pt(w.a), pt(w.b)
        item = {
            "id": w.id,
            "p0": list(a),
            "p1": list(b),
            "thicknessPx": max(1, round(w.thickness_px * ov.s)),
            "source": w.source,
            "freeEnds": w.free_ends,
        }
        return Entry(o, item, _mid(a, b))
    if kind == "openings":
        op: OpeningCandidate = o
        ends = _opening_ends(op, walls)
        if ends is None:
            return None
        a, b = pt(ends[0]), pt(ends[1])
        item = {
            "id": op.id,
            "wallId": op.wall_id,
            "p0": list(a),
            "p1": list(b),
            "kind": op.kind,
            "support": round(op.support, 2),
        }
        return Entry(o, item, _mid(a, b))
    if kind == "rooms":
        r: RoomFace = o
        anchor = pt(r.anchor_px)
        x0, y0 = pt((r.bbox[0], r.bbox[1]))
        x1, y1 = pt((r.bbox[2], r.bbox[3]))
        item = {
            "id": r.id,
            "anchor": list(anchor),
            "bbox": [x0, y0, x1, y1],
            "areaPx": round(r.area_px * ov.s * ov.s),
            "containsTextIds": list(r.contains_text_ids),
            "open": r.open,
        }
        return Entry(o, item, anchor)
    d: DimensionSpan = o
    a, b = pt(d.p0), pt(d.p1)
    item = {
        "id": d.id,
        "p0": list(a),
        "p1": list(b),
        "axis": d.axis,
        "kind": d.kind,
        "nearTextIds": list(d.near_text_ids),
    }
    return Entry(o, item, _mid(a, b))


def _length(a: Pt, b: Pt) -> float:
    return math.hypot(b[0] - a[0], b[1] - a[1])


# What to keep when a kind is over its limit (06 §9.2: longest / highest score); ties fall back to id order.
_PRIORITY: dict[str, Callable[[Any], float]] = {
    "texts": lambda t: t.score,
    "walls": lambda w: _length(w.a, w.b),
    "openings": lambda o: o.support,
    "rooms": lambda r: r.area_px,
    "dimensionSpans": lambda d: _length(d.p0, d.p1),
}


def _objects(kind: Kind, cs: CandidateSet) -> Sequence[Any]:
    by_kind: dict[str, Sequence[Any]] = {
        "texts": cs.texts,
        "walls": cs.walls,
        "openings": cs.openings,
        "rooms": cs.rooms,
        "dimensionSpans": cs.spans,
    }
    return by_kind[kind]


def entries(
    kind: Kind,
    cs: CandidateSet,
    ov: Overview,
    *,
    limit: int | None = None,
    region: Rect | None = None,
) -> tuple[list[Entry], int]:
    """The candidates of ``kind`` as JSON items sorted by id, restricted to ``region`` (overview px, by the
    reference point) and cut to the ``limit`` best. Returns them with the count before the cut."""
    walls = {w.id: w for w in cs.walls}
    built = [e for o in _objects(kind, cs) if (e := _build_entry(kind, o, walls, ov)) is not None]
    if region is not None:
        built = [e for e in built if region.contains(e.ref)]
    total = len(built)
    if limit is not None and total > limit:
        prio = _PRIORITY[kind]
        best = sorted(built, key=lambda e: (-prio(e.obj), natural_key(e.item["id"])))[:limit]
        built = best
    built.sort(key=lambda e: natural_key(e.item["id"]))
    return built, total


def compact_json(value: object) -> str:
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False)


# --- marks ----------------------------------------------------------------------------------------------


class _Labels:
    """Places labels with a white halo; a label that keeps colliding is left off the image."""

    def __init__(self, img: np.ndarray) -> None:
        self.img = img
        self.placed: list[tuple[int, int, int, int]] = []

    def put(self, text: str, x: int, y: int, bgr: tuple[int, int, int]) -> None:
        """``(x, y)`` is the label's bottom-left corner."""
        (tw, th), base = cv2.getTextSize(text, _FONT, FONT_SCALE, LABEL_TEXT_THICKNESS)
        h, w = self.img.shape[:2]
        for attempt in range(LABEL_ATTEMPTS + 1):
            ly = y - attempt * LABEL_OFFSET_PX
            rect = (
                x - LABEL_HALO_PX,
                ly - th - LABEL_HALO_PX,
                x + tw + LABEL_HALO_PX,
                ly + base + LABEL_HALO_PX,
            )
            if rect[2] < 0 or rect[3] < 0 or rect[0] >= w or rect[1] >= h:
                return  # off the image: nothing to draw
            if any(
                rect[0] < p[2] and p[0] < rect[2] and rect[1] < p[3] and p[1] < rect[3] for p in self.placed
            ):
                continue
            self.placed.append(rect)
            halo = LABEL_TEXT_THICKNESS + 2 * LABEL_HALO_PX
            cv2.putText(self.img, text, (x, ly), _FONT, FONT_SCALE, _WHITE, halo, cv2.LINE_AA)
            cv2.putText(self.img, text, (x, ly), _FONT, FONT_SCALE, bgr, LABEL_TEXT_THICKNESS, cv2.LINE_AA)
            return


def draw_marks(
    img: np.ndarray,
    candidates_subset: CandidateSet,
    ov: Overview,
    scale: float,
    *,
    origin: tuple[float, float] = (0.0, 0.0),
    all_walls: Sequence[WallCandidate] | None = None,
) -> None:
    """Draw the set-of-marks overlay in place (06 §9.2): ``img`` shows the overview region whose top-left is
    ``origin`` (overview px), magnified by ``scale``. ``all_walls`` locates openings whose wall is not in the
    subset (default: the subset's own walls)."""
    walls = {w.id: w for w in (all_walls if all_walls is not None else candidates_subset.walls)}

    def px(p: Pt) -> tuple[int, int]:
        return (
            round(((p[0] - ov.offset[0]) * ov.s - origin[0]) * scale),
            round(((p[1] - ov.offset[1]) * ov.s - origin[1]) * scale),
        )

    def line(a: tuple[int, int], b: tuple[int, int], bgr: tuple[int, int, int], thickness: int) -> None:
        cv2.line(img, a, b, bgr, thickness, cv2.LINE_AA)

    labels: list[tuple[str, int, int, tuple[int, int, int]]] = []
    for w in candidates_subset.walls:
        a, b = px(w.a), px(w.b)
        line(a, b, WALL_BGR, STROKE_PX)
        m = _mid(a, b)
        labels.append((w.id, m[0] + 4, m[1] - 4, WALL_BGR))
    for o in candidates_subset.openings:
        ends = _opening_ends(o, walls)
        if ends is None:
            continue
        a, b = px(ends[0]), px(ends[1])
        line(a, b, OPENING_BGR, STROKE_PX + 2)
        m = _mid(a, b)
        labels.append((o.id, m[0] + 4, m[1] - 4, OPENING_BGR))
    for r in candidates_subset.rooms:
        c = px(r.anchor_px)
        cv2.circle(img, c, 4, ROOM_BGR, -1, cv2.LINE_AA)
        labels.append((r.id, c[0] + 6, c[1] - 6, ROOM_BGR))
    for d in candidates_subset.spans:
        a, b = px(d.p0), px(d.p1)
        line(a, b, SPAN_BGR, STROKE_PX)
        length = math.hypot(b[0] - a[0], b[1] - a[1])
        if length > 0:  # end ticks perpendicular to the line
            nx, ny = -(b[1] - a[1]) / length * 4, (b[0] - a[0]) / length * 4
            for e in (a, b):
                line(
                    (round(e[0] - nx), round(e[1] - ny)),
                    (round(e[0] + nx), round(e[1] + ny)),
                    SPAN_BGR,
                    STROKE_PX,
                )
        m = _mid(a, b)
        labels.append((d.id, m[0] + 4, m[1] - 4, SPAN_BGR))
    for t in candidates_subset.texts:
        x0, y0 = px((t.box[0], t.box[1]))
        x1, y1 = px((t.box[2], t.box[3]))
        cv2.rectangle(img, (x0, y0), (x1, y1), TEXT_BGR, STROKE_PX, cv2.LINE_AA)
        labels.append((t.id, x0, y0 - 3, TEXT_BGR))
    placer = _Labels(img)
    for text, x, y, bgr in labels:
        placer.put(text, x, y, bgr)


# --- overview -------------------------------------------------------------------------------------------

_JSON_ORDER: tuple[Kind, ...] = ("texts", "dimensionSpans", "walls", "openings", "rooms")


def build_overview(
    page: NormalizedPage, candidates: CandidateSet, *, max_image_px: int, ctx: PipelineContext
) -> Overview:
    """Clean and marked overview images plus the candidate JSON (06 §9.2)."""
    h, w = page.image.shape[:2]
    s = min(1.0, max_image_px / max(w, h))
    region = candidates.region.clip(w, h)
    if region.w == 0 or region.h == 0:
        region = Rect(0, 0, w, h)
    clean = page.image[region.y : region.y + region.h, region.x : region.x + region.w]
    if s < 1.0:
        size = (max(1, round(region.w * s)), max(1, round(region.h * s)))
        clean = cv2.resize(clean, size, interpolation=cv2.INTER_AREA)
    clean = np.ascontiguousarray(clean)
    ov = Overview(s, (region.x, region.y), clean.shape[1], clean.shape[0], clean, clean, "", {})

    payload: dict[str, Any] = {"image": {"width": ov.width, "height": ov.height}}
    kept: dict[Kind, list[Entry]] = {}
    for kind in _JSON_ORDER:
        kept[kind], total = entries(kind, candidates, ov, limit=TRUNCATION[kind])
        if total > TRUNCATION[kind]:
            ctx.warn(
                "too_many_candidates_truncated", {"kind": kind, "kept": TRUNCATION[kind], "total": total}
            )
        payload[kind] = [e.item for e in kept[kind]]
    subset = replace(
        candidates,
        texts=[e.obj for e in kept["texts"]],
        spans=[e.obj for e in kept["dimensionSpans"]],
        walls=[e.obj for e in kept["walls"]],
        openings=[e.obj for e in kept["openings"]],
        rooms=[e.obj for e in kept["rooms"]],
    )
    marked = clean.copy()
    draw_marks(marked, subset, ov, 1.0, all_walls=candidates.walls)
    return replace(ov, marked=marked, candidates_json=compact_json(payload), payload=payload)
