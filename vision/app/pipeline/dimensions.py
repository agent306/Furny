"""Dimension lines, dimension spans and heuristic text association (06 §8.4 steps 1-5, §8.1 step 2).

A dimension line is a thin segment with at least two ticks and a numeric label beside it. Ticks come from
three sources: short slanted or perpendicular strokes crossing the line, perpendicular extension lines
touching it, and (raster pages) the strokes and blobs found in the ink around the line. LSD drops strokes
shorter than its minimum length, and the spec's tick length range (0.005 L ... 0.03 L) reaches below that
limit (`max(8 px, 0.008 L)`), so on raster pages the interior ticks are usually only visible in the ink.

Raster pages (Task 14b, see `_raster_lines`): a dimension line arrives from LSD in pieces (broken at its
ticks and crossings, cut under its labels by the text mask, falling apart where it is faint), so the pieces
are chained into lines first. A partition face meeting perpendicular partitions, an extension line crossing
a chain and a door jamb crossing a line all look like a line with ticks and a label nearby; such lines are
dropped when they pair as a double-line wall face, when they own no label (each label belongs to the line
it stands on) and, on lines drawn with terminator marks, strokes that merely run through them are no ticks.
Pages without ink (vector pages) keep the Task 14 rules unchanged.
"""

import bisect
import itertools
import math
from collections.abc import Callable, Sequence

import numpy as np

from app.pipeline.dimension_candidates import Evidence, candidate_lines, wall_faces
from app.pipeline.dimension_ticks import (
    TICK_DEDUPE_PX,
    TICK_MAX_FRAC,
    TICK_MIN_FRAC,
    along_and_across,
    dedupe_ticks,
    ink_ticks,
    segment_ticks,
    styled_ticks,
    unit,
)
from app.schemas.candidates import DimensionLine, DimensionSpan, Segment, TextToken
from app.utils.geometry import Pt, Rect, seg_angle_deg

__all__ = ["associate_dimension_texts", "find_dimension_lines", "find_dimension_spans"]

NUMERIC_KINDS = frozenset({"mm_number", "metric_length", "feet_inch"})
MIN_LINE_FRAC = 0.04  # a dimension line is at least this long (fraction of the plan region's long side L)
TEXT_REACH = 2.5  # a label lies within this many text heights of the line
ASSOC_TIE_FRAC = 0.01  # spans whose midpoints lie this share of their length closer tie (step 5)
OWNER_TIE_PX = 3.0  # lines this much farther from a label than the nearest one share it
STACK_REACH = 2.0  # lines on both sides of a label within 2 text heights contest it (stacked chains)
SCALE_MIN_SAMPLES = 3  # uncontested labels needed for a scale estimate ...
SCALE_FIT = 0.15  # ... a contested label fits an interval within this log ratio of it ...
SCALE_MARGIN = 0.05  # ... and clearly better than the next interval by this much
AXIS_TOL_DEG = 10.0  # x / y axis and text-orientation tolerance
CROSS_TOL_DEG = 30.0  # another dimension line crossing within 90 +- 30 degrees takes no unmarked tick


def _numeric(tokens: Sequence[TextToken]) -> list[TextToken]:
    return [t for t in tokens if t.parsed.kind in NUMERIC_KINDS]


def _centre(token: TextToken) -> Pt:
    return (token.box[0] + token.box[2]) / 2, (token.box[1] + token.box[3]) / 2


