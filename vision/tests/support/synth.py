"""Synthetic floor-plan and photo generators shared by the vision tests.

All coordinates are image pixels (x right, y down). Line widths are exact pixel widths and nothing is
anti-aliased, so tests can assert on measured widths and lengths.
"""

import itertools
import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

import cv2
import numpy as np

Color = tuple[int, int, int]
Pt = tuple[float, float]

BLACK: Color = (0, 0, 0)
WHITE: Color = (255, 255, 255)

CANVAS = (1600, 1300)  # width, height of the default photo canvas
CORNERS = np.array([(180, 150), (1450, 210), (1400, 1180), (140, 1100)], dtype=np.float32)

DIM_TICK_PX = 16  # length of a dimension tick
DIM_FONT_SCALE = 1.0
DIM_FONT_THICKNESS = 2
DIM_LABEL_GAP = 8  # px between the dimension line and the label baseline
_ARC_SEGMENTS = 48
_TEXT_PAD = 4


@dataclass
class SWall:
    """A wall along the centreline `a`->`b`.

    `filled` and `double` walls extend `thickness / 2` past both ends (square caps) so corners and
    T-junctions close. `double` draws two `line_px` lines whose centres are `thickness` apart, hollow in
    between. `single` draws one `line_px` line from `a` to `b` without extension.
    """

    a: tuple[int, int]
    b: tuple[int, int]
    thickness: int = 12
    style: Literal["filled", "double", "single"] = "filled"
    color: tuple[int, int, int] = (0, 0, 0)


@dataclass
class SDoor:
    """A door cut out of wall `wall` over `u0..u0+width` (px along a->b), drawn as leaf plus 90 degree arc.

    The leaf opens towards `side * n` with `n = (d.y, -d.x)` for the wall direction `d`. `double` hinges a
    leaf of `width / 2` at each jamb instead of one leaf at `hinge`.
    """

    wall: int
    u0: int
    width: int
    hinge: Literal["start", "end"] = "start"
    side: Literal[1, -1] = 1
    double: bool = False


@dataclass
class SWindow:
    """A window cut: `lines` parallel lines across the wall thickness; `offset_sashes` staggers them."""

    wall: int
    u0: int
    width: int
    lines: int = 2
    offset_sashes: bool = False


@dataclass
class SGap:
    """A bare passage cut into wall `wall` (no symbol)."""

    wall: int
    u0: int
    width: int


@dataclass
class SText:
    """Black Hershey text with its baseline start at `org`; `vertical` rotates it to read bottom-to-top."""

    text: str
    org: tuple[int, int]
    scale: float = 1.2
    thickness: int = 2
    vertical: bool = False


@dataclass
class SDimChain:
    """A dimension line along `axis` through `start`, with a tick at every position in `ticks`.

    `ticks` are absolute coordinates along the axis (x for `"x"`, y for `"y"`); the line sits at the other
    coordinate of `start` and spans the first to the last tick. `labels` are drawn centred between
    consecutive ticks (above the line for x, left of it and rotated for y), so there is one per interval
    (or none).
    """

    start: tuple[int, int]
    axis: Literal["x", "y"]
    ticks: list[int]
    labels: list[str]
    tick_style: Literal["slash", "bar"] = "slash"


def _unit(a: Pt, b: Pt) -> tuple[Pt, float]:
    length = math.hypot(b[0] - a[0], b[1] - a[1])
    if length == 0:
        return (1.0, 0.0), 0.0
    return ((b[0] - a[0]) / length, (b[1] - a[1]) / length), length


def _strip_mask(
    shape: tuple[int, int], a: Pt, b: Pt, width: float, ext: float = 0.0, *, round_caps: bool = False
) -> tuple[slice, slice, np.ndarray]:
    """Pixels within `width / 2` of the segment a-b (extended by `ext` at both ends).

    Pixel centres are shifted by half a pixel for even widths, so an axis-aligned strip is exactly
    `width` px wide. Returns the bounding slices and the boolean mask inside them.
    """
    h, w = shape
    (dx, dy), length = _unit(a, b)
    half = width / 2.0
    reach = half + ext + 2
    x0, x1 = int(max(0, math.floor(min(a[0], b[0]) - reach))), int(min(w, math.ceil(max(a[0], b[0]) + reach)))
    y0, y1 = int(max(0, math.floor(min(a[1], b[1]) - reach))), int(min(h, math.ceil(max(a[1], b[1]) + reach)))
    ys, xs = slice(y0, y1), slice(x0, x1)
    if x1 <= x0 or y1 <= y0:
        return ys, xs, np.zeros((0, 0), bool)
    shift = 0.5 if round(width) % 2 == 0 else 0.0
    gx, gy = np.meshgrid(np.arange(x0, x1) + shift - a[0], np.arange(y0, y1) + shift - a[1])
    along = gx * dx + gy * dy
    across = np.abs(-gx * dy + gy * dx)
    if round_caps:
        t = np.clip(along, 0.0, length)
        dist = np.hypot(gx - t * dx, gy - t * dy)
        return ys, xs, dist < half
    return ys, xs, (across < half) & (along >= -ext - 1e-9) & (along <= length + ext + 1e-9)


