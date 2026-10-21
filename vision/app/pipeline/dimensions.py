"""Dimension lines, dimension spans and heuristic text association (06 §8.4 steps 1-5, §8.1 step 2).

A dimension line is a thin segment with at least two ticks and a numeric label beside it. Ticks come from
three sources: short slanted or perpendicular strokes crossing the line, perpendicular extension lines
touching it, and (raster pages) the strokes and blobs found in the ink around the line. LSD drops strokes
shorter than its minimum length, and the spec's tick length range (0.005 L ... 0.03 L) reaches below that
limit (`max(8 px, 0.008 L)`), so on raster pages the interior ticks are usually only visible in the ink.
"""

import itertools
import math
from collections.abc import Callable, Sequence

import cv2
import numpy as np

from app.schemas.candidates import DimensionLine, DimensionSpan, Segment, TextToken
from app.utils.geometry import Pt, Rect, seg_angle_deg

__all__ = ["associate_dimension_texts", "find_dimension_lines", "find_dimension_spans"]

NUMERIC_KINDS = frozenset({"mm_number", "metric_length", "feet_inch"})
MIN_LINE_FRAC = 0.04  # a dimension line is at least this long (fraction of the plan region's long side L)
TICK_MIN_FRAC = 0.005  # tick length range ...
TICK_MAX_FRAC = 0.03  # ... as fractions of L
BLOB_AREA_FRAC = 0.006  # a dot/arrowhead blob has area <= (0.006 L)^2
TICK_MIDDLE = 0.8  # the line must cross the tick within its middle 80 %
PERP_TOL_DEG = 10.0  # perpendicular ticks: 90 +- 10 degrees
DIAG_TOL_DEG = 15.0  # slash ticks: 45 +- 15 degrees
EXTENSION_TOUCH_PX = 2.0  # an extension line ends within this distance of the line (+ half its width + 1 px)
EXTENSION_OVERSHOOT_PX = 14.0  # ... or crosses it and ends at most this far beyond (LSD adds ~3 px to ends)
TEXT_REACH = 2.5  # a label lies within this many text heights of the line
AXIS_TOL_DEG = 10.0  # x / y axis and text-orientation tolerance
END_SLACK_PX = 6.0  # ticks may sit this far beyond the ends of the (LSD-extended) segment
TICK_DEDUPE_PX = 4.0  # ticks closer than this along the line are one tick

# Ink bands (raster pages).
BAND_MARGIN_PX = 6  # band half-height is ceil(0.015 L) + this
THICK_FACTOR = 2.5  # a stroke wider than 2.5 line widths + 2 px is a wall, not a tick
THICK_MARGIN_PX = 2.0
ELONGATION = 3.0  # a stroke's long axis is at least 3x the short one (rms): a clear direction
BLOB_LEN_FRAC = 0.012  # a blob is at most this long along the line (fraction of L)
BLOB_EXCESS_PX = 3  # a blob is at least this much thicker than the line
NEAR_ROW_FRAC = 0.5  # a band row is "the line" when this share of it is a long horizontal run


def _unit(p0: Pt, p1: Pt) -> tuple[float, float, float]:
    length = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
    return (p1[0] - p0[0]) / length, (p1[1] - p0[1]) / length, length


def _numeric(tokens: Sequence[TextToken]) -> list[TextToken]:
    return [t for t in tokens if t.parsed.kind in NUMERIC_KINDS]


def _centre(token: TextToken) -> Pt:
    return (token.box[0] + token.box[2]) / 2, (token.box[1] + token.box[3]) / 2


def _along_and_across(p0: Pt, p1: Pt, point: Pt) -> tuple[float, float]:
    """Distance of `point` along the line `p0` -> `p1` (from `p0`) and signed distance across it."""
    ux, uy, _ = _unit(p0, p1)
    rx, ry = point[0] - p0[0], point[1] - p0[1]
    return rx * ux + ry * uy, -rx * uy + ry * ux


