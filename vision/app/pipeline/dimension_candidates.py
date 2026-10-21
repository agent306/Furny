"""Candidate dimension lines on raster pages (Task 14b): thin pieces chained into lines, and the
candidates that pair as double-line wall faces.

Split out of `dimensions.py`; `find_dimension_lines` there is the stage's API.
"""

import itertools
import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass

import numpy as np

from app.pipeline.dimension_ticks import END_SLACK_PX, THICK_FACTOR, THICK_MARGIN_PX, along_and_across, unit
from app.schemas.candidates import Segment

CHAIN_ANGLE_DEG = 2.0  # thin pieces of one line: parallel within 2 degrees ...
CHAIN_OFFSET_PX = 3.0  # ... each end within max(3 px, the wider stroke) of the other's line ...
CHAIN_GAP_FRAC = 0.06  # ... and at most 0.06 L apart, the gap inked or under a text box (raster pages)
CHAIN_GAP_COVER = 0.9
CHAIN_ACROSS_PX = 2  # ... within 2 px across (the line may bow a little between its pieces) ...
GAP_CONTRAST = 8.0  # ... darker than the paper 5-8 px beside it by this many gray levels ...
PAPER_NEAR_PX, PAPER_FAR_PX = 5, 8
CHAIN_TEXT_MARGIN_PX = 3.0  # ... or under a text box grown by this margin
CHAIN_DARKNESS_RATIO = 1.6  # pieces of one line are drawn with one pen: ink darkness within 1.6x
EXTEND_GAP_PX = 4  # a chain's ends run on (alone: not into a wall) through gaps of up to 4 px
# A line paired like a double-line wall face is no dimension line (the walls stage's pair rules, 06 §8.1
# step 3 with ruling R6): both lines >= 0.03 L, parallel within 2 degrees, 1.5 t_thin ... 0.02 L apart,
# overlapping >= 60 % of the shorter, the strip between them free of text and hollow or filled.
FACE_MIN_LEN_FRAC = 0.03
FACE_ANGLE_DEG = 2.0
FACE_D_MIN_THIN, FACE_D_MAX_FRAC = 1.5, 0.02
FACE_OVERLAP = 0.6
FACE_HOLLOW_MAX, FACE_FILLED_MIN = 0.15, 0.85


# --- candidate lines: chains of thin pieces ----------------------------------------------------------


class _Chains:
    """Union-find over the thin pieces of one stroke."""

    def __init__(self, n: int) -> None:
        self.parent = list(range(n))

    def find(self, i: int) -> int:
        while self.parent[i] != i:
            self.parent[i] = self.parent[self.parent[i]]
            i = self.parent[i]
        return i

    def union(self, i: int, j: int) -> None:
        ri, rj = self.find(i), self.find(j)
        if ri != rj:
            self.parent[max(ri, rj)] = min(ri, rj)


