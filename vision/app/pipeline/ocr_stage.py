"""OCR stage (06 §7.7): tiled two-pass reading, vector-word bypass, text tokens and the text mask."""

import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

import cv2
import numpy as np

from app.ocr.engine import OcrLike
from app.ocr.tiling import map_rotated_cw, merge_passes, quad_bbox, read_tiled
from app.pipeline.binarize import Preprocessed
from app.pipeline.context import PipelineContext
from app.pipeline.normalize import NormalizedPage
from app.pipeline.pdf import VectorPage
from app.pipeline.region import annotation_region
from app.pipeline.textparse import parse_token
from app.schemas.candidates import TextToken
from app.utils.geometry import Rect

__all__ = ["OcrLike", "OcrResult", "run_ocr", "split_combined_label", "tokens_from_vector_words"]

MIN_VECTOR_WORDS = 10  # at least this many pdfplumber words: no OCR (06 §7.7)
VERTICAL_ASPECT = 1.5  # a 2-character box this much taller than wide holds vertical text
VERTICAL_ASPECT_LONG = 1.25  # ... for 3+ characters (narrow digits such as "111" stay below 1.5)
MASK_DILATE_PX = 2
_WORD = re.compile(r"\S+")


@dataclass(frozen=True, eq=False)
class OcrResult:
    tokens: list[TextToken]
    text_mask: np.ndarray  # uint8 0/255, token boxes dilated by 2 px
    ink_notext: np.ndarray  # uint8 0/255, `ink` with the text mask removed


@dataclass(frozen=True, eq=False)
class Reading:
    """A text line in page pixels before splitting: `quad` starts at the text's start-top corner."""

    quad: np.ndarray
    text: str
    score: float
    angle: Literal[0, 90]


def _runs_along(quad: np.ndarray, angle: Literal[0, 90]) -> bool:
    dx, dy = quad[1] - quad[0]
    return bool(abs(dx) >= abs(dy) if angle == 0 else abs(dy) > abs(dx))


def _canonical_quad(box: tuple[float, float, float, float], angle: Literal[0, 90]) -> np.ndarray:
    x0, y0, x1, y1 = box
    corners = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    if angle == 90:  # vertical text reads bottom-to-top: start at the lower left
        corners = [(x0, y1), (x0, y0), (x1, y0), (x1, y1)]
    return np.array(corners, np.float64)


def orient(reading: Reading) -> Reading:
    """Settle the text angle from the box shape; the pass only decides when the shape is ambiguous.

    RapidOCR reads tall boxes as rotated text in both passes (and reads horizontal text in the rotated
    pass), so the pass alone does not say how the text runs: a box at least 1.5x taller than wide (1.25x
    with 3+ characters) is vertical (90), as wide as that is horizontal (0), anything else (and a single
    character) keeps the pass's angle. Quads that do not start along the reading direction are replaced
    by the box corners.
    """
    x0, y0, x1, y1 = quad_bbox(reading.quad)
    w, h = x1 - x0, y1 - y0
    angle = reading.angle
    n_chars = len(reading.text.strip())
    if n_chars >= 2:
        aspect = VERTICAL_ASPECT_LONG if n_chars >= 3 else VERTICAL_ASPECT
        if h >= aspect * w:
            angle = 90
        elif w >= aspect * h:
            angle = 0
    quad = reading.quad
    if not _runs_along(quad, angle):
        quad = _canonical_quad((x0, y0, x1, y1), angle)
    return Reading(quad, reading.text, reading.score, angle)


def split_combined_label(text: str) -> tuple[str, str, int, int] | None:
    """Split `BEDROOM 10'0"x11'0"` into the name and the size pair.

    Returns `(name, size, name_end, size_start)` (character offsets into the stripped text) when a
    word boundary leaves a name containing a letter in front of a `size_pair`; the earliest such
    boundary wins. Plain labels return `None`.
    """
    text = text.strip()
    spans = [m.span() for m in _WORD.finditer(text)]
    for i in range(1, len(spans)):
        name, size = text[: spans[i - 1][1]], text[spans[i][0] :]
        if any(c.isalpha() for c in name) and parse_token(size).kind == "size_pair":
            return name, size, spans[i - 1][1], spans[i][0]
    return None


def _lerp(quad: np.ndarray, t0: float, t1: float) -> np.ndarray:
    """Sub-quad between fractions `t0` and `t1` of the reading direction (edges q0->q1 and q3->q2)."""
    a, b, c, d = quad
    return np.array([a + (b - a) * t0, a + (b - a) * t1, d + (c - d) * t1, d + (c - d) * t0])


def _split(reading: Reading) -> list[Reading]:
    text = reading.text.strip()
    parts = split_combined_label(text)
    if parts is None:
        return [Reading(reading.quad, text, reading.score, reading.angle)]
    name, size, name_end, size_start = parts
    n = len(text)
    return [
        Reading(_lerp(reading.quad, 0.0, name_end / n), name, reading.score, reading.angle),
        Reading(_lerp(reading.quad, size_start / n, 1.0), size, reading.score, reading.angle),
    ]


