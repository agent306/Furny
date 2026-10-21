"""Page quad detection, perspective warp, illumination flattening and geometry/image helpers (06 §7.3)."""

import math

import cv2
import numpy as np
import pytest

from app.pipeline import decode
from app.pipeline.rectify import (
    detect_page_quad,
    flatten_illumination,
    quad_is_axis_aligned,
    sheet_contrast,
    warp_quad,
    warp_quad_with_matrix,
)
from app.utils.geometry import (
    Rect,
    detect_line_segments,
    odd,
    point_seg_distance,
    project_param,
    seg_angle_deg,
)
from app.utils.images import encode_jpeg, encode_png, encode_webp, resize_long_edge

CANVAS = (1600, 1300)  # width, height
CORNERS = np.array([(180, 150), (1450, 210), (1400, 1180), (140, 1100)], dtype=np.float32)


def grid_drawing(w: int = 1200, h: int = 900) -> np.ndarray:
    """White page with a black 4 px grid of rectangles."""
    page = np.full((h, w, 3), 255, np.uint8)
    cv2.rectangle(page, (30, 30), (w - 31, h - 31), (0, 0, 0), 4)
    for x in range(30, w - 30, 235):
        cv2.line(page, (x, 30), (x, h - 31), (0, 0, 0), 4)
    for y in range(30, h - 30, 215):
        cv2.line(page, (30, y), (w - 31, y), (0, 0, 0), 4)
    return page


def photo_of(
    page: np.ndarray, corners: np.ndarray = CORNERS, canvas: tuple[int, int] = CANVAS, grey: int = 128
):
    h, w = page.shape[:2]
    src = np.array([(0, 0), (w - 1, 0), (w - 1, h - 1), (0, h - 1)], dtype=np.float32)
    m = cv2.getPerspectiveTransform(src, corners)
    return cv2.warpPerspective(
        page, m, canvas, flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_CONSTANT, borderValue=(grey, grey, grey)
    )


def test_photo_quad_detected_and_rectified() -> None:
    photo = photo_of(grid_drawing())
    quad = detect_page_quad(photo)
    assert quad is not None
    assert quad.shape == (4, 2) and quad.dtype == np.float32
    tol = 0.015 * math.hypot(*CANVAS)
    for found, truth in zip(quad, CORNERS, strict=True):
        assert math.dist(found, truth) <= tol

    flat = warp_quad(photo, quad)
    segs = detect_line_segments(cv2.cvtColor(flat, cv2.COLOR_BGR2GRAY))
    long_segs = [s for s in segs if math.dist(s[:2], s[2:]) > 100]
    assert len(long_segs) >= 8
    for s in long_segs:
        a = seg_angle_deg(*map(float, s))
        assert min(a, abs(a - 90), 180 - a) <= 1.0


def test_axis_aligned_quad_is_not_photo() -> None:
    canvas = np.zeros((800, 1000, 3), np.uint8)
    canvas[3:797, 3:997] = 255
    cv2.line(canvas, (100, 100), (900, 700), (0, 0, 0), 5)
    quad = detect_page_quad(canvas)
    assert quad is not None
    assert quad_is_axis_aligned(quad, canvas.shape) is True
    explicit = np.array([(0, 0), (999, 0), (999, 799), (0, 799)], dtype=np.float32)
    assert quad_is_axis_aligned(explicit, canvas.shape) is True


def test_tilted_quad_is_not_axis_aligned() -> None:
    assert quad_is_axis_aligned(CORNERS, (CANVAS[1], CANVAS[0], 3)) is False


def test_no_quad_in_flat_image() -> None:
    assert detect_page_quad(np.full((600, 800, 3), 200, np.uint8)) is None


def test_warp_returns_source_to_output_matrix() -> None:
    photo = photo_of(grid_drawing())
    out, m = warp_quad_with_matrix(photo, CORNERS)
    h, w = out.shape[:2]
    for corner, expected in zip(CORNERS, [(0, 0), (w - 1, 0), (w - 1, h - 1), (0, h - 1)], strict=True):
        x, y, z = m @ [corner[0], corner[1], 1.0]
        assert (x / z, y / z) == pytest.approx(expected, abs=0.5)


def test_warp_output_is_capped() -> None:
    photo = photo_of(grid_drawing())
    out, _ = warp_quad_with_matrix(photo, CORNERS, max_pixels=200_000)
    assert out.shape[0] * out.shape[1] <= 200_000


def test_sheet_contrast_separates_desk_photo_from_framed_plan() -> None:
    photo = photo_of(grid_drawing(), grey=60)
    assert sheet_contrast(photo, CORNERS) > 100
    plan = np.full((800, 1000, 3), 255, np.uint8)
    inner = np.array([(60, 60), (940, 60), (940, 740), (60, 740)], dtype=np.float32)
    assert sheet_contrast(plan, inner) == 0.0
    assert sheet_contrast(plan, np.array([(0, 0), (999, 0), (999, 799), (0, 799)], dtype=np.float32)) == 0.0


