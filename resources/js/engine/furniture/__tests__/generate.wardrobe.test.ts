import { describe, expect, it } from 'vitest';
import { seedCatalog } from '../../testing/seedCatalog';
import { generateFurniture } from '../generate';
import { wardrobeFixture } from '../testing/docs';
import type { Part } from '../types';

/**
 * 07 §12.2: the wardrobe fixture against the seed catalog gives exactly the
 * complete tables of parts, fronts, hardware, operations and issues.
 */
const catalog = seedCatalog();
const model = generateFurniture(wardrobeFixture(), catalog);

const B = 'EB08-WHITE';
const _ = null;
const PB = 'PB18-WHITE';
const HDF = 'HDF3-WHITE';
const FR1 = 'fr_0000000001';
const FR2 = 'fr_0000000002';

type Row = [
    key: string,
    material: string,
    t: number,
    length: number,
    width: number,
    l1: string | null,
    l2: string | null,
    w1: string | null,
    w2: string | null,
];

/** The 07 §12.2 expected parts table (20 rows, sorted by key). */
const PARTS: Row[] = [
    ['carcass.back.1', HDF, 3, 1978, 598, _, _, _, _],
    ['carcass.back.2', HDF, 3, 1978, 1180, _, _, _, _],
    ['carcass.bottom', PB, 18, 1764, 582, B, _, _, _],
    ['carcass.side.left', PB, 18, 2000, 582, B, _, B, _],
    ['carcass.side.right', PB, 18, 2000, 582, B, _, B, _],
    ['carcass.top', PB, 18, 1764, 582, B, _, _, _],
    [`front.${FR1}.leaf.1`, PB, 18, 1997, 606, B, B, B, B],
    [`front.${FR2}.leaf.1`, PB, 18, 1997, 593, B, B, B, B],
    [`front.${FR2}.leaf.2`, PB, 18, 1997, 593, B, B, B, B],
    ['plinth.back', PB, 18, 1800, 100, _, _, _, _],
    ['plinth.front', PB, 18, 1800, 100, _, _, B, B],
    ['plinth.return.1', PB, 18, 526, 100, _, _, _, _],
    ['plinth.return.2', PB, 18, 526, 100, _, _, _, _],
    ['plinth.return.3', PB, 18, 526, 100, _, _, _, _],
    ['section.s_0000000001.partition.1', PB, 18, 1964, 569, B, _, _, _],
    ['section.s_0000000002.shelf.1', PB, 18, 580, 549, B, _, _, _],
    ['section.s_0000000002.shelf.2', PB, 18, 580, 549, B, _, _, _],
    ['section.s_0000000002.shelf.3', PB, 18, 580, 549, B, _, _, _],
    ['section.s_0000000002.shelf.4', PB, 18, 580, 549, B, _, _, _],
    ['section.s_0000000003.fixed_shelf.1', PB, 18, 1164, 569, B, _, _, _],
];

/** The 07 §12.2 expected hardware table (14 rows, sorted by key). */
const HARDWARE: Array<[string, string, number]> = [
    ['carcass.anti_tip', 'BRK-ANTITIP', 1],
    ['carcass.connectors.cam', 'CON-CAM-15', 16],
    ['carcass.connectors.dowel', 'CON-DOWEL-8', 16],
    ['carcass.screws', 'SCR-PACK', 1],
    [`front.${FR1}.handles`, 'HDL-BAR-160', 1],
    [`front.${FR1}.hinge_plates`, 'HNG-PLATE-0', 4],
    [`front.${FR1}.hinges`, 'HNG-FO-SC', 4],
    [`front.${FR2}.handles`, 'HDL-BAR-160', 2],
    [`front.${FR2}.hinge_plates`, 'HNG-PLATE-0', 8],
    [`front.${FR2}.hinges`, 'HNG-FO-SC', 4],
    [`front.${FR2}.hinges.shared`, 'HNG-HO-SC', 4],
    ['section.s_0000000002.shelf_supports', 'SHF-PIN-5', 16],
    ['section.s_0000000005.rod', 'ROD-OVAL-1200', 1],
    ['section.s_0000000005.rod_supports', 'ROD-SUP', 2],
];

const LEAVES = [
    `front.${FR1}.leaf.1`,
    `front.${FR2}.leaf.1`,
    `front.${FR2}.leaf.2`,
];

const opsOf = (key: string): Part['operations'] => {
    const part = model.parts.find((p) => p.key === key);
    if (!part) throw new Error(`no part ${key}`);
    return part.operations;
};

const sumOf = (op: keyof Part['operations']): number =>
    model.parts.reduce((total, p) => total + p.operations[op] * p.qty, 0);

