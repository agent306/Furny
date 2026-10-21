import { describe, expect, it } from 'vitest';
import {
    FIXTURE_KEYS,
    FIXTURE_LIBRARY,
    type Fixture2DItem,
    type FixtureKey,
} from '../fixtures';

const SCALES = [0.5, 1, 2];
const TOL = 1e-9;

/** Points of a polyline item; fails the test for any other item type. */
function polylinePts(item: Fixture2DItem | undefined): Array<[number, number]> {
    if (item?.t !== 'polyline') throw new Error('expected a polyline');
    return item.pts;
}

function points(item: Fixture2DItem): Array<[number, number]> {
    switch (item.t) {
        case 'rect':
            return [
                [item.x0, item.y0],
                [item.x1, item.y1],
            ];
        case 'ellipse':
            return [
                [item.cx - item.rx, item.cy - item.ry],
                [item.cx + item.rx, item.cy + item.ry],
            ];
        case 'line':
            return [
                [item.x0, item.y0],
                [item.x1, item.y1],
            ];
        case 'polyline':
            return item.pts;
    }
}

describe('FIXTURE_KEYS', () => {
    it('lists the 35 keys of 05 §9.4 in table order', () => {
        expect(FIXTURE_KEYS).toHaveLength(35);
        expect(new Set(FIXTURE_KEYS).size).toBe(35);
        expect(FIXTURE_KEYS[0]).toBe('bed_single');
        expect(FIXTURE_KEYS[FIXTURE_KEYS.length - 1]).toBe('car');
        expect(FIXTURE_KEYS.slice(0, 8)).toEqual([
            'bed_single',
            'bed_double',
            'bed_queen',
            'bed_king',
            'bedside_table',
            'wardrobe_generic',
            'dresser',
            'sofa_2',
        ]);
    });

    it('has one definition per key, with matching key, name key and category', () => {
        expect(Object.keys(FIXTURE_LIBRARY)).toEqual([...FIXTURE_KEYS]);
        for (const key of FIXTURE_KEYS) {
            const def = FIXTURE_LIBRARY[key];
            expect(def.key).toBe(key);
            expect(def.nameKey).toBe(`plan_editor.fixtures.${key}`);
        }
    });

    it('assigns the categories of 05 §9.4', () => {
        const count: Record<string, number> = {};
        for (const key of FIXTURE_KEYS) {
            const c = FIXTURE_LIBRARY[key].category;
            count[c] = (count[c] ?? 0) + 1;
        }
        expect(count).toEqual({
            bedroom: 7,
            living: 8,
            dining: 3,
            study: 2,
            kitchen: 6,
            bathroom: 4,
            utility: 2,
            structure: 2,
            outdoor: 1,
        });
    });
});

