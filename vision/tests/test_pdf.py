"""PDF page count/size, rendering, classification and vector extraction (06 §5.4, §7.2).

The DPI-rule and encrypted-PDF tests live in test_decode.py (06 §16.1).
"""

import io
import json
import subprocess
import sys
import threading
from pathlib import Path

import numpy as np
import pypdf
import pytest
from pypdf.generic import RectangleObject

from app.api.errors import VisionError
from app.pipeline import decode, pdf
from app.pipeline.pdf import (
    classify_pdf_page,
    extract_vector_page,
    is_standard_paper,
    page_size_pt,
    pdf_page_count,
    render_pdf_page,
)
from tests.support.pdfgen import A3_PT, A4_PT, PageSpec, make_pdf

A4 = PageSpec(*A4_PT)


def raises_code(code: str, status: int) -> "pytest.RaisesExc[VisionError]":
    return pytest.raises(VisionError, check=lambda e: e.code == code and e.http_status == status)


def lines(n: int) -> list[tuple[float, float, float, float, float]]:
    return [(10.0 + i, 10.0, 10.0 + i, 500.0, 0.5) for i in range(n)]


def test_render_shape() -> None:
    page = render_pdf_page(make_pdf([A4]), 1)
    w_pt, h_pt = A4_PT
    assert page.dpi == 300
    assert page.image.dtype == np.uint8
    assert abs(page.image.shape[0] - round(h_pt * 300 / 72)) <= 1
    assert abs(page.image.shape[1] - round(w_pt * 300 / 72)) <= 1
    assert page.image.shape[2] == 3
    assert (page.width_pt, page.height_pt) == pytest.approx(A4_PT, abs=0.1)
    assert (page.image == 255).all()  # blank page: opaque white, not transparent black


def test_render_is_bgr_and_honours_explicit_dpi() -> None:
    red = PageSpec(200, 100, filled_rects=[(0, 0, 100, 100)])
    page = render_pdf_page(make_pdf([red]), 1, dpi=72)
    assert page.image.shape == (100, 200, 3)
    assert page.dpi == 72
    assert page.image[50, 50].tolist() == [0, 0, 0]
    assert page.image[50, 150].tolist() == [255, 255, 255]


def test_render_uses_requested_page() -> None:
    data = make_pdf([PageSpec(100, 100), PageSpec(300, 200)])
    assert page_size_pt(data, 1) == (100, 100)
    assert page_size_pt(data, 2) == (300, 200)
    assert render_pdf_page(data, 2, dpi=72).image.shape == (200, 300, 3)


def test_page_size_applies_rotation() -> None:
    reader = pypdf.PdfReader(io.BytesIO(make_pdf([PageSpec(300, 200)])))
    writer = pypdf.PdfWriter()
    writer.add_page(reader.pages[0]).rotate(90)
    buf = io.BytesIO()
    writer.write(buf)
    assert page_size_pt(buf.getvalue(), 1) == (200, 300)
    assert render_pdf_page(buf.getvalue(), 1, dpi=72).image.shape == (300, 200, 3)


def test_classify() -> None:
    assert classify_pdf_page(make_pdf([PageSpec(*A4_PT, lines=lines(250))]), 1) == "pdf_vector"
    assert classify_pdf_page(make_pdf([PageSpec(*A4_PT, lines=lines(10))]), 1) == "pdf_raster"


def test_classify_threshold_counts_rects_and_is_per_page() -> None:
    page = PageSpec(*A4_PT, lines=lines(150), filled_rects=[(i, 600, 1, 1) for i in range(50)])
    data = make_pdf([page, PageSpec(*A4_PT, lines=lines(199)), PageSpec(*A4_PT, lines=lines(5))])
    assert classify_pdf_page(data, 1) == "pdf_vector"  # 150 lines + 50 rects = 200
    assert classify_pdf_page(data, 2) == "pdf_raster"
    assert classify_pdf_page(data, 3) == "pdf_raster"
    assert extract_vector_page(data, 1, 72).object_count == 200


def test_vector_coords() -> None:
    page = PageSpec(
        *A4_PT,
        lines=[(72, 72, 144, 72, 1)],
        words=[(100, 100, "SCALE 1:100", 12)],
        filled_rects=[(200, 200, 50, 30)],
    )
    vec = extract_vector_page(make_pdf([page]), 1, 150)
    assert len(vec.segments) == 1  # the stroked line; the unstroked filled rect has no outline
    seg = vec.segments[0]
    assert seg.p0 == pytest.approx((150, 150))
    assert seg.p1 == pytest.approx((300, 150))
    assert seg.width_px == pytest.approx(2.083, abs=0.01)
    [word] = vec.words
    assert word.text == "SCALE 1:100"
    assert word.angle == 0
    x0, y0, x1, y1 = word.box
    assert x0 == pytest.approx(100 * 150 / 72)
    assert y0 < 100 * 150 / 72 < y1  # box brackets the baseline, y down
    assert x1 > x0
    [poly] = vec.filled
    assert len(poly.points) == 4
    xs, ys = zip(*poly.points, strict=True)
    assert (min(xs), max(xs)) == pytest.approx((200 * 150 / 72, 250 * 150 / 72))
    assert (min(ys), max(ys)) == pytest.approx((200 * 150 / 72, 230 * 150 / 72))
    assert vec.object_count == 2


