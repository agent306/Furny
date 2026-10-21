"""Wall extraction (06 §8.1 steps 1-8): wall masks, skeleton tracing and raw wall centre lines.

``extract_walls`` builds the wall mask ``W`` of the plan region from

1. filled walls: the thick-ink mask, with wide solid walls that Sauvola hollowed out (a uniform dark
   area thresholds as background, so an 80 px wall on a 3000 px page arrives as two ~25 px bands) closed
   again where the hole between the bands is as dark as the bands; on ``pdf_vector`` pages also the dark
   filled polygons and the stroked segments at least ``2.5 t_thin`` wide (``source = vector``);
2. (dimension lines of 06 §8.4 step 1 never take part);
3. double-line walls: pairs of parallel thin segments whose strip is hollow or filled;
4. single-line walls, only for sketches (fill and double masks cover < 0.2 % of the region);

then (5) closes it, (6) skeletonises it and traces the 8-neighbourhood pixel graph into straight pieces,
(7) snaps them onto the dominant orientation ``theta0`` (short off-axis pieces are dropped) and (8) merges
collinear pieces into one raw wall per wall run: tiny breaks close, empty gaps of ``2.5 t .. 18 t``
between walls of similar thickness become ``openings_px`` of that raw wall. A thin piece that leaves a
gap's jamb and is as long as the gap is wide (``0.8 g .. 1.1 g``) is a door leaf, not a wall.

``walls_to_graph`` snaps the raw walls into the wall graph (``graph.py``); its ``gaps`` are the gap
candidates. This module talks to later stages only through ``app.schemas.candidates`` types and plain
arrays (06 I12).
"""

import itertools
import math
import time
from collections import defaultdict
from collections.abc import Callable, Sequence
from dataclasses import dataclass

import cv2
import numpy as np
from skimage.morphology import skeletonize

from app.pipeline.binarize import Preprocessed, sauvola_window
from app.pipeline.context import PipelineContext
from app.pipeline.graph import build_wall_graph
from app.pipeline.normalize import NormalizedPage
from app.pipeline.segments import dominant_orientation
from app.schemas.candidates import DimensionLine, RawWall, Segment, WallGraph, WallSource
from app.utils.geometry import Pt, Rect

__all__ = [
    "WallExtraction",
    "debug_walls_png",
    "dedupe_raw_walls",
    "extract_walls",
    "walls_to_graph",
]

# `source_mask` labels. 06 names filled/double/single; vector walls get their own label so that the
# pixels of a `pdf_vector` page's walls can be told apart from the raster thick mask.
SRC_FILLED, SRC_DOUBLE, SRC_SINGLE, SRC_VECTOR = 1, 2, 3, 4
_SOURCES: dict[int, WallSource] = {
    SRC_FILLED: "filled",
    SRC_DOUBLE: "double_line",
    SRC_SINGLE: "single_line",
    SRC_VECTOR: "vector",
}
_SOURCE_RANK: dict[WallSource, int] = {"filled": 0, "vector": 1, "double_line": 2, "single_line": 3}

VECTOR_WALL_FACTOR = 2.5  # stroked vector segments at least this many t_thin wide are walls
DOUBLE_MIN_LEN_FRAC = 0.02  # of L
DOUBLE_ANGLE_DEG = 2.0
DOUBLE_D_MIN_FRAC, DOUBLE_D_MAX_FRAC = 0.004, 0.03  # line distance, fractions of L
DOUBLE_OVERLAP = 0.6  # of the shorter segment
HOLLOW_MAX, FILLED_MIN = 0.15, 0.85  # ink share of the strip between the two lines
DOUBLE_CLAIM_TOL_PX = 1.0  # claims of one segment side may touch by this much
SINGLE_COVERAGE = 0.002  # sketches: fill and double masks cover less than this share of the region
SINGLE_MIN_LEN_FRAC = 0.05
SINGLE_WIDTH_FACTOR = 3.0  # sketch lines are drawn 3 x t_thin wide
HOLE_FILL_FRAC = 0.01  # holes in W smaller than (0.01 L)^2 are filled (no pixel loops in the skeleton)
SPUR_FACTOR = 1.5  # spurs shorter than 1.5 x the local thickness are pruned
EPS_MIN, EPS_FACTOR = 1.5, 0.25  # approxPolyDP epsilon = max(1.5, 0.25 x median thickness)
SNAP_DEG = 3.0
DIAGONAL_MIN_FRAC = 0.03  # off-axis pieces at least 0.03 L long are diagonal walls
MERGE_OFFSET = 0.5  # collinear: perpendicular offset <= 0.5 t ...
MERGE_OFFSET_MIN_PX = 1.5  # ... but at least this (skeleton jitter)
MERGE_GAP = 1.5  # gaps up to 1.5 t close
GAP_MIN, GAP_MAX = 2.5, 18.0  # gap candidates: 2.5 t <= g <= 18 t
SIMILAR_THICKNESS = 1.5  # thickness ratio of the two walls beside a gap candidate
GAP_WALL_MAX = 0.1  # a gap whose centre line is more than 10 % wall is crossed by a wall: no opening
LEAF_MIN, LEAF_MAX = 0.8, 1.1  # door leaf length, fractions of the gap width
LEAF_MIN_ANGLE_DEG = 30.0  # a leaf leaves its wall at least this steeply
DUPLICATE_ANGLE_DEG = 1.0
SNAP_RADIUS_FRAC = 0.006  # graph snap radius r = max(t_median, 0.006 L)

_POLL_SECONDS = 0.02  # deadline polls reach the real check at most this often
_MAX_SAMPLES = 400_000  # vectorised work per block between polls
_WALK_POLL = 4096  # pixel steps between polls in the tracer
_ANGLE_BUCKET_DEG = 2.0
_MARCH_STEP = 0.5
_NB8 = ((-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1))
_NB_KERNEL = np.array([[1, 1, 1], [1, 0, 1], [1, 1, 1]], np.float32)

Check = Callable[[], None]


@dataclass(frozen=True, eq=False)
class WallExtraction:
    """Wall masks (page sized, uint8) and raw wall centre lines in page pixels.

    ``mask`` is 255 on wall pixels; ``source_mask`` labels them 1 = filled, 2 = double line,
    3 = single line, 4 = vector. ``theta0`` is the dominant orientation in degrees [0, 90) and
    ``t_median`` the length-weighted median raw wall thickness.
    """

    mask: np.ndarray
    source_mask: np.ndarray
    raw: list[RawWall]
    theta0: float
    t_median: float


def _throttled(check: Check) -> Check:
    """``check`` wrapped so that it runs at most every ``_POLL_SECONDS`` (the first call always runs)."""
    last = -math.inf

    def poll() -> None:
        nonlocal last
        now = time.perf_counter()
        if now - last >= _POLL_SECONDS:
            last = now
            check()

    return poll


# --- step 2: candidate segments ------------------------------------------------------------------------


def _wall_candidates(segments: Sequence[Segment], dimension_lines: Sequence[DimensionLine]) -> list[Segment]:
    """Segments minus dimension lines (06 §8.1 step 2), including collinear copies of a dimension line."""
    dim_ids = {d.segment_id for d in dimension_lines}
    out: list[Segment] = []
    for s in segments:
        if s.id in dim_ids or (s.is_thin and any(_on_line(s, d) for d in dimension_lines)):
            continue
        out.append(s)
    return out


