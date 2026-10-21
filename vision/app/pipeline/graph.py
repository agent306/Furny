"""Wall graph building (06 section 8.1 steps 9-10): pure geometry over wall centre lines, no images.

``build_wall_graph`` turns raw wall centre lines into a snapped graph:

1. raw walls are validated, zero-length ones dropped, collinear overlapping detections fused (collinear
   walls whose facing ends are within ``r`` of each other fuse too, the gap becoming an opening);
2. endpoints within ``r`` are clustered (union-find over a KD tree) into nodes;
3. free ends are extended up to ``r + t`` along their direction onto another wall's centre line (L/T
   closure) and the clustering is redone;
4. a wall is split at every node lying on its centre line within ``r`` (T junction) and at every point
   where it properly crosses another wall (X junction);
5. walls on the same node pair are merged and short *dangling* walls (a free end, cascading) are pruned;
6. nodes are placed (axis-aligned walls keep right angles, diagonals meet at a least-squares
   intersection), ids ``N1..``/``W1..`` follow a stable geometric order and opening intervals are
   re-based onto each final wall.

Determinism: the result is a function of the *set* of raw walls. They are sorted canonically first and
every float sum uses ``math.fsum``, so ids, node sets, topology and coordinates do not depend on input
order; swapping a wall's ``p0``/``p1`` (with its openings re-measured) keeps ids and nodes exactly and
moves opening values by float rounding only (ulp level).

Cost: spatial grids / KD trees / sorted windows replace all-pairs loops, endpoints are collapsed on a
grid so stacked points stay cheap, and more than ``MAX_RAW_WALLS`` raw walls raise ``TooComplexError``.
"""

import itertools
import math
import time
from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass

import numpy as np
from scipy.spatial import cKDTree

from app.schemas.candidates import GapCandidate, RawWall, WallCandidate, WallGraph, WallSource
from app.utils.geometry import Pt, project_param

__all__ = ["EVIDENCE", "MAX_RAW_WALLS", "TooComplexError", "build_wall_graph"]

EVIDENCE: dict[WallSource, float] = {"filled": 1.0, "vector": 1.0, "double_line": 0.85, "single_line": 0.5}

MAX_RAW_WALLS = 20_000

_SOURCE_RANK: dict[WallSource, int] = {"filled": 0, "vector": 1, "double_line": 2, "single_line": 3}
_AXIS_TOL_DEG = 3.0  # 06 8.1 step 7: within 3 deg of an axis (relative to theta0) counts as axis-aligned
_COLLINEAR_SIN = math.sin(math.radians(3.0))  # double detections: at most 3 deg apart
_PARALLEL_SIN = math.sin(math.radians(15.0))  # a free end cannot extend onto a wall this close to parallel
_CROSS_SIN = math.sin(math.radians(3.0))  # walls closer to parallel than this are not a crossing
_LS_MIN_DET = math.sin(math.radians(10.0)) ** 2  # least squares needs lines more than 10 deg apart
_TRUST = 2.0  # a placed coordinate or intersection further than _TRUST * r from the centroid is not trusted
_MIN_GAP_OPENING = 1.5  # 06 8.1 step 8: a bridged gap shorter than this many t is closed silently
_MIN_OPENING_PX = 1.0  # a clipped opening interval shorter than this is a sliver, not an opening
_ZERO = 1e-9
_DEADLINE_EVERY = 128
_POLL_SECONDS = 0.02  # a block poll reaches the real deadline check at most this often
_MAX_SAMPLES = 400_000
_SAMPLE_BLOCK = 128
_ESTIMATE_SAMPLE = 128
_CELL_OFFSET = 1 << 20
_CELL_STRIDE = 1 << 22
_HUB_DEGREE = 16  # nodes with more walls than this widen the crossing-free zone around them
_MAX_CANDIDATE_PAIRS = (
    150_000_000  # grid estimate (about 3x the true pair count) beyond which a plan is too dense
)


class TooComplexError(ValueError):
    """The input is too large or too dense to snap; the orchestrator maps it to the ``too_complex`` error."""

    code = "too_complex"


Seg = tuple[Pt, Pt]
Check = Callable[[], None] | None


@dataclass(frozen=True, slots=True)
class _Frame:
    """The plan's axis frame, rotated by ``theta0`` (``u`` along ``theta0``, ``v`` along ``theta0 + 90``)."""

    c: float
    s: float

    @staticmethod
    def of(theta0_deg: float) -> "_Frame":
        rad = math.radians(theta0_deg)
        return _Frame(math.cos(rad), math.sin(rad))

    def to_local(self, x: float, y: float) -> Pt:
        return (x * self.c + y * self.s, -x * self.s + y * self.c)

    def to_world(self, u: float, v: float) -> Pt:
        return (u * self.c - v * self.s, u * self.s + v * self.c)


@dataclass(frozen=True, slots=True)
class _Line:
    """Infinite support line of one wall in the rotated frame: ``pos`` is ``u`` of a "v" wall (along
    ``theta0 + 90``) / ``v`` of an "h" wall (along ``theta0``), otherwise the line is
    ``nx * u + ny * v = c`` with unit normal ``(nx, ny)``."""

    kind: str  # "v", "h" or "d"
    pos: float
    nx: float
    ny: float
    c: float


@dataclass(slots=True)
class _Wall:
    """A raw wall after ingestion; ``openings`` are world-space segments (so geometry changes are free)."""

    p0: Pt
    p1: Pt
    thickness: float
    source: WallSource
    openings: list[Seg]
    line: _Line


@dataclass(slots=True)
class _Edge:
    """A wall between two node ids; ``wi`` is the index of the wall whose ends were clustered."""

    a: int
    b: int
    line: _Line
    thickness: float
    source: WallSource
    openings: list[Seg]
    wi: int = -1  # also identifies the original wall of split halves


def _tick(check: Check, counter: int) -> None:
    """Poll the deadline every ``_DEADLINE_EVERY`` iterations of a loop whose iterations are cheap."""
    if check is not None and counter % _DEADLINE_EVERY == 0:
        check()


def _poll(check: Check) -> None:
    """Poll the deadline once; for loops whose iterations do a block of vectorised work."""
    if check is not None:
        check()


def _throttled(check: Callable[[], None] | None) -> Callable[[], None] | None:
    """``check`` wrapped so it runs at most every ``_POLL_SECONDS`` (the first call always runs)."""
    if check is None:
        return None
    last = -math.inf

    def poll() -> None:
        nonlocal last
        now = time.perf_counter()
        if now - last >= _POLL_SECONDS:
            last = now
            check()

    return poll


# --- validation and ingestion -------------------------------------------------------------------------------


def _require_finite(values: tuple[float, ...], what: str) -> None:
    if not all(math.isfinite(v) for v in values):
        raise ValueError(f"{what} must be finite, got {values!r}")


