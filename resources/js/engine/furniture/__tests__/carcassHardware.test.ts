import { describe, expect, it } from 'vitest';
import { seedCatalog } from '../../testing/seedCatalog';
import { createGenContext } from '../context';
import { generateFurniture } from '../generate';
import { makePart } from '../parts';
import {
    cabinetLegs,
    mountingHardware,
    screwPacks,
} from '../rules/carcassHardware';
import { connectorsForJoints } from '../rules/connectors';
import type { CarcassSpec, FurnitureDocument } from '../schema';
import { withoutDefault } from '../testing/catalogs';
import { hardwareOf, runCarcass } from '../testing/carcassRun';
import { boxDocument, drawerTestBox } from '../testing/docs';
import type { FurnitureModel, GenContext } from '../types';

const catalog = seedCatalog();

const lineOf = (model: FurnitureModel, key: string) =>
    model.hardware.find((h) => h.key === key);
const issuesOf = (issues: FurnitureModel['issues'], code: string) =>
    issues.filter((i) => i.code === code);

/** A floor box `width` wide on a `legs` base. */
const legsBox = (
    width: number,
    plinth: Partial<CarcassSpec['plinth']> = {},
): FurnitureDocument =>
    boxDocument({
        width,
        height: 720,
        depth: 560,
        carcass: {
            plinth: {
                type: 'legs',
                height: 100,
                setback: 50,
                legCode: null,
                ...plinth,
            },
        },
    });

const mountedBox = (
    mounting: CarcassSpec['mounting'],
    width: number,
    height = 720,
): FurnitureDocument =>
    boxDocument({ width, height, depth: 560, carcass: { mounting } });

describe('cabinet legs (07 §6.6, §12.4)', () => {
    it.each([
        [600, 4],
        [800, 4],
        [801, 6],
        [900, 6],
        [1600, 6],
        [1800, 8],
    ])('Wc %d gets %d legs', (width, legs) => {
        const model = generateFurniture(legsBox(width), catalog);
        expect(lineOf(model, 'plinth.legs')).toMatchObject({
            code: 'LEG-PLINTH-100',
            qty: legs,
            reasonKey: 'hardware.reason.plinth_legs',
            frontId: null,
            sectionId: null,
            source: 'generated',
        });
    });

    it('uses the plinth leg (leg.plinth) when set back and the cabinet leg (leg.cabinet) when not', () => {
        expect(
            lineOf(generateFurniture(legsBox(600), catalog), 'plinth.legs')
                ?.code,
        ).toBe('LEG-PLINTH-100');
        const flush = generateFurniture(legsBox(600, { setback: 0 }), catalog);
        expect(lineOf(flush, 'plinth.legs')).toMatchObject({
            code: 'LEG-CAB-ADJ',
            qty: 4,
            reasonKey: 'hardware.reason.cabinet_legs',
        });
        expect(issuesOf(flush.issues, 'furniture.leg_height_mismatch')).toEqual(
            [],
        );
    });

    it('takes the document legCode over the role default', () => {
        const model = generateFurniture(
            legsBox(600, { legCode: 'LEG-CAB-ADJ' }),
            catalog,
        );
        expect(lineOf(model, 'plinth.legs')?.code).toBe('LEG-CAB-ADJ');
    });

    it('warns leg_height_mismatch for a 90 mm plinth on LEG-PLINTH-100 (95-150)', () => {
        const model = generateFurniture(legsBox(600, { height: 90 }), catalog);
        expect(
            issuesOf(model.issues, 'furniture.leg_height_mismatch'),
        ).toMatchObject([
            {
                severity: 'warning',
                params: { code: 'LEG-PLINTH-100' },
                entityIds: ['plinth.legs'],
            },
        ]);
        expect(lineOf(model, 'plinth.legs')?.qty).toBe(4);
    });

    it.each([
        [94, true],
        [95, false],
        [150, false],
        [151, true],
    ])('plinth %d on the 95-150 range: mismatch %s', (height, mismatch) => {
        const model = generateFurniture(legsBox(600, { height }), catalog);
        expect(
            issuesOf(model.issues, 'furniture.leg_height_mismatch'),
        ).toHaveLength(mismatch ? 1 : 0);
    });

    it('checks a fixed-height leg against heightMm ± adjustableMm', () => {
        // LEG-TBL-710: heightMm 710, adjustableMm 15.
        const at = (height: number) =>
            issuesOf(
                generateFurniture(
                    boxDocument({
                        width: 600,
                        height: 1500,
                        depth: 560,
                        carcass: {
                            plinth: {
                                type: 'legs',
                                height,
                                setback: 0,
                                legCode: 'LEG-TBL-710',
                            },
                        },
                    }),
                    catalog,
                ).issues,
                'furniture.leg_height_mismatch',
            ).length;
        expect(at(694)).toBe(1);
        expect(at(695)).toBe(0);
        expect(at(725)).toBe(0);
        expect(at(726)).toBe(1);
    });

    it('adds no legs to a plinth base, a base without plinth, or a wall unit', () => {
        for (const doc of [
            legsBox(600, { type: 'plinth' }),
            legsBox(600, { type: 'none' }),
            boxDocument({
                width: 600,
                height: 720,
                depth: 560,
                carcass: {
                    mounting: 'wall',
                    plinth: {
                        type: 'legs',
                        height: 100,
                        setback: 0,
                        legCode: null,
                    },
                },
            }),
        ]) {
            expect(
                lineOf(generateFurniture(doc, catalog), 'plinth.legs'),
            ).toBeUndefined();
        }
    });

    it('warns no_default_hardware and adds no line without a default leg', () => {
        const model = generateFurniture(
            legsBox(600),
            withoutDefault('leg.plinth'),
        );
        expect(lineOf(model, 'plinth.legs')).toBeUndefined();
        expect(
            issuesOf(model.issues, 'furniture.no_default_hardware'),
        ).toMatchObject([
            { severity: 'warning', params: { roleKey: 'leg.plinth' } },
        ]);
    });

    it('can be called on its own with the envelope', () => {
        const { ctx, env } = runCarcass(legsBox(1800));
        cabinetLegs(ctx, env);
        expect(hardwareOf(ctx, 'plinth.legs')?.qty).toBe(8);
    });
});

