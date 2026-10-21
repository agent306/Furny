/**
 * The 4 table templates (07 §2.4.14-§2.4.17) and the complete registry.
 * Expected documents are written out from the spec text (the table specs of
 * `testing/docs.ts` are the §2.4.14 / §2.4.15 defaults).
 */
import { describe, expect, it } from 'vitest';
import { testIds } from '../../../testing/ids';
import { seedCatalog } from '../../../testing/seedCatalog';
import { indexCatalog } from '../../catalogIndex';
import {
    FurnitureDocumentSchema,
    TEMPLATE_KEYS,
    type FurnitureDocument,
    type TableSpec,
} from '../../schema';
import {
    defaultMaterials,
    diningTable,
    studyDesk,
    tableDocument,
} from '../../testing/docs';
import { validateFurniture } from '../../validate';
import { TEMPLATES, getTemplate, templateDefaultDocument } from '../index';
import type { TemplateContext, TemplateDefinition } from '../types';

const snapshot = seedCatalog();
const catalog = indexCatalog(snapshot);
const ctx = (): TemplateContext => ({ catalog, newId: testIds() });

const TABLE_KEYS = [
    'study_desk',
    'dining_table',
    'coffee_table',
    'console_table',
] as const;
type TableKey = (typeof TABLE_KEYS)[number];

const template = (key: TableKey): TemplateDefinition => TEMPLATES[key];

/** The template's document for its defaults overridden by `over`. */
function gen(key: TableKey, over: Record<string, unknown> = {}) {
    const t = template(key);
    return t.generate({ ...t.defaults, ...over }, ctx());
}

function tableOf(doc: FurnitureDocument): TableSpec {
    if (!doc.table) throw new Error('no table spec');
    return doc.table;
}

// --- Expected definitions (written out from §2.4, not taken from common.ts) ---

const labelOf = (key: string) => `templates.fields.${key}`;
const L = (key: string, min: number, max: number, step = 10, extra = {}) => ({
    key,
    kind: 'length',
    labelKey: labelOf(key),
    min,
    max,
    step,
    ...extra,
});
const I = (key: string, min: number, max: number, extra = {}) => ({
    key,
    kind: 'int',
    labelKey: labelOf(key),
    min,
    max,
    ...extra,
});
const SEL = (key: string, values: string[], extra = {}) => ({
    key,
    kind: 'select',
    labelKey: labelOf(key),
    options: values.map((value) => ({
        value,
        labelKey: `templates.options.${value}`,
    })),
    ...extra,
});
const B = (key: string, extra = {}) => ({
    key,
    kind: 'boolean',
    labelKey: labelOf(key),
    ...extra,
});

const SHAPES = ['rectangle', 'rounded_rectangle', 'round', 'oval'];
/** A round top has depth = width: the depth field is hidden for it. */
const NOT_ROUND = {
    key: 'shape',
    equals: ['rectangle', 'rounded_rectangle', 'oval'],
};
const CABINET_ENDS = { key: 'base', equals: 'cabinet_ends' };

/** key -> [category, the complete field list in UI order]. */
const SPEC: Record<TableKey, [string, unknown[]]> = {
    study_desk: [
        'desk',
        [
            L('width', 800, 2400),
            L('height', 700, 780, 5),
            L('depth', 450, 800),
            SEL('base', ['cabinet_ends', 'panel_ends', 'four_legs']),
            L('cabinetWidth', 300, 600, 10, { visibleIf: CABINET_ENDS }),
            SEL('cabinetContent', ['drawers', 'shelves'], {
                visibleIf: CABINET_ENDS,
            }),
            B('topDrawer'),
        ],
    ],
    dining_table: [
        'table',
        [
            L('width', 900, 3000),
            L('height', 700, 780, 5),
            L('depth', 700, 1200, 10, { visibleIf: NOT_ROUND }),
            SEL('shape', SHAPES),
            SEL('base', ['four_legs', 'trestle', 'pedestal']),
            SEL('legSource', ['solid', 'hardware']),
        ],
    ],
    coffee_table: [
        'table',
        [
            L('width', 500, 1600),
            L('height', 300, 500),
            L('depth', 400, 900, 10, { visibleIf: NOT_ROUND }),
            SEL('shape', SHAPES),
            B('lowerShelf'),
        ],
    ],
    console_table: [
        'table',
        [
            L('width', 600, 1800),
            L('height', 700, 900),
            L('depth', 360, 450),
            I('drawers', 0, 3),
        ],
    ],
};

