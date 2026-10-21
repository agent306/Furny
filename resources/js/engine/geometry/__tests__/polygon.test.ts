import { describe, expect, it } from 'vitest';
import {
    area,
    distToRing,
    ensureCCW,
    ensureCW,
    isAxisRectangle,
    perimeter,
    pointInPolygon,
    pointInRing,
    polygonCentroid,
    ringBBox,
    signedArea,
    signedDistToPolygon,
    simplifyCollinear,
    type PolygonWithHoles,
    type Ring,
} from '../polygon';
import { v } from '../vec2';

/** Clockwise on screen (positive signed area in y-down space). */
const rectCW = (w: number, h: number, x = 0, y = 0): Ring => [
    v(x, y),
    v(x + w, y),
    v(x + w, y + h),
    v(x, y + h),
];

const square10 = rectCW(10, 10);
const holeCCW: Ring = [...rectCW(2, 2, 4, 4)].reverse();

describe('signedArea / area / perimeter', () => {
    it('has positive signed area for a clockwise-on-screen ring', () => {
        expect(signedArea([v(0, 0), v(10, 0), v(10, 10), v(0, 10)])).toBe(100);
        expect(signedArea([...square10].reverse())).toBe(-100);
    });

    it('is 0 for degenerate rings', () => {
        expect(signedArea([])).toBe(0);
        expect(signedArea([v(0, 0), v(5, 5)])).toBe(0);
    });

    it('subtracts holes from the area, ignoring ring orientation', () => {
        expect(area({ outer: square10, holes: [holeCCW] })).toBe(96);
        expect(area({ outer: [...square10].reverse(), holes: [] })).toBe(100);
    });

    it('sums edge lengths including the closing edge', () => {
        expect(perimeter(square10)).toBe(40);
        expect(perimeter([])).toBe(0);
    });
});

describe('polygonCentroid', () => {
    it('is the centre of a rectangle', () => {
        const c = polygonCentroid({ outer: rectCW(40, 20, 10, 10), holes: [] });
        expect(c.x).toBeCloseTo(30);
        expect(c.y).toBeCloseTo(20);
    });

    it('is (5,5) for a 10x10 square with a centred 2x2 hole', () => {
        const c = polygonCentroid({ outer: square10, holes: [holeCCW] });
        expect(c.x).toBeCloseTo(5);
        expect(c.y).toBeCloseTo(5);
    });

    it('shifts away from an off-centre hole', () => {
        const hole: Ring = [...rectCW(2, 2, 1, 4)].reverse();
        const c = polygonCentroid({ outer: square10, holes: [hole] });
        expect(c.x).toBeGreaterThan(5);
        expect(c.y).toBeCloseTo(5);
    });

    it('is orientation independent', () => {
        const c = polygonCentroid({
            outer: [...rectCW(40, 20, 10, 10)].reverse(),
            holes: [],
        });
        expect(c.x).toBeCloseTo(30);
        expect(c.y).toBeCloseTo(20);
    });

    it('falls back to the vertex average for |area| < 1', () => {
        const c = polygonCentroid({
            outer: [v(0, 0), v(10, 0), v(20, 0)],
            holes: [],
        });
        expect(c).toEqual({ x: 10, y: 0 });
        expect(polygonCentroid({ outer: [], holes: [] })).toEqual({
            x: 0,
            y: 0,
        });
    });
});

describe('pointInRing / pointInPolygon', () => {
    it('classifies inside, outside and boundary', () => {
        expect(pointInRing(v(5, 5), square10)).toBe('inside');
        expect(pointInRing(v(15, 5), square10)).toBe('outside');
        expect(pointInRing(v(-5, 5), square10)).toBe('outside');
        expect(pointInRing(v(5, 15), square10)).toBe('outside');
        expect(pointInRing(v(0, 0), square10)).toBe('boundary');
        expect(pointInRing(v(10, 5), square10)).toBe('boundary');
    });

    it('reports boundary for a point 0.3 mm off an edge', () => {
        const r = rectCW(1000, 1000);
        expect(pointInRing(v(500, -0.3), r)).toBe('boundary');
        expect(pointInRing(v(500, 0.3), r)).toBe('boundary');
        expect(pointInRing(v(500, 1.0), r)).toBe('inside');
        expect(pointInRing(v(500, -1.0), r)).toBe('outside');
    });

    it('works for either orientation and concave rings', () => {
        const ell: Ring = [
            v(0, 0),
            v(100, 0),
            v(100, 40),
            v(40, 40),
            v(40, 100),
            v(0, 100),
        ];
        expect(pointInRing(v(20, 80), ell)).toBe('inside');
        expect(pointInRing(v(80, 80), ell)).toBe('outside');
        expect(pointInRing(v(20, 80), [...ell].reverse())).toBe('inside');
    });

    it('ignores edges whose ray crossing is at a vertex consistently', () => {
        const diamond: Ring = [v(50, 0), v(100, 50), v(50, 100), v(0, 50)];
        expect(pointInRing(v(25, 50), diamond)).toBe('inside');
        expect(pointInRing(v(-25, 50), diamond)).toBe('outside');
        expect(pointInRing(v(120, 50), diamond)).toBe('outside');
    });

    it('treats holes as outside and hole edges as boundary', () => {
        const p: PolygonWithHoles = { outer: square10, holes: [holeCCW] };
        expect(pointInPolygon(v(1, 1), p)).toBe('inside');
        expect(pointInPolygon(v(5, 5), p)).toBe('outside');
        expect(pointInPolygon(v(4, 5), p)).toBe('boundary');
        expect(pointInPolygon(v(0, 5), p)).toBe('boundary');
        expect(pointInPolygon(v(20, 5), p)).toBe('outside');
    });

    it('treats empty rings as outside', () => {
        expect(pointInRing(v(0, 0), [])).toBe('outside');
    });
});

