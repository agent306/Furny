import { describe, expect, it } from 'vitest';
import type { CatalogSnapshot } from '../../../catalog/snapshot';
import { mutateCatalog, seedCatalog } from '../../../testing/seedCatalog';
import { contentDepth } from '../../carcass/contents';
import { leafWeightKg } from '../../rules/weight';
import type { Front, FurnitureDocument } from '../../schema';
import type { GenContext, Part } from '../../types';
import {
    boxOfPart,
    hardwareOf,
    partOf,
    runWithFronts,
} from '../../testing/carcassRun';
import {
    BOX_ROOT_ID,
    assign,
    boxDocument,
    frontOn,
    halfOverlayBox,
    insetBox,
    wardrobeFixture,
} from '../../testing/docs';

const catalog = seedCatalog();
const B = 'EB08-WHITE';
const FR1 = 'fr_0000000001';
const FR2 = 'fr_0000000002';
const allBanded = { L1: B, L2: B, W1: B, W2: B };

const frontLines = (ctx: GenContext) =>
    ctx.hardware
        .filter((h) => h.key.startsWith('front.'))
        .map((h) => [h.key, h.code, h.qty])
        .sort();

const issuesOf = (ctx: GenContext, code: string) =>
    ctx.issues.filter((i) => i.code === code);

const leafParts = (ctx: GenContext) =>
    ctx.parts.filter((p) => p.key.startsWith('front.'));

/** A box `width` x `height` x 560 with one front `over` on the root. */
function singleFrontBox(
    width: number,
    height: number,
    over: Partial<Omit<Front, 'id' | 'covers'>> = {},
    doc: Partial<Parameters<typeof boxDocument>[0]> = {},
): FurnitureDocument {
    return boxDocument({
        width,
        height,
        depth: 560,
        fronts: [frontOn(FR1, [BOX_ROOT_ID], over)],
        ...doc,
    });
}

describe('hinged fronts: wardrobe fixture (07 §4.1-§4.2, §12.2)', () => {
    const { ctx } = runWithFronts(wardrobeFixture());

    it('generates the column 1 leaf of the worked example', () => {
        const leaf = partOf(ctx, 'front.fr_0000000001.leaf.1');
        expect(leaf).toMatchObject({
            nameKey: 'parts.door',
            nameParams: { leaf: 1 },
            role: 'front',
            materialCode: 'PB18-WHITE',
            thickness: 18,
            length: 1997,
            width: 606,
            edges: allBanded,
            visibleFaces: 2,
            grain: 'none',
        });
        // Full overlay: in front of the carcass front plane (Dc = 582).
        expect(boxOfPart(leaf)).toEqual({
            min: [1.5, 101.5, 582],
            size: [606.5, 1997, 18],
        });
        expect(ctx.edgeMap.get(leaf.key)).toEqual({
            L1: 'left',
            L2: 'right',
            W1: 'top',
            W2: 'bottom',
        });
    });

    it('splits column 2 into two leaves of 593 x 1997', () => {
        for (const k of [1, 2]) {
            expect(partOf(ctx, `front.fr_0000000002.leaf.${k}`)).toMatchObject({
                length: 1997,
                width: 593,
                edges: allBanded,
            });
        }
        expect(leafParts(ctx)).toHaveLength(3);
    });

    it('lists the three model fronts with their hinge sides', () => {
        expect(ctx.fronts).toEqual([
            {
                id: 'front.fr_0000000001.leaf.1',
                frontId: FR1,
                kind: 'door',
                rect: { x: 1, y: 101, w: 606, h: 1997 },
                hingeSide: 'left',
                partKey: 'front.fr_0000000001.leaf.1',
            },
            {
                id: 'front.fr_0000000002.leaf.1',
                frontId: FR2,
                kind: 'door',
                rect: { x: 610, y: 101, w: 593, h: 1997 },
                hingeSide: 'left',
                partKey: 'front.fr_0000000002.leaf.1',
            },
            {
                id: 'front.fr_0000000002.leaf.2',
                frontId: FR2,
                kind: 'door',
                rect: { x: 1205, y: 101, w: 593, h: 1997 },
                hingeSide: 'right',
                partKey: 'front.fr_0000000002.leaf.2',
            },
        ]);
    });

    it('weighs the leaves at 14.16 and 13.86 kg', () => {
        const weight = (key: string) =>
            leafWeightKg([partOf(ctx, key)], ctx.idx);
        expect(weight('front.fr_0000000001.leaf.1')).toBeCloseTo(14.16, 2);
        expect(weight('front.fr_0000000002.leaf.1')).toBeCloseTo(13.86, 2);
    });

    it('adds the hinge, plate and handle lines of 07 §12.2', () => {
        expect(frontLines(ctx)).toEqual([
            ['front.fr_0000000001.handles', 'HDL-BAR-160', 1],
            ['front.fr_0000000001.hinge_plates', 'HNG-PLATE-0', 4],
            ['front.fr_0000000001.hinges', 'HNG-FO-SC', 4],
            ['front.fr_0000000002.handles', 'HDL-BAR-160', 2],
            ['front.fr_0000000002.hinge_plates', 'HNG-PLATE-0', 8],
            ['front.fr_0000000002.hinges', 'HNG-FO-SC', 4],
            ['front.fr_0000000002.hinges.shared', 'HNG-HO-SC', 4],
        ]);
    });

    it('tags the lines with their front and reason', () => {
        expect(
            hardwareOf(ctx, 'front.fr_0000000002.hinges.shared'),
        ).toMatchObject({
            reasonKey: 'hardware.reason.hinges_for_door',
            reasonParams: { leaves: 1 },
            frontId: FR2,
            sectionId: null,
            source: 'generated',
            overridden: false,
        });
        expect(hardwareOf(ctx, 'front.fr_0000000002.hinges')).toMatchObject({
            reasonParams: { leaves: 1 },
        });
        expect(
            hardwareOf(ctx, 'front.fr_0000000002.hinge_plates'),
        ).toMatchObject({ reasonKey: 'hardware.reason.hinge_plates' });
        expect(hardwareOf(ctx, 'front.fr_0000000002.handles')).toMatchObject({
            reasonKey: 'hardware.reason.handles_for_front',
        });
    });

    it('drills 4 hinge cups and 2 handle holes per leaf', () => {
        for (const leaf of leafParts(ctx)) {
            expect(leaf.operations).toMatchObject({
                hingeCups: 4,
                handleHoles: 2,
            });
        }
    });

    it('raises no front issues', () => {
        expect(ctx.issues.map((i) => i.code)).not.toContainEqual(
            expect.stringMatching(/door|front|hinge|handle/),
        );
    });

    it('follows the vertical grain on doors when the material has grain', () => {
        const doc = wardrobeFixture((d) => {
            d.materials.front = assign('PB18-OAK');
        });
        const leaf = partOf(
            runWithFronts(doc).ctx,
            'front.fr_0000000001.leaf.1',
        );
        expect(leaf.grain).toBe('length');
    });
});

