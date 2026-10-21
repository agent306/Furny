"""Wall candidates and double-line walls (06 §8.1 steps 2-3), split out of ``walls.py``.

- step 2: the stage's segments minus dimension lines, their collinear copies and their extension lines
  (``candidate_segments``), and the guard that keeps wall faces taken for dimension lines
  (``wall_face_dims``);
- step 3: pairs of parallel thin segments whose strip is hollow or filled become the double-line wall mask
  (``double_mask``), inside the solid walls' envelope when there is one (``solid_envelope``).
"""

import math
from collections import defaultdict
from collections.abc import Callable, Sequence
from dataclasses import dataclass

import cv2
import numpy as np

from app.pipeline.segments import merge_collinear
from app.schemas.candidates import DimensionLine, Segment
from app.utils.geometry import Rect

__all__ = [
    "Check",
    "candidate_segments",
    "double_mask",
    "is_extension",
    "sample",
    "solid_envelope",
    "touches_tick",
    "wall_face_dims",
]

EXTENSION_ANGLE_DEG = 10.0  # extension lines: perpendicular to their dimension line within 10 degrees ...
EXTENSION_TICK_THIN = 2.0  # ... meeting it within 2 t_thin of one of its ticks with one end ...
EXTENSION_OVERSHOOT_THIN = (1.0, 3.0)  # ... and running on past it in the ink for 1 .. 3 t_thin (ruling R6)
DOUBLE_MIN_LEN_FRAC = 0.03  # of L (ruling R6)
ENVELOPE_MIN_COVER = 0.5  # solid walls outline the plan when their convex hull covers half of the region
ENVELOPE_GROW_FRAC = 0.01  # the hull is grown by 0.01 L
ENVELOPE_MIN_INSIDE = 0.5  # a double-line pair needs half of its centre line inside
DOUBLE_ANGLE_DEG = 2.0
DOUBLE_D_MIN_THIN, DOUBLE_D_MAX_FRAC = 1.5, 0.02  # line distance: >= 1.5 t_thin, <= 0.02 L (ruling R6)
DOUBLE_OVERLAP = 0.6  # of the shorter segment
HOLLOW_MAX, FILLED_MIN = 0.15, 0.85  # ink share of the strip between the two lines
DOUBLE_CLAIM_TOL_PX = 1.0  # claims of one segment side may touch by this much
REJOIN_GAP_THIN = 3.0  # thin pieces cut by a dimension line: within this many t_thin of it, this far apart
REJOIN_ANGLE_DEG, REJOIN_OFFSET_PX = 1.5, 2.0  # ... on one line: within 1.5 degrees and 2 px

_MAX_SAMPLES = 400_000  # vectorised work per block between polls
_ANGLE_BUCKET_DEG = 2.0
_MARCH_STEP = 0.5

Check = Callable[[], None]


def sample(img: np.ndarray, pts: np.ndarray) -> np.ndarray:
    """``img`` at the points ``pts`` (x, y), rounded to the nearest pixel and clamped to the image."""
    h, w = img.shape[:2]
    x = np.clip(np.floor(pts[:, 0] + 0.5).astype(np.intp), 0, w - 1)
    y = np.clip(np.floor(pts[:, 1] + 0.5).astype(np.intp), 0, h - 1)
    return np.asarray(img[y, x])


# --- step 2: candidate segments ------------------------------------------------------------------------


def candidate_segments(
    segments: Sequence[Segment],
    dimension_lines: Sequence[DimensionLine],
    t_thin: float,
    ink: np.ndarray,
    faces: frozenset[str] | set[str] = frozenset(),
) -> list[Segment]:
    """Segments minus dimension lines (06 §8.1 step 2), including collinear copies of a dimension line, and
    minus their extension lines (ruling R6, see ``is_extension``; ``ink`` is the page's text-free ink).

    A dimension line is never a wall candidate. For the dimension lines in ``faces`` (``wall_face_dims``:
    drawn beside a wall face, pairing with it) only the extension-line exclusion is skipped, so a face
    touching one of their ticks is not cut (Task 16c: re-admitting their own segments paired them with the
    face beside them into a wall, the HDB toilet-3 wall at the "3200" line)."""
    dim_ids = {d.segment_id for d in dimension_lines}
    cut = [d for d in dimension_lines if d.segment_id not in faces]
    out: list[Segment] = []
    for s in segments:
        if s.id in dim_ids or (
            s.is_thin
            and (
                any(_on_line(s, d) for d in dimension_lines)
                or any(is_extension(s, d, t_thin, ink) for d in cut)
            )
        ):
            continue
        out.append(s)
    return out