def test_vector_words_keep_blanks_and_split_far_apart_text() -> None:
    page = PageSpec(*A4_PT, words=[(50, 50, "LIVING ROOM", 10), (400, 50, "KITCHEN", 10)])
    vec = extract_vector_page(make_pdf([page]), 1, 72)
    assert sorted(w.text for w in vec.words) == ["KITCHEN", "LIVING ROOM"]


def test_vector_fill_colour_rule() -> None:
    """Only a fill darker than luminance 0.35 becomes a polygon (06 §7.2)."""

    def pdf_with_fills(*fills: str) -> bytes:
        body = "\n".join(f"{fill} {10 + 30 * i} 10 20 20 re f" for i, fill in enumerate(fills))
        return _raw_single_page_pdf(body)

    vec = extract_vector_page(
        pdf_with_fills("0.2 g", "0.5 g", "0 0 0 rg", "1 1 1 rg", "1 0 0 rg", "0 0 0 1 k", "0 0 0 0 k"), 1, 72
    )
    # dark gray, black RGB, red (lum 0.21) and CMYK black are dark; mid gray, white and CMYK white are not
    assert len(vec.filled) == 4
    assert vec.segments == []  # fill-only shapes have no outline


def test_vector_filled_curve_path_and_beziers() -> None:
    # A dark triangle (filled) and a stroked Bezier arc.
    body = "0 g 10 10 m 60 10 l 35 50 l h f\n0 G 1 w 100 100 m 100 150 150 200 200 200 c S"
    vec = extract_vector_page(_raw_single_page_pdf(body), 1, 72)
    [tri] = vec.filled
    assert len(tri.points) == 3
    arc = [s for s in vec.segments if s.p0[0] >= 90]
    assert len(arc) == 8  # flattened into 8 chords
    # the chord polyline starts and ends at the Bezier end points (y flipped: page is 300 pt high)
    assert arc[0].p0 == pytest.approx((100, 300 - 100))
    assert arc[-1].p1 == pytest.approx((200, 300 - 200))


def _raw_single_page_pdf(content: str) -> bytes:
    stream = content.encode()
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Contents 4 0 R >>",
        b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for n, body in enumerate(objs, 1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % n + body + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1)
    out += b"".join(b"%010d 00000 n \n" % o for o in offsets)
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, xref)
    return bytes(out)


def test_vector_rotated_text_is_angle_90() -> None:
    font = b"/Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >>"
    body = (
        "BT /F1 12 Tf 0 1 -1 0 100 100 Tm (UP TEXT) Tj ET\n"
        "BT /F1 12 Tf 0 -1 1 0 200 100 Tm (DOWN TEXT) Tj ET\n"
        "BT /F1 12 Tf 1 0 0 1 20 20 Tm (FLAT) Tj ET"
    )
    data = _raw_single_page_pdf(body).replace(b"/Contents 4 0 R", b"/Contents 4 0 R " + font)
    words = {w.text: w for w in extract_vector_page(data, 1, 72).words}
    assert set(words) == {"UP TEXT", "DOWN TEXT", "FLAT"}
    assert [words[t].angle for t in ("UP TEXT", "DOWN TEXT", "FLAT")] == [90, 90, 0]
    x0, y0, x1, y1 = words["UP TEXT"].box
    assert y1 - y0 > x1 - x0  # tall, narrow box


def test_unstroked_shapes_do_not_inherit_stale_line_width() -> None:
    body = "5 w 10 10 m 100 10 l S\n0 g 20 50 40 30 re f\n0 G 20 120 40 30 re S\n0 g 0 G 20 200 40 30 re B"
    vec = extract_vector_page(_raw_single_page_pdf(body), 1, 72)
    assert [s.width_px for s in vec.segments[:1]] == [5.0]
    assert len(vec.segments) == 1 + 4 + 4  # line, stroked rect, filled+stroked rect; not the `f` rect
    assert all(s.width_px == 5.0 for s in vec.segments)  # S/B rects really are stroked with width 5
    assert len(vec.filled) == 2  # `f` and `B` rects (dark fill); the `S` rect is not filled
    body = "5 w 10 10 m 100 10 l S\n0 g 20 50 40 30 re f"
    vec = extract_vector_page(_raw_single_page_pdf(body), 1, 72)
    assert [s.width_px for s in vec.segments] == [5.0]  # nothing thick from the fill-only rect
    assert len(vec.filled) == 1