def _make_line(p0: Pt, p1: Pt, frame: _Frame) -> _Line:
    u0, v0 = frame.to_local(*p0)
    u1, v1 = frame.to_local(*p1)
    du, dv = u1 - u0, v1 - v0
    length = math.hypot(du, dv)
    angle = math.degrees(math.atan2(dv, du)) % 180.0
    if min(angle, 180.0 - angle) <= _AXIS_TOL_DEG:
        return _Line("h", (v0 + v1) / 2.0, 0.0, 1.0, 0.0)
    if abs(angle - 90.0) <= _AXIS_TOL_DEG:
        return _Line("v", (u0 + u1) / 2.0, 1.0, 0.0, 0.0)
    nu, nv = -dv / length, du / length
    return _Line("d", 0.0, nu, nv, nu * (u0 + u1) / 2.0 + nv * (v0 + v1) / 2.0)


def _canonical(p0: Pt, p1: Pt) -> tuple[Pt, Pt]:
    return (p0, p1) if p0 <= p1 else (p1, p0)


def _make_wall(
    p0: Pt, p1: Pt, thickness: float, source: WallSource, openings: list[Seg], frame: _Frame
) -> _Wall:
    p0, p1 = _canonical(p0, p1)
    return _Wall(p0, p1, thickness, source, openings, _make_line(p0, p1, frame))


def _wall_key(w: _Wall) -> tuple[object, ...]:
    return (w.p0, w.p1, w.thickness, _SOURCE_RANK[w.source], tuple(sorted(w.openings)))


def _ingest(raw: list[RawWall], frame: _Frame, check: Check) -> list[_Wall]:
    walls: list[_Wall] = []
    for k, rw in enumerate(raw):
        _tick(check, k)
        _require_finite((*rw.p0, *rw.p1, rw.thickness_px), "wall coordinates and thickness")
        for op in rw.openings_px:
            _require_finite((op[0], op[1]), "opening interval")
        if rw.thickness_px < 0:
            raise ValueError(f"wall thickness must be >= 0, got {rw.thickness_px!r}")
        dx, dy = rw.p1[0] - rw.p0[0], rw.p1[1] - rw.p0[1]
        length = math.hypot(dx, dy)
        if length <= _ZERO:
            continue
        ux, uy = dx / length, dy / length
        openings: list[Seg] = []
        for u0, u1 in rw.openings_px:
            lo, hi = max(0.0, min(u0, u1)), min(length, max(u0, u1))
            if hi - lo > _ZERO:
                openings.append(
                    ((rw.p0[0] + ux * lo, rw.p0[1] + uy * lo), (rw.p0[0] + ux * hi, rw.p0[1] + uy * hi))
                )
        walls.append(_make_wall(rw.p0, rw.p1, rw.thickness_px, rw.source, openings, frame))
    walls.sort(key=_wall_key)
    return walls


# --- spatial index ------------------------------------------------------------------------------------------


class _SegIndex:
    """KD tree over points sampled along segments at most ``step`` apart (endpoints included).

    A point within ``radius`` of a segment has a sample within ``radius + step / 2`` of it, which is what
    ``near`` queries; exact tests are left to the caller. ``step`` grows when the walls are so long that
    more than ``_MAX_SAMPLES`` points would be needed (``self.step`` is the spacing actually used).
    """

    def __init__(self, p0: np.ndarray, p1: np.ndarray, step: float) -> None:
        vec = p1 - p0
        length = np.hypot(vec[:, 0], vec[:, 1])
        counts = np.maximum(np.ceil(length / step).astype(np.intp), 1) + 1
        if (
            int(counts.sum()) > _MAX_SAMPLES
        ):  # keep the (uninterruptible) tree build small: sample more coarsely
            step *= int(counts.sum()) / _MAX_SAMPLES
            counts = np.maximum(np.ceil(length / step).astype(np.intp), 1) + 1
        self.owner = np.repeat(np.arange(len(p0), dtype=np.intp), counts)
        starts = np.cumsum(counts) - counts
        local = np.arange(self.owner.size) - np.repeat(starts, counts)
        t = local / np.repeat(counts - 1, counts)
        self.tree = cKDTree(p0[self.owner] + t[:, None] * vec[self.owner])
        self.step = step

    def near(self, pts: np.ndarray, radius: float, check: Check = None) -> list[np.ndarray]:
        out: list[np.ndarray] = []
        for start in range(0, len(pts), 1024):
            _poll(check)
            hits = self.tree.query_ball_point(pts[start : start + 1024], radius + self.step / 2.0)
            out.extend(np.unique(self.owner[h]) for h in hits)
        return out


_CELL_KEEP = 8  # points kept per grid cell for the cross-cell neighbour search


class _UnionFind:
    """Union-find whose roots are always the smallest member index (order independent)."""

    def __init__(self, n: int) -> None:
        self.parent = list(range(n))

    def find(self, i: int) -> int:
        parent = self.parent
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(self, i: int, j: int) -> bool:
        ri, rj = self.find(i), self.find(j)
        if ri == rj:
            return False
        self.parent[max(ri, rj)] = min(ri, rj)
        return True


def _extremes(pts: np.ndarray) -> list[int]:
    """Indices of the (up to 8) points extreme along x, y, x + y and x - y: a cell's proximity hull."""
    keys = (pts[:, 0], pts[:, 1], pts[:, 0] + pts[:, 1], pts[:, 0] - pts[:, 1])
    picked = {int(np.argmin(k)) for k in keys} | {int(np.argmax(k)) for k in keys}
    return sorted(picked)


def _cluster(points: np.ndarray, r: float, check: Check = None) -> list[int]:
    """Single-linkage clusters of points at distance <= r; labels are numbered by first appearance.

    Points sharing a grid cell of side ``r / 2`` are within ``r`` of each other, so they are united
    directly and only up to ``_CELL_KEEP`` extreme points per cell enter the KD-tree neighbour search. That
    keeps stacked points linear in time and memory; the result is exact for cells of at most
    ``_CELL_KEEP`` points and accurate to a fraction of a pixel for the rest.
    """
    n = len(points)
    uf = _UnionFind(n)
    if n > 1:
        cell = np.floor(points / (r / 2.0)).astype(np.int64)
        order = np.lexsort((cell[:, 1], cell[:, 0]))  # stable: ties stay in index order
        sc = cell[order]
        first_of_group = np.ones(n, bool)
        first_of_group[1:] = (sc[1:] != sc[:-1]).any(axis=1)
        starts = np.flatnonzero(first_of_group)
        stops = np.append(starts[1:], n)
        kept: list[int] = []
        for g, (a, b) in enumerate(zip(starts.tolist(), stops.tolist(), strict=True)):
            _tick(check, g)
            members = order[a:b]
            head = int(members[0])
            for m in members[1:].tolist():
                uf.union(head, m)
            if b - a <= _CELL_KEEP:
                kept.extend(members.tolist())
            else:
                kept.extend(int(members[i]) for i in _extremes(points[members]))
        kept_arr = np.array(kept, np.intp)
        pairs = cKDTree(points[kept_arr]).query_pairs(r, output_type="ndarray")
        for count, (i, j) in enumerate(kept_arr[pairs].tolist()):
            _tick(check, count)
            uf.union(i, j)
    labels: dict[int, int] = {}
    return [labels.setdefault(uf.find(i), len(labels)) for i in range(n)]


# --- step 1: collinear overlapping detections ---------------------------------------------------------------