def _paint(img: np.ndarray, a: Pt, b: Pt, width: float, color: Color, ext: float = 0.0) -> None:
    ys, xs, mask = _strip_mask(img.shape[:2], a, b, width, ext, round_caps=ext == 0.0)
    img[ys, xs][mask] = color


def _arc_points(center: Pt, radius: float, start: Pt, end: Pt) -> list[Pt]:
    """Points of the shorter circular arc around `center` from `start` to `end` (both on the circle)."""
    a0 = math.atan2(start[1] - center[1], start[0] - center[0])
    a1 = math.atan2(end[1] - center[1], end[0] - center[0])
    delta = (a1 - a0 + math.pi) % (2 * math.pi) - math.pi
    return [
        (center[0] + radius * math.cos(a0 + delta * i / _ARC_SEGMENTS),
         center[1] + radius * math.sin(a0 + delta * i / _ARC_SEGMENTS))
        for i in range(_ARC_SEGMENTS + 1)
    ]  # fmt: skip


def _polyline(img: np.ndarray, pts: Sequence[Pt], width: float, color: Color) -> None:
    for p, q in itertools.pairwise(pts):
        _paint(img, p, q, width, color)


def _put_text(
    img: np.ndarray, text: str, org: tuple[int, int], scale: float, thickness: int, vertical: bool
) -> None:
    if not vertical:
        cv2.putText(img, text, org, cv2.FONT_HERSHEY_SIMPLEX, scale, BLACK, thickness, cv2.LINE_8)
        return
    (tw, th), base = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, scale, thickness)
    tile = np.zeros((th + base + 2 * _TEXT_PAD, tw + 2 * _TEXT_PAD), np.uint8)
    cv2.putText(
        tile, text, (_TEXT_PAD, _TEXT_PAD + th), cv2.FONT_HERSHEY_SIMPLEX, scale, 255, thickness, cv2.LINE_8
    )
    rot = cv2.rotate(tile, cv2.ROTATE_90_COUNTERCLOCKWISE)  # (x, y) -> (y, tile_w - 1 - x)
    # The text origin (_TEXT_PAD, _TEXT_PAD + th) lands on (_TEXT_PAD + th, tile_w - 1 - _TEXT_PAD).
    left, top = org[0] - (_TEXT_PAD + th), org[1] - (tile.shape[1] - 1 - _TEXT_PAD)
    h, w = img.shape[:2]
    x0, y0 = max(0, left), max(0, top)
    x1, y1 = min(w, left + rot.shape[1]), min(h, top + rot.shape[0])
    if x1 <= x0 or y1 <= y0:
        return
    patch = rot[y0 - top : y1 - top, x0 - left : x1 - left] > 0
    img[y0:y1, x0:x1][patch] = BLACK


def _wall_dir(wall: SWall) -> tuple[Pt, Pt, float]:
    a = (float(wall.a[0]), float(wall.a[1]))
    b = (float(wall.b[0]), float(wall.b[1]))
    d, length = _unit(a, b)
    return a, d, length


def _along(a: Pt, d: Pt, u: float, v: float = 0.0) -> Pt:
    """Point at `u` px along the wall and `v` px to the `n = (d.y, -d.x)` side of the centreline."""
    return (a[0] + d[0] * u + d[1] * v, a[1] + d[1] * u - d[0] * v)


def _cut_mask(
    shape: tuple[int, int], a: Pt, d: Pt, u0: float, width: float, thickness: float, line_px: float
) -> tuple[slice, slice, np.ndarray]:
    half = max(thickness, line_px) / 2 + line_px + 1
    p, q = _along(a, d, u0), _along(a, d, u0 + width)
    return _strip_mask(shape, p, q, 2 * half)