class _Labels:
    """Numeric tokens as arrays: centre x / y and the reach (2.5 text heights)."""

    def __init__(self, tokens: Sequence[TextToken]) -> None:
        centres = np.array([_centre(t) for t in tokens], np.float64).reshape(-1, 2)
        self.x, self.y = centres[:, 0], centres[:, 1]
        self.reach = TEXT_REACH * np.array([t.height_px for t in tokens], np.float64)

    def __len__(self) -> int:
        return len(self.x)

    def beside(self, line: Segment) -> bool:
        """Whether a label centre projects onto `line` and lies within its reach across it."""
        ux, uy, length = _unit(line.p0, line.p1)
        rx, ry = self.x - line.p0[0], self.y - line.p0[1]
        along, across = rx * ux + ry * uy, -rx * uy + ry * ux
        return bool(np.any((along >= 0.0) & (along <= length) & (np.abs(across) <= self.reach)))


# --- ticks from segments ------------------------------------------------------------------------------


def _segment_ticks(
    line: Segment, index: int, p0: np.ndarray, p1: np.ndarray, lo: float, hi: float
) -> list[float]:
    """Tick positions (px from `line.p0`) of the thin segments (`p0`, `p1`: (n, 2) endpoints) at `line`.

    Counted are strokes of 0.005 L ... 0.03 L crossing the line in their middle 80 % at 90 +- 10 or
    45 +- 15 degrees, and perpendicular extension lines: ending within `2 px + half the line width + 1 px`
    of the line, or crossing it and ending at most 14 px beyond (LSD lengthens line ends by ~3 px).
    """
    ux, uy, length = _unit(line.p0, line.p1)
    origin = np.array(line.p0, np.float64)
    q0, q1 = p0 - origin, p1 - origin
    s0, h0 = q0[:, 0] * ux + q0[:, 1] * uy, -q0[:, 0] * uy + q0[:, 1] * ux
    s1, h1 = q1[:, 0] * ux + q1[:, 1] * uy, -q1[:, 0] * uy + q1[:, 1] * ux
    tick_len = np.hypot(s1 - s0, h1 - h0)
    others = np.arange(len(p0)) != index
    safe_len = np.where(tick_len > 0, tick_len, 1.0)
    angle = np.degrees(np.arccos(np.clip(np.abs(s1 - s0) / safe_len, 0.0, 1.0)))  # to the line, 0..90
    perpendicular = others & (angle >= 90.0 - PERP_TOL_DEG) & (tick_len > 0)
    slanted = np.abs(angle - 45.0) <= DIAG_TOL_DEG

    sides = h0 * h1 < 0
    u = np.where(sides, h0 / np.where(h0 != h1, h0 - h1, 1.0), 0.5)
    where = s0 + u * (s1 - s0)
    margin = (1.0 - TICK_MIDDLE) / 2
    in_reach = (where >= -END_SLACK_PX) & (where <= length + END_SLACK_PX)
    crossing = others & sides & (tick_len >= lo) & (tick_len <= hi) & (perpendicular | slanted)
    crossing &= (u >= margin) & (u <= 1.0 - margin) & in_reach
    positions = list(np.clip(where[crossing], 0.0, length))

    touch = EXTENSION_TOUCH_PX + line.width_px / 2 + 1.0
    for s_end, h_end in ((s0, h0), (s1, h1)):  # an end of a perpendicular stroke touches the line
        off = s_end - np.clip(s_end, 0.0, length)
        touching = perpendicular & (np.hypot(h_end, off) <= touch)
        positions += list(np.clip(s_end[touching], 0.0, length))
    overshoot = (
        perpendicular & sides & in_reach & (np.minimum(np.abs(h0), np.abs(h1)) <= EXTENSION_OVERSHOOT_PX)
    )
    positions += list(np.clip(where[overshoot], 0.0, length))
    return [float(p) for p in positions]


# --- ticks from the ink mask --------------------------------------------------------------------------


def _band(ink: np.ndarray, line: Segment, radius: int) -> np.ndarray:
    """The ink resampled into line coordinates: column `i` is `u = i - END_SLACK_PX` along the line from
    `line.p0`, row `j` is `v = j - radius` along the normal. Nearest-neighbour, one pixel per unit."""
    ux, uy, length = _unit(line.p0, line.p1)
    slack = int(END_SLACK_PX)
    matrix = np.array(
        [
            [ux, -uy, line.p0[0] - slack * ux + radius * uy],
            [uy, ux, line.p0[1] - slack * uy - radius * ux],
        ],
        np.float64,
    )
    size = (math.ceil(length) + 2 * slack + 1, 2 * radius + 1)
    flags = cv2.INTER_NEAREST | cv2.WARP_INVERSE_MAP
    return cv2.warpAffine(ink, matrix, size, flags=flags, borderMode=cv2.BORDER_CONSTANT, borderValue=0)


