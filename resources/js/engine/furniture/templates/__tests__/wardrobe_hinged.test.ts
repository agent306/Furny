import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EngineInputError } from '../../../errors';
import { newId } from '../../../ids';
import { testIds } from '../../../testing/ids';
import { seedCatalog } from '../../../testing/seedCatalog';
import { indexCatalog } from '../../catalogIndex';
import {
    FurnitureDocumentSchema,
    TEMPLATE_KEYS,
    type Content,
    type Section,
} from '../../schema';
import { shelfCount } from '../common';
import { TEMPLATES, getTemplate, templateDefaultDocument } from '../index';
import type { TemplateContext } from '../types';
import { wardrobeHinged, wardrobeHingedParamsSchema } from '../wardrobe_hinged';

const FIXTURE = new URL(
    '../../../../../../database/fixtures/furniture/wardrobe-3door.json',
    import.meta.url,
);

const catalog = indexCatalog(seedCatalog());
const ctx = (): TemplateContext => ({ catalog, newId: testIds() });
const gen = (over: Record<string, unknown> = {}) =>
    wardrobeHinged.generate(
        {
            ...wardrobeHinged.defaults,
            ...over,
        } as typeof wardrobeHinged.defaults,
        ctx(),
    );

const interiorOf = (over: Record<string, unknown> = {}): Section => {
    const carcass = gen(over).carcass;
    if (!carcass) throw new Error('no carcass');
    return carcass.interior;
};
const contents = (s: Section): Array<Content | null> =>
    s.split === 'none'
        ? [s.content]
        : s.children.flatMap((c) => contents(c.section));

describe('wardrobe_hinged golden fixture (07 §12.2)', () => {
    it('generates exactly wardrobe-3door.json', () => {
        const golden: unknown = JSON.parse(readFileSync(FIXTURE, 'utf8'));
        expect(gen()).toEqual(golden);
    });

    it('the fixture parses as a FurnitureDocument', () => {
        const golden: unknown = JSON.parse(readFileSync(FIXTURE, 'utf8'));
        expect(() => FurnitureDocumentSchema.parse(golden)).not.toThrow();
    });

    it('templateDefaultDocument builds the same document', () => {
        const golden: unknown = JSON.parse(readFileSync(FIXTURE, 'utf8'));
        const result = templateDefaultDocument(
            'wardrobe_hinged',
            {},
            catalog,
            testIds(),
        );
        expect(result.document).toEqual(golden);
        expect(result.issues).toEqual([]);
    });

    it('is deterministic', () => {
        expect(gen()).toEqual(gen());
    });
});