describe('inset and half overlay (07 §12.4)', () => {
    it('insets a single door by 2 mm on every edge, with no front zone', () => {
        const { ctx, env } = runWithFronts(insetBox());
        expect(env.fz).toBe(0);
        const leaf = partOf(ctx, 'front.fr_0000000001.leaf.1');
        // Opening 564 x 684 -> leaf 560 x 680 (opening height - 4).
        expect([leaf.width, leaf.length]).toEqual([560, 680]);
        // Inset: z in [Dc - t_f, Dc] with Dc = 560.
        expect(boxOfPart(leaf)).toEqual({
            min: [20, 20, 542],
            size: [560, 680, 18],
        });
        expect(frontLines(ctx)).toContainEqual([
            'front.fr_0000000001.hinges',
            'HNG-IN-SC',
            2,
        ]);
    });

    it('shortens the content depth of an inset-covered leaf by t_f', () => {
        const { ctx, env } = runWithFronts(insetBox());
        expect(contentDepth(ctx, env, BOX_ROOT_ID)).toBe(
            env.interior.size[2] - 18,
        );
    });

    it('places two half-overlay doors at [10, 599] and [601, 1190]', () => {
        const { ctx } = runWithFronts(halfOverlayBox());
        const xs = (key: string) => {
            const box = boxOfPart(partOf(ctx, key));
            return box ? [box.min[0], box.min[0] + box.size[0]] : null;
        };
        expect(xs('front.fr_0000000001.leaf.1')).toEqual([10, 599]);
        expect(xs('front.fr_0000000002.leaf.1')).toEqual([601, 1190]);
        expect(partOf(ctx, 'front.fr_0000000001.leaf.1').width).toBe(589);
        expect(partOf(ctx, 'front.fr_0000000002.leaf.1').width).toBe(589);
        expect(frontLines(ctx)).toEqual([
            ['front.fr_0000000001.handles', 'HDL-BAR-160', 1],
            ['front.fr_0000000001.hinge_plates', 'HNG-PLATE-0', 2],
            ['front.fr_0000000001.hinges', 'HNG-HO-SC', 2],
            ['front.fr_0000000002.handles', 'HDL-BAR-160', 1],
            ['front.fr_0000000002.hinge_plates', 'HNG-PLATE-0', 2],
            ['front.fr_0000000002.hinges', 'HNG-HO-SC', 2],
        ]);
    });
});

