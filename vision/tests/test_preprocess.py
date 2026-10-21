"""Sauvola preprocessing, style classification, thick mask and plan region (06 §7.6)."""

import cv2
import numpy as np
import pytest

from app.pipeline import binarize
from app.pipeline.binarize import Preprocessed, preprocess, sauvola_window, stroke_width_mode, thick_kernel
from app.pipeline.normalize import NormalizedPage
from app.pipeline.region import detect_plan_region
from app.schemas.meta import PageImage, SourceKind
from app.utils.geometry import Rect
from tests.support.synth import SDimChain, SText, SWall, render_plan
from tests.test_normalize import make_ctx

SIZE = (2000, 1500)


def page_of(img: np.ndarray, *, kind: SourceKind = "raster", is_photo: bool = False) -> NormalizedPage:
    h, w = img.shape[:2]
    return NormalizedPage(
        image=img,
        page_image=PageImage(
            width=w, height=h, source_page=1, dpi=None, rectified=False, deskew_deg=0.0, resample_factor=1.0
        ),
        transform=np.eye(3),
        source_kind=kind,
        is_photo=is_photo,
    )


def rectangle(
    x0: int, y0: int, x1: int, y1: int, t: int = 14, color: tuple[int, int, int] = (0, 0, 0)
) -> list[SWall]:
    pts = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    return [SWall(pts[i], pts[(i + 1) % 4], t, color=color) for i in range(4)]


def plan_walls(color: tuple[int, int, int] = (0, 0, 0)) -> list[SWall]:
    return [*rectangle(300, 300, 1700, 1200, color=color), SWall((1000, 300), (1000, 1200), 14, color=color)]


DIMS = [
    SDimChain((0, 200), "x", [300, 1000, 1700], ["7000", "7000"]),
    SDimChain((150, 0), "y", [300, 1200], ["9000"], "bar"),
]


def test_sauvola_window() -> None:
    assert sauvola_window(2000) == 33
    assert sauvola_window(600) == 15
    assert sauvola_window(6000) == 81


def test_thick_kernel() -> None:
    assert thick_kernel(2.0) == 5
    assert thick_kernel(0.5) == 3
    assert thick_kernel(10) == 15
    assert thick_kernel(3.0) == 9  # always odd


def test_stroke_width_mode_defaults_without_thin_strokes() -> None:
    assert stroke_width_mode(np.zeros((50, 50), np.uint8)) == 2.0
    solid = np.zeros((100, 100), np.uint8)
    solid[10:90, 10:90] = 255  # 80 px wide: no skeleton pixel is <= 6 px wide
    assert stroke_width_mode(solid) == 2.0


def test_line_drawing_style() -> None:
    img = render_plan(SIZE, plan_walls(), dims=DIMS, line_px=2)
    pre = preprocess(page_of(img), make_ctx())
    assert isinstance(pre, Preprocessed)
    assert pre.drawing_kind == "architectural_line_drawing"
    assert abs(pre.t_thin - 2.0) <= 0.5
    assert pre.dt.shape == pre.ink.shape and pre.dt.dtype == np.float32
    assert pre.thick.dtype == np.uint8 and set(np.unique(pre.thick)) <= {0, 255}

    wall_px = render_plan(SIZE, plan_walls()).min(axis=2) < 128
    assert (pre.thick > 0)[wall_px].mean() >= 0.90
    thin_px = render_plan(SIZE, dims=DIMS, line_px=2).min(axis=2) < 128
    assert thin_px.sum() > 2000
    assert (pre.thick > 0)[thin_px].mean() < 0.05


def test_colored_brochure_style() -> None:
    grey = (60, 60, 60)
    fills = [
        ([(300, 300), (1000, 300), (1000, 1200), (300, 1200)], (180, 200, 240)),
        ([(1000, 300), (1700, 300), (1700, 1200), (1000, 1200)], (240, 200, 180)),
    ]
    img = render_plan(SIZE, plan_walls(grey), fills=fills, dims=DIMS)
    pre = preprocess(page_of(img), make_ctx())
    assert pre.drawing_kind == "colored_brochure"
    assert pre.colorfulness > 25
    wall_px = render_plan(SIZE, plan_walls(grey)).max(axis=2) < 100
    assert (pre.thick > 0)[wall_px].mean() >= 0.90
    assert (pre.dark > 0)[wall_px].mean() >= 0.95


