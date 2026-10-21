"""Magic-byte sniffing, raster/HEIC decode and pixel guards (06 §2.1, §2.2, §7.2)."""

import io
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pypdf
import pytest
from PIL import Image

from app.api.errors import VisionError
from app.pipeline import decode
from app.pipeline.context import PipelineContext
from app.pipeline.decode import (
    apply_pixel_guards,
    canonical_mime,
    decode_raster,
    sniff_kind,
    sniff_mime,
)
from app.pipeline.pdf import pdf_page_count, render_dpi
from tests.support.pdfgen import PageSpec, make_pdf


class _NoIO:
    def fetch(self, url: str, max_bytes: int, timeout_s: float = 30) -> bytes:
        raise AssertionError("not used")

    def put(self, url: str, data: bytes, content_type: str) -> None:
        raise AssertionError("not used")


def make_ctx() -> PipelineContext:
    return PipelineContext.for_request(60, _NoIO(), debug=False)


def encode(fmt: str, size: tuple[int, int] = (64, 48), mode: str = "RGB", **save_kwargs: object) -> bytes:
    buf = io.BytesIO()
    Image.new(mode, size, "white" if mode == "RGB" else None).save(buf, format=fmt, **save_kwargs)  # type: ignore[arg-type]
    return buf.getvalue()


def raises_code(code: str, status: int) -> "pytest.RaisesExc[VisionError]":
    return pytest.raises(VisionError, check=lambda e: e.code == code and e.http_status == status)


# --- sniffing ---------------------------------------------------------------------------------


@pytest.mark.parametrize("fmt", ["JPEG", "PNG", "WEBP"])
def test_sniff_raster(fmt: str) -> None:
    assert sniff_kind(encode(fmt), "plan.bin") == "raster"


@pytest.mark.parametrize("brand", ["heic", "heix", "hevc", "heim", "heis", "mif1", "msf1"])
def test_sniff_heic_variants(brand: str) -> None:
    assert sniff_kind(b"\x00\x00\x00\x18ftyp" + brand.encode() + b"\x00" * 20, "x.heic") == "heic"


def test_sniff_pdf_offset() -> None:
    assert sniff_kind(b" " * 500 + b"%PDF-1.7", "a.pdf") == "pdf"
    assert sniff_kind(b" " * 1019 + b"%PDF-1.7", "a.pdf") == "pdf"
    with raises_code("unsupported_type", 415):
        sniff_kind(b" " * 1100 + b"%PDF-1.7", "a.pdf")


def test_sniff_dxf() -> None:
    assert sniff_kind(b"  0\nSECTION\n  2\nHEADER\n", "a.dxf") == "dxf"
    assert sniff_kind(b"  0\r\nSECTION\r\n  2\r\nHEADER\r\n", "a.dxf") == "dxf"
    assert sniff_kind(b"AutoCAD Binary DXF\r\n\x1a\x00" + b"\x00" * 16, "a.dxf") == "dxf"


def test_dwg_magic() -> None:
    with raises_code("dwg_not_supported", 415):
        sniff_kind(b"AC1032" + b"\x00" * 100, "plan.dxf")
    with raises_code("dwg_not_supported", 415):
        sniff_kind(encode("PNG"), "x.dwg")
    with raises_code("dwg_not_supported", 415):
        sniff_kind(encode("PNG"), "X.DWG")


@pytest.mark.parametrize(
    "data",
    [
        b"II*\x00" + b"\x00" * 20,
        b"GIF89a" + b"\x00" * 20,
        b"BM" + b"\x00" * 20,
        b"\x00\x00\x00\x18ftypavif" + b"\x00" * 20,
        b'<svg xmlns="http://www.w3.org/2000/svg"/>',
        b"",
    ],
)
def test_unsupported(data: bytes) -> None:
    with raises_code("unsupported_type", 415):
        sniff_kind(data, "plan.png")


def test_riff_without_webp_is_unsupported() -> None:
    with raises_code("unsupported_type", 415):
        sniff_kind(b"RIFF\x00\x00\x00\x00WAVEfmt ", "a.webp")


@pytest.mark.parametrize(
    ("data", "mime"),
    [
        (encode("JPEG"), "image/jpeg"),
        (encode("PNG"), "image/png"),
        (encode("WEBP"), "image/webp"),
        (b"\x00\x00\x00\x18ftypheic" + b"\x00" * 20, "image/heic"),
        (b"%PDF-1.7", "application/pdf"),
        (b"  0\nSECTION\n  2\nHEADER\n", "image/vnd.dxf"),
    ],
)
def test_sniff_mime_per_subtype(data: bytes, mime: str) -> None:
    """06 §4.5: the sniffed canonical MIME keeps the raster sub-type."""
    assert sniff_mime(data, "upload.bin") == mime
    assert canonical_mime(sniff_kind(data, "upload.bin"), data) == mime


