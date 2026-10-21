import { describe, expect, it } from 'vitest';
import { mutateCatalog, seedCatalog } from '../../../testing/seedCatalog';
import type { Section } from '../../schema';
import {
    assign,
    boxDocument,
    fixed,
    flex,
    leafSection,
    splitSection,
    wardrobeFixture,
} from '../../testing/docs';
import { boxOfPart, partOf, runCarcass } from '../../testing/carcassRun';

const catalog = seedCatalog();
const ROOT = 's_0000000001';

type Ctx = ReturnType<typeof runCarcass>['ctx'];

const backs = (ctx: Ctx) =>
    ctx.parts.filter((p) => p.key.startsWith('carcass.back'));
const backIssues = (ctx: Ctx) => ctx.issues.filter((i) => /back/.test(i.code));
const seams = (ctx: Ctx) =>
    ctx.issues
        .filter((i) => i.code === 'furniture.back_seam_unsupported')
        .map((i) => i.params);

/** Pieces as `[key, x0, x1, y0, y1]`. */
const piecesOf = (ctx: Ctx) =>
    backs(ctx).map((p) => {
        const b = boxOfPart(p);
        if (!b) throw new Error('no box');
        return [
            p.key,
            b.min[0],
            b.min[0] + b.size[0],
            b.min[1],
            b.min[1] + b.size[1],
        ];
    });

describe('backPanels: one piece (07 §3.4)', () => {
    const box = (back: 'none' | 'nailed' | 'grooved' | 'inset') =>
        runCarcass(
            boxDocument({
                width: 600,
                height: 720,
                depth: 560,
                carcass: { back: { type: back } },
            }),
        ).ctx;

    it('grooved: interior + 2 x 7 on each axis, 3 mm thick at z [10, 13]', () => {
        const ctx = box('grooved');
        const [back] = backs(ctx);
        expect(backs(ctx)).toHaveLength(1);
        const p = partOf(ctx, 'carcass.back');
        expect([p.length, p.width, p.thickness]).toEqual([698, 578, 3]);
        expect(boxOfPart(p)).toEqual({
            min: [11, 11, 10],
            size: [578, 698, 3],
        });
        expect(back?.key).toBe('carcass.back');
        expect(p.role).toBe('back');
        expect(p.materialCode).toBe('HDF3-WHITE');
        expect(p.nameKey).toBe('parts.back');
        expect(p.nameParams).toEqual({});
        expect(p.edges).toEqual({ L1: null, L2: null, W1: null, W2: null });
        expect(p.visibleFaces).toBe(0);
        expect(p.grain).toBe('none');
        expect(backIssues(ctx)).toEqual([]);
    });

    it('nailed: the whole carcass at z [0, 3]', () => {
        const p = partOf(box('nailed'), 'carcass.back');
        expect(boxOfPart(p)).toEqual({
            min: [0, 0, 0],
            size: [600, 720, 3],
        });
        expect([p.length, p.width]).toEqual([720, 600]);
    });

    it('inset: the interior at z [0, 3]', () => {
        const p = partOf(box('inset'), 'carcass.back');
        expect(boxOfPart(p)).toEqual({
            min: [18, 18, 0],
            size: [564, 684, 3],
        });
    });

    it('none: no back and no issue', () => {
        const ctx = box('none');
        expect(backs(ctx)).toEqual([]);
        expect(ctx.issues).toEqual([]);
    });

    it('sits on the plinth: y starts at the plinth height', () => {
        const ctx = runCarcass(
            boxDocument({
                width: 600,
                height: 720,
                depth: 560,
                carcass: {
                    back: { type: 'nailed' },
                    plinth: {
                        type: 'plinth',
                        height: 100,
                        setback: 0,
                        legCode: null,
                    },
                },
            }),
        ).ctx;
        expect(boxOfPart(partOf(ctx, 'carcass.back'))).toEqual({
            min: [0, 100, 0],
            size: [600, 620, 3],
        });
    });

    it('uses the back material grain: oak, taller than wide, grain "length"', () => {
        const doc = boxDocument({
            width: 600,
            height: 720,
            depth: 560,
            materials: { back: assign('PB18-OAK') },
        });
        expect(partOf(runCarcass(doc).ctx, 'carcass.back').grain).toBe(
            'length',
        );
    });
});