def _on_line(s: Segment, d: DimensionLine) -> bool:
    """``s`` lies on the dimension line ``d``: within 2 px of its line and inside its extent."""
    dx, dy = d.p1[0] - d.p0[0], d.p1[1] - d.p0[1]
    length = math.hypot(dx, dy)
    if length == 0.0:
        return False
    ux, uy = dx / length, dy / length
    for p in (s.p0, s.p1):
        rx, ry = p[0] - d.p0[0], p[1] - d.p0[1]
        along = rx * ux + ry * uy
        if abs(-rx * uy + ry * ux) > 2.0 or along < -2.0 or along > length + 2.0:
            return False
    return True


# --- steps 1, 3, 4: wall masks -------------------------------------------------------------------------


def _filled_mask(pre: Preprocessed, crop: Rect, long_edge: int) -> np.ndarray:
    """``thick`` with Sauvola holes closed: pixels between thick bands at most one Sauvola window apart
    that are as dark as the bands (below the midpoint of wall grey and paper grey).

    Brochures take ``thick`` from the colour mask, which Sauvola never hollowed, so they are left alone.
    """
    ys, xs = slice(crop.y, crop.y + crop.h), slice(crop.x, crop.x + crop.w)
    thick = pre.thick[ys, xs].copy()
    if pre.drawing_kind == "colored_brochure" or not thick.any():
        return thick
    win = sauvola_window(long_edge)
    closed = cv2.morphologyEx(thick, cv2.MORPH_CLOSE, np.ones((win, win), np.uint8))
    holes = (closed > 0) & (thick == 0)
    if not holes.any():
        return thick
    gray = pre.gray[ys, xs]
    paper = pre.ink[ys, xs] == 0
    if not paper.any():
        return thick
    wall_grey = float(np.median(gray[thick > 0]))
    paper_grey = float(np.median(gray[paper]))
    if paper_grey - wall_grey < 30.0:  # no contrast to tell a dark hole from paper
        return thick
    thick[holes & (gray <= (wall_grey + paper_grey) / 2.0)] = 255
    return thick


def _quad(
    mask: np.ndarray, p0: np.ndarray, p1: np.ndarray, width: float, offset: tuple[float, float] = (0, 0)
) -> None:
    """Fill the butt-ended strip of ``width`` around ``p0``-``p1`` (crop coordinates) into ``mask``."""
    d = p1 - p0
    length = float(np.hypot(d[0], d[1]))
    if length < 1e-9:
        return
    n = np.array((-d[1], d[0])) / length * (width / 2.0)
    o = np.asarray(offset, np.float64)
    poly = np.array([p0 + n - o, p1 + n - o, p1 - n - o, p0 - n - o])
    cv2.fillPoly(mask, [np.round(poly * 16).astype(np.int32)], 255, cv2.LINE_8, 4)


def _vector_mask(page: NormalizedPage, cands: Sequence[Segment], t_thin: float, crop: Rect) -> np.ndarray:
    """Dark filled vector polygons and stroked vector segments at least ``2.5 t_thin`` wide."""
    mask = np.zeros((crop.h, crop.w), np.uint8)
    origin = np.array((crop.x, crop.y), np.float64)
    for s in cands:
        if s.source == "vector" and s.width_px >= VECTOR_WALL_FACTOR * t_thin:
            _quad(mask, np.asarray(s.p0) - origin, np.asarray(s.p1) - origin, s.width_px)
    vector = page.vector
    if vector is not None and vector.filled:
        a = np.asarray(page.transform, np.float64)
        for poly in vector.filled:
            pts = np.array([(x, y, 1.0) for x, y in poly.points], np.float64) @ a.T
            xy = pts[:, :2] / pts[:, 2:3] - origin
            cv2.fillPoly(mask, [np.round(xy * 16).astype(np.int32)], 255, cv2.LINE_8, 4)
    return mask


@dataclass(frozen=True, slots=True)
class _Pair:
    i: int
    j: int
    d: float
    overlap: float


def _double_mask(cands: Sequence[Segment], ink: np.ndarray, crop: Rect, L: float, poll: Check) -> np.ndarray:
    """Quadrilaterals between paired parallel thin lines (06 §8.1 step 3).

    Pairs: angle difference <= 2 degrees, distance ``d`` in ``[0.004 L, 0.03 L]``, projection overlap
    >= 60 % of the shorter segment and a hollow (< 15 % ink) or filled (> 85 %) strip. Greedy by ``d``
    ascending, then overlap descending. Each side of a segment is used once per stretch of its length (a
    face line broken by a T junction pairs with both pieces of the opposite face). A quad is extended by
    ``d / 2`` at an end where one of its lines runs on (a corner or junction), not where both stop (a
    door jamb), so corners close without narrowing openings.
    """
    mask = np.zeros((crop.h, crop.w), np.uint8)
    thin = [s for s in cands if s.is_thin and s.length >= DOUBLE_MIN_LEN_FRAC * L]
    if len(thin) < 2:
        return mask
    origin = np.array((crop.x, crop.y), np.float64)
    p0 = np.array([s.p0 for s in thin], np.float64) - origin
    p1 = np.array([s.p1 for s in thin], np.float64) - origin
    width = np.array([s.width_px for s in thin], np.float64)
    length = np.hypot(*(p1 - p0).T)
    unit = (p1 - p0) / length[:, None]
    d_min, d_max = DOUBLE_D_MIN_FRAC * L, DOUBLE_D_MAX_FRAC * L

    pairs = _pair_candidates(p0, p1, length, unit, d_min, d_max, poll)
    if not pairs:
        return mask
    pairs.sort(key=lambda p: (p.d, -p.overlap, p.i, p.j))
    claims: dict[tuple[int, int], list[tuple[float, float]]] = defaultdict(list)
    for count, pr in enumerate(pairs):
        if count % 256 == 0:
            poll()
        geo = _pair_geometry(pr.i, pr.j, p0, p1, length, unit)
        if geo is None:
            continue
        s0, s1, side_i, (t0j, t1j), side_j = geo
        if not (_free(claims[(pr.i, side_i)], s0, s1) and _free(claims[(pr.j, side_j)], t0j, t1j)):
            continue
        ratio = _strip_ink(ink, p0[pr.i], unit[pr.i], side_i, s0, s1, pr.d, width[pr.i], width[pr.j])
        if HOLLOW_MAX <= ratio <= FILLED_MIN:
            continue
        claims[(pr.i, side_i)].append((s0, s1))
        claims[(pr.j, side_j)].append((t0j, t1j))
        _fill_pair(mask, pr.i, pr.j, s0, s1, pr.d, p0, p1, length, unit)
    return mask