_BUCKET_DEG = 3.0
_PAIR_CHUNK = 100_000
_GAP_CHUNK = 1024
_GAP_NEIGHBOURS = 32
_BLOCK = 256


def _merge_overlaps(
    walls: list[_Wall], r: float, t_median: float, frame: _Frame, check: Check
) -> list[_Wall]:
    """Fuse walls lying on one line that overlap along it (double detections of one wall), or whose
    facing ends are within ``r`` of each other (a gap of at least ``1.5 * t_median`` becomes an opening
    interval, a smaller one closes silently).

    Candidates are collinear pairs: direction within 3 degrees, both ends of the shorter within
    ``max(1, 0.5 * max thickness)`` of the longer's line (``0.5 * t_median`` across a gap) and overlap of at
    least ``min(r, 0.5 * shorter)`` or a gap of at most ``r``. A gap next to a wall that is not collinear
    with the pair (a junction) is not bridged. Pairs come from sorted offset windows inside 3-degree
    direction buckets and are united as found; walls already in one component are skipped, so
    stacked duplicates cost linear time and memory. A component only fuses the members that are collinear
    with its longest wall (no chain drift); the others stay as they are.
    """
    n = len(walls)
    if n < 2:
        return walls
    p0 = np.array([w.p0 for w in walls], np.float64)
    p1 = np.array([w.p1 for w in walls], np.float64)
    thick = np.array([w.thickness for w in walls], np.float64)
    length = np.hypot(*(p1 - p0).T)
    unit = (p1 - p0) / length[:, None]
    margin = max(1.0, 0.5 * float(thick.max()))
    gap_tol = 0.5 * t_median
    uf = _UnionFind(n)
    seg_index: list[_SegIndex] = []
    near_step = r + t_median

    def blocked(a: np.ndarray, b: np.ndarray) -> np.ndarray:
        """Mask of gap pairs that must not be bridged: a wall that is not collinear with the pair has an
        end near the gap (a junction) or properly crosses it. Only the nearest ``_GAP_NEIGHBOURS`` wall
        samples around each gap are examined, so dense areas stay bounded."""
        if not seg_index:
            seg_index.append(_SegIndex(p0, p1, near_step))
        index = seg_index[0]
        owner = np.append(index.owner, -1)
        out = np.zeros(len(a), bool)
        for start in range(0, len(a), _GAP_CHUNK):
            _poll(check)
            aa, bb = a[start : start + _GAP_CHUNK], b[start : start + _GAP_CHUNK]
            m = len(aa)
            ends_a = np.stack([p0[aa], p1[aa]], axis=1)  # (m, 2, 2)
            ends_b = np.stack([p0[bb], p1[bb]], axis=1)
            dist = np.hypot(*(ends_a[:, :, None, :] - ends_b[:, None, :, :]).transpose(3, 0, 1, 2))
            flat = dist.reshape(m, 4).argmin(axis=1)
            rows = np.arange(m)
            s0, s1 = ends_a[rows, flat // 2], ends_b[rows, flat % 2]
            centre, gap = (s0 + s1) / 2.0, np.hypot(*(s0 - s1).T)
            bound = float(gap.max()) / 2.0 + near_step
            _, nn = index.tree.query(centre, k=_GAP_NEIGHBOURS, distance_upper_bound=bound)
            wk = owner[nn]  # -1 where fewer neighbours exist
            valid = wk >= 0
            wk = np.where(valid, wk, 0)
            other = (
                valid
                & (wk != aa[:, None])
                & (wk != bb[:, None])
                & (
                    np.abs(unit[wk, 0] * unit[aa, 1][:, None] - unit[wk, 1] * unit[aa, 0][:, None])
                    > _COLLINEAR_SIN
                )
            )
            q0, q1 = p0[wk], p1[wk]  # (m, K, 2)
            near_end = (
                np.minimum(
                    np.hypot(*(q0 - centre[:, None, :]).transpose(2, 0, 1)),
                    np.hypot(*(q1 - centre[:, None, :]).transpose(2, 0, 1)),
                )
                <= (gap / 2.0 + r)[:, None]
            )
            gv = (s1 - s0)[:, None, :]
            o1 = gv[..., 0] * (q0[..., 1] - s0[:, None, 1]) - gv[..., 1] * (q0[..., 0] - s0[:, None, 0])
            o2 = gv[..., 0] * (q1[..., 1] - s0[:, None, 1]) - gv[..., 1] * (q1[..., 0] - s0[:, None, 0])
            qv = q1 - q0
            o3 = qv[..., 0] * (s0[:, None, 1] - q0[..., 1]) - qv[..., 1] * (s0[:, None, 0] - q0[..., 0])
            o4 = qv[..., 0] * (s1[:, None, 1] - q0[..., 1]) - qv[..., 1] * (s1[:, None, 0] - q0[..., 0])
            crossing = (o1 * o2 < 0.0) & (o3 * o4 < 0.0)
            out[start : start + _GAP_CHUNK] = (other & (near_end | crossing)).any(axis=1)
        return out

    def unite(i: np.ndarray, j: np.ndarray) -> bool:
        swap = (length[i] < length[j]) | ((length[i] == length[j]) & (i > j))
        a, b = np.where(swap, j, i), np.where(swap, i, j)  # a: the longer wall, the line b must lie on
        ua, ub = unit[a], unit[b]
        ok = np.abs(ua[:, 0] * ub[:, 1] - ua[:, 1] * ub[:, 0]) <= _COLLINEAR_SIN
        rel0, rel1 = p0[b] - p0[a], p1[b] - p0[a]
        t0, t1 = (rel0 * ua).sum(axis=1), (rel1 * ua).sum(axis=1)
        n0 = np.abs(ua[:, 0] * rel0[:, 1] - ua[:, 1] * rel0[:, 0])
        n1 = np.abs(ua[:, 0] * rel1[:, 1] - ua[:, 1] * rel1[:, 0])
        tol = np.maximum(1.0, 0.5 * np.maximum(thick[a], thick[b]))
        overlap = np.minimum(np.maximum(t0, t1), length[a]) - np.maximum(np.minimum(t0, t1), 0.0)
        overlapping = ok & (n0 <= tol) & (n1 <= tol) & (overlap >= np.minimum(r, 0.5 * length[b]))
        gapped = ok & ~overlapping & (n0 <= gap_tol) & (n1 <= gap_tol) & (overlap >= -r)
        gap_idx = np.flatnonzero(gapped)
        if len(gap_idx):
            gapped[gap_idx[blocked(a[gap_idx], b[gap_idx])]] = False
        united = False
        for count, (x, y) in enumerate(
            zip(i[overlapping | gapped].tolist(), j[overlapping | gapped].tolist(), strict=True)
        ):
            _tick(check, count)
            united |= uf.union(x, y)
        return united

    angle = np.degrees(np.arctan2(p1[:, 1] - p0[:, 1], p1[:, 0] - p0[:, 0])) % 180.0
    n_buckets = round(180.0 / _BUCKET_DEG)
    bucket = np.minimum((angle // _BUCKET_DEG).astype(np.intp), n_buckets - 1)
    mid = (p0 + p1) / 2.0
    roots = np.arange(n)
    dirty = False
    for bk in np.unique(bucket).tolist():
        members = np.flatnonzero(bucket == bk)
        partners = np.flatnonzero((bucket == bk) | (bucket == (bk + 1) % n_buckets))
        theta = math.radians((bk + 0.5) * _BUCKET_DEG)
        rho = mid[:, 1] * math.cos(theta) - mid[:, 0] * math.sin(theta)
        partners = partners[np.argsort(rho[partners], kind="stable")]
        rho_sorted = rho[partners]
        half = 2.0 * margin + 0.04 * (length[members] + float(length[partners].max()))
        lo = np.searchsorted(rho_sorted, rho[members] - half, side="left")
        hi = np.searchsorted(rho_sorted, rho[members] + half, side="right")
        s = 0
        while s < len(members):
            _poll(check)
            if dirty:
                roots = np.array([uf.find(k) for k in range(n)], np.intp)
                dirty = False
            root_sorted = roots[partners]
            change = np.concatenate(([0], np.cumsum(root_sorted[1:] != root_sorted[:-1])))
            e = min(s + _BLOCK, len(members))
            m, lw, hw = members[s:e], lo[s:e], hi[s:e]
            nonempty = hw > lw
            lc, hc = np.minimum(lw, len(partners) - 1), np.maximum(hw - 1, 0)
            # Windows whose partners all share the member's component cannot unite anything new.
            same = nonempty & (change[hc] == change[lc]) & (root_sorted[lc] == roots[m])
            cnt = np.where(nonempty & ~same, hw - lw, 0)
            take = min(max(int(np.searchsorted(np.cumsum(cnt), _PAIR_CHUNK, side="right")), 1), len(m))
            c = cnt[:take]
            total = int(c.sum())
            if total:
                ii = np.repeat(m[:take], c)
                pos = np.repeat(lw[:take], c) + np.arange(total) - np.repeat(np.cumsum(c) - c, c)
                jj = partners[pos]
                keep = ((bucket[jj] != bk) | (jj > ii)) & (roots[ii] != roots[jj])
                if keep.any():
                    dirty |= unite(ii[keep], jj[keep])
            s += take

    groups: dict[int, list[int]] = defaultdict(list)
    for k in range(n):
        groups[uf.find(k)].append(k)
    out: list[_Wall] = []
    for members_list in groups.values():  # ascending first member: canonical
        _poll(check)
        if len(members_list) == 1:
            out.append(walls[members_list[0]])
            continue
        mem = np.array(members_list, np.intp)
        base = min(members_list, key=lambda k: (-length[k], k))
        ub, o = unit[base], p0[base]
        nb = np.array((-ub[1], ub[0]))
        rel0, rel1 = p0[mem] - o, p1[mem] - o
        tol = np.maximum(1.0, 0.5 * np.maximum(thick[base], thick[mem]))
        valid = (
            (np.abs(ub[0] * unit[mem, 1] - ub[1] * unit[mem, 0]) <= _COLLINEAR_SIN)
            & (np.abs(rel0 @ nb) <= tol)
            & (np.abs(rel1 @ nb) <= tol)
        ) | (mem == base)
        out.extend(walls[k] for k in mem[~valid].tolist())
        vm = mem[valid]
        if len(vm) == 1:
            out.append(walls[base])
            continue
        r0, r1 = rel0[valid], rel1[valid]
        s0, s1 = r0 @ ub, r1 @ ub
        w = length[vm].tolist()
        total_w = math.fsum(w)
        off = (
            math.fsum(wi * oi for wi, oi in zip(w, (((r0 + r1) / 2.0) @ nb).tolist(), strict=True)) / total_w
        )
        thickness = math.fsum(wi * ti for wi, ti in zip(w, thick[vm].tolist(), strict=True)) / total_w
        lo_s, hi_s = np.minimum(s0, s1), np.maximum(s0, s1)
        openings: list[Seg] = [seg for k in vm.tolist() for seg in walls[k].openings]
        covered_to = None
        for idx in np.lexsort((hi_s, lo_s)).tolist():
            if covered_to is not None and lo_s[idx] - covered_to >= _MIN_GAP_OPENING * t_median:
                t0, t1 = covered_to, float(lo_s[idx])
                openings.append(
                    (
                        (float(o[0] + ub[0] * t0 + nb[0] * off), float(o[1] + ub[1] * t0 + nb[1] * off)),
                        (float(o[0] + ub[0] * t1 + nb[0] * off), float(o[1] + ub[1] * t1 + nb[1] * off)),
                    )
                )
            covered_to = float(hi_s[idx]) if covered_to is None else max(covered_to, float(hi_s[idx]))
        smin, smax = float(lo_s.min()), float(hi_s.max())
        source = min((walls[k].source for k in vm.tolist()), key=lambda src: _SOURCE_RANK[src])
        out.append(
            _make_wall(
                (float(o[0] + ub[0] * smin + nb[0] * off), float(o[1] + ub[1] * smin + nb[1] * off)),
                (float(o[0] + ub[0] * smax + nb[0] * off), float(o[1] + ub[1] * smax + nb[1] * off)),
                thickness,
                source,
                openings,
                frame,
            )
        )
    out.sort(key=_wall_key)
    return out


# --- node placement -----------------------------------------------------------------------------------------


def _place_nodes(edges: list[_Edge], node_pts: dict[int, list[Pt]], r: float, frame: _Frame) -> dict[int, Pt]:
    """Position of every node touched by ``edges`` (06 8.1 step 9), computed in the ``theta0`` frame.

    ``u`` is the mean position of the incident "v" walls, ``v`` that of the incident "h" walls (a value
    further than ``2 r`` from the centroid of the clustered endpoints is not trusted, so a long tilted
    wall never drags its end far). A coordinate no axis wall fixes comes from the least-squares
    intersection of the incident diagonal centre lines (given the fixed coordinate, if any) and otherwise
    from the centroid; a least-squares solution further than ``2 r`` from the centroid, or from lines
    within 10 degrees of parallel, falls back to the centroid.
    """
    incident: dict[int, dict[int, _Line]] = defaultdict(dict)
    for e in edges:
        incident[e.a][id(e.line)] = e.line
        incident[e.b][id(e.line)] = e.line
    placed: dict[int, Pt] = {}
    for node, lines in incident.items():
        pts = node_pts[node]
        cu, cv = frame.to_local(
            math.fsum(p[0] for p in pts) / len(pts), math.fsum(p[1] for p in pts) / len(pts)
        )
        us = [ln.pos for ln in lines.values() if ln.kind == "v"]
        vs = [ln.pos for ln in lines.values() if ln.kind == "h"]
        diags = [ln for ln in lines.values() if ln.kind == "d"]
        u = math.fsum(us) / len(us) if us else None
        v = math.fsum(vs) / len(vs) if vs else None
        if u is not None and abs(u - cu) > _TRUST * r:
            u = None
        if v is not None and abs(v - cv) > _TRUST * r:
            v = None
        if u is not None and v is not None:
            placed[node] = frame.to_world(u, v)
        elif u is not None:
            placed[node] = frame.to_world(u, _solve_free(diags, 1, u, cv, r))
        elif v is not None:
            placed[node] = frame.to_world(_solve_free(diags, 0, v, cu, r), v)
        else:
            placed[node] = frame.to_world(*_intersect(diags, (cu, cv), r))
    return placed


def _solve_free(diags: list[_Line], axis: int, fixed: float, fallback: float, r: float) -> float:
    """The free coordinate (``axis`` 1: v given u, 0: u given v) minimising the squared distance to the
    diagonal lines, or ``fallback`` when there are none or the solution is not trusted."""
    nums, dens = [], []
    for ln in diags:
        n_free, n_fixed = (ln.ny, ln.nx) if axis == 1 else (ln.nx, ln.ny)
        nums.append(n_free * (ln.c - n_fixed * fixed))
        dens.append(n_free * n_free)
    if not nums:
        return fallback
    num, den = math.fsum(nums), math.fsum(dens)
    if den < _LS_MIN_DET or abs(num / den - fallback) > _TRUST * r:
        return fallback
    return num / den


def _intersect(diags: list[_Line], centroid: Pt, r: float) -> Pt:
    if len(diags) < 2:
        return centroid
    a00 = math.fsum(ln.nx * ln.nx for ln in diags)
    a01 = math.fsum(ln.nx * ln.ny for ln in diags)
    a11 = math.fsum(ln.ny * ln.ny for ln in diags)
    b0 = math.fsum(ln.nx * ln.c for ln in diags)
    b1 = math.fsum(ln.ny * ln.c for ln in diags)
    det = a00 * a11 - a01 * a01
    if det < _LS_MIN_DET * len(diags) * len(diags) / 4.0:
        return centroid
    x, y = (a11 * b0 - a01 * b1) / det, (a00 * b1 - a01 * b0) / det
    return (x, y) if math.hypot(x - centroid[0], y - centroid[1]) <= _TRUST * r else centroid


# --- steps 2-4: clustering, extension, T split --------------------------------------------------------------


def _build_edges(
    walls: list[_Wall], ends: np.ndarray, r: float, check: Check
) -> tuple[list[_Edge], dict[int, list[Pt]]]:
    """Cluster all endpoints and make one edge per wall whose two ends land in different nodes."""
    flat = ends.reshape(-1, 2)
    labels = _cluster(flat, r, check)
    edges: list[_Edge] = []
    node_pts: dict[int, list[Pt]] = defaultdict(list)
    for wi, w in enumerate(walls):
        a, b = labels[2 * wi], labels[2 * wi + 1]
        if a == b:
            continue
        edges.append(_Edge(a, b, w.line, w.thickness, w.source, w.openings, wi))
        node_pts[a].append((float(ends[wi, 0, 0]), float(ends[wi, 0, 1])))
        node_pts[b].append((float(ends[wi, 1, 0]), float(ends[wi, 1, 1])))
    return edges, node_pts


def _edge_arrays(edges: list[_Edge], placed: dict[int, Pt]) -> tuple[np.ndarray, np.ndarray]:
    pa = np.array([placed[e.a] for e in edges], np.float64).reshape(-1, 2)
    pb = np.array([placed[e.b] for e in edges], np.float64).reshape(-1, 2)
    return pa, pb


def _direction(line: _Line, frm: Pt, to: Pt, frame: _Frame) -> Pt:
    """Unit direction of a wall's line from ``frm`` towards ``to`` (exactly axis-parallel for axis walls)."""
    if line.kind == "h":
        d = (frame.c, frame.s)
    elif line.kind == "v":
        d = (-frame.s, frame.c)
    else:
        d = frame.to_world(-line.ny, line.nx)
    return d if (to[0] - frm[0]) * d[0] + (to[1] - frm[1]) * d[1] >= 0 else (-d[0], -d[1])


def _extend_free_ends(
    ends: np.ndarray,
    edges: list[_Edge],
    node_pts: dict[int, list[Pt]],
    r: float,
    reach: float,
    step: float,
    frame: _Frame,
    check: Check,
) -> bool:
    """Move free ends onto the nearest other centre line ahead of them within ``reach``; True if any moved."""
    degree: dict[int, int] = defaultdict(int)
    for e in edges:
        degree[e.a] += 1
        degree[e.b] += 1
    free = [(k, end) for k, e in enumerate(edges) for end in (0, 1) if degree[e.a if end == 0 else e.b] == 1]
    if not free:
        return False
    placed = _place_nodes(edges, node_pts, r, frame)
    pa, pb = _edge_arrays(edges, placed)
    index = _SegIndex(pa, pb, step)
    tips = np.array([placed[edges[k].a if end == 0 else edges[k].b] for k, end in free], np.float64)
    moved = False
    for (k, end), cands in zip(free, index.near(tips, reach, check), strict=True):
        _poll(check)
        e = edges[k]
        tip = placed[e.a if end == 0 else e.b]
        other = placed[e.b if end == 0 else e.a]
        dx, dy = _direction(e.line, other, tip, frame)
        best: tuple[float, int, Pt] | None = None
        for j in cands.tolist():
            if j == k:
                continue
            ax, ay = pa[j]
            wx, wy = pb[j][0] - ax, pb[j][1] - ay
            wl = math.hypot(wx, wy)
            denom = dx * wy - dy * wx
            if wl <= _ZERO or abs(denom) < _PARALLEL_SIN * wl:
                continue
            rx, ry = ax - tip[0], ay - tip[1]
            lam = (rx * wy - ry * wx) / denom
            s = (rx * dy - ry * dx) / denom
            if not 0.0 < lam <= reach or not -r / wl <= s <= 1.0 + r / wl:
                continue
            if best is None or (lam, j) < (best[0], best[1]):
                best = (lam, j, (tip[0] + lam * dx, tip[1] + lam * dy))
        if best is not None:
            ends[e.wi, end] = best[2]
            moved = True
    return moved


def _split_t_junctions(
    edges: list[_Edge], node_pts: dict[int, list[Pt]], r: float, step: float, frame: _Frame, check: Check
) -> list[_Edge]:
    """Split every wall at the nodes lying on its centre line within ``r`` (06 8.1 step 9, third bullet)."""
    placed = _place_nodes(edges, node_pts, r, frame)
    pa, pb = _edge_arrays(edges, placed)
    node_ids = sorted(placed)
    pts = np.array([placed[q] for q in node_ids], np.float64).reshape(-1, 2)
    index = _SegIndex(pa, pb, step)
    splits: dict[int, list[tuple[float, int]]] = defaultdict(list)
    for q, cands in zip(node_ids, index.near(pts, r, check), strict=True):
        _poll(check)
        qx, qy = placed[q]
        for j in cands.tolist():
            e = edges[j]
            if q in (e.a, e.b):
                continue
            ax, ay = pa[j]
            bx, by = pb[j]
            t = project_param((qx, qy), (ax, ay), (bx, by))
            if not 0.0 < t < 1.0:
                continue
            if math.hypot(qx - (ax + t * (bx - ax)), qy - (ay + t * (by - ay))) > r:
                continue
            if math.hypot(qx - ax, qy - ay) <= r or math.hypot(qx - bx, qy - by) <= r:
                continue
            splits[j].append((t, q))
    if not splits:
        return edges
    out: list[_Edge] = []
    for j, e in enumerate(edges):
        if j not in splits:
            out.append(e)
            continue
        chain = [e.a, *(q for _, q in sorted(splits[j])), e.b]
        for a, b in itertools.pairwise(chain):
            if a != b:
                out.append(_Edge(a, b, e.line, e.thickness, e.source, e.openings, e.wi))
    return out


def _estimate_pairs(points: np.ndarray, cell: float, check: Check) -> float:
    """Upper-bound estimate of the point pairs closer than ``cell``: a histogram of the points over a grid
    of side ``cell`` and the sum of ``count * neighbourhood count`` over the cells. Built in chunks."""
    keys: list[np.ndarray] = []
    for start in range(0, len(points), 200_000):
        _poll(check)
        c = np.floor(points[start : start + 200_000] / cell).astype(np.int64) + _CELL_OFFSET
        keys.append(c[:, 0] * _CELL_STRIDE + c[:, 1])
    uniq, count = np.unique(np.concatenate(keys), return_counts=True)
    total = 0.0
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            _poll(check)
            wanted = uniq + dx * _CELL_STRIDE + dy
            pos = np.minimum(np.searchsorted(uniq, wanted), len(uniq) - 1)
            hit = uniq[pos] == wanted
            total += float((count * np.where(hit, count[pos], 0)).sum())
    return total


@dataclass(slots=True)
class _CrossingGeometry:
    """Placed edge geometry for the crossing stage: ``trim_*`` is the length at each end that is ignored
    (``r``, or more at a hub of many walls, capped at 45 % of the length)."""

    pa: np.ndarray
    pb: np.ndarray
    vec: np.ndarray
    length: np.ndarray
    trim_a: np.ndarray
    trim_b: np.ndarray
    node_a: np.ndarray
    node_b: np.ndarray


def _crossing_geometry(edges: list[_Edge], placed: dict[int, Pt], r: float) -> _CrossingGeometry:
    pa, pb = _edge_arrays(edges, placed)
    vec = pb - pa
    length = np.hypot(vec[:, 0], vec[:, 1])
    degree: dict[int, int] = defaultdict(int)
    for e in edges:
        degree[e.a] += 1
        degree[e.b] += 1
    node_a = np.array([e.a for e in edges], np.int64)
    node_b = np.array([e.b for e in edges], np.int64)
    deg_a = np.array([degree[e.a] for e in edges], np.float64)
    deg_b = np.array([degree[e.b] for e in edges], np.float64)
    cap = 0.45 * length
    return _CrossingGeometry(
        pa,
        pb,
        vec,
        length,
        np.minimum(cap, r * np.maximum(1.0, deg_a / _HUB_DEGREE)),
        np.minimum(cap, r * np.maximum(1.0, deg_b / _HUB_DEGREE)),
        node_a,
        node_b,
    )


def _estimate_split_walls(geo: _CrossingGeometry, r: float, check: Check) -> float:
    """Estimated number of walls after splitting at proper crossings (``n + 2 * crossings``).

    Crossings are counted exactly for a deterministic sample of at most ``_ESTIMATE_SAMPLE`` walls against
    all walls and scaled; every crossing is seen from both of its walls, hence the division by two. The
    same rules as in ``_split_crossings`` apply: walls of at most ``2 r``, walls sharing a node, crossings
    within ``r`` of an end and crossings inside a hub's ignored zone do not count.
    """
    n = len(geo.pa)
    eligible = np.flatnonzero(geo.length > 2.0 * r)
    if len(eligible) < 2:
        return float(n)
    pa, pb, vec, length = geo.pa, geo.pb, geo.vec, geo.length
    sample = eligible[
        np.unique(np.linspace(0, len(eligible) - 1, min(len(eligible), _ESTIMATE_SAMPLE)).astype(np.intp))
    ]
    crossings = 0
    for start in range(0, len(sample), 8):
        _poll(check)
        i = sample[start : start + 8][:, None]
        j = eligible[None, :]
        d1x, d1y, d2x, d2y = vec[i, 0], vec[i, 1], vec[j, 0], vec[j, 1]
        denom = d1x * d2y - d1y * d2x
        ok = np.abs(denom) > _CROSS_SIN * length[i] * length[j]
        ok &= (geo.node_a[i] != geo.node_a[j]) & (geo.node_a[i] != geo.node_b[j])
        ok &= (geo.node_b[i] != geo.node_a[j]) & (geo.node_b[i] != geo.node_b[j])
        safe = np.where(ok, denom, 1.0)
        dx, dy = pa[j, 0] - pa[i, 0], pa[j, 1] - pa[i, 1]
        t = (dx * d2y - dy * d2x) / safe
        u = (dx * d1y - dy * d1x) / safe
        ok &= (t > 0.0) & (t < 1.0) & (u > 0.0) & (u < 1.0)
        ok &= (t * length[i] >= geo.trim_a[i]) & ((1.0 - t) * length[i] >= geo.trim_b[i])
        ok &= (u * length[j] >= geo.trim_a[j]) & ((1.0 - u) * length[j] >= geo.trim_b[j])
        cx, cy = pa[i, 0] + t * d1x, pa[i, 1] + t * d1y
        for end in (pa[i], pb[i], pa[j], pb[j]):
            ok &= np.hypot(cx - end[..., 0], cy - end[..., 1]) > r
        crossings += int(ok.sum())
    return n + crossings * len(eligible) / len(sample)


def _check_crossing_load(
    edges: list[_Edge], node_pts: dict[int, list[Pt]], r: float, frame: _Frame, check: Check
) -> None:
    """Raise ``TooComplexError`` early when splitting at crossings would give more than ``MAX_RAW_WALLS``."""
    if len(edges) < 2:
        return
    geo = _crossing_geometry(edges, _place_nodes(edges, node_pts, r, frame), r)
    if _estimate_split_walls(geo, r, check) > MAX_RAW_WALLS:
        raise TooComplexError("the walls would be split into too many pieces")


def _split_crossings(
    edges: list[_Edge], node_pts: dict[int, list[Pt]], r: float, step: float, frame: _Frame, check: Check
) -> list[_Edge]:
    """Split two walls that properly cross (neither end on the other) at a shared node.

    A crossing only counts when it lies inside both walls and further than ``r`` from the four ends
    (nearer ones are L/T junctions). Crossing points within ``r`` of each other share one node.
    """
    placed = _place_nodes(edges, node_pts, r, frame)
    geo = _crossing_geometry(edges, placed, r)
    pa, pb, vec, length = geo.pa, geo.pb, geo.vec, geo.length
    long_edges = np.flatnonzero(length > 2.0 * r)
    if len(long_edges) < 2:
        return edges
    unit = vec[long_edges] / length[long_edges, None]
    index = _SegIndex(
        pa[long_edges] + unit * geo.trim_a[long_edges, None],
        pb[long_edges] - unit * geo.trim_b[long_edges, None],
        step,
    )
    data = index.tree.data
    if _estimate_pairs(data, index.step, check) > _MAX_CANDIDATE_PAIRS:
        raise TooComplexError("too many walls cross or touch in one place")
    n_edges = len(edges)
    found: list[tuple[np.ndarray, np.ndarray, np.ndarray]] = []
    seen: set[int] = set()
    for start in range(0, len(data), _SAMPLE_BLOCK):
        _poll(check)
        stop = min(start + _SAMPLE_BLOCK, len(data))
        hits = index.tree.query_ball_point(data[start:stop], index.step)
        counts = np.fromiter((len(h) for h in hits), np.intp, stop - start)
        if not counts.any():
            continue
        oi = long_edges[np.repeat(index.owner[start:stop], counts)]
        oj = long_edges[
            index.owner[np.fromiter(itertools.chain.from_iterable(hits), np.intp, int(counts.sum()))]
        ]
        keep = oi < oj
        uniq = np.unique(oi[keep].astype(np.int64) * n_edges + oj[keep])
        i, j = uniq // n_edges, uniq % n_edges
        d1, d2 = vec[i], vec[j]
        denom = d1[:, 0] * d2[:, 1] - d1[:, 1] * d2[:, 0]
        ok = np.abs(denom) > _CROSS_SIN * length[i] * length[j]
        diff = pa[j] - pa[i]
        safe = np.where(ok, denom, 1.0)
        t = (diff[:, 0] * d2[:, 1] - diff[:, 1] * d2[:, 0]) / safe
        u = (diff[:, 0] * d1[:, 1] - diff[:, 1] * d1[:, 0]) / safe
        ok &= (t > 0.0) & (t < 1.0) & (u > 0.0) & (u < 1.0)
        ok &= (t * length[i] >= geo.trim_a[i]) & ((1.0 - t) * length[i] >= geo.trim_b[i])
        ok &= (u * length[j] >= geo.trim_a[j]) & ((1.0 - u) * length[j] >= geo.trim_b[j])
        cross_pt = pa[i] + t[:, None] * d1
        for end_pts in (pa[i], pb[i], pa[j], pb[j]):
            ok &= np.hypot(*(cross_pt - end_pts).T) > r
        if ok.any():
            found.append((i[ok], j[ok], cross_pt[ok]))
            seen.update((i[ok] * n_edges + j[ok]).tolist())
            if n_edges + 2 * len(seen) > MAX_RAW_WALLS:
                raise TooComplexError("the walls would be split into too many pieces")
    if not found:
        return edges
    i, j = np.concatenate([f[0] for f in found]), np.concatenate([f[1] for f in found])
    cross_pt = np.concatenate([f[2] for f in found])
    order = np.lexsort((j, i))  # a pair seen in several blocks appears twice; the order is canonical
    i, j, cross_pt = i[order], j[order], cross_pt[order]
    first = np.ones(len(i), bool)
    first[1:] = (i[1:] != i[:-1]) | (j[1:] != j[:-1])
    i, j, cross_pt = i[first], j[first], cross_pt[first]
    labels = _cluster(cross_pt, r, check)
    first_new = max(placed) + 1
    members: dict[int, list[Pt]] = defaultdict(list)
    on_edge: dict[int, set[int]] = defaultdict(set)
    for k, (a, b, lab) in enumerate(zip(i.tolist(), j.tolist(), labels, strict=True)):
        members[lab].append((float(cross_pt[k, 0]), float(cross_pt[k, 1])))
        on_edge[a].add(lab)
        on_edge[b].add(lab)
    centre: dict[int, Pt] = {}
    for lab, pts in members.items():
        node_pts[first_new + lab] = pts
        centre[lab] = (math.fsum(p[0] for p in pts) / len(pts), math.fsum(p[1] for p in pts) / len(pts))
    out: list[_Edge] = []
    for k, e in enumerate(edges):
        _tick(check, k)
        if k not in on_edge:
            out.append(e)
            continue
        a_pt, b_pt = (float(pa[k, 0]), float(pa[k, 1])), (float(pb[k, 0]), float(pb[k, 1]))
        cuts = sorted((project_param(centre[lab], a_pt, b_pt), lab) for lab in on_edge[k])
        chain = [e.a, *(first_new + lab for _, lab in cuts), e.b]
        for a, b in itertools.pairwise(chain):
            if a != b:
                out.append(_Edge(a, b, e.line, e.thickness, e.source, e.openings, e.wi))
    return out


# --- step 5: duplicates and short walls ---------------------------------------------------------------------


def _dedupe(edges: list[_Edge]) -> list[_Edge]:
    groups: dict[tuple[int, int], list[_Edge]] = {}
    for e in edges:
        if e.a != e.b:
            groups.setdefault((min(e.a, e.b), max(e.a, e.b)), []).append(e)
    out: list[_Edge] = []
    for (a, b), members in groups.items():
        best = min(members, key=lambda e: _SOURCE_RANK[e.source])  # first of the strongest source
        if len(members) == 1:
            out.append(best)
            continue
        merged = [seg for e in members for seg in e.openings]
        out.append(_Edge(a, b, best.line, best.thickness, best.source, merged, best.wi))
    return out


def _prune_short(edges: list[_Edge], placed: dict[int, Pt], min_len: float, check: Check) -> list[_Edge]:
    """Drop dangling walls (a free end) shorter than ``min_len``, cascading along chains of them.

    A short wall with both ends attached stays, whether it bridges two parts or lies on a cycle.
    """
    degree: dict[int, int] = defaultdict(int)
    adjacency: dict[int, list[int]] = defaultdict(list)
    for k, e in enumerate(edges):
        degree[e.a] += 1
        degree[e.b] += 1
        adjacency[e.a].append(k)
        adjacency[e.b].append(k)

    def is_short(k: int) -> bool:
        e = edges[k]
        return math.hypot(placed[e.a][0] - placed[e.b][0], placed[e.a][1] - placed[e.b][1]) < min_len

    alive = [True] * len(edges)
    stack = [k for k, e in enumerate(edges) if (degree[e.a] == 1 or degree[e.b] == 1) and is_short(k)]
    work = 0
    while stack:
        work += 1
        _tick(check, work)
        k = stack.pop()
        e = edges[k]
        if not alive[k] or not (degree[e.a] == 1 or degree[e.b] == 1):
            continue
        alive[k] = False
        for node in (e.a, e.b):
            degree[node] -= 1
            stack.extend(m for m in adjacency[node] if alive[m] and degree[node] == 1 and is_short(m))
    kept = [e for k, e in enumerate(edges) if alive[k]]
    if len(kept) == len(edges):
        return kept
    touched = {n for k, e in enumerate(edges) if not alive[k] for n in (e.a, e.b)}
    return _rejoin_splits(kept, touched)


def _rejoin_splits(edges: list[_Edge], candidates: set[int]) -> list[_Edge]:
    """Undo a T split whose stem was pruned: a candidate node left with just the two halves of one wall."""
    live = dict(enumerate(edges))
    incident: dict[int, set[int]] = defaultdict(set)
    for k, e in live.items():
        incident[e.a].add(k)
        incident[e.b].add(k)
    next_id = len(edges)
    for node in sorted(candidates):
        if len(incident[node]) != 2:
            continue
        k1, k2 = sorted(incident[node])
        e1, e2 = live[k1], live[k2]
        a = e1.b if e1.a == node else e1.a
        b = e2.b if e2.a == node else e2.a
        if e1.wi != e2.wi or a == b:
            continue
        for k, e in ((k1, e1), (k2, e2)):
            del live[k]
            incident[e.a].discard(k)
            incident[e.b].discard(k)
        live[next_id] = _Edge(a, b, e1.line, e1.thickness, e1.source, [*e1.openings, *e2.openings], e1.wi)
        incident[a].add(next_id)
        incident[b].add(next_id)
        next_id += 1
    return [live[k] for k in sorted(live)]


# --- output -------------------------------------------------------------------------------------------------


def _project_openings(openings: list[Seg], a: Pt, b: Pt, length: float) -> tuple[tuple[float, float], ...]:
    ux, uy = (b[0] - a[0]) / length, (b[1] - a[1]) / length
    spans: list[tuple[float, float]] = []
    for p, q in openings:
        s0 = (p[0] - a[0]) * ux + (p[1] - a[1]) * uy
        s1 = (q[0] - a[0]) * ux + (q[1] - a[1]) * uy
        lo, hi = max(0.0, min(s0, s1)), min(length, max(s0, s1))
        if hi - lo >= _MIN_OPENING_PX:
            spans.append((lo, hi))
    spans.sort()
    merged: list[tuple[float, float]] = []
    for lo, hi in spans:
        if merged and lo <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], hi))
        else:
            merged.append((lo, hi))
    return tuple(merged)