def wall_face_dims(
    segments: Sequence[Segment],
    dimension_lines: Sequence[DimensionLine],
    ink: np.ndarray,
    t_thin: float,
    L: float,
) -> set[str]:
    """Ids of the "dimension lines" that are wall faces: their segment pairs with another thin segment, not
    a dimension line, as a double-line wall (``double_mask``'s pair rules, strip on the text-free ``ink``).

    ``find_dimension_lines`` drops candidates that pair as wall faces itself (Task 14b), with the walls
    stage's pair rules, one pair per stretch and the stacked-chain exception for two dimension lines. This
    guard stays for the dimension lines drawn closer than 0.02 L beside a single face line (an interior
    dimension along a partition): their extension lines are not excluded (``candidate_segments``), so
    they do not cut the partition. Their own segments are no wall candidates (Task 16c).
    """
    by_id = {s.id: s for s in segments}
    dim_ids = {d.segment_id for d in dimension_lines}
    min_len = DOUBLE_MIN_LEN_FRAC * L
    lines = [by_id[d.segment_id] for d in dimension_lines if d.segment_id in by_id]
    lines = [s for s in lines if s.length >= min_len]
    partners = [s for s in segments if s.is_thin and s.length >= min_len and s.id not in dim_ids]
    if not lines or not partners:
        return set()
    segs = [*lines, *partners]
    p0 = np.array([s.p0 for s in segs], np.float64)
    p1 = np.array([s.p1 for s in segs], np.float64)
    width = np.array([s.width_px for s in segs], np.float64)
    length = np.hypot(*(p1 - p0).T)
    unit = (p1 - p0) / length[:, None]
    n_lines = len(lines)
    ii, jj = (
        a.ravel() for a in np.meshgrid(np.arange(n_lines), np.arange(n_lines, len(segs)), indexing="ij")
    )
    cos_tol = math.cos(math.radians(DOUBLE_ANGLE_DEG))
    d_min, d_max = DOUBLE_D_MIN_THIN * t_thin, DOUBLE_D_MAX_FRAC * L
    faces: set[str] = set()
    for pr in _filter_pairs(ii, jj, p0, p1, length, unit, d_min, d_max, cos_tol):
        geo = _pair_geometry(pr.i, pr.j, p0, p1, length, unit)
        if geo is None:
            continue
        s0, s1, side_i, _, _ = geo
        ratio = _strip_ink(ink, p0[pr.i], unit[pr.i], side_i, s0, s1, pr.d, width[pr.i], width[pr.j])
        if not HOLLOW_MAX <= ratio <= FILLED_MIN:
            faces.update(segs[k].id for k in (pr.i, pr.j) if k < n_lines)
    return faces


def _tick_crossing(s: Segment, d: DimensionLine, t_thin: float) -> tuple[float, float, float] | None:
    """Where ``s`` meets ``d`` at one of its ticks: ``s`` perpendicular to ``d`` (within 10 degrees) and its
    line meeting ``d``'s within ``2 t_thin`` of a tick. Returns ``(k, mx, my)``: the meeting point
    ``(mx, my)`` at ``k`` along ``s`` from ``s.p0``; None otherwise."""
    dx, dy = d.p1[0] - d.p0[0], d.p1[1] - d.p0[1]
    length = math.hypot(dx, dy)
    sx, sy = s.p1[0] - s.p0[0], s.p1[1] - s.p0[1]
    s_len = math.hypot(sx, sy)
    if length == 0.0 or s_len == 0.0 or not d.tick_positions:
        return None
    ux, uy = dx / length, dy / length
    vx, vy = sx / s_len, sy / s_len
    if abs(ux * vx + uy * vy) > math.sin(math.radians(EXTENSION_ANGLE_DEG)):
        return None
    # Meeting point of the two lines: s.p0 + v * k, with zero offset from d's line.
    h0 = -(s.p0[0] - d.p0[0]) * uy + (s.p0[1] - d.p0[1]) * ux
    rate = -vx * uy + vy * ux  # offset change per unit along s (|rate| >= cos 10 degrees)
    k = -h0 / rate
    mx, my = s.p0[0] + vx * k, s.p0[1] + vy * k
    along = (mx - d.p0[0]) * ux + (my - d.p0[1]) * uy
    if not any(abs(along - t) <= EXTENSION_TICK_THIN * t_thin for t in d.tick_positions):
        return None
    return k, mx, my