@pytest.mark.parametrize("rotation", [0, 90, 180, 270])
@pytest.mark.parametrize("crop", [None, (10, 10, 250, 190), (40, 0, 300, 150)])
def test_vector_coords_align_with_render_under_cropbox_and_rotation(
    crop: tuple[float, ...] | None, rotation: int
) -> None:
    base = make_pdf([PageSpec(300, 200, filled_rects=[(20, 20, 60, 30), (150, 100, 40, 40)])])
    writer = pypdf.PdfWriter(clone_from=io.BytesIO(base))
    if crop:
        writer.pages[0].cropbox = RectangleObject(crop)
    if rotation:
        writer.pages[0].rotate(rotation)
    buf = io.BytesIO()
    writer.write(buf)
    data = buf.getvalue()

    image = render_pdf_page(data, 1, dpi=72).image
    vec = extract_vector_page(data, 1, 72)
    assert len(vec.filled) == 2
    visible = 0
    for poly in vec.filled:
        xs, ys = zip(*poly.points, strict=True)
        h, w = image.shape[:2]
        x0, x1, y0, y1 = (round(v) for v in (min(xs), max(xs), min(ys), max(ys)))
        # clip to the visible area; fully visible parts must be black and the pixels just outside white
        cx0, cx1, cy0, cy1 = max(x0, 0), min(x1, w), max(y0, 0), min(y1, h)
        if cy1 - cy0 < 3 or cx1 - cx0 < 3:
            continue  # outside the CropBox
        visible += 1
        inner = image[cy0 + 1 : cy1 - 1, cx0 + 1 : cx1 - 1]
        assert (inner == 0).all(), (crop, rotation, poly)
        if x0 > 2:
            assert (image[cy0 + 1 : cy1 - 1, x0 - 2] == 255).all(), (crop, rotation, poly)
        if y0 > 2:
            assert (image[y0 - 2, cx0 + 1 : cx1 - 1] == 255).all(), (crop, rotation, poly)
    assert visible >= 1, (crop, rotation)


def test_cropbox_repro_from_review() -> None:
    base = make_pdf([PageSpec(300, 200, filled_rects=[(20, 20, 40, 40)])])
    writer = pypdf.PdfWriter(clone_from=io.BytesIO(base))
    writer.pages[0].cropbox = RectangleObject((10, 10, 250, 190))
    buf = io.BytesIO()
    writer.write(buf)
    [poly] = extract_vector_page(buf.getvalue(), 1, 72).filled
    assert min(x for x, _ in poly.points) == pytest.approx(10)
    assert min(y for _, y in poly.points) == pytest.approx(10)


@pytest.mark.parametrize("rotate", [0, 90, 180, 270])
@pytest.mark.parametrize("crop", ["", "/CropBox [150 120 350 280]"])
def test_mediabox_with_nonzero_origin_aligns(rotate: int, crop: str) -> None:
    data = _raw_single_page_pdf("0 g 160 130 40 40 re f").replace(
        b"/MediaBox [0 0 300 300]", f"/MediaBox [100 100 400 300] /Rotate {rotate} {crop}".encode()
    )
    image = render_pdf_page(data, 1, dpi=72).image
    [poly] = extract_vector_page(data, 1, 72).filled
    xs, ys = zip(*poly.points, strict=True)
    x0, x1, y0, y1 = (round(v) for v in (min(xs), max(xs), min(ys), max(ys)))
    assert (x1 - x0, y1 - y0) in {(40, 40)}
    assert (image[y0 + 2 : y1 - 2, x0 + 2 : x1 - 2] == 0).all()
    assert (image[y0 - 3, x0 + 2 : x1 - 2] == 255).all()
    assert (image[y0 + 2 : y1 - 2, x0 - 3] == 255).all()


