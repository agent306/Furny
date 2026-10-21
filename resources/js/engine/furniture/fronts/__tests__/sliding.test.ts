import { describe, expect, it } from 'vitest';
import { mutateCatalog, seedCatalog } from '../../../testing/seedCatalog';
import { contentDepth } from '../../carcass/contents';
import type { GenContext } from '../../types';
import {
    boxOfPart,
    hardwareOf,
    partOf,
    runWithFronts,
} from '../../testing/carcassRun';
import { BOX_ROOT_ID, frontOn, slidingWardrobe } from '../../testing/docs';

const catalog = seedCatalog();
const B = 'EB08-WHITE';
const FR1 = 'fr_0000000001';

const frontLines = (ctx: GenContext) =>
    ctx.hardware
        .filter((h) => h.key.startsWith('front.'))
        .map((h) => [h.key, h.code, h.qty])
        .sort();

const issuesOf = (ctx: GenContext, code: string) =>
    ctx.issues.filter((i) => i.code === code);

const leafKeys = (ctx: GenContext) =>
    ctx.parts.filter((p) => p.key.startsWith('front.')).map((p) => p.key);

describe('sliding wardrobe defaults (07 §4.6, §12.4)', () => {
    const { ctx, env } = runWithFronts(slidingWardrobe());

    it('reserves the sliding zone instead of a front zone', () => {
        expect(env.fz).toBe(0);
        expect(env.slidingZone).toBe(60);
        // Interior content depth 650 - 13 - 60 = 577.
        expect(contentDepth(ctx, env, 's_0000000002')).toBe(577);
    });

    it('generates 3 leaves of 808 x 1924', () => {
        expect(leafKeys(ctx)).toEqual([
            'front.fr_0000000001.leaf.1',
            'front.fr_0000000001.leaf.2',
            'front.fr_0000000001.leaf.3',
        ]);
        for (const key of leafKeys(ctx)) {
            expect(partOf(ctx, key)).toMatchObject({
                nameKey: 'parts.sliding_door',
                role: 'front',
                length: 1924,
                width: 808,
                edges: { L1: B, L2: B, W1: B, W2: B },
                visibleFaces: 2,
            });
        }
        expect(partOf(ctx, 'front.fr_0000000001.leaf.2').nameParams).toEqual({
            leaf: 2,
        });
    });

    it('overlaps the leaves by 30 and runs odd leaves on the front track', () => {
        // Wo = 2364 from ix0 = 18; y from iy0 + 15 = 133; Dc = 650, p = 30.
        expect(boxOfPart(partOf(ctx, 'front.fr_0000000001.leaf.1'))).toEqual({
            min: [18, 133, 626],
            size: [808, 1924, 18],
        });
        expect(boxOfPart(partOf(ctx, 'front.fr_0000000001.leaf.2'))).toEqual({
            min: [796, 133, 596],
            size: [808, 1924, 18],
        });
        expect(boxOfPart(partOf(ctx, 'front.fr_0000000001.leaf.3'))).toEqual({
            min: [1574, 133, 626],
            size: [808, 1924, 18],
        });
    });

    it('lists sliding model fronts without a hinge side', () => {
        expect(ctx.fronts.map((f) => [f.kind, f.rect, f.hingeSide])).toEqual([
            ['sliding', { x: 18, y: 133, w: 808, h: 1924 }, undefined],
            ['sliding', { x: 796, y: 133, w: 808, h: 1924 }, undefined],
            ['sliding', { x: 1574, y: 133, w: 808, h: 1924 }, undefined],
        ]);
        expect(ctx.fronts[0]).not.toHaveProperty('hingeSide');
        expect(ctx.fronts[0]?.partKey).toBe('front.fr_0000000001.leaf.1');
    });

    it('adds one track set, a roller set and a flush handle per leaf, no hinges', () => {
        expect(frontLines(ctx)).toEqual([
            ['front.fr_0000000001.handles', 'HDL-FLUSH', 3],
            ['front.fr_0000000001.rollers', 'ROL-SLD-SET', 3],
            ['front.fr_0000000001.track', 'TRK-SLD-2T-3000', 1],
        ]);
        expect(hardwareOf(ctx, 'front.fr_0000000001.track')).toMatchObject({
            reasonKey: 'hardware.reason.sliding_track',
            reasonParams: { length: 3000 },
            frontId: FR1,
        });
        expect(hardwareOf(ctx, 'front.fr_0000000001.rollers')?.reasonKey).toBe(
            'hardware.reason.sliding_rollers',
        );
        // HDL-FLUSH has holeCount 0.
        for (const key of leafKeys(ctx)) {
            expect(partOf(ctx, key).operations).toMatchObject({
                hingeCups: 0,
                handleHoles: 0,
            });
        }
    });

    it('raises no sliding issues', () => {
        expect(ctx.issues.map((i) => i.code)).not.toContainEqual(
            expect.stringMatching(/sliding|door|front/),
        );
    });
});

