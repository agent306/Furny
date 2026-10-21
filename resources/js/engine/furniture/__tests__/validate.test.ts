import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Issue } from '../../plan/types';
import { testIds } from '../../testing/ids';
import { seedCatalog } from '../../testing/seedCatalog';
import { indexCatalog } from '../catalogIndex';
import { generateFurniture } from '../generate';
import { furnitureIssue } from '../context';
import type {
    Content,
    ExtraPart,
    Front,
    FurnitureDocument,
    Section,
} from '../schema';
import { templateDefaultDocument } from '../templates/index';
import { archived, withoutEdgeBand } from '../testing/catalogs';
import {
    assign,
    boxDocument,
    drawerTestBox,
    fixed,
    flex,
    frontOn,
    leafSection,
    splitSection,
    wardrobeFixture,
} from '../testing/docs';
import {
    CRITICAL_WARNING_CODES,
    FURNITURE_ISSUE_CODES,
    SAVE_BLOCKING_CODES,
    dedupeIssues,
    isSaveBlocking,
    validateFurniture,
    type FurnitureIssueCode,
} from '../validate';

const catalog = seedCatalog();
const ROOT = 's_0000000001';
const FR1 = 'fr_0000000001';
const FR2 = 'fr_0000000002';

const codesOf = (issues: readonly Issue[]): string[] =>
    issues.map((i) => i.code);
const only = (issues: readonly Issue[], code: string): Issue[] =>
    issues.filter((i) => i.code === code);
const validate = (doc: FurnitureDocument) => validateFurniture(doc, catalog);

/** The three info issues of the 07 §12.2 wardrobe. */
const WARDROBE_ISSUES = [
    'furniture.back_split',
    'furniture.anti_tip_added',
    'furniture.weight_estimate',
];

describe('validateFurniture: valid documents', () => {
    it('reports only the three info issues for the wardrobe fixture', () => {
        const issues = validate(wardrobeFixture());
        expect(codesOf(issues)).toEqual(WARDROBE_ISSUES);
        expect(issues.every((i) => i.severity === 'info')).toBe(true);
        expect(isSaveBlocking(issues)).toBe(false);
    });

    it('is the generated issues when the structure is fine', () => {
        const doc = wardrobeFixture();
        expect(validate(doc)).toEqual(generateFurniture(doc, catalog).issues);
    });

    it('does not mutate the document', () => {
        const doc = wardrobeFixture();
        const before = JSON.stringify(doc);
        validate(doc);
        expect(JSON.stringify(doc)).toBe(before);
    });

    it('templateDefaultDocument returns the same three issues', () => {
        const result = templateDefaultDocument(
            'wardrobe_hinged',
            {},
            indexCatalog(catalog),
            testIds(),
        );
        expect(codesOf(result.issues)).toEqual(WARDROBE_ISSUES);
        expect(result.issues).toEqual(validate(result.document));
    });
});

describe('dims_range (03 §2.4)', () => {
    const dimsIssues = (dims: Partial<FurnitureDocument['dims']>) =>
        only(
            validate(
                wardrobeFixture((d) => {
                    Object.assign(d.dims, dims);
                }),
            ),
            'furniture.dims_range',
        );

    it('width 6001 is out of range', () => {
        expect(dimsIssues({ width: 6001 })).toEqual([
            {
                code: 'furniture.dims_range',
                severity: 'error',
                messageKey: 'engine.furniture.issue.dims_range',
                params: { dimension: 'width', min: 150, max: 6000 },
                entityIds: [],
            },
        ]);
    });

    it.each([
        ['width', 149, 150, 6000],
        ['width', 6001, 150, 6000],
        ['height', 99, 100, 3000],
        ['height', 3001, 100, 3000],
        ['depth', 99, 100, 1200],
        ['depth', 1201, 100, 1200],
    ] as const)('%s %i is out of range', (dimension, value, min, max) => {
        expect(dimsIssues({ [dimension]: value }).map((i) => i.params)).toEqual(
            [{ dimension, min, max }],
        );
    });

    it.each([
        ['width', 150],
        ['width', 6000],
        ['height', 100],
        ['height', 3000],
        ['depth', 100],
        ['depth', 1200],
    ] as const)('%s %i is in range', (dimension, value) => {
        expect(dimsIssues({ [dimension]: value })).toEqual([]);
    });

    it('reports every dimension that is out of range, in width / height / depth order', () => {
        expect(
            dimsIssues({ width: 10, height: 5000, depth: 2000 }).map(
                (i) => i.params.dimension,
            ),
        ).toEqual(['width', 'height', 'depth']);
    });

    it('blocks saving', () => {
        expect(
            isSaveBlocking(
                validate(
                    wardrobeFixture((d) => {
                        d.dims.width = 6001;
                    }),
                ),
            ),
        ).toBe(true);
    });
});

