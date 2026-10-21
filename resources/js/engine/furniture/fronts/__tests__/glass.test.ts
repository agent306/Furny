import { describe, expect, it } from 'vitest';
import { mutateCatalog, seedCatalog } from '../../../testing/seedCatalog';
import { hingeCount } from '../../rules/hardware';
import { leafWeightKg } from '../../rules/weight';
import type { FurnitureDocument } from '../../schema';
import type { GenContext } from '../../types';
import {
    boxOfPart,
    hardwareOf,
    partOf,
    runWithFronts,
} from '../../testing/carcassRun';
import {
    BOX_ROOT_ID,
    boxDocument,
    frontOn,
    slidingWardrobe,
    wardrobeFixture,
} from '../../testing/docs';

const catalog = seedCatalog();
const B = 'EB08-WHITE';
const FR1 = 'fr_0000000001';
const LEAF = 'front.fr_0000000002.leaf.1';
const allBanded = { L1: B, L2: B, W1: B, W2: B };

/** The wardrobe fixture with glass doors on column 2 (two 593 x 1997 leaves). */
const glassWardrobe = (): FurnitureDocument =>
    wardrobeFixture((d) => {
        const f = d.carcass?.fronts[1];
        if (f) f.glass = true;
    });

const keysOf = (ctx: GenContext, prefix: string) =>
    ctx.parts
        .filter((p) => p.key.startsWith(prefix))
        .map((p) => p.key)
        .sort();

/** A `width` x 720 x 560 box with one glass single door over the root. */
const glassBox = (width: number): FurnitureDocument =>
    boxDocument({
        width,
        height: 720,
        depth: 560,
        fronts: [frontOn(FR1, [BOX_ROOT_ID], { glass: true })],
    });

describe('glass frame doors (07 §4.5)', () => {
    const { ctx } = runWithFronts(glassWardrobe());

    it('replaces the solid leaf by two stiles, two rails and a glass panel', () => {
        expect(keysOf(ctx, 'front.fr_0000000002.')).toEqual([
            `${LEAF}.glass`,
            `${LEAF}.rail.bottom`,
            `${LEAF}.rail.top`,
            `${LEAF}.stile.left`,
            `${LEAF}.stile.right`,
            'front.fr_0000000002.leaf.2.glass',
            'front.fr_0000000002.leaf.2.rail.bottom',
            'front.fr_0000000002.leaf.2.rail.top',
            'front.fr_0000000002.leaf.2.stile.left',
            'front.fr_0000000002.leaf.2.stile.right',
        ]);
        expect(ctx.parts.some((p) => p.key === LEAF)).toBe(false);
    });

    it('sizes stiles 60 x 1997 and rails 473 x 60, banded all four, faces 2', () => {
        for (const side of ['left', 'right']) {
            expect(partOf(ctx, `${LEAF}.stile.${side}`)).toMatchObject({
                nameKey: 'parts.glass_stile',
                role: 'front',
                materialCode: 'PB18-WHITE',
                length: 1997,
                width: 60,
                edges: allBanded,
                visibleFaces: 2,
            });
        }
        for (const side of ['top', 'bottom']) {
            expect(partOf(ctx, `${LEAF}.rail.${side}`)).toMatchObject({
                nameKey: 'parts.glass_rail',
                length: 473,
                width: 60,
                edges: allBanded,
                visibleFaces: 2,
            });
        }
    });

    it('cuts the glass 487 x 1891 from the catalog glass, unbanded', () => {
        expect(partOf(ctx, `${LEAF}.glass`)).toMatchObject({
            nameKey: 'parts.glass_panel',
            role: 'front',
            materialCode: 'GLASS5-CLEAR',
            thickness: 5,
            length: 1891,
            width: 487,
            grain: 'none',
            edges: { L1: null, L2: null, W1: null, W2: null },
            visibleFaces: 0,
        });
    });

    it('frames the leaf rectangle and centres the glass in the leaf depth', () => {
        // Leaf 1 of column 2 spans x [610, 1203.25], y [101.5, 2098.5], z [582, 600].
        expect(boxOfPart(partOf(ctx, `${LEAF}.stile.left`))).toEqual({
            min: [610, 101.5, 582],
            size: [60, 1997, 18],
        });
        expect(boxOfPart(partOf(ctx, `${LEAF}.stile.right`))?.min[0]).toBe(
            1143.25,
        );
        expect(boxOfPart(partOf(ctx, `${LEAF}.rail.top`))).toEqual({
            min: [670, 2038.5, 582],
            size: [473.25, 60, 18],
        });
        expect(boxOfPart(partOf(ctx, `${LEAF}.glass`))).toEqual({
            min: [663, 154.5, 588.5],
            size: [487.25, 1891, 5],
        });
    });

    it('points the model front at the left stile', () => {
        expect(ctx.fronts.find((f) => f.id === LEAF)).toEqual({
            id: LEAF,
            frontId: 'fr_0000000002',
            kind: 'door',
            rect: { x: 610, y: 101, w: 593, h: 1997 },
            hingeSide: 'left',
            partKey: `${LEAF}.stile.left`,
        });
    });

    it('drills the cups in the hinge-side stile and the handle in the other', () => {
        const ops = (key: string) => partOf(ctx, key).operations;
        const hinges = hingeCount(
            1997,
            leafWeightKg(
                ctx.parts.filter((p) => p.key.startsWith(`${LEAF}.`)),
                ctx.idx,
            ),
        );
        expect(ops(`${LEAF}.stile.left`)).toMatchObject({
            hingeCups: hinges,
            handleHoles: 0,
        });
        expect(ops(`${LEAF}.stile.right`)).toMatchObject({
            hingeCups: 0,
            handleHoles: 2,
        });
        // Leaf 2 hinges on the right.
        expect(ops('front.fr_0000000002.leaf.2.stile.right').hingeCups).toBe(
            hinges,
        );
    });

    it('counts hinges from the frame + glass weight', () => {
        const parts = ctx.parts.filter((p) => p.key.startsWith(`${LEAF}.`));
        // Frame: 2 x 60 x 1997 + 2 x 473 x 60 at 18 mm PB; glass 487 x 1891 x 5 at 2500 kg/m3.
        const frame = ((2 * 60 * 1997 + 2 * 473 * 60) * 18 * 650) / 1e9;
        const glass = (487 * 1891 * 5 * 2500) / 1e9;
        expect(leafWeightKg(parts, ctx.idx)).toBeCloseTo(frame + glass, 6);
        expect(hardwareOf(ctx, 'front.fr_0000000002.hinges')?.qty).toBe(
            hingeCount(1997, frame + glass),
        );
    });
});

