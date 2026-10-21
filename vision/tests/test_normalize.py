"""Rectify -> deskew -> resample into a NormalizedPage (06 §7.3-§7.5)."""

import cv2
import numpy as np
import pytest

from app.api.errors import VisionError
from app.pipeline.context import PipelineContext
from app.pipeline.normalize import NormalizedPage, estimate_skew_deg, normalize
from app.schemas.meta import SourceKind
from tests.test_rectify import CORNERS, grid_drawing, photo_of


class _NoIO:
    def fetch(self, url: str, max_bytes: int, timeout_s: float = 30) -> bytes:
        raise AssertionError("not used")

    def put(self, url: str, data: bytes, content_type: str) -> None:
        raise AssertionError("not used")


def make_ctx() -> PipelineContext:
    return PipelineContext.for_request(60, _NoIO(), debug=False)


def line_drawing(w: int = 2000, h: int = 1500) -> np.ndarray:
    """White page with open (unframed) black lines, so no sheet outline is detectable."""
    img = np.full((h, w, 3), 255, np.uint8)
    for i, y in enumerate(range(200, h - 150, 200)):
        cv2.line(img, (150 + 20 * i, y), (w - 200, y), (0, 0, 0), 3)
    for i, x in enumerate(range(250, w - 150, 250)):
        cv2.line(img, (x, 180 + 15 * i), (x, h - 220), (0, 0, 0), 3)
    return img


def rotate_cw(img: np.ndarray, deg: float) -> np.ndarray:
    h, w = img.shape[:2]
    m = cv2.getRotationMatrix2D(((w - 1) / 2, (h - 1) / 2), -deg, 1)  # OpenCV positive = counter-clockwise
    return cv2.warpAffine(img, m, (w, h), flags=cv2.INTER_CUBIC, borderValue=(255, 255, 255))


def run(
    img: np.ndarray,
    ctx: PipelineContext | None = None,
    *,
    kind: SourceKind = "raster",
    is_photo: bool = False,
    corners: list[tuple[float, float]] | None = None,
    **kwargs: int,
) -> NormalizedPage:
    return normalize(
        img,
        source_kind=kind,
        is_photo=is_photo,
        corners=corners,
        source_page=1,
        dpi=None,
        ctx=ctx or make_ctx(),
        **kwargs,
    )


def warning_codes(ctx: PipelineContext) -> list[str]:
    return [w.code for w in ctx.warnings]


def test_user_corners_win() -> None:
    img = line_drawing(3000, 2000)
    ctx = make_ctx()
    page = run(img, ctx, corners=[(0.1, 0.1), (0.9, 0.1), (0.9, 0.9), (0.1, 0.9)])
    assert page.page_image.rectified is True
    assert abs(page.page_image.width - 2400) <= 1 and abs(page.page_image.height - 1600) <= 1
    assert page.page_image.resample_factor == 1.0
    assert warning_codes(ctx) == ["photo_rectified"]
    assert page.is_photo is True


def test_user_corners_win_over_detection_and_unphoto_hint() -> None:
    photo = photo_of(line_drawing(1200, 900))
    page = run(photo, corners=[(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)], is_photo=True)
    assert page.page_image.rectified is True
    assert abs(page.page_image.width - 2000) <= 1  # full frame kept (1600 -> 2000 upscale)


@pytest.mark.parametrize(
    "corners",
    [
        [(0.1, 0.1), (0.9, 0.1), (0.9, 0.9), (0.1, 0.9)],  # TL TR BR BL
        [(0.1, 0.9), (0.9, 0.9), (0.9, 0.1), (0.1, 0.1)],  # reversed
        [(0.9, 0.9), (0.1, 0.9), (0.1, 0.1), (0.9, 0.1)],  # rotated start
        [(0.1, 0.1), (0.9, 0.1), (0.1, 0.9), (0.9, 0.9)],  # bow-tie order
    ],
)
def test_user_corner_order_does_not_mirror_the_warp(corners: list[tuple[float, float]]) -> None:
    img = np.full((2000, 3000, 3), 255, np.uint8)
    img[300:500, 400:600] = 0  # marker near the top-left of the user region (300..2700 x 200..1800)
    page = run(img, corners=corners)
    assert page.page_image.rectified is True
    ys, xs = np.nonzero(page.image[:, :, 0] < 128)
    h, w = page.image.shape[:2]
    # Marker centre (500, 400) -> ((500-300)/2400, (400-200)/1600) of the output = (0.083, 0.125).
    assert xs.mean() / w == pytest.approx(200 / 2400, abs=0.01)
    assert ys.mean() / h == pytest.approx(200 / 1600, abs=0.01)


def test_degenerate_user_corners_are_ignored_with_warning() -> None:
    ctx = make_ctx()
    page = run(line_drawing(), ctx, corners=[(0.1, 0.1), (0.2, 0.1), (0.2, 0.12), (0.1, 0.12)])
    assert page.page_image.rectified is False
    assert warning_codes(ctx) == ["page_corners_not_found"]


