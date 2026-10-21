"""Dimension lines, dimension spans and heuristic text association (06 §8.4 steps 1-5, §8.1 step 2).

A dimension line is a thin segment with at least two ticks and a numeric label beside it. Ticks come from
three sources: short slanted or perpendicular strokes crossing the line, perpendicular extension lines
touching it, and (raster pages) the ink mask probed along the line. LSD drops strokes shorter than its
minimum length, and the spec's tick length range (0.005 L ... 0.03 L) reaches below that limit
(`max(8 px, 0.008 L)`), so on raster pages the interior ticks are usually only visible in the ink.
"""

import itertools
import math
from collections.abc import Sequence

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
EXTENSION_TOUCH_PX = 2.0  # an extension line touches the dimension line within this distance
TEXT_REACH = 2.5  # a label lies within this many text heights of the line
AXIS_TOL_DEG = 10.0  # x / y axis and text-orientation tolerance
END_SLACK_PX = 6.0  # ticks may sit this far beyond the ends of the (LSD-extended) segment
TICK_DEDUPE_PX = 4.0  # ticks closer than this along the line are one tick

# Ink probing (raster pages).
PROBE_INKED_FRAC = 0.8  # a probe counts as a tick when at least this share of its samples are inked
PROBE_ANGLES_DEG = (
    80.0,
    85.0,
    90.0,
    95.0,
    100.0,
    30.0,
    37.5,
    45.0,
    52.5,
    60.0,
    120.0,
    127.5,
    135.0,
    142.5,
    150.0,
)
PROBE_WIDTH_FACTOR = 3.0  # a probe is at least 3 line widths + 2 px long, so the line itself cannot fill it
PROBE_MARGIN_PX = 2.0
TICK_WIDTH_FACTOR = (
    2.0  # a tick stroke is at most 2 line widths + 2 px thick (a wall crossed at a slant is not)
)
TICK_WIDTH_MARGIN_PX = 2.0
MIN_BALANCE = 0.3  # a tick is centred on the line: the shorter side is >= 30 % of the whole run
CLUSTER_GAP_PX = 3.0  # probe hits closer than this along the line belong to one tick
BLOB_MIN_WIDTHS = 2.5  # a blob is at least this many line widths across
_HIT_CHUNK = 8000
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


def _has_label(line: Segment, numeric: Sequence[TextToken]) -> bool:
    length = line.length
    for token in numeric:
        along, across = _along_and_across(line.p0, line.p1, _centre(token))
        if 0.0 <= along <= length and abs(across) <= TEXT_REACH * token.height_px:
            return True
    return False


# --- ticks from segments ------------------------------------------------------------------------------


def _segment_ticks(line: Segment, index: int, thin: Sequence[Segment], lo: float, hi: float) -> list[float]:
    """Tick positions (px from `line.p0`) of the thin segments crossing or touching `line`."""
    if len(thin) < 2:
        return []
    ux, uy, length = _unit(line.p0, line.p1)
    p0 = np.array([s.p0 for s in thin], np.float64) - np.array(line.p0)
    p1 = np.array([s.p1 for s in thin], np.float64) - np.array(line.p0)
    s0, h0 = p0[:, 0] * ux + p0[:, 1] * uy, -p0[:, 0] * uy + p0[:, 1] * ux
    s1, h1 = p1[:, 0] * ux + p1[:, 1] * uy, -p1[:, 0] * uy + p1[:, 1] * ux
    tick_len = np.hypot(s1 - s0, h1 - h0)
    others = np.arange(len(thin)) != index
    safe_len = np.where(tick_len > 0, tick_len, 1.0)
    angle = np.degrees(np.arccos(np.clip(np.abs(s1 - s0) / safe_len, 0.0, 1.0)))  # to the line, 0..90
    perpendicular = angle >= 90.0 - PERP_TOL_DEG
    slanted = np.abs(angle - 45.0) <= DIAG_TOL_DEG

    crossing = others & (h0 * h1 < 0) & (tick_len >= lo) & (tick_len <= hi) & (perpendicular | slanted)
    u = np.where(crossing, h0 / np.where(h0 != h1, h0 - h1, 1.0), 0.5)
    where = s0 + u * (s1 - s0)
    margin = (1.0 - TICK_MIDDLE) / 2
    crossing &= (
        (u >= margin) & (u <= 1.0 - margin) & (where >= -END_SLACK_PX) & (where <= length + END_SLACK_PX)
    )
    positions = list(np.clip(where[crossing], 0.0, length))

    for s_end, h_end in ((s0, h0), (s1, h1)):  # extension lines: perpendicular, touching within 2 px
        off = s_end - np.clip(s_end, 0.0, length)
        touching = others & perpendicular & (np.hypot(h_end, off) <= EXTENSION_TOUCH_PX) & (tick_len > 0)
        positions += list(np.clip(s_end[touching], 0.0, length))
    return [float(p) for p in positions]


