"""Sauvola preprocessing, style classification, thick mask and plan region (06 §7.6)."""

import json
import subprocess
import sys
import time
from pathlib import Path

import cv2
import numpy as np
import pytest
from skimage.filters import threshold_sauvola

from app.pipeline import binarize
from app.pipeline.binarize import (
    Preprocessed,
    preprocess,
    sauvola_ink,
    sauvola_window,
    stroke_width_mode,
    thick_kernel,
)
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


def test_sauvola_ink_matches_skimage() -> None:
    rng = np.random.default_rng(7)
    gray = np.full((900, 1300), 235, np.uint8)
    gray[200:700, 300:1000] = rng.integers(0, 256, (500, 700))  # noisy block, hard for equality
    gray[:, :600] = (gray[:, :600] * np.linspace(0.5, 1.0, 600)[None, :]).astype(np.uint8)
    gray = (gray.astype(int) + rng.integers(-6, 7, gray.shape)).clip(0, 255).astype(np.uint8)
    for window in (15, 33, 81):
        expected = np.where(gray < threshold_sauvola(gray, window_size=window, k=0.2), 255, 0)
        assert np.array_equal(sauvola_ink(gray, window), expected.astype(np.uint8)), window


_PEAK_SCRIPT = """
import json
from app.pipeline.binarize import preprocess
from tests.support.synth import SWall, render_plan
from tests.test_normalize import make_ctx
from tests.test_preprocess import page_of

def status(key):
    for line in open("/proc/self/status"):
        if line.startswith(key + ":"):
            return int(line.split()[1]) * 1024

img = render_plan((6000, 4000), [SWall((900, 900), (5100, 900), 30), SWall((900, 900), (900, 3300), 30)])
page = page_of(img)
before = status("VmRSS")
pre = preprocess(page, make_ctx())
print(json.dumps({"peak_delta": status("VmHWM") - before, "nbytes": img.nbytes, "kind": pre.drawing_kind}))
"""


@pytest.mark.skipif(not Path("/proc/self/status").exists(), reason="needs /proc for peak RSS")
def test_preprocess_peak_memory_is_bounded() -> None:
    """06 §5.2 budget (1.5 GB per run): skimage's float64 integral images peaked at ~1.5 GB here."""
    root = Path(__file__).resolve().parents[1]
    proc = subprocess.run(
        [sys.executable, "-c", _PEAK_SCRIPT],
        cwd=root,
        env={"PYTHONPATH": str(root), "PATH": ""},
        capture_output=True,
        text=True,
        check=True,
    )
    result = json.loads(proc.stdout)
    assert result["kind"] == "architectural_line_drawing"
    assert result["peak_delta"] < 1_000_000_000, result


# --- Task 16b: adaptive dark mask (R3), t_thin under upscaling (R5), bold strokes and the region (R4) ---


def test_dark_threshold_follows_grey_walls() -> None:
    """Ruling R3: brochure walls drawn mid-grey (V 130) are dark; a fixed V < 90 would miss them."""
    grey = (130, 130, 130)
    fills = [
        ([(300, 300), (1000, 300), (1000, 1200), (300, 1200)], (180, 200, 240)),
        ([(1000, 300), (1700, 300), (1700, 1200), (1000, 1200)], (240, 200, 180)),
    ]
    img = render_plan(SIZE, plan_walls(grey), fills=fills, dims=DIMS, texts=[SText("LIVING", (500, 700))])
    pre = preprocess(page_of(img), make_ctx())
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    assert 130 <= binarize.dark_threshold(hsv[..., 2]) <= 170
    wall_px = render_plan(SIZE, plan_walls(grey)).max(axis=2) < 200
    assert (pre.dark > 0)[wall_px].mean() >= 0.95
    assert (pre.thick > 0)[wall_px].mean() >= 0.90
    fill_px = (img == (180, 200, 240)).all(axis=2)
    assert (pre.dark > 0)[fill_px].mean() == 0.0


def test_dark_threshold_is_clamped() -> None:
    black_ink = np.full((100, 100), 255, np.uint8)
    black_ink[40:60, :] = 0
    assert binarize.dark_threshold(black_ink) == 90.0  # Otsu of pure black would be 0
    pale = np.full((100, 100), 255, np.uint8)
    pale[:30, :] = 200
    pale[30:60, :] = 240
    assert binarize.dark_threshold(pale) == 170.0
    assert binarize.dark_threshold(np.full((10, 10), 255, np.uint8)) == 90.0  # paper only