def touches_tick(s: Segment, d: DimensionLine, t_thin: float) -> bool:
    """``s`` is a thin line touching one of ``d``'s ticks (ruling R6's definition of an extension line):
    perpendicular to ``d``, meeting it at a tick and reaching it (the meeting point within ``3 t_thin`` of
    ``s``'s extent), whatever it runs on beyond."""
    hit = _tick_crossing(s, d, t_thin)
    if hit is None:
        return False
    reach = EXTENSION_OVERSHOOT_THIN[1] * t_thin
    return -reach <= hit[0] <= s.length + reach


def is_extension(s: Segment, d: DimensionLine, t_thin: float, ink: np.ndarray) -> bool:
    """``s`` is an extension line of ``d`` (ruling R6): perpendicular to it (within 10 degrees), meeting its
    line within ``2 t_thin`` of one of its ticks with one end (within ``3 t_thin``), and overshooting it in
    the ink: past the far edge of the dimension line the stroke runs on for ``t_thin .. 3 t_thin`` and stops
    (drafting convention; LSD often cuts the stub off at the crossing, so the ink is probed, not the
    segment). A partition face that stops at a line (a T junction) has no ink beyond it and a line passing
    through runs on, so neither is removed when a wall face was taken for a dimension line."""
    hit = _tick_crossing(s, d, t_thin)
    if hit is None:
        return False
    k, mx, my = hit
    s_len = s.length
    vx, vy = (s.p1[0] - s.p0[0]) / s_len, (s.p1[1] - s.p0[1]) / s_len
    reach = EXTENSION_OVERSHOOT_THIN[1] * t_thin
    if min(abs(k), abs(s_len - k)) > reach:
        return False  # the line passes through: the meeting point is far from both ends
    out = -1.0 if abs(k) < abs(s_len - k) else 1.0  # away from the segment's body
    edge = t_thin / 2.0 + 1.0  # the dimension line's far edge (it is thin)
    steps = np.arange(_MARCH_STEP, edge + reach + 2.0 * t_thin, _MARCH_STEP)
    pts = np.array((mx, my))[None, :] + (out * steps)[:, None] * np.array((vx, vy))[None, :]
    inked = sample(ink, pts) > 0
    gap = np.flatnonzero(~inked)
    run_on = float(steps[gap[0]]) if gap.size else float(steps[-1]) + _MARCH_STEP
    overshoot = run_on - edge
    return EXTENSION_OVERSHOOT_THIN[0] * t_thin <= overshoot <= reach


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


# --- step 3: double-line walls ------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class _Pair:
    i: int
    j: int
    d: float
    overlap: float