def _door_leaves(door: SDoor, a: Pt, d: Pt) -> list[tuple[Pt, Pt, Pt, float]]:
    """`(hinge, closed_point, open_point, radius)` per leaf, in px."""
    side = float(door.side)
    w = float(door.width)
    if door.double:
        r = w / 2
        h1, h2 = _along(a, d, door.u0), _along(a, d, door.u0 + w)
        return [
            (h1, _along(a, d, door.u0 + r), _along(a, d, door.u0, side * r), r),
            (h2, _along(a, d, door.u0 + r), _along(a, d, door.u0 + w, side * r), r),
        ]
    if door.hinge == "start":
        return [(_along(a, d, door.u0), _along(a, d, door.u0 + w), _along(a, d, door.u0, side * w), w)]
    return [(_along(a, d, door.u0 + w), _along(a, d, door.u0), _along(a, d, door.u0 + w, side * w), w)]


def _window_lines(win: SWindow, a: Pt, d: Pt, thickness: float) -> list[tuple[Pt, Pt]]:
    n = max(1, win.lines)
    offsets = [0.0] if n == 1 else [thickness / 2 - thickness * i / (n - 1) for i in range(n)]
    w = float(win.width)
    out: list[tuple[Pt, Pt]] = []
    for i, v in enumerate(offsets):
        u_from, u_to = win.u0, win.u0 + w
        if win.offset_sashes and n >= 2:
            # Sashes overlap by ~40 %: even lines cover the first 70 %, odd lines the last 70 %.
            if i % 2 == 0:
                u_to = win.u0 + 0.7 * w
            else:
                u_from = win.u0 + 0.3 * w
        out.append((_along(a, d, u_from, v), _along(a, d, u_to, v)))
    return out


def _draw_walls(
    img: np.ndarray,
    walls: Sequence[SWall],
    cuts: dict[int, list[tuple[int, int]]],
    line_px: int,
) -> None:
    shape = img.shape[:2]
    outer = np.zeros(shape, bool)
    inner = np.zeros(shape, bool)
    outer_color = np.zeros((*shape, 3), np.uint8)

    def apply_cuts(i: int, wall: SWall, mask_into: np.ndarray) -> None:
        a, d, _ = _wall_dir(wall)
        for u0, width in cuts.get(i, ()):
            ys, xs, cut = _cut_mask(shape, a, d, u0, width, wall.thickness, line_px)
            mask_into[ys, xs][cut] = False

    for i, wall in enumerate(walls):
        pa = (float(wall.a[0]), float(wall.a[1]))
        pb = (float(wall.b[0]), float(wall.b[1]))
        layer = np.zeros(shape, bool)
        if wall.style == "filled":
            ys, xs, m = _strip_mask(shape, pa, pb, wall.thickness, wall.thickness / 2)
            layer[ys, xs] = m
            apply_cuts(i, wall, layer)
            img[layer] = wall.color
        elif wall.style == "single":
            ys, xs, m = _strip_mask(shape, pa, pb, line_px)
            layer[ys, xs] = m
            apply_cuts(i, wall, layer)
            img[layer] = wall.color
        else:  # double: outline of the filled wall, hollow inside
            ys, xs, m = _strip_mask(shape, pa, pb, wall.thickness + line_px, wall.thickness / 2)
            layer[ys, xs] = m
            apply_cuts(i, wall, layer)
            outer |= layer
            outer_color[layer] = wall.color
            ys, xs, m = _strip_mask(shape, pa, pb, wall.thickness - line_px, wall.thickness / 2)
            inner[ys, xs] |= m
    lines = outer & ~inner
    img[lines] = outer_color[lines]


def _draw_dim_chain(img: np.ndarray, dim: SDimChain, line_px: int) -> None:
    if len(dim.ticks) < 2:
        return
    ticks = sorted(dim.ticks)
    x_axis = dim.axis == "x"
    fixed = float(dim.start[1] if x_axis else dim.start[0])

    def pt(t: float, off: float = 0.0) -> Pt:
        return (t, fixed + off) if x_axis else (fixed + off, t)

    _paint(img, pt(ticks[0]), pt(ticks[-1]), line_px, BLACK)
    half = DIM_TICK_PX / 2
    for t in ticks:
        if dim.tick_style == "slash":
            cx, cy = pt(t)
            r = half / math.sqrt(2)
            _paint(img, (cx - r, cy + r), (cx + r, cy - r), line_px, BLACK)  # 45 degrees, rising to the right
        else:
            _paint(img, pt(t, -half), pt(t, half), line_px, BLACK)
    for (t0, t1), label in zip(itertools.pairwise(ticks), dim.labels, strict=False):
        (tw, _), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, DIM_FONT_SCALE, DIM_FONT_THICKNESS)
        mid = (t0 + t1) / 2
        if x_axis:
            org = (round(mid - tw / 2), round(fixed - DIM_LABEL_GAP - line_px))
            _put_text(img, label, org, DIM_FONT_SCALE, DIM_FONT_THICKNESS, False)
        else:
            # Rotated text reads upwards: its baseline start is the bottom of the span, and its glyphs
            # rise to the left of the baseline, so the baseline sits `gap` left of the line.
            org = (round(fixed - DIM_LABEL_GAP - line_px), round(mid + tw / 2))
            _put_text(img, label, org, DIM_FONT_SCALE, DIM_FONT_THICKNESS, True)


