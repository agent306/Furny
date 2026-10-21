"""Wall extraction (06 §8.1 steps 1-8): wall masks, skeleton tracing and raw wall centre lines.

``extract_walls`` builds the wall mask ``W`` of the plan region from

1. filled walls: the thick-ink mask, with wide solid walls that Sauvola hollowed out (a uniform dark
   area thresholds as background, so an 80 px wall on a 3000 px page arrives as two ~25 px bands) closed
   again where the hole between the bands is as dark as the bands; on raster pages the bold strokes
   outside it (ruling R2); on ``pdf_vector`` pages the dark filled polygons and the stroked segments at
   least ``2.5 t_thin`` wide (``source = vector``);
2. (dimension lines of 06 §8.4 step 1 never take part);
3. double-line walls: pairs of parallel thin segments whose strip is hollow or filled;
4. single-line walls, only for sketches (fill and double masks cover < 0.2 % of the region);

then (5) closes it, (6) skeletonises it and traces the 8-neighbourhood pixel graph into straight pieces,
(7) snaps them onto the dominant orientation ``theta0`` (short off-axis pieces are dropped) and (8) merges
collinear pieces into one raw wall per wall run: tiny breaks close, empty gaps of ``1.5 t .. 18 t``
between walls of similar thickness become ``openings_px`` of that raw wall (a bold stroke's gaps are
measured against the drawing's wall thickness ``t_wall``, ruling B2). A thin piece that leaves a gap's jamb
and is as long as the gap is wide (``0.8 g .. 1.1 g``) is a door leaf, not a wall. Facing ends of runs the
walk left apart are linked (``_link_runs``): a partition ending in an offset block by a connector, runs of
different drawing styles across a window, slider or door by a bridging wall (ruling B2). Last, walls that
dangle outside the closed outline along extension lines are cut out (``_drop_dangling_extensions``).

Step 2's candidate segments and step 3's double-line pairing live in ``wall_candidates.py``.

``walls_to_graph`` snaps the raw walls into the wall graph (``graph.py``); its ``gaps`` are the gap
candidates. This module talks to later stages only through ``app.schemas.candidates`` types and plain
arrays (06 I12).
"""

import bisect
import itertools
import math
import time
from collections import defaultdict
from collections.abc import Callable, Sequence
from dataclasses import dataclass

import cv2
import numpy as np
from shapely.geometry import LineString, Point
from shapely.ops import polygonize, unary_union
from skimage.morphology import skeletonize

from app.pipeline.binarize import Preprocessed, sauvola_window
from app.pipeline.context import PipelineContext
from app.pipeline.graph import build_wall_graph
from app.pipeline.normalize import NormalizedPage
from app.pipeline.segments import dominant_orientation
from app.pipeline.wall_candidates import (
    Check,
    candidate_segments,
    double_mask,
    sample,
    solid_envelope,
    touches_tick,
    wall_face_dims,
)
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
SRC_BOLD = 5  # tracing only: R2 bold strokes (`filled`, and 1 in `source_mask`)
_SOURCES: dict[int, WallSource] = {
    SRC_FILLED: "filled",
    SRC_DOUBLE: "double_line",
    SRC_SINGLE: "single_line",
    SRC_VECTOR: "vector",
    SRC_BOLD: "filled",
}
_SOURCE_RANK: dict[WallSource, int] = {"filled": 0, "vector": 1, "double_line": 2, "single_line": 3}

VECTOR_WALL_FACTOR = 2.5  # stroked vector segments at least this many t_thin wide are walls
BOLD_MIN_LEN_FRAC = 0.04  # raster bold strokes (not thin) at least 0.04 L long are solid walls (ruling R2)
TEXT_SHARE_MAX = 0.5  # a `thick` component with more than half of its pixels in text boxes is text
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
# Gap candidates: 1.5 t < g <= 18 t (Task 16c ruling R-a: 06's 2.5 t left breaks of 1.5 .. 2.5 t neither
# closed nor openings, ending the run; graph building already records bridged gaps >= 1.5 t as openings)
GAP_MIN, GAP_MAX = MERGE_GAP, 18.0
SIMILAR_THICKNESS = 1.5  # thickness ratio of the two walls beside a gap candidate
GAP_WALL_MAX = 0.1  # a gap whose centre line is more than 10 % wall is crossed by a wall: no opening
GAP_BAND = 0.45  # ... tested on lines up to 0.45 t (the thinner wall's) to either side of it too
BRIDGE_OFFSET_TWALL = 1.0  # mixed-style bridging (ruling B2): parallel runs at most 1 t_wall apart across ...
BRIDGE_GAP_TWALL = 18.0  # ... and 18 t_wall along, with opening evidence in the gap's strip:
EVIDENCE_ANGLE_DEG = 3.0  # thin lines parallel within 3 degrees ...
EVIDENCE_LINES = 2  # ... at least two distinct ones ...
EVIDENCE_COVER = 0.8  # ... each covering 80 % of the gap ...
EVIDENCE_CLUSTER_PX = 1.5  # ... (pieces less than this apart across are one line)
EVIDENCE_STRIP = (
    0.75  # ... within 0.75 max(t, t_wall) beyond the runs' lines (frame lines run along the faces)
)
ARC_RADIUS = (0.85, 1.15)  # ... or a door swing: a thin arc of radius 0.85 .. 1.15 g about a jamb ...
ARC_STEP_DEG = 1.0  # ... sampled every degree, 3 degrees clear of the closed and the open leaf ...
ARC_EDGE_DEG = 3.0
ARC_COVER = 0.6  # ... with ink on 60 % of its samples inside the region ...
ARC_MIN_DEG = 45.0  # ... and on at least 45 contiguous degrees ...
ARC_MAX_BREAK = 2  # ... (breaks of at most 2 samples)
ARC_RUN_PX = 6  # a stroke crossing a ray: an ink run of at most 6 px ...
ARC_HIT_PX = 2  # ... within 2 px of the arc's radius ...
ARC_CLEAR_PX = 5  # ... with paper 5 px inside and outside it (hatching and tile grids have ink there)
ARC_CENTRE_STEP = 2.0  # hinge offsets tried, up to 0.5 t (+ 2 px) from the jamb point
ARC_TRIES = 3  # best (centre, radius) hypotheses scored
JOG_MIN_PX = 1.0  # a bridge's line this far from a run's line gets a connector
OUTSIDE_ANGLE_DEG = 3.0  # a dangling wall outside the outline along an extension line (within 3 degrees ...
OUTSIDE_COVER = 0.5  # ... over half of its length) is that extension line (Task 16c)
LEAF_MIN, LEAF_MAX = 0.8, 1.1  # door leaf length, fractions of the gap width
LEAF_MIN_ANGLE_DEG = 30.0  # a leaf leaves its wall at least this steeply
DUPLICATE_ANGLE_DEG = 1.0
SNAP_RADIUS_FRAC = 0.006  # graph snap radius r = max(t_median, 0.006 L)