def test_photo_quad_detected_and_transform_tracks_corners() -> None:
    ctx = make_ctx()
    photo = photo_of(grid_drawing(), grey=60)
    page = run(photo, ctx, is_photo=True)
    assert page.page_image.rectified is True
    assert "photo_rectified" in warning_codes(ctx)
    w, h = page.page_image.width, page.page_image.height
    for corner, expected in zip(CORNERS, [(0, 0), (w - 1, 0), (w - 1, h - 1), (0, h - 1)], strict=True):
        x, y, z = page.transform @ [corner[0], corner[1], 1.0]
        assert (x / z, y / z) == pytest.approx(expected, abs=0.02 * w)


def test_unhinted_photo_on_a_desk_is_rectified() -> None:
    ctx = make_ctx()
    page = run(photo_of(grid_drawing(), grey=60), ctx, is_photo=False)
    assert page.page_image.rectified is True
    assert page.is_photo is True


def test_unhinted_framed_plan_on_white_is_left_alone() -> None:
    plan = np.full((1500, 2000, 3), 255, np.uint8)
    cv2.rectangle(plan, (200, 150), (1800, 1350), (0, 0, 0), 12)
    cv2.line(plan, (200, 700), (1800, 700), (0, 0, 0), 8)
    ctx = make_ctx()
    page = run(plan, ctx)
    assert page.page_image.rectified is False
    assert ctx.warnings == []
    assert page.is_photo is False
    assert page.image.shape == plan.shape


def test_pdf_pages_never_auto_rectify() -> None:
    page = run(photo_of(grid_drawing(), grey=60), kind="pdf_raster")
    assert page.page_image.rectified is False


def test_photo_without_quad_warns() -> None:
    noise = np.random.default_rng(7).integers(0, 256, (900, 1200, 3), dtype=np.uint8)
    ctx = make_ctx()
    page = run(noise, ctx, is_photo=True)
    assert "page_corners_not_found" in warning_codes(ctx)
    assert page.page_image.rectified is False
    assert "photo_rectified" not in warning_codes(ctx)


def test_photo_filling_the_frame_warns_and_is_not_warped() -> None:
    ctx = make_ctx()
    page = run(line_drawing(), ctx, is_photo=True)
    assert warning_codes(ctx) == ["page_corners_not_found"]
    assert page.page_image.rectified is False


def test_estimate_skew_deg_sign_convention() -> None:
    gray = cv2.cvtColor(rotate_cw(line_drawing(), 3), cv2.COLOR_BGR2GRAY)
    assert estimate_skew_deg(gray) == pytest.approx(3.0, abs=0.2)
    gray = cv2.cvtColor(rotate_cw(line_drawing(), -4.5), cv2.COLOR_BGR2GRAY)
    assert estimate_skew_deg(gray) == pytest.approx(-4.5, abs=0.2)
    assert estimate_skew_deg(np.full((500, 500), 255, np.uint8)) == 0.0


def test_deskew() -> None:
    ctx = make_ctx()
    page = run(rotate_cw(line_drawing(), 3), ctx)
    assert page.page_image.deskew_deg == pytest.approx(-3.0, abs=0.2)
    assert page.page_image.rectified is False
    (warning,) = [w for w in ctx.warnings if w.code == "deskewed"]
    assert warning.params["degrees"] == round(page.page_image.deskew_deg, 1)
    # Canvas grew to fit the rotated content, and the result is straight now.
    assert page.image.shape[1] > 2000
    assert estimate_skew_deg(cv2.cvtColor(page.image, cv2.COLOR_BGR2GRAY)) == pytest.approx(0.0, abs=0.2)