describe('mounting (07 §6.8)', () => {
    it.each([
        ['wall', 1800, 4],
        ['loft', 1800, 4],
        ['wall', 1000, 2],
        ['wall', 1001, 4],
        ['wall', 400, 2],
    ] as const)('%s unit %d wide gets %d wall brackets', (mounting, w, qty) => {
        const model = generateFurniture(mountedBox(mounting, w), catalog);
        expect(lineOf(model, 'carcass.wall_brackets')).toMatchObject({
            code: 'BRK-WALL-HANG',
            qty,
            reasonKey: 'hardware.reason.wall_brackets',
        });
        expect(lineOf(model, 'carcass.anti_tip')).toBeUndefined();
    });

    it('adds no anti-tip kit to a floor unit 1499 high, and one at 1500', () => {
        const low = generateFurniture(mountedBox('floor', 600, 1499), catalog);
        expect(lineOf(low, 'carcass.anti_tip')).toBeUndefined();
        expect(issuesOf(low.issues, 'furniture.anti_tip_added')).toEqual([]);
        expect(lineOf(low, 'carcass.wall_brackets')).toBeUndefined();

        const tall = generateFurniture(mountedBox('floor', 600, 1500), catalog);
        expect(lineOf(tall, 'carcass.anti_tip')).toMatchObject({
            code: 'BRK-ANTITIP',
            qty: 1,
            reasonKey: 'hardware.reason.anti_tip',
        });
        expect(issuesOf(tall.issues, 'furniture.anti_tip_added')).toMatchObject(
            [{ severity: 'info', params: {} }],
        );
    });

    it('does not announce an anti-tip kit the catalog cannot supply', () => {
        const model = generateFurniture(
            mountedBox('floor', 600, 2000),
            withoutDefault('anti_tip.default'),
        );
        expect(lineOf(model, 'carcass.anti_tip')).toBeUndefined();
        expect(issuesOf(model.issues, 'furniture.anti_tip_added')).toEqual([]);
        expect(
            issuesOf(model.issues, 'furniture.no_default_hardware'),
        ).toMatchObject([{ params: { roleKey: 'anti_tip.default' } }]);
    });

    it('can be called on its own with the envelope', () => {
        const { ctx, env } = runCarcass(mountedBox('wall', 1800));
        mountingHardware(ctx, env);
        expect(hardwareOf(ctx, 'carcass.wall_brackets')?.qty).toBe(4);
    });
});

