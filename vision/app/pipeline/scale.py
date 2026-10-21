"""Scale solve (06 §8.2), scale confidence (§8.3) and the scale note (§5.6, §8.2 step 8).

Runs after labeling: the labeler's dimension associations, room sizes and known-dimension match are the
evidence. Samples are (value mm, span px) pairs; the robust fit is a weighted median with two 8 % rejection
rounds and a weighted least-squares line through the origin over the inliers. Fallbacks in order:
``dimension_chain`` -> ``room_label`` -> ``scale_note`` -> ``user_hint`` -> ``default_guess``.

The pixel sample dataclass is ``PxScaleSample`` (preflight I3: ``ScaleSample`` is the meta model). The
"1 overall with LLM confidence >= 0.8" primary rule of step 3 is never true in v1 (``LabelingResult`` has no
confidence, preflight K8).
"""

import math
import statistics
from collections.abc import Sequence
from dataclasses import dataclass, replace
from typing import Literal

from app.pipeline.context import PipelineContext
from app.pipeline.normalize import NormalizedPage
from app.pipeline.pdf import is_standard_paper
from app.schemas.api import RecognizeHints
from app.schemas.candidates import CandidateSet, RoomFace, TextToken
from app.schemas.labeling import LabelingResult
from app.schemas.meta import RoomLabelCheck, ScaleMeta, ScaleMethod, ScaleSample
from app.schemas.plan import Point
from app.utils.geometry import Pt

__all__ = [
    "FitResult",
    "PxScaleSample",
    "ScaleNote",
    "ScaleResult",
    "collect_samples",
    "find_scale_note",
    "fit_scale",
    "scale_confidence",
    "solve_scale",
    "to_scale_meta",
]

SampleAxis = Literal["x", "y", "other"]
SampleKind = Literal["chain_segment", "overall", "room_width", "room_depth"]

WEIGHT = {"chain_segment": 1.0, "overall": 2.0, "room": 0.5, "known": 3.0}  # §8.2 step 1
REJECT_FRAC = 0.08  # step 4: samples farther than 8 % from the weighted median are outliers ...
REJECT_ROUNDS = 2  # ... decided twice
CONSISTENT_FRAC = 0.01  # step 6: a chain sums to an overall within 1 % in value and pixel extent
ANISO_MIN_INLIERS = 3  # step 7: inliers per axis needed to fit the axes separately ...
ANISO_MIN_FRAC = 0.02  # ... and the relative x / y difference that is corrected
ANISO_KINDS = frozenset({"raster", "pdf_raster", "heic"})  # never pdf_vector (or dxf)
NOTE_KINDS = frozenset({"pdf_vector", "pdf_raster"})
MM_PER_INCH = 25.4
GUESS_LONG_EDGE_MM = 12000  # step 8: default_guess assumes a 12 m long plan
ROOM_MISMATCH_PCT = 10.0  # step 9
ROOM_MISMATCH_FACTOR = 0.7
HIGH_RESIDUAL_PCT = 3.0  # §8.3
ROOM_LABEL_FACTOR = 0.85
FIXED_CONFIDENCE: dict[str, float] = {
    "dxf_units": 1.0,
    "scale_note": 0.6,
    "user_hint": 0.7,
    "default_guess": 0.1,
}
MAX_META_SAMPLES = 60
MAX_COORD_MM = 1_000_000  # the range of a document coordinate (`schemas.plan.Coord`)
MIN_SPAN_PX = 10.0  # a sample over a shorter span is noise (a tick mark read as a dimension) ...
MIN_MM_PER_PX, MAX_MM_PER_PX = (
    0.25,
    250.0,
)  # ... and so is one whose scale no plan can have (Task 20 review N-M1)
KNOWN_X_WORDS = ("width",)  # a null-id known dimension spans the walls across (x) for "width", else down (y)


@dataclass(frozen=True)
class PxScaleSample:
    """One (value, span) pair in normalized px (06 §8.2 step 1). ``line_id`` groups the dimension samples
    of one dimension line (chain consistency, step 6); None for room and known-dimension samples."""

    value_mm: int
    span_px: float
    weight: float
    axis: SampleAxis
    kind: SampleKind
    text: str
    a_px: Pt
    b_px: Pt
    line_id: str | None = None

    @property
    def estimate(self) -> float:
        """mm per px (step 2)."""
        return self.value_mm / self.span_px