def test_concurrent_pdfium_use_is_serialised() -> None:
    """PDFium isn't thread-safe: /v1/inspect and /v1/normalize call in from worker threads."""
    data = make_pdf([PageSpec(*A4_PT, lines=lines(30)), PageSpec(300, 200, filled_rects=[(10, 10, 50, 50)])])
    errors: list[BaseException] = []
    results: list[tuple[int, tuple[int, int, int]]] = []

    def work(i: int) -> None:
        try:
            for _ in range(5):
                n = pdf_page_count(data)
                page = render_pdf_page(data, 1 + i % 2, dpi=96)
                page_size_pt(data, 1)
                results.append((n, page.image.shape))
        except BaseException as e:
            errors.append(e)

    threads = [threading.Thread(target=work, args=(i,)) for i in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert errors == []
    assert len(results) == 40
    assert {n for n, _ in results} == {2}
    assert {shape for _, shape in results} == {(1123, 794, 3), (267, 400, 3)}


def test_pdfium_lock_is_held_while_pdfium_is_used(monkeypatch: pytest.MonkeyPatch) -> None:
    held: list[bool] = []
    original = pdf.pdfium.PdfDocument

    def spy(data: bytes) -> object:
        held.append(pdf._PDFIUM_LOCK.locked())
        return original(data)

    monkeypatch.setattr(pdf.pdfium, "PdfDocument", spy)
    pdf_page_count(make_pdf([PageSpec(100, 100)]))
    assert held == [True]
    assert not pdf._PDFIUM_LOCK.locked()


def test_internal_bugs_are_not_reported_as_corrupt_file(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(*args: object) -> None:
        raise RuntimeError("bug in our conversion")

    monkeypatch.setattr(pdf, "_add_object", boom)
    with pytest.raises(RuntimeError, match="bug in our conversion"):
        extract_vector_page(make_pdf([PageSpec(*A4_PT, lines=lines(3))]), 1, 72)


def test_page_count_and_invalid_page() -> None:
    data = make_pdf([PageSpec(100, 100) for _ in range(21)])
    assert pdf_page_count(data) == 21
    with raises_code("invalid_page", 400):
        render_pdf_page(data, 22)
    for bad in (0, -1, 22):
        with raises_code("invalid_page", 400):
            page_size_pt(data, bad)
        with raises_code("invalid_page", 400):
            classify_pdf_page(data, bad)
        with raises_code("invalid_page", 400):
            extract_vector_page(data, bad, 72)


def test_corrupt_pdf() -> None:
    for fn in (pdf_page_count, lambda d: render_pdf_page(d, 1), lambda d: classify_pdf_page(d, 1)):
        with raises_code("corrupt_file", 422):
            fn(b"%PDF-1.7 garbage")


def test_truncated_pdf_is_corrupt_not_a_crash() -> None:
    data = make_pdf([PageSpec(*A4_PT, lines=lines(5))])
    with raises_code("corrupt_file", 422):
        extract_vector_page(data[: len(data) // 2], 1, 72)


def test_oversize_page_rejected_before_rendering(monkeypatch: pytest.MonkeyPatch) -> None:
    """A 200 in square page would be 207 MP at the 72 dpi floor: refuse before allocating pixels."""
    data = make_pdf([PageSpec(14400, 14400)])
    assert (page_size_pt(data, 1)) == (14400, 14400)
    with raises_code("image_too_large", 413):
        render_pdf_page(data, 1)
    monkeypatch.setattr(decode, "MAX_DECODE_PIXELS", 10_000)
    with raises_code("image_too_large", 413):
        render_pdf_page(make_pdf([PageSpec(300, 300)]), 1, dpi=72)


def test_standard_paper() -> None:
    assert is_standard_paper(841.9, 1190.6)  # A3
    assert is_standard_paper(1190.6, 841.9)  # A3 landscape
    assert not is_standard_paper(700, 700)
    for w, h in (A4_PT, (2383.9, 3370.4), (612, 792), (792, 1224), (1224, 1584), (1584, 2448), (2448, 3168)):
        assert is_standard_paper(w, h)  # A4, A0, ANSI A, B, C, D, E
    assert is_standard_paper(A3_PT[0] * 1.019, A3_PT[1] * 0.981)
    assert not is_standard_paper(A3_PT[0] * 1.03, A3_PT[1])
    assert not is_standard_paper(A3_PT[0], A4_PT[1])  # right width, wrong length


_PEAK_SCRIPT = """
import json, sys
from app.pipeline.pdf import render_pdf_page

def status(key):
    for line in open("/proc/self/status"):
        if line.startswith(key + ":"):
            return int(line.split()[1]) * 1024

data = open(sys.argv[1], "rb").read()
before = status("VmRSS")
page = render_pdf_page(data, 1)
print(json.dumps({"peak_delta": status("VmHWM") - before, "nbytes": page.image.nbytes, "dpi": page.dpi}))
"""


@pytest.mark.skipif(not Path("/proc/self/status").exists(), reason="needs /proc for peak RSS")
def test_render_peak_memory_is_bounded(tmp_path: Path) -> None:
    """06 §5.2: an A0 page renders at ~25 MP; the copy out of PDFium's bitmap must not multiply it."""
    path = tmp_path / "a0.pdf"
    path.write_bytes(make_pdf([PageSpec(2384, 3370, lines=lines(20))]))
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
    assert result["dpi"] == pytest.approx(128.2, abs=0.1)
    # PDFium bitmap (3 B/px) + the packed copy (3 B/px) = 2x the output; 3x leaves headroom for noise.
    assert result["peak_delta"] < 3 * result["nbytes"], result
