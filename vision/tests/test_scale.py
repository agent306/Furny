"""Scale solve (06 §8.2), scale confidence (§8.3) and the scale note (§5.6, §8.2 step 8), Task 20.

Preflight rulings applied: K7 (the room-label cross-check pin is 15 %, the spec formula), K8 (the brief's
``test_single_overall_high_confidence`` is dropped: a lone known-dimension sample gives ``user_hint``), K20
(a known dimension matched with null ids is one ``overall`` w = 3 sample over the walls' bbox) and I3 (the
pixel sample dataclass is ``PxScaleSample``; ``ScaleSample`` stays the meta model).
"""

import math
from dataclasses import replace

import numpy as np
import pytest

from app.pipeline.normalize import NormalizedPage
from app.pipeline.scale import (
    PxScaleSample,
    ScaleNote,
    collect_samples,
    find_scale_note,
    fit_scale,
    scale_confidence,
    solve_scale,
    to_scale_meta,
)
from app.pipeline.textparse import parse_token
from app.schemas.api import KnownDimension, RecognizeHints
from app.schemas.candidates import CandidateSet, DimensionSpan, RoomFace, TextToken, WallCandidate
from app.schemas.labeling import DimensionLabel, KnownDimensionMatch, LabelingResult, RoomLabel, WallLabel
from app.schemas.meta import PageImage, SourceKind
from app.utils.geometry import Pt, Rect
from tests.test_normalize import make_ctx

REGION = Rect(100, 100, 1600, 1200)
A3_PT = (841.89, 1190.55)


# --- builders -------------------------------------------------------------------------------------------


def sample(
    value: int, span: float, kind: str = "chain_segment", axis: str = "x", weight: float = 1.0
) -> PxScaleSample:
    return PxScaleSample(
        value_mm=value,
        span_px=span,
        weight=weight,
        axis=axis,  # type: ignore[arg-type]
        kind=kind,  # type: ignore[arg-type]
        text=str(value),
        a_px=(0.0, 0.0),
        b_px=(span, 0.0) if axis == "x" else (0.0, span),
    )


def token(tid: str, text: str, at: Pt = (0.0, 0.0)) -> TextToken:
    x, y = at
    box = (x - 20.0, y - 8.0, x + 20.0, y + 8.0)
    quad = ((box[0], box[1]), (box[2], box[1]), (box[2], box[3]), (box[0], box[3]))
    return TextToken(tid, text, quad, box, 0, 0.99, 16.0, parse_token(text))


