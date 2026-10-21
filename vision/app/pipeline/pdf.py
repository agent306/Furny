"""PDF page rendering (pypdfium2) and vector extraction (pdfplumber), 06 §5.4, §7.2.

Page numbers are 1-based throughout. PDFium renders raster pages; pdfplumber reads the vector
drawing operators. Neither library is ever given more than one page of pixels at a time.
"""

import io
import itertools
import math
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any, Literal

import numpy as np
import pdfplumber
import pypdfium2 as pdfium
from pdfminer.pdfdocument import PDFPasswordIncorrect

from app.api.errors import VisionError
from app.pipeline import decode

MAX_RENDER_DPI = 300.0
MIN_RENDER_DPI = 72.0
MAX_RENDER_LONG_EDGE_PX = 6000.0
VECTOR_OBJECT_THRESHOLD = 200  # 06 §5.4: >= 200 lines + rects + curves -> pdf_vector
DARK_FILL_LUMINANCE = 0.35  # 06 §7.2: non-stroking colour darker than this -> filled polygon
_PDFIUM_ERR_PASSWORD = 4  # FPDF_ERR_PASSWORD
_BEZIER_STEPS = 8
_STRIP_PIXELS = 1 << 20  # pixels per strip when copying the render, bounds temporary buffers

# (short, long) in points; ISO A0-A4 are rounded mm, ANSI A-E are inches.
_PAPER_PT: tuple[tuple[float, float], ...] = tuple(
    (min(a, b) * 72.0 / 25.4, max(a, b) * 72.0 / 25.4)
    for a, b in ((841, 1189), (594, 841), (420, 594), (297, 420), (210, 297))
) + tuple(
    (min(a, b) * 72.0, max(a, b) * 72.0) for a, b in ((8.5, 11), (11, 17), (17, 22), (22, 34), (34, 44))
)
_PAPER_TOLERANCE = 0.02


@dataclass(frozen=True)
class RenderedPage:
    image: "np.ndarray"  # BGR uint8
    dpi: float
    width_pt: float
    height_pt: float


@dataclass(frozen=True)
class VSeg:
    p0: tuple[float, float]
    p1: tuple[float, float]
    width_px: float


@dataclass(frozen=True)
class VPolygon:
    points: list[tuple[float, float]]


@dataclass(frozen=True)
class VWord:
    text: str
    box: tuple[float, float, float, float]  # x0, y0, x1, y1 in px, y down
    angle: Literal[0, 90]


@dataclass(frozen=True)
class VectorPage:
    segments: list[VSeg]
    filled: list[VPolygon]
    words: list[VWord]
    object_count: int


def render_dpi(w_pt: float, h_pt: float) -> float:
    """`min(300, 6000 / long_edge_in)`, never below 72 (06 §7.2)."""
    long_edge_in = max(w_pt, h_pt) / 72.0
    if long_edge_in <= 0:
        return MAX_RENDER_DPI
    return max(min(MAX_RENDER_DPI, MAX_RENDER_LONG_EDGE_PX / long_edge_in), MIN_RENDER_DPI)


def is_standard_paper(w_pt: float, h_pt: float) -> bool:
    """ISO A0-A4 or ANSI A-E, +-2 % on each side, either orientation."""
    short, long = sorted((w_pt, h_pt))
    return any(
        abs(short - s) <= _PAPER_TOLERANCE * s and abs(long - lo) <= _PAPER_TOLERANCE * lo
        for s, lo in _PAPER_PT
    )


def _is_password_error(e: pdfium.PdfiumError) -> bool:
    return getattr(e, "err_code", None) == _PDFIUM_ERR_PASSWORD or "password" in str(e).lower()


def _corrupt() -> VisionError:
    return VisionError("corrupt_file", "The PDF could not be opened")


def _encrypted() -> VisionError:
    return VisionError("pdf_encrypted", "This PDF is password-protected")


def _invalid_page(page_number: int, count: int) -> VisionError:
    return VisionError(
        "invalid_page",
        f"Page {page_number} doesn't exist (the PDF has {count} pages)",
        details={"page": page_number, "pageCount": count},
    )


@contextmanager
def _open_pdfium(data: bytes) -> Iterator[pdfium.PdfDocument]:
    try:
        doc = pdfium.PdfDocument(data)
    except pdfium.PdfiumError as e:
        raise (_encrypted() if _is_password_error(e) else _corrupt()) from e
    try:
        yield doc
    finally:
        doc.close()


def _check_page(doc: pdfium.PdfDocument, page_number: int) -> None:
    if not 1 <= page_number <= len(doc):
        raise _invalid_page(page_number, len(doc))


def pdf_page_count(data: bytes) -> int:
    """Number of pages. Raises `pdf_encrypted` (password-protected) or `corrupt_file`."""
    with _open_pdfium(data) as doc:
        return len(doc)


