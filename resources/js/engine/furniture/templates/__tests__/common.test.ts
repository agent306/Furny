import { describe, expect, it } from 'vitest';
import { EngineInputError } from '../../../errors';
import { indexCatalog } from '../../catalogIndex';
import { mutateCatalog, seedCatalog } from '../../../testing/seedCatalog';
import { testIds } from '../../../testing/ids';
import type { FurnitureDocument, Section } from '../../schema';
import { archived, withoutDefault } from '../../testing/catalogs';
import {
    autoDoorCount,
    clamp,
    columnsFromDoors,
    commonCarcass,
    dimensionFields,
    effectiveParams,
    emptyOverrides,
    evenSplit,
    fitDoors,
    fitDrawers,
    leafFitsSheet,
    sheetDoors,
    tableDims,
    hingedFront,
    intField,
    interiorHeight,
    leaf,
    lengthField,
    maxColumns,
    maxRows,
    outerHingeSide,
    reidentify,
    resolveDefaultMaterials,
    shelfCount,
    split,
    tracked,
} from '../common';
import type { TemplateContext } from '../types';
import { wardrobeHinged } from '../wardrobe_hinged';

const ctxFor = (catalog = seedCatalog()): TemplateContext => ({
    catalog: indexCatalog(catalog),
    newId: testIds(),
});

describe('clamp, interiorHeight, shelfCount', () => {
    it('clamps to the range', () => {
        expect(clamp(5, 1, 3)).toBe(3);
        expect(clamp(-1, 1, 3)).toBe(1);
        expect(clamp(2, 1, 3)).toBe(2);
    });

    it('interiorHeight is H - plinth - 2 x 18', () => {
        expect(interiorHeight(2100, 100)).toBe(1964);
        expect(interiorHeight(800, 0)).toBe(764);
    });

    it('shelfCount is clamp(round(h / pitch) - 1, 1, 20)', () => {
        expect(shelfCount(1964, 400)).toBe(4);
        expect(shelfCount(1964 - 18 - 360, 400)).toBe(3);
        expect(shelfCount(100, 400)).toBe(1);
        expect(shelfCount(100000, 400)).toBe(20);
        expect(shelfCount(600, 400)).toBe(1); // round(1.5) - 1
        expect(shelfCount(1000, 400)).toBe(2); // round(2.5) - 1, half rounds up
        expect(shelfCount(920, 400)).toBe(1); // round(2.3) - 1; ceil would give 2
    });
});

describe('columnsFromDoors', () => {
    it('pairs of doors, the single-door column first by default', () => {
        expect(columnsFromDoors(1)).toEqual([1]);
        expect(columnsFromDoors(2)).toEqual([2]);
        expect(columnsFromDoors(3)).toEqual([1, 2]);
        expect(columnsFromDoors(4)).toEqual([2, 2]);
        expect(columnsFromDoors(5)).toEqual([1, 2, 2]);
    });

    it("puts the single-door column last for 'right'", () => {
        expect(columnsFromDoors(5, 'right')).toEqual([2, 2, 1]);
        expect(columnsFromDoors(1, 'right')).toEqual([1]);
        expect(columnsFromDoors(4, 'right')).toEqual([2, 2]);
    });
});