class Plan:
    """Candidates and labels built together: labelled spans, rooms with sizes, walls."""

    def __init__(self) -> None:
        self.spans: list[DimensionSpan] = []
        self.texts: list[TextToken] = []
        self.dims: list[DimensionLabel] = []
        self.faces: list[RoomFace] = []
        self.rooms: list[RoomLabel] = []
        self.walls: list[WallCandidate] = []
        self.wall_labels: list[WallLabel] = []
        self.theta0 = 0.0

    def span(self, p0: Pt, p1: Pt, value: int | None, kind: str = "chain_segment", line: str = "L1") -> str:
        sid = f"D{len(self.spans) + 1}"
        axis = "x" if abs(p1[1] - p0[1]) < 1e-9 else "y" if abs(p1[0] - p0[0]) < 1e-9 else "other"
        tid = f"T{len(self.texts) + 1}"
        self.spans.append(DimensionSpan(sid, p0, p1, axis, kind, [tid], line))  # type: ignore[arg-type]
        if value is not None:
            self.texts.append(token(tid, str(value), ((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2 - 15)))
            self.dims.append(DimensionLabel(text_id=tid, span_id=sid, value_mm=value, kind=kind))  # type: ignore[arg-type]
        return sid

    def chain(self, k: float, values: list[int], start: Pt, axis: str = "x", line: str = "L1") -> None:
        """Consecutive chain segments at `k` mm/px from `start` along `axis`."""
        at = 0.0
        for v in values:
            a = at
            at += v / k
            if axis == "x":
                self.span((start[0] + a, start[1]), (start[0] + at, start[1]), v, line=line)
            else:
                self.span((start[0], start[1] + a), (start[0], start[1] + at), v, line=line)

    def room(
        self,
        x0: float,
        y0: float,
        w: float,
        h: float,
        size: tuple[int, int] | None,
        *,
        open_face: bool = False,
    ) -> str:
        """A rectangular face whose interior is `w` x `h` px (pixels x0 .. x0 + w - 1)."""
        rid = f"R{len(self.faces) + 1}"
        x1, y1 = x0 + w - 1, y0 + h - 1
        poly = ((x0, y0), (x1, y0), (x1, y1), (x0, y1))
        self.faces.append(
            RoomFace(rid, poly, ((x0 + x1) / 2, (y0 + y1) / 2), w * h, (x0, y0, x1, y1), (), open_face)
        )
        self.rooms.append(
            RoomLabel(
                id=rid,
                include=True,
                name="Bedroom",
                type="bedroom",
                name_text_id=None,
                size_text=None if size is None else f"{size[0]}x{size[1]}",
                width_mm=None if size is None else size[0],
                depth_mm=None if size is None else size[1],
            )
        )
        return rid

    def wall(self, a: Pt, b: Pt, thickness: float = 20.0) -> str:
        wid = f"W{len(self.walls) + 1}"
        self.walls.append(WallCandidate(wid, a, b, "N1", "N2", thickness, "double_line", 1.0, 0, ()))
        return wid

    def candidates(self) -> CandidateSet:
        return CandidateSet(
            texts=self.texts,
            segments=[],
            dimension_lines=[],
            spans=self.spans,
            nodes={},
            walls=self.walls,
            gaps=[],
            openings=[],
            rooms=self.faces,
            theta0=self.theta0,
            t_thin=2.0,
            t_median=20.0,
            region=REGION,
            drawing_kind_cv="architectural_line_drawing",
        )

    def labels(self, known: KnownDimensionMatch | None = None) -> LabelingResult:
        return LabelingResult(
            unit_system="metric",
            drawing_kind="architectural_line_drawing",
            texts=[],
            dimensions=self.dims,
            rooms=self.rooms,
            missed_rooms=[],
            walls=self.wall_labels,
            openings=[],
            missed_openings=[],
            known_dimension_match=known,
            notes=None,
        )


def page_of(
    source_kind: SourceKind = "raster",
    dpi: float | None = None,
    size_pt: tuple[float, float] | None = None,
    rectified: bool = False,
    scale: float = 1.0,
) -> NormalizedPage:
    """A 2000 x 1500 page; `scale` is the normalized px per source (render) px of its transform."""
    image = np.full((1500, 2000, 3), 255, np.uint8)
    info = PageImage(
        width=2000,
        height=1500,
        source_page=1,
        dpi=dpi,
        rectified=rectified,
        deskew_deg=0.0,
        resample_factor=scale,
    )
    transform = np.diag([scale, scale, 1.0])
    return NormalizedPage(image, info, transform, source_kind, rectified, dpi=dpi, page_size_pt=size_pt)


def solve(plan: Plan, page: NormalizedPage | None = None, **kw: object):  # type: ignore[no-untyped-def]
    ctx = make_ctx()
    known = kw.pop("known", None)
    hints = kw.pop("hints", RecognizeHints())
    result = solve_scale(
        plan.candidates(),
        plan.labels(known),  # type: ignore[arg-type]
        hints,  # type: ignore[arg-type]
        page or page_of(),
        ctx,
        scale_note=kw.pop("scale_note", None),  # type: ignore[arg-type]
    )
    return result, {w.code: w.params for w in ctx.warnings}


# --- fit ------------------------------------------------------------------------------------------------


def test_outliers_rejected() -> None:
    """8 samples at k = 10 with +-0.3 % noise and 2 outliers (x1.2, x0.85): both rejected, k within 0.5 %."""
    noise = [0.003, -0.003, 0.002, -0.001, 0.0, 0.001, -0.002, 0.003]
    values = [3000, 4200, 1500, 2700, 900, 3600, 2400, 5100]
    good = [sample(v, v / (10 * (1 + e))) for v, e in zip(values, noise, strict=True)]
    bad = [sample(3300, 3300 / 12.0), sample(2000, 2000 / 8.5)]
    fit = fit_scale([*good[:4], bad[0], *good[4:], bad[1]])
    assert abs(fit.k / 10 - 1) <= 0.005
    assert len(fit.rejected) == 2 and {s.value_mm for s in fit.rejected} == {3300, 2000}
    assert len(fit.inliers) == 8


def test_wls_residual() -> None:
    fit = fit_scale([sample(v, v / 12.5) for v in (1000, 2500, 4000)])
    assert fit.k == pytest.approx(12.5)
    assert fit.residual_pct < 1e-6


def test_weights_pull_the_fit() -> None:
    """WLS through the origin: k = sum w v p / sum w p^2 (two samples within 8 %, one weighted 3)."""
    a, b = sample(1000, 100.0), sample(1000, 96.0, weight=3.0)
    fit = fit_scale([a, b])
    assert fit.k == pytest.approx((1000 * 100 + 3 * 1000 * 96) / (100**2 + 3 * 96**2))
    expected = 100 * math.sqrt(
        ((1000 - fit.k * 100) ** 2 + 3 * (1000 - fit.k * 96) ** 2) / (1000**2 + 3 * 1000**2)
    )
    assert fit.residual_pct == pytest.approx(expected)


def test_confidence_formula() -> None:
    assert scale_confidence("dimension_chain", 1.0, 8, 1) == pytest.approx(0.945)
    assert scale_confidence("room_label", 2.0, 4, 0) == pytest.approx(0.68)
    assert scale_confidence("scale_note", None, 0, 0) == 0.6
    assert scale_confidence("user_hint", 0.0, 1, 0) == 0.7
    assert scale_confidence("default_guess", None, 0, 0) == 0.1
    assert scale_confidence("dxf_units", None, 0, 0) == 1.0
    assert scale_confidence("dimension_chain", 0.0, 12, 5) == 1.0  # clamped (bonus capped at 2 chains)
    assert scale_confidence("dimension_chain", 15.0, 8, 0) == 0.0


# --- samples --------------------------------------------------------------------------------------------


def test_room_orientation_assignment() -> None:
    """A 300 x 400 px interior labelled 3000 x 4000: width <-> x, depth <-> y; labelled 4000 x 3000: the
    swap fits better. Room samples weigh 0.5."""
    for size, axes in (((3000, 4000), ("x", "y")), ((4000, 3000), ("y", "x"))):
        plan = Plan()
        plan.room(400, 300, 300, 400, size)
        primary, rooms = collect_samples(plan.candidates(), plan.labels(), RecognizeHints())
        assert primary == []
        by_kind = {s.kind: s for s in rooms}
        assert (by_kind["room_width"].axis, by_kind["room_depth"].axis) == axes
        assert by_kind["room_width"].value_mm == size[0] and by_kind["room_depth"].value_mm == size[1]
        assert {s.span_px for s in rooms} == {300.0, 400.0}
        assert all(s.weight == 0.5 for s in rooms)
        assert all(s.value_mm / s.span_px == pytest.approx(10.0) for s in rooms)


def test_room_without_parsed_size_gives_no_sample() -> None:
    plan = Plan()
    plan.room(400, 300, 300, 400, None)
    assert collect_samples(plan.candidates(), plan.labels(), RecognizeHints()) == ([], [])


def test_room_extent_follows_the_snapped_axes() -> None:
    """A room drawn rotated by theta0 = 2 degrees: its extents are measured along the snapped axes."""
    plan = Plan()
    plan.theta0 = 2.0
    c, s = math.cos(math.radians(2.0)), math.sin(math.radians(2.0))
    corners = [(0.0, 0.0), (299.0, 0.0), (299.0, 399.0), (0.0, 399.0)]
    poly = tuple((500 + x * c - y * s, 300 + x * s + y * c) for x, y in corners)
    xs, ys = [p[0] for p in poly], [p[1] for p in poly]
    plan.room(0, 0, 1, 1, (3000, 4000))
    plan.faces[0] = RoomFace(
        "R1", poly, (650.0, 500.0), 120000.0, (min(xs), min(ys), max(xs), max(ys)), (), False
    )
    _, rooms = collect_samples(plan.candidates(), plan.labels(), RecognizeHints())
    assert sorted(s.span_px for s in rooms) == pytest.approx([300.0, 400.0])


def test_labeler_kind_overrides_the_span_kind() -> None:
    """A label the labeler calls `overall` on a chain-segment span weighs 2."""
    plan = Plan()
    plan.span((100, 100), (400, 100), 3000)
    plan.dims[0] = DimensionLabel(text_id="T1", span_id="D1", value_mm=3000, kind="overall")
    plan.span((100, 200), (500, 200), 4000, kind="overall")
    plan.dims[1] = DimensionLabel(text_id="T2", span_id="D2", value_mm=4000, kind="chain_segment")
    primary, _ = collect_samples(plan.candidates(), plan.labels(), RecognizeHints())
    assert [(s.kind, s.weight, s.text) for s in primary] == [
        ("overall", 2.0, "3000"),
        ("chain_segment", 1.0, "4000"),
    ]


def test_dimension_labels_without_a_value_or_span_give_no_sample() -> None:
    plan = Plan()
    plan.span((100, 100), (400, 100), 3000)
    plan.dims[0] = DimensionLabel(text_id="T1", span_id="D1", value_mm=None, kind="chain_segment")
    plan.dims.append(DimensionLabel(text_id="T1", span_id=None, value_mm=3000, kind="chain_segment"))
    assert collect_samples(plan.candidates(), plan.labels(), RecognizeHints()) == ([], [])


def test_known_dimension_on_a_span_and_on_a_wall() -> None:
    """A known dimension matched to a span (its length) or a wall (its centre line): `overall`, w = 3."""
    hints = RecognizeHints(known_dimension=KnownDimension(label="Living width", mm=4500))
    plan = Plan()
    sid = plan.span((100, 100), (550, 100), None)
    wid = plan.wall((100, 300), (100, 750))
    for match, axis in (
        (KnownDimensionMatch(wall_id=None, span_id=sid), "x"),
        (KnownDimensionMatch(wall_id=wid, span_id=None), "y"),
    ):
        primary, _ = collect_samples(plan.candidates(), plan.labels(match), hints)
        assert [(s.kind, s.weight, s.value_mm, s.span_px, s.axis, s.text) for s in primary] == [
            ("overall", 3.0, 4500, 450.0, axis, "Living width")
        ]


def test_known_dimension_with_null_ids_spans_the_walls() -> None:
    """Ruling K20: "overall width" matched with null ids spans the walls' bbox across (outer faces, x);
    "overall length" / "depth" spans it down (y)."""
    plan = Plan()
    plan.wall((200, 200), (1200, 200))
    plan.wall((200, 200), (200, 900))
    plan.wall((1200, 200), (1200, 900))
    plan.wall((200, 900), (1200, 900))
    null = KnownDimensionMatch(wall_id=None, span_id=None)
    for label, axis, span in (
        ("Overall width", "x", 1020.0),
        ("overall length", "y", 720.0),
        ("Total depth", "y", 720.0),
    ):
        hints = RecognizeHints(known_dimension=KnownDimension(label=label, mm=10200))
        primary, _ = collect_samples(plan.candidates(), plan.labels(null), hints)
        assert [(s.kind, s.weight, s.axis, s.span_px) for s in primary] == [("overall", 3.0, axis, span)], (
            label
        )


# --- solve ----------------------------------------------------------------------------------------------


def test_dimension_chain() -> None:
    plan = Plan()
    plan.chain(10.0, [3000, 4000, 2500], (200, 150))
    plan.chain(10.0, [3500, 3500], (150, 200), axis="y", line="L2")
    result, warnings = solve(plan)
    assert result.method == "dimension_chain"
    assert result.mm_per_px == pytest.approx(10.0)
    assert (result.samples, result.rejected, result.residual_pct) == (5, 0, pytest.approx(0.0, abs=1e-9))
    assert result.confidence == pytest.approx(min(1.0, 0.5 + 0.125 * 5))
    assert result.anisotropy_corrected is False and result.y_factor == 1.0
    assert result.room_label_check.rooms == 0 and result.room_label_check.median_discrepancy_pct is None
    assert warnings == {}


@pytest.mark.parametrize("source_kind", ["raster", "pdf_raster", "pdf_vector"])
def test_anisotropy_raster(source_kind: SourceKind) -> None:
    """4 x samples at k = 10 and 4 y samples at 10.5: raster pages are corrected (y resampled by 1.05,
    mm/px = k_x); vector pages never."""
    plan = Plan()
    plan.chain(10.0, [3000, 2000, 2500, 1500], (200, 150))
    plan.chain(10.5, [3150, 2100, 2625, 1575], (150, 200), axis="y", line="L2")
    result, warnings = solve(plan, page_of(source_kind))
    if source_kind == "pdf_vector":
        assert result.anisotropy_corrected is False and result.y_factor == 1.0
        assert "scale_anisotropy_corrected" not in warnings
        assert result.mm_per_px == pytest.approx(10.25, rel=0.01)
        return
    assert result.anisotropy_corrected is True
    assert result.y_factor == pytest.approx(1.05, rel=1e-3)
    assert result.mm_per_px == pytest.approx(10.0, rel=1e-6)
    assert result.residual_pct == pytest.approx(0.0, abs=1e-6)  # the corrected samples fit exactly
    assert warnings["scale_anisotropy_corrected"] == {"ratioPct": 5.0}
    y_samples = [s for s in result.used_samples if s.axis == "y"]
    assert all(s.value_mm / s.span_px == pytest.approx(10.0) for s in y_samples)  # in the corrected frame


def test_anisotropy_on_a_rectified_photo_and_below_the_threshold() -> None:
    plan = Plan()
    plan.chain(10.0, [3000, 2000, 2500, 1500], (200, 150))
    plan.chain(10.5, [3150, 2100, 2625, 1575], (150, 200), axis="y", line="L2")
    result, _ = solve(plan, page_of("heic", rectified=True))
    assert result.anisotropy_corrected is True
    plan = Plan()
    plan.chain(10.0, [3000, 2000, 2500, 1500], (200, 150))
    plan.chain(10.15, [3045, 2030, 2537, 1522], (150, 200), axis="y", line="L2")  # 1.5 %: no correction
    result, warnings = solve(plan)
    assert result.anisotropy_corrected is False and "scale_anisotropy_corrected" not in warnings


def test_anisotropy_needs_three_inliers_per_axis() -> None:
    plan = Plan()
    plan.chain(10.0, [3000, 2000, 2500, 1500], (200, 150))
    plan.chain(10.5, [3150, 2100], (150, 200), axis="y", line="L2")
    result, _ = solve(plan)
    assert result.anisotropy_corrected is False


def test_fallback_room_label() -> None:
    plan = Plan()
    plan.room(400, 300, 300, 400, (3000, 4000))
    plan.room(800, 300, 250, 300, (3000, 2500))
    result, warnings = solve(plan)
    assert result.method == "room_label"
    assert result.mm_per_px == pytest.approx(10.0)
    assert warnings["scale_from_room_labels"] == {"rooms": 2}
    assert result.confidence == pytest.approx(0.85 * min(1.0, 0.5 + 0.125 * 4))
    assert result.room_label_check.rooms == 2 and result.room_label_check.median_discrepancy_pct is None


def test_fallback_scale_note() -> None:
    """No samples, a scale note 1:100 on an A3 page rendered at 150 dpi: mm/px = 100 x 25.4 / 150."""
    note = find_scale_note([token("T1", "SCALE 1:100")], page_of("pdf_vector", 150, A3_PT))
    assert note == ScaleNote(n=100, mm_per_px=pytest.approx(100 * 25.4 / 150), text="SCALE 1:100")
    result, warnings = solve(Plan(), scale_note=note)
    assert result.method == "scale_note"
    assert result.mm_per_px == pytest.approx(100 * 25.4 / 150)
    assert (result.confidence, result.residual_pct, result.samples) == (0.6, None, 0)
    assert warnings == {}


def test_scale_note_conditions() -> None:
    """A non-standard paper size, an unknown DPI or a raster image: no note. A raster PDF counts. The page's
    resampling (its transform) is taken into account."""
    tokens = [token("T1", "Plan"), token("T2", "SCALE 1:50")]
    assert find_scale_note(tokens, page_of("pdf_vector", 150, (700.0, 1000.0))) is None
    assert find_scale_note(tokens, page_of("pdf_vector", None, A3_PT)) is None
    assert find_scale_note(tokens, page_of("raster", 150, A3_PT)) is None
    assert find_scale_note([token("T1", "Plan")], page_of("pdf_vector", 150, A3_PT)) is None
    raster_pdf = find_scale_note(tokens, page_of("pdf_raster", 300, A3_PT))
    assert raster_pdf is not None and raster_pdf.mm_per_px == pytest.approx(50 * 25.4 / 300)
    halved = find_scale_note(tokens, page_of("pdf_vector", 300, A3_PT, scale=0.5))
    assert halved is not None and halved.mm_per_px == pytest.approx(50 * 25.4 / 150)


def test_fallback_user_hint() -> None:
    """A known dimension matched alone (< 2 other samples): `user_hint` from its span."""
    plan = Plan()
    sid = plan.span((100, 100), (550, 100), None)
    hints = RecognizeHints(known_dimension=KnownDimension(label="Living width", mm=4500))
    result, warnings = solve(plan, known=KnownDimensionMatch(wall_id=None, span_id=sid), hints=hints)
    assert result.method == "user_hint"
    assert result.mm_per_px == pytest.approx(10.0)
    assert result.confidence == 0.7
    assert warnings == {}


def test_known_dimension_joins_the_chain_fit() -> None:
    """With >= 2 primary samples the known dimension is one of them (w = 3)."""
    plan = Plan()
    plan.chain(10.0, [3000, 4000], (200, 150))
    sid = plan.span((100, 100), (550, 100), None)
    hints = RecognizeHints(known_dimension=KnownDimension(label="Living width", mm=4500))
    result, _ = solve(plan, known=KnownDimensionMatch(wall_id=None, span_id=sid), hints=hints)
    assert result.method == "dimension_chain" and result.samples == 3


def test_fallback_default_guess() -> None:
    result, warnings = solve(Plan())
    assert result.method == "default_guess"
    assert result.mm_per_px == 12000 / max(REGION.w, REGION.h)
    assert (result.confidence, result.residual_pct, result.samples, result.rejected) == (0.1, None, 0, 0)
    assert warnings == {"scale_guessed": {"assumedLongEdgeMm": 12000}}


def test_fallback_order() -> None:
    """dimension_chain > room_label > scale_note > user_hint > default_guess; a lone chain sample is not
    a chain."""
    note = ScaleNote(n=100, mm_per_px=17.0, text="1:100")
    plan = Plan()
    plan.chain(10.0, [3000, 4000], (200, 150))
    plan.room(400, 300, 300, 400, (3300, 4400))
    assert solve(plan, scale_note=note)[0].method == "dimension_chain"
    plan = Plan()
    plan.span((100, 100), (400, 100), 3000)
    plan.room(400, 300, 300, 400, (3300, 4400))
    assert solve(plan, scale_note=note)[0].method == "room_label"
    plan = Plan()
    plan.span((100, 100), (400, 100), 3000)
    assert solve(plan, scale_note=note)[0].method == "scale_note"
    sid = plan.span((100, 200), (550, 200), None)
    hints = RecognizeHints(known_dimension=KnownDimension(label="Living width", mm=4500))
    known = KnownDimensionMatch(wall_id=None, span_id=sid)
    plan.spans.pop(0), plan.dims.pop(0)
    assert solve(plan, scale_note=note, known=known, hints=hints)[0].method == "scale_note"
    assert solve(plan, known=known, hints=hints)[0].method == "user_hint"


def test_room_label_cross_check() -> None:
    """Ruling K7: chain at k = 10, room labels implying k = 11.5: discrepancy |11.5 / 10 - 1| = 15 % > 10:
    warning and confidence x 0.7."""
    plan = Plan()
    plan.chain(10.0, [3000, 4000, 2500], (200, 150))
    plan.room(400, 300, 300, 400, (3450, 4600))
    plan.room(800, 300, 200, 300, (2300, 3450))
    result, warnings = solve(plan)
    assert result.method == "dimension_chain"
    assert result.room_label_check.rooms == 2
    assert result.room_label_check.median_discrepancy_pct == pytest.approx(15.0)
    assert warnings["scale_room_label_mismatch"] == {"discrepancyPct": 15.0}
    assert result.confidence == pytest.approx(0.7 * scale_confidence("dimension_chain", 0.0, 3, 0))


def test_room_labels_that_agree_raise_no_warning() -> None:
    plan = Plan()
    plan.chain(10.0, [3000, 4000, 2500], (200, 150))
    plan.room(400, 300, 300, 400, (3150, 4200))  # 5 %
    result, warnings = solve(plan)
    assert result.room_label_check.median_discrepancy_pct == pytest.approx(5.0)
    assert "scale_room_label_mismatch" not in warnings
    assert result.confidence == pytest.approx(scale_confidence("dimension_chain", 0.0, 3, 0))


def test_high_residual_warning() -> None:
    plan = Plan()
    for n, e in enumerate([0.06, -0.06, 0.06, -0.06]):
        y = 150 + 40 * n
        plan.span((200, y), (200 + 3000 / (10 * (1 + e)), y), 3000, line=f"L{n}")
    result, warnings = solve(plan)
    assert result.samples == 4 and result.rejected == 0
    assert result.residual_pct > 3
    assert warnings["scale_high_residual"] == {"residualPct": round(result.residual_pct, 1)}


def test_chain_consistency() -> None:
    """Chain 3000 + 4000 on one line and an overall 7000 on a parallel line over the same extent (+-1 %):
    one consistent chain; an overall of another value or extent is none."""
    for overall, extent, expected in ((7000, 700.0, 1), (7000, 705.0, 1), (7500, 700.0, 0), (7000, 720.0, 0)):
        plan = Plan()
        plan.chain(10.0, [3000, 4000], (200, 150))
        plan.span((200, 110), (200 + extent, 110), overall, kind="overall", line="L2")
        result, _ = solve(plan)
        assert result.consistent_chains == expected, (overall, extent)


def test_chain_consistency_needs_another_line() -> None:
    """A chain's own overall span (same line) is no consistency evidence."""
    plan = Plan()
    plan.chain(10.0, [3000, 4000], (200, 150))
    plan.span((200, 150), (900, 150), 7000, kind="overall")
    result, _ = solve(plan)
    assert result.consistent_chains == 0


# --- meta -----------------------------------------------------------------------------------------------


def test_to_scale_meta() -> None:
    plan = Plan()
    plan.chain(10.0, [3000, 4000, 2500], (200, 150))
    plan.span((200, 300), (200 + 3300 / 12.0, 300), 3300, line="L9")  # an outlier
    result, _ = solve(plan)
    meta = to_scale_meta(result)
    assert meta.method == "dimension_chain" and meta.mm_per_pixel == pytest.approx(10.0)
    assert (meta.samples, meta.rejected) == (3, 1)
    first = meta.used_samples[0]
    assert (first.text, first.value_mm, first.kind, first.inlier) == ("3000", 3000, "chain_segment", True)
    assert (first.a.x, first.a.y, first.b.x, first.b.y) == (2000, 1500, 5000, 1500)
    assert [s.inlier for s in meta.used_samples] == [True, True, True, False]


def test_to_scale_meta_keeps_at_most_60_samples_inliers_first() -> None:
    plan = Plan()
    for n in range(70):
        plan.span((200, 100 + 10 * n), (500, 100 + 10 * n), 3000, line=f"L{n}")
    plan.span((200, 900), (500, 900), 4500, line="L99")  # the outlier is kept after the inliers
    result, _ = solve(plan)
    meta = to_scale_meta(result)
    assert len(meta.used_samples) == 60 and all(s.inlier for s in meta.used_samples)
    assert meta.samples == 70 and meta.rejected == 1


# --- fix round 1: degenerate fits (C1) and boundaries (M1-M6) ------------------------------------------


def test_fit_keeps_its_input_when_a_round_would_reject_everything() -> None:
    """Review C1: estimates [10, 10, 20, 20] put the tie median (15) more than 8 % from every sample: the
    round keeps its input and rejection stops; the fit is WLS over all four."""
    samples = [sample(1000, 100.0), sample(2000, 200.0), sample(2000, 100.0), sample(1000, 50.0)]
    fit = fit_scale(samples)
    assert len(fit.inliers) == 4 and fit.rejected == []
    assert fit.k == pytest.approx(_wls_of(samples))
    assert fit.residual_pct > 3


def _wls_of(samples: list[PxScaleSample]) -> float:
    return sum(s.weight * s.value_mm * s.span_px for s in samples) / sum(
        s.weight * s.span_px**2 for s in samples
    )


def test_one_room_whose_size_disagrees_with_its_face_does_not_crash() -> None:
    """Review C1, reproduction 1: one room 3000 x 3000 on a 300 x 400 px face (10 and 7.5 mm/px)."""
    plan = Plan()
    plan.room(400, 300, 300, 400, (3000, 3000))
    result, warnings = solve(plan)
    assert result.method == "room_label" and math.isfinite(result.mm_per_px) and result.mm_per_px > 0
    assert (result.samples, result.rejected) == (2, 0)
    assert "scale_high_residual" in warnings


def test_two_disagreeing_chain_labels_do_not_crash() -> None:
    """Review C1, reproduction 2: two chain labels at 10 and 20 mm/px stay a dimension chain with a high
    residual (warning, low confidence)."""
    plan = Plan()
    plan.span((100, 100), (400, 100), 3000)
    plan.span((100, 200), (250, 200), 3000, line="L2")
    result, warnings = solve(plan)
    assert result.method == "dimension_chain"
    assert (result.samples, result.rejected) == (2, 0)
    assert result.mm_per_px == pytest.approx((3000 * 300 + 3000 * 150) / (300**2 + 150**2))
    assert warnings["scale_high_residual"] == {"residualPct": round(result.residual_pct, 1)}
    assert result.confidence == pytest.approx(scale_confidence("dimension_chain", result.residual_pct, 2, 0))


def test_degenerate_sample_sets_never_raise() -> None:
    """Review C1: seeded random sets of 1-3 dimension labels and rooms with wide spreads, near-zero and zero
    spans and duplicates: `solve_scale` returns a finite positive scale."""
    rng = np.random.default_rng(20)
    for case in range(400):
        plan = Plan()
        for n in range(int(rng.integers(0, 4))):
            length = float(rng.choice([0.0, 1e-6, 0.5, 3.0, rng.uniform(10, 900)]))
            value = int(rng.choice([1, 100, 3000, 3000, 25000]))
            y = 100 + 30 * n
            plan.span(
                (100, y),
                (100 + length, y),
                value,
                kind=str(rng.choice(["chain_segment", "overall"])),
                line=f"L{n}",
            )
            if rng.random() < 0.3:  # a duplicate
                plan.span((100, y), (100 + length, y), value, line=f"L{n}")
        for n in range(int(rng.integers(0, 3))):
            w, h = (
                float(rng.choice([1.0, 2.0, rng.uniform(20, 600)])),
                float(rng.choice([1.0, rng.uniform(20, 600)])),
            )
            size = (int(rng.choice([100, 3000, 9000])), int(rng.choice([100, 3000, 9000])))
            plan.room(200 + 10 * n, 300, w, h, size)
        source = "pdf_vector" if rng.random() < 0.3 else "raster"
        result, _ = solve(plan, page_of(source))  # type: ignore[arg-type]
        assert math.isfinite(result.mm_per_px) and result.mm_per_px > 0, case
        assert 0.0 <= result.confidence <= 1.0, case
        to_scale_meta(result)


def test_rejection_threshold_is_8_percent() -> None:
    """Review M1: a sample 7 % off the median is an inlier, one 9 % off is rejected."""
    samples = [sample(1000, 100.0) for _ in range(6)] + [sample(1070, 100.0), sample(1090, 100.0)]
    fit = fit_scale(samples)
    assert [s.value_mm for s in fit.rejected] == [1090]


def test_second_round_retests_every_sample_around_the_new_median() -> None:
    """Review M1: estimates [9, 9, 10, 10.3, 10.9]. Round 1 (median 10) keeps 10 and 10.3; round 2 (median
    10.15) re-admits 10.9 (7.4 % off), the 9s stay out (11.3 %)."""
    samples = [sample(1000, 1000 / e) for e in (9.0, 9.0, 10.0, 10.3, 10.9)]
    fit = fit_scale(samples)
    assert sorted(round(s.estimate, 2) for s in fit.inliers) == [10.0, 10.3, 10.9]
    assert [round(s.estimate, 2) for s in fit.rejected] == [9.0, 9.0]


@pytest.mark.parametrize(("spread", "warned"), [(0.035, True), (0.029, False)])
def test_high_residual_threshold_is_3_percent(spread: float, warned: bool) -> None:
    plan = Plan()
    for n, e in enumerate([spread, -spread, spread, -spread]):
        y = 150 + 40 * n
        plan.span((200, y), (200 + 3000 / (10 * (1 + e)), y), 3000, line=f"L{n}")
    result, warnings = solve(plan)
    assert (result.residual_pct > 3) is warned
    assert ("scale_high_residual" in warnings) is warned


@pytest.mark.parametrize(("off", "warned"), [(0.11, True), (0.09, False)])
def test_room_mismatch_threshold_is_10_percent(off: float, warned: bool) -> None:
    plan = Plan()
    plan.chain(10.0, [3000, 4000, 2500], (200, 150))
    plan.room(400, 300, 300, 400, (round(3000 * (1 + off)), round(4000 * (1 + off))))
    result, warnings = solve(plan)
    assert result.room_label_check.median_discrepancy_pct == pytest.approx(100 * off)
    assert ("scale_room_label_mismatch" in warnings) is warned


def test_room_discrepancy_is_the_mean_of_its_two_samples() -> None:
    """Width 4 % off, depth 14 % off: the room's discrepancy is 9 % (no warning)."""
    plan = Plan()
    plan.chain(10.0, [3000, 4000, 2500], (200, 150))
    plan.room(400, 300, 300, 400, (3120, 4560))
    result, warnings = solve(plan)
    assert result.room_label_check.median_discrepancy_pct == pytest.approx(9.0)
    assert "scale_room_label_mismatch" not in warnings


def test_room_check_runs_in_the_corrected_frame() -> None:
    """Review M1: on a page corrected for anisotropy (y at 10.5 mm/px), a room labelled at 10 mm/px across
    and 10.5 mm/px down agrees exactly once its depth is in the corrected frame."""
    plan = Plan()
    plan.chain(10.0, [3000, 2000, 2500, 1500], (200, 150))
    plan.chain(10.5, [3150, 2100, 2625, 1575], (150, 200), axis="y", line="L2")
    plan.room(400, 300, 300, 400, (3000, 4200))
    result, _ = solve(plan)
    assert result.anisotropy_corrected is True
    assert result.room_label_check.median_discrepancy_pct == pytest.approx(0.0, abs=1e-9)


def test_anisotropy_on_an_unrectified_heic_page() -> None:
    plan = Plan()
    plan.chain(10.0, [3000, 2000, 2500, 1500], (200, 150))
    plan.chain(10.5, [3150, 2100, 2625, 1575], (150, 200), axis="y", line="L2")
    result, _ = solve(plan, page_of("heic"))
    assert result.anisotropy_corrected is True


@pytest.mark.parametrize(
    ("k_y", "corrected"), [(9.802, True), (10.205, True), (9.81, False), (10.195, False)]
)
def test_anisotropy_threshold_is_k_x_over_k_y(k_y: float, corrected: bool) -> None:
    """Review M2: spec step 7 tests |k_x / k_y - 1| > 2 %: k_y = 9.802 (2.02 %) is corrected, 10.195 (1.91 %)
    is not."""
    plan = Plan()
    plan.chain(10.0, [3000, 2000, 2500, 1500], (200, 150))
    plan.chain(k_y, [3000, 2000, 2500, 1500], (150, 200), axis="y", line="L2")
    result, _ = solve(plan)
    assert result.anisotropy_corrected is corrected


def test_slanted_chain_is_not_consistent_with_a_horizontal_overall() -> None:
    """Review M1: a chain on a line slanted 20 degrees (axis `other`) and a horizontal overall over its
    projected extent with the chain's total: no consistent chain (only parallel lines on one axis count)."""
    plan = Plan()
    c, s = math.cos(math.radians(20.0)), math.sin(math.radians(20.0))
    a, b, e = (200.0, 400.0), (200 + 300 * c, 400 + 300 * s), (200 + 700 * c, 400 + 700 * s)
    plan.span(a, b, 3000)
    plan.span(b, e, 4000)
    plan.span((200, 300), (200 + 700 * c, 300), 7000, kind="overall", line="L2")
    result, _ = solve(plan)
    assert result.samples == 3
    assert result.consistent_chains == 0


def test_known_dimension_bbox_leaves_out_walls_labelled_not_wall() -> None:
    """Review M1 (K20): a wall the labeler calls `not_wall` beyond the plan does not widen the bbox."""
    plan = Plan()
    plan.wall((200, 200), (1200, 200))
    plan.wall((200, 900), (1200, 900))
    stray = plan.wall((1500, 200), (1500, 900))
    plan.wall_labels = [WallLabel(id=stray, verdict="not_wall", kind=None)]
    hints = RecognizeHints(known_dimension=KnownDimension(label="Overall width", mm=10200))
    primary, _ = collect_samples(
        plan.candidates(), plan.labels(KnownDimensionMatch(wall_id=None, span_id=None)), hints
    )
    assert [s.span_px for s in primary] == [1020.0]


def test_open_faces_give_no_room_sample() -> None:
    """Review M6: spec step 1 takes rooms with a closed face; a face closed only across a passage
    (`RoomFace.open`) may span the next space."""
    plan = Plan()
    plan.room(400, 300, 300, 400, (3000, 4000), open_face=True)
    assert collect_samples(plan.candidates(), plan.labels(), RecognizeHints()) == ([], [])


def test_meta_holds_sample_ends_to_the_document_range() -> None:
    """The backstop: an absurd scale still serializes, sample ends held to +-1 000 000 (collection no longer
    lets one through, see the test below)."""
    absurd = [sample(10000, 2.0, axis="x"), sample(10000, 2.0, axis="x")]
    result = replace(
        solve(Plan())[0],
        mm_per_px=5000.0,
        used_samples=absurd,
        inlier_flags=[True, True],
    )
    meta = to_scale_meta(result)
    assert {s.b.x for s in meta.used_samples} == {10000}
    far = replace(result, used_samples=[sample(10000, 1500.0)], inlier_flags=[True])
    assert to_scale_meta(far).used_samples[0].b.x == 1_000_000


def test_implausible_samples_are_rejected_at_collection() -> None:
    """Task 20 review N-M1 (carry): spans under 10 px and scales outside 0.25-250 mm/px are not samples,
    so an absurd label gives `default_guess` instead of a 5 m/px scale."""
    plan = Plan()
    plan.span((100, 100), (102, 100), 10000)  # 5000 mm/px over 2 px
    plan.span((100, 200), (150, 200), 100000, line="L2")  # 2000 mm/px
    plan.span((100, 300), (400, 300), 30, line="L3")  # 0.1 mm/px
    result, warnings = solve(plan)
    assert result.method == "default_guess" and "scale_guessed" in warnings
    assert 0.25 <= result.mm_per_px <= 250.0
    assert collect_samples(plan.candidates(), plan.labels(), RecognizeHints()) == ([], [])
    plan.span((100, 400), (300, 400), 2000, line="L4")  # 10 mm/px: plausible
    plan.span((100, 500), (400, 500), 3000, line="L5")
    assert solve(plan)[0].method == "dimension_chain"
