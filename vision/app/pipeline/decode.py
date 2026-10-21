"""Magic-byte sniffing, raster/HEIC decode and decoded-pixel guards (06 §2.1, §2.2, §7.2)."""

import io
import re
import struct
import warnings
from dataclasses import dataclass
from typing import Literal

import cv2
import numpy as np
import pi_heif
from PIL import Image

from app.api.errors import VisionError
from app.pipeline.context import PipelineContext

pi_heif.register_heif_opener()

SniffedKind = Literal["raster", "heic", "pdf", "dxf"]

# Module-level so tests can monkeypatch them. The service passes `Settings.vision_max_pixels` to
# `apply_pixel_guards` explicitly (18 §4); the constants are only the defaults.
MAX_DECODE_PIXELS = 120_000_000
MAX_WORK_PIXELS = 40_000_000
MIN_SHORT_EDGE = 300

Image.MAX_IMAGE_PIXELS = MAX_DECODE_PIXELS

_PDF_WINDOW = 1024
_DXF_WINDOW = 1024
_HEIC_BRANDS = frozenset(
    [b"heic", b"heix", b"hevc", b"heim", b"heis", b"mif1", b"msf1"],
)
_DXF_ASCII = re.compile(rb"\s*0[ \t]*\r?\n[ \t]*SECTION[ \t]*(?:\r?\n|$)")
_DXF_BINARY = b"AutoCAD Binary DXF\r\n\x1a\x00"
_EXIF_MAKE, _EXIF_MODEL, _EXIF_ORIENTATION = 0x010F, 0x0110, 0x0112

_NON_RASTER_MIME: dict[str, str] = {
    "heic": "image/heic",
    "pdf": "application/pdf",
    "dxf": "image/vnd.dxf",
}

# Pixels per strip when converting to BGR: bounds the temporary buffers (06 §5.2 memory budget).
_STRIP_PIXELS = 1 << 20
# EXIF orientation value -> Pillow transpose, as in `ImageOps.exif_transpose`.
_ORIENTATION_TRANSPOSE = {
    2: Image.Transpose.FLIP_LEFT_RIGHT,
    3: Image.Transpose.ROTATE_180,
    4: Image.Transpose.FLIP_TOP_BOTTOM,
    5: Image.Transpose.TRANSPOSE,
    6: Image.Transpose.ROTATE_270,
    7: Image.Transpose.TRANSVERSE,
    8: Image.Transpose.ROTATE_90,
}


@dataclass(frozen=True)
class DecodedImage:
    image: "np.ndarray"  # BGR uint8, EXIF orientation applied, alpha composited on white
    exif_make_or_model: bool


def _sniff(data: bytes, filename: str) -> tuple[SniffedKind, str]:
    """Return `(kind, canonical MIME)`; the MIME keeps the raster sub-type (06 §4.5)."""
    if data.startswith(b"AC10") or filename.lower().endswith(".dwg"):
        raise VisionError(
            "dwg_not_supported", "DWG files can't be opened. Save as DXF or print to PDF and upload that."
        )
    if data.startswith(b"\xff\xd8\xff"):
        return "raster", "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "raster", "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "raster", "image/webp"
    if data[4:8] == b"ftyp" and data[8:12] in _HEIC_BRANDS:
        return "heic", _NON_RASTER_MIME["heic"]
    if b"%PDF-" in data[:_PDF_WINDOW]:
        return "pdf", _NON_RASTER_MIME["pdf"]
    if data.startswith(_DXF_BINARY) or _DXF_ASCII.match(data[:_DXF_WINDOW]):
        return "dxf", _NON_RASTER_MIME["dxf"]
    raise VisionError(
        "unsupported_type",
        "This file type isn't supported. Please upload a JPG, PNG, WebP, HEIC, PDF or DXF.",
    )


def sniff_kind(data: bytes, filename: str) -> SniffedKind:
    """Classify by magic bytes (the filename only matters for `.dwg`, 06 §2.1)."""
    return _sniff(data, filename)[0]


def sniff_mime(data: bytes, filename: str) -> str:
    """Sniffed canonical MIME (06 §4.5), e.g. image/jpeg, image/heic, application/pdf, image/vnd.dxf."""
    return _sniff(data, filename)[1]


def canonical_mime(kind: SniffedKind, data: bytes = b"") -> str:
    """Canonical MIME of a kind. `raster` has three sub-types, so it needs the bytes (or use `sniff_mime`)."""
    if kind == "raster":
        return _sniff(data, "")[1]
    return _NON_RASTER_MIME[kind]


