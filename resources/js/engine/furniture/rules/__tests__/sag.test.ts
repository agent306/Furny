import { describe, expect, it } from 'vitest';
import { BOARD_TYPES } from '../../../catalog/snapshot';
import { seedCatalog } from '../../../testing/seedCatalog';
import { createGenContext } from '../../context';
import { generateFurniture } from '../../generate';
import { makePart } from '../../parts';
import type { FurnitureDocument } from '../../schema';
import {
    assign,
    boxDocument,
    flex,
    leafSection,
    splitSection,
} from '../../testing/docs';
import type { FurnitureModel } from '../../types';
import { modelRules } from '../model';
import { SAG_TABLE, sagLimits } from '../sag';

const catalog = seedCatalog();

describe('SAG_TABLE (07 §7.2)', () => {
    it('holds every row of the table, thicknesses ascending per board type', () => {
        const rows = (type: string) =>
            (SAG_TABLE[type] ?? []).map((r) => [
                r.thickness,
                r.warn,
                r.critical,
            ]);
        expect(rows('particle_board')).toEqual([
            [16, 600, 800],
            [18, 800, 1000],
            [25, 1000, 1250],
        ]);
        expect(rows('mdf')).toEqual([
            [16, 650, 850],
            [18, 850, 1050],
            [25, 1050, 1300],
        ]);
        expect(rows('plywood')).toEqual([
            [12, 600, 800],
            [15, 800, 1000],
            [18, 1000, 1200],
            [25, 1200, 1500],
        ]);
        expect(rows('blockboard')).toEqual([
            [18, 1000, 1250],
            [25, 1200, 1500],
        ]);
        expect(rows('solid_wood')).toEqual([
            [18, 900, 1100],
            [25, 1200, 1500],
        ]);
        expect(rows('glass')).toEqual([
            [5, 500, 700],
            [8, 700, 900],
            [10, 800, 1000],
        ]);
        expect(rows('hdf')).toEqual([
            [3, 300, 400],
            [6, 400, 500],
        ]);
        expect(Object.keys(SAG_TABLE).sort()).toEqual([
            'blockboard',
            'glass',
            'hdf',
            'mdf',
            'particle_board',
            'plywood',
            'solid_wood',
        ]);
    });

    it('keeps board types of the catalog that have no row out of the table', () => {
        for (const type of ['acrylic', 'metal_sheet']) {
            expect(BOARD_TYPES).toContain(type);
            expect(SAG_TABLE[type]).toBeUndefined();
        }
    });
});

describe('sagLimits (07 §7.2 lookup)', () => {
    it('reads the row of an exact thickness', () => {
        expect(sagLimits('particle_board', 18, false)).toEqual({
            warn: 800,
            critical: 1000,
        });
        expect(sagLimits('plywood', 12, false)).toEqual({
            warn: 600,
            critical: 800,
        });
    });

    it('takes the largest row at or below the thickness', () => {
        expect(sagLimits('particle_board', 17, false)).toEqual({
            warn: 600,
            critical: 800,
        });
        expect(sagLimits('particle_board', 24, false)).toEqual({
            warn: 800,
            critical: 1000,
        });
        expect(sagLimits('particle_board', 25, false)).toEqual({
            warn: 1000,
            critical: 1250,
        });
        // above the largest row: that row
        expect(sagLimits('particle_board', 40, false)).toEqual({
            warn: 1000,
            critical: 1250,
        });
    });

    it('scales the smallest row by t / t_row below every row', () => {
        expect(sagLimits('hdf', 2, false)).toEqual({
            warn: (300 * 2) / 3,
            critical: (400 * 2) / 3,
        });
        expect(sagLimits('plywood', 6, false)).toEqual({
            warn: 300,
            critical: 400,
        });
        expect(sagLimits('particle_board', 8, false)).toEqual({
            warn: 300,
            critical: 400,
        });
    });

    it('uses 44 x t and 55 x t for a board type without rows', () => {
        expect(sagLimits('acrylic', 20, false)).toEqual({
            warn: 44 * 20,
            critical: 55 * 20,
        });
        expect(sagLimits('metal_sheet', 3, false)).toEqual({
            warn: 132,
            critical: 165,
        });
        // not a prototype key
        expect(sagLimits('constructor', 10, false)).toEqual({
            warn: 440,
            critical: 550,
        });
    });

    it('multiplies both limits by 1.5 for clamped shelves', () => {
        expect(sagLimits('particle_board', 18, true)).toEqual({
            warn: 1200,
            critical: 1500,
        });
        expect(sagLimits('hdf', 2, true)).toEqual({
            warn: 1.5 * ((300 * 2) / 3),
            critical: 1.5 * ((400 * 2) / 3),
        });
        expect(sagLimits('acrylic', 20, true)).toEqual({
            warn: 1320,
            critical: 1650,
        });
    });
});

