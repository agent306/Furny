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
different drawing styles across a window, slider or door by a bridging wall (ruling B2). A partition whose
free end holds a door closing against a crossing wall is carried through to it as an opening
(``_partition_doors``, Task 16c ruling R-b). Last, walls that dangle outside the closed outline along
extension lines are cut out (``_drop_dangling_extensions``).

Door leaves (thin lines with a swing arc about one end, ``opening_evidence.door_leaves``) pair with a much
longer line only after every other pair (Task 17): beside a wall's face, a leaf took the face from its
partner.

Step 2's candidate segments and step 3's double-line pairing live in ``wall_candidates.py``, step 6's skeleton
tracing in ``wall_skeleton.py`` and steps 7-8 with the run linking in ``wall_runs.py``; this module keeps the
masks (steps 1-5), the extension cut and the wall graph.

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
from shapely.geometry import LineString, Point
from shapely.ops import polygonize, unary_union
from skimage.morphology import skeletonize

from app.pipeline.binarize import Preprocessed, sauvola_window
from app.pipeline.context import PipelineContext
from app.pipeline.graph import build_wall_graph
from app.pipeline.normalize import NormalizedPage
from app.pipeline.opening_evidence import door_leaves
from app.pipeline.segments import dominant_orientation
from app.pipeline.wall_candidates import (
    DOUBLE_MIN_LEN_FRAC,
    Check,
    candidate_segments,
    double_mask,
    sample,
    solid_envelope,
    touches_tick,
    wall_face_dims,
)
from app.pipeline.wall_runs import (
    _SOURCE_RANK,
    DUPLICATE_ANGLE_DEG,
    _drop_leaves,
    _link_runs,
    _march_free_ends,
    _partition_doors,
    _runs,
    _snap,
    _wall_thickness,
    _weighted_median,
)
from app.pipeline.wall_skeleton import (
    SRC_BOLD,
    SRC_DOUBLE,
    SRC_FILLED,
    SRC_SINGLE,
    SRC_VECTOR,
    _contract,
    _degrees,
    _pieces,
    _prune_spurs,
    _trace,
)
from app.schemas.candidates import DimensionLine, RawWall, Segment, WallGraph
from app.utils.geometry import Pt, Rect

__all__ = [
    "WallExtraction",
    "debug_walls_png",
    "dedupe_raw_walls",
    "extract_walls",
    "walls_to_graph",
]


VECTOR_WALL_FACTOR = 2.5  # stroked vector segments at least this many t_thin wide are walls
BOLD_MIN_LEN_FRAC = 0.04  # raster bold strokes (not thin) at least 0.04 L long are solid walls (ruling R2)
TEXT_SHARE_MAX = 0.5  # a `thick` component with more than half of its pixels in text boxes is text
SINGLE_COVERAGE = 0.002  # sketches: fill and double masks cover less than this share of the region
SINGLE_MIN_LEN_FRAC = 0.05
SINGLE_WIDTH_FACTOR = 3.0  # sketch lines are drawn 3 x t_thin wide
HOLE_FILL_FRAC = 0.01  # holes in W smaller than (0.01 L)^2 are filled (no pixel loops in the skeleton)
EPS_MIN, EPS_FACTOR = 1.5, 0.25  # approxPolyDP epsilon = max(1.5, 0.25 x median thickness)
OUTSIDE_ANGLE_DEG = 3.0  # a dangling wall outside the outline along an extension line (within 3 degrees ...
OUTSIDE_COVER = 0.5  # ... over half of its length) is that extension line (Task 16c)
SNAP_RADIUS_FRAC = 0.006  # graph snap radius r = max(t_median, 0.006 L)

_POLL_SECONDS = 0.02  # deadline polls reach the real check at most this often


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
    # Door arcs are read on the page's thin ink: solid strokes (a jamb block) removed, so none merges with
    # an arc, and the whole page, so an exterior door's swing past the region's margin stays whole.
    arc_ink = ink.copy()
    arc_ink[ys, xs][cv2.dilate(filled, np.ones((5, 5), np.uint8)) > 0] = 0
    leaves = set(door_leaves(cands, arc_ink, pre.t_thin, DOUBLE_MIN_LEN_FRAC * L))
    poll()
    double = double_mask(cands, ink[ys, xs], crop, L, pre.t_thin, poll, envelope, dim_ends, leaves)
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
    linked: set[tuple[int, int]] = set()
    links = _link_runs(runs, thin, ink, t_wall, poll, origin, linked)
    doors = _partition_doors(runs, ink, t_wall, poll, origin, linked, thin)
    return [*(r.wall() for r in runs), *links, *doors]


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