describe('sliding leaf count and hardware (07 §4.6)', () => {
    it('resolves auto leaves to clamp(max(2, ceil(Wo / 1000)), 2, 4)', () => {
        const count = (width: number) => {
            const doc = slidingWardrobe({ leaves: 'auto' });
            doc.dims.width = width;
            return leafKeys(runWithFronts(doc).ctx).length;
        };
        expect(count(1200)).toBe(2);
        expect(count(2400)).toBe(3);
        expect(count(3600)).toBe(4);
        expect(count(6000)).toBe(4);
    });

    it('rejects 1 or 5 leaves and clamps the geometry into 2..4', () => {
        for (const [leaves, made] of [
            [1, 2],
            [5, 4],
        ] as const) {
            const { ctx } = runWithFronts(slidingWardrobe({ leaves }));
            expect(
                issuesOf(ctx, 'furniture.sliding_leaves_unsupported'),
            ).toMatchObject([{ severity: 'error', params: { frontId: FR1 } }]);
            expect(leafKeys(ctx)).toHaveLength(made);
        }
    });

    it('needs ceil(Wo / track length) track sets', () => {
        const doc = slidingWardrobe();
        doc.dims.width = 3600;
        expect(
            hardwareOf(runWithFronts(doc).ctx, 'front.fr_0000000001.track')
                ?.qty,
        ).toBe(2);
    });

    it('adds no track and no rollers for slidingTrackCode null', () => {
        const { ctx } = runWithFronts(
            slidingWardrobe({ slidingTrackCode: null }),
        );
        expect(frontLines(ctx)).toEqual([
            ['front.fr_0000000001.handles', 'HDL-FLUSH', 3],
        ]);
    });

    it('uses an explicit track code', () => {
        const { ctx } = runWithFronts(
            slidingWardrobe({ slidingTrackCode: 'TRK-SLD-2T-3000' }),
        );
        expect(hardwareOf(ctx, 'front.fr_0000000001.track')?.code).toBe(
            'TRK-SLD-2T-3000',
        );
    });

    it('warns sliding_leaf_narrow below 450 mm', () => {
        const doc = slidingWardrobe({ leaves: 2 });
        doc.dims.width = 800;
        // Wo = 764 -> lw = (764 + 30) / 2 = 397.
        const { ctx } = runWithFronts(doc);
        expect(issuesOf(ctx, 'furniture.sliding_leaf_narrow')).toMatchObject([
            { severity: 'warning', params: { frontId: FR1 } },
        ]);
    });

    it('warns sliding_leaf_heavy above the roller limit', () => {
        const weak = mutateCatalog(catalog, (draft) => {
            const roller = draft.hardware.find((h) => h.code === 'ROL-SLD-SET');
            if (roller) roller.specs.maxLeafWeightKg = 15;
        });
        // 808 x 1924 x 18 mm of particle board = 18.2 kg.
        const { ctx } = runWithFronts(slidingWardrobe(), weak);
        expect(issuesOf(ctx, 'furniture.sliding_leaf_heavy')).toMatchObject([
            { severity: 'warning', params: { frontId: FR1, kg: 18.2 } },
        ]);
    });

    it('warns door_tall when a leaf exceeds 2400 mm', () => {
        const doc = slidingWardrobe();
        doc.dims.height = 2700;
        // Ho = 2700 - 100 - 36 = 2564 -> lh = 2524.
        const { ctx } = runWithFronts(doc);
        expect(issuesOf(ctx, 'furniture.door_tall')).toMatchObject([
            { severity: 'warning', params: { frontId: FR1, height: 2524 } },
        ]);
    });
});

describe('sliding front restrictions (07 §4.6)', () => {
    it('rejects a sliding front that does not cover the whole interior', () => {
        const doc = slidingWardrobe();
        const front = doc.carcass?.fronts[0];
        if (front) front.covers = ['s_0000000002'];
        const { ctx } = runWithFronts(doc);
        expect(issuesOf(ctx, 'furniture.sliding_front_partial')).toMatchObject([
            { severity: 'error', params: { frontId: FR1 }, entityIds: [FR1] },
        ]);
        expect(leafKeys(ctx)).toEqual([]);
        expect(frontLines(ctx)).toEqual([]);
    });

    it('accepts covers that add up to the whole interior', () => {
        const doc = slidingWardrobe();
        const front = doc.carcass?.fronts[0];
        if (front) {
            front.covers = ['s_0000000002', 's_0000000003', 's_0000000006'];
        }
        const { ctx } = runWithFronts(doc);
        expect(issuesOf(ctx, 'furniture.sliding_front_partial')).toEqual([]);
        expect(leafKeys(ctx)).toHaveLength(3);
    });

    it('allows one sliding front per carcass', () => {
        const doc = slidingWardrobe();
        doc.carcass?.fronts.push(
            frontOn('fr_0000000002', [BOX_ROOT_ID], {
                kind: 'sliding',
                leaves: 2,
                hingeCode: null,
                slidingTrackCode: 'auto',
            }),
        );
        const { ctx } = runWithFronts(doc);
        expect(issuesOf(ctx, 'furniture.sliding_front_multiple')).toMatchObject(
            [{ severity: 'error', params: {}, entityIds: ['fr_0000000002'] }],
        );
        expect(
            leafKeys(ctx).every((k) => k.startsWith('front.fr_0000000001.')),
        ).toBe(true);
    });
});