describe('leaf, split, hingedFront', () => {
    it('leaf is an undivided section holding the content', () => {
        const ctx = ctxFor();
        expect(leaf({ type: 'empty' }, ctx)).toEqual({
            id: 's_0000000001',
            split: 'none',
            children: [],
            content: { type: 'empty' },
        });
    });

    it('split takes its id before its children, depth first, left to right', () => {
        const ctx = ctxFor();
        const tree = split(
            'columns',
            [
                [
                    { mode: 'flex', weight: 1 },
                    () =>
                        split(
                            'rows',
                            [
                                [
                                    { mode: 'fixed', mm: 100 },
                                    () => leaf({ type: 'empty' }, ctx),
                                ],
                                [
                                    { mode: 'flex', weight: 1 },
                                    () => leaf({ type: 'empty' }, ctx),
                                ],
                            ],
                            ctx,
                        ),
                ],
                [
                    { mode: 'flex', weight: 2 },
                    () => leaf({ type: 'empty' }, ctx),
                ],
            ],
            ctx,
        );
        const ids: string[] = [];
        const walk = (s: Section): void => {
            ids.push(s.id);
            s.children.forEach((c) => walk(c.section));
        };
        walk(tree);
        expect(ids).toEqual([
            's_0000000001',
            's_0000000002',
            's_0000000003',
            's_0000000004',
            's_0000000005',
        ]);
        expect(tree.split).toBe('columns');
        expect(tree.content).toBeNull();
        expect(tree.children.map((c) => c.size)).toEqual([
            { mode: 'flex', weight: 1 },
            { mode: 'flex', weight: 2 },
        ]);
    });

    it('hingedFront fills the front defaults and honours overlay', () => {
        const ctx = ctxFor();
        expect(hingedFront(['s_a'], 2, 'auto', ctx)).toEqual({
            id: 'fr_0000000001',
            kind: 'hinged',
            covers: ['s_a'],
            leaves: 2,
            hingeSide: 'auto',
            overlay: 'full',
            glass: false,
            handleCode: 'inherit',
            hingeCode: 'auto',
            slidingTrackCode: null,
        });
        expect(hingedFront(['s_a'], 1, 'left', ctx, 'half').overlay).toBe(
            'half',
        );
    });
});

describe('commonCarcass and emptyOverrides', () => {
    it('carries the 07 §2.3 defaults with the default handle', () => {
        expect(commonCarcass(ctxFor())).toEqual({
            construction: { top: 'between_sides', bottom: 'between_sides' },
            mounting: 'floor',
            plinth: { type: 'none', height: 0, setback: 0, legCode: null },
            back: { type: 'grooved' },
            countertop: null,
            handles: {
                code: 'HDL-BAR-160',
                orientation: 'auto',
                placement: 'auto',
            },
        });
    });

    it('has no handle code when the catalog has no default handle', () => {
        const catalog = withoutDefault('handle.default');
        expect(commonCarcass(ctxFor(catalog)).handles.code).toBeNull();
    });

    it('emptyOverrides returns a fresh empty block each call', () => {
        expect(emptyOverrides()).toEqual({
            parts: {},
            extraParts: [],
            hardware: {},
            extraHardware: [],
        });
        expect(emptyOverrides()).not.toBe(emptyOverrides());
    });
});

describe('resolveDefaultMaterials', () => {
    it('uses the catalog role defaults of the seed catalog', () => {
        const m = resolveDefaultMaterials({}, ctxFor());
        const codes = Object.fromEntries(
            Object.entries(m).map(([role, a]) => [role, a.materialCode]),
        );
        expect(codes).toEqual({
            carcass: 'PB18-WHITE',
            shelf: 'PB18-WHITE',
            front: 'PB18-WHITE',
            top: 'PB18-WHITE',
            plinth: 'PB18-WHITE',
            back: 'HDF3-WHITE',
            drawer_bottom: 'HDF3-WHITE',
            drawer_box: 'PLY12-BWR',
            leg: 'SW50-RUBBER',
        });
        for (const a of Object.values(m)) {
            expect(a.edgeBandCode).toBeNull();
            expect(a.finishCode).toBeNull();
        }
    });

    it('takes the first preferred code that exists and is active', () => {
        const catalog = archived('PB18-ANTH');
        const m = resolveDefaultMaterials(
            {
                preferredMaterials: {
                    carcass: ['NOPE', 'PB18-ANTH', 'PB18-OAK', 'PB18-WHITE'],
                    front: ['MDF18-GLOSS-WHITE'],
                },
            },
            ctxFor(catalog),
        );
        expect(m.carcass.materialCode).toBe('PB18-OAK');
        expect(m.front.materialCode).toBe('MDF18-GLOSS-WHITE');
        expect(m.shelf.materialCode).toBe('PB18-WHITE');
    });

    it('falls back to the role default when no preferred code is usable', () => {
        const m = resolveDefaultMaterials(
            { preferredMaterials: { carcass: ['NOPE'] } },
            ctxFor(),
        );
        expect(m.carcass.materialCode).toBe('PB18-WHITE');
    });

    it('throws invalid_input for a catalog without any material', () => {
        const catalog = mutateCatalog(seedCatalog(), (d) => {
            d.materials = [];
        });
        expect(() => resolveDefaultMaterials({}, ctxFor(catalog))).toThrow(
            EngineInputError,
        );
    });
});

