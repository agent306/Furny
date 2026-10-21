"""OCR engine wrapper, tiling, two-pass reading and text tokens (06 §7.7)."""

import numpy as np
import pytest

from app.ocr.engine import OcrEngine, RawOcrBox
from app.ocr.tiling import dedupe, map_rotated_cw, tile_origins
from app.pipeline.binarize import Preprocessed, preprocess
from app.pipeline.normalize import NormalizedPage
from app.pipeline.ocr_stage import run_ocr, tokens_from_vector_words
from app.pipeline.pdf import VectorPage, VWord
from app.schemas.meta import PageImage, SourceKind
from app.utils.geometry import Rect
from tests.support.synth import SText, render_plan
from tests.test_normalize import make_ctx


def quad_of(x0: float, y0: float, x1: float, y1: float) -> np.ndarray:
    return np.array([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], np.float64)


def raw(x0: float, y0: float, x1: float, y1: float, text: str, score: float) -> RawOcrBox:
    return RawOcrBox(quad=quad_of(x0, y0, x1, y1), text=text, score=score)


def rot_raw(box: RawOcrBox, orig_h: int) -> RawOcrBox:
    """What pass B sees: the same box in the image rotated 90 degrees clockwise ((x, y) -> (h - 1 - y, x))."""
    quad = np.array([[orig_h - 1 - y, x] for x, y in box.quad], np.float64)
    return RawOcrBox(quad=quad, text=box.text, score=box.score)


class FakeOcr:
    """Calls `fn(img, n)` where `n` counts the reads so far; records the shape of every image read."""

    def __init__(self, fn):  # type: ignore[no-untyped-def]
        self.fn = fn
        self.shapes: list[tuple[int, ...]] = []

    def read(self, img_bgr: np.ndarray) -> list[RawOcrBox]:
        self.shapes.append(img_bgr.shape)
        return list(self.fn(img_bgr, len(self.shapes) - 1))


class ExplodingOcr:
    def read(self, img_bgr: np.ndarray) -> list[RawOcrBox]:
        raise AssertionError("OCR must not run")


def page_of(
    w: int,
    h: int,
    *,
    kind: SourceKind = "raster",
    vector: VectorPage | None = None,
    img: np.ndarray | None = None,
) -> NormalizedPage:
    if img is None:
        img = np.full((h, w, 3), 255, np.uint8)
    return NormalizedPage(
        image=img,
        page_image=PageImage(
            width=w, height=h, source_page=1, dpi=None, rectified=False, deskew_deg=0.0, resample_factor=1.0
        ),
        transform=np.eye(3),
        source_kind=kind,
        is_photo=False,
        vector=vector,
    )


def pre_of(w: int, h: int, *, ink: np.ndarray | None = None, region: Rect | None = None) -> Preprocessed:
    if ink is None:
        ink = np.zeros((h, w), np.uint8)
    zeros = np.zeros((h, w), np.uint8)
    return Preprocessed(
        gray=np.full((h, w), 255, np.uint8),
        ink=ink,
        dark=zeros,
        thick=zeros,
        dt=np.zeros((h, w), np.float32),
        t_thin=2.0,
        colorfulness=0.0,
        drawing_kind="line_drawing",
        region=region or Rect(0, 0, w, h),
    )


def read_page(ocr: object, w: int = 800, h: int = 600, **kw: object):  # type: ignore[no-untyped-def]
    return run_ocr(page_of(w, h), pre_of(w, h, **kw), ocr, make_ctx())  # type: ignore[arg-type]


def test_tile_origins() -> None:
    assert tile_origins(1000) == [0]
    assert tile_origins(1280) == [0]
    assert tile_origins(3000) == [0, 1120, 1720]
    assert tile_origins(2400) == [0, 1120]
    assert tile_origins(2401) == [0, 1120, 1121]


def test_rotated_mapping() -> None:
    import cv2

    h = 500
    img = np.zeros((h, 300), np.uint8)
    img[20, 10] = 255
    rotated = cv2.rotate(img, cv2.ROTATE_90_CLOCKWISE)
    v, u = np.argwhere(rotated)[0]
    assert (u, v) == (479, 10)
    assert map_rotated_cw((479, 10), h) == (10, 20)


def test_dedupe_keeps_higher_score_within_iou() -> None:
    a = raw(0, 0, 100, 50, "A", 0.6)
    b = raw(10, 0, 110, 50, "B", 0.9)  # IoU 90/110 > 0.5
    c = raw(300, 0, 400, 50, "C", 0.5)
    kept = dedupe([a, b, c], 0.5)
    assert [k.text for k in kept] == ["B", "C"]
    assert [k.text for k in dedupe([raw(0, 0, 10, 10, "X", 0.5), raw(0, 0, 10, 10, "Y", 0.5)], 0.5)] == ["X"]


