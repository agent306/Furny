"""Room faces (06 section 8.6 steps 1-7): the free space of the plan region that the walls enclose.

``find_room_faces`` works on the wall mask, not on the graph's centre lines:

1. **Closures.** ``closed`` is the wall mask plus every graph wall drawn at its thickness along its centre
   line outside its openings (the graph's L/T closures and the walls stage's links are walls the mask
   lacks). Then each opening (the openings stage's candidates and the graph's own gap intervals) is drawn
   across as a line of its wall's thickness (door "closures"), and so is every remaining end-to-end gap of
   at most ``18 t`` between collinear walls when one of the two facing ends is free.
2. ``free = ~closed`` inside the plan region, in 4-connected components.
3. Components touching the region border (the outside), smaller than ``0.002 x`` the region area, or whose
   bounding box is more than 15 times longer than wide (slivers) are no faces.
4. Each face's outer contour, simplified with ``approxPolyDP(0.5 t_median)``, is its polygon.
5. Its anchor is the maximum of its distance transform (the pole of inaccessibility), strictly inside.
6. ``contains_text_ids`` lists the tokens centred inside its polygon (the innermost one when faces nest).
7. Faces are ``R1..`` in the order of their anchors' ``(y, x)``. A face is ``open`` when it only closes
   thanks to closures longer than ``6 t`` (``t`` the closed wall's thickness): without them its free space
   would reach beyond it.

The second result is the int32 face-id map: ``k`` on the pixels of ``R{k}``, 0 elsewhere.

The post-scale filters of 06 section 8.6 (area in m^2) are applied at assembly.
"""

import math
from collections import defaultdict
from dataclasses import dataclass, replace

import cv2
import numpy as np

from app.schemas.candidates import OpeningCandidate, RoomFace, TextToken, WallCandidate, WallGraph
from app.utils.geometry import Pt, Rect

__all__ = ["find_room_faces"]

OPEN_CLOSURE_T = 6.0  # a closure longer than this many t leaves its faces open (step 7)
MAX_CLOSURE_T = 18.0  # step 1: collinear wall ends up to this many t apart are closed
MIN_AREA_FRAC = 0.002  # step 3: faces smaller than this share of the region area are dropped
MAX_ASPECT = 15.0  # step 3: faces whose bounding box is longer than this many times its width are slivers
POLY_EPS_T = 0.5  # step 4: approxPolyDP epsilon, in t_median
COLLINEAR_DEG = 3.0  # step 1: two walls are collinear within this angle ...
COLLINEAR_ACROSS_T = 0.5  # ... and with the other end within this many t of the line
_SHIFT = 4  # cv2 drawing sub-pixel bits
_ONE = 1 << _SHIFT


@dataclass(frozen=True, slots=True)
class _Closure:
    a: Pt
    b: Pt
    thickness: float

    @property
    def long(self) -> bool:
        return math.dist(self.a, self.b) > OPEN_CLOSURE_T * self.thickness


@dataclass(frozen=True, slots=True)
class _End:
    """A wall's end at node ``node``: its point, the outward unit direction along the wall and its
    thickness."""

    wall: str
    node: str
    p: Pt
    u: Pt
    thickness: float


def find_room_faces(
    wall_mask: np.ndarray,
    graph: WallGraph,
    openings: list[OpeningCandidate],
    tokens: list[TextToken],
    region: Rect,
    t_median: float,
) -> tuple[list[RoomFace], np.ndarray]:
    """Room faces of the plan region (module doc) and the int32 face-id map (``k`` for ``R{k}``)."""
    h, w = wall_mask.shape[:2]
    region = region.clip(w, h)
    face_map = np.zeros((h, w), np.int32)
    if region.w == 0 or region.h == 0:
        return [], face_map
    walls = (wall_mask > 0).astype(np.uint8) * 255
    intervals = _opening_intervals(graph, openings)
    closures: list[_Closure] = []
    for wall in graph.walls:
        cut = intervals.get(wall.id, [])
        for a, b in _pieces(wall, cut):
            _draw(walls, a, b, wall.thickness_px)
        closures += [_Closure(_at(wall, u0), _at(wall, u1), wall.thickness_px) for u0, u1 in cut]
    closures += _collinear_closures(graph)

    closed = walls.copy()
    short = walls.copy()  # closed without the long closures
    for c in closures:
        _draw(closed, c.a, c.b, c.thickness)
        if not c.long:
            _draw(short, c.a, c.b, c.thickness)

    labels, kept = _faces(closed, region)
    short_labels, _ = _faces(short, region, keep=False)
    beyond_long = (closed > 0) & (short == 0)  # the long closures' own pixels

    found: list[tuple[Pt, int, np.ndarray, tuple[int, int, int, int]]] = []
    for k, (x, y, bw, bh) in kept:
        mask = (labels[y : y + bh, x : x + bw] == k).astype(np.uint8)
        dt = cv2.distanceTransform(np.pad(mask, 1), cv2.DIST_L2, 5)[1:-1, 1:-1]
        row, col = np.unravel_index(int(np.argmax(dt)), dt.shape)
        found.append(((float(x + col), float(y + row)), k, mask, (x, y, bw, bh)))
    found.sort(key=lambda f: (f[0][1], f[0][0]))

    eps = POLY_EPS_T * t_median
    faces: list[RoomFace] = []
    polygons: list[np.ndarray] = []
    for n, (anchor, k, mask, (x, y, bw, bh)) in enumerate(found, 1):
        face_map[y : y + bh, x : x + bw][mask > 0] = n
        polygon = _polygon(mask, x, y, eps)
        polygons.append(polygon)
        faces.append(
            RoomFace(
                id=f"R{n}",
                polygon_px=tuple((float(px), float(py)) for px, py in polygon.reshape(-1, 2)),
                anchor_px=anchor,
                area_px=float(mask.sum()),
                bbox=(float(x), float(y), float(x + bw - 1), float(y + bh - 1)),
                contains_text_ids=(),
                open=_is_open(labels == k, short_labels, beyond_long, anchor),
            )
        )
    texts = _texts_in(faces, polygons, tokens)
    return [replace(f, contains_text_ids=ids) for f, ids in zip(faces, texts, strict=True)], face_map