/** A context holding `count` generated parts of quantity `qty` each. */
function contextWithParts(count: number, qty = 1): GenContext {
    const ctx = createGenContext(drawerTestBox(), catalog);
    for (let i = 1; i <= count; i++) {
        const part = makePart(
            {
                key: `test.part.${i}`,
                nameKey: 'parts.shelf',
                role: 'shelf',
                materialCode: 'PB18-WHITE',
                box: { min: [0, 0, 0], size: [500, 18, 300] },
                thicknessAxis: 'y',
                grainAxis: 'x',
                banded: [],
                visibleFaces: 0,
            },
            ctx,
        );
        part.qty = qty;
        ctx.parts.push(part);
    }
    return ctx;
}

describe('screw packs (07 §6.9)', () => {
    it.each([
        [0, 1],
        [1, 1],
        [30, 1],
        [31, 2],
        [60, 2],
        [61, 3],
    ])('%d generated parts get %d packs', (count, packs) => {
        const ctx = contextWithParts(count);
        screwPacks(ctx, 'carcass');
        expect(hardwareOf(ctx, 'carcass.screws')).toMatchObject({
            code: 'SCR-PACK',
            qty: packs,
            reasonKey: 'hardware.reason.screw_pack',
            frontId: null,
            sectionId: null,
        });
    });

    it('counts the quantities, not the rows', () => {
        const ctx = contextWithParts(1, 31);
        screwPacks(ctx, 'table');
        expect(hardwareOf(ctx, 'table.screws')?.qty).toBe(2);
    });

    it('warns no_default_hardware without a default screw pack', () => {
        const ctx = createGenContext(
            drawerTestBox(),
            withoutDefault('screw_pack.default'),
        );
        screwPacks(ctx, 'carcass');
        expect(ctx.hardware).toEqual([]);
        expect(ctx.issues).toMatchObject([
            {
                code: 'furniture.no_default_hardware',
                params: { roleKey: 'screw_pack.default' },
            },
        ]);
    });
});

describe('connectors (07 §6.9)', () => {
    it.each([
        [1, 2],
        [640, 2],
        [641, 3],
        [960, 3],
        [961, 4],
    ])('a joint %d mm long gets %d cams and as many dowels', (length, cams) => {
        const ctx = contextWithParts(2);
        ctx.joints.push({
            member: 'test.part.1',
            other: 'test.part.2',
            length,
        });
        connectorsForJoints(ctx, 'carcass');
        expect(hardwareOf(ctx, 'carcass.connectors.cam')).toMatchObject({
            code: 'CON-CAM-15',
            qty: cams,
            reasonKey: 'hardware.reason.cam_locks',
            reasonParams: { joints: 1 },
        });
        expect(hardwareOf(ctx, 'carcass.connectors.dowel')).toMatchObject({
            code: 'CON-DOWEL-8',
            qty: cams,
            reasonKey: 'hardware.reason.dowels',
            reasonParams: { joints: 1 },
        });
        const [member, other] = ctx.parts;
        expect(member?.operations).toMatchObject({
            camLocks: cams,
            dowels: cams,
        });
        expect(other?.operations).toMatchObject({ camLocks: 0, dowels: 0 });
    });

    it('sums over joints and adds to the member of each', () => {
        const ctx = contextWithParts(3);
        ctx.joints.push(
            { member: 'test.part.1', other: 'test.part.2', length: 500 },
            { member: 'test.part.1', other: 'test.part.3', length: 700 },
            { member: 'test.part.2', other: 'test.part.3', length: 300 },
        );
        connectorsForJoints(ctx, 'table');
        expect(hardwareOf(ctx, 'table.connectors.cam')?.qty).toBe(7);
        expect(hardwareOf(ctx, 'table.connectors.dowel')?.qty).toBe(7);
        expect(ctx.parts.map((p) => p.operations.camLocks)).toEqual([5, 2, 0]);
    });

    it('adds no lines without joints', () => {
        const ctx = contextWithParts(2);
        connectorsForJoints(ctx, 'carcass');
        expect(ctx.hardware).toEqual([]);
    });

    it('gives the §12.3 drawer box 8 cams and 8 dowels (4 joints of 542) and no anti-tip', () => {
        const model = generateFurniture(drawerTestBox(), catalog);
        expect(lineOf(model, 'carcass.connectors.cam')?.qty).toBe(8);
        expect(lineOf(model, 'carcass.connectors.dowel')?.qty).toBe(8);
        expect(lineOf(model, 'carcass.anti_tip')).toBeUndefined();
    });
});
