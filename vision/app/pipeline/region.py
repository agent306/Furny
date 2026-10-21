"""Plan region: the part of the page that holds the floor plan (06 §7.6 step 7)."""

from collections.abc import Callable

import cv2
import numpy as np

from app.pipeline.context import PipelineContext
from app.utils.geometry import Rect, odd

CLOSE_FRAC = 0.02  # closing kernel, fraction of the long edge
NEAR_FRAC = 0.05  # components this close (fraction of the long edge) belong to one drawing
SIBLING_MIN_SHARE = 0.30  # another drawing with this share of the main plan's wall pixels is warned about
SURROUND_MIN_COVER = 0.50  # a solid drawing covering this share of a strip drawing's box makes it annotation
INSIDE_MIN_SHARE = 0.80  # a drawing with this share of its box inside the region is no excluded rival
MAX_COMPONENTS = 2000  # grouping bound: the largest components by wall pixels
INK_LINK_FRAC = 0.005  # ink closing kernel for linking wall components, fraction of the long edge
EXPAND_FRAC = 0.06  # dimension chains live outside the walls
ANNOTATION_GROW_FRAC = 0.15  # ... and reach up to ~0.15 L beyond them (Task 14b ruling B1)


def _groups(boxes: np.ndarray, near: float, linked: np.ndarray, poll: Callable[[], None]) -> np.ndarray:
    """Group label per box: boxes (x0, y0, x1, y1) whose gap is at most ``near``, and the index pairs in
    ``linked`` (k, 2), belong together, transitively (union-find over the pairs).

    Close pairs come from a sweep over the boxes sorted by ``x0``: box ``i`` is only compared with the
    boxes after it that start at most ``near`` past its right edge, so the cost follows the number of
    boxes overlapping in x (no ``n x n`` arrays); ``poll`` is called every 64 boxes."""
    n = len(boxes)
    parent = list(range(n))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(i: int, j: int) -> None:
        ri, rj = find(i), find(j)
        if ri != rj:
            parent[max(ri, rj)] = min(ri, rj)

    order = np.argsort(boxes[:, 0], kind="stable")
    x0, y0, x1, y1 = (boxes[order, k] for k in range(4))
    reach = np.searchsorted(x0, x1 + near, side="right")  # boxes [i + 1, reach) start close enough in x
    for i in range(n):
        if i % 64 == 0:
            poll()
        j = np.arange(i + 1, int(reach[i]))
        if j.size == 0:
            continue
        gap_y = np.maximum(y0[j] - y1[i], y0[i] - y1[j])
        for k in j[gap_y <= near].tolist():
            union(int(order[i]), int(order[k]))
    for i, j in linked.tolist():
        union(int(i), int(j))
    return np.array([find(i) for i in range(n)], np.intp)


def _ink_links(labels: np.ndarray, comps: np.ndarray, walls: np.ndarray, ink: np.ndarray) -> np.ndarray:
    """Pairs ``(i, j)`` of indices into ``comps`` whose wall pixels touch one closed-ink component."""
    k = odd(round(INK_LINK_FRAC * max(ink.shape[:2])))
    closed = cv2.morphologyEx(ink, cv2.MORPH_CLOSE, np.ones((k, k), np.uint8))
    _, ink_labels = cv2.connectedComponents(closed, connectivity=8, ltype=cv2.CV_32S)
    index = np.full(int(labels.max()) + 1, -1, np.intp)
    index[comps] = np.arange(len(comps))
    at = (walls > 0) & (closed > 0)
    comp_of, ink_of = index[labels[at]], ink_labels[at]
    keep = comp_of >= 0
    pairs = np.unique(np.stack([ink_of[keep], comp_of[keep]], axis=1), axis=0)  # sorted by ink label
    same = pairs[1:, 0] == pairs[:-1, 0]
    return np.stack([pairs[:-1, 1][same], pairs[1:, 1][same]], axis=1).astype(np.intp)


def annotation_region(region: Rect, w: int, h: int) -> Rect:
    """The annotation region (Task 14b ruling B1): the plan region grown by 0.15 of its long side on every
    side, clamped to the `w` x `h` page. Outer dimension chains and their overall lines are drawn up to
    ~0.15 L beyond the walls, past the plan region's 6 % margin. The OCR and segment stages read this
    region and the dimension stage uses all of it; walls, rooms and every other stage keep the plan region
    (they get `segments.detect_segments`, the plan region's own segments, and select their tokens with
    `ocr_stage.in_region`; `segments.detect_annotation_segments` adds the rest for the dimension stage).
    """
    region = region.clip(w, h)
    if region.w <= 0 or region.h <= 0:
        return region
    return region.expand(round(ANNOTATION_GROW_FRAC * region.long_side)).clip(w, h)