# --- closures ---------------------------------------------------------------------------------------------


def _opening_intervals(
    graph: WallGraph, openings: list[OpeningCandidate]
) -> dict[str, list[tuple[float, float]]]:
    """Per wall, the merged sorted intervals of its openings: the openings stage's candidates and the
    graph's own gap intervals."""
    raw: dict[str, list[tuple[float, float]]] = defaultdict(list)
    for wall in graph.walls:
        raw[wall.id] += list(wall.openings_px)
    for o in openings:
        raw[o.wall_id].append((o.u0, o.u1))
    lengths = {wall.id: math.dist(wall.a, wall.b) for wall in graph.walls}
    merged: dict[str, list[tuple[float, float]]] = {}
    for wid, spans in raw.items():
        if wid not in lengths:
            continue
        out: list[tuple[float, float]] = []
        for u0, u1 in sorted((max(0.0, min(a, b)), min(lengths[wid], max(a, b))) for a, b in spans):
            if u1 <= u0:
                continue
            if out and u0 <= out[-1][1]:
                out[-1] = (out[-1][0], max(out[-1][1], u1))
            else:
                out.append((u0, u1))
        if out:
            merged[wid] = out
    return merged


def _at(wall: WallCandidate, u: float) -> Pt:
    length = math.dist(wall.a, wall.b)
    if length == 0:
        return wall.a
    k = u / length
    return (wall.a[0] + (wall.b[0] - wall.a[0]) * k, wall.a[1] + (wall.b[1] - wall.a[1]) * k)


def _pieces(wall: WallCandidate, cut: list[tuple[float, float]]) -> list[tuple[Pt, Pt]]:
    """The wall's centre line outside the intervals ``cut``."""
    length = math.dist(wall.a, wall.b)
    out: list[tuple[Pt, Pt]] = []
    s = 0.0
    for u0, u1 in [*cut, (length, length)]:
        if u0 > s:
            out.append((_at(wall, s), _at(wall, u0)))
        s = max(s, u1)
    return out


def _ends(graph: WallGraph) -> tuple[list[_End], dict[str, int]]:
    """Both ends of every wall, and the node degrees."""
    degree: dict[str, int] = defaultdict(int)
    ends = []
    for wall in graph.walls:
        length = math.dist(wall.a, wall.b)
        if length == 0:
            continue
        ux, uy = (wall.b[0] - wall.a[0]) / length, (wall.b[1] - wall.a[1]) / length
        for node, p, u in ((wall.a_node, wall.a, (-ux, -uy)), (wall.b_node, wall.b, (ux, uy))):
            degree[node] += 1
            ends.append(_End(wall.id, node, p, u, wall.thickness_px))
    return ends, degree


def _collinear_closures(graph: WallGraph) -> list[_Closure]:
    """Step 1: end-to-end gaps of at most ``18 t`` between collinear walls, one end at least free, that no
    other wall crosses; each end is closed at most once, shortest gaps first (so a wall running on through
    a junction never pairs past its own continuation)."""
    ends, degree = _ends(graph)
    cos = math.cos(math.radians(COLLINEAR_DEG))
    pairs: list[tuple[float, int, int]] = []
    for i, e in enumerate(ends):
        for j in range(i + 1, len(ends)):
            f = ends[j]
            if e.wall == f.wall or e.node == f.node or (degree[e.node] > 1 and degree[f.node] > 1):
                continue
            if e.u[0] * f.u[0] + e.u[1] * f.u[1] > -cos:
                continue  # not facing each other along one line
            dx, dy = f.p[0] - e.p[0], f.p[1] - e.p[1]
            along = dx * e.u[0] + dy * e.u[1]
            across = abs(dx * e.u[1] - dy * e.u[0])
            t = (e.thickness + f.thickness) / 2.0
            if along <= 0 or along > MAX_CLOSURE_T * t or across > COLLINEAR_ACROSS_T * t:
                continue
            pairs.append((along, i, j))
    pairs.sort()
    used: set[int] = set()
    out: list[_Closure] = []
    for _, i, j in pairs:
        if i in used or j in used:
            continue
        e, f = ends[i], ends[j]
        if _crosses_a_wall(graph, e, f):
            continue
        used |= {i, j}
        out.append(_Closure(e.p, f.p, (e.thickness + f.thickness) / 2.0))
    return out


