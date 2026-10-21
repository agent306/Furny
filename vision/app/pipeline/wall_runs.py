"""Wall runs (06 §8.1 steps 7-8), split out of ``walls.py``: pieces snapped onto the dominant orientation
(``_snap``), free ends marched to the mask's edge, collinear pieces walked into runs with their gaps as
openings (``_runs``), door leaves dropped (``_drop_leaves``), and the facing ends the walk left apart linked
by jogs and ruling B2's bridges (``_link_runs``) or carried through a door to a crossing wall (Task 16c
ruling R-b, ``_partition_doors``).
"""

import bisect
import itertools
import math
from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass

import numpy as np

from app.pipeline.opening_evidence import door_arc, frame_lines
from app.pipeline.wall_candidates import Check, sample
from app.pipeline.wall_skeleton import _Piece
from app.schemas.candidates import RawWall, WallSource
from app.utils.geometry import Pt

_SOURCE_RANK: dict[WallSource, int] = {"filled": 0, "vector": 1, "double_line": 2, "single_line": 3}
SNAP_DEG = 3.0
DIAGONAL_MIN_FRAC = 0.03  # off-axis pieces at least 0.03 L long are diagonal walls
MERGE_OFFSET = 0.5  # collinear: perpendicular offset <= 0.5 t ...
MERGE_OFFSET_MIN_PX = 1.5  # ... but at least this (skeleton jitter)
MERGE_GAP = 1.5  # gaps up to 1.5 t close
# Gap candidates: 1.5 t < g <= 18 t (Task 16c ruling R-a: 06's 2.5 t left breaks of 1.5 .. 2.5 t neither
# closed nor openings, ending the run; graph building already records bridged gaps >= 1.5 t as openings)
GAP_MIN, GAP_MAX = MERGE_GAP, 18.0
SIMILAR_THICKNESS = 1.5  # thickness ratio of the two walls beside a gap candidate
GAP_WALL_MAX = 0.1  # a gap whose centre line is more than 10 % wall is crossed by a wall: no opening
GAP_BAND = 0.45  # ... tested on lines up to 0.45 t (the thinner wall's) to either side of it too
BRIDGE_OFFSET_TWALL = 1.0  # mixed-style bridging (ruling B2): parallel runs at most 1 t_wall apart across ...
BRIDGE_GAP_TWALL = 18.0  # ... and 18 t_wall along, with opening evidence in the gap's strip:
EVIDENCE_ANGLE_DEG = 3.0  # thin lines parallel within 3 degrees ...
EVIDENCE_LINES = 2  # ... at least two distinct ones ...
EVIDENCE_COVER = 0.8  # ... each covering 80 % of the gap ...
EVIDENCE_CLUSTER_PX = 1.5  # ... (pieces less than this apart across are one line)
EVIDENCE_STRIP = (
    0.75  # ... within 0.75 max(t, t_wall) beyond the runs' lines (frame lines run along the faces)
)
PARTITION_DOOR_CROSS_DEG = 60.0  # a partition-end door closes against a run crossing its line this steeply
PARTITION_DOOR_NIB = 0.15  # its hinge may sit behind a jamb nib up to 0.15 g deep
JOG_MIN_PX = 1.0  # a bridge's line this far from a run's line gets a connector
LEAF_MIN, LEAF_MAX = 0.8, 1.1  # door leaf length, fractions of the gap width
LEAF_MIN_ANGLE_DEG = 30.0  # a leaf leaves its wall at least this steeply
DUPLICATE_ANGLE_DEG = 1.0
_MARCH_STEP = 0.5


# --- step 7: orientation snap, free-end refinement ------------------------------------------------------


def _snap_one(p: _Piece, theta0: float, L: float) -> _Piece | None:
    d = p.p1 - p.p0
    length = float(np.hypot(d[0], d[1]))
    ang = math.degrees(math.atan2(d[1], d[0]))
    delta = (ang - theta0 + 45.0) % 90.0 - 45.0
    if abs(delta) <= SNAP_DEG:
        target = math.radians(ang - delta)
        half = np.array((math.cos(target), math.sin(target))) * (length / 2.0)
        mid = (p.p0 + p.p1) / 2.0
        k = round((ang - delta - theta0) / 90.0) % 2
        return _Piece(mid - half, mid + half, p.thickness, p.source, p.free0, p.free1, "hv"[k], p.bold)
    if length >= DIAGONAL_MIN_FRAC * L:
        return p
    return None


