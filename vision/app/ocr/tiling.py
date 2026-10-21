"""Tiling and de-duplication of OCR boxes (06 §7.7)."""

from collections.abc import Callable, Sequence
from typing import Protocol

import numpy as np

from app.ocr.engine import OcrLike, RawOcrBox
from app.utils.geometry import Pt

TILE = 1280
OVERLAP = 160
IOU_WITHIN_PASS = 0.5
IOU_ACROSS_PASSES = 0.3


class Detection(Protocol):
    @property
    def quad(self) -> np.ndarray: ...

    @property
    def score(self) -> float: ...


def tile_origins(length: int, tile: int = TILE, overlap: int = OVERLAP) -> list[int]:
    """Start offsets of overlapping tiles covering `[0, length)`; the last tile ends exactly at `length`."""
    origins = [0]
    step = tile - overlap
    while origins[-1] + tile < length:
        origins.append(min(origins[-1] + step, length - tile))
    return origins


def map_rotated_cw(pt: Pt, tile_h: int) -> Pt:
    """Point `(u, v)` of an image rotated 90 degrees clockwise -> `(x, y)` in the `tile_h` high original.

    `cv2.ROTATE_90_CLOCKWISE` sends `(x, y)` to `(u, v) = (tile_h - 1 - y, x)`.
    """
    u, v = pt
    return v, tile_h - 1 - u


def quad_bbox(quad: np.ndarray) -> tuple[float, float, float, float]:
    return float(quad[:, 0].min()), float(quad[:, 1].min()), float(quad[:, 0].max()), float(quad[:, 1].max())


def _iou_with(bbox: tuple[float, float, float, float], others: np.ndarray) -> np.ndarray:
    """IoU of one `(x0, y0, x1, y1)` with every row of an `(n, 4)` array."""
    ix = np.clip(np.minimum(bbox[2], others[:, 2]) - np.maximum(bbox[0], others[:, 0]), 0, None)
    iy = np.clip(np.minimum(bbox[3], others[:, 3]) - np.maximum(bbox[1], others[:, 1]), 0, None)
    inter = ix * iy
    union = (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]) + (others[:, 2] - others[:, 0]) * (
        others[:, 3] - others[:, 1]
    )
    union = union - inter
    return np.where(union > 0, inter / np.where(union > 0, union, 1.0), 0.0)


def _greedy[D: Detection](boxes: Sequence[D], iou: float, groups: Sequence[int]) -> list[D]:
    """Keep by descending score (ties: input order); drop a box overlapping a kept box of another group."""
    boxes_xyxy = np.array([quad_bbox(b.quad) for b in boxes], np.float64).reshape(-1, 4)
    order = sorted(range(len(boxes)), key=lambda i: -boxes[i].score)
    kept: list[int] = []
    for i in order:
        rivals = [k for k in kept if groups[k] != groups[i]]
        if rivals and (_iou_with(quad_bbox(boxes[i].quad), boxes_xyxy[rivals]) > iou).any():
            continue
        kept.append(i)
    return [boxes[i] for i in sorted(kept)]


def dedupe[D: Detection](boxes: Sequence[D], iou: float) -> list[D]:
    """Drop every box whose bbox IoU with a higher-scoring kept box exceeds `iou` (earlier wins ties)."""
    return _greedy(boxes, iou, range(len(boxes)))


def merge_passes[D: Detection](
    pass_a: Sequence[D], pass_b: Sequence[D], iou: float = IOU_ACROSS_PASSES
) -> list[D]:
    """Merge two passes: a duplicate across passes (IoU > `iou`) keeps the higher score, pass A on a tie.

    Boxes of the same pass never suppress each other here (they were de-duplicated with a looser rule).
    """
    return _greedy([*pass_a, *pass_b], iou, [0] * len(pass_a) + [1] * len(pass_b))


SEAM_PX = 3  # a box this close to an interior tile edge may be cut by it
SEAM_CONTAINED = (
    0.8  # share of a seam box's area inside a larger box of another tile that marks it a fragment
)


def _touches_seam(
    bbox: tuple[float, float, float, float],
    tile_w: int,
    tile_h: int,
    at: tuple[int, int],
    size: tuple[int, int],
) -> bool:
    """Whether `bbox` (tile coordinates) touches a tile edge that is not the image border."""
    (ox, oy), (w, h) = at, size
    x0, y0, x1, y1 = bbox
    return (
        (ox > 0 and x0 <= SEAM_PX)
        or (ox + tile_w < w and x1 >= tile_w - SEAM_PX)
        or (oy > 0 and y0 <= SEAM_PX)
        or (oy + tile_h < h and y1 >= tile_h - SEAM_PX)
    )


def _drop_seam_fragments(found: list[RawOcrBox], tile_of: list[int], seam: list[bool]) -> list[RawOcrBox]:
    """Drop seam-touching boxes mostly covered by a larger box of another tile, whatever their scores.

    A tile edge can cut "1250" into a confident "125"; score-only de-duplication would let it displace the
    full reading from the neighbouring tile.
    """
    if not any(seam):
        return found
    xyxy = np.array([quad_bbox(b.quad) for b in found], np.float64).reshape(-1, 4)
    area = (xyxy[:, 2] - xyxy[:, 0]) * (xyxy[:, 3] - xyxy[:, 1])
    tiles = np.array(tile_of)
    kept: list[RawOcrBox] = []
    for i, box in enumerate(found):
        if seam[i] and area[i] > 0:
            ix = np.clip(np.minimum(xyxy[i, 2], xyxy[:, 2]) - np.maximum(xyxy[i, 0], xyxy[:, 0]), 0, None)
            iy = np.clip(np.minimum(xyxy[i, 3], xyxy[:, 3]) - np.maximum(xyxy[i, 1], xyxy[:, 1]), 0, None)
            covering = (tiles != tiles[i]) & (area > area[i]) & (ix * iy >= SEAM_CONTAINED * area[i])
            if covering.any():
                continue
        kept.append(box)
    return kept


def read_tiled(
    ocr: OcrLike,
    img: np.ndarray,
    check_deadline: Callable[[], None],
    tile: int = TILE,
    overlap: int = OVERLAP,
) -> list[RawOcrBox]:
    """Read `img` tile by tile (row-major), map boxes back by the tile offset, drop fragments and duplicates.

    Boxes cut by an interior tile edge that sit inside a larger box of another tile are dropped first;
    the rest are de-duplicated by IoU (higher score wins).
    """
    h, w = img.shape[:2]
    found: list[RawOcrBox] = []
    tile_of: list[int] = []
    seam: list[bool] = []
    origins = [(ox, oy) for oy in tile_origins(h, tile, overlap) for ox in tile_origins(w, tile, overlap)]
    for tile_index, (ox, oy) in enumerate(origins):
        check_deadline()
        tile_img = img[oy : oy + tile, ox : ox + tile]
        th, tw = tile_img.shape[:2]
        for box in ocr.read(tile_img):
            seam.append(_touches_seam(quad_bbox(box.quad), tw, th, (ox, oy), (w, h)))
            tile_of.append(tile_index)
            found.append(
                RawOcrBox(quad=box.quad + np.array([ox, oy], np.float64), text=box.text, score=box.score)
            )
    return dedupe(_drop_seam_fragments(found, tile_of, seam), IOU_WITHIN_PASS)