def test_kind_follows_source() -> None:
    img = render_plan(SIZE, plan_walls(), dims=DIMS)
    assert preprocess(page_of(img, kind="pdf_vector"), make_ctx()).drawing_kind == "cad_vector"
    assert preprocess(page_of(img, is_photo=True), make_ctx()).drawing_kind == "photo_of_drawing"


def test_illumination_flattening() -> None:
    img = render_plan(SIZE, plan_walls(), dims=DIMS, texts=[SText("LIVING", (500, 700))])
    ramp = np.linspace(0.55, 1.0, SIZE[0], dtype=np.float32)[None, :, None]
    shaded = (img.astype(np.float32) * ramp).astype(np.uint8)
    pre = preprocess(page_of(shaded, is_photo=True), make_ctx())
    k = thick_kernel(pre.t_thin)
    truth = (img.min(axis=2) < 128).astype(np.uint8)
    near_drawing = cv2.dilate(truth, np.ones((9, 9), np.uint8)) > 0
    stray = np.where(near_drawing, 0, pre.ink)[:, : SIZE[0] // 2]  # ink the drawing does not explain
    _, _, stats, _ = cv2.connectedComponentsWithStats(stray, connectivity=8)
    assert stats[1:, cv2.CC_STAT_AREA].max(initial=0) <= (3 * k) ** 2
    assert (pre.ink > 0)[truth > 0].mean() > 0.9  # the drawing itself is still ink
    assert pre.gray[20:100, :].min() >= 235  # paper evened out to white


def test_flattening_only_for_photos(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[int] = []

    def spy(gray: np.ndarray) -> np.ndarray:
        calls.append(1)
        return gray

    monkeypatch.setattr(binarize, "flatten_illumination", spy)
    img = render_plan((1000, 800), rectangle(100, 100, 800, 600))
    preprocess(page_of(img), make_ctx())
    assert calls == []
    preprocess(page_of(img, is_photo=True), make_ctx())
    assert calls == [1]


def thick_of(size: tuple[int, int], walls: list[SWall]) -> np.ndarray:
    img = render_plan(size, walls)
    return np.where(img.min(axis=2) < 128, 255, 0).astype(np.uint8)


def test_region_excludes_far_inset() -> None:
    main = rectangle(200, 100, 1400, 1000)  # 1200 x 900
    inset = rectangle(300, 1300, 700, 1500, t=24)  # 400 x 200, 28800 px vs main 58800 px
    thick = thick_of((2000, 1600), [*main, *inset])
    assert (thick[1250:] > 0).sum() >= 0.30 * (thick[:1100] > 0).sum()
    ctx = make_ctx()
    region = detect_plan_region(thick, thick, ctx)
    assert region.y + region.h < 1300
    assert [(w.code, w.params) for w in ctx.warnings] == [("plan_region_ambiguous", {"components": 2})]


def test_region_includes_near_sibling_without_warning() -> None:
    thick = thick_of((2000, 1600), [*rectangle(200, 100, 1000, 900), *rectangle(1060, 100, 1400, 900)])
    ctx = make_ctx()
    region = detect_plan_region(thick, thick, ctx)
    assert region.x <= 200 - 7 and region.x + region.w >= 1400 + 7
    assert ctx.warnings == []


def test_region_expanded_and_clipped() -> None:
    thick = thick_of((2000, 1600), rectangle(500, 400, 1300, 900))  # outer faces 493..1307 x 393..907
    region = detect_plan_region(thick, thick, make_ctx())
    ys, xs = np.nonzero(thick)
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    pad = round(0.06 * max(x1 - x0, y1 - y0))
    assert region == Rect(x0 - pad, y0 - pad, x1 - x0 + 2 * pad, y1 - y0 + 2 * pad)

    near_edge = thick_of((2000, 1600), rectangle(40, 30, 840, 530))
    clipped = detect_plan_region(near_edge, near_edge, make_ctx())
    assert (clipped.x, clipped.y) == (0, 0)
    assert clipped.x + clipped.w <= 2000 and clipped.y + clipped.h <= 1600


def test_region_empty_is_full_image() -> None:
    ctx = make_ctx()
    blank = np.zeros((1200, 1800), np.uint8)
    assert detect_plan_region(blank, blank, ctx) == Rect(0, 0, 1800, 1200)
    assert ctx.warnings == []
    pre = preprocess(page_of(np.full((1200, 1800, 3), 255, np.uint8)), ctx)
    assert pre.region == Rect(0, 0, 1800, 1200)
    assert pre.t_thin == 2.0 and pre.colorfulness == 0.0