describe('backPanels: the wardrobe split at the partition (07 §12.2)', () => {
    const { ctx } = runCarcass(wardrobeFixture());

    it('two pieces, 1978 x 598 and 1978 x 1180, split at x = 609', () => {
        const [a, b] = ['carcass.back.1', 'carcass.back.2'].map((k) =>
            partOf(ctx, k),
        );
        expect([a?.length, a?.width, a?.thickness]).toEqual([1978, 598, 3]);
        expect([b?.length, b?.width, b?.thickness]).toEqual([1978, 1180, 3]);
        expect(piecesOf(ctx)).toEqual([
            ['carcass.back.1', 11, 609, 111, 2089],
            ['carcass.back.2', 609, 1789, 111, 2089],
        ]);
        expect(a?.nameKey).toBe('parts.back');
        expect(a?.nameParams).toEqual({ n: 1 });
        expect(b?.nameParams).toEqual({ n: 2 });
        expect(boxOfPart(a as NonNullable<typeof a>)?.min[2]).toBe(10);
        expect(a?.role).toBe('back');
        expect(a?.visibleFaces).toBe(0);
        expect(a?.edges).toEqual({ L1: null, L2: null, W1: null, W2: null });
    });

    it('says so with an info and has no seam warning', () => {
        expect(backIssues(ctx)).toEqual([
            {
                code: 'furniture.back_split',
                severity: 'info',
                messageKey: 'engine.furniture.issue.back_split',
                params: { count: 2 },
                entityIds: [],
            },
        ]);
    });

    it('there is no unsplit back', () => {
        expect(backs(ctx).map((p) => p.key)).toEqual([
            'carcass.back.1',
            'carcass.back.2',
        ]);
    });
});