def _sorted_tokens(readings: list[Reading]) -> list[TextToken]:
    """Split combined labels, parse, sort top-to-bottom then left-to-right and number `T1..Tn`."""
    pieces = [piece for r in readings if r.text.strip() for piece in _split(r)]
    boxed = [(quad_bbox(p.quad), p) for p in pieces]
    boxed.sort(key=lambda bp: (round(bp[0][1]), round(bp[0][0])))
    tokens: list[TextToken] = []
    for n, (box, piece) in enumerate(boxed, 1):
        quad = tuple((float(x), float(y)) for x, y in piece.quad)
        tokens.append(
            TextToken(
                id=f"T{n}",
                text=piece.text,
                quad=(quad[0], quad[1], quad[2], quad[3]),
                box=box,
                angle=piece.angle,
                score=piece.score,
                height_px=box[3] - box[1] if piece.angle == 0 else box[2] - box[0],
                parsed=parse_token(piece.text),
            )
        )
    return tokens


def _vector_readings(vector: VectorPage, transform: np.ndarray) -> list[Reading]:
    readings: list[Reading] = []
    for word in vector.words:
        x0, y0, x1, y1 = word.box
        if word.angle == 0:
            corners = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
        else:  # vertical text is taken to read bottom-to-top (the CAD norm): start at the lower left
            corners = [(x0, y1), (x0, y0), (x1, y0), (x1, y1)]
        pts = np.hstack([np.array(corners, np.float64), np.ones((4, 1))]) @ transform.T
        readings.append(Reading(pts[:, :2] / pts[:, 2:3], word.text, 1.0, word.angle))
    return readings


def _centre_in(region: Rect, quad: np.ndarray) -> bool:
    x0, y0, x1, y1 = quad_bbox(quad)
    return region.contains(((x0 + x1) / 2, (y0 + y1) / 2))


def tokens_from_vector_words(
    vector: VectorPage, transform: np.ndarray, region: Rect | None = None
) -> list[TextToken]:
    """Text tokens (score 1.0) from pdfplumber words, mapped through `transform` (source -> normalized px).

    With a `region`, only words centred inside it are kept.
    """
    readings = _vector_readings(vector, transform)
    if region is not None:
        readings = [r for r in readings if _centre_in(region, r.quad)]
    return _sorted_tokens(readings)


def _read_region(
    ocr: OcrLike, crop: np.ndarray, origin: tuple[int, int], ctx: PipelineContext
) -> list[Reading]:
    """Pass A on the crop and pass B on the crop rotated 90 degrees clockwise, merged, in page pixels."""
    offset = np.array(origin, np.float64)
    pass_a = [Reading(b.quad + offset, b.text, b.score, 0) for b in read_tiled(ocr, crop, ctx.check_deadline)]
    crop_h = crop.shape[0]
    rotated = cv2.rotate(crop, cv2.ROTATE_90_CLOCKWISE)
    pass_b = [
        Reading(
            np.array([map_rotated_cw((u, v), crop_h) for u, v in b.quad], np.float64) + offset,
            b.text,
            b.score,
            90,
        )
        for b in read_tiled(ocr, rotated, ctx.check_deadline)
    ]
    return [orient(r) for r in merge_passes(pass_a, pass_b)]


def _text_mask(shape: tuple[int, int], tokens: list[TextToken]) -> np.ndarray:
    h, w = shape
    mask = np.zeros((h, w), np.uint8)
    for t in tokens:
        x0, y0, x1, y1 = t.box
        mask[
            max(0, int(np.floor(y0)) - MASK_DILATE_PX) : min(h, int(np.ceil(y1)) + MASK_DILATE_PX + 1),
            max(0, int(np.floor(x0)) - MASK_DILATE_PX) : min(w, int(np.ceil(x1)) + MASK_DILATE_PX + 1),
        ] = 255
    return mask


def in_region(tokens: Sequence[TextToken], region: Rect) -> list[TextToken]:
    """The tokens centred inside `region` (ids unchanged): the plan region's text for the stages that work
    on the plan region only (rooms, labeling)."""
    return [t for t in tokens if region.contains(((t.box[0] + t.box[2]) / 2, (t.box[1] + t.box[3]) / 2))]


def run_ocr(page: NormalizedPage, pre: Preprocessed, ocr: OcrLike, ctx: PipelineContext) -> OcrResult:
    """Text tokens of the annotation region, the text mask and `ink_notext` (06 §7.7).

    The tokens cover the annotation region (`region.annotation_region`: the plan region grown by 0.15 L,
    Task 14b ruling B1), where the outer dimension chains' labels lie; ids `T1..Tn` run over all of them.
    Stages working on the plan region select theirs with `in_region(tokens, pre.region)`.
    """
    h, w = pre.ink.shape[:2]
    region = annotation_region(pre.region, w, h)
    vector = page.vector
    if page.source_kind == "pdf_vector" and vector is not None and len(vector.words) >= MIN_VECTOR_WORDS:
        tokens = tokens_from_vector_words(vector, page.transform, region)
    elif region.w > 0 and region.h > 0:
        crop = page.image[region.y : region.y + region.h, region.x : region.x + region.w]
        tokens = _sorted_tokens(_read_region(ocr, crop, (region.x, region.y), ctx))
    else:
        tokens = []
    mask = _text_mask((h, w), tokens)
    ink_notext = pre.ink.copy()
    ink_notext[mask > 0] = 0
    return OcrResult(tokens=tokens, text_mask=mask, ink_notext=ink_notext)