describe('family_mismatch (03 §2.4)', () => {
    const tableSpec = (): NonNullable<FurnitureDocument['table']> => ({
        top: {
            shape: 'rectangle',
            thickness: 'material',
            cornerRadius: 0,
            overhang: 0,
        },
        base: {
            type: 'four_legs',
            legSource: 'hardware',
            legCode: null,
            legSection: 50,
            apron: { enabled: false, height: 80, inset: 0 },
            stretcher: false,
        },
        storage: { drawers: null, lowerShelf: false, endCabinets: null },
    });

    const mismatch = (doc: FurnitureDocument) =>
        only(validate(doc), 'furniture.family_mismatch');

    it('flags a carcass spec on a table-family document', () => {
        const doc = wardrobeFixture((d) => {
            d.family = 'table';
            d.table = tableSpec();
        });
        expect(mismatch(doc)).toEqual([
            {
                code: 'furniture.family_mismatch',
                severity: 'error',
                messageKey: 'engine.furniture.issue.family_mismatch',
                params: {},
                entityIds: [],
            },
        ]);
        // carcass non-null on a table family
        expect(
            mismatch(wardrobeFixture((d) => (d.family = 'table'))),
        ).toHaveLength(1);
    });

    it('flags a missing spec for the family, without throwing', () => {
        expect(
            mismatch(wardrobeFixture((d) => (d.carcass = null))),
        ).toHaveLength(1);
        const noTable = wardrobeFixture((d) => {
            d.family = 'table';
            d.carcass = null;
        });
        expect(mismatch(noTable)).toHaveLength(1);
    });

    it('flags a table spec on a carcass-family document, once', () => {
        expect(
            mismatch(wardrobeFixture((d) => (d.table = tableSpec()))),
        ).toHaveLength(1);
        const both = wardrobeFixture((d) => {
            d.family = 'table';
            d.table = tableSpec();
            d.carcass = null;
        });
        expect(mismatch(both)).toEqual([]);
    });

    it('blocks saving', () => {
        expect(
            isSaveBlocking(
                validate(wardrobeFixture((d) => (d.carcass = null))),
            ),
        ).toBe(true);
    });
});

describe('section_tree_invalid (03 §2.4)', () => {
    const invalid = (interior: Section) =>
        only(
            validate(
                boxDocument({ width: 900, height: 720, depth: 560, interior }),
            ),
            'furniture.section_tree_invalid',
        );

    it('flags a duplicate section id, naming the id', () => {
        const issues = invalid(
            splitSection(ROOT, 'columns', [
                [flex(), leafSection('s_0000000002')],
                [flex(), leafSection('s_0000000002')],
            ]),
        );
        expect(issues).toEqual([
            {
                code: 'furniture.section_tree_invalid',
                severity: 'error',
                messageKey: 'engine.furniture.issue.section_tree_invalid',
                params: { sectionId: 's_0000000002' },
                entityIds: ['s_0000000002'],
            },
        ]);
    });

    it('flags a child that repeats the id of an ancestor', () => {
        expect(
            invalid(
                splitSection(ROOT, 'rows', [
                    [flex(), leafSection(ROOT)],
                    [flex(), leafSection('s_0000000002')],
                ]),
            ).map((i) => i.params.sectionId),
        ).toEqual([ROOT]);
    });

    it("flags a split 'columns' or 'rows' with a single child", () => {
        for (const dir of ['columns', 'rows'] as const) {
            expect(
                invalid(
                    splitSection(ROOT, dir, [
                        [flex(), leafSection('s_0000000002')],
                    ]),
                ).map((i) => i.params.sectionId),
            ).toEqual([ROOT]);
        }
    });

    it("flags a split 'columns' without children", () => {
        expect(
            invalid(splitSection(ROOT, 'columns', [])).map(
                (i) => i.params.sectionId,
            ),
        ).toEqual([ROOT]);
    });

    it("flags a split 'none' that has children", () => {
        const section = splitSection(ROOT, 'columns', [
            [flex(), leafSection('s_0000000002')],
            [flex(), leafSection('s_0000000003')],
        ]);
        expect(
            invalid({ ...section, split: 'none' }).map(
                (i) => i.params.sectionId,
            ),
        ).toEqual([ROOT]);
    });

    it('flags a leaf whose content is null', () => {
        expect(
            invalid(leafSection(ROOT, null)).map((i) => i.entityIds),
        ).toEqual([[ROOT]]);
        const nested = invalid(
            splitSection(ROOT, 'columns', [
                [flex(), leafSection('s_0000000002')],
                [flex(), leafSection('s_0000000003', null)],
            ]),
        );
        expect(nested.map((i) => i.params.sectionId)).toEqual(['s_0000000003']);
    });

    it('flags a divided section that has content', () => {
        const section = splitSection(ROOT, 'columns', [
            [flex(), leafSection('s_0000000002')],
            [flex(), leafSection('s_0000000003')],
        ]);
        expect(
            invalid({ ...section, content: { type: 'empty' } }).map(
                (i) => i.params.sectionId,
            ),
        ).toEqual([ROOT]);
    });

    it('accepts a consistent tree', () => {
        expect(
            invalid(
                splitSection(ROOT, 'columns', [
                    [flex(), leafSection('s_0000000002')],
                    [
                        flex(),
                        splitSection('s_0000000003', 'rows', [
                            [fixed(200), leafSection('s_0000000004')],
                            [flex(), leafSection('s_0000000005')],
                        ]),
                    ],
                ]),
            ),
        ).toEqual([]);
    });

    it('generates without throwing for every invalid shape and blocks saving', () => {
        const dup = splitSection(ROOT, 'columns', [
            [flex(), leafSection('s_0000000002')],
            [flex(), leafSection('s_0000000002')],
        ]);
        for (const interior of [dup, leafSection(ROOT, null)]) {
            const doc = boxDocument({
                width: 900,
                height: 720,
                depth: 560,
                interior,
            });
            expect(isSaveBlocking(validate(doc))).toBe(true);
        }
    });
});