const DEFAULTS: Record<TableKey, Record<string, unknown>> = {
    study_desk: {
        width: 1200,
        height: 750,
        depth: 600,
        base: 'cabinet_ends',
        cabinetWidth: 400,
        cabinetContent: 'drawers',
        topDrawer: false,
    },
    dining_table: {
        width: 1800,
        height: 750,
        depth: 900,
        shape: 'rectangle',
        base: 'four_legs',
        legSource: 'solid',
    },
    coffee_table: {
        width: 1000,
        height: 420,
        depth: 550,
        shape: 'rectangle',
        lowerShelf: true,
    },
    console_table: { width: 1200, height: 800, depth: 400, drawers: 2 },
};

const PREFERRED: Record<TableKey, unknown> = {
    study_desk: { top: ['PB25-WHITE'] },
    dining_table: { top: ['PB25-WHITE'], leg: ['SW50-RUBBER'] },
    coffee_table: undefined,
    console_table: undefined,
};

/** A table spec with no storage, from the parts the §2.4 table changes. */
function spec(
    top: Partial<TableSpec['top']>,
    base: Partial<TableSpec['base']>,
    storage: Partial<TableSpec['storage']> = {},
): TableSpec {
    return {
        top: {
            shape: 'rectangle',
            thickness: 'material',
            cornerRadius: 0,
            overhang: 0,
            ...top,
        },
        base: {
            type: 'four_legs',
            legSource: 'solid',
            legCode: null,
            legSection: 50,
            apron: { enabled: false, height: 0, inset: 0 },
            stretcher: false,
            ...base,
        },
        storage: {
            drawers: null,
            lowerShelf: false,
            endCabinets: null,
            ...storage,
        },
    };
}

const errorsOf = (doc: FurnitureDocument) =>
    validateFurniture(doc, snapshot).filter((i) => i.severity === 'error');

// --- Registry -------------------------------------------------------------------

describe('TEMPLATES registry (07 §2)', () => {
    it('is complete: 19 keys, one per TemplateKey', () => {
        expect(Object.keys(TEMPLATES).length).toBe(19);
        expect(Object.keys(TEMPLATES).sort()).toStrictEqual(
            [...TEMPLATE_KEYS].sort(),
        );
        for (const key of TEMPLATE_KEYS) {
            expect(getTemplate(key).key).toBe(key);
        }
    });
});

describe.each(TABLE_KEYS)('%s definition', (key) => {
    const t = () => template(key);

    it('metadata: family table, category, i18n keys and thumbnail', () => {
        expect({
            key: t().key,
            family: t().family,
            category: t().category,
            nameKey: t().nameKey,
            descriptionKey: t().descriptionKey,
            thumbnail: t().thumbnail,
        }).toStrictEqual({
            key,
            family: 'table',
            category: SPEC[key][0],
            nameKey: `templates.${key}.name`,
            descriptionKey: `templates.${key}.description`,
            thumbnail: `/images/templates/${key}.svg`,
        });
    });

    it('fields in UI order with the §2.4 ranges', () => {
        expect(t().fields).toStrictEqual(SPEC[key][1]);
    });

    it('defaults, accepted by paramsSchema', () => {
        expect(t().defaults).toStrictEqual(DEFAULTS[key]);
        expect(t().paramsSchema.safeParse(t().defaults).success).toBe(true);
    });

    it('preferred materials', () => {
        expect(t().preferredMaterials).toStrictEqual(PREFERRED[key]);
    });

    it('paramsSchema rejects lengths outside the field ranges', () => {
        for (const field of t().fields) {
            if (field.kind !== 'length' && field.kind !== 'int') continue;
            const over = (value: number) =>
                t().paramsSchema.safeParse({
                    ...t().defaults,
                    [field.key]: value,
                }).success;
            expect([field.key, over(field.min - 1)]).toStrictEqual([
                field.key,
                false,
            ]);
            expect([field.key, over(field.max + 1)]).toStrictEqual([
                field.key,
                false,
            ]);
            expect([field.key, over(field.max)]).toStrictEqual([
                field.key,
                true,
            ]);
        }
    });

    it('the default document parses, has no error and no warning', () => {
        const doc = gen(key);
        expect(() => FurnitureDocumentSchema.parse(doc)).not.toThrow();
        expect(
            validateFurniture(doc, snapshot)
                .filter((i) => i.severity !== 'info')
                .map((i) => i.code),
        ).toStrictEqual([]);
    });

    it('templateDefaultDocument and a second run give the same document', () => {
        expect(
            templateDefaultDocument(key, {}, catalog, testIds()).document,
        ).toStrictEqual(gen(key));
        expect(gen(key)).toStrictEqual(gen(key));
    });
});

