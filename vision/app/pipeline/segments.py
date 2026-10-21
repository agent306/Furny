"""Line segments: LSD (or Hough) detection, collinear merge, stroke width and dominant orientation (06 §7.9).

LSD reports the two *edges* of a stroke, not its centre line. Each detected edge is therefore moved onto
the ridge of the distance transform of the ink (the stroke centre) and extended to the end of the ink;
the two edges of one stroke then coincide and the collinear merge fuses them into one centre-line segment
whose width is read from the distance transform.
"""

import math
from collections.abc import Callable
from functools import cache

import cv2
import numpy as np

from app.pipeline.binarize import Preprocessed
from app.pipeline.context import PipelineContext
from app.pipeline.normalize import NormalizedPage
from app.pipeline.ocr_stage import OcrResult
from app.schemas.candidates import Segment, SegmentSource
from app.utils.geometry import Rect, detect_line_segments

__all__ = ["detect_segments", "dominant_orientation", "merge_collinear"]

MIN_LENGTH_PX = 8.0
MIN_LENGTH_FRAC = 0.008  # of the plan region's long side L
THIN_FACTOR = 1.8  # is_thin <= THIN_FACTOR * t_thin
WIDTH_SAMPLES = 9  # distance-transform samples per segment
ORIENTATION_BIN_DEG = 0.5
ORIENTATION_REFINE_DEG = 1.0  # the peak is refined over this half-window

TILE_PX = 2048  # LSD works on float64 buffers: bound its working set by tiling the region
TILE_OVERLAP_PX = 64  # a line cut by a seam is seen whole by one tile and merged afterwards
RIDGE_RADIUS_CAP_PX = 200  # the perpendicular search reaches `ceil(2 x max dt) + RIDGE_REACH_PX`, up to this
RIDGE_REACH_PX = 3  # an LSD edge lies within this distance of its stroke's ink
RUN_SLACK_PX = 1.5  # an ink run across a stroke may exceed 2 x dt by this much (anti-aliasing) ...
RUN_RATIO = 1.15  # ... and by this factor (the 3x3 chamfer distance transform reads up to ~5 % low)
MIN_SUPPORTED_SAMPLES = 5  # of WIDTH_SAMPLES must find ink for a segment to be snapped
EXTEND_STEP_PX = 0.5
EXTEND_MAX_PX = 3.0  # LSD ends stop up to ~1 px short of the ink
_CHUNK = 1024
_SNAP_CHUNK_CELLS = 2_000_000  # (segments x samples x offsets) per snapping chunk
_GRID_PX = 32  # endpoint grid of the collinear merge
_MAX_GRID_CELLS = 1500  # a bigger box is scanned linearly instead
_DEADLINE_EVERY = 256
_SIMILAR_WIDTH = 1.5  # strokes up to this width ratio fuse (06 §8.1 step 8)


@cache
def _lsd_available() -> bool:
    try:
        cv2.createLineSegmentDetector(cv2.LSD_REFINE_STD)
    except (cv2.error, AttributeError, NotImplementedError):
        return False
    return True


def _canonical(p0: np.ndarray, p1: np.ndarray) -> tuple[tuple[float, float], tuple[float, float]]:
    """Order the endpoints left to right (top to bottom for steep segments), so that p0 -> p1 runs along
    the undirected angle; a near-horizontal segment never flips over on sub-pixel noise in y."""
    dx, dy = p1[0] - p0[0], p1[1] - p0[1]
    if (dx < 0) if abs(dx) >= abs(dy) else (dy < 0):
        p0, p1 = p1, p0
    return (float(p0[0]), float(p0[1])), (float(p1[0]), float(p1[1]))


def _renumber(segs: list[Segment]) -> list[Segment]:
    """Sort by (min y, min x) and number `S1..Sn`."""
    segs = sorted(
        segs,
        key=lambda s: (
            min(s.p0[1], s.p1[1]),
            min(s.p0[0], s.p1[0]),
            max(s.p0[1], s.p1[1]),
            max(s.p0[0], s.p1[0]),
        ),
    )
    return [Segment(f"S{n}", s.p0, s.p1, s.width_px, s.is_thin, s.source) for n, s in enumerate(segs, 1)]


