import { describe, expect, it } from 'vitest';
import { generateFurniture } from '../../furniture/generate';
import { wardrobeFixture } from '../../furniture/testing/docs';
import { seedCatalog } from '../../testing/seedCatalog';
import { bomOptionsFor, computeBom } from '../bom';
import type { CutListRow } from '../types';

/**
 * 08 §10.2 without nesting (Task 43 adds it): the wardrobe fixture against
 * the seed catalog.
 */
const catalog = seedCatalog();
const doc = wardrobeFixture();
const model = generateFurniture(doc, catalog);
const bom = computeBom(model, catalog, bomOptionsFor(doc, false));

const HDF = 'HDF3-WHITE';
const PB = 'PB18-WHITE';
const B = 'EB08-WHITE';

type RowSummary = [
    material: string,
    length: number,
    width: number,
    cutLength: number,
    cutWidth: number,
    qty: number,
    name: string,
];

const summary = (row: CutListRow): RowSummary => [
    row.materialCode,
    row.length,
    row.width,
    row.cutLength,
    row.cutWidth,
    row.qty,
    row.name,
];

describe('computeBom: wardrobe fixture (08 §10.2, nesting off)', () => {
    it('has 12 cut list rows in material / thickness / size order', () => {
        const rows = bom.cutList.map(summary);
        expect(rows).toHaveLength(12);
        expect(rows.slice(0, 6)).toEqual([
            [HDF, 1978, 1180, 1978, 1180, 1, 'Back panel 2'],
            [HDF, 1978, 598, 1978, 598, 1, 'Back panel 1'],
            [PB, 2000, 582, 1999, 581, 2, 'Left side / Right side'],
            [PB, 1997, 606, 1995, 604, 1, 'Door 1'],
            [PB, 1997, 593, 1995, 591, 2, 'Door 1 / Door 2'],
            [PB, 1964, 569, 1964, 568, 1, 'Partition 1'],
        ]);
        // plinth front and back tie on finished size; their order follows rowKey
        expect(rows.slice(6, 8)).toEqual(
            expect.arrayContaining([
                [PB, 1800, 100, 1798, 100, 1, 'Plinth front'],
                [PB, 1800, 100, 1800, 100, 1, 'Plinth back'],
            ]),
        );
        expect(bom.cutList[6]!.rowKey < bom.cutList[7]!.rowKey).toBe(true);
        expect(rows.slice(8)).toEqual([
            // 08 §3.4 step 4: names in key order (carcass.bottom < carcass.top)
            [PB, 1764, 582, 1764, 581, 2, 'Bottom / Top'],
            [PB, 1164, 569, 1164, 568, 1, 'Fixed shelf 1'],
            [PB, 580, 549, 580, 548, 4, 'Shelf 1 / Shelf 2 / Shelf 3 +1 more'],
            [
                PB,
                526,
                100,
                526,
                100,
                3,
                'Plinth return 1 / Plinth return 2 / Plinth return 3',
            ],
        ]);
    });

    it('fills every row from its first part and lists all part keys once', () => {
        const sides = bom.cutList[2]!;
        expect(sides).toMatchObject({
            partKeys: ['carcass.side.left', 'carcass.side.right'],
            nameKey: 'parts.side_left',
            nameParams: {},
            thickness: 18,
            grain: 'none',
            edges: { L1: B, L2: null, W1: B, W2: null },
        });
        expect(sides.rowKey).toMatch(/^r[0-9a-f]{8}$/);
        expect(bom.cutList[10]!.partKeys).toEqual([
            'section.s_0000000002.shelf.1',
            'section.s_0000000002.shelf.2',
            'section.s_0000000002.shelf.3',
            'section.s_0000000002.shelf.4',
        ]);
        const keys = bom.cutList.flatMap((r) => r.partKeys).sort();
        expect(keys).toEqual(model.parts.map((p) => p.key).sort());
        expect(new Set(bom.cutList.map((r) => r.rowKey)).size).toBe(12);
    });

    it('needs 32 767 mm of EB08-WHITE (raw 31 206 incl. 26 × 50 mm, + 5 %)', () => {
        expect(bom.edgeBanding).toEqual([{ edgeBandCode: B, lengthMm: 32767 }]);
    });

    it('estimates sheets per material without nesting', () => {
        expect(bom.materials).toEqual([
            {
                materialCode: HDF,
                partCount: 2,
                netAreaMm2: 3516884,
                sheetsEstimated: 2,
                sheetsNested: null,
                sheetsBilled: 2,
                utilization: null,
            },
            {
                materialCode: PB,
                partCount: 18,
                netAreaMm2: 11531232,
                sheetsEstimated: 5,
                sheetsNested: null,
                sheetsBilled: 5,
                utilization: null,
            },
        ]);
    });

    it('sums the operations of every part', () => {
        expect(bom.operations).toEqual({
            hingeCups: 12,
            shelfPinHoles: 232,
            dowels: 16,
            camLocks: 16,
            slideScrewSets: 0,
            handleHoles: 6,
        });
    });

    it('merges the hardware by code, code ascending (11 codes)', () => {
        expect(bom.hardware).toEqual([
            { code: 'BRK-ANTITIP', qty: 1 },
            { code: 'CON-CAM-15', qty: 16 },
            { code: 'CON-DOWEL-8', qty: 16 },
            { code: 'HDL-BAR-160', qty: 3 },
            { code: 'HNG-FO-SC', qty: 8 },
            { code: 'HNG-HO-SC', qty: 4 },
            { code: 'HNG-PLATE-0', qty: 12 },
            { code: 'ROD-OVAL-1200', qty: 1 },
            { code: 'ROD-SUP', qty: 2 },
            { code: 'SCR-PACK', qty: 1 },
            { code: 'SHF-PIN-5', qty: 16 },
        ]);
    });

    it('has no finishing without finish codes', () => {
        expect(bom.finishing).toEqual([]);
    });

    it('finishes the 3 door leaves on both faces with a front finish', () => {
        const finished = wardrobeFixture((d) => {
            d.materials.front.finishCode = 'FIN-LAM-MATT';
        });
        const result = computeBom(
            generateFurniture(finished, catalog),
            catalog,
            bomOptionsFor(finished, false),
        );
        // 2 × (1997 × 606 + 2 × 1997 × 593) = 7 157 248
        expect(result.finishing).toEqual([
            { finishCode: 'FIN-LAM-MATT', areaMm2: 7157248 },
        ]);
    });

    it('stamps versions, has no nesting and carries the model issues', () => {
        expect(bom.engineVersion).toBe('1.0.0');
        expect(bom.catalogVersion).toBe(1);
        expect(bom.nesting).toBeNull();
        expect(bom.issues).toEqual(model.issues);
    });

    it('is deterministic', () => {
        expect(computeBom(model, catalog, bomOptionsFor(doc, false))).toEqual(
            bom,
        );
    });
});
