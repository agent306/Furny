"""Small 2-D geometry helpers and line-segment detection shared by the pipeline stages (06 §7.4, §7.9)."""

import math
from dataclasses import dataclass

import cv2
import numpy as np

Pt = tuple[float, float]

_HOUGH_THETA = math.pi / 360
_HOUGH_THRESHOLD = 50
_HOUGH_MIN_LENGTH_FRAC = 0.02
_HOUGH_MAX_GAP = 3
_CANNY_LOW, _CANNY_HIGH = 50, 150


@dataclass(frozen=True)
class Rect:
    """Integer pixel rectangle; `contains` is half-open: `x <= px < x + w`, `y <= py < y + h`."""

    x: int
    y: int
    w: int
    h: int

    @property
    def long_side(self) -> int:
        return max(self.w, self.h)

    def contains(self, pt: Pt) -> bool:
        return self.x <= pt[0] < self.x + self.w and self.y <= pt[1] < self.y + self.h

    def expand(self, px: int) -> "Rect":
        """Grow by `px` on every side (shrinks for negative `px`, never below zero size)."""
        return Rect(self.x - px, self.y - px, max(0, self.w + 2 * px), max(0, self.h + 2 * px))

    def clip(self, w: int, h: int) -> "Rect":
        """Intersect with the image frame `[0, w) x [0, h)`."""
        x0, y0 = max(0, self.x), max(0, self.y)
        x1, y1 = min(w, self.x + self.w), min(h, self.y + self.h)
        return Rect(x0, y0, max(0, x1 - x0), max(0, y1 - y0))


def odd(n: int) -> int:
    """Smallest odd integer >= max(n, 1) (kernel sizes)."""
    n = max(int(n), 1)
    return n if n % 2 == 1 else n + 1


def seg_angle_deg(x0: float, y0: float, x1: float, y1: float) -> float:
    """Undirected segment angle in [0, 180); image axes (y down), so clockwise on screen is positive."""
    angle = math.degrees(math.atan2(y1 - y0, x1 - x0)) % 180.0
    # `-0.0 % 180.0` and rounding can land exactly on 180.0.
    return 0.0 if angle >= 180.0 else angle


def project_param(p: Pt, a: Pt, b: Pt) -> float:
    """Unclamped parameter `t` of the projection of `p` on line `a + t (b - a)` (0 for a point segment)."""
    dx, dy = b[0] - a[0], b[1] - a[1]
    len2 = dx * dx + dy * dy
    if len2 == 0.0:
        return 0.0
    return ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2


def point_seg_distance(p: Pt, a: Pt, b: Pt) -> float:
    """Distance from `p` to the closed segment `a`-`b`."""
    t = min(1.0, max(0.0, project_param(p, a, b)))
    return math.hypot(p[0] - (a[0] + t * (b[0] - a[0])), p[1] - (a[1] + t * (b[1] - a[1])))


def _as_gray_u8(gray: np.ndarray) -> np.ndarray:
    if gray.ndim == 3:
        gray = cv2.cvtColor(gray, cv2.COLOR_BGR2GRAY)
    if gray.dtype != np.uint8:
        gray = np.clip(gray, 0, 255).astype(np.uint8)
    return np.ascontiguousarray(gray)


def _hough_segments(gray: np.ndarray) -> np.ndarray:
    long_side = max(gray.shape[:2])
    edges = cv2.Canny(gray, _CANNY_LOW, _CANNY_HIGH)
    lines = cv2.HoughLinesP(
        edges,
        rho=1,
        theta=_HOUGH_THETA,
        threshold=_HOUGH_THRESHOLD,
        minLineLength=_HOUGH_MIN_LENGTH_FRAC * long_side,
        maxLineGap=_HOUGH_MAX_GAP,
    )
    if lines is None:
        return np.zeros((0, 4), dtype=np.float32)
    return np.asarray(lines, dtype=np.float32).reshape(-1, 4)


def detect_line_segments(gray: np.ndarray) -> np.ndarray:
    """Line segments of a grey image as an `(N, 4)` float32 array of `x0 y0 x1 y1`.

    LSD (standard refinement); Hough on Canny edges when this OpenCV build's LSD raises (06 §7.9).
    """
    gray = _as_gray_u8(gray)
    try:
        lsd = cv2.createLineSegmentDetector(cv2.LSD_REFINE_STD)
        lines: np.ndarray | None = lsd.detect(gray)[0]  # None when nothing is found
    except (cv2.error, AttributeError, NotImplementedError):
        return _hough_segments(gray)
    if lines is None:
        return np.zeros((0, 4), dtype=np.float32)
    return np.asarray(lines, dtype=np.float32).reshape(-1, 4)