describe('backPanels: greedy vertical seams (07 §3.4.1)', () => {
    /** 3700 x 720: back 3678 x 698 at x [11, 3689]. */
    const wide = (interior?: Section, materials = {}) =>
        runCarcass(
            boxDocument({
                width: 3700,
                height: 720,
                depth: 560,
                interior,
                materials,
            }),
        ).ctx;

    it('without partitions: an even unsupported seam, strips up to the sheet length', () => {
        const ctx = wide();
        // free rotation (height 698 <= 1200): strips up to 2420 -> 2 x 1839
        expect(piecesOf(ctx)).toEqual([
            ['carcass.back.1', 11, 1850, 11, 709],
            ['carcass.back.2', 1850, 3689, 11, 709],
        ]);
        expect(seams(ctx)).toEqual([{ axis: 'x', position: 1850 }]);
        expect(backIssues(ctx).map((i) => i.code)).toEqual([
            'furniture.back_split',
            'furniture.back_seam_unsupported',
        ]);
        expect(ctx.issues[1]?.entityIds).toEqual([
            'carcass.back.1',
            'carcass.back.2',
        ]);
    });

    it('a back exactly as high as the usable sheet width may still use the sheet length', () => {
        // 3700 x 1222: back 3678 x 1200
        const ctx = runCarcass(
            boxDocument({ width: 3700, height: 1222, depth: 560 }),
        ).ctx;
        expect(piecesOf(ctx).map((p) => [p[1], p[2]])).toEqual([
            [11, 1850],
            [1850, 3689],
        ]);
        // one millimetre higher it cannot: strips of 1200
        const higher = runCarcass(
            boxDocument({ width: 3700, height: 1223, depth: 560 }),
        ).ctx;
        expect(backs(higher)).toHaveLength(4);
    });

    it('a grained back keeps its grain along the sheet: strips up to 1200', () => {
        const ctx = wide(undefined, { back: assign('PB18-OAK') });
        expect(piecesOf(ctx).map((p) => [p[1], p[2]])).toEqual([
            [11, 931],
            [931, 1851],
            [1851, 2770],
            [2770, 3689],
        ]);
        expect(seams(ctx)).toEqual([
            { axis: 'x', position: 931 },
            { axis: 'x', position: 1851 },
            { axis: 'x', position: 2770 },
        ]);
        // 920 x 698 with the grain (vertical) along the short side
        expect(partOf(ctx, 'carcass.back.1').grain).toBe('width');
        expect(
            ctx.issues.find((i) => i.code === 'furniture.back_split')?.params,
        ).toEqual({ count: 4 });
    });

    it('a full-height partition supports the seam at its centre', () => {
        const ctx = wide(
            splitSection(ROOT, 'columns', [
                [fixed(1700), leafSection('s_0000000002')],
                [flex(), leafSection('s_0000000003')],
            ]),
        );
        // partition x [1718, 1736]: centre 1727
        expect(piecesOf(ctx).map((p) => [p[1], p[2]])).toEqual([
            [11, 1727],
            [1727, 3689],
        ]);
        expect(seams(ctx)).toEqual([]);
    });

    it('takes the largest partition centre inside the window', () => {
        const ctx = wide(
            splitSection(ROOT, 'columns', [
                [fixed(900), leafSection('s_0000000002')],
                [fixed(1000), leafSection('s_0000000003')],
                [flex(), leafSection('s_0000000004')],
            ]),
        );
        // centres 927 and 1945, both within [111, 2431]
        expect(piecesOf(ctx).map((p) => [p[1], p[2]])).toEqual([
            [11, 1945],
            [1945, 3689],
        ]);
        expect(seams(ctx)).toEqual([]);
    });

    it('ignores a partition closer than 100 mm to the strip start or beyond the strip limit', () => {
        const near = wide(
            splitSection(ROOT, 'columns', [
                [fixed(50), leafSection('s_0000000002')],
                [flex(), leafSection('s_0000000003')],
            ]),
        );
        // centre 18 + 50 + 9 = 77 < 11 + 100
        expect(seams(near)).toEqual([{ axis: 'x', position: 1850 }]);
        const far = wide(
            splitSection(ROOT, 'columns', [
                [fixed(2500), leafSection('s_0000000002')],
                [flex(), leafSection('s_0000000003')],
            ]),
        );
        // centre 18 + 2500 + 9 = 2527 > 11 + 2420
        expect(seams(far)).toEqual([{ axis: 'x', position: 1850 }]);
    });

    it('accepts a partition centre exactly 100 mm from the start and exactly at the limit', () => {
        // centre = 18 + c + 9: c = 84 -> 111 = 11 + 100; c = 2404 -> 2431 = 11 + 2420
        const at = (c: number) =>
            wide(
                splitSection(ROOT, 'columns', [
                    [fixed(c), leafSection('s_0000000002')],
                    [flex(), leafSection('s_0000000003')],
                ]),
            );
        const start = at(84);
        expect(piecesOf(start)[0]?.[2]).toBe(111);
        const limit = at(2404);
        expect(piecesOf(limit).map((p) => p[2])).toEqual([2431, 3689]);
        expect(seams(limit)).toEqual([]);
        // one millimetre outside either bound the partition is ignored
        expect(seams(at(83))[0]).toEqual({ axis: 'x', position: 1850 });
        expect(seams(at(2405))).toEqual([{ axis: 'x', position: 1850 }]);
    });

    it('a partition that does not span the full height does not support a seam', () => {
        const ctx = wide(
            splitSection(ROOT, 'rows', [
                [
                    flex(),
                    splitSection('s_0000000002', 'columns', [
                        [fixed(1700), leafSection('s_0000000003')],
                        [flex(), leafSection('s_0000000004')],
                    ]),
                ],
                [flex(), leafSection('s_0000000005')],
            ]),
        );
        expect(seams(ctx)).toEqual([{ axis: 'x', position: 1850 }]);
    });

    it('a partition of a nested column split counts when it spans the full height', () => {
        const ctx = wide(
            splitSection(ROOT, 'columns', [
                [
                    fixed(3000),
                    splitSection('s_0000000002', 'columns', [
                        [fixed(1700), leafSection('s_0000000003')],
                        [flex(), leafSection('s_0000000004')],
                    ]),
                ],
                [flex(), leafSection('s_0000000005')],
            ]),
        );
        // the root partition's centre (3027) is out of reach; the nested one is at 1727
        expect(piecesOf(ctx).map((p) => p[2])).toEqual([1727, 3689]);
        expect(seams(ctx)).toEqual([]);
    });
});