_POLL_SECONDS = 0.02  # deadline polls reach the real check at most this often
_WALK_POLL = 4096  # pixel steps between polls in the tracer
_MARCH_STEP = 0.5
_NB8 = ((-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1))
_NB_KERNEL = np.array([[1, 1, 1], [1, 0, 1], [1, 1, 1]], np.float32)


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
    graph: WallGraph | None = None  # the wall graph of ``raw`` for ``graph_region``, when extraction built it
    graph_region: Rect | None = None


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


# --- steps 1, 3, 4: wall masks -------------------------------------------------------------------------


def _drop_text(mask: np.ndarray, text: np.ndarray) -> np.ndarray:
    """``mask`` without its components that lie mostly (> 50 %) in text boxes (ruling R6); a wall that a
    label overlaps keeps its pixels."""
    if not mask.any() or not (text & (mask > 0)).any():
        return mask
    n, labels = cv2.connectedComponents(mask, connectivity=8)
    total = np.bincount(labels.ravel().astype(np.intp), minlength=n)
    in_text = np.bincount(labels[text].astype(np.intp), minlength=n)
    drop = in_text > TEXT_SHARE_MAX * total
    drop[0] = False
    out = mask.copy()
    out[drop[labels]] = 0
    return out


def _filled_mask(pre: Preprocessed, crop: Rect, long_edge: int, text: np.ndarray) -> np.ndarray:
    """``thick`` (without text components, see ``_drop_text``) with Sauvola holes closed: pixels between
    thick bands at most one Sauvola window apart that are as dark as the bands (below the midpoint of wall
    grey and paper grey).

    Brochures take ``thick`` from the colour mask, which Sauvola never hollowed, so they are left alone.
    """
    ys, xs = slice(crop.y, crop.y + crop.h), slice(crop.x, crop.x + crop.w)
    thick = _drop_text(pre.thick[ys, xs], text).copy()  # never write into `pre.thick`
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


def _bold_mask(cands: Sequence[Segment], thick: np.ndarray, crop: Rect, L: float) -> np.ndarray:
    """Raster bold strokes as solid walls (ruling R2; 06 §8.1 step 1 only takes ``thick``): segments that are
    not thin (wider than ``1.8 t_thin``) and at least ``0.04 L`` long, drawn as butt-ended quads of their
    stroke width where they are not already in ``thick``. Bold outline strokes are too narrow for ``thick``
    and too wide to be line work.

    The test is per stretch (Task 16c): every stretch of the stroke outside ``thick`` at least as long as
    the stroke is wide is drawn. A stroke whose width wavers about the thick kernel lies partly in
    ``thick`` (on HDB the bold outline next to its black blocks); judged as a whole it would be skipped and
    the stretch outside ``thick`` lost."""
    mask = np.zeros((crop.h, crop.w), np.uint8)
    origin = np.array((crop.x, crop.y), np.float64)
    min_len = BOLD_MIN_LEN_FRAC * L
    for s in cands:
        if s.is_thin or s.source == "vector" or s.length < min_len:
            continue
        a, b = np.asarray(s.p0) - origin, np.asarray(s.p1) - origin
        n = max(2, math.ceil(s.length) + 1)
        t = np.linspace(0.0, 1.0, n)
        outside = sample(thick, a + t[:, None] * (b - a)) == 0
        edges = np.flatnonzero(np.diff(np.concatenate(([0], outside.astype(np.int8), [0]))))
        for lo, hi in zip(edges[::2].tolist(), edges[1::2].tolist(), strict=True):
            t0, t1 = float(t[lo]), float(t[hi - 1])
            if (t1 - t0) * s.length >= s.width_px:
                _quad(mask, a + t0 * (b - a), a + t1 * (b - a), s.width_px)
    return mask


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
        return _Piece(mid - half, mid + half, p.thickness, p.source, p.free0, p.free1, "hv"[k], p.bold)
    if length >= DIAGONAL_MIN_FRAC * L:
        return p
    return None


def _snap(chains: list[list[_Piece]], theta0: float, L: float) -> list[_Piece]:
    """Rotate pieces within 3 degrees of ``theta0 + k 90`` onto that axis about their midpoint; keep
    other pieces of at least 0.03 L as diagonals and drop shorter off-axis ones (06 §8.1 step 7).

    A kept piece after a dropped head (or before a dropped tail) of its path is extended along its own
    line to the projection of the path's end node (a diagonal whose skeleton curls into a junction), and
    joined to the node by a connector piece when the node lies beside its line (``_close_end``). When
    that end is free (a skeleton curling into a corner of a wall's end), the kept piece inherits the free
    end instead, so the end is still refined to the end of the wall.

    Between two kept pieces whose short off-axis stretch in between was dropped (a wall that jogs where
    two drawing styles meet: a column block and the bold line continuing it) the path stays connected:
    pieces on different axes are extended to the crossing of their lines, parallel ones are joined by a
    connector piece between their facing ends."""
    out: list[_Piece] = []
    for chain in chains:
        kept = [(k, q) for k, q in enumerate(_snap_one(p, theta0, L) for p in chain) if q is not None]
        if not kept:
            continue
        kept_idx = [k for k, _ in kept]
        pieces = [q for _, q in kept]
        out.extend(_close_end(chain, kept_idx[0], pieces[0], head=True))
        out.extend(_close_end(chain, kept_idx[-1], pieces[-1], head=False))
        out.extend(pieces)
        for (ka, a), (kb, b) in itertools.pairwise(kept):
            if kb > ka + 1:
                out.extend(_join(a, b, chain[ka + 1 : kb]))
    return out


