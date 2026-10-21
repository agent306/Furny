"""Openings (06 §8.5): each gap of the wall graph is a door, a window or a passage.

``find_openings`` reads the gap candidates of the wall graph (06 §8.1 step 8, and the gaps graph building
keeps on merged walls), plus the breaks in the solid ink of straight wall lines (Task 17: a window's frame
lines or a door's threshold drawn across a black wall join its two pieces into one wall run, so the
opening is only a break in the solid ink; the line may run through several graph walls). Each candidate
``[u0, u1]`` on wall ``W`` (direction ``d``, left normal ``n = (d.y, -d.x)``, 04 §2.1, width
``g = u1 - u0``) is tested:

1. **door**: four arc hypotheses, the hinge at ``u0`` or ``u1`` and the leaf opening to ``+n`` or ``-n``.
   Each samples 24 points on the quarter circle of radius ``g`` about the hinge, from the closed leaf (along
   the wall) to the open one (along the side's normal); its support is the share of points with thin ink
   (solid strokes removed) within 2 px (a 5 x 5 window), plus 0.15 when a straight leaf line (a thin
   segment ``0.8 .. 1.1`` radii long from the hinge, perpendicular to the wall within 10 degrees) exists.
   Two arcs of radius ``g / 2``, one from each jamb on one side, each with support >= 0.45 make a
   ``double_swing`` door; else the best hypothesis with support >= 0.55 a ``single_swing`` door. A
   ``bifold`` door is two short leaves folded into a V off the wall at a jamb.

   Read on real drawings (Task 17): samples on the walls' strips (a double-line wall's faces, window
   frames and slider tracks are thin ink but no arc) and within 2 px of ink the text mask removed (an arc
   passing under a label) are not judged, and at least 8 must be. The door's span may differ from the
   gap: the hinge may lie up to ``g`` beyond the gap's end (a dimension line's extension paired into a
   wall piece there) or behind a nib up to ``0.2 g`` inside it, or the leaf may close short of the far
   end (down to ``0.5 g``); the opening is then the door's span. No door (nor its gap) is narrower than
   ``1.5 t`` (the gap limit) and 10 px. A clear arc (support >= 0.75) outranks frame lines across the gap
   (a threshold drawn across a door); a weaker one yields to them (toilet fixtures beside a window).
2. **window**: thin segments parallel to the wall (within 3 degrees) inside the gap's strip (``0.75 t`` to
   either side of the centre line, as ruling B2's frame-line evidence reads it): at least two lines each
   covering >= 80 % of ``g`` make a ``casement``; at least three lines, two of them offset sashes (overlapping
   by at most 60 % of the shorter, together covering >= 80 % of ``g``) a ``sliding_window``.
3. otherwise a passage (``opening``, support 0.0), for gaps of the graph only: a break in a solid wall
   without a door or window symbol is a change of drawing style, not an opening; nor is a gap along which
   the text mask removed ink over half of its length (a wall line erased under a label, or a symbol hidden
   by one).

Swing side: ``+n`` (the left side walking from ``a`` to ``b``) is ``swing = left``. Ids are ``O1..`` in the
order of the walls' ids, then ``u0``. Talks to the other stages only through ``app.schemas.candidates``
types and plain arrays (06 I12).
"""

import dataclasses
import math
from collections import defaultdict
from dataclasses import dataclass
from typing import Literal

import cv2
import numpy as np

from app.pipeline.binarize import Preprocessed
from app.pipeline.opening_evidence import DoorLeaf, FrameLine, door_leaves, frame_lines, ink_at
from app.schemas.candidates import OpeningCandidate, Segment, WallCandidate, WallGraph

__all__ = ["find_openings"]

Hinge = Literal["start", "end"]
Swing = Literal["left", "right"]