def test_flatten_illumination_evens_out_gradient() -> None:
    h, w = 600, 900
    gradient = np.tile(np.linspace(110, 250, w, dtype=np.float32), (h, 1))
    gray = gradient.copy()
    cv2.line(gray, (100, 300), (800, 300), 20, 3)
    flat = flatten_illumination(gray.astype(np.uint8))
    assert flat.dtype == np.uint8
    paper = flat[100:200, :]
    assert paper.min() >= 235  # background ~uniform white instead of 110..250
    assert flat[300, 450] < 100  # ink survives


def test_geometry_helpers() -> None:
    assert seg_angle_deg(0, 0, 10, 0) == 0.0
    assert seg_angle_deg(0, 0, 10, 10) == pytest.approx(45.0)  # y down: clockwise positive
    assert seg_angle_deg(0, 0, 0, -10) == pytest.approx(90.0)
    assert seg_angle_deg(10, 0, 0, 0) == 0.0
    assert seg_angle_deg(0, 0, 10, -1) == pytest.approx(180 - math.degrees(math.atan(0.1)))
    assert point_seg_distance((5, 3), (0, 0), (10, 0)) == pytest.approx(3.0)
    assert point_seg_distance((-3, 4), (0, 0), (10, 0)) == pytest.approx(5.0)
    assert point_seg_distance((1, 1), (2, 2), (2, 2)) == pytest.approx(math.sqrt(2))
    assert project_param((5, 3), (0, 0), (10, 0)) == pytest.approx(0.5)
    assert project_param((20, 0), (0, 0), (10, 0)) == pytest.approx(2.0)
    assert project_param((1, 1), (2, 2), (2, 2)) == 0.0
    assert [odd(n) for n in (0, 1, 2, 3, 24, 25)] == [1, 1, 3, 3, 25, 25]


def test_rect() -> None:
    r = Rect(10, 20, 30, 40)
    assert r.long_side == 40
    assert r.contains((10, 20)) and r.contains((39.9, 59.9))
    assert not r.contains((40, 30)) and not r.contains((9.9, 30))
    assert r.expand(5) == Rect(5, 15, 40, 50)
    assert r.expand(-20) == Rect(30, 40, 0, 0)
    assert r.expand(100).clip(50, 60) == Rect(0, 0, 50, 60)
    assert Rect(-5, -5, 20, 20).clip(100, 100) == Rect(0, 0, 15, 15)
    assert Rect(200, 200, 10, 10).clip(100, 100).w == 0


def test_detect_line_segments_finds_lines() -> None:
    img = np.full((400, 600), 255, np.uint8)
    cv2.line(img, (50, 100), (550, 100), 0, 3)
    cv2.line(img, (300, 50), (300, 350), 0, 3)
    segs = detect_line_segments(img)
    assert segs.dtype == np.float32 and segs.ndim == 2 and segs.shape[1] == 4
    assert max(math.dist(s[:2], s[2:]) for s in segs) > 200
    assert detect_line_segments(np.full((100, 100), 255, np.uint8)).shape == (0, 4)


def test_detect_line_segments_falls_back_to_hough(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(*_: object, **__: object) -> None:
        raise cv2.error("LSD unavailable")

    monkeypatch.setattr(cv2, "createLineSegmentDetector", boom)
    img = np.full((400, 600), 255, np.uint8)
    cv2.line(img, (50, 100), (550, 100), 0, 3)
    segs = detect_line_segments(img)
    assert segs.dtype == np.float32 and segs.shape[1] == 4 and len(segs) >= 1
    assert max(math.dist(s[:2], s[2:]) for s in segs) > 200
    assert detect_line_segments(np.full((100, 100), 255, np.uint8)).shape == (0, 4)


def test_image_encoders_and_resize() -> None:
    img = grid_drawing(400, 300)
    assert cv2.imdecode(np.frombuffer(encode_png(img), np.uint8), cv2.IMREAD_COLOR).shape == img.shape
    assert encode_jpeg(img, 82)[:3] == b"\xff\xd8\xff"
    webp = encode_webp(img, 70)
    assert webp[:4] == b"RIFF" and webp[8:12] == b"WEBP"
    assert resize_long_edge(img, 400) is img
    assert resize_long_edge(img, 200).shape[:2] == (150, 200)
    assert resize_long_edge(img, 800, cv2.INTER_CUBIC).shape[:2] == (600, 800)
    assert resize_long_edge(img[:, :100], 50).shape[:2] == (50, 17)


def test_work_budget_default_is_read_at_call_time(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(decode, "MAX_WORK_PIXELS", 50_000)
    out, _ = warp_quad_with_matrix(photo_of(grid_drawing()), CORNERS)
    assert out.shape[0] * out.shape[1] <= 50_000