def _snap(chains: list[list[_Piece]], theta0: float, L: float) -> list[_Piece]:
    """Rotate pieces within 3 degrees of ``theta0 + k 90`` onto that axis about their midpoint; keep
    other pieces of at least 0.03 L as diagonals and drop shorter off-axis ones (06 §8.1 step 7).

    A kept piece after a dropped head (or before a dropped tail) of its path is extended along its own
    line to the projection of the path's end node (a diagonal whose skeleton curls into a junction), and
    joined to the node by a connector piece when the node lies beside its line (``_close_end``). When
    that end is free (a skeleton curling into a corner of a wall's end), the kept piece inherits the free
    end instead, so the end is still refined to the end of the wall.

    Between two kept pieces whose short off-axis stretch in between was dropped (a wall that jogs where
    two drawing styles meet: a column block and the bold line continuing it) the path stays connected:
    pieces on different axes are extended to the crossing of their lines, parallel ones are joined by a
    connector piece between their facing ends."""
    out: list[_Piece] = []
    for chain in chains:
        kept = [(k, q) for k, q in enumerate(_snap_one(p, theta0, L) for p in chain) if q is not None]
        if not kept:
            continue
        kept_idx = [k for k, _ in kept]
        pieces = [q for _, q in kept]
        out.extend(_close_end(chain, kept_idx[0], pieces[0], head=True))
        out.extend(_close_end(chain, kept_idx[-1], pieces[-1], head=False))
        out.extend(pieces)
        for (ka, a), (kb, b) in itertools.pairwise(kept):
            if kb > ka + 1:
                out.extend(_join(a, b, chain[ka + 1 : kb]))
    return out


def _join(a: _Piece, b: _Piece, dropped: list[_Piece]) -> list[_Piece]:
    """Reconnect ``a`` (path order: its ``p1`` faces ``b``) and ``b`` across the ``dropped`` pieces between
    them; returns the connector piece, if one is needed."""
    da, db = a.p1 - a.p0, b.p1 - b.p0
    cross = float(da[0] * db[1] - da[1] * db[0])
    na, nb = float(np.hypot(*da)), float(np.hypot(*db))
    if na > 1e-9 and nb > 1e-9 and abs(cross) / (na * nb) > math.sin(math.radians(SNAP_DEG)):
        # The crossing of the two lines: a.p0 + da * s = b.p0 + db * t.
        r = b.p0 - a.p0
        s_par = float(r[0] * db[1] - r[1] * db[0]) / cross
        meet = a.p0 + da * s_par
        _extend_to(a, meet, at_start=False)
        _extend_to(b, meet, at_start=True)
        return []
    thickness = float(np.median([p.thickness for p in dropped])) if dropped else min(a.thickness, b.thickness)
    if float(np.hypot(*(b.p0 - a.p1))) < 1e-6:
        return []
    return [
        _Piece(a.p1.copy(), b.p0.copy(), thickness, dropped[0].source if dropped else a.source, False, False)
    ]


def _close_end(chain: list[_Piece], kept_at: int, piece: _Piece, *, head: bool) -> list[_Piece]:
    """Close the path's head (or tail) after dropped pieces: inherit a free end, or extend to the end
    node's projection. When the node lies off the piece's line by more than half the piece's thickness (a
    wall meeting a black block's corner beside its centre line), a connector piece from the extended end
    to the node keeps the junction (Task 16c); it is returned."""
    if kept_at == (0 if head else len(chain) - 1):
        return []  # nothing was dropped at this end
    if chain[0].free0 if head else chain[-1].free1:
        setattr(piece, "free0" if head else "free1", True)
        return []
    node = chain[0].p0 if head else chain[-1].p1
    _extend_to(piece, node, at_start=head)
    end = piece.p0 if head else piece.p1
    if float(np.hypot(*(node - end))) <= 0.5 * piece.thickness:
        return []
    dropped = chain[:kept_at] if head else chain[kept_at + 1 :]
    thickness = float(np.median([p.thickness for p in dropped]))
    return [_Piece(end.copy(), node.copy(), thickness, dropped[0].source, False, False)]