ARC_SAMPLES = 24
ARC_WINDOW_PX = 2  # thin ink within 2 px of a sample: a 5 x 5 window
ARC_MIN_COUNTED = 8  # samples an arc needs judged (off the walls' strips and labels) to be scored
DOOR_SUPPORT = 0.55
DOOR_CLEAR = 0.75  # an arc this clear outranks frame lines across the gap
DOUBLE_SUPPORT = 0.45
LEAF_BONUS = 0.15
LEAF_LEN = (0.8, 1.1)  # of the radius
LEAF_ANGLE_DEG = 10.0
LEAF_MIN_T, LEAF_MIN_PX = 1.5, 10.0  # no door (nor its gap) is narrower than 1.5 t (the gap limit) and 10 px
SPAN_STEPS = 10  # door spans tried: the hinge up to g beyond the gap's end, or the leaf closing ...
SPAN_SHORT = 0.5  # ... down to 0.5 g short of the far end, or the hinge behind a nib up to 0.2 g deep,
SPAN_NIB = 0.2  # ... in steps of a tenth of g
WINDOW_ANGLE_DEG = 3.0
WINDOW_STRIP = 0.75  # frame lines within 0.75 t of the centre line (ruling B2's evidence strip)
WINDOW_CLUSTER_PX = 1.5
WINDOW_COVER = 0.8
WINDOW_LINES = 2
SASH_LINES = 3
SASH_MIN_COVER = 0.4  # a sash covers at least 40 % of g ...
SASH_OVERLAP = 0.6  # ... and two offset sashes overlap by at most 60 % of the shorter
BIFOLD_LEAF = (0.25, 0.75)  # bi-fold leaves: g / 2 each (04), folded ...
BIFOLD_ANGLE_DEG = (15.0, 75.0)  # ... at an angle to the wall ...
BIFOLD_DEPTH = 0.15  # ... into a V whose fold is at least 0.15 g off the wall line
SOLID_GAP = (1.5, 18.0)  # breaks of a solid wall line 1.5 t .. 18 t long (the gap limits, ruling R-a) ...
SOLID_FLANK = 0.5  # ... between solid stretches of at least 0.5 t beyond the junctions at its ends
SOLID_BAND = 0.25  # solid ink read on the centre line and 0.25 t to either side
LEAF_MIN_LEN_FRAC = 0.03  # door leaves are read on thin segments at least 0.03 L long (as wall faces are)
LEAF_DOOR_DEG = 10.0  # a leaf door's leaf is perpendicular to its wall, its arc closing along it ...
LEAF_DOOR_REACH_FRAC = 0.012  # ... its hinge within 0.75 t + 2 px + 0.012 L of the wall's line
PANEL_WALL_GREY = (50.0, 170.0)  # grey poche: a wall's median centre-line grey ...
PANEL_LIGHTER = 20.0  # ... a window panel this much lighter ...
PANEL_PAPER = 200.0  # ... and darker than paper ...
PANEL_BAND = 0.15  # ... read on the centre line and 0.15 t to either side
LINE_DEG = 3.0  # graph walls meeting at a node within 3 degrees continue one wall line
LABEL_HIDDEN = 0.5  # a gap is no passage when removed label ink runs along half of it
_THIN_CLEAR = 5  # solid strokes dilated by this (px) are removed from the arcs' thin ink


@dataclass(frozen=True, slots=True)
class _Frame:
    """A wall's centre-line frame: ``a`` + ``d`` u is the point at ``u``; ``n`` the left normal."""

    a: np.ndarray
    d: np.ndarray
    n: np.ndarray
    length: float
    t: float

    def at(self, u: float, across: float = 0.0) -> np.ndarray:
        return np.asarray(self.a + self.d * u + self.n * across)


def _frame(w: WallCandidate) -> _Frame | None:
    a, b = np.asarray(w.a, np.float64), np.asarray(w.b, np.float64)
    length = float(np.hypot(*(b - a)))
    if length < 1e-6:
        return None
    d = (b - a) / length
    return _Frame(a, d, np.array((d[1], -d[0])), length, max(1.0, float(w.thickness_px)))


@dataclass(frozen=True, slots=True)
class _Ink:
    """The arcs' ink: ``near`` is thin ink grown by 2 px (a sample's 5 x 5 window); ``unknown`` is where an
    arc is not judged: within 2 px of ink the text mask removed, and on the walls' strips."""

    near: np.ndarray
    unknown: np.ndarray
    masked: np.ndarray  # ink the text mask removed (where labels were)


@dataclass(frozen=True, slots=True)
class _Found:
    """A classified candidate: the opening's span on its wall and its symbol."""

    u0: float
    u1: float
    kind: Literal["door", "window", "opening"]
    type: str
    hinge: Hinge
    swing: Swing
    support: float


