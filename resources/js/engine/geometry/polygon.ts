/** Ring and polygon-with-holes helpers (04 §2.5). Rings are not closed. */
import { closestPointOnSeg, distPointLine } from './segment';
import { ANGLE_TOL, EPS } from './tolerance';
import { dist, dot, normalize, sub, type Vec2 } from './vec2';

/** Not closed: the first point is not repeated. */
export type Ring = Vec2[];

export interface PolygonWithHoles {
    outer: Ring;
    holes: Ring[];
}

/**
 * `½ Σ (x_i·y_{i+1} − x_{i+1}·y_i)`. In y-down plan space a ring that is
 * clockwise on screen has positive area (04 §2.1-6).
 */
export function signedArea(r: Ring): number {
    let sum = 0;
    for (let i = 0; i < r.length; i++) {
        const p = r[i]!;
        const q = r[(i + 1) % r.length]!;
        sum += p.x * q.y - q.x * p.y;
    }
    return sum / 2;
}

/** `|outer| − Σ|holes|`, independent of ring orientation. */
export function area(p: PolygonWithHoles): number {
    let a = Math.abs(signedArea(p.outer));
    for (const h of p.holes) a -= Math.abs(signedArea(h));
    return a;
}

export function perimeter(r: Ring): number {
    let sum = 0;
    for (let i = 0; i < r.length; i++) {
        sum += dist(r[i]!, r[(i + 1) % r.length]!);
    }
    return sum;
}

function vertexAverage(r: Ring): Vec2 {
    if (r.length === 0) return { x: 0, y: 0 };
    let x = 0;
    let y = 0;
    for (const p of r) {
        x += p.x;
        y += p.y;
    }
    return { x: x / r.length, y: y / r.length };
}

/** Area-weighted centroid of one ring and its absolute area. */
function ringCentroid(r: Ring): { c: Vec2; a: number } {
    let a2 = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < r.length; i++) {
        const p = r[i]!;
        const q = r[(i + 1) % r.length]!;
        const w = p.x * q.y - q.x * p.y;
        a2 += w;
        cx += (p.x + q.x) * w;
        cy += (p.y + q.y) * w;
    }
    if (a2 === 0) return { c: vertexAverage(r), a: 0 };
    return { c: { x: cx / (3 * a2), y: cy / (3 * a2) }, a: Math.abs(a2 / 2) };
}

/** Area-weighted centroid (holes subtract); the vertex average of the outer ring when `|area| < 1`. */
export function polygonCentroid(p: PolygonWithHoles): Vec2 {
    if (Math.abs(area(p)) < 1) return vertexAverage(p.outer);
    const outer = ringCentroid(p.outer);
    let a = outer.a;
    let x = outer.c.x * outer.a;
    let y = outer.c.y * outer.a;
    for (const h of p.holes) {
        const hc = ringCentroid(h);
        a -= hc.a;
        x -= hc.c.x * hc.a;
        y -= hc.c.y * hc.a;
    }
    return { x: x / a, y: y / a };
}

/** Distance from `pt` to the nearest edge (closing edge included); `Infinity` for an empty ring. */
export function distToRing(pt: Vec2, r: Ring): number {
    let best = Infinity;
    for (let i = 0; i < r.length; i++) {
        const d = closestPointOnSeg(pt, {
            a: r[i]!,
            b: r[(i + 1) % r.length]!,
        }).dist;
        if (d < best) best = d;
    }
    return best;
}

/** Boundary check (`distToRing ≤ eps`), then even–odd ray cast toward +x. */
export function pointInRing(
    pt: Vec2,
    r: Ring,
    eps = EPS,
): 'inside' | 'outside' | 'boundary' {
    if (distToRing(pt, r) <= eps) return 'boundary';
    let inside = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const pi = r[i]!;
        const pj = r[j]!;
        if (
            pi.y > pt.y !== pj.y > pt.y &&
            pt.x < ((pj.x - pi.x) * (pt.y - pi.y)) / (pj.y - pi.y) + pi.x
        ) {
            inside = !inside;
        }
    }
    return inside ? 'inside' : 'outside';
}

/** Like `pointInRing` for the outer ring, with holes counting as outside and hole edges as boundary. */
export function pointInPolygon(
    pt: Vec2,
    p: PolygonWithHoles,
    eps = EPS,
): 'inside' | 'outside' | 'boundary' {
    const inOuter = pointInRing(pt, p.outer, eps);
    if (inOuter !== 'inside') return inOuter;
    for (const h of p.holes) {
        const inHole = pointInRing(pt, h, eps);
        if (inHole === 'boundary') return 'boundary';
        if (inHole === 'inside') return 'outside';
    }
    return 'inside';
}