/** Interior width of a 18 mm carcass box of `width`. */
const interior = (width: number): number => width - 36;

/** A one-leaf box holding one shelf; shelf length is `interior - 2` (adjustable) or `interior`. */
const shelfBox = (
    width: number,
    adjustable: boolean,
    shelfMaterial = 'PB18-WHITE',
): FurnitureDocument =>
    boxDocument({
        width,
        height: 720,
        depth: 400,
        content: { type: 'shelves', count: 1, adjustable, frontSetback: 20 },
        materials: { shelf: assign(shelfMaterial) },
    });

const sagIssues = (model: FurnitureModel) =>
    model.issues.filter((i) => i.code.startsWith('furniture.shelf_sag'));

const spanOf = (model: FurnitureModel, key: string): number | undefined =>
    model.parts.find((p) => p.key === key)?.length;

describe('shelf sag in a generated model (07 §12.4, PB18)', () => {
    const run = (
        width: number,
        adjustable: boolean,
        material?: string,
    ): { span: number | undefined; issues: FurnitureModel['issues'] } => {
        const model = generateFurniture(
            shelfBox(width, adjustable, material),
            catalog,
        );
        return {
            span: spanOf(model, 'section.s_0000000001.shelf.1'),
            issues: sagIssues(model),
        };
    };

    it('an adjustable shelf of span 800 is fine, 801 warns', () => {
        expect(run(838, true)).toEqual({ span: 800, issues: [] });
        const { span, issues } = run(839, true);
        expect(span).toBe(801);
        expect(issues).toEqual([
            {
                code: 'furniture.shelf_sag',
                severity: 'warning',
                messageKey: 'engine.furniture.issue.shelf_sag',
                params: {
                    partKey: 'section.s_0000000001.shelf.1',
                    span: 801,
                    limit: 800,
                },
                entityIds: ['section.s_0000000001.shelf.1'],
            },
        ]);
    });

    it('an adjustable shelf of span 1000 only warns, 1001 is critical', () => {
        const at1000 = run(1038, true);
        expect(at1000.span).toBe(1000);
        expect(at1000.issues.map((i) => i.code)).toEqual([
            'furniture.shelf_sag',
        ]);
        const at1001 = run(1039, true);
        expect(at1001.span).toBe(1001);
        expect(at1001.issues).toEqual([
            {
                code: 'furniture.shelf_sag_critical',
                severity: 'warning',
                messageKey: 'engine.furniture.issue.shelf_sag_critical',
                params: {
                    partKey: 'section.s_0000000001.shelf.1',
                    span: 1001,
                    limit: 1000,
                },
                entityIds: ['section.s_0000000001.shelf.1'],
            },
        ]);
    });

    it('a fixed (clamped) shelf has 1.5 x the limits: 1164 and 1200 are fine, 1201 warns', () => {
        expect(run(interior(1200) + 36, false)).toEqual({
            span: 1164,
            issues: [],
        });
        const at1200 = run(1236, false);
        expect(at1200).toEqual({ span: 1200, issues: [] });
        const at1201 = run(1237, false);
        expect(at1201.span).toBe(1201);
        expect(at1201.issues.map((i) => [i.code, i.params.limit])).toEqual([
            ['furniture.shelf_sag', 1200],
        ]);
        expect(
            run(1537, false).issues.map((i) => [i.code, i.params.limit]),
        ).toEqual([['furniture.shelf_sag_critical', 1500]]);
        expect(run(1536, false).issues.map((i) => i.code)).toEqual([
            'furniture.shelf_sag',
        ]);
    });

    it('MDF18 adjustable 900 warns (limit 850)', () => {
        const { span, issues } = run(938, true, 'MDF18-RAW');
        expect(span).toBe(900);
        expect(issues.map((i) => [i.code, i.params.limit])).toEqual([
            ['furniture.shelf_sag', 850],
        ]);
    });

    it('PLY18 adjustable 1100 warns only (limits 1000 / 1200)', () => {
        const { span, issues } = run(1138, true, 'PLY18-BWR');
        expect(span).toBe(1100);
        expect(issues.map((i) => [i.code, i.params.limit])).toEqual([
            ['furniture.shelf_sag', 1000],
        ]);
    });

    it('uses the material of the shelf part, not of the carcass', () => {
        // 25 mm shelves: 1000 / 1250 adjustable
        expect(run(1038, true, 'PB25-WHITE').issues).toEqual([]);
        expect(run(1039, true, 'PB25-WHITE').issues.map((i) => i.code)).toEqual(
            ['furniture.shelf_sag'],
        );
    });

    it('checks the fixed shelves between rows (clamped)', () => {
        const doc = boxDocument({
            width: 1237,
            height: 720,
            depth: 400,
            interior: splitSection('s_0000000001', 'rows', [
                [flex(), leafSection('s_0000000002')],
                [flex(), leafSection('s_0000000003')],
            ]),
        });
        const model = generateFurniture(doc, catalog);
        expect(spanOf(model, 'section.s_0000000001.fixed_shelf.1')).toBe(1201);
        expect(sagIssues(model)).toMatchObject([
            {
                code: 'furniture.shelf_sag',
                params: {
                    partKey: 'section.s_0000000001.fixed_shelf.1',
                    span: 1201,
                    limit: 1200,
                },
            },
        ]);
        const fine = generateFurniture(
            boxDocument({
                width: 1236,
                height: 720,
                depth: 400,
                interior: splitSection('s_0000000001', 'rows', [
                    [flex(), leafSection('s_0000000002')],
                    [flex(), leafSection('s_0000000003')],
                ]),
            }),
            catalog,
        );
        expect(sagIssues(fine)).toEqual([]);
    });

    it('measures the span along x even when the shelf is deeper than wide', () => {
        // 300 wide inside, 560 deep: part length is the depth, the span stays 300
        const model = generateFurniture(
            boxDocument({
                width: 336,
                height: 720,
                depth: 700,
                content: {
                    type: 'shelves',
                    count: 1,
                    adjustable: true,
                    frontSetback: 20,
                },
            }),
            catalog,
        );
        const shelf = model.parts.find(
            (p) => p.key === 'section.s_0000000001.shelf.1',
        );
        expect(shelf?.length).toBeGreaterThan(500);
        expect(sagIssues(model)).toEqual([]);
    });

    it('orders several findings by part key', () => {
        const doc = boxDocument({
            width: 1100,
            height: 1200,
            depth: 400,
            content: {
                type: 'shelves',
                count: 3,
                adjustable: true,
                frontSetback: 20,
            },
        });
        const keys = sagIssues(generateFurniture(doc, catalog)).map(
            (i) => i.entityIds[0],
        );
        expect(keys).toEqual([
            'section.s_0000000001.shelf.1',
            'section.s_0000000001.shelf.2',
            'section.s_0000000001.shelf.3',
        ]);
    });
});