def test_tiling_dedupe_with_fake_engine() -> None:
    w, h = 2000, 1000
    origins = tile_origins(w)
    assert origins == [0, 720]

    def fn(img: np.ndarray, n: int) -> list[RawOcrBox]:
        if img.shape[:2] != (1000, 1280):  # pass B (rotated tiles): nothing
            return []
        ox = origins[n]  # pass A reads the two tiles in x order
        score = 0.8 if n == 0 else 0.9
        return [raw(1200 - ox, 100, 1250 - ox, 140, "KITCHEN", score)]

    fake = FakeOcr(fn)
    result = read_page(fake, w, h)
    assert len(result.tokens) == 1
    token = result.tokens[0]
    assert token.text == "KITCHEN"
    assert token.score == 0.9
    assert token.angle == 0
    assert token.box == pytest.approx((1200, 100, 1250, 140))
    assert token.height_px == pytest.approx(40)
    assert token.parsed.kind == "room_name"
    # pass A: 2 tiles; pass B reads the rotated image (1000 wide, 2000 high): 2 tiles
    assert fake.shapes == [(1000, 1280, 3), (1000, 1280, 3), (1280, 1000, 3), (1280, 1000, 3)]


def test_rotated_pass_maps_back_with_region_offset() -> None:
    w, h = 1000, 700
    region = Rect(200, 100, 600, 400)
    target = raw(300, 150, 340, 330, "3300", 0.9)  # a tall box: vertical text, absolute coordinates

    def fn(img: np.ndarray, n: int) -> list[RawOcrBox]:
        if img.shape[:2] == (400, 600):  # pass A on the region crop
            return []
        crop = raw(100, 50, 140, 230, "3300", 0.9)  # the target in crop coordinates
        return [rot_raw(crop, 400)]

    result = read_page(FakeOcr(fn), w, h, region=region)
    assert [t.text for t in result.tokens] == ["3300"]
    token = result.tokens[0]
    assert token.angle == 90
    assert token.box == pytest.approx((target.quad[0][0], target.quad[0][1], 340, 330))
    assert token.height_px == pytest.approx(40)  # box width for rotated text
    assert token.parsed.kind == "mm_number"


def pass_split(a_boxes: list[RawOcrBox], b_boxes_abs: list[RawOcrBox], h: int = 600) -> FakeOcr:
    def fn(img: np.ndarray, n: int) -> list[RawOcrBox]:
        if img.shape[0] == h:
            return a_boxes
        return [rot_raw(b, h) for b in b_boxes_abs]

    return FakeOcr(fn)


def test_pass_merge() -> None:
    a = raw(100, 100, 200, 150, "AAA", 0.7)
    b = raw(142, 100, 242, 150, "BBB", 0.9)  # IoU 58 / 142 = 0.41: above 0.3, below the in-pass 0.5
    assert [t.text for t in read_page(pass_split([a], [b])).tokens] == ["BBB"]

    a, b = raw(100, 100, 200, 150, "AAA", 0.9), raw(142, 100, 242, 150, "BBB", 0.7)
    assert [t.text for t in read_page(pass_split([a], [b])).tokens] == ["AAA"]

    a, b = raw(100, 100, 200, 150, "AAA", 0.8), raw(142, 100, 242, 150, "BBB", 0.8)
    assert [t.text for t in read_page(pass_split([a], [b])).tokens] == ["AAA"]  # tie: pass A

    a, b = raw(100, 100, 200, 150, "AAA", 0.8), raw(180, 100, 280, 150, "BBB", 0.8)
    assert sorted(t.text for t in read_page(pass_split([a], [b])).tokens) == ["AAA", "BBB"]  # IoU 20/180


def test_same_pass_boxes_do_not_suppress_each_other_at_the_cross_pass_threshold() -> None:
    a1, a2 = raw(100, 100, 200, 150, "AAA", 0.8), raw(142, 100, 242, 150, "BBB", 0.8)  # IoU 0.41
    assert sorted(t.text for t in read_page(pass_split([a1, a2], [])).tokens) == ["AAA", "BBB"]


