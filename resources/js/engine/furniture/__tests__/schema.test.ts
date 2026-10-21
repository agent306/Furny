import { describe, expect, it } from 'vitest';
import { EngineInputError } from '../../errors';
import {
    FURNITURE_MIGRATIONS,
    FURNITURE_SCHEMA_VERSION,
    migrateFurniture,
} from '../migrate';
import {
    EDGE_IDS,
    FurnitureDocumentSchema,
    MATERIAL_ROLES,
    TEMPLATE_KEYS,
    type FurnitureDocument,
} from '../schema';
import { MATERIAL_ROLES as CATALOG_ROLES } from '../../catalog/snapshot';

/** The 07 §12.2 wardrobe fixture. */
const WARDROBE = {
    schemaVersion: 1,
    templateKey: 'wardrobe_hinged',
    family: 'carcass',
    dims: { width: 1800, height: 2100, depth: 600 },
    materials: {
        carcass: {
            materialCode: 'PB18-WHITE',
            edgeBandCode: null,
            finishCode: null,
        },
        back: {
            materialCode: 'HDF3-WHITE',
            edgeBandCode: null,
            finishCode: null,
        },
        shelf: {
            materialCode: 'PB18-WHITE',
            edgeBandCode: null,
            finishCode: null,
        },
        front: {
            materialCode: 'PB18-WHITE',
            edgeBandCode: null,
            finishCode: null,
        },
        top: {
            materialCode: 'PB18-WHITE',
            edgeBandCode: null,
            finishCode: null,
        },
        drawer_box: {
            materialCode: 'PLY12-BWR',
            edgeBandCode: null,
            finishCode: null,
        },
        drawer_bottom: {
            materialCode: 'HDF3-WHITE',
            edgeBandCode: null,
            finishCode: null,
        },
        plinth: {
            materialCode: 'PB18-WHITE',
            edgeBandCode: null,
            finishCode: null,
        },
        leg: {
            materialCode: 'SW50-RUBBER',
            edgeBandCode: null,
            finishCode: null,
        },
    },
    carcass: {
        construction: { top: 'between_sides', bottom: 'between_sides' },
        mounting: 'floor',
        plinth: { type: 'plinth', height: 100, setback: 20, legCode: null },
        back: { type: 'grooved' },
        countertop: null,
        interior: {
            id: 's_0000000001',
            split: 'columns',
            content: null,
            children: [
                {
                    size: { mode: 'flex', weight: 1 },
                    section: {
                        id: 's_0000000002',
                        split: 'none',
                        children: [],
                        content: {
                            type: 'shelves',
                            count: 4,
                            adjustable: true,
                            frontSetback: 20,
                        },
                    },
                },
                {
                    size: { mode: 'flex', weight: 2 },
                    section: {
                        id: 's_0000000003',
                        split: 'rows',
                        content: null,
                        children: [
                            {
                                size: { mode: 'fixed', mm: 350 },
                                section: {
                                    id: 's_0000000004',
                                    split: 'none',
                                    children: [],
                                    content: { type: 'empty' },
                                },
                            },
                            {
                                size: { mode: 'flex', weight: 1 },
                                section: {
                                    id: 's_0000000005',
                                    split: 'none',
                                    children: [],
                                    content: {
                                        type: 'hanging_rod',
                                        topClearance: 60,
                                        rodCode: null,
                                    },
                                },
                            },
                        ],
                    },
                },
            ],
        },
        fronts: [
            {
                id: 'fr_0000000001',
                kind: 'hinged',
                covers: ['s_0000000002'],
                leaves: 1,
                hingeSide: 'left',
                overlay: 'full',
                glass: false,
                handleCode: 'inherit',
                hingeCode: 'auto',
                slidingTrackCode: null,
            },
            {
                id: 'fr_0000000002',
                kind: 'hinged',
                covers: ['s_0000000003'],
                leaves: 2,
                hingeSide: 'auto',
                overlay: 'full',
                glass: false,
                handleCode: 'inherit',
                hingeCode: 'auto',
                slidingTrackCode: null,
            },
        ],
        handles: {
            code: 'HDL-BAR-160',
            orientation: 'auto',
            placement: 'auto',
        },
    },
    table: null,
    overrides: { parts: {}, extraParts: [], hardware: {}, extraHardware: [] },
    notes: null,
};