describe('section_too_small (03 §2.4)', () => {
    const twoColumns = (a: Section['children'][number]['size']) =>
        boxDocument({
            width: 600,
            height: 720,
            depth: 560,
            interior: splitSection(ROOT, 'columns', [
                [a, leafSection('s_0000000002')],
                [flex(), leafSection('s_0000000003')],
            ]),
        });

    it('flags a leaf 95 mm wide with its net size', () => {
        expect(
            only(
                validate(twoColumns(fixed(95))),
                'furniture.section_too_small',
            ),
        ).toEqual([
            {
                code: 'furniture.section_too_small',
                severity: 'error',
                messageKey: 'engine.furniture.issue.section_too_small',
                params: { sectionId: 's_0000000002', width: 95, height: 684 },
                entityIds: ['s_0000000002'],
            },
        ]);
    });

    it('accepts 100 mm wide and flags 99', () => {
        expect(
            only(
                validate(twoColumns(fixed(100))),
                'furniture.section_too_small',
            ),
        ).toEqual([]);
        expect(
            only(
                validate(twoColumns(fixed(99))),
                'furniture.section_too_small',
            ),
        ).toHaveLength(1);
    });

    it('flags a leaf lower than 80 mm and accepts 80', () => {
        const rows = (h: number) =>
            validate(
                boxDocument({
                    width: 600,
                    height: 720,
                    depth: 560,
                    interior: splitSection(ROOT, 'rows', [
                        [fixed(h), leafSection('s_0000000002')],
                        [flex(), leafSection('s_0000000003')],
                    ]),
                }),
            );
        expect(
            only(rows(79), 'furniture.section_too_small').map((i) => i.params),
        ).toEqual([{ sectionId: 's_0000000002', width: 564, height: 79 }]);
        expect(only(rows(80), 'furniture.section_too_small')).toEqual([]);
    });

    it('does not flag divided sections, only leaves', () => {
        const doc = boxDocument({
            width: 600,
            height: 720,
            depth: 560,
            interior: splitSection(ROOT, 'columns', [
                [fixed(120), leafSection('s_0000000002')],
                [flex(), leafSection('s_0000000003')],
            ]),
        });
        expect(only(validate(doc), 'furniture.section_too_small')).toEqual([]);
    });

    it('blocks saving', () => {
        expect(isSaveBlocking(validate(twoColumns(fixed(95))))).toBe(true);
    });
});

