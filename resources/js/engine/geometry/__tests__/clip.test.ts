import { describe, expect, it } from 'vitest';
import {
    difference,
    intersection,
    intersectionArea,
    offset,
    union,
} from '../clip';
import type { PolygonWithHoles, Ring } from '../polygon';
import { area, signedArea } from '../polygon';

function rect(x0: number, y0: number, x1: number, y1: number): Ring {
    return [
        { x: x0, y: y0 },
        { x: x1, y: y0 },
        { x: x1, y: y1 },
        { x: x0, y: y1 },
    ];
}

function box(x0: number, y0: number, x1: number, y1: number): PolygonWithHoles {
    return { outer: rect(x0, y0, x1, y1), holes: [] };
}

function total(ps: PolygonWithHoles[]): number {
    return ps.reduce((s, p) => s + area(p), 0);
}

function expectWinding(ps: PolygonWithHoles[]): void {
    for (const p of ps) {
        expect(signedArea(p.outer)).toBeGreaterThan(0);
        for (const h of p.holes) expect(signedArea(h)).toBeLessThan(0);
    }
}

describe('union', () => {
    it('merges two 100x100 squares offset by 50 into one ring of area 15000', () => {
        const r = union([box(0, 0, 100, 100), box(50, 0, 150, 100)]);
        expect(r).toHaveLength(1);
        expect(r[0]!.holes).toHaveLength(0);
        expect(total(r)).toBeCloseTo(15_000, 0);
        expectWinding(r);
    });

    it('keeps disjoint polygons separate', () => {
        const r = union([box(0, 0, 100, 100), box(500, 0, 600, 100)]);
        expect(r).toHaveLength(2);
        expect(total(r)).toBeCloseTo(20_000, 0);
    });

    it('is exact for coordinates near 1 000 000 mm', () => {
        const r = union([
            box(999_000, 998_000, 999_100, 998_100),
            box(999_050, 998_000, 999_150, 998_100),
        ]);
        expect(r).toHaveLength(1);
        expect(total(r)).toBeCloseTo(15_000, 0);
        const xs = r[0]!.outer.map((p) => p.x);
        expect(Math.min(...xs)).toBe(999_000);
        expect(Math.max(...xs)).toBe(999_150);
        expectWinding(r);
    });

    it('is exact for diagonal edges crossing near 1 000 000 mm', () => {
        const diamond = (
            cx: number,
            cy: number,
            r: number,
        ): PolygonWithHoles => ({
            outer: [
                { x: cx, y: cy - r },
                { x: cx + r, y: cy },
                { x: cx, y: cy + r },
                { x: cx - r, y: cy },
            ],
            holes: [],
        });
        const a = diamond(999_000, 998_000, 100);
        const b = diamond(999_100, 998_000, 100);
        expect(total(union([a, b]))).toBeCloseTo(35_000, 0);
        expect(intersectionArea([a], [b])).toBeCloseTo(5_000, 0);
    });

    it('accepts either input winding and preserves holes', () => {
        const withHole: PolygonWithHoles = {
            outer: rect(0, 0, 1000, 1000).reverse(),
            holes: [rect(400, 400, 600, 600)],
        };
        const r = union([withHole]);
        expect(r).toHaveLength(1);
        expect(r[0]!.holes).toHaveLength(1);
        expect(total(r)).toBeCloseTo(960_000, 0);
        expectWinding(r);
    });

    it('returns [] for no input and drops rings under 1 mm2', () => {
        expect(union([])).toEqual([]);
        expect(union([box(0, 0, 0.5, 0.5)])).toEqual([]);
        expect(
            union([box(0, 0, 1000, 1000), box(2000, 0, 2000.9, 1)]),
        ).toHaveLength(1);
    });

    it('ignores rings with fewer than three vertices', () => {
        const r = union([
            {
                outer: [
                    { x: 0, y: 0 },
                    { x: 5, y: 5 },
                ],
                holes: [],
            },
        ]);
        expect(r).toEqual([]);
    });

    it('contains no negative zero', () => {
        const r = union([box(-0, -0, 10, 10), box(-10, -10, 0, 0)]);
        for (const p of r) {
            for (const pt of [...p.outer, ...p.holes.flat()]) {
                expect(Object.is(pt.x, -0)).toBe(false);
                expect(Object.is(pt.y, -0)).toBe(false);
            }
        }
    });
});