def _plausible(s: PxScaleSample) -> bool:
    return s.span_px >= MIN_SPAN_PX and MIN_MM_PER_PX <= s.estimate <= MAX_MM_PER_PX


@dataclass(frozen=True)
class FitResult:
    k: float
    inliers: list[PxScaleSample]
    rejected: list[PxScaleSample]
    residual_pct: float


@dataclass(frozen=True)
class ScaleNote:
    n: int
    mm_per_px: float
    text: str


@dataclass(frozen=True)
class ScaleResult:
    """The solved scale. ``used_samples`` (with ``inlier_flags``) are the fitted samples in the corrected
    frame (y multiplied by ``y_factor`` when ``anisotropy_corrected``); ``y_factor`` is what the caller
    resamples the image and the candidates by (`CandidateSet.scale_y`)."""

    mm_per_px: float
    method: ScaleMethod
    residual_pct: float | None
    samples: int
    rejected: int
    confidence: float
    anisotropy_corrected: bool
    y_factor: float
    room_label_check: RoomLabelCheck
    used_samples: list[PxScaleSample]
    inlier_flags: list[bool]
    consistent_chains: int


# --- fit ------------------------------------------------------------------------------------------------


def _weighted_median(samples: Sequence[PxScaleSample]) -> float:
    """The weighted median of the estimates; where the cumulative weight reaches exactly half between two
    estimates, their mean."""
    ordered = sorted(samples, key=lambda s: s.estimate)
    half = sum(s.weight for s in ordered) / 2.0
    acc = 0.0
    for i, s in enumerate(ordered):
        acc += s.weight
        if math.isclose(acc, half, rel_tol=1e-12) and i + 1 < len(ordered):
            return (s.estimate + ordered[i + 1].estimate) / 2.0
        if acc > half:
            return s.estimate
    return ordered[-1].estimate


def _wls(samples: Sequence[PxScaleSample]) -> float:
    """Weighted least squares through the origin: k = sum w v p / sum w p^2 (step 5)."""
    return sum(s.weight * s.value_mm * s.span_px for s in samples) / sum(
        s.weight * s.span_px**2 for s in samples
    )


def _residual_pct(samples: Sequence[PxScaleSample], k: float) -> float:
    """100 sqrt(sum w (v - k p)^2 / sum w v^2) (step 5)."""
    num = sum(s.weight * (s.value_mm - k * s.span_px) ** 2 for s in samples)
    den = sum(s.weight * s.value_mm**2 for s in samples)
    return 100.0 * math.sqrt(num / den) if den > 0 else 0.0


def fit_scale(samples: Sequence[PxScaleSample]) -> FitResult:
    """Steps 4-5 over a non-empty sample set: two rounds of 8 % rejection around the weighted median (the
    second around the median of the first round's inliers, re-testing every sample), then WLS through the
    origin over the inliers. A round that would reject every sample (a median between estimates more than
    ~16 % apart) keeps its input and ends the rejection (Task 20 fix round 1, C1): the high residual then
    shows in the warning and the confidence."""
    if not samples:
        raise ValueError("fit_scale needs at least one sample")
    inliers = list(samples)
    for _ in range(REJECT_ROUNDS):
        m = _weighted_median(inliers)
        kept = [s for s in samples if abs(s.estimate / m - 1.0) <= REJECT_FRAC]
        if not kept:
            break
        inliers = kept
    k = _wls(inliers)
    kept_ids = {id(s) for s in inliers}
    rejected = [s for s in samples if id(s) not in kept_ids]
    return FitResult(k, inliers, rejected, _residual_pct(inliers, k))


def scale_confidence(
    method: ScaleMethod, residual_pct: float | None, inliers: int, consistent_chains: int
) -> float:
    """06 §8.3 (before the room-label cross-check factor of §8.2 step 9)."""
    if method in FIXED_CONFIDENCE:
        return FIXED_CONFIDENCE[method]
    fit = 1.0 - min(residual_pct or 0.0, 10.0) / 10.0
    value = fit * min(1.0, 0.5 + 0.125 * inliers) * (1.0 + 0.05 * min(consistent_chains, 2))
    if method == "room_label":
        value *= ROOM_LABEL_FACTOR
    return min(1.0, max(0.0, value))


