import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generateFurniture } from '../../furniture/generate';
import { FurnitureDocumentSchema } from '../../furniture/schema';
import type { FurnitureModel, HardwareLine, Part } from '../../furniture/types';
import type { Issue } from '../../plan/types';
import { seedCatalog } from '../../testing/seedCatalog';
import { wardrobeFixture } from '../../furniture/testing/docs';
import { bomOptionsFor, computeBom, mergeIssues } from '../bom';
import type { ComputeBomOptions } from '../types';
import { NO_EDGES, panel } from './panel';

const catalog = seedCatalog();

const OFF: ComputeBomOptions = {
    nesting: false,
    finishByRole: {
        carcass: null,
        back: null,
        shelf: null,
        front: null,
        top: null,
        drawer_box: null,
        drawer_bottom: null,
        plinth: null,
        leg: null,
    },
};

function model(
    parts: Part[],
    extra: { hardware?: HardwareLine[]; issues?: Issue[] } = {},
): FurnitureModel {
    return {
        parts,
        hardware: extra.hardware ?? [],
        fronts: [],
        sections: [],
        bbox: { min: [0, 0, 0], size: [0, 0, 0] },
        issues: extra.issues ?? [],
    };
}

function hw(key: string, code: string, qty: number): HardwareLine {
    return {
        key,
        code,
        qty,
        reasonKey: 'hardware.reason.extra',
        reasonParams: {},
        frontId: null,
        sectionId: null,
        source: 'extra',
        overridden: false,
    };
}

function issue(code: string, entityIds: string[], n = 0): Issue {
    return {
        code,
        severity: 'warning',
        messageKey: `issues.${code}`,
        params: { n },
        entityIds,
    };
}

const named = (key: string, name: string, over: Partial<Part> = {}): Part =>
    panel({ key, nameKey: 'parts.extra', nameParams: { name }, ...over });

describe('bomOptionsFor (08 §3)', () => {
    it('takes the finish code of every role from the document', () => {
        const doc = wardrobeFixture((d) => {
            d.materials.front.finishCode = 'FIN-PU-MATT';
            d.materials.carcass.finishCode = 'FIN-LAM-MATT';
        });
        expect(bomOptionsFor(doc, true)).toEqual({
            nesting: true,
            finishByRole: {
                carcass: 'FIN-LAM-MATT',
                back: null,
                shelf: null,
                front: 'FIN-PU-MATT',
                top: null,
                drawer_box: null,
                drawer_bottom: null,
                plinth: null,
                leg: null,
            },
        });
    });
});

describe('computeBom: cut list rows (08 §3.4)', () => {
    it('merges identical parts: sorted keys once each, qty summed, fields from the first key', () => {
        const bom = computeBom(
            model([
                named('b', 'Bee', {
                    qty: 3,
                    edges: { ...NO_EDGES, L2: 'EB08-WHITE' },
                }),
                named('a', 'Ay', { edges: { ...NO_EDGES, L1: 'EB08-WHITE' } }),
            ]),
            catalog,
            OFF,
        );
        expect(bom.cutList).toHaveLength(1);
        expect(bom.cutList[0]).toMatchObject({
            partKeys: ['a', 'b'],
            qty: 4,
            name: 'Ay / Bee',
            nameKey: 'parts.extra',
            nameParams: { name: 'Ay' },
            edges: { L1: 'EB08-WHITE', L2: null, W1: null, W2: null },
            length: 1000,
            width: 500,
            cutLength: 1000,
            cutWidth: 499,
        });
    });

    it('lists unique names only and shortens beyond three', () => {
        const parts = ['a', 'b', 'c', 'd', 'e', 'f'].map((k, i) =>
            named(k, i < 2 ? 'Same' : `Name ${k}`),
        );
        const bom = computeBom(model(parts), catalog, OFF);
        // unique: Same, Name c, Name d, Name e, Name f → 3 + "+2 more"
        expect(bom.cutList[0]!.name).toBe('Same / Name c / Name d +2 more');
        const three = computeBom(model(parts.slice(0, 4)), catalog, OFF);
        expect(three.cutList[0]!.name).toBe('Same / Name c / Name d');
    });

    it('orders rows by material asc, thickness desc, length desc, width desc, rowKey', () => {
        const bom = computeBom(
            model([
                named('p1', 'p1', { length: 500, width: 400 }),
                named('p2', 'p2', { length: 800, width: 300 }),
                named('p3', 'p3', { length: 800, width: 350 }),
                named('p4', 'p4', {
                    materialCode: 'HDF3-WHITE',
                    thickness: 3,
                    length: 100,
                    width: 100,
                }),
                named('p5', 'p5', {
                    materialCode: 'PB25-WHITE',
                    thickness: 25,
                    length: 50,
                    width: 50,
                }),
                named('p6', 'p6', { thickness: 19, length: 60, width: 60 }),
            ]),
            catalog,
            OFF,
        );
        expect(bom.cutList.map((r) => r.partKeys[0])).toEqual([
            'p4',
            'p6',
            'p3',
            'p2',
            'p1',
            'p5',
        ]);
    });

    it('suffixes the later identity of a hash collision with -2', () => {
        // FNV-1a collision: both identities hash to 0xe389dbf9
        const bom = computeBom(
            model([
                named('x', 'x', { length: 535, width: 296 }),
                named('y', 'y', { length: 1232, width: 420 }),
            ]),
            catalog,
            OFF,
        );
        expect(bom.cutList.map((r) => [r.partKeys[0], r.rowKey])).toEqual([
            ['y', 're389dbf9'],
            ['x', 're389dbf9-2'],
        ]);
    });

    it('keeps the pieces of a split panel as ordinary parts of the cut list', () => {
        const pieces = [1, 2].map((n) =>
            panel({
                key: `carcass.top.${n}`,
                nameKey: 'parts.top',
                nameParams: { piece: n },
                length: 1500,
                width: 582,
                edges: { ...NO_EDGES, L1: 'EB08-WHITE' },
            }),
        );
        const third = panel({
            key: 'carcass.top.3',
            nameKey: 'parts.top',
            nameParams: { piece: 3 },
            length: 900,
            width: 582,
            edges: { ...NO_EDGES, L1: 'EB08-WHITE' },
        });
        const bom = computeBom(model([...pieces, third]), catalog, OFF);
        expect(
            bom.cutList.map((r) => [r.name, r.partKeys, r.qty, r.cutWidth]),
        ).toEqual([
            ['Top 1 / Top 2', ['carcass.top.1', 'carcass.top.2'], 2, 581],
            ['Top 3', ['carcass.top.3'], 1, 581],
        ]);
    });
});

