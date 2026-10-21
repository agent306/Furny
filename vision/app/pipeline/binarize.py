"""Binarization, colour analysis, stroke width, style and thick-ink mask (06 §7.6)."""

import itertools
from dataclasses import dataclass

import cv2
import numpy as np
from skimage.morphology import skeletonize

from app.pipeline.context import PipelineContext
from app.pipeline.normalize import NormalizedPage
from app.pipeline.rectify import flatten_illumination
from app.pipeline.region import detect_plan_region
from app.schemas.meta import DrawingKind
from app.utils.geometry import Rect, odd

SAUVOLA_K = 0.2
SAUVOLA_MIN, SAUVOLA_MAX = 15, 81
SAUVOLA_EDGE_DIV = 60
PAPER_V_MAX = 245  # colourfulness ignores near-white paper
DARK_V_MIN, DARK_V_MAX = 90, 170  # adaptive dark threshold: Otsu over non-paper V, clamped (ruling R3)
DARK_S_MAX = 60  # solid-wall candidates are achromatic: chroma (S x V / 255) below this (0..255 scale)
BROCHURE_COLORFULNESS = 25.0
BROCHURE_DARK_FRAC = 0.005
THIN_MAX_PX = 6.0  # stroke widths above this (source px, see `_width_mode`) are walls, not line work
WIDTH_BIN_PX = 0.5
DEFAULT_T_THIN = 2.0
THICK_K_MIN, THICK_K_MAX = 3, 15
THICK_K_FACTOR = 2.2
SAUVOLA_R = 127.5  # half the uint8 dynamic range: skimage's default `r` for uint8 input
MIN_BLOB_KERNELS = 3  # components smaller than (3k)^2 px are dropped from `thick`
BOLD_FACTOR = 1.8  # bold strokes are at least this many t_thin wide (= segments' is_thin limit, ruling R2)
BOLD_MIN_LEN_FRAC = 0.04  # ... and at least this long (fraction of the page's long edge here, of L in walls)
DOUBLE_MIN_LEN_FRAC = 0.03  # double-line walls for the plan region: two thin lines at least this long ...
DOUBLE_MAX_GAP_FRAC = 0.02  # ... at most this far apart (fractions of the long edge; walls' pair limits, R6)
DOUBLE_MIN_SPAN_FRAC = 0.1  # ... in joined strips spanning at least this much both across and down
GRID_LINE_SHARE = 0.5  # periodic grids: lines running across half of a structure ...
GRID_MIN_CELLS = 3  # ... at least this many consecutive cells ...
GRID_PITCH_TOL = 0.15  # ... of equal pitch within 15 %, in both directions


@dataclass(frozen=True, eq=False)
class Preprocessed:
    gray: np.ndarray  # uint8, illumination-flattened for photos (this is what was thresholded)
    ink: np.ndarray  # uint8 0/255
    dark: np.ndarray  # uint8 0/255, achromatic and darker than `dark_threshold` (see `dark_mask`)
    thick: np.ndarray  # uint8 0/255, wall-scale ink only
    dt: np.ndarray  # float32, cv2.distanceTransform(ink, DIST_L2, 3)
    t_thin: float  # typical thin-line width in px
    colorfulness: float  # mean saturation of non-paper pixels, 0..255
    drawing_kind: DrawingKind
    region: Rect


def sauvola_window(long_edge: int) -> int:
    return odd(min(SAUVOLA_MAX, max(SAUVOLA_MIN, round(long_edge / SAUVOLA_EDGE_DIV))))


def thick_kernel(t_thin: float) -> int:
    return min(THICK_K_MAX, max(THICK_K_MIN, odd(round(THICK_K_FACTOR * t_thin) + 1)))


