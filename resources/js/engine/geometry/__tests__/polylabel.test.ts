import { describe, expect, it } from 'vitest';
import { pointInPolygon, type PolygonWithHoles } from '../polygon';
import { polylabel } from '../polylabel';
import { v } from '../vec2';

const rect = (x0: number, y0: number, x1: number, y1: number) => [
    v(x0, y0),
    v(x1, y0),
    v(x1, y1),
    v(x0, y1),
];

describe('polylabel', () => {
    it('returns the centre of a 1000 mm square', () => {
        const r = polylabel({ outer: rect(0, 0, 1000, 1000), holes: [] });
        expect(r.point.x).toBeCloseTo(500, -1);
        expect(r.point.y).toBeCloseTo(500, -1);
        expect(Math.abs(r.point.x - 500)).toBeLessThanOrEqual(10);
        expect(Math.abs(r.point.y - 500)).toBeLessThanOrEqual(10);
        expect(r.distance).toBeGreaterThanOrEqual(490);
        expect(r.distance).toBeLessThanOrEqual(500);
    });

    it('puts the label of an L-shape inside the thick part of the arms', () => {
        const poly: PolygonWithHoles = {
            outer: [
                v(0, 0),
                v(3000, 0),
                v(3000, 1000),
                v(1000, 1000),
                v(1000, 3000),
                v(0, 3000),
            ],
            holes: [],
        };
        const r = polylabel(poly);
        expect(pointInPolygon(r.point, poly)).toBe('inside');
        expect(r.distance).toBeGreaterThanOrEqual(0.45 * 1000);
    });

    it('avoids the hole of a square with a centred hole', () => {
        const poly: PolygonWithHoles = {
            outer: rect(0, 0, 1000, 1000),
            holes: [rect(300, 300, 700, 700).reverse()],
        };
        const r = polylabel(poly);
        expect(pointInPolygon(r.point, poly)).toBe('inside');
        // Widest points are the ring corners: x = 300·√2/(1+√2) ≈ 175.7 mm from both walls.
        expect(r.distance).toBeGreaterThan(165);
        expect(r.distance).toBeLessThanOrEqual(175.8);
    });

    it('works regardless of ring orientation', () => {
        const cw = polylabel({ outer: rect(0, 0, 2000, 600), holes: [] });
        const ccw = polylabel({
            outer: rect(0, 0, 2000, 600).reverse(),
            holes: [],
        });
        expect(cw.distance).toBeCloseTo(ccw.distance, 6);
        expect(cw.distance).toBeGreaterThanOrEqual(290);
    });

    it('returns bbox.min with distance 0 for a degenerate polygon', () => {
        const flat = polylabel({
            outer: [v(10, 20), v(500, 20), v(900, 20)],
            holes: [],
        });
        expect(flat).toEqual({ point: { x: 10, y: 20 }, distance: 0 });
    });

    it('honours a coarser precision and stays deterministic', () => {
        const poly: PolygonWithHoles = {
            outer: rect(0, 0, 4000, 3000),
            holes: [],
        };
        const a = polylabel(poly, 50);
        const b = polylabel(poly, 50);
        expect(a).toEqual(b);
        expect(a.distance).toBeGreaterThanOrEqual(1500 - 50);
    });

    it('does not return -0 coordinates', () => {
        const r = polylabel({ outer: rect(-500, -500, 500, 500), holes: [] });
        expect(Object.is(r.point.x, -0)).toBe(false);
        expect(Object.is(r.point.y, -0)).toBe(false);
    });

    describe('very elongated polygons', () => {
        it.each([1e6, 1e9])(
            'costs the same for a 4 m wide strip of length %s mm',
            (length) => {
                const t0 = performance.now();
                const r = polylabel({
                    outer: rect(0, 0, length, 4000),
                    holes: [],
                });
                expect(performance.now() - t0).toBeLessThan(200);
                expect(r.distance).toBe(2000);
                expect(r.point.y).toBe(2000);
                expect(r.point.x).toBeGreaterThan(0);
                expect(r.point.x).toBeLessThan(length);
            },
        );

        it('returns the bbox corner with distance 0 for non-finite extents', () => {
            const r = polylabel({
                outer: rect(0, 0, Number.POSITIVE_INFINITY, 4000),
                holes: [],
            });
            expect(r).toEqual({ point: { x: 0, y: 0 }, distance: 0 });
        });
    });
});
