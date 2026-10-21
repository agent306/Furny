"""Line segments, collinear merge and dominant orientation (06 §7.9)."""

import dataclasses
import time

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
from tests.support.synth import SGap, SText, SWall, SWindow, render_plan
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
    long = [s for s in segs if s.length > 100]
    horizontal = [s for s in long if s.angle_deg < 1 or s.angle_deg > 179]
    vertical = [s for s in long if 89 < s.angle_deg < 91]
    assert len(long) == 2 and len(horizontal) == 1 and len(vertical) == 1
    assert horizontal[0].width_px == pytest.approx(14, abs=2)
    assert vertical[0].width_px == pytest.approx(14, abs=2)
    # LSD also reports the end caps of the walls: they stay on the wall ends as short thin segments, and
    # are not turned into thick cross segments inside the wall.
    caps = [s for s in segs if s.length <= 100]
    assert all(s.is_thin for s in caps)
    assert caps
    for c in caps:
        mx, my = (c.p0[0] + c.p1[0]) / 2, (c.p0[1] + c.p1[1]) / 2
        at_horizontal_end = min(abs(mx - 93), abs(mx - 907)) <= 3 and abs(my - 100) <= 8
        at_vertical_end = abs(my - 507) <= 3 and abs(mx - 500) <= 8
        assert at_horizontal_end or at_vertical_end, (mx, my)


@pytest.mark.parametrize("t", [56, 70])
def test_very_thick_walls_keep_their_caps_and_centre_lines(t: int) -> None:
    """Strokes wider than a fixed search window: the search is sized from the distance transform."""
    x0, y0, x1, y1 = 600, 600, 5400, 3400
    pts = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    walls = [SWall(pts[i], pts[(i + 1) % 4], t) for i in range(4)] + [SWall((3000, 600), (3000, 2000), t)]
    segs, _ = run(render_plan((6000, 4000), walls))
    thick = [s for s in segs if not s.is_thin]
    assert len(thick) == 5, "one centre line per wall, no cross segments"
    assert all(s.length > 1000 for s in thick)
    assert all(s.width_px == pytest.approx(t, rel=0.08, abs=1.0) for s in thick)
    horizontal_y = sorted((s.p0[1] + s.p1[1]) / 2 for s in thick if s.angle_deg < 1 or s.angle_deg > 179)
    vertical_x = sorted((s.p0[0] + s.p1[0]) / 2 for s in thick if 89 < s.angle_deg < 91)
    assert horizontal_y == pytest.approx([600, 3400], abs=2)
    assert vertical_x == pytest.approx([600, 3000, 5400], abs=2)
    caps = [s for s in segs if s.length <= 100]
    assert len(caps) == 1
    cap = caps[0]
    assert cap.is_thin
    assert cap.length == pytest.approx(t, abs=3)
    assert (cap.p0[1] + cap.p1[1]) / 2 == pytest.approx(
        2000 + t / 2, abs=3
    )  # on the stub's end, not inside it


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


def test_clipped_ink_run_is_not_a_cross_section(monkeypatch: pytest.MonkeyPatch) -> None:
    """A run that reaches the end of the search window says nothing about the stroke: no snapping."""
    monkeypatch.setattr(segmod, "RIDGE_RADIUS_CAP_PX", 20)
    segs, _ = run(render_plan((4000, 1500), [SWall((200, 600), (3800, 600), 56)]))
    assert segs
    assert all(s.is_thin for s in segs)  # the edges stay on the wall boundary
    ys = sorted(round((s.p0[1] + s.p1[1]) / 2) for s in segs if s.length > 1000)
    assert ys == pytest.approx([572, 628], abs=3)


def test_merge_unequal_widths_gives_length_weighted_width() -> None:
    base = seg((0.0, 10.0), (100.0, 10.0), width=3.0)
    other = seg((90.0, 10.0), (140.0, 10.0), width=4.0)
    (merged,) = merge_collinear([base, other])
    assert merged.length == pytest.approx(140.0)
    assert merged.width_px == pytest.approx((100 * 3.0 + 50 * 4.0) / 150)


def test_merge_perpendicular_tolerance_follows_the_larger_width() -> None:
    wide = seg((0.0, 10.0), (100.0, 10.0), width=10.0)
    narrower = seg((102.0, 14.5), (160.0, 14.5), width=8.0)  # 4.5 px off: within 0.5 x 10, not 0.5 x 8
    assert len(merge_collinear([wide, narrower])) == 1


