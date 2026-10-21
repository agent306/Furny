import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ICONS, type IconName } from '@/lib/icons';

// 15 §13 / 01 §1.2: named lucide imports only, so tree-shaking works.
const SOURCE_ROOT = 'resources/js';

function sourceFiles(): string[] {
    return (readdirSync(SOURCE_ROOT, { recursive: true }) as string[])
        .map((file) => `${SOURCE_ROOT}/${file.split('\\').join('/')}`)
        .filter((file) => /\.(vue|ts)$/.test(file))
        .filter((file) => !file.endsWith('.test.ts'));
}

const NAMESPACE_IMPORT = /import\s+\*\s+as\s+\w+\s+from\s+['"]@lucide\/vue['"]/;
const DYNAMIC_IMPORT = /import\(\s*['"]@lucide\/vue['"]\s*\)/;

describe('lucide imports', () => {
    it('never import the whole set (no `import * as` from @lucide/vue)', () => {
        const files = sourceFiles();

        expect(files.length).toBeGreaterThan(50);
        expect(
            files.filter((file) =>
                NAMESPACE_IMPORT.test(readFileSync(file, 'utf8')),
            ),
        ).toEqual([]);
    });

    it('never pull the set in through a dynamic import', () => {
        expect(
            sourceFiles().filter((file) =>
                DYNAMIC_IMPORT.test(readFileSync(file, 'utf8')),
            ),
        ).toEqual([]);
    });

    it('the guard is not vacuous', () => {
        expect(
            NAMESPACE_IMPORT.test("import * as Icons from '@lucide/vue'"),
        ).toBe(true);
        expect(
            NAMESPACE_IMPORT.test("import { Package } from '@lucide/vue'"),
        ).toBe(false);
    });
});

describe('ICONS registry', () => {
    it('contains the icon names the specs reference', () => {
        for (const name of [
            'package',
            'armchair',
            'house',
            'monitor-smartphone',
            'scan-line',
            'search-x',
            'send-horizontal',
            'rotate-3d',
            'bell',
            'bell-ring',
            'file-text',
            'sparkles',
        ] satisfies IconName[]) {
            expect(ICONS[name]).toBeDefined();
        }
    });

    it('maps kebab-case names to renderable components', () => {
        for (const [name, icon] of Object.entries(ICONS)) {
            expect(name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
            expect(icon, name).toBeTruthy();
        }
    });

    it('has no two names pointing at the same component by accident', () => {
        const seen = new Map<unknown, string>();

        for (const [name, icon] of Object.entries(ICONS)) {
            expect(seen.get(icon), `${name} duplicates ${seen.get(icon)}`).toBe(
                undefined,
            );
            seen.set(icon, name);
        }
    });
});