describe('generateFurniture: wardrobe fixture (07 §12.2)', () => {
    it('generates exactly the 20 parts of the table, sorted by key', () => {
        expect(
            model.parts.map((p) => [
                p.key,
                p.materialCode,
                p.thickness,
                p.length,
                p.width,
                p.edges.L1,
                p.edges.L2,
                p.edges.W1,
                p.edges.W2,
            ]),
        ).toEqual(PARTS);
    });

    it('generates every part once, without grain, as a generated part', () => {
        for (const part of model.parts) {
            expect(part).toMatchObject({
                qty: 1,
                grain: 'none',
                source: 'generated',
                overridden: false,
            });
        }
    });

    it('has exactly the three leaf fronts, by x', () => {
        expect(model.fronts).toEqual([
            {
                id: `front.${FR1}.leaf.1`,
                frontId: FR1,
                kind: 'door',
                rect: { x: 1, y: 101, w: 606, h: 1997 },
                hingeSide: 'left',
                partKey: `front.${FR1}.leaf.1`,
            },
            {
                id: `front.${FR2}.leaf.1`,
                frontId: FR2,
                kind: 'door',
                rect: { x: 610, y: 101, w: 593, h: 1997 },
                hingeSide: 'left',
                partKey: `front.${FR2}.leaf.1`,
            },
            {
                id: `front.${FR2}.leaf.2`,
                frontId: FR2,
                kind: 'door',
                rect: { x: 1205, y: 101, w: 593, h: 1997 },
                hingeSide: 'right',
                partKey: `front.${FR2}.leaf.2`,
            },
        ]);
    });

    it('has exactly the 14 hardware lines of the table, sorted by key', () => {
        expect(model.hardware.map((h) => [h.key, h.code, h.qty])).toEqual(
            HARDWARE,
        );
        for (const line of model.hardware) {
            expect(line).toMatchObject({
                source: 'generated',
                overridden: false,
            });
        }
    });

    it('gives the carcass-level lines their reasons', () => {
        const line = (key: string) => model.hardware.find((h) => h.key === key);
        expect(line('carcass.anti_tip')).toMatchObject({
            reasonKey: 'hardware.reason.anti_tip',
            frontId: null,
            sectionId: null,
        });
        expect(line('carcass.connectors.cam')).toMatchObject({
            reasonKey: 'hardware.reason.cam_locks',
            reasonParams: { joints: 8 },
        });
        expect(line('carcass.connectors.dowel')).toMatchObject({
            reasonKey: 'hardware.reason.dowels',
            reasonParams: { joints: 8 },
        });
        expect(line('carcass.screws')).toMatchObject({
            reasonKey: 'hardware.reason.screw_pack',
        });
    });

    it('drills 4 hinge cups and 2 handle holes in every leaf', () => {
        for (const key of LEAVES) {
            expect(opsOf(key)).toMatchObject({ hingeCups: 4, handleHoles: 2 });
        }
        expect(sumOf('hingeCups')).toBe(12);
        expect(sumOf('handleHoles')).toBe(6);
    });

    it('drills 116 shelf pin holes in the left side and the partition only', () => {
        expect(opsOf('carcass.side.left').shelfPinHoles).toBe(116);
        expect(opsOf('section.s_0000000001.partition.1').shelfPinHoles).toBe(
            116,
        );
        expect(sumOf('shelfPinHoles')).toBe(232);
    });

    it('records 16 cam locks and 16 dowels over the members, and no slide screws', () => {
        expect(sumOf('camLocks')).toBe(16);
        expect(sumOf('dowels')).toBe(16);
        expect(sumOf('slideScrewSets')).toBe(0);
        // 8 joints of 2 cams each, on the member part.
        expect(opsOf('carcass.top')).toMatchObject({ camLocks: 4, dowels: 4 });
        expect(opsOf('carcass.bottom')).toMatchObject({
            camLocks: 4,
            dowels: 4,
        });
        expect(opsOf('section.s_0000000001.partition.1')).toMatchObject({
            camLocks: 4,
            dowels: 4,
        });
        expect(opsOf('section.s_0000000003.fixed_shelf.1')).toMatchObject({
            camLocks: 4,
            dowels: 4,
        });
        expect(opsOf('carcass.side.left').camLocks).toBe(0);
    });

    it('reports exactly back_split, anti_tip_added and weight_estimate', () => {
        const issues = model.issues
            .map((i) => ({
                code: i.code,
                severity: i.severity,
                params: i.params,
            }))
            .sort((a, b) => (a.code < b.code ? -1 : 1));
        expect(issues).toEqual([
            {
                code: 'furniture.anti_tip_added',
                severity: 'info',
                params: {},
            },
            {
                code: 'furniture.back_split',
                severity: 'info',
                params: { count: 2 },
            },
            {
                code: 'furniture.weight_estimate',
                severity: 'info',
                params: { kg: 144.4 },
            },
        ]);
        expect(
            model.issues.find((i) => i.code === 'furniture.weight_estimate')
                ?.messageKey,
        ).toBe('engine.furniture.issue.weight_estimate');
    });

    it('has the bounding box of the overall dimensions', () => {
        expect(model.bbox).toEqual({ min: [0, 0, 0], size: [1800, 2100, 600] });
    });

    it('lists the leaf section boxes in pre-order', () => {
        expect(model.sections).toEqual([
            {
                id: 's_0000000002',
                box: { min: [18, 118, 13], size: [582, 1964, 569] },
            },
            {
                id: 's_0000000004',
                box: { min: [618, 1732, 13], size: [1164, 350, 569] },
            },
            {
                id: 's_0000000005',
                box: { min: [618, 118, 13], size: [1164, 1596, 569] },
            },
        ]);
    });

    it('is deterministic: two calls give deep-equal models', () => {
        const again = generateFurniture(wardrobeFixture(), catalog);
        expect(again).toEqual(model);
    });

    it('does not mutate the document', () => {
        const doc = wardrobeFixture();
        const before = structuredClone(doc);
        generateFurniture(doc, catalog);
        expect(doc).toEqual(before);
    });
});