def _merge_coincident(edges: list[_Edge], placed: dict[int, Pt]) -> list[_Edge]:
    """Nodes that a zero-length wall joins (placement put both on one point: a short jog between two
    axis-aligned walls takes x from one and y from the other) become one node, and the zero-length wall
    goes; otherwise the walls on either side would each keep a free end at the same point (Task 16c)."""
    parent: dict[int, int] = {}

    def find(q: int) -> int:
        while parent.get(q, q) != q:
            q = parent[q]
        return q

    for e in edges:
        if math.hypot(placed[e.a][0] - placed[e.b][0], placed[e.a][1] - placed[e.b][1]) <= _ZERO:
            ra, rb = find(e.a), find(e.b)
            if ra != rb:
                parent[max(ra, rb)] = min(ra, rb)
    if not parent:
        return edges
    out = [
        _Edge(find(e.a), find(e.b), e.line, e.thickness, e.source, e.openings, e.wi)
        for e in edges
        if find(e.a) != find(e.b)
    ]
    return _dedupe(out)


def _assemble(edges: list[_Edge], placed: dict[int, Pt], check: Check) -> WallGraph:
    edges = _merge_coincident(edges, placed)
    used = sorted({n for e in edges for n in (e.a, e.b)})

    def node_key(q: int) -> tuple[float, float, float, float]:
        x, y = placed[q]
        return (round(y, 6), round(x, 6), y, x)

    rank = {q: i for i, q in enumerate(sorted(used, key=node_key))}
    names = {q: f"N{i + 1}" for q, i in rank.items()}
    oriented = []
    for e in edges:
        a, b = (e.a, e.b) if rank[e.a] < rank[e.b] else (e.b, e.a)
        pa, pb = placed[a], placed[b]
        key = (round(min(pa[1], pb[1]), 6), round(min(pa[0], pb[0]), 6), rank[a], rank[b])
        oriented.append((key, e, a, b))
    oriented.sort(key=lambda item: item[0])
    degree: dict[int, int] = defaultdict(int)
    for e in edges:
        degree[e.a] += 1
        degree[e.b] += 1
    walls: list[WallCandidate] = []
    gaps: list[GapCandidate] = []
    for count, (_, e, a, b) in enumerate(oriented):
        _tick(check, count)
        pa, pb = placed[a], placed[b]
        wid = f"W{count + 1}"
        length = math.hypot(pb[0] - pa[0], pb[1] - pa[1])
        openings = _project_openings(e.openings, pa, pb, length)
        walls.append(
            WallCandidate(
                id=wid,
                a=pa,
                b=pb,
                a_node=names[a],
                b_node=names[b],
                thickness_px=e.thickness,
                source=e.source,
                evidence=EVIDENCE[e.source],
                free_ends=int(degree[a] == 1) + int(degree[b] == 1),
                openings_px=openings,
            )
        )
        gaps.extend(GapCandidate(wid, u0, u1) for u0, u1 in openings)
    nodes = {names[q]: placed[q] for q in sorted(used, key=lambda q: rank[q])}
    return WallGraph(nodes=nodes, walls=walls, gaps=gaps)