def test_canonical_mime_raster_needs_bytes() -> None:
    assert canonical_mime("heic") == "image/heic"
    assert canonical_mime("pdf") == "application/pdf"
    assert canonical_mime("dxf") == "image/vnd.dxf"
    with raises_code("unsupported_type", 415):
        canonical_mime("raster")


def test_sniff_mime_rejections() -> None:
    with raises_code("dwg_not_supported", 415):
        sniff_mime(encode("PNG"), "x.dwg")
    with raises_code("unsupported_type", 415):
        sniff_mime(b"GIF89a", "x.gif")


# --- decode -----------------------------------------------------------------------------------


def jpeg_with_exif(size: tuple[int, int], **tags: object) -> bytes:
    exif = Image.Exif()
    for key, value in tags.items():
        exif[{"orientation": 0x0112, "make": 0x010F, "model": 0x0110}[key]] = value
    buf = io.BytesIO()
    Image.new("RGB", size, "white").save(buf, format="JPEG", exif=exif)
    return buf.getvalue()


def test_exif_orientation_applied() -> None:
    decoded = decode_raster(jpeg_with_exif((200, 100), orientation=6))
    assert decoded.image.shape == (200, 100, 3)
    assert decoded.image.dtype == np.uint8
    assert decoded.exif_make_or_model is False


def test_exif_make_or_model_flag() -> None:
    assert decode_raster(jpeg_with_exif((20, 10), make="Apple")).exif_make_or_model is True
    assert decode_raster(jpeg_with_exif((20, 10), model="iPhone 15")).exif_make_or_model is True
    assert decode_raster(jpeg_with_exif((20, 10), make="  ")).exif_make_or_model is False


def test_output_is_bgr() -> None:
    buf = io.BytesIO()
    Image.new("RGB", (4, 4), (255, 0, 0)).save(buf, format="PNG")
    assert decode_raster(buf.getvalue()).image[0, 0].tolist() == [0, 0, 255]


def test_alpha_composited_white() -> None:
    buf = io.BytesIO()
    Image.new("RGBA", (30, 20), (0, 0, 0, 0)).save(buf, format="PNG")
    img = decode_raster(buf.getvalue()).image
    assert img.shape == (20, 30, 3)
    assert (img == 255).all()


def test_palette_transparency_composited_white() -> None:
    buf = io.BytesIO()
    pal = Image.new("P", (10, 10), 0)
    pal.putpalette([0, 0, 0] * 256)
    pal.save(buf, format="PNG", transparency=0)
    assert (decode_raster(buf.getvalue()).image == 255).all()


def test_gray_16bit_scaled() -> None:
    arr = np.full((10, 12), 65535, dtype=np.uint16)
    buf = io.BytesIO()
    Image.fromarray(arr).save(buf, format="PNG")
    img = decode_raster(buf.getvalue()).image
    assert img.shape == (10, 12, 3)
    assert (img == 255).all()


def test_decompression_bomb_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    data = encode("PNG", (200, 100))
    monkeypatch.setattr(decode, "MAX_DECODE_PIXELS", 10_000)

    def fail_load(self: Image.Image) -> None:
        raise AssertionError("pixels were decoded")

    # Rejected from `im.size`: the pixel data is never loaded.
    monkeypatch.setattr(Image.Image, "load", fail_load)
    with raises_code("image_too_large", 413):
        decode_raster(data)


def test_pillow_bomb_error_maps_to_image_too_large(monkeypatch: pytest.MonkeyPatch) -> None:
    assert Image.MAX_IMAGE_PIXELS == decode.MAX_DECODE_PIXELS
    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 1_000)
    with raises_code("image_too_large", 413):
        decode_raster(encode("PNG", (200, 100)))


def test_corrupt() -> None:
    with raises_code("corrupt_file", 422):
        decode_raster(b"\x89PNG\r\n\x1a\n" + b"junk")