describe('fixed_sizes_exceed and flex-only children without room (Task 33 M6)', () => {
    it('reports fixed_sizes_exceed for fixed children that do not fit', () => {
        const doc = boxDocument({
            width: 1000,
            height: 720,
            depth: 560,
            interior: splitSection(ROOT, 'columns', [
                [fixed(600), leafSection('s_0000000002')],
                [fixed(500), leafSection('s_0000000003')],
            ]),
        });
        expect(
            only(validate(doc), 'furniture.fixed_sizes_exceed').map(
                (i) => i.params,
            ),
        ).toEqual([{ sectionId: ROOT, overBy: 154 }]);
    });

    /** 20 flex columns in 300 mm: 264 - 19 x 18 < 0, with a different content in each. */
    const crowded = (): FurnitureDocument => {
        const contents: Content[] = [
            { type: 'empty' },
            {
                type: 'shelves',
                count: 3,
                adjustable: true,
                frontSetback: 20,
            },
            {
                type: 'shelves',
                count: 2,
                adjustable: false,
                frontSetback: 20,
            },
            {
                type: 'drawers',
                count: 2,
                frontHeights: 'equal',
                slideCode: null,
                behindDoor: false,
            },
            { type: 'hanging_rod', topClearance: 60, rodCode: null },
            { type: 'pull_out_basket', count: 2, basketCode: null },
        ];
        const columns = Array.from({ length: 20 }, (_, k) => {
            const id = `s_${String(k + 2).padStart(10, '0')}`;
            return [flex(), leafSection(id, contents[k % contents.length])] as [
                Section['children'][number]['size'],
                Section,
            ];
        });
        return boxDocument({
            width: 300,
            height: 720,
            depth: 560,
            interior: splitSection(ROOT, 'columns', columns),
            fronts: [
                frontOn(FR1, ['s_0000000002']),
                frontOn(FR2, ['s_0000000003', 's_0000000004']),
            ],
        });
    };

    it('reports section_too_small for each squeezed leaf, not fixed_sizes_exceed', () => {
        const issues = validate(crowded());
        expect(only(issues, 'furniture.fixed_sizes_exceed')).toEqual([]);
        const small = only(issues, 'furniture.section_too_small');
        expect(small).toHaveLength(20);
        expect(small.every((i) => i.params.width === 0)).toBe(true);
        expect(isSaveBlocking(issues)).toBe(true);
    });

    it('generates no part or section with a negative size', () => {
        const model = generateFurniture(crowded(), catalog);
        for (const section of model.sections) {
            expect(section.box.size.every((s) => s >= 0)).toBe(true);
        }
        for (const part of model.parts) {
            expect(part.length).toBeGreaterThanOrEqual(0);
            expect(part.width).toBeGreaterThanOrEqual(0);
            if (part.geometry.kind === 'box') {
                expect(part.geometry.box.size.every((s) => s >= 0)).toBe(true);
            }
        }
        for (const front of model.fronts) {
            expect(front.rect.w).toBeGreaterThanOrEqual(0);
            expect(front.rect.h).toBeGreaterThanOrEqual(0);
        }
    });
});

describe('front_not_rectangle and front_overlap (03 §2.4)', () => {
    /** 1200 x 1500 x 560: column 1 a leaf, column 2 rows [fixed 600 | flex]. */
    const gridBox = (fronts: Front[]) =>
        boxDocument({
            width: 1200,
            height: 1500,
            depth: 560,
            interior: splitSection(ROOT, 'columns', [
                [flex(), leafSection('s_0000000002')],
                [
                    flex(),
                    splitSection('s_0000000003', 'rows', [
                        [fixed(600), leafSection('s_0000000004')],
                        [flex(), leafSection('s_0000000005')],
                    ]),
                ],
            ]),
            fronts,
        });

    it('flags an L-shaped cover', () => {
        const doc = gridBox([frontOn(FR1, ['s_0000000002', 's_0000000004'])]);
        expect(only(validate(doc), 'furniture.front_not_rectangle')).toEqual([
            {
                code: 'furniture.front_not_rectangle',
                severity: 'error',
                messageKey: 'engine.furniture.issue.front_not_rectangle',
                params: { frontId: FR1 },
                entityIds: [FR1],
            },
        ]);
    });

    it('flags two fronts on one leaf', () => {
        const doc = gridBox([
            frontOn(FR1, ['s_0000000003']),
            frontOn(FR2, ['s_0000000005']),
        ]);
        expect(only(validate(doc), 'furniture.front_overlap')).toEqual([
            {
                code: 'furniture.front_overlap',
                severity: 'error',
                messageKey: 'engine.furniture.issue.front_overlap',
                params: { frontIds: `${FR1},${FR2}` },
                entityIds: [FR1, FR2],
            },
        ]);
    });

    it('accepts rectangular, disjoint fronts', () => {
        const doc = gridBox([
            frontOn(FR1, ['s_0000000002']),
            frontOn(FR2, ['s_0000000003']),
        ]);
        const issues = validate(doc);
        expect(only(issues, 'furniture.front_overlap')).toEqual([]);
        expect(only(issues, 'furniture.front_not_rectangle')).toEqual([]);
    });

    it('both block saving', () => {
        expect(
            isSaveBlocking(
                validate(
                    gridBox([frontOn(FR1, ['s_0000000002', 's_0000000004'])]),
                ),
            ),
        ).toBe(true);
    });

    it('is checked on the raw document even when generation stops at the envelope', () => {
        // 140 mm wide: furniture.envelope_too_small, no parts at all
        const doc = boxDocument({
            width: 140,
            height: 720,
            depth: 560,
            fronts: [frontOn(FR1, [ROOT]), frontOn(FR2, [ROOT])],
        });
        const issues = validate(doc);
        expect(generateFurniture(doc, catalog).parts).toEqual([]);
        expect(codesOf(issues)).toEqual(
            expect.arrayContaining([
                'furniture.envelope_too_small',
                'furniture.dims_range',
                'furniture.front_overlap',
            ]),
        );
    });
});

