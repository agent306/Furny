/**
 * Hit testing over a `HitIndex` (04 §5.12): `hitTest` for the pointer and
 * `hitTestRect` for marquee selection. See `hitIndex.ts` for the classes and
 * their priority order.
 */
import { distToRing, pointInPolygon, pointInRing } from '../geometry/polygon';
import { closestPointOnSeg } from '../geometry/segment';
import { EPS } from '../geometry/tolerance';
import { dist, rot, type Vec2 } from '../geometry/vec2';
import {
    CLASS_ORDER,
    TOLERANT,
    type BackgroundRect,
    type ClassKey,
    type Entry,
    type Hit,
    type HitIndex,
    type HitLayerMask,
    type Shape,
} from './hitIndex';
import { query } from './snapIndex';
import {
    cmp,
    snapTolerance,
    z,
    type Box,
    type SnapPointerType,
} from './snapShared';

function ringDistance(p: Vec2, pts: Vec2[]): number {
    return pointInRing(p, pts) === 'outside' ? distToRing(p, pts) : 0;
}

/** Distance from `p` to a shape; 0 inside a ring or polygon. */
function shapeDistance(p: Vec2, s: Shape): number {
    switch (s.k) {
        case 'ring':
            return ringDistance(p, s.pts);
        case 'poly':
            return pointInPolygon(p, { outer: s.outer, holes: s.holes }) ===
                'outside'
                ? Math.min(
                      distToRing(p, s.outer),
                      ...s.holes.map((h) => distToRing(p, h)),
                  )
                : 0;
        case 'seg':
            return closestPointOnSeg(p, { a: s.a, b: s.b }).dist;
        case 'point':
            return dist(p, s.p);
    }
}

const entryDistance = (e: Entry, p: Vec2): number =>
    Math.min(...e.shapes.map((s) => shapeDistance(p, s)));

interface Found {
    entry: Entry;
    /** mm */
    d: number;
}

/** Comparison of two hits of one class (best first). */
function compareWithin(cls: ClassKey, a: Found, b: Found, p: Vec2): number {
    const byId = cmp(a.entry.id, b.entry.id);
    switch (cls) {
        case 'body': {
            // Inside hits (distance 0) come first, then by distance. Stacked
            // ones: the higher top, then the more recently added.
            if (a.d !== b.d) return a.d - b.d;
            return b.entry.top - a.entry.top || b.entry.seq - a.entry.seq;
        }
        case 'wall': {
            if (a.d !== b.d) return a.d - b.d;
            const ca = a.entry.centre!;
            const cb = b.entry.centre!;
            return (
                closestPointOnSeg(p, { a: ca[0], b: ca[1] }).dist -
                    closestPointOnSeg(p, { a: cb[0], b: cb[1] }).dist || byId
            );
        }
        case 'room':
            return a.entry.area - b.entry.area || byId;
        default:
            return a.d - b.d || byId;
    }
}

function backgroundHit(bg: BackgroundRect, p: Vec2): boolean {
    const local = rot(
        { x: p.x - bg.center.x, y: p.y - bg.center.y },
        -bg.rotationRad,
    );
    return (
        Math.abs(local.x) <= bg.width / 2 && Math.abs(local.y) <= bg.height / 2
    );
}

/**
 * Entities under `p`, best first (04 §5.12 priority). `zoom` is screen px per
 * mm; the tolerance is 8 px (mouse, pen) or 16 px (touch) converted by it.
 */
