/**
 * 2D vector helpers (04 §2.2). Plan space is x right, y down, units mm; see
 * 04 §2.1 for the orientation and normal conventions these functions encode.
 * All functions are pure and never mutate their arguments.
 */
import { ANGLE_TOL, EPS, roundMm } from './tolerance';

export interface Vec2 {
    x: number;
    y: number;
}

export const v = (x: number, y: number): Vec2 => ({ x, y });

export function add(a: Vec2, b: Vec2): Vec2 {
    return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Vec2, b: Vec2): Vec2 {
    return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(a: Vec2, k: number): Vec2 {
    return { x: a.x * k, y: a.y * k };
}

export function dot(a: Vec2, b: Vec2): number {
    return a.x * b.x + a.y * b.y;
}

/** `a.x*b.y − a.y*b.x`. */
export function cross(a: Vec2, b: Vec2): number {
    return a.x * b.y - a.y * b.x;
}

export function len(a: Vec2): number {
    return Math.sqrt(a.x * a.x + a.y * a.y);
}

export function dist(a: Vec2, b: Vec2): number {
    return len(sub(a, b));
}

export function dist2(a: Vec2, b: Vec2): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
}

/** Unit vector, or (0,0) for |a| < 1e-12. */
export function normalize(a: Vec2): Vec2 {
    const l = len(a);
    if (l < 1e-12) return { x: 0, y: 0 };
    return { x: a.x / l, y: a.y / l };
}

/** `(d.y, −d.x)`: the +normal (left side when walking along `d`) of 04 §2.1. */
export function perpLeft(d: Vec2): Vec2 {
    return { x: d.y, y: -d.x };
}

/** Rotates clockwise on screen by `rad` (04 §2.1-8). */
export function rot(a: Vec2, rad: number): Vec2 {
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
}

export function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** `atan2(y, x)` in `(−π, π]`; increasing angle is clockwise on screen. */
export function angleOf(a: Vec2): number {
    return Math.atan2(a.y, a.x);
}

export function nearlyEqual(a: Vec2, b: Vec2, eps = EPS): boolean {
    return dist(a, b) <= eps;
}

/** Rounds both coordinates with `roundMm` (half away from zero). */
export function roundPoint(a: Vec2): Vec2 {
    return { x: roundMm(a.x), y: roundMm(a.y) };
}

/** Normalises degrees into `[0, 360)` (04 §0.2-3). */
export function normDeg(d: number): number {
    return ((d % 360) + 360) % 360;
}

/** Parallel (or anti-parallel) within `tol` radians: `|cross(n1,n2)| ≤ sin(tol)`. */
export function isParallel(d1: Vec2, d2: Vec2, tol = ANGLE_TOL): boolean {
    return Math.abs(cross(normalize(d1), normalize(d2))) <= Math.sin(tol);
}

/**
 * `(b−a) × (c−a)`. In y-down space a negative value means `c` is on the left
 * (+normal) of `a→b`, a positive one means right (04 §2.1-5).
 */
export function orient(a: Vec2, b: Vec2, c: Vec2): number {
    return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/**
 * Side of `c` relative to the line `a→b`: `+1` left, `−1` right, `0` when `c`
 * is within `EPS` of the line (04 §2.1-5).
 */
export function sideOf(a: Vec2, b: Vec2, c: Vec2): -1 | 0 | 1 {
    const ab = sub(b, a);
    const l = len(ab);
    const o = orient(a, b, c);
    const distance = l < 1e-12 ? dist(a, c) : Math.abs(o) / l;
    if (distance <= EPS) return 0;
    return o < 0 ? 1 : -1;
}

/**
 * Front vector of a placement/fixture rotated `deg` clockwise: `(−sin θ, cos θ)`
 * (04 §2.1-9). Exact at quarter turns (0/90/180/270), so axis-aligned
 * footprints carry no trigonometric noise.
 */
export function frontVector(deg: number): Vec2 {
    const d = normDeg(deg);
    if (d === 0) return { x: 0, y: 1 };
    if (d === 90) return { x: -1, y: 0 };
    if (d === 180) return { x: 0, y: -1 };
    if (d === 270) return { x: 1, y: 0 };
    return rot({ x: 0, y: 1 }, (deg * Math.PI) / 180);
}

/** Inverse of `frontVector`, in degrees `[0, 360)`. */
export function rotationFromFront(f: Vec2): number {
    return normDeg((Math.atan2(-f.x, f.y) * 180) / Math.PI);
}