def test_deskew_border_is_white() -> None:
    h, w = 1500, 2000
    grey = np.full((h, w, 3), 200, np.uint8)
    grey[:] = np.minimum(grey, line_drawing(w, h))
    m = cv2.getRotationMatrix2D(((w - 1) / 2, (h - 1) / 2), -3, 1)
    tilted = cv2.warpAffine(grey, m, (w, h), flags=cv2.INTER_CUBIC, borderValue=(200, 200, 200))
    page = run(tilted)
    assert page.page_image.deskew_deg == pytest.approx(-3.0, abs=0.2)
    out = page.image
    assert (out[0, 0] == 255).all() and (out[-1, -1] == 255).all()  # expanded canvas corners: white fill
    centre = out[out.shape[0] // 3 : 2 * out.shape[0] // 3, out.shape[1] // 3 : 2 * out.shape[1] // 3]
    assert np.median(centre) == 200  # content background untouched


def test_deskew_transform_maps_content() -> None:
    src = line_drawing()
    page = run(rotate_cw(src, 3))
    # The original page centre is the rotation centre; it must land on the new content centre.
    x, y, z = page.transform @ [(2000 - 1) / 2, (1500 - 1) / 2, 1.0]
    assert (x / z, y / z) == pytest.approx(
        ((page.image.shape[1] - 1) / 2, (page.image.shape[0] - 1) / 2), abs=1.5
    )


def test_tiny_rotation_is_not_deskewed() -> None:
    ctx = make_ctx()
    page = run(rotate_cw(line_drawing(), 0.1), ctx)
    assert page.page_image.deskew_deg == 0
    assert "deskewed" not in warning_codes(ctx)
    assert page.image.shape[:2] == (1500, 2000)


def test_large_skew_is_not_corrected() -> None:
    ctx = make_ctx()
    page = run(rotate_cw(line_drawing(), 12), ctx)
    assert page.page_image.deskew_deg == 0
    assert "deskewed" not in warning_codes(ctx)


def test_deskew_skipped_for_pdf_vector() -> None:
    ctx = make_ctx()
    tilted = rotate_cw(line_drawing(), 3)
    page = run(tilted, ctx, kind="pdf_vector")
    assert page.page_image.deskew_deg == 0
    assert "deskewed" not in warning_codes(ctx)
    assert page.image.shape == tilted.shape
    assert run(tilted, kind="pdf_raster").page_image.deskew_deg == pytest.approx(-3.0, abs=0.2)


@pytest.mark.parametrize(
    ("size", "expected_long", "factor", "warns"),
    [
        ((800, 600), 2000, 2.5, True),
        ((1200, 900), 2000, 2000 / 1200, False),
        ((6500, 1200), 6000, 6000 / 6500, False),
        ((3000, 1500), 3000, 1.0, False),
    ],
)
def test_resample_rule(size: tuple[int, int], expected_long: int, factor: float, warns: bool) -> None:
    ctx = make_ctx()
    img = np.full((size[1], size[0], 3), 255, np.uint8)
    page = run(img, ctx)
    assert max(page.image.shape[:2]) == expected_long
    assert page.page_image.resample_factor == pytest.approx(factor)
    assert (page.page_image.width, page.page_image.height) == (page.image.shape[1], page.image.shape[0])
    low = [w for w in ctx.warnings if w.code == "low_resolution"]
    assert [w.params for w in low] == ([{"longEdge": 800}] if warns else [])


def test_transform_maps_points() -> None:
    img = np.full((600, 800, 3), 255, np.uint8)
    page = run(img)
    h, w = img.shape[:2]
    x, y, z = page.transform @ [w - 1, h - 1, 1.0]
    assert (x / z, y / z) == pytest.approx((page.image.shape[1] - 1, page.image.shape[0] - 1), abs=1.5)
    x, y, z = page.transform @ [0, 0, 1.0]
    assert (x / z, y / z) == pytest.approx((0, 0), abs=1.5)

    big = np.full((1500, 6500, 3), 255, np.uint8)
    page = run(big)
    x, y, z = page.transform @ [6499, 1499, 1.0]
    assert (x / z, y / z) == pytest.approx((page.image.shape[1] - 1, page.image.shape[0] - 1), abs=1.5)


def test_page_metadata_is_passed_through() -> None:
    page = normalize(
        line_drawing(),
        source_kind="pdf_raster",
        is_photo=False,
        corners=None,
        source_page=3,
        dpi=150.0,
        ctx=make_ctx(),
    )
    assert page.page_image.source_page == 3 and page.page_image.dpi == 150.0
    assert page.dpi == 150.0 and page.source_kind == "pdf_raster"
    assert page.vector is None and page.page_size_pt is None


def test_pdf_render_is_pixel_guarded_and_transform_keeps_the_scale() -> None:
    img = np.full((1500, 2000, 3), 255, np.uint8)
    cv2.line(img, (100, 100), (1900, 100), (0, 0, 0), 3)
    ctx = make_ctx()
    page = run(img, ctx, kind="pdf_vector", max_work_pixels=1_000_000)
    assert [w.code for w in ctx.warnings] == ["image_downscaled"]
    assert page.image.shape[1] == 2000  # guard shrank it to ~1 MP, resample brought it back to 2000 px
    # Source (render frame) point -> normalized frame: render width 2000 maps to the 2000 px output.
    x, y, z = page.transform @ [1999, 1499, 1.0]
    assert (x / z, y / z) == pytest.approx((page.image.shape[1] - 1, page.image.shape[0] - 1), abs=2.0)


def test_pdf_render_below_budget_untouched() -> None:
    ctx = make_ctx()
    page = run(line_drawing(), ctx, kind="pdf_raster")
    assert ctx.warnings == []
    assert page.page_image.rectified is False


def test_deadline_is_checked() -> None:
    ctx = PipelineContext.for_request(-1, _NoIO(), debug=False)
    with pytest.raises(VisionError) as exc:
        run(line_drawing(), ctx)
    assert exc.value.code == "deadline_exceeded"