def _crosses_a_wall(graph: WallGraph, e: _End, f: _End) -> bool:
    """Some wall not touching ``e``'s or ``f``'s node crosses the closure ``e.p -> f.p``."""
    for wall in graph.walls:
        if {wall.a_node, wall.b_node} & {e.node, f.node}:
            continue
        if _segments_cross(e.p, f.p, wall.a, wall.b):
            return True
    return False


def _segments_cross(p: Pt, q: Pt, a: Pt, b: Pt) -> bool:
    def orient(o: Pt, s: Pt, t: Pt) -> float:
        return (s[0] - o[0]) * (t[1] - o[1]) - (s[1] - o[1]) * (t[0] - o[0])

    d1, d2 = orient(a, b, p), orient(a, b, q)
    d3, d4 = orient(p, q, a), orient(p, q, b)
    return d1 * d2 < 0 and d3 * d4 < 0


def _draw(img: np.ndarray, a: Pt, b: Pt, thickness: float) -> None:
    cv2.line(
        img,
        (round(a[0] * _ONE), round(a[1] * _ONE)),
        (round(b[0] * _ONE), round(b[1] * _ONE)),
        255,
        max(1, round(thickness)),
        cv2.LINE_8,
        _SHIFT,
    )


# --- faces ------------------------------------------------------------------------------------------------


def _faces(
    closed: np.ndarray, region: Rect, *, keep: bool = True
) -> tuple[np.ndarray, list[tuple[int, tuple[int, int, int, int]]]]:
    """4-connected components of the free space inside ``region`` (page-sized labels) and, with ``keep``,
    the ones that are faces (step 3) with their boxes."""
    h, w = closed.shape[:2]
    free = np.zeros((h, w), np.uint8)
    rs, cs = slice(region.y, region.y + region.h), slice(region.x, region.x + region.w)
    free[rs, cs] = (closed[rs, cs] == 0).astype(np.uint8)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(free, connectivity=4)
    if not keep:
        return labels, []
    min_area = MIN_AREA_FRAC * region.w * region.h
    x1, y1 = region.x + region.w, region.y + region.h
    kept = []
    for k in range(1, n):
        x, y, bw, bh, area = (int(v) for v in stats[k])
        if x <= region.x or y <= region.y or x + bw >= x1 or y + bh >= y1:
            continue  # touches the region border: the outside
        if area < min_area or max(bw, bh) > MAX_ASPECT * min(bw, bh):
            continue
        kept.append((k, (x, y, bw, bh)))
    return labels, kept


def _polygon(mask: np.ndarray, x: int, y: int, eps: float) -> np.ndarray:
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    outer = max(contours, key=cv2.contourArea)
    poly = cv2.approxPolyDP(outer, eps, True) if eps > 0 else outer
    return np.asarray(poly.reshape(-1, 2) + np.array([x, y]), np.int64)


def _is_open(face: np.ndarray, short_labels: np.ndarray, beyond_long: np.ndarray, anchor: Pt) -> bool:
    """Without the long closures, the free space at the face's anchor reaches pixels outside the face (other
    than the long closures' own)."""
    k = short_labels[round(anchor[1]), round(anchor[0])]
    if k == 0:
        return False
    reach = short_labels == k
    return bool((reach & ~face & ~beyond_long).any())


def _texts_in(
    faces: list[RoomFace], polygons: list[np.ndarray], tokens: list[TextToken]
) -> list[tuple[str, ...]]:
    """Step 6: per face, the ids of the tokens centred inside its polygon (the smallest such face)."""
    out: list[list[str]] = [[] for _ in faces]
    contours = [p.reshape(-1, 1, 2).astype(np.float32) for p in polygons]
    for t in tokens:
        c = ((t.box[0] + t.box[2]) / 2.0, (t.box[1] + t.box[3]) / 2.0)
        inside = [i for i, poly in enumerate(contours) if cv2.pointPolygonTest(poly, c, False) >= 0]
        if inside:
            out[min(inside, key=lambda i: faces[i].area_px)].append(t.id)
    return [tuple(ids) for ids in out]