def _extend_to(p: _Piece, target: np.ndarray, *, at_start: bool) -> None:
    """Move an end of ``p`` outwards along its line to the projection of ``target`` (never inwards)."""
    d = p.p1 - p.p0
    length = float(np.hypot(d[0], d[1]))
    if length < 1e-9:
        return
    u = d / length
    t = float((target - p.p0) @ u)
    if at_start and t < 0.0:
        p.p0 = p.p0 + u * t
    elif not at_start and t > length:
        p.p1 = p.p0 + u * t


def _march_free_ends(pieces: list[_Piece], wall: np.ndarray) -> None:
    """Move every free end along its piece to the end of the wall mask (the skeleton stops about t / 2
    short of a wall's end, which would widen door gaps by t)."""
    for p in pieces:
        for is_start in (True, False):
            if not (p.free0 if is_start else p.free1):
                continue
            end, other = (p.p0, p.p1) if is_start else (p.p1, p.p0)
            d = end - other
            length = float(np.hypot(d[0], d[1]))
            if length < 1e-9:
                continue
            u = d / length
            if not sample(wall, end[None, :])[0]:
                continue
            reach = 2.0 * p.thickness + 4.0
            steps = np.arange(1, int(reach / _MARCH_STEP) + 1) * _MARCH_STEP
            inside = sample(wall, end[None, :] + steps[:, None] * u[None, :]) > 0
            out = np.flatnonzero(~inside)
            last = (
                float(steps[out[0] - 1])
                if out.size and out[0] > 0
                else (0.0 if out.size else float(steps[-1]))
            )
            new = end + u * (last + _MARCH_STEP)
            if is_start:
                p.p0 = new
            else:
                p.p1 = new


# --- step 8: collinear runs and gap candidates ----------------------------------------------------------


@dataclass(frozen=True, slots=True)
class _Item:
    """A snapped piece as step 8 sees it: its stretch ``[s0, s1]`` along the group's direction, its offset
    across, its drawn thickness ``t`` and the thickness ``t_gap`` its gaps are measured with (``t_wall``
    for a bold stroke, ruling B2), its source and style and whether its ends are free."""

    s0: float
    s1: float
    off: float
    t: float
    t_gap: float
    source: WallSource
    style: str
    free0: bool
    free1: bool


@dataclass(slots=True)
class _Run:
    u: np.ndarray
    n: np.ndarray
    s0: float
    s1: float
    members: list[_Item]
    openings: list[tuple[float, float]]
    free0: bool
    free1: bool

    def _mean(self, value: Callable[[_Item], float]) -> float:
        """Length-weighted mean of ``value`` over the members."""
        lengths = [m.s1 - m.s0 for m in self.members]
        total = math.fsum(lengths) or 1.0
        return math.fsum(value(m) * w for m, w in zip(self.members, lengths, strict=True)) / total

    def offset(self) -> float:
        return self._mean(lambda m: m.off)

    def thickness(self) -> float:
        return self._mean(lambda m: m.t)

    def style(self) -> str:
        """The members' style covering most of the run's length."""
        by_style: dict[str, float] = defaultdict(float)
        for m in self.members:
            by_style[m.style] += m.s1 - m.s0
        return min(by_style, key=lambda k: (-by_style[k], k))

    def wall(self) -> RawWall:
        by_source: dict[WallSource, float] = defaultdict(float)
        for m in self.members:
            by_source[m.source] += m.s1 - m.s0
        source = min(by_source, key=lambda k: (-by_source[k], _SOURCE_RANK[k]))
        off = self.offset()
        a = self.u * self.s0 + self.n * off
        b = self.u * self.s1 + self.n * off
        openings = tuple((o0 - self.s0, o1 - self.s0) for o0, o1 in self.openings)
        return RawWall(
            (float(a[0]), float(a[1])), (float(b[0]), float(b[1])), self.thickness(), source, openings
        )


