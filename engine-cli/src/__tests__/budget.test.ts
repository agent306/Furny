import { describe, expect, it } from 'vitest';
import { seedCatalog } from '../../../resources/js/engine/testing/seedCatalog';
import { dispatch, type CliResponse } from '../commands';
import { get, loadFurniture, set } from './fixtureSources';

const catalog = seedCatalog();

function timed(
    command: string,
    request: unknown,
): { response: CliResponse; ms: number } {
    const raw = JSON.stringify(request);
    const start = performance.now();
    const response = dispatch(command, raw);
    return { response, ms: performance.now() - start };
}

const issueCodes = (response: CliResponse): string[] =>
    (get(response, 'result.issues') as Array<{ code: string }>).map(
        (i) => i.code,
    );

function columns(count: number): Record<string, unknown> {
    const children = Array.from({ length: count }, (_, i) => ({
        size: { mode: 'flex', weight: 1 },
        section: {
            id: `s_${String(i + 10).padStart(10, '0')}`,
            split: 'none',
            children: [],
            content: { type: 'empty' },
        },
    }));
    const doc = loadFurniture('wardrobe-3door');
    set(doc, 'carcass.interior', {
        id: 's_0000000001',
        split: 'columns',
        content: null,
        children,
    });
    set(doc, 'carcass.fronts', []);
    return doc;
}

describe('work budget of validate-furniture and compute-bom', () => {
    it('refuses a width of 1e8 at once with dims_range', () => {
        const doc = loadFurniture('wardrobe-3door');
        set(doc, 'dims.width', 1e8);
        const { response, ms } = timed('validate-furniture', {
            document: doc,
            catalog,
        });
        expect(ms).toBeLessThan(1000);
        expect(get(response, 'result.valid')).toBe(false);
        expect(issueCodes(response)).toContain('furniture.dims_range');
        expect(get(response, 'result.bbox.size')).toEqual([1e8, 2100, 600]);
    });

    it('refuses a 1e8 width in compute-bom without generating parts', () => {
        const doc = loadFurniture('wardrobe-3door');
        set(doc, 'dims.width', 1e8);
        const { response, ms } = timed('compute-bom', {
            document: doc,
            catalog,
            options: { nesting: true },
        });
        expect(ms).toBeLessThan(1000);
        expect(get(response, 'result.bom.cutList')).toEqual([]);
    });

    it('refuses 20 000 columns with too_many_parts', () => {
        const { response, ms } = timed('validate-furniture', {
            document: columns(20_000),
            catalog,
        });
        expect(ms).toBeLessThan(1000);
        expect(get(response, 'result.valid')).toBe(false);
        expect(issueCodes(response)).toContain('furniture.too_many_parts');
    });

    it('refuses 5000 fronts with too_many_parts', () => {
        const doc = loadFurniture('wardrobe-3door');
        const front = (get(doc, 'carcass.fronts') as unknown[])[0] as Record<
            string,
            unknown
        >;
        set(
            doc,
            'carcass.fronts',
            Array.from({ length: 5000 }, (_, i) => ({
                ...front,
                id: `fr_${String(i).padStart(10, '0')}`,
            })),
        );
        const { response, ms } = timed('validate-furniture', {
            document: doc,
            catalog,
        });
        expect(ms).toBeLessThan(1000);
        expect(get(response, 'result.valid')).toBe(false);
        expect(issueCodes(response)).toContain('furniture.too_many_parts');
    });

    it('refuses 5000 extra parts with too_many_parts', () => {
        const doc = loadFurniture('wardrobe-3door');
        set(
            doc,
            'overrides.extraParts',
            Array.from({ length: 5000 }, (_, i) => ({
                id: `p_${String(i).padStart(10, '0')}`,
                name: 'x',
                role: 'carcass',
                materialCode: 'MDF-18',
                length: 100,
                width: 100,
                qty: 99,
                edges: { L1: null, L2: null, W1: null, W2: null },
                grain: 'none',
                note: null,
                placement: null,
            })),
        );
        const { response, ms } = timed('validate-furniture', {
            document: doc,
            catalog,
        });
        expect(ms).toBeLessThan(1000);
        expect(issueCodes(response)).toContain('furniture.too_many_parts');
    });

    it('maps a stack overflow in parsing to invalid_input', () => {
        const doc = loadFurniture('wardrobe-3door');
        set(doc, 'carcass.interior', '__DEEP__');
        const leaf =
            '{"id":"s_9999999999","split":"none","children":[],"content":{"type":"empty"}}';
        const open =
            '{"id":"s_0000000001","split":"columns","content":null,"children":[{"size":{"mode":"flex","weight":1},"section":';
        const deep = open.repeat(20_000) + leaf + '}]}'.repeat(20_000);
        const raw = JSON.stringify({ document: doc, catalog }).replace(
            '"__DEEP__"',
            deep,
        );
        expect(dispatch('validate-furniture', raw)).toMatchObject({
            ok: false,
            error: { code: 'invalid_input' },
        });
    });

    it('maps arithmetic overflow to invalid_input', () => {
        const doc = loadFurniture('wardrobe-3door');
        const { response } = timed('compute-bom', {
            document: doc,
            catalog,
            options: {
                nesting: false,
                price: {
                    quantity: Number.MAX_SAFE_INTEGER,
                    includeInstallation: true,
                },
            },
        });
        expect(response).toMatchObject({
            ok: false,
            error: { code: 'invalid_input' },
        });
    });
});
