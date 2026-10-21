import { describe, expect, it } from 'vitest';
import { generateFurniture } from '../../furniture/generate';
import { wardrobeFixture } from '../../furniture/testing/docs';
import type { FurnitureModel, Part } from '../../furniture/types';
import { seedCatalog } from '../../testing/seedCatalog';
import { bomOptionsFor, computeBom } from '../bom';
import type { NestedSheet } from '../types';
import { panel } from './panel';

/** 08 §10.2 nesting (kerf 4, trim 10, rotation allowed) and 08 §3.5 / §3.9. */
const catalog = seedCatalog();
const doc = wardrobeFixture();
const model = generateFurniture(doc, catalog);
const bom = computeBom(model, catalog, bomOptionsFor(doc, true));

type Spot = [key: string, x: number, y: number, rotated?: true];

/** The placements of a sheet as `[key, x, y, rotated?]`, in placement order. */
const spots = (sheet: NestedSheet): Spot[] =>
    sheet.placements.map((p) =>
        p.rotated ? [p.partKey, p.x, p.y, true] : [p.partKey, p.x, p.y],
    );

const sheetsOf = (code: string) =>
    bom.nesting!.sheets.filter((s) => s.materialCode === code);

const PB = 'PB18-WHITE';
const HDF = 'HDF3-WHITE';

describe('computeBom: wardrobe nesting (08 §10.2)', () => {
    it('uses kerf 4, trim 10 and has nothing unplaced', () => {
        expect(bom.nesting).toMatchObject({ kerf: 4, trim: 10, unplaced: [] });
    });

    it('nests 5 PB sheets with the exact placements', () => {
        const sheets = sheetsOf(PB);
        expect(sheets.map((s) => s.utilization)).toEqual([
            0.7803, 0.8009, 0.7708, 0.6073, 0.9044,
        ]);
        expect(sheets.map(spots)).toEqual([
            [
                ['carcass.side.left', 10, 10],
                ['carcass.side.right', 10, 595],
            ],
            [
                ['front.fr_0000000001.leaf.1', 10, 10],
                ['front.fr_0000000002.leaf.1', 10, 618],
            ],
            [
                ['front.fr_0000000002.leaf.2', 10, 10],
                ['section.s_0000000001.partition.1', 10, 605],
            ],
            [
                ['plinth.back', 10, 10],
                ['plinth.front', 10, 114],
                ['carcass.bottom', 10, 218],
                ['section.s_0000000002.shelf.1', 1778, 218],
                ['plinth.return.1', 1814, 10],
                ['plinth.return.2', 1812, 114],
            ],
            [
                ['carcass.top', 10, 10],
                ['section.s_0000000003.fixed_shelf.1', 1778, 10, true],
                ['section.s_0000000002.shelf.2', 10, 595, true],
                ['section.s_0000000002.shelf.3', 562, 595, true],
                ['section.s_0000000002.shelf.4', 1114, 595, true],
                ['plinth.return.3', 1666, 595, true],
            ],
        ]);
    });

    it('nests 2 HDF sheets', () => {
        const sheets = sheetsOf(HDF);
        expect(sheets.map((s) => s.utilization)).toEqual([0.7841, 0.3974]);
        expect(sheets.map(spots)).toEqual([
            [['carcass.back.2', 10, 10]],
            [['carcass.back.1', 10, 10]],
        ]);
    });

    it('fills sheetsNested and utilization per material', () => {
        expect(bom.materials).toEqual([
            {
                materialCode: HDF,
                partCount: 2,
                netAreaMm2: 3516884,
                sheetsEstimated: 2,
                sheetsNested: 2,
                sheetsBilled: 2,
                utilization: 0.5907,
            },
            {
                materialCode: PB,
                partCount: 18,
                netAreaMm2: 11531232,
                sheetsEstimated: 5,
                sheetsNested: 5,
                sheetsBilled: 5,
                utilization: 0.7727,
            },
        ]);
    });

    it('names qty > 1 instances key, key#2, key#3', () => {
        const keys = bom.nesting!.sheets.flatMap((s) =>
            s.placements.map((p) => p.partKey),
        );
        expect(keys).toHaveLength(20);
        expect(new Set(keys).size).toBe(20);
        const withQty = model.parts.find((p) => p.qty > 1);
        if (withQty) {
            expect(keys).toContain(`${withQty.key}#2`);
        }
    });

    it('is deterministic and leaves the model alone', () => {
        const before = JSON.stringify(model);
        expect(computeBom(model, catalog, bomOptionsFor(doc, true))).toEqual(
            bom,
        );
        expect(JSON.stringify(model)).toBe(before);
    });

    it('does not change anything but the nesting fields against nesting off', () => {
        const off = computeBom(model, catalog, bomOptionsFor(doc, false));
        expect({ ...bom, nesting: null, materials: [] }).toEqual({
            ...off,
            materials: [],
        });
    });
});

