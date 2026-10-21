import { describe, expect, it } from 'vitest';
import {
    closestPointOnSeg,
    distPointLine,
    intersectSegments,
    lineIntersection,
    projectParam,
    segLength,
} from '../segment';
import { v } from '../vec2';

const seg = (ax: number, ay: number, bx: number, by: number) => ({
    a: v(ax, ay),
    b: v(bx, by),
});

describe('segment helpers', () => {
    it('measures length and projects unclamped', () => {
        const s = seg(0, 0, 100, 0);
        expect(segLength(s)).toBe(100);
        expect(projectParam(v(25, 40), s)).toBe(0.25);
        expect(projectParam(v(-50, 0), s)).toBe(-0.5);
        expect(projectParam(v(150, 0), s)).toBe(1.5);
        expect(projectParam(v(1, 1), seg(2, 2, 2, 2))).toBe(0);
    });

    it('finds the closest point, clamped to the segment', () => {
        const s = seg(0, 0, 100, 0);
        const mid = closestPointOnSeg(v(30, 40), s);
        expect(mid.point).toEqual({ x: 30, y: 0 });
        expect(mid.t).toBeCloseTo(0.3);
        expect(mid.dist).toBe(40);
        const before = closestPointOnSeg(v(-30, 40), s);
        expect(before.point).toEqual({ x: 0, y: 0 });
        expect(before.t).toBe(0);
        expect(before.dist).toBe(50);
        const after = closestPointOnSeg(v(130, 40), s);
        expect(after.t).toBe(1);
        expect(after.dist).toBe(50);
        expect(closestPointOnSeg(v(3, 4), seg(0, 0, 0, 0)).dist).toBe(5);
    });

    it('measures distance to an infinite line', () => {
        expect(distPointLine(v(500, 7), v(0, 0), v(100, 0))).toBe(7);
        expect(distPointLine(v(3, 4), v(0, 0), v(0, 0))).toBe(5);
    });
});

describe('intersectSegments (04 2.4)', () => {
    it('reports a perpendicular crossing as a point', () => {
        const r = intersectSegments(seg(0, 0, 100, 0), seg(50, -50, 50, 50));
        expect(r.kind).toBe('point');
        if (r.kind !== 'point') return;
        expect(r.point.x).toBeCloseTo(50);
        expect(r.point.y).toBeCloseTo(0);
        expect(r.t).toBeCloseTo(0.5);
        expect(r.u).toBeCloseTo(0.5);
    });

    it('reports a collinear overlap within EPS', () => {
        const r = intersectSegments(seg(0, 0, 100, 0), seg(50, 0.3, 150, 0.3));
        expect(r.kind).toBe('overlap');
        if (r.kind !== 'overlap') return;
        expect(r.t0).toBeCloseTo(0.5);
        expect(r.t1).toBeCloseTo(1);
        expect(r.u0).toBeCloseTo(0);
        expect(r.u1).toBeCloseTo(0.5);
    });

    it('returns none for parallel lines 1 mm apart', () => {
        expect(
            intersectSegments(seg(0, 0, 100, 0), seg(0, 1, 100, 1)).kind,
        ).toBe('none');
    });

    it('returns none for collinear but disjoint segments', () => {
        expect(
            intersectSegments(seg(0, 0, 100, 0), seg(200, 0, 300, 0)).kind,
        ).toBe('none');
    });

    it('returns a point when collinear segments touch end to end', () => {
        const r = intersectSegments(seg(0, 0, 100, 0), seg(100, 0, 200, 0));
        expect(r.kind).toBe('point');
        if (r.kind !== 'point') return;
        expect(r.point.x).toBeCloseTo(100);
        expect(r.t).toBeCloseTo(1);
        expect(r.u).toBeCloseTo(0);
    });

    it('matches opposite-direction overlaps with the right s2 params', () => {
        const r = intersectSegments(seg(0, 0, 100, 0), seg(150, 0, 50, 0));
        expect(r.kind).toBe('overlap');
        if (r.kind !== 'overlap') return;
        expect(r.t0).toBeCloseTo(0.5);
        expect(r.t1).toBeCloseTo(1);
        expect(r.u0).toBeCloseTo(1);
        expect(r.u1).toBeCloseTo(0.5);
    });

    it('accepts a T-junction landing within EPS of an end and clamps params', () => {
        const r = intersectSegments(
            seg(0, 0, 100, 0),
            seg(100.3, -50, 100.3, 50),
        );
        expect(r.kind).toBe('point');
        if (r.kind !== 'point') return;
        expect(r.t).toBe(1);
        expect(r.u).toBeCloseTo(0.5);
    });

    it('returns none for crossing lines whose segments do not meet', () => {
        expect(
            intersectSegments(seg(0, 0, 100, 0), seg(150, -50, 150, 50)).kind,
        ).toBe('none');
        expect(
            intersectSegments(seg(0, 0, 100, 0), seg(50, 5, 50, 50)).kind,
        ).toBe('none');
    });

    it('handles oblique crossings', () => {
        const r = intersectSegments(seg(0, 0, 100, 100), seg(0, 100, 100, 0));
        expect(r.kind).toBe('point');
        if (r.kind !== 'point') return;
        expect(r.point.x).toBeCloseTo(50);
        expect(r.point.y).toBeCloseTo(50);
    });

    it('never divides by zero on degenerate segments', () => {
        const onSeg = intersectSegments(seg(50, 0, 50, 0), seg(0, 0, 100, 0));
        expect(onSeg.kind).toBe('point');
        expect(
            intersectSegments(seg(50, 5, 50, 5), seg(0, 0, 100, 0)).kind,
        ).toBe('none');
        const rev = intersectSegments(seg(0, 0, 100, 0), seg(50, 0, 50, 0));
        expect(rev.kind).toBe('point');
        if (rev.kind !== 'point') return;
        expect(rev.t).toBeCloseTo(0.5);
        expect(intersectSegments(seg(1, 1, 1, 1), seg(1, 1, 1, 1)).kind).toBe(
            'point',
        );
    });
});

describe('lineIntersection', () => {
    it('intersects two lines', () => {
        const p = lineIntersection(v(0, 0), v(1, 0), v(5, -3), v(0, 2));
        expect(p).not.toBeNull();
        expect(p?.x).toBeCloseTo(5);
        expect(p?.y).toBeCloseTo(0);
    });

    it('returns null for parallel and near-parallel lines', () => {
        expect(lineIntersection(v(0, 0), v(1, 0), v(0, 5), v(2, 0))).toBeNull();
        expect(
            lineIntersection(v(0, 0), v(1000, 0), v(0, 5), v(1000, 2)),
        ).toBeNull();
    });
});
