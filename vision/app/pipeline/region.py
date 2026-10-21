"""Plan region: the part of the page that holds the floor plan (06 §7.6 step 7)."""

import cv2
import numpy as np

from app.pipeline.context import PipelineContext
from app.utils.geometry import Rect, odd

CLOSE_FRAC = 0.02  # closing kernel, fraction of the long edge
NEAR_FRAC = 0.05  # other components must lie this close to the main one (fraction of the long edge)
SIBLING_MIN_SHARE = 0.30  # ... and hold at least this share of the main component's thick pixels
EXPAND_FRAC = 0.06  # dimension chains live outside the walls


def detect_plan_region(thick: np.ndarray, ink: np.ndarray, ctx: PipelineContext) -> Rect:
    """Union bounding box of the main wall component and its near siblings, grown by 6 % and clipped.

    The main component is the one with the most thick pixels. Another component joins it when it holds
    >= 30 % as many thick pixels and its bbox lies within `0.05 * long_edge` of the main bbox. A
    comparably big component that stays outside (a key-plan inset) is excluded with the warning
    `plan_region_ambiguous {components}` (all components >= 30 %, included or not). With no thick pixels
    at all the region is the whole image and nothing is warned (the validator reports `no_walls_detected`).

    `ink` is part of the stage interface (06 §7.6) and is not needed by this rule.
    """
    del ink
    h, w = thick.shape[:2]
    long_edge = max(h, w)
    if not thick.any():
        return Rect(0, 0, w, h)
    k = odd(round(CLOSE_FRAC * long_edge))
    closed = cv2.morphologyEx(thick, cv2.MORPH_CLOSE, np.ones((k, k), np.uint8))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(closed, connectivity=8)
    counts = np.bincount(labels[thick > 0].astype(np.intp), minlength=n)
    counts[0] = 0  # background
    main = int(np.argmax(counts))
    mx, my, mw, mh = (int(v) for v in stats[main, :4])
    near = NEAR_FRAC * long_edge
    x0, y0, x1, y1 = mx, my, mx + mw, my + mh
    big = 1
    excluded = False
    for i in range(1, n):
        if i == main or counts[i] < SIBLING_MIN_SHARE * counts[main]:
            continue
        big += 1
        cx, cy, cw, ch = (int(v) for v in stats[i, :4])
        gap_x = max(cx - (mx + mw), mx - (cx + cw), 0)
        gap_y = max(cy - (my + mh), my - (cy + ch), 0)
        if max(gap_x, gap_y) <= near:
            x0, y0, x1, y1 = min(x0, cx), min(y0, cy), max(x1, cx + cw), max(y1, cy + ch)
        else:
            excluded = True
    if excluded:
        ctx.warn("plan_region_ambiguous", {"components": big})
    union = Rect(x0, y0, x1 - x0, y1 - y0)
    return union.expand(round(EXPAND_FRAC * union.long_side)).clip(w, h)
