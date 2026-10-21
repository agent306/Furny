import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../testing/random';
import {
    NEST_PASSES,
    nestMaterial,
    type NestItem,
    type NestMaterialResult,
    type NestRotation,
} from '../nesting/guillotine';

const spec = (sheetLength: number, sheetWidth: number) => ({
    materialCode: 'M',
    sheetLength,
    sheetWidth,
});

const item = (
    partKey: string,
    length: number,
    width: number,
    rotation: NestRotation = 'free',
): NestItem => ({ rowKey: `r-${partKey}`, partKey, length, width, rotation });

const at = (res: NestMaterialResult, sheet: number, partKey: string) => {
    const p = res.sheets[sheet]!.placements.find((q) => q.partKey === partKey)!;
    return { x: p.x, y: p.y, rotated: p.rotated };
};

describe('nestMaterial: 08 §10.4 exact cases', () => {
    it('A: best fit leaves a reusable strip, with the cuts in order', () => {
        const res = nestMaterial(
            [item('a', 600, 300), item('b', 396, 300), item('c', 1000, 196)],
            spec(1000, 500),
            { kerf: 4, trim: 0 },
        );
        expect(res.unplaced).toEqual([]);
        expect(res.sheets).toHaveLength(1);
        const sheet = res.sheets[0]!;
        expect(sheet.utilization).toBe(0.9896);
        expect(at(res, 0, 'c')).toEqual({ x: 0, y: 0, rotated: false });
        expect(at(res, 0, 'a')).toEqual({ x: 0, y: 200, rotated: false });
        expect(at(res, 0, 'b')).toEqual({ x: 604, y: 200, rotated: false });
        expect(sheet.cuts).toEqual([
            { x1: 0, y1: 196, x2: 1000, y2: 196 },
            { x1: 600, y1: 200, x2: 600, y2: 500 },
        ]);
    });

    it('B: opposite grain locks cannot share a sheet', () => {
        const res = nestMaterial(
            [
                item('a', 700, 400, 'length_along_sheet'),
                item('b', 700, 400, 'width_along_sheet'),
            ],
            spec(1000, 800),
            { kerf: 4, trim: 10 },
        );
        expect(res.sheets.map((s) => s.utilization)).toEqual([0.35, 0.35]);
        expect(at(res, 0, 'a')).toEqual({ x: 10, y: 10, rotated: false });
        expect(at(res, 1, 'b')).toEqual({ x: 10, y: 10, rotated: true });
    });

    it('C: a part larger than the usable area is unplaced and opens no sheet', () => {
        const res = nestMaterial([item('big', 2500, 500)], spec(2440, 1220), {
            kerf: 4,
            trim: 10,
        });
        expect(res.sheets).toHaveLength(0);
        expect(res.unplaced).toEqual(['big']);
    });

    it('D: four 1208 × 598 fill one sheet', () => {
        const res = nestMaterial(
            ['a', 'b', 'c', 'd'].map((k) => item(k, 1208, 598)),
            spec(2440, 1220),
            { kerf: 4, trim: 10 },
        );
        expect(res.sheets).toHaveLength(1);
        expect(res.sheets[0]!.utilization).toBe(0.9707);
        expect(at(res, 0, 'a')).toEqual({ x: 10, y: 10, rotated: false });
        expect(at(res, 0, 'b')).toEqual({ x: 10, y: 612, rotated: false });
        expect(at(res, 0, 'c')).toEqual({ x: 1222, y: 10, rotated: false });
        expect(at(res, 0, 'd')).toEqual({ x: 1222, y: 612, rotated: false });
    });

    it("D': one 1209 long part does not fit beside 1208 (the kerf)", () => {
        const res = nestMaterial(
            [
                item('a', 1208, 598),
                item('b', 1208, 598),
                item('c', 1208, 598),
                item('d', 1209, 598),
            ],
            spec(2440, 1220),
            { kerf: 4, trim: 10 },
        );
        expect(res.sheets).toHaveLength(2);
        expect(res.unplaced).toEqual([]);
    });
});