describe('wardrobe_hinged generation', () => {
    it('default shelf count is 4', () => {
        expect(shelfCount(1964, 400)).toBe(4);
        const first = interiorOf().children[0]?.section.content;
        expect(first).toMatchObject({ type: 'shelves', count: 4 });
    });

    it("resolves doors 'auto' to clamp(round(width / 600), 1, 12)", () => {
        const doorsOf = (width: number) =>
            gen({ width }).carcass?.fronts.reduce(
                (n, f) => n + (f.leaves as number),
                0,
            );
        expect(doorsOf(1800)).toBe(3);
        expect(doorsOf(600)).toBe(1);
        expect(doorsOf(3600)).toBe(6);
        expect(doorsOf(900)).toBe(2); // round(1.5)
        expect(doorsOf(1500)).toBe(3); // round(2.5)
    });

    it('explicit doors win over the width', () => {
        const fronts = gen({ doors: 12, width: 600 }).carcass?.fronts ?? [];
        expect(fronts.map((f) => f.leaves)).toEqual([2, 2, 2, 2, 2, 2]);
    });

    it('weights each column by its doors and covers it with one front', () => {
        const doc = gen({ doors: 5 });
        const interior = doc.carcass?.interior as Section;
        expect(interior.children.map((c) => c.size)).toEqual([
            { mode: 'flex', weight: 1 },
            { mode: 'flex', weight: 2 },
            { mode: 'flex', weight: 2 },
        ]);
        expect(doc.carcass?.fronts.map((f) => f.covers)).toEqual(
            interior.children.map((c) => [c.section.id]),
        );
    });

    it('hinges single-door columns on the carcass-outer side', () => {
        const sides = (over: Record<string, unknown>) =>
            gen(over).carcass?.fronts.map((f) => f.hingeSide);
        expect(sides({ doors: 3 })).toEqual(['left', 'auto']);
        expect(sides({ doors: 3, singleColumnSide: 'right' })).toEqual([
            'auto',
            'right',
        ]);
        expect(sides({ doors: 1 })).toEqual(['left']);
        expect(sides({ doors: 4 })).toEqual(['auto', 'auto']);
    });

    it('creates section ids before front ids, each in listed order', () => {
        const doc = gen({ doors: 5 });
        const ids: string[] = [];
        const walk = (s: Section): void => {
            ids.push(s.id);
            s.children.forEach((c) => walk(c.section));
        };
        walk(doc.carcass?.interior as Section);
        expect(ids).toEqual(
            Array.from(
                { length: 8 },
                (_, i) => `s_${String(i + 1).padStart(10, '0')}`,
            ),
        );
        expect(doc.carcass?.fronts.map((f) => f.id)).toEqual([
            'fr_0000000001',
            'fr_0000000002',
            'fr_0000000003',
        ]);
    });

    it('internalDrawers 2 turns the first single column into shelves over drawers', () => {
        const column = interiorOf({ internalDrawers: 2 }).children[0]
            ?.section as Section;
        expect(column.split).toBe('rows');
        expect(column.children.map((c) => c.size)).toEqual([
            { mode: 'flex', weight: 1 },
            { mode: 'fixed', mm: 360 },
        ]);
        expect(column.children.map((c) => c.section.content)).toEqual([
            {
                type: 'shelves',
                count: shelfCount(1964 - 18 - 360, 400),
                adjustable: true,
                frontSetback: 20,
            },
            {
                type: 'drawers',
                count: 2,
                frontHeights: 'equal',
                slideCode: null,
                behindDoor: true,
            },
        ]);
        // ids stay pre-order: column 2, shelves 3, drawers 4
        expect(column.id).toBe('s_0000000002');
        expect(column.children.map((c) => c.section.id)).toEqual([
            's_0000000003',
            's_0000000004',
        ]);
    });

    it('internalDrawers go to the first single column wherever it is', () => {
        const interior = interiorOf({
            doors: 5,
            singleColumnSide: 'right',
            internalDrawers: 1,
        });
        expect(interior.children.map((c) => c.section.split)).toEqual([
            'rows',
            'rows',
            'rows',
        ]);
        const types = interior.children.map((c) =>
            contents(c.section).map((x) => x?.type),
        );
        expect(types).toEqual([
            ['empty', 'hanging_rod'],
            ['empty', 'hanging_rod'],
            ['shelves', 'drawers'],
        ]);
    });

    it('with no single column the first column takes the drawers', () => {
        const interior = interiorOf({ doors: 4, internalDrawers: 3 });
        const types = interior.children.map((c) =>
            contents(c.section).map((x) => x?.type),
        );
        expect(types).toEqual([
            ['shelves', 'drawers'],
            ['empty', 'hanging_rod'],
        ]);
        const fixed = interior.children[0]?.section.children[1]?.size;
        expect(fixed).toEqual({ mode: 'fixed', mm: 540 });
    });

    it("hangingStyle 'long' has one rod, 'double' two", () => {
        const rods = (hangingStyle: string) => {
            const col = interiorOf({ hangingStyle }).children[1]
                ?.section as Section;
            return {
                rows: col.children.map((c) => c.size),
                rods: contents(col).filter((c) => c?.type === 'hanging_rod')
                    .length,
            };
        };
        expect(rods('long')).toEqual({
            rows: [
                { mode: 'fixed', mm: 350 },
                { mode: 'flex', weight: 1 },
            ],
            rods: 1,
        });
        expect(rods('double')).toEqual({
            rows: [
                { mode: 'fixed', mm: 350 },
                { mode: 'flex', weight: 1 },
                { mode: 'flex', weight: 1 },
            ],
            rods: 2,
        });
    });

    it('plinthHeight 0 means no plinth; otherwise a 20 mm setback plinth', () => {
        expect(gen({ plinthHeight: 0 }).carcass?.plinth).toEqual({
            type: 'none',
            height: 0,
            setback: 0,
            legCode: null,
        });
        expect(gen({ plinthHeight: 60 }).carcass?.plinth).toEqual({
            type: 'plinth',
            height: 60,
            setback: 20,
            legCode: null,
        });
    });

    it('shelf count follows the interior height', () => {
        const shelves = (over: Record<string, unknown>) =>
            interiorOf({ doors: 1, ...over }).children[0]?.section.content;
        expect(shelves({ height: 1500, plinthHeight: 0 })).toMatchObject({
            count: shelfCount(1464, 400),
        });
        expect(shelves({ height: 2700 })).toMatchObject({
            count: shelfCount(2564, 400),
        });
    });

    it('takes dims and the back type from the parameters', () => {
        const doc = gen({
            width: 2400,
            height: 2400,
            depth: 650,
            backType: 'none',
        });
        expect(doc.dims).toEqual({ width: 2400, height: 2400, depth: 650 });
        expect(doc.carcass?.back).toEqual({ type: 'none' });
    });

    it('produces valid documents across the declared ranges', () => {
        for (const width of [600, 1210, 3600]) {
            for (const doors of ['auto', 1, 2, 7, 12] as const) {
                for (const internalDrawers of [0, 4]) {
                    const doc = gen({ width, doors, internalDrawers });
                    expect(() =>
                        FurnitureDocumentSchema.parse(doc),
                    ).not.toThrow();
                }
            }
        }
    });
});