describe('unknown_code and archived_code (03 §2.4)', () => {
    it('flags an unknown material code', () => {
        const issues = validate(
            wardrobeFixture((d) => {
                d.materials.front = assign('GONE-01');
            }),
        );
        expect(only(issues, 'furniture.unknown_code')).toEqual([
            {
                code: 'furniture.unknown_code',
                severity: 'error',
                messageKey: 'engine.furniture.issue.unknown_code',
                params: { code: 'GONE-01', kind: 'material' },
                entityIds: [],
            },
        ]);
        expect(isSaveBlocking(issues)).toBe(true);
    });

    it('keeps two different unknown codes apart (no entities to tell them by)', () => {
        const issues = validate(
            wardrobeFixture((d) => {
                d.materials.front = assign('GONE-01');
                d.materials.top = assign('GONE-02');
            }),
        );
        expect(
            only(issues, 'furniture.unknown_code').map((i) => i.params.code),
        ).toEqual(['GONE-01', 'GONE-02']);
    });

    describe('explicit slideCode (Task 35 carry)', () => {
        const drawers = (slideCode: string | null): Content => ({
            type: 'drawers',
            count: 2,
            frontHeights: 'equal',
            slideCode,
            behindDoor: false,
        });
        const boxWith = (...slideCodes: Array<string | null>) =>
            boxDocument({
                width: 900,
                height: 720,
                depth: 560,
                interior: splitSection(
                    ROOT,
                    'columns',
                    slideCodes.map(
                        (
                            code,
                            k,
                        ): [Section['children'][number]['size'], Section] => [
                            flex(),
                            leafSection(
                                `s_${String(k + 2).padStart(10, '0')}`,
                                drawers(code),
                            ),
                        ],
                    ),
                ),
            });
        const unknowns = (doc: FurnitureDocument) =>
            only(validate(doc), 'furniture.unknown_code').map((i) => i.params);

        it('reports a slide code the catalog does not have', () => {
            expect(unknowns(boxWith('SLD-NOPE', null))).toEqual([
                { code: 'SLD-NOPE', kind: 'hardware' },
            ]);
        });

        it('reports a catalog item that is not a drawer slide, once per code', () => {
            // HDL-BAR-160 is a handle, and also the carcass handle code
            expect(unknowns(boxWith('HDL-BAR-160', 'HDL-BAR-160'))).toEqual([
                { code: 'HDL-BAR-160', kind: 'hardware' },
            ]);
        });

        it('accepts a real slide and the family default', () => {
            expect(unknowns(boxWith('SLD-BB-500', 'SLD-UM-450', null))).toEqual(
                [],
            );
        });

        it('still generates the drawers with the family default', () => {
            const model = generateFurniture(boxWith('HDL-BAR-160'), catalog);
            expect(
                model.hardware.filter((h) => h.key.endsWith('.slides')),
            ).toHaveLength(2);
        });

        it('checks the table drawers and end cabinet content too', () => {
            const table: FurnitureDocument = {
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
                        drawers: {
                            count: 1,
                            side: 'front',
                            slideCode: 'HDL-BAR-160',
                        },
                        lowerShelf: false,
                        endCabinets: { width: 500, content: drawers('KNOB-1') },
                    },
                },
            };
            expect(unknowns(table)).toHaveLength(2);
            expect(unknowns(table)).toEqual(
                expect.arrayContaining([
                    { code: 'HDL-BAR-160', kind: 'hardware' },
                    { code: 'KNOB-1', kind: 'hardware' },
                ]),
            );
        });
    });

    describe('default edge bands of the materials (Task 36 carry)', () => {
        const edgeIssues = (
            cat: ReturnType<typeof seedCatalog>,
            doc = wardrobeFixture(),
        ) =>
            validateFurniture(doc, cat).filter(
                (i) =>
                    i.code === 'furniture.archived_code' ||
                    i.code === 'furniture.unknown_code',
            );

        it('reports an archived default band once, however many roles use it', () => {
            // EB08-WHITE is the default band of PB18-WHITE: carcass, shelf, front, top, plinth
            expect(edgeIssues(archived('EB08-WHITE'))).toEqual([
                {
                    code: 'furniture.archived_code',
                    severity: 'warning',
                    messageKey: 'engine.furniture.issue.archived_code',
                    params: { code: 'EB08-WHITE' },
                    entityIds: [],
                },
            ]);
        });

        it('reports a deleted default band as unknown_code of kind edge_band, once', () => {
            expect(edgeIssues(withoutEdgeBand('EB08-WHITE'))).toEqual([
                {
                    code: 'furniture.unknown_code',
                    severity: 'error',
                    messageKey: 'engine.furniture.issue.unknown_code',
                    params: { code: 'EB08-WHITE', kind: 'edge_band' },
                    entityIds: [],
                },
            ]);
        });

        it('reports a code once when it is both explicit and derived', () => {
            const doc = wardrobeFixture((d) => {
                d.materials.carcass.edgeBandCode = 'EB08-WHITE';
            });
            expect(edgeIssues(withoutEdgeBand('EB08-WHITE'), doc)).toHaveLength(
                1,
            );
        });

        it('ignores a default band that an explicit band replaces in every role', () => {
            const doc = wardrobeFixture((d) => {
                for (const role of [
                    'carcass',
                    'shelf',
                    'front',
                    'top',
                    'plinth',
                ] as const) {
                    d.materials[role].edgeBandCode = 'EB08-ANTH';
                }
            });
            expect(edgeIssues(withoutEdgeBand('EB08-WHITE'), doc)).toEqual([]);
        });

        it('reports the band of the fallback material for an unknown material', () => {
            const doc = wardrobeFixture((d) => {
                d.materials.front = assign('GONE-01');
            });
            const issues = edgeIssues(withoutEdgeBand('EB08-WHITE'), doc);
            expect(issues.map((i) => i.params)).toEqual([
                { code: 'GONE-01', kind: 'material' },
                { code: 'EB08-WHITE', kind: 'edge_band' },
            ]);
        });
    });
});