def find_openings(
    graph: WallGraph, pre: Preprocessed, segments: list[Segment], ink_notext: np.ndarray
) -> list[OpeningCandidate]:
    """Doors, windows and passages of ``graph``'s gaps and of the breaks in its solid wall lines (module
    doc).

    ``segments`` are the plan region's line segments (``detect_segments``); ``ink_notext`` the text-free ink
    (``OcrResult.ink_notext``, ruling R6); ``pre.thick`` is the solid ink, removed from the arcs' thin ink
    and read for solid-wall breaks."""
    thin_ink = ink_notext.copy()
    k = 2 * _THIN_CLEAR + 1
    thin_ink[cv2.dilate(pre.thick, np.ones((k, k), np.uint8)) > 0] = 0
    w5 = 2 * ARC_WINDOW_PX + 1
    near = cv2.dilate(thin_ink, np.ones((w5, w5), np.uint8))
    # Text masking removed the ink under labels: an arc passing under a label is neither seen nor missing
    # there (the masked ink marks where text was; it is never read as evidence, ruling R6).
    masked = ((pre.ink > 0) & (ink_notext == 0)).astype(np.uint8)
    unknown = cv2.dilate(masked, np.ones((w5, w5), np.uint8))
    # Nor are the walls' own strips read: a double-line wall's faces are thin ink, but no arc.
    for w in graph.walls:
        a = (round(w.a[0] * 16), round(w.a[1] * 16))
        b = (round(w.b[0] * 16), round(w.b[1] * 16))
        cv2.line(unknown, a, b, 1, max(1, round(w.thickness_px + 2 * ARC_WINDOW_PX)), cv2.LINE_8, 4)
    ink = _Ink(near, unknown, masked)
    thin = np.array([(*s.p0, *s.p1) for s in segments if s.is_thin], np.float64).reshape(-1, 4)
    frames = {w.id: _frame(w) for w in graph.walls}
    order = {w.id: k for k, w in enumerate(graph.walls)}
    L = float(pre.region.long_side)
    found: list[tuple[int, float, str, _Found]] = []
    for wall_id, u0, u1, is_gap in _candidates(graph, pre.thick, frames):
        f = frames[wall_id]
        if f is None or u1 - u0 < 1.0:
            continue
        op = _classify(u0, u1, f, ink, thin, is_gap)
        if op is not None:
            op = dataclasses.replace(
                op, u0=max(0.0, op.u0), u1=min(f.length, op.u1)
            )  # a door's span may overrun
            found.append((order[wall_id], op.u0, wall_id, op))
    extra = _leaf_doors(graph, frames, door_leaves(segments, thin_ink, pre.t_thin, LEAF_MIN_LEN_FRAC * L), L)
    if pre.drawing_kind == "colored_brochure":
        extra += _grey_panels(graph, frames, pre.gray)
    for wall_id, op in extra:
        mine = [o for _, _, w, o in found if w == wall_id]
        if all(min(o.u1, op.u1) - max(o.u0, op.u0) <= 0.5 * min(o.u1 - o.u0, op.u1 - op.u0) for o in mine):
            found.append((order[wall_id], op.u0, wall_id, op))
    found.sort(key=lambda x: (x[0], x[1]))
    return [
        OpeningCandidate(f"O{k}", wall_id, o.u0, o.u1, o.kind, o.type, o.hinge, o.swing, o.support)
        for k, (_, _, wall_id, o) in enumerate(found, 1)
    ]


# --- candidates ------------------------------------------------------------------------------------------


def _candidates(
    graph: WallGraph, thick: np.ndarray, frames: dict[str, _Frame | None]
) -> list[tuple[str, float, float, bool]]:
    """The graph's gaps (``True``) and the breaks of its solid wall lines (``False``). A gap inside a solid
    break takes the break's extent: a frame line or sash paired into a wall piece leaves only part of a
    window as a gap of the graph."""
    gaps: dict[str, list[list[float]]] = defaultdict(list)
    for g in graph.gaps:
        gaps[g.wall_id].append([g.u0, g.u1])
    out: list[tuple[str, float, float, bool]] = []
    for wall_id, b0, b1 in _solid_breaks(graph, thick, frames):
        hit = [g for g in gaps[wall_id] if min(b1, g[1]) - max(b0, g[0]) > 0]
        if not hit:
            out.append((wall_id, b0, b1, False))
        elif len(hit) == 1:
            hit[0][0], hit[0][1] = min(hit[0][0], b0), max(hit[0][1], b1)
    for w in graph.walls:
        out.extend((w.id, g0, g1, True) for g0, g1 in gaps[w.id])
    return _off_junctions(graph, frames, out)


def _off_junctions(
    graph: WallGraph, frames: dict[str, _Frame | None], cands: list[tuple[str, float, float, bool]]
) -> list[tuple[str, float, float, bool]]:
    """Candidates trimmed clear of the walls crossing at their wall's end nodes (half the thickest one,
    + 2 px; a collinear continuation does not count), and dropped when less than ``1.5 t`` stays: a gap
    that is only a junction's own extent is no opening."""
    at: dict[str, list[WallCandidate]] = defaultdict(list)
    for w in graph.walls:
        at[w.a_node].append(w)
        at[w.b_node].append(w)
    by_id = {w.id: w for w in graph.walls}
    cos_tol = math.cos(math.radians(LINE_DEG))

    def zone(w: WallCandidate, node: str) -> float:
        f = frames[w.id]
        assert f is not None
        crossing = []
        for o in at[node]:
            fo = frames[o.id]
            if o.id != w.id and fo is not None and abs(float(fo.d @ f.d)) < cos_tol:
                crossing.append(o.thickness_px)
        return max(crossing) / 2.0 + 2.0 if crossing else 0.0

    out = []
    for wall_id, u0, u1, is_gap in cands:
        w, f = by_id[wall_id], frames[wall_id]
        if f is None:
            continue
        u0, u1 = max(u0, zone(w, w.a_node), 0.0), min(u1, f.length - zone(w, w.b_node), f.length)
        if u1 - u0 >= SOLID_GAP[0] * f.t:
            out.append((wall_id, u0, u1, is_gap))
    return out