@pytest.mark.parametrize("flip", [False, True])
def test_merge_checks_both_endpoints_of_a_segment_within_the_angle_tolerance(flip: bool) -> None:
    base = seg((0.0, 10.0), (100.0, 10.0))
    ends = ((102.0, 10.0), (200.0, 12.5)) if not flip else ((102.0, 12.5), (200.0, 10.0))
    tilted = seg(*ends)  # 1.46 degrees, but 2.5 px off the line at one end (tolerance 2 px)
    assert min(tilted.angle_deg, 180 - tilted.angle_deg) <= 1.5
    assert len(merge_collinear([base, tilted])) == 2


def test_merge_thin_segment_never_extends_a_thick_one() -> None:
    wall = seg((0.0, 10.0), (100.0, 10.0), width=14.0)
    overhang = seg((80.0, 10.0), (150.0, 10.0), width=2.0)
    out = merge_collinear([wall, overhang])
    assert sorted(round(s.length) for s in out) == [70, 100]
    assert max(out, key=lambda s: s.width_px).length == pytest.approx(100.0)


def test_merge_thin_segment_inside_a_thick_one_is_absorbed() -> None:
    wall = seg((0.0, 10.0), (100.0, 10.0), width=14.0)
    inside = seg((30.0, 11.0), (60.0, 11.0), width=2.0)
    remnant = seg((98.0, 10.0), (103.0, 10.0), width=2.0)  # edge remnant at the wall end
    (merged,) = merge_collinear([wall, inside, remnant])
    assert merged.length == pytest.approx(100.0)
    assert merged.width_px == pytest.approx(14.0)


def test_window_centre_line_is_not_swallowed_by_the_wall() -> None:
    walls = [SWall((200, 300), (1800, 300), 14)]
    windows = [SWindow(0, 600, 150, lines=3, offset_sashes=True)]  # cut x 800..950 of the wall
    segs, _ = run(render_plan((2000, 600), walls, windows=windows))
    thick = [s for s in segs if not s.is_thin]
    assert all(max(s.p0[0], s.p1[0]) < 830 or min(s.p0[0], s.p1[0]) > 920 for s in thick), (
        "wall spans the opening"
    )
    centre = [s for s in segs if s.is_thin and abs((s.p0[1] + s.p1[1]) / 2 - 300) <= 1.5 and s.length > 50]
    assert centre, "the window's centre line survives"


def test_wide_segment_is_trimmed_to_its_stroke() -> None:
    """A wall's LSD edge that runs on along a window's thin face line is snapped onto the wall centre; the
    wide segment is cut back to where the stroke is at least half its width (Task 16b)."""
    ink = np.zeros((600, 1200), np.uint8)
    ink[293:307, 200:801] = 255  # a 14 px wall ending at x = 800
    ink[293:295, 800:951] = 255  # the window's thin face line continuing the wall's top face
    dt = cv2.distanceTransform(ink, cv2.DIST_L2, 3)
    p0, p1 = segmod._trim_to_stroke((200.0, 300.0), (950.0, 300.0), 13.4, dt)
    assert p0[0] == pytest.approx(203, abs=4)
    assert p1[0] == pytest.approx(797, abs=4)
    assert segmod._trim_to_stroke((0.0, 0.0), (5.0, 0.0), 13.4, dt) == ((0.0, 0.0), (5.0, 0.0))  # no stroke


def test_unsupported_segments_stay_put(monkeypatch: pytest.MonkeyPatch) -> None:
    """A segment snaps only when at least 5 of 9 normals meet a stroke, and only within 3 px of it."""
    img = render_plan(
        (300, 200),
        [
            SWall((10, 50), (60, 50), 2, style="single"),  # covers 2 of the 9 samples of segment A
            SWall((10, 70), (290, 70), 2, style="single"),  # 10 px away from segment B
            SWall((10, 120), (290, 120), 2, style="single"),
        ],
    )
    raw = np.array(
        [[10, 52, 190, 52], [10, 80, 290, 80], [10, 118, 290, 118]],  # A, B, C (C is 2 px off its line)
        np.float32,
    )
    monkeypatch.setattr(segmod, "detect_line_segments", lambda gray: raw)
    segs, _ = run(img)
    ys = sorted(round((s.p0[1] + s.p1[1]) / 2, 1) for s in segs)
    assert ys[0] == pytest.approx(52.0, abs=0.01)
    assert ys[1] == pytest.approx(80.0, abs=0.01)
    assert ys[2] == pytest.approx(119.5, abs=0.7)  # C snapped onto the stroke centre


def test_attach_widths_looks_one_pixel_to_each_side() -> None:
    img = render_plan((300, 200), [SWall((20, 100), (280, 100), 6)])  # rows 97..102, ridge rows 99 and 100
    pre = preprocess(page_of(img), make_ctx())
    off_ridge = Segment("S1", (40.0, 101.0), (260.0, 101.0), 2.0, True, "lsd")
    (out,) = segmod._attach_widths([off_ridge], pre)
    assert out.width_px == pytest.approx(6.0, abs=0.5)


