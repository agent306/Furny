"""Dimension lines, dimension spans and heuristic text association (06 §8.4 steps 1-5, §8.1 step 2).

A dimension line is a thin segment with at least two ticks and a numeric label beside it. Ticks come from
three sources: short slanted or perpendicular strokes crossing the line, perpendicular extension lines
touching it, and (raster pages) the strokes and blobs found in the ink around the line. LSD drops strokes
shorter than its minimum length, and the spec's tick length range (0.005 L ... 0.03 L) reaches below that
limit (`max(8 px, 0.008 L)`), so on raster pages the interior ticks are usually only visible in the ink.
"""

import bisect
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
BLOB_MERGE_PX = 8.0  # blob marks closer than this (or 2 line widths + 4) are one mark
BLOB_EXCESS_PX = 3  # a blob is at least this much thicker than the line


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


def _band(ink: np.ndarray, line: Segment, radius: int, slack: int) -> np.ndarray:
    """The ink resampled into line coordinates: column `i` is `u = i - slack` along the line from
    `line.p0`, row `j` is `v = j - radius` along the normal. Nearest-neighbour, one pixel per unit."""
    ux, uy, length = _unit(line.p0, line.p1)
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
    """Moments (n, sum u, sum v, sum uu, sum uv, sum vv) and extent of one stroke: the components touching
    the line, merged across it."""

    def __init__(self) -> None:
        self.m = np.zeros(6)
        self.top = 10**9  # smallest / largest band row
        self.bottom = -1
        self.members: list[int] = []
        self.edge_u: list[float] = []  # u next to the line, one per side

    @property
    def n(self) -> float:
        return float(self.m[0])

    def add(self, label: int, m: np.ndarray, top: int, bottom: int, edge_u: float) -> None:
        self.members.append(label)
        self.edge_u.append(edge_u)
        self.m += m
        self.top, self.bottom = min(self.top, top), max(self.bottom, bottom)


