"""Evidence of an opening in a wall's strip, shared by the walls stage (ruling B2's bridges, Task 17's
partition-end doors) and the openings stage (06 §8.5):

- a door swing arc about a jamb (``door_arc``, Task 16c): one thin curve of radius about the gap width;
- window frame lines (``frame_lines``): thin lines parallel to the wall inside the gap's strip, clustered
  across and measured along the gap.
"""

import math
from dataclasses import dataclass

import numpy as np

__all__ = ["FrameLine", "door_arc", "frame_lines", "ink_at"]

ARC_RADIUS = (0.85, 1.15)  # a door swing: a thin arc of radius 0.85 .. 1.15 g about a jamb ...
ARC_STEP_DEG = 1.0  # ... sampled every degree, 3 degrees clear of the closed and the open leaf ...
ARC_EDGE_DEG = 3.0
ARC_COVER = 0.6  # ... with ink on 60 % of its samples inside the region ...
ARC_MIN_DEG = 45.0  # ... and on at least 45 contiguous degrees ...
ARC_MAX_BREAK = 2  # ... (breaks of at most 2 samples)
ARC_RUN_PX = 6  # a stroke crossing a ray: an ink run of at most 6 px ...
ARC_HIT_PX = 2  # ... within 2 px of the arc's radius ...
ARC_CLEAR_PX = 5  # ... with paper 5 px inside and outside it (hatching and tile grids have ink there)
ARC_CENTRE_STEP = 2.0  # hinge offsets tried, up to 0.5 t (+ 2 px) from the jamb point
ARC_TRIES = 3  # best (centre, radius) hypotheses scored


def door_arc(
    ink: np.ndarray, hinge: np.ndarray, toward: np.ndarray, out: np.ndarray, gap: float, t: float
) -> bool:
    """A door swing (Task 16c fix round 2) about ``hinge``, in the quadrant from ``toward`` (the closed
    leaf, across the gap) to ``out`` (the open leaf); ``ink`` is the thin ink (solid wall masks removed,
    so a jamb block cannot merge with the arc).

    Rays every degree (3 degrees clear of either leaf) are read from the hinge out to ``1.15 g``: each
    thin ink run on a ray (at most 6 px) votes for the radius it would have about each hinge offset up to
    ``0.5 t`` (+ 2 px). The best few (offset, radius) votes are scored on their own circle: a sample is
    arc when it has ink within 2 px of the radius and paper 5 px inside and outside (hatching and tile
    grids fail that), and the arc holds when 60 % of the samples inside the region (the ink's extent) are
    arc, on at least 45 contiguous degrees. The cost is O(gap): a fixed number of rays of length O(gap)."""
    ang = np.radians(np.arange(ARC_EDGE_DEG, 90.0 - ARC_EDGE_DEG + 1e-9, ARC_STEP_DEG))
    dirs = np.cos(ang)[:, None] * toward[None, :] + np.sin(ang)[:, None] * out[None, :]
    tol = 0.5 * t + 2.0
    r_min, r_max = ARC_RADIUS[0] * gap, ARC_RADIUS[1] * gap
    rho = np.arange(max(1.0, r_min - tol - ARC_RUN_PX), r_max + tol + ARC_RUN_PX + 1.0)
    on = ink_at(ink, hinge[None, None, :] + dirs[:, None, :] * rho[None, :, None])
    edge = np.diff(np.pad(on, ((0, 0), (1, 1))).astype(np.int8), axis=1)
    r0, c0 = np.nonzero(edge == 1)
    _, c1 = np.nonzero(edge == -1)
    thin = (c1 - c0) <= ARC_RUN_PX
    need = ARC_COVER * ARC_MIN_DEG / ARC_STEP_DEG  # the fewest arc samples an arc can hold with
    if np.count_nonzero(thin) < need:
        return False
    ray = r0[thin]
    pts = dirs[ray] * (rho[0] + (c0[thin] + c1[thin] - 1) / 2.0)[:, None]  # run centres about the hinge
    nb = math.ceil(r_max - r_min) + 1
    # Hinge offsets on a grid (at most 9 x 9), each voting with a window as wide as the grid's error; the
    # best few offsets' voters are then fitted with a circle (a quarter arc leaves the offset along its
    # bisector ambiguous to votes alone).
    step = max(ARC_CENTRE_STEP, tol / 4.0)
    grid = np.arange(-tol, tol + 1e-9, step)
    offs = (grid[:, None, None] * toward + grid[None, :, None] * out).reshape(-1, 2)
    half = ARC_HIT_PX + math.ceil(0.71 * step)
    votes = _arc_votes(pts, ray, len(ang), offs, r_min, nb, half)
    best_bin = votes.argmax(axis=1)
    best = votes[np.arange(len(offs)), best_bin]
    for k in np.argsort(-best, kind="stable")[:ARC_TRIES].tolist():
        if best[k] < need:
            break
        sel = np.abs(np.hypot(*(pts - offs[k]).T) - (r_min + best_bin[k])) <= half
        fit = _fit_circle(pts[sel])
        if fit is None:
            continue
        centre, radius = fit
        if max(abs(float(centre @ toward)), abs(float(centre @ out))) > tol or not r_min <= radius <= r_max:
            continue
        if _arc_holds(ink, hinge + centre, dirs, radius):
            return True
    return False