def _direction_groups(pieces: list[_Piece], theta0: float) -> list[tuple[np.ndarray, list[_Piece]]]:
    """Pieces grouped by direction: the two snapped axes, and diagonals within 1 degree of each other."""
    rad = math.radians(theta0)
    h_axis = np.array((math.cos(rad), math.sin(rad)))
    v_axis = np.array((-math.sin(rad), math.cos(rad)))
    groups: list[tuple[np.ndarray, list[_Piece]]] = [
        (h_axis, [p for p in pieces if p.axis == "h"]),
        (v_axis, [p for p in pieces if p.axis == "v"]),
    ]
    diags = sorted(
        (p for p in pieces if p.axis == "d"),
        key=lambda p: math.degrees(math.atan2(p.p1[1] - p.p0[1], p.p1[0] - p.p0[0])) % 180.0,
    )
    current: list[_Piece] = []
    first_angle = 0.0
    for p in diags:
        ang = math.degrees(math.atan2(p.p1[1] - p.p0[1], p.p1[0] - p.p0[0])) % 180.0
        if current and ang - first_angle > DUPLICATE_ANGLE_DEG:
            groups.append((_longest_direction(current), current))
            current = []
        if not current:
            first_angle = ang
        current.append(p)
    if current:
        groups.append((_longest_direction(current), current))
    return [(u, g) for u, g in groups if g]


def _longest_direction(pieces: list[_Piece]) -> np.ndarray:
    p = max(pieces, key=lambda q: float(np.hypot(*(q.p1 - q.p0))))
    d = p.p1 - p.p0
    return np.asarray(d / float(np.hypot(d[0], d[1])))


def _gap_is_empty(
    wall: np.ndarray, u: np.ndarray, n: np.ndarray, off: float, g0: float, g1: float, half: float = 0.0
) -> bool:
    """No line of the gap's strip (offsets ``off - half .. off + half``) is more than 10 % wall: a wall
    crossing the gap, or one running along it inside the strip (a jogged wall's piece beside the line of
    two collinear blocks), means the gap is no opening."""
    along = np.arange(g0 + 1.0, g1 - 1.0 + 1e-9, 1.0)
    if along.size == 0:
        return True
    for k in np.linspace(-half, half, 5) if half > 0 else (0.0,):
        pts = along[:, None] * u[None, :] + (n * (off + k))[None, :]
        if float((sample(wall, pts) > 0).mean()) > GAP_WALL_MAX:
            return False
    return True


def _wall_thickness(pieces: list[_Piece]) -> float | None:
    """``t_wall`` (ruling B2): the length-weighted median thickness of the drawing's solid-block and
    double-line pieces, the thickness its walls are drawn with; None when it has none (a drawing of bold
    strokes only)."""
    walls = [p for p in pieces if p.style in ("block", "double")]
    if not walls:
        return None
    return _weighted_median([p.thickness for p in walls], [float(np.hypot(*(p.p1 - p.p0))) for p in walls])