describe('hinged leaf count and hinge side (07 §4.2)', () => {
    it('uses one leaf for auto up to 600 mm of opening and two above', () => {
        const one = runWithFronts(singleFrontBox(636, 720, { leaves: 'auto' }));
        expect(leafParts(one.ctx)).toHaveLength(1);
        const two = runWithFronts(singleFrontBox(637, 720, { leaves: 'auto' }));
        expect(leafParts(two.ctx)).toHaveLength(2);
        const three = runWithFronts(
            singleFrontBox(2000, 720, { leaves: 'auto' }),
        );
        expect(leafParts(three.ctx)).toHaveLength(2);
        expect(
            issuesOf(three.ctx, 'furniture.hinged_leaves_unsupported'),
        ).toEqual([]);
    });

    it('rejects 3 leaves with an error and generates 2', () => {
        const { ctx } = runWithFronts(singleFrontBox(1200, 720, { leaves: 3 }));
        expect(
            issuesOf(ctx, 'furniture.hinged_leaves_unsupported'),
        ).toMatchObject([
            { severity: 'error', params: { frontId: FR1 }, entityIds: [FR1] },
        ]);
        expect(leafParts(ctx).map((p) => p.key)).toEqual([
            'front.fr_0000000001.leaf.1',
            'front.fr_0000000001.leaf.2',
        ]);
    });

    it('hinges a single auto leaf on the right, an explicit one on its side', () => {
        const auto = runWithFronts(singleFrontBox(600, 720));
        expect(auto.ctx.fronts[0]?.hingeSide).toBe('right');
        const left = runWithFronts(
            singleFrontBox(600, 720, { hingeSide: 'left' }),
        );
        expect(left.ctx.fronts[0]?.hingeSide).toBe('left');
    });
});

describe('hinge hardware variants (07 §6.2)', () => {
    it('adds no hinges, plates or cups with hingeCode null', () => {
        const { ctx } = runWithFronts(
            wardrobeFixture((d) => {
                for (const f of d.carcass?.fronts ?? []) f.hingeCode = null;
            }),
        );
        expect(frontLines(ctx).map(([key]) => key)).toEqual([
            'front.fr_0000000001.handles',
            'front.fr_0000000002.handles',
        ]);
        for (const leaf of leafParts(ctx)) {
            expect(leaf.operations.hingeCups).toBe(0);
        }
    });

    it('omits the plates when the hinge has an integrated plate', () => {
        const integrated = mutateCatalog(catalog, (draft) => {
            for (const h of draft.hardware) {
                if (h.category === 'hinge') h.specs.integratedPlate = true;
            }
        });
        const { ctx } = runWithFronts(wardrobeFixture(), integrated);
        expect(frontLines(ctx).map(([key]) => key)).toEqual([
            'front.fr_0000000001.handles',
            'front.fr_0000000001.hinges',
            'front.fr_0000000002.handles',
            'front.fr_0000000002.hinges',
            'front.fr_0000000002.hinges.shared',
        ]);
    });

    it('puts every leaf on an explicit hinge code', () => {
        const { ctx } = runWithFronts(
            wardrobeFixture((d) => {
                const f = d.carcass?.fronts[1];
                if (f) f.hingeCode = 'HNG-FO-SC';
            }),
        );
        expect(
            frontLines(ctx).filter(([key]) =>
                String(key).startsWith('front.fr_0000000002.hinge'),
            ),
        ).toEqual([
            ['front.fr_0000000002.hinge_plates', 'HNG-PLATE-0', 8],
            ['front.fr_0000000002.hinges', 'HNG-FO-SC', 8],
        ]);
    });

    it('warns no_default_hardware and drops the hinges when the role default is missing', () => {
        const noFull: CatalogSnapshot = mutateCatalog(catalog, (draft) => {
            draft.hardware = draft.hardware.filter(
                (h) => h.code !== 'HNG-FO-SC',
            );
        });
        const { ctx } = runWithFronts(wardrobeFixture(), noFull);
        expect(
            issuesOf(ctx, 'furniture.no_default_hardware').map((i) => i.params),
        ).toEqual([
            { roleKey: 'hinge.full_overlay' },
            { roleKey: 'hinge.full_overlay' },
        ]);
        expect(frontLines(ctx)).toEqual([
            ['front.fr_0000000001.handles', 'HDL-BAR-160', 1],
            ['front.fr_0000000002.handles', 'HDL-BAR-160', 2],
            ['front.fr_0000000002.hinge_plates', 'HNG-PLATE-0', 4],
            ['front.fr_0000000002.hinges.shared', 'HNG-HO-SC', 4],
        ]);
        expect(
            partOf(ctx, 'front.fr_0000000001.leaf.1').operations.hingeCups,
        ).toBe(0);
    });
});