def _gather_candidates(
    cells: dict[tuple[int, int], list[int]],
    alive: bytearray,
    accept: Callable[[int], bool],
    a: tuple[float, float],
    b: tuple[float, float],
    margin: float,
) -> np.ndarray:
    """Alive segments that pass `accept` and have an endpoint in the grid cells under the box of `a`-`b`
    grown by `margin`.

    Any segment that can merge into the extent `a`-`b` has an endpoint near it (it cannot be longer than
    the extent), so registering the endpoints in a grid is enough.
    """
    cx0 = math.floor((min(a[0], b[0]) - margin) / _GRID_PX)
    cx1 = math.floor((max(a[0], b[0]) + margin) / _GRID_PX)
    cy0 = math.floor((min(a[1], b[1]) - margin) / _GRID_PX)
    cy1 = math.floor((max(a[1], b[1]) + margin) / _GRID_PX)
    found: set[int] = set()
    if (cx1 - cx0 + 1) * (cy1 - cy0 + 1) > _MAX_GRID_CELLS:  # a long diagonal: scan instead
        found.update(k for k in np.flatnonzero(np.frombuffer(alive, np.uint8)).tolist() if accept(k))
    else:
        for cx in range(cx0, cx1 + 1):
            for cy in range(cy0, cy1 + 1):
                members = cells.get((cx, cy))
                if members:
                    found.update(k for k in members if alive[k] and accept(k))
    return np.fromiter(found, np.intp, len(found))


def _near_line(
    angle: list[float],
    p0: list[list[float]],
    p1: list[list[float]],
    base_angle: float,
    angle_tol: float,
    origin: tuple[float, float],
    normal: tuple[float, float],
    margin: float,
) -> Callable[[int], bool]:
    """Predicate: segment `k` runs in the base direction and both its endpoints are within `margin` of
    the base line (the merge tolerance never exceeds `margin`)."""
    ox, oy = origin
    nx, ny = normal

    def accept(k: int) -> bool:
        diff = abs(angle[k] - base_angle)
        if min(diff, 180.0 - diff) > angle_tol:
            return False
        (x0, y0), (x1, y1) = p0[k], p1[k]
        near_0 = abs((x0 - ox) * nx + (y0 - oy) * ny) <= margin
        return near_0 and abs((x1 - ox) * nx + (y1 - oy) * ny) <= margin

    return accept