class _Labels:
    """Numeric tokens as arrays: centre x / y, the glyph height, the reach (2.5 text heights) and the text
    angle."""

    def __init__(self, tokens: Sequence[TextToken]) -> None:
        centres = np.array([_centre(t) for t in tokens], np.float64).reshape(-1, 2)
        self.x, self.y = centres[:, 0], centres[:, 1]
        self.height = np.array([t.height_px for t in tokens], np.float64)
        self.reach = TEXT_REACH * self.height
        self.angle = np.array([t.angle for t in tokens], np.int64)
        self.value = np.array([float(t.parsed.mm or 0) for t in tokens], np.float64)

    def __len__(self) -> int:
        return len(self.x)

    def _near(self, line: Segment, oriented: bool) -> tuple[np.ndarray, np.ndarray, float, float]:
        """Which labels are beside ``line`` (see `beside`), their signed distances across it and its unit
        direction."""
        ux, uy, length = unit(line.p0, line.p1)
        rx, ry = self.x - line.p0[0], self.y - line.p0[1]
        along, across = rx * ux + ry * uy, -rx * uy + ry * ux
        near = (along >= 0.0) & (along <= length) & (np.abs(across) <= self.reach)
        if oriented:
            wanted = {"x": 0, "y": 90}.get(_axis_of_points(line.p0, line.p1))
            if wanted is not None:
                near &= self.angle == wanted
        return near, across, ux, uy

    def beside(self, line: Segment, *, oriented: bool = False) -> bool:
        """Whether a label centre projects onto `line` and lies within its reach across it. ``oriented``
        (raster pages): written along the line, angle 0 beside an x line and 90 beside a y line (06 §8.4
        step 3's orientation rule; any angle beside a line on neither axis)."""
        return bool(np.any(self._near(line, oriented)[0]))

    def owners(self, lines: Sequence[Segment], ticks: Sequence[Sequence[tuple[float, bool]]]) -> set[int]:
        """Indices of the ``lines`` (with their ``ticks``: u, marked) that some label belongs to.

        A label (oriented, see `beside`) belongs to the nearest line across, on either side (06 §8.4 step 1
        names no side), and to the lines within `OWNER_TIE_PX` of that distance on the same side (collinear
        copies of one line). Stacked lines contest it: lines on the other side of the label within
        `STACK_REACH` text heights. Among the contenders (and the nearest), in this order:
        1. the lines whose consecutive ticks bracket the label's projection;
        2. with a scale estimate (the median mm per px of the uncontested labels in a bracketing interval,
           from at least `SCALE_MIN_SAMPLES` of them), the line whose bracketing interval matches the label's
           value best, when it fits within `SCALE_FIT` (log ratio) and clearly (by `SCALE_MARGIN`) better
           than the next;
        3. the lines with the most terminator marks on the two ticks bracketing the label (a dimension line
           carries the marks; an extension-crossed line beside it has bare crossings);
        4. the lines that own no uncontested label (each dimension line has a label of its own);
        5. the nearest.
        A line owning no label is no dimension line, so an extension line, a face line or a stacked chain next
        to a dimension line does not borrow its label (Task 14b fix round 1, replacing the baseline side)."""
        n_lines, n_labels = len(lines), len(self)
        if not n_lines:
            return set()
        across = np.full((n_lines, n_labels), np.nan)
        along = np.full((n_lines, n_labels), np.nan)
        for k, line in enumerate(lines):
            near, acr, ux, uy = self._near(line, True)
            rx, ry = self.x - line.p0[0], self.y - line.p0[1]
            across[k, near] = acr[near]
            along[k, near] = (rx * ux + ry * uy)[near]
        positions = [sorted(u for u, _ in t) for t in ticks]

        def bracket(k: int, j: int) -> tuple[float, float] | None:
            pos = positions[k]
            i = bisect.bisect_right(pos, along[k, j])
            return (pos[i - 1], pos[i]) if 0 < i < len(pos) else None

        def end_marks(k: int, j: int) -> int:
            """Terminator-marked ticks among the two bracketing the label's projection on line ``k``."""
            iv = bracket(k, j)
            if iv is None:
                return 0
            return sum(1 for u, m in ticks[k] if m and u in iv)

        def contenders(j: int) -> tuple[int, list[int]]:
            near = np.flatnonzero(~np.isnan(across[:, j]))
            if not near.size:
                return -1, []
            dist = np.abs(across[near, j])
            nearest = int(near[np.argmin(dist)])
            side = np.sign(across[nearest, j])
            rival = [
                int(k)
                for k in near
                if np.sign(across[k, j]) != side and abs(across[k, j]) <= STACK_REACH * self.height[j]
            ]
            if abs(across[nearest, j]) > STACK_REACH * self.height[j]:
                rival = []
            return nearest, [nearest, *rival]

        contest = [contenders(j) for j in range(n_labels)]
        owned_alone: set[int] = {c[0] for c in contest if len(c[1]) == 1}
        samples = []
        for j, (nearest, cands) in enumerate(contest):
            interval = bracket(nearest, j) if len(cands) == 1 else None
            if interval is not None and self.value[j] > 0 and interval[1] > interval[0]:
                samples.append(self.value[j] / (interval[1] - interval[0]))
        scale = float(np.median(samples)) if len(samples) >= SCALE_MIN_SAMPLES else None

        owners: set[int] = set()
        for j, (nearest, cands) in enumerate(contest):
            if nearest < 0:
                continue
            pool = cands
            if len(pool) > 1:
                bracketed = [k for k in pool if bracket(k, j) is not None]
                pool = bracketed or pool
            if len(pool) > 1 and scale is not None and self.value[j] > 0:
                misfit = {}
                for k in pool:
                    iv = bracket(k, j)
                    if iv is not None:
                        misfit[k] = abs(math.log(self.value[j] / (scale * max(iv[1] - iv[0], 1e-9))))
                if misfit:
                    ranked = sorted(misfit, key=lambda k: misfit[k])
                    clear = len(ranked) == 1 or misfit[ranked[1]] - misfit[ranked[0]] >= SCALE_MARGIN
                    if misfit[ranked[0]] <= SCALE_FIT and clear:
                        pool = [ranked[0]]
            if len(pool) > 1:
                marked = {k: end_marks(k, j) for k in pool}
                most = max(marked.values())
                pool = [k for k in pool if marked[k] == most]
            if len(pool) > 1:
                pool = [k for k in pool if k not in owned_alone] or pool
            winner = min(pool, key=lambda k: abs(across[k, j]))
            side = np.sign(across[winner, j])
            d = abs(across[winner, j])
            for other in np.flatnonzero(~np.isnan(across[:, j])).tolist():
                if np.sign(across[other, j]) == side and abs(across[other, j]) <= d + OWNER_TIE_PX:
                    owners.add(int(other))
        return owners