def _lines(graph: WallGraph, frames: dict[str, _Frame | None]) -> list[list[tuple[str, str, str]]]:
    """Straight wall lines: graph walls meeting end to end at a node within 3 degrees, chained (each end
    continues into at most one wall, the straightest). Each line lists ``(wall, entry node, exit node)``
    in order."""
    at: dict[str, list[str]] = defaultdict(list)
    for w in graph.walls:
        if frames[w.id] is not None:
            at[w.a_node].append(w.id)
            at[w.b_node].append(w.id)
    by_id = {w.id: w for w in graph.walls}

    def other(wid: str, node: str) -> str:
        return by_id[wid].b_node if by_id[wid].a_node == node else by_id[wid].a_node

    cos_tol = math.cos(math.radians(LINE_DEG))
    link: dict[tuple[str, str], str] = {}  # (wall, node) -> the wall it continues into there
    for node, ids in at.items():
        pairs = []
        for i, x in enumerate(ids):
            for y in ids[i + 1 :]:
                fx, fy = frames[x], frames[y]
                assert fx is not None and fy is not None
                dx = fx.d if by_id[x].a_node == node else -fx.d  # leaving the node
                dy = fy.d if by_id[y].a_node == node else -fy.d
                c = -float(dx @ dy)
                if c >= cos_tol:
                    pairs.append((c, x, y))
        for _, x, y in sorted(pairs, reverse=True):
            if (x, node) not in link and (y, node) not in link:
                link[(x, node)], link[(y, node)] = y, x
    seen: set[str] = set()
    lines = []
    for w in graph.walls:
        if w.id in seen or frames[w.id] is None:
            continue
        cur, entry = w.id, w.a_node  # walk back to the line's first wall
        steps = 0
        while (cur, entry) in link and steps <= len(graph.walls):
            prev = link[(cur, entry)]
            cur, entry = prev, other(prev, entry)
            steps += 1
        line = []
        while cur not in seen:
            exit_node = other(cur, entry)
            line.append((cur, entry, exit_node))
            seen.add(cur)
            if (cur, exit_node) not in link:
                break
            cur, entry = link[(cur, exit_node)], exit_node
        lines.append(line)
    return lines


def _solid_breaks(
    graph: WallGraph, thick: np.ndarray, frames: dict[str, _Frame | None]
) -> list[tuple[str, float, float]]:
    """Breaks ``(wall, u0, u1)`` of the solid ink along each straight wall line (``_lines``): stretches
    without solid ink ``1.5 t .. 18 t`` long between solid stretches reaching at least ``0.5 t`` beyond the
    junctions at the line's ends (their solid ink is the crossing walls'), on the wall holding the break's
    middle."""
    at: dict[str, list[WallCandidate]] = defaultdict(list)
    for w in graph.walls:
        at[w.a_node].append(w)
        at[w.b_node].append(w)
    a_node = {w.id: w.a_node for w in graph.walls}
    out = []
    for line in _lines(graph, frames):
        ids = {wid for wid, _, _ in line}
        first = frames[line[0][0]]
        assert first is not None
        start_node = line[0][1]
        u = first.d if start_node == a_node[line[0][0]] else -first.d
        origin = np.asarray(graph.nodes[start_node], np.float64)
        spans = []  # (wall id, s of its u = 0, sign of its u along s, frame)
        s_parts, solid_parts = [], []
        for wid, _, _ in line:
            f = frames[wid]
            assert f is not None
            sa = float((f.a - origin) @ u)
            sign = 1.0 if float(f.d @ u) > 0 else -1.0
            spans.append((wid, sa, sign, f))
            uu = np.arange(0.0, f.length + 1e-9, 1.0)
            solid = np.zeros(len(uu), bool)
            for k in (-SOLID_BAND, 0.0, SOLID_BAND):
                pts = f.a[None, :] + uu[:, None] * f.d[None, :] + (f.n * k * f.t)[None, :]
                solid |= ink_at(thick, pts)
            s_parts.append(sa + sign * uu)
            solid_parts.append(solid)
        s = np.concatenate(s_parts)
        solid = np.concatenate(solid_parts)
        order = np.argsort(s, kind="stable")
        s, solid = s[order], solid[order]
        if solid.all() or not solid.any():
            continue
        zone0 = _zone(at[start_node], ids)
        zone1 = _zone(at[line[-1][2]], ids)
        s_lo, s_hi = float(s[0]), float(s[-1])
        ss = s[solid]
        cut = np.flatnonzero(np.diff(ss) > 1.5)  # solid runs: consecutive solid samples
        run_lo = np.concatenate(([ss[0]], ss[cut + 1]))
        run_hi = np.concatenate((ss[cut], [ss[-1]]))
        for k in range(len(run_lo) - 1):
            b0, b1 = float(run_hi[k]), float(run_lo[k + 1])
            wid, sa, sign, f = _holding(spans, (b0 + b1) / 2.0)
            if not SOLID_GAP[0] * f.t <= b1 - b0 <= SOLID_GAP[1] * f.t:
                continue
            flank = SOLID_FLANK * f.t
            left = b0 - max(float(run_lo[k]), s_lo + zone0)
            right = min(float(run_hi[k + 1]), s_hi - zone1) - b1
            if left < flank or right < flank:
                continue
            u0, u1 = sorted(((b0 - sa) * sign, (b1 - sa) * sign))
            out.append((wid, max(0.0, u0), min(f.length, u1)))
    return out