def merge_collinear(
    segs: list[Segment],
    *,
    angle_tol_deg: float = 1.5,
    dist_tol: float = 2.0,
    gap_tol: float = 4.0,
    check_deadline: Callable[[], None] | None = None,
) -> list[Segment]:
    """Fuse collinear segments (06 §7.9 step 3), longest first.

    A segment joins the one being grown when its angle differs by at most `angle_tol_deg`, both of its
    endpoints lie within the perpendicular tolerance of the longer one's line and the gap between the two
    along that line is at most `gap_tol`. The tolerance is `dist_tol`, but at least half the larger
    stroke width. Strokes of clearly different width (ratio above 1.5) do not fuse; only a thinner
    segment lying inside the extent of the thicker one is absorbed (an edge remnant), and it never
    lengthens it. The result is the union of the projections onto the longer segment's direction, on its
    line, with the length-weighted mean width. Ids are renumbered `S1..Sn` by (min y, min x).

    Candidates come from a grid over the endpoints, so the cost is close to linear in `len(segs)`;
    `check_deadline` is called every few hundred segments.
    """
    if not segs:
        return []
    p0 = np.array([s.p0 for s in segs], np.float64)
    p1 = np.array([s.p1 for s in segs], np.float64)
    width = np.array([s.width_px for s in segs], np.float64)
    length = np.hypot(*(p1 - p0).T)
    angle = np.array([s.angle_deg for s in segs], np.float64)
    alive = bytearray(b"\x01") * len(segs)
    p0_l, p1_l = p0.tolist(), p1.tolist()
    length_l, width_l, angle_l = length.tolist(), width.tolist(), angle.tolist()
    cells: dict[tuple[int, int], list[int]] = {}
    cell0 = np.floor(p0 / _GRID_PX).astype(np.intp).tolist()
    cell1 = np.floor(p1 / _GRID_PX).astype(np.intp).tolist()
    for k, (c0, c1) in enumerate(zip(cell0, cell1, strict=True)):
        cells.setdefault((c0[0], c0[1]), []).append(k)
        if c1 != c0:
            cells.setdefault((c1[0], c1[1]), []).append(k)
    out: list[Segment] = []
    for step, i in enumerate(int(k) for k in np.argsort(-length, kind="stable")):
        if check_deadline is not None and step % _DEADLINE_EVERY == 0:
            check_deadline()
        if not alive[i]:
            continue
        alive[i] = 0
        base_len = float(length_l[i])
        if base_len == 0.0:
            continue
        ox, oy = p0_l[i]
        ux, uy = (p1_l[i][0] - ox) / base_len, (p1_l[i][1] - oy) / base_len
        u = np.array((ux, uy))
        origin = np.array((ox, oy))
        nx, ny = -uy, ux
        w_base = width_l[i]
        t_lo, t_hi = 0.0, base_len
        weight_sum, width_sum = base_len, base_len * w_base
        margin = max(dist_tol, 0.75 * w_base) + gap_tol
        base_angle = angle_l[i]

        accept = _near_line(angle_l, p0_l, p1_l, base_angle, angle_tol_deg, (ox, oy), (nx, ny), margin)
        while True:
            a = (ox + ux * t_lo, oy + uy * t_lo)
            b = (ox + ux * t_hi, oy + uy * t_hi)
            cand = _gather_candidates(cells, alive, accept, a, b, margin)
            if cand.size == 0:
                break
            rel0, rel1 = p0[cand] - origin, p1[cand] - origin
            t0, t1 = rel0 @ u, rel1 @ u
            perp = np.maximum(
                np.abs(rel0[:, 0] * nx + rel0[:, 1] * ny), np.abs(rel1[:, 0] * nx + rel1[:, 1] * ny)
            )
            lo, hi = np.minimum(t0, t1), np.maximum(t0, t1)
            w_c = width[cand]
            similar = np.maximum(w_c, w_base) <= _SIMILAR_WIDTH * np.maximum(np.minimum(w_c, w_base), 1e-9)
            tol = np.maximum(dist_tol, 0.5 * np.maximum(w_c, w_base))
            gap = np.maximum(np.maximum(lo - t_hi, t_lo - hi), 0.0)
            extend = similar & (perp <= tol) & (gap <= gap_tol)
            absorb = (
                ~similar
                & (w_c < w_base)
                & (perp <= max(dist_tol, 0.5 * w_base))
                & (lo >= t_lo - gap_tol)
                & (hi <= t_hi + gap_tol)
            )
            for k in cand[absorb].tolist():
                alive[k] = 0
            if not extend.any():
                break
            idx = cand[extend]
            t_lo, t_hi = min(t_lo, float(lo[extend].min())), max(t_hi, float(hi[extend].max()))
            weight_sum += float(length[idx].sum())
            width_sum += float((length[idx] * width[idx]).sum())
            for k in idx.tolist():
                alive[k] = 0
        p_a, p_b = _canonical(origin + u * t_lo, origin + u * t_hi)
        out.append(Segment("", p_a, p_b, width_sum / weight_sum, segs[i].is_thin, segs[i].source))
    return _renumber(out)


def dominant_orientation(segs: list[Segment]) -> float:
    """Dominant drawing angle `theta0` in [0, 90) degrees: the peak of the length-weighted histogram of
    segment angles mod 90 in 0.5 degree bins (circular), refined over the peak's +-1 degree window."""
    if not segs:
        return 0.0
    ang = np.array([s.angle_deg for s in segs], np.float64) % 90.0
    w = np.array([s.length for s in segs], np.float64)
    n_bins = round(90.0 / ORIENTATION_BIN_DEG)
    hist = np.bincount((ang / ORIENTATION_BIN_DEG).astype(np.intp) % n_bins, weights=w, minlength=n_bins)
    smooth = hist + np.roll(hist, 1) + np.roll(hist, -1)
    centre = (int(np.argmax(smooth)) + 0.5) * ORIENTATION_BIN_DEG
    delta = (ang - centre + 45.0) % 90.0 - 45.0
    near = np.abs(delta) <= ORIENTATION_REFINE_DEG + ORIENTATION_BIN_DEG
    if not near.any() or w[near].sum() == 0.0:
        return centre % 90.0
    theta = (centre + float(np.average(delta[near], weights=w[near]))) % 90.0
    return 0.0 if theta >= 90.0 else theta