@dataclass(frozen=True)
class Evidence:
    """What shows a line running on through a gap between two of its pieces: the ink, the page's gray
    image (a faint line that the ink threshold broke up) and the text boxes (the text mask cuts a line
    under its label)."""

    ink: np.ndarray | None
    gray: np.ndarray | None
    boxes: np.ndarray  # (k, 4) token boxes

    def covered(self, a: np.ndarray, b: np.ndarray, normal: np.ndarray, width: float) -> bool:
        """At least 90 % of the gap ``a`` -> ``b`` is inked, darker than the paper beside it or under a text
        box (within `CHAIN_ACROSS_PX` across: the line may bow a little between its pieces), and no wall
        crosses it: no stroke crossing the gap is wider than ``2.5 width + 2`` (the ink covering the line
        and ``2.5 width / 2 + 2`` px on either side; a chain interrupted by a solid wall is two dimension
        lines, each ending at the wall)."""
        n = max(2, math.ceil(float(np.hypot(*(b - a)))) + 1)
        pts = a + np.linspace(0.0, 1.0, n)[:, None] * (b - a)
        if self.ink is not None:
            limit = THICK_FACTOR * width + THICK_MARGIN_PX
            half = math.ceil(limit / 2.0) + 1
            across = np.arange(-half, half + 1, dtype=np.float64)
            wide = (_sample_rows(self.ink, pts, normal, across) > 0).all(axis=1)
            run = np.diff(np.flatnonzero(np.diff(np.concatenate([[0], wide.astype(np.int8), [0]]))))[::2]
            if run.size and int(run.max()) > limit:
                return False
        return float(self.hits(pts, normal).mean()) >= CHAIN_GAP_COVER

    def hits(
        self, pts: np.ndarray, normal: np.ndarray, *, alone: bool = False, darkness: float = 0.0
    ) -> np.ndarray:
        """Per point: the line shows there (ink, gray or a text box; see `covered`). With ``alone`` the
        line only counts where it runs alone, with paper 5-8 px beside it on both sides (not inside a wall
        or along a crossing stroke), as dark as ``darkness`` / 1.6 at least (drawn with the same pen; then
        the ink is not used when a gray image is given, it cannot tell pens apart)."""
        n = len(pts)
        hit = np.zeros(n, bool)
        across = np.arange(-CHAIN_ACROSS_PX, CHAIN_ACROSS_PX + 1, dtype=np.float64)
        beside = np.concatenate(
            [np.arange(-PAPER_FAR_PX, -PAPER_NEAR_PX + 1), np.arange(PAPER_NEAR_PX, PAPER_FAR_PX + 1)]
        ).astype(np.float64)
        if self.ink is not None and not (alone and self.gray is not None):
            inked = (_sample_rows(self.ink, pts, normal, across) > 0).any(axis=1)
            if alone:
                inked &= ~(_sample_rows(self.ink, pts, normal, beside) > 0).any(axis=1)
            hit |= inked
        if self.gray is not None:
            line = _sample_rows(self.gray, pts, normal, across).min(axis=1).astype(np.float64)
            side = _sample_rows(self.gray, pts, normal, beside).astype(np.float64)
            paper = side.min(axis=1) if alone else np.median(side, axis=1)
            dark = paper - line >= GAP_CONTRAST
            if alone:
                dark &= 255.0 - line >= darkness / CHAIN_DARKNESS_RATIO
            hit |= dark
        if self.boxes.size:
            m = CHAIN_TEXT_MARGIN_PX
            bx = self.boxes
            hit |= (
                (pts[:, None, 0] >= bx[None, :, 0] - m)
                & (pts[:, None, 0] <= bx[None, :, 2] + m)
                & (pts[:, None, 1] >= bx[None, :, 1] - m)
                & (pts[:, None, 1] <= bx[None, :, 3] + m)
            ).any(axis=1)
        return hit


def _sample_rows(img: np.ndarray, pts: np.ndarray, normal: np.ndarray, across: np.ndarray) -> np.ndarray:
    """``img`` at ``pts + across * normal``, nearest pixel, clamped to the image; shape
    (len(pts), len(across))."""
    q = np.rint(pts[:, None, :] + across[None, :, None] * normal[None, None, :]).astype(np.intp)
    h, w = img.shape[:2]
    x = np.clip(q[..., 0], 0, w - 1)
    y = np.clip(q[..., 1], 0, h - 1)
    return np.asarray(img[y, x])


def candidate_lines(
    thin: Sequence[Segment],
    evidence: Evidence,
    long_side: float,
    check_deadline: Callable[[], None] | None,
) -> list[tuple[Segment, list[int]]]:
    """The thin pieces chained into lines, each with the indices of its pieces.

    LSD breaks a dimension line at its ticks and crossings, the text mask cuts it under its labels and a
    faint line falls apart in the ink, so one line arrives as several pieces. Two pieces belong to one line
    when they are drawn alike (with a gray image: ink darkness within 1.6x), parallel within 2 degrees,
    the ends facing each other lie within ``max(3 px, the wider stroke)`` of the other piece's line, and
    they overlap or the gap between them is at most ``0.06 L`` and runs on in the image
    (`_Evidence.covered`; with no evidence at all, at most ``END_SLACK_PX``). A chain is the straight
    least-squares line through its pieces' ends, from the first to the last projection, with the
    length-weighted mean width and the id of its longest piece; with a gray image its ends then run on
    while the line does (`_extend_ends`).
    """
    n = len(thin)
    p0 = np.array([s.p0 for s in thin], np.float64).reshape(-1, 2)
    p1 = np.array([s.p1 for s in thin], np.float64).reshape(-1, 2)
    length = np.hypot(*(p1 - p0).T)
    unit = (p1 - p0) / np.maximum(length, 1e-9)[:, None]
    width = np.array([s.width_px for s in thin], np.float64)
    has_evidence = evidence.ink is not None or evidence.gray is not None
    darkness = _darkness(evidence.gray, p0, p1, unit) if evidence.gray is not None else None
    max_gap = CHAIN_GAP_FRAC * long_side if has_evidence else END_SLACK_PX
    cos_tol = math.cos(math.radians(CHAIN_ANGLE_DEG))
    chains = _Chains(n)
    ends = np.stack([p0, p1], axis=1)  # (n, 2 ends, 2)
    cell = max(max_gap, 1.0)
    keys = np.floor(ends / cell).astype(np.intp)
    grid: dict[tuple[int, int], list[int]] = {}
    for i in range(n):
        for e in (0, 1):
            bucket = grid.setdefault((int(keys[i, e, 0]), int(keys[i, e, 1])), [])
            if not bucket or bucket[-1] != i:
                bucket.append(i)
    for i in range(n):
        if check_deadline is not None and i % 256 == 0:
            check_deadline()
        near: set[int] = set()
        for e in (0, 1):
            kx, ky = int(keys[i, e, 0]), int(keys[i, e, 1])
            for dx, dy in itertools.product((-1, 0, 1), repeat=2):
                near.update(grid.get((kx + dx, ky + dy), ()))
        for j in sorted(near):
            if j <= i or abs(float(unit[i] @ unit[j])) < cos_tol or chains.find(i) == chains.find(j):
                continue
            if darkness is not None and max(darkness[i], darkness[j]) > CHAIN_DARKNESS_RATIO * max(
                min(darkness[i], darkness[j]), 1.0
            ):
                continue
            if _joins(i, j, ends, length, unit, width, max_gap, evidence):
                chains.union(i, j)
    groups: dict[int, list[int]] = {}
    for i in range(n):
        groups.setdefault(chains.find(i), []).append(i)
    out = []
    for members in groups.values():
        line = (
            thin[members[0]] if len(members) == 1 else _fit_chain(thin, members, p0, p1, length, unit, width)
        )
        if evidence.gray is not None:
            line = _extend_ends(line, evidence, max_gap)
        out.append((line, members))
    return out


