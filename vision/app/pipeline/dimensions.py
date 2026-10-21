"""Dimension lines, dimension spans and heuristic text association (06 §8.4 steps 1-5, §8.1 step 2).

A dimension line is a thin segment with at least two ticks and a numeric label beside it. Ticks come from
three sources: short slanted or perpendicular strokes crossing the line, perpendicular extension lines
touching it, and (raster pages) the ink mask probed along the line. LSD drops strokes shorter than its
minimum length, and the spec's tick length range (0.005 L ... 0.03 L) reaches below that limit
(`max(8 px, 0.008 L)`), so on raster pages the interior ticks are usually only visible in the ink.
"""

import itertools
import math
from collections.abc import Callable, Sequence

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

# Ink probing (raster pages).
PROBE_INKED_FRAC = 0.8  # a probe counts as a tick when at least this share of its samples are inked
PERPENDICULAR_PROBES = (80.0, 85.0, 90.0, 95.0, 100.0)  # 90 +- 10
PROBE_ANGLES_DEG = (
    *PERPENDICULAR_PROBES,
    *(30.0, 37.5, 45.0, 52.5, 60.0),  # slash, 45 +- 15
    *(120.0, 127.5, 135.0, 142.5, 150.0),  # backslash, 135 +- 15
)
PROBE_WIDTH_FACTOR = 3.0  # a probe is at least 3 line widths + 2 px long, so the line itself cannot fill it
PROBE_MARGIN_PX = 2.0
TICK_WIDTH_FACTOR = (
    2.0  # a tick stroke is at most 2 line widths + 2 px thick (a wall crossed at a slant is not)
)
TICK_WIDTH_MARGIN_PX = 2.0
MIN_BALANCE = 0.3  # a tick is centred on the line: the shorter side is >= 30 % of the whole run
CLUSTER_GAP_PX = 3.0  # probe hits closer than this along the line belong to one tick
PREFILTER_OFFSET_PX = 2.5  # ink must exist this far (+ half the line width) beside the line to probe there
MAX_BUSY_FRAC = 0.6  # ink beside more than this share of a line: it is not probed for ticks
MIN_CLUSTER = 2  # accepted probe positions (1 px apart) that make a tick
GUARD_PX = 2  # a stroke passing through the line within this many px of a tick position disqualifies it
BLOB_EXTRA_PX = 6.0  # a blob is at least this much wider than the line
BLOB_ASPECT = 0.5  # ... and at least half as long along the line as it is wide (a short stroke is no dot)
_HIT_CHUNK = 1000
_POS_CHUNK = 512


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


def _inked(ink: np.ndarray, xs: np.ndarray, ys: np.ndarray) -> np.ndarray:
    """Ink value at the nearest pixel of each coordinate; outside the image counts as no ink."""
    h, w = ink.shape[:2]
    ix, iy = (xs + 0.5).astype(np.intp), (ys + 0.5).astype(np.intp)
    inside = (ix >= 0) & (ix < w) & (iy >= 0) & (iy < h)
    np.clip(ix, 0, w - 1, out=ix)
    np.clip(iy, 0, h - 1, out=iy)
    return np.asarray((ink.ravel()[iy * w + ix] > 0) & inside, bool)