describe('too_many_parts (03 §2.4)', () => {
    const extra = (n: number, qty: number): ExtraPart => ({
        id: `p_${String(n).padStart(10, '0')}`,
        name: `Extra ${n}`,
        role: 'shelf',
        materialCode: 'PB18-WHITE',
        length: 300,
        width: 200,
        qty,
        edges: { L1: null, L2: null, W1: null, W2: null },
        grain: 'none',
        note: null,
        placement: null,
    });
    /** The wardrobe (20 parts) plus extras of `quantities`. */
    const withExtras = (...quantities: number[]) =>
        wardrobeFixture((d) => {
            d.overrides.extraParts = quantities.map((q, k) => extra(k + 1, q));
        });
    const partCount = (doc: FurnitureDocument): number =>
        generateFurniture(doc, catalog).parts.reduce((n, p) => n + p.qty, 0);

    it('flags 401 generated parts (sum of qty), with the count', () => {
        const doc = withExtras(99, 99, 99, 84);
        expect(partCount(doc)).toBe(401);
        const issues = validate(doc);
        expect(only(issues, 'furniture.too_many_parts')).toEqual([
            {
                code: 'furniture.too_many_parts',
                severity: 'error',
                messageKey: 'engine.furniture.issue.too_many_parts',
                params: { count: 401 },
                entityIds: [],
            },
        ]);
        expect(isSaveBlocking(issues)).toBe(true);
    });

    it('accepts exactly 400 parts', () => {
        const doc = withExtras(99, 99, 99, 83);
        expect(partCount(doc)).toBe(400);
        expect(only(validate(doc), 'furniture.too_many_parts')).toEqual([]);
    });

    it('counts the parts after the overrides', () => {
        const doc = withExtras(99, 99, 99, 84);
        doc.overrides.parts['carcass.top'] = { removed: true };
        expect(partCount(doc)).toBe(400);
        expect(only(validate(doc), 'furniture.too_many_parts')).toEqual([]);
    });
});