def _extend_ends(line: Segment, evidence: Evidence, reach: float) -> Segment:
    """``line`` lengthened at each end while it runs on alone in the image, with the same pen
    (`_Evidence.hits` with ``alone``; gaps of up to `EXTEND_GAP_PX`), by at most ``reach``: the last pieces
    of a faint line, or of one cut under its label, can be missing from the segments altogether. It stops
    at a wall or a crossing stroke wider than the gap allowance and at a fainter line running on."""
    ux, uy, _ = unit(line.p0, line.p1)
    u = np.array((ux, uy))
    normal = np.array((-uy, ux))
    darkness = 0.0
    if evidence.gray is not None:
        p0, p1 = np.array([line.p0], np.float64), np.array([line.p1], np.float64)
        darkness = float(_darkness(evidence.gray, p0, p1, u[None, :])[0])
    steps = np.arange(1.0, reach + 1.0)
    new = []
    for end, out in ((np.array(line.p0), -u), (np.array(line.p1), u)):
        hit = evidence.hits(end + steps[:, None] * out, normal, alone=True, darkness=darkness)
        last, gap = 0.0, 0
        for k, h in enumerate(hit):
            if h:
                last, gap = float(steps[k]), 0
            else:
                gap += 1
                if gap > EXTEND_GAP_PX:
                    break
        new.append(end + last * out)
    (ax, ay), (bx, by) = new
    return Segment(line.id, (float(ax), float(ay)), (float(bx), float(by)), line.width_px, True, line.source)


def _darkness(gray: np.ndarray, p0: np.ndarray, p1: np.ndarray, unit: np.ndarray) -> np.ndarray:
    """Ink darkness (255 - gray, the darkest of 3 px across) of each piece, median over its middle 80 %."""
    out = np.zeros(len(p0))
    across = np.arange(-1.0, 2.0)
    for k in range(len(p0)):
        n = max(2, math.ceil(float(np.hypot(*(p1[k] - p0[k])))))
        pts = p0[k] + np.linspace(0.1, 0.9, n)[:, None] * (p1[k] - p0[k])
        normal = np.array((-unit[k, 1], unit[k, 0]))
        out[k] = 255.0 - float(np.median(_sample_rows(gray, pts, normal, across).min(axis=1)))
    return out