describe('effectiveParams', () => {
    it('merges default overrides onto the code defaults', () => {
        expect(effectiveParams(wardrobeHinged, { width: 2400 })).toEqual({
            ...wardrobeHinged.defaults,
            width: 2400,
        });
    });

    it('ignores keys that are not template fields', () => {
        const overrides = JSON.parse(
            '{"nope":1,"width":2000,"__proto__":{"polluted":true}}',
        ) as Record<string, unknown>;
        expect(Object.hasOwn(overrides, '__proto__')).toBe(true);
        const params = effectiveParams(wardrobeHinged, overrides);
        expect(params).toEqual({ ...wardrobeHinged.defaults, width: 2000 });
        expect('nope' in params).toBe(false);
        expect(Object.hasOwn(params, '__proto__')).toBe(false);
        expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    });

    it('falls back to the code defaults when the merge fails the schema', () => {
        expect(effectiveParams(wardrobeHinged, { width: 5000 })).toEqual(
            wardrobeHinged.defaults,
        );
        expect(
            effectiveParams(wardrobeHinged, { width: 2400, doors: 99 }),
        ).toEqual(wardrobeHinged.defaults);
    });

    it('does not return the defaults object itself', () => {
        expect(effectiveParams(wardrobeHinged, {})).not.toBe(
            wardrobeHinged.defaults,
        );
        // the fallback branch copies too
        expect(effectiveParams(wardrobeHinged, { width: 5000 })).not.toBe(
            wardrobeHinged.defaults,
        );
    });
});

