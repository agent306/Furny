"""Photo page detection, perspective rectification and illumination flattening (06 §7.3)."""

import math

import cv2
import numpy as np

from app.pipeline import decode
from app.utils.geometry import odd

_DETECT_LONG_EDGE = 1000
_MIN_QUAD_AREA_FRAC = 0.25
_CANNY_LOW_FACTOR, _CANNY_HIGH_FACTOR = 0.66, 1.33
_TOP_CONTOURS = 5
_APPROX_EPS_FRAC = 0.02
_AXIS_ALIGNED_TOL_FRAC = 0.015  # 06 §5.4: corner distance to the image corner, fraction of the diagonal
_CONTRAST_WORK_EDGE = 500
_ILLUMINATION_WORK_EDGE = 800  # the background is smooth, so the closing runs on a downscaled copy


def order_corners(pts: np.ndarray) -> np.ndarray | None:
    """Four points in any order -> TL, TR, BR, BL (float32).

    TL = min x+y, BR = max x+y, TR = min y-x, BL = max y-x; None when two roles pick one point.
    """
    s = pts.sum(axis=1)
    d = pts[:, 1] - pts[:, 0]
    idx = [int(np.argmin(s)), int(np.argmin(d)), int(np.argmax(s)), int(np.argmax(d))]
    if len(set(idx)) != 4:
        return None
    return pts[idx].astype(np.float32)


def detect_page_quad(img: np.ndarray) -> np.ndarray | None:
    """Find the sheet in a photo: a (4, 2) float32 array TL, TR, BR, BL in `img` pixels, or None."""
    h, w = img.shape[:2]
    f = min(1.0, _DETECT_LONG_EDGE / max(h, w))
    small = (
        img
        if f == 1.0
        else cv2.resize(img, (max(1, round(w * f)), max(1, round(h * f))), interpolation=cv2.INTER_AREA)
    )
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY) if small.ndim == 3 else small
    gray = cv2.GaussianBlur(gray, (5, 5), 0)
    v = float(np.median(gray))
    edges = cv2.Canny(gray, max(0.0, _CANNY_LOW_FACTOR * v), min(255.0, _CANNY_HIGH_FACTOR * v))
    edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=1)
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    min_area = _MIN_QUAD_AREA_FRAC * gray.shape[0] * gray.shape[1]
    for contour in sorted(contours, key=cv2.contourArea, reverse=True)[:_TOP_CONTOURS]:
        approx = cv2.approxPolyDP(contour, _APPROX_EPS_FRAC * cv2.arcLength(contour, True), True)
        if len(approx) == 4 and cv2.isContourConvex(approx) and cv2.contourArea(approx) >= min_area:
            ordered = order_corners(approx.reshape(4, 2).astype(np.float32))
            if ordered is not None:
                quad: np.ndarray = ordered / np.float32(f)
                return quad.astype(np.float32)
            return None
    return None


def quad_is_axis_aligned(quad: np.ndarray, shape: tuple[int, ...]) -> bool:
    """True when every corner lies within 1.5 % of the image diagonal of the matching image corner."""
    h, w = shape[:2]
    tol = _AXIS_ALIGNED_TOL_FRAC * math.hypot(w, h)
    frame = np.array([[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]], dtype=np.float64)
    dist = np.hypot(*(np.asarray(quad, dtype=np.float64).reshape(4, 2) - frame).T)
    return bool(np.all(dist <= tol))


def sheet_contrast(img: np.ndarray, quad: np.ndarray) -> float:
    """|median grey inside the quad - median grey outside it| (0 when the quad covers the whole frame).

    A sheet photographed on a desk differs from its surroundings; a building outline drawn on a white
    page does not, which is how an unhinted upload tells the two apart.
    """
    h, w = img.shape[:2]
    f = min(1.0, _CONTRAST_WORK_EDGE / max(h, w))
    small = (
        img
        if f == 1.0
        else cv2.resize(img, (max(1, round(w * f)), max(1, round(h * f))), interpolation=cv2.INTER_AREA)
    )
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY) if small.ndim == 3 else small
    inside = np.zeros(gray.shape[:2], np.uint8)
    cv2.fillConvexPoly(
        inside, np.round(np.asarray(quad, dtype=np.float64) * f).astype(np.int32).reshape(4, 2), 1
    )
    mask = inside.astype(bool)
    if mask.all() or not mask.any():
        return 0.0
    return abs(float(np.median(gray[mask])) - float(np.median(gray[~mask])))


def warp_quad_with_matrix(
    img: np.ndarray, quad: np.ndarray, max_pixels: int | None = None
) -> tuple[np.ndarray, np.ndarray]:
    """Warp the quad (TL, TR, BR, BL) to an upright rectangle; also return the 3x3 source -> output map.

    The output is shrunk uniformly if it would exceed `max_pixels` (default: the decode work budget).
    """
    q = np.asarray(quad, dtype=np.float32).reshape(4, 2)
    tl, tr, br, bl = q
    width = max(float(np.linalg.norm(tr - tl)), float(np.linalg.norm(br - bl)))
    height = max(float(np.linalg.norm(bl - tl)), float(np.linalg.norm(br - tr)))
    limit = decode.MAX_WORK_PIXELS if max_pixels is None else max_pixels
    if width * height > limit:
        shrink = math.sqrt(limit / (width * height))
        out_w, out_h = max(1, math.floor(width * shrink)), max(1, math.floor(height * shrink))
    else:
        out_w, out_h = max(1, math.floor(width + 0.5)), max(1, math.floor(height + 0.5))
    dst = np.array([[0, 0], [out_w - 1, 0], [out_w - 1, out_h - 1], [0, out_h - 1]], dtype=np.float32)
    m = cv2.getPerspectiveTransform(q, dst)
    warped: np.ndarray = cv2.warpPerspective(
        img, m, (out_w, out_h), flags=cv2.INTER_CUBIC, borderValue=(255, 255, 255)
    )
    return warped, np.asarray(m, dtype=np.float64)


def warp_quad(img: np.ndarray, quad: np.ndarray) -> np.ndarray:
    """Perspective-correct the quad (TL, TR, BR, BL) to an upright rectangle (06 §7.3)."""
    return warp_quad_with_matrix(img, quad)[0]


def flatten_illumination(gray: np.ndarray) -> np.ndarray:
    """Divide out the paper background (morphological closing, kernel odd(round(long_edge / 40)))."""
    h, w = gray.shape[:2]
    f = min(1.0, _ILLUMINATION_WORK_EDGE / max(h, w))
    small = (
        gray
        if f == 1.0
        else cv2.resize(gray, (max(1, round(w * f)), max(1, round(h * f))), interpolation=cv2.INTER_AREA)
    )
    k = odd(round(max(small.shape[:2]) / 40))
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
    bg = cv2.morphologyEx(small, cv2.MORPH_CLOSE, kernel)
    if f != 1.0:
        bg = cv2.resize(bg, (w, h), interpolation=cv2.INTER_LINEAR)
    flat: np.ndarray = cv2.divide(gray, bg, scale=255)
    return flat
