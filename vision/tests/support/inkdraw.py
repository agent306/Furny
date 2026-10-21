"""Exact-width ink strokes for tests that need pixel-precise geometry (no anti-aliasing)."""

import math

import numpy as np


def stroke(ink: np.ndarray, p0: tuple[float, float], p1: tuple[float, float], width: float) -> None:
    """Set the pixels whose centre lies within `width / 2` of the segment `p0` - `p1`."""
    h, w = ink.shape
    x0, x1 = int(min(p0[0], p1[0]) - width - 2), int(max(p0[0], p1[0]) + width + 3)
    y0, y1 = int(min(p0[1], p1[1]) - width - 2), int(max(p0[1], p1[1]) + width + 3)
    x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, w), min(y1, h)
    yy, xx = np.mgrid[y0:y1, x0:x1].astype(np.float64)
    dx, dy = p1[0] - p0[0], p1[1] - p0[1]
    len2 = dx * dx + dy * dy
    t = np.clip(((xx - p0[0]) * dx + (yy - p0[1]) * dy) / len2, 0, 1) if len2 > 0 else np.zeros_like(xx)
    dist = np.hypot(xx - (p0[0] + t * dx), yy - (p0[1] + t * dy))
    ink[y0:y1, x0:x1][dist <= width / 2] = 255


def polar(
    centre: tuple[float, float], angle_deg: float, length: float
) -> tuple[tuple[float, float], tuple[float, float]]:
    """Endpoints of a segment of `length` through `centre`, `angle_deg` counter-clockwise on screen."""
    a = math.radians(angle_deg)
    dx, dy = math.cos(a) * length / 2, math.sin(a) * length / 2
    return (centre[0] - dx, centre[1] + dy), (centre[0] + dx, centre[1] - dy)