def _join(a: _Piece, b: _Piece, dropped: list[_Piece]) -> list[_Piece]:
    """Reconnect ``a`` (path order: its ``p1`` faces ``b``) and ``b`` across the ``dropped`` pieces between
    them; returns the connector piece, if one is needed."""
    da, db = a.p1 - a.p0, b.p1 - b.p0
    cross = float(da[0] * db[1] - da[1] * db[0])
    na, nb = float(np.hypot(*da)), float(np.hypot(*db))
    if na > 1e-9 and nb > 1e-9 and abs(cross) / (na * nb) > math.sin(math.radians(SNAP_DEG)):
        # The crossing of the two lines: a.p0 + da * s = b.p0 + db * t.
        r = b.p0 - a.p0
        s_par = float(r[0] * db[1] - r[1] * db[0]) / cross
        meet = a.p0 + da * s_par
        _extend_to(a, meet, at_start=False)
        _extend_to(b, meet, at_start=True)
        return []
    thickness = float(np.median([p.thickness for p in dropped])) if dropped else min(a.thickness, b.thickness)
    if float(np.hypot(*(b.p0 - a.p1))) < 1e-6:
        return []
    return [
        _Piece(a.p1.copy(), b.p0.copy(), thickness, dropped[0].source if dropped else a.source, False, False)
    ]


def _close_end(chain: list[_Piece], kept_at: int, piece: _Piece, *, head: bool) -> list[_Piece]:
    """Close the path's head (or tail) after dropped pieces: inherit a free end, or extend to the end
    node's projection. When the node lies off the piece's line by more than half the piece's thickness (a
    wall meeting a black block's corner beside its centre line), a connector piece from the extended end
    to the node keeps the junction (Task 16c); it is returned."""
    if kept_at == (0 if head else len(chain) - 1):
        return []  # nothing was dropped at this end
    if chain[0].free0 if head else chain[-1].free1:
        setattr(piece, "free0" if head else "free1", True)
        return []
    node = chain[0].p0 if head else chain[-1].p1
    _extend_to(piece, node, at_start=head)
    end = piece.p0 if head else piece.p1
    if float(np.hypot(*(node - end))) <= 0.5 * piece.thickness:
        return []
    dropped = chain[:kept_at] if head else chain[kept_at + 1 :]
    thickness = float(np.median([p.thickness for p in dropped]))
    return [_Piece(end.copy(), node.copy(), thickness, dropped[0].source, False, False)]


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
            if not sample(wall, end[None, :])[0]:
                continue
            reach = 2.0 * p.thickness + 4.0
            steps = np.arange(1, int(reach / _MARCH_STEP) + 1) * _MARCH_STEP
            inside = sample(wall, end[None, :] + steps[:, None] * u[None, :]) > 0
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


@dataclass(frozen=True, slots=True)
class _Item:
    """A snapped piece as step 8 sees it: its stretch ``[s0, s1]`` along the group's direction, its offset
    across, its drawn thickness ``t`` and the thickness ``t_gap`` its gaps are measured with (``t_wall``
    for a bold stroke, ruling B2), its source and style and whether its ends are free."""

    s0: float
    s1: float
    off: float
    t: float
    t_gap: float
    source: WallSource
    style: str
    free0: bool
    free1: bool


@dataclass(slots=True)
class _Run:
    u: np.ndarray
    n: np.ndarray
    s0: float
    s1: float
    members: list[_Item]
    openings: list[tuple[float, float]]
    free0: bool
    free1: bool

    def _mean(self, value: Callable[[_Item], float]) -> float:
        """Length-weighted mean of ``value`` over the members."""
        lengths = [m.s1 - m.s0 for m in self.members]
        total = math.fsum(lengths) or 1.0
        return math.fsum(value(m) * w for m, w in zip(self.members, lengths, strict=True)) / total

    def offset(self) -> float:
        return self._mean(lambda m: m.off)

    def thickness(self) -> float:
        return self._mean(lambda m: m.t)

    def style(self) -> str:
        """The members' style covering most of the run's length."""
        by_style: dict[str, float] = defaultdict(float)
        for m in self.members:
            by_style[m.style] += m.s1 - m.s0
        return min(by_style, key=lambda k: (-by_style[k], k))

    def wall(self) -> RawWall:
        by_source: dict[WallSource, float] = defaultdict(float)
        for m in self.members:
            by_source[m.source] += m.s1 - m.s0
        source = min(by_source, key=lambda k: (-by_source[k], _SOURCE_RANK[k]))
        off = self.offset()
        a = self.u * self.s0 + self.n * off
        b = self.u * self.s1 + self.n * off
        openings = tuple((o0 - self.s0, o1 - self.s0) for o0, o1 in self.openings)
        return RawWall(
            (float(a[0]), float(a[1])), (float(b[0]), float(b[1])), self.thickness(), source, openings
        )


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


def _gap_is_empty(
    wall: np.ndarray, u: np.ndarray, n: np.ndarray, off: float, g0: float, g1: float, half: float = 0.0
) -> bool:
    """No line of the gap's strip (offsets ``off - half .. off + half``) is more than 10 % wall: a wall
    crossing the gap, or one running along it inside the strip (a jogged wall's piece beside the line of
    two collinear blocks), means the gap is no opening."""
    along = np.arange(g0 + 1.0, g1 - 1.0 + 1e-9, 1.0)
    if along.size == 0:
        return True
    for k in np.linspace(-half, half, 5) if half > 0 else (0.0,):
        pts = along[:, None] * u[None, :] + (n * (off + k))[None, :]
        if float((sample(wall, pts) > 0).mean()) > GAP_WALL_MAX:
            return False
    return True


def _wall_thickness(pieces: list[_Piece]) -> float | None:
    """``t_wall`` (ruling B2): the length-weighted median thickness of the drawing's solid-block and
    double-line pieces, the thickness its walls are drawn with; None when it has none (a drawing of bold
    strokes only)."""
    walls = [p for p in pieces if p.style in ("block", "double")]
    if not walls:
        return None
    return _weighted_median([p.thickness for p in walls], [float(np.hypot(*(p.p1 - p.p0))) for p in walls])