def stroke_width_mode(ink: np.ndarray, upscale: float = 1.0) -> float:
    """Most common thin stroke width (2 x distance transform on the skeleton), in this image's pixels.

    ``upscale`` is the normalisation resample factor (06 §7.5). An upscaled source draws its 1-2 px lines
    ``upscale`` times as wide, so the search range (06 §7.6: <= 6 px) is measured in source pixels: widths
    up to ``6 x upscale`` count (ruling R5). Without that, a 2 px source line upscaled 3.7x (~7.5 px) falls
    outside the range and the mode lands on anti-aliasing debris or the range's top bin. Bins stay 0.5 px of
    this image (the distance transform is quantised per pixel here). Downscaled pages (factor < 1) keep the
    plain 6 px. Returns the centre of the winning bin, or 2.0 when no thin stroke exists.
    """
    if not ink.any():
        return DEFAULT_T_THIN
    dt = cv2.distanceTransform(ink, cv2.DIST_L2, 3)
    return _width_mode(dt, ink, upscale)


def _width_mode(dt: np.ndarray, ink: np.ndarray, upscale: float = 1.0) -> float:
    cap, bin_px = THIN_MAX_PX * max(1.0, upscale), WIDTH_BIN_PX
    widths = 2.0 * dt[skeletonize(ink > 0)]  # type: ignore[no-untyped-call]
    widths = widths[(widths > 0) & (widths <= cap)]
    if widths.size == 0:
        return DEFAULT_T_THIN
    edges = np.arange(0.0, cap + bin_px, bin_px)
    hist, _ = np.histogram(widths, bins=edges)
    return float(edges[int(np.argmax(hist))] + bin_px / 2)