def render_plan(
    size: tuple[int, int],
    walls: Sequence[SWall] = (),
    doors: Sequence[SDoor] = (),
    windows: Sequence[SWindow] = (),
    texts: Sequence[SText] = (),
    dims: Sequence[SDimChain] = (),
    fills: Sequence[tuple[list[tuple[int, int]], tuple[int, int, int]]] = (),
    background: tuple[int, int, int] = (255, 255, 255),
    line_px: int = 2,
    gaps: Sequence[SGap] = (),
) -> np.ndarray:
    """Render a synthetic plan as a BGR uint8 image of `size = (width, height)`.

    Order: fills, walls (door/window/gap cutouts erased), door arcs and leaves, window lines, dimension
    chains, text. Door and window symbols take the colour of their wall.
    """
    w, h = size
    img = np.empty((h, w, 3), np.uint8)
    img[:] = background
    for polygon, color in fills:
        cv2.fillPoly(img, [np.array(polygon, np.int32).reshape(-1, 1, 2)], color)

    cuts: dict[int, list[tuple[int, int]]] = {}
    for opening in (*doors, *windows, *gaps):
        cuts.setdefault(opening.wall, []).append((opening.u0, opening.width))
    _draw_walls(img, walls, cuts, line_px)

    for door in doors:
        wall = walls[door.wall]
        a, d, _ = _wall_dir(wall)
        for hinge, closed, opened, radius in _door_leaves(door, a, d):
            _polyline(img, _arc_points(hinge, radius, closed, opened), line_px, wall.color)
            _paint(img, hinge, opened, line_px, wall.color)
    for win in windows:
        wall = walls[win.wall]
        a, d, _ = _wall_dir(wall)
        for p, q in _window_lines(win, a, d, wall.thickness):
            _paint(img, p, q, line_px, wall.color)
    for dim in dims:
        _draw_dim_chain(img, dim, line_px)
    for text in texts:
        _put_text(img, text.text, text.org, text.scale, text.thickness, text.vertical)
    return img


def grid_drawing(w: int = 1200, h: int = 900) -> np.ndarray:
    """White page with a black 4 px grid of rectangles."""
    page = np.full((h, w, 3), 255, np.uint8)
    cv2.rectangle(page, (30, 30), (w - 31, h - 31), (0, 0, 0), 4)
    for x in range(30, w - 30, 235):
        cv2.line(page, (x, 30), (x, h - 31), (0, 0, 0), 4)
    for y in range(30, h - 30, 215):
        cv2.line(page, (30, y), (w - 31, y), (0, 0, 0), 4)
    return page


def warp_onto_canvas(
    img: np.ndarray,
    corners: np.ndarray,
    canvas_size: tuple[int, int],
    fill: tuple[int, int, int] | int = 128,
) -> np.ndarray:
    """Perspective-map `img` so its corners land on `corners` (TL, TR, BR, BL) of a `fill`-coloured canvas.

    `canvas_size` is `(width, height)`. This is a photographed sheet on a desk.
    """
    h, w = img.shape[:2]
    src = np.array([(0, 0), (w - 1, 0), (w - 1, h - 1), (0, h - 1)], dtype=np.float32)
    m = cv2.getPerspectiveTransform(src, np.asarray(corners, dtype=np.float32))
    border = (fill, fill, fill) if isinstance(fill, int) else fill
    warped: np.ndarray = cv2.warpPerspective(
        img, m, canvas_size, flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_CONSTANT, borderValue=border
    )
    return warped


def photo_of(
    page: np.ndarray,
    corners: np.ndarray = CORNERS,
    canvas: tuple[int, int] = CANVAS,
    grey: int = 128,
) -> np.ndarray:
    """`page` photographed at an angle onto a uniform grey desk."""
    return warp_onto_canvas(page, corners, canvas, grey)
