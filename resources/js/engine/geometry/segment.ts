/** Segment helpers and segment–segment intersection (04 §2.3–§2.4). */
import { ANGLE_TOL, EPS } from './tolerance';
import {
    add,
    cross,
    dist,
    dot,
    isParallel,
    len,
    lerp,
    scale,
    sub,
    type Vec2,
} from './vec2';

export interface Seg {
    a: Vec2;
    b: Vec2;
}

export function segLength(s: Seg): number {
    return dist(s.a, s.b);
}

/** Parameter `t` of the projection of `p` on `s` (0 at `a`, 1 at `b`), unclamped. Zero-length segments give 0. */
export function projectParam(p: Vec2, s: Seg): number {
    const d = sub(s.b, s.a);
    const l2 = dot(d, d);
    if (l2 === 0) return 0;
    return dot(sub(p, s.a), d) / l2;
}

export function closestPointOnSeg(
    p: Vec2,
    s: Seg,
): { point: Vec2; t: number; dist: number } {
    const t = Math.min(1, Math.max(0, projectParam(p, s)));
    const point = lerp(s.a, s.b, t);
    return { point, t, dist: dist(p, point) };
}

/** Distance from `p` to the infinite line through `a` and `b` (to `a` if they coincide). */
export function distPointLine(p: Vec2, a: Vec2, b: Vec2): number {
    const d = sub(b, a);
    const l = len(d);
    if (l < 1e-12) return dist(p, a);
    return Math.abs(cross(d, sub(p, a))) / l;
}

export type SegIntersection =
    | { kind: 'none' }
    | { kind: 'point'; point: Vec2; t: number; u: number }
    | { kind: 'overlap'; t0: number; t1: number; u0: number; u1: number };

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/**
 * Intersects two segments (04 §2.4). `t` parameterises `s1`, `u` parameterises
 * `s2`. Collinear overlaps report the interval on `s1` (`t0 < t1`) and the
 * matching `s2` parameters. Zero-length segments are treated as points.
 */
export function intersectSegments(
    s1: Seg,
    s2: Seg,
    eps = EPS,
): SegIntersection {
    const r = sub(s1.b, s1.a);
    const s = sub(s2.b, s2.a);
    const l1 = len(r);
    const l2 = len(s);

    if (l1 < 1e-12 || l2 < 1e-12)
        return degenerateIntersection(s1, s2, l1, eps);

    if (isParallel(r, s, ANGLE_TOL)) {
        if (distPointLine(s2.a, s1.a, s1.b) > eps) return { kind: 'none' };
        const pa = projectParam(s2.a, s1);
        const pb = projectParam(s2.b, s1);
        const lo = Math.max(Math.min(pa, pb), 0);
        const hi = Math.min(Math.max(pa, pb), 1);
        if ((hi - lo) * l1 > eps) {
            const p0 = lerp(s1.a, s1.b, lo);
            const p1 = lerp(s1.a, s1.b, hi);
            return {
                kind: 'overlap',
                t0: lo,
                t1: hi,
                u0: projectParam(p0, s2),
                u1: projectParam(p1, s2),
            };
        }
        if ((lo - hi) * l1 <= eps) {
            // Touching end to end: a single point.
            const t = clamp01((lo + hi) / 2);
            const point = lerp(s1.a, s1.b, t);
            return {
                kind: 'point',
                point,
                t,
                u: clamp01(projectParam(point, s2)),
            };
        }
        return { kind: 'none' };
    }

    const denom = cross(r, s);
    const qp = sub(s2.a, s1.a);
    const t = cross(qp, s) / denom;
    const u = cross(qp, r) / denom;
    const et = eps / l1;
    const eu = eps / l2;
    if (t < -et || t > 1 + et || u < -eu || u > 1 + eu) return { kind: 'none' };
    const tc = clamp01(t);
    const uc = clamp01(u);
    return { kind: 'point', point: add(s1.a, scale(r, t)), t: tc, u: uc };
}

/** Intersection when at least one segment has zero length: a point-on-segment test. */
function degenerateIntersection(
    s1: Seg,
    s2: Seg,
    l1: number,
    eps: number,
): SegIntersection {
    if (l1 < 1e-12) {
        const c = closestPointOnSeg(s1.a, s2);
        if (c.dist > eps) return { kind: 'none' };
        return { kind: 'point', point: s1.a, t: 0, u: c.t };
    }
    const c = closestPointOnSeg(s2.a, s1);
    if (c.dist > eps) return { kind: 'none' };
    return { kind: 'point', point: c.point, t: c.t, u: 0 };
}

/**
 * Intersection of the infinite lines `p + t·dp` and `q + u·dq`; `null` when
 * they are parallel within `ANGLE_TOL` (never divides in that case).
 */
export function lineIntersection(
    p: Vec2,
    dp: Vec2,
    q: Vec2,
    dq: Vec2,
): Vec2 | null {
    if (isParallel(dp, dq)) return null;
    const t = cross(sub(q, p), dq) / cross(dp, dq);
    return add(p, scale(dp, t));
}