describe('computeBom: materials, finishing, hardware, issues (08 §3.5–§3.9)', () => {
    it('estimates sheets with the material waste factor', () => {
        // PB18-OAK: 2440 × 1220, waste 0.12; 2 × 1000 × 500 = 1 000 000 mm²
        const bom = computeBom(
            model([
                named('a', 'a', {
                    materialCode: 'PB18-OAK',
                    qty: 2,
                }),
            ]),
            catalog,
            OFF,
        );
        expect(bom.materials).toEqual([
            {
                materialCode: 'PB18-OAK',
                partCount: 2,
                netAreaMm2: 1000000,
                sheetsEstimated: 1,
                sheetsNested: null,
                sheetsBilled: 1,
                utilization: null,
            },
        ]);
    });

    it('rounds the sheet estimate up exactly at the boundary', () => {
        // one sheet = 2 976 800 mm²; with 10 % waste, 2 706 181 mm² still fits, 2 706 182 does not
        const exact = (area: number) =>
            computeBom(
                model([named('a', 'a', { length: area, width: 1 })]),
                catalog,
                OFF,
            ).materials[0]!.sheetsEstimated;
        expect(exact(2706181)).toBe(1);
        expect(exact(2706182)).toBe(2);
    });

    it('estimates 0 sheets for a material the catalog does not know', () => {
        const bom = computeBom(
            model([named('a', 'a', { materialCode: 'NOPE' })]),
            catalog,
            OFF,
        );
        expect(bom.materials[0]).toMatchObject({
            materialCode: 'NOPE',
            netAreaMm2: 500000,
            sheetsEstimated: 0,
            sheetsBilled: 0,
        });
    });

    it('finishes visible faces × qty per finish code and drops zero areas', () => {
        const options: ComputeBomOptions = {
            ...OFF,
            finishByRole: {
                ...OFF.finishByRole,
                carcass: 'FIN-PU-MATT',
                front: 'FIN-LAM-MATT',
                shelf: 'FIN-DUCO',
            },
        };
        const bom = computeBom(
            model([
                named('a', 'a', { role: 'carcass', visibleFaces: 1, qty: 2 }),
                named('b', 'b', { role: 'front', visibleFaces: 2 }),
                named('c', 'c', { role: 'shelf', visibleFaces: 0 }),
                named('d', 'd', { role: 'back', visibleFaces: 2 }),
            ]),
            catalog,
            options,
        );
        expect(bom.finishing).toEqual([
            { finishCode: 'FIN-LAM-MATT', areaMm2: 1000000 },
            { finishCode: 'FIN-PU-MATT', areaMm2: 1000000 },
        ]);
    });

    it('sums operations × qty', () => {
        const ops = { ...panel().operations, dowels: 2, hingeCups: 1 };
        const bom = computeBom(
            model([named('a', 'a', { operations: ops, qty: 3 })]),
            catalog,
            OFF,
        );
        expect(bom.operations).toMatchObject({ dowels: 6, hingeCups: 3 });
    });

    it('merges hardware by code, drops lines with qty ≤ 0, sorts by code', () => {
        const bom = computeBom(
            model([], {
                hardware: [
                    hw('k1', 'SCR-PACK', 1),
                    hw('k2', 'CON-CAM-15', 4),
                    hw('k3', 'SCR-PACK', 2),
                    hw('k4', 'ROD-SUP', 0),
                    hw('k5', 'HNG-FO-SC', 2),
                    hw('k6', 'HNG-FO-SC', -2),
                ],
            }),
            catalog,
            OFF,
        );
        expect(bom.hardware).toEqual([
            { code: 'CON-CAM-15', qty: 4 },
            { code: 'SCR-PACK', qty: 3 },
        ]);
    });

    it('returns empty lists for an empty model', () => {
        const bom = computeBom(model([]), catalog, OFF);
        expect(bom).toMatchObject({
            cutList: [],
            materials: [],
            edgeBanding: [],
            hardware: [],
            finishing: [],
            nesting: null,
            issues: [],
        });
    });

    it('copies the model issues', () => {
        const issues = [
            issue('furniture.a', ['p1']),
            issue('furniture.a', ['p1'], 1),
        ];
        const bom = computeBom(model([], { issues }), catalog, OFF);
        expect(bom.issues).toEqual(issues);
        expect(bom.issues).not.toBe(issues);
    });

    it('appends BOM issues not already present by code + entityIds', () => {
        const base = [issue('furniture.a', ['p1'])];
        expect(
            mergeIssues(base, [
                issue('bom.x', ['p1']),
                issue('furniture.a', ['p1'], 9),
                issue('bom.x', ['p1'], 2),
                issue('bom.x', ['p2']),
            ]),
        ).toEqual([
            issue('furniture.a', ['p1']),
            issue('bom.x', ['p1']),
            issue('bom.x', ['p2']),
        ]);
    });

    it('throws for nesting until Task 43 wires it', () => {
        expect(() =>
            computeBom(model([]), catalog, { ...OFF, nesting: true }),
        ).toThrow('nesting not implemented');
    });

    it('applies the catalog pre-mill allowance to cut sizes', () => {
        const premill = seedCatalog({ pricing: { edgePremillMm: 1 } });
        const bom = computeBom(
            model([
                named('a', 'a', { edges: { ...NO_EDGES, L1: 'EB08-WHITE' } }),
            ]),
            premill,
            OFF,
        );
        expect(bom.cutList[0]).toMatchObject({
            cutLength: 1000,
            cutWidth: 500,
        });
    });

    it('does not mutate its inputs', () => {
        const parts = [named('b', 'b'), named('a', 'a')];
        const m = model(parts, { hardware: [hw('k', 'SCR-PACK', 1)] });
        const before = JSON.stringify(m);
        computeBom(m, catalog, OFF);
        expect(JSON.stringify(m)).toBe(before);
    });
});