def _zone(walls: list[WallCandidate], line: set[str]) -> float:
    """Half the thickest wall at a line's end node that is not on the line (+ 2 px): the stretch whose solid
    ink is that wall's; 0 at a free end."""
    others = [w.thickness_px for w in walls if w.id not in line]
    return max(others) / 2.0 + 2.0 if others else 0.0


def _holding(spans: list[tuple[str, float, float, _Frame]], s: float) -> tuple[str, float, float, _Frame]:
    """The line's wall whose stretch holds ``s`` (the nearest one when none does)."""

    def dist(span: tuple[str, float, float, _Frame]) -> float:
        _, sa, sign, f = span
        lo, hi = sorted((sa, sa + sign * f.length))
        return max(lo - s, 0.0, s - hi)

    return min(spans, key=dist)


# --- classification --------------------------------------------------------------------------------------


def _classify(u0: float, u1: float, f: _Frame, ink: _Ink, thin: np.ndarray, is_gap: bool) -> _Found | None:
    """Door, window or passage (module doc). A gap may hold both frame lines and an arc (a threshold drawn
    across a door, a toilet fixture beside a window): a clear arc (support >= 0.75) is a door, else frame
    lines are a window, else a weaker arc (>= 0.55) is a door."""
    door = _door(u0, u1, f, ink, thin)
    if door is not None and door.support >= DOOR_CLEAR:
        return door
    window = _window(u0, u1, f, thin)
    if window is not None:
        window_type, support = window
        return _Found(u0, u1, "window", window_type, "start", "left", support)
    if door is not None:
        return door
    if is_gap and not _under_label(u0, u1, f, ink.masked):
        return _Found(u0, u1, "opening", "opening", "start", "left", 0.0)
    return None


def _under_label(u0: float, u1: float, f: _Frame, masked: np.ndarray) -> bool:
    """Ink the text mask removed runs along the gap over half of it, inside the wall's strip: a wall line
    erased under a label, or symbols hidden by one; the gap is no evidence of a passage."""
    u = np.arange(u0, u1 + 1e-9, 1.0)
    if not u.size:
        return False
    hidden = np.zeros(len(u), bool)
    for k in np.linspace(-0.5, 0.5, 5):
        hidden |= ink_at(masked, f.a[None, :] + u[:, None] * f.d[None, :] + (f.n * k * f.t)[None, :])
    return float(hidden.mean()) >= LABEL_HIDDEN


def _arc_support(ink: _Ink, f: _Frame, u_hinge: float, toward: float, side: float, r: float) -> float:
    """Share of the 24 quarter-circle samples of radius ``r`` about the jamb point at ``u_hinge`` that have
    thin ink in their 5 x 5 window, among the samples off ``ink.unknown`` (the walls' strips and the
    labels; 0 with fewer than 8 of those). ``toward`` (+1 / -1 along ``d``) points from the hinge across the
    opening, ``side`` (+1 / -1 along ``n``) to the open leaf."""
    theta = np.radians((np.arange(ARC_SAMPLES) + 0.5) * 90.0 / ARC_SAMPLES)
    dirs = np.cos(theta)[:, None] * (f.d * toward)[None, :] + np.sin(theta)[:, None] * (f.n * side)[None, :]
    pts = f.at(u_hinge)[None, :] + dirs * r
    use = ~ink_at(ink.unknown, pts)
    n_used = int(np.count_nonzero(use))
    if n_used < ARC_MIN_COUNTED:
        return 0.0
    return float(np.count_nonzero(ink_at(ink.near, pts) & use)) / n_used