def _sample_dt(dt: np.ndarray, x: np.ndarray, y: np.ndarray) -> np.ndarray:
    """Distance-transform values at the nearest pixels (centre convention); 0 outside the image."""
    h, w = dt.shape
    ix, iy = np.floor(x + 0.5).astype(np.intp), np.floor(y + 0.5).astype(np.intp)
    inside = (ix >= 0) & (ix < w) & (iy >= 0) & (iy < h)
    vals = dt[np.clip(iy, 0, h - 1), np.clip(ix, 0, w - 1)]
    return np.where(inside, vals, np.float32(0.0))


def _sample_points(p0: np.ndarray, p1: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """`(n, WIDTH_SAMPLES, 2)` points evenly spread along the segments, the unit directions and normals."""
    d = p1 - p0
    length = np.maximum(np.hypot(d[:, 0], d[:, 1]), 1e-9)
    u = d / length[:, None]
    nrm = np.stack([-u[:, 1], u[:, 0]], axis=1)
    t = (np.arange(1, WIDTH_SAMPLES + 1) / (WIDTH_SAMPLES + 1))[None, :, None]
    return p0[:, None, :] + d[:, None, :] * t, u, nrm


def _snap_chunk(p0: np.ndarray, p1: np.ndarray, dt: np.ndarray, radius: int) -> tuple[np.ndarray, np.ndarray]:
    """Per segment: the median offset of the stroke centre along the normal and the median stroke width.

    On each of the 9 normals (searched `radius` px to both sides) the ink run closest to the segment
    (within `RIDGE_REACH_PX`) is found; its centre is the mean offset of the run's distance-transform
    maxima, its width twice that maximum. A run that reaches the end of the search window is cut off, so
    it is not a stroke cross-section either.
    Returns `(offset, width)`, with NaN where fewer than `MIN_SUPPORTED_SAMPLES` normals find ink.
    """
    pts, _, nrm = _sample_points(p0, p1)
    offs = np.arange(-radius, radius + 1, dtype=np.float64)
    j = offs.size
    x = pts[:, :, None, 0] + nrm[:, None, None, 0] * offs[None, None, :]
    y = pts[:, :, None, 1] + nrm[:, None, None, 1] * offs[None, None, :]
    val = _sample_dt(dt, x, y)  # (n, S, J)
    idx = np.arange(j)
    nz = val > 0
    dist = np.where(nz, np.abs(idx - radius), j)
    start = dist.argmin(axis=2)
    zero = ~nz
    left = np.where(zero & (idx < start[..., None]), idx, -1).max(axis=2) + 1
    right = np.where(zero & (idx > start[..., None]), idx, j).min(axis=2) - 1
    in_run = (idx >= left[..., None]) & (idx <= right[..., None])
    peak = np.where(in_run, val, 0).max(axis=2)
    # A stroke seen across is as long as it is wide (~ 2 x its dt maximum); a longer run means the normal
    # follows the ink (the end cap of a stroke, a junction), which says nothing about the centre line.
    across = ((right - left + 1) <= RUN_RATIO * 2.0 * peak + RUN_SLACK_PX) & (left > 0) & (right < j - 1)
    found = (dist.min(axis=2) <= RIDGE_REACH_PX) & across
    at_peak = in_run & (val >= peak[..., None] - 1e-3)
    centre = (at_peak * offs).sum(axis=2) / np.maximum(at_peak.sum(axis=2), 1)
    centre = np.where(found, centre, np.nan)
    width = np.where(found, 2.0 * peak, np.nan)
    supported = found.sum(axis=1) >= MIN_SUPPORTED_SAMPLES
    n = p0.shape[0]
    off_out, w_out = np.full(n, np.nan), np.full(n, np.nan)
    if supported.any():
        off_out[supported] = np.nanmedian(centre[supported], axis=1)
        w_out[supported] = np.nanmedian(width[supported], axis=1)
    return off_out, w_out


def _extend(p0: np.ndarray, p1: np.ndarray, ink: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Grow both ends along the segment while the ink continues, at most `EXTEND_MAX_PX`."""
    d = p1 - p0
    u = d / np.maximum(np.hypot(d[:, 0], d[:, 1]), 1e-9)[:, None]
    ends: list[np.ndarray] = []
    for end, direction in ((p0, -u), (p1, u)):
        reach = np.zeros(end.shape[0])
        alive = np.ones(end.shape[0], bool)
        for k in range(1, round(EXTEND_MAX_PX / EXTEND_STEP_PX) + 1):
            q = end + direction * (k * EXTEND_STEP_PX)
            alive &= _sample_dt(ink, q[:, 0], q[:, 1]) > 0
            reach[alive] = k * EXTEND_STEP_PX
        ends.append(end + direction * reach[:, None])
    return ends[0], ends[1]


def _snap_and_extend(
    raw: np.ndarray, pre: Preprocessed
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Move raw LSD edges onto their stroke centre lines. Returns `(p0, p1, width, snapped)`; segments
    that are not the edge of a stroke (end caps, no ink nearby) stay where they are, with width `t_thin`."""
    p0, p1 = raw[:, :2].astype(np.float64), raw[:, 2:].astype(np.float64)
    width = np.full(p0.shape[0], pre.t_thin)
    snapped = np.zeros(p0.shape[0], bool)
    # Search far enough to see the widest stroke whole; a wider blob is simply not snapped.
    radius = min(RIDGE_RADIUS_CAP_PX, math.ceil(2.0 * float(pre.dt.max())) + RIDGE_REACH_PX)
    chunk = max(16, _SNAP_CHUNK_CELLS // (WIDTH_SAMPLES * (2 * radius + 1)))
    for lo in range(0, p0.shape[0], chunk):
        sl = slice(lo, lo + chunk)
        off, w = _snap_chunk(p0[sl], p1[sl], pre.dt, radius)
        ok = ~np.isnan(off)
        d = p1[sl] - p0[sl]
        length = np.maximum(np.hypot(d[:, 0], d[:, 1]), 1e-9)
        shift = np.stack([-d[:, 1], d[:, 0]], axis=1) / length[:, None] * np.where(ok, off, 0.0)[:, None]
        a, b = p0[sl] + shift, p1[sl] + shift
        a_ext, b_ext = _extend(a, b, pre.ink)
        a[ok], b[ok] = a_ext[ok], b_ext[ok]
        p0[sl], p1[sl] = a, b
        width[sl] = np.where(ok, w, pre.t_thin)
        snapped[sl] = ok
    return p0, p1, width, snapped


def _lsd_page_segments(
    pre: Preprocessed, text_mask: np.ndarray, region: Rect, ctx: PipelineContext
) -> np.ndarray:
    """`(N, 4)` float32 LSD segments of the region in page pixels, text boxes painted white, tile by tile."""
    step = max(1, TILE_PX - TILE_OVERLAP_PX)
    found: list[np.ndarray] = []
    for ty in range(0, max(1, region.h - TILE_OVERLAP_PX), step):
        for tx in range(0, max(1, region.w - TILE_OVERLAP_PX), step):
            ctx.check_deadline()
            x0, y0 = region.x + tx, region.y + ty
            x1, y1 = min(region.x + region.w, x0 + TILE_PX), min(region.y + region.h, y0 + TILE_PX)
            tile = pre.gray[y0:y1, x0:x1].copy()
            tile[text_mask[y0:y1, x0:x1] > 0] = 255
            segs = detect_line_segments(tile)
            if len(segs):
                found.append(segs + np.array([x0, y0, x0, y0], np.float32))
    return np.concatenate(found) if found else np.zeros((0, 4), np.float32)


def _attach_widths(segs: list[Segment], pre: Preprocessed) -> list[Segment]:
    """`widthPx = 2 x median(dt)` at 9 evenly spaced points (best of the pixel and its two normal
    neighbours, so a half-pixel offset from the ridge does not matter); `isThin = width <= 1.8 t_thin`."""
    if not segs:
        return segs
    p0 = np.array([s.p0 for s in segs], np.float64)
    p1 = np.array([s.p1 for s in segs], np.float64)
    widths = np.empty(len(segs))
    for lo in range(0, len(segs), _CHUNK):
        a, b = p0[lo : lo + _CHUNK], p1[lo : lo + _CHUNK]
        pts, _, nrm = _sample_points(a, b)
        best = np.max(
            [
                _sample_dt(pre.dt, pts[..., 0] + k * nrm[:, None, 0], pts[..., 1] + k * nrm[:, None, 1])
                for k in (-1.0, 0.0, 1.0)
            ],
            axis=0,
        )
        widths[lo : lo + _CHUNK] = 2.0 * np.median(best, axis=1)
    out: list[Segment] = []
    for s, w in zip(segs, widths, strict=True):
        wp = float(w) if w > 0 else pre.t_thin
        out.append(Segment(s.id, s.p0, s.p1, wp, wp <= THIN_FACTOR * pre.t_thin, s.source))
    return out


def _raster_segments(pre: Preprocessed, ocr: OcrResult, ctx: PipelineContext) -> list[Segment]:
    h, w = pre.gray.shape[:2]
    region = pre.region.clip(w, h)
    if region.w <= 0 or region.h <= 0:
        return []
    raw = _lsd_page_segments(pre, ocr.text_mask, region, ctx)
    length = np.hypot(raw[:, 2] - raw[:, 0], raw[:, 3] - raw[:, 1])
    raw = raw[length >= max(MIN_LENGTH_PX, MIN_LENGTH_FRAC * region.long_side)]
    if raw.shape[0] == 0:
        return []
    ctx.check_deadline()
    p0, p1, width, snapped = _snap_and_extend(raw, pre)
    source: SegmentSource = "lsd" if _lsd_available() else "hough"
    centre_lines: list[Segment] = []
    others: list[Segment] = []  # end caps and ink-less segments: no stroke width to measure
    for a, b, wd, ok in zip(p0, p1, width, snapped, strict=True):
        q0, q1 = _canonical(a, b)
        seg = Segment("", q0, q1, float(wd), float(wd) <= THIN_FACTOR * pre.t_thin, source)
        (centre_lines if ok else others).append(seg)
    merged = merge_collinear(centre_lines, check_deadline=ctx.check_deadline)
    merged_others = merge_collinear(others, check_deadline=ctx.check_deadline)
    ctx.check_deadline()
    return _renumber([*_attach_widths(merged, pre), *merged_others])


def _vector_segments(page: NormalizedPage, pre: Preprocessed) -> list[Segment]:
    """PDF line work mapped to normalized px; width is the PDF line width scaled by the transform."""
    vector = page.vector
    assert vector is not None
    a = np.asarray(page.transform, np.float64)
    scale = math.sqrt(abs(float(np.linalg.det(a[:2, :2]))))
    h, w = pre.gray.shape[:2]
    region = pre.region.clip(w, h)
    pts = np.array([(*s.p0, 1.0, *s.p1, 1.0) for s in vector.segments], np.float64).reshape(-1, 2, 3)
    mapped = pts @ a.T
    mapped = mapped[..., :2] / mapped[..., 2:3]
    out: list[Segment] = []
    for s, (q0, q1) in zip(vector.segments, mapped, strict=True):
        mid = ((q0[0] + q1[0]) / 2, (q0[1] + q1[1]) / 2)
        if math.hypot(q1[0] - q0[0], q1[1] - q0[1]) < 1e-6 or not region.contains(mid):
            continue
        wd = s.width_px * scale if s.width_px > 0 else pre.t_thin  # hairlines count as thin
        c0, c1 = _canonical(q0, q1)
        out.append(Segment("", c0, c1, wd, wd <= THIN_FACTOR * pre.t_thin, "vector"))
    return out


def detect_segments(
    page: NormalizedPage, pre: Preprocessed, ocr: OcrResult, ctx: PipelineContext
) -> list[Segment]:
    """Line segments of the plan region, merged and with stroke widths attached (06 §7.9).

    Raster pages: LSD on the grey image with the OCR text boxes painted white (Hough when LSD is
    unavailable), segments shorter than `max(8 px, 0.008 L)` dropped. `pdf_vector` pages use the PDF
    strokes instead (widths from the PDF line width). Ids are `S1..Sn` by (min y, min x).
    """
    if page.source_kind == "pdf_vector" and page.vector is not None and page.vector.segments:
        merged = merge_collinear(_vector_segments(page, pre), check_deadline=ctx.check_deadline)
        limit = THIN_FACTOR * pre.t_thin  # merging changed the widths
        return [Segment(m.id, m.p0, m.p1, m.width_px, m.width_px <= limit, m.source) for m in merged]
    return _raster_segments(pre, ocr, ctx)