class _Stroke:
    """Moments and extent of one stroke (components touching the line, merged across it)."""

    def __init__(self) -> None:
        self.n = 0.0
        self.su = self.sv = self.suu = self.suv = self.svv = 0.0
        self.top = 10**9  # smallest / largest band row
        self.bottom = -1
        self.members: list[int] = []

    def add(self, label: int, m: np.ndarray, top: int, bottom: int) -> None:
        self.members.append(label)
        self.n += m[0]
        self.su, self.sv, self.suu, self.suv, self.svv = (
            self.su + m[1],
            self.sv + m[2],
            self.suu + m[3],
            self.suv + m[4],
            self.svv + m[5],
        )
        self.top, self.bottom = min(self.top, top), max(self.bottom, bottom)


def _axis_of(stroke: _Stroke, pixels: np.ndarray) -> tuple[float, float, float, float, float] | None:
    """(du, dv, centre u, centre v, elongation) of the principal axis; None when it is unreliable.

    Strokes of fewer than 6 pixels use the farthest pair of pixels instead of the covariance.
    """
    n = stroke.n
    mu, mv = stroke.su / n, stroke.sv / n
    if n < 6:
        d = pixels[:, None, :] - pixels[None, :, :]
        i, j = np.unravel_index(np.argmax((d**2).sum(axis=2)), (len(pixels), len(pixels)))
        vec = pixels[j] - pixels[i]
        norm = float(np.hypot(*vec))
        return (vec[0] / norm, vec[1] / norm, mu, mv, 99.0) if norm > 0 else None
    cov = np.array(
        [
            [stroke.suu / n - mu * mu, stroke.suv / n - mu * mv],
            [stroke.suv / n - mu * mv, stroke.svv / n - mv * mv],
        ]
    )
    values, vectors = np.linalg.eigh(cov)
    if values[1] <= 1e-9:
        return None
    elongation = math.sqrt(values[1] / max(values[0], 1e-9))
    return float(vectors[0, 1]), float(vectors[1, 1]), mu, mv, elongation