def _pair_candidates(
    p0: np.ndarray,
    p1: np.ndarray,
    length: np.ndarray,
    unit: np.ndarray,
    d_min: float,
    d_max: float,
    poll: Check,
) -> list[_Pair]:
    """Pairs within 2 degrees, ``d_min <= d <= d_max`` apart and overlapping >= 60 % of the shorter.

    Candidates come from sorted offset windows inside 2-degree direction buckets (each with its next
    bucket), so the cost follows the local density instead of ``n^2``.
    """
    angle = np.degrees(np.arctan2(unit[:, 1], unit[:, 0])) % 180.0
    n_buckets = round(180.0 / _ANGLE_BUCKET_DEG)
    bucket = np.minimum((angle // _ANGLE_BUCKET_DEG).astype(np.intp), n_buckets - 1)
    mid = (p0 + p1) / 2.0
    cos_tol = math.cos(math.radians(DOUBLE_ANGLE_DEG))
    out: list[_Pair] = []
    for bk in np.unique(bucket).tolist():
        members = np.flatnonzero(bucket == bk)
        partners = np.flatnonzero((bucket == bk) | (bucket == (bk + 1) % n_buckets))
        theta = math.radians((bk + 0.5) * _ANGLE_BUCKET_DEG)
        rho = mid[:, 1] * math.cos(theta) - mid[:, 0] * math.sin(theta)
        partners = partners[np.argsort(rho[partners], kind="stable")]
        rho_sorted = rho[partners]
        # Midpoints of two segments that are d apart differ in rho by up to d plus the tilt over their
        # half lengths (2 degrees).
        half = d_max + math.sin(math.radians(DOUBLE_ANGLE_DEG + _ANGLE_BUCKET_DEG)) * (
            length[members] + float(length[partners].max())
        )
        lo = np.searchsorted(rho_sorted, rho[members] - half, side="left")
        hi = np.searchsorted(rho_sorted, rho[members] + half, side="right")
        counts = hi - lo
        start = 0
        while start < len(members):
            poll()
            stop = start + 1
            budget = int(counts[start])
            while stop < len(members) and budget + int(counts[stop]) <= _MAX_SAMPLES:
                budget += int(counts[stop])
                stop += 1
            c = counts[start:stop]
            total = int(c.sum())
            if total:
                ii = np.repeat(members[start:stop], c)
                pos = np.repeat(lo[start:stop], c) + np.arange(total) - np.repeat(np.cumsum(c) - c, c)
                jj = partners[pos]
                keep = ((bucket[jj] != bk) | (jj > ii)) & (ii != jj)
                ii, jj = ii[keep], jj[keep]
                out.extend(_filter_pairs(ii, jj, p0, p1, length, unit, d_min, d_max, cos_tol))
            start = stop
    return out


def _filter_pairs(
    ii: np.ndarray,
    jj: np.ndarray,
    p0: np.ndarray,
    p1: np.ndarray,
    length: np.ndarray,
    unit: np.ndarray,
    d_min: float,
    d_max: float,
    cos_tol: float,
) -> list[_Pair]:
    swap = (length[ii] < length[jj]) | ((length[ii] == length[jj]) & (ii > jj))
    a, b = np.where(swap, jj, ii), np.where(swap, ii, jj)  # a: the longer one, the base line
    ua = unit[a]
    ok = np.abs((ua * unit[b]).sum(axis=1)) >= cos_tol
    na = np.stack([-ua[:, 1], ua[:, 0]], axis=1)
    r0, r1 = p0[b] - p0[a], p1[b] - p0[a]
    o0, o1 = (r0 * na).sum(axis=1), (r1 * na).sum(axis=1)
    t0, t1 = (r0 * ua).sum(axis=1), (r1 * ua).sum(axis=1)
    d = np.abs(o0 + o1) / 2.0
    same_side = o0 * o1 > 0
    overlap = np.minimum(np.maximum(t0, t1), length[a]) - np.maximum(np.minimum(t0, t1), 0.0)
    ok &= same_side & (d >= d_min) & (d <= d_max) & (overlap >= DOUBLE_OVERLAP * length[b])
    idx = np.flatnonzero(ok)
    return [_Pair(int(a[k]), int(b[k]), float(d[k]), float(overlap[k])) for k in idx.tolist()]


def _pair_geometry(
    i: int, j: int, p0: np.ndarray, p1: np.ndarray, length: np.ndarray, unit: np.ndarray
) -> tuple[float, float, int, tuple[float, float], int] | None:
    """Overlap ``[s0, s1]`` along ``i``, the side of ``i`` facing ``j`` (+1 / -1 along its normal), the
    same overlap in ``j``'s own parameter and the side of ``j`` facing ``i``."""
    u = unit[i]
    n = np.array((-u[1], u[0]))
    r0, r1 = p0[j] - p0[i], p1[j] - p0[i]
    t0, t1 = float(r0 @ u), float(r1 @ u)
    s0, s1 = max(min(t0, t1), 0.0), min(max(t0, t1), float(length[i]))
    if s1 <= s0:
        return None
    side_i = 1 if float((r0 + r1) @ n) > 0 else -1
    uj = unit[j]
    nj = np.array((-uj[1], uj[0]))
    side_j = 1 if float((p0[i] + p1[i] - p0[j] - p1[j]) @ nj) > 0 else -1
    a, b = p0[i] + u * s0, p0[i] + u * s1
    q0, q1 = float((a - p0[j]) @ uj), float((b - p0[j]) @ uj)
    return s0, s1, side_i, (min(q0, q1), max(q0, q1)), side_j


def _free(claimed: list[tuple[float, float]], s0: float, s1: float) -> bool:
    """The stretch ``[s0, s1]`` of a segment side is not part of an earlier pair on that side."""
    return all(min(s1, b) - max(s0, a) <= DOUBLE_CLAIM_TOL_PX for a, b in claimed)


def _strip_ink(
    ink: np.ndarray,
    origin: np.ndarray,
    u: np.ndarray,
    side: int,
    s0: float,
    s1: float,
    d: float,
    w_i: float,
    w_j: float,
) -> float:
    """Ink share of the strip between two paired lines (their own stroke widths left out)."""
    n = np.array((-u[1], u[0])) * side
    a_lo, a_hi = w_i / 2.0 + 1.0, d - w_j / 2.0 - 1.0
    across = np.arange(a_lo, a_hi + 1e-9, 1.0) if a_hi >= a_lo else np.array([d / 2.0])
    n_along = int(min(400, max(5, (s1 - s0) / 2.0)))
    along = np.linspace(s0, s1, n_along)
    pts = origin + along[:, None, None] * u + across[None, :, None] * n
    x = np.floor(pts[..., 0] + 0.5).astype(np.intp)
    y = np.floor(pts[..., 1] + 0.5).astype(np.intp)
    h, w = ink.shape
    inside = (x >= 0) & (x < w) & (y >= 0) & (y < h)
    vals = ink[np.clip(y, 0, h - 1), np.clip(x, 0, w - 1)] > 0
    return float((vals & inside).sum()) / max(1, int(inside.sum()))


def _fill_pair(
    mask: np.ndarray,
    i: int,
    j: int,
    s0: float,
    s1: float,
    d: float,
    p0: np.ndarray,
    p1: np.ndarray,
    length: np.ndarray,
    unit: np.ndarray,
) -> None:
    """Fill the quad between line ``i`` over ``[s0, s1]`` and the matching stretch of line ``j``, grown by
    ``d / 2`` at each end where ``i`` or ``j`` runs on."""
    u = unit[i]
    uj = unit[j]
    tj0, tj1 = sorted((float((p0[j] - p0[i]) @ u), float((p1[j] - p0[i]) @ u)))
    ext = d / 2.0
    lo = s0 - ext if (s0 >= ext or tj0 <= s0 - ext) else s0
    hi = s1 + ext if (float(length[i]) - s1 >= ext or tj1 >= s1 + ext) else s1
    a, b = p0[i] + u * lo, p0[i] + u * hi

    def on_j(p: np.ndarray) -> np.ndarray:
        t = float((p - p0[j]) @ uj)
        return np.asarray(p0[j] + uj * t)

    poly = np.array([a, b, on_j(b), on_j(a)])
    del p1  # j's far end is reached through its direction
    cv2.fillPoly(mask, [np.round(poly * 16).astype(np.int32)], 255, cv2.LINE_8, 4)


def _single_mask(cands: Sequence[Segment], t_thin: float, crop: Rect, L: float) -> np.ndarray:
    """Long thin segments (>= 0.05 L) drawn 3 x t_thin wide (06 §8.1 step 4)."""
    mask = np.zeros((crop.h, crop.w), np.uint8)
    origin = np.array((crop.x, crop.y), np.float64)
    w = max(3.0, SINGLE_WIDTH_FACTOR * t_thin)
    for s in cands:
        if s.is_thin and s.length >= SINGLE_MIN_LEN_FRAC * L:
            _quad(mask, np.asarray(s.p0) - origin, np.asarray(s.p1) - origin, w)
    return mask


def _fill_small_holes(mask: np.ndarray, max_area: float) -> None:
    """Fill background components of ``mask`` (4-connected) smaller than ``max_area`` in place."""
    n, labels, stats, _ = cv2.connectedComponentsWithStats((mask == 0).astype(np.uint8), connectivity=4)
    small = np.zeros(n, bool)
    small[1:] = stats[1:, cv2.CC_STAT_AREA] < max_area
    h, w = mask.shape
    touches = (stats[:, cv2.CC_STAT_LEFT] == 0) | (stats[:, cv2.CC_STAT_TOP] == 0)
    touches |= stats[:, cv2.CC_STAT_LEFT] + stats[:, cv2.CC_STAT_WIDTH] == w
    touches |= stats[:, cv2.CC_STAT_TOP] + stats[:, cv2.CC_STAT_HEIGHT] == h
    small &= ~touches
    if small.any():
        mask[small[labels]] = 255


# --- step 6: skeleton tracing ---------------------------------------------------------------------------


@dataclass(slots=True)
class _Edge:
    """A traced skeleton path from node ``a`` to node ``b`` (``pts`` x, y, node centroids included);
    ``closed`` paths are loops without a node (``a == b == -1``)."""

    a: int
    b: int
    pts: np.ndarray
    closed: bool = False


def _lookup(sorted_flat: np.ndarray, query: np.ndarray) -> np.ndarray:
    """Positions of ``query`` in ``sorted_flat`` (-1 where absent)."""
    if sorted_flat.size == 0:
        return np.full(query.shape, -1, np.intp)
    pos = np.searchsorted(sorted_flat, query)
    pos_c = np.minimum(pos, sorted_flat.size - 1)
    return np.where(sorted_flat[pos_c] == query, pos_c, -1)


def _trace(skel: np.ndarray, poll: Check) -> tuple[list[_Edge], np.ndarray, np.ndarray]:
    """Edges of the 8-neighbourhood pixel graph of ``skel``.

    Nodes are the 8-connected clusters of pixels whose neighbour count is not 2 (ends, junctions and the
    odd redundant staircase pixel); edges are the paths of the remaining pixels between them. Returns the
    edges, the node centroids ``(n, 2)`` (x, y) and the node pixel lists' flat indices per node label.
    """
    h, w = skel.shape
    sk = skel.astype(np.uint8)
    nb = cv2.filter2D(sk, cv2.CV_8U, _NB_KERNEL, borderType=cv2.BORDER_CONSTANT)
    ys, xs = np.nonzero(sk)
    deg = nb[ys, xs]
    is_node = deg != 2
    node_img = np.zeros_like(sk)
    node_img[ys[is_node], xs[is_node]] = 1
    n_lab, node_lab = cv2.connectedComponents(node_img, connectivity=8, ltype=cv2.CV_32S)
    nys, nxs = ys[is_node], xs[is_node]
    labs = node_lab[nys, nxs]
    del node_lab
    count = np.bincount(labs, minlength=n_lab).astype(np.float64)
    count[0] = 1.0
    centroid = (
        np.stack(
            [
                np.bincount(labs, weights=nxs, minlength=n_lab),
                np.bincount(labs, weights=nys, minlength=n_lab),
            ],
            axis=1,
        )
        / count[:, None]
    )
    node_flat = nys.astype(np.int64) * w + nxs
    order = np.argsort(node_flat)
    node_flat, node_labs = node_flat[order], labs[order]
    poll()

    cys, cxs = ys[~is_node], xs[~is_node]
    flat = cys.astype(np.int64) * w + cxs  # row-major: already sorted
    m = flat.size
    n1 = np.full(m, -1, np.intp)
    n2 = np.full(m, -1, np.intp)
    end_node = np.zeros((m, 2), np.intp)  # node labels next to path ends (0 = none)
    for dy, dx in _NB8:
        qy, qx = cys + dy, cxs + dx
        valid = (qy >= 0) & (qy < h) & (qx >= 0) & (qx < w)
        q = qy.astype(np.int64) * w + qx
        pos = np.where(valid, _lookup(flat, q), -1)
        has = pos >= 0
        first = has & (n1 < 0)
        n1[first] = pos[first]
        second = has & ~first
        n2[second] = pos[second]
        npos = np.where(valid, _lookup(node_flat, q), -1)
        nh = npos >= 0
        lab = np.where(nh, node_labs[np.maximum(npos, 0)], 0) if node_labs.size else np.zeros(m, np.intp)
        put0 = nh & (end_node[:, 0] == 0)
        end_node[put0, 0] = lab[put0]
        put1 = nh & ~put0 & (end_node[:, 1] == 0)
        end_node[put1, 1] = lab[put1]
    poll()

    nl1, nl2 = n1.tolist(), n2.tolist()
    visited = bytearray(m)
    px, py = cxs.tolist(), cys.tolist()
    ends = np.flatnonzero(n2 < 0).tolist()
    edges: list[_Edge] = []
    steps = 0

    def walk(start: int) -> list[int]:
        nonlocal steps
        path = [start]
        visited[start] = 1
        cur = start
        while True:
            a, b = nl1[cur], nl2[cur]
            if a >= 0 and not visited[a]:
                cur = a
            elif b >= 0 and not visited[b]:
                cur = b
            else:
                return path
            visited[cur] = 1
            path.append(cur)
            steps += 1
            if steps % _WALK_POLL == 0:
                poll()

    for start in ends:
        if visited[start]:
            continue
        path = walk(start)
        head, tail = path[0], path[-1]
        na = int(end_node[head, 0])
        nb_ = int(end_node[tail, 1] if len(path) == 1 else end_node[tail, 0])
        if na == 0 or nb_ == 0:
            continue  # cannot happen for a well-formed skeleton; never invent a node
        coords = np.column_stack([[px[k] for k in path], [py[k] for k in path]]).astype(np.float64)
        pts = np.vstack([centroid[na], coords, centroid[nb_]])
        edges.append(_Edge(na, nb_, pts))
    for start in range(m):  # what is left are loops without a node
        if visited[start]:
            continue
        path = walk(start)
        if len(path) >= 3:
            coords = np.column_stack([[px[k] for k in path], [py[k] for k in path]]).astype(np.float64)
            edges.append(_Edge(-1, -1, coords, closed=True))
    return edges, centroid, count


def _path_length(pts: np.ndarray) -> float:
    return float(np.hypot(*np.diff(pts, axis=0).T).sum()) if len(pts) > 1 else 0.0


def _degrees(edges: list[_Edge], n_nodes: int) -> np.ndarray:
    deg = np.zeros(n_nodes, np.intp)
    for e in edges:
        if not e.closed:
            deg[e.a] += 1
            deg[e.b] += 1
    return deg


def _prune_spurs(edges: list[_Edge], node_r: np.ndarray, n_nodes: int) -> list[_Edge]:
    """Drop edges from a junction (degree >= 3) to a free end shorter than 1.5 x the local thickness
    (twice the junction's distance-transform value)."""
    deg = _degrees(edges, n_nodes)
    out: list[_Edge] = []
    for e in edges:
        if not e.closed and e.a != e.b:
            da, db = deg[e.a], deg[e.b]
            junction = e.b if (da == 1 and db >= 3) else e.a if (db == 1 and da >= 3) else -1
            if junction >= 0 and _path_length(e.pts) < SPUR_FACTOR * 2.0 * float(node_r[junction]):
                continue
        out.append(e)
    return out


def _contract(edges: list[_Edge]) -> list[_Edge]:
    """Join the two edges at every node of degree 2 (a loop through one such node becomes closed)."""
    slots: list[_Edge | None] = list(edges)
    inc: dict[int, list[int]] = defaultdict(list)
    for k, e in enumerate(edges):
        if not e.closed:
            inc[e.a].append(k)
            inc[e.b].append(k)
    for node in sorted(inc):
        ids = inc[node]
        if len(ids) != 2:
            continue
        i, j = ids
        ei, ej = slots[i], slots[j]
        assert ei is not None and ej is not None
        if i == j:  # a loop whose only node is this one
            slots[i] = _Edge(-1, -1, ei.pts[:-1], closed=True)
            inc[node] = []
            continue
        pi, ai = (ei.pts, ei.a) if ei.b == node else (ei.pts[::-1], ei.b)
        pj, bj = (ej.pts, ej.b) if ej.a == node else (ej.pts[::-1], ej.a)
        slots[i] = _Edge(ai, bj, np.vstack([pi, pj[1:]]))
        slots[j] = None
        inc[node] = []
        inc[bj] = [i if k == j else k for k in inc[bj]]
    return [e for e in slots if e is not None]


# --- pieces: simplified straight runs -------------------------------------------------------------------


@dataclass(slots=True)
class _Piece:
    p0: np.ndarray
    p1: np.ndarray
    thickness: float
    source: WallSource
    free0: bool
    free1: bool
    axis: str = "d"  # "h" (along theta0), "v" (theta0 + 90) or "d" (diagonal)


def _vertex_indices(pts: np.ndarray, eps: float) -> list[int]:
    """Indices of the ``cv2.approxPolyDP`` vertices of the open polyline ``pts`` (first and last kept)."""
    if len(pts) <= 2:
        return list(range(len(pts)))
    f32 = pts.astype(np.float32)
    approx = cv2.approxPolyDP(f32.reshape(-1, 1, 2), eps, False).reshape(-1, 2)
    out: list[int] = []
    k = 0
    for v in approx:
        while k < len(f32) and not (f32[k, 0] == v[0] and f32[k, 1] == v[1]):
            k += 1
        if k == len(f32):
            break
        out.append(k)
        k += 1
    if not out or out[0] != 0:
        out.insert(0, 0)
    if out[-1] != len(pts) - 1:
        out.append(len(pts) - 1)
    return out


def _sample(img: np.ndarray, pts: np.ndarray) -> np.ndarray:
    h, w = img.shape[:2]
    x = np.clip(np.floor(pts[:, 0] + 0.5).astype(np.intp), 0, w - 1)
    y = np.clip(np.floor(pts[:, 1] + 0.5).astype(np.intp), 0, h - 1)
    return np.asarray(img[y, x])


def _pieces(
    edges: list[_Edge], deg: np.ndarray, dt: np.ndarray, source: np.ndarray, eps: float, poll: Check
) -> list[list[_Piece]]:
    """Straight pieces of every traced path (``cv2.approxPolyDP``), in path order, one list per path.

    Thickness is ``2 x median(dt_W)`` along the piece's pixels and the source is the majority label of
    ``source`` there. Only a path's first and last piece can have a free end (a node of degree 1).
    """
    out: list[list[_Piece]] = []
    for count, e in enumerate(edges):
        if count % 64 == 0:
            poll()
        if e.closed:
            far = int(np.argmax(np.hypot(*(e.pts - e.pts[0]).T)))
            halves = [e.pts[: far + 1], np.vstack([e.pts[far:], e.pts[:1]])]
            free = [(False, False), (False, False)]
        else:
            halves = [e.pts]
            free = [(bool(deg[e.a] == 1), bool(deg[e.b] == 1))]
        for pts, (fa, fb) in zip(halves, free, strict=True):
            idx = _vertex_indices(pts, eps)
            last = len(pts) - 1
            chain: list[_Piece] = []
            for i0, i1 in itertools.pairwise(idx):
                seg = pts[i0 : i1 + 1]
                a, b = pts[i0], pts[i1]
                if float(np.hypot(*(b - a))) < 1e-6:
                    continue
                thickness = 2.0 * float(np.median(_sample(dt, seg)))
                labels = _sample(source, seg)
                labels = labels[labels > 0]
                src: WallSource = (
                    _SOURCES[int(np.bincount(labels, minlength=5).argmax())] if labels.size else "filled"
                )
                chain.append(
                    _Piece(a.copy(), b.copy(), max(thickness, 1.0), src, fa and i0 == 0, fb and i1 == last)
                )
            if chain:
                out.append(chain)
    return out


# --- step 7: orientation snap, free-end refinement ------------------------------------------------------


def _snap_one(p: _Piece, theta0: float, L: float) -> _Piece | None:
    d = p.p1 - p.p0
    length = float(np.hypot(d[0], d[1]))
    ang = math.degrees(math.atan2(d[1], d[0]))
    delta = (ang - theta0 + 45.0) % 90.0 - 45.0
    if abs(delta) <= SNAP_DEG:
        target = math.radians(ang - delta)
        half = np.array((math.cos(target), math.sin(target))) * (length / 2.0)
        mid = (p.p0 + p.p1) / 2.0
        k = round((ang - delta - theta0) / 90.0) % 2
        return _Piece(mid - half, mid + half, p.thickness, p.source, p.free0, p.free1, "hv"[k])
    if length >= DIAGONAL_MIN_FRAC * L:
        return p
    return None


def _snap(chains: list[list[_Piece]], theta0: float, L: float) -> list[_Piece]:
    """Rotate pieces within 3 degrees of ``theta0 + k 90`` onto that axis about their midpoint; keep
    other pieces of at least 0.03 L as diagonals and drop shorter off-axis ones (06 §8.1 step 7).

    A kept piece after a dropped head (or before a dropped tail) of its path is extended along its own
    line to the projection of the path's end node (a diagonal whose skeleton curls into a junction). When
    that end is free (a skeleton curling into a corner of a wall's end), the kept piece inherits the free
    end instead, so the end is still refined to the end of the wall."""
    out: list[_Piece] = []
    for chain in chains:
        kept = [(k, q) for k, q in enumerate(_snap_one(p, theta0, L) for p in chain) if q is not None]
        if not kept:
            continue
        kept_idx = [k for k, _ in kept]
        pieces = [q for _, q in kept]
        _close_end(chain, kept_idx[0], pieces[0], head=True)
        _close_end(chain, kept_idx[-1], pieces[-1], head=False)
        out.extend(pieces)
    return out


def _close_end(chain: list[_Piece], kept_at: int, piece: _Piece, *, head: bool) -> None:
    """Close the path's head (or tail) after dropped pieces: inherit a free end, or extend to the end
    node's projection."""
    if kept_at == (0 if head else len(chain) - 1):
        return  # nothing was dropped at this end
    if chain[0].free0 if head else chain[-1].free1:
        setattr(piece, "free0" if head else "free1", True)
    else:
        _extend_to(piece, chain[0].p0 if head else chain[-1].p1, at_start=head)


def _extend_to(p: _Piece, target: np.ndarray, *, at_start: bool) -> None:
    """Move an end of ``p`` outwards along its line to the projection of ``target`` (never inwards)."""
    d = p.p1 - p.p0
    length = float(np.hypot(d[0], d[1]))
    if length < 1e-9:
        return
    u = d / length
    t = float((target - p.p0) @ u)
    if at_start and t < 0.0:
        p.p0 = p.p0 + u * t
    elif not at_start and t > length:
        p.p1 = p.p0 + u * t


def _march_free_ends(pieces: list[_Piece], wall: np.ndarray) -> None:
    """Move every free end along its piece to the end of the wall mask (the skeleton stops about t / 2
    short of a wall's end, which would widen door gaps by t)."""
    for p in pieces:
        for is_start in (True, False):
            if not (p.free0 if is_start else p.free1):
                continue
            end, other = (p.p0, p.p1) if is_start else (p.p1, p.p0)
            d = end - other
            length = float(np.hypot(d[0], d[1]))
            if length < 1e-9:
                continue
            u = d / length
            if not _sample(wall, end[None, :])[0]:
                continue
            reach = 2.0 * p.thickness + 4.0
            steps = np.arange(1, int(reach / _MARCH_STEP) + 1) * _MARCH_STEP
            inside = _sample(wall, end[None, :] + steps[:, None] * u[None, :]) > 0
            out = np.flatnonzero(~inside)
            last = (
                float(steps[out[0] - 1])
                if out.size and out[0] > 0
                else (0.0 if out.size else float(steps[-1]))
            )
            new = end + u * (last + _MARCH_STEP)
            if is_start:
                p.p0 = new
            else:
                p.p1 = new


# --- step 8: collinear runs and gap candidates ----------------------------------------------------------


@dataclass(slots=True)
class _Run:
    u: np.ndarray
    n: np.ndarray
    s0: float
    s1: float
    members: list[tuple[float, float, float, float, WallSource]]  # (s0, s1, offset, thickness, source)
    openings: list[tuple[float, float]]
    free0: bool
    free1: bool

    def wall(self) -> RawWall:
        lengths = [m[1] - m[0] for m in self.members]
        total = math.fsum(lengths) or 1.0
        off = math.fsum(m[2] * w for m, w in zip(self.members, lengths, strict=True)) / total
        thick = math.fsum(m[3] * w for m, w in zip(self.members, lengths, strict=True)) / total
        by_source: dict[WallSource, float] = defaultdict(float)
        for m, w in zip(self.members, lengths, strict=True):
            by_source[m[4]] += w
        source = min(by_source, key=lambda s: (-by_source[s], _SOURCE_RANK[s]))
        a = self.u * self.s0 + self.n * off
        b = self.u * self.s1 + self.n * off
        openings = tuple((o0 - self.s0, o1 - self.s0) for o0, o1 in self.openings)
        return RawWall((float(a[0]), float(a[1])), (float(b[0]), float(b[1])), thick, source, openings)


def _direction_groups(pieces: list[_Piece], theta0: float) -> list[tuple[np.ndarray, list[_Piece]]]:
    """Pieces grouped by direction: the two snapped axes, and diagonals within 1 degree of each other."""
    rad = math.radians(theta0)
    h_axis = np.array((math.cos(rad), math.sin(rad)))
    v_axis = np.array((-math.sin(rad), math.cos(rad)))
    groups: list[tuple[np.ndarray, list[_Piece]]] = [
        (h_axis, [p for p in pieces if p.axis == "h"]),
        (v_axis, [p for p in pieces if p.axis == "v"]),
    ]
    diags = sorted(
        (p for p in pieces if p.axis == "d"),
        key=lambda p: math.degrees(math.atan2(p.p1[1] - p.p0[1], p.p1[0] - p.p0[0])) % 180.0,
    )
    current: list[_Piece] = []
    first_angle = 0.0
    for p in diags:
        ang = math.degrees(math.atan2(p.p1[1] - p.p0[1], p.p1[0] - p.p0[0])) % 180.0
        if current and ang - first_angle > DUPLICATE_ANGLE_DEG:
            groups.append((_longest_direction(current), current))
            current = []
        if not current:
            first_angle = ang
        current.append(p)
    if current:
        groups.append((_longest_direction(current), current))
    return [(u, g) for u, g in groups if g]


def _longest_direction(pieces: list[_Piece]) -> np.ndarray:
    p = max(pieces, key=lambda q: float(np.hypot(*(q.p1 - q.p0))))
    d = p.p1 - p.p0
    return np.asarray(d / float(np.hypot(d[0], d[1])))


def _gap_is_empty(wall: np.ndarray, u: np.ndarray, n: np.ndarray, off: float, g0: float, g1: float) -> bool:
    along = np.arange(g0 + 1.0, g1 - 1.0 + 1e-9, 1.0)
    if along.size == 0:
        return True
    pts = along[:, None] * u[None, :] + (n * off)[None, :]
    return float((_sample(wall, pts) > 0).mean()) <= GAP_WALL_MAX


def _runs(pieces: list[_Piece], theta0: float, wall: np.ndarray, poll: Check) -> list[_Run]:
    """Collinear pieces (same direction, offset within ``0.5 t``) joined along their line: breaks up to
    ``1.5 t`` close, empty gaps of ``2.5 t .. 18 t`` between walls of similar thickness become openings,
    anything else ends the run."""
    out: list[_Run] = []
    for u, group in _direction_groups(pieces, theta0):
        poll()
        n = np.array((-u[1], u[0]))
        items = []
        for p in group:
            a, b = float(p.p0 @ u), float(p.p1 @ u)
            off = float((p.p0 + p.p1) @ n) / 2.0
            fa, fb = (p.free0, p.free1) if a <= b else (p.free1, p.free0)
            items.append((min(a, b), max(a, b), off, p.thickness, p.source, fa, fb))
        items.sort(key=lambda it: it[2])
        lines: list[list[tuple[float, float, float, float, WallSource, bool, bool]]] = []
        anchor_off, anchor_t = 0.0, 0.0
        for it in items:
            tol = max(MERGE_OFFSET * min(anchor_t, it[3]), MERGE_OFFSET_MIN_PX)
            if lines and abs(it[2] - anchor_off) <= tol:
                lines[-1].append(it)
            else:
                lines.append([it])
                anchor_off, anchor_t = it[2], it[3]
        for line in lines:
            line.sort(key=lambda it: (it[0], it[1]))
            run: _Run | None = None
            last_t = 0.0
            for s0, s1, off, t, src, fa, fb in line:
                if run is not None:
                    gap = s0 - run.s1
                    t_gap = (last_t + t) / 2.0
                    similar = max(last_t, t) <= SIMILAR_THICKNESS * min(last_t, t)
                    if gap <= MERGE_GAP * max(last_t, t):
                        pass
                    elif (
                        GAP_MIN * t_gap <= gap <= GAP_MAX * t_gap
                        and similar
                        and _gap_is_empty(wall, u, n, (off + _mean_offset(run)) / 2.0, run.s1, s0)
                    ):
                        run.openings.append((run.s1, s0))
                    else:
                        out.append(run)
                        run = None
                if run is None:
                    run = _Run(u, n, s0, s1, [], [], fa, fb)
                elif s1 >= run.s1:
                    run.free1 = fb
                if s1 >= run.s1:
                    run.s1 = s1
                    last_t = t
                run.members.append((s0, s1, off, t, src))
            if run is not None:
                out.append(run)
    return out


def _mean_offset(run: _Run) -> float:
    lengths = [m[1] - m[0] for m in run.members]
    total = math.fsum(lengths) or 1.0
    return math.fsum(m[2] * w for m, w in zip(run.members, lengths, strict=True)) / total


def _drop_leaves(runs: list[_Run]) -> list[_Run]:
    """Drop door leaves: a run with one end at a gap's jamb, a free far end and a length (far end to the
    jamb) of ``0.8 g .. 1.1 g``, leaving the gap's wall at least 30 degrees steeply.

    A leaf drawn touching its jamb merges with the jamb's end cap, so its near end may lie up to the
    wall thickness from the jamb point on the centre line.
    """
    jambs: list[tuple[np.ndarray, float, np.ndarray, float, int]] = []
    for k, r in enumerate(runs):
        off = _mean_offset(r)
        t = max(m[3] for m in r.members)
        for o0, o1 in r.openings:
            g = o1 - o0
            jambs.append((r.u * o0 + r.n * off, g, r.u, t, k))
            jambs.append((r.u * o1 + r.n * off, g, r.u, t, k))
    if not jambs:
        return runs
    sin_min = math.sin(math.radians(LEAF_MIN_ANGLE_DEG))
    keep: list[_Run] = []
    for k, r in enumerate(runs):
        w = r.wall()
        a, b = np.asarray(w.p0), np.asarray(w.p1)
        t_r = w.thickness_px
        leaf = False
        for near, far, far_free in ((a, b, r.free1), (b, a, r.free0)):
            if not far_free or r.openings:
                continue
            for jp, g, hu, t_host, host in jambs:
                if host == k:
                    continue
                if float(np.hypot(*(near - jp))) > max(t_host, t_r) + 2.0:
                    continue
                d = far - near
                ln = float(np.hypot(d[0], d[1]))
                if ln < 1e-9 or abs(float(d[0] * hu[1] - d[1] * hu[0])) / ln < sin_min:
                    continue
                if LEAF_MIN * g <= float(np.hypot(*(far - jp))) <= LEAF_MAX * g:
                    leaf = True
                    break
            if leaf:
                break
        if not leaf:
            keep.append(r)
    return keep


def dedupe_raw_walls(raw: Sequence[RawWall]) -> list[RawWall]:
    """Drop near-identical collinear copies (stacked DXF / vector strokes): a wall whose direction is
    within 1 degree of a kept wall's and whose ends are both within ``max(1, 0.25 t)`` of that wall's ends
    (either order) is a copy. The first of each set of copies in the canonical (source rank, length,
    endpoints) order is kept, so the result does not depend on the input order; the copies' openings are
    merged into it."""
    if not raw:
        return []
    order = sorted(
        raw,
        key=lambda w: (
            _SOURCE_RANK[w.source],
            -math.hypot(w.p1[0] - w.p0[0], w.p1[1] - w.p0[1]),
            min(w.p0, w.p1),
            max(w.p0, w.p1),
            w.thickness_px,
            w.openings_px,
        ),
    )
    kept: list[RawWall] = []
    grid: dict[tuple[int, int], list[int]] = defaultdict(list)
    # Copies' midpoints differ by at most the end tolerance, so neighbouring cells of this size suffice.
    cell = max(8.0, 0.25 * max(w.thickness_px for w in raw))
    cos_tol = math.cos(math.radians(DUPLICATE_ANGLE_DEG))
    for w in order:
        mx, my = (w.p0[0] + w.p1[0]) / 2.0, (w.p0[1] + w.p1[1]) / 2.0
        cx, cy = math.floor(mx / cell), math.floor(my / cell)
        near = (
            k
            for gx, gy in itertools.product((cx - 1, cx, cx + 1), (cy - 1, cy, cy + 1))
            for k in grid[(gx, gy)]
        )
        dup = next((k for k in near if _same_wall(kept[k], w, cos_tol)), -1)
        if dup < 0:
            grid[(cx, cy)].append(len(kept))
            kept.append(w)
        elif w.openings_px:
            kept[dup] = _with_openings_of(kept[dup], w)
    return kept


def _with_openings_of(base: RawWall, other: RawWall) -> RawWall:
    """``base`` with ``other``'s openings re-measured along ``base`` and merged into its own."""
    bx, by = base.p1[0] - base.p0[0], base.p1[1] - base.p0[1]
    ox, oy = other.p1[0] - other.p0[0], other.p1[1] - other.p0[1]
    lb, lo = math.hypot(bx, by), math.hypot(ox, oy)
    spans = list(base.openings_px)
    for u0, u1 in other.openings_px:
        ends = []
        for u in (u0, u1):
            x, y = other.p0[0] + ox / lo * u, other.p0[1] + oy / lo * u
            ends.append(((x - base.p0[0]) * bx + (y - base.p0[1]) * by) / lb)
        spans.append((min(ends), max(ends)))
    spans.sort()
    merged: list[tuple[float, float]] = []
    for lo_u, hi_u in spans:
        if merged and lo_u <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], hi_u))
        else:
            merged.append((lo_u, hi_u))
    return RawWall(base.p0, base.p1, base.thickness_px, base.source, tuple(merged))