def _runs(
    pieces: list[_Piece], theta0: float, wall: np.ndarray, poll: Check, t_wall: float | None = None
) -> list[_Run]:
    """Collinear pieces (same direction, offset within ``0.5 t``) joined along their line: breaks up to
    ``1.5 t`` close, empty gaps of ``1.5 t .. 18 t`` (ruling R-a; 06 says ``2.5 t``) between walls of similar
    thickness become openings, anything else ends the run.

    A bold stroke's ``t`` in these gap rules is ``t_wall`` (ruling B2, a deviation from 06 §8.1 step 8):
    an outline drawn as a bold stroke stands for a wall of the drawing's wall thickness, so its windows and
    sliders (up to ``18 t_wall``) are gaps of that wall, not of the pen."""
    out: list[_Run] = []
    for u, group in _direction_groups(pieces, theta0):
        poll()
        n = np.array((-u[1], u[0]))
        items: list[_Item] = []
        for p in group:
            a, b = float(p.p0 @ u), float(p.p1 @ u)
            fa, fb = (p.free0, p.free1) if a <= b else (p.free1, p.free0)
            t_gap = t_wall if p.bold and t_wall is not None else p.thickness
            off = float((p.p0 + p.p1) @ n) / 2.0
            items.append(_Item(min(a, b), max(a, b), off, p.thickness, t_gap, p.source, p.style, fa, fb))
        items.sort(key=lambda it: it.off)
        lines: list[list[_Item]] = []
        anchor_off, anchor_t = 0.0, 0.0
        for it in items:
            tol = max(MERGE_OFFSET * min(anchor_t, it.t), MERGE_OFFSET_MIN_PX)
            if lines and abs(it.off - anchor_off) <= tol:
                lines[-1].append(it)
            else:
                lines.append([it])
                anchor_off, anchor_t = it.off, it.t
        for line in lines:
            line.sort(key=lambda it: (it.s0, it.s1))
            run: _Run | None = None
            last = line[0]  # the member reaching furthest along the current run
            for it in line:
                if run is not None:
                    gap = it.s0 - run.s1
                    if gap <= MERGE_GAP * max(_gap_thickness(last, it)):
                        pass
                    elif _is_opening(last, it, gap) and _gap_is_empty(
                        wall, u, n, (it.off + run.offset()) / 2.0, run.s1, it.s0, GAP_BAND * min(last.t, it.t)
                    ):
                        run.openings.append((run.s1, it.s0))
                    else:
                        out.append(run)
                        run = None
                if run is None:
                    run = _Run(u, n, it.s0, it.s1, [], [], it.free0, it.free1)
                    last = it
                elif it.s1 >= run.s1:
                    run.free1 = it.free1
                if it.s1 >= run.s1:
                    run.s1 = it.s1
                    last = it
                run.members.append(it)
            if run is not None:
                out.append(run)
    return out


def _gap_thickness(a: _Item, b: _Item) -> tuple[float, float]:
    """The thicknesses a gap between ``a`` and ``b`` is measured with: ``t_gap`` (``t_wall`` for a bold
    stroke, ruling B2), except across a bold stroke and a piece of another style, where the drawn widths
    count (Task 16c review, Important 1: otherwise a bold stroke and a double line look alike)."""
    if a.style != b.style and "bold" in (a.style, b.style):
        return a.t, b.t
    return a.t_gap, b.t_gap


def _is_opening(a: _Item, b: _Item, gap: float) -> bool:
    """Step 8's gap candidate between ``a`` and ``b`` (emptiness aside): the same drawing style (ruling B2:
    pieces of different styles are bridged only with opening evidence, ``_link_runs``), similar
    thickness and ``1.5 t .. 18 t`` (ruling R-a) wide."""
    if a.style != b.style:
        return False
    ta, tb = _gap_thickness(a, b)
    t_gap = (ta + tb) / 2.0
    return max(ta, tb) <= SIMILAR_THICKNESS * min(ta, tb) and GAP_MIN * t_gap <= gap <= GAP_MAX * t_gap


def _point(run: _Run, s: float, off: float) -> Pt:
    q = run.u * s + run.n * off
    return (float(q[0]), float(q[1]))


def _link_runs(
    runs: list[_Run],
    thin: np.ndarray,
    ink: np.ndarray,
    t_wall: float | None,
    poll: Check,
    origin: tuple[float, float] = (0.0, 0.0),
) -> list[RawWall]:
    """Raw walls that join facing ends of parallel runs the collinear walk left apart (Task 16c):

    - a **jog**: two free ends at most ``1.5 t`` apart along their line whose lines are less than half the
      thicker wall apart across (a partition ending in a black block whose centre line lies beside its own)
      get a connector between them, as ``_join`` joins a path's pieces;
    - a **bridge** (ruling B2, a deviation from 06 §8.1 step 8): runs drawn in different styles (a black
      block, a bold stroke, a double line) with at least one free facing end, parallel within 2 degrees
      (one direction group: the snapped axes, or diagonals within 1 degree), at most ``1 t_wall`` apart
      across and ``18 t_wall`` along, with opening evidence in the gap's strip (at least two thin parallel
      lines each covering 80 % of the gap, window frames or a slider, or a door swing arc at one of the
      jambs) are bridged: a wall of the thicker run's thickness along the evidence lines' centre (the
      thicker run's line for an arc) spans the gap as one opening, with a connector at each end where a
      run's line jogs from it.

    Each run end is linked at most once, nearest gap first. ``ink`` (the arcs' thin ink) may be the whole
    page, with the runs' coordinate origin at ``origin`` in it: a door swinging out of the plan region
    keeps its whole arc."""
    found: list[tuple[float, int, int, str]] = []
    groups: dict[tuple[float, float], list[int]] = defaultdict(list)  # runs of one direction group
    for k, r in enumerate(runs):  # share their direction exactly
        groups[(float(r.u[0]), float(r.u[1]))].append(k)
    offs = [r.offset() for r in runs]
    thick = [r.thickness() for r in runs]
    for members in groups.values():
        poll()
        members.sort(key=lambda k: offs[k])
        keys = [offs[k] for k in members]
        reach = max(0.5 * max(thick[k] for k in members), BRIDGE_OFFSET_TWALL * (t_wall or 0.0))
        for i in members:
            a = runs[i]
            lo, hi = bisect.bisect_left(keys, offs[i] - reach), bisect.bisect_right(keys, offs[i] + reach)
            for j in members[lo:hi]:
                b = runs[j]
                if i == j or b.s0 <= a.s1:
                    continue
                gap = b.s0 - a.s1
                delta = abs(offs[j] - offs[i])
                ta, tb = thick[i], thick[j]
                if a.free1 and b.free0 and gap <= MERGE_GAP * max(ta, tb) and delta <= 0.5 * max(ta, tb):
                    found.append((gap, i, j, "jog"))
                elif (
                    t_wall is not None
                    and (a.free1 or b.free0)
                    and a.style() != b.style()
                    and delta <= BRIDGE_OFFSET_TWALL * t_wall
                    and gap <= BRIDGE_GAP_TWALL * t_wall
                ):
                    found.append((gap, i, j, "bridge"))
    out: list[RawWall] = []
    ends: set[int] = set()
    starts: set[int] = set()
    arcs: dict[tuple[float, ...], bool] = {}  # door-arc results per jamb, hinge side and gap
    for gap, i, j, kind in sorted(found):
        if i in ends or j in starts:
            continue
        a, b = runs[i], runs[j]
        a_off, b_off = offs[i], offs[j]
        thin_t = min(thick[i], thick[j])
        if kind == "jog":
            out.append(RawWall(_point(a, a.s1, a_off), _point(a, b.s0, b_off), thin_t, a.wall().source))
        else:
            poll()  # each bridge candidate reads its gap's evidence
            k = i if thick[i] >= thick[j] else j
            strip = EVIDENCE_STRIP * max(thick[k], t_wall or 0.0)
            line = _opening_line(a, a_off, b_off, a.s1, b.s0, strip, thin, ink, thick[k], arcs, origin)
            if line is None:
                continue
            off = offs[k] if math.isnan(line) else line
            out.append(
                RawWall(
                    _point(a, a.s1, off),
                    _point(a, b.s0, off),
                    thick[k],
                    runs[k].wall().source,
                    ((0.0, gap),),
                )
            )
            for s_end, o in ((a.s1, a_off), (b.s0, b_off)):
                if abs(o - off) > JOG_MIN_PX:
                    out.append(RawWall(_point(a, s_end, o), _point(a, s_end, off), thin_t, "filled"))
        ends.add(i)
        starts.add(j)
    return out


