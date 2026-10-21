"""Wall skeleton tracing (06 §8.1 step 6), split out of ``walls.py``: the wall mask's skeleton traced into
an 8-neighbourhood pixel graph (``_trace``), spurs pruned and degree-2 chains contracted, and each edge's
polyline simplified into straight pieces with their thickness, source and free ends (``_pieces``).
"""

import itertools
from collections import defaultdict
from dataclasses import dataclass

import cv2
import numpy as np

from app.pipeline.wall_candidates import Check, sample
from app.schemas.candidates import WallSource

# `source_mask` labels. 06 names filled/double/single; vector walls get their own label so that the
# pixels of a `pdf_vector` page's walls can be told apart from the raster thick mask.
SRC_FILLED, SRC_DOUBLE, SRC_SINGLE, SRC_VECTOR = 1, 2, 3, 4
SRC_BOLD = 5  # tracing only: R2 bold strokes (`filled`, and 1 in `source_mask`)
_SOURCES: dict[int, WallSource] = {
    SRC_FILLED: "filled",
    SRC_DOUBLE: "double_line",
    SRC_SINGLE: "single_line",
    SRC_VECTOR: "vector",
    SRC_BOLD: "filled",
}

SPUR_FACTOR = 1.5  # spurs shorter than 1.5 x the local thickness are pruned
_WALK_POLL = 4096  # pixel steps between polls in the tracer
_NB8 = ((-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1))
_NB_KERNEL = np.array([[1, 1, 1], [1, 0, 1], [1, 1, 1]], np.float32)


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
    bold: bool = False  # an R2 bold stroke (ruling R2), drawn with the stroke's width

    @property
    def style(self) -> str:
        """How the wall is drawn: ``bold`` stroke, solid ``block`` (``thick``), ``double`` line, ``single``
        line or ``vector``."""
        if self.bold:
            return "bold"
        return {"filled": "block", "double_line": "double", "single_line": "single"}.get(
            self.source, "vector"
        )


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
                thickness = 2.0 * float(np.median(sample(dt, seg)))
                labels = sample(source, seg)
                labels = labels[labels > 0]
                label = int(np.bincount(labels, minlength=6).argmax()) if labels.size else SRC_FILLED
                chain.append(
                    _Piece(
                        a.copy(),
                        b.copy(),
                        max(thickness, 1.0),
                        _SOURCES[label],
                        fa and i0 == 0,
                        fb and i1 == last,
                        bold=label == SRC_BOLD,
                    )
                )
            if chain:
                out.append(chain)
    return out
