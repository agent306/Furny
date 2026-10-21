import { describe, expect, it } from 'vitest';
import { ANGLE_TOL, EPS } from '../tolerance';
import {
    add,
    angleOf,
    cross,
    dist,
    dist2,
    dot,
    frontVector,
    isParallel,
    len,
    lerp,
    nearlyEqual,
    normalize,
    normDeg,
    orient,
    perpLeft,
    rot,
    rotationFromFront,
    roundPoint,
    scale,
    sideOf,
    sub,
    v,
} from '../vec2';

describe('vec2 basics', () => {
    it('builds and combines vectors without mutating inputs', () => {
        const a = v(1, 2);
        const b = v(3, -4);
        expect(add(a, b)).toEqual({ x: 4, y: -2 });
        expect(sub(a, b)).toEqual({ x: -2, y: 6 });
        expect(scale(a, 3)).toEqual({ x: 3, y: 6 });
        expect(a).toEqual({ x: 1, y: 2 });
        expect(b).toEqual({ x: 3, y: -4 });
    });

    it('computes dot, cross, lengths and distances', () => {
        expect(dot(v(1, 2), v(3, 4))).toBe(11);
        expect(cross(v(1, 0), v(0, 1))).toBe(1);
        expect(cross(v(0, 1), v(1, 0))).toBe(-1);
        expect(len(v(3, 4))).toBe(5);
        expect(dist(v(0, 0), v(3, 4))).toBe(5);
        expect(dist2(v(0, 0), v(3, 4))).toBe(25);
    });

    it('normalizes, returning (0,0) for a zero vector', () => {
        expect(normalize(v(0, 0))).toEqual({ x: 0, y: 0 });
        expect(normalize(v(1e-13, 0))).toEqual({ x: 0, y: 0 });
        const n = normalize(v(3, 4));
        expect(n.x).toBeCloseTo(0.6);
        expect(n.y).toBeCloseTo(0.8);
    });

    it('perpLeft is the +normal of 04 2.1 (y-down plan space)', () => {
        expect(perpLeft(v(1, 0))).toEqual({ x: 0, y: -1 });
        const down = perpLeft(v(0, 1));
        expect(down.x).toBe(1);
        expect(down.y).toBeCloseTo(0);
    });

    it('rot turns clockwise on screen', () => {
        const r = rot(v(1, 0), Math.PI / 2);
        expect(r.x).toBeCloseTo(0);
        expect(r.y).toBeCloseTo(1);
    });

    it('lerps and measures angles', () => {
        expect(lerp(v(0, 0), v(10, 20), 0.25)).toEqual({ x: 2.5, y: 5 });
        expect(angleOf(v(0, 1))).toBeCloseTo(Math.PI / 2);
        expect(angleOf(v(-1, 0))).toBeCloseTo(Math.PI);
    });

    it('nearlyEqual uses EPS by default', () => {
        expect(nearlyEqual(v(0, 0), v(0.3, 0.3))).toBe(true);
        expect(nearlyEqual(v(0, 0), v(EPS + 0.1, 0))).toBe(false);
        expect(nearlyEqual(v(0, 0), v(5, 0), 6)).toBe(true);
    });

    it('roundPoint rounds half away from zero', () => {
        expect(roundPoint(v(2.5, -2.5))).toEqual({ x: 3, y: -3 });
        expect(roundPoint(v(1.4, -1.4))).toEqual({ x: 1, y: -1 });
    });
});

describe('normDeg', () => {
    it('normalises into [0, 360)', () => {
        expect(normDeg(-90)).toBe(270);
        expect(normDeg(720)).toBe(0);
        expect(normDeg(0)).toBe(0);
        expect(normDeg(359.5)).toBe(359.5);
        expect(normDeg(360)).toBe(0);
    });
});

describe('isParallel', () => {
    it('treats opposite and near-parallel directions as parallel', () => {
        expect(isParallel(v(1, 0), v(-5, 0))).toBe(true);
        expect(isParallel(v(1, 0), v(1, 0.004))).toBe(true); // ~0.23 deg
        expect(isParallel(v(1, 0), v(1, 0.02))).toBe(false); // ~1.15 deg
        expect(isParallel(v(1, 0), v(0, 1))).toBe(false);
    });

    it('honours a custom tolerance', () => {
        expect(isParallel(v(1, 0), v(1, 0.02), 0.03)).toBe(true);
        expect(ANGLE_TOL).toBeGreaterThan(0);
    });
});

describe('orient / sideOf (04 2.1-5)', () => {
    it('orient is negative for a point on the left in y-down space', () => {
        expect(orient(v(0, 0), v(1000, 0), v(500, -10))).toBeLessThan(0);
        expect(orient(v(0, 0), v(1000, 0), v(500, 10))).toBeGreaterThan(0);
        expect(orient(v(0, 0), v(1000, 0), v(500, 0))).toBe(0);
    });

    it('sideOf returns +1 left, -1 right, 0 within EPS of the line', () => {
        expect(sideOf(v(0, 0), v(1000, 0), v(500, -10))).toBe(1);
        expect(sideOf(v(0, 0), v(1000, 0), v(500, 10))).toBe(-1);
        expect(sideOf(v(0, 0), v(1000, 0), v(500, 0.3))).toBe(0);
        expect(sideOf(v(0, 0), v(1000, 0), v(2000, 0))).toBe(0);
    });

    it('sideOf is 0 for a degenerate line only when c coincides with it', () => {
        expect(sideOf(v(5, 5), v(5, 5), v(5, 5.2))).toBe(0);
    });
});

describe('frontVector / rotationFromFront (04 2.1-9)', () => {
    it('matches the acceptance values', () => {
        expect(frontVector(0)).toEqual(
            expect.objectContaining({
                x: expect.closeTo(0),
                y: expect.closeTo(1),
            }),
        );
        expect(frontVector(90).x).toBeCloseTo(-1);
        expect(frontVector(90).y).toBeCloseTo(0);
        expect(frontVector(180).y).toBeCloseTo(-1);
        expect(frontVector(270).x).toBeCloseTo(1);
        expect(rotationFromFront(v(1, 0))).toBe(270);
    });

    it('is exact at quarter turns', () => {
        expect(frontVector(0)).toEqual({ x: 0, y: 1 });
        expect(frontVector(90)).toEqual({ x: -1, y: 0 });
        expect(frontVector(180)).toEqual({ x: 0, y: -1 });
        expect(frontVector(270)).toEqual({ x: 1, y: 0 });
        expect(frontVector(360)).toEqual({ x: 0, y: 1 });
        expect(frontVector(-90)).toEqual({ x: 1, y: 0 });
    });

    it('rotationFromFront inverts frontVector for 0..359', () => {
        for (let d = 0; d < 360; d++) {
            const back = rotationFromFront(frontVector(d));
            const diff = Math.abs(((back - d + 540) % 360) - 180);
            expect(diff).toBeLessThan(1e-9);
            expect(back).toBeGreaterThanOrEqual(0);
            expect(back).toBeLessThan(360);
        }
    });
});