describe('hinged front warnings (07 §4.2, §6.2)', () => {
    it('warns door_wide when the opening share per leaf exceeds 600', () => {
        const ok = runWithFronts(singleFrontBox(636, 720, { leaves: 1 }));
        expect(issuesOf(ok.ctx, 'furniture.door_wide')).toEqual([]);
        const wide = runWithFronts(singleFrontBox(700, 720, { leaves: 1 }));
        expect(issuesOf(wide.ctx, 'furniture.door_wide')).toMatchObject([
            {
                severity: 'warning',
                params: { frontId: FR1, width: 664 },
                entityIds: [FR1],
            },
        ]);
    });

    it('warns door_tall above 2400 mm', () => {
        const { ctx } = runWithFronts(singleFrontBox(600, 2500));
        expect(issuesOf(ctx, 'furniture.door_tall')).toMatchObject([
            { severity: 'warning', params: { frontId: FR1, height: 2497 } },
        ]);
    });

    it('warns door_heavy above 22 kg and adds hinges for the weight', () => {
        // 997 x 2197 x 18 mm of particle board = 25.6 kg.
        const { ctx } = runWithFronts(singleFrontBox(1000, 2200));
        expect(issuesOf(ctx, 'furniture.door_heavy')).toMatchObject([
            { severity: 'warning', params: { frontId: FR1, kg: 25.6 } },
        ]);
        expect(hardwareOf(ctx, 'front.fr_0000000001.hinges')?.qty).toBe(5);
    });

    it('reports front_too_small below 100 mm', () => {
        const { ctx } = runWithFronts(
            singleFrontBox(600, 720, { leaves: 2 }, { width: 200 }),
        );
        expect(issuesOf(ctx, 'furniture.front_too_small')).toMatchObject([
            { severity: 'error', params: { frontId: FR1 } },
        ]);
    });
});

describe('handles on hinged fronts (07 §6.4)', () => {
    const handleLine = (doc: FurnitureDocument, snapshot = catalog) =>
        hardwareOf(
            runWithFronts(doc, snapshot).ctx,
            'front.fr_0000000001.handles',
        );

    it('inherits the carcass handle, or uses its own code', () => {
        expect(handleLine(singleFrontBox(600, 720))?.code).toBe('HDL-BAR-160');
        expect(
            handleLine(singleFrontBox(600, 720, { handleCode: 'HDL-BAR-320' }))
                ?.code,
        ).toBe('HDL-BAR-320');
    });

    it('adds no handle and no holes for handleCode null', () => {
        const { ctx } = runWithFronts(
            singleFrontBox(600, 720, { handleCode: null }),
        );
        expect(hardwareOf(ctx, 'front.fr_0000000001.handles')).toBeUndefined();
        expect(
            partOf(ctx, 'front.fr_0000000001.leaf.1').operations.handleHoles,
        ).toBe(0);
    });

    it('swaps a horizontal bar that does not fit for the default knob', () => {
        // 320 + 2 x 40 = 400 > leaf width 297 when the handles run horizontally.
        const doc = singleFrontBox(300, 720, { handleCode: 'HDL-BAR-320' });
        if (doc.carcass) doc.carcass.handles.orientation = 'horizontal';
        const { ctx } = runWithFronts(doc);
        expect(hardwareOf(ctx, 'front.fr_0000000001.handles')?.code).toBe(
            'KNB-ROUND-30',
        );
        expect(
            issuesOf(ctx, 'furniture.handle_replaced_by_knob'),
        ).toMatchObject([{ severity: 'info', params: { frontId: FR1 } }]);
        expect(
            partOf(ctx, 'front.fr_0000000001.leaf.1').operations.handleHoles,
        ).toBe(1);
    });
});

