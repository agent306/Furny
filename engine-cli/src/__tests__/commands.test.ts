import { describe, expect, it } from 'vitest';
import { makeRectPlan } from '../../../resources/js/engine/plan/testing/fixtures';
import { seedCatalog } from '../../../resources/js/engine/testing/seedCatalog';
import {
    CLI_COMMANDS,
    CLI_ERROR_CODES,
    dispatch,
    type CliResponse,
} from '../commands';
import { get, loadFurniture, loadPlan, set } from './fixtureSources';

const catalog = seedCatalog();
const wardrobe = loadFurniture('wardrobe-3door');

function run(command: string, request: unknown): CliResponse {
    return dispatch(command, JSON.stringify(request));
}

function ok(command: string, request: unknown): Record<string, unknown> {
    const response = run(command, request);
    if (!response.ok) throw new Error(JSON.stringify(response.error));
    return response.result as Record<string, unknown>;
}

const codes = (result: unknown): string[] =>
    (get(result, 'issues') as Array<{ code: string }>).map((i) => i.code);

describe('command and error code lists', () => {
    it('exports the protocol constants', () => {
        expect(CLI_COMMANDS).toEqual([
            'validate-plan',
            'validate-furniture',
            'compute-bom',
            'cutlist-csv',
            'template-default',
            'diff-furniture',
            'plan-summary',
            'version',
        ]);
        expect(CLI_ERROR_CODES).toEqual([
            'unknown_command',
            'invalid_json',
            'invalid_input',
            'engine_error',
        ]);
    });
});

describe('version', () => {
    it('answers with the engine version', () => {
        expect(run('version', {})).toEqual({
            ok: true,
            result: { engineVersion: '1.0.0' },
        });
    });
});

describe('compute-bom', () => {
    const request = {
        document: wardrobe,
        catalog,
        options: { nesting: true },
    };

    it('prices the wardrobe fixture exactly as 08 §10.2', () => {
        const result = ok('compute-bom', request);
        expect(result['engineVersion']).toBe('1.0.0');
        expect(result['price']).toMatchObject({
            unitPriceMinor: 2431300,
            installationMinor: 194600,
            totalBeforeTaxMinor: 2625900,
        });
        expect(get(result, 'bom.nesting.sheets')).toHaveLength(7);
    });

    it('prices the requested quantity without installation', () => {
        const result = ok('compute-bom', {
            ...request,
            options: {
                nesting: true,
                price: { quantity: 2, includeInstallation: false },
            },
        });
        expect(get(result, 'price.totalBeforeTaxMinor')).toBe(4862600);
    });

    it('skips nesting when asked to', () => {
        const result = ok('compute-bom', {
            ...request,
            options: { nesting: false },
        });
        expect(get(result, 'bom.nesting')).toBeNull();
    });

    it('rejects an empty catalog with the zod issues in details', () => {
        const response = run('compute-bom', { ...request, catalog: {} });
        expect(response).toMatchObject({
            ok: false,
            error: { code: 'invalid_input' },
        });
        const issues = get(response, 'error.details.issues');
        expect(Array.isArray(issues)).toBe(true);
        expect((issues as unknown[]).length).toBeGreaterThan(0);
    });

    it('rejects a request without options', () => {
        expect(
            run('compute-bom', { document: wardrobe, catalog }),
        ).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    });
});

describe('validate-furniture', () => {
    it('validates the wardrobe and reports its bounding box', () => {
        const result = ok('validate-furniture', {
            document: wardrobe,
            catalog,
        });
        expect(result['valid']).toBe(true);
        expect(get(result, 'bbox.size')).toEqual([1800, 2100, 600]);
        expect(result['migratedDocument']).toEqual(wardrobe);
        expect(Array.isArray(result['issues'])).toBe(true);
    });

    it('rejects a newer schemaVersion', () => {
        expect(
            run('validate-furniture', {
                document: { ...wardrobe, schemaVersion: 2 },
                catalog,
            }),
        ).toMatchObject({
            ok: false,
            error: {
                code: 'invalid_input',
                details: { code: 'unsupported_schema_version' },
            },
        });
    });

    it('rejects a document that fails the schema', () => {
        expect(
            run('validate-furniture', { document: { nope: 1 }, catalog }),
        ).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    });
});

