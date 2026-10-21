import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Builds the real CLI bundle (same config as `yarn build:engine-cli`) into a
// temporary directory and runs it the way PHP's EngineCli does.
const root = resolve(__dirname, '../../..');
let workDir: string;

function runCli(entry: string, command: string, stdin: string): string {
    return execFileSync(process.execPath, [entry, command], {
        input: stdin,
        encoding: 'utf8',
    });
}

describe('built engine CLI', () => {
    beforeAll(() => {
        workDir = mkdtempSync(join(tmpdir(), 'engine-cli-'));
        execFileSync(
            process.execPath,
            [
                join(root, 'node_modules/vite/bin/vite.js'),
                'build',
                '--config',
                'engine-cli/vite.config.ts',
                '--outDir',
                join(workDir, 'dist'),
                '--logLevel',
                'silent',
            ],
            { cwd: root, stdio: 'pipe' },
        );
        symlinkSync(join(workDir, 'dist'), join(workDir, 'linked'), 'dir');
    }, 60_000);

    afterAll(() => {
        rmSync(workDir, { recursive: true, force: true });
    });

    it('answers on stdout when run directly', () => {
        expect(
            JSON.parse(runCli(join(workDir, 'dist/cli.mjs'), 'version', '{}')),
        ).toEqual({ ok: true, result: { engineVersion: '1.0.0' } });
    });

    it('answers on stdout when run through a symlinked directory', () => {
        expect(
            JSON.parse(
                runCli(join(workDir, 'linked/cli.mjs'), 'version', '{}'),
            ),
        ).toEqual({ ok: true, result: { engineVersion: '1.0.0' } });
    });
});
