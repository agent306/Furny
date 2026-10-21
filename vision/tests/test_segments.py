"""Line segments, collinear merge and dominant orientation (06 §7.9)."""

import dataclasses

import cv2
import numpy as np
import pytest

from app.pipeline import segments as segmod
from app.pipeline.binarize import preprocess
from app.pipeline.ocr_stage import OcrResult
from app.pipeline.pdf import VectorPage, VSeg
from app.pipeline.segments import detect_segments, dominant_orientation, merge_collinear
from app.schemas.candidates import Segment
from app.utils.geometry import Rect
from tests.support.synth import SGap, SText, SWall, render_plan
from tests.test_normalize import make_ctx
from tests.test_preprocess import page_of


def seg(p0, p1, width=2.0, source="lsd", sid="S1"):  # type: ignore[no-untyped-def]
    return Segment(sid, p0, p1, width, width <= 3.6, source)


def run(img: np.ndarray, *, mask: np.ndarray | None = None, t_thin: float | None = None):  # type: ignore[no-untyped-def]
    """`detect_segments` on a synthetic render with the given text mask (default: no text)."""
    page = page_of(img)
    pre = preprocess(page, make_ctx())
    if t_thin is not None:
        pre = dataclasses.replace(pre, t_thin=t_thin)
    mask = np.zeros(pre.ink.shape, np.uint8) if mask is None else mask
    ink_notext = pre.ink.copy()
    ink_notext[mask > 0] = 0
    ocr = OcrResult(tokens=[], text_mask=mask, ink_notext=ink_notext)
    return detect_segments(page, pre, ocr, make_ctx()), pre


def rect_walls(x0: int, y0: int, x1: int, y1: int, t: int = 2, style: str = "single") -> list[SWall]:
    pts = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    return [SWall(pts[i], pts[(i + 1) % 4], t, style=style) for i in range(4)]  # type: ignore[arg-type]


def axis_error(s: Segment) -> float:
    a = s.angle_deg % 90.0
    return min(a, 90.0 - a)


def test_rectangle_outline() -> None:
    img = render_plan((1000, 700), rect_walls(100, 100, 900, 600), line_px=2)
    segs, _ = run(img)
    assert len(segs) == 4
    assert all(s.length > 400 for s in segs)
    assert all(axis_error(s) <= 1.0 for s in segs)
    assert [s.id for s in segs] == ["S1", "S2", "S3", "S4"]
    assert {s.source for s in segs} == {"lsd"}
    # Each outline edge becomes one centreline (both LSD edges of a 2 px stroke collapse onto it).
    ys = sorted((s.p0[1] + s.p1[1]) / 2 for s in segs if s.angle_deg < 1 or s.angle_deg > 179)
    assert ys[0] == pytest.approx(99.5, abs=1.0)
    assert ys[1] == pytest.approx(599.5, abs=1.0)


@pytest.mark.parametrize(("gap", "expected"), [(3, 1), (12, 2)])
def test_merge_small_gap(gap: int, expected: int) -> None:
    walls = [SWall((100, 100), (900, 100), 2, style="single")]
    img = render_plan((1000, 300), walls, gaps=[SGap(0, 500, gap)], line_px=2)
    segs, _ = run(img)
    assert len(segs) == expected


def test_merge_gap_boundary_on_segments() -> None:
    a = seg((0.0, 10.0), (100.0, 10.0))
    near = seg((103.9, 10.0), (200.0, 10.0))
    far = seg((104.5, 10.0), (200.0, 10.0))
    assert len(merge_collinear([a, near])) == 1
    assert len(merge_collinear([a, far])) == 2


def test_width_attached() -> None:
    walls = [
        SWall((100, 100), (900, 100), 6, style="filled"),
        SWall((100, 300), (900, 300), 2, style="single"),
    ]
    segs, _ = run(render_plan((1000, 450), walls, line_px=2), t_thin=2.0)
    thick = [s for s in segs if s.p0[1] < 200]
    thin = [s for s in segs if s.p0[1] > 200]
    assert len(thick) == 1 and len(thin) == 1
    assert thick[0].width_px == pytest.approx(6, abs=1)
    assert thick[0].is_thin is False
    assert thin[0].width_px == pytest.approx(2, abs=1)
    assert thin[0].is_thin is True
    # The two LSD edges of the 6 px stroke are moved onto its centre line.
    assert (thick[0].p0[1] + thick[0].p1[1]) / 2 == pytest.approx(99.5, abs=1.0)
    assert thick[0].length > 790


def test_filled_wall_with_junction_is_one_centreline_per_wall() -> None:
    walls = [SWall((100, 100), (900, 100), 14), SWall((500, 100), (500, 500), 14)]
    segs, _ = run(render_plan((1000, 600), walls, line_px=2))
    long = [s for s in segs if s.length > 100]  # LSD also reports the short end caps of the walls
    horizontal = [s for s in long if s.angle_deg < 1 or s.angle_deg > 179]
    vertical = [s for s in long if 89 < s.angle_deg < 91]
    assert len(horizontal) == 1 and len(vertical) == 1
    assert horizontal[0].width_px == pytest.approx(14, abs=2)
    assert vertical[0].width_px == pytest.approx(14, abs=2)