def _ink_ticks(
    line: Segment, ink: np.ndarray, long_side: float, check_deadline: Callable[[], None] | None
) -> list[float]:
    """Tick positions (px from `line.p0`) found in the ink around `line` (raster pages).

    The ink is resampled into line coordinates (a band of +-(0.015 L + 6 px)); every long horizontal run
    (the line itself, parallel dimension lines, wall edges: >= 0.03 L) is cleared with a pixel of margin,
    and the rest is split into 8-connected components. Components that touch the cleared line rows are
    strokes; the two halves of a stroke crossing the line are merged. Per stroke:
    - wider than 2.5 line widths + 2 px (area / length): a wall, no tick;
    - angle 90 +- 10 degrees to the line: a tick of any length (bar ticks, extension lines ending at or
      crossing the line, extension lines running through an inner chain of a stacked dimension string);
    - angle 45 +- 15 or 135 +- 15 degrees, not reaching the band edge on either side and
      0.005 L ... 0.03 L long: a slash tick, of any width;
    - anything else (longer diagonals, other angles, blobs with no clear direction): no stroke tick.
    The tick sits where the stroke's fitted axis meets the line. Strokes that are no ticks (and do not run
    out of the band) are searched for blobs: the ink beside the cleared rows, per column; runs where it is
    at least `width + 3` px thick with an area of at most (0.006 L)^2 and a length of at most 0.012 L are
    dots / arrowheads. A run is placed at its centre; an arrowhead (clearly wider at one end) at its tip,
    extrapolated from the thickness profile.
    """
    length = _unit(line.p0, line.p1)[2]
    width = max(1.0, line.width_px)
    hi = TICK_MAX_FRAC * long_side
    lo = TICK_MIN_FRAC * long_side
    radius = math.ceil(hi / 2) + BAND_MARGIN_PX
    slack = int(END_SLACK_PX)
    inked = _band(ink, line, radius) > 0
    cols = inked.shape[1]
    run = min(math.ceil(hi) + 1, cols) | 1  # odd: OpenCV's even-sized kernels are off by one at run ends
    cleared = np.zeros_like(inked)
    long_rows = np.flatnonzero(inked.sum(axis=1) >= run)  # only these rows can hold a run that long
    if long_rows.size:
        opened = cv2.morphologyEx(
            inked[long_rows].astype(np.uint8), cv2.MORPH_OPEN, np.ones((1, run), np.uint8)
        )
        cleared[long_rows] = opened > 0
        cleared[1:] |= cleared[:-1].copy()  # a pixel of margin above and below
        cleared[:-1] |= cleared[1:].copy()
    # The line's own rows: the cleared rows around v = 0.
    row_share = cleared.mean(axis=1)
    near = [
        j
        for j in range(max(0, radius - int(width / 2) - 3), min(2 * radius, radius + int(width / 2) + 3) + 1)
        if row_share[j] >= NEAR_ROW_FRAC
    ]
    if near:
        line_top = line_bottom = min(near, key=lambda j: abs(j - radius))
        while line_top > 0 and row_share[line_top - 1] >= NEAR_ROW_FRAC:
            line_top -= 1
        while line_bottom < 2 * radius and row_share[line_bottom + 1] >= NEAR_ROW_FRAC:
            line_bottom += 1
    else:
        line_top = line_bottom = radius
    rest = inked & ~cleared
    count, labels, stats, _ = cv2.connectedComponentsWithStats(rest.astype(np.uint8), connectivity=8)
    top, height, area = stats[:, cv2.CC_STAT_TOP], stats[:, cv2.CC_STAT_HEIGHT], stats[:, cv2.CC_STAT_AREA]
    bottom = top + height - 1
    centre_row = top + height / 2.0
    min_area = max(3.0, width)
    touching_up = (centre_row < line_top) & (bottom >= line_top - 1) & (area >= min_area)  # smaller rows = -v
    touching_down = (centre_row > line_bottom) & (top <= line_bottom + 1) & (area >= min_area)
    touching_up[0] = touching_down[0] = False
    touching = touching_up | touching_down
    ys, xs = np.nonzero(rest)
    lab = labels[ys, xs]
    keep = touching[lab]
    ys, xs, lab = ys[keep], xs[keep], lab[keep]
    u = xs.astype(np.float64) - slack
    v = ys.astype(np.float64) - radius
    moments = np.stack(
        [
            np.bincount(lab, weights=w_, minlength=count)
            for w_ in (np.ones_like(u), u, v, u * u, u * v, v * v)
        ],
        axis=1,
    )
    # u of the pixels nearest the line, per component, to pair the two halves of a crossing stroke.
    nearest_row = np.where(touching_up, bottom, top)
    at_edge = ys == nearest_row[lab]
    edge_u = np.bincount(lab[at_edge], weights=u[at_edge], minlength=count) / np.maximum(
        np.bincount(lab[at_edge], minlength=count), 1
    )
    zone = line_bottom - line_top + 1
    strokes: list[_Stroke] = []
    ups = [int(c) for c in np.flatnonzero(touching_up)]
    downs = [int(c) for c in np.flatnonzero(touching_down)]
    paired: set[int] = set()
    for c in ups:
        stroke = _Stroke()
        stroke.add(c, moments[c], int(top[c]), int(bottom[c]))
        partner = [d for d in downs if d not in paired and abs(edge_u[d] - edge_u[c]) <= zone + 2]
        if partner:
            d = min(partner, key=lambda d_: abs(edge_u[d_] - edge_u[c]))
            paired.add(d)
            stroke.add(d, moments[d], int(top[d]), int(bottom[d]))
        strokes.append(stroke)
    for d in downs:
        if d not in paired:
            stroke = _Stroke()
            stroke.add(d, moments[d], int(top[d]), int(bottom[d]))
            strokes.append(stroke)

    blob_max_area = (BLOB_AREA_FRAC * long_side) ** 2
    blob_max_len = BLOB_LEN_FRAC * long_side
    ticks: list[float] = []
    thick_limit = THICK_FACTOR * width + THICK_MARGIN_PX
    skips: list[tuple[float, float]] = []  # u ranges of ticks and of strokes too long to be blobs
    for stroke in strokes:
        if check_deadline is not None:
            check_deadline()
        pixels = np.empty((0, 2))
        if stroke.n < 6:
            member = np.isin(lab, stroke.members)
            pixels = np.stack([u[member], v[member]], axis=1)
        at_band_edge = stroke.top <= 1 or stroke.bottom >= 2 * radius - 1
        lefts = stats[stroke.members, cv2.CC_STAT_LEFT]
        rights = lefts + stats[stroke.members, cv2.CC_STAT_WIDTH]
        axis = _axis_of(stroke, pixels)
        # Where the stroke crosses the cleared rows it leaves no component: widen its range by that run.
        run_in_zone = 1.0
        if axis is not None and abs(axis[1]) > 1e-3:
            run_in_zone = min((zone + 2) * abs(axis[0]) / abs(axis[1]), 4.0 * blob_max_len) + 1.0
        span = (float(lefts.min()) - run_in_zone, float(rights.max()) + run_in_zone)
        if at_band_edge or rights.max() - lefts.min() > blob_max_len:  # long: never a blob
            skips.append(span)
        if axis is None:
            continue
        du, dv, mu, mv, elongation = axis
        if elongation < ELONGATION or abs(dv) < 1e-6:
            continue
        extent = (stroke.bottom - stroke.top + 1) / abs(dv)  # along the axis, across the cleared rows too
        if stroke.n / max(extent, 1.0) > thick_limit:
            continue
        angle = math.degrees(math.atan2(abs(dv), abs(du)))  # to the line, 0..90
        if angle >= 90.0 - PERP_TOL_DEG:
            tick = True
        elif abs(angle - 45.0) <= DIAG_TOL_DEG:
            tick = (not at_band_edge) and lo <= extent <= hi
        else:
            tick = False
        if tick:
            ticks.append(mu - mv * du / dv)
            skips.append(span)

    # Blobs: the thickness of the ink through the line, per column, away from the strokes found above.
    line_width = max(width, float(zone - 2))  # the line's own ink (the cleared rows have a pixel of margin)
    mid = (line_top + line_bottom) // 2
    pad = np.zeros((1, cols), bool)
    up = np.argmin(np.vstack([inked[mid::-1], pad]), axis=0)  # inked rows from the line's middle upwards ...
    down = np.argmin(np.vstack([inked[mid:], pad]), axis=0)  # ... and downwards
    through = up + down - 1
    thickness = np.where(inked[mid], through, 0).astype(np.float64)
    skip = np.zeros(cols, bool)
    for first, last in skips:
        skip[max(0, math.floor(first)) : max(0, math.ceil(last)) + 1] = True
    columns = np.flatnonzero((thickness >= line_width + BLOB_EXCESS_PX) & ~skip)
    for group in np.split(columns, np.flatnonzero(np.diff(columns) > 2) + 1) if columns.size else []:
        if group.size <= blob_max_len and (thickness[group] - line_width).sum() <= blob_max_area:
            ticks.append(_blob_position(group, thickness[group]) - slack)
    return [t for t in ticks if -END_SLACK_PX <= t <= length + END_SLACK_PX]