# --- samples --------------------------------------------------------------------------------------------


def _axis_of(a: Pt, b: Pt) -> SampleAxis:
    angle = math.degrees(math.atan2(b[1] - a[1], b[0] - a[0])) % 180.0
    if min(angle, 180.0 - angle) <= 10.0:
        return "x"
    if abs(angle - 90.0) <= 10.0:
        return "y"
    return "other"


def _fold(theta: float) -> float:
    """An axis angle (degrees) folded into (-45, 45]."""
    a = theta % 90.0
    return a - 90.0 if a > 45.0 else a


def _room_samples(face: RoomFace, width: int, depth: int, theta0: float, text: str) -> list[PxScaleSample]:
    """Two samples from a room's size and its face's interior extents along the snapped axes (the polygon
    turned by -theta0; pixel extents, so + 1 px), width / depth assigned to x / y or swapped, whichever
    gives the more alike scales (§8.2 step 1)."""
    rad = math.radians(_fold(theta0))
    c, s = math.cos(rad), math.sin(rad)
    us = [x * c + y * s for x, y in face.polygon_px]
    vs = [-x * s + y * c for x, y in face.polygon_px]
    u0, u1, v0, v1 = min(us), max(us), min(vs), max(vs)
    px_x, px_y = u1 - u0 + 1.0, v1 - v0 + 1.0
    um, vm = (u0 + u1) / 2.0, (v0 + v1) / 2.0

    def back(u: float, v: float) -> Pt:
        return (u * c - v * s, u * s + v * c)

    across = (back(u0 - 0.5, vm), back(u1 + 0.5, vm))
    down = (back(um, v0 - 0.5), back(um, v1 + 0.5))
    straight = abs(math.log((width / px_x) / (depth / px_y)))
    swapped = abs(math.log((depth / px_x) / (width / px_y)))
    (wa, wb, wpx, waxis), (da, db, dpx, daxis) = (
        ((*across, px_x, "x"), (*down, px_y, "y"))
        if straight <= swapped
        else ((*down, px_y, "y"), (*across, px_x, "x"))
    )
    w = WEIGHT["room"]
    return [
        PxScaleSample(width, wpx, w, waxis, "room_width", text, wa, wb),  # type: ignore[arg-type]
        PxScaleSample(depth, dpx, w, daxis, "room_depth", text, da, db),  # type: ignore[arg-type]
    ]


def _known_sample(
    candidates: CandidateSet, labels: LabelingResult, hints: RecognizeHints
) -> PxScaleSample | None:
    """The user's known dimension matched by the labeler: on a span (its length), a wall (its centre line)
    or, with null ids (preflight K20, "overall width / length / depth"), the walls' outer bbox across (x)
    for "width", else down (y)."""
    match, known = labels.known_dimension_match, hints.known_dimension
    if match is None or known is None:
        return None
    a: Pt | None = None
    b: Pt | None = None
    if match.span_id is not None:
        span = next((s for s in candidates.spans if s.id == match.span_id), None)
        if span is not None:
            a, b = span.p0, span.p1
    elif match.wall_id is not None:
        wall = next((w for w in candidates.walls if w.id == match.wall_id), None)
        if wall is not None:
            a, b = wall.a, wall.b
    else:
        dropped = {w.id for w in labels.walls if w.verdict == "not_wall"}
        walls = [w for w in candidates.walls if w.id not in dropped]
        if not walls:
            return None
        half = [w.thickness_px / 2.0 for w in walls]
        x0 = min(min(w.a[0], w.b[0]) - h for w, h in zip(walls, half, strict=True))
        x1 = max(max(w.a[0], w.b[0]) + h for w, h in zip(walls, half, strict=True))
        y0 = min(min(w.a[1], w.b[1]) - h for w, h in zip(walls, half, strict=True))
        y1 = max(max(w.a[1], w.b[1]) + h for w, h in zip(walls, half, strict=True))
        if any(word in known.label.lower() for word in KNOWN_X_WORDS):
            a, b = (x0, (y0 + y1) / 2.0), (x1, (y0 + y1) / 2.0)
        else:
            a, b = ((x0 + x1) / 2.0, y0), ((x0 + x1) / 2.0, y1)
    if a is None or b is None:
        return None
    span_px = math.dist(a, b)
    if span_px <= 0:
        return None
    return PxScaleSample(known.mm, span_px, WEIGHT["known"], _axis_of(a, b), "overall", known.label, a, b)