# --- ticks from the ink mask --------------------------------------------------------------------------


def _inked(ink: np.ndarray, xs: np.ndarray, ys: np.ndarray) -> np.ndarray:
    """Ink value at the nearest pixel of each coordinate; outside the image counts as no ink."""
    h, w = ink.shape[:2]
    ix, iy = np.rint(xs).astype(np.intp), np.rint(ys).astype(np.intp)
    inside = (ix >= 0) & (ix < w) & (iy >= 0) & (iy < h)
    out = np.zeros(xs.shape, bool)
    out[inside] = ink[iy[inside], ix[inside]] > 0
    return out


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


def _cluster(positions: np.ndarray, gap: float) -> list[float]:
    """Means of the groups of sorted `positions` whose neighbours are at most `gap` apart."""
    if positions.size == 0:
        return []
    ordered = np.sort(positions)
    groups = np.split(ordered, np.flatnonzero(np.diff(ordered) > gap) + 1)
    return [float(g.mean()) for g in groups]


def _ink_ticks(line: Segment, ink: np.ndarray, lo: float, hi: float) -> list[float]:
    """Tick positions found by probing the ink along `line` (spec tick geometry, one probe per position).

    At every position along the line, probes run through it at 90 +- 10 and 45 +- 15 degrees to the line.
    A probe is `max(0.005 L, 3 line widths + 2 px)` long, centred on the line, and counts when at least
    80 % of its samples are inked. For each such probe the full ink run through the centre is then
    measured: it must be 0.005 L ... 0.03 L long and roughly centred (a longer run is a wall or an
    extension line crossing the dimension line, not a tick), and the stroke must be thin near both probe
    ends (a thick wall cut at a slant also yields a short diagonal run).
    """
    ux, uy, length = _unit(line.p0, line.p1)
    probe = max(lo, PROBE_WIDTH_FACTOR * line.width_px + PROBE_MARGIN_PX)
    if probe > hi:
        return []
    along = np.arange(-END_SLACK_PX, length + END_SLACK_PX + 0.5, 1.0)
    phi = np.radians(PROBE_ANGLES_DEG)
    ex, ey = np.cos(phi) * ux - np.sin(phi) * uy, np.cos(phi) * uy + np.sin(phi) * ux  # probe directions
    short = np.arange(-math.ceil(probe / 2), math.ceil(probe / 2) + 1.0)
    reach = math.ceil(hi)
    long = np.arange(-reach, reach + 1.0)
    max_width = TICK_WIDTH_FACTOR * line.width_px + TICK_WIDTH_MARGIN_PX
    side = np.arange(-math.ceil(max_width) - 1, math.ceil(max_width) + 2.0)

    accepted: list[float] = []
    for start in range(0, len(along), _POS_CHUNK):
        s = along[start : start + _POS_CHUNK]
        cx, cy = line.p0[0] + s * ux, line.p0[1] + s * uy
        xs = cx[:, None, None] + short[None, None, :] * ex[None, :, None]
        ys = cy[:, None, None] + short[None, None, :] * ey[None, :, None]
        hit_pos, hit_angle = np.nonzero(_inked(ink, xs, ys).mean(axis=2) >= PROBE_INKED_FRAC)
        for h in range(0, len(hit_pos), _HIT_CHUNK):
            pos, ang = hit_pos[h : h + _HIT_CHUNK], hit_angle[h : h + _HIT_CHUNK]
            xs = cx[pos][:, None] + long[None, :] * ex[ang][:, None]
            ys = cy[pos][:, None] + long[None, :] * ey[ang][:, None]
            left, right = _runs_through_centre(_inked(ink, xs, ys))
            total = left + right - 1
            ok = (total >= lo) & (total <= hi) & (np.minimum(left, right) >= MIN_BALANCE * total)
            pos, ang = pos[ok], ang[ok]
            for sign in (-1.0, 1.0):  # a tick is a thin stroke: no wider than the line near both probe ends
                px = cx[pos] + sign * (probe / 2) * ex[ang]
                py = cy[pos] + sign * (probe / 2) * ey[ang]
                xs = px[:, None] - side[None, :] * ey[ang][:, None]
                ys = py[:, None] + side[None, :] * ex[ang][:, None]
                left, right = _runs_through_centre(_inked(ink, xs, ys))
                thin_enough = (left + right - 1) <= max_width
                pos, ang = pos[thin_enough], ang[thin_enough]
            accepted += s[pos].tolist()
    return _cluster(np.array(accepted), CLUSTER_GAP_PX)