def _blob_position(columns: np.ndarray, thickness: np.ndarray) -> float:
    """Column of a blob: the centre of the run; for an arrowhead (clearly thicker at one end than at the
    other) the tip, extrapolated from the thickness profile to where it would vanish."""
    first, last = float(columns[0]), float(columns[-1])
    edge = max(1, len(columns) // 4)
    start, end = float(thickness[:edge].mean()), float(thickness[-edge:].mean())
    if abs(end - start) >= 2.0 and last > first:
        slope = abs(end - start) / (last - first)
        reach = min(min(start, end) / slope, 12.0)
        return first - reach if end > start else last + reach
    return (first + last) / 2.0


def _cluster(positions: np.ndarray, gap: float) -> list[float]:
    """Means of the groups of sorted `positions` whose neighbours are at most `gap` apart."""
    if positions.size == 0:
        return []
    ordered = np.sort(positions)
    return [float(g.mean()) for g in np.split(ordered, np.flatnonzero(np.diff(ordered) > gap) + 1)]


# --- dimension lines ----------------------------------------------------------------------------------


def _dedupe_ticks(positions: Sequence[float], width: float) -> list[float]:
    """Ticks closer than `max(4, 2 line widths)` px along the line are one tick."""
    return _cluster(np.array(sorted(positions)), max(TICK_DEDUPE_PX, 2.0 * width))


def _collinear_overlap(a: DimensionLine, b: DimensionLine) -> bool:
    """Whether the lines lie on the same stroke: parallel within 2 degrees, <= 3 px apart, overlapping."""
    ang_a = seg_angle_deg(*a.p0, *a.p1)
    ang_b = seg_angle_deg(*b.p0, *b.p1)
    diff = abs(ang_a - ang_b)
    if min(diff, 180.0 - diff) > 2.0:
        return False
    _, across = _along_and_across(a.p0, a.p1, ((b.p0[0] + b.p1[0]) / 2, (b.p0[1] + b.p1[1]) / 2))
    if abs(across) > 3.0:
        return False
    len_a, len_b = math.dist(a.p0, a.p1), math.dist(b.p0, b.p1)
    s0, _ = _along_and_across(a.p0, a.p1, b.p0)
    s1, _ = _along_and_across(a.p0, a.p1, b.p1)
    overlap = min(max(s0, s1), len_a) - max(min(s0, s1), 0.0)
    return overlap >= 0.5 * min(len_a, len_b)


def find_dimension_lines(
    segments: Sequence[Segment],
    tokens: Sequence[TextToken],
    region: Rect,
    *,
    ink: np.ndarray | None = None,
    check_deadline: Callable[[], None] | None = None,
) -> list[DimensionLine]:
    """Dimension lines among the thin segments (06 §8.4 step 1). Runs before wall extraction.

    A candidate is a thin segment of length >= 0.04 L (`L` = long side of `region`) with a numeric token
    (`mm_number`, `metric_length`, `feet_inch`) alongside it within 2.5 text heights, and with >= 2 ticks.
    Ticks come from other thin segments (slash / perpendicular strokes crossing the line in their middle
    80 %, 0.005 L ... 0.03 L long; perpendicular extension lines touching it or crossing it by a few px).
    On raster pages pass the page's `ink` mask as well: ticks are then also found in the ink around the
    line (see `_ink_ticks`; LSD drops strokes shorter than its minimum length, which includes many
    interior ticks), together with dot / arrowhead blobs. Pass a text-free mask (`OcrResult.ink_notext`,
    not `Preprocessed.ink`) so that glyphs touching the line cannot read as ticks. Ticks closer than
    `max(4, 2 line widths)` px are one tick. Collinear duplicates of one line are dropped. Ids `L1..Ln`
    follow the (min y, min x, max y, max x) order of the lines. `check_deadline` is called for every
    candidate.
    """
    long_side = float(region.long_side)
    numeric = _numeric(tokens)
    if not numeric or long_side <= 0:
        return []
    labels = _Labels(numeric)
    lo, hi = TICK_MIN_FRAC * long_side, TICK_MAX_FRAC * long_side
    thin = [s for s in segments if s.is_thin and s.length > 0]
    p0 = np.array([s.p0 for s in thin], np.float64).reshape(-1, 2)
    p1 = np.array([s.p1 for s in thin], np.float64).reshape(-1, 2)
    found: list[tuple[Segment, list[float]]] = []
    for index, cand in enumerate(thin):
        if check_deadline is not None:
            check_deadline()
        if cand.length < MIN_LINE_FRAC * long_side or not labels.beside(cand):
            continue
        ticks = _segment_ticks(cand, index, p0, p1, lo, hi)
        if ink is not None:
            ticks += _ink_ticks(cand, ink, long_side, check_deadline)
        ticks = _dedupe_ticks(ticks, max(1.0, cand.width_px))
        if len(ticks) >= 2:
            found.append((cand, ticks))

    found.sort(key=lambda f: (-len(f[1]), -f[0].length))  # the best-supported stroke of a duplicate wins
    kept: list[DimensionLine] = []
    for cand, ticks in found:
        line = DimensionLine("", cand.p0, cand.p1, ticks, cand.id)
        if not any(_collinear_overlap(k, line) for k in kept):
            kept.append(line)
    kept.sort(
        key=lambda ln: (
            min(ln.p0[1], ln.p1[1]),
            min(ln.p0[0], ln.p1[0]),
            max(ln.p0[1], ln.p1[1]),
            max(ln.p0[0], ln.p1[0]),
        )
    )
    return [
        DimensionLine(f"L{n}", ln.p0, ln.p1, ln.tick_positions, ln.segment_id) for n, ln in enumerate(kept, 1)
    ]


# --- spans --------------------------------------------------------------------------------------------


def _axis(line: DimensionLine) -> str:
    angle = seg_angle_deg(*line.p0, *line.p1)
    if min(angle, 180.0 - angle) <= AXIS_TOL_DEG:
        return "x"
    if abs(angle - 90.0) <= AXIS_TOL_DEG:
        return "y"
    return "other"


def find_dimension_spans(
    lines: Sequence[DimensionLine], tokens: Sequence[TextToken], region: Rect
) -> list[DimensionSpan]:
    """Spans of each dimension line (06 §8.4 steps 2-4).

    Consecutive ticks give `chain_segment` spans; first-to-last gives an `overall` span when there are >= 3
    ticks, and with exactly 2 ticks the single span is the `overall` one. `near_text_ids` holds the
    numeric tokens whose centre projects between the span's ticks, within 2.5 text heights of the line,
    with matching orientation (angle 0 on x lines, 90 on y lines; none on other lines), ordered along the
    line. Ids `D1..Dn` run over the lines in the given order (geometric, as `find_dimension_lines` returns
    them): chain spans left to right, then the overall span.
    `region` is part of the stage interface (06 §8.4) and is not needed here: all rules are in pixels and
    text heights.
    """
    del region
    numeric = _numeric(tokens)
    spans: list[DimensionSpan] = []
    for line in lines:
        ux, uy, _ = _unit(line.p0, line.p1)
        axis = _axis(line)
        wanted = {"x": 0, "y": 90}.get(axis)
        placed: list[tuple[float, float, TextToken]] = []  # (along, across, token)
        for token in numeric:
            if token.angle != wanted:
                continue
            along, across = _along_and_across(line.p0, line.p1, _centre(token))
            if abs(across) <= TEXT_REACH * token.height_px:
                placed.append((along, across, token))
        ticks = sorted(line.tick_positions)
        ranges = [(a, b, "chain_segment") for a, b in itertools.pairwise(ticks)]
        if len(ticks) == 2:
            ranges = [(ticks[0], ticks[1], "overall")]
        elif len(ticks) > 2:
            ranges.append((ticks[0], ticks[-1], "overall"))
        for a, b, kind in ranges:
            near = sorted((along, t.id) for along, _, t in placed if a <= along <= b)
            spans.append(
                DimensionSpan(
                    id=f"D{len(spans) + 1}",
                    p0=(line.p0[0] + a * ux, line.p0[1] + a * uy),
                    p1=(line.p0[0] + b * ux, line.p0[1] + b * uy),
                    axis=axis,  # type: ignore[arg-type]
                    kind=kind,  # type: ignore[arg-type]
                    near_text_ids=[tid for _, tid in near],
                    line_id=line.id,
                )
            )
    return spans


def associate_dimension_texts(spans: Sequence[DimensionSpan], tokens: Sequence[TextToken]) -> dict[str, str]:
    """Heuristic text -> span association (06 §8.4 step 5), text id -> span id.

    Each numeric token is assigned to the span listing it whose midpoint is nearest to the token centre's
    projection on the span; ties go to the shorter span. Tokens no span lists are left out.
    """
    by_id = {t.id: t for t in _numeric(tokens)}
    best: dict[str, tuple[float, float, int]] = {}
    for order, span in enumerate(spans):
        length = math.dist(span.p0, span.p1)
        for text_id in span.near_text_ids:
            token = by_id.get(text_id)
            if token is None:
                continue
            along, _ = _along_and_across(span.p0, span.p1, _centre(token))
            key = (round(abs(along - length / 2), 6), length, order)
            if text_id not in best or key < best[text_id]:
                best[text_id] = key
    return {text_id: spans[key[2]].id for text_id, key in best.items()}
