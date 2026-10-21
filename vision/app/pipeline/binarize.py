"""Binarization, colour analysis, stroke width, style and thick-ink mask (06 §7.6)."""

from dataclasses import dataclass

import cv2
import numpy as np
from skimage.filters import threshold_sauvola
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
DARK_V_MAX, DARK_S_MAX = 90, 60  # solid-wall candidates (0..255 scale)
BROCHURE_COLORFULNESS = 25.0
BROCHURE_DARK_FRAC = 0.005
THIN_MAX_PX = 6.0  # stroke widths above this are walls, not line work
WIDTH_BIN_PX = 0.5
DEFAULT_T_THIN = 2.0
THICK_K_MIN, THICK_K_MAX = 3, 15
THICK_K_FACTOR = 2.2
MIN_BLOB_KERNELS = 3  # components smaller than (3k)^2 px are dropped from `thick`


@dataclass(frozen=True, eq=False)
class Preprocessed:
    gray: np.ndarray  # uint8, illumination-flattened for photos (this is what was thresholded)
    ink: np.ndarray  # uint8 0/255
    dark: np.ndarray  # uint8 0/255, (V < 90) & (S < 60)
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


def stroke_width_mode(ink: np.ndarray) -> float:
    """Most common stroke width <= 6 px (2 x distance transform on the skeleton), bins of 0.5 px.

    Returns the centre of the winning bin, or 2.0 when no thin stroke exists.
    """
    if not ink.any():
        return DEFAULT_T_THIN
    dt = cv2.distanceTransform(ink, cv2.DIST_L2, 3)
    return _width_mode(dt, ink)


def _width_mode(dt: np.ndarray, ink: np.ndarray) -> float:
    widths = 2.0 * dt[skeletonize(ink > 0)]  # type: ignore[no-untyped-call]
    widths = widths[(widths > 0) & (widths <= THIN_MAX_PX)]
    if widths.size == 0:
        return DEFAULT_T_THIN
    edges = np.arange(0.0, THIN_MAX_PX + WIDTH_BIN_PX, WIDTH_BIN_PX)
    hist, _ = np.histogram(widths, bins=edges)
    return float(edges[int(np.argmax(hist))] + WIDTH_BIN_PX / 2)


def _remove_small_blobs(mask: np.ndarray, min_area: int) -> np.ndarray:
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    keep = np.zeros(n, bool)
    keep[1:] = stats[1:, cv2.CC_STAT_AREA] >= min_area
    out: np.ndarray = (keep[labels] * 255).astype(np.uint8)
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

    thresh = threshold_sauvola(  # type: ignore[no-untyped-call]
        gray, window_size=sauvola_window(long_edge), k=SAUVOLA_K
    )
    ink = np.where(gray < thresh, 255, 0).astype(np.uint8)
    ctx.check_deadline()

    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    sat, val = hsv[..., 1], hsv[..., 2]
    paper = val < PAPER_V_MAX
    colorfulness = float(sat[paper].mean()) if paper.any() else 0.0
    dark = np.where((val < DARK_V_MAX) & (sat < DARK_S_MAX), 255, 0).astype(np.uint8)

    dt = cv2.distanceTransform(ink, cv2.DIST_L2, 3)
    t_thin = _width_mode(dt, ink) if ink.any() else DEFAULT_T_THIN
    ctx.check_deadline()

    kind = _classify(page, colorfulness, float((dark > 0).mean()))
    k = thick_kernel(t_thin)
    kernel = np.ones((k, k), np.uint8)
    # Brochure walls are the dark fills; line drawings have no fill colour to lean on, so use the ink.
    base = dark if kind == "colored_brochure" else ink
    thick = cv2.morphologyEx(base, cv2.MORPH_OPEN, kernel)
    thick = _remove_small_blobs(thick, (MIN_BLOB_KERNELS * k) ** 2)

    region = detect_plan_region(thick, ink, ctx)
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