describe('nestMaterial: details', () => {
    it('has four passes in the specified order', () => {
        expect(NEST_PASSES).toEqual([
            ['longest_side', 'shorter_leftover_axis'],
            ['longest_side', 'max_area'],
            ['area', 'shorter_leftover_axis'],
            ['area', 'max_area'],
        ]);
    });

    it('returns no sheet for no items', () => {
        expect(
            nestMaterial([], spec(2440, 1220), { kerf: 4, trim: 10 }),
        ).toEqual({ sheets: [], unplaced: [] });
    });

    it('never rotates a square and honours width_along_sheet', () => {
        const res = nestMaterial(
            [item('sq', 300, 300), item('w', 600, 200, 'width_along_sheet')],
            spec(2440, 1220),
            { kerf: 4, trim: 10 },
        );
        expect(at(res, 0, 'sq').rotated).toBe(false);
        expect(at(res, 0, 'w').rotated).toBe(true);
    });
});

describe('nestMaterial: properties (mulberry32(99), 50 random sets)', () => {
    const SHEET = { l: 2440, w: 1220 };
    const KERF = 4;
    const TRIM = 10;
    const ROTATIONS: NestRotation[] = [
        'free',
        'free',
        'length_along_sheet',
        'width_along_sheet',
    ];
    const rng = mulberry32(99);
    const int = (min: number, max: number) =>
        min + Math.floor(rng() * (max - min + 1));

    const sets: NestItem[][] = Array.from({ length: 50 }, () =>
        Array.from({ length: int(1, 300) }, (_, i) =>
            item(
                `p${String(i).padStart(3, '0')}`,
                int(40, 1500),
                int(40, 700),
                ROTATIONS[int(0, ROTATIONS.length - 1)]!,
            ),
        ),
    );
    const run = (items: NestItem[]) =>
        nestMaterial(items, spec(SHEET.l, SHEET.w), { kerf: KERF, trim: TRIM });
    const rectOf = (p: {
        x: number;
        y: number;
        length: number;
        width: number;
        rotated: boolean;
    }) => ({
        x: p.x,
        y: p.y,
        w: p.rotated ? p.width : p.length,
        h: p.rotated ? p.length : p.width,
    });

    it('keeps every placement inside the usable area', () => {
        for (const items of sets) {
            for (const sheet of run(items).sheets) {
                for (const p of sheet.placements) {
                    const r = rectOf(p);
                    expect(r.x).toBeGreaterThanOrEqual(TRIM);
                    expect(r.y).toBeGreaterThanOrEqual(TRIM);
                    expect(r.x + r.w).toBeLessThanOrEqual(SHEET.l - TRIM);
                    expect(r.y + r.h).toBeLessThanOrEqual(SHEET.w - TRIM);
                }
            }
        }
    });

    it('keeps placements that overlap in projection at least a kerf apart', () => {
        for (const items of sets) {
            for (const sheet of run(items).sheets) {
                const rects = sheet.placements.map(rectOf);
                for (let i = 0; i < rects.length; i++) {
                    for (let j = i + 1; j < rects.length; j++) {
                        const a = rects[i]!;
                        const b = rects[j]!;
                        const xGap = Math.max(
                            b.x - (a.x + a.w),
                            a.x - (b.x + b.w),
                        );
                        const yGap = Math.max(
                            b.y - (a.y + a.h),
                            a.y - (b.y + b.h),
                        );
                        if (xGap < 0) expect(yGap).toBeGreaterThanOrEqual(KERF);
                        if (yGap < 0) expect(xGap).toBeGreaterThanOrEqual(KERF);
                    }
                }
            }
        }
    });

    it('places every instance exactly once or lists it as unplaced', () => {
        for (const items of sets) {
            const res = run(items);
            const placed = res.sheets.flatMap((s) =>
                s.placements.map((p) => p.partKey),
            );
            expect([...placed, ...res.unplaced].sort()).toEqual(
                items.map((i) => i.partKey).sort(),
            );
        }
    });

    it('never uses a forbidden orientation', () => {
        for (const items of sets) {
            const byKey = new Map(items.map((i) => [i.partKey, i]));
            for (const sheet of run(items).sheets) {
                for (const p of sheet.placements) {
                    const { rotation } = byKey.get(p.partKey)!;
                    if (rotation === 'length_along_sheet') {
                        expect(p.rotated).toBe(false);
                    }
                    if (rotation === 'width_along_sheet') {
                        expect(p.rotated).toBe(true);
                    }
                }
            }
        }
    });

    it('is deterministic: identical input gives deep-equal output in 3 runs', () => {
        for (const items of sets.slice(0, 10)) {
            const first = run(items);
            expect(run(items)).toEqual(first);
            expect(run(items.map((i) => ({ ...i })))).toEqual(first);
        }
    });
});