describe('flap fronts (07 §4.3, §6.3)', () => {
    const leafOf = (ctx: GenContext): Part =>
        partOf(ctx, 'front.fr_0000000001.leaf.1');

    it('generates one flap leaf with gas struts for a 900 mm flap_up', () => {
        const { ctx } = runWithFronts(
            singleFrontBox(900, 720, { kind: 'flap_up' }),
        );
        expect(leafOf(ctx)).toMatchObject({
            nameKey: 'parts.flap',
            length: 897,
            width: 717,
            edges: allBanded,
            visibleFaces: 2,
        });
        expect(ctx.fronts).toEqual([
            {
                id: 'front.fr_0000000001.leaf.1',
                frontId: FR1,
                kind: 'flap',
                rect: { x: 1, y: 1, w: 897, h: 717 },
                partKey: 'front.fr_0000000001.leaf.1',
            },
        ]);
        // 897 wide: hinges along the width (<= 900 -> 2), weight 7.5 kg -> 3.
        expect(frontLines(ctx)).toEqual([
            ['front.fr_0000000001.gas_struts', 'GAS-80N', 2],
            ['front.fr_0000000001.handles', 'HDL-BAR-160', 2],
            ['front.fr_0000000001.hinge_plates', 'HNG-PLATE-0', 3],
            ['front.fr_0000000001.hinges', 'HNG-FO-SC', 3],
        ]);
        expect(leafOf(ctx).operations).toMatchObject({
            hingeCups: 3,
            handleHoles: 4,
        });
        expect(
            hardwareOf(ctx, 'front.fr_0000000001.gas_struts')?.reasonKey,
        ).toBe('hardware.reason.gas_struts');
    });

    it('uses one soft-down stay for a 500 mm flap_down', () => {
        const { ctx } = runWithFronts(
            singleFrontBox(500, 400, { kind: 'flap_down' }),
        );
        expect(hardwareOf(ctx, 'front.fr_0000000001.stays')).toMatchObject({
            code: 'LFT-STAY-SC',
            qty: 1,
            reasonKey: 'hardware.reason.flap_stays',
        });
        expect(hardwareOf(ctx, 'front.fr_0000000001.handles')?.qty).toBe(1);
    });

    it('lays the flap grain along the width', () => {
        const doc = singleFrontBox(900, 400, { kind: 'flap_up' });
        doc.materials.front = assign('PB18-OAK');
        // 897 x 397: x is the length axis.
        expect(leafOf(runWithFronts(doc).ctx).grain).toBe('length');
        const tall = singleFrontBox(400, 900, { kind: 'flap_up' });
        tall.materials.front = assign('PB18-OAK');
        expect(leafOf(runWithFronts(tall).ctx).grain).toBe('width');
    });

    it('ignores numeric leaves > 1 with a warning', () => {
        const { ctx } = runWithFronts(
            singleFrontBox(900, 400, { kind: 'flap_up', leaves: 2 }),
        );
        expect(issuesOf(ctx, 'furniture.flap_leaves_ignored')).toMatchObject([
            { severity: 'warning', params: { frontId: FR1 } },
        ]);
        expect(leafParts(ctx)).toHaveLength(1);
        expect(issuesOf(ctx, 'furniture.door_wide')).toEqual([]);
    });

    it('swaps a 320 mm bar on a 300 mm flap for the knob', () => {
        const { ctx } = runWithFronts(
            singleFrontBox(300, 400, {
                kind: 'flap_down',
                handleCode: 'HDL-BAR-320',
            }),
        );
        expect(hardwareOf(ctx, 'front.fr_0000000001.handles')).toMatchObject({
            code: 'KNB-ROUND-30',
            qty: 1,
        });
        expect(issuesOf(ctx, 'furniture.handle_replaced_by_knob')).toHaveLength(
            1,
        );
        expect(leafOf(ctx).operations.handleHoles).toBe(1);
    });

    it('warns flap_heavy above 8 kg', () => {
        const light = runWithFronts(
            singleFrontBox(900, 720, { kind: 'flap_up' }),
        );
        expect(issuesOf(light.ctx, 'furniture.flap_heavy')).toEqual([]);
        // 1197 x 717 x 18 mm of particle board = 10.0 kg.
        const heavy = runWithFronts(
            singleFrontBox(1200, 720, { kind: 'flap_up' }),
        );
        expect(issuesOf(heavy.ctx, 'furniture.flap_heavy')).toMatchObject([
            { severity: 'warning', params: { frontId: FR1, kg: 10 } },
        ]);
    });

    it('hinges the flap on the top or bottom edge class', () => {
        const doc = singleFrontBox(900, 720, {
            kind: 'flap_up',
            overlay: 'inset',
        });
        expect(
            hardwareOf(runWithFronts(doc).ctx, 'front.fr_0000000001.hinges')
                ?.code,
        ).toBe('HNG-IN-SC');
    });
});