def double_mask(
    cands: Sequence[Segment],
    ink: np.ndarray,
    crop: Rect,
    L: float,
    t_thin: float,
    poll: Check,
    envelope: np.ndarray | None = None,
    dims: np.ndarray | None = None,
) -> np.ndarray:
    """Quadrilaterals between paired parallel thin lines (06 §8.1 step 3).

    ``dims`` (k, 4; page px) are the dimension lines' end points: thin lines cut by one are rejoined first
    (``_rejoined``).

    Pairs (ruling R6): both lines at least ``0.03 L`` long, angle difference <= 2 degrees, distance ``d`` in
    ``[1.5 t_thin, 0.02 L]``, projection overlap >= 60 % of the shorter segment and a hollow (< 15 % ink) or
    filled (> 85 %) strip; ``ink`` is the text-free ink. With an ``envelope`` (``solid_envelope``) at least
    half of the pair's centre line must lie in it. Greedy by ``d`` ascending, then overlap descending. Each
    stretch of a segment is used by one pair, on either side (06 says once per side: a face line bounds one
    wall, and its other side would pair with a dimension line or a counter edge into one thick block); a face
    line broken by a T junction still pairs with both pieces of the opposite face. A quad is extended by
    ``d / 2`` at an end where one of its lines runs on (a corner or junction), not where both stop (a
    door jamb), so corners close without narrowing openings.
    """
    mask = np.zeros((crop.h, crop.w), np.uint8)
    thin = [s for s in cands if s.is_thin]
    if dims is not None and dims.size and thin:
        thin = _rejoined(thin, dims, t_thin, poll)
    thin = [s for s in thin if s.length >= DOUBLE_MIN_LEN_FRAC * L]
    if len(thin) < 2:
        return mask
    origin = np.array((crop.x, crop.y), np.float64)
    p0 = np.array([s.p0 for s in thin], np.float64) - origin
    p1 = np.array([s.p1 for s in thin], np.float64) - origin
    width = np.array([s.width_px for s in thin], np.float64)
    length = np.hypot(*(p1 - p0).T)
    unit = (p1 - p0) / length[:, None]
    d_min, d_max = DOUBLE_D_MIN_THIN * t_thin, DOUBLE_D_MAX_FRAC * L

    pairs = _pair_candidates(p0, p1, length, unit, d_min, d_max, poll)
    if not pairs:
        return mask
    pairs.sort(key=lambda p: (p.d, -p.overlap, p.i, p.j))
    claims: dict[int, list[tuple[float, float]]] = defaultdict(list)
    for count, pr in enumerate(pairs):
        if count % 256 == 0:
            poll()
        geo = _pair_geometry(pr.i, pr.j, p0, p1, length, unit)
        if geo is None:
            continue
        s0, s1, side_i, (t0j, t1j), side_j = geo
        del side_j
        if not (_free(claims[pr.i], s0, s1) and _free(claims[pr.j], t0j, t1j)):
            continue
        if envelope is not None and not _inside(envelope, pr.i, pr.j, s0, s1, p0, unit, side_i, pr.d):
            continue
        ratio = _strip_ink(ink, p0[pr.i], unit[pr.i], side_i, s0, s1, pr.d, width[pr.i], width[pr.j])
        if HOLLOW_MAX <= ratio <= FILLED_MIN:
            continue
        claims[pr.i].append((s0, s1))
        claims[pr.j].append((t0j, t1j))
        _fill_pair(mask, pr.i, pr.j, s0, s1, pr.d, p0, p1, length, unit)
    return mask