def _ink_blobs(line: Segment, ink: np.ndarray, blob_max: float) -> list[float]:
    """Dot / arrowhead blobs on the line: short stretches where the ink across the line is wider than the
    line but no wider than a blob of area <= (0.006 L)^2 (equal-area diameter `blob_max`)."""
    ux, uy, length = _unit(line.p0, line.p1)
    blob_min = max(BLOB_MIN_WIDTHS * line.width_px, 4.0)
    if blob_min > blob_max:
        return []
    along = np.arange(-END_SLACK_PX, length + END_SLACK_PX + 0.5, 1.0)
    reach = math.ceil(blob_max) + 1
    across = np.arange(-reach, reach + 1.0)
    cx, cy = line.p0[0] + along * ux, line.p0[1] + along * uy
    xs = cx[:, None] - across[None, :] * uy
    ys = cy[:, None] + across[None, :] * ux
    left, right = _runs_through_centre(_inked(ink, xs, ys))
    width = left + right - 1
    candidate = (width >= blob_min) & (width <= blob_max)
    positions: list[float] = []
    idx = np.flatnonzero(candidate)
    for group in np.split(idx, np.flatnonzero(np.diff(idx) > 1) + 1) if idx.size else []:
        if group.size <= blob_max + 1:
            positions.append(float(along[group].mean()))
    return positions


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
) -> list[DimensionLine]:
    """Dimension lines among the thin segments (06 §8.4 step 1). Runs before wall extraction.

    A candidate is a thin segment of length >= 0.04 L (`L` = long side of `region`) with a numeric token
    (`mm_number`, `metric_length`, `feet_inch`) alongside it within 2.5 text heights, and with >= 2 ticks.
    Ticks come from other thin segments (slash / perpendicular strokes crossing the line in their middle
    80 %, 0.005 L ... 0.03 L long; perpendicular extension lines touching it within 2 px). On raster pages
    pass the page's `ink` mask as well: ticks are then also found by probing the ink along the line (LSD
    drops strokes shorter than its minimum length, which includes many interior ticks), together with dot
    blobs. Ticks closer than 4 px are one tick. Collinear duplicates of one line are dropped. Ids `L1..Ln`
    follow the (min y, min x, max y, max x) order of the lines.
    """
    long_side = float(region.long_side)
    numeric = _numeric(tokens)
    if not numeric or long_side <= 0:
        return []
    lo, hi = TICK_MIN_FRAC * long_side, TICK_MAX_FRAC * long_side
    blob_max = 2.0 * BLOB_AREA_FRAC * long_side / math.sqrt(math.pi)
    thin = [s for s in segments if s.is_thin and s.length > 0]
    found: list[tuple[Segment, list[float]]] = []
    for index, cand in enumerate(thin):
        if cand.length < MIN_LINE_FRAC * long_side or not _has_label(cand, numeric):
            continue
        ticks = _segment_ticks(cand, index, thin, lo, hi)
        if ink is not None:
            ticks += _ink_ticks(cand, ink, lo, hi) + _ink_blobs(cand, ink, blob_max)
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
    line. Ids `D1..Dn` run over the lines in id order: chain spans left to right, then the overall span.
    `region` is part of the stage interface (06 §8.4) and is not needed here: all rules are in pixels and
    text heights.
    """
    del region
    numeric = _numeric(tokens)
    spans: list[DimensionSpan] = []
    for line in sorted(lines, key=lambda ln: ln.id):
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
    best: dict[str, tuple[float, float, str]] = {}
    for span in spans:
        length = math.dist(span.p0, span.p1)
        for text_id in span.near_text_ids:
            token = by_id.get(text_id)
            if token is None:
                continue
            along, _ = _along_and_across(span.p0, span.p1, _centre(token))
            key = (round(abs(along - length / 2), 6), length, span.id)
            if text_id not in best or key < best[text_id]:
                best[text_id] = key
    return {text_id: key[2] for text_id, key in best.items()}