def _opening_line(
    run: _Run,
    a_off: float,
    b_off: float,
    g0: float,
    g1: float,
    strip: float,
    thin: np.ndarray,
    ink: np.ndarray,
    thick: float,
    arcs: dict[tuple[float, ...], bool] | None = None,
    origin: tuple[float, float] = (0.0, 0.0),
) -> float | None:
    """Opening evidence in the gap ``[g0, g1]`` along ``run``'s line between offsets ``a_off`` and ``b_off``
    (ruling B2): the centre offset of the thin lines parallel to it (within 3 degrees) inside the gap's
    strip (``strip`` beyond both runs' lines) when at least two distinct ones each cover >= 80 % of the
    gap; NaN for a door swing arc at one of the jambs instead; None without evidence. ``ink`` is the thin
    ink the arc is read from; ``arcs`` caches arc results per jamb, side and gap across candidates."""
    gap = g1 - g0
    lo = min(a_off, b_off) - strip
    hi = max(a_off, b_off) + strip
    if thin.size:
        p0, p1 = thin[:, :2], thin[:, 2:]
        d = p1 - p0
        length = np.hypot(d[:, 0], d[:, 1])
        ok = np.abs(d @ run.u) >= np.cos(np.radians(EVIDENCE_ANGLE_DEG)) * np.maximum(length, 1e-9)
        t0, t1 = p0 @ run.u, p1 @ run.u
        c0, c1 = np.maximum(np.minimum(t0, t1), g0), np.minimum(np.maximum(t0, t1), g1)
        ok &= c1 > c0
        # offset of each line over the gap: at the middle of its clipped stretch
        mid = (c0 + c1) / 2.0
        k = np.where(np.abs(t1 - t0) > 1e-9, (mid - t0) / np.where(np.abs(t1 - t0) > 1e-9, t1 - t0, 1.0), 0.5)
        offs = (p0 + k[:, None] * d) @ run.n
        ok &= (offs >= lo) & (offs <= hi)
        idx = np.flatnonzero(ok)
        if idx.size:
            order = idx[np.argsort(offs[idx], kind="stable")]
            clusters: list[list[int]] = []
            for m in order.tolist():
                if clusters and offs[m] - offs[clusters[-1][-1]] <= EVIDENCE_CLUSTER_PX:
                    clusters[-1].append(m)
                else:
                    clusters.append([m])
            centres = []
            for cl in clusters:
                spans = sorted((float(c0[m]), float(c1[m])) for m in cl)
                covered, end = 0.0, -math.inf
                for x0, x1 in spans:
                    x0 = max(x0, end)
                    if x1 > x0:
                        covered += x1 - x0
                    end = max(end, x1)
                if covered >= EVIDENCE_COVER * gap:
                    w = np.array([float(c1[m] - c0[m]) for m in cl])
                    centres.append(float(np.average(offs[cl], weights=w)))
            if len(centres) >= EVIDENCE_LINES:
                return float(np.mean(centres))
    # The hinge sits at a jamb, on the line of either run (they may jog across the opening).
    jambs = [
        (run.u * g + run.n * off, toward)
        for g, toward in ((g0, run.u), (g1, -run.u))
        for off in (a_off, b_off)
    ]
    cache = {} if arcs is None else arcs
    for c, toward in jambs:
        for side in (1.0, -1.0):
            key = (round(2.0 * c[0]), round(2.0 * c[1]), float(toward @ run.u), side, round(2.0 * gap))
            if key not in cache:
                cache[key] = _door_arc(ink, c + np.asarray(origin), toward, run.n * side, gap, thick)
            if cache[key]:
                return math.nan
    return None