def build_wall_graph(
    raw: list[RawWall],
    *,
    r: float,
    t_median: float,
    L: float,
    theta0_deg: float = 0.0,
    check_deadline: Callable[[], None] | None = None,
) -> WallGraph:
    """Snap raw wall centre lines into a graph of nodes and walls (06 8.1 steps 9-10).

    ``r`` is the snap radius (``max(1.0 * t_median, 0.006 L)`` in the pipeline), ``t_median`` the median
    wall thickness and ``L`` the plan-region long side, all in pixels. ``theta0_deg`` is the plan's dominant
    orientation: walls within 3 degrees of ``theta0 + k * 90`` are axis-aligned and snap to right angles in
    that frame (compared modulo 90, so 89 equals -1); ids still follow the image-frame ``(y, x)`` order.
    Free ends extend up to ``r + t_median``; walls shorter than ``max(2 t_median, 0.01 L)`` are removed
    only when they dangle (have a free end). Raises ``ValueError`` for non-finite input and
    ``TooComplexError`` (a ``ValueError``) for more than ``MAX_RAW_WALLS`` walls or implausibly dense
    crossings. ``check_deadline`` is polled inside the long loops and may raise to abort.
    """
    if len(raw) > MAX_RAW_WALLS:
        raise TooComplexError(f"{len(raw)} raw walls exceed the limit of {MAX_RAW_WALLS}")
    _require_finite((r, t_median, L, theta0_deg), "r, t_median, L and theta0_deg")
    if r <= 0 or t_median <= 0 or L <= 0:
        raise ValueError(f"r, t_median and L must be positive, got {(r, t_median, L)!r}")
    check = _throttled(check_deadline)
    frame = _Frame.of(theta0_deg % 90.0)
    step = r + t_median
    walls = _merge_overlaps(_ingest(raw, frame, check), r, t_median, frame, check)
    if not walls:
        return WallGraph(nodes={}, walls=[], gaps=[])
    ends = np.array([[w.p0, w.p1] for w in walls], np.float64)
    edges, node_pts = _build_edges(walls, ends, r, check)
    if not edges:
        return WallGraph(nodes={}, walls=[], gaps=[])
    _check_crossing_load(edges, node_pts, r, frame, check)
    if _extend_free_ends(ends, edges, node_pts, r, r + t_median, step, frame, check):
        edges, node_pts = _build_edges(walls, ends, r, check)
    edges = _split_t_junctions(edges, node_pts, r, step, frame, check)
    edges = _split_crossings(edges, node_pts, r, step, frame, check)
    edges = _dedupe(edges)
    placed = _place_nodes(edges, node_pts, r, frame)
    edges = _prune_short(edges, placed, max(2.0 * t_median, 0.01 * L), check)
    return _assemble(edges, _place_nodes(edges, node_pts, r, frame), check)