def _runs(
    pieces: list[_Piece], theta0: float, wall: np.ndarray, poll: Check, t_wall: float | None = None
) -> list[_Run]:
    """Collinear pieces (same direction, offset within ``0.5 t``) joined along their line: breaks up to
    ``1.5 t`` close, empty gaps of ``1.5 t .. 18 t`` (ruling R-a; 06 says ``2.5 t``) between walls of similar
    thickness become openings, anything else ends the run.

    A bold stroke's ``t`` in these gap rules is ``t_wall`` (ruling B2, a deviation from 06 §8.1 step 8):
    an outline drawn as a bold stroke stands for a wall of the drawing's wall thickness, so its windows and
    sliders (up to ``18 t_wall``) are gaps of that wall, not of the pen."""
    out: list[_Run] = []
    for u, group in _direction_groups(pieces, theta0):
        poll()
        n = np.array((-u[1], u[0]))
        items: list[_Item] = []
        for p in group:
            a, b = float(p.p0 @ u), float(p.p1 @ u)
            fa, fb = (p.free0, p.free1) if a <= b else (p.free1, p.free0)
            t_gap = t_wall if p.bold and t_wall is not None else p.thickness
            off = float((p.p0 + p.p1) @ n) / 2.0
            items.append(_Item(min(a, b), max(a, b), off, p.thickness, t_gap, p.source, p.style, fa, fb))
        items.sort(key=lambda it: it.off)
        lines: list[list[_Item]] = []
        anchor_off, anchor_t = 0.0, 0.0
        for it in items:
            tol = max(MERGE_OFFSET * min(anchor_t, it.t), MERGE_OFFSET_MIN_PX)
            if lines and abs(it.off - anchor_off) <= tol:
                lines[-1].append(it)
            else:
                lines.append([it])
                anchor_off, anchor_t = it.off, it.t
        for line in lines:
            line.sort(key=lambda it: (it.s0, it.s1))
            run: _Run | None = None
            last = line[0]  # the member reaching furthest along the current run
            for it in line:
                if run is not None:
                    gap = it.s0 - run.s1
                    if gap <= MERGE_GAP * max(_gap_thickness(last, it)):
                        pass
                    elif _is_opening(last, it, gap) and _gap_is_empty(
                        wall, u, n, (it.off + run.offset()) / 2.0, run.s1, it.s0, GAP_BAND * min(last.t, it.t)
                    ):
                        run.openings.append((run.s1, it.s0))
                    else:
                        out.append(run)
                        run = None
                if run is None:
                    run = _Run(u, n, it.s0, it.s1, [], [], it.free0, it.free1)
                    last = it
                elif it.s1 >= run.s1:
                    run.free1 = it.free1
                if it.s1 >= run.s1:
                    run.s1 = it.s1
                    last = it
                run.members.append(it)
            if run is not None:
                out.append(run)
    return out


def _gap_thickness(a: _Item, b: _Item) -> tuple[float, float]:
    """The thicknesses a gap between ``a`` and ``b`` is measured with: ``t_gap`` (``t_wall`` for a bold
    stroke, ruling B2), except across a bold stroke and a piece of another style, where the drawn widths
    count (Task 16c review, Important 1: otherwise a bold stroke and a double line look alike)."""
    if a.style != b.style and "bold" in (a.style, b.style):
        return a.t, b.t
    return a.t_gap, b.t_gap


def _is_opening(a: _Item, b: _Item, gap: float) -> bool:
    """Step 8's gap candidate between ``a`` and ``b`` (emptiness aside): the same drawing style (ruling B2:
    pieces of different styles are bridged only with opening evidence, ``_link_runs``), similar
    thickness and ``1.5 t .. 18 t`` (ruling R-a) wide."""
    if a.style != b.style:
        return False
    ta, tb = _gap_thickness(a, b)
    t_gap = (ta + tb) / 2.0
    return max(ta, tb) <= SIMILAR_THICKNESS * min(ta, tb) and GAP_MIN * t_gap <= gap <= GAP_MAX * t_gap


def _point(run: _Run, s: float, off: float) -> Pt:
    q = run.u * s + run.n * off
    return (float(q[0]), float(q[1]))