describe('ensureCW / ensureCCW', () => {
    it('reverses a CCW ring and leaves a CW ring unchanged', () => {
        const ccw = [...square10].reverse();
        const cw = ensureCW(ccw);
        expect(signedArea(cw)).toBe(100);
        expect(cw).toEqual(square10);
        expect(ccw).toEqual([...square10].reverse());
        expect(ensureCW(square10)).toEqual(square10);
    });

    it('ensureCCW produces negative signed area', () => {
        expect(signedArea(ensureCCW(square10))).toBe(-100);
        expect(ensureCCW(holeCCW)).toEqual(holeCCW);
    });
});

describe('simplifyCollinear', () => {
    it('removes a vertex 0.3 mm off the line', () => {
        const r: Ring = [
            v(0, 0),
            v(500, 0.3),
            v(1000, 0),
            v(1000, 1000),
            v(0, 1000),
        ];
        expect(simplifyCollinear(r)).toEqual(rectCW(1000, 1000));
    });

    it('keeps a vertex 2 mm off the line', () => {
        const r: Ring = [
            v(0, 0),
            v(500, 2),
            v(1000, 0),
            v(1000, 1000),
            v(0, 1000),
        ];
        expect(simplifyCollinear(r)).toHaveLength(5);
    });

    it('removes duplicate vertices including a wrap-around duplicate', () => {
        const r: Ring = [
            v(0, 0),
            v(0, 0),
            v(10, 0),
            v(10, 10),
            v(0, 10),
            v(0, 0.2),
        ];
        expect(simplifyCollinear(r)).toEqual(rectCW(10, 10));
    });

    it('removes a run of collinear vertices and the wrap-around vertex', () => {
        const r: Ring = [
            v(500, 0),
            v(1000, 0),
            v(1000, 500),
            v(1000, 1000),
            v(0, 1000),
            v(0, 0),
            v(250, 0),
        ];
        expect(simplifyCollinear(r)).toEqual([
            v(1000, 0),
            v(1000, 1000),
            v(0, 1000),
            v(0, 0),
        ]);
    });

    it('does not mutate its input', () => {
        const r: Ring = [v(0, 0), v(5, 0), v(10, 0), v(10, 10)];
        simplifyCollinear(r);
        expect(r).toHaveLength(4);
    });
});

describe('ringBBox / distToRing / signedDistToPolygon', () => {
    it('computes the bounding box', () => {
        expect(ringBBox([v(3, -2), v(10, 7), v(-4, 5)])).toEqual({
            min: { x: -4, y: -2 },
            max: { x: 10, y: 7 },
        });
    });

    it('measures the distance to the nearest edge', () => {
        expect(distToRing(v(5, 5), square10)).toBe(5);
        expect(distToRing(v(13, 5), square10)).toBe(3);
        expect(distToRing(v(13, 14), square10)).toBe(5);
        expect(distToRing(v(0, 0), [])).toBe(Infinity);
    });

    it('is positive inside, negative outside, and respects holes', () => {
        const p: PolygonWithHoles = { outer: square10, holes: [holeCCW] };
        expect(signedDistToPolygon(v(1, 5), p)).toBe(1);
        expect(signedDistToPolygon(v(5, 5), p)).toBe(-1);
        expect(signedDistToPolygon(v(13, 5), p)).toBe(-3);
        expect(signedDistToPolygon(v(2, 5), p)).toBe(2);
        expect(
            signedDistToPolygon(v(5, 5), { outer: square10, holes: [] }),
        ).toBe(5);
    });
});

describe('isAxisRectangle', () => {
    it('describes an axis rectangle', () => {
        expect(isAxisRectangle(rectCW(4000, 3000))).toEqual({
            width: 4000,
            depth: 3000,
            angle: 0,
        });
    });

    it('takes width along the x axis regardless of start vertex and winding', () => {
        const r = rectCW(4000, 3000);
        const rotated = [r[1]!, r[2]!, r[3]!, r[0]!];
        expect(isAxisRectangle(rotated)).toEqual({
            width: 4000,
            depth: 3000,
            angle: 0,
        });
        expect(isAxisRectangle([...r].reverse())).toEqual({
            width: 4000,
            depth: 3000,
            angle: 0,
        });
        expect(isAxisRectangle(rectCW(3000, 4000))).toEqual({
            width: 3000,
            depth: 4000,
            angle: 0,
        });
    });

    it('simplifies collinear vertices first', () => {
        const r: Ring = [
            v(0, 0),
            v(2000, 0.2),
            v(4000, 0),
            v(4000, 3000),
            v(0, 3000),
        ];
        expect(isAxisRectangle(r)).toEqual({
            width: 4000,
            depth: 3000,
            angle: 0,
        });
    });

    it('returns null for a rotated-45 degree square', () => {
        const s = 1000 / Math.SQRT2;
        const diamond: Ring = [v(s, 0), v(2 * s, s), v(s, 2 * s), v(0, s)];
        expect(isAxisRectangle(diamond)).toBeNull();
    });

    it('returns null for non-rectangles', () => {
        expect(isAxisRectangle([v(0, 0), v(10, 0), v(10, 10)])).toBeNull();
        expect(
            isAxisRectangle([v(0, 0), v(10, 0), v(12, 10), v(0, 10)]),
        ).toBeNull();
        expect(
            isAxisRectangle([
                v(0, 0),
                v(100, 0),
                v(100, 40),
                v(40, 40),
                v(40, 100),
                v(0, 100),
            ]),
        ).toBeNull();
    });
});