def _joins(
    i: int,
    j: int,
    ends: np.ndarray,
    length: np.ndarray,
    unit: np.ndarray,
    width: np.ndarray,
    max_gap: float,
    evidence: Evidence,
) -> bool:
    """Whether pieces ``i`` and ``j`` continue one line (see `candidate_lines`)."""
    u = unit[i]
    nrm = np.array((-u[1], u[0]))
    origin = ends[i, 0]
    t = (ends[j] - origin) @ u  # j's ends along i
    lo, hi = float(t.min()), float(t.max())
    if hi < 0.0:  # j before i: a = i's start, b = j's end facing it
        a, b, gap = ends[i, 0], ends[j, int(np.argmax(t))], -hi
    elif lo > float(length[i]):  # j after i
        a, b, gap = ends[i, 1], ends[j, int(np.argmin(t))], lo - float(length[i])
    else:  # overlapping: the facing ends are the ones nearest each other across the overlap
        a = b = None
        gap = 0.0
    tol = max(CHAIN_OFFSET_PX, float(max(width[i], width[j])))
    if a is None:
        # parallel copies (both edges of a faint stroke): every end of the shorter within tol of the longer
        k, m = (i, j) if length[i] >= length[j] else (j, i)
        nk = np.array((-unit[k, 1], unit[k, 0]))
        return bool(np.all(np.abs((ends[m] - ends[k, 0]) @ nk) <= tol))
    nj = np.array((-unit[j, 1], unit[j, 0]))
    if abs(float((b - origin) @ nrm)) > tol or abs(float((a - ends[j, 0]) @ nj)) > tol:
        return False
    if gap > max_gap:
        return False
    if gap <= 1.0:
        return True
    normal = np.array((-(b - a)[1], (b - a)[0])) / max(float(np.hypot(*(b - a))), 1e-9)
    return evidence.covered(a, b, normal, float(max(width[i], width[j])))


def _fit_chain(
    thin: Sequence[Segment],
    members: list[int],
    p0: np.ndarray,
    p1: np.ndarray,
    length: np.ndarray,
    unit: np.ndarray,
    width: np.ndarray,
) -> Segment:
    longest = max(members, key=lambda k: float(length[k]))
    u = unit[longest]
    signs = np.sign(unit[members] @ u)
    signs[signs == 0] = 1.0
    d = (unit[members] * (signs * length[members])[:, None]).sum(axis=0)
    u = d / np.hypot(*d)
    nrm = np.array((-u[1], u[0]))
    pts = np.vstack([p0[members], p1[members]])
    w = np.concatenate([length[members], length[members]])
    origin = p0[longest]
    offset = float(((pts - origin) @ nrm * w).sum() / w.sum())
    along = (pts - origin) @ u
    a = origin + u * float(along.min()) + nrm * offset
    b = origin + u * float(along.max()) + nrm * offset
    mean_width = float((width[members] * length[members]).sum() / length[members].sum())
    seg = thin[longest]
    return Segment(
        seg.id, (float(a[0]), float(a[1])), (float(b[0]), float(b[1])), mean_width, True, seg.source
    )


# --- wall faces -----------------------------------------------------------------------------------------


@dataclass(frozen=True)
class _Pair:
    d: float  # distance between the lines
    s0: float  # overlap along the first line
    s1: float


def _pair(a: Segment, b: Segment, d_min: float, d_max: float) -> _Pair | None:
    """The pair geometry of ``a`` and ``b`` under the face rules (angle, distance, overlap), else None."""
    ux, uy, len_a = unit(a.p0, a.p1)
    vx, vy, len_b = unit(b.p0, b.p1)
    if abs(ux * vx + uy * vy) < math.cos(math.radians(FACE_ANGLE_DEG)):
        return None
    s0, h0 = along_and_across(a.p0, a.p1, b.p0)
    s1, h1 = along_and_across(a.p0, a.p1, b.p1)
    if h0 * h1 <= 0.0:
        return None
    d = abs(h0 + h1) / 2.0
    lo, hi = max(min(s0, s1), 0.0), min(max(s0, s1), len_a)
    if not d_min <= d <= d_max or hi - lo < FACE_OVERLAP * min(len_a, len_b):
        return None
    return _Pair(d, lo, hi)


def _strip_is_wall(a: Segment, b: Segment, pair: _Pair, ink: np.ndarray, centres: np.ndarray) -> bool:
    """The strip between paired lines ``a`` and ``b`` (over the overlap, their own strokes left out) holds
    no label (no text centre lies in it) and is hollow (< 15 % ink) or filled (> 85 %)."""
    ux, uy, _ = unit(a.p0, a.p1)
    _, side = along_and_across(a.p0, a.p1, ((b.p0[0] + b.p1[0]) / 2, (b.p0[1] + b.p1[1]) / 2))
    sign = 1.0 if side > 0 else -1.0
    if centres.size:
        rx, ry = centres[:, 0] - a.p0[0], centres[:, 1] - a.p0[1]
        along, across = rx * ux + ry * uy, (-rx * uy + ry * ux) * sign
        if np.any((along >= pair.s0) & (along <= pair.s1) & (across > 0.0) & (across < pair.d)):
            return False
    n = np.array((-uy, ux)) * sign
    lo, hi = a.width_px / 2.0 + 1.0, pair.d - b.width_px / 2.0 - 1.0
    across_px = np.arange(lo, hi + 1e-9, 1.0) if hi >= lo else np.array([pair.d / 2.0])
    along_px = np.linspace(pair.s0, pair.s1, int(min(400, max(5, (pair.s1 - pair.s0) / 2.0))))
    pts = np.array(a.p0) + along_px[:, None, None] * np.array((ux, uy)) + across_px[None, :, None] * n
    q = np.rint(pts.reshape(-1, 2)).astype(np.intp)
    h, w = ink.shape[:2]
    inside = (q[:, 0] >= 0) & (q[:, 0] < w) & (q[:, 1] >= 0) & (q[:, 1] < h)
    if not inside.any():
        return False
    ratio = float((ink[q[inside, 1], q[inside, 0]] > 0).mean())
    return not FACE_HOLLOW_MAX <= ratio <= FACE_FILLED_MIN


