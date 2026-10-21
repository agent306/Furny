"""Dimension lines, dimension spans and heuristic text association (06 §8.4 steps 1-5, §8.1 step 2).

A dimension line is a thin segment with at least two ticks and a numeric label beside it. Ticks come from
three sources: short slanted or perpendicular strokes crossing the line, perpendicular extension lines
touching it, and (raster pages) the strokes and blobs found in the ink around the line. LSD drops strokes
shorter than its minimum length, and the spec's tick length range (0.005 L ... 0.03 L) reaches below that
limit (`max(8 px, 0.008 L)`), so on raster pages the interior ticks are usually only visible in the ink.

Raster pages (Task 14b, see `_raster_lines`): a dimension line arrives from LSD in pieces (broken at its
ticks and crossings, cut under its labels by the text mask, falling apart where it is faint), so the pieces
are chained into lines first. A partition face meeting perpendicular partitions, an extension line crossing
a chain and a door jamb crossing a line all look like a line with ticks and a label nearby; such lines are
dropped when they pair as a double-line wall face, when they own no label (each label belongs to the line
it stands on) and, on lines drawn with terminator marks, strokes that merely run through them are no ticks.
Pages without ink (vector pages) keep the Task 14 rules unchanged.
"""

import bisect
import itertools
import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass

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
OWNER_TIE_PX = 3.0  # lines this much farther from a label than the nearest one share it
AXIS_TOL_DEG = 10.0  # x / y axis and text-orientation tolerance
END_SLACK_PX = 6.0  # ticks may sit this far beyond the ends of the (LSD-extended) segment
TICK_DEDUPE_PX = 4.0  # ticks closer than this along the line are one tick
CROSS_TOL_DEG = 30.0  # another dimension line crossing within 90 +- 30 degrees takes no unmarked tick
# Tick kinds: a terminator mark (slash, arrowhead, dot, a bar crossing the line with a slash), a bar
# or extension line ending at the line, a perpendicular stroke running through the band on both sides, and
# the face of a wall the line ends at.
MARK, BAR, THROUGH, WALL = "mark", "bar", "through", "wall"
MARK_REACH_PX, MARK_REACH_FRAC = 4.0, 0.01  # a mark widens a stroke within max(4 px, 0.01 L) of the line ...
MARK_EXCESS_PX = 3.0  # ... by at least 3 px
CHAIN_ANGLE_DEG = 2.0  # thin pieces of one line: parallel within 2 degrees ...
CHAIN_OFFSET_PX = 3.0  # ... each end within max(3 px, the wider stroke) of the other's line ...
CHAIN_GAP_FRAC = 0.06  # ... and at most 0.06 L apart, the gap inked or under a text box (raster pages)
CHAIN_GAP_COVER = 0.9
CHAIN_ACROSS_PX = 2  # ... within 2 px across (the line may bow a little between its pieces) ...
GAP_CONTRAST = 8.0  # ... darker than the paper 5-8 px beside it by this many gray levels ...
PAPER_NEAR_PX, PAPER_FAR_PX = 5, 8
CHAIN_TEXT_MARGIN_PX = 3.0  # ... or under a text box grown by this margin
CHAIN_DARKNESS_RATIO = 1.6  # pieces of one line are drawn with one pen: ink darkness within 1.6x
EXTEND_GAP_PX = 4  # a chain's ends run on (alone: not into a wall) through gaps of up to 4 px
# A line paired like a double-line wall face is no dimension line (the walls stage's pair rules, 06 §8.1
# step 3 with ruling R6): both lines >= 0.03 L, parallel within 2 degrees, 1.5 t_thin ... 0.02 L apart,
# overlapping >= 60 % of the shorter, the strip between them free of text and hollow or filled.
FACE_MIN_LEN_FRAC = 0.03
FACE_ANGLE_DEG = 2.0
FACE_D_MIN_THIN, FACE_D_MAX_FRAC = 1.5, 0.02
FACE_OVERLAP = 0.6
FACE_HOLLOW_MAX, FACE_FILLED_MIN = 0.15, 0.85

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
    """Numeric tokens as arrays: centre x / y, the glyph height, the reach (2.5 text heights) and the text
    angle."""

    def __init__(self, tokens: Sequence[TextToken]) -> None:
        centres = np.array([_centre(t) for t in tokens], np.float64).reshape(-1, 2)
        self.x, self.y = centres[:, 0], centres[:, 1]
        self.height = np.array([t.height_px for t in tokens], np.float64)
        self.reach = TEXT_REACH * self.height
        self.angle = np.array([t.angle for t in tokens], np.int64)

    def __len__(self) -> int:
        return len(self.x)

    def _near(self, line: Segment, oriented: bool) -> tuple[np.ndarray, np.ndarray, float, float]:
        """Which labels are beside ``line`` (see `beside`), their signed distances across it and its unit
        direction."""
        ux, uy, length = _unit(line.p0, line.p1)
        rx, ry = self.x - line.p0[0], self.y - line.p0[1]
        along, across = rx * ux + ry * uy, -rx * uy + ry * ux
        near = (along >= 0.0) & (along <= length) & (np.abs(across) <= self.reach)
        if oriented:
            wanted = {"x": 0, "y": 90}.get(_axis_of_points(line.p0, line.p1))
            if wanted is not None:
                near &= self.angle == wanted
        return near, across, ux, uy

    def beside(self, line: Segment, *, oriented: bool = False) -> bool:
        """Whether a label centre projects onto `line` and lies within its reach across it. ``oriented``
        (raster pages): written along the line, angle 0 beside an x line and 90 beside a y line (06 §8.4
        step 3's orientation rule; any angle beside a line on neither axis)."""
        return bool(np.any(self._near(line, oriented)[0]))

    def owners(self, lines: Sequence[Segment]) -> set[int]:
        """Indices of the ``lines`` that some label (oriented, see `beside`) belongs to.

        A label belongs to the nearest line (across, from its centre) among those it is beside on its
        baseline side, and to every line within `OWNER_TIE_PX` of that (collinear copies of one line); only
        when no line is there, to the nearest on the other side. Dimension text stands on its line: below
        horizontal text, right of text reading upwards (06 §7.7 angle 90). So an extension line, a face
        line or a stacked chain next to a dimension line does not borrow its label."""
        if not lines:
            return set()
        base = np.full((len(lines), len(self)), np.inf)
        other = np.full((len(lines), len(self)), np.inf)
        for k, line in enumerate(lines):
            near, across, ux, uy = self._near(line, True)
            # The foot of the label centre on the line: below it (angle 0) or right of it (angle 90) is the
            # baseline side.
            foot_x = self.x + across * uy
            foot_y = self.y - across * ux
            on_base = np.where(self.angle == 90, foot_x > self.x, foot_y > self.y)
            dist = np.abs(across)
            base[k, near & on_base] = dist[near & on_base]
            other[k, near & ~on_base] = dist[near & ~on_base]
        gaps = np.where(np.isfinite(base).any(axis=0)[None, :], base, other)
        best = gaps.min(axis=0)
        owns = np.isfinite(gaps) & (gaps <= best[None, :] + OWNER_TIE_PX)
        return {int(k) for k in np.flatnonzero(owns.any(axis=1))}


