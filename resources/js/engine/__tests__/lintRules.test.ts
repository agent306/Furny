// @vitest-environment node
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

let eslint: ESLint;

beforeAll(async () => {
    eslint = new ESLint({ cwd: repoRoot });
    await eslint.lintText('export {};\n', {
        filePath: 'resources/js/engine/warmup.ts',
    });
});

async function ruleIds(code: string, filePath: string): Promise<string[]> {
    const [result] = await eslint.lintText(code, { filePath });
    return (result?.messages ?? []).map((m) => m.ruleId ?? 'parse-error');
}

const ENGINE_FILE = 'resources/js/engine/plan/x.ts';

describe('engine lint rules', { timeout: 30_000 }, () => {
    it.each([
        ["import { ref } from 'vue';\nexport const r = ref;\n"],
        ["import * as T from 'three';\nexport const t = T;\n"],
        [
            "import { TresCanvas } from '@tresjs/core';\nexport const c = TresCanvas;\n",
        ],
        ["import x from '@/lib/http';\nexport const h = x;\n"],
        [
            "import { Clipper64 } from 'clipper2-ts';\nexport const c = Clipper64;\n",
        ],
        ["import earcut from 'earcut';\nexport const e = earcut;\n"],
    ])('rejects the import in %j', async (code) => {
        expect(await ruleIds(code, ENGINE_FILE)).toContain(
            'no-restricted-imports',
        );
    });

    it.each([
        ['window.alert(1);\n'],
        ['export const b = document.body;\n'],
        ['export const v = localStorage.x;\n'],
        ["fetch('/');\n"],
    ])('rejects the global in %j', async (code) => {
        expect(await ruleIds(code, ENGINE_FILE)).toContain(
            'no-restricted-globals',
        );
    });

    it('lets geometry/clip.ts import clipper2-ts', async () => {
        const code =
            "import { Clipper64 } from 'clipper2-ts';\nexport const c = Clipper64;\n";
        expect(
            await ruleIds(code, 'resources/js/engine/geometry/clip.ts'),
        ).toEqual([]);
    });

    it('lets geometry/triangulate.ts import earcut', async () => {
        const code = "import earcut from 'earcut';\nexport const e = earcut;\n";
        expect(
            await ruleIds(code, 'resources/js/engine/geometry/triangulate.ts'),
        ).toEqual([]);
    });

    it('still blocks earcut in clip.ts and clipper2-ts in triangulate.ts', async () => {
        expect(
            await ruleIds(
                "import earcut from 'earcut';\nexport const e = earcut;\n",
                'resources/js/engine/geometry/clip.ts',
            ),
        ).toContain('no-restricted-imports');
        expect(
            await ruleIds(
                "import { Clipper64 } from 'clipper2-ts';\nexport const c = Clipper64;\n",
                'resources/js/engine/geometry/triangulate.ts',
            ),
        ).toContain('no-restricted-imports');
    });
});