# --- dimension lines ----------------------------------------------------------------------------------


def _drop_crossings(
    found: Sequence[tuple[Segment, list[tuple[float, bool]]]],
) -> list[tuple[Segment, list[tuple[float, bool]]]]:
    """Each line without its ticks where another of the dimension lines crosses or meets it: a dimension
    line is no extension line of another (Task 14b). An unmarked tick there is dropped; a marked one only
    when the other line has a tick of its own at the crossing and more ticks than this line (the slash is
    the other line's: an extension line crossing a chain at the chain's tick). Other marked ticks stay (an
    extension line with a slash there may run along the other line's end)."""
    out = []
    for k, (line, ticks) in enumerate(found):
        ux, uy, _ = unit(line.p0, line.p1)
        gap = max(TICK_DEDUPE_PX, 2.0 * line.width_px)
        crossings: list[tuple[float, bool]] = []  # (u, the crossing is the other line's tick)
        for j, (other, other_ticks) in enumerate(found):
            if j == k:
                continue
            vx, vy, other_len = unit(other.p0, other.p1)
            if abs(ux * vx + uy * vy) > math.cos(math.radians(90.0 - CROSS_TOL_DEG)):
                continue
            # where the other line's axis meets this one
            s0, h0 = along_and_across(line.p0, line.p1, other.p0)
            s1, h1 = along_and_across(line.p0, line.p1, other.p1)
            if h0 == h1:
                continue
            t = h0 / (h0 - h1)  # along the other line, 0..1 inside it
            reach = (gap + other.width_px) / other_len
            if -reach <= t <= 1.0 + reach:
                at = t * other_len
                theirs = len(other_ticks) > len(ticks) and any(abs(at - u) <= gap for u, _ in other_ticks)
                crossings.append((s0 + t * (s1 - s0), theirs))
        kept = [
            (u, marked)
            for u, marked in ticks
            if all(abs(u - c) > gap or (marked and not theirs) for c, theirs in crossings)
        ]
        out.append((line, kept))
    return out