def test_hough_fallback_when_lsd_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    def broken(*args: object, **kwargs: object) -> None:
        raise cv2.error("LSD is not available")

    monkeypatch.setattr(cv2, "createLineSegmentDetector", broken)
    segmod._lsd_available.cache_clear()
    try:
        img = render_plan((1000, 300), [SWall((100, 100), (900, 100), 2, style="single")])
        segs, _ = run(img)
    finally:
        monkeypatch.undo()
        segmod._lsd_available.cache_clear()
    assert segs
    assert {s.source for s in segs} == {"hough"}
    assert max(s.length for s in segs) > 700


def test_vector_is_thin_follows_merged_width() -> None:
    img = np.full((600, 900, 3), 255, np.uint8)
    page = page_of(img, kind="pdf_vector")
    vector = VectorPage(
        segments=[VSeg((50.0, 50.0), (260.0, 50.0), 3.0), VSeg((250.0, 50.0), (400.0, 50.0), 4.5)],
        filled=[],
        words=[],
        object_count=2,
    )
    page = dataclasses.replace(page, vector=vector)
    pre = dataclasses.replace(preprocess(page, make_ctx()), t_thin=2.0)
    ocr = OcrResult([], np.zeros(pre.ink.shape, np.uint8), pre.ink.copy())
    (merged,) = detect_segments(page, pre, ocr, make_ctx())
    # (210 x 3.0 + 150 x 4.5) / 360 = 3.625 > 1.8 x t_thin = 3.6, although the base segment alone is thin
    assert merged.width_px == pytest.approx(3.625)
    assert merged.is_thin is False


def test_merge_scales_to_tens_of_thousands_of_segments() -> None:
    rng = np.random.default_rng(0)
    xs, ys = rng.uniform(0, 6000, 40_000), rng.uniform(0, 4500, 40_000)
    lengths = rng.uniform(10, 60, 40_000)
    segs = [
        Segment("", (x, y), (x + n, y) if k % 2 else (x, y + n), 2.0, True, "vector")
        for k, (x, y, n) in enumerate(zip(xs.tolist(), ys.tolist(), lengths.tolist(), strict=True))
    ]
    started = time.perf_counter()
    out = merge_collinear(segs)
    elapsed = time.perf_counter() - started
    assert 30_000 < len(out) <= 40_000
    assert elapsed < 8.0  # about 1 s here; the quadratic version needed ~19 s


def test_merge_checks_the_deadline_while_a_chain_grows() -> None:
    calls: list[int] = []

    def check() -> None:
        calls.append(1)
        if len(calls) >= 2:
            raise TimeoutError

    # 3000 pieces 1 px apart fuse one neighbour per round into a single line.
    chain = [seg((float(i * 6), 0.0), (float(i * 6 + 5), 0.0)) for i in range(3000)]
    with pytest.raises(TimeoutError):
        merge_collinear(chain, check_deadline=check)


def test_merge_checks_the_deadline() -> None:
    calls: list[int] = []

    def check() -> None:
        calls.append(1)
        if len(calls) >= 2:
            raise TimeoutError

    segs = [seg((float(i * 10), 0.0), (float(i * 10 + 5), 0.0)) for i in range(2000)]
    with pytest.raises(TimeoutError):
        merge_collinear(segs, check_deadline=check)


def test_theta0_smoothing_joins_adjacent_bins() -> None:
    # 20.45 and 20.55 fall in different 0.5 degree bins; together (120) they beat the single 100 at 50.25.
    segs = [
        seg((0.0, 0.0), (60 * np.cos(np.radians(20.45)), 60 * np.sin(np.radians(20.45)))),
        seg((0.0, 0.0), (60 * np.cos(np.radians(20.55)), 60 * np.sin(np.radians(20.55)))),
        seg((0.0, 0.0), (100 * np.cos(np.radians(50.25)), 100 * np.sin(np.radians(50.25)))),
    ]
    assert dominant_orientation(segs) == pytest.approx(20.5, abs=0.1)


@pytest.mark.parametrize("angle", [5.2, 5.5])
def test_theta0_is_refined_below_the_bin_width(angle: float) -> None:
    img = render_plan((1400, 1000), rect_walls(300, 250, 1100, 750), line_px=2)
    m = cv2.getRotationMatrix2D((700.0, 500.0), -angle, 1.0)
    rotated = cv2.warpAffine(img, m, (1400, 1000), flags=cv2.INTER_LINEAR, borderValue=(255, 255, 255))
    segs, _ = run(rotated)
    assert dominant_orientation(segs) == pytest.approx(angle, abs=0.15)