def _door_arc(
    ink: np.ndarray, hinge: np.ndarray, toward: np.ndarray, out: np.ndarray, gap: float, t: float
) -> bool:
    """A door swing (Task 16c fix round 2) about ``hinge``, in the quadrant from ``toward`` (the closed
    leaf, across the gap) to ``out`` (the open leaf); ``ink`` is the thin ink (solid wall masks removed,
    so a jamb block cannot merge with the arc).

    Rays every degree (3 degrees clear of either leaf) are read from the hinge out to ``1.15 g``: each
    thin ink run on a ray (at most 6 px) votes for the radius it would have about each hinge offset up to
    ``0.5 t`` (+ 2 px). The best few (offset, radius) votes are scored on their own circle: a sample is
    arc when it has ink within 2 px of the radius and paper 5 px inside and outside (hatching and tile
    grids fail that), and the arc holds when 60 % of the samples inside the region (the ink's extent) are
    arc, on at least 45 contiguous degrees. The cost is O(gap): a fixed number of rays of length O(gap)."""
    ang = np.radians(np.arange(ARC_EDGE_DEG, 90.0 - ARC_EDGE_DEG + 1e-9, ARC_STEP_DEG))
    dirs = np.cos(ang)[:, None] * toward[None, :] + np.sin(ang)[:, None] * out[None, :]
    tol = 0.5 * t + 2.0
    r_min, r_max = ARC_RADIUS[0] * gap, ARC_RADIUS[1] * gap
    rho = np.arange(max(1.0, r_min - tol - ARC_RUN_PX), r_max + tol + ARC_RUN_PX + 1.0)
    on = _ink_at(ink, hinge[None, None, :] + dirs[:, None, :] * rho[None, :, None])
    edge = np.diff(np.pad(on, ((0, 0), (1, 1))).astype(np.int8), axis=1)
    r0, c0 = np.nonzero(edge == 1)
    _, c1 = np.nonzero(edge == -1)
    thin = (c1 - c0) <= ARC_RUN_PX
    need = ARC_COVER * ARC_MIN_DEG / ARC_STEP_DEG  # the fewest arc samples an arc can hold with
    if np.count_nonzero(thin) < need:
        return False
    ray = r0[thin]
    pts = dirs[ray] * (rho[0] + (c0[thin] + c1[thin] - 1) / 2.0)[:, None]  # run centres about the hinge
    nb = math.ceil(r_max - r_min) + 1
    # Hinge offsets on a grid (at most 9 x 9), each voting with a window as wide as the grid's error; the
    # best few offsets' voters are then fitted with a circle (a quarter arc leaves the offset along its
    # bisector ambiguous to votes alone).
    step = max(ARC_CENTRE_STEP, tol / 4.0)
    grid = np.arange(-tol, tol + 1e-9, step)
    offs = (grid[:, None, None] * toward + grid[None, :, None] * out).reshape(-1, 2)
    half = ARC_HIT_PX + math.ceil(0.71 * step)
    votes = _arc_votes(pts, ray, len(ang), offs, r_min, nb, half)
    best_bin = votes.argmax(axis=1)
    best = votes[np.arange(len(offs)), best_bin]
    for k in np.argsort(-best, kind="stable")[:ARC_TRIES].tolist():
        if best[k] < need:
            break
        sel = np.abs(np.hypot(*(pts - offs[k]).T) - (r_min + best_bin[k])) <= half
        fit = _fit_circle(pts[sel])
        if fit is None:
            continue
        centre, radius = fit
        if max(abs(float(centre @ toward)), abs(float(centre @ out))) > tol or not r_min <= radius <= r_max:
            continue
        if _arc_holds(ink, hinge + centre, dirs, radius):
            return True
    return False


def _fit_circle(pts: np.ndarray) -> tuple[np.ndarray, float] | None:
    """Algebraic least-squares circle through ``pts``, refitted twice on the points within
    ``ARC_HIT_PX`` of it: centre and radius, or None for fewer than 3 points or a degenerate fit."""
    use = np.ones(len(pts), bool)
    centre, radius = np.zeros(2), 0.0
    for _ in range(3):
        q = pts[use]
        if len(q) < 3:
            return None
        a = np.column_stack([2.0 * q, np.ones(len(q))])
        (cx, cy, c), *_ = np.linalg.lstsq(a, (q * q).sum(axis=1), rcond=None)
        r2 = c + cx * cx + cy * cy
        if r2 <= 0:
            return None
        centre, radius = np.array((cx, cy)), math.sqrt(r2)
        use = np.abs(np.hypot(*(pts - centre).T) - radius) <= ARC_HIT_PX
    return centre, radius