def page_size_pt(data: bytes, page_number: int) -> tuple[float, float]:
    """`(width, height)` in points with the page's /Rotate applied."""
    with _open_pdfium(data) as doc:
        _check_page(doc, page_number)
        page = doc[page_number - 1]
        try:
            w, h = page.get_size()
        except pdfium.PdfiumError as e:
            raise _corrupt() from e
        finally:
            page.close()
        return float(w), float(h)


def render_pdf_page(data: bytes, page_number: int, dpi: float | None = None) -> RenderedPage:
    """Render one page to BGR uint8 at `dpi` (default: the 06 §7.2 rule).

    Pages that would exceed the decoded-pixel limit are rejected before any pixel is allocated.
    """
    with _open_pdfium(data) as doc:
        _check_page(doc, page_number)
        page = doc[page_number - 1]
        try:
            w_pt, h_pt = (float(v) for v in page.get_size())
            use_dpi = render_dpi(w_pt, h_pt) if dpi is None else dpi
            scale = use_dpi / 72.0
            pixels = math.ceil(w_pt * scale) * math.ceil(h_pt * scale)
            if pixels > decode.MAX_DECODE_PIXELS:
                raise VisionError(
                    "image_too_large",
                    f"Page renders to {pixels} pixels (max {decode.MAX_DECODE_PIXELS})",
                    details={"maxPixels": decode.MAX_DECODE_PIXELS},
                )
            bitmap = page.render(scale=scale)
            try:
                image = _bitmap_to_bgr(bitmap)
            finally:
                bitmap.close()
        except pdfium.PdfiumError as e:
            raise _corrupt() from e
        finally:
            page.close()
    return RenderedPage(image=image, dpi=use_dpi, width_pt=w_pt, height_pt=h_pt)