describe('reidentify', () => {
    /** A generator whose ids can never equal those of the source document. */
    const offsetIds = () => {
        const counters = new Map<string, number>();
        return (prefix: 's' | 'fr') => {
            const next = (counters.get(prefix) ?? 100) + 1;
            counters.set(prefix, next);
            return `${prefix}_${String(next).padStart(10, '0')}`;
        };
    };

    function docWithOverrides(): FurnitureDocument {
        const doc = wardrobeHinged.generate(wardrobeHinged.defaults, ctxFor());
        doc.overrides.parts['front.fr_0000000001.leaf.1'] = { note: 'a' };
        doc.overrides.parts['section.s_0000000002.shelf.2'] = { removed: true };
        doc.overrides.parts['carcass.top'] = { note: 'b' };
        doc.overrides.hardware['hinge.fr_0000000002.leaf.1'] = {
            removed: true,
        };
        return doc;
    }

    it('gives sections then fronts fresh ids in generation order', () => {
        const out = reidentify(docWithOverrides(), offsetIds());
        const interior = out.carcass?.interior as Section;
        expect(interior.id).toBe('s_0000000101');
        expect(interior.children.map((c) => c.section.id)).toEqual([
            's_0000000102',
            's_0000000103',
        ]);
        expect(
            interior.children[1]?.section.children.map((c) => c.section.id),
        ).toEqual(['s_0000000104', 's_0000000105']);
        expect(out.carcass?.fronts.map((f) => f.id)).toEqual([
            'fr_0000000101',
            'fr_0000000102',
        ]);
    });

    it('rewrites covers and every override key that contains an old id', () => {
        const out = reidentify(docWithOverrides(), offsetIds());
        expect(out.carcass?.fronts.map((f) => f.covers)).toEqual([
            ['s_0000000102'],
            ['s_0000000103'],
        ]);
        expect(out.overrides.parts).toEqual({
            'front.fr_0000000101.leaf.1': { note: 'a' },
            'section.s_0000000102.shelf.2': { removed: true },
            'carcass.top': { note: 'b' },
        });
        expect(out.overrides.hardware).toEqual({
            'hinge.fr_0000000102.leaf.1': { removed: true },
        });
    });

    it('is a deep copy that leaves the input untouched', () => {
        const doc = docWithOverrides();
        const before = structuredClone(doc);
        const out = reidentify(doc, offsetIds());
        expect(doc).toEqual(before);
        expect(out).not.toBe(doc);
        expect(out.dims).not.toBe(doc.dims);
        expect(out.materials).not.toBe(doc.materials);
    });

    it('maps in a single pass when new ids overlap old ones', () => {
        const doc = docWithOverrides();
        // shifted by one: old s_1 -> s_2, old s_2 -> s_3 ..., old fr_1 -> fr_2, old fr_2 -> fr_3
        const ids = testIds();
        ids('s');
        ids('fr');
        doc.overrides.parts['section.s_0000000001.partition.1'] = { note: 'p' };
        doc.overrides.hardware['x.s_0000000002.fr_0000000001'] = {
            removed: true,
        };
        const out = reidentify(doc, ids);
        expect(out.carcass?.interior.id).toBe('s_0000000002');
        expect(out.carcass?.fronts.map((f) => f.id)).toEqual([
            'fr_0000000002',
            'fr_0000000003',
        ]);
        expect(out.carcass?.fronts.map((f) => f.covers)).toEqual([
            ['s_0000000003'],
            ['s_0000000004'],
        ]);
        expect(out.overrides.parts).toEqual({
            'front.fr_0000000002.leaf.1': { note: 'a' },
            'section.s_0000000003.shelf.2': { removed: true },
            'carcass.top': { note: 'b' },
            'section.s_0000000002.partition.1': { note: 'p' },
        });
        expect(out.overrides.hardware).toEqual({
            'hinge.fr_0000000003.leaf.1': { removed: true },
            'x.s_0000000003.fr_0000000002': { removed: true },
        });
    });

    it('only rewrites whole ids, not tokens that merely contain one', () => {
        const doc = docWithOverrides();
        const lookalikes = [
            'xs_0000000002.shelf.1', // letter before
            '_s_0000000002.shelf.1', // underscore before
            '9s_0000000002.shelf.1', // digit before
            'section.s_00000000021.shelf.1', // longer id (old id is its prefix)
            'section.s_0000000002a.shelf.1', // letter after
            'section.s_000000002.shelf.1', // shorter id
            'xfr_0000000001.leaf.1',
        ];
        for (const key of lookalikes) doc.overrides.parts[key] = { note: key };
        const out = reidentify(doc, offsetIds());
        for (const key of lookalikes) {
            expect(out.overrides.parts[key]).toEqual({ note: key });
        }
        // the embedded, whole ids are still rewritten
        expect(out.overrides.parts).toHaveProperty(
            'section.s_0000000102.shelf.2',
        );
    });

    it('leaves unknown ids in covers and keys alone', () => {
        const doc = docWithOverrides();
        const front = doc.carcass?.fronts[0];
        if (front) front.covers = ['s_zzzzzzzzzz'];
        doc.overrides.parts['section.s_zzzzzzzzzz.shelf.1'] = { note: 'x' };
        const out = reidentify(doc, offsetIds());
        expect(out.carcass?.fronts[0]?.covers).toEqual(['s_zzzzzzzzzz']);
        expect(out.overrides.parts).toHaveProperty(
            'section.s_zzzzzzzzzz.shelf.1',
        );
    });

    it('copies a table document without touching it', () => {
        const doc = docWithOverrides();
        doc.carcass = null;
        doc.family = 'table';
        expect(reidentify(doc, offsetIds())).toEqual(doc);
    });
});