def detect_plan_region(
    thick: np.ndarray,
    ink: np.ndarray,
    ctx: PipelineContext,
    *,
    bold: np.ndarray | None = None,
    strips: np.ndarray | None = None,
    attached: np.ndarray | None = None,
) -> Rect:
    """Bounding box of the main plan's walls, grown by 6 % and clipped.

    Candidates are drawings of solid wall strokes (`thick` with `bold`, the bold wall strokes of
    `binarize.bold_strokes`; ruling R4: a plan drawn with bold outline strokes and a few solid columns is
    found by the extent of its outline, not by one column) and drawings of double-line wall strips
    (`strips`, `binarize.strip_structures`; Task 16c). Each kind is closed with a `0.02 * long_edge`
    square; closed components whose bounding boxes lie within `0.05 * long_edge` of each other form one
    drawing, transitively (a plan whose walls are cut into pieces by its window and door gaps stays one
    drawing). Strips touching a solid drawing (`attached`) count toward it, inside its extent. The main
    plan is the drawing with the most **wall mass** (Task 16c fix round 3): its wall pixels, solid strokes
    and the strips between double lines alike, i.e. its walls' centre-line length weighted by their drawn
    thickness. A rule or a title-block frame is one stroke narrower than a wall: it does not outweigh a
    plan of either kind (by length alone, the reviewer's 4200 px frame outweighed a 3900 px filled plan).
    A strip drawing whose box holds a solid drawing of at least 30 % of its mass, covering at least 50 % of
    its box, is that plan's annotation (stacked dimension chains with their extension lines around a solid
    plan: the HDB plan covers 0.72 of its ring's box) and no candidate. A solid stair or lift core inside a
    double-line plan covers a few percent of the plan's box (fix round 4), so the plan stays. Another
    drawing holding >= 30 % as much (a key-plan inset, a strip of site context) is excluded with the warning
    `plan_region_ambiguous {components}` (the main plan plus every such drawing); one with >= 80 % of its
    box inside the region (a solid core within a double-line plan) is not excluded and not counted. With
    no wall pixels at all the region is the whole image and nothing is warned (the validator reports
    `no_walls_detected`).

    Components are also one drawing when the same `ink` component (closed with a `0.005 * long_edge`
    square) touches both: window frames, door leaves and railings join the wall pieces of one plan across
    openings wider than `0.05 * long_edge`, while a drawing beside it (across a corridor, an inset) shares
    no ink with it.
    """
    if bold is not None:
        thick = cv2.bitwise_or(thick, bold)
    h, w = thick.shape[:2]
    if strips is None:
        strips = np.zeros_like(thick)
    if not thick.any() and not strips.any():
        return Rect(0, 0, w, h)
    solid = _drawings(thick, attached, ink, ctx)
    # A strip drawing around a solid one of comparable mass and extent is that plan's annotation (stacked
    # dimension chains and their extension lines), not a plan of its own. A solid core inside a double-line
    # plan has the mass but not the extent.
    drawings = [
        *solid,
        *(
            (box, mass)
            for box, mass in _drawings(strips, None, ink, ctx)
            if not any(
                m >= SIBLING_MIN_SHARE * mass
                and _inside(b, box)
                and b.w * b.h >= SURROUND_MIN_COVER * box.w * box.h
                for b, m in solid
            )
        ),
    ]
    mass = np.array([m for _, m in drawings], np.float64)
    main = int(np.argmax(mass))
    union = drawings[main][0]
    region = union.expand(round(EXPAND_FRAC * union.long_side)).clip(w, h)
    # A heavy drawing inside the region (a solid core within a double-line plan) is not excluded: no rival.
    rivals = sum(
        1
        for i, (box, m) in enumerate(drawings)
        if i != main
        and m >= SIBLING_MIN_SHARE * mass[main]
        and _overlap(box, region) < INSIDE_MIN_SHARE * _area(box)
    )
    if rivals:
        ctx.warn("plan_region_ambiguous", {"components": rivals + 1})
    return region


def _area(r: Rect) -> int:
    return max(r.w, 0) * max(r.h, 0)


def _overlap(a: Rect, b: Rect) -> int:
    dx = min(a.x + a.w, b.x + b.w) - max(a.x, b.x)
    dy = min(a.y + a.h, b.y + b.h) - max(a.y, b.y)
    return max(dx, 0) * max(dy, 0)


def _inside(inner: Rect, outer: Rect) -> bool:
    return (
        inner.x >= outer.x
        and inner.y >= outer.y
        and inner.x + inner.w <= outer.x + outer.w
        and inner.y + inner.h <= outer.y + outer.h
    )


def _drawings(
    walls: np.ndarray, extra: np.ndarray | None, ink: np.ndarray, ctx: PipelineContext
) -> list[tuple[Rect, float]]:
    """The drawings of ``walls`` (closed components grouped by proximity and shared ink): the bounding box
    of each one's wall pixels and its wall mass (its wall pixels, plus the ``extra`` pixels lying on its
    closed components)."""
    if not walls.any():
        return []
    long_edge = max(walls.shape[:2])
    k = odd(round(CLOSE_FRAC * long_edge))
    closed = cv2.morphologyEx(walls, cv2.MORPH_CLOSE, np.ones((k, k), np.uint8))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(closed, connectivity=8)
    lab: np.ndarray = labels.astype(np.int32, copy=False)
    counts: np.ndarray = np.bincount(lab[walls > 0], minlength=n)
    mass = counts if extra is None else np.add(counts, np.bincount(lab[extra > 0], minlength=n))
    comps = np.flatnonzero(counts[1:] > 0) + 1
    if comps.size > MAX_COMPONENTS:  # bound the grouping: the smallest ones cannot be the plan
        comps = comps[np.argsort(-mass[comps], kind="stable")[:MAX_COMPONENTS]]
    x, y = stats[comps, cv2.CC_STAT_LEFT], stats[comps, cv2.CC_STAT_TOP]
    boxes = np.stack(
        [x, y, x + stats[comps, cv2.CC_STAT_WIDTH], y + stats[comps, cv2.CC_STAT_HEIGHT]], axis=1
    ).astype(np.int64)  # a square's closing stays inside its pixels' bounding box
    links = _ink_links(labels, comps, walls, ink)
    group = _groups(boxes, NEAR_FRAC * long_edge, links, ctx.check_deadline)
    out = []
    for g in np.unique(group).tolist():
        mine = boxes[group == g]
        x0, y0 = int(mine[:, 0].min()), int(mine[:, 1].min())
        x1, y1 = int(mine[:, 2].max()), int(mine[:, 3].max())
        out.append((Rect(x0, y0, x1 - x0, y1 - y0), float(mass[comps[group == g]].sum())))
    return out