describe('computeBom: every furniture fixture', () => {
    const dir = new URL(
        '../../../../../database/fixtures/furniture/',
        import.meta.url,
    );
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));

    it.each(files)('%s: rows cover every part once, totals agree', (file) => {
        const doc = FurnitureDocumentSchema.parse(
            JSON.parse(readFileSync(new URL(file, dir), 'utf8')),
        );
        const m = generateFurniture(doc, catalog);
        const bom = computeBom(m, catalog, bomOptionsFor(doc, false));
        const keys = bom.cutList.flatMap((r) => r.partKeys);
        expect([...keys].sort()).toEqual(m.parts.map((p) => p.key).sort());
        expect(new Set(bom.cutList.map((r) => r.rowKey)).size).toBe(
            bom.cutList.length,
        );
        const qty = (rows: Array<{ qty: number }>) =>
            rows.reduce((s, r) => s + r.qty, 0);
        expect(qty(bom.cutList)).toBe(qty(m.parts));
        expect(bom.materials.reduce((s, x) => s + x.partCount, 0)).toBe(
            qty(m.parts),
        );
        for (const row of bom.cutList) {
            expect(row.cutLength).toBeGreaterThan(0);
            expect(row.cutWidth).toBeGreaterThan(0);
            expect(row.cutLength).toBeLessThanOrEqual(row.length);
            expect(row.cutWidth).toBeLessThanOrEqual(row.width);
        }
        for (const band of bom.edgeBanding) {
            expect(Number.isSafeInteger(band.lengthMm)).toBe(true);
            expect(band.lengthMm).toBeGreaterThan(0);
        }
        expect(bom.issues).toEqual(m.issues);
    });
});