def _link_runs(
    runs: list[_Run],
    thin: np.ndarray,
    ink: np.ndarray,
    t_wall: float | None,
    poll: Check,
    origin: tuple[float, float] = (0.0, 0.0),
    linked: set[tuple[int, int]] | None = None,
) -> list[RawWall]:
    """Raw walls that join facing ends of parallel runs the collinear walk left apart (Task 16c):

    - a **jog**: two free ends at most ``1.5 t`` apart along their line whose lines are less than half the
      thicker wall apart across (a partition ending in a black block whose centre line lies beside its own)
      get a connector between them, as ``_join`` joins a path's pieces;
    - a **bridge** (ruling B2, a deviation from 06 §8.1 step 8): runs drawn in different styles (a black
      block, a bold stroke, a double line) with at least one free facing end, parallel within 2 degrees
      (one direction group: the snapped axes, or diagonals within 1 degree), at most ``1 t_wall`` apart
      across and ``18 t_wall`` along, with opening evidence in the gap's strip (at least two thin parallel
      lines each covering 80 % of the gap, window frames or a slider, or a door swing arc at one of the
      jambs) are bridged: a wall of the thicker run's thickness along the evidence lines' centre (the
      thicker run's line for an arc) spans the gap as one opening, with a connector at each end where a
      run's line jogs from it.

    Each run end is linked at most once, nearest gap first; ``linked`` receives the linked ends as
    ``(run index, 0 | 1)`` (its ``s0`` / ``s1`` end). ``ink`` (the arcs' thin ink) may be the whole page,
    with the runs' coordinate origin at ``origin`` in it: a door swinging out of the plan region keeps its
    whole arc."""
    found: list[tuple[float, int, int, str]] = []
    groups: dict[tuple[float, float], list[int]] = defaultdict(list)  # runs of one direction group
    for k, r in enumerate(runs):  # share their direction exactly
        groups[(float(r.u[0]), float(r.u[1]))].append(k)
    offs = [r.offset() for r in runs]
    thick = [r.thickness() for r in runs]
    for members in groups.values():
        poll()
        members.sort(key=lambda k: offs[k])
        keys = [offs[k] for k in members]
        reach = max(0.5 * max(thick[k] for k in members), BRIDGE_OFFSET_TWALL * (t_wall or 0.0))
        for i in members:
            a = runs[i]
            lo, hi = bisect.bisect_left(keys, offs[i] - reach), bisect.bisect_right(keys, offs[i] + reach)
            for j in members[lo:hi]:
                b = runs[j]
                if i == j or b.s0 <= a.s1:
                    continue
                gap = b.s0 - a.s1
                delta = abs(offs[j] - offs[i])
                ta, tb = thick[i], thick[j]
                if a.free1 and b.free0 and gap <= MERGE_GAP * max(ta, tb) and delta <= 0.5 * max(ta, tb):
                    found.append((gap, i, j, "jog"))
                elif (
                    t_wall is not None
                    and (a.free1 or b.free0)
                    and a.style() != b.style()
                    and delta <= BRIDGE_OFFSET_TWALL * t_wall
                    and gap <= BRIDGE_GAP_TWALL * t_wall
                ):
                    found.append((gap, i, j, "bridge"))
    out: list[RawWall] = []
    ends: set[int] = set()
    starts: set[int] = set()
    arcs: dict[tuple[float, ...], bool] = {}  # door-arc results per jamb, hinge side and gap
    for gap, i, j, kind in sorted(found):
        if i in ends or j in starts:
            continue
        a, b = runs[i], runs[j]
        a_off, b_off = offs[i], offs[j]
        thin_t = min(thick[i], thick[j])
        if kind == "jog":
            out.append(RawWall(_point(a, a.s1, a_off), _point(a, b.s0, b_off), thin_t, a.wall().source))
        else:
            poll()  # each bridge candidate reads its gap's evidence
            k = i if thick[i] >= thick[j] else j
            strip = EVIDENCE_STRIP * max(thick[k], t_wall or 0.0)
            line = _opening_line(a, a_off, b_off, a.s1, b.s0, strip, thin, ink, thick[k], arcs, origin)
            if line is None:
                continue
            off = offs[k] if math.isnan(line) else line
            out.append(
                RawWall(
                    _point(a, a.s1, off),
                    _point(a, b.s0, off),
                    thick[k],
                    runs[k].wall().source,
                    ((0.0, gap),),
                )
            )
            for s_end, o in ((a.s1, a_off), (b.s0, b_off)):
                if abs(o - off) > JOG_MIN_PX:
                    out.append(RawWall(_point(a, s_end, o), _point(a, s_end, off), thin_t, "filled"))
        ends.add(i)
        starts.add(j)
    if linked is not None:
        linked.update((i, 1) for i in ends)
        linked.update((j, 0) for j in starts)
    return out