def _arc_votes(
    pts: np.ndarray, ray: np.ndarray, n_rays: int, offs: np.ndarray, r_min: float, nb: int, half: int
) -> np.ndarray:
    """Votes (offsets x radius bins from ``r_min``, 1 px): the rays with a run centre (``pts``, about the
    hinge, on ray ``ray``) within ``half`` px of each radius about each hinge offset."""
    radius = np.hypot(*(pts[None, :, :] - offs[:, None, :]).transpose(2, 0, 1))  # (offsets, runs)
    bins = np.rint(radius - r_min).astype(np.int64)
    ok = (bins >= -half) & (bins < nb + half)
    k_idx, p_idx = np.nonzero(ok)
    width = nb + 2 * half
    key = np.sort((k_idx * width + bins[ok] + half) * n_rays + ray[p_idx])
    key = key[np.concatenate(([True], np.diff(key) != 0))]  # one vote per ray and bin
    hits = np.bincount(key // n_rays, minlength=len(offs) * width).reshape(len(offs), width)
    cum = np.cumsum(np.pad(hits.astype(np.float64), ((0, 0), (1, 0))), axis=1)
    out: np.ndarray = cum[:, 2 * half + 1 :] - cum[:, : -(2 * half + 1)]  # bins b - half .. b + half
    return out


def _ink_at(ink: np.ndarray, pts: np.ndarray) -> np.ndarray:
    """Ink at the nearest pixel of each point (False outside the image)."""
    h, w = ink.shape[:2]
    x, y = np.rint(pts[..., 0]).astype(np.intp), np.rint(pts[..., 1]).astype(np.intp)
    inside = (x >= 0) & (x < w) & (y >= 0) & (y < h)
    out = np.zeros(x.shape, bool)
    out[inside] = ink[y[inside], x[inside]] > 0
    return out


def _arc_holds(ink: np.ndarray, centre: np.ndarray, dirs: np.ndarray, radius: float) -> bool:
    """The arc of ``radius`` about ``centre`` along ``dirs``: ink within ``ARC_HIT_PX`` of it and paper
    ``ARC_CLEAR_PX`` inside and outside, on ``ARC_COVER`` of the samples inside the image and on at least
    ``ARC_MIN_DEG`` contiguous degrees (breaks of at most ``ARC_MAX_BREAK`` samples)."""
    h, w = ink.shape[:2]
    at = centre[None, :] + dirs * radius
    inside = (at[:, 0] >= 0) & (at[:, 0] <= w - 1) & (at[:, 1] >= 0) & (at[:, 1] <= h - 1)
    need = ARC_MIN_DEG / ARC_STEP_DEG
    if np.count_nonzero(inside) < need:
        return False
    dr = np.arange(-ARC_HIT_PX, ARC_HIT_PX + 1, dtype=np.float64)
    hit = _ink_at(ink, centre[None, None, :] + dirs[:, None, :] * (radius + dr)[None, :, None]).any(axis=1)
    clear = ~_ink_at(ink, centre + dirs * (radius - ARC_CLEAR_PX)) & ~_ink_at(
        ink, centre + dirs * (radius + ARC_CLEAR_PX)
    )
    arc = hit & clear & inside
    if np.count_nonzero(arc) < ARC_COVER * np.count_nonzero(inside):
        return False
    best = run = gap = 0
    for i in range(len(arc)):
        if arc[i]:
            run += gap + 1
            gap = 0
        elif inside[i] and run and gap < ARC_MAX_BREAK:
            gap += 1
        else:
            run = gap = 0
        best = max(best, run)
    return best >= need


def _drop_leaves(runs: list[_Run]) -> list[_Run]:
    """Drop door leaves: a run with one end at a gap's jamb, a free far end and a length (far end to the
    jamb) of ``0.8 g .. 1.1 g``, leaving the gap's wall at least 30 degrees steeply.

    A leaf drawn touching its jamb merges with the jamb's end cap, so its near end may lie up to the
    wall thickness from the jamb point on the centre line.
    """
    jambs: list[tuple[np.ndarray, float, np.ndarray, float, int]] = []
    for k, r in enumerate(runs):
        off = r.offset()
        t = max(m.t for m in r.members)
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
    *,
    ink: np.ndarray,
) -> WallExtraction:
    """Wall masks and raw wall centre lines of the plan region (06 §8.1 steps 1-8); see the module doc.

    ``segments`` are the plan region's line segments (``detect_segments``, 06 §7.9; never the annotation
    region's ``A…`` segments, which are the dimension stage's) and ``dimension_lines`` the result of
    ``find_dimension_lines``; dimension lines take no part in walls. ``ink`` is the page's text-free ink
    (``OcrResult.ink_notext``, ruling R6: never raw ink). No rule reads OCR tokens (Task 14b moved the
    stacked-chain text-height rule into ``find_dimension_lines``), so the stage takes none.
    ``ctx.check_deadline`` is polled throughout.
    """
    poll = _throttled(ctx.check_deadline)
    poll()
    h, w = pre.ink.shape[:2]
    crop = pre.region.clip(w, h)
    mask = np.zeros((h, w), np.uint8)
    source_full = np.zeros((h, w), np.uint8)
    L = float(crop.long_side)
    faces = wall_face_dims(segments, dimension_lines, ink, pre.t_thin, L) if crop.w and crop.h else set()
    dims = [d for d in dimension_lines if d.segment_id not in faces]
    cands = candidate_segments(segments, dimension_lines, pre.t_thin, ink, faces)
    theta0 = dominant_orientation(cands)
    if crop.w <= 0 or crop.h <= 0:
        return WallExtraction(mask, source_full, [], theta0, max(1.0, 2.0 * pre.t_thin))
    ys, xs = slice(crop.y, crop.y + crop.h), slice(crop.x, crop.x + crop.w)

    text = (pre.ink[ys, xs] > 0) & (ink[ys, xs] == 0)
    filled = _filled_mask(pre, crop, max(h, w), text)
    bold = _bold_mask(cands, filled, crop, L) if page.source_kind != "pdf_vector" else np.zeros_like(filled)
    bold[filled > 0] = 0
    filled |= bold
    poll()
    vector = (
        _vector_mask(page, cands, pre.t_thin, crop)
        if page.source_kind == "pdf_vector"
        else np.zeros_like(filled)
    )
    envelope = solid_envelope(filled, L)
    dim_ends = np.array([(*d.p0, *d.p1) for d in dimension_lines], np.float64).reshape(-1, 4)
    double = double_mask(cands, ink[ys, xs], crop, L, pre.t_thin, poll, envelope, dim_ends)
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
        (SRC_BOLD, bold),
        (SRC_VECTOR, vector),
    ):
        source[layer > 0] = label
    wall = cv2.morphologyEx(filled | double | single | vector, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    _fill_small_holes(wall, (HOLE_FILL_FRAC * L) ** 2)
    poll()
    source[wall == 0] = 0  # pixels closed in by step 5 keep no label of their own
    mask[ys, xs] = wall
    source_full[ys, xs] = np.where(source == SRC_BOLD, SRC_FILLED, source)
    if not wall.any():
        return WallExtraction(mask, source_full, [], theta0, max(1.0, 2.0 * pre.t_thin))

    origin_xy = np.array((crop.x, crop.y, crop.x, crop.y), np.float64)
    thin = np.array([(*s.p0, *s.p1) for s in cands if s.is_thin], np.float64).reshape(-1, 4) - origin_xy
    # Door arcs are read on the page's thin ink: solid strokes (a jamb block) removed, so none merges with
    # an arc, and the whole page, so an exterior door's swing past the region's margin stays whole.
    arc_ink = ink.copy()
    arc_ink[ys, xs][cv2.dilate(filled, np.ones((5, 5), np.uint8)) > 0] = 0
    raw = _trace_raw_walls(wall, source, theta0, L, poll, thin, arc_ink, (float(crop.x), float(crop.y)))
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
    extensions = [s for s in segments if s.is_thin and any(touches_tick(s, d, pre.t_thin) for d in dims)]
    raw, graph = _drop_dangling_extensions(raw, extensions, pre.region, theta0, t_median, poll)
    return WallExtraction(mask, source_full, raw, theta0, t_median, graph, pre.region if graph else None)


def _drop_dangling_extensions(
    raw: list[RawWall],
    extensions: Sequence[Segment],
    region: Rect,
    theta0: float,
    t_median: float,
    poll: Check,
) -> tuple[list[RawWall], WallGraph | None]:
    """``raw`` without the walls that are extension lines outside the plan's outline (Task 16c), and the
    wall graph of the result when it was built (``walls_to_graph`` reuses it).

    The outline is the union of the bounded faces of the wall graph of ``raw``. A graph wall with a free
    end that lies outside it and runs along an extension line (a thin line touching a dimension tick,
    ruling R6's definition, within 3 degrees and its thickness across, over half of its length) is cut out
    of the raw walls it came from: a pair of extension lines drawn a wall's width apart pairs into a
    double-line wall, and extension lines continuing a wall past the outline extend it. Without a closed
    outline nothing is dropped. Repeats once for a chain of such walls."""
    for _ in range(2):
        if not raw or not extensions:
            return raw, None
        graph = _graph_of(raw, region, theta0, t_median, poll)  # the graph `walls_to_graph` builds
        lines = [LineString([w.a, w.b]) for w in graph.walls if math.dist(w.a, w.b) > 0]
        faces = list(polygonize(unary_union(lines))) if lines else []
        if not faces:
            return raw, graph
        outline = unary_union(faces).buffer(1.0)
        cuts = [
            w
            for w in graph.walls
            if w.free_ends
            and not outline.contains(Point((w.a[0] + w.b[0]) / 2.0, (w.a[1] + w.b[1]) / 2.0))
            and any(_runs_along(w.a, w.b, e, w.thickness_px) for e in extensions)
        ]
        if not cuts:
            return raw, graph
        for w in cuts:
            raw = [piece for r in raw for piece in _cut(r, w.a, w.b, w.thickness_px)]
    return raw, None


def _runs_along(a: Pt, b: Pt, e: Segment, thickness: float) -> bool:
    """The extension line ``e`` runs along the wall ``a``-``b``: parallel within 3 degrees, within the
    wall's thickness of its centre line and covering at least half of its length."""
    d = np.subtract(b, a)
    length = float(np.hypot(*d))
    ed = np.subtract(e.p1, e.p0)
    if length < 1e-9 or e.length < 1e-9:
        return False
    u = d / length
    if abs(float(u @ ed)) < math.cos(math.radians(OUTSIDE_ANGLE_DEG)) * e.length:
        return False
    n = np.array((-u[1], u[0]))
    q0, q1 = np.subtract(e.p0, a), np.subtract(e.p1, a)
    if max(abs(float(q0 @ n)), abs(float(q1 @ n))) > thickness:
        return False
    t0, t1 = sorted((float(q0 @ u), float(q1 @ u)))
    return min(t1, length) - max(t0, 0.0) >= OUTSIDE_COVER * length


def _cut(r: RawWall, a: Pt, b: Pt, thickness: float) -> list[RawWall]:
    """``r`` without its stretch along the graph wall ``a``-``b`` (when ``r`` runs along it: parallel within 3
    degrees and within half the thickness of its line); openings in the kept pieces are kept."""
    d = np.subtract(r.p1, r.p0)
    length = float(np.hypot(*d))
    w = np.subtract(b, a)
    w_len = float(np.hypot(*w))
    if length < 1e-9 or w_len < 1e-9:
        return [r]
    u = d / length
    if abs(float(u @ w)) < math.cos(math.radians(OUTSIDE_ANGLE_DEG)) * w_len:
        return [r]
    n = np.array((-u[1], u[0]))
    qa, qb = np.subtract(a, r.p0), np.subtract(b, r.p0)
    if max(abs(float(qa @ n)), abs(float(qb @ n))) > 0.5 * max(thickness, r.thickness_px):
        return [r]
    c0, c1 = sorted((float(qa @ u), float(qb @ u)))
    if c1 <= 0.0 or c0 >= length:
        return [r]
    out = []
    for lo, hi in ((0.0, c0), (c1, length)):
        if hi - lo < 1.0:
            continue
        p0 = np.asarray(r.p0) + u * lo
        p1 = np.asarray(r.p0) + u * hi
        openings = tuple(
            (max(o0, lo) - lo, min(o1, hi) - lo) for o0, o1 in r.openings_px if min(o1, hi) - max(o0, lo) > 0
        )
        out.append(
            RawWall(
                (float(p0[0]), float(p0[1])), (float(p1[0]), float(p1[1])), r.thickness_px, r.source, openings
            )
        )
    return out


def _trace_raw_walls(
    wall: np.ndarray,
    source: np.ndarray,
    theta0: float,
    L: float,
    poll: Check,
    thin: np.ndarray,
    ink: np.ndarray,
    origin: tuple[float, float] = (0.0, 0.0),
) -> list[RawWall]:
    """Steps 6-8 on the region's wall mask (crop coordinates); ``thin`` (k, 4) are the thin candidate
    segments and ``ink`` the text-free thin ink (solid strokes removed; the crop at ``origin`` in it),
    the opening evidence of ``_link_runs``."""
    dt = cv2.distanceTransform(wall, cv2.DIST_L2, cv2.DIST_MASK_PRECISE)
    skel = skeletonize(wall > 0)  # type: ignore[no-untyped-call]
    poll()
    edges, centroid, _ = _trace(skel, poll)
    n_nodes = len(centroid)
    node_r = sample(dt, centroid) if n_nodes else np.zeros(0)  # local half thickness at each node
    for _ in range(2):
        edges = _contract(_prune_spurs(edges, node_r, n_nodes))
    deg = _degrees(edges, n_nodes)
    t_skel = 2.0 * float(np.median(dt[skel])) if skel.any() else 1.0
    eps = max(EPS_MIN, EPS_FACTOR * t_skel)
    pieces = _snap(_pieces(edges, deg, dt, source, eps, poll), theta0, L)
    _march_free_ends(pieces, wall)
    t_wall = _wall_thickness(pieces)
    runs = [r for r in _drop_leaves(_runs(pieces, theta0, wall, poll, t_wall)) if r.s1 - r.s0 > 1e-6]
    links = _link_runs(runs, thin, ink, t_wall, poll, origin)
    return [*(r.wall() for r in runs), *links]


def walls_to_graph(
    ext: WallExtraction, region: Rect, *, check_deadline: Callable[[], None] | None = None
) -> WallGraph:
    """The wall graph of ``ext.raw`` (06 §8.1 step 9): ``build_wall_graph`` with ``r = max(t_median,
    0.006 L)``, ``L`` = the region's long side and ``theta0_deg = ext.theta0``. Near-identical duplicate
    raw walls are dropped first. The raw walls' ``openings_px`` come back as ``graph.gaps`` (the gap
    candidates, ids consistent with ``graph.walls``)."""
    if ext.graph is not None and ext.graph_region == region:
        return ext.graph  # built by extraction's outline rule from the same raw walls
    return _graph_of(ext.raw, region, ext.theta0, ext.t_median, check_deadline)


def _graph_of(
    raw: list[RawWall], region: Rect, theta0: float, t_median: float, check: Callable[[], None] | None
) -> WallGraph:
    L = float(region.long_side)
    raw = dedupe_raw_walls(raw)
    if not raw or L <= 0:
        return WallGraph(nodes={}, walls=[], gaps=[])
    t_median = max(t_median, 1e-3)
    r = max(t_median, SNAP_RADIUS_FRAC * L)
    return build_wall_graph(raw, r=r, t_median=t_median, L=L, theta0_deg=float(theta0), check_deadline=check)


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
