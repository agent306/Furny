import { describe, expect, it } from 'vitest';
import { mutateCatalog, seedCatalog } from '../../testing/seedCatalog';
import { BOM_ISSUE_CODES, nestSheets } from '../nesting';
import type { CutListRow } from '../types';

const catalog = seedCatalog();
const OPTS = { kerf: 4, trim: 10, allowRotation: true };

function row(over: Partial<CutListRow> = {}): CutListRow {
    return {
        rowKey: 'r00000001',
        partKeys: ['p'],
        name: 'P',
        nameKey: 'parts.extra',
        nameParams: {},
        materialCode: 'PB18-WHITE',
        thickness: 18,
        length: 800,
        width: 400,
        cutLength: 800,
        cutWidth: 400,
        qty: 1,
        grain: 'none',
        edges: { L1: null, L2: null, W1: null, W2: null },
        ...over,
    };
}

describe('nestSheets (08 §5.4)', () => {
    it('lists the BOM issue codes', () => {
        expect(BOM_ISSUE_CODES).toEqual(['bom.part_exceeds_sheet']);
    });

    it('expands qty into instance keys key, key#2, key#3', () => {
        const res = nestSheets(
            [row({ qty: 3 })],
            new Map([['p', 3]]),
            catalog,
            OPTS,
        );
        const keys = res.sheets.flatMap((s) =>
            s.placements.map((p) => p.partKey),
        );
        expect(keys.sort()).toEqual(['p', 'p#2', 'p#3']);
        expect(res).toMatchObject({ kerf: 4, trim: 10, unplaced: [] });
    });

    it('nests per material and reports unplaced instances sorted', () => {
        const res = nestSheets(
            [
                row({ rowKey: 'r2', partKeys: ['z'], cutLength: 3000 }),
                row({
                    rowKey: 'r1',
                    partKeys: ['b'],
                    materialCode: 'HDF3-WHITE',
                }),
                row({ rowKey: 'r3', partKeys: ['a'], cutLength: 3000 }),
            ],
            new Map([
                ['z', 2],
                ['b', 1],
                ['a', 1],
            ]),
            catalog,
            OPTS,
        );
        expect(res.sheets.map((s) => s.materialCode)).toEqual(['HDF3-WHITE']);
        expect(res.unplaced).toEqual(['a', 'z', 'z#2']);
    });

    it('orders sheets by material code', () => {
        const res = nestSheets(
            [
                row({
                    rowKey: 'r1',
                    partKeys: ['b'],
                    materialCode: 'PB18-WHITE',
                }),
                row({
                    rowKey: 'r2',
                    partKeys: ['a'],
                    materialCode: 'HDF3-WHITE',
                }),
            ],
            new Map([
                ['a', 1],
                ['b', 1],
            ]),
            catalog,
            OPTS,
        );
        expect(res.sheets.map((s) => s.materialCode)).toEqual([
            'HDF3-WHITE',
            'PB18-WHITE',
        ]);
    });

    it('skips glass', () => {
        const res = nestSheets(
            [row({ materialCode: 'GLASS5-CLEAR' })],
            new Map([['p', 1]]),
            catalog,
            OPTS,
        );
        expect(res.sheets).toEqual([]);
        expect(res.unplaced).toEqual([]);
    });

    it('locks the orientation by grain only when the material has grain', () => {
        const grainy = mutateCatalog(catalog, (c) => {
            c.materials.find((m) => m.code === 'PB18-WHITE')!.hasGrain = true;
        });
        const rows = [row({ grain: 'width', cutLength: 600, cutWidth: 300 })];
        const qty = new Map([['p', 1]]);
        const noRotation = { ...OPTS, allowRotation: false };
        expect(
            nestSheets(rows, qty, grainy, noRotation).sheets[0]!.placements[0]!
                .rotated,
        ).toBe(true);
        expect(
            nestSheets(rows, qty, catalog, noRotation).sheets[0]!.placements[0]!
                .rotated,
        ).toBe(false);
    });

    it('rotates only when rotation is allowed', () => {
        // 2000 long only fits the 1200 high usable side after turning
        const rows = [row({ cutLength: 1200, cutWidth: 2000 })];
        const qty = new Map([['p', 1]]);
        expect(nestSheets(rows, qty, catalog, OPTS).unplaced).toEqual([]);
        expect(
            nestSheets(rows, qty, catalog, { ...OPTS, allowRotation: false })
                .unplaced,
        ).toEqual(['p']);
    });
});