def _partition_doors(
    runs: list[_Run],
    ink: np.ndarray,
    t_wall: float | None,
    poll: Check,
    origin: tuple[float, float] = (0.0, 0.0),
    linked: set[tuple[int, int]] | frozenset[tuple[int, int]] = frozenset(),
) -> list[RawWall]:
    """Raw walls that carry a partition through the door at its free end to the wall the door closes
    against (Task 16c ruling R-b, Task 17; a deviation from 06 §8.1 step 8, which only links collinear
    pieces).

    A free run end (not ``linked`` by ``_link_runs``) looks along its line for the nearest run crossing it
    at 60 degrees or more, its centre line hit within ``18 t`` (``t`` the larger of the partition's and
    ``t_wall``); the gap ``g`` runs from the end to that run's face (at least ``1.5 t`` of the partition).
    With a door swing arc (``door_arc``, ruling B2's arc evidence: one thin curve of radius ``0.85 ..
    1.15 r`` centred within ``0.5 t`` of a jamb, inked on 60 % of its samples with 45 contiguous degrees,
    solid walls removed) about either jamb, opening to either side, a wall of the partition's thickness
    runs from the end to the crossing run's centre line, with ``(0, g)`` as its opening. The jambs are the
    partition's end and the crossing run's face; as drawn, the leaf may close on that run's face or on its
    centre line (``r = g`` or the distance to the centre line), and the hinge may sit behind a nib up to
    ``0.15 g`` deep (the HDB bedroom-3 door)."""
    origin_xy = np.asarray(origin)
    lines = []
    for r in runs:
        off = r.offset()
        lines.append((r.u * r.s0 + r.n * off, r.u * r.s1 + r.n * off, r.thickness()))
    cos_cross = math.cos(math.radians(PARTITION_DOOR_CROSS_DEG))
    out: list[RawWall] = []
    for k, r in enumerate(runs):
        t_k = r.thickness()
        cap = BRIDGE_GAP_TWALL * max(t_k, t_wall or 0.0)
        for end, free, e, v in ((0, r.free0, lines[k][0], -r.u), (1, r.free1, lines[k][1], r.u)):
            if not free or (k, end) in linked:
                continue
            best: tuple[float, float] | None = None  # (distance to the crossing centre line, gap)
            for j, (p, q, t_j) in enumerate(lines):
                w = q - p
                length = float(np.hypot(*w))
                if j == k or length < 1e-9 or abs(float(v @ w)) > cos_cross * length:
                    continue
                wu = w / length
                denom = float(v[0] * wu[1] - v[1] * wu[0])
                rel = p - e
                lam = float(rel[0] * wu[1] - rel[1] * wu[0]) / denom
                mu = float(rel[0] * v[1] - rel[1] * v[0]) / denom
                gap = lam - t_j / 2.0
                if not -t_j / 2.0 <= mu <= length + t_j / 2.0 or lam > cap or gap < MERGE_GAP * t_k:
                    continue
                if best is None or lam < best[0]:
                    best = (lam, gap)
            if best is None:
                continue
            poll()
            lam, gap = best
            n = np.array((-v[1], v[0]))
            nib = PARTITION_DOOR_NIB * gap
            # (hinge, toward the closing jamb, radius): at the partition's end, closing on the crossing wall's
            # face or centre line; at the face or centre line, closing on the end; either one behind a nib
            hinges = (
                (e, v, gap),
                (e, v, lam),
                (e + v * nib, v, gap - nib),
                (e + v * gap, -v, gap),
                (e + v * lam, -v, lam),
                (e + v * (gap - nib), -v, gap - nib),
            )
            if any(
                door_arc(ink, c + origin_xy, toward, n * side, radius, t_k)
                for c, toward, radius in hinges
                for side in (1.0, -1.0)
            ):
                hit = e + v * lam
                out.append(
                    RawWall(
                        (float(e[0]), float(e[1])),
                        (float(hit[0]), float(hit[1])),
                        t_k,
                        r.wall().source,
                        ((0.0, gap),),
                    )
                )
    return out