describe('difference', () => {
    it('1000-square minus a centred 200-square gives one polygon with a CCW hole', () => {
        const r = difference(
            [box(0, 0, 1000, 1000)],
            [box(400, 400, 600, 600)],
        );
        expect(r).toHaveLength(1);
        expect(r[0]!.holes).toHaveLength(1);
        expect(signedArea(r[0]!.outer)).toBeGreaterThan(0);
        expect(signedArea(r[0]!.holes[0]!)).toBeLessThan(0);
        expect(total(r)).toBeCloseTo(960_000, 0);
    });

    it('splits a bar cut through the middle into two polygons', () => {
        const r = difference([box(0, 0, 1000, 100)], [box(450, -10, 550, 110)]);
        expect(r).toHaveLength(2);
        expect(total(r)).toBeCloseTo(90_000, 0);
        expectWinding(r);
    });

    it('returns an island inside a hole as its own polygon', () => {
        const ring = difference(
            [box(0, 0, 1000, 1000)],
            [box(100, 100, 900, 900)],
        );
        const r = union([...ring, box(400, 400, 600, 600)]);
        expect(r).toHaveLength(2);
        expect(r.filter((p) => p.holes.length === 1)).toHaveLength(1);
        expect(total(r)).toBeCloseTo(1_000_000 - 640_000 + 40_000, 0);
        expectWinding(r);
    });

    it('with an empty clip returns the subject', () => {
        const r = difference([box(0, 0, 100, 100)], []);
        expect(total(r)).toBeCloseTo(10_000, 0);
    });
});

describe('intersection and intersectionArea', () => {
    it('intersection area of the 1000-square and the 200-square is 40000', () => {
        const a = [box(0, 0, 1000, 1000)];
        const b = [box(400, 400, 600, 600)];
        expect(intersectionArea(a, b)).toBeCloseTo(40_000, 0);
        expect(total(intersection(a, b))).toBeCloseTo(40_000, 0);
    });

    it('is 0 for disjoint or empty operands', () => {
        expect(
            intersectionArea([box(0, 0, 10, 10)], [box(100, 0, 110, 10)]),
        ).toBe(0);
        expect(intersectionArea([box(0, 0, 10, 10)], [])).toBe(0);
        expect(intersectionArea([], [box(0, 0, 10, 10)])).toBe(0);
    });

    it('subtracts holes from the intersection area', () => {
        const donut = difference(
            [box(0, 0, 1000, 1000)],
            [box(400, 400, 600, 600)],
        );
        expect(intersectionArea(donut, [box(0, 0, 1000, 500)])).toBeCloseTo(
            500_000 - 20_000,
            0,
        );
    });
});

describe('offset', () => {
    it('miter-offsetting a 1000-square by 100 gives a 1200 square', () => {
        const r = offset([box(0, 0, 1000, 1000)], 100, 'miter');
        expect(r).toHaveLength(1);
        expect(total(r)).toBeCloseTo(1_440_000, 0);
        const xs = r[0]!.outer.map((p) => p.x);
        expect(Math.min(...xs)).toBe(-100);
        expect(Math.max(...xs)).toBe(1100);
        expectWinding(r);
    });

    it('shrinks with a negative delta and shrinks holes when growing', () => {
        const shrunk = offset([box(0, 0, 1000, 1000)], -100, 'miter');
        expect(total(shrunk)).toBeCloseTo(640_000, 0);
        const donut = difference(
            [box(0, 0, 1000, 1000)],
            [box(300, 300, 700, 700)],
        );
        const grown = offset(donut, 100, 'miter');
        expect(grown).toHaveLength(1);
        expect(grown[0]!.holes).toHaveLength(1);
        expect(total(grown)).toBeCloseTo(1_200 * 1_200 - 200 * 200, 0);
        expectWinding(grown);
    });

    it('closes a hole that the offset fills completely', () => {
        const donut = difference(
            [box(0, 0, 1000, 1000)],
            [box(400, 400, 600, 600)],
        );
        const grown = offset(donut, 100, 'miter');
        expect(grown).toHaveLength(1);
        expect(grown[0]!.holes).toHaveLength(0);
        expect(total(grown)).toBeCloseTo(1_440_000, 0);
    });

    it('square and round joins cut the corners', () => {
        const sq = total(offset([box(0, 0, 1000, 1000)], 100, 'square'));
        const rd = total(offset([box(0, 0, 1000, 1000)], 100, 'round'));
        expect(sq).toBeLessThan(1_440_000);
        expect(sq).toBeGreaterThan(1_400_000);
        expect(rd).toBeLessThan(sq + 1);
        expect(rd).toBeGreaterThan(1_400_000);
    });

    it('returns [] for no input or a fully collapsed polygon', () => {
        expect(offset([], 10, 'miter')).toEqual([]);
        expect(offset([box(0, 0, 100, 100)], -60, 'miter')).toEqual([]);
    });
});