describe('template-default', () => {
    it('applies the overrides to the generated document', () => {
        const result = ok('template-default', {
            templateKey: 'tv_unit',
            overrides: { width: 2000 },
            catalog,
        });
        expect(get(result, 'document.templateKey')).toBe('tv_unit');
        expect(get(result, 'document.dims.width')).toBe(2000);
        expect(Array.isArray(result['issues'])).toBe(true);
    });

    it('rejects an unknown template key', () => {
        expect(
            run('template-default', {
                templateKey: 'nope',
                overrides: {},
                catalog,
            }),
        ).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    });
});

describe('diff-furniture', () => {
    it('finds no change between identical documents', () => {
        expect(
            ok('diff-furniture', {
                before: wardrobe,
                after: wardrobe,
                catalog,
            }),
        ).toEqual({ changes: [] });
    });

    it('begins with the price change when the width differs', () => {
        const wider = structuredClone(wardrobe);
        set(wider, 'dims.width', 2100);
        const changes = ok('diff-furniture', {
            before: wardrobe,
            after: wider,
            catalog,
        });
        expect(get(changes, 'changes.0.kind')).toBe('price_changed');
        expect(get(changes, 'changes.1.kind')).toBe('dims_changed');
    });
});

describe('cutlist-csv', () => {
    it('exports the CSV of a computed BOM, starting with the UTF-8 BOM', () => {
        const { bom } = ok('compute-bom', {
            document: wardrobe,
            catalog,
            options: { nesting: false },
        });
        const csv = String(
            get(ok('cutlist-csv', { bom, catalog, document: wardrobe }), 'csv'),
        );
        expect(csv.startsWith('\uFEFFrow_no,part_name,qty,')).toBe(true);
        expect(csv.split(String.fromCharCode(13, 10))).toHaveLength(12 + 2);
    });

    it('rejects a request without a BOM', () => {
        expect(
            run('cutlist-csv', { catalog, document: wardrobe }),
        ).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    });
});

describe('validate-plan', () => {
    it('reports and removes an orphan node', () => {
        const plan = makeRectPlan(5000, 4000, 230);
        plan.nodes['n_00000000zz'] = { id: 'n_00000000zz', x: 9000, y: 9000 };
        const result = ok('validate-plan', { document: plan });
        expect(codes(result)).toContain('plan.orphan_node');
        expect(result['valid']).toBe(true);
        expect(
            get(result, 'migratedDocument.nodes.n_00000000zz'),
        ).toBeUndefined();
        expect(get(result, 'summary.wallCount')).toBe(4);
    });

    it('marks a plan over the 2 MiB size limit invalid', () => {
        const plan = makeRectPlan(5000, 4000, 230);
        for (let i = 0; i < 50_000; i += 1) {
            const id = `n_x${String(i).padStart(9, '0')}`;
            plan.nodes[id] = { id, x: i % 1000, y: Math.floor(i / 1000) };
        }
        const result = ok('validate-plan', { document: plan });
        expect(result['valid']).toBe(false);
        expect(codes(result)).toContain('plan.too_large');
    });

    it('rejects a newer schemaVersion', () => {
        expect(
            run('validate-plan', {
                document: { ...loadPlan('hdb-3room'), schemaVersion: 2 },
            }),
        ).toMatchObject({
            ok: false,
            error: {
                code: 'invalid_input',
                details: { code: 'unsupported_schema_version' },
            },
        });
    });
});

describe('plan-summary', () => {
    it('counts the rooms of the HDB plan', () => {
        const result = ok('plan-summary', { document: loadPlan('hdb-3room') });
        expect(result['roomCount']).toBeGreaterThan(0);
        expect(result['bbox']).not.toBeNull();
    });
});

describe('errors', () => {
    it('rejects an unknown command', () => {
        expect(dispatch('nope', '{}')).toMatchObject({
            ok: false,
            error: { code: 'unknown_command' },
        });
    });

    it('rejects input that is not JSON', () => {
        expect(dispatch('compute-bom', '{')).toMatchObject({
            ok: false,
            error: { code: 'invalid_json' },
        });
    });

    it('rejects a request that is not an object', () => {
        expect(dispatch('compute-bom', '[]')).toMatchObject({
            ok: false,
            error: { code: 'invalid_input' },
        });
    });
});