describe('FIXTURE_LIBRARY defaults', () => {
    const size = (k: FixtureKey) => {
        const d = FIXTURE_LIBRARY[k];
        return [d.width, d.depth, d.height, d.elevation];
    };

    it('matches the 05 §9.4 default sizes and elevations', () => {
        expect(size('bed_single')).toEqual([900, 1900, 900, 0]);
        expect(size('bed_double')).toEqual([1400, 1900, 900, 0]);
        expect(size('bed_queen')).toEqual([1500, 2000, 900, 0]);
        expect(size('bed_king')).toEqual([1800, 2000, 900, 0]);
        expect(size('bedside_table')).toEqual([450, 400, 550, 0]);
        expect(size('wardrobe_generic')).toEqual([1200, 600, 2100, 0]);
        expect(size('dresser')).toEqual([1000, 450, 800, 0]);
        expect(size('sofa_2')).toEqual([1500, 850, 800, 0]);
        expect(size('sofa_3')).toEqual([2100, 900, 800, 0]);
        expect(size('sofa_l')).toEqual([2400, 1600, 800, 0]);
        expect(size('armchair')).toEqual([800, 800, 800, 0]);
        expect(size('coffee_table')).toEqual([1000, 550, 420, 0]);
        expect(size('tv')).toEqual([1200, 80, 700, 900]);
        expect(size('rug')).toEqual([2000, 1400, 10, 0]);
        expect(size('plant')).toEqual([450, 450, 1200, 0]);
        expect(size('dining_table_4')).toEqual([1200, 1700, 900, 0]);
        expect(size('dining_table_6')).toEqual([1800, 1700, 900, 0]);
        expect(size('chair')).toEqual([450, 500, 900, 0]);
        expect(size('desk_generic')).toEqual([1200, 600, 750, 0]);
        expect(size('office_chair')).toEqual([600, 600, 1000, 0]);
        expect(size('kitchen_counter')).toEqual([2400, 600, 900, 0]);
        expect(size('kitchen_counter_l')).toEqual([2400, 1800, 900, 0]);
        expect(size('sink')).toEqual([800, 500, 50, 850]);
        expect(size('hob')).toEqual([600, 520, 20, 900]);
        expect(size('fridge')).toEqual([700, 700, 1800, 0]);
        expect(size('dishwasher')).toEqual([600, 600, 850, 0]);
        expect(size('wc')).toEqual([380, 700, 780, 0]);
        expect(size('basin')).toEqual([550, 450, 850, 0]);
        expect(size('shower')).toEqual([900, 900, 2000, 0]);
        expect(size('bathtub')).toEqual([1700, 750, 550, 0]);
        expect(size('washing_machine')).toEqual([600, 600, 850, 0]);
        expect(size('water_heater')).toEqual([450, 450, 700, 1600]);
        expect(size('stairs_straight')).toEqual([1000, 3000, 3000, 0]);
        expect(size('column')).toEqual([300, 300, 2700, 0]);
        expect(size('car')).toEqual([1800, 4500, 1500, 0]);
    });

    it('flags only sink, hob and rug as noConflict', () => {
        const flagged = FIXTURE_KEYS.filter(
            (k) => FIXTURE_LIBRARY[k].noConflict,
        );
        expect(flagged).toEqual(['rug', 'sink', 'hob']);
        for (const k of FIXTURE_KEYS) {
            expect(FIXTURE_LIBRARY[k].noConflict).toBe(
                k === 'sink' || k === 'hob' || k === 'rug',
            );
        }
    });

    it('elevates only tv, sink, hob and water_heater', () => {
        const elevated = FIXTURE_KEYS.filter(
            (k) => FIXTURE_LIBRARY[k].elevation !== 0,
        );
        expect(elevated).toEqual(['tv', 'sink', 'hob', 'water_heater']);
        expect(FIXTURE_LIBRARY.tv.elevation).toBe(900);
        expect(FIXTURE_LIBRARY.water_heater.elevation).toBe(1600);
    });
});