describe('glass fallbacks (07 §4.5)', () => {
    it('keeps a 220 mm leaf as glass (2 x 60 + 100)', () => {
        // Opening 187 + 2 x 16.5 = 220.
        const { ctx } = runWithFronts(glassBox(223));
        expect(
            ctx.issues.filter(
                (i) => i.code === 'furniture.glass_door_too_small',
            ),
        ).toEqual([]);
        expect(partOf(ctx, 'front.fr_0000000001.leaf.1.glass').width).toBe(114);
    });

    it('builds a solid leaf with glass_door_too_small below 220 mm (C14: 200 mm)', () => {
        const { ctx } = runWithFronts(glassBox(203));
        expect(
            ctx.issues.filter(
                (i) => i.code === 'furniture.glass_door_too_small',
            ),
        ).toMatchObject([
            { severity: 'error', params: { frontId: FR1 }, entityIds: [FR1] },
        ]);
        expect(keysOf(ctx, 'front.')).toEqual(['front.fr_0000000001.leaf.1']);
        expect(partOf(ctx, 'front.fr_0000000001.leaf.1').width).toBe(200);
        expect(ctx.fronts[0]?.partKey).toBe('front.fr_0000000001.leaf.1');
    });

    it('builds a solid leaf with no_glass_material when the catalog has no active glass', () => {
        const noGlass = mutateCatalog(catalog, (draft) => {
            for (const m of draft.materials) {
                if (m.boardType === 'glass') m.isActive = false;
            }
        });
        const { ctx } = runWithFronts(glassBox(600), noGlass);
        expect(
            ctx.issues.filter((i) => i.code === 'furniture.no_glass_material'),
        ).toMatchObject([{ severity: 'error', params: {} }]);
        expect(keysOf(ctx, 'front.')).toEqual(['front.fr_0000000001.leaf.1']);
    });

    it('frames sliding leaves too', () => {
        const { ctx } = runWithFronts(slidingWardrobe({ glass: true }));
        expect(keysOf(ctx, 'front.fr_0000000001.leaf.1.')).toEqual([
            'front.fr_0000000001.leaf.1.glass',
            'front.fr_0000000001.leaf.1.rail.bottom',
            'front.fr_0000000001.leaf.1.rail.top',
            'front.fr_0000000001.leaf.1.stile.left',
            'front.fr_0000000001.leaf.1.stile.right',
        ]);
        expect(partOf(ctx, 'front.fr_0000000001.leaf.1.glass')).toMatchObject({
            length: 1818,
            width: 702,
        });
        expect(ctx.fronts[0]?.partKey).toBe(
            'front.fr_0000000001.leaf.1.stile.left',
        );
    });
});