def _rejoined(
    thin: list[Segment], dims: np.ndarray, t_thin: float, poll: Check | None = None
) -> list[Segment]:
    """Thin lines rejoined where a dimension line or its tick cut them (Task 16c). A piece with an end
    within ``3 t_thin`` of a dimension line (``dims``: (k, 4) end points), and the pieces collinear with it
    (within 1.5 degrees and 2 px) that overlap it or end at most ``3 t_thin`` from it, fuse whatever their
    measured widths: the segment stage keeps strokes more than 1.5x apart in width separate, and a thin
    line's width reads 1.9 or 3.8 px by chance. On HDB the "3200" line's end and tick cut both faces of the
    bedroom-2 wall 25 px short of the wall they meet.

    Cost: the ends are tested against the dimension lines in blocks, and a picked piece is compared only
    with the pieces of its own and the neighbouring 2-degree direction buckets inside an offset window
    (sorted, as in ``_pair_candidates``); ``poll`` is called between blocks."""
    poll = poll or (lambda: None)
    if not thin:
        return thin
    reach = REJOIN_GAP_THIN * t_thin
    p0 = np.array([s.p0 for s in thin], np.float64)
    p1 = np.array([s.p1 for s in thin], np.float64)
    ends = np.stack([p0, p1], axis=1).reshape(-1, 2)
    near = np.zeros(len(ends), bool)
    block = max(1, _MAX_SAMPLES // max(1, len(dims)))
    for lo in range(0, len(ends), block):
        poll()
        near[lo : lo + block] = (
            _point_segment_distances(ends[lo : lo + block], dims[:, :2], dims[:, 2:]) <= reach
        ).any(axis=1)
    seeds = np.flatnonzero(near.reshape(-1, 2).any(axis=1))
    if seeds.size == 0:
        return thin
    length = np.maximum(np.hypot(*(p1 - p0).T), 1e-9)
    unit = (p1 - p0) / length[:, None]
    angle = np.degrees(np.arctan2(unit[:, 1], unit[:, 0])) % 180.0
    n_buckets = round(180.0 / _ANGLE_BUCKET_DEG)
    bucket = np.minimum((angle // _ANGLE_BUCKET_DEG).astype(np.intp), n_buckets - 1)
    mid = (p0 + p1) / 2.0
    index: dict[int, tuple[np.ndarray, np.ndarray, float]] = {}  # bucket -> (members by rho, rho, max length)
    cos_tol = math.cos(math.radians(REJOIN_ANGLE_DEG))
    picked = set(seeds.tolist())
    for count, i in enumerate(seeds.tolist()):
        if count % 64 == 0:
            poll()
        b = int(bucket[i])
        for bk in ((b - 1) % n_buckets, b, (b + 1) % n_buckets):
            if bk not in index:
                members = np.flatnonzero(bucket == bk)
                theta = math.radians((bk + 0.5) * _ANGLE_BUCKET_DEG)
                rho = mid[members, 1] * math.cos(theta) - mid[members, 0] * math.sin(theta)
                order = np.argsort(rho, kind="stable")
                max_len = float(length[members].max()) if members.size else 0.0
                index[bk] = (members[order], rho[order], max_len)
            members, rho, max_len = index[bk]
            if members.size == 0:
                continue
            theta = math.radians((bk + 0.5) * _ANGLE_BUCKET_DEG)
            rho_i = mid[i, 1] * math.cos(theta) - mid[i, 0] * math.sin(theta)
            half = REJOIN_OFFSET_PX + math.sin(math.radians(REJOIN_ANGLE_DEG + 2 * _ANGLE_BUCKET_DEG)) * (
                length[i] + max_len + 2 * reach
            )
            lo, hi = np.searchsorted(rho, rho_i - half), np.searchsorted(rho, rho_i + half, side="right")
            js = members[lo:hi]
            if js.size == 0:
                continue
            u, n = unit[i], np.array((-unit[i][1], unit[i][0]))
            q0, q1 = p0[js] - p0[i], p1[js] - p0[i]
            ok = np.abs(unit[js] @ u) >= cos_tol
            ok &= np.maximum(np.abs(q0 @ n), np.abs(q1 @ n)) <= REJOIN_OFFSET_PX
            t0, t1 = q0 @ u, q1 @ u
            ok &= (np.minimum(t0, t1) <= length[i] + reach) & (np.maximum(t0, t1) >= -reach)
            picked.update(js[ok].tolist())
    if len(picked) < 2:
        return thin
    cut = [Segment(thin[k].id, thin[k].p0, thin[k].p1, t_thin, True, thin[k].source) for k in sorted(picked)]
    keep = [s for k, s in enumerate(thin) if k not in picked]
    return [*keep, *merge_collinear(cut, gap_tol=reach, check_deadline=poll)]


def _point_segment_distances(pts: np.ndarray, a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """(n_pts, n_segs) distances of points to segments ``a``-``b``."""
    d = b - a
    ll = np.maximum((d * d).sum(axis=1), 1e-12)
    r = pts[:, None, :] - a[None, :, :]
    t = np.clip((r * d[None]).sum(axis=2) / ll[None], 0.0, 1.0)
    q = a[None] + t[..., None] * d[None]
    return np.asarray(np.hypot(*(pts[:, None, :] - q).transpose(2, 0, 1)))


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


def _inside(
    envelope: np.ndarray,
    i: int,
    j: int,
    s0: float,
    s1: float,
    p0: np.ndarray,
    unit: np.ndarray,
    side_i: int,
    d: float,
) -> bool:
    """At least half of the pair's centre line (``i`` over ``[s0, s1]`` and ``j``) lies in ``envelope``."""
    del j
    u = unit[i]
    n = np.array((-u[1], u[0])) * side_i
    t = np.linspace(s0, s1, max(2, math.ceil((s1 - s0) / 2.0)))[:, None]
    pts = p0[i] + t * u + n * (d / 2.0)
    return float((sample(envelope, pts) > 0).mean()) >= ENVELOPE_MIN_INSIDE


def solid_envelope(solid: np.ndarray, L: float) -> np.ndarray | None:
    """Where double-line walls may lie: the convex hull of the solid (filled and bold) walls grown by
    ``0.01 L``, when that hull covers at least half of the plan region; otherwise (no solid outline, a few
    columns) None. Pairs of extension lines and stacked dimension chains outside a drawn outline are not
    walls; nothing a plan draws as walls lies outside its own outline."""
    if not solid.any():
        return None
    envelope = np.zeros_like(solid)
    cv2.fillConvexPoly(envelope, cv2.convexHull(cv2.findNonZero(solid)), 255)
    if np.count_nonzero(envelope) < ENVELOPE_MIN_COVER * envelope.size:
        return None
    k = 2 * round(ENVELOPE_GROW_FRAC * L) + 1
    return cv2.dilate(envelope, np.ones((k, k), np.uint8))


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