describe('shelf sag for table shelves (07 §7.2: table lower and cabinet shelves)', () => {
    const tableDoc = (
        content: NonNullable<
            NonNullable<FurnitureDocument['table']>['storage']['endCabinets']
        >['content'] = { type: 'empty' },
    ): FurnitureDocument => ({
        ...boxDocument({ width: 1600, height: 740, depth: 800 }),
        family: 'table',
        carcass: null,
        table: {
            top: {
                shape: 'rectangle',
                thickness: 'material',
                cornerRadius: 0,
                overhang: 0,
            },
            base: {
                type: 'cabinet_ends',
                legSource: 'hardware',
                legCode: null,
                legSection: 50,
                apron: { enabled: false, height: 80, inset: 0 },
                stretcher: false,
            },
            storage: {
                drawers: null,
                lowerShelf: true,
                endCabinets: { width: 500, content },
            },
        },
    });

    /** Runs the model rules on a context holding one shelf part of `length` x 400. */
    const rulesFor = (doc: FurnitureDocument, key: string, length: number) => {
        const ctx = createGenContext(doc, catalog);
        ctx.parts.push(
            makePart(
                {
                    key,
                    nameKey: 'parts.shelf',
                    role: 'shelf',
                    materialCode: 'PB18-WHITE',
                    box: { min: [0, 100, 0], size: [length, 18, 400] },
                    thicknessAxis: 'y',
                    grainAxis: 'x',
                    banded: ['front'],
                    visibleFaces: 2,
                },
                ctx,
            ),
        );
        modelRules(ctx);
        return ctx.issues
            .filter((i) => i.code.startsWith('furniture.shelf_sag'))
            .map((i) => [i.code, i.params.limit]);
    };

    it('treats the lower shelf as fixed (clamped limits)', () => {
        expect(rulesFor(tableDoc(), 'table.shelf', 1200)).toEqual([]);
        expect(rulesFor(tableDoc(), 'table.shelf', 1201)).toEqual([
            ['furniture.shelf_sag', 1200],
        ]);
    });

    it('treats an adjustable cabinet shelf as loose and a fixed one as clamped', () => {
        const adjustable = tableDoc({
            type: 'shelves',
            count: 1,
            adjustable: true,
            frontSetback: 20,
        });
        const fixedShelves = tableDoc({
            type: 'shelves',
            count: 1,
            adjustable: false,
            frontSetback: 20,
        });
        expect(rulesFor(adjustable, 'table.cabinet.shelf.1', 801)).toEqual([
            ['furniture.shelf_sag', 800],
        ]);
        expect(rulesFor(fixedShelves, 'table.cabinet.shelf.1', 801)).toEqual(
            [],
        );
    });
});
