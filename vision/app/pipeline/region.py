"""Plan region: the part of the page that holds the floor plan (06 §7.6 step 7)."""

import cv2
import numpy as np

from app.pipeline.context import PipelineContext
from app.utils.geometry import Rect, odd

CLOSE_FRAC = 0.02  # closing kernel, fraction of the long edge
NEAR_FRAC = 0.05  # components this close (fraction of the long edge) belong to one drawing
SIBLING_MIN_SHARE = 0.30  # another drawing with this share of the main plan's wall pixels is warned about
MAX_COMPONENTS = 2000  # pairwise grouping bound
INK_LINK_FRAC = 0.005  # ink closing kernel for linking wall components, fraction of the long edge
EXPAND_FRAC = 0.06  # dimension chains live outside the walls


def _groups(boxes: np.ndarray, near: float, linked: np.ndarray) -> np.ndarray:
    """Group label per box: boxes (x0, y0, x1, y1) whose gap is at most ``near``, and the index pairs in
    ``linked`` (k, 2), belong together, transitively (union-find over the pairs)."""
    n = len(boxes)
    gap_x = np.maximum(boxes[None, :, 0] - boxes[:, None, 2], boxes[:, None, 0] - boxes[None, :, 2])
    gap_y = np.maximum(boxes[None, :, 1] - boxes[:, None, 3], boxes[:, None, 1] - boxes[None, :, 3])
    close = np.maximum(np.maximum(gap_x, gap_y), 0) <= near
    close[linked[:, 0], linked[:, 1]] = True
    parent = list(range(n))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i, j in zip(*np.nonzero(np.triu(close | close.T, 1)), strict=True):
        ri, rj = find(int(i)), find(int(j))
        if ri != rj:
            parent[max(ri, rj)] = min(ri, rj)
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


def detect_plan_region(
    thick: np.ndarray, ink: np.ndarray, ctx: PipelineContext, *, bold: np.ndarray | None = None
) -> Rect:
    """Bounding box of the main plan's wall pixels, grown by 6 % and clipped.

    Wall pixels are `thick` together with `bold`, the bold wall strokes (`binarize.bold_strokes`; ruling
    R4: a plan drawn with bold outline strokes and a few solid columns is found by the extent of its
    outline, not by one column). They are closed with a `0.02 * long_edge` square; the closed components
    whose bounding boxes lie within `0.05 * long_edge` of each other form one drawing, transitively (a plan
    whose walls are cut into pieces by its window and door gaps stays one drawing). The main plan is the
    drawing with the most wall pixels. Another drawing holding >= 30 % as many (a key-plan inset, a strip of
    site context) is excluded with the warning `plan_region_ambiguous {components}` (the main plan plus
    every such drawing). With no wall pixels at all the region is the whole image and nothing is warned
    (the validator reports `no_walls_detected`).

    Components are also one drawing when the same `ink` component (closed with a `0.005 * long_edge`
    square) touches both: window frames, door leaves and railings join the wall pieces of one plan across
    openings wider than `0.05 * long_edge`, while a drawing beside it (across a corridor, an inset) shares
    no ink with it.
    """
    if bold is not None:
        thick = cv2.bitwise_or(thick, bold)
    h, w = thick.shape[:2]
    long_edge = max(h, w)
    if not thick.any():
        return Rect(0, 0, w, h)
    k = odd(round(CLOSE_FRAC * long_edge))
    closed = cv2.morphologyEx(thick, cv2.MORPH_CLOSE, np.ones((k, k), np.uint8))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(closed, connectivity=8)
    counts = np.bincount(labels[thick > 0].astype(np.intp), minlength=n)
    comps = np.flatnonzero(counts[1:] > 0) + 1
    if comps.size > MAX_COMPONENTS:  # bound the pairwise grouping: the smallest ones cannot be the plan
        comps = comps[np.argsort(-counts[comps], kind="stable")[:MAX_COMPONENTS]]
    x, y = stats[comps, cv2.CC_STAT_LEFT], stats[comps, cv2.CC_STAT_TOP]
    boxes = np.stack(
        [x, y, x + stats[comps, cv2.CC_STAT_WIDTH], y + stats[comps, cv2.CC_STAT_HEIGHT]], axis=1
    )
    group = _groups(boxes.astype(np.int64), NEAR_FRAC * long_edge, _ink_links(labels, comps, thick, ink))
    pixels = np.bincount(group, weights=counts[comps], minlength=len(comps))
    main = int(np.argmax(pixels))
    rivals = int((pixels >= SIBLING_MIN_SHARE * pixels[main]).sum()) - 1
    if rivals:
        ctx.warn("plan_region_ambiguous", {"components": rivals + 1})
    mine = boxes[group == main]
    x0, y0 = int(mine[:, 0].min()), int(mine[:, 1].min())
    x1, y1 = int(mine[:, 2].max()), int(mine[:, 3].max())
    union = Rect(x0, y0, x1 - x0, y1 - y0)
    return union.expand(round(EXPAND_FRAC * union.long_side)).clip(w, h)