describe('symbol2d', () => {
    it.each(FIXTURE_KEYS)(
        '%s stays inside [-0.5, 0.5] x [0, 1] at 50 %%, 100 %% and 200 %%',
        (key) => {
            const def = FIXTURE_LIBRARY[key];
            for (const s of SCALES) {
                const items = def.symbol2d(def.width * s, def.depth * s);
                expect(items.length).toBeGreaterThan(0);
                for (const item of items) {
                    for (const [x, y] of points(item)) {
                        expect(x).toBeGreaterThanOrEqual(-0.5 - TOL);
                        expect(x).toBeLessThanOrEqual(0.5 + TOL);
                        expect(y).toBeGreaterThanOrEqual(0 - TOL);
                        expect(y).toBeLessThanOrEqual(1 + TOL);
                    }
                }
            }
        },
    );

    it('has a non-detail outline as the first item of every symbol', () => {
        for (const key of FIXTURE_KEYS) {
            const def = FIXTURE_LIBRARY[key];
            const first = def.symbol2d(def.width, def.depth)[0];
            expect(first && 'detail' in first && first.detail).toBeFalsy();
        }
    });

    it('draws the single bed exactly as 05 §9.4', () => {
        const d = FIXTURE_LIBRARY.bed_single;
        expect(d.symbol2d(d.width, d.depth)).toEqual([
            { t: 'rect', x0: -0.5, x1: 0.5, y0: 0, y1: 1 },
            { t: 'rect', x0: -0.5, x1: 0.5, y0: 0, y1: 0.04, detail: true },
            { t: 'rect', x0: -0.4, x1: 0.4, y0: 0.05, y1: 0.16, detail: true },
            { t: 'line', x0: -0.5, y0: 0.38, x1: 0.5, y1: 0.38, detail: true },
        ]);
    });

    it('draws two pillows for double, queen and king beds', () => {
        for (const key of ['bed_double', 'bed_queen', 'bed_king'] as const) {
            const d = FIXTURE_LIBRARY[key];
            const rects = d
                .symbol2d(d.width, d.depth)
                .filter((i) => i.t === 'rect' && i.y0 === 0.05);
            expect(rects).toEqual([
                {
                    t: 'rect',
                    x0: -0.45,
                    x1: -0.03,
                    y0: 0.05,
                    y1: 0.16,
                    detail: true,
                },
                {
                    t: 'rect',
                    x0: 0.03,
                    x1: 0.45,
                    y0: 0.05,
                    y1: 0.16,
                    detail: true,
                },
            ]);
        }
    });

    it('draws sofa_3 with three cushions and sofa_2 with two', () => {
        const cushions = (key: 'sofa_2' | 'sofa_3') => {
            const d = FIXTURE_LIBRARY[key];
            return d
                .symbol2d(d.width, d.depth)
                .filter(
                    (i) => i.t === 'rect' && i.y0 === 0.22 && i.y1 === 0.95,
                );
        };
        expect(cushions('sofa_2')).toHaveLength(2);
        expect(cushions('sofa_3')).toHaveLength(3);
    });

    it('builds sofa_l from absolute millimetre formulas', () => {
        const d = FIXTURE_LIBRARY.sofa_l;
        const W = 2400;
        const D = 1600;
        const s = Math.min(900, 0.6 * Math.min(W, D));
        const b = 0.22 * s;
        const sx = s / W;
        const sy = s / D;
        const bx = b / W;
        const by = b / D;
        const items = d.symbol2d(W, D);
        expect(items[0]).toEqual({
            t: 'polyline',
            closed: true,
            pts: [
                [-0.5, 0],
                [0.5, 0],
                [0.5, sy],
                [-0.5 + sx, sy],
                [-0.5 + sx, 1],
                [-0.5, 1],
            ],
        });
        const rects = items.filter((i) => i.t === 'rect');
        expect(rects).toEqual([
            { t: 'rect', x0: -0.5, x1: 0.5, y0: 0, y1: by, detail: true },
            { t: 'rect', x0: -0.5, x1: -0.5 + bx, y0: by, y1: 1, detail: true },
            {
                t: 'rect',
                x0: -0.5 + bx,
                x1: 0.5 - bx,
                y0: by,
                y1: sy,
                detail: true,
            },
            {
                t: 'rect',
                x0: -0.5 + bx,
                x1: -0.5 + sx,
                y0: sy,
                y1: 1,
                detail: true,
            },
            { t: 'rect', x0: 0.5 - bx, x1: 0.5, y0: by, y1: sy, detail: true },
        ]);
        // s is capped by 0.6 * min(W, D) on small sizes: 50 % -> min(900, 480) = 480
        const small = d.symbol2d(1200, 800)[0];
        expect(polylinePts(small)[2]).toEqual([0.5, 480 / 800]);
        // ... and by 900 on large sizes: 200 % -> 900
        const big = d.symbol2d(4800, 3200)[0];
        expect(polylinePts(big)[3]).toEqual([-0.5 + 900 / 4800, 900 / 3200]);
    });

    it('builds kitchen_counter_l from absolute millimetre formulas', () => {
        const d = FIXTURE_LIBRARY.kitchen_counter_l;
        const W = 2400;
        const D = 1800;
        const a = Math.min(600, 0.45 * Math.min(W, D));
        const ax = a / W;
        const ay = a / D;
        const items = d.symbol2d(W, D);
        expect(items[0]).toEqual({
            t: 'polyline',
            closed: true,
            pts: [
                [-0.5, 0],
                [0.5, 0],
                [0.5, ay],
                [-0.5 + ax, ay],
                [-0.5 + ax, 1],
                [-0.5, 1],
            ],
        });
        expect(items[1]).toEqual({
            t: 'polyline',
            closed: false,
            detail: true,
            pts: [
                [0.5, ay - 50 / D],
                [-0.5 + ax - 50 / W, ay - 50 / D],
                [-0.5 + ax - 50 / W, 1],
            ],
        });
        // 50 %: a = min(600, 0.45 * 900) = 405
        const small = d.symbol2d(1200, 900)[0];
        expect(polylinePts(small)[2]).toEqual([0.5, 405 / 900]);
    });

    it('draws the stairs with 11 tread lines and an arrow', () => {
        const d = FIXTURE_LIBRARY.stairs_straight;
        const items = d.symbol2d(d.width, d.depth);
        expect(items.filter((i) => i.t === 'line')).toHaveLength(11);
        expect(items.filter((i) => i.t === 'polyline')).toHaveLength(2);
    });

    it('fills the column and dashes the rug, the rod and the water heater', () => {
        const col = FIXTURE_LIBRARY.column;
        expect(col.symbol2d(300, 300)).toEqual([
            { t: 'rect', x0: -0.5, x1: 0.5, y0: 0, y1: 1, fill: '#3B3B3B' },
        ]);
        const rug = FIXTURE_LIBRARY.rug.symbol2d(2000, 1400);
        expect(rug[1]).toMatchObject({ t: 'rect', dashed: true, detail: true });
        const heater = FIXTURE_LIBRARY.water_heater.symbol2d(450, 450);
        expect(heater).toEqual([
            { t: 'ellipse', cx: 0, cy: 0.5, rx: 0.5, ry: 0.5, dashed: true },
        ]);
    });

    it('draws the hob with four burner ellipses', () => {
        const d = FIXTURE_LIBRARY.hob;
        const ellipses = d
            .symbol2d(d.width, d.depth)
            .filter((i) => i.t === 'ellipse');
        expect(ellipses).toHaveLength(4);
    });
});