def _collect(
    candidates: CandidateSet, labels: LabelingResult, hints: RecognizeHints
) -> tuple[list[PxScaleSample], PxScaleSample | None, list[PxScaleSample]]:
    """The dimension samples, the known-dimension sample and the room samples (see `collect_samples`), without
    the implausible ones: spans under ``MIN_SPAN_PX`` or scales outside ``MIN_MM_PER_PX .. MAX_MM_PER_PX``."""
    texts = {t.id: t.text for t in candidates.texts}
    spans = {s.id: s for s in candidates.spans}
    dimensions: list[PxScaleSample] = []
    for d in labels.dimensions:
        span = spans.get(d.span_id) if d.span_id is not None else None
        if span is None or d.value_mm is None or d.value_mm <= 0:
            continue
        length = math.dist(span.p0, span.p1)
        if length <= 0:
            continue
        kind: SampleKind = d.kind if d.kind in ("chain_segment", "overall") else span.kind
        text = texts.get(d.text_id, str(d.value_mm))
        found = PxScaleSample(
            d.value_mm, length, WEIGHT[kind], span.axis, kind, text, span.p0, span.p1, span.line_id
        )
        if _plausible(found):
            dimensions.append(found)
    faces = {f.id: f for f in candidates.rooms if not f.open}
    rooms: list[PxScaleSample] = []
    for r in labels.rooms:
        face = faces.get(r.id)
        if face is None or r.width_mm is None or r.depth_mm is None or min(r.width_mm, r.depth_mm) <= 0:
            continue
        text = r.size_text or f"{r.width_mm} x {r.depth_mm}"
        pair = _room_samples(face, r.width_mm, r.depth_mm, candidates.theta0, text)
        if all(_plausible(s) for s in pair):
            rooms.extend(pair)
    known = _known_sample(candidates, labels, hints)
    return dimensions, known if known is not None and _plausible(known) else None, rooms


def collect_samples(
    candidates: CandidateSet, labels: LabelingResult, hints: RecognizeHints
) -> tuple[list[PxScaleSample], list[PxScaleSample]]:
    """The primary samples (labelled dimensions and the known dimension) and the room samples (§8.2 step 1).

    A dimension label gives a sample when it has a value and a span: kind ``chain_segment`` (w = 1) or
    ``overall`` (w = 2), the labeler's kind overriding the span's (``room_interior`` / ``unknown`` keep the
    span's). A room gives two (w = 0.5) when the labeler parsed both sizes in mm and its face is closed
    (step 1: a face closed only across a passage, ``RoomFace.open``, may span the next space)."""
    dimensions, known, rooms = _collect(candidates, labels, hints)
    return [*dimensions, *([known] if known is not None else [])], rooms


# --- scale note -----------------------------------------------------------------------------------------


def find_scale_note(tokens: Sequence[TextToken], page: NormalizedPage) -> ScaleNote | None:
    """A ``scale_note`` token (``1:N``) on a PDF page (vector or raster) rendered at a known DPI on a
    standard paper size (ISO A0-A4, ANSI A-E, +-2 %): ``mm/px = N x 25.4 / dpi``, with the DPI of the
    normalized page (the render DPI times its transform's scale, progress ruling on resampled PDFs). Several
    notes: the most frequent N, ties to the first."""
    if page.source_kind not in NOTE_KINDS or not page.dpi or page.page_size_pt is None:
        return None
    if not is_standard_paper(*page.page_size_pt):
        return None
    notes = [t for t in tokens if t.parsed.kind == "scale_note" and t.parsed.scale_n]
    if not notes:
        return None
    counts = [sum(o.parsed.scale_n == t.parsed.scale_n for o in notes) for t in notes]
    note = notes[counts.index(max(counts))]
    n = int(note.parsed.scale_n or 0)
    m = page.transform
    resample = math.sqrt(abs(float(m[0][0] * m[1][1] - m[0][1] * m[1][0])))
    return ScaleNote(n, n * MM_PER_INCH / (page.dpi * resample), note.text)


# --- solve ----------------------------------------------------------------------------------------------


