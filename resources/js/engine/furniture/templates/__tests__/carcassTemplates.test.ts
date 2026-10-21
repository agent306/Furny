/**
 * The 14 carcass templates of Task 39 (07 §2.4.2-§2.4.13, §2.4.18-§2.4.19).
 * The golden documents are written out here from the spec text, with the
 * deterministic ids of `testIds()` (07 §12.1): sections pre-order, then fronts.
 */
import { describe, expect, it } from 'vitest';
import { testIds } from '../../../testing/ids';
import { seedCatalog } from '../../../testing/seedCatalog';
import { indexCatalog } from '../../catalogIndex';
import { generateFurniture } from '../../generate';
import { FurnitureDocumentSchema, type FurnitureDocument } from '../../schema';
import type { Part } from '../../types';
import { partOverlaps, sameDrawerBox } from '../../testing/overlaps';
import { isSaveBlocking, validateFurniture } from '../../validate';
import { TEMPLATES, getTemplate, templateDefaultDocument } from '../index';
import type { TemplateContext, TemplateDefinition } from '../types';

const snapshot = seedCatalog();
const catalog = indexCatalog(snapshot);
const ctx = (): TemplateContext => ({ catalog, newId: testIds() });

type CarcassKey = Exclude<
    keyof typeof TEMPLATES,
    | 'wardrobe_hinged'
    | 'study_desk'
    | 'dining_table'
    | 'coffee_table'
    | 'console_table'
>;

const CARCASS_KEYS: CarcassKey[] = [
    'wardrobe_sliding',
    'loft_cabinet',
    'base_cabinet',
    'wall_cabinet',
    'tall_cabinet',
    'bookshelf',
    'open_shelf_wall',
    'tv_unit',
    'shoe_rack',
    'chest_of_drawers',
    'sideboard',
    'bedside_table',
    'dressing_unit',
    'custom_box',
];

const template = (key: CarcassKey): TemplateDefinition => TEMPLATES[key];

/** The template's document for its defaults overridden by `over`. */
function gen(key: CarcassKey, over: Record<string, unknown> = {}) {
    const t = template(key);
    return t.generate({ ...t.defaults, ...over }, ctx());
}

// --- Expected-document builders (independent of the implementation) ----------

const S = (n: number) => `s_${String(n).padStart(10, '0')}`;
const FR = (n: number) => `fr_${String(n).padStart(10, '0')}`;
const flex = (weight = 1) => ({ mode: 'flex', weight });
const fixed = (mm: number) => ({ mode: 'fixed', mm });
const leafAt = (n: number, content: unknown) => ({
    id: S(n),
    split: 'none',
    children: [],
    content,
});
const node = (
    n: number,
    dir: 'columns' | 'rows',
    ...children: Array<[unknown, unknown]>
) => ({
    id: S(n),
    split: dir,
    children: children.map(([size, section]) => ({ size, section })),
    content: null,
});
const empty = { type: 'empty' };
const shelves = (count: number, frontSetback = 20) => ({
    type: 'shelves',
    count,
    adjustable: true,
    frontSetback,
});
const drawers = (count: number, slideCode: string | null) => ({
    type: 'drawers',
    count,
    frontHeights: 'equal',
    slideCode,
    behindDoor: false,
});
const rod = { type: 'hanging_rod', topClearance: 60, rodCode: null };
const front = (
    n: number,
    kind: string,
    covers: string[],
    leaves: number | 'auto',
    hingeSide: string,
) => ({
    id: FR(n),
    kind,
    covers,
    leaves,
    hingeSide,
    overlay: 'full',
    glass: false,
    handleCode: 'inherit',
    hingeCode: kind === 'sliding' ? null : 'auto',
    slidingTrackCode: kind === 'sliding' ? 'auto' : null,
});
const door = (
    n: number,
    covers: string[],
    leaves: number | 'auto',
    hingeSide: string,
) => front(n, 'hinged', covers, leaves, hingeSide);

const SLIDE_SIDE = 'SLD-BB-450';
const SLIDE_UNDER = 'SLD-UM-450';

const assign = (materialCode: string) => ({
    materialCode,
    edgeBandCode: null,
    finishCode: null,
});
const MATERIALS = {
    carcass: assign('PB18-WHITE'),
    back: assign('HDF3-WHITE'),
    shelf: assign('PB18-WHITE'),
    front: assign('PB18-WHITE'),
    top: assign('PB18-WHITE'),
    drawer_box: assign('PLY12-BWR'),
    drawer_bottom: assign('HDF3-WHITE'),
    plinth: assign('PB18-WHITE'),
    leg: assign('SW50-RUBBER'),
};
const NO_PLINTH = { type: 'none', height: 0, setback: 0, legCode: null };
const plinth = (type: 'plinth' | 'legs', height: number, setback: number) => ({
    type,
    height,
    setback,
    legCode: null,
});

/** A whole carcass document: 07 §2.3 common defaults, then what the template changes. */
function expected(
    templateKey: string,
    [width, height, depth]: [number, number, number],
    carcass: Record<string, unknown>,
    materials: Record<string, unknown> = MATERIALS,
) {
    return {
        schemaVersion: 1,
        templateKey,
        family: 'carcass',
        dims: { width, height, depth },
        materials,
        carcass: {
            construction: { top: 'between_sides', bottom: 'between_sides' },
            mounting: 'floor',
            plinth: NO_PLINTH,
            back: { type: 'grooved' },
            countertop: null,
            handles: {
                code: 'HDL-BAR-160',
                orientation: 'auto',
                placement: 'auto',
            },
            ...carcass,
        },
        table: null,
        overrides: {
            parts: {},
            extraParts: [],
            hardware: {},
            extraHardware: [],
        },
        notes: null,
    };
}

// --- Validity helpers ---------------------------------------------------------

/**
 * Part boxes may touch but never intersect. The one exception is a grooved
 * back against the sides, top and bottom: its edge sits in their groove, and
 * grooving is not modelled as an operation (07 §3.4), so those boxes overlap
 * by the 7 mm tongue. The back against anything else (shelves, dividers,
 * drawer boxes, the plinth) must still not overlap.
 */
// `.n`: the pieces of a top or bottom split at seams (R40-1).
const TONGUE_PARTNER = /^carcass\.(side\.(left|right)|top|bottom)(\.\d+)?$/;
function overlapsOf(doc: FurnitureDocument): string[] {
    const grooved = doc.carcass?.back.type === 'grooved';
    const inGroove = (a: Part, b: Part): boolean =>
        grooved &&
        ((a.key.startsWith('carcass.back') && TONGUE_PARTNER.test(b.key)) ||
            (b.key.startsWith('carcass.back') && TONGUE_PARTNER.test(a.key)));
    return partOverlaps(generateFurniture(doc, snapshot).parts, {
        ignore: (a, b) => sameDrawerBox(a, b) || inGroove(a, b),
    });
}

const errorsOf = (doc: FurnitureDocument) =>
    validateFurniture(doc, snapshot).filter((i) => i.severity === 'error');

/** No error, and for the defaults not even a warning. */
function expectValid(doc: FurnitureDocument) {
    expect(() => FurnitureDocumentSchema.parse(doc)).not.toThrow();
    expect(errorsOf(doc)).toStrictEqual([]);
    expect(overlapsOf(doc)).toStrictEqual([]);
}