def wall_faces(
    found: Sequence[tuple[Segment, list[tuple[float, bool]]]],
    lines: Sequence[Segment],
    ink: np.ndarray,
    centres: np.ndarray,
    t_thin: float,
    long_side: float,
    text_height: float,
) -> set[int]:
    """Indices into ``found`` of the candidates that pair as a double-line wall face (moved here from the
    walls stage's guard, Task 14b).

    A candidate (a chained line with ticks and a label) is a face when at least 60 % of its length pairs
    (`_pair`, `_strip_is_wall`) with other lines ``p`` of ``lines`` (chained thin lines and bold strokes)
    that are not spoken for (a short face line beside one end of a dimension line does not make it a face):
    ``p`` is not already one line of a closer valid pair over that stretch (`_spoken_for`: a partition's two
    faces pair with each other first, so a dimension line drawn beside a partition stays one). ``p`` may be
    another candidate only when the two are closer than a text height: stacked dimension chains keep their
    labels between them.
    """
    d_min, d_max = FACE_D_MIN_THIN * t_thin, FACE_D_MAX_FRAC * long_side
    min_len = FACE_MIN_LEN_FRAC * long_side
    pool = [ln for ln in lines if ln.length >= min_len]
    cand_ids = {id(c) for c, _ in found}
    mids = np.array([((ln.p0[0] + ln.p1[0]) / 2, (ln.p0[1] + ln.p1[1]) / 2) for ln in pool]).reshape(-1, 2)
    half = np.array([ln.length / 2 for ln in pool])
    reach = d_max + half

    def near(line: Segment) -> list[int]:
        m = ((line.p0[0] + line.p1[0]) / 2, (line.p0[1] + line.p1[1]) / 2)
        dist = np.hypot(mids[:, 0] - m[0], mids[:, 1] - m[1])
        return [int(k) for k in np.flatnonzero(dist <= reach + line.length / 2)]

    def valid(a: Segment, b: Segment) -> _Pair | None:
        pr = _pair(a, b, d_min, d_max)
        return pr if pr is not None and _strip_is_wall(a, b, pr, ink, centres) else None

    faces: set[int] = set()
    for k, (cand, _) in enumerate(found):
        if cand.length < min_len:
            continue
        paired: list[tuple[float, float]] = []  # stretches of the candidate paired as a face
        for j in near(cand):
            p = pool[j]
            if p is cand:
                continue
            pr = valid(cand, p)
            if pr is None or (id(p) in cand_ids and pr.d >= text_height):
                continue
            if not _spoken_for(p, cand, pr.d, pool, near, valid):
                paired.append((pr.s0, pr.s1))
        if _union_length(paired) >= FACE_OVERLAP * cand.length:
            faces.add(k)
    return faces


def _union_length(stretches: list[tuple[float, float]]) -> float:
    total, end = 0.0, -math.inf
    for a, b in sorted(stretches):
        if b > end:
            total += b - max(a, end)
            end = b
    return total


def _spoken_for(
    p: Segment,
    cand: Segment,
    d: float,
    pool: Sequence[Segment],
    near: Callable[[Segment], list[int]],
    valid: Callable[[Segment, Segment], "_Pair | None"],
) -> bool:
    """Whether ``p`` pairs more closely (distance < ``d``) with a line other than ``cand``, on either side,
    over at least half of its stretch facing ``cand`` (the walls stage uses each stretch of a line in one
    pair)."""
    facing = _pair(p, cand, 0.0, math.inf)
    if facing is None:
        return False
    for j in near(p):
        q = pool[j]
        if q is p or q is cand:
            continue
        pr = valid(p, q)
        if pr is None or pr.d >= d:
            continue
        shared = min(pr.s1, facing.s1) - max(pr.s0, facing.s0)
        if shared >= 0.5 * (facing.s1 - facing.s0):
            return True
    return False
