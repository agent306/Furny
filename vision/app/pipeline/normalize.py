"""Rectify, deskew and resample a decoded page into the `NormalizedPage` (06 §7.3-§7.5)."""

import math
from dataclasses import dataclass

import cv2
import numpy as np

from app.pipeline import decode, rectify
from app.pipeline.context import PipelineContext
from app.pipeline.pdf import VectorPage
from app.schemas.meta import PageImage, SourceKind
from app.utils.geometry import detect_line_segments, seg_angle_deg

MIN_LONG_EDGE = 2000  # smaller sources are upscaled to this
LOW_RES_LONG_EDGE = 1000  # ... with a warning below this
MAX_LONG_EDGE = 6000  # larger sources are downscaled to this
DESKEW_MIN_DEG, DESKEW_MAX_DEG = 0.2, 10.0

SHEET_CONTRAST_MIN = 20.0  # unhinted uploads: grey-level gap between sheet and surroundings
_SKEW_MIN_SEG_FRAC = 0.03
_SKEW_BIN_DEG = 0.1
_SKEW_RANGE_DEG = 10.0
_SKEW_SMOOTH_BINS = 5
_SKEW_WORK_EDGE = 2000  # estimation runs on a copy at most this large; angles do not depend on scale
_USER_CORNERS_MIN_AREA_FRAC = 0.01
_WHITE = (255, 255, 255)
_PHOTO_DETECT_KINDS = frozenset({"raster", "heic"})
_NO_DESKEW_KINDS = frozenset({"pdf_vector", "dxf"})


@dataclass(frozen=True, eq=False)
class NormalizedPage:
    image: np.ndarray  # BGR uint8
    page_image: PageImage
    transform: np.ndarray  # 3x3, source px -> normalized px (pixel-centre convention)
    source_kind: SourceKind
    is_photo: bool
    vector: VectorPage | None = None  # filled in by the caller for pdf_vector pages
    dpi: float | None = None
    page_size_pt: tuple[float, float] | None = None


def _scale_matrix(sx: float, sy: float) -> np.ndarray:
    """Map of `cv2.resize` by (sx, sy): pixel centres stay centres."""
    return np.array([[sx, 0.0, 0.5 * sx - 0.5], [0.0, sy, 0.5 * sy - 0.5], [0.0, 0.0, 1.0]])


def _fold_deg(angle: float) -> float:
    """Fold a line angle in [0, 180) into (-45, 45]."""
    a = angle % 90.0
    return a - 90.0 if a > 45.0 else a


def estimate_skew_deg(gray: np.ndarray) -> float:
    """Dominant near-axis line angle in degrees (y down, clockwise positive); 0 when there is no evidence."""
    long_side = max(gray.shape[:2])
    segs = detect_line_segments(gray)
    if len(segs) == 0:
        return 0.0
    lengths = np.hypot(segs[:, 2] - segs[:, 0], segs[:, 3] - segs[:, 1])
    keep = lengths >= _SKEW_MIN_SEG_FRAC * long_side
    n_bins = round(2 * _SKEW_RANGE_DEG / _SKEW_BIN_DEG)
    hist = np.zeros(n_bins)
    for (x0, y0, x1, y1), length in zip(segs[keep], lengths[keep], strict=True):
        a = _fold_deg(seg_angle_deg(float(x0), float(y0), float(x1), float(y1)))
        if -_SKEW_RANGE_DEG <= a < _SKEW_RANGE_DEG:
            hist[int((a + _SKEW_RANGE_DEG) / _SKEW_BIN_DEG)] += float(length)
    if not hist.any():
        return 0.0
    smooth = np.convolve(hist, np.ones(_SKEW_SMOOTH_BINS) / _SKEW_SMOOTH_BINS, mode="same")
    peak = int(np.argmax(smooth))
    return float(-_SKEW_RANGE_DEG + (peak + 0.5) * _SKEW_BIN_DEG)


def _to_gray(img: np.ndarray) -> np.ndarray:
    gray: np.ndarray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img
    return gray


def _skew_of(img: np.ndarray) -> float:
    gray = _to_gray(img)
    long_side = max(gray.shape[:2])
    if long_side > _SKEW_WORK_EDGE:
        f = _SKEW_WORK_EDGE / long_side
        h, w = gray.shape[:2]
        gray = cv2.resize(gray, (round(w * f), round(h * f)), interpolation=cv2.INTER_AREA)
    return estimate_skew_deg(gray)


def _user_quad(corners: list[tuple[float, float]], shape: tuple[int, ...]) -> np.ndarray | None:
    """User corners (0..1 of the preview frame, any order) in pixels; None if they are not a sane quad."""
    if len(corners) != 4:
        return None
    h, w = shape[:2]
    quad = np.array(
        [(min(1.0, max(0.0, x)) * w, min(1.0, max(0.0, y)) * h) for x, y in corners], dtype=np.float32
    )
    # The order is normalised, so a reversed or rotated list cannot produce a mirrored warp.
    ordered = rectify.order_corners(quad)
    if ordered is None or not cv2.isContourConvex(ordered.reshape(4, 1, 2)):
        return None
    if cv2.contourArea(ordered.reshape(4, 1, 2)) < _USER_CORNERS_MIN_AREA_FRAC * w * h:
        return None
    return ordered


