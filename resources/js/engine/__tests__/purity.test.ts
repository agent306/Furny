// @vitest-environment node
import { describe, expect, it } from 'vitest';

// import.meta.glob arguments must be literals, so the pattern list is repeated.
const loaders = import.meta.glob([
    '../**/*.ts',
    '!../**/__tests__/**',
    '!../**/__perf__/**',
    '!../**/*.bench.ts',
]);
const sources = import.meta.glob(
    [
        '../**/*.ts',
        '!../**/__tests__/**',
        '!../**/__perf__/**',
        '!../**/*.bench.ts',
    ],
    { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

const FORBIDDEN: RegExp[] = [
    /from\s+['"]vue['"]/,
    /from\s+['"]three['"]/,
    /from\s+['"]@tresjs/,
    /\bwindow\./,
    /\bdocument\./,
    /\blocalStorage\b/,
    /\bfetch\(/,
];

function filesMatching(pattern: RegExp): string[] {
    return Object.entries(sources)
        .filter(([, text]) => pattern.test(text))
        .map(([path]) => path.replace(/^\.\.\//, ''))
        .sort();
}

describe('engine purity', () => {
    it('finds engine source files to check', () => {
        expect(Object.keys(sources).length).toBeGreaterThan(0);
        expect(Object.keys(loaders)).toEqual(Object.keys(sources));
    });

    it('imports every engine module in a bare node environment', async () => {
        // eslint-disable-next-line no-restricted-globals -- asserting the absence of DOM globals
        expect(typeof window === 'undefined').toBe(true);
        // eslint-disable-next-line no-restricted-globals -- asserting the absence of DOM globals
        expect(typeof document === 'undefined').toBe(true);

        for (const load of Object.values(loaders)) {
            await expect(load()).resolves.toBeDefined();
        }
    });

    it.each(FORBIDDEN.map((re) => [String(re), re] as const))(
        'no engine source matches %s',
        (_label, re) => {
            expect(filesMatching(re)).toEqual([]);
        },
    );

    it('imports clipper2-ts only from geometry/clip.ts', () => {
        const offenders = filesMatching(/['"]clipper2-ts['"]/).filter(
            (path) => path !== 'geometry/clip.ts',
        );
        expect(offenders).toEqual([]);
    });

    it('imports earcut only from geometry/triangulate.ts', () => {
        const offenders = filesMatching(/['"]earcut['"]/).filter(
            (path) => path !== 'geometry/triangulate.ts',
        );
        expect(offenders).toEqual([]);
    });
});