/** Returns a clockwise-on-screen copy (positive signed area). */
export function ensureCW(r: Ring): Ring {
    return signedArea(r) < 0 ? [...r].reverse() : [...r];
}

/** Returns a counter-clockwise-on-screen copy (negative signed area). */
export function ensureCCW(r: Ring): Ring {
    return signedArea(r) > 0 ? [...r].reverse() : [...r];
}

/**
 * Removes duplicate vertices and vertices within `eps` of the line through
 * their neighbours, repeating until stable. May return fewer than 3 points
 * for a degenerate ring.
 */
export function simplifyCollinear(r: Ring, eps = EPS): Ring {
    const pts: Ring = [];
    for (const p of r) {
        const last = pts[pts.length - 1];
        if (!last || dist(last, p) > eps) pts.push(p);
    }
    while (pts.length > 1 && dist(pts[0]!, pts[pts.length - 1]!) <= eps) {
        pts.pop();
    }
    let i = 0;
    let sinceChange = 0;
    while (pts.length >= 3 && sinceChange < pts.length) {
        const n = pts.length;
        const prev = pts[(i - 1 + n) % n]!;
        const next = pts[(i + 1) % n]!;
        if (distPointLine(pts[i]!, prev, next) <= eps) {
            pts.splice(i, 1);
            if (i >= pts.length) i = 0;
            sinceChange = 0;
        } else {
            i = (i + 1) % n;
            sinceChange++;
        }
    }
    return pts;
}

/** Axis-aligned bounding box; `±Infinity` for an empty ring. */
export function ringBBox(r: Ring): { min: Vec2; max: Vec2 } {
    const min = { x: Infinity, y: Infinity };
    const max = { x: -Infinity, y: -Infinity };
    for (const p of r) {
        if (p.x < min.x) min.x = p.x;
        if (p.y < min.y) min.y = p.y;
        if (p.x > max.x) max.x = p.x;
        if (p.y > max.y) max.y = p.y;
    }
    return { min, max };
}

/** Distance to the nearest outer or hole edge; positive inside (and on the boundary), negative outside. */
export function signedDistToPolygon(pt: Vec2, p: PolygonWithHoles): number {
    let d = distToRing(pt, p.outer);
    for (const h of p.holes) d = Math.min(d, distToRing(pt, h));
    return pointInPolygon(pt, p) === 'outside' ? -d : d;
}

/**
 * Recognises a rectangle whose sides are aligned to the x/y axes within
 * `angleTol` (radians): 4 vertices after `simplifyCollinear`, all corners
 * 90° ± tol. `width` is the length of the edge closest to the x axis, `depth`
 * the other one; `angle` is that edge's direction in radians folded into
 * `(−π/2, π/2]` (so `|angle| ≤ angleTol` for any accepted rectangle). Rotated
 * rectangles (e.g. a 45° square) return `null`.
 */
export function isAxisRectangle(
    r: Ring,
    angleTol = ANGLE_TOL,
): { width: number; depth: number; angle: number } | null {
    const p = simplifyCollinear(r);
    if (p.length !== 4) return null;
    const edges = p.map((q, i) => sub(p[(i + 1) % 4]!, q));
    const sinTol = Math.sin(angleTol);
    for (let i = 0; i < 4; i++) {
        const e1 = normalize(edges[i]!);
        const e2 = normalize(edges[(i + 1) % 4]!);
        if (Math.abs(dot(e1, e2)) > sinTol) return null;
    }
    // Direction of each edge folded into (−π/2, π/2]; pick the one nearest the x axis.
    let best = 0;
    let bestAngle = Infinity;
    for (let i = 0; i < 4; i++) {
        const e = edges[i]!;
        let a = Math.atan2(e.y, e.x);
        if (a > Math.PI / 2) a -= Math.PI;
        else if (a <= -Math.PI / 2) a += Math.PI;
        if (Math.abs(a) < Math.abs(bestAngle)) {
            best = i;
            bestAngle = a;
        }
    }
    if (Math.abs(bestAngle) > angleTol) return null;
    return {
        width: Math.hypot(edges[best]!.x, edges[best]!.y),
        depth: Math.hypot(edges[(best + 1) % 4]!.x, edges[(best + 1) % 4]!.y),
        angle: bestAngle === 0 ? 0 : bestAngle,
    };
}