def _has_leaf(thin: np.ndarray, f: _Frame, u_hinge: float, side: float, r: float) -> bool:
    """A straight leaf: a thin segment ``0.8 .. 1.1 r`` long, perpendicular to the wall within 10 degrees,
    from the hinge (one end within ``t / 2`` + 2 px of the jamb point or its face) out to ``side``."""
    if not thin.size:
        return False
    out = f.n * side
    jamb = f.at(u_hinge)
    reach = 0.5 * f.t + 2.0
    cos_tol = math.cos(math.radians(LEAF_ANGLE_DEG))
    for row in thin:
        p, q = row[:2], row[2:]
        for near_end, far_end in ((p, q), (q, p)):
            v = far_end - near_end
            length = float(np.hypot(*v))
            if not LEAF_LEN[0] * r <= length <= LEAF_LEN[1] * r:
                continue
            if float(v @ out) < cos_tol * length:
                continue
            rel = near_end - jamb
            if abs(float(rel @ f.d)) <= reach and -2.0 <= float(rel @ out) <= reach:
                return True
    return False


def _door(u0: float, u1: float, f: _Frame, ink: _Ink, thin: np.ndarray) -> _Found | None:
    """The door in ``[u0, u1]``, or None (module doc, step 1)."""
    g = u1 - u0
    r_min = max(LEAF_MIN_T * f.t, LEAF_MIN_PX)
    if g < r_min:
        return None
    double: tuple[float, float, float] | None = None  # (support at u0, at u1, side)
    if g / 2.0 >= r_min:
        for side in (1.0, -1.0):
            a = _arc_support(ink, f, u0, 1.0, side, g / 2.0)
            b = _arc_support(ink, f, u1, -1.0, side, g / 2.0)
            if min(a, b) >= DOUBLE_SUPPORT and (double is None or min(a, b) > min(double[0], double[1])):
                double = (a, b, side)
    if double is not None:
        swing: Swing = "left" if double[2] > 0 else "right"
        return _Found(u0, u1, "door", "double_swing", "start", swing, min(1.0, (double[0] + double[1]) / 2.0))
    bifold = _bifold(u0, u1, f, thin)  # before the arcs: a quarter circle can be fitted through a V
    if bifold is not None:
        return _Found(u0, u1, "door", "bifold", bifold[0], bifold[1], 1.0)
    best: tuple[float, float, float, Hinge, Swing] | None = None  # (support, span start, span end, ...)
    hypotheses: tuple[tuple[Hinge, float, float, float], ...] = (
        ("start", u0, u1, 1.0),
        ("end", u1, u0, -1.0),
    )
    step = g / SPAN_STEPS
    for hinge, u_h, u_c, toward in hypotheses:
        # (hinge, closing jamb): the gap's own ends; the hinge further out; the leaf closing short
        spans = [(u_h - toward * step * k, u_c) for k in range(SPAN_STEPS + 1)]
        spans += [(u_h, u_c - toward * step * k) for k in range(1, round(SPAN_SHORT * SPAN_STEPS) + 1)]
        spans += [(u_h + toward * step * k, u_c) for k in range(1, round(SPAN_NIB * SPAN_STEPS) + 1)]
        for side in (1.0, -1.0):
            for h, c in spans:
                r = abs(c - h)
                if r < r_min:
                    continue
                support = _arc_support(ink, f, h, toward, side, r)
                if support + LEAF_BONUS < DOOR_SUPPORT or (
                    best is not None and support + LEAF_BONUS <= best[0]
                ):
                    continue
                if _has_leaf(thin, f, h, side, r):
                    support += LEAF_BONUS
                if best is None or support > best[0]:
                    best = (support, h, c, hinge, "left" if side > 0 else "right")
    if best is not None and best[0] >= DOOR_SUPPORT:
        support, h, c, hinge, swing = best
        return _Found(min(h, c), max(h, c), "door", "single_swing", hinge, swing, min(1.0, support))
    return None