def _collinear_overlap(a: DimensionLine, b: DimensionLine) -> bool:
    """Whether the lines lie on the same stroke: parallel within 2 degrees, <= 3 px apart, overlapping."""
    ang_a = seg_angle_deg(*a.p0, *a.p1)
    ang_b = seg_angle_deg(*b.p0, *b.p1)
    diff = abs(ang_a - ang_b)
    if min(diff, 180.0 - diff) > 2.0:
        return False
    _, across = along_and_across(a.p0, a.p1, ((b.p0[0] + b.p1[0]) / 2, (b.p0[1] + b.p1[1]) / 2))
    if abs(across) > 3.0:
        return False
    len_a, len_b = math.dist(a.p0, a.p1), math.dist(b.p0, b.p1)
    s0, _ = along_and_across(a.p0, a.p1, b.p0)
    s1, _ = along_and_across(a.p0, a.p1, b.p1)
    overlap = min(max(s0, s1), len_a) - max(min(s0, s1), 0.0)
    return overlap >= 0.5 * min(len_a, len_b)


def _vector_lines(
    thin: Sequence[Segment], labels: _Labels, long_side: float, check_deadline: Callable[[], None] | None
) -> list[tuple[Segment, list[float]]]:
    """Candidates without ink (vector pages), best-supported first: each thin segment with a label beside
    it and >= 2 ticks among the other segments (unchanged since Task 14)."""
    lo, hi = TICK_MIN_FRAC * long_side, TICK_MAX_FRAC * long_side
    p0 = np.array([s.p0 for s in thin], np.float64).reshape(-1, 2)
    p1 = np.array([s.p1 for s in thin], np.float64).reshape(-1, 2)
    found = []
    for index, cand in enumerate(thin):
        if check_deadline is not None:
            check_deadline()
        if cand.length < MIN_LINE_FRAC * long_side or not labels.beside(cand):
            continue
        ticks = dedupe_ticks([u for u, _ in segment_ticks(cand, [index], p0, p1, lo, hi)], TICK_DEDUPE_PX)
        if len(ticks) >= 2:
            found.append((cand, ticks))
    found.sort(key=lambda f: (-len(f[1]), -f[0].length))  # the best-supported stroke of a duplicate wins
    return found


def _raster_lines(
    segments: Sequence[Segment],
    thin: Sequence[Segment],
    tokens: Sequence[TextToken],
    labels: _Labels,
    ink: np.ndarray,
    gray: np.ndarray | None,
    t_thin: float | None,
    long_side: float,
    check_deadline: Callable[[], None] | None,
) -> list[tuple[Segment, list[float]]]:
    """Candidates on raster pages (Task 14b), best-supported first: the thin pieces chained into lines
    (`candidate_lines`), each with an oriented label beside it and >= 2 ticks from the segments and the ink
    (`styled_ticks`); then wall faces are dropped (`wall_faces`), lines that own no label
    (`_Labels.owners`) and the unmarked ticks where another dimension line crosses (`_drop_crossings`)."""
    lo, hi = TICK_MIN_FRAC * long_side, TICK_MAX_FRAC * long_side
    p0 = np.array([s.p0 for s in thin], np.float64).reshape(-1, 2)
    p1 = np.array([s.p1 for s in thin], np.float64).reshape(-1, 2)
    boxes = np.array([t.box for t in tokens], np.float64).reshape(-1, 4)
    chains = candidate_lines(thin, Evidence(ink, gray, boxes), long_side, check_deadline)
    width = float(np.median([s.width_px for s in thin])) if t_thin is None else t_thin
    found: list[tuple[Segment, list[tuple[float, bool]]]] = []
    for cand, members in chains:
        if check_deadline is not None:
            check_deadline()
        if cand.length < MIN_LINE_FRAC * long_side or not labels.beside(cand, oriented=True):
            continue
        marks = segment_ticks(cand, members, p0, p1, lo, hi)
        # A line chained from pieces or run on beyond its piece is drawn into its band (`_draw_pieces`).
        pieces = [(thin[k].p0, thin[k].p1) for k in members]
        whole = len(members) == 1 and cand.length <= thin[members[0]].length + 1.0
        from_ink = ink_ticks(cand, ink, long_side, check_deadline, [] if whole else pieces)
        ticks = styled_ticks(marks, max(TICK_DEDUPE_PX, 2.0 * cand.width_px), from_ink, long_side, width)
        if len(ticks) >= 2:
            found.append((cand, ticks))
    if not found:
        return []
    partners = [c for c, _ in chains] + [s for s in segments if not s.is_thin and s.length > 0]
    centres = np.array([_centre(t) for t in tokens], np.float64).reshape(-1, 2)
    faces = wall_faces(found, partners, ink, centres, width, long_side, float(np.median(labels.height)))
    found = [f for k, f in enumerate(found) if k not in faces]
    owners = labels.owners([c for c, _ in found], [t for _, t in found])
    found = [f for k, f in enumerate(found) if k in owners]
    found = [(c, t) for c, t in _drop_crossings(found) if len(t) >= 2]
    # The best-supported stroke of a duplicate wins: most terminator marks, then most ticks, then longest.
    found.sort(key=lambda f: (-sum(m for _, m in f[1]), -len(f[1]), -f[0].length))
    return [(c, [u for u, _ in t]) for c, t in found]