def test_angle_follows_box_shape_and_falls_back_to_the_pass() -> None:
    tall_a = raw(300, 100, 340, 250, "3300", 0.9)  # tall box in pass A: RapidOCR read it as rotated text
    wide_a = raw(100, 100, 220, 140, "BEDROOM", 0.9)
    square_a = raw(500, 100, 530, 130, "D1", 0.9)
    single_a = raw(600, 100, 620, 160, "I", 0.9)  # one character: shape says nothing
    wide_b = raw(100, 300, 220, 340, "KITCHEN", 0.9)  # horizontal text found by the rotated pass
    square_b = raw(500, 300, 530, 330, "W2", 0.9)
    result = read_page(pass_split([tall_a, wide_a, square_a, single_a], [wide_b, square_b]))
    got = {t.text: t.angle for t in result.tokens}
    assert got == {"3300": 90, "BEDROOM": 0, "D1": 0, "I": 0, "KITCHEN": 0, "W2": 90}
    tall = next(t for t in result.tokens if t.text == "3300")
    assert tall.height_px == pytest.approx(40)
    assert tall.quad == ((300, 250), (300, 100), (340, 100), (340, 250))  # reads bottom-to-top


def test_sorted_ids() -> None:
    boxes = [
        raw(500, 300, 560, 330, "ONE", 0.9),
        raw(100, 300.4, 160, 330, "TWO", 0.9),
        raw(900, 50, 960, 80, "THREE", 0.9),
    ]
    result = read_page(pass_split(boxes, []))
    assert [(t.id, t.text) for t in result.tokens] == [("T1", "THREE"), ("T2", "TWO"), ("T3", "ONE")]


def vector_words(n: int) -> list[VWord]:
    words = [VWord(text="3300", box=(100.0, 50.0, 140.0, 70.0), angle=0)]
    words.append(VWord(text="BEDROOM", box=(200.0, 300.0, 300.0, 330.0), angle=0))
    words.append(VWord(text="2400", box=(30.0, 100.0, 50.0, 160.0), angle=90))
    words += [VWord(text=f"W{i}", box=(10.0 * i, 400.0, 10.0 * i + 8, 410.0), angle=0) for i in range(n - 3)]
    return words


def test_vector_words_bypass() -> None:
    vector = VectorPage(segments=[], filled=[], words=vector_words(12), object_count=0)
    page = page_of(800, 600, kind="pdf_vector", vector=vector)
    result = run_ocr(page, pre_of(800, 600), ExplodingOcr(), make_ctx())
    assert len(result.tokens) == 12
    assert all(t.score == 1.0 for t in result.tokens)
    by_text = {t.text: t for t in result.tokens}
    assert by_text["3300"].angle == 0
    assert by_text["3300"].parsed.kind == "mm_number"
    assert by_text["2400"].angle == 90
    assert by_text["2400"].height_px == pytest.approx(20)  # box width for rotated text
    assert by_text["BEDROOM"].height_px == pytest.approx(30)
    assert by_text["BEDROOM"].parsed.room_type == "bedroom"
    assert [t.id for t in result.tokens] == [f"T{i}" for i in range(1, 13)]


def test_vector_words_are_mapped_through_the_transform() -> None:
    vector = VectorPage(segments=[], filled=[], words=vector_words(12), object_count=0)
    transform = np.array([[2.0, 0, 10.0], [0, 2.0, 20.0], [0, 0, 1.0]])
    tokens = tokens_from_vector_words(vector, transform)
    bedroom = next(t for t in tokens if t.text == "BEDROOM")
    assert bedroom.box == pytest.approx((410.0, 620.0, 610.0, 680.0))
    assert bedroom.height_px == pytest.approx(60.0)
    assert bedroom.quad[0] == pytest.approx((410.0, 620.0))


def test_few_vector_words_fall_back_to_ocr() -> None:
    vector = VectorPage(segments=[], filled=[], words=vector_words(9), object_count=0)
    page = page_of(800, 600, kind="pdf_vector", vector=vector)
    fake = FakeOcr(lambda img, n: [])
    result = run_ocr(page, pre_of(800, 600), fake, make_ctx())
    assert fake.shapes
    assert result.tokens == []


def test_text_mask() -> None:
    w, h = 800, 600
    ink = np.full((h, w), 255, np.uint8)
    result = read_page(pass_split([raw(100, 100, 200, 150, "ABC", 0.9)], []), w, h, ink=ink)
    mask = result.text_mask
    assert mask.shape == (h, w)
    assert mask.dtype == np.uint8
    assert (mask[98:153, 98:203] == 255).all()
    assert mask.sum() == 255 * (203 - 98) * (153 - 98)
    assert (result.ink_notext[98:153, 98:203] == 0).all()
    assert result.ink_notext.sum() == 255 * (w * h - (203 - 98) * (153 - 98))
    assert (ink == 255).all()  # the input is not modified