describe('backPanels: horizontal seams (07 §3.4.1 step 4)', () => {
    /** 1000 x 2700: back 978 x 2678 at y [11, 2689], taller than a sheet. */
    const tall = (interior?: Section) =>
        runCarcass(
            boxDocument({
                width: 1000,
                height: 2700,
                depth: 560,
                interior,
            }),
        ).ctx;

    it('no shelf: an even unsupported seam at y = 1350', () => {
        const ctx = tall();
        expect(piecesOf(ctx)).toEqual([
            ['carcass.back.1', 11, 989, 11, 1350],
            ['carcass.back.2', 11, 989, 1350, 2689],
        ]);
        expect(seams(ctx)).toEqual([{ axis: 'y', position: 1350 }]);
        const p = partOf(ctx, 'carcass.back.1');
        expect([p.length, p.width]).toEqual([1339, 978]);
    });

    it('a fixed shelf across the strip supports the seam at its centre', () => {
        const ctx = tall(
            splitSection(ROOT, 'rows', [
                [fixed(1000), leafSection('s_0000000002')],
                [flex(), leafSection('s_0000000003')],
            ]),
        );
        // rows from the top: 2682 - 1000 = 1682, shelf y [1664, 1682], centre 1673
        expect(piecesOf(ctx).map((p) => [p[3], p[4]])).toEqual([
            [11, 1673],
            [1673, 2689],
        ]);
        expect(seams(ctx)).toEqual([]);
        expect(backIssues(ctx).map((i) => i.code)).toEqual([
            'furniture.back_split',
        ]);
    });

    it('a fixed shelf that covers only part of the strip does not support it', () => {
        const ctx = tall(
            splitSection(ROOT, 'columns', [
                [
                    flex(),
                    splitSection('s_0000000002', 'rows', [
                        [flex(), leafSection('s_0000000003')],
                        [flex(), leafSection('s_0000000004')],
                    ]),
                ],
                [flex(), leafSection('s_0000000005')],
            ]),
        );
        expect(seams(ctx)).toEqual([{ axis: 'y', position: 1350 }]);
    });

    it('grid: vertical seams first, horizontal ones per strip, numbered strip by strip bottom to top', () => {
        const ctx = runCarcass(
            boxDocument({ width: 2800, height: 2700, depth: 560 }),
        ).ctx;
        expect(piecesOf(ctx)).toEqual([
            ['carcass.back.1', 11, 937, 11, 1350],
            ['carcass.back.2', 11, 937, 1350, 2689],
            ['carcass.back.3', 937, 1863, 11, 1350],
            ['carcass.back.4', 937, 1863, 1350, 2689],
            ['carcass.back.5', 1863, 2789, 11, 1350],
            ['carcass.back.6', 1863, 2789, 1350, 2689],
        ]);
        expect(seams(ctx)).toEqual([
            { axis: 'x', position: 937 },
            { axis: 'x', position: 1863 },
            { axis: 'y', position: 1350 },
            { axis: 'y', position: 1350 },
            { axis: 'y', position: 1350 },
        ]);
        expect(
            ctx.issues.find((i) => i.code === 'furniture.back_split')?.params,
        ).toEqual({ count: 6 });
    });
});