describe('save blocking (03 §2.4, 07 §7.1)', () => {
    const NINE = [
        'furniture.dims_range',
        'furniture.family_mismatch',
        'furniture.section_tree_invalid',
        'furniture.section_too_small',
        'furniture.fixed_sizes_exceed',
        'furniture.front_not_rectangle',
        'furniture.front_overlap',
        'furniture.unknown_code',
        'furniture.too_many_parts',
    ] satisfies FurnitureIssueCode[] as FurnitureIssueCode[];

    it('SAVE_BLOCKING_CODES is exactly the nine codes of 03 §2.4', () => {
        expect([...SAVE_BLOCKING_CODES].sort()).toEqual([...NINE].sort());
    });

    it.each(NINE)('%s blocks', (code) => {
        expect(isSaveBlocking([furnitureIssue(code, 'error')])).toBe(true);
    });

    it('other codes, errors included, do not block', () => {
        const others = FURNITURE_ISSUE_CODES.filter((c) => !NINE.includes(c));
        expect(others.length).toBe(FURNITURE_ISSUE_CODES.length - 9);
        for (const code of others) {
            expect(isSaveBlocking([furnitureIssue(code, 'error')])).toBe(false);
        }
        expect(isSaveBlocking([])).toBe(false);
    });

    it('one blocking issue among others blocks', () => {
        expect(
            isSaveBlocking([
                furnitureIssue('furniture.weight_estimate', 'info', { kg: 1 }),
                furnitureIssue('furniture.too_many_parts', 'error', {
                    count: 401,
                }),
            ]),
        ).toBe(true);
    });

    it('shelves_dont_fit is an error that does not block saving', () => {
        const doc = boxDocument({
            width: 600,
            height: 300,
            depth: 560,
            content: {
                type: 'shelves',
                count: 20,
                adjustable: true,
                frontSetback: 20,
            },
        });
        const issues = validate(doc);
        const found = only(issues, 'furniture.shelves_dont_fit');
        expect(found).toHaveLength(1);
        expect(found[0]?.severity).toBe('error');
        expect(isSaveBlocking(issues)).toBe(false);
    });

    it('CRITICAL_WARNING_CODES lists the four critical warnings of 07 §7.1', () => {
        expect([...CRITICAL_WARNING_CODES]).toEqual([
            'furniture.shelf_sag_critical',
            'furniture.door_heavy',
            'furniture.sliding_leaf_heavy',
            'furniture.part_exceeds_sheet_back',
        ]);
    });
});

describe('dedupeIssues (07 §7.1)', () => {
    const issue = (
        code: FurnitureIssueCode,
        entityIds: string[],
        params: Issue['params'] = {},
    ) => furnitureIssue(code, 'warning', params, entityIds);

    it('keeps the first of issues with the same code and entities', () => {
        const a = issue('furniture.shelf_sag', ['k1'], { span: 1 });
        const b = issue('furniture.shelf_sag', ['k1'], { span: 2 });
        expect(dedupeIssues([a, b])).toEqual([a]);
    });

    it('treats entityIds as a set: order does not matter', () => {
        const a = issue('furniture.front_overlap', ['a', 'b']);
        const b = issue('furniture.front_overlap', ['b', 'a']);
        expect(dedupeIssues([a, b])).toEqual([a]);
    });

    it('keeps issues of other codes or other entities, in order', () => {
        const list = [
            issue('furniture.shelf_sag', ['k1']),
            issue('furniture.shelf_sag', ['k2']),
            issue('furniture.shelf_sag_critical', ['k1']),
            issue('furniture.shelf_sag', ['k1', 'k2']),
        ];
        expect(dedupeIssues(list)).toEqual(list);
    });

    it('does not confuse entity lists that join to the same text', () => {
        const list = [
            issue('furniture.front_overlap', ['a,b']),
            issue('furniture.front_overlap', ['a', 'b']),
        ];
        expect(dedupeIssues(list)).toHaveLength(2);
    });

    it('tells issues without entities apart by their params', () => {
        const list = [
            issue('furniture.unknown_code', [], {
                code: 'A',
                kind: 'material',
            }),
            issue('furniture.unknown_code', [], {
                code: 'B',
                kind: 'material',
            }),
            issue('furniture.unknown_code', [], {
                kind: 'material',
                code: 'A',
            }),
        ];
        expect(dedupeIssues(list).map((i) => i.params.code)).toEqual([
            'A',
            'B',
        ]);
    });

    it('does not mutate its input', () => {
        const list = [
            issue('furniture.shelf_sag', ['k']),
            issue('furniture.shelf_sag', ['k']),
        ];
        dedupeIssues(list);
        expect(list).toHaveLength(2);
    });

    it('validateFurniture lists structural issues before the generated ones', () => {
        const doc = wardrobeFixture((d) => {
            d.dims.width = 6001;
        });
        const codes = codesOf(validate(doc));
        expect(codes[0]).toBe('furniture.dims_range');
        expect(codes.indexOf('furniture.weight_estimate')).toBeGreaterThan(0);
    });
});