@pytest.mark.parametrize(
    ("label", "name_key", "room_type", "pair_mm"),
    [
        ("BEDROOM 10'0\"x11'0\"", "BEDROOM", "bedroom", (3048, 3353)),
        ("LIVING/DINING 10'1\"x21'6\"", "LIVING/DINING", "living", (3073, 6553)),
        ("TOILET 8'1\"x5'0\"", "TOILET", "toilet", (2464, 1524)),
        ("OTS 12'3\"x7'11\"", "OTS", "ots", (3734, 2413)),
        ("MASTER BEDROOM 12'0\" X 14'0\"", "MASTER BEDROOM", "master_bedroom", (3658, 4267)),
        ("KITCHEN 3.0 x 2.4", "KITCHEN", "kitchen", (3000, 2400)),
    ],
)
def test_combined_labels_split_into_name_and_size(
    label: str, name_key: str, room_type: str, pair_mm: tuple[int, int]
) -> None:
    result = read_page(pass_split([raw(100, 100, 100 + 20 * len(label), 140, label, 0.9)], []))
    assert [t.id for t in result.tokens] == ["T1", "T2"]
    name, size = result.tokens
    assert name.parsed.kind == "room_name"
    assert name.parsed.room_name == name_key
    assert name.parsed.room_type == room_type
    assert size.parsed.kind == "size_pair"
    assert size.parsed.pair_mm == pair_mm
    assert name.text + " " + size.text == label
    # the pieces tile the original box left to right and keep its score and height
    assert name.box[0] == pytest.approx(100)
    assert size.box[2] == pytest.approx(100 + 20 * len(label))
    assert name.box[2] <= size.box[0]
    assert name.score == size.score == 0.9
    assert name.height_px == size.height_px == pytest.approx(40)
    assert name.quad[1][1] == pytest.approx(100)  # axis-aligned quad stays axis-aligned


def test_split_follows_reading_direction_of_rotated_text() -> None:
    label = "BEDROOM 10'0\"x11'0\""
    # vertical text reads bottom to top: the name is the lower part of the box
    abs_box = raw(300, 100, 340, 100 + 20 * len(label), label, 0.9)
    h = 600
    rotated = RawOcrBox(
        quad=np.array([[h - 1 - y, x] for x, y in abs_box.quad[[3, 0, 1, 2]]], np.float64),
        text=label,
        score=0.9,
    )

    def fn(img: np.ndarray, n: int) -> list[RawOcrBox]:
        return [] if img.shape[0] == h else [rotated]

    result = read_page(FakeOcr(fn))
    assert len(result.tokens) == 2
    by_kind = {t.parsed.kind: t for t in result.tokens}
    assert by_kind["room_name"].angle == by_kind["size_pair"].angle == 90
    assert by_kind["room_name"].box[1] > by_kind["size_pair"].box[3] - 1e-6  # name below the size
    assert by_kind["room_name"].height_px == pytest.approx(40)


def test_plain_labels_are_not_split() -> None:
    texts = ["BEDROOM", "SCALE 1:100", "10'0\"x11'0\"", "912 SQ.FT", "LIVING ROOM", "3 x 4"]
    boxes = [raw(100, 50 + 60 * i, 300, 90 + 60 * i, t, 0.9) for i, t in enumerate(texts)]
    result = read_page(pass_split(boxes, []))
    assert [t.text for t in result.tokens] == texts


def test_empty_text_is_dropped() -> None:
    result = read_page(pass_split([raw(10, 10, 50, 40, "  ", 0.9), raw(100, 10, 150, 40, "OK", 0.9)], []))
    assert [t.text for t in result.tokens] == ["OK"]


@pytest.mark.slow
def test_real_rapidocr_reads_plan_text() -> None:
    import cv2

    img = render_plan((1600, 700), texts=[SText("3300", (1400, 600), scale=1.6, thickness=3, vertical=True)])
    cv2.putText(img, "BEDROOM", (150, 300), cv2.FONT_HERSHEY_SIMPLEX, 2.0, (0, 0, 0), 4)
    page = page_of(1600, 700, img=img)
    pre = preprocess(page, make_ctx())
    result = run_ocr(page, pre, OcrEngine(), make_ctx())
    texts = {t.text: t for t in result.tokens}
    assert "BEDROOM" in texts, [t.text for t in result.tokens]
    assert texts["BEDROOM"].angle == 0
    assert texts["BEDROOM"].parsed.kind == "room_name"
    assert texts["BEDROOM"].parsed.room_type == "bedroom"
    assert "3300" in texts, [(t.text, t.angle) for t in result.tokens]
    assert texts["3300"].angle == 90
    assert texts["3300"].parsed.kind == "mm_number"
    assert result.ink_notext.sum() < pre.ink.sum()


@pytest.mark.slow
def test_real_engine_blank_image_reads_nothing() -> None:
    assert OcrEngine().read(np.full((300, 300, 3), 255, np.uint8)) == []