def _bifold(u0: float, u1: float, f: _Frame, thin: np.ndarray) -> tuple[Hinge, Swing] | None:
    """(hinge, swing) of a bi-fold door: two thin leaves ``0.25 .. 0.75 g`` long at ``15 .. 75`` degrees to
    the wall, meeting in a fold at least ``0.15 g`` off the wall line, their other ends on the wall line
    (within ``t / 2`` + 2 px) inside the gap, one of them at a jamb (within ``t / 2`` + 2 px)."""
    g = u1 - u0
    if not thin.size:
        return None
    reach = 0.5 * f.t + 2.0
    rel0 = thin[:, :2] - f.a
    rel1 = thin[:, 2:] - f.a
    s0, s1 = rel0 @ f.d, rel1 @ f.d
    o0, o1 = rel0 @ f.n, rel1 @ f.n
    length = np.hypot(s1 - s0, o1 - o0)
    sin_ang = np.abs(o1 - o0) / np.maximum(length, 1e-9)
    lo, hi = (math.sin(math.radians(a)) for a in BIFOLD_ANGLE_DEG)
    ok = (length >= BIFOLD_LEAF[0] * g) & (length <= BIFOLD_LEAF[1] * g) & (sin_ang >= lo) & (sin_ang <= hi)
    ok &= (np.minimum(s0, s1) >= u0 - reach) & (np.maximum(s0, s1) <= u1 + reach)
    leaves = []
    for k in np.flatnonzero(ok).tolist():
        ends = [(float(s0[k]), float(o0[k])), (float(s1[k]), float(o1[k]))]
        ends.sort(key=lambda e: abs(e[1]))  # (on the wall line, at the fold)
        if abs(ends[0][1]) <= reach and abs(ends[1][1]) >= BIFOLD_DEPTH * g:
            leaves.append((ends[0], ends[1]))
    join = max(3.0, reach)
    for i, (base_i, fold_i) in enumerate(leaves):
        for base_j, fold_j in leaves[i + 1 :]:
            if math.dist(fold_i, fold_j) > join or fold_i[1] * fold_j[1] <= 0:
                continue
            if (base_i[0] - fold_i[0]) * (base_j[0] - fold_j[0]) >= 0:
                continue  # both leaves on one side of the fold: no V
            first = min(base_i[0], base_j[0])
            last = max(base_i[0], base_j[0])
            hinge: Hinge
            if first - u0 <= reach:
                hinge = "start"
            elif u1 - last <= reach:
                hinge = "end"
            else:
                continue
            return hinge, "left" if fold_i[1] > 0 else "right"
    return None


def _window(u0: float, u1: float, f: _Frame, thin: np.ndarray) -> tuple[str, float] | None:
    """(type, support) of a window in ``[u0, u1]``, or None (module doc, step 2); the support is the mean
    coverage of its two best lines."""
    g = u1 - u0
    rel = thin - np.concatenate((f.a, f.a))[None, :] if thin.size else thin
    reach = WINDOW_STRIP * f.t
    lines = frame_lines(
        rel, f.d, f.n, u0, u1, -reach, reach, angle_deg=WINDOW_ANGLE_DEG, cluster_px=WINDOW_CLUSTER_PX
    )
    if not lines:
        return None
    cover = sorted((ln.covered / g for ln in lines), reverse=True)
    support = min(1.0, (cover[0] + (cover[1] if len(cover) > 1 else 0.0)) / 2.0)
    sashes = [ln for ln in lines if ln.covered >= SASH_MIN_COVER * g]
    if len(sashes) >= SASH_LINES:
        for i, x in enumerate(sashes):
            for y in sashes[i + 1 :]:
                offset = _overlap(x, y) <= SASH_OVERLAP * min(x.covered, y.covered)
                if offset and _union(x, y) >= WINDOW_COVER * g:
                    return "sliding_window", support
    if sum(c >= WINDOW_COVER for c in cover) >= WINDOW_LINES:
        return "casement", support
    return None


def _overlap(x: FrameLine, y: FrameLine) -> float:
    return sum(max(0.0, min(a1, b1) - max(a0, b0)) for a0, a1 in x.spans for b0, b1 in y.spans)


def _union(x: FrameLine, y: FrameLine) -> float:
    return x.covered + y.covered - _overlap(x, y)


# --- symbols away from gaps (rulings R17-a, R17-b) --------------------------------------------------------


