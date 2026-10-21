import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 15 §3: app code uses design tokens, never raw Tailwind palette colours.
const RAW_PALETTE =
    /\b(bg|text|border|fill|stroke|ring)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/;

const SOURCE_ROOT = 'resources/js';

function vueFiles(): string[] {
    return (readdirSync(SOURCE_ROOT, { recursive: true }) as string[])
        .map((file) => `${SOURCE_ROOT}/${file.split('\\').join('/')}`)
        .filter((file) => file.endsWith('.vue'))
        .filter((file) => !file.startsWith(`${SOURCE_ROOT}/components/ui/`));
}

function offences(files: Record<string, string>): string[] {
    return Object.entries(files).flatMap(([file, source]) =>
        source
            .split('\n')
            .map((line, index) => ({ line, number: index + 1 }))
            .filter(({ line }) => RAW_PALETTE.test(line))
            .map(({ line, number }) => `${file}:${number}: ${line.trim()}`),
    );
}

describe('raw Tailwind palette colours (15 §3)', () => {
    it('are not used in app Vue files', () => {
        const files = Object.fromEntries(
            vueFiles().map((file) => [file, readFileSync(file, 'utf8')]),
        );

        expect(Object.keys(files).length).toBeGreaterThan(0);
        expect(offences(files)).toEqual([]);
    });

    it('are caught by the pattern (the guard is not vacuous)', () => {
        const fixture = {
            'Offender.vue':
                '<template><p class="mt-2 text-red-600 dark:bg-neutral-800">x</p></template>',
            'Clean.vue':
                '<template><p class="text-destructive bg-muted/50 border-border">x</p></template>',
        };

        expect(offences(fixture)).toEqual([
            'Offender.vue:1: <template><p class="mt-2 text-red-600 dark:bg-neutral-800">x</p></template>',
        ]);
    });
});
