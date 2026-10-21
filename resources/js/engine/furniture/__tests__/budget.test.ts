import { describe, expect, it } from 'vitest';
import { seedCatalog } from '../../testing/seedCatalog';
import { MAX_PARTS } from '../constants';
import { generateFurniture } from '../generate';
import type { Section, SectionChild } from '../schema';
import { wardrobeFixture } from '../testing/docs';
import { isSaveBlocking, validateFurniture } from '../validate';

const catalog = seedCatalog();

const flexLeaf = (n: number): SectionChild => ({
    size: { mode: 'flex', weight: 1 },
    section: {
        id: `s_${String(n + 10).padStart(10, '0')}`,
        split: 'none',
        children: [],
        content: { type: 'empty' },
    },
});

const columns = (count: number): Section => ({
    id: 's_0000000001',
    split: 'columns',
    content: null,
    children: Array.from({ length: count }, (_, i) => flexLeaf(i)),
});

const codes = (issues: readonly { code: string }[]): string[] =>
    issues.map((i) => i.code);

describe('generateFurniture work budget', () => {
    it('returns an empty model with dims_range when a dimension is over twice its maximum', () => {
        const doc = wardrobeFixture((d) => {
            d.dims.width = 1e8;
        });
        const model = generateFurniture(doc, catalog);
        expect(model.parts).toEqual([]);
        expect(model.hardware).toEqual([]);
        expect(model.fronts).toEqual([]);
        expect(model.bbox).toEqual({ min: [0, 0, 0], size: [1e8, 2100, 600] });
        expect(model.issues).toMatchObject([
            {
                code: 'furniture.dims_range',
                severity: 'error',
                params: { dimension: 'width', min: 150, max: 6000 },
            },
        ]);
    });

    it('reports every dimension out of range once one is over the limit', () => {
        const doc = wardrobeFixture((d) => {
            d.dims.width = 1e8;
            d.dims.depth = 50;
        });
        expect(codes(generateFurniture(doc, catalog).issues)).toEqual([
            'furniture.dims_range',
            'furniture.dims_range',
        ]);
    });

    it('still generates up to twice the maximum, where validateFurniture reports dims_range', () => {
        const doc = wardrobeFixture((d) => {
            d.dims.width = 12_000;
        });
        expect(generateFurniture(doc, catalog).parts.length).toBeGreaterThan(0);
        expect(validateFurniture(doc, catalog)[0]?.code).toBe(
            'furniture.dims_range',
        );
    });

    it('refuses more than MAX_PARTS leaf sections with too_many_parts', () => {
        const doc = wardrobeFixture((d) => {
            d.carcass!.interior = columns(MAX_PARTS + 1);
            d.carcass!.fronts = [];
        });
        const model = generateFurniture(doc, catalog);
        expect(model.parts).toEqual([]);
        expect(model.issues).toMatchObject([
            {
                code: 'furniture.too_many_parts',
                params: { count: MAX_PARTS + 1 },
            },
        ]);
    });

    it('counts MAX_PARTS leaves as within budget', () => {
        const doc = wardrobeFixture((d) => {
            d.carcass!.interior = columns(MAX_PARTS);
            d.carcass!.fronts = [];
        });
        expect(generateFurniture(doc, catalog).parts.length).toBeGreaterThan(0);
    });

    it('refuses more than MAX_PARTS fronts', () => {
        const doc = wardrobeFixture((d) => {
            const front = d.carcass!.fronts[0]!;
            d.carcass!.fronts = Array.from(
                { length: MAX_PARTS + 1 },
                (_, i) => ({
                    ...front,
                    id: `fr_${String(i).padStart(10, '0')}`,
                }),
            );
        });
        expect(codes(generateFurniture(doc, catalog).issues)).toEqual([
            'furniture.too_many_parts',
        ]);
    });

    it('refuses more than MAX_PARTS extra parts', () => {
        const doc = wardrobeFixture((d) => {
            d.overrides.extraParts = Array.from(
                { length: MAX_PARTS + 1 },
                (_, i) => ({
                    id: `p_${String(i).padStart(10, '0')}`,
                    name: 'x',
                    role: 'carcass',
                    materialCode: 'PB18-WHITE',
                    length: 100,
                    width: 100,
                    qty: 1,
                    edges: { L1: null, L2: null, W1: null, W2: null },
                    grain: 'none',
                    note: null,
                    placement: null,
                }),
            );
        });
        expect(codes(generateFurniture(doc, catalog).issues)).toEqual([
            'furniture.too_many_parts',
        ]);
    });

    it('refuses a deep chain of one-child sections without recursing', () => {
        let section: Section = flexLeaf(0).section;
        for (let i = 0; i < 100_000; i += 1) {
            section = {
                id: 's_0000000001',
                split: 'columns',
                content: null,
                children: [{ size: { mode: 'flex', weight: 1 }, section }],
            };
        }
        const doc = wardrobeFixture((d) => {
            d.carcass!.interior = section;
        });
        const issues = validateFurniture(doc, catalog);
        expect(codes(issues)).toEqual(['furniture.too_many_parts']);
        expect(isSaveBlocking(issues)).toBe(true);
    });

    it('validateFurniture of an over-budget document is quick and keeps the family check', () => {
        const doc = wardrobeFixture((d) => {
            d.dims.width = 1e9;
            d.carcass = null;
        });
        const start = performance.now();
        const issues = validateFurniture(doc, catalog);
        expect(performance.now() - start).toBeLessThan(1000);
        expect(codes(issues)).toEqual([
            'furniture.dims_range',
            'furniture.family_mismatch',
        ]);
    });
});