describe('primitives3d', () => {
    it.each(FIXTURE_KEYS)(
        '%s has primitives at 50 %%, 100 %% and 200 %%',
        (key) => {
            const def = FIXTURE_LIBRARY[key];
            for (const s of SCALES) {
                const prims = def.primitives3d(
                    def.width * s,
                    def.depth * s,
                    def.height * s,
                );
                expect(prims.length).toBeGreaterThan(0);
                for (const p of prims) {
                    expect(['box', 'cylinder', 'sphere']).toContain(p.shape);
                    for (const [lo, hi] of [p.x, p.y, p.z]) {
                        expect(Number.isFinite(lo)).toBe(true);
                        expect(Number.isFinite(hi)).toBe(true);
                        expect(hi).toBeGreaterThan(lo);
                    }
                }
            }
        },
    );

    it('builds the single bed from five boxes', () => {
        const d = FIXTURE_LIBRARY.bed_single;
        expect(d.primitives3d(d.width, d.depth, d.height)).toEqual([
            {
                shape: 'box',
                x: [-0.5, 0.5],
                y: [0.03, 1],
                z: [0, 0.28],
                mat: 'wood',
            },
            {
                shape: 'box',
                x: [-0.48, 0.48],
                y: [0.04, 0.99],
                z: [0.28, 0.5],
                mat: 'mattress',
            },
            {
                shape: 'box',
                x: [-0.5, 0.5],
                y: [0, 0.03],
                z: [0, 1],
                mat: 'wood',
            },
            {
                shape: 'box',
                x: [-0.4, 0.4],
                y: [0.05, 0.16],
                z: [0.5, 0.58],
                mat: 'pillow',
            },
            {
                shape: 'box',
                x: [-0.49, 0.49],
                y: [0.38, 0.99],
                z: [0.5, 0.52],
                mat: 'fabric',
            },
        ]);
    });

    it('uses two pillows on double beds', () => {
        const d = FIXTURE_LIBRARY.bed_double;
        const pillows = d
            .primitives3d(d.width, d.depth, d.height)
            .filter((p) => p.mat === 'pillow');
        expect(pillows.map((p) => p.x)).toEqual([
            [-0.45, -0.03],
            [0.03, 0.45],
        ]);
    });

    it('builds 12 wooden steps for the stairs', () => {
        const d = FIXTURE_LIBRARY.stairs_straight;
        const prims = d.primitives3d(d.width, d.depth, d.height);
        expect(prims).toHaveLength(12);
        expect(prims[0]).toMatchObject({ y: [1 - 1 / 12, 1], z: [0, 1 / 12] });
        expect(prims[11]).toMatchObject({ y: [0, 1 - 11 / 12], z: [0, 1] });
    });

    it('adds four 50 mm legs under the coffee table', () => {
        const d = FIXTURE_LIBRARY.coffee_table;
        const prims = d.primitives3d(d.width, d.depth, d.height);
        expect(prims).toHaveLength(5);
        expect(prims[0]).toMatchObject({ z: [0.9, 1], mat: 'wood' });
        const leg = prims[1];
        if (!leg) throw new Error('missing leg');
        expect(leg.x[1] - leg.x[0]).toBeCloseTo(50 / 1000, 12);
        expect(leg.y[1] - leg.y[0]).toBeCloseTo(50 / 550, 12);
        expect(leg.z).toEqual([0, 0.9]);
    });

    it('builds four chairs for dining_table_4 and six for dining_table_6', () => {
        const seats = (key: 'dining_table_4' | 'dining_table_6') => {
            const d = FIXTURE_LIBRARY[key];
            return d
                .primitives3d(d.width, d.depth, d.height)
                .filter((p) => p.z[0] === 0 && p.z[1] === 0.5);
        };
        expect(seats('dining_table_4')).toHaveLength(4);
        expect(seats('dining_table_6')).toHaveLength(6);
        const d4 = FIXTURE_LIBRARY.dining_table_4;
        const prims = d4.primitives3d(d4.width, d4.depth, d4.height);
        // top + four 60 mm legs + four seats + four backs
        expect(prims).toHaveLength(13);
        expect(prims[0]).toMatchObject({ y: [0.265, 0.735], z: [0.8, 0.84] });
        const legX = prims[1]?.x ?? [0, 0];
        expect(legX[1] - legX[0]).toBeCloseTo(60 / 1200, 12);
    });

    it('puts burner cylinders on top of the hob', () => {
        const d = FIXTURE_LIBRARY.hob;
        const prims = d.primitives3d(d.width, d.depth, d.height);
        const burners = prims.filter((p) => p.shape === 'cylinder');
        expect(burners).toHaveLength(4);
        for (const b of burners) {
            expect(b.z).toEqual([1, 1.5]);
            expect(b.mat).toBe('metal');
        }
    });

    it('builds sofa_l and kitchen_counter_l from absolute millimetre formulas', () => {
        const sofa = FIXTURE_LIBRARY.sofa_l.primitives3d(2400, 1600, 800);
        const s = Math.min(900, 0.6 * 1600);
        const b = 0.22 * s;
        expect(sofa).toHaveLength(5);
        expect(sofa[0]).toMatchObject({
            x: [-0.5, 0.5],
            y: [0, b / 1600],
            z: [0, 1],
        });
        expect(sofa[4]).toMatchObject({
            x: [0.5 - b / 2400, 0.5],
            y: [b / 1600, s / 1600],
            z: [0, 0.7],
        });
        const kc = FIXTURE_LIBRARY.kitchen_counter_l.primitives3d(
            2400,
            1800,
            900,
        );
        expect(kc).toHaveLength(4);
        expect(kc[0]).toMatchObject({
            x: [-0.5, 0.5],
            y: [0, 600 / 1800],
            z: [0, 0.95],
            mat: 'white',
        });
        expect(kc[3]).toMatchObject({
            x: [-0.5, -0.5 + 600 / 2400],
            y: [600 / 1800, 1],
            z: [0.95, 1],
            mat: 'stone',
        });
    });

    it('draws a sink basin and a car with four wheels', () => {
        const sink = FIXTURE_LIBRARY.sink.primitives3d(800, 500, 50);
        expect(sink).toHaveLength(2);
        expect(sink[1]).toMatchObject({ z: [0.6, 1.02], mat: 'dark' });
        const car = FIXTURE_LIBRARY.car.primitives3d(1800, 4500, 1500);
        expect(car.filter((p) => p.shape === 'cylinder')).toHaveLength(4);
        expect(car).toHaveLength(6);
    });
});
