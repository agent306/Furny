import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface PackageJson {
    packageManager: string;
    engines: { node: string };
    dependencies: Record<string, string>;
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as PackageJson;

describe('package manager and pinned packages', () => {
    it('pins yarn 4 via corepack', () => {
        expect(pkg.packageManager).toMatch(/^yarn@4\.\d+\.\d+$/);
        expect(pkg.engines.node).toBe('>=22.12 <23');
        expect(existsSync('package-lock.json')).toBe(false);
        expect(readFileSync('.yarnrc.yml', 'utf8')).toContain(
            'nodeLinker: node-modules',
        );
    });

    it('pins exact pre-1.0 packages', () => {
        expect(pkg.dependencies.three).toBe('0.186.1');
        expect(pkg.dependencies['@tresjs/core']).toBe('5.9.3');
        expect(pkg.dependencies['@tresjs/cientos']).toBe('5.9.3');
        expect(pkg.dependencies['clipper2-ts']).toBe('2.0.1-18');
    });

    it('loads no fonts from third-party hosts', () => {
        for (const f of [
            'vite.config.ts',
            'resources/views/app.blade.php',
            'resources/css/app.css',
        ]) {
            expect(readFileSync(f, 'utf8')).not.toMatch(
                /bunny|fonts\.googleapis/,
            );
        }
    });
});
