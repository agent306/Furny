import { describe, expect, it } from 'vitest';
import { signedArea } from '../../geometry/polygon';
import * as vec2 from '../../geometry/vec2';
import {
    fixtureFootprint,
    frontVector,
    placementFootprint,
    rotationFromFront,
} from '../footprint';
import type { Fixture, FurniturePlacement } from '../schema';

const placement = (
    patch: Partial<FurniturePlacement> = {},
): FurniturePlacement => ({
    id: 'f_0000000001',
    designId: 'design',
    x: 1000,
    y: 1000,
    rotation: 0,
    elevation: 0,
    mirrored: false,
    wallAttachment: null,
    ...patch,
});

const fixture = (patch: Partial<Fixture> = {}): Fixture => ({
    id: 'x_0000000001',
    libraryKey: 'sofa_3',
    x: 3000,
    y: 2000,
    rotation: 0,
    width: 1800,
    depth: 800,
    height: 850,
    elevation: 0,
    label: null,
    ...patch,
});

const SIZE = { width: 1200, depth: 600, height: 750 };

function expectPoint(
    actual: { x: number; y: number },
    expected: [number, number],
): void {
    expect(actual.x).toBeCloseTo(expected[0], 6);
    expect(actual.y).toBeCloseTo(expected[1], 6);
}

describe('placementFootprint', () => {
    it('lays out the corners at rotation 0 (back-left, back-right, front-right, front-left)', () => {
        const fp = placementFootprint(placement(), SIZE);
        expect(fp.corners).toEqual([
            { x: 400, y: 1000 },
            { x: 1600, y: 1000 },
            { x: 1600, y: 1600 },
            { x: 400, y: 1600 },
        ]);
        expect(fp.backCenter).toEqual({ x: 1000, y: 1000 });
        expect(fp.center).toEqual({ x: 1000, y: 1300 });
        expect(fp.front).toEqual({ x: 1000, y: 1600 });
        expect(fp.width).toBe(1200);
        expect(fp.depth).toBe(600);
        expect(fp.rotation).toBe(0);
    });

    it.each([
        [
            90,
            [
                [1000, 400],
                [1000, 1600],
                [400, 1600],
                [400, 400],
            ],
            [700, 1000],
        ],
        [
            180,
            [
                [1600, 1000],
                [400, 1000],
                [400, 400],
                [1600, 400],
            ],
            [1000, 700],
        ],
        [
            270,
            [
                [1000, 1600],
                [1000, 400],
                [1600, 400],
                [1600, 1600],
            ],
            [1300, 1000],
        ],
    ] as const)(
        'rotates the corners clockwise by %i degrees (exactly)',
        (rotation, corners, center) => {
            const fp = placementFootprint(placement({ rotation }), SIZE);
            expect(fp.corners).toEqual(corners.map(([x, y]) => ({ x, y })));
            expect(fp.center).toEqual({ x: center[0], y: center[1] });
        },
    );

    it.each([0, 30, 90, 135, 180, 225, 270, 359])(
        'is clockwise (positive signed area) at rotation %i',
        (rotation) => {
            const fp = placementFootprint(placement({ rotation }), SIZE);
            expect(signedArea(fp.corners)).toBeCloseTo(1200 * 600, 3);
        },
    );

    it('keeps the front edge facing the front vector', () => {
        for (const rotation of [0, 45, 90, 180, 270]) {
            const fp = placementFootprint(placement({ rotation }), SIZE);
            const f = frontVector(rotation);
            expect(fp.front.x - fp.backCenter.x).toBeCloseTo(f.x * 600, 6);
            expect(fp.front.y - fp.backCenter.y).toBeCloseTo(f.y * 600, 6);
        }
    });

    it('is not changed by mirrored', () => {
        const a = placementFootprint(placement({ rotation: 30 }), SIZE);
        const b = placementFootprint(
            placement({ rotation: 30, mirrored: true }),
            SIZE,
        );
        expect(b).toEqual(a);
    });

    it('does not mutate its inputs', () => {
        const p = Object.freeze(placement());
        const size = Object.freeze({ ...SIZE });
        expect(() => placementFootprint(p, size)).not.toThrow();
    });
});

describe('fixtureFootprint', () => {
    it('is centred on (x, y)', () => {
        for (const rotation of [0, 90, 180, 270, 37]) {
            const fp = fixtureFootprint(fixture({ rotation }));
            expect(fp.center).toEqual({ x: 3000, y: 2000 });
            const mid = {
                x: fp.corners.reduce((s, c) => s + c.x, 0) / 4,
                y: fp.corners.reduce((s, c) => s + c.y, 0) / 4,
            };
            expectPoint(mid, [3000, 2000]);
            expect(signedArea(fp.corners)).toBeCloseTo(1800 * 800, 3);
        }
    });

    it('puts the back edge half a depth behind the centre', () => {
        const fp = fixtureFootprint(fixture());
        expect(fp.backCenter).toEqual({ x: 3000, y: 1600 });
        expect(fp.corners[0]).toEqual({ x: 2100, y: 1600 });
        expect(fp.corners[2]).toEqual({ x: 3900, y: 2400 });
        expect(fp.front).toEqual({ x: 3000, y: 2400 });
    });
});

describe('front vector helpers', () => {
    it('re-exports the geometry implementations', () => {
        expect(frontVector).toBe(vec2.frontVector);
        expect(rotationFromFront).toBe(vec2.rotationFromFront);
    });

    it('round-trips rotationFromFront(frontVector(d)) for d = 0..359', () => {
        for (let d = 0; d < 360; d += 1) {
            expect(rotationFromFront(frontVector(d))).toBeCloseTo(d, 6);
        }
    });
});