export function hitTest(
    index: HitIndex,
    p: Vec2,
    zoom: number,
    pointerType: SnapPointerType,
    layers: HitLayerMask,
): Hit[] {
    if (!(zoom > 0))
        throw new RangeError(`hitTest: zoom must be positive (${zoom})`);
    const tol = snapTolerance(pointerType, zoom);
    const hits: Hit[] = [];
    for (const key of CLASS_ORDER) {
        const reach = TOLERANT.has(key) ? tol : 0;
        const found: Found[] = [];
        // The search box is at least the boundary slack of the inside tests.
        const r = Math.max(reach, EPS);
        for (const e of query(
            index.classes[key],
            p.x - r,
            p.y - r,
            p.x + r,
            p.y + r,
        )) {
            if (layers[e.kind] === false) continue;
            const d = entryDistance(e, p);
            if (d <= reach) found.push({ entry: e, d });
        }
        found.sort((a, b) => compareWithin(key, a, b, p));
        for (const { entry: e, d } of found) {
            hits.push({
                kind: e.kind,
                id: e.id,
                distancePx: z(Math.round(d * zoom * 100) / 100),
            });
        }
    }
    if (
        layers.background === true &&
        index.background &&
        backgroundHit(index.background, p)
    ) {
        hits.push({ kind: 'background', id: 'background', distancePx: 0 });
    }
    return hits;
}

/** Liang-Barsky: does the segment meet the closed rectangle? */
function segMeetsRect(a: Vec2, b: Vec2, min: Vec2, max: Vec2): boolean {
    let t0 = 0;
    let t1 = 1;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const clip = (pq: number, qq: number): boolean => {
        if (pq === 0) return qq >= 0;
        const t = qq / pq;
        if (pq < 0) {
            if (t > t1) return false;
            if (t > t0) t0 = t;
        } else {
            if (t < t0) return false;
            if (t < t1) t1 = t;
        }
        return true;
    };
    return (
        clip(-dx, a.x - min.x) &&
        clip(dx, max.x - a.x) &&
        clip(-dy, a.y - min.y) &&
        clip(dy, max.y - a.y)
    );
}

const inRect = (p: Vec2, min: Vec2, max: Vec2): boolean =>
    p.x >= min.x && p.x <= max.x && p.y >= min.y && p.y <= max.y;

function shapeMeetsRect(s: Shape, min: Vec2, max: Vec2): boolean {
    switch (s.k) {
        case 'point':
            return inRect(s.p, min, max);
        case 'seg':
            return segMeetsRect(s.a, s.b, min, max);
        case 'poly':
        case 'ring': {
            const pts = s.k === 'ring' ? s.pts : s.outer;
            if (pts.some((q) => inRect(q, min, max))) return true;
            if (
                pts.some((q, i) =>
                    segMeetsRect(q, pts[(i + 1) % pts.length]!, min, max),
                )
            ) {
                return true;
            }
            // The rectangle may lie wholly inside the shape.
            return pointInRing(min, pts) !== 'outside';
        }
    }
}

const boxInside = (b: Box, min: Vec2, max: Vec2): boolean =>
    b[0] >= min.x && b[1] >= min.y && b[2] <= max.x && b[3] <= max.y;

/**
 * Ids selected by a marquee rectangle (corners in any order). `window`: the
 * entities whose bounding box lies fully inside, rooms included. `crossing`:
 * every entity whose geometry meets the rectangle (walls by their outline,
 * openings by their cut), rooms excluded. Room labels are not selectable.
 * The result is sorted and unique.
 *
 * Hidden layers are the caller's job (05 §4.10): this function takes no
 * layer mask, so the editor filters the returned ids by what is visible and
 * selectable (hidden furniture, locked background) before selecting them.
 */
export function hitTestRect(
    index: HitIndex,
    min: Vec2,
    max: Vec2,
    mode: 'window' | 'crossing',
): string[] {
    const lo = { x: Math.min(min.x, max.x), y: Math.min(min.y, max.y) };
    const hi = { x: Math.max(min.x, max.x), y: Math.max(min.y, max.y) };
    const ids = new Set<string>();
    for (const key of CLASS_ORDER) {
        if (key === 'room_label') continue;
        if (key === 'room' && mode === 'crossing') continue;
        for (const e of query(index.classes[key], lo.x, lo.y, hi.x, hi.y)) {
            const picked =
                mode === 'window'
                    ? boxInside(e.box, lo, hi)
                    : e.shapes.some((s) => shapeMeetsRect(s, lo, hi));
            if (picked) ids.add(e.id);
        }
    }
    return [...ids].sort(cmp);
}