def _leaf_doors(
    graph: WallGraph, frames: dict[str, _Frame | None], leaves: dict[str, DoorLeaf], L: float
) -> list[tuple[str, _Found]]:
    """Doors drawn across a wall the drawing does not break (ruling R17-a; the HDB entrance's bold outer
    stroke runs on across it): an open leaf with its swing arc (``door_leaves``) whose hinge lies on a
    graph wall's line (within ``0.75 t`` + 2 px + ``0.012 L``: the hinge sits on the face of a wall often
    drawn thinner than it is), the leaf perpendicular to that wall and the arc closing along it (within 10
    degrees), is a door over ``[hinge, hinge +- leaf length]`` on the wall holding most of that span (at
    least half). A wall that runs along a leaf (a leaf paired into a wall piece) hosts none."""
    sin_tol, cos_tol = math.sin(math.radians(LEAF_DOOR_DEG)), math.cos(math.radians(LEAF_DOOR_DEG))
    out: list[tuple[str, _Found]] = []
    for lf in leaves.values():
        best: tuple[float, str, float, float, float, _Frame] | None = None
        for w in graph.walls:
            f = frames[w.id]
            if f is None or abs(float(f.d @ lf.leaf)) > sin_tol or abs(float(f.d @ lf.toward)) < cos_tol:
                continue
            if _along_a_leaf(f, leaves):
                continue
            rel = lf.hinge - f.a
            u, across = float(rel @ f.d), float(rel @ f.n)
            if abs(across) > 0.75 * f.t + 2.0 + LEAF_DOOR_REACH_FRAC * L or not -f.t <= u <= f.length + f.t:
                continue
            sign = 1.0 if float(lf.toward @ f.d) > 0 else -1.0
            u0, u1 = sorted((u, u + sign * lf.length))
            cover = min(u1, f.length) - max(u0, 0.0)
            if cover >= 0.5 * lf.length and (best is None or cover > best[0]):
                best = (cover, w.id, u0, u1, sign, f)
        if best is None:
            continue
        _, wall_id, u0, u1, sign, f = best
        swing: Swing = "left" if float(lf.leaf @ f.n) > 0 else "right"
        hinge: Hinge = "start" if sign > 0 else "end"
        out.append(
            (wall_id, _Found(max(0.0, u0), min(f.length, u1), "door", "single_swing", hinge, swing, 1.0))
        )
    return out


def _along_a_leaf(f: _Frame, leaves: dict[str, DoorLeaf]) -> bool:
    """The wall runs along a leaf (parallel within 10 degrees, within ``t`` of it, over half its length)."""
    cos_tol = math.cos(math.radians(LEAF_DOOR_DEG))
    for lf in leaves.values():
        if abs(float(f.d @ lf.leaf)) < cos_tol:
            continue
        a, b = lf.hinge - f.a, lf.hinge + lf.leaf * lf.length - f.a
        if max(abs(float(a @ f.n)), abs(float(b @ f.n))) > f.t:
            continue
        s0, s1 = sorted((float(a @ f.d), float(b @ f.d)))
        if min(s1, f.length) - max(s0, 0.0) >= 0.5 * f.length:
            return True
    return False


def _grey_panels(
    graph: WallGraph, frames: dict[str, _Frame | None], gray: np.ndarray
) -> list[tuple[str, _Found]]:
    """Windows drawn as a lighter grey panel inside a grey-filled wall (ruling R17-b; colour brochure plans
    only): on a wall whose centre line reads a median grey of 50 .. 170 (grey poche; black poche and
    unfilled walls have no such panel), a stretch ``1.5 t .. 18 t`` long at least 20 grey levels lighter
    than that median and darker than paper (< 200) is a ``fixed`` window. The grey is the mean of the
    centre line and the lines 0.15 t to either side."""
    out: list[tuple[str, _Found]] = []
    for w in graph.walls:
        f = frames[w.id]
        if f is None or f.length < 3.0 * f.t:
            continue
        u = np.arange(0.0, f.length, 1.0)
        vals = np.mean(
            [
                _gray_at(gray, f.a[None, :] + u[:, None] * f.d[None, :] + (f.n * k * f.t)[None, :])
                for k in (-PANEL_BAND, 0.0, PANEL_BAND)
            ],
            axis=0,
        )
        med = float(np.median(vals))
        if not PANEL_WALL_GREY[0] <= med <= PANEL_WALL_GREY[1]:
            continue
        on = (vals >= med + PANEL_LIGHTER) & (vals < PANEL_PAPER)
        edges = np.diff(np.concatenate(([0], on.astype(np.int8), [0])))
        for s0, s1 in zip(np.flatnonzero(edges == 1), np.flatnonzero(edges == -1), strict=True):
            u0, u1 = float(u[s0]), float(u[s1 - 1])
            if SOLID_GAP[0] * f.t <= u1 - u0 <= SOLID_GAP[1] * f.t:
                out.append((w.id, _Found(u0, u1, "window", "fixed", "start", "left", 1.0)))
    return out


def _gray_at(gray: np.ndarray, pts: np.ndarray) -> np.ndarray:
    h, w = gray.shape[:2]
    x = np.clip(np.rint(pts[:, 0]).astype(np.intp), 0, w - 1)
    y = np.clip(np.rint(pts[:, 1]).astype(np.intp), 0, h - 1)
    return np.asarray(gray[y, x], np.float64)