def _has_alpha(im: Image.Image) -> bool:
    return "A" in im.getbands() or "transparency" in im.info


def _to_rgb(im: Image.Image) -> Image.Image:
    """Convert one (strip of an) image to RGB, compositing any alpha on white."""
    if _has_alpha(im):
        rgba = im if im.mode == "RGBA" else im.convert("RGBA")
        rgb = Image.new("RGB", rgba.size, (255, 255, 255))
        rgb.paste(rgba, mask=rgba.getchannel("A"))
        return rgb
    if im.mode == "RGB":
        return im
    if im.mode.startswith("I;16") or im.mode == "I":
        # Pillow clips 16-bit to 8-bit; scale instead so scans keep their tonal range.
        arr = np.asarray(im).astype(np.float64)
        return Image.fromarray((arr / 65535.0 * 255.0).round().astype(np.uint8), mode="L").convert("RGB")
    return im.convert("RGB")


def _exif_make_or_model(exif: Image.Exif) -> bool:
    return any(isinstance(v := exif.get(tag), str) and v.strip() for tag in (_EXIF_MAKE, _EXIF_MODEL))


def _to_bgr(im: Image.Image) -> "np.ndarray":
    """Fill one BGR buffer strip by strip, so no full-size intermediate copies are alive."""
    width, height = im.size
    out = np.empty((height, width, 3), dtype=np.uint8)
    rows = max(1, _STRIP_PIXELS // max(width, 1))
    for y0 in range(0, height, rows):
        y1 = min(height, y0 + rows)
        out[y0:y1] = np.asarray(_to_rgb(im.crop((0, y0, width, y1))))[:, :, ::-1]
    return out


def decode_raster(data: bytes) -> DecodedImage:
    """JPEG/PNG/WebP/HEIC bytes -> BGR uint8. Rejects decompression bombs before decoding pixels."""
    try:
        with warnings.catch_warnings():
            # Between 1x and 2x the Pillow limit it only warns; our explicit check below decides.
            warnings.simplefilter("ignore", Image.DecompressionBombWarning)
            im: Image.Image = Image.open(io.BytesIO(data))
            width, height = im.size
            if width * height > MAX_DECODE_PIXELS:
                raise VisionError(
                    "image_too_large",
                    f"Image has {width * height} pixels (max {MAX_DECODE_PIXELS})",
                    details={"maxPixels": MAX_DECODE_PIXELS},
                )
            exif = im.getexif()
            exif_flag = _exif_make_or_model(exif)
            orientation = exif.get(_EXIF_ORIENTATION)
            im.load()
        # Only transposing images copy; the original is released as soon as `im` is rebound.
        if orientation in _ORIENTATION_TRANSPOSE:
            im = im.transpose(_ORIENTATION_TRANSPOSE[orientation])
        image = _to_bgr(im)
    except Image.DecompressionBombError as e:
        raise VisionError("image_too_large", "Image has too many pixels") from e
    except (OSError, SyntaxError, ValueError, EOFError, struct.error) as e:
        raise VisionError("corrupt_file", "The image could not be decoded") from e
    return DecodedImage(image=image, exif_make_or_model=exif_flag)


def apply_pixel_guards(
    img: "np.ndarray", ctx: PipelineContext, max_work_pixels: int | None = None
) -> "np.ndarray":
    """Reject oversized or tiny images; downscale (INTER_AREA) to the work budget with a warning."""
    limit = MAX_WORK_PIXELS if max_work_pixels is None else max_work_pixels
    h, w = img.shape[:2]
    pixels = w * h
    if pixels > MAX_DECODE_PIXELS:
        raise VisionError(
            "image_too_large",
            f"Image has {pixels} pixels (max {MAX_DECODE_PIXELS})",
            details={"maxPixels": MAX_DECODE_PIXELS},
        )
    if min(w, h) < MIN_SHORT_EDGE:
        raise VisionError(
            "image_too_small",
            f"Image short edge is {min(w, h)} px (min {MIN_SHORT_EDGE})",
            details={"minShortEdge": MIN_SHORT_EDGE},
        )
    if pixels <= limit:
        return img
    factor = (limit / pixels) ** 0.5
    # Floor so the result never exceeds the budget.
    new_w, new_h = max(1, int(w * factor)), max(1, int(h * factor))
    ctx.warn("image_downscaled", {"megapixels": round(pixels / 1_000_000, 1)})
    resized: np.ndarray = cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_AREA)
    return resized