def test_double_line_wall_keeps_two_thin_lines() -> None:
    walls = [SWall((100, 100), (900, 100), 16, style="double")]
    segs, _ = run(render_plan((1000, 300), walls, line_px=2))
    assert len(segs) == 2
    assert all(s.is_thin for s in segs)
    ys = sorted((s.p0[1] + s.p1[1]) / 2 for s in segs)
    assert ys[1] - ys[0] == pytest.approx(16, abs=1.5)


@pytest.mark.parametrize(
    ("size", "kept"),
    [
        ((200, 100), [9, 20, 180]),  # L = 200: the 8 px floor applies (7 px and 5 px are dropped)
        ((2000, 100), [20, 180]),  # L = 2000: 0.008 L = 16 px (7, 9 and 5 px are dropped)
    ],
)
def test_min_length(monkeypatch: pytest.MonkeyPatch, size: tuple[int, int], kept: list[int]) -> None:
    """Segments shorter than max(8, 0.008 L) are dropped; L is the long side of the plan region."""
    raw = np.array(
        [
            [10, 20, 17, 20],  # 7 px
            [10, 40, 19, 40],  # 9 px
            [10, 60, 15, 60],  # 5 px
            [10, 80, 30, 80],  # 20 px
            [10, 90, 190, 90],  # 180 px
        ],
        np.float32,
    )
    monkeypatch.setattr(segmod, "detect_line_segments", lambda gray: raw)
    segs, pre = run(np.full((100, size[0], 3), 255, np.uint8))
    assert pre.region == Rect(0, 0, *size)
    assert sorted(round(s.length) for s in segs) == sorted(kept)


