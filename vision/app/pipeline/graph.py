"""Wall graph building (06 section 8.1 steps 9-10): pure geometry over wall centre lines, no images.

``build_wall_graph`` turns raw wall centre lines into a snapped graph:

1. raw walls are validated, zero-length ones dropped, collinear overlapping detections fused;
2. endpoints within ``r`` are clustered (union-find over a KD tree) into nodes;
3. free ends are extended up to ``r + t`` along their direction onto another wall's centre line (L/T
   closure) and the clustering is redone;
4. a wall is split at every node lying on its centre line within ``r`` (T junction);
5. walls on the same node pair are merged and short walls that do not join two otherwise unconnected
   parts are pruned;
6. nodes are placed (axis-aligned walls keep right angles, diagonals meet at a least-squares
   intersection), ids ``N1..``/``W1..`` follow a stable geometric order and opening intervals are
   re-based onto each final wall.

Everything is a deterministic function of the *set* of raw walls: they are sorted canonically first and
every float sum uses ``math.fsum``, so ids and coordinates never depend on input order.
"""

import itertools
import math
from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass

import numpy as np
from scipy.spatial import cKDTree

from app.schemas.candidates import GapCandidate, RawWall, WallCandidate, WallGraph, WallSource
from app.utils.geometry import Pt, project_param

__all__ = ["EVIDENCE", "build_wall_graph"]

EVIDENCE: dict[WallSource, float] = {"filled": 1.0, "vector": 1.0, "double_line": 0.85, "single_line": 0.5}

_SOURCE_RANK: dict[WallSource, int] = {"filled": 0, "vector": 1, "double_line": 2, "single_line": 3}
_AXIS_TOL_DEG = 3.0  # 06 8.1 step 7: within 3 deg of an image axis counts as axis-aligned
_COLLINEAR_SIN = math.sin(math.radians(3.0))  # double detections: at most 3 deg apart
_PARALLEL_SIN = math.sin(math.radians(15.0))  # a free end cannot extend onto a wall this close to parallel
_LS_MIN_DET = math.sin(math.radians(10.0)) ** 2  # least-squares intersection needs lines > 10 deg apart
_MIN_OPENING_PX = 1.0  # a clipped opening interval shorter than this is a sliver, not an opening
_ZERO = 1e-9
_DEADLINE_EVERY = 128

Seg = tuple[Pt, Pt]
Check = Callable[[], None] | None


@dataclass(frozen=True, slots=True)
class _Line:
    """Infinite support line of one wall: ``pos`` is x of a vertical / y of a horizontal wall, otherwise
    the line is ``nx * x + ny * y = c`` with unit normal ``(nx, ny)``."""

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
    if check is not None and counter % _DEADLINE_EVERY == 0:
        check()


# --- validation and ingestion -------------------------------------------------------------------------------


def _require_finite(values: tuple[float, ...], what: str) -> None:
    if not all(math.isfinite(v) for v in values):
        raise ValueError(f"{what} must be finite, got {values!r}")


def _make_line(p0: Pt, p1: Pt) -> _Line:
    dx, dy = p1[0] - p0[0], p1[1] - p0[1]
    length = math.hypot(dx, dy)
    angle = math.degrees(math.atan2(dy, dx)) % 180.0
    if min(angle, 180.0 - angle) <= _AXIS_TOL_DEG:
        return _Line("h", (p0[1] + p1[1]) / 2.0, 0.0, 1.0, 0.0)
    if abs(angle - 90.0) <= _AXIS_TOL_DEG:
        return _Line("v", (p0[0] + p1[0]) / 2.0, 1.0, 0.0, 0.0)
    nx, ny = -dy / length, dx / length
    mx, my = (p0[0] + p1[0]) / 2.0, (p0[1] + p1[1]) / 2.0
    return _Line("d", 0.0, nx, ny, nx * mx + ny * my)


def _canonical(p0: Pt, p1: Pt) -> tuple[Pt, Pt]:
    return (p0, p1) if p0 <= p1 else (p1, p0)


def _make_wall(p0: Pt, p1: Pt, thickness: float, source: WallSource, openings: list[Seg]) -> _Wall:
    p0, p1 = _canonical(p0, p1)
    return _Wall(p0, p1, thickness, source, openings, _make_line(p0, p1))


def _wall_key(w: _Wall) -> tuple[object, ...]:
    return (w.p0, w.p1, w.thickness, _SOURCE_RANK[w.source], tuple(sorted(w.openings)))