function modelOf(parts: Part[]): FurnitureModel {
    return {
        parts,
        hardware: [],
        fronts: [],
        sections: [],
        bbox: { min: [0, 0, 0], size: [0, 0, 0] },
        issues: [],
    };
}

const OPTIONS = bomOptionsFor(doc, true);

describe('computeBom: nesting issues and edge cases (08 §3.9)', () => {
    it('reports bom.part_exceeds_sheet for a part longer than the sheet', () => {
        const result = computeBom(
            modelOf([panel({ key: 'extra.long', length: 2500, width: 400 })]),
            catalog,
            OPTIONS,
        );
        expect(result.nesting!.unplaced).toEqual(['extra.long']);
        expect(result.issues).toEqual([
            {
                code: 'bom.part_exceeds_sheet',
                severity: 'error',
                messageKey: 'engine.bom.issue.part_exceeds_sheet',
                params: { partKey: 'extra.long', materialCode: PB },
                entityIds: ['extra.long'],
            },
        ]);
        expect(result.materials[0]).toMatchObject({
            sheetsNested: 0,
            sheetsBilled: 0,
            utilization: 0,
        });
    });

    it('reports a qty > 1 part once, per part key', () => {
        const result = computeBom(
            modelOf([
                panel({ key: 'extra.long', length: 2500, width: 400, qty: 2 }),
            ]),
            catalog,
            OPTIONS,
        );
        expect(result.nesting!.unplaced).toEqual([
            'extra.long',
            'extra.long#2',
        ]);
        expect(result.issues.map((i) => i.code)).toEqual([
            'bom.part_exceeds_sheet',
        ]);
    });

    it('skips glass: no nesting, sheetsNested null, billed from the estimate', () => {
        const result = computeBom(
            modelOf([
                panel({
                    key: 'glass.1',
                    materialCode: 'GLASS5-CLEAR',
                    thickness: 5,
                    length: 600,
                    width: 400,
                }),
            ]),
            catalog,
            OPTIONS,
        );
        expect(result.nesting).toMatchObject({ sheets: [], unplaced: [] });
        expect(result.materials[0]).toMatchObject({
            materialCode: 'GLASS5-CLEAR',
            sheetsNested: null,
            sheetsBilled: result.materials[0]!.sheetsEstimated,
            utilization: null,
        });
    });

    it('rounds the kerf up and honours allowRotation and the catalog default', () => {
        const kerfy = seedCatalog({ pricing: { kerfMm: 3.2 } });
        const parts = [panel({ key: 'p', length: 1200, width: 2000 })];
        const on = computeBom(modelOf(parts), kerfy, OPTIONS);
        expect(on.nesting).toMatchObject({ kerf: 4, unplaced: [] });
        const off = computeBom(modelOf(parts), kerfy, {
            ...OPTIONS,
            allowRotation: false,
        });
        expect(off.nesting!.unplaced).toEqual(['p']);
        const byDefault = computeBom(
            modelOf(parts),
            seedCatalog({ pricing: { nestingAllowRotationDefault: false } }),
            OPTIONS,
        );
        expect(byDefault.nesting!.unplaced).toEqual(['p']);
    });
});