/** Mutable untyped JSON, so tests can break a valid document in one place. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- deliberately untyped test input
type Loose = Record<string, any>;

const clone = (): Loose => structuredClone(WARDROBE);

const TABLE_DOC = {
    ...clone(),
    templateKey: 'dining_table',
    family: 'table',
    carcass: null,
    table: {
        top: {
            shape: 'rounded_rectangle',
            thickness: 'material',
            cornerRadius: 50,
            overhang: 30,
        },
        base: {
            type: 'cabinet_ends',
            legSource: 'solid',
            legCode: null,
            legSection: 50,
            apron: { enabled: true, height: 80, inset: 20 },
            stretcher: false,
        },
        storage: {
            drawers: { count: 2, side: 'front', slideCode: null },
            lowerShelf: false,
            endCabinets: { width: 400, content: { type: 'empty' } },
        },
    },
};

describe('FurnitureDocumentSchema', () => {
    it('accepts the 07 §12.2 wardrobe fixture unchanged', () => {
        const parsed = FurnitureDocumentSchema.parse(WARDROBE);
        expect(parsed).toEqual(WARDROBE);
    });

    it('accepts a table document', () => {
        expect(FurnitureDocumentSchema.safeParse(TABLE_DOC).success).toBe(true);
    });

    it('accepts overrides and extra parts', () => {
        const doc = clone();
        doc.overrides = {
            parts: {
                'carcass.top': {
                    removed: true,
                    edges: { L1: 'EB08-WHITE', W2: null },
                    lengthDelta: -2,
                    grain: 'none',
                    note: 'x',
                },
            },
            extraParts: [
                {
                    id: 'p_0000000001',
                    name: 'Filler',
                    role: 'carcass',
                    materialCode: 'PB18-WHITE',
                    length: 500,
                    width: 80,
                    qty: 2,
                    edges: { L1: null, L2: null, W1: null, W2: null },
                    grain: 'length',
                    note: null,
                    placement: { min: [0, 0, 0], size: [18, 500, 80] },
                },
            ],
            hardware: { 'carcass.screws': { qtyDelta: 1 } },
            extraHardware: [
                { id: 'h_0000000001', code: 'SCR-PACK', qty: 1, note: null },
            ],
        };
        expect(FurnitureDocumentSchema.safeParse(doc).success).toBe(true);
    });

    it('rejects shelves with count 0 or above 20', () => {
        for (const count of [0, 21, 1.5]) {
            const doc = clone();
            doc.carcass.interior.children[0].section.content.count = count;
            expect(FurnitureDocumentSchema.safeParse(doc).success).toBe(false);
        }
    });

    it('rejects drawer counts outside 1..10 and table drawers outside 0..3', () => {
        const doc = clone();
        doc.carcass.interior.children[0].section.content = {
            type: 'drawers',
            count: 11,
            frontHeights: 'equal',
            slideCode: null,
            behindDoor: false,
        };
        expect(FurnitureDocumentSchema.safeParse(doc).success).toBe(false);
        doc.carcass.interior.children[0].section.content.count = 3;
        doc.carcass.interior.children[0].section.content.frontHeights = [
            100, 100, 100,
        ];
        expect(FurnitureDocumentSchema.safeParse(doc).success).toBe(true);

        const table = structuredClone(TABLE_DOC);
        table.table.storage.drawers!.count = 4;
        expect(FurnitureDocumentSchema.safeParse(table).success).toBe(false);
    });

    it("rejects leaves: 'many'", () => {
        const doc = clone();
        doc.carcass.fronts[0].leaves = 'many';
        expect(FurnitureDocumentSchema.safeParse(doc).success).toBe(false);
    });

    it.each([0, -1, 1.5])(
        'rejects leaves: %s (an integer of at least 1)',
        (leaves) => {
            const doc = clone();
            doc.carcass.fronts[0].leaves = leaves;
            expect(FurnitureDocumentSchema.safeParse(doc).success).toBe(false);
        },
    );

    it.each([1, 2, 4, 'auto'])('accepts leaves: %s', (leaves) => {
        const doc = clone();
        doc.carcass.fronts[0].leaves = leaves;
        expect(FurnitureDocumentSchema.safeParse(doc).success).toBe(true);
    });

    it("rejects EdgeId 'L3' in a part override and in an extra part", () => {
        const doc = clone();
        doc.overrides.parts['carcass.top'] = { edges: { L3: 'EB08-WHITE' } };
        expect(FurnitureDocumentSchema.safeParse(doc).success).toBe(false);

        const extra = clone();
        extra.overrides.extraParts = [
            {
                id: 'p_0000000001',
                name: 'x',
                role: 'carcass',
                materialCode: 'PB18-WHITE',
                length: 1,
                width: 1,
                qty: 1,
                edges: { L1: null, L2: null, W1: null, W2: null, L3: null },
                grain: 'none',
                note: null,
                placement: null,
            },
        ];
        // A stray key is dropped; a missing edge is not allowed.
        expect(FurnitureDocumentSchema.safeParse(extra).success).toBe(false);
    });

    it('requires every edge of an extra part and every material role', () => {
        const extra = clone();
        extra.overrides.extraParts = [
            {
                id: 'p_0000000001',
                name: 'x',
                role: 'carcass',
                materialCode: 'PB18-WHITE',
                length: 1,
                width: 1,
                qty: 1,
                edges: { L1: null, L2: null, W1: null },
                grain: 'none',
                note: null,
                placement: null,
            },
        ];
        expect(FurnitureDocumentSchema.safeParse(extra).success).toBe(false);

        const doc = clone();
        delete doc.materials.leg;
        expect(FurnitureDocumentSchema.safeParse(doc).success).toBe(false);
    });

    it('rejects extra part quantities outside 1..99', () => {
        for (const qty of [0, 100]) {
            const doc = clone();
            doc.overrides.extraParts = [
                {
                    id: 'p_0000000001',
                    name: 'x',
                    role: 'carcass',
                    materialCode: 'PB18-WHITE',
                    length: 1,
                    width: 1,
                    qty,
                    edges: { L1: null, L2: null, W1: null, W2: null },
                    grain: 'none',
                    note: null,
                    placement: null,
                },
            ];
            expect(FurnitureDocumentSchema.safeParse(doc).success).toBe(false);
        }
    });

    it('rejects fractional millimetres, bad ids, enums and templates', () => {
        const mutations: Array<(d: Loose) => void> = [
            (d) => (d.dims.width = 1800.5),
            (d) => (d.carcass.interior.id = 'x_0000000001'),
            (d) => (d.carcass.fronts[0].id = 'fr_1'),
            (d) => (d.carcass.fronts[0].kind = 'swing'),
            (d) => (d.carcass.interior.children[0].size.weight = 0),
            (d) => (d.templateKey = 'sofa'),
            (d) => (d.family = 'chair'),
            (d) => (d.schemaVersion = 2),
            (d) => (d.notes = undefined),
        ];
        for (const mutate of mutations) {
            const doc = clone();
            mutate(doc);
            expect(FurnitureDocumentSchema.safeParse(doc).success).toBe(false);
        }
    });

    it('leaves range and consistency checks to validateFurniture', () => {
        const doc = clone();
        doc.dims.width = 10;
        doc.family = 'table'; // carcass set although the family is table
        doc.carcass.interior.split = 'columns';
        doc.carcass.interior.children = [];
        expect(FurnitureDocumentSchema.safeParse(doc).success).toBe(true);
    });
});

describe('schema constants', () => {
    it('lists the 19 templates, 4 edge ids and re-exports the catalog roles', () => {
        expect(TEMPLATE_KEYS).toHaveLength(19);
        expect(new Set(TEMPLATE_KEYS).size).toBe(19);
        expect(EDGE_IDS).toEqual(['L1', 'L2', 'W1', 'W2']);
        expect(MATERIAL_ROLES).toBe(CATALOG_ROLES);
    });
});

describe('migrateFurniture', () => {
    it('is a no-op for v1 and returns a parsed document', () => {
        const migrated: FurnitureDocument = migrateFurniture(clone());
        expect(migrated).toEqual(WARDROBE);
        expect(FURNITURE_SCHEMA_VERSION).toBe(1);
        expect(FURNITURE_MIGRATIONS).toEqual({});
    });

    it('throws unsupported_schema_version for v2', () => {
        const doc = { ...clone(), schemaVersion: 2 };
        expect(() => migrateFurniture(doc)).toThrow(EngineInputError);
        try {
            migrateFurniture(doc);
        } catch (e) {
            expect((e as EngineInputError).code).toBe(
                'unsupported_schema_version',
            );
        }
    });

    it('throws invalid_input for non-objects, missing versions and schema failures', () => {
        const code = (input: unknown): string | undefined => {
            try {
                migrateFurniture(input);
            } catch (e) {
                return (e as EngineInputError).code;
            }
            return undefined;
        };
        expect(code(null)).toBe('invalid_input');
        expect(code([])).toBe('invalid_input');
        expect(code({})).toBe('invalid_input');
        expect(code({ ...clone(), schemaVersion: 1.5 })).toBe('invalid_input');
        expect(code({ ...clone(), dims: 'big' })).toBe('invalid_input');
    });

    it('throws when an older version has no registered migration', () => {
        try {
            migrateFurniture({ ...clone(), schemaVersion: 0 });
            expect.unreachable();
        } catch (e) {
            expect((e as EngineInputError).code).toBe(
                'unsupported_schema_version',
            );
        }
    });
});