describe('FURNITURE_ISSUE_CODES (07 §7.3)', () => {
    it('lists the 69 codes of the catalogue in table order, then the 2 spec-19 additions, without duplicates', () => {
        expect(FURNITURE_ISSUE_CODES).toHaveLength(71);
        expect(new Set(FURNITURE_ISSUE_CODES).size).toBe(71);
        expect(FURNITURE_ISSUE_CODES.slice(0, 11)).toEqual([
            'furniture.dims_range',
            'furniture.family_mismatch',
            'furniture.section_tree_invalid',
            'furniture.section_too_small',
            'furniture.fixed_sizes_exceed',
            'furniture.front_not_rectangle',
            'furniture.front_overlap',
            'furniture.unknown_code',
            'furniture.too_many_parts',
            'furniture.envelope_too_small',
            'furniture.part_exceeds_sheet',
        ]);
        expect(FURNITURE_ISSUE_CODES.slice(-4)).toEqual([
            'furniture.override_orphaned',
            'furniture.part_exceeds_sheet_back',
            // spec 19 additions (Task 38 fix round 2)
            'furniture.table_drawers_dont_fit',
            'furniture.apron_inset_clamped',
        ]);
        expect(
            FURNITURE_ISSUE_CODES.every((c) => /^furniture\.[a-z_]+$/.test(c)),
        ).toBe(true);
    });

    it('contains every code the SAVE_BLOCKING and CRITICAL sets name', () => {
        for (const code of [
            ...SAVE_BLOCKING_CODES,
            ...CRITICAL_WARNING_CODES,
        ]) {
            expect(FURNITURE_ISSUE_CODES).toContain(code);
        }
    });

    /** Source files of the furniture engine, tests and test helpers excluded. */
    function sources(dir: string): string[] {
        return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
            const path = join(dir, entry.name);
            if (entry.isDirectory()) {
                return entry.name === '__tests__' || entry.name === 'testing'
                    ? []
                    : sources(path);
            }
            return entry.name.endsWith('.ts') ? [path] : [];
        });
    }

    it('contains every furniture code literal that appears in the furniture engine', () => {
        const root = new URL('..', import.meta.url).pathname;
        const files = sources(root);
        expect(files.length).toBeGreaterThan(30);
        const known = new Set<string>(FURNITURE_ISSUE_CODES);
        const unknown: string[] = [];
        let found = 0;
        for (const file of files) {
            const text = readFileSync(file, 'utf8');
            for (const m of text.matchAll(/'(furniture\.[a-z_]+)'/g)) {
                found += 1;
                if (!known.has(m[1] ?? '')) unknown.push(`${file}: ${m[1]}`);
            }
        }
        expect(found).toBeGreaterThan(50);
        expect(unknown).toEqual([]);
    });
});

describe('drawer issues survive deduplication (Task 37 M2)', () => {
    it('keeps four drawer_too_low issues for four short drawers', () => {
        // 300 mm behind a door: 4 slots of 75 -> boxes of 30 < 60
        const doc = boxDocument({
            width: 600,
            height: 336,
            depth: 560,
            content: {
                type: 'drawers',
                count: 4,
                frontHeights: 'equal',
                slideCode: null,
                behindDoor: true,
            },
        });
        const issues = only(validate(doc), 'furniture.drawer_too_low');
        expect(issues.map((i) => i.params)).toEqual(
            [1, 2, 3, 4].map((drawer) => ({ sectionId: ROOT, drawer })),
        );
        expect(issues.map((i) => i.entityIds)).toEqual(
            [1, 2, 3, 4].map((j) => [ROOT, `section.${ROOT}.drawer.${j}`]),
        );
    });
});

describe('model-level rules are wired into generateFurniture', () => {
    it('reports drawer_bottom_thick through validateFurniture', () => {
        const doc = drawerTestBox();
        doc.materials.drawer_bottom = assign('PB18-WHITE');
        expect(codesOf(validate(doc))).toContain(
            'furniture.drawer_bottom_thick',
        );
    });
});