describe('count clamps (07 gap, log 19)', () => {
    it('maxColumns: n columns need n x 100 mm plus n - 1 dividers', () => {
        expect(maxColumns(100)).toBe(1);
        expect(maxColumns(217)).toBe(1);
        expect(maxColumns(218)).toBe(2); // 2 x 100 + 18
        expect(maxColumns(336)).toBe(3); // 3 x 100 + 2 x 18
        expect(maxColumns(335)).toBe(2);
        expect(maxColumns(10)).toBe(1);
    });

    it('maxRows: n rows need n x 80 mm plus n - 1 dividers', () => {
        expect(maxRows(79)).toBe(1);
        expect(maxRows(178)).toBe(2); // 2 x 80 + 18
        expect(maxRows(177)).toBe(1);
        expect(maxRows(276)).toBe(3);
    });

    it('fitDoors keeps the count while every door has 100 mm of the columns', () => {
        expect(fitDoors(3, 1764)).toBe(3);
        expect(fitDoors(12, 3564)).toBe(12);
        // 3 doors: 2 columns, one divider: (346 - 0) / 3
        expect(fitDoors(3, 364)).toBe(3);
        expect(fitDoors(4, 364)).toBe(3); // 346 / 4 < 100
        expect(fitDoors(12, 364)).toBe(3);
        // exactly 100 mm per door still fits; one mm less does not
        expect(fitDoors(2, 200)).toBe(2);
        expect(fitDoors(2, 199)).toBe(1);
        expect(fitDoors(3, 318)).toBe(3); // (318 - one divider) / 3
        expect(fitDoors(3, 317)).toBe(2);
        expect(fitDoors(2, 50)).toBe(1);
        expect(fitDoors(1, 50)).toBe(1);
    });

    it('fitDrawers: at least one, at most count, 120 mm of carcass per drawer', () => {
        expect(fitDrawers(5, 584)).toBe(5); // 620 / 120
        expect(fitDrawers(5, 544)).toBe(4); // 580 / 120
        expect(fitDrawers(3, 10)).toBe(1);
        expect(fitDrawers(2, 5000)).toBe(2);
    });
});

describe('sheet clamps (spec 19, Task 40)', () => {
    const tctx = (): TemplateContext => ({
        catalog: indexCatalog(seedCatalog()),
        newId: testIds(),
    });

    it('leafFitsSheet: PB18-WHITE usable 2420 x 1200 (trim 10); true for an unknown code', () => {
        const fits = leafFitsSheet(tctx(), 'PB18-WHITE');
        expect(fits(1200, 2420)).toBe(true);
        expect(fits(1201, 2000)).toBe(false);
        expect(fits(600, 2421)).toBe(false);
        expect(fits(2420, 600)).toBe(true);
        expect(leafFitsSheet(tctx(), 'NOPE')(9000, 9000)).toBe(true);
    });

    it('leafFitsSheet keeps a grained leaf upright (grain along its height)', () => {
        const fits = leafFitsSheet(tctx(), 'SW50-RUBBER'); // 2440 x 300, grained
        expect(fits(280, 2400)).toBe(true);
        expect(fits(2400, 280)).toBe(false);
    });

    it('sheetDoors: the fewest doors from the request whose leaves fit', () => {
        const fits = leafFitsSheet(tctx(), 'PB18-WHITE');
        // leaf = width / n + 18 (x2 for a 2-door column when one leaf per column)
        expect(sheetDoors(1, 1800, 2100, fits)).toBe(2); // 918
        expect(sheetDoors(1, 3600, 2100, fits)).toBe(4); // 1218 at 3 is too wide
        expect(sheetDoors(3, 1800, 2100, fits)).toBe(3);
        expect(sheetDoors(1, 3600, 600, fits, true)).toBe(3); // flaps 1218 / 2418
    });

    it('sheetDoors keeps the request when no count helps (the height alone is too big)', () => {
        const fits = leafFitsSheet(tctx(), 'PB18-WHITE');
        expect(sheetDoors(3, 1800, 2700, fits)).toBe(3);
    });

    it('tableDims: a round top takes depth = width, capped at depthMax', () => {
        const p = { width: 1500, height: 750, depth: 800 };
        expect(tableDims({ ...p, shape: 'round' }, 1200)).toStrictEqual({
            width: 1200,
            height: 750,
            depth: 1200,
        });
        expect(
            tableDims({ ...p, shape: 'round', width: 1000 }, 1200),
        ).toStrictEqual({ width: 1000, height: 750, depth: 1000 });
        expect(tableDims({ ...p, shape: 'oval' }, 1200)).toStrictEqual(p);
        expect(tableDims(p, 1200)).toStrictEqual(p);
    });
});