def _rectify(
    img: np.ndarray,
    *,
    source_kind: SourceKind,
    is_photo: bool,
    corners: list[tuple[float, float]] | None,
    ctx: PipelineContext,
    max_pixels: int | None,
) -> tuple[np.ndarray, np.ndarray | None]:
    """Return `(image, matrix)`; `matrix` is the 3x3 warp, None when nothing was warped."""
    quad: np.ndarray | None = None
    if corners is not None:
        quad = _user_quad(corners, img.shape)  # user corners always win over detection
        if quad is None:
            ctx.warn("page_corners_not_found")
            return img, None
    elif is_photo or source_kind in _PHOTO_DETECT_KINDS:
        detected = rectify.detect_page_quad(img)
        if (
            detected is not None
            and not rectify.quad_is_axis_aligned(detected, img.shape)
            and (is_photo or rectify.sheet_contrast(img, detected) >= SHEET_CONTRAST_MIN)
        ):
            quad = detected
        elif is_photo:
            # No sheet outline, or one that already fills the frame: nothing to correct.
            ctx.warn("page_corners_not_found")
    if quad is None:
        return img, None
    warped, matrix = rectify.warp_quad_with_matrix(img, quad, max_pixels)
    ctx.warn("photo_rectified")
    return warped, matrix


def _deskew(img: np.ndarray, skew_deg: float) -> tuple[np.ndarray, np.ndarray]:
    """Rotate the content by `-skew_deg` (clockwise positive) on an expanded white canvas."""
    h, w = img.shape[:2]
    cx, cy = (w - 1) / 2, (h - 1) / 2
    # OpenCV angles are counter-clockwise on screen; removing a clockwise skew is a counter-clockwise turn.
    m = cv2.getRotationMatrix2D((cx, cy), skew_deg, 1.0)
    cos, sin = abs(m[0, 0]), abs(m[0, 1])
    out_w, out_h = math.ceil(h * sin + w * cos), math.ceil(h * cos + w * sin)
    m[0, 2] += (out_w - 1) / 2 - cx
    m[1, 2] += (out_h - 1) / 2 - cy
    rotated: np.ndarray = cv2.warpAffine(
        img, m, (out_w, out_h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_CONSTANT, borderValue=_WHITE
    )
    return rotated, np.vstack([m, [0.0, 0.0, 1.0]])


def _target_long_edge(long_side: int) -> int:
    if long_side < MIN_LONG_EDGE:
        return MIN_LONG_EDGE
    return min(long_side, MAX_LONG_EDGE)


def normalize(
    img: np.ndarray,
    *,
    source_kind: SourceKind,
    is_photo: bool,
    corners: list[tuple[float, float]] | None,
    source_page: int,
    dpi: float | None,
    ctx: PipelineContext,
    max_work_pixels: int | None = None,
) -> NormalizedPage:
    """Rectify (user corners, photo, or a tilted sheet) -> deskew -> resample to 2000..6000 px long edge.

    `corners` are TL, TR, BR, BL as fractions (0..1) of the frame. PDF renders are pixel-guarded here
    (`apply_pixel_guards`), and that downscale is part of `transform`, so vector coordinates stay valid
    in the render frame the caller passes in. Raster callers apply the guards when decoding.
    """
    transform = np.eye(3)
    if source_kind in ("pdf_vector", "pdf_raster"):
        guarded = decode.apply_pixel_guards(img, ctx, max_work_pixels)
        if guarded is not img:
            transform = _scale_matrix(guarded.shape[1] / img.shape[1], guarded.shape[0] / img.shape[0])
            img = guarded
    ctx.check_deadline()

    img, warp = _rectify(
        img, source_kind=source_kind, is_photo=is_photo, corners=corners, ctx=ctx, max_pixels=max_work_pixels
    )
    rectified = warp is not None
    if warp is not None:
        transform = warp @ transform
    ctx.check_deadline()

    deskew_deg = 0.0
    if source_kind not in _NO_DESKEW_KINDS:
        skew = _skew_of(img)
        if DESKEW_MIN_DEG <= abs(skew) <= DESKEW_MAX_DEG:
            img, rot = _deskew(img, skew)
            transform = rot @ transform
            deskew_deg = round(-skew, 2)
            ctx.warn("deskewed", {"degrees": round(deskew_deg, 1)})
    ctx.check_deadline()

    h, w = img.shape[:2]
    long_side = max(h, w)
    target = _target_long_edge(long_side)
    factor = target / long_side
    if long_side < LOW_RES_LONG_EDGE:
        ctx.warn("low_resolution", {"longEdge": long_side})
    if target != long_side:
        new_w, new_h = max(1, round(w * factor)), max(1, round(h * factor))
        interp = cv2.INTER_CUBIC if factor > 1 else cv2.INTER_AREA
        img = cv2.resize(img, (new_w, new_h), interpolation=interp)
        transform = _scale_matrix(new_w / w, new_h / h) @ transform

    out_h, out_w = img.shape[:2]
    return NormalizedPage(
        image=img,
        page_image=PageImage(
            width=out_w,
            height=out_h,
            source_page=source_page,
            dpi=dpi,
            rectified=rectified,
            deskew_deg=deskew_deg,
            resample_factor=factor,
        ),
        transform=transform,
        source_kind=source_kind,
        is_photo=is_photo or rectified,
        dpi=dpi,
    )