def _ingest(raw: list[RawWall], check: Check) -> list[_Wall]:
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
        walls.append(_make_wall(rw.p0, rw.p1, rw.thickness_px, rw.source, openings))
    walls.sort(key=_wall_key)
    return walls


# --- spatial index ------------------------------------------------------------------------------------------


class _SegIndex:
    """KD tree over points sampled along segments at most ``step`` apart (endpoints included).

    A point within ``radius`` of a segment has a sample within ``radius + step / 2`` of it, which is what
    ``near`` queries; exact tests are left to the caller.
    """

    def __init__(self, p0: np.ndarray, p1: np.ndarray, step: float) -> None:
        vec = p1 - p0
        length = np.hypot(vec[:, 0], vec[:, 1])
        counts = np.maximum(np.ceil(length / step).astype(np.intp), 1) + 1
        self.owner = np.repeat(np.arange(len(p0), dtype=np.intp), counts)
        starts = np.cumsum(counts) - counts
        local = np.arange(self.owner.size) - np.repeat(starts, counts)
        t = local / np.repeat(counts - 1, counts)
        self.tree = cKDTree(p0[self.owner] + t[:, None] * vec[self.owner])
        self.step = step

    def near(self, pts: np.ndarray, radius: float) -> list[np.ndarray]:
        hits = self.tree.query_ball_point(pts, radius + self.step / 2.0)
        return [np.unique(self.owner[h]) for h in hits]


def _cluster(points: np.ndarray, r: float) -> list[int]:
    """Single-linkage clusters of points at distance <= r; labels are numbered by first appearance."""
    n = len(points)
    parent = list(range(n))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    if n > 1:
        for i, j in cKDTree(points).query_pairs(r, output_type="ndarray").tolist():
            ri, rj = find(i), find(j)
            if ri != rj:
                parent[max(ri, rj)] = min(ri, rj)
    labels: dict[int, int] = {}
    return [labels.setdefault(find(i), len(labels)) for i in range(n)]


# --- step 1: collinear overlapping detections ---------------------------------------------------------------


_BUCKET_DEG = 3.0
_PAIR_CHUNK = 200_000