describe('wardrobe_hinged definition', () => {
    it('lists width, height, depth first with the 07 §2.4.1 ranges', () => {
        expect(wardrobeHinged.fields.slice(0, 3)).toMatchObject([
            { key: 'width', kind: 'length', min: 600, max: 3600, step: 10 },
            { key: 'height', kind: 'length', min: 1500, max: 2700, step: 10 },
            {
                key: 'depth',
                kind: 'length',
                min: 450,
                max: 750,
                step: 10,
                helpKey: 'templates.help.hanging_depth',
            },
        ]);
    });

    it('lists every parameter once, in UI order, with pinned label keys', () => {
        expect(wardrobeHinged.fields.map((f) => f.key)).toEqual([
            'width',
            'height',
            'depth',
            'doors',
            'singleColumnSide',
            'hangingStyle',
            'internalDrawers',
            'plinthHeight',
            'backType',
        ]);
        for (const f of wardrobeHinged.fields) {
            expect(f.labelKey).toBe(`templates.fields.${f.key}`);
            if (f.kind === 'select') {
                for (const o of f.options) {
                    expect(o.labelKey).toBe(`templates.options.${o.value}`);
                }
            }
        }
        expect(Object.keys(wardrobeHinged.defaults).sort()).toEqual(
            wardrobeHinged.fields.map((f) => f.key).sort(),
        );
    });

    it('declares the select options, advanced fields and conditions of 07 §2.4.1', () => {
        const field = (key: string) =>
            wardrobeHinged.fields.find((f) => f.key === key);
        const values = (key: string) => {
            const f = field(key);
            return f?.kind === 'select' ? f.options.map((o) => o.value) : [];
        };
        expect(values('singleColumnSide')).toEqual(['left', 'right']);
        expect(values('hangingStyle')).toEqual(['long', 'double']);
        expect(values('backType')).toEqual([
            'grooved',
            'nailed',
            'inset',
            'none',
        ]);
        expect(field('doors')).toMatchObject({
            kind: 'int',
            min: 1,
            max: 12,
            allowAuto: true,
        });
        expect(field('internalDrawers')).toMatchObject({
            kind: 'int',
            min: 0,
            max: 4,
        });
        expect(field('plinthHeight')).toMatchObject({
            kind: 'length',
            min: 0,
            max: 150,
            step: 10,
            advanced: true,
        });
        expect(field('backType')?.advanced).toBe(true);
        expect(field('singleColumnSide')?.visibleIf?.key).toBe('doors');
    });

    it('has the code defaults of 07 §2.4.1', () => {
        expect(wardrobeHinged.defaults).toEqual({
            width: 1800,
            height: 2100,
            depth: 600,
            doors: 'auto',
            singleColumnSide: 'left',
            hangingStyle: 'long',
            internalDrawers: 0,
            plinthHeight: 100,
            backType: 'grooved',
        });
        expect(
            wardrobeHingedParamsSchema.safeParse(wardrobeHinged.defaults)
                .success,
        ).toBe(true);
    });

    it('has the template metadata', () => {
        expect(wardrobeHinged).toMatchObject({
            key: 'wardrobe_hinged',
            family: 'carcass',
            category: 'wardrobe',
            nameKey: 'templates.wardrobe_hinged.name',
            descriptionKey: 'templates.wardrobe_hinged.description',
            thumbnail: '/images/templates/wardrobe_hinged.svg',
        });
    });

    it('paramsSchema rejects out-of-range values and accepts the range ends', () => {
        const parse = (over: Record<string, unknown>) =>
            wardrobeHinged.paramsSchema.safeParse({
                ...wardrobeHinged.defaults,
                ...over,
            }).success;
        expect(parse({ width: 3610 })).toBe(false);
        expect(parse({ width: 590 })).toBe(false);
        expect(parse({ width: 3600 })).toBe(true);
        expect(parse({ width: 600 })).toBe(true);
        expect(parse({ height: 2710 })).toBe(false);
        expect(parse({ height: 1490 })).toBe(false);
        expect(parse({ depth: 760 })).toBe(false);
        expect(parse({ depth: 440 })).toBe(false);
        expect(parse({ doors: 13 })).toBe(false);
        expect(parse({ doors: 0 })).toBe(false);
        expect(parse({ doors: 12 })).toBe(true);
        expect(parse({ doors: 'many' })).toBe(false);
        expect(parse({ internalDrawers: 5 })).toBe(false);
        expect(parse({ internalDrawers: -1 })).toBe(false);
        expect(parse({ plinthHeight: 160 })).toBe(false);
        expect(parse({ plinthHeight: 0 })).toBe(true);
        expect(parse({ hangingStyle: 'short' })).toBe(false);
        expect(parse({ backType: 'glued' })).toBe(false);
        expect(parse({ singleColumnSide: 'auto' })).toBe(false);
        expect(parse({ width: 1800.5 })).toBe(false);
    });

    it('paramsSchema ranges are identical to the field ranges', () => {
        const probe = (key: string, value: number) =>
            wardrobeHinged.paramsSchema.safeParse({
                ...wardrobeHinged.defaults,
                [key]: value,
            }).success;
        for (const f of wardrobeHinged.fields) {
            if (f.kind !== 'length' && f.kind !== 'int') continue;
            expect([f.key, probe(f.key, f.min)]).toEqual([f.key, true]);
            expect([f.key, probe(f.key, f.max)]).toEqual([f.key, true]);
            expect([f.key, probe(f.key, f.min - 1)]).toEqual([f.key, false]);
            expect([f.key, probe(f.key, f.max + 1)]).toEqual([f.key, false]);
        }
    });

    it('effectiveParams-driven default document merges admin overrides', () => {
        const { document } = templateDefaultDocument(
            'wardrobe_hinged',
            { width: 2400, bogus: true },
            catalog,
            testIds(),
        );
        expect(document.dims.width).toBe(2400);
        expect(document.carcass?.fronts.map((f) => f.leaves)).toEqual([2, 2]);
    });

    it('templateDefaultDocument falls back to code defaults on invalid overrides', () => {
        const { document } = templateDefaultDocument(
            'wardrobe_hinged',
            { width: 9999 },
            catalog,
            testIds(),
        );
        expect(document.dims.width).toBe(1800);
    });

    it('templateDefaultDocument draws real ids by default', () => {
        const { document } = templateDefaultDocument(
            'wardrobe_hinged',
            {},
            catalog,
        );
        expect(document.carcass?.interior.id).toMatch(/^s_[0-9a-z]{10}$/);
        expect(document.carcass?.interior.id).not.toBe('s_0000000001');
        expect(typeof newId('s')).toBe('string');
    });
});

describe('template registry', () => {
    it('registers wardrobe_hinged', () => {
        expect(TEMPLATES.wardrobe_hinged).toBe(wardrobeHinged);
        expect(getTemplate('wardrobe_hinged')).toBe(wardrobeHinged);
    });

    it('getTemplate throws invalid_input for a template that is not built yet', () => {
        const missing = TEMPLATE_KEYS.filter((k) => !(k in TEMPLATES));
        expect(missing.length).toBeGreaterThan(0);
        for (const key of missing) {
            expect(() => getTemplate(key)).toThrow(EngineInputError);
            try {
                getTemplate(key);
            } catch (e) {
                expect((e as EngineInputError).code).toBe('invalid_input');
            }
        }
    });
});