def test_source_is_hough_without_lsd(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(segmod, "_lsd_available", lambda: False)
    img = render_plan((1000, 300), [SWall((100, 100), (900, 100), 2, style="single")])
    segs, _ = run(img)
    assert segs
    assert {s.source for s in segs} == {"hough"}


def test_text_painted_white() -> None:
    text = SText("BEDROOM", (400, 160), scale=1.2, thickness=2)
    img = render_plan((1000, 300), [SWall((100, 150), (900, 150), 2, style="single")], texts=[text])
    (tw, th), base = cv2.getTextSize("BEDROOM", cv2.FONT_HERSHEY_SIMPLEX, 1.2, 2)
    mask = np.zeros(img.shape[:2], np.uint8)
    mask[160 - th - 4 : 160 + base + 4, 400 - 4 : 400 + tw + 4] = 255

    with_text, pre = run(img, mask=mask)
    long_floor = 0.02 * pre.region.long_side
    assert with_text, "the two line halves remain"
    assert all(s.length > long_floor for s in with_text)

    unmasked, _ = run(img)
    assert any(s.length <= long_floor for s in unmasked), "glyph strokes do show up without the mask"


def test_theta0() -> None:
    img = render_plan((1400, 1000), rect_walls(300, 250, 1100, 750), line_px=2)
    m = cv2.getRotationMatrix2D((700.0, 500.0), -5.0, 1.0)  # clockwise on screen
    rotated = cv2.warpAffine(img, m, (1400, 1000), flags=cv2.INTER_LINEAR, borderValue=(255, 255, 255))
    segs, _ = run(rotated)
    assert dominant_orientation(segs) == pytest.approx(5.0, abs=0.5)


def test_theta0_unit() -> None:
    assert dominant_orientation([]) == 0.0
    near_axis = [seg((0.0, 0.0), (100.0, 0.0)), seg((0.0, 5.0), (100.0, 5.0)), seg((0.0, 0.0), (0.0, 100.0))]
    theta = dominant_orientation(near_axis)
    assert min(theta, 90.0 - theta) <= 0.5  # circular: just below 90 is as good as 0
    assert 0.0 <= theta < 90.0
    # Length-weighted: the long 30 degree segment outweighs the short axis ones.
    mixed = [seg((0.0, 0.0), (86.6, 50.0)), seg((0.0, 0.0), (10.0, 0.0))]
    assert dominant_orientation(mixed) == pytest.approx(30.0, abs=0.5)


def test_vector_segments() -> None:
    img = np.full((600, 900, 3), 255, np.uint8)
    page = page_of(img, kind="pdf_vector")
    transform = np.array([[2.0, 0.0, 10.0], [0.0, 2.0, 20.0], [0.0, 0.0, 1.0]])
    vector = VectorPage(
        segments=[VSeg((50.0, 50.0), (200.0, 50.0), 1.5), VSeg((50.0, 50.0), (50.0, 150.0), 3.0)],
        filled=[],
        words=[],
        object_count=2,
    )
    page = dataclasses.replace(page, transform=transform, vector=vector)
    pre = preprocess(page, make_ctx())
    pre = dataclasses.replace(pre, t_thin=2.0)
    ocr = OcrResult([], np.zeros(pre.ink.shape, np.uint8), pre.ink.copy())
    segs = detect_segments(page, pre, ocr, make_ctx())
    assert len(segs) == 2
    assert {s.source for s in segs} == {"vector"}
    by_angle = sorted(segs, key=lambda s: s.angle_deg)
    horiz, vert = by_angle
    assert (horiz.p0, horiz.p1) == ((110.0, 120.0), (410.0, 120.0))
    assert (vert.p0, vert.p1) == ((110.0, 120.0), (110.0, 320.0))
    assert horiz.width_px == pytest.approx(3.0)  # PDF line width scaled by the transform
    assert vert.width_px == pytest.approx(6.0)
    assert horiz.is_thin is True  # 3.0 <= 1.8 * 2
    assert vert.is_thin is False


def test_vector_segments_are_merged() -> None:
    img = np.full((600, 900, 3), 255, np.uint8)
    page = page_of(img, kind="pdf_vector")
    vector = VectorPage(
        segments=[VSeg((50.0, 50.0), (200.0, 50.0), 2.0), VSeg((202.0, 50.0), (400.0, 50.0), 2.0)],
        filled=[],
        words=[],
        object_count=2,
    )
    page = dataclasses.replace(page, vector=vector)
    pre = preprocess(page, make_ctx())
    ocr = OcrResult([], np.zeros(pre.ink.shape, np.uint8), pre.ink.copy())
    segs = detect_segments(page, pre, ocr, make_ctx())
    assert len(segs) == 1
    assert segs[0].length == pytest.approx(350.0)


def test_tiled_detection_merges_seams(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(segmod, "TILE_PX", 400)
    monkeypatch.setattr(segmod, "TILE_OVERLAP_PX", 64)
    img = render_plan((1000, 700), rect_walls(100, 100, 900, 600), line_px=2)
    segs, _ = run(img)
    assert len(segs) == 4
    assert sorted(round(s.length) for s in segs) == pytest.approx([500, 500, 800, 800], abs=6)


@pytest.mark.parametrize(
    ("other", "merged"),
    [
        (seg((102.0, 11.0), (200.0, 11.0)), True),  # 1 px off the line, 2 px gap
        (seg((105.0, 11.0), (200.0, 11.0)), False),  # 5 px gap
        (seg((102.0, 14.0), (200.0, 14.0)), False),  # 4 px off a 2 px line
        (seg((102.0, 10.0), (200.0, 13.5)), False),  # about 2 degrees
        (seg((102.0, 10.0), (200.0, 12.0)), True),  # about 1.2 degrees, 2 px off at the far end
        (seg((50.0, 10.5), (150.0, 10.5)), True),  # overlapping
    ],
)
def test_merge_tolerances(other: Segment, merged: bool) -> None:
    base = seg((0.0, 10.0), (100.0, 10.0))
    assert (len(merge_collinear([base, other])) == 1) is merged


def test_merge_thick_uses_half_width_tolerance() -> None:
    a = seg((0.0, 10.0), (100.0, 10.0), width=10.0)
    b = seg((102.0, 14.0), (200.0, 14.0), width=10.0)  # 4 px off, but 4 <= 0.5 * 10
    out = merge_collinear([a, b])
    assert len(out) == 1
    assert out[0].width_px == pytest.approx(10.0)
    assert out[0].length == pytest.approx(200.0, abs=0.5)


def test_merge_is_union_of_projections_on_longer_direction() -> None:
    long = seg((0.0, 0.0), (200.0, 0.0))
    short = seg((150.0, 1.0), (260.0, 1.0))
    (merged,) = merge_collinear([short, long])
    assert merged.p0 == pytest.approx((0.0, 0.0))  # on the longer one's line
    assert merged.p1 == pytest.approx((260.0, 0.0))
    assert merged.id == "S1"


def test_merge_orders_and_numbers_by_min_y_then_min_x() -> None:
    segs = [
        seg((500.0, 300.0), (500.0, 100.0), sid="a"),
        seg((900.0, 50.0), (950.0, 50.0), sid="b"),
        seg((10.0, 50.0), (60.0, 50.0), sid="c"),
    ]
    out = merge_collinear(segs)
    assert [s.id for s in out] == ["S1", "S2", "S3"]
    assert [(min(s.p0[1], s.p1[1]), min(s.p0[0], s.p1[0])) for s in out] == [(50, 10), (50, 900), (100, 500)]
    # Endpoints follow the segment's angle: p0 -> p1 points along angle_deg.
    vertical = out[2]
    assert vertical.p0 == (500.0, 100.0)
    assert vertical.p1 == (500.0, 300.0)


def test_merge_angle_wraps_at_180() -> None:
    a = seg((0.0, 0.0), (100.0, 0.1))  # ~0.06 degrees
    b = seg((101.0, 0.1), (200.0, -0.05))  # ~179.9 degrees
    assert len(merge_collinear([a, b])) == 1


def test_merge_empty() -> None:
    assert merge_collinear([]) == []