def _bitmap_to_bgr(bitmap: pdfium.PdfBitmap) -> "np.ndarray":
    """Copy PDFium's BGR/BGRA(x) buffer into one packed BGR array, strip by strip."""
    src = bitmap.to_numpy()
    height, width = src.shape[:2]
    out = np.empty((height, width, 3), dtype=np.uint8)
    rows = max(1, _STRIP_PIXELS // max(width, 1))
    for y0 in range(0, height, rows):
        out[y0 : y0 + rows] = src[y0 : y0 + rows, :, :3]
    return out


# --- vector extraction -------------------------------------------------------------------------


@contextmanager
def _open_plumber_page(data: bytes, page_number: int) -> Iterator[Any]:
    try:
        pdf = pdfplumber.open(io.BytesIO(data))
    except PDFPasswordIncorrect as e:
        raise _encrypted() from e
    except Exception as e:
        raise _corrupt() from e
    try:
        if not 1 <= page_number <= len(pdf.pages):
            raise _invalid_page(page_number, len(pdf.pages))
        page = pdf.pages[page_number - 1]
        try:
            yield page
        finally:
            page.close()
    except PDFPasswordIncorrect as e:
        raise _encrypted() from e
    except VisionError:
        raise
    except Exception as e:
        raise _corrupt() from e
    finally:
        pdf.close()


def _object_count(page: Any) -> int:
    return len(page.lines) + len(page.rects) + len(page.curves)


def classify_pdf_page(data: bytes, page_number: int) -> Literal["pdf_vector", "pdf_raster"]:
    """`pdf_vector` iff the page has >= 200 lines + rects + curves (06 §5.4)."""
    with _open_plumber_page(data, page_number) as page:
        return "pdf_vector" if _object_count(page) >= VECTOR_OBJECT_THRESHOLD else "pdf_raster"


def _luminance(color: Any) -> float | None:
    """Relative luminance 0..1 of a pdfminer colour (gray, RGB or CMYK); None when unknown."""
    if isinstance(color, (int, float)):
        return float(color)
    if not isinstance(color, (tuple, list)) or not all(isinstance(c, (int, float)) for c in color):
        return None
    if len(color) == 1:
        return float(color[0])
    if len(color) == 3:
        r, g, b = (float(c) for c in color)
        return 0.2126 * r + 0.7152 * g + 0.0722 * b
    if len(color) == 4:
        c, m, y, k = (float(v) for v in color)
        return 0.2126 * (1 - c) * (1 - k) + 0.7152 * (1 - m) * (1 - k) + 0.0722 * (1 - y) * (1 - k)
    return None


def _is_dark_fill(obj: dict[str, Any]) -> bool:
    if not obj.get("fill"):
        return False
    lum = _luminance(obj.get("non_stroking_color"))
    return lum is not None and lum < DARK_FILL_LUMINANCE


def _subpaths(obj: dict[str, Any]) -> list[tuple[list[tuple[float, float]], bool]]:
    """Polylines `(points, closed)` of an object's path, with Beziers flattened."""
    path = obj.get("path")
    if not path:
        pts = [(float(x), float(y)) for x, y in obj["pts"]]
        return [(pts, False)]
    result: list[tuple[list[tuple[float, float]], bool]] = []
    cur: list[tuple[float, float]] = []
    for cmd in path:
        op = cmd[0]
        if op == "m":
            if len(cur) > 1:
                result.append((cur, False))
            cur = [(float(cmd[1][0]), float(cmd[1][1]))]
        elif op == "l":
            cur.append((float(cmd[1][0]), float(cmd[1][1])))
        elif op == "c" and cur:
            p0 = cur[-1]
            p1, p2, p3 = ((float(x), float(y)) for x, y in cmd[1:4])
            for i in range(1, _BEZIER_STEPS + 1):
                t = i / _BEZIER_STEPS
                u = 1 - t
                cur.append(
                    tuple(  # type: ignore[arg-type]
                        u**3 * a + 3 * u * u * t * b + 3 * u * t * t * c + t**3 * d
                        for a, b, c, d in zip(p0, p1, p2, p3, strict=True)
                    )
                )
        elif op == "h" and len(cur) > 1:
            result.append((cur, True))
            cur = []
    if len(cur) > 1:
        result.append((cur, False))
    return result


def _add_object(
    obj: dict[str, Any], dark_fill: bool, k: float, segments: list[VSeg], filled: list[VPolygon]
) -> None:
    """Append an object's edges (every rect/curve edge, stroked or not) and its dark fill."""
    width_px = float(obj.get("linewidth") or 0.0) * k
    for pts, closed in _subpaths(obj):
        scaled = [(x * k, y * k) for x, y in pts]
        ring = [*scaled, scaled[0]] if closed and scaled[0] != scaled[-1] else scaled
        segments.extend(VSeg(a, b, width_px) for a, b in itertools.pairwise(ring) if a != b)
        if dark_fill and len(scaled) >= 3:
            filled.append(VPolygon(points=scaled[:-1] if scaled[0] == scaled[-1] else scaled))


def _is_char(obj: dict[str, Any]) -> bool:
    return bool(obj["object_type"] == "char")


def _extract_words(page: Any, k: float) -> list[VWord]:
    """Words in px. Horizontal text reads normally; each direction of rotated text is its own pass.

    Text rotated counter-clockwise (the CAD norm for vertical dimensions) is read bottom-to-top and
    clockwise text top-to-bottom, so `extract_words` gets the matching direction for each group.
    Spaces stay inside a word (`keep_blank_chars`) so notes such as `SCALE 1:100` arrive whole.
    """
    groups: list[tuple[Any, Literal[0, 90], dict[str, str]]] = [
        (lambda o: not _is_char(o) or o["upright"], 0, {}),
        (
            lambda o: not _is_char(o) or (not o["upright"] and o["matrix"][1] > 0),
            90,
            {"line_dir_rotated": "ltr", "char_dir_rotated": "btt"},
        ),
        (
            lambda o: not _is_char(o) or (not o["upright"] and o["matrix"][1] <= 0),
            90,
            {"line_dir_rotated": "ltr", "char_dir_rotated": "ttb"},
        ),
    ]
    if all(c["upright"] for c in page.chars):
        groups = groups[:1]  # the common case: no rotated text, so no filtered copies of the page
    words: list[VWord] = []
    for keep, angle, directions in groups:
        sub = page.filter(keep)
        # `size` splits horizontal words at font-size changes; for rotated glyphs pdfminer reports a
        # per-glyph size, which would shatter every word into single letters.
        extra = ["size"] if angle == 0 else []
        for w in sub.extract_words(
            keep_blank_chars=True, use_text_flow=False, extra_attrs=extra, **directions
        ):
            box = (w["x0"] * k, w["top"] * k, w["x1"] * k, w["bottom"] * k)
            words.append(VWord(text=w["text"], box=box, angle=angle))
    return words


def extract_vector_page(data: bytes, page_number: int, dpi: float) -> VectorPage:
    """Segments, dark filled polygons and words of one page, in pixels at `dpi` (06 §7.2)."""
    k = dpi / 72.0
    segments: list[VSeg] = []
    filled: list[VPolygon] = []
    with _open_plumber_page(data, page_number) as page:
        for kind, objs in (("line", page.lines), ("rect", page.rects), ("curve", page.curves)):
            for obj in objs:
                _add_object(obj, kind != "line" and _is_dark_fill(obj), k, segments, filled)
        words = _extract_words(page, k)
        return VectorPage(segments=segments, filled=filled, words=words, object_count=_object_count(page))