def _window_pairs(
    p0: np.ndarray, p1: np.ndarray, length: np.ndarray, margin: float, check: Check
) -> list[tuple[np.ndarray, np.ndarray]]:
    """Candidate wall pairs that may be collinear: same or adjacent 3-degree direction bucket and close
    offset across the bucket's direction (a sorted window per wall), in chunks of bounded size."""
    angle = np.degrees(np.arctan2(p1[:, 1] - p0[:, 1], p1[:, 0] - p0[:, 0])) % 180.0
    n_buckets = round(180.0 / _BUCKET_DEG)
    bucket = np.minimum((angle // _BUCKET_DEG).astype(np.intp), n_buckets - 1)
    mid = (p0 + p1) / 2.0
    out: list[tuple[np.ndarray, np.ndarray]] = []
    for b in np.unique(bucket).tolist():
        _tick(check, b)
        members = np.flatnonzero(bucket == b)
        partners = np.flatnonzero((bucket == b) | (bucket == (b + 1) % n_buckets))
        theta = math.radians((b + 0.5) * _BUCKET_DEG)
        rho = mid[:, 1] * math.cos(theta) - mid[:, 0] * math.sin(theta)
        partners = partners[np.argsort(rho[partners], kind="stable")]
        rho_sorted = rho[partners]
        half = 2.0 * margin + 0.04 * (length[members] + float(length[partners].max()))
        lo = np.searchsorted(rho_sorted, rho[members] - half, side="left")
        hi = np.searchsorted(rho_sorted, rho[members] + half, side="right")
        counts = hi - lo
        ends = np.cumsum(counts)
        start = 0
        while start < len(members):
            base = int(ends[start - 1]) if start else 0
            stop = max(int(np.searchsorted(ends, base + _PAIR_CHUNK, side="right")), start + 1)
            stop = min(stop, len(members))
            cnt = counts[start:stop]
            total = int(cnt.sum())
            if total:
                ii = np.repeat(members[start:stop], cnt)
                first = np.cumsum(cnt) - cnt
                pos = np.repeat(lo[start:stop], cnt) + np.arange(total) - np.repeat(first, cnt)
                jj = partners[pos]
                keep = (bucket[jj] != b) | (jj > ii)
                out.append((ii[keep], jj[keep]))
            start = stop
    return out


def _merge_overlaps(walls: list[_Wall], r: float, check: Check) -> list[_Wall]:
    """Fuse walls lying on one line and overlapping along it (double detections of one wall)."""
    n = len(walls)
    if n < 2:
        return walls
    p0 = np.array([w.p0 for w in walls], np.float64)
    p1 = np.array([w.p1 for w in walls], np.float64)
    thick = np.array([w.thickness for w in walls], np.float64)
    length = np.hypot(*(p1 - p0).T)
    unit = (p1 - p0) / length[:, None]
    margin = max(1.0, 0.5 * float(thick.max()))
    found_i: list[np.ndarray] = []
    found_j: list[np.ndarray] = []
    for i, j in _window_pairs(p0, p1, length, margin, check):
        swap = (length[i] < length[j]) | ((length[i] == length[j]) & (i > j))
        a, b = np.where(swap, j, i), np.where(swap, i, j)  # a: the longer wall, the line b must lie on
        ua, ub = unit[a], unit[b]
        ok = np.abs(ua[:, 0] * ub[:, 1] - ua[:, 1] * ub[:, 0]) <= _COLLINEAR_SIN
        rel0, rel1 = p0[b] - p0[a], p1[b] - p0[a]
        t0, t1 = (rel0 * ua).sum(axis=1), (rel1 * ua).sum(axis=1)
        n0 = ua[:, 0] * rel0[:, 1] - ua[:, 1] * rel0[:, 0]
        n1 = ua[:, 0] * rel1[:, 1] - ua[:, 1] * rel1[:, 0]
        tol = np.maximum(1.0, 0.5 * np.maximum(thick[a], thick[b]))
        ok &= (np.abs(n0) <= tol) & (np.abs(n1) <= tol)
        overlap = np.minimum(np.maximum(t0, t1), length[a]) - np.maximum(np.minimum(t0, t1), 0.0)
        ok &= overlap >= np.minimum(r, 0.5 * length[b])
        found_i.append(i[ok])
        found_j.append(j[ok])
    if not found_i or not any(len(x) for x in found_i):
        return walls
    i, j = np.concatenate(found_i), np.concatenate(found_j)

    parent = list(range(n))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for x, y in zip(i.tolist(), j.tolist(), strict=True):
        rx, ry = find(x), find(y)
        if rx != ry:
            parent[max(rx, ry)] = min(rx, ry)
    groups: dict[int, list[int]] = defaultdict(list)
    for k in range(n):
        groups[find(k)].append(k)

    out: list[_Wall] = []
    for count, members in enumerate(groups.values()):  # dict order = ascending first member: canonical
        _tick(check, count)
        if len(members) == 1:
            out.append(walls[members[0]])
            continue
        base = min(members, key=lambda k: (-length[k], k))
        o = walls[base].p0
        ux, uy = float(unit[base][0]), float(unit[base][1])
        nx, ny = -uy, ux
        s_all: list[float] = []
        offs, weights, thick_w = [], [], []
        openings: list[Seg] = []
        for k in members:
            w = walls[k]
            for p in (w.p0, w.p1):
                s_all.append((p[0] - o[0]) * ux + (p[1] - o[1]) * uy)
            mid = ((w.p0[0] + w.p1[0]) / 2.0, (w.p0[1] + w.p1[1]) / 2.0)
            offs.append(float(length[k]) * ((mid[0] - o[0]) * nx + (mid[1] - o[1]) * ny))
            weights.append(float(length[k]))
            thick_w.append(float(length[k]) * w.thickness)
            openings.extend(w.openings)
        total = math.fsum(weights)
        off = math.fsum(offs) / total
        smin, smax = min(s_all), max(s_all)
        source = min((walls[k].source for k in members), key=lambda s: _SOURCE_RANK[s])
        out.append(
            _make_wall(
                (o[0] + ux * smin + nx * off, o[1] + uy * smin + ny * off),
                (o[0] + ux * smax + nx * off, o[1] + uy * smax + ny * off),
                math.fsum(thick_w) / total,
                source,
                openings,
            )
        )
    out.sort(key=_wall_key)
    return out


# --- node placement -----------------------------------------------------------------------------------------


def _place_nodes(edges: list[_Edge], node_pts: dict[int, list[Pt]], r: float) -> dict[int, Pt]:
    """Position of every node touched by ``edges`` (06 8.1 step 9).

    x is the mean ``x`` of the incident vertical walls, y the mean ``y`` of the incident horizontal ones;
    a coordinate no axis wall fixes comes from the least-squares intersection of the incident diagonal
    centre lines (given the fixed coordinate, if any), and otherwise from the centroid of the clustered
    endpoints. A least-squares solution further than ``2 r`` from the centroid is not trusted.
    """
    incident: dict[int, dict[int, _Line]] = defaultdict(dict)
    for e in edges:
        incident[e.a][id(e.line)] = e.line
        incident[e.b][id(e.line)] = e.line
    placed: dict[int, Pt] = {}
    for node, lines in incident.items():
        pts = node_pts[node]
        cx = math.fsum(p[0] for p in pts) / len(pts)
        cy = math.fsum(p[1] for p in pts) / len(pts)
        xs = [ln.pos for ln in lines.values() if ln.kind == "v"]
        ys = [ln.pos for ln in lines.values() if ln.kind == "h"]
        diags = [ln for ln in lines.values() if ln.kind == "d"]
        x = math.fsum(xs) / len(xs) if xs else None
        y = math.fsum(ys) / len(ys) if ys else None
        if x is not None and y is not None:
            placed[node] = (x, y)
        elif x is not None:
            placed[node] = (x, _solve_free(diags, 1, x, cy, r))
        elif y is not None:
            placed[node] = (_solve_free(diags, 0, y, cx, r), y)
        else:
            placed[node] = _intersect(diags, (cx, cy), r)
    return placed


def _solve_free(diags: list[_Line], axis: int, fixed: float, fallback: float, r: float) -> float:
    """The free coordinate (``axis`` 1: y given x, 0: x given y) minimising the squared distance to the
    diagonal lines, or ``fallback`` when there are none or the solution is not trusted."""
    num = den = 0.0
    nums, dens = [], []
    for ln in diags:
        n_free, n_fixed = (ln.ny, ln.nx) if axis == 1 else (ln.nx, ln.ny)
        nums.append(n_free * (ln.c - n_fixed * fixed))
        dens.append(n_free * n_free)
    if nums:
        num, den = math.fsum(nums), math.fsum(dens)
    if den < _LS_MIN_DET * 0.1 or abs(num / den - fallback) > 2.0 * r:
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
    return (x, y) if math.hypot(x - centroid[0], y - centroid[1]) <= 2.0 * r else centroid


# --- steps 2-4: clustering, extension, T split --------------------------------------------------------------


def _build_edges(walls: list[_Wall], ends: np.ndarray, r: float) -> tuple[list[_Edge], dict[int, list[Pt]]]:
    """Cluster all endpoints and make one edge per wall whose two ends land in different nodes."""
    flat = ends.reshape(-1, 2)
    labels = _cluster(flat, r)
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


def _direction(line: _Line, frm: Pt, to: Pt) -> Pt:
    """Unit direction of a wall's line from ``frm`` towards ``to`` (exactly axis-parallel for axis walls)."""
    if line.kind == "h":
        return (1.0, 0.0) if to[0] >= frm[0] else (-1.0, 0.0)
    if line.kind == "v":
        return (0.0, 1.0) if to[1] >= frm[1] else (0.0, -1.0)
    dx, dy = -line.ny, line.nx
    return (dx, dy) if (to[0] - frm[0]) * dx + (to[1] - frm[1]) * dy >= 0 else (-dx, -dy)


def _extend_free_ends(
    ends: np.ndarray,
    edges: list[_Edge],
    node_pts: dict[int, list[Pt]],
    r: float,
    reach: float,
    step: float,
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
    placed = _place_nodes(edges, node_pts, r)
    pa, pb = _edge_arrays(edges, placed)
    index = _SegIndex(pa, pb, step)
    tips = np.array([placed[edges[k].a if end == 0 else edges[k].b] for k, end in free], np.float64)
    moved = False
    for count, ((k, end), cands) in enumerate(zip(free, index.near(tips, reach), strict=True)):
        _tick(check, count)
        e = edges[k]
        tip = placed[e.a if end == 0 else e.b]
        other = placed[e.b if end == 0 else e.a]
        dx, dy = _direction(e.line, other, tip)
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
    edges: list[_Edge], node_pts: dict[int, list[Pt]], r: float, step: float, check: Check
) -> list[_Edge]:
    """Split every wall at the nodes lying on its centre line within ``r`` (06 8.1 step 9, third bullet)."""
    placed = _place_nodes(edges, node_pts, r)
    pa, pb = _edge_arrays(edges, placed)
    node_ids = sorted(placed)
    pts = np.array([placed[q] for q in node_ids], np.float64).reshape(-1, 2)
    index = _SegIndex(pa, pb, step)
    splits: dict[int, list[tuple[float, int]]] = defaultdict(list)
    for count, (q, cands) in enumerate(zip(node_ids, index.near(pts, r), strict=True)):
        _tick(check, count)
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
    """Drop walls shorter than ``min_len`` that do not connect two otherwise unconnected parts."""
    alive = [True] * len(edges)
    degree: dict[int, int] = defaultdict(int)
    adjacency: dict[int, set[int]] = defaultdict(set)
    for k, e in enumerate(edges):
        degree[e.a] += 1
        degree[e.b] += 1
        adjacency[e.a].add(k)
        adjacency[e.b].add(k)

    def length(k: int) -> float:
        e = edges[k]
        return math.hypot(placed[e.a][0] - placed[e.b][0], placed[e.a][1] - placed[e.b][1])

    short = sorted((k for k in range(len(edges)) if length(k) < min_len), key=lambda k: (length(k), k))

    def remove(k: int) -> None:
        alive[k] = False
        for node in (edges[k].a, edges[k].b):
            degree[node] -= 1
            adjacency[node].discard(k)

    def other_end_reachable(k: int) -> bool:
        """True if the two ends of edge ``k`` stay connected without it (it lies on a cycle)."""
        goal = edges[k].b
        seen = {edges[k].a}
        stack = [edges[k].a]
        steps = 0
        while stack:
            steps += 1
            _tick(check, steps)
            node = stack.pop()
            for m in adjacency[node]:
                if m == k:
                    continue
                nxt = edges[m].b if edges[m].a == node else edges[m].a
                if nxt == goal:
                    return True
                if nxt not in seen:
                    seen.add(nxt)
                    stack.append(nxt)
        return False

    verified_bridges: set[int] = set()
    while True:
        progressed = False
        for k in short:
            if alive[k] and (degree[edges[k].a] == 1 or degree[edges[k].b] == 1):
                remove(k)  # dangling: it joins nothing
                progressed = True
        if progressed:
            continue
        for k in short:
            if not alive[k] or k in verified_bridges:
                continue
            if other_end_reachable(k):
                remove(k)
                progressed = True
                break
            verified_bridges.add(k)  # removing other walls can never reconnect a bridge
        if not progressed:
            break
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


def _assemble(edges: list[_Edge], placed: dict[int, Pt], check: Check) -> WallGraph:
    edges = [
        e
        for e in edges
        if math.hypot(placed[e.a][0] - placed[e.b][0], placed[e.a][1] - placed[e.b][1]) > _ZERO
    ]
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
    check_deadline: Callable[[], None] | None = None,
) -> WallGraph:
    """Snap raw wall centre lines into a graph of nodes and walls (06 8.1 steps 9-10).

    ``r`` is the snap radius (``max(1.0 * t_median, 0.006 L)`` in the pipeline), ``t_median`` the median
    wall thickness and ``L`` the plan-region long side, all in pixels. Free ends extend up to
    ``r + t_median``; walls shorter than ``max(2 t_median, 0.01 L)`` are removed unless they bridge two
    otherwise unconnected parts. Raises ``ValueError`` for non-finite input. ``check_deadline`` is polled
    inside the long loops and may raise to abort.
    """
    _require_finite((r, t_median, L), "r, t_median and L")
    if r <= 0 or t_median <= 0 or L <= 0:
        raise ValueError(f"r, t_median and L must be positive, got {(r, t_median, L)!r}")
    step = r + t_median
    walls = _merge_overlaps(_ingest(raw, check_deadline), r, check_deadline)
    if not walls:
        return WallGraph(nodes={}, walls=[], gaps=[])
    ends = np.array([[w.p0, w.p1] for w in walls], np.float64)

    edges, node_pts = _build_edges(walls, ends, r)
    if not edges:
        return WallGraph(nodes={}, walls=[], gaps=[])
    if _extend_free_ends(ends, edges, node_pts, r, r + t_median, step, check_deadline):
        edges, node_pts = _build_edges(walls, ends, r)
    edges = _split_t_junctions(edges, node_pts, r, step, check_deadline)
    edges = _dedupe(edges)
    placed = _place_nodes(edges, node_pts, r)
    edges = _prune_short(edges, placed, max(2.0 * t_median, 0.01 * L), check_deadline)
    return _assemble(edges, _place_nodes(edges, node_pts, r), check_deadline)