// --- study_desk ------------------------------------------------------------------

describe('study_desk (§2.4.14)', () => {
    it('default: the §2.4.14 table spec (cabinet ends, 3 drawers, top PB25-WHITE)', () => {
        expect(gen('study_desk')).toStrictEqual(studyDesk());
        expect(tableOf(gen('study_desk'))).toStrictEqual(
            spec(
                {},
                {
                    type: 'cabinet_ends',
                    legSource: 'hardware',
                    apron: { enabled: false, height: 80, inset: 15 },
                    stretcher: true,
                },
                {
                    endCabinets: {
                        width: 400,
                        content: {
                            type: 'drawers',
                            count: 3,
                            frontHeights: 'equal',
                            slideCode: null,
                            behindDoor: false,
                        },
                    },
                },
            ),
        );
        expect(gen('study_desk').materials.top.materialCode).toBe('PB25-WHITE');
    });

    it('cabinetWidth and shelves content: two adjustable shelves set back 20', () => {
        expect(
            tableOf(
                gen('study_desk', {
                    cabinetWidth: 500,
                    cabinetContent: 'shelves',
                }),
            ).storage.endCabinets,
        ).toStrictEqual({
            width: 500,
            content: {
                type: 'shelves',
                count: 2,
                adjustable: true,
                frontSetback: 20,
            },
        });
    });

    it('four_legs: apron enabled, no end cabinets', () => {
        const table = tableOf(gen('study_desk', { base: 'four_legs' }));
        expect(table.base).toStrictEqual({
            type: 'four_legs',
            legSource: 'hardware',
            legCode: null,
            legSection: 50,
            apron: { enabled: true, height: 80, inset: 15 },
            stretcher: true,
        });
        expect(table.storage.endCabinets).toBeNull();
    });

    it('panel_ends: no apron, no end cabinets', () => {
        const table = tableOf(gen('study_desk', { base: 'panel_ends' }));
        expect(table.base.type).toBe('panel_ends');
        expect(table.base.apron.enabled).toBe(false);
        expect(table.storage.endCabinets).toBeNull();
    });

    it('topDrawer: one front drawer in the knee space', () => {
        expect(
            tableOf(gen('study_desk', { topDrawer: true })).storage.drawers,
        ).toStrictEqual({ count: 1, side: 'front', slideCode: null });
        expect(tableOf(gen('study_desk')).storage.drawers).toBeNull();
    });
});

// --- dining_table ----------------------------------------------------------------

describe('dining_table (§2.4.15)', () => {
    it('default: rectangle top overhang 50, four solid legs, apron 90 / 15', () => {
        expect(gen('dining_table')).toStrictEqual(diningTable());
        expect(tableOf(gen('dining_table'))).toStrictEqual(
            spec(
                { overhang: 50 },
                { apron: { enabled: true, height: 90, inset: 15 } },
            ),
        );
    });

    it("shape 'round' forces depth = width", () => {
        const doc = gen('dining_table', {
            shape: 'round',
            width: 1100,
            depth: 800,
        });
        expect(doc.dims).toStrictEqual({
            width: 1100,
            height: 750,
            depth: 1100,
        });
        expect(tableOf(doc).top.shape).toBe('round');
        expect(errorsOf(doc)).toStrictEqual([]);
    });

    it('a round top wider than the 1200 depth range is capped at 1200 (spec 19, Task 40)', () => {
        // depth = width would leave 03 §2.4 (depth <= 1200): dims_range
        for (const width of [1210, 1800, 3000]) {
            const doc = gen('dining_table', { shape: 'round', width });
            expect(doc.dims).toStrictEqual({
                width: 1200,
                height: 750,
                depth: 1200,
            });
            expect(errorsOf(doc)).toStrictEqual([]);
        }
        expect(
            gen('dining_table', { shape: 'round', width: 1200 }).dims.width,
        ).toBe(1200);
        // other shapes keep the full width
        expect(
            gen('dining_table', { shape: 'oval', width: 3000 }).dims,
        ).toStrictEqual({ width: 3000, height: 750, depth: 900 });
    });

    it('3000 wide: the top and the long aprons are split at seams, no error (R40-1)', () => {
        for (const base of ['four_legs', 'trestle', 'pedestal']) {
            const doc = gen('dining_table', { width: 3000, base });
            expect(errorsOf(doc)).toStrictEqual([]);
        }
    });

    it('rounded_rectangle -> cornerRadius 100, other shapes 0', () => {
        expect(
            tableOf(gen('dining_table', { shape: 'rounded_rectangle' })).top,
        ).toStrictEqual({
            shape: 'rounded_rectangle',
            thickness: 'material',
            cornerRadius: 100,
            overhang: 50,
        });
        expect(
            tableOf(gen('dining_table', { shape: 'oval' })).top.cornerRadius,
        ).toBe(0);
    });

    it('trestle and pedestal bases have no apron; legSource is passed on', () => {
        for (const base of ['trestle', 'pedestal']) {
            const table = tableOf(
                gen('dining_table', { base, legSource: 'hardware' }),
            );
            expect(table.base).toStrictEqual({
                type: base,
                legSource: 'hardware',
                legCode: null,
                legSection: 50,
                apron: { enabled: false, height: 90, inset: 15 },
                stretcher: false,
            });
        }
    });
});

