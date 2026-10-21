import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

// Standalone on purpose: the app's vite.config.ts loads the Laravel, Inertia
// and Wayfinder plugins (the latter runs artisan), which tests must not need.
const ENGINE_TESTS = [
    'resources/js/engine/**/*.test.ts',
    'engine-cli/src/**/*.test.ts',
];

export default defineConfig({
    plugins: [vue()],
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./resources/js', import.meta.url)),
        },
    },
    test: {
        coverage: {
            provider: 'v8',
            include: ['resources/js/**', 'engine-cli/src/**'],
            exclude: [
                '**/testing/**',
                '**/__tests__/**',
                '**/__perf__/**',
                '**/*.bench.ts',
                '**/*.d.ts',
                // Generated code (Wayfinder, typescript:transform, i18n:export) and the kit.
                'resources/js/{actions,routes,wayfinder}/**',
                'resources/js/lang/generated/**',
                'resources/js/components/ui/**',
            ],
            reportsDirectory: 'build/coverage/js',
            // 04 §10 / 16: the engine only; editor, lib and composables are owned by P4/P5.
            thresholds: {
                'resources/js/engine/**': { lines: 90, branches: 85 },
                'resources/js/engine/{units,geometry,plan}/**': { lines: 90 },
            },
        },
        projects: [
            {
                extends: true,
                test: {
                    name: 'engine',
                    environment: 'node',
                    // v8 coverage slows the heaviest equivalence tests ~3x; they take ~1 s plain.
                    testTimeout: 20_000,
                    include: ENGINE_TESTS,
                    exclude: ['**/node_modules/**', '**/__perf__/**'],
                    // 16 §10: yarn bench:check runs these and asserts bench-thresholds.json.
                    benchmark: {
                        include: ['resources/js/engine/**/*.bench.ts'],
                    },
                },
            },
            {
                extends: true,
                test: {
                    name: 'app',
                    environment: 'happy-dom',
                    include: ['resources/js/**/*.test.ts'],
                    exclude: ['**/node_modules/**', ...ENGINE_TESTS],
                    setupFiles: ['resources/js/test/setup.ts'],
                    benchmark: { include: [] },
                },
            },
        ],
    },
});