def test_truncated_is_corrupt() -> None:
    data = encode("PNG", (300, 300))
    with raises_code("corrupt_file", 422):
        decode_raster(data[: len(data) // 2])


_PEAK_SCRIPT = """
import json, sys
from app.pipeline.decode import decode_raster

def status(key):
    for line in open("/proc/self/status"):
        if line.startswith(key + ":"):
            return int(line.split()[1]) * 1024

data = open(sys.argv[1], "rb").read()
before = status("VmRSS")
image = decode_raster(data).image
print(json.dumps({"peak_delta": status("VmHWM") - before, "nbytes": image.nbytes, "shape": image.shape}))
"""


@pytest.mark.skipif(not Path("/proc/self/status").exists(), reason="needs /proc for peak RSS")
def test_decode_peak_memory_is_bounded(tmp_path: Path) -> None:
    """06 §5.2 budget: decoding must not keep several full-size copies alive (RGBA used to need ~5)."""
    path = tmp_path / "big.png"
    im = Image.new("RGBA", (5000, 4000), (10, 20, 30, 255))
    im.paste((200, 100, 50, 128), (0, 0, 2500, 2000))
    im.save(path, format="PNG")
    del im
    root = Path(__file__).resolve().parents[1]
    proc = subprocess.run(
        [sys.executable, "-c", _PEAK_SCRIPT, str(path)],
        cwd=root,
        env={"PYTHONPATH": str(root), "PATH": ""},
        capture_output=True,
        text=True,
        check=True,
    )
    result = json.loads(proc.stdout)
    assert result["shape"] == [4000, 5000, 3]
    # Loaded RGBA (4 B/px) + the BGR output (3 B/px) is ~2.3x the output; 3x leaves headroom for noise.
    assert result["peak_delta"] < 3 * result["nbytes"], result


def test_heic_opener_registered() -> None:
    assert ".heic" in Image.registered_extensions()


def test_heic_decode_roundtrip() -> None:
    """pi-heif is decode-only, so this runs only where Pillow can also encode HEIF."""
    buf = io.BytesIO()
    try:
        Image.new("RGB", (64, 48), (255, 0, 0)).save(buf, format="HEIF")
    except (KeyError, ValueError, OSError):
        pytest.skip("no HEIF encoder available (pi-heif is decode-only); HEIC decode is in the gap list")
    assert sniff_kind(buf.getvalue(), "x.heic") == "heic"
    assert decode_raster(buf.getvalue()).image.shape == (48, 64, 3)


# --- pixel guards -----------------------------------------------------------------------------


def blank(w: int, h: int) -> "np.ndarray":
    return np.full((h, w, 3), 255, dtype=np.uint8)


def test_no_change_within_limits() -> None:
    ctx = make_ctx()
    img = blank(400, 300)
    assert apply_pixel_guards(img, ctx) is img
    assert ctx.warnings == []


def test_downscale_warning(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(decode, "MAX_WORK_PIXELS", 5000)
    monkeypatch.setattr(decode, "MIN_SHORT_EDGE", 10)
    ctx = make_ctx()
    out = apply_pixel_guards(blank(400, 300), ctx)
    h, w = out.shape[:2]
    assert w * h <= 5000
    assert w * h > 4000
    assert abs(w / h - 400 / 300) < 0.05
    assert [(x.code, x.params) for x in ctx.warnings] == [("image_downscaled", {"megapixels": 0.1})]


def test_explicit_max_work_pixels_overrides_default() -> None:
    """K5: callers pass `settings.vision_max_pixels` explicitly."""
    ctx = make_ctx()
    out = apply_pixel_guards(blank(400, 300), ctx, max_work_pixels=60_000)
    assert out.shape[0] * out.shape[1] <= 60_000
    assert ctx.warnings[0].params == {"megapixels": 0.1}


def test_downscale_uses_area_interpolation(monkeypatch: pytest.MonkeyPatch) -> None:
    import cv2

    seen: list[int] = []
    real = cv2.resize

    def spy(src: "np.ndarray", dsize: tuple[int, int], *, interpolation: int) -> "np.ndarray":
        seen.append(interpolation)
        return real(src, dsize, interpolation=interpolation)

    monkeypatch.setattr(decode.cv2, "resize", spy)
    apply_pixel_guards(blank(400, 300), make_ctx(), max_work_pixels=60_000)
    assert seen == [cv2.INTER_AREA]


def test_too_small() -> None:
    with raises_code("image_too_small", 422):
        apply_pixel_guards(blank(299, 800), make_ctx())
    with raises_code("image_too_small", 422):
        apply_pixel_guards(blank(800, 299), make_ctx())
    apply_pixel_guards(blank(300, 800), make_ctx())


def test_guards_reject_over_decode_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(decode, "MAX_DECODE_PIXELS", 100_000)
    with raises_code("image_too_large", 413):
        apply_pixel_guards(blank(400, 300), make_ctx())


# --- PDF render rule and encryption (06 §7.2; the rest of the PDF tests are in test_pdf.py) -----


def test_render_dpi_rule() -> None:
    assert render_dpi(595.3, 841.9) == 300
    assert render_dpi(2384, 3370) == pytest.approx(6000 / (3370 / 72), abs=0.1)
    assert render_dpi(2384, 3370) == pytest.approx(128.2, abs=0.1)
    assert render_dpi(14400, 14400) == 72


def test_encrypted_pdf() -> None:
    writer = pypdf.PdfWriter(clone_from=io.BytesIO(make_pdf([PageSpec(200, 100)])))
    writer.encrypt("pw", algorithm="RC4-128")
    buf = io.BytesIO()
    writer.write(buf)
    with raises_code("pdf_encrypted", 422):
        pdf_page_count(buf.getvalue())
