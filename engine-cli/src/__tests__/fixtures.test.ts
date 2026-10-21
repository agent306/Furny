import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TEMPLATE_KEYS } from '../../../resources/js/engine/furniture/schema';
import { testIds } from '../../../resources/js/engine/testing/ids';
import { seedCatalog } from '../../../resources/js/engine/testing/seedCatalog';
import { dispatch, type CliResponse } from '../commands';
import { loadFurniture, loadPlan, set } from './fixtureSources';

/**
 * The request/response pairs PHP's contract tests consume (16 §5.2, §13.1):
 * `tests/fixtures/engine-cli/<command>.<case>.json` = `{ command, request,
 * response }`. `UPDATE_FIXTURES=1 yarn vitest run engine-cli` rewrites them;
 * otherwise the committed files must equal what the CLI answers now.
 */
const UPDATE = process.env['UPDATE_FIXTURES'] === '1';
const DIR = new URL('../../../tests/fixtures/engine-cli/', import.meta.url);

const catalog = seedCatalog();
const PLANS = ['hdb-3room', 'brochure-2bhk'] as const;
const FURNITURE = [
    'wardrobe-3door',
    'tv-unit-1800',
    'bookshelf-5shelf',
    'kitchen-base-600',
    'study-desk-cabinet',
    'dining-table-6seat',
] as const;

interface Case {
    file: string;
    command: string;
    request: unknown;
}

const wardrobe = loadFurniture('wardrobe-3door');
const wider = structuredClone(wardrobe);
set(wider, 'dims.width', 2100);

const cases: Case[] = [
    ...PLANS.flatMap((name) => [
        {
            file: `validate-plan.${name}.json`,
            command: 'validate-plan',
            request: { document: loadPlan(name) },
        },
        {
            file: `plan-summary.${name}.json`,
            command: 'plan-summary',
            request: { document: loadPlan(name) },
        },
    ]),
    {
        file: 'validate-furniture.wardrobe-3door.json',
        command: 'validate-furniture',
        request: { document: wardrobe, catalog },
    },
    ...FURNITURE.map((name) => ({
        file: `compute-bom.${name}.json`,
        command: 'compute-bom',
        request: {
            document: loadFurniture(name),
            catalog,
            options: { nesting: true },
        },
    })),
    ...TEMPLATE_KEYS.map((templateKey) => ({
        file: `template-default.${templateKey}.json`,
        command: 'template-default',
        request: { templateKey, overrides: {}, catalog },
    })),
    {
        file: 'diff-furniture.wardrobe-width-2100.json',
        command: 'diff-furniture',
        request: { before: wardrobe, after: wider, catalog },
    },
    {
        file: 'invalid-input.json',
        command: 'compute-bom',
        request: {
            document: wardrobe,
            catalog: {},
            options: { nesting: true },
        },
    },
];

const answer = (command: string, request: unknown): CliResponse =>
    // JSON round trip = what crosses the wire; ids are deterministic for template-default
    JSON.parse(
        JSON.stringify(
            dispatch(command, JSON.stringify(request), { newId: testIds() }),
        ),
    ) as CliResponse;

function sync(file: string, content: string): string {
    const url = new URL(file, DIR);
    if (UPDATE) {
        mkdirSync(fileURLToPath(DIR), { recursive: true });
        writeFileSync(url, content, 'utf8');
    }
    return readFileSync(url, 'utf8');
}

describe('engine-cli fixtures', () => {
    it.each(cases)('$file is the CLI answer to its request', (c) => {
        const response = answer(c.command, c.request);
        const stored = sync(
            c.file,
            `${JSON.stringify({ command: c.command, request: c.request, response }, null, 2)}\n`,
        );
        expect(JSON.parse(stored)).toEqual({
            command: c.command,
            request: JSON.parse(JSON.stringify(c.request)),
            response,
        });
    });

    it('cutlist-csv.wardrobe-3door.csv is the cut list of the computed BOM', () => {
        const { bom } = (
            answer('compute-bom', {
                document: wardrobe,
                catalog,
                options: { nesting: true },
            }) as { ok: true; result: { bom: unknown } }
        ).result;
        const response = answer('cutlist-csv', {
            bom,
            catalog,
            document: wardrobe,
        }) as { ok: true; result: { csv: string } };
        expect(response.ok).toBe(true);
        expect(
            sync('cutlist-csv.wardrobe-3door.csv', response.result.csv),
        ).toBe(response.result.csv);
    });

    it('every template key has a passing template-default fixture', () => {
        for (const key of TEMPLATE_KEYS) {
            const { response } = JSON.parse(
                readFileSync(
                    new URL(`template-default.${key}.json`, DIR),
                    'utf8',
                ),
            ) as { response: { ok: boolean } };
            expect(response.ok, key).toBe(true);
        }
    });
});