def _same_wall(a: RawWall, b: RawWall, cos_tol: float) -> bool:
    tol = max(1.0, 0.25 * max(a.thickness_px, b.thickness_px))
    da = (a.p1[0] - a.p0[0], a.p1[1] - a.p0[1])
    db = (b.p1[0] - b.p0[0], b.p1[1] - b.p0[1])
    la, lb = math.hypot(*da), math.hypot(*db)
    if la == 0.0 or lb == 0.0 or abs(da[0] * db[0] + da[1] * db[1]) < cos_tol * la * lb:
        return False

    def close(p: Pt, q: Pt) -> bool:
        return math.hypot(p[0] - q[0], p[1] - q[1]) <= tol

    return (close(a.p0, b.p0) and close(a.p1, b.p1)) or (close(a.p0, b.p1) and close(a.p1, b.p0))


def _weighted_median(values: list[float], weights: list[float]) -> float:
    order = np.argsort(values)
    v = np.asarray(values)[order]
    w = np.asarray(weights)[order]
    cum = np.cumsum(w)
    return float(v[int(np.searchsorted(cum, cum[-1] / 2.0))])


# --- public API -----------------------------------------------------------------------------------------


def extract_walls(
    page: NormalizedPage,
    pre: Preprocessed,
    segments: list[Segment],
    dimension_lines: list[DimensionLine],
    ctx: PipelineContext,
) -> WallExtraction:
    """Wall masks and raw wall centre lines of the plan region (06 §8.1 steps 1-8); see the module doc.

    ``segments`` are the stage's line segments (06 §7.9) and ``dimension_lines`` the result of
    ``find_dimension_lines``; neither takes part in walls. ``ctx.check_deadline`` is polled throughout.
    """
    poll = _throttled(ctx.check_deadline)
    poll()
    h, w = pre.ink.shape[:2]
    crop = pre.region.clip(w, h)
    mask = np.zeros((h, w), np.uint8)
    source_full = np.zeros((h, w), np.uint8)
    cands = _wall_candidates(segments, dimension_lines)
    theta0 = dominant_orientation(cands)
    if crop.w <= 0 or crop.h <= 0:
        return WallExtraction(mask, source_full, [], theta0, max(1.0, 2.0 * pre.t_thin))
    L = float(crop.long_side)
    ys, xs = slice(crop.y, crop.y + crop.h), slice(crop.x, crop.x + crop.w)

    filled = _filled_mask(pre, crop, max(h, w))
    poll()
    vector = (
        _vector_mask(page, cands, pre.t_thin, crop)
        if page.source_kind == "pdf_vector"
        else np.zeros_like(filled)
    )
    double = _double_mask(cands, pre.ink[ys, xs], crop, L, poll)
    poll()
    covered = int(np.count_nonzero(filled | double | vector))
    single = (
        _single_mask(cands, pre.t_thin, crop, L)
        if covered < SINGLE_COVERAGE * crop.w * crop.h
        else np.zeros_like(filled)
    )
    source = np.zeros_like(filled)
    for label, layer in (
        (SRC_SINGLE, single),
        (SRC_DOUBLE, double),
        (SRC_FILLED, filled),
        (SRC_VECTOR, vector),
    ):
        source[layer > 0] = label
    wall = cv2.morphologyEx(filled | double | single | vector, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    _fill_small_holes(wall, (HOLE_FILL_FRAC * L) ** 2)
    poll()
    source[wall == 0] = 0  # pixels closed in by step 5 keep no label of their own
    mask[ys, xs] = wall
    source_full[ys, xs] = source
    if not wall.any():
        return WallExtraction(mask, source_full, [], theta0, max(1.0, 2.0 * pre.t_thin))

    raw = _trace_raw_walls(wall, source, theta0, L, poll)
    origin = (float(crop.x), float(crop.y))
    raw = [
        RawWall(
            (r.p0[0] + origin[0], r.p0[1] + origin[1]),
            (r.p1[0] + origin[0], r.p1[1] + origin[1]),
            r.thickness_px,
            r.source,
            r.openings_px,
        )
        for r in raw
    ]
    raw = dedupe_raw_walls(raw)
    if raw:
        t_median = _weighted_median(
            [r.thickness_px for r in raw], [math.hypot(r.p1[0] - r.p0[0], r.p1[1] - r.p0[1]) for r in raw]
        )
    else:
        t_median = max(1.0, 2.0 * pre.t_thin)
    return WallExtraction(mask, source_full, raw, theta0, t_median)


def _trace_raw_walls(
    wall: np.ndarray, source: np.ndarray, theta0: float, L: float, poll: Check
) -> list[RawWall]:
    """Steps 6-8 on the region's wall mask (crop coordinates)."""
    dt = cv2.distanceTransform(wall, cv2.DIST_L2, cv2.DIST_MASK_PRECISE)
    skel = skeletonize(wall > 0)  # type: ignore[no-untyped-call]
    poll()
    edges, centroid, _ = _trace(skel, poll)
    n_nodes = len(centroid)
    node_r = _sample(dt, centroid) if n_nodes else np.zeros(0)  # local half thickness at each node
    for _ in range(2):
        edges = _contract(_prune_spurs(edges, node_r, n_nodes))
    deg = _degrees(edges, n_nodes)
    t_skel = 2.0 * float(np.median(dt[skel])) if skel.any() else 1.0
    eps = max(EPS_MIN, EPS_FACTOR * t_skel)
    pieces = _snap(_pieces(edges, deg, dt, source, eps, poll), theta0, L)
    _march_free_ends(pieces, wall)
    runs = _drop_leaves(_runs(pieces, theta0, wall, poll))
    return [r.wall() for r in runs if r.s1 - r.s0 > 1e-6]


def walls_to_graph(
    ext: WallExtraction, region: Rect, *, check_deadline: Callable[[], None] | None = None
) -> WallGraph:
    """The wall graph of ``ext.raw`` (06 §8.1 step 9): ``build_wall_graph`` with ``r = max(t_median,
    0.006 L)``, ``L`` = the region's long side and ``theta0_deg = ext.theta0``. Near-identical duplicate
    raw walls are dropped first. The raw walls' ``openings_px`` come back as ``graph.gaps`` (the gap
    candidates, ids consistent with ``graph.walls``)."""
    L = float(region.long_side)
    raw = dedupe_raw_walls(ext.raw)
    if not raw or L <= 0:
        return WallGraph(nodes={}, walls=[], gaps=[])
    t_median = max(ext.t_median, 1e-3)
    r = max(t_median, SNAP_RADIUS_FRAC * L)
    return build_wall_graph(
        raw, r=r, t_median=t_median, L=L, theta0_deg=float(ext.theta0), check_deadline=check_deadline
    )


_DEBUG_COLOURS: dict[int, tuple[int, int, int]] = {
    SRC_FILLED: (0, 0, 230),  # BGR red
    SRC_DOUBLE: (230, 0, 0),  # blue
    SRC_SINGLE: (0, 170, 0),  # green
    SRC_VECTOR: (0, 0, 150),  # dark red
}


def debug_walls_png(page: NormalizedPage, ext: WallExtraction, graph: WallGraph) -> np.ndarray:
    """``02-walls.png`` (06 §13): the wall mask coloured by source (filled red, double line blue, single
    line green, vector dark red) over a faded page, with the graph's centre lines (black), nodes and gap
    candidates (yellow) drawn on top. Returns a BGR uint8 image of the page's size."""
    img = page.image
    base = img if img.ndim == 3 else cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    out = cv2.addWeighted(base, 0.3, np.full_like(base, 255), 0.7, 0.0)
    for label, colour in _DEBUG_COLOURS.items():
        out[ext.source_mask == label] = colour
    out[(ext.mask > 0) & (ext.source_mask == 0)] = (120, 0, 120)
    by_id = {w.id: w for w in graph.walls}
    for wc in graph.walls:
        a = (round(wc.a[0] * 16), round(wc.a[1] * 16))
        b = (round(wc.b[0] * 16), round(wc.b[1] * 16))
        cv2.line(out, a, b, (0, 0, 0), 1, cv2.LINE_8, 4)
    for gap in graph.gaps:
        wc = by_id[gap.wall_id]
        length = math.hypot(wc.b[0] - wc.a[0], wc.b[1] - wc.a[1]) or 1.0
        ux, uy = (wc.b[0] - wc.a[0]) / length, (wc.b[1] - wc.a[1]) / length
        p = (round((wc.a[0] + ux * gap.u0) * 16), round((wc.a[1] + uy * gap.u0) * 16))
        q = (round((wc.a[0] + ux * gap.u1) * 16), round((wc.a[1] + uy * gap.u1) * 16))
        cv2.line(out, p, q, (0, 220, 255), 3, cv2.LINE_8, 4)
    for x, y in graph.nodes.values():
        cv2.circle(out, (round(x * 16), round(y * 16)), 3 * 16, (0, 0, 0), 1, cv2.LINE_8, 4)
    return out