def _opening_line(
    run: _Run,
    a_off: float,
    b_off: float,
    g0: float,
    g1: float,
    strip: float,
    thin: np.ndarray,
    ink: np.ndarray,
    thick: float,
    arcs: dict[tuple[float, ...], bool] | None = None,
    origin: tuple[float, float] = (0.0, 0.0),
) -> float | None:
    """Opening evidence in the gap ``[g0, g1]`` along ``run``'s line between offsets ``a_off`` and ``b_off``
    (ruling B2): the centre offset of the thin lines parallel to it (within 3 degrees) inside the gap's
    strip (``strip`` beyond both runs' lines) when at least two distinct ones each cover >= 80 % of the
    gap; NaN for a door swing arc at one of the jambs instead; None without evidence. ``ink`` is the thin
    ink the arc is read from; ``arcs`` caches arc results per jamb, side and gap across candidates."""
    gap = g1 - g0
    lo = min(a_off, b_off) - strip
    hi = max(a_off, b_off) + strip
    lines = frame_lines(
        thin, run.u, run.n, g0, g1, lo, hi, angle_deg=EVIDENCE_ANGLE_DEG, cluster_px=EVIDENCE_CLUSTER_PX
    )
    centres = [ln.offset for ln in lines if ln.covered >= EVIDENCE_COVER * gap]
    if len(centres) >= EVIDENCE_LINES:
        return float(np.mean(centres))
    # The hinge sits at a jamb, on the line of either run (they may jog across the opening).
    jambs = [
        (run.u * g + run.n * off, toward)
        for g, toward in ((g0, run.u), (g1, -run.u))
        for off in (a_off, b_off)
    ]
    cache = {} if arcs is None else arcs
    for c, toward in jambs:
        for side in (1.0, -1.0):
            key = (round(2.0 * c[0]), round(2.0 * c[1]), float(toward @ run.u), side, round(2.0 * gap))
            if key not in cache:
                cache[key] = door_arc(ink, c + np.asarray(origin), toward, run.n * side, gap, thick)
            if cache[key]:
                return math.nan
    return None


def _drop_leaves(runs: list[_Run]) -> list[_Run]:
    """Drop door leaves: a run with one end at a gap's jamb, a free far end and a length (far end to the
    jamb) of ``0.8 g .. 1.1 g``, leaving the gap's wall at least 30 degrees steeply.

    A leaf drawn touching its jamb merges with the jamb's end cap, so its near end may lie up to the
    wall thickness from the jamb point on the centre line.
    """
    jambs: list[tuple[np.ndarray, float, np.ndarray, float, int]] = []
    for k, r in enumerate(runs):
        off = r.offset()
        t = max(m.t for m in r.members)
        for o0, o1 in r.openings:
            g = o1 - o0
            jambs.append((r.u * o0 + r.n * off, g, r.u, t, k))
            jambs.append((r.u * o1 + r.n * off, g, r.u, t, k))
    if not jambs:
        return runs
    sin_min = math.sin(math.radians(LEAF_MIN_ANGLE_DEG))
    keep: list[_Run] = []
    for k, r in enumerate(runs):
        w = r.wall()
        a, b = np.asarray(w.p0), np.asarray(w.p1)
        t_r = w.thickness_px
        leaf = False
        for near, far, far_free in ((a, b, r.free1), (b, a, r.free0)):
            if not far_free or r.openings:
                continue
            for jp, g, hu, t_host, host in jambs:
                if host == k:
                    continue
                if float(np.hypot(*(near - jp))) > max(t_host, t_r) + 2.0:
                    continue
                d = far - near
                ln = float(np.hypot(d[0], d[1]))
                if ln < 1e-9 or abs(float(d[0] * hu[1] - d[1] * hu[0])) / ln < sin_min:
                    continue
                if LEAF_MIN * g <= float(np.hypot(*(far - jp))) <= LEAF_MAX * g:
                    leaf = True
                    break
            if leaf:
                break
        if not leaf:
            keep.append(r)
    return keep


def _weighted_median(values: list[float], weights: list[float]) -> float:
    order = np.argsort(values)
    v = np.asarray(values)[order]
    w = np.asarray(weights)[order]
    cum = np.cumsum(w)
    return float(v[int(np.searchsorted(cum, cum[-1] / 2.0))])


# --- public API -----------------------------------------------------------------------------------------