def _runs_through_centre(inked: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Inked run lengths (samples, centre included) towards both ends of rows sampled around a centre.

    Single-sample gaps are bridged (ragged scan edges). The centre is the middle column.
    """
    bridged = inked.copy()
    bridged[:, 1:-1] |= inked[:, :-2] & inked[:, 2:]
    c = inked.shape[1] // 2
    left = np.cumprod(bridged[:, c::-1], axis=1).sum(axis=1)
    right = np.cumprod(bridged[:, c:], axis=1).sum(axis=1)
    return left, right


def _groups(positions: np.ndarray, gap: float) -> list[np.ndarray]:
    """Groups of sorted `positions` whose neighbours are at most `gap` apart."""
    if positions.size == 0:
        return []
    ordered = np.sort(positions)
    return np.split(ordered, np.flatnonzero(np.diff(ordered) > gap) + 1)


def _cluster(positions: np.ndarray, gap: float) -> list[float]:
    return [float(g.mean()) for g in _groups(positions, gap)]


def _probed_positions(line: Segment, ink: np.ndarray, window: float) -> np.ndarray:
    """Positions along `line` (1 px apart, from `-END_SLACK_PX`) with ink beside the line within `window`.

    Ticks, extension lines and blobs all have ink off to the side of the line. Positions where neither
    side has any (the usual case along a clean line) need no probing. A line with such ink beside more
    than 60 % of its length (a wall edge, hatching, a line inside a dense drawing) is no dimension line
    to probe: nothing is returned for it.
    """
    ux, uy, length = _unit(line.p0, line.p1)
    along = np.arange(-END_SLACK_PX, length + END_SLACK_PX + 0.5, 1.0)
    cx, cy = line.p0[0] + along * ux, line.p0[1] + along * uy
    off = line.width_px / 2 + PREFILTER_OFFSET_PX
    reach = math.ceil(window)
    index = np.arange(len(along))
    near = np.zeros(len(along), bool)
    for sign in (-1.0, 1.0):
        inked = _inked(ink, cx - sign * off * uy, cy + sign * off * ux)
        total = np.concatenate([[0], np.cumsum(inked)])
        near |= (total[np.minimum(index + reach + 1, len(along))] - total[np.maximum(index - reach, 0)]) > 0
    if near.mean() > MAX_BUSY_FRAC:
        return along[:0]
    return along[near]


def _ink_ticks(
    line: Segment,
    ink: np.ndarray,
    lo: float,
    hi: float,
    along: np.ndarray,
    check_deadline: Callable[[], None] | None,
) -> list[float]:
    """Tick positions found by probing the ink at the given `along` positions of `line`.

    At every position, probes run through the line at 90 +- 10 and 45 +- 15 degrees. A probe is
    `max(0.005 L, 3 line widths + 2 px)` long, centred on the line, and counts when at least 80 % of its
    samples are inked (a perpendicular probe also when one of its halves is, for extension lines that end at
    the dimension line). For each such probe the full ink run through the centre is then measured (single
    gaps bridged) and the position is a tick when
    - the run is 0.005 L ... 0.03 L long and roughly centred (shorter side >= 30 %), or
    - the run is along a perpendicular probe and ends within 14 px on one side: an extension line of any
      length touching the line or crossing it by a few px;
    where the run is taken along the probe angle with the longest run at that position (the stroke's own
    direction), and the stroke is thin (<= 2.5 line widths + 2 px) half way along its arm(s) (a thick wall
    or a big dot cut at a slant also give a short diagonal run).
    Positions are clustered; a lone position is a fluke at a stroke's edge. Finally a stroke that passes
    through the line within 2 px of the tick at *any* probe angle with more than 14 px on both sides and
    a total beyond 0.03 L is a wall or a long line crossing the dimension line, not a tick (a tilted
    probe leaves a thin long stroke after a few px, so the run along the probe alone cannot tell).
    """
    ux, uy, _ = _unit(line.p0, line.p1)
    probe = max(lo, PROBE_WIDTH_FACTOR * line.width_px + PROBE_MARGIN_PX)
    if probe > hi or along.size == 0:
        return []
    phi = np.radians(PROBE_ANGLES_DEG)
    ex, ey = np.cos(phi) * ux - np.sin(phi) * uy, np.cos(phi) * uy + np.sin(phi) * ux  # probe directions
    perpendicular = np.arange(len(phi)) < len(PERPENDICULAR_PROBES)
    short = np.arange(-math.ceil(probe / 2), math.ceil(probe / 2) + 1.0)
    reach = math.ceil(hi)
    long = np.arange(-reach, reach + 1.0)
    max_width = TICK_WIDTH_FACTOR * line.width_px + TICK_WIDTH_MARGIN_PX
    side = np.arange(-math.ceil(max_width) - 1, math.ceil(max_width) + 2.0)

    min_side = 1.5 * line.width_px + 4.0  # clear of the line's own ink even at the shallowest probe angle

    def thin_at(cx: np.ndarray, cy: np.ndarray, ang: np.ndarray, dist: np.ndarray) -> np.ndarray:
        """Whether a stroke at most `max_width` thick crosses the probe `dist` from its centre."""
        px, py = cx + dist * ex[ang], cy + dist * ey[ang]
        xs = px[:, None] - side[None, :] * ey[ang][:, None]
        ys = py[:, None] + side[None, :] * ex[ang][:, None]
        left, right = _runs_through_centre(_inked(ink, xs, ys))
        present = (left > 0) & (right > 0)  # the probe still runs along a stroke there
        return np.asarray(present & ((left + right - 1) <= max_width), bool)

    def thin_arm(cx: np.ndarray, cy: np.ndarray, ang: np.ndarray, arm: np.ndarray, sign: float) -> np.ndarray:
        """Thin-stroke check half way along an arm of `arm` samples (arms shorter than the line's own ink
        are not judged)."""
        measured = arm >= min_side
        dist = np.minimum(arm - 1.0, np.maximum(min_side, arm / 2))
        return np.asarray(~measured | thin_at(cx, cy, ang, sign * dist), bool)

    accepted: list[float] = []
    for start in range(0, len(along), _POS_CHUNK):
        if check_deadline is not None:
            check_deadline()
        s = along[start : start + _POS_CHUNK]
        cx, cy = line.p0[0] + s * ux, line.p0[1] + s * uy
        xs = cx[:, None, None] + short[None, None, :] * ex[None, :, None]
        ys = cy[:, None, None] + short[None, None, :] * ey[None, :, None]
        samples = _inked(ink, xs, ys)
        middle = samples.shape[2] // 2
        hits = samples.mean(axis=2) >= PROBE_INKED_FRAC
        for half in (samples[:, :, : middle + 1], samples[:, :, middle:]):  # a one-sided extension line
            hits |= perpendicular[None, :] & (half.mean(axis=2) >= PROBE_INKED_FRAC)
        hit_positions = np.flatnonzero(hits.any(axis=1))
        for h in range(0, len(hit_positions), _HIT_CHUNK):
            if check_deadline is not None:
                check_deadline()
            pos = hit_positions[h : h + _HIT_CHUNK]
            xs = cx[pos][:, None, None] + long[None, None, :] * ex[None, :, None]
            ys = cy[pos][:, None, None] + long[None, None, :] * ey[None, :, None]
            runs_left, runs_right = _runs_through_centre(_inked(ink, xs, ys).reshape(-1, len(long)))
            runs_left, runs_right = runs_left.reshape(len(pos), -1), runs_right.reshape(len(pos), -1)
            best = np.argmax(runs_left + runs_right, axis=1)  # the stroke's own direction
            rows = np.arange(len(pos))
            left, right = runs_left[rows, best], runs_right[rows, best]
            total = left + right - 1
            body = (total >= lo) & (total <= hi) & (np.minimum(left, right) >= MIN_BALANCE * total)
            stub = (np.minimum(left, right) - 1 <= EXTENSION_OVERSHOOT_PX) & (
                np.maximum(left, right) > lo / 2
            )
            ok = body | (perpendicular[best] & stub)
            if not ok.any():
                continue
            pos, best, left, right, body = pos[ok], best[ok], left[ok], right[ok], body[ok]
            thin_minus = thin_arm(cx[pos], cy[pos], best, left - 1.0, -1.0)
            thin_plus = thin_arm(cx[pos], cy[pos], best, right - 1.0, 1.0)
            thin = np.where(body, thin_minus & thin_plus, np.where(left >= right, thin_minus, thin_plus))
            accepted += s[pos[thin]].tolist()

    ticks = []
    for group in _groups(np.array(accepted), CLUSTER_GAP_PX):
        if (
            group.size < MIN_CLUSTER
        ):  # a stroke is several px wide: a lone position is a probe fluke at its edge
            continue
        if check_deadline is not None:
            check_deadline()
        if not _passes_through(
            line, ink, np.arange(group.min() - GUARD_PX, group.max() + GUARD_PX + 1.0), hi, ex, ey, long
        ):
            ticks.append(float(group.mean()))
    return ticks


def _passes_through(
    line: Segment,
    ink: np.ndarray,
    along: np.ndarray,
    hi: float,
    ex: np.ndarray,
    ey: np.ndarray,
    long: np.ndarray,
) -> bool:
    """Whether at one of the `along` positions a stroke in a probe direction runs through the line: a
    total beyond `hi` and more than `EXTENSION_OVERSHOOT_PX` on both sides."""
    ux, uy, _ = _unit(line.p0, line.p1)
    cx, cy = line.p0[0] + along * ux, line.p0[1] + along * uy
    xs = cx[:, None, None] + long[None, None, :] * ex[None, :, None]
    ys = cy[:, None, None] + long[None, None, :] * ey[None, :, None]
    shape = xs.shape
    left, right = _runs_through_centre(_inked(ink, xs.reshape(-1, shape[2]), ys.reshape(-1, shape[2])))
    through = (left + right - 1 > hi) & (np.minimum(left, right) - 1 > EXTENSION_OVERSHOOT_PX)
    return bool(through.any())


def _ink_blobs(line: Segment, ink: np.ndarray, blob_max: float, along: np.ndarray) -> list[float]:
    """Dot / arrowhead blobs on the line: short stretches where the ink across the line is clearly wider
    than the line (>= width + 6 px) but no wider than a blob of area <= (0.006 L)^2 (equal-area diameter
    `blob_max`). `along` are the positions to look at."""
    ux, uy, _ = _unit(line.p0, line.p1)
    blob_min = line.width_px + BLOB_EXTRA_PX
    if blob_min > blob_max or along.size == 0:
        return []
    reach = math.ceil(blob_max) + 1
    across = np.arange(-reach, reach + 1.0)
    cx, cy = line.p0[0] + along * ux, line.p0[1] + along * uy
    xs = cx[:, None] - across[None, :] * uy
    ys = cy[:, None] + across[None, :] * ux
    left, right = _runs_through_centre(_inked(ink, xs, ys))
    width = left + right - 1
    keep = (width >= blob_min) & (width <= blob_max)
    positions, widths = along[keep], width[keep]
    blobs: list[float] = []
    for group in np.split(np.arange(len(positions)), np.flatnonzero(np.diff(positions) > 1.5) + 1):
        if group.size == 0:
            continue
        extent = positions[group].max() - positions[group].min() + 1
        if BLOB_ASPECT * widths[group].max() <= extent <= blob_max + 1:  # about as long as wide
            blobs.append(float(positions[group].mean()))
    return blobs


# --- dimension lines ----------------------------------------------------------------------------------


def _dedupe_ticks(positions: Sequence[float]) -> list[float]:
    return _cluster(np.array(sorted(positions)), TICK_DEDUPE_PX)


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
    On raster pages pass the page's `ink` mask as well: ticks are then also found by probing the ink
    along the line (LSD drops strokes shorter than its minimum length, which includes many interior
    ticks), together with dot blobs. Pass a text-free mask (`OcrResult.ink_notext`, not `Preprocessed.ink`)
    so that glyphs next to the line cannot read as ticks. Ticks closer than 4 px are one tick. Collinear
    duplicates of one line are dropped. Ids `L1..Ln` follow the (min y, min x, max y, max x) order of the
    lines. `check_deadline` is called for every candidate and while probing the ink.
    """
    long_side = float(region.long_side)
    numeric = _numeric(tokens)
    if not numeric or long_side <= 0:
        return []
    labels = _Labels(numeric)
    lo, hi = TICK_MIN_FRAC * long_side, TICK_MAX_FRAC * long_side
    blob_max = 2.0 * BLOB_AREA_FRAC * long_side / math.sqrt(math.pi)
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
            window = math.ceil(max(hi, blob_max) / 2) + 2
            along = _probed_positions(cand, ink, window)
            ticks += _ink_ticks(cand, ink, lo, hi, along, check_deadline)
            ticks += _ink_blobs(cand, ink, blob_max, along)
        ticks = _dedupe_ticks(ticks)
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