# --- ticks from segments ------------------------------------------------------------------------------


def _segment_ticks(
    line: Segment, members: Sequence[int], p0: np.ndarray, p1: np.ndarray, lo: float, hi: float
) -> list[tuple[float, str]]:
    """Ticks (px from `line.p0`, kind) of the thin segments (`p0`, `p1`: (n, 2) endpoints) at `line`; the
    segments `members` (the line's own pieces) are left out.

    Counted are strokes of 0.005 L ... 0.03 L crossing the line in their middle 80 % at 90 +- 10 (`BAR`)
    or 45 +- 15 degrees (`MARK`), and perpendicular extension lines (`BAR`): ending within
    `2 px + half the line width + 1 px` of the line, or crossing it and ending at most 14 px beyond (LSD
    lengthens line ends by ~3 px).
    """
    ux, uy, length = _unit(line.p0, line.p1)
    origin = np.array(line.p0, np.float64)
    q0, q1 = p0 - origin, p1 - origin
    s0, h0 = q0[:, 0] * ux + q0[:, 1] * uy, -q0[:, 0] * uy + q0[:, 1] * ux
    s1, h1 = q1[:, 0] * ux + q1[:, 1] * uy, -q1[:, 0] * uy + q1[:, 1] * ux
    tick_len = np.hypot(s1 - s0, h1 - h0)
    others = np.ones(len(p0), bool)
    others[list(members)] = False
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
    marks = [(float(p), MARK) for p in np.clip(where[crossing & slanted & ~perpendicular], 0.0, length)]
    positions = list(np.clip(where[crossing & perpendicular], 0.0, length))

    touch = EXTENSION_TOUCH_PX + line.width_px / 2 + 1.0
    for s_end, h_end in ((s0, h0), (s1, h1)):  # an end of a perpendicular stroke touches the line
        off = s_end - np.clip(s_end, 0.0, length)
        touching = perpendicular & (np.hypot(h_end, off) <= touch)
        positions += list(np.clip(s_end[touching], 0.0, length))
    overshoot = (
        perpendicular & sides & in_reach & (np.minimum(np.abs(h0), np.abs(h1)) <= EXTENSION_OVERSHOOT_PX)
    )
    positions += list(np.clip(where[overshoot], 0.0, length))
    return marks + [(float(p), BAR) for p in positions]


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
    line: Segment,
    ink: np.ndarray,
    long_side: float,
    check_deadline: Callable[[], None] | None,
    pieces: Sequence[tuple[Pt, Pt]] = (),
) -> list[tuple[float, str]]:
    """Ticks (px from `line.p0`, kind) found in the ink around `line` (raster pages).

    The ink is resampled into line coordinates (a band of +-(0.015 L + 6 px)); every long horizontal run
    (the line itself, parallel dimension lines, wall edges: >= 0.03 L) is cleared with a pixel of margin,
    and the rest is split into 8-connected components. The line's own rows are found per column (it may
    step by a pixel or drift against the segment); components connected to them in the original ink,
    through at most the one pixel of margin, are strokes (a glyph one empty row away is not), and the two
    halves of a stroke crossing the line are merged. Per stroke:
    - wider than 2.5 line widths + 2 px (area / length): a wall, no tick; but a wall the line ends at
      (`_wall_face_at_end`) gives a `WALL` tick at its face;
    - angle 90 +- 10 degrees to the line: a tick of at least 0.005 L (bar ticks, extension lines ending at or
      crossing the line, extension lines running through an inner chain of a stacked dimension string): a
      `MARK` when it carries a slash, arrowhead or dot at the line (`_carries_mark`), else `THROUGH` when it
      reaches the band edge on both sides and `BAR` when not;
    - angle 45 +- 15 or 135 +- 15 degrees, not reaching the band edge on either side and
      0.005 L ... 0.03 L long: a slash tick (`MARK`), of any width;
    - anything else (longer diagonals, other angles, blobs with no clear direction): no stroke tick.
    The tick sits where the stroke's fitted axis meets the line. Strokes that are no ticks (and do not run
    out of the band) are searched for blobs: the ink run through the line's middle, per column; runs where
    it is at least `width + 3` px thick with an area of at most (0.006 L)^2 and a length of at most 0.012 L
    are dots / arrowheads. A run is placed at its centre; an arrowhead (clearly wider at one end) at its
    tip, where its edges converge (see `_blob_position`); blobs are `MARK`s. Marks outside the kept range
    (up to 6 px beyond the ends) are dropped before they could absorb other marks. ``pieces`` (the line's
    LSD pieces, for a chained or lengthened line) are drawn into the band first (`_draw_pieces`).
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
    if pieces:
        _draw_pieces(inked, line, pieces, radius, slack)
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
    marks: list[tuple[float, float, str]] = []  # (u, size across the line, kind): strokes and blobs
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
        rows = stroke.bottom - stroke.top + 1
        if at_band_edge and stroke.n / rows > thick_limit:
            # A wall the line ends at: its face is the tick (the line is dimensioned to it; a slash there
            # merges with the wall). A wall the line runs through is no tick.
            face = _wall_face_at_end(np.isin(lab, stroke.members), u, v, zone, length, max(MARK_REACH_PX, lo))
            if face is not None:
                marks.append((face, float(rows), WALL))
            continue
        if axis is None:
            continue
        du, dv, mu, mv, elongation = axis
        if elongation < ELONGATION:
            # No clear direction: a compound of a bar or extension line and a slash, or a dot. If it
            # crosses the line, is tick-sized, stays in the band and is thin, it is a tick at the line.
            if (
                len(stroke.edge_u) == 2
                and not at_band_edge
                and lo <= rows <= hi
                and stroke.n / rows <= thick_limit
            ):
                marks.append((sum(stroke.edge_u) / 2, float(rows), MARK))
                skips.append(span)
            continue
        if abs(dv) < 1e-6:
            continue
        extent = rows / abs(dv)  # along the axis, across the cleared rows too
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
            kind = MARK
            if angle >= 90.0 - PERP_TOL_DEG and not _carries_mark(
                np.isin(lab, stroke.members), u, v, zone, max(MARK_REACH_PX, MARK_REACH_FRAC * long_side)
            ):
                kind = THROUGH if stroke.top <= 1 and stroke.bottom >= 2 * radius - 1 else BAR
            if len(stroke.edge_u) == 2:  # both halves: where they meet the line
                marks.append((sum(stroke.edge_u) / 2, float(rows), kind))
            else:
                marks.append((mu - mv * du / dv, float(rows), kind))
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
        marks.append((position - slack, 0.0, MARK))
    # Small marks (dots, arrowheads, short strokes) next to a tick of tick size are part of it: an
    # arrowhead at an extension line (which then carries a mark). Heads meeting tip to tip at an interior
    # extension line are one mark. Marks beyond the kept range (an extension line past the end) are dropped
    # first: they absorb nothing.
    kept = [m for m in marks if -END_SLACK_PX <= m[0] <= length + END_SLACK_PX]
    big = [(u_, kind) for u_, size, kind in kept if size >= lo]
    small = []
    for u_, size, _ in kept:
        if size >= lo:
            continue
        near = [k for k, (b_, _) in enumerate(big) if abs(u_ - b_) <= blob_max_len]
        if not near:
            small.append(u_)
        for k in near:
            big[k] = (big[k][0], MARK)
    ticks = big + [
        (u_, MARK) for u_ in _cluster(np.array(sorted(small)), max(BLOB_MERGE_PX, 2.0 * width + 4.0))
    ]
    return [(t, kind) for t, kind in ticks if -END_SLACK_PX <= t <= length + END_SLACK_PX]


def _wall_face_at_end(
    member: np.ndarray, u: np.ndarray, v: np.ndarray, zone: int, length: float, reach: float
) -> float | None:
    """The face (u) of a wall stroke (pixels ``member`` of the band pixels ``u``, ``v``) that the line
    ends at, else None: next to the line (within the cleared rows + 2) the wall lies wholly before the
    line's start and reaches within `END_SLACK_PX` of it, or wholly beyond its end. The face is read in the
    rows ``reach`` .. ``2 reach`` beyond the cleared ones (the median of their wall edges), clear of a slash
    merged with the wall at the line."""
    near = member & (np.abs(v) <= zone / 2.0 + 2.0)
    if not near.any():
        return None
    first, last = float(u[near].min()), float(u[near].max())
    at_start = -END_SLACK_PX <= last <= END_SLACK_PX and first < -END_SLACK_PX
    at_end = length - END_SLACK_PX <= first <= length + END_SLACK_PX and last > length + END_SLACK_PX
    if not (at_start or at_end):
        return None
    away = member & (np.abs(v) > zone / 2.0 + reach) & (np.abs(v) <= zone / 2.0 + 2.0 * reach)
    if not away.any():
        return last if at_start else first
    rows = np.round(v[away]).astype(np.intp)
    order, idx = np.unique(rows, return_inverse=True)
    edge = np.full(order.size, -np.inf if at_start else np.inf)
    if at_start:
        np.maximum.at(edge, idx, u[away])
    else:
        np.minimum.at(edge, idx, u[away])
    return float(np.median(edge))


def _carries_mark(member: np.ndarray, u: np.ndarray, v: np.ndarray, zone: int, reach: float) -> bool:
    """Whether a perpendicular stroke (its pixels: ``member`` of the band pixels ``u``, ``v``) carries a
    terminator mark where it meets the line: a slash, arrowhead or dot widens it next to the line (up to
    ``reach`` beyond the cleared rows) by at least `MARK_EXCESS_PX` over its width farther out, in at least
    two rows. A bare extension line, partition face or crossing line does not widen."""
    uu, vv = u[member], np.abs(v[member])
    if uu.size == 0:
        return False
    rows = np.round(vv).astype(np.intp)
    order = np.unique(rows)
    lo_u = np.full(order.size, np.inf)
    hi_u = np.full(order.size, -np.inf)
    idx = np.searchsorted(order, rows)
    np.minimum.at(lo_u, idx, uu)
    np.maximum.at(hi_u, idx, uu)
    width = hi_u - lo_u + 1.0  # both sides of the line share a row index |v|: the extent spans both
    edge = zone / 2.0
    near = (order > edge) & (order <= edge + reach)
    far = order > edge + reach
    if not far.any() or not near.any():
        return False
    return int(np.count_nonzero(width[near] >= float(np.median(width[far])) + MARK_EXCESS_PX)) >= 2


def _draw_pieces(
    inked: np.ndarray, line: Segment, pieces: Sequence[tuple[Pt, Pt]], radius: int, slack: int
) -> None:
    """Draw the line's own pieces, joined end to end and run on to the line's ends, into its band (in
    place), as wide as the line: a faint line that the ink threshold broke up (its pieces chained by the
    gray image) is whole again, so the strokes crossing it are split into their halves at it and not joined
    into one blob through their ticks."""
    ux, uy, length = _unit(line.p0, line.p1)
    pts = [(float(slack), float(radius)), (length + slack, float(radius))]
    for a, b in pieces:
        for p in (a, b):
            rx, ry = p[0] - line.p0[0], p[1] - line.p0[1]
            pts.append((rx * ux + ry * uy + slack, -rx * uy + ry * ux + radius))
    pts.sort()
    poly = np.round(np.array(pts) * 16).astype(np.int32)
    mask = np.zeros(inked.shape, np.uint8)
    cv2.polylines(mask, [poly], False, 1, max(1, round(line.width_px)), cv2.LINE_8, 4)
    inked |= mask > 0


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


# --- candidate lines: chains of thin pieces ----------------------------------------------------------


class _Chains:
    """Union-find over the thin pieces of one stroke."""

    def __init__(self, n: int) -> None:
        self.parent = list(range(n))

    def find(self, i: int) -> int:
        while self.parent[i] != i:
            self.parent[i] = self.parent[self.parent[i]]
            i = self.parent[i]
        return i

    def union(self, i: int, j: int) -> None:
        ri, rj = self.find(i), self.find(j)
        if ri != rj:
            self.parent[max(ri, rj)] = min(ri, rj)


@dataclass(frozen=True)
class _Evidence:
    """What shows a line running on through a gap between two of its pieces: the ink, the page's gray
    image (a faint line that the ink threshold broke up) and the text boxes (the text mask cuts a line
    under its label)."""

    ink: np.ndarray | None
    gray: np.ndarray | None
    boxes: np.ndarray  # (k, 4) token boxes

    def covered(self, a: np.ndarray, b: np.ndarray, normal: np.ndarray, width: float) -> bool:
        """At least 90 % of the gap ``a`` -> ``b`` is inked, darker than the paper beside it or under a text
        box (within `CHAIN_ACROSS_PX` across: the line may bow a little between its pieces), and no wall
        crosses it: no stroke crossing the gap is wider than ``2.5 width + 2`` (the ink covering the line
        and ``2.5 width / 2 + 2`` px on either side; a chain interrupted by a solid wall is two dimension
        lines, each ending at the wall)."""
        n = max(2, math.ceil(float(np.hypot(*(b - a)))) + 1)
        pts = a + np.linspace(0.0, 1.0, n)[:, None] * (b - a)
        if self.ink is not None:
            limit = THICK_FACTOR * width + THICK_MARGIN_PX
            half = math.ceil(limit / 2.0) + 1
            across = np.arange(-half, half + 1, dtype=np.float64)
            wide = (_sample_rows(self.ink, pts, normal, across) > 0).all(axis=1)
            run = np.diff(np.flatnonzero(np.diff(np.concatenate([[0], wide.astype(np.int8), [0]]))))[::2]
            if run.size and int(run.max()) > limit:
                return False
        return float(self.hits(pts, normal).mean()) >= CHAIN_GAP_COVER

    def hits(
        self, pts: np.ndarray, normal: np.ndarray, *, alone: bool = False, darkness: float = 0.0
    ) -> np.ndarray:
        """Per point: the line shows there (ink, gray or a text box; see `covered`). With ``alone`` the
        line only counts where it runs alone, with paper 5-8 px beside it on both sides (not inside a wall
        or along a crossing stroke), as dark as ``darkness`` / 1.6 at least (drawn with the same pen; then
        the ink is not used when a gray image is given, it cannot tell pens apart)."""
        n = len(pts)
        hit = np.zeros(n, bool)
        across = np.arange(-CHAIN_ACROSS_PX, CHAIN_ACROSS_PX + 1, dtype=np.float64)
        beside = np.concatenate(
            [np.arange(-PAPER_FAR_PX, -PAPER_NEAR_PX + 1), np.arange(PAPER_NEAR_PX, PAPER_FAR_PX + 1)]
        ).astype(np.float64)
        if self.ink is not None and not (alone and self.gray is not None):
            inked = (_sample_rows(self.ink, pts, normal, across) > 0).any(axis=1)
            if alone:
                inked &= ~(_sample_rows(self.ink, pts, normal, beside) > 0).any(axis=1)
            hit |= inked
        if self.gray is not None:
            line = _sample_rows(self.gray, pts, normal, across).min(axis=1).astype(np.float64)
            side = _sample_rows(self.gray, pts, normal, beside).astype(np.float64)
            paper = side.min(axis=1) if alone else np.median(side, axis=1)
            dark = paper - line >= GAP_CONTRAST
            if alone:
                dark &= 255.0 - line >= darkness / CHAIN_DARKNESS_RATIO
            hit |= dark
        if self.boxes.size:
            m = CHAIN_TEXT_MARGIN_PX
            bx = self.boxes
            hit |= (
                (pts[:, None, 0] >= bx[None, :, 0] - m)
                & (pts[:, None, 0] <= bx[None, :, 2] + m)
                & (pts[:, None, 1] >= bx[None, :, 1] - m)
                & (pts[:, None, 1] <= bx[None, :, 3] + m)
            ).any(axis=1)
        return hit


def _sample_rows(img: np.ndarray, pts: np.ndarray, normal: np.ndarray, across: np.ndarray) -> np.ndarray:
    """``img`` at ``pts + across * normal``, nearest pixel, clamped to the image; shape
    (len(pts), len(across))."""
    q = np.rint(pts[:, None, :] + across[None, :, None] * normal[None, None, :]).astype(np.intp)
    h, w = img.shape[:2]
    x = np.clip(q[..., 0], 0, w - 1)
    y = np.clip(q[..., 1], 0, h - 1)
    return np.asarray(img[y, x])


def _candidate_lines(
    thin: Sequence[Segment],
    evidence: _Evidence,
    long_side: float,
    check_deadline: Callable[[], None] | None,
) -> list[tuple[Segment, list[int]]]:
    """The thin pieces chained into lines, each with the indices of its pieces.

    LSD breaks a dimension line at its ticks and crossings, the text mask cuts it under its labels and a
    faint line falls apart in the ink, so one line arrives as several pieces. Two pieces belong to one line
    when they are drawn alike (with a gray image: ink darkness within 1.6x), parallel within 2 degrees,
    the ends facing each other lie within ``max(3 px, the wider stroke)`` of the other piece's line, and
    they overlap or the gap between them is at most ``0.06 L`` and runs on in the image
    (`_Evidence.covered`; with no evidence at all, at most ``END_SLACK_PX``). A chain is the straight
    least-squares line through its pieces' ends, from the first to the last projection, with the
    length-weighted mean width and the id of its longest piece; with a gray image its ends then run on
    while the line does (`_extend_ends`).
    """
    n = len(thin)
    p0 = np.array([s.p0 for s in thin], np.float64).reshape(-1, 2)
    p1 = np.array([s.p1 for s in thin], np.float64).reshape(-1, 2)
    length = np.hypot(*(p1 - p0).T)
    unit = (p1 - p0) / np.maximum(length, 1e-9)[:, None]
    width = np.array([s.width_px for s in thin], np.float64)
    has_evidence = evidence.ink is not None or evidence.gray is not None
    darkness = _darkness(evidence.gray, p0, p1, unit) if evidence.gray is not None else None
    max_gap = CHAIN_GAP_FRAC * long_side if has_evidence else END_SLACK_PX
    cos_tol = math.cos(math.radians(CHAIN_ANGLE_DEG))
    chains = _Chains(n)
    ends = np.stack([p0, p1], axis=1)  # (n, 2 ends, 2)
    cell = max(max_gap, 1.0)
    keys = np.floor(ends / cell).astype(np.intp)
    grid: dict[tuple[int, int], list[int]] = {}
    for i in range(n):
        for e in (0, 1):
            bucket = grid.setdefault((int(keys[i, e, 0]), int(keys[i, e, 1])), [])
            if not bucket or bucket[-1] != i:
                bucket.append(i)
    for i in range(n):
        if check_deadline is not None and i % 256 == 0:
            check_deadline()
        near: set[int] = set()
        for e in (0, 1):
            kx, ky = int(keys[i, e, 0]), int(keys[i, e, 1])
            for dx, dy in itertools.product((-1, 0, 1), repeat=2):
                near.update(grid.get((kx + dx, ky + dy), ()))
        for j in sorted(near):
            if j <= i or abs(float(unit[i] @ unit[j])) < cos_tol or chains.find(i) == chains.find(j):
                continue
            if darkness is not None and max(darkness[i], darkness[j]) > CHAIN_DARKNESS_RATIO * max(
                min(darkness[i], darkness[j]), 1.0
            ):
                continue
            if _joins(i, j, ends, length, unit, width, max_gap, evidence):
                chains.union(i, j)
    groups: dict[int, list[int]] = {}
    for i in range(n):
        groups.setdefault(chains.find(i), []).append(i)
    out = []
    for members in groups.values():
        line = (
            thin[members[0]] if len(members) == 1 else _fit_chain(thin, members, p0, p1, length, unit, width)
        )
        if evidence.gray is not None:
            line = _extend_ends(line, evidence, max_gap)
        out.append((line, members))
    return out


def _extend_ends(line: Segment, evidence: _Evidence, reach: float) -> Segment:
    """``line`` lengthened at each end while it runs on alone in the image, with the same pen
    (`_Evidence.hits` with ``alone``; gaps of up to `EXTEND_GAP_PX`), by at most ``reach``: the last pieces
    of a faint line, or of one cut under its label, can be missing from the segments altogether. It stops
    at a wall or a crossing stroke wider than the gap allowance and at a fainter line running on."""
    ux, uy, _ = _unit(line.p0, line.p1)
    u = np.array((ux, uy))
    normal = np.array((-uy, ux))
    darkness = 0.0
    if evidence.gray is not None:
        p0, p1 = np.array([line.p0], np.float64), np.array([line.p1], np.float64)
        darkness = float(_darkness(evidence.gray, p0, p1, u[None, :])[0])
    steps = np.arange(1.0, reach + 1.0)
    new = []
    for end, out in ((np.array(line.p0), -u), (np.array(line.p1), u)):
        hit = evidence.hits(end + steps[:, None] * out, normal, alone=True, darkness=darkness)
        last, gap = 0.0, 0
        for k, h in enumerate(hit):
            if h:
                last, gap = float(steps[k]), 0
            else:
                gap += 1
                if gap > EXTEND_GAP_PX:
                    break
        new.append(end + last * out)
    (ax, ay), (bx, by) = new
    return Segment(line.id, (float(ax), float(ay)), (float(bx), float(by)), line.width_px, True, line.source)


def _darkness(gray: np.ndarray, p0: np.ndarray, p1: np.ndarray, unit: np.ndarray) -> np.ndarray:
    """Ink darkness (255 - gray, the darkest of 3 px across) of each piece, median over its middle 80 %."""
    out = np.zeros(len(p0))
    across = np.arange(-1.0, 2.0)
    for k in range(len(p0)):
        n = max(2, math.ceil(float(np.hypot(*(p1[k] - p0[k])))))
        pts = p0[k] + np.linspace(0.1, 0.9, n)[:, None] * (p1[k] - p0[k])
        normal = np.array((-unit[k, 1], unit[k, 0]))
        out[k] = 255.0 - float(np.median(_sample_rows(gray, pts, normal, across).min(axis=1)))
    return out


def _joins(
    i: int,
    j: int,
    ends: np.ndarray,
    length: np.ndarray,
    unit: np.ndarray,
    width: np.ndarray,
    max_gap: float,
    evidence: _Evidence,
) -> bool:
    """Whether pieces ``i`` and ``j`` continue one line (see `_candidate_lines`)."""
    u = unit[i]
    nrm = np.array((-u[1], u[0]))
    origin = ends[i, 0]
    t = (ends[j] - origin) @ u  # j's ends along i
    lo, hi = float(t.min()), float(t.max())
    if hi < 0.0:  # j before i: a = i's start, b = j's end facing it
        a, b, gap = ends[i, 0], ends[j, int(np.argmax(t))], -hi
    elif lo > float(length[i]):  # j after i
        a, b, gap = ends[i, 1], ends[j, int(np.argmin(t))], lo - float(length[i])
    else:  # overlapping: the facing ends are the ones nearest each other across the overlap
        a = b = None
        gap = 0.0
    tol = max(CHAIN_OFFSET_PX, float(max(width[i], width[j])))
    if a is None:
        # parallel copies (both edges of a faint stroke): every end of the shorter within tol of the longer
        k, m = (i, j) if length[i] >= length[j] else (j, i)
        nk = np.array((-unit[k, 1], unit[k, 0]))
        return bool(np.all(np.abs((ends[m] - ends[k, 0]) @ nk) <= tol))
    nj = np.array((-unit[j, 1], unit[j, 0]))
    if abs(float((b - origin) @ nrm)) > tol or abs(float((a - ends[j, 0]) @ nj)) > tol:
        return False
    if gap > max_gap:
        return False
    if gap <= 1.0:
        return True
    normal = np.array((-(b - a)[1], (b - a)[0])) / max(float(np.hypot(*(b - a))), 1e-9)
    return evidence.covered(a, b, normal, float(max(width[i], width[j])))


def _fit_chain(
    thin: Sequence[Segment],
    members: list[int],
    p0: np.ndarray,
    p1: np.ndarray,
    length: np.ndarray,
    unit: np.ndarray,
    width: np.ndarray,
) -> Segment:
    longest = max(members, key=lambda k: float(length[k]))
    u = unit[longest]
    signs = np.sign(unit[members] @ u)
    signs[signs == 0] = 1.0
    d = (unit[members] * (signs * length[members])[:, None]).sum(axis=0)
    u = d / np.hypot(*d)
    nrm = np.array((-u[1], u[0]))
    pts = np.vstack([p0[members], p1[members]])
    w = np.concatenate([length[members], length[members]])
    origin = p0[longest]
    offset = float(((pts - origin) @ nrm * w).sum() / w.sum())
    along = (pts - origin) @ u
    a = origin + u * float(along.min()) + nrm * offset
    b = origin + u * float(along.max()) + nrm * offset
    mean_width = float((width[members] * length[members]).sum() / length[members].sum())
    seg = thin[longest]
    return Segment(
        seg.id, (float(a[0]), float(a[1])), (float(b[0]), float(b[1])), mean_width, True, seg.source
    )


# --- wall faces -----------------------------------------------------------------------------------------


@dataclass(frozen=True)
class _Pair:
    d: float  # distance between the lines
    s0: float  # overlap along the first line
    s1: float


def _pair(a: Segment, b: Segment, d_min: float, d_max: float) -> _Pair | None:
    """The pair geometry of ``a`` and ``b`` under the face rules (angle, distance, overlap), else None."""
    ux, uy, len_a = _unit(a.p0, a.p1)
    vx, vy, len_b = _unit(b.p0, b.p1)
    if abs(ux * vx + uy * vy) < math.cos(math.radians(FACE_ANGLE_DEG)):
        return None
    s0, h0 = _along_and_across(a.p0, a.p1, b.p0)
    s1, h1 = _along_and_across(a.p0, a.p1, b.p1)
    if h0 * h1 <= 0.0:
        return None
    d = abs(h0 + h1) / 2.0
    lo, hi = max(min(s0, s1), 0.0), min(max(s0, s1), len_a)
    if not d_min <= d <= d_max or hi - lo < FACE_OVERLAP * min(len_a, len_b):
        return None
    return _Pair(d, lo, hi)


def _strip_is_wall(a: Segment, b: Segment, pair: _Pair, ink: np.ndarray, centres: np.ndarray) -> bool:
    """The strip between paired lines ``a`` and ``b`` (over the overlap, their own strokes left out) holds
    no label (no text centre lies in it) and is hollow (< 15 % ink) or filled (> 85 %)."""
    ux, uy, _ = _unit(a.p0, a.p1)
    _, side = _along_and_across(a.p0, a.p1, ((b.p0[0] + b.p1[0]) / 2, (b.p0[1] + b.p1[1]) / 2))
    sign = 1.0 if side > 0 else -1.0
    if centres.size:
        rx, ry = centres[:, 0] - a.p0[0], centres[:, 1] - a.p0[1]
        along, across = rx * ux + ry * uy, (-rx * uy + ry * ux) * sign
        if np.any((along >= pair.s0) & (along <= pair.s1) & (across > 0.0) & (across < pair.d)):
            return False
    n = np.array((-uy, ux)) * sign
    lo, hi = a.width_px / 2.0 + 1.0, pair.d - b.width_px / 2.0 - 1.0
    across_px = np.arange(lo, hi + 1e-9, 1.0) if hi >= lo else np.array([pair.d / 2.0])
    along_px = np.linspace(pair.s0, pair.s1, int(min(400, max(5, (pair.s1 - pair.s0) / 2.0))))
    pts = np.array(a.p0) + along_px[:, None, None] * np.array((ux, uy)) + across_px[None, :, None] * n
    q = np.rint(pts.reshape(-1, 2)).astype(np.intp)
    h, w = ink.shape[:2]
    inside = (q[:, 0] >= 0) & (q[:, 0] < w) & (q[:, 1] >= 0) & (q[:, 1] < h)
    if not inside.any():
        return False
    ratio = float((ink[q[inside, 1], q[inside, 0]] > 0).mean())
    return not FACE_HOLLOW_MAX <= ratio <= FACE_FILLED_MIN


def _wall_faces(
    found: Sequence[tuple[Segment, list[tuple[float, bool]]]],
    lines: Sequence[Segment],
    ink: np.ndarray,
    centres: np.ndarray,
    t_thin: float,
    long_side: float,
    text_height: float,
) -> set[int]:
    """Indices into ``found`` of the candidates that pair as a double-line wall face (moved here from the
    walls stage's guard, Task 14b).

    A candidate (a chained line with ticks and a label) is a face when at least 60 % of its length pairs
    (`_pair`, `_strip_is_wall`) with other lines ``p`` of ``lines`` (chained thin lines and bold strokes)
    that are not spoken for (a short face line beside one end of a dimension line does not make it a face):
    ``p`` is not already one line of a closer valid pair over that stretch (`_spoken_for`: a partition's two
    faces pair with each other first, so a dimension line drawn beside a partition stays one). ``p`` may be
    another candidate only when the two are closer than a text height: stacked dimension chains keep their
    labels between them.
    """
    d_min, d_max = FACE_D_MIN_THIN * t_thin, FACE_D_MAX_FRAC * long_side
    min_len = FACE_MIN_LEN_FRAC * long_side
    pool = [ln for ln in lines if ln.length >= min_len]
    cand_ids = {id(c) for c, _ in found}
    mids = np.array([((ln.p0[0] + ln.p1[0]) / 2, (ln.p0[1] + ln.p1[1]) / 2) for ln in pool]).reshape(-1, 2)
    half = np.array([ln.length / 2 for ln in pool])
    reach = d_max + half

    def near(line: Segment) -> list[int]:
        m = ((line.p0[0] + line.p1[0]) / 2, (line.p0[1] + line.p1[1]) / 2)
        dist = np.hypot(mids[:, 0] - m[0], mids[:, 1] - m[1])
        return [int(k) for k in np.flatnonzero(dist <= reach + line.length / 2)]

    def valid(a: Segment, b: Segment) -> _Pair | None:
        pr = _pair(a, b, d_min, d_max)
        return pr if pr is not None and _strip_is_wall(a, b, pr, ink, centres) else None

    faces: set[int] = set()
    for k, (cand, _) in enumerate(found):
        if cand.length < min_len:
            continue
        paired: list[tuple[float, float]] = []  # stretches of the candidate paired as a face
        for j in near(cand):
            p = pool[j]
            if p is cand:
                continue
            pr = valid(cand, p)
            if pr is None or (id(p) in cand_ids and pr.d >= text_height):
                continue
            if not _spoken_for(p, cand, pr.d, pool, near, valid):
                paired.append((pr.s0, pr.s1))
        if _union_length(paired) >= FACE_OVERLAP * cand.length:
            faces.add(k)
    return faces


def _union_length(stretches: list[tuple[float, float]]) -> float:
    total, end = 0.0, -math.inf
    for a, b in sorted(stretches):
        if b > end:
            total += b - max(a, end)
            end = b
    return total


def _spoken_for(
    p: Segment,
    cand: Segment,
    d: float,
    pool: Sequence[Segment],
    near: Callable[[Segment], list[int]],
    valid: Callable[[Segment, Segment], "_Pair | None"],
) -> bool:
    """Whether ``p`` pairs more closely (distance < ``d``) with a line other than ``cand``, on either side,
    over at least half of its stretch facing ``cand`` (the walls stage uses each stretch of a line in one
    pair)."""
    facing = _pair(p, cand, 0.0, math.inf)
    if facing is None:
        return False
    for j in near(p):
        q = pool[j]
        if q is p or q is cand:
            continue
        pr = valid(p, q)
        if pr is None or pr.d >= d:
            continue
        shared = min(pr.s1, facing.s1) - max(pr.s0, facing.s0)
        if shared >= 0.5 * (facing.s1 - facing.s0):
            return True
    return False


# --- dimension lines ----------------------------------------------------------------------------------


def _styled_ticks(marks: Sequence[tuple[float, str]], gap: float) -> list[tuple[float, bool]]:
    """Ticks from the marks of all sources, each with whether it carries a terminator mark: marks within
    ``gap`` (``max(4, 2 line widths)``) are one tick. A line drawn with terminator marks (slashes,
    arrowheads or dots; at least two ticks of those and of walls the line ends at, one of them a mark) takes
    a stroke running through it on both sides as a tick only where it carries such a mark: a crossing door
    jamb, partition face or other dimension line is no tick of it (Task 14b; the fix2 design counts every
    through stroke, which stays right for lines whose ticks are bare extension lines)."""
    styled = _dedupe_ticks([u for u, kind in marks if kind == MARK], gap)
    ends = _dedupe_ticks([u for u, kind in marks if kind in (MARK, WALL)], gap)
    if styled and len(ends) >= 2:
        marks = [(u, kind) for u, kind in marks if kind != THROUGH or any(abs(u - m) <= gap for m in styled)]
    return [(t, any(abs(t - m) <= gap for m in styled)) for t in _dedupe_ticks([u for u, _ in marks], gap)]


def _drop_crossings(
    found: Sequence[tuple[Segment, list[tuple[float, bool]]]],
) -> list[tuple[Segment, list[tuple[float, bool]]]]:
    """Each line without its unmarked ticks where another of the dimension lines crosses or meets it: a
    dimension line is no extension line of another (Task 14b). Marked ticks stay (an extension line with a
    slash there may run along the other line's end)."""
    out = []
    for k, (line, ticks) in enumerate(found):
        ux, uy, _ = _unit(line.p0, line.p1)
        gap = max(TICK_DEDUPE_PX, 2.0 * line.width_px)
        crossings = []
        for j, (other, _) in enumerate(found):
            if j == k:
                continue
            vx, vy, other_len = _unit(other.p0, other.p1)
            if abs(ux * vx + uy * vy) > math.cos(math.radians(90.0 - CROSS_TOL_DEG)):
                continue
            # where the other line's axis meets this one
            s0, h0 = _along_and_across(line.p0, line.p1, other.p0)
            s1, h1 = _along_and_across(line.p0, line.p1, other.p1)
            if h0 == h1:
                continue
            t = h0 / (h0 - h1)  # along the other line, 0..1 inside it
            reach = (gap + other.width_px) / other_len
            if -reach <= t <= 1.0 + reach:
                crossings.append(s0 + t * (s1 - s0))
        kept = [(u, marked) for u, marked in ticks if marked or all(abs(u - c) > gap for c in crossings)]
        out.append((line, kept))
    return out


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


def _vector_lines(
    thin: Sequence[Segment], labels: _Labels, long_side: float, check_deadline: Callable[[], None] | None
) -> list[tuple[Segment, list[float]]]:
    """Candidates without ink (vector pages), best-supported first: each thin segment with a label beside
    it and >= 2 ticks among the other segments (unchanged since Task 14)."""
    lo, hi = TICK_MIN_FRAC * long_side, TICK_MAX_FRAC * long_side
    p0 = np.array([s.p0 for s in thin], np.float64).reshape(-1, 2)
    p1 = np.array([s.p1 for s in thin], np.float64).reshape(-1, 2)
    found = []
    for index, cand in enumerate(thin):
        if check_deadline is not None:
            check_deadline()
        if cand.length < MIN_LINE_FRAC * long_side or not labels.beside(cand):
            continue
        ticks = _dedupe_ticks([u for u, _ in _segment_ticks(cand, [index], p0, p1, lo, hi)], TICK_DEDUPE_PX)
        if len(ticks) >= 2:
            found.append((cand, ticks))
    found.sort(key=lambda f: (-len(f[1]), -f[0].length))  # the best-supported stroke of a duplicate wins
    return found


def _raster_lines(
    segments: Sequence[Segment],
    thin: Sequence[Segment],
    tokens: Sequence[TextToken],
    labels: _Labels,
    ink: np.ndarray,
    gray: np.ndarray | None,
    t_thin: float | None,
    long_side: float,
    check_deadline: Callable[[], None] | None,
) -> list[tuple[Segment, list[float]]]:
    """Candidates on raster pages (Task 14b), best-supported first: the thin pieces chained into lines
    (`_candidate_lines`), each with an oriented label beside it and >= 2 ticks from the segments and the ink
    (`_styled_ticks`); then wall faces are dropped (`_wall_faces`), lines that own no label
    (`_Labels.owners`) and the unmarked ticks where another dimension line crosses (`_drop_crossings`)."""
    lo, hi = TICK_MIN_FRAC * long_side, TICK_MAX_FRAC * long_side
    p0 = np.array([s.p0 for s in thin], np.float64).reshape(-1, 2)
    p1 = np.array([s.p1 for s in thin], np.float64).reshape(-1, 2)
    boxes = np.array([t.box for t in tokens], np.float64).reshape(-1, 4)
    chains = _candidate_lines(thin, _Evidence(ink, gray, boxes), long_side, check_deadline)
    found: list[tuple[Segment, list[tuple[float, bool]]]] = []
    for cand, members in chains:
        if check_deadline is not None:
            check_deadline()
        if cand.length < MIN_LINE_FRAC * long_side or not labels.beside(cand, oriented=True):
            continue
        marks = _segment_ticks(cand, members, p0, p1, lo, hi)
        # A line chained from pieces or run on beyond its piece is drawn into its band (`_draw_pieces`).
        pieces = [(thin[k].p0, thin[k].p1) for k in members]
        whole = len(members) == 1 and cand.length <= thin[members[0]].length + 1.0
        marks += _ink_ticks(cand, ink, long_side, check_deadline, [] if whole else pieces)
        ticks = _styled_ticks(marks, max(TICK_DEDUPE_PX, 2.0 * cand.width_px))
        if len(ticks) >= 2:
            found.append((cand, ticks))
    if not found:
        return []
    width = float(np.median([s.width_px for s in thin])) if t_thin is None else t_thin
    partners = [c for c, _ in chains] + [s for s in segments if not s.is_thin and s.length > 0]
    centres = np.array([_centre(t) for t in tokens], np.float64).reshape(-1, 2)
    faces = _wall_faces(found, partners, ink, centres, width, long_side, float(np.median(labels.height)))
    found = [f for k, f in enumerate(found) if k not in faces]
    owners = labels.owners([c for c, _ in found])
    found = [f for k, f in enumerate(found) if k in owners]
    found = [(c, t) for c, t in _drop_crossings(found) if len(t) >= 2]
    # The best-supported stroke of a duplicate wins: most terminator marks, then most ticks, then longest.
    found.sort(key=lambda f: (-sum(m for _, m in f[1]), -len(f[1]), -f[0].length))
    return [(c, [u for u, _ in t]) for c, t in found]


def find_dimension_lines(
    segments: Sequence[Segment],
    tokens: Sequence[TextToken],
    region: Rect,
    *,
    ink: np.ndarray | None = None,
    gray: np.ndarray | None = None,
    t_thin: float | None = None,
    check_deadline: Callable[[], None] | None = None,
) -> list[DimensionLine]:
    """Dimension lines among the thin segments (06 §8.4 step 1). Runs before wall extraction.

    A candidate is a thin segment of length >= 0.04 L (`L` = long side of `region`) with a numeric token
    (`mm_number`, `metric_length`, `feet_inch`) alongside it within 2.5 text heights, and with >= 2 ticks.
    Ticks come from other thin segments (slash / perpendicular strokes crossing the line in their middle
    80 %, 0.005 L ... 0.03 L long; perpendicular extension lines touching it or crossing it by a few px).
    On raster pages pass the page's `ink` mask as well: ticks are then also found in the ink around the
    line (see `_ink_ticks`; LSD drops strokes shorter than its minimum length, which includes many
    interior ticks), together with dot / arrowhead blobs, and the raster rules of Task 14b apply
    (`_raster_lines`): a candidate is a chain of thin pieces, its label must be written along it and stand
    on it, and wall faces are no dimension lines. Pass a text-free mask (`OcrResult.ink_notext`, not
    `Preprocessed.ink`) so that glyphs touching the line cannot read as ticks; pass the page's `gray` image
    (`Preprocessed.gray`) so that faint lines broken up in the ink are chained and lengthened, and `t_thin`
    (`Preprocessed.t_thin`; default: the median width of the thin segments) for the wall-face distances.
    Ticks closer than 4 px are one tick (`max(4, 2 line widths)` on raster pages). Collinear duplicates of
    one line are dropped. Ids `L1..Ln` follow the (min y, min x, max y, max x) order of the lines.
    `check_deadline` is called for every candidate.
    """
    long_side = float(region.long_side)
    numeric = _numeric(tokens)
    if not numeric or long_side <= 0:
        return []
    labels = _Labels(numeric)
    thin = [s for s in segments if s.is_thin and s.length > 0]
    if ink is None:
        found = _vector_lines(thin, labels, long_side, check_deadline)
    else:
        found = _raster_lines(segments, thin, tokens, labels, ink, gray, t_thin, long_side, check_deadline)
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
    return _axis_of_points(line.p0, line.p1)


def _axis_of_points(p0: Pt, p1: Pt) -> str:
    angle = seg_angle_deg(*p0, *p1)
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