def _consistent_chains(inliers: Sequence[PxScaleSample]) -> int:
    """Step 6: dimension lines whose chain segments (>= 2) sum to an ``overall`` value on another, parallel
    line covering the same extent, both within 1 %."""
    chains: dict[str, list[PxScaleSample]] = {}
    for s in inliers:
        if s.kind == "chain_segment" and s.line_id is not None:
            chains.setdefault(s.line_id, []).append(s)
    overalls = [s for s in inliers if s.kind == "overall" and s.line_id is not None]
    count = 0
    for line_id, group in chains.items():
        if len(group) < 2:
            continue
        total = sum(s.value_mm for s in group)
        for o in overalls:
            if o.line_id == line_id or o.axis != group[0].axis or o.axis == "other":
                continue
            if abs(total / o.value_mm - 1.0) > CONSISTENT_FRAC:
                continue
            ux, uy = (o.b_px[0] - o.a_px[0]) / o.span_px, (o.b_px[1] - o.a_px[1]) / o.span_px
            along = [p[0] * ux + p[1] * uy for s in group for p in (s.a_px, s.b_px)]
            ends = sorted((o.a_px[0] * ux + o.a_px[1] * uy, o.b_px[0] * ux + o.b_px[1] * uy))
            tol = CONSISTENT_FRAC * o.span_px
            if abs(min(along) - ends[0]) <= tol and abs(max(along) - ends[1]) <= tol:
                count += 1
                break
    return count


def _scaled_y(s: PxScaleSample, factor: float) -> PxScaleSample:
    a, b = (s.a_px[0], s.a_px[1] * factor), (s.b_px[0], s.b_px[1] * factor)
    old = math.dist(s.a_px, s.b_px)
    span = s.span_px * (math.dist(a, b) / old if old > 0 else 1.0)
    return replace(s, a_px=a, b_px=b, span_px=span)


def _anisotropy(fit: FitResult, page: NormalizedPage) -> float:
    """Step 7: k_y / k_x when both axes have >= 3 inliers, |k_x / k_y - 1| > 2 % and the page is a
    raster one (or a rectified photo); else 1."""
    if page.source_kind not in ANISO_KINDS and not page.page_image.rectified:
        return 1.0
    xs = [s for s in fit.inliers if s.axis == "x"]
    ys = [s for s in fit.inliers if s.axis == "y"]
    if len(xs) < ANISO_MIN_INLIERS or len(ys) < ANISO_MIN_INLIERS:
        return 1.0
    k_x, k_y = _wls(xs), _wls(ys)
    return k_y / k_x if abs(k_x / k_y - 1.0) > ANISO_MIN_FRAC else 1.0


def _room_check(rooms: Sequence[PxScaleSample], k: float) -> RoomLabelCheck:
    """Step 9: the median over rooms (each the mean over its two samples) of |v / (k p) - 1| x 100."""
    per_room = [
        (abs(w.value_mm / (k * w.span_px) - 1.0) + abs(d.value_mm / (k * d.span_px) - 1.0)) * 50.0
        for w, d in zip(rooms[0::2], rooms[1::2], strict=True)
    ]
    return RoomLabelCheck(
        rooms=len(per_room), median_discrepancy_pct=statistics.median(per_room) if per_room else None
    )