def find_dimension_lines(
    segments: Sequence[Segment],
    tokens: Sequence[TextToken],
    region: Rect,
    *,
    ink: np.ndarray | None = None,
    gray: np.ndarray | None = None,
    t_thin: float | None = None,
    check_deadline: Callable[[], None] | None = None,
) -> list[DimensionLine]:
    """Dimension lines among the thin segments (06 §8.4 step 1). Runs before wall extraction.

    A candidate is a thin segment of length >= 0.04 L (`L` = long side of `region`) with a numeric token
    (`mm_number`, `metric_length`, `feet_inch`) alongside it within 2.5 text heights, and with >= 2 ticks.
    Ticks come from other thin segments (slash / perpendicular strokes crossing the line in their middle
    80 %, 0.005 L ... 0.03 L long; perpendicular extension lines touching it or crossing it by a few px).
    On raster pages pass the page's `ink` mask as well: ticks are then also found in the ink around the
    line (see `ink_ticks`; LSD drops strokes shorter than its minimum length, which includes many
    interior ticks), together with dot / arrowhead blobs, and the raster rules of Task 14b apply
    (`_raster_lines`): a candidate is a chain of thin pieces, its label must be written along it and stand
    on it, and wall faces are no dimension lines. Pass a text-free mask (`OcrResult.ink_notext`, not
    `Preprocessed.ink`) so that glyphs touching the line cannot read as ticks; pass the page's `gray` image
    (`Preprocessed.gray`) so that faint lines broken up in the ink are chained and lengthened, and `t_thin`
    (`Preprocessed.t_thin`; default: the median width of the thin segments) for the wall-face distances.
    Ticks closer than 4 px are one tick (`max(4, 2 line widths)` on raster pages). Collinear duplicates of
    one line are dropped. Ids `L1..Ln` follow the (min y, min x, max y, max x) order of the lines.
    `check_deadline` is called for every candidate.
    """
    long_side = float(region.long_side)
    numeric = _numeric(tokens)
    if not numeric or long_side <= 0:
        return []
    labels = _Labels(numeric)
    thin = [s for s in segments if s.is_thin and s.length > 0]
    if ink is None:
        found = _vector_lines(thin, labels, long_side, check_deadline)
    else:
        found = _raster_lines(segments, thin, tokens, labels, ink, gray, t_thin, long_side, check_deadline)
    kept: list[DimensionLine] = []
    for cand, ticks in found:
        line = DimensionLine("", cand.p0, cand.p1, ticks, cand.id)
        if not any(_collinear_overlap(k, line) for k in kept):
            kept.append(line)
    kept.sort(
        key=lambda ln: (
            min(ln.p0[1], ln.p1[1]),
            min(ln.p0[0], ln.p1[0]),
            max(ln.p0[1], ln.p1[1]),
            max(ln.p0[0], ln.p1[0]),
        )
    )
    return [
        DimensionLine(f"L{n}", ln.p0, ln.p1, ln.tick_positions, ln.segment_id) for n, ln in enumerate(kept, 1)
    ]


# --- spans --------------------------------------------------------------------------------------------


def _axis(line: DimensionLine) -> str:
    return _axis_of_points(line.p0, line.p1)


def _axis_of_points(p0: Pt, p1: Pt) -> str:
    angle = seg_angle_deg(*p0, *p1)
    if min(angle, 180.0 - angle) <= AXIS_TOL_DEG:
        return "x"
    if abs(angle - 90.0) <= AXIS_TOL_DEG:
        return "y"
    return "other"