describe('evenSplit', () => {
    it('numbers the parent before its equal-weight children', () => {
        const ctx = ctxFor();
        const out = evenSplit(
            'columns',
            3,
            () => leaf({ type: 'empty' }, ctx),
            ctx,
        );
        expect(out.id).toBe('s_0000000001');
        expect(out.split).toBe('columns');
        expect(out.children.map((c) => c.size)).toEqual([
            { mode: 'flex', weight: 1 },
            { mode: 'flex', weight: 1 },
            { mode: 'flex', weight: 1 },
        ]);
        expect(out.children.map((c) => c.section.id)).toEqual([
            's_0000000002',
            's_0000000003',
            's_0000000004',
        ]);
    });

    it('returns the only child as is (a split needs two children)', () => {
        const ctx = ctxFor();
        const out = evenSplit(
            'rows',
            1,
            () => leaf({ type: 'empty' }, ctx),
            ctx,
        );
        expect(out).toEqual({
            id: 's_0000000001',
            split: 'none',
            children: [],
            content: { type: 'empty' },
        });
    });
});

describe('field constructors', () => {
    it('build the §2.1 field shapes with pinned label keys', () => {
        expect(lengthField('width', 100, 200)).toEqual({
            key: 'width',
            kind: 'length',
            labelKey: 'templates.fields.width',
            min: 100,
            max: 200,
            step: 10,
        });
        expect(
            intField('rows', 1, 6, { allowAuto: true, advanced: true }),
        ).toEqual({
            key: 'rows',
            kind: 'int',
            labelKey: 'templates.fields.rows',
            min: 1,
            max: 6,
            allowAuto: true,
            advanced: true,
        });
        expect(
            dimensionFields([1, 2], [3, 4], [5, 6], { helpKey: 'h' }),
        ).toMatchObject([
            { key: 'width', min: 1, max: 2 },
            { key: 'height', min: 3, max: 4 },
            { key: 'depth', min: 5, max: 6, helpKey: 'h' },
        ]);
    });
});

describe('door helpers', () => {
    it('autoDoorCount is clamp(round(width / 600), 1, 12)', () => {
        expect(autoDoorCount(100)).toBe(1);
        expect(autoDoorCount(899)).toBe(1);
        expect(autoDoorCount(900)).toBe(2);
        expect(autoDoorCount(1500)).toBe(3);
        expect(autoDoorCount(7200)).toBe(12);
        expect(autoDoorCount(9000)).toBe(12);
    });

    it('outerHingeSide hinges a single-door column on the outer side', () => {
        expect(outerHingeSide(2, 0, 3)).toBe('auto');
        expect(outerHingeSide(1, 0, 3)).toBe('left');
        expect(outerHingeSide(1, 0, 1)).toBe('left');
        expect(outerHingeSide(1, 2, 3)).toBe('right');
        expect(outerHingeSide(1, 1, 3)).toBe('auto');
    });

    it('tracked appends each built section to the list, in build order', () => {
        const ctx = ctxFor();
        const into: Section[] = [];
        const a = tracked(into, () => leaf({ type: 'empty' }, ctx));
        const b = tracked(into, () => leaf({ type: 'empty' }, ctx));
        const second = b();
        const first = a();
        expect(into).toStrictEqual([second, first]);
        expect(first.id).toBe('s_0000000002');
    });
});