// --- coffee_table ----------------------------------------------------------------

describe('coffee_table (§2.4.16)', () => {
    it('default: overhang 30, four solid legs, apron 70 / 10, a lower shelf', () => {
        // No preferred materials: the role defaults (top PB18-WHITE).
        expect(gen('coffee_table')).toStrictEqual({
            ...tableDocument(
                { width: 1000, height: 420, depth: 550 },
                spec(
                    { overhang: 30 },
                    { apron: { enabled: true, height: 70, inset: 10 } },
                    { lowerShelf: true },
                ),
                'coffee_table',
            ),
            materials: defaultMaterials(),
        });
    });

    it('a round top is capped at the 900 depth range (spec 19, Task 40)', () => {
        const doc = gen('coffee_table', { shape: 'round', width: 1600 });
        expect(doc.dims).toStrictEqual({ width: 900, height: 420, depth: 900 });
        expect(errorsOf(doc)).toStrictEqual([]);
    });

    it('lowerShelf false: no lower shelf', () => {
        expect(
            tableOf(gen('coffee_table', { lowerShelf: false })).storage
                .lowerShelf,
        ).toBe(false);
    });

    it("shape 'round' forces depth = width, rounded_rectangle has radius 100", () => {
        const round = gen('coffee_table', {
            shape: 'round',
            width: 800,
            depth: 500,
        });
        expect(round.dims).toStrictEqual({
            width: 800,
            height: 420,
            depth: 800,
        });
        expect(errorsOf(round)).toStrictEqual([]);
        expect(
            tableOf(gen('coffee_table', { shape: 'rounded_rectangle' })).top
                .cornerRadius,
        ).toBe(100);
    });
});

// --- console_table ---------------------------------------------------------------

describe('console_table (§2.4.17)', () => {
    it('default: overhang 20, four solid legs, apron 100 / 10, 2 front drawers', () => {
        expect(gen('console_table')).toStrictEqual({
            ...tableDocument(
                { width: 1200, height: 800, depth: 400 },
                spec(
                    { overhang: 20 },
                    { apron: { enabled: true, height: 100, inset: 10 } },
                    { drawers: { count: 2, side: 'front', slideCode: null } },
                ),
                'console_table',
            ),
            materials: defaultMaterials(),
        });
    });

    it('depth starts at 360: the shortest seed slide fits three drawers there (R40-3)', () => {
        const parse = (depth: number) =>
            template('console_table').paramsSchema.safeParse({
                ...DEFAULTS.console_table,
                depth,
            }).success;
        expect(parse(350)).toBe(false);
        expect(parse(360)).toBe(true);
        for (const drawers of [1, 2, 3]) {
            expect(
                errorsOf(gen('console_table', { depth: 360, drawers })),
            ).toStrictEqual([]);
        }
    });

    it('drawers 0: no drawers', () => {
        expect(
            tableOf(gen('console_table', { drawers: 0 })).storage.drawers,
        ).toBeNull();
    });
});