def _axis_of(m: np.ndarray, pixels: np.ndarray) -> tuple[float, float, float, float, float] | None:
    """(du, dv, centre u, centre v, elongation) of the principal axis of the moments `m`; None when it
    is unreliable. Strokes of fewer than 6 pixels use the farthest pair of pixels instead."""
    n = m[0]
    mu, mv = m[1] / n, m[2] / n
    if n < 6:
        d = pixels[:, None, :] - pixels[None, :, :]
        i, j = np.unravel_index(np.argmax((d**2).sum(axis=2)), (len(pixels), len(pixels)))
        vec = pixels[j] - pixels[i]
        norm = float(np.hypot(*vec))
        return (vec[0] / norm, vec[1] / norm, mu, mv, 99.0) if norm > 0 else None
    cov = np.array([[m[3] / n - mu * mu, m[4] / n - mu * mv], [m[4] / n - mu * mv, m[5] / n - mv * mv]])
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
    and the rest is split into 8-connected components. The line's own rows are found per column (it may
    step by a pixel or drift against the segment); components connected to them in the original ink,
    through at most the one pixel of margin, are strokes (a glyph one empty row away is not), and the two
    halves of a stroke crossing the line are merged. Per stroke:
    - wider than 2.5 line widths + 2 px (area / length): a wall, no tick;
    - angle 90 +- 10 degrees to the line: a tick of at least 0.005 L (bar ticks, extension lines ending at or
      crossing the line, extension lines running through an inner chain of a stacked dimension string);
    - angle 45 +- 15 or 135 +- 15 degrees, not reaching the band edge on either side and
      0.005 L ... 0.03 L long: a slash tick, of any width;
    - anything else (longer diagonals, other angles, blobs with no clear direction): no stroke tick.
    The tick sits where the stroke's fitted axis meets the line. Strokes that are no ticks (and do not run
    out of the band) are searched for blobs: the ink run through the line's middle, per column; runs where
    it is at least `width + 3` px thick with an area of at most (0.006 L)^2 and a length of at most 0.012 L
    are dots / arrowheads. A run is placed at its centre; an arrowhead (clearly wider at one end) at its
    tip, where its edges converge (see `_blob_position`). Marks outside the kept range (up to 6 px beyond
    the ends) are dropped before they could absorb other marks.
    """
    length = _unit(line.p0, line.p1)[2]
    width = max(1.0, line.width_px)
    hi = TICK_MAX_FRAC * long_side
    lo = TICK_MIN_FRAC * long_side
    radius = math.ceil(hi / 2) + BAND_MARGIN_PX
    blob_max_len = BLOB_LEN_FRAC * long_side
    slack = max(
        int(END_SLACK_PX), math.ceil(blob_max_len)
    )  # room for an arrowhead whose body is off the line
    inked = _band(ink, line, radius, slack) > 0
    cols = inked.shape[1]
    run = min(math.ceil(hi) + 1, cols) | 1  # odd: OpenCV's even-sized kernels are off by one at run ends
    opened = np.zeros_like(inked)  # the long horizontal runs
    long_rows = np.flatnonzero(inked.sum(axis=1) >= run)  # only these rows can hold a run that long
    if long_rows.size:
        opened[long_rows] = (
            cv2.morphologyEx(inked[long_rows].astype(np.uint8), cv2.MORPH_OPEN, np.ones((1, run), np.uint8))
            > 0
        )
    cleared = opened.copy()
    cleared[1:] |= opened[:-1]  # a pixel of margin above and below
    cleared[:-1] |= opened[1:]
    # The line's own rows, per column (the line may step by a pixel or drift against the segment).
    line_first, line_last, found = _line_rows(opened, radius, int(width / 2) + 3)
    # Rows of the line with the margin: the most common local thickness + 2.
    zone = int(np.bincount(line_last[found] - line_first[found]).argmax()) + 3 if found.any() else 1
    rest = inked & ~cleared
    count, labels, stats, centroids = cv2.connectedComponentsWithStats(rest.astype(np.uint8), connectivity=8)
    top, height, area = stats[:, cv2.CC_STAT_TOP], stats[:, cv2.CC_STAT_HEIGHT], stats[:, cv2.CC_STAT_AREA]
    bottom = top + height - 1
    min_area = max(3.0, width)
    # A stroke touches the line when it is connected to the line's own pixels at its columns in the
    # original ink, through at most one pixel (the cleared margin): a glyph one empty row away is not.
    lo_row, hi_row = max(0, int(line_first.min()) - 2), min(2 * radius, int(line_last.max()) + 2)
    band_rows = np.arange(lo_row, hi_row + 1, dtype=np.int16)[:, None]
    on_line = ((band_rows >= line_first) & (band_rows <= line_last)).astype(np.uint8)
    ring = np.ones((3, 3), np.uint8)
    next_to_line = (cv2.dilate(on_line, ring) > 0) & inked[lo_row : hi_row + 1]
    reach = cv2.dilate(next_to_line.astype(np.uint8) | on_line, ring) > 0
    contact = np.zeros(count, bool)
    contact[labels[lo_row : hi_row + 1][rest[lo_row : hi_row + 1] & reach]] = True
    # Side of the line: the middle of the component's rows lies beyond the cleared rows (the line and, where
    # it was found, its margin) at its centroid's column. A component straddling them is no half of a stroke.
    centre_col = np.clip((centroids[:, 0] + 0.5).astype(np.int64), 0, cols - 1)
    centre_row = top + height / 2.0
    margin = found.any().astype(np.int16)  # without a line found, the rows are a guess with no margin
    stroke_like = contact & (area >= min_area)
    touching_up = stroke_like & (centre_row < line_first[centre_col] - margin)
    touching_down = stroke_like & (centre_row > line_last[centre_col] + margin)
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
    strokes: list[_Stroke] = []
    ups = [int(c) for c in np.flatnonzero(touching_up)]
    downs = [int(c) for c in np.flatnonzero(touching_down)]
    # Pair the halves of a stroke across the line, nearest first. A slanted stroke is shifted by the run
    # it makes across the line (zone / tan(angle): 8 px for a 35 degree stroke on a 5 row zone).
    window = 2.0 * zone + 6.0
    by_u = sorted(downs, key=lambda d_: edge_u[d_])
    keys = [float(edge_u[d_]) for d_ in by_u]
    costs = []
    for c in ups:
        for d in by_u[
            bisect.bisect_left(keys, edge_u[c] - window) : bisect.bisect_right(keys, edge_u[c] + window)
        ]:
            costs.append((abs(float(edge_u[d] - edge_u[c])), c, d))
    costs.sort()
    partner_of: dict[int, int] = {}
    taken: set[int] = set()
    for _, c, d in costs:
        if c not in partner_of and d not in taken:
            partner_of[c] = d
            taken.add(d)
    for c in ups:
        stroke = _Stroke()
        stroke.add(c, moments[c], int(top[c]), int(bottom[c]), float(edge_u[c]))
        if c in partner_of:
            d = partner_of[c]
            stroke.add(d, moments[d], int(top[d]), int(bottom[d]), float(edge_u[d]))
        strokes.append(stroke)
    for d in downs:
        if d not in taken:
            stroke = _Stroke()
            stroke.add(d, moments[d], int(top[d]), int(bottom[d]), float(edge_u[d]))
            strokes.append(stroke)

    blob_max_area = (BLOB_AREA_FRAC * long_side) ** 2
    marks: list[tuple[float, float]] = []  # (u, size across the line): ticks of strokes and blobs
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
        axis = _axis_of(stroke.m, pixels)
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
        if elongation < ELONGATION:
            # No clear direction: a compound of a bar or extension line and a slash, or a dot. If it
            # crosses the line, is tick-sized, stays in the band and is thin, it is a tick at the line.
            rows = stroke.bottom - stroke.top + 1
            if (
                len(stroke.edge_u) == 2
                and not at_band_edge
                and lo <= rows <= hi
                and stroke.n / rows <= thick_limit
            ):
                marks.append((sum(stroke.edge_u) / 2, float(rows)))
                skips.append(span)
            continue
        if abs(dv) < 1e-6:
            continue
        extent = (stroke.bottom - stroke.top + 1) / abs(dv)  # along the axis, across the cleared rows too
        if stroke.n / max(extent, 1.0) > thick_limit:
            continue
        angle = math.degrees(math.atan2(abs(dv), abs(du)))  # to the line, 0..90
        if angle >= 90.0 - PERP_TOL_DEG:
            tick = extent >= lo  # shorter marks (arrowhead wedges, dots) are left to the blob rule
        elif abs(angle - 45.0) <= DIAG_TOL_DEG:
            tick = (not at_band_edge) and lo <= extent <= hi
        else:
            tick = False
        if tick:
            if len(stroke.edge_u) == 2:  # both halves: where they meet the line
                marks.append((sum(stroke.edge_u) / 2, float(stroke.bottom - stroke.top + 1)))
            else:
                marks.append((mu - mv * du / dv, float(stroke.bottom - stroke.top + 1)))
            skips.append(span)

    # Blobs: the thickness of the ink through the line, per column, away from the strokes found above.
    line_width = max(width, float(zone - 2))  # the line's own ink (the cleared rows have a pixel of margin)
    run_top, run_bottom = _run_through(inked, line_first, line_last, found)
    thickness = (run_bottom - run_top + 1).astype(np.float64)
    skip = np.zeros(cols, bool)
    for u_from, u_to in skips:
        skip[max(0, math.floor(u_from)) : max(0, math.ceil(u_to)) + 1] = True
    columns = np.flatnonzero((thickness >= line_width + BLOB_EXCESS_PX) & ~skip)
    for group in np.split(columns, np.flatnonzero(np.diff(columns) > 2) + 1) if columns.size else []:
        if group.size > blob_max_len or (thickness[group] - line_width).sum() > blob_max_area:
            continue
        position = _blob_position(
            group, run_top, run_bottom, (line_first, line_last), ~skip, line_width, blob_max_len / 2
        )
        marks.append((position - slack, 0.0))
    # Small marks (dots, arrowheads, short strokes) next to a tick of tick size are part of it: an
    # arrowhead at an extension line. Heads meeting tip to tip at an interior extension line are one mark.
    # Marks beyond the kept range (an extension line past the end) are dropped first: they absorb nothing.
    kept = [(u_, size) for u_, size in marks if -END_SLACK_PX <= u_ <= length + END_SLACK_PX]
    big = [u_ for u_, size in kept if size >= lo]
    small = [u_ for u_, size in kept if size < lo and all(abs(u_ - b_) > blob_max_len for b_ in big)]
    ticks = big + _cluster(np.array(sorted(small)), max(BLOB_MERGE_PX, 2.0 * width + 4.0))
    return [t for t in ticks if -END_SLACK_PX <= t <= length + END_SLACK_PX]


def _line_rows(opened: np.ndarray, centre: int, reach: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """First and last row of the line in each column of a band, and whether the column holds the line.

    The line is the run of `opened` (long horizontal ink runs) rows nearest to row `centre`, within
    `reach` rows of it. Columns without one (beyond the ends, gaps) take the nearest column's rows;
    without any, the line is row `centre`."""
    rows, cols = opened.shape
    lo, hi = max(0, centre - reach), min(rows - 1, centre + reach)
    window = opened[lo : hi + 1]
    index = np.arange(lo, hi + 1, dtype=np.int16)[:, None]
    distance = np.where(window, np.abs(index - centre), np.int16(rows))
    found = distance.min(axis=0) < rows
    if not found.all():
        if not found.any():
            return np.full(cols, centre, np.int16), np.full(cols, centre, np.int16), found
        column = np.arange(cols)
        left = np.maximum.accumulate(np.where(found, column, -cols))  # nearest column holding the line
        right = np.minimum.accumulate(np.where(found, column, 2 * cols)[::-1])[::-1]
        nearest = np.where(column - left <= right - column, left, right)
        window = window[:, nearest]
        distance = distance[:, nearest]
    seed = lo + distance.argmin(axis=0).astype(np.int16)
    first = np.where(~window & (index < seed), index, np.int16(lo - 1)).max(axis=0) + 1  # below the gap above
    last = np.where(~window & (index > seed), index, np.int16(hi + 1)).min(axis=0) - 1  # above the gap below
    return first, last, found


def _run_through(
    inked: np.ndarray, first: np.ndarray, last: np.ndarray, found: np.ndarray
) -> tuple[np.ndarray, np.ndarray]:
    """Per column, the top and bottom row of the vertical ink run through the middle of the line (rows
    `first` ... `last`; bottom = top - 1 where that pixel is blank). Where the line was found and nothing
    touches it, that is the line itself; elsewhere the run is followed up and down."""
    rows, cols = inked.shape
    column = np.arange(cols)
    top, bottom = first.astype(np.int64), last.astype(np.int64)
    touched = ~found
    touched |= inked[np.maximum(first - 1, 0), column] & (first > 0)
    touched |= inked[np.minimum(last + 1, rows - 1), column] & (last < rows - 1)
    at = np.flatnonzero(touched)
    if at.size:
        mid = (first[at] + last[at]) // 2
        part = inked[:, at]
        pad = np.zeros((1, at.size), bool)
        for row in np.unique(mid):  # a few values (steps, drift, the ends)
            up = np.argmin(np.vstack([part[row::-1], pad]), axis=0)  # inked rows from `row` upwards ...
            down = np.argmin(np.vstack([part[row:], pad]), axis=0)  # ... and downwards
            here = at[mid == row]
            top[here] = (int(row) - up + 1)[mid == row]
            bottom[here] = np.maximum(int(row) + down - 1, int(row) - up)[mid == row]
    return top, bottom


def _blob_position(
    columns: np.ndarray,
    top: np.ndarray,
    bottom: np.ndarray,
    line_rows: tuple[np.ndarray, np.ndarray],
    usable: np.ndarray,
    line_width: float,
    max_reach: float,
) -> float:
    """Column of a blob: the centre of the run; for an arrowhead (clearly thicker at one end than at the
    other) the tip. The tip is where the linear fits of the head's upper and lower edges (where they show
    beside the line) meet; with one edge showing, where it meets the line's middle; with none, where the
    linear fit of the thickness would vanish. The taper is the run plus the columns thicker than the line
    next to it, and the tip lies at most `max_reach` px beyond its narrow end."""
    thickness = bottom - top + 1
    first, last = int(columns[0]), int(columns[-1])
    while (
        first > 0 and usable[first - 1] and thickness[first - 1] > line_width and last - first < 4 * max_reach
    ):
        first -= 1
    while (
        last < len(thickness) - 1
        and usable[last + 1]
        and thickness[last + 1] > line_width
        and last - first < 4 * max_reach
    ):
        last += 1
    xs = np.arange(first, last + 1, dtype=np.float64)
    t = thickness[first : last + 1].astype(np.float64)
    edge = max(1, len(xs) // 4)
    start, end = float(t[:edge].mean()), float(t[-edge:].mean())
    if abs(end - start) >= 2.0 and last > first:
        slope, intercept = np.polyfit(xs, t, 1)
        if abs(slope) > 0.1:
            tip = _tip(xs, top[first : last + 1], bottom[first : last + 1], line_rows, first, last, slope)
            if tip is None:
                tip = -intercept / slope
            if slope > 0:
                return float(min(first, max(tip, first - max_reach)))
            return float(max(last, min(tip, last + max_reach)))
    return (float(columns[0]) + float(columns[-1])) / 2.0


def _tip(
    xs: np.ndarray,
    top: np.ndarray,
    bottom: np.ndarray,
    line_rows: tuple[np.ndarray, np.ndarray],
    first: int,
    last: int,
    widening: float,
) -> float | None:
    """Column where the edges of an arrowhead (columns `xs`, ink rows `top` ... `bottom`) converge; None
    when no edge shows beside the line. `widening` > 0: the head widens to the right."""
    line_top, line_bottom = line_rows[0][first : last + 1], line_rows[1][first : last + 1]
    fits = []
    for rows, beside, sign in ((top, top < line_top, -1.0), (bottom, bottom > line_bottom, 1.0)):
        if np.count_nonzero(beside) >= 2 and np.ptp(xs[beside]) > 0:
            slope, intercept = np.polyfit(xs[beside], rows[beside].astype(np.float64), 1)
            if sign * slope * np.sign(widening) > 0.05:  # opens away from the line towards the base
                fits.append((float(slope), float(intercept)))
    if len(fits) == 2:
        (s_top, i_top), (s_bottom, i_bottom) = fits
        return (i_bottom - i_top) / (s_top - s_bottom)
    if len(fits) == 1:
        axis = float((line_top + line_bottom).mean()) / 2.0
        return (axis - fits[0][1]) / fits[0][0]
    return None


def _cluster(positions: np.ndarray, gap: float) -> list[float]:
    """Means of the groups of sorted `positions` whose neighbours are at most `gap` apart."""
    if positions.size == 0:
        return []
    ordered = np.sort(positions)
    return [float(g.mean()) for g in np.split(ordered, np.flatnonzero(np.diff(ordered) > gap) + 1)]


# --- dimension lines ----------------------------------------------------------------------------------


def _dedupe_ticks(positions: Sequence[float], gap: float) -> list[float]:
    """Ticks closer than `gap` px along the line are one tick."""
    return _cluster(np.array(sorted(positions)), gap)


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
    4 px are one tick (marks of one tick in the ink: `max(4, 2 line widths)`). Collinear duplicates of
    one line are dropped. Ids `L1..Ln` follow the (min y, min x, max y, max x) order of the lines.
    `check_deadline` is called for every candidate.
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
        ticks = _dedupe_ticks(_segment_ticks(cand, index, p0, p1, lo, hi), TICK_DEDUPE_PX)
        if ink is not None:
            # Marks of one tick (arrowhead, extension line, slash) are merged within `max(4, 2 widths)`;
            # then ink and segment ticks within 4 px are one tick.
            from_ink = _dedupe_ticks(
                _ink_ticks(cand, ink, long_side, check_deadline), max(TICK_DEDUPE_PX, 2.0 * cand.width_px)
            )
            ticks = _dedupe_ticks(ticks + from_ink, TICK_DEDUPE_PX)
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
