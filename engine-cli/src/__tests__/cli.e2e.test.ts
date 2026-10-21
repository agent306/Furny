import { execSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { get } from './fixtureSources';
import { makeRectPlan } from '../../../resources/js/engine/plan/testing/fixtures';

/**
 * Review focus 4 (preflight): malformed server input never crashes the real
 * bundle, never leaves partial stdout or anything on stderr, and exits 0.
 */
const root = resolve(__dirname, '../../..');
const cli = resolve(root, 'engine-cli/dist/cli.mjs');

interface Run {
    status: number | null;
    stdout: string;
    stderr: string;
    json: Record<string, unknown>;
}

function run(command: string, stdin: string): Run {
    const out = spawnSync(process.execPath, [cli, command], {
        cwd: root,
        input: stdin,
        encoding: 'utf8',
        maxBuffer: 256 * 1024 * 1024,
    });
    return {
        status: out.status,
        stdout: out.stdout,
        stderr: out.stderr,
        json: JSON.parse(out.stdout) as Record<string, unknown>,
    };
}

/** Exit 0, nothing on stderr, stdout is exactly one JSON line. */
function expectClean(r: Run): void {
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
    expect(r.stdout.endsWith('\n')).toBe(true);
    expect(r.stdout.trimEnd().includes('\n')).toBe(false);
}

describe('built engine CLI', () => {
    beforeAll(() => {
        execSync('yarn build:engine-cli', { cwd: root, stdio: 'pipe' });
    }, 120_000);

    it('answers the version command', () => {
        const r = run('version', '{}');
        expectClean(r);
        expect(r.stdout).toBe(
            '{"ok":true,"result":{"engineVersion":"1.0.0"}}\n',
        );
    });

    it('reports invalid JSON', () => {
        const r = run('version', '{');
        expectClean(r);
        expect(r.json).toMatchObject({
            ok: false,
            error: { code: 'invalid_json' },
        });
    });

    it('reports an unknown command', () => {
        const r = run('nope', '{}');
        expectClean(r);
        expect(r.json).toMatchObject({
            ok: false,
            error: { code: 'unknown_command' },
        });
    });

    it('reports empty stdin as invalid JSON', () => {
        const r = run('compute-bom', '');
        expectClean(r);
        expect(r.json).toMatchObject({
            ok: false,
            error: { code: 'invalid_json' },
        });
    });

    it.each(['validate-plan', 'compute-bom', 'cutlist-csv', 'diff-furniture'])(
        'reports wrongly typed input to %s as invalid_input',
        (command) => {
            for (const stdin of ['42', 'null', '{"document":42}']) {
                const r = run(command, stdin);
                expectClean(r);
                expect(r.json).toMatchObject({
                    ok: false,
                    error: { code: 'invalid_input' },
                });
            }
        },
    );

    it('answers a 2.5 MB plan with ok and plan.too_large', () => {
        const plan = makeRectPlan(5000, 4000, 230);
        for (let i = 0; i < 50_000; i += 1) {
            const id = `n_x${String(i).padStart(9, '0')}`;
            plan.nodes[id] = { id, x: i % 1000, y: Math.floor(i / 1000) };
        }
        const stdin = JSON.stringify({ document: plan });
        expect(stdin.length).toBeGreaterThan(2_500_000);
        const r = run('validate-plan', stdin);
        expectClean(r);
        expect(r.json['ok']).toBe(true);
        expect(get(r.json, 'result.valid')).toBe(false);
        expect(
            (get(r.json, 'result.issues') as Array<{ code: string }>).map(
                (i) => i.code,
            ),
        ).toContain('plan.too_large');
    }, 60_000);

    it('answers the committed compute-bom fixture request with its response', () => {
        const fixture = JSON.parse(
            readFileSync(
                resolve(
                    root,
                    'tests/fixtures/engine-cli/compute-bom.wardrobe-3door.json',
                ),
                'utf8',
            ),
        ) as { request: unknown; response: unknown };
        const r = run('compute-bom', JSON.stringify(fixture.request));
        expectClean(r);
        expect(r.json).toEqual(fixture.response);
    });
});
