import { describe, expect, it } from 'vitest';
import type { PolygonWithHoles, Ring } from '../polygon';
import { area, signedArea } from '../polygon';
import { triangulate } from '../triangulate';

function rect(x0: number, y0: number, x1: number, y1: number): Ring {
    return [
        { x: x0, y: y0 },
        { x: x1, y: y0 },
        { x: x1, y: y1 },
        { x: x0, y: y1 },
    ];
}

function triangleAreas(m: ReturnType<typeof triangulate>): number[] {
    const out: number[] = [];
    for (let t = 0; t < m.indices.length; t += 3) {
        const pts = [0, 1, 2].map((k) => {
            const i = m.indices[t + k]!;
            return { x: m.positions[2 * i]!, y: m.positions[2 * i + 1]! };
        });
        out.push(signedArea(pts));
    }
    return out;
}

describe('triangulate', () => {
    it('covers a square with a hole exactly, all triangles CW', () => {
        const p: PolygonWithHoles = {
            outer: rect(0, 0, 1000, 1000),
            // a hole given in either winding is accepted
            holes: [rect(400, 400, 600, 600).reverse()],
        };
        const m = triangulate(p);
        const areas = triangleAreas(m);
        expect(areas.length).toBeGreaterThan(2);
        expect(areas.every((a) => a > 0)).toBe(true);
        expect(areas.reduce((s, a) => s + a, 0)).toBeCloseTo(area(p), 6);
        expect(area(p)).toBe(960_000);
    });

    it('lays out outer vertices first, then hole vertices, as flat x,y pairs', () => {
        const m = triangulate({
            outer: rect(0, 0, 10, 10),
            holes: [rect(4, 4, 6, 6)],
        });
        expect(m.positions).toBeInstanceOf(Float64Array);
        expect(m.indices).toBeInstanceOf(Uint32Array);
        expect(m.positions.length).toBe(16);
        expect(Array.from(m.positions.slice(0, 4))).toEqual([0, 0, 10, 0]);
        expect(Array.from(m.positions.slice(8, 12))).toEqual([4, 4, 6, 4]);
        expect(m.indices.length % 3).toBe(0);
        expect(Math.max(...m.indices)).toBeLessThan(8);
    });

    it('re-orders triangles of a CCW outer ring to CW', () => {
        const m = triangulate({
            outer: rect(0, 0, 100, 100).reverse(),
            holes: [],
        });
        const areas = triangleAreas(m);
        expect(areas).toHaveLength(2);
        expect(areas.every((a) => a > 0)).toBe(true);
        expect(areas[0]! + areas[1]!).toBe(10_000);
    });

    it('triangulates a concave L shape without gaps', () => {
        const L: Ring = [
            { x: 0, y: 0 },
            { x: 200, y: 0 },
            { x: 200, y: 100 },
            { x: 100, y: 100 },
            { x: 100, y: 200 },
            { x: 0, y: 200 },
        ];
        const areas = triangleAreas(triangulate({ outer: L, holes: [] }));
        expect(areas.every((a) => a > 0)).toBe(true);
        expect(areas.reduce((s, a) => s + a, 0)).toBe(30_000);
    });

    it('returns empty buffers for a degenerate outer ring', () => {
        const m = triangulate({
            outer: [
                { x: 0, y: 0 },
                { x: 1, y: 1 },
            ],
            holes: [],
        });
        expect(m.positions).toHaveLength(0);
        expect(m.indices).toHaveLength(0);
    });

    it('normalises -0 coordinates to 0', () => {
        const m = triangulate({
            outer: [
                { x: -0, y: -0 },
                { x: 10, y: -0 },
                { x: 10, y: 10 },
            ],
            holes: [],
        });
        expect(Object.is(m.positions[0], 0)).toBe(true);
        expect(Object.is(m.positions[1], 0)).toBe(true);
        expect(Object.is(m.positions[3], 0)).toBe(true);
    });
});