def dark_threshold(val: np.ndarray) -> float:
    """V below which an achromatic pixel is "dark" (a solid wall candidate): Otsu's threshold over the V
    channel of the non-paper pixels (V < 245), clamped to ``[90, 170]`` (ruling R3; 06 §7.6 has a fixed
    90). Black-ink drawings stay near 90-110; a brochure's grey walls (V ~ 105-150 between white paper and
    pale room fills) fall below it. The Sauvola ink is not the population: it hollows wide grey walls and
    splits into black strokes and grey strokes, so its Otsu threshold cuts through the walls' cores."""
    values = val[val < PAPER_V_MAX]
    if values.size == 0:
        return float(DARK_V_MIN)
    otsu, _ = cv2.threshold(values.reshape(-1, 1), 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return float(min(DARK_V_MAX, max(DARK_V_MIN, otsu)))


def dark_mask(hsv: np.ndarray) -> np.ndarray:
    """``(V <= dark_threshold) & (chroma < 60)`` (Otsu's dark class is ``<= t``), chroma = ``S x V / 255``
    (= max - min of BGR): the 06 §7.6
    ``S < 60`` test at full brightness, without rejecting near-black tinted strokes (navy outlines read
    S ~ 100 at V ~ 50 although their chroma is ~ 20)."""
    sat, val = hsv[..., 1], hsv[..., 2]
    chroma_ok = sat.astype(np.uint16) * val.astype(np.uint16) < DARK_S_MAX * 255
    out: np.ndarray = ((val <= dark_threshold(val)) & chroma_ok).astype(np.uint8) * 255
    return out


def bold_strokes(ink: np.ndarray, t_thin: float, min_len: float) -> np.ndarray:
    """Ink strokes at least ``1.8 t_thin`` wide (an opening with that square) in components whose bounding
    box is at least ``min_len`` long: wall outlines drawn as bold lines, which are neither thin line work nor
    wide enough for ``thick`` (ruling R2/R4). Text and symbols are too short to qualify."""
    k = odd(round(BOLD_FACTOR * t_thin))
    opened = cv2.morphologyEx(ink, cv2.MORPH_OPEN, np.ones((k, k), np.uint8))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(opened, connectivity=8)
    keep = np.zeros(n, bool)
    keep[1:] = np.maximum(stats[1:, cv2.CC_STAT_WIDTH], stats[1:, cv2.CC_STAT_HEIGHT]) >= min_len
    out: np.ndarray = keep[labels].astype(np.uint8) * 255
    return out


def double_line_strips(
    ink: np.ndarray, t_thin: float, long_edge: int, walls: np.ndarray | None = None
) -> np.ndarray:
    """The strips between pairs of parallel thin lines (horizontal or vertical), each at least ``0.03`` of
    the long edge long and at most ``0.02`` of it apart: the extent of double-line walls, before segments
    exist (Task 16c; the walls stage pairs the segments themselves). Thin line work is the ink minus its
    opening with a ``1.8 t_thin`` square; text, hatching (not axis-aligned or shorter than the length) and
    single lines leave no strip.

    A connected structure of strips counts when it is no periodic grid (``_is_grid``: schedule and
    title-block tables, tiled floors and terraces) and either touches a solid wall drawing (``walls``:
    thick or bold strokes) inside that drawing's bounding box (it adds no extent), or spans at
    least ``0.1`` of the long edge both ways (walls meet at corners and junctions; a lone straight pair
    reaching out of a drawing is a pair of extension lines or a stacked chain as often as a wall)."""
    k = odd(round(BOLD_FACTOR * t_thin))
    thin = cv2.subtract(ink, cv2.morphologyEx(ink, cv2.MORPH_OPEN, np.ones((k, k), np.uint8)))
    length = max(3, round(DOUBLE_MIN_LEN_FRAC * long_edge))
    gap = max(3, round(DOUBLE_MAX_GAP_FRAC * long_edge))
    out = np.zeros_like(ink)
    line_masks = []
    for along, across in (((1, length), (gap, 1)), ((length, 1), (1, gap))):
        lines = cv2.morphologyEx(thin, cv2.MORPH_OPEN, np.ones(along, np.uint8))
        line_masks.append(lines)
        band = cv2.morphologyEx(lines, cv2.MORPH_CLOSE, np.ones(across, np.uint8))
        strip = cv2.subtract(band, lines)
        out |= cv2.morphologyEx(strip, cv2.MORPH_OPEN, np.ones(along, np.uint8))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(out, connectivity=8)
    if n <= 1:
        return out
    within = np.zeros(n, bool)  # touching a solid wall, inside that wall's drawing's extent
    if walls is not None and walls.any():
        _, wall_labels, wall_stats, _ = cv2.connectedComponentsWithStats(walls, connectivity=8)
        near = cv2.dilate(walls, np.ones((3, 3), np.uint8)) > 0
        hits = labels[near] > 0
        wall_of = cv2.dilate(wall_labels.astype(np.float32), np.ones((3, 3), np.uint8))[near][hits].astype(
            np.intp
        )
        for c, wl in set(zip(labels[near][hits].tolist(), wall_of.tolist(), strict=True)):
            if wl <= 0:
                continue
            wx, wy, ww, wh = (int(v) for v in wall_stats[wl, :4])
            x, y, w, h = (int(v) for v in stats[c, :4])
            if x >= wx and y >= wy and x + w <= wx + ww and y + h <= wy + wh:
                within[c] = True
    span = DOUBLE_MIN_SPAN_FRAC * long_edge
    keep = np.zeros(n, bool)
    for c in range(1, n):
        x, y, w, h = (int(v) for v in stats[c, :4])
        if not (within[c] or min(w, h) >= span):
            continue
        box = (slice(y, y + h), slice(x, x + w))
        keep[c] = not _is_grid(line_masks[0][box], line_masks[1][box])
    kept: np.ndarray = keep[labels].astype(np.uint8) * 255
    return kept


def _line_positions(lines: np.ndarray, axis: int) -> np.ndarray:
    """Centres of the lines (rows for ``axis`` 0, columns for 1) in a structure's box that run across at
    least ``GRID_LINE_SHARE`` of it."""
    share = (lines > 0).mean(axis=1 - axis) if lines.size else np.zeros(0)
    rows = np.flatnonzero(share >= GRID_LINE_SHARE)
    if rows.size == 0:
        return rows.astype(np.float64)
    groups = np.split(rows, np.flatnonzero(np.diff(rows) > 1) + 1)
    return np.array([g.mean() for g in groups], np.float64)


def _has_pitch(positions: np.ndarray) -> bool:
    """At least ``GRID_MIN_CELLS`` consecutive cells of near-equal pitch (within ``GRID_PITCH_TOL``)."""
    pitch = np.diff(positions)
    run = 1
    for a, b in itertools.pairwise(pitch.tolist()):
        run = run + 1 if abs(a - b) <= GRID_PITCH_TOL * max(a, b) else 1
        if run >= GRID_MIN_CELLS:
            return True
    return False


def _is_grid(h_lines: np.ndarray, v_lines: np.ndarray) -> bool:
    """A periodic grid of thin lines (a table, tiles): near-equal cell pitch in both directions over at
    least 3 cells (Task 16c review, Important 2)."""
    return _has_pitch(_line_positions(h_lines, 0)) and _has_pitch(_line_positions(v_lines, 1))


def sauvola_ink(gray: np.ndarray, window: int, k: float = SAUVOLA_K) -> np.ndarray:
    """Sauvola binarization of a uint8 image: 255 where `gray < m * (1 + k * (s / R - 1))`, else 0.

    Same result as `skimage.filters.threshold_sauvola`, but with float32 box filters instead of float64
    integral images, which need ~3x the memory (06 §5.2 budget): `m` and `s` are the window mean and
    standard deviation (reflect-101 borders), `R = 127.5`.
    """
    g = gray.astype(np.float32)
    size = (window, window)
    mean: np.ndarray = cv2.boxFilter(g, cv2.CV_32F, size, borderType=cv2.BORDER_REFLECT_101)
    np.multiply(g, g, out=g)
    sq_mean: np.ndarray = cv2.boxFilter(g, cv2.CV_32F, size, borderType=cv2.BORDER_REFLECT_101)
    del g
    var = sq_mean
    var -= mean * mean
    np.clip(var, 0.0, None, out=var)
    np.sqrt(var, out=var)
    var *= k / SAUVOLA_R
    var += 1.0 - k
    mean *= var  # threshold
    ink: np.ndarray = (gray < mean).astype(np.uint8) * 255
    return ink


def _remove_small_blobs(mask: np.ndarray, min_area: int) -> np.ndarray:
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    keep = np.zeros(n, bool)
    keep[1:] = stats[1:, cv2.CC_STAT_AREA] >= min_area
    out: np.ndarray = keep[labels].astype(np.uint8) * 255
    return out


def _classify(page: NormalizedPage, colorfulness: float, dark_frac: float) -> DrawingKind:
    if colorfulness > BROCHURE_COLORFULNESS and dark_frac >= BROCHURE_DARK_FRAC:
        return "colored_brochure"
    if page.is_photo:
        return "photo_of_drawing"
    if page.source_kind == "pdf_vector":
        return "cad_vector"
    return "architectural_line_drawing"


def preprocess(page: NormalizedPage, ctx: PipelineContext) -> Preprocessed:
    img = page.image
    h, w = img.shape[:2]
    long_edge = max(h, w)
    gray: np.ndarray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    if page.is_photo:
        gray = flatten_illumination(gray)
    ctx.check_deadline()

    ink = sauvola_ink(gray, sauvola_window(long_edge))
    ctx.check_deadline()

    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    sat, val = hsv[..., 1], hsv[..., 2]
    paper = val < PAPER_V_MAX
    colorfulness = float(sat[paper].mean()) if paper.any() else 0.0
    dark = dark_mask(hsv)

    dt = cv2.distanceTransform(ink, cv2.DIST_L2, 3)
    t_thin = _width_mode(dt, ink, page.page_image.resample_factor) if ink.any() else DEFAULT_T_THIN
    ctx.check_deadline()

    kind = _classify(page, colorfulness, float((dark > 0).mean()))
    k = thick_kernel(t_thin)
    kernel = np.ones((k, k), np.uint8)
    # Brochure walls are the dark fills; line drawings have no fill colour to lean on, so use the ink.
    base = dark if kind == "colored_brochure" else ink
    thick = cv2.morphologyEx(base, cv2.MORPH_OPEN, kernel)
    thick = _remove_small_blobs(thick, (MIN_BLOB_KERNELS * k) ** 2)

    bold = bold_strokes(ink, t_thin, BOLD_MIN_LEN_FRAC * long_edge)
    bold |= double_line_strips(ink, t_thin, long_edge, thick | bold)  # double-line walls count too (Task 16c)
    region = detect_plan_region(thick, ink, ctx, bold=bold)
    return Preprocessed(
        gray=gray,
        ink=ink,
        dark=dark,
        thick=thick,
        dt=dt,
        t_thin=t_thin,
        colorfulness=colorfulness,
        drawing_kind=kind,
        region=region,
    )