describe('backPanels: sheet fit and trim', () => {
    it('custom_box 2400 x 2000 x 600, nailed HDF3: two 1200 x 2000 pieces (07 §12.4)', () => {
        const { ctx } = runCarcass(
            boxDocument({
                width: 2400,
                height: 2000,
                depth: 600,
                carcass: { back: { type: 'nailed' } },
            }),
        );
        expect(
            backs(ctx).map((p) => {
                const q = partOf(ctx, p.key);
                return [q.key, q.length, q.width];
            }),
        ).toEqual([
            ['carcass.back.1', 2000, 1200],
            ['carcass.back.2', 2000, 1200],
        ]);
        expect(piecesOf(ctx)).toEqual([
            ['carcass.back.1', 0, 1200, 0, 2000],
            ['carcass.back.2', 1200, 2400, 0, 2000],
        ]);
        expect(backIssues(ctx)).toEqual([
            {
                code: 'furniture.back_split',
                severity: 'info',
                messageKey: 'engine.furniture.issue.back_split',
                params: { count: 2 },
                entityIds: [],
            },
            {
                code: 'furniture.back_seam_unsupported',
                severity: 'warning',
                messageKey: 'engine.furniture.issue.back_seam_unsupported',
                params: { axis: 'x', position: 1200 },
                entityIds: ['carcass.back.1', 'carcass.back.2'],
            },
        ]);
    });

    it('the trim is pricing.sheetTrimMm: 1200 x 2430 fits an untrimmed sheet only', () => {
        const doc = () =>
            boxDocument({ width: 1222, height: 2452, depth: 560 });
        const trimmed = runCarcass(doc()).ctx;
        expect(piecesOf(trimmed).map((p) => [p[3], p[4]])).toEqual([
            [11, 1226],
            [1226, 2441],
        ]);
        const free = runCarcass(
            doc(),
            seedCatalog({ pricing: { sheetTrimMm: 0 } }),
        ).ctx;
        expect(backs(free).map((p) => p.key)).toEqual(['carcass.back']);
        expect(backIssues(free)).toEqual([]);
    });

    it('a grained back that fits only with free rotation is split', () => {
        // 2000 wide x 1000 high: with the vertical grain along the sheet it needs 1000 x 2000 of 2420 x 1200
        const doc = (code: string) =>
            boxDocument({
                width: 2022,
                height: 1022,
                depth: 560,
                materials: { back: assign(code) },
            });
        expect(backs(runCarcass(doc('HDF3-WHITE')).ctx)).toHaveLength(1);
        const oak = runCarcass(doc('PB18-OAK')).ctx;
        expect(piecesOf(oak).map((p) => [p[1], p[2]])).toEqual([
            [11, 1011],
            [1011, 2011],
        ]);
    });

    it('a sheet smaller than the trim cannot be split: critical warning, one piece', () => {
        const tiny = mutateCatalog(catalog, (draft) => {
            const m = draft.materials.find((x) => x.code === 'HDF3-WHITE');
            if (m) m.sheetWidthMm = 15;
        });
        const { ctx } = runCarcass(
            boxDocument({ width: 600, height: 720, depth: 560 }),
            tiny,
        );
        expect(backs(ctx).map((p) => p.key)).toEqual(['carcass.back']);
        expect(backIssues(ctx)).toEqual([
            {
                code: 'furniture.part_exceeds_sheet_back',
                severity: 'warning',
                messageKey: 'engine.furniture.issue.part_exceeds_sheet_back',
                params: { partKey: 'carcass.back', length: 698, width: 578 },
                entityIds: ['carcass.back'],
            },
        ]);
    });
});