def find_dimension_spans(
    lines: Sequence[DimensionLine], tokens: Sequence[TextToken], region: Rect
) -> list[DimensionSpan]:
    """Spans of each dimension line (06 §8.4 steps 2-4).

    Consecutive ticks give `chain_segment` spans; first-to-last gives an `overall` span when there are >= 3
    ticks, and with exactly 2 ticks the single span is the `overall` one. `near_text_ids` holds the
    numeric tokens whose centre projects between the span's ticks, within 2.5 text heights of the line,
    with matching orientation (angle 0 on x lines, 90 on y lines; none on other lines), ordered along the
    line. Ids `D1..Dn` run over the lines in the given order (geometric, as `find_dimension_lines` returns
    them): chain spans left to right, then the overall span.
    `region` is part of the stage interface (06 §8.4) and is not needed here: all rules are in pixels and
    text heights.
    """
    del region
    numeric = _numeric(tokens)
    spans: list[DimensionSpan] = []
    for line in lines:
        ux, uy, _ = unit(line.p0, line.p1)
        axis = _axis(line)
        wanted = {"x": 0, "y": 90}.get(axis)
        placed: list[tuple[float, float, TextToken]] = []  # (along, across, token)
        for token in numeric:
            if token.angle != wanted:
                continue
            along, across = along_and_across(line.p0, line.p1, _centre(token))
            if abs(across) <= TEXT_REACH * token.height_px:
                placed.append((along, across, token))
        ticks = sorted(line.tick_positions)
        ranges = [(a, b, "chain_segment") for a, b in itertools.pairwise(ticks)]
        if len(ticks) == 2:
            ranges = [(ticks[0], ticks[1], "overall")]
        elif len(ticks) > 2:
            ranges.append((ticks[0], ticks[-1], "overall"))
        for a, b, kind in ranges:
            near = sorted((along, t.id) for along, _, t in placed if a <= along <= b)
            spans.append(
                DimensionSpan(
                    id=f"D{len(spans) + 1}",
                    p0=(line.p0[0] + a * ux, line.p0[1] + a * uy),
                    p1=(line.p0[0] + b * ux, line.p0[1] + b * uy),
                    axis=axis,  # type: ignore[arg-type]
                    kind=kind,  # type: ignore[arg-type]
                    near_text_ids=[tid for _, tid in near],
                    line_id=line.id,
                )
            )
    return spans


def associate_dimension_texts(spans: Sequence[DimensionSpan], tokens: Sequence[TextToken]) -> dict[str, str]:
    """Heuristic text -> span association (06 §8.4 step 5), text id -> span id.

    Each numeric token is assigned to the span listing it whose midpoint is nearest to the token centre's
    projection on the span; ties go to the shorter span. Spans of (nearly) one extent on parallel lines (an
    overall line and the chain beside it, both listing the overall label: length and midpoint distance
    within `ASSOC_TIE_FRAC` of the span) go to the one on a line at least a text height nearer to the token
    (Task 14b fix round 1; 06 names the shorter span only). Tokens no span lists are left out.
    """
    by_id = {t.id: t for t in _numeric(tokens)}
    listed: dict[str, list[tuple[float, float, float, int]]] = {}
    for order, span in enumerate(spans):
        length = math.dist(span.p0, span.p1)
        for text_id in span.near_text_ids:
            token = by_id.get(text_id)
            if token is None:
                continue
            along, across = along_and_across(span.p0, span.p1, _centre(token))
            listed.setdefault(text_id, []).append((abs(along - length / 2), abs(across), length, order))
    out = {}
    for text_id, options in listed.items():
        first = min(options, key=lambda o: (round(o[0], 6), o[2], o[3]))
        same = [  # spans of (nearly) the same extent as the first, on lines nearer to the token
            o
            for o in options
            if abs(o[2] - first[2]) <= ASSOC_TIE_FRAC * first[2]
            and abs(o[0] - first[0]) <= ASSOC_TIE_FRAC * first[2]
            and o[1] <= first[1] - by_id[text_id].height_px  # a parallel line a text height nearer
        ]
        chosen = min(same, key=lambda o: (round(o[1], 6), o[3])) if same else first
        out[text_id] = spans[chosen[3]].id
    return out