def test_coloured_hatch_is_not_dark() -> None:
    """Saturated hatching stays out of `dark` whatever its brightness; near-black tinted strokes (navy
    outlines, S ~ 120 at V ~ 40) are dark, which the plain 06 `S < 60` test rejected."""
    img = np.full((400, 600, 3), 255, np.uint8)
    for x in range(0, 600, 12):
        cv2.line(img, (x, 0), (x + 200, 200), (0, 0, 200), 3)  # red hatch, V 200
        cv2.line(img, (x, 200), (x + 200, 400), (120, 40, 0), 3)  # dark blue hatch, V 120, chroma 120
    img[180:220, 100:500] = (40, 33, 21)  # navy band, chroma 19
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    dark = binarize.dark_mask(hsv) > 0
    assert hsv[200, 300, 1] > 60  # the old S test would have rejected the navy band
    assert dark[185:215, 105:495].all()
    hatch = (img == (0, 0, 200)).all(axis=2) | (img == (120, 40, 0)).all(axis=2)
    assert hatch.sum() > 10000
    assert not dark[hatch].any()


def _upscaled_page(scale: float) -> NormalizedPage:
    src = render_plan((540, 380), rectangle(60, 60, 480, 320, t=6), line_px=2)
    for y in range(80, 310, 12):  # 2 px line work (furniture, hatch) dominates the stroke widths
        cv2.line(src, (80, y), (460, y), (0, 0, 0), 2)
    img = cv2.resize(src, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    page = page_of(img)
    image = page.page_image.model_copy(update={"resample_factor": scale})
    return NormalizedPage(img, image, page.transform, page.source_kind, page.is_photo)


def test_t_thin_survives_upscaling() -> None:
    """Ruling R5: a 3.7x upscaled source draws its 2 px lines as ~12 px of ink (cubic blur + Sauvola). The
    6 px search range is in source pixels, so t_thin is that width; a fixed 6 px range cuts the lines off
    and reports anti-aliasing debris."""
    pre = preprocess(_upscaled_page(3.7), make_ctx())
    column = pre.ink[:, 1000] > 0
    edges = np.flatnonzero(np.diff(column.astype(np.int8)))
    runs = edges[1::2] - edges[0::2]
    line_width = float(np.median(runs))  # the line work's ink width across
    assert line_width == pytest.approx(12, abs=1)
    assert abs(pre.t_thin - line_width) <= 1.5
    fixed = stroke_width_mode(pre.ink)  # the range not scaled (upscale 1)
    assert fixed <= 6.0
    assert abs(fixed - line_width) > 3.0
    assert stroke_width_mode(pre.ink, upscale=3.7) == pre.t_thin
    assert stroke_width_mode(pre.ink, upscale=0.5) == fixed  # downscaled pages keep the plain range


def test_bold_strokes_keep_long_bold_lines_only() -> None:
    ink = np.zeros((600, 800), np.uint8)
    cv2.line(ink, (50, 100), (750, 100), 255, 7)  # bold, long
    cv2.line(ink, (50, 300), (750, 300), 255, 3)  # thin
    ink[450:480, 100:130] = 255  # bold but short (a glyph)
    bold = binarize.bold_strokes(ink, t_thin=3.75, min_len=0.04 * 800)
    assert bold[95:106, 60:740].mean() > 200
    assert not bold[290:311].any()
    assert not bold[440:490].any()


def _outline_plan() -> np.ndarray:
    """A plan drawn like the HDB reference: 7 px bold outline strokes, two black column blocks, 3 px line
    work (so t_thin ~ 3.75 and the bold strokes are neither thin nor wide enough for `thick`)."""
    walls = rectangle(300, 300, 1700, 1200, t=7)
    walls += [SWall((300, 300), (300, 360), 40), SWall((1700, 1140), (1700, 1200), 40)]
    return render_plan(SIZE, walls, dims=DIMS, line_px=3)


def test_region_follows_a_bold_outline_not_one_column() -> None:
    """Ruling R4: the outline strokes are not in `thick` (only the two columns are); the region still covers
    the whole outline, not one column."""
    pre = preprocess(page_of(_outline_plan()), make_ctx())
    assert pre.t_thin == pytest.approx(3.75)
    assert not pre.thick[700:800, 1690:1710].any()  # the outline is not thick ...
    assert pre.thick[280:380, 280:320].any()  # ... the columns are
    r = pre.region
    assert r.x < 300 and r.y < 300 and r.x + r.w > 1700 and r.y + r.h > 1200
    # Discriminating: the thick mask alone, without bold strokes or ink links (the 06 §7.6 rule), is one
    # column.
    old = detect_plan_region(pre.thick, np.zeros_like(pre.ink), make_ctx())
    assert old.w < 400 and old.h < 400


def test_region_joins_pieces_linked_by_ink_and_drops_an_unlinked_drawing() -> None:
    """The main plan's walls are split by a 300 px window (> 0.05 x long edge) whose thin frame lines join
    them; a separate drawing 200 px below, with more wall pixels than either half, shares no ink with it."""
    size = (2000, 1900)
    halves = [*rectangle(200, 150, 800, 900, t=16), *rectangle(1100, 150, 1800, 900, t=16)]
    other = rectangle(300, 1100, 1500, 1500, t=16)
    frame = [SWall((800, 150 + dy), (1100, 150 + dy), 2, style="single") for dy in (-4, 4)]
    frame += [SWall((800, 900 + dy), (1100, 900 + dy), 2, style="single") for dy in (-4, 4)]
    img = render_plan(size, [*halves, *frame, *other])
    ctx = make_ctx()
    pre = preprocess(page_of(img), ctx)
    r = pre.region
    assert r.x < 200 and r.x + r.w > 1800
    assert r.y + r.h < 1100  # the drawing below is excluded
    assert [(w.code, w.params) for w in ctx.warnings] == [("plan_region_ambiguous", {"components": 2})]
    # Discriminating: without the frame lines the halves are two drawings and the one below is the largest.
    bare = preprocess(page_of(render_plan(size, [*halves, *other])), make_ctx()).region
    assert bare.y + bare.h > 1500


def test_region_grouping_matches_the_pairwise_rule() -> None:
    """Task 16c (review Minor 3): the sweep over x-sorted boxes groups exactly like the old all-pairs rule
    (gap <= near in both axes, plus the ink links), without n x n arrays."""
    from app.pipeline.region import _groups

    rng = np.random.default_rng(7)
    xy = rng.integers(0, 3000, (300, 2))
    wh = rng.integers(1, 120, (300, 2))
    boxes = np.hstack([xy, xy + wh]).astype(np.int64)
    linked = np.array([[3, 250], [17, 18]], np.intp)
    near = 40.0

    def brute() -> list[int]:
        parent = list(range(len(boxes)))

        def find(i: int) -> int:
            while parent[i] != i:
                i = parent[i]
            return i

        pairs = [tuple(p) for p in linked.tolist()]
        for i in range(len(boxes)):
            for j in range(i + 1, len(boxes)):
                gx = max(boxes[j, 0] - boxes[i, 2], boxes[i, 0] - boxes[j, 2])
                gy = max(boxes[j, 1] - boxes[i, 3], boxes[i, 1] - boxes[j, 3])
                if max(gx, gy, 0) <= near:
                    pairs.append((i, j))
        for i, j in pairs:
            ri, rj = find(i), find(j)
            if ri != rj:
                parent[max(ri, rj)] = min(ri, rj)
        return [find(i) for i in range(len(boxes))]

    calls: list[int] = []
    got = _groups(boxes, near, linked, lambda: calls.append(1))
    assert got.tolist() == brute()
    assert len(calls) >= len(boxes) // 64


def test_region_grouping_of_many_components_is_bounded_and_polls_the_deadline(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """1600 wall components that stay apart under the 0.02 L closing (20 px squares 150 px apart on a 6000 px
    sheet, the closing is 121 px; Task 16c review, Minor 2): the sweep groups them fast and stops at the
    deadline."""
    from app.api.errors import VisionError
    from app.pipeline import region as regionmod

    thick = np.zeros((6000, 6000), np.uint8)
    for k in range(1600):
        y, x = divmod(k, 40)
        thick[150 * y + 10 : 150 * y + 30, 150 * x + 10 : 150 * x + 30] = 255
    seen: list[int] = []
    real = regionmod._groups

    def spy(boxes: np.ndarray, *args: object) -> np.ndarray:
        seen.append(len(boxes))
        return real(boxes, *args)  # type: ignore[arg-type]

    monkeypatch.setattr(regionmod, "_groups", spy)
    start = time.perf_counter()
    detect_plan_region(thick, np.zeros_like(thick), make_ctx())
    assert time.perf_counter() - start < 3.0
    assert seen == [1600]
    ctx = make_ctx()
    ctx.deadline = 0.0
    with pytest.raises(VisionError) as err:
        detect_plan_region(thick, np.zeros_like(thick), ctx)
    assert err.value.code == "deadline_exceeded"


def test_region_of_a_double_line_plan_with_one_column_holds_the_plan() -> None:
    """Task 16c: the plan's only thick stroke is one solid column; the region is found from the double-line
    walls' strips as well (`double_line_strips`), not collapsed onto the column."""
    pts = [(300, 300), (1700, 300), (1700, 1200), (300, 1200)]
    walls = [SWall(pts[i], pts[(i + 1) % 4], 14, style="double") for i in range(4)]
    walls.append(SWall((700, 700), (700, 780), 40))
    pre = preprocess(page_of(render_plan(SIZE, walls)), make_ctx())
    r = pre.region
    assert r.x < 300 and r.y < 300 and r.x + r.w > 1700 and r.y + r.h > 1200
    # Discriminating: thick and bold strokes alone (the R4 rule) give the column's box.
    alone = detect_plan_region(
        pre.thick, pre.ink, make_ctx(), bold=binarize.bold_strokes(pre.ink, pre.t_thin, 80)
    )
    assert alone.w < 400 and alone.h < 400


def test_lone_double_line_strip_does_not_grow_the_region() -> None:
    """A straight pair of thin lines in the margin (two extension lines, a stacked chain) leaves no strip:
    only strips joined into a structure spanning both directions count."""
    ink = np.zeros((1500, 2000), np.uint8)
    ink[100:102, 300:1500] = 255
    ink[112:114, 300:1500] = 255
    assert not binarize.double_line_strips(ink, 2.0, 2000).any()
    ink[100:1000, 300:302] = 255  # the pair turns a corner into a vertical pair: a wall outline
    ink[112:1000, 312:314] = 255
    assert binarize.double_line_strips(ink, 2.0, 2000).any()


def _grid(img: np.ndarray, x0: int, y0: int, x1: int, y1: int, step: int) -> None:
    for y in range(y0, y1 + 1, step):
        img[y : y + 2, x0:x1] = 0
    for x in range(x0, x1 + 1, step):
        img[y0:y1, x : x + 2] = 0


def _small_plan(style: str) -> np.ndarray:
    pts = [(200, 300), (1100, 300), (1100, 1000), (200, 1000)]
    walls = [SWall(pts[i], pts[(i + 1) % 4], 14, style) for i in range(4)]  # type: ignore[arg-type]
    return render_plan((2400, 1700), [*walls, SWall((650, 300), (650, 1000), 14, style)])  # type: ignore[arg-type]


@pytest.mark.parametrize("style", ["filled", "double"])
@pytest.mark.parametrize("case", ["table", "terrace", "hatch"])
def test_grids_and_hatching_do_not_become_the_plan_region(style: str, case: str) -> None:
    """Task 16c review, Important 2: a schedule table (40 px cells) at the sheet's right, a tiled terrace
    (30 px grid) beside the plan and a 45-degree hatch block leave the region on the plan: periodic grids
    and hatching make no double-line strips."""
    base = _small_plan(style)
    img = base.copy()
    if case == "table":
        _grid(img, 1500, 200, 2300, 1500, 40)
    elif case == "terrace":
        _grid(img, 1200, 300, 1700, 1000, 30)
    else:
        for k in range(-1400, 1400, 12):
            cv2.line(img, (1500 + k, 1500), (1500 + k + 1300, 200), (0, 0, 0), 2)
        img[:, :1450] = base[:, :1450]
        img[:, 2350:] = 255
        img[:150] = 255
        img[1550:] = 255
    alone = preprocess(page_of(base), make_ctx()).region
    with_it = preprocess(page_of(img), make_ctx()).region
    assert with_it == alone
    assert alone.x < 200 and alone.x + alone.w > 1100 and alone.x + alone.w < 1250


def _table(img: np.ndarray, x0: int, y0: int, rows: list[int], cols: list[int], text: bool = False) -> None:
    """A table of 2 px lines with the given row heights and column widths, optionally with a short text
    in each cell at least 28 px high."""
    ys, xs = np.cumsum([y0, *rows]), np.cumsum([x0, *cols])
    for y in ys:
        img[y : y + 2, xs[0] : xs[-1]] = 0
    for x in xs:
        img[ys[0] : ys[-1], x : x + 2] = 0
    if text:
        for i, h in enumerate(rows):
            for j in range(len(cols)):
                if h >= 28:
                    org = (int(xs[j]) + 8, int(ys[i]) + h - 8)
                    cv2.putText(img, f"AB-{i * 7 + j}", org, cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 1)


IRREGULAR_ROWS = [26, 44, 30, 38, 22, 46, 34, 28, 41, 25, 36, 47, 29, 33, 43, 24, 39, 31, 45, 27, 35, 42, 23]


@pytest.mark.parametrize("style", ["filled", "double"])
@pytest.mark.parametrize("case", ["title-block", "schedule"])
def test_tables_with_uneven_rows_do_not_become_the_plan_region(style: str, case: str) -> None:
    """Fix round 2 (re-review, Important 2): a title-block table and a 2-column schedule with uneven rows
    (22-47 px, so no periodic grid) at the sheet's right. Their strips fill their boxes, so they are no
    strip candidates for the region at all."""
    base = _small_plan(style)
    img = base.copy()
    if case == "title-block":
        _table(img, 1500, 200, IRREGULAR_ROWS + IRREGULAR_ROWS[:10], [130, 260, 90, 210, 110])
    else:
        _table(img, 1500, 200, IRREGULAR_ROWS[:20], [400, 400])
    alone = preprocess(page_of(base), make_ctx()).region
    ctx = make_ctx()
    assert preprocess(page_of(img), ctx).region == alone
    assert alone.x + alone.w < 1250
    if case == "title-block frame":  # a rival outside the region, excluded and warned about
        assert [(w.code, w.params) for w in ctx.warnings] == [("plan_region_ambiguous", {"components": 2})]


def test_a_double_line_plan_wins_over_a_table_with_text() -> None:
    """Fix round 2: a double-line plan and a larger table whose narrow rows (strips) alternate with tall
    ones, so its strips fill under half of its box; its cells hold text, so it is no plan. Without the
    text the table's strips, larger than the plan's, would take the region: the text rule decides."""
    rows = [34, 90, 30, 85, 36, 95, 32, 88, 34, 92, 30, 86, 33]
    base = _small_plan("double")
    alone = preprocess(page_of(base), make_ctx()).region
    img = base.copy()
    _table(img, 1350, 150, rows, [260, 300, 380], text=True)
    assert preprocess(page_of(img), make_ctx()).region == alone
    empty = base.copy()
    _table(empty, 1350, 150, rows, [260, 300, 380])
    assert preprocess(page_of(empty), make_ctx()).region.x > 1100  # discriminating


@pytest.mark.parametrize("rooms", [2, 4, 6])
@pytest.mark.parametrize("column", [False, True])
def test_regular_double_line_plans_hold_the_region(rooms: int, column: bool) -> None:
    """The re-review's regular plans: n x n equal rooms in double lines (equal pitch, but no table: the
    strips are thin walls around wide rooms), with or without a solid 40 px column (a drawing of its own,
    with far less wall mass). The region is the whole plan."""
    x0, y0, w, h = 300, 300, 1500, 1200
    walls = []
    for i in range(rooms + 1):
        y, x = y0 + h * i // rooms, x0 + w * i // rooms
        walls += [SWall((x0, y), (x0 + w, y), 14, "double"), SWall((x, y0), (x, y0 + h), 14, "double")]
    if column:
        walls.append(SWall((x0 + 40, y0 + 40), (x0 + 40, y0 + 120), 40))
    r = preprocess(page_of(render_plan((2400, 1800), walls)), make_ctx()).region
    assert r.x < x0 and r.y < y0 and r.x + r.w > x0 + w and r.y + r.h > y0 + h


def _plan_walls(style: str, t: int = 14) -> list[SWall]:
    pts = [(200, 300), (1100, 300), (1100, 1000), (200, 1000)]
    walls = [SWall(pts[i], pts[(i + 1) % 4], t, style) for i in range(4)]  # type: ignore[arg-type]
    return [*walls, SWall((650, 300), (650, 1000), t, style)]  # type: ignore[arg-type]


@pytest.mark.parametrize("style", ["filled", "double"])
@pytest.mark.parametrize("case", ["rule", "title-block frame"])
def test_a_bold_rule_or_frame_does_not_take_the_region(style: str, case: str) -> None:
    """Fix round 3 (re-review 2, R2-1): an 800 px bold rule, or a bold title-block frame, at the sheet's
    right. Every drawing is a candidate on its own (solid strokes, double-line strip structures) and the
    one with the most wall mass is the plan: a single 6 px stroke weighs less than a plan's walls. Round 2
    switched a double-line plan's strips off for any solid stroke on the page and took the stroke."""
    base = _small_plan(style)
    img = base.copy()
    if case == "rule":
        cv2.line(img, (1500, 1200), (2300, 1200), (0, 0, 0), 6)
    else:
        cv2.rectangle(img, (1700, 100), (2300, 1600), (0, 0, 0), 6)
    alone = preprocess(page_of(base), make_ctx()).region
    ctx = make_ctx()
    assert preprocess(page_of(img), ctx).region == alone
    assert alone.x + alone.w < 1250
    if case == "title-block frame":  # a rival outside the region, excluded and warned about
        assert [(w.code, w.params) for w in ctx.warnings] == [("plan_region_ambiguous", {"components": 2})]


@pytest.mark.parametrize("style", ["filled", "double"])
def test_a_frame_around_the_plan_keeps_the_plan_in_the_region(style: str) -> None:
    """A bold frame drawn around the plan (a title-block border close around the drawing): the region
    still holds the whole plan."""
    img = _small_plan(style)
    cv2.rectangle(img, (100, 200), (1250, 1100), (0, 0, 0), 6)
    r = preprocess(page_of(img), make_ctx()).region
    assert r.x < 200 and r.y < 300 and r.x + r.w > 1100 and r.y + r.h > 1000


@pytest.mark.parametrize("t", [14, 24])
@pytest.mark.parametrize("fill", ["stipple", "poche"])
def test_filled_double_line_walls_hold_the_region(t: int, fill: str) -> None:
    """Fix round 3 (re-review 2, R2-2): concrete stipple (2 px dots on ~4 % of the wall interior, clear of
    the faces) or a 45-degree poché hatch inside double-line walls. Stipple is inside the strips, never in
    a table cell, so the plan is no table: the region holds the whole plan (round 2 lost most of it)."""
    walls = _plan_walls("double", t)
    base = render_plan((2400, 1700), walls)
    inside = np.zeros(base.shape[:2], np.uint8)
    for w in walls:
        cv2.line(inside, w.a, w.b, 255, max(1, t - 6))
    img = base.copy()
    if fill == "stipple":
        ys, xs = np.nonzero(inside)
        pick = np.random.default_rng(0).choice(len(ys), size=len(ys) // 25, replace=False)
        for y, x in zip(ys[pick], xs[pick], strict=True):
            img[y : y + 2, x : x + 2] = 0
    else:
        for k in range(-2400, 2400, 7):
            cv2.line(img, (k, 1700), (k + 1700, 0), (0, 0, 0), 1)
        img[inside == 0] = base[inside == 0]
    alone = preprocess(page_of(base), make_ctx()).region
    assert preprocess(page_of(img), make_ctx()).region == alone
    assert alone.x < 200 and alone.x + alone.w > 1100


CORES = {
    "core 120 x 300": [SWall((800, 500), (800, 680), 120)],
    "stair and lift core 180 x 360": [SWall((800, 500), (800, 680), 180)],
    "two lift shafts 90 x 200": [SWall((760, 520), (760, 700), 90), SWall((860, 520), (860, 700), 90)],
}


@pytest.mark.parametrize("t", [14, 24])
@pytest.mark.parametrize("core", list(CORES))
def test_a_solid_core_inside_a_double_line_plan_keeps_the_plan(t: int, core: str) -> None:
    """Fix round 4 (re-review 3, R3-1): a solid stair or lift core inside a double-line plan, weighing 30-52 %
    of the plan's strips at t 14. A strip drawing is only that solid drawing's annotation when the solid box
    also covers >= 50 % of the strip box (the HDB plan covers 0.72 of its dimension ring; a core ~0.055 of
    its plan): the region is the whole plan, not the core (round 3 took the core). The core, inside the
    region, is not warned about as a rival."""
    alone = preprocess(page_of(render_plan((2400, 1700), _plan_walls("double", t))), make_ctx()).region
    img = render_plan((2400, 1700), [*_plan_walls("double", t), *CORES[core]])
    ctx = make_ctx()
    r = preprocess(page_of(img), ctx).region
    assert r == alone
    assert ctx.warnings == []  # the core lies inside the region: it is no excluded rival
    assert r.x < 200 and r.y < 300 and r.x + r.w > 1100 and r.y + r.h > 1000