const columnsOf = (doc: FurnitureDocument) =>
    (doc.carcass?.interior.children ?? []).map((c) => c.size);
const fronts = (doc: FurnitureDocument) => doc.carcass?.fronts ?? [];

// --- Definitions ---------------------------------------------------------------

// Field builders for the expected §2.4 tables (written out, not taken from common.ts).
const labelOf = (key: string) => `templates.fields.${key}`;
const L = (key: string, min: number, max: number, extra = {}) => ({
    key,
    kind: 'length',
    labelKey: labelOf(key),
    min,
    max,
    step: 10,
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
const DIMS = (
    w: [number, number],
    h: [number, number],
    d: [number, number],
) => [L('width', ...w), L('height', ...h), L('depth', ...d)];

/** key -> [category, the complete field list in UI order] from the §2.4 tables. */
const SPEC: Record<CarcassKey, [string, unknown[]]> = {
    wardrobe_sliding: [
        'wardrobe',
        [
            // 07 §2.4.2 says 2700; capped so the sides fit the sheet (R40-2)
            ...DIMS([1200, 3600], [1800, 2420], [550, 750]),
            I('leaves', 2, 4, { allowAuto: true }),
            L('plinthHeight', 0, 150, { advanced: true }),
        ],
    ],
    loft_cabinet: [
        'wardrobe',
        [
            ...DIMS([400, 3600], [300, 1000], [300, 750]),
            I('doors', 1, 12, { allowAuto: true }),
            SEL('frontKind', ['hinged', 'flap_up']),
        ],
    ],
    base_cabinet: [
        'kitchen',
        [
            ...DIMS([150, 1200], [700, 950], [450, 650]),
            SEL('variant', ['door', 'drawers', 'door_drawer', 'basket']),
            I('drawerCount', 2, 5, {
                visibleIf: { key: 'variant', equals: 'drawers' },
            }),
            B('countertop'),
            L('plinthHeight', 80, 150, { advanced: true }),
        ],
    ],
    wall_cabinet: [
        'kitchen',
        [
            ...DIMS([300, 1200], [300, 1000], [250, 400]),
            SEL('frontKind', ['hinged', 'flap_up', 'open']),
        ],
    ],
    tall_cabinet: [
        'kitchen',
        [...DIMS([300, 900], [1800, 2400], [450, 650]), B('applianceNiche')],
    ],
    bookshelf: [
        'shelving',
        [
            ...DIMS([300, 2400], [600, 2400], [200, 450]),
            I('columns', 1, 6, { allowAuto: true }),
            B('lowerDoors'),
        ],
    ],
    open_shelf_wall: [
        'shelving',
        [
            ...DIMS([300, 2400], [150, 1200], [150, 400]),
            I('rows', 1, 6, { allowAuto: true }),
            I('columns', 1, 6, { allowAuto: true }),
        ],
    ],
    tv_unit: [
        'tv_unit',
        [
            ...DIMS([900, 3000], [300, 700], [300, 550]),
            SEL('mounting', ['floor', 'wall']),
            SEL('layout', ['drawers_open_door', 'doors_open_doors', 'flaps']),
        ],
    ],
    shoe_rack: ['storage', DIMS([400, 1500], [600, 1800], [300, 420])],
    chest_of_drawers: [
        'storage',
        [
            ...DIMS([400, 1600], [500, 1400], [350, 600]),
            I('drawerCount', 2, 8, { allowAuto: true }),
            // `auto` is the width-dependent default `width > 1000 ? 2 : 1` (accepted)
            SEL('columns', ['auto', '1', '2']),
            SEL('slideType', ['side_mount', 'undermount'], {
                advanced: true,
            }),
        ],
    ],
    sideboard: [
        'storage',
        [...DIMS([900, 2700], [600, 1000], [350, 550]), L('legHeight', 0, 250)],
    ],
    bedside_table: [
        'storage',
        [
            ...DIMS([300, 700], [400, 700], [300, 500]),
            SEL('variant', ['drawer_open', 'two_drawers', 'drawer_door']),
        ],
    ],
    dressing_unit: [
        'storage',
        [...DIMS([900, 1800], [1500, 2200], [400, 600]), I('drawerRows', 2, 4)],
    ],
    custom_box: [
        'other',
        [
            // 07 §2.4.19 says 100-3000: 120 keeps an 80 mm interior (R40-3),
            // 2420 keeps the sides within the sheet (R40-2)
            ...DIMS([150, 6000], [120, 2420], [100, 1200]),
            SEL('mounting', ['floor', 'wall', 'loft']),
        ],
    ],
};

/** key -> defaults of §2.4 (an `'auto'` stays `'auto'`). */
const DEFAULTS: Record<CarcassKey, Record<string, unknown>> = {
    wardrobe_sliding: {
        width: 2400,
        height: 2100,
        depth: 650,
        leaves: 'auto',
        plinthHeight: 100,
    },
    loft_cabinet: {
        width: 1800,
        height: 600,
        depth: 600,
        doors: 'auto',
        frontKind: 'hinged',
    },
    base_cabinet: {
        width: 600,
        height: 850,
        depth: 560,
        variant: 'door',
        drawerCount: 3,
        countertop: false,
        plinthHeight: 100,
    },
    wall_cabinet: { width: 600, height: 700, depth: 330, frontKind: 'hinged' },
    tall_cabinet: {
        width: 600,
        height: 2100,
        depth: 560,
        applianceNiche: false,
    },
    bookshelf: {
        width: 900,
        height: 1800,
        depth: 300,
        columns: 'auto',
        lowerDoors: false,
    },
    open_shelf_wall: {
        width: 1200,
        height: 400,
        depth: 250,
        rows: 'auto',
        columns: 'auto',
    },
    tv_unit: {
        width: 1800,
        height: 450,
        depth: 400,
        mounting: 'floor',
        layout: 'drawers_open_door',
    },
    shoe_rack: { width: 800, height: 1000, depth: 350 },
    chest_of_drawers: {
        width: 800,
        height: 1000,
        depth: 450,
        drawerCount: 'auto',
        columns: 'auto',
        slideType: 'side_mount',
    },
    sideboard: { width: 1600, height: 800, depth: 450, legHeight: 150 },
    bedside_table: {
        width: 450,
        height: 550,
        depth: 400,
        variant: 'drawer_open',
    },
    dressing_unit: { width: 1200, height: 1800, depth: 450, drawerRows: 3 },
    custom_box: { width: 600, height: 720, depth: 560, mounting: 'floor' },
};

describe.each(CARCASS_KEYS)('%s definition', (key) => {
    const t = template(key);
    const [category, fields] = SPEC[key];

    it('is registered with its spec metadata', () => {
        expect(TEMPLATES[key]).toBe(t);
        expect(getTemplate(key)).toBe(t);
        expect(t).toMatchObject({
            key,
            family: 'carcass',
            category,
            nameKey: `templates.${key}.name`,
            descriptionKey: `templates.${key}.description`,
            thumbnail: `/images/templates/${key}.svg`,
        });
    });

    it('lists exactly the §2.4 fields, in order, with every attribute', () => {
        expect(t.fields).toStrictEqual(fields);
    });

    it('has the code defaults of §2.4, one per field', () => {
        expect(t.defaults).toStrictEqual(DEFAULTS[key]);
        expect(Object.keys(t.defaults).sort()).toStrictEqual(
            t.fields.map((f) => f.key).sort(),
        );
    });

    it('pins the label keys', () => {
        for (const f of t.fields) {
            expect(f.labelKey).toBe(`templates.fields.${f.key}`);
            if (f.kind === 'select') {
                for (const o of f.options) {
                    expect(o.labelKey).toBe(`templates.options.${o.value}`);
                }
            }
        }
    });

    it('accepts its defaults and enforces every field range in paramsSchema', () => {
        expect(t.paramsSchema.safeParse(t.defaults).success).toBe(true);
        const accepts = (key: string, value: unknown) =>
            t.paramsSchema.safeParse({ ...t.defaults, [key]: value }).success;
        for (const f of t.fields) {
            if (f.kind === 'length' || f.kind === 'int') {
                expect(accepts(f.key, f.min)).toBe(true);
                expect(accepts(f.key, f.max)).toBe(true);
                expect(accepts(f.key, f.min - 1)).toBe(false);
                expect(accepts(f.key, f.max + 1)).toBe(false);
                expect(accepts(f.key, 'auto')).toBe(
                    f.kind === 'int' && f.allowAuto === true,
                );
            } else if (f.kind === 'select') {
                for (const o of f.options)
                    expect(accepts(f.key, o.value)).toBe(true);
                expect(accepts(f.key, 'nope')).toBe(false);
            } else {
                expect(accepts(f.key, true)).toBe(true);
                expect(accepts(f.key, 'yes')).toBe(false);
            }
        }
    });

    it('generates a valid, deterministic default with no error or warning', () => {
        const doc = gen(key);
        expectValid(doc);
        expect(gen(key)).toStrictEqual(doc);
        const issues = validateFurniture(doc, snapshot);
        expect(issues.filter((i) => i.severity !== 'info')).toStrictEqual([]);
        expect(isSaveBlocking(issues)).toBe(false);
        const viaIndex = templateDefaultDocument(key, {}, catalog, testIds());
        expect(viaIndex.document).toStrictEqual(doc);
        expect(viaIndex.issues).toStrictEqual(issues);
    });
});

// --- Per template ----------------------------------------------------------------

describe('wardrobe_sliding (§2.4.2)', () => {
    const track = (leaves: number) =>
        front(1, 'sliding', [S(1)], leaves, 'auto');

    it('raises the leaf count until each leaf fits a sheet (spec 19, Task 40)', () => {
        const leaves = (over: Record<string, unknown>) =>
            fronts(gen('wardrobe_sliding', over)).map((f) => f.leaves);
        // (3600 + 30) / 2 = 1815 and (3600 + 60) / 3 = 1220 exceed 1200
        expect(leaves({ leaves: 2, width: 3600 })).toStrictEqual([4]);
        // (2400 + 30) / 2 = 1215 > 1200; (2400 + 60) / 3 = 820 fits
        expect(leaves({ leaves: 2, width: 2400 })).toStrictEqual([3]);
        expect(leaves({ leaves: 2, width: 2300 })).toStrictEqual([2]);
        expectValid(gen('wardrobe_sliding', { leaves: 2, width: 3600 }));
    });

    it('is valid at the capped height 2420 without a plinth', () => {
        expectValid(gen('wardrobe_sliding', { height: 2420, plinthHeight: 0 }));
    });

    it('default: 3 flex columns of shelves / hanging zone / shelves, one sliding front', () => {
        expect(gen('wardrobe_sliding')).toStrictEqual(
            expected('wardrobe_sliding', [2400, 2100, 650], {
                plinth: plinth('plinth', 100, 0),
                handles: {
                    code: 'HDL-FLUSH',
                    orientation: 'auto',
                    placement: 'auto',
                },
                interior: node(
                    1,
                    'columns',
                    [flex(), leafAt(2, shelves(4))],
                    [
                        flex(),
                        node(
                            3,
                            'rows',
                            [fixed(350), leafAt(4, empty)],
                            [flex(), leafAt(5, rod)],
                        ),
                    ],
                    [flex(), leafAt(6, shelves(4))],
                ),
                fronts: [track(3)],
            }),
        );
    });

    it("resolves leaves 'auto' to clamp(max(2, ceil((width - 36) / 1000)), 2, 4)", () => {
        const leaves = (width: number) =>
            fronts(gen('wardrobe_sliding', { width }))[0]?.leaves;
        expect(leaves(1200)).toBe(2);
        expect(leaves(1900)).toBe(2); // ceil(1.864)
        expect(leaves(2036)).toBe(2); // ceil(2.0)
        expect(leaves(2037)).toBe(3);
        expect(leaves(3036)).toBe(3);
        expect(leaves(3037)).toBe(4);
        expect(leaves(3600)).toBe(4);
    });

    it('alternates shelves and hanging columns, one sliding front over the root', () => {
        const doc = gen('wardrobe_sliding', { leaves: 4, width: 3000 });
        const kinds = (doc.carcass?.interior.children ?? []).map((c) =>
            c.section.split === 'none' ? c.section.content?.type : 'rows',
        );
        expect(kinds).toStrictEqual(['shelves', 'rows', 'shelves', 'rows']);
        expect(columnsOf(doc)).toStrictEqual([flex(), flex(), flex(), flex()]);
        expect(fronts(doc)).toStrictEqual([track(4)]);
    });

    it('plinthHeight 0 means no plinth; the setback is always 0', () => {
        expect(
            gen('wardrobe_sliding', { plinthHeight: 0 }).carcass?.plinth,
        ).toStrictEqual(NO_PLINTH);
        expect(
            gen('wardrobe_sliding', { plinthHeight: 60 }).carcass?.plinth,
        ).toStrictEqual(plinth('plinth', 60, 0));
    });

    it('falls back to the default handle when the catalog has no flush handle', () => {
        const flushOnly = indexCatalog({
            ...snapshot,
            hardware: snapshot.hardware.map((h) => ({
                ...h,
                isDefaultFor: h.isDefaultFor.filter(
                    (r) => r !== 'handle.flush',
                ),
            })),
        });
        const doc = template('wardrobe_sliding').generate(
            template('wardrobe_sliding').defaults,
            { catalog: flushOnly, newId: testIds() },
        );
        expect(doc.carcass?.handles.code).toBe('HDL-BAR-160');
    });
});

describe('loft_cabinet (§2.4.3)', () => {
    it('raises the door count until each leaf (a flap: its column) fits a sheet (spec 19)', () => {
        const leaves = (over: Record<string, unknown>) =>
            fronts(gen('loft_cabinet', over)).map((f) => f.leaves);
        // one 3618 x 600 door exceeds the 2420 sheet length; two of 1818 fit
        expect(leaves({ doors: 1, width: 3600 })).toStrictEqual([2]);
        // flaps span their column: 3 doors -> columns of 1218 and 2418
        expect(
            leaves({ doors: 1, width: 3600, frontKind: 'flap_up' }),
        ).toStrictEqual([1, 1]);
        expectValid(gen('loft_cabinet', { doors: 1, width: 3600 }));
        expectValid(
            gen('loft_cabinet', {
                doors: 1,
                width: 3600,
                frontKind: 'flap_up',
            }),
        );
    });

    it('default: loft mounting, nailed back, empty columns with doors', () => {
        // 1800 -> 3 doors -> columnsFromDoors(3) = [1, 2]
        expect(gen('loft_cabinet')).toStrictEqual(
            expected('loft_cabinet', [1800, 600, 600], {
                mounting: 'loft',
                back: { type: 'nailed' },
                interior: node(
                    1,
                    'columns',
                    [flex(1), leafAt(2, empty)],
                    [flex(2), leafAt(3, empty)],
                ),
                fronts: [
                    door(1, [S(2)], 1, 'left'),
                    door(2, [S(3)], 2, 'auto'),
                ],
            }),
        );
    });

    it('flap_up gives one flap_up front per column, one leaf each', () => {
        const out = fronts(gen('loft_cabinet', { frontKind: 'flap_up' }));
        expect(out).toStrictEqual([
            front(1, 'flap_up', [S(2)], 1, 'auto'),
            front(2, 'flap_up', [S(3)], 1, 'auto'),
        ]);
    });

    it('a single door has no column split', () => {
        const doc = gen('loft_cabinet', { width: 600, doors: 1 });
        expect(doc.carcass?.interior).toStrictEqual(leafAt(1, empty));
        expect(fronts(doc)).toStrictEqual([door(1, [S(1)], 1, 'left')]);
        expectValid(doc);
    });

    it("doors 'auto' is clamp(round(width / 600), 1, 12) away from the default", () => {
        const doors = (width: number) =>
            fronts(gen('loft_cabinet', { width })).reduce(
                (n, f) => n + (f.leaves as number),
                0,
            );
        expect(doors(400)).toBe(1); // round(0.67)
        expect(doors(890)).toBe(1); // round(1.48)
        expect(doors(900)).toBe(2); // round(1.5)
        expect(doors(1500)).toBe(3); // round(2.5); 700 mm per door would give 2
        expect(doors(2100)).toBe(4); // round(3.5); 700 mm per door would give 3
        expect(doors(3600)).toBe(6);
    });

    it('doors above what the width holds are reduced (a door needs 100 mm)', () => {
        const leaves = (width: number, doors: number) =>
            fronts(gen('loft_cabinet', { width, doors })).reduce(
                (n, f) => n + (f.leaves as number),
                0,
            );
        expect(leaves(400, 12)).toBe(3);
        expect(leaves(400, 3)).toBe(3);
        expect(leaves(710, 11)).toBe(6);
        expect(leaves(3600, 12)).toBe(12);
        for (const doors of [1, 2, 6, 11, 12]) {
            expectValid(gen('loft_cabinet', { width: 400, doors }));
            expectValid(
                gen('loft_cabinet', {
                    width: 710,
                    doors,
                    frontKind: 'flap_up',
                }),
            );
        }
    });
});

describe('base_cabinet (§2.4.4)', () => {
    const legs = plinth('legs', 100, 50);

    it('default (door): shelves(1) with one auto door, on legs with a kickboard', () => {
        expect(gen('base_cabinet')).toStrictEqual(
            expected('base_cabinet', [600, 850, 560], {
                plinth: legs,
                interior: leafAt(1, shelves(1)),
                fronts: [door(1, [S(1)], 'auto', 'auto')],
            }),
        );
    });

    it('drawers: the undermount slide, no front', () => {
        expect(gen('base_cabinet', { variant: 'drawers' })).toStrictEqual(
            expected('base_cabinet', [600, 850, 560], {
                plinth: legs,
                interior: leafAt(1, drawers(3, SLIDE_UNDER)),
                fronts: [],
            }),
        );
        expect(
            gen('base_cabinet', { variant: 'drawers', drawerCount: 2 }).carcass
                ?.interior.content,
        ).toMatchObject({ count: 2 });
    });

    it('door_drawer: a fixed 150 drawer row over shelves, the door on row 2', () => {
        expect(gen('base_cabinet', { variant: 'door_drawer' })).toStrictEqual(
            expected('base_cabinet', [600, 850, 560], {
                plinth: legs,
                interior: node(
                    1,
                    'rows',
                    [fixed(150), leafAt(2, drawers(1, SLIDE_UNDER))],
                    [flex(), leafAt(3, shelves(1))],
                ),
                fronts: [door(1, [S(3)], 'auto', 'auto')],
            }),
        );
    });

    it('basket: two pull-out baskets behind a one-leaf door', () => {
        expect(gen('base_cabinet', { variant: 'basket' })).toStrictEqual(
            expected('base_cabinet', [600, 850, 560], {
                plinth: legs,
                interior: leafAt(1, {
                    type: 'pull_out_basket',
                    count: 2,
                    basketCode: null,
                }),
                fronts: [door(1, [S(1)], 1, 'auto')],
            }),
        );
    });

    it('countertop: 20 mm front overhang and the PB25-WHITE top material', () => {
        const doc = gen('base_cabinet', { countertop: true });
        expect(doc.carcass?.countertop).toStrictEqual({
            enabled: true,
            overhangFront: 20,
            overhangLeft: 0,
            overhangRight: 0,
        });
        expect(doc.materials).toStrictEqual({
            ...MATERIALS,
            top: assign('PB25-WHITE'),
        });
        expect(gen('base_cabinet').materials.top).toStrictEqual(
            assign('PB18-WHITE'),
        );
        expectValid(doc);
    });

    it('plinthHeight sets the leg height', () => {
        expect(
            gen('base_cabinet', { plinthHeight: 150 }).carcass?.plinth,
        ).toStrictEqual(plinth('legs', 150, 50));
    });

    it('fewer drawers when the height leaves boxes under 60 mm', () => {
        const count = (over: Record<string, unknown>) =>
            gen('base_cabinet', { variant: 'drawers', ...over }).carcass
                ?.interior.content;
        expect(
            count({ drawerCount: 5, height: 700, plinthHeight: 120 }),
        ).toMatchObject({
            count: 4,
        });
        expect(count({ drawerCount: 5, height: 850 })).toMatchObject({
            count: 5,
        });
        for (const height of [700, 750, 950]) {
            for (const plinthHeight of [80, 150]) {
                for (const countertop of [false, true]) {
                    expectValid(
                        gen('base_cabinet', {
                            variant: 'drawers',
                            drawerCount: 5,
                            width: 150,
                            height,
                            plinthHeight,
                            countertop,
                        }),
                    );
                }
            }
        }
    });

    it('every variant is valid', () => {
        for (const variant of ['door', 'drawers', 'door_drawer', 'basket']) {
            for (const width of [150, 600, 1200]) {
                expectValid(gen('base_cabinet', { variant, width }));
            }
        }
    });
});

describe('wall_cabinet (§2.4.5)', () => {
    const wall = (
        interior: unknown,
        fronts: unknown[],
        dims: [number, number, number] = [600, 700, 330],
    ) => expected('wall_cabinet', dims, { mounting: 'wall', interior, fronts });

    it('default: wall mounting, 2 shelves above 600 mm, one auto door', () => {
        expect(gen('wall_cabinet')).toStrictEqual(
            wall(leafAt(1, shelves(2)), [door(1, [S(1)], 'auto', 'auto')]),
        );
    });

    it('height 600 -> 1 shelf, height 700 -> 2', () => {
        const count = (height: number) =>
            gen('wall_cabinet', { height }).carcass?.interior.content;
        expect(count(600)).toMatchObject({ count: 1 });
        expect(count(601)).toMatchObject({ count: 2 });
        expect(count(300)).toMatchObject({ count: 1 });
    });

    it('flap_up: a flap_up front over the root', () => {
        expect(gen('wall_cabinet', { frontKind: 'flap_up' })).toStrictEqual(
            wall(leafAt(1, shelves(2)), [
                front(1, 'flap_up', [S(1)], 1, 'auto'),
            ]),
        );
    });

    it('open: no front', () => {
        expect(gen('wall_cabinet', { frontKind: 'open' })).toStrictEqual(
            wall(leafAt(1, shelves(2)), []),
        );
    });
});

describe('tall_cabinet (§2.4.6)', () => {
    const tall = (interior: unknown, fronts: unknown[]) =>
        expected('tall_cabinet', [600, 2100, 560], {
            plinth: plinth('legs', 100, 50),
            interior,
            fronts,
        });

    it('default: two rows of shelves, a door on each', () => {
        expect(gen('tall_cabinet')).toStrictEqual(
            tall(
                node(
                    1,
                    'rows',
                    [flex(), leafAt(2, shelves(2))],
                    [flex(), leafAt(3, shelves(3))],
                ),
                [
                    door(1, [S(2)], 'auto', 'auto'),
                    door(2, [S(3)], 'auto', 'auto'),
                ],
            ),
        );
    });

    it('with an appliance niche: a fixed 600 open row between, doors on rows 1 and 3', () => {
        expect(gen('tall_cabinet', { applianceNiche: true })).toStrictEqual(
            tall(
                node(
                    1,
                    'rows',
                    [flex(), leafAt(2, shelves(2))],
                    [fixed(600), leafAt(3, empty)],
                    [flex(), leafAt(4, shelves(2))],
                ),
                [
                    door(1, [S(2)], 'auto', 'auto'),
                    door(2, [S(4)], 'auto', 'auto'),
                ],
            ),
        );
    });
});

describe('bookshelf (§2.4.7)', () => {
    const book = (interior: unknown, fronts: unknown[] = [], h = 1800) =>
        expected('bookshelf', [900, h, 300], {
            plinth: plinth('plinth', 60, 0),
            back: { type: 'nailed' },
            interior,
            fronts,
        });

    it('default: 2 columns of shelfCount(1704, 330) = 4 shelves, no front setback', () => {
        expect(gen('bookshelf')).toStrictEqual(
            book(
                node(
                    1,
                    'columns',
                    [flex(), leafAt(2, shelves(4, 0))],
                    [flex(), leafAt(3, shelves(4, 0))],
                ),
            ),
        );
    });

    it("columns 'auto' is max(1, ceil(width / 800))", () => {
        const count = (width: number) =>
            gen('bookshelf', { width }).carcass?.interior.children.length;
        expect(count(300)).toBe(0); // a single column is the root leaf
        expect(count(800)).toBe(0);
        expect(count(801)).toBe(2);
        expect(count(1600)).toBe(2);
        expect(count(1601)).toBe(3);
        expect(count(2400)).toBe(3);
        expect(
            gen('bookshelf', { width: 600 }).carcass?.interior,
        ).toStrictEqual(leafAt(1, shelves(4, 0)));
    });

    it('height 2100 gives 5 shelves per column', () => {
        expect(
            gen('bookshelf', { height: 2100 }).carcass?.interior.children[0]
                ?.section.content,
        ).toMatchObject({ count: 5 });
    });

    it('lowerDoors: rows with a fixed 700 lower part and one auto door per lower column', () => {
        expect(gen('bookshelf', { lowerDoors: true })).toStrictEqual(
            book(
                node(
                    1,
                    'rows',
                    [
                        flex(),
                        node(
                            2,
                            'columns',
                            [flex(), leafAt(3, shelves(2, 0))],
                            [flex(), leafAt(4, shelves(2, 0))],
                        ),
                    ],
                    [
                        fixed(700),
                        node(
                            5,
                            'columns',
                            [flex(), leafAt(6, shelves(1))],
                            [flex(), leafAt(7, shelves(1))],
                        ),
                    ],
                ),
                [
                    door(1, [S(6)], 'auto', 'auto'),
                    door(2, [S(7)], 'auto', 'auto'),
                ],
            ),
        );
    });

    it('lowerDoors with one column splits only the rows', () => {
        const doc = gen('bookshelf', { width: 600, lowerDoors: true });
        expect(doc.carcass?.interior).toStrictEqual(
            node(
                1,
                'rows',
                [flex(), leafAt(2, shelves(2, 0))],
                [fixed(700), leafAt(3, shelves(1))],
            ),
        );
        expect(fronts(doc)).toStrictEqual([door(1, [S(3)], 'auto', 'auto')]);
    });

    it('a low shelf keeps 200 mm above a shorter lower part', () => {
        // ih = 600 - 60 - 36 = 504: lower = 504 - 18 - 200 = 286
        const doc = gen('bookshelf', { height: 600, lowerDoors: true });
        expect(doc.carcass?.interior.children[1]?.size).toStrictEqual(
            fixed(286),
        );
        expectValid(doc);
    });

    it('fewer columns when the width cannot give each 100 mm', () => {
        const count = (over: Record<string, unknown>) =>
            gen('bookshelf', over).carcass?.interior.children.length;
        expect(count({ width: 300, columns: 6 })).toBe(2);
        expect(count({ width: 660, columns: 6 })).toBe(5);
        expect(count({ width: 2400, columns: 6 })).toBe(6);
        for (const lowerDoors of [false, true]) {
            for (const width of [300, 410, 660, 1000, 2400]) {
                for (const columns of [1, 3, 6]) {
                    expectValid(
                        gen('bookshelf', { width, columns, lowerDoors }),
                    );
                }
            }
        }
    });
});

describe('open_shelf_wall (§2.4.8)', () => {
    const open = (
        interior: unknown,
        dims: [number, number, number] = [1200, 400, 250],
    ) =>
        expected('open_shelf_wall', dims, {
            construction: { top: 'over_sides', bottom: 'over_sides' },
            mounting: 'wall',
            back: { type: 'none' },
            interior,
            fronts: [],
        });

    it('default 1200 x 400: 1 row of 2 columns, over_sides, no back, no fronts', () => {
        expect(gen('open_shelf_wall')).toStrictEqual(
            open(
                node(
                    1,
                    'columns',
                    [flex(), leafAt(2, empty)],
                    [flex(), leafAt(3, empty)],
                ),
            ),
        );
    });

    it('2 rows of 2 columns at height 800', () => {
        expect(gen('open_shelf_wall', { height: 800 })).toStrictEqual(
            open(
                node(
                    1,
                    'rows',
                    [
                        flex(),
                        node(
                            2,
                            'columns',
                            [flex(), leafAt(3, empty)],
                            [flex(), leafAt(4, empty)],
                        ),
                    ],
                    [
                        flex(),
                        node(
                            5,
                            'columns',
                            [flex(), leafAt(6, empty)],
                            [flex(), leafAt(7, empty)],
                        ),
                    ],
                ),
                [1200, 800, 250],
            ),
        );
    });

    it("rows 'auto' is max(1, round(height / 350)), columns 'auto' max(1, ceil(width / 900))", () => {
        const shape = (over: Record<string, unknown>) => {
            const root = gen('open_shelf_wall', over).carcass?.interior;
            return root?.split === 'rows'
                ? ['rows', root.children.length]
                : [root?.split, root?.children.length];
        };
        expect(shape({ height: 150, width: 300 })).toStrictEqual(['none', 0]);
        expect(shape({ height: 524, width: 300 })).toStrictEqual(['none', 0]); // round(1.497)
        expect(shape({ height: 525, width: 300 })).toStrictEqual(['rows', 2]); // round(1.5)
        expect(shape({ height: 1200, width: 300 })).toStrictEqual(['rows', 3]);
        expect(shape({ width: 900 })).toStrictEqual(['none', 0]);
        expect(shape({ width: 901 })).toStrictEqual(['columns', 2]);
        expect(shape({ width: 2400 })).toStrictEqual(['columns', 3]);
    });

    it('one row and one column is a single empty leaf', () => {
        expect(
            gen('open_shelf_wall', { width: 300 }).carcass?.interior,
        ).toStrictEqual(leafAt(1, empty));
    });

    it('fewer rows and columns when the size cannot give each 80 / 100 mm', () => {
        const root = (over: Record<string, unknown>) =>
            gen('open_shelf_wall', over).carcass?.interior;
        expect(root({ width: 300, columns: 6, rows: 1 })?.children.length).toBe(
            2,
        );
        expect(
            root({ height: 150, width: 300, rows: 6, columns: 1 }),
        ).toStrictEqual(leafAt(1, empty));
        for (const [width, height] of [
            [300, 150],
            [1520, 180],
            [2400, 1200],
        ]) {
            for (const rows of [1, 6]) {
                for (const columns of [1, 6]) {
                    expectValid(
                        gen('open_shelf_wall', {
                            width,
                            height,
                            rows,
                            columns,
                        }),
                    );
                }
            }
        }
    });
});

describe('tv_unit (§2.4.9)', () => {
    const tv = (
        interior: unknown,
        fronts: unknown[],
        over: Record<string, unknown> = {},
    ) =>
        expected('tv_unit', [1800, 450, 400], {
            construction: { top: 'over_sides', bottom: 'between_sides' },
            plinth: plinth('legs', 100, 0),
            interior,
            fronts,
            ...over,
        });

    it('default drawers_open_door: columns w1 drawers(2) | w2 empty | w1 shelves(1) + a right door on column 3', () => {
        expect(gen('tv_unit')).toStrictEqual(
            tv(
                node(
                    1,
                    'columns',
                    [flex(1), leafAt(2, drawers(2, SLIDE_SIDE))],
                    [flex(2), leafAt(3, empty)],
                    [flex(1), leafAt(4, shelves(1))],
                ),
                [door(1, [S(4)], 1, 'right')],
            ),
        );
    });

    it('doors_open_doors: a left door on column 1 and a right door on column 3', () => {
        expect(gen('tv_unit', { layout: 'doors_open_doors' })).toStrictEqual(
            tv(
                node(
                    1,
                    'columns',
                    [flex(1), leafAt(2, shelves(1))],
                    [flex(2), leafAt(3, empty)],
                    [flex(1), leafAt(4, shelves(1))],
                ),
                [door(1, [S(2)], 1, 'left'), door(2, [S(4)], 1, 'right')],
            ),
        );
    });

    it('flaps: three equal empty columns, one flap_down each', () => {
        expect(gen('tv_unit', { layout: 'flaps' })).toStrictEqual(
            tv(
                node(
                    1,
                    'columns',
                    [flex(1), leafAt(2, empty)],
                    [flex(1), leafAt(3, empty)],
                    [flex(1), leafAt(4, empty)],
                ),
                [
                    front(1, 'flap_down', [S(2)], 1, 'auto'),
                    front(2, 'flap_down', [S(3)], 1, 'auto'),
                    front(3, 'flap_down', [S(4)], 1, 'auto'),
                ],
            ),
        );
    });

    it('wall mounting has no legs', () => {
        const doc = gen('tv_unit', { mounting: 'wall' });
        expect(doc.carcass?.plinth).toStrictEqual(NO_PLINTH);
        expect(doc.carcass?.mounting).toBe('wall');
        expect(doc.carcass?.construction).toStrictEqual({
            top: 'over_sides',
            bottom: 'between_sides',
        });
        expectValid(doc);
    });

    it('one drawer when the height leaves boxes under 60 mm', () => {
        const content = (over: Record<string, unknown>) =>
            gen('tv_unit', over).carcass?.interior.children[0]?.section.content;
        expect(content({ height: 300 })).toMatchObject({ count: 1 });
        expect(content({ height: 330 })).toMatchObject({ count: 1 });
        expect(content({ height: 340 })).toMatchObject({ count: 2 });
        expect(content({ height: 300, mounting: 'wall' })).toMatchObject({
            count: 2,
        });
        for (const height of [300, 340, 700]) {
            for (const mounting of ['floor', 'wall']) {
                expectValid(
                    gen('tv_unit', {
                        height,
                        mounting,
                        depth: 330,
                        width: 2110,
                    }),
                );
            }
        }
    });
});

describe('shoe_rack (§2.4.10)', () => {
    const rack = (
        interior: unknown,
        fronts: unknown[],
        dims: [number, number, number] = [800, 1000, 350],
    ) =>
        expected('shoe_rack', dims, {
            plinth: plinth('plinth', 60, 20),
            back: { type: 'nailed' },
            interior,
            fronts,
        });

    it('default 800: 2 columns of shelfCount(904, 180) = 4, hinges left then right', () => {
        expect(gen('shoe_rack')).toStrictEqual(
            rack(
                node(
                    1,
                    'columns',
                    [flex(), leafAt(2, shelves(4))],
                    [flex(), leafAt(3, shelves(4))],
                ),
                [door(1, [S(2)], 1, 'left'), door(2, [S(3)], 1, 'right')],
            ),
        );
    });

    it('max(1, ceil(width / 600)) columns; the first hinges left, the others right', () => {
        const sides = (width: number) =>
            fronts(gen('shoe_rack', { width })).map((f) => f.hingeSide);
        expect(sides(400)).toStrictEqual(['left']);
        expect(sides(600)).toStrictEqual(['left']);
        expect(sides(601)).toStrictEqual(['left', 'right']);
        expect(sides(1200)).toStrictEqual(['left', 'right']);
        expect(sides(1500)).toStrictEqual(['left', 'right', 'right']);
    });

    it('shelves follow shelfCount(height - 96, 180)', () => {
        const count = (height: number) =>
            gen('shoe_rack', { height }).carcass?.interior.children[0]?.section
                .content;
        expect(count(600)).toMatchObject({ count: 2 }); // 504 / 180 = 2.8
        expect(count(700)).toMatchObject({ count: 2 }); // 604 / 180 = 3.36
        expect(count(900)).toMatchObject({ count: 3 }); // 804 / 180 = 4.47
        expect(count(1100)).toMatchObject({ count: 5 }); // 1004 / 180 = 5.58
        expect(count(1500)).toMatchObject({ count: 7 }); // 1404 / 180 = 7.8
        expect(count(1800)).toMatchObject({ count: 8 }); // 1704 / 180 = 9.47
    });

    it('a single column is the root leaf', () => {
        const doc = gen('shoe_rack', { width: 500 });
        expect(doc.carcass?.interior).toStrictEqual(leafAt(1, shelves(4)));
        expect(fronts(doc)).toStrictEqual([door(1, [S(1)], 1, 'left')]);
        expectValid(doc);
    });
});

describe('chest_of_drawers (§2.4.11)', () => {
    const chest = (
        interior: unknown,
        dims: [number, number, number] = [800, 1000, 450],
    ) =>
        expected('chest_of_drawers', dims, {
            construction: { top: 'over_sides', bottom: 'between_sides' },
            plinth: plinth('plinth', 80, 20),
            interior,
            fronts: [],
        });

    it("default 800 x 1000: one column, drawerCount 'auto' = 4, side-mount slides, no fronts", () => {
        expect(gen('chest_of_drawers')).toStrictEqual(
            chest(leafAt(1, drawers(4, SLIDE_SIDE))),
        );
    });

    it('width 1100 gives 2 columns of drawers', () => {
        expect(gen('chest_of_drawers', { width: 1100 })).toStrictEqual(
            chest(
                node(
                    1,
                    'columns',
                    [flex(), leafAt(2, drawers(4, SLIDE_SIDE))],
                    [flex(), leafAt(3, drawers(4, SLIDE_SIDE))],
                ),
                [1100, 1000, 450],
            ),
        );
    });

    it("columns 'auto' switches to 2 above 1000 mm; an explicit 1 or 2 wins", () => {
        const count = (over: Record<string, unknown>) =>
            gen('chest_of_drawers', over).carcass?.interior.children.length;
        expect(count({ width: 1000 })).toBe(0);
        expect(count({ width: 1010 })).toBe(2);
        expect(count({ width: 1500, columns: '1' })).toBe(0);
        expect(count({ width: 500, columns: '2' })).toBe(2);
    });

    it("drawerCount 'auto' is clamp(round((height - 80 - 36) / 200), 2, 8)", () => {
        const count = (height: number) =>
            gen('chest_of_drawers', { height }).carcass?.interior.content;
        expect(count(500)).toMatchObject({ count: 2 }); // round(1.92)
        expect(count(1000)).toMatchObject({ count: 4 }); // round(4.42)
        expect(count(1100)).toMatchObject({ count: 5 }); // round(4.92)
        expect(count(1400)).toMatchObject({ count: 6 });
        expect(
            gen('chest_of_drawers', { drawerCount: 6 }).carcass?.interior
                .content,
        ).toMatchObject({ count: 6 });
    });

    it('slideType undermount takes the undermount default slide', () => {
        expect(
            gen('chest_of_drawers', { slideType: 'undermount' }).carcass
                ?.interior.content,
        ).toMatchObject({ slideCode: SLIDE_UNDER });
    });

    it('a chest too shallow for the shortest undermount slide takes side-mount slides', () => {
        const slide = (depth: number) =>
            gen('chest_of_drawers', { slideType: 'undermount', depth }).carcass
                ?.interior.content;
        expect(slide(350)).toMatchObject({ slideCode: SLIDE_SIDE });
        expect(slide(390)).toMatchObject({ slideCode: SLIDE_SIDE });
        expect(slide(395)).toMatchObject({ slideCode: SLIDE_UNDER });
        expectValid(
            gen('chest_of_drawers', { slideType: 'undermount', depth: 350 }),
        );
    });

    it('fewer drawers when the height leaves boxes under 60 mm', () => {
        const count = (over: Record<string, unknown>) =>
            gen('chest_of_drawers', over).carcass?.interior.content;
        expect(count({ height: 500, drawerCount: 8 })).toMatchObject({
            count: 3,
        });
        expect(count({ height: 1400, drawerCount: 8 })).toMatchObject({
            count: 8,
        });
        for (const height of [500, 950, 1400]) {
            for (const drawerCount of [2, 8, 'auto']) {
                for (const slideType of ['side_mount', 'undermount']) {
                    expectValid(
                        gen('chest_of_drawers', {
                            width: 400,
                            height,
                            depth: 350,
                            drawerCount,
                            slideType,
                        }),
                    );
                }
            }
        }
    });
});

describe('sideboard (§2.4.12)', () => {
    const board = (plinthSpec: unknown) =>
        expected('sideboard', [1600, 800, 450], {
            construction: { top: 'over_sides', bottom: 'between_sides' },
            plinth: plinthSpec,
            interior: node(
                1,
                'columns',
                [flex(), leafAt(2, shelves(1))],
                [flex(), leafAt(3, drawers(3, SLIDE_SIDE))],
                [flex(), leafAt(4, shelves(1))],
            ),
            fronts: [door(1, [S(2)], 1, 'left'), door(2, [S(4)], 1, 'right')],
        });

    it('default: shelves | 3 drawers | shelves with a door on each side, on 150 mm legs', () => {
        expect(gen('sideboard')).toStrictEqual(board(plinth('legs', 150, 0)));
    });

    it('legHeight 0 means no plinth', () => {
        expect(gen('sideboard', { legHeight: 0 })).toStrictEqual(
            board(NO_PLINTH),
        );
    });

    it('fewer drawers when the height leaves boxes under 60 mm', () => {
        const count = (over: Record<string, unknown>) =>
            gen('sideboard', over).carcass?.interior.children[1]?.section
                .content;
        expect(count({ height: 600, legHeight: 250 })).toMatchObject({
            count: 2,
        });
        expect(count({ height: 600, legHeight: 0 })).toMatchObject({
            count: 3,
        });
        expectValid(
            gen('sideboard', {
                width: 900,
                height: 600,
                depth: 350,
                legHeight: 250,
            }),
        );
    });
});

describe('bedside_table (§2.4.13)', () => {
    const table = (interior: unknown, fronts: unknown[] = []) =>
        expected('bedside_table', [450, 550, 400], {
            construction: { top: 'over_sides', bottom: 'between_sides' },
            plinth: plinth('legs', 100, 0),
            interior,
            fronts,
        });

    it('drawer_open: a fixed 150 drawer over an empty compartment', () => {
        expect(gen('bedside_table')).toStrictEqual(
            table(
                node(
                    1,
                    'rows',
                    [fixed(150), leafAt(2, drawers(1, SLIDE_SIDE))],
                    [flex(), leafAt(3, empty)],
                ),
            ),
        );
    });

    it('two_drawers: one leaf of two drawers', () => {
        expect(gen('bedside_table', { variant: 'two_drawers' })).toStrictEqual(
            table(leafAt(1, drawers(2, SLIDE_SIDE))),
        );
    });

    it('drawer_door: a fixed 150 drawer over shelves behind a one-leaf door', () => {
        expect(gen('bedside_table', { variant: 'drawer_door' })).toStrictEqual(
            table(
                node(
                    1,
                    'rows',
                    [fixed(150), leafAt(2, drawers(1, SLIDE_SIDE))],
                    [flex(), leafAt(3, shelves(1))],
                ),
                [door(1, [S(3)], 1, 'auto')],
            ),
        );
    });

    it('every variant is valid across its smallest and largest sizes', () => {
        for (const variant of ['drawer_open', 'two_drawers', 'drawer_door']) {
            for (const [width, height, depth] of [
                [300, 400, 300],
                [700, 700, 500],
            ]) {
                expectValid(
                    gen('bedside_table', { variant, width, height, depth }),
                );
            }
        }
    });
});

describe('dressing_unit (§2.4.18)', () => {
    const unit = (
        rows: number,
        topLeaves: [number, number, number],
        bottom: [number, number],
        extra: number,
    ) =>
        expected('dressing_unit', [1200, 1800, 450], {
            plinth: plinth('plinth', 80, 20),
            interior: node(
                1,
                'rows',
                [
                    flex(),
                    node(
                        2,
                        'columns',
                        [flex(1), leafAt(topLeaves[0], shelves(3))],
                        [flex(2), leafAt(topLeaves[1], empty)],
                        [flex(1), leafAt(topLeaves[2], shelves(3))],
                    ),
                ],
                [
                    fixed(rows * 170),
                    node(
                        extra,
                        'columns',
                        [flex(), leafAt(bottom[0], drawers(rows, SLIDE_SIDE))],
                        [flex(), leafAt(bottom[1], drawers(rows, SLIDE_SIDE))],
                    ),
                ],
            ),
            fronts: [
                door(1, [S(topLeaves[0])], 1, 'left'),
                door(2, [S(topLeaves[2])], 1, 'right'),
            ],
        });

    it('default drawerRows 3: rows[flex columns(3) / fixed 510 columns(2)], doors on top columns 1 and 3', () => {
        expect(gen('dressing_unit')).toStrictEqual(
            unit(3, [3, 4, 5], [7, 8], 6),
        );
    });

    it('drawerRows sets the fixed row to 170 per row and the drawers per column', () => {
        expect(gen('dressing_unit', { drawerRows: 2 })).toStrictEqual(
            unit(2, [3, 4, 5], [7, 8], 6),
        );
        expect(gen('dressing_unit', { drawerRows: 4 })).toStrictEqual(
            unit(4, [3, 4, 5], [7, 8], 6),
        );
    });
});

describe('custom_box (§2.4.19)', () => {
    it('is valid at the range ends 120 and 2420 high, 6000 wide (top split, R40-1)', () => {
        for (const mounting of ['floor', 'wall', 'loft']) {
            expect(
                errorsOf(gen('custom_box', { height: 120, mounting })),
            ).toStrictEqual([]);
            expect(
                errorsOf(gen('custom_box', { height: 2420, mounting })),
            ).toStrictEqual([]);
        }
        expectValid(gen('custom_box', { width: 6000, depth: 1200 }));
    });

    it('default: common defaults, one empty root leaf, no fronts', () => {
        expect(gen('custom_box')).toStrictEqual(
            expected('custom_box', [600, 720, 560], {
                interior: leafAt(1, empty),
                fronts: [],
            }),
        );
    });

    it('takes the mounting from the parameter', () => {
        for (const mounting of ['floor', 'wall', 'loft']) {
            expect(gen('custom_box', { mounting }).carcass?.mounting).toBe(
                mounting,
            );
        }
    });
});

// --- Cross-cutting ------------------------------------------------------------------

describe('carcass templates together', () => {
    it('registers the wardrobe and the 14 carcass templates as the carcass family', () => {
        const carcass = Object.values(TEMPLATES)
            .filter((t: TemplateDefinition) => t.family === 'carcass')
            .map((t) => t.key);
        expect(carcass.sort()).toStrictEqual(
            ['wardrobe_hinged', ...CARCASS_KEYS].sort(),
        );
    });

    it("an explicit count equal to the 'auto' result gives the same document", () => {
        const same = (key: CarcassKey, explicit: Record<string, unknown>) =>
            expect(gen(key, explicit)).toStrictEqual(gen(key));
        same('wardrobe_sliding', { leaves: 3 });
        same('loft_cabinet', { doors: 3 });
        same('bookshelf', { columns: 2 });
        same('open_shelf_wall', { rows: 1, columns: 2 });
        same('chest_of_drawers', { drawerCount: 4, columns: '1' });
        // and nothing in a document is left 'auto' that a parameter decided
        for (const key of CARCASS_KEYS) {
            const t = template(key);
            const autos = Object.fromEntries(
                t.fields.flatMap((f) =>
                    f.kind === 'int' && f.allowAuto ? [[f.key, 'auto']] : [],
                ),
            );
            expect(
                JSON.stringify(gen(key, autos).carcass?.interior),
            ).not.toContain('auto');
        }
    });

    it('takes hardware codes from the catalog defaults, not from literals', () => {
        const moved = indexCatalog({
            ...snapshot,
            hardware: snapshot.hardware.map((h) => {
                const swap: Record<string, string[]> = {
                    'HDL-BAR-160': [],
                    'HDL-BAR-320': ['handle.default'],
                    'HDL-FLUSH': [],
                    'SLD-BB-450': [],
                    'SLD-BB-500': ['slide.side_mount'],
                    'SLD-UM-450': [],
                    'SLD-UM-500': ['slide.undermount'],
                };
                return h.code in swap
                    ? { ...h, isDefaultFor: swap[h.code] ?? [] }
                    : h;
            }),
        });
        const build = (key: CarcassKey, over: Record<string, unknown> = {}) => {
            const t = template(key);
            return t.generate(
                { ...t.defaults, ...over },
                { catalog: moved, newId: testIds() },
            );
        };
        const slideOf = (doc: FurnitureDocument) =>
            JSON.stringify(doc.carcass?.interior).match(
                /"slideCode":"([^"]+)"/,
            )?.[1];
        expect(build('tv_unit').carcass?.handles.code).toBe('HDL-BAR-320');
        expect(slideOf(build('tv_unit'))).toBe('SLD-BB-500');
        expect(slideOf(build('sideboard'))).toBe('SLD-BB-500');
        expect(slideOf(build('bedside_table'))).toBe('SLD-BB-500');
        expect(slideOf(build('dressing_unit'))).toBe('SLD-BB-500');
        expect(slideOf(build('chest_of_drawers'))).toBe('SLD-BB-500');
        expect(
            slideOf(build('chest_of_drawers', { slideType: 'undermount' })),
        ).toBe('SLD-UM-500');
        expect(slideOf(build('base_cabinet', { variant: 'drawers' }))).toBe(
            'SLD-UM-500',
        );
        // the flush handle has no replacement here, so sliding wardrobes use the default one
        expect(build('wardrobe_sliding').carcass?.handles.code).toBe(
            'HDL-BAR-320',
        );
    });

    it('leaves hardware codes null when the catalog has no default for them', () => {
        const bare = indexCatalog({
            ...snapshot,
            hardware: snapshot.hardware.map((h) => ({
                ...h,
                isDefaultFor: [],
            })),
        });
        const build = (key: CarcassKey, over: Record<string, unknown> = {}) => {
            const t = template(key);
            return t.generate(
                { ...t.defaults, ...over },
                { catalog: bare, newId: testIds() },
            );
        };
        for (const key of [
            'tv_unit',
            'chest_of_drawers',
            'wardrobe_sliding',
        ] as const) {
            expect(build(key).carcass?.handles.code).toBeNull();
        }
        expect(JSON.stringify(build('tv_unit').carcass?.interior)).toContain(
            '"slideCode":null',
        );
        expect(
            build('base_cabinet', { variant: 'drawers' }).carcass?.interior
                .content,
        ).toMatchObject({ slideCode: null });
        expect(
            build('chest_of_drawers', { slideType: 'undermount' }).carcass
                ?.interior.content,
        ).toMatchObject({ slideCode: null });
    });
});