def solve_scale(
    candidates: CandidateSet,
    labels: LabelingResult,
    hints: RecognizeHints,
    page: NormalizedPage,
    ctx: PipelineContext,
    *,
    scale_note: ScaleNote | None,
) -> ScaleResult:
    """06 §8.2: the scale of the page in mm per normalized px, with its method, fit and warnings
    (``scale_from_room_labels``, ``scale_guessed``, ``scale_anisotropy_corrected``, ``scale_high_residual``,
    ``scale_room_label_mismatch``)."""
    dimensions, known, rooms = _collect(candidates, labels, hints)
    primary = [*dimensions, *([known] if known is not None else [])]
    method: ScaleMethod
    fitted: list[PxScaleSample]
    if len(primary) >= 2:
        method, fitted = "dimension_chain", primary
    elif rooms:
        method, fitted = "room_label", rooms
    elif scale_note is not None:
        method, fitted = "scale_note", []
    elif known is not None:
        method, fitted = "user_hint", [known]
    else:
        method, fitted = "default_guess", []
    room_rooms = len(rooms) // 2

    if not fitted:
        if method == "scale_note" and scale_note is not None:
            mm_per_px = scale_note.mm_per_px
        else:
            mm_per_px = GUESS_LONG_EDGE_MM / max(candidates.region.w, candidates.region.h)
            ctx.warn("scale_guessed", {"assumedLongEdgeMm": GUESS_LONG_EDGE_MM})
        return ScaleResult(
            mm_per_px=mm_per_px,
            method=method,
            residual_pct=None,
            samples=0,
            rejected=0,
            confidence=scale_confidence(method, None, 0, 0),
            anisotropy_corrected=False,
            y_factor=1.0,
            room_label_check=RoomLabelCheck(rooms=room_rooms, median_discrepancy_pct=None),
            used_samples=[],
            inlier_flags=[],
            consistent_chains=0,
        )

    fit = fit_scale(fitted)
    y_factor = _anisotropy(fit, page)
    corrected = y_factor != 1.0
    k = fit.k
    inliers, rejected = fit.inliers, fit.rejected
    if corrected:
        k = _wls([s for s in fit.inliers if s.axis == "x"])
        inliers = [_scaled_y(s, y_factor) for s in inliers]
        rejected = [_scaled_y(s, y_factor) for s in rejected]
        rooms = [_scaled_y(s, y_factor) for s in rooms]
        ctx.warn("scale_anisotropy_corrected", {"ratioPct": round(abs(y_factor - 1.0) * 100.0, 1)})
    residual = _residual_pct(inliers, k)
    consistent = _consistent_chains(inliers) if method == "dimension_chain" else 0
    confidence = scale_confidence(method, residual, len(inliers), consistent)
    if method == "room_label":
        ctx.warn("scale_from_room_labels", {"rooms": room_rooms})
        check = RoomLabelCheck(rooms=room_rooms, median_discrepancy_pct=None)
    else:
        check = _room_check(rooms, k)
        if check.median_discrepancy_pct is not None and check.median_discrepancy_pct > ROOM_MISMATCH_PCT:
            ctx.warn("scale_room_label_mismatch", {"discrepancyPct": round(check.median_discrepancy_pct, 1)})
            confidence *= ROOM_MISMATCH_FACTOR
    if residual > HIGH_RESIDUAL_PCT:
        ctx.warn("scale_high_residual", {"residualPct": round(residual, 1)})
    used = [*inliers, *rejected]
    return ScaleResult(
        mm_per_px=k,
        method=method,
        residual_pct=residual,
        samples=len(inliers),
        rejected=len(rejected),
        confidence=min(1.0, max(0.0, confidence)),
        anisotropy_corrected=corrected,
        y_factor=y_factor,
        room_label_check=check,
        used_samples=used,
        inlier_flags=[True] * len(inliers) + [False] * len(rejected),
        consistent_chains=consistent,
    )


def to_scale_meta(result: ScaleResult) -> ScaleMeta:
    """``ImportResultMeta.scale`` (06 §6): sample ends in document mm (``round(px x mm/px)``, held to the
    document's coordinate range, so an absurd scale from bad labels still serializes), at most 60 samples,
    inliers first."""
    k = result.mm_per_px

    def coord(v: float) -> int:
        return max(-MAX_COORD_MM, min(MAX_COORD_MM, round(v * k)))

    def mm(p: Pt) -> Point:
        return Point(x=coord(p[0]), y=coord(p[1]))

    pairs = list(zip(result.used_samples, result.inlier_flags, strict=True))
    pairs.sort(key=lambda p: not p[1])  # stable: inliers first, each in sample order
    return ScaleMeta(
        mm_per_pixel=k,
        method=result.method,
        residual_pct=result.residual_pct,
        samples=result.samples,
        rejected=result.rejected,
        confidence=min(1.0, max(0.0, result.confidence)),
        anisotropy_corrected=result.anisotropy_corrected,
        room_label_check=result.room_label_check,
        used_samples=[
            ScaleSample(
                text=s.text, value_mm=s.value_mm, a=mm(s.a_px), b=mm(s.b_px), inlier=flag, kind=s.kind
            )
            for s, flag in pairs[:MAX_META_SAMPLES]
        ],
    )