def _fit_circle(pts: np.ndarray) -> tuple[np.ndarray, float] | None:
    """Algebraic least-squares circle through ``pts``, refitted twice on the points within
    ``ARC_HIT_PX`` of it: centre and radius, or None for fewer than 3 points or a degenerate fit."""
    use = np.ones(len(pts), bool)
    centre, radius = np.zeros(2), 0.0
    for _ in range(3):
        q = pts[use]
        if len(q) < 3:
            return None
        a = np.column_stack([2.0 * q, np.ones(len(q))])
        (cx, cy, c), *_ = np.linalg.lstsq(a, (q * q).sum(axis=1), rcond=None)
        r2 = c + cx * cx + cy * cy
        if r2 <= 0:
            return None
        centre, radius = np.array((cx, cy)), math.sqrt(r2)
        use = np.abs(np.hypot(*(pts - centre).T) - radius) <= ARC_HIT_PX
    return centre, radius


def _arc_votes(
    pts: np.ndarray, ray: np.ndarray, n_rays: int, offs: np.ndarray, r_min: float, nb: int, half: int
) -> np.ndarray:
    """Votes (offsets x radius bins from ``r_min``, 1 px): the rays with a run centre (``pts``, about the
    hinge, on ray ``ray``) within ``half`` px of each radius about each hinge offset."""
    radius = np.hypot(*(pts[None, :, :] - offs[:, None, :]).transpose(2, 0, 1))  # (offsets, runs)
    bins = np.rint(radius - r_min).astype(np.int64)
    ok = (bins >= -half) & (bins < nb + half)
    k_idx, p_idx = np.nonzero(ok)
    width = nb + 2 * half
    key = np.sort((k_idx * width + bins[ok] + half) * n_rays + ray[p_idx])
    key = key[np.concatenate(([True], np.diff(key) != 0))]  # one vote per ray and bin
    hits = np.bincount(key // n_rays, minlength=len(offs) * width).reshape(len(offs), width)
    cum = np.cumsum(np.pad(hits.astype(np.float64), ((0, 0), (1, 0))), axis=1)
    out: np.ndarray = cum[:, 2 * half + 1 :] - cum[:, : -(2 * half + 1)]  # bins b - half .. b + half
    return out


def ink_at(ink: np.ndarray, pts: np.ndarray) -> np.ndarray:
    """Ink at the nearest pixel of each point (False outside the image)."""
    h, w = ink.shape[:2]
    x, y = np.rint(pts[..., 0]).astype(np.intp), np.rint(pts[..., 1]).astype(np.intp)
    inside = (x >= 0) & (x < w) & (y >= 0) & (y < h)
    out = np.zeros(x.shape, bool)
    out[inside] = ink[y[inside], x[inside]] > 0
    return out


def _arc_holds(ink: np.ndarray, centre: np.ndarray, dirs: np.ndarray, radius: float) -> bool:
    """The arc of ``radius`` about ``centre`` along ``dirs``: ink within ``ARC_HIT_PX`` of it and paper
    ``ARC_CLEAR_PX`` inside and outside, on ``ARC_COVER`` of the samples inside the image and on at least
    ``ARC_MIN_DEG`` contiguous degrees (breaks of at most ``ARC_MAX_BREAK`` samples)."""
    h, w = ink.shape[:2]
    at = centre[None, :] + dirs * radius
    inside = (at[:, 0] >= 0) & (at[:, 0] <= w - 1) & (at[:, 1] >= 0) & (at[:, 1] <= h - 1)
    need = ARC_MIN_DEG / ARC_STEP_DEG
    if np.count_nonzero(inside) < need:
        return False
    dr = np.arange(-ARC_HIT_PX, ARC_HIT_PX + 1, dtype=np.float64)
    hit = ink_at(ink, centre[None, None, :] + dirs[:, None, :] * (radius + dr)[None, :, None]).any(axis=1)
    clear = ~ink_at(ink, centre + dirs * (radius - ARC_CLEAR_PX)) & ~ink_at(
        ink, centre + dirs * (radius + ARC_CLEAR_PX)
    )
    arc = hit & clear & inside
    if np.count_nonzero(arc) < ARC_COVER * np.count_nonzero(inside):
        return False
    best = run = gap = 0
    for i in range(len(arc)):
        if arc[i]:
            run += gap + 1
            gap = 0
        elif inside[i] and run and gap < ARC_MAX_BREAK:
            gap += 1
        else:
            run = gap = 0
        best = max(best, run)
    return best >= need


@dataclass(frozen=True, slots=True)
class FrameLine:
    """One line across a gap's strip: thin pieces less than ``cluster_px`` apart across. ``offset`` is its
    length-weighted offset along the wall's normal, ``covered`` the length of ``[g0, g1]`` it covers and
    ``spans`` its covered pieces (along the wall, merged and sorted)."""

    offset: float
    covered: float
    spans: tuple[tuple[float, float], ...]


def frame_lines(
    thin: np.ndarray,
    u: np.ndarray,
    n: np.ndarray,
    g0: float,
    g1: float,
    lo: float,
    hi: float,
    *,
    angle_deg: float = 3.0,
    cluster_px: float = 1.5,
) -> list[FrameLine]:
    """The lines of the thin segments ``thin`` ((k, 4) rows ``x0, y0, x1, y1``) that run along a wall of
    direction ``u`` and normal ``n`` (parallel within ``angle_deg``) over the gap ``[g0, g1]`` (positions
    along ``u``), at offsets (along ``n``, measured at the middle of each piece's stretch over the gap)
    within ``[lo, hi]``; pieces less than ``cluster_px`` apart across are one line. Sorted by offset."""
    if not thin.size or g1 <= g0:
        return []
    p0, p1 = thin[:, :2], thin[:, 2:]
    d = p1 - p0
    length = np.hypot(d[:, 0], d[:, 1])
    ok = np.abs(d @ u) >= np.cos(np.radians(angle_deg)) * np.maximum(length, 1e-9)
    t0, t1 = p0 @ u, p1 @ u
    c0, c1 = np.maximum(np.minimum(t0, t1), g0), np.minimum(np.maximum(t0, t1), g1)
    ok &= c1 > c0
    mid = (c0 + c1) / 2.0
    step = np.where(np.abs(t1 - t0) > 1e-9, t1 - t0, 1.0)
    k = np.where(np.abs(t1 - t0) > 1e-9, (mid - t0) / step, 0.5)
    offs = (p0 + k[:, None] * d) @ n
    ok &= (offs >= lo) & (offs <= hi)
    idx = np.flatnonzero(ok)
    if not idx.size:
        return []
    order = idx[np.argsort(offs[idx], kind="stable")]
    clusters: list[list[int]] = []
    for m in order.tolist():
        if clusters and offs[m] - offs[clusters[-1][-1]] <= cluster_px:
            clusters[-1].append(m)
        else:
            clusters.append([m])
    out = []
    for cl in clusters:
        merged: list[tuple[float, float]] = []
        for x0, x1 in sorted((float(c0[m]), float(c1[m])) for m in cl):
            if merged and x0 <= merged[-1][1]:
                merged[-1] = (merged[-1][0], max(merged[-1][1], x1))
            else:
                merged.append((x0, x1))
        w = np.array([float(c1[m] - c0[m]) for m in cl])
        out.append(
            FrameLine(float(np.average(offs[cl], weights=w)), sum(b - a for a, b in merged), tuple(merged))
        )
    return out
