import {
    defineConfigWithVueTs,
    vueTsConfigs,
} from '@vue/eslint-config-typescript';
import prettier from 'eslint-config-prettier/flat';
import vue from 'eslint-plugin-vue';

// App URLs come from Wayfinder (`@/routes/...`, `@/actions/...`), never from
// hand-written strings (16 §7.2).
const APP_URL_PREFIX =
    '^\\/(api\\/|admin|orders|projects|plans|furniture|imports|account)';

// Engine purity (01 §5.1, 04 §10): framework-free, DOM-free, network-free.
// clipper2-ts and earcut each have exactly one permitted importer.
const ENGINE_FILES = ['resources/js/engine/**/*.ts'];

const ENGINE_RESTRICTED_PACKAGES = [
    {
        name: 'vue',
        message: 'The engine is framework-free (01 §5.1).',
    },
    {
        name: 'three',
        message: 'The engine is renderer-free (01 §5.1).',
    },
    {
        name: 'clipper2-ts',
        message:
            'Only engine/geometry/clip.ts may import clipper2-ts (04 §10).',
    },
    {
        name: 'earcut',
        message:
            'Only engine/geometry/triangulate.ts may import earcut (04 §10).',
    },
];

const ENGINE_RESTRICTED_PATTERNS = [
    {
        group: ['@tresjs/*', 'three/*'],
        message: 'The engine is renderer-free (01 §5.1).',
    },
    {
        group: ['@/*', '**/editor/**', '**/components/**'],
        message:
            'Engine imports are relative and never reach into the app (01 §5.2).',
    },
];

const ENGINE_RESTRICTED_GLOBALS = [
    'window',
    'document',
    'localStorage',
    'fetch',
    'HTMLCanvasElement',
    'Image',
].map((name) => ({
    name,
    message: 'The engine must not touch DOM or network globals (01 §5.1).',
}));

function enginePurityRules(allowedPackage) {
    return {
        'no-restricted-imports': [
            'error',
            {
                paths: ENGINE_RESTRICTED_PACKAGES.filter(
                    (p) => p.name !== allowedPackage,
                ),
                patterns: ENGINE_RESTRICTED_PATTERNS,
            },
        ],
        'no-restricted-globals': ['error', ...ENGINE_RESTRICTED_GLOBALS],
    };
}

export default defineConfigWithVueTs(
    {
        name: 'furny/ignores',
        ignores: [
            '.superpowers/**',
            'bootstrap/ssr/**',
            'build/**',
            'docs/**',
            'engine-cli/dist/**',
            'node_modules/**',
            'public/**',
            'storage/**',
            'vendor/**',
            'vision/**',
            'resources/js/actions/**',
            'resources/js/routes/**',
            'resources/js/wayfinder/**',
            'resources/js/lang/generated/**',
            'resources/js/types/generated.d.ts',
            'resources/js/components/ui/**',
            'tests/Browser/screenshots/**',
        ],
    },
    vue.configs['flat/recommended'],
    vueTsConfigs.recommended,
    {
        name: 'furny/rules',
        rules: {
            '@typescript-eslint/no-explicit-any': 'error',
            'vue/no-v-html': 'error',
            'vue/no-bare-strings-in-template': [
                'error',
                { allowlist: ['×', '—', '·', '/', ':', '%', '+'] },
            ],
            'vue/multi-word-component-names': 'off',
        },
    },
    {
        name: 'furny/wayfinder-urls',
        files: ['resources/js/**/*.{ts,vue}'],
        ignores: ['resources/js/**/__tests__/**'],
        rules: {
            'no-restricted-syntax': [
                'error',
                {
                    selector: `Literal[value=/${APP_URL_PREFIX}/]`,
                    message:
                        'Use the Wayfinder helpers (@/routes, @/actions) instead of a hard-coded URL.',
                },
                {
                    selector: `TemplateLiteral[quasis.0.value.raw=/${APP_URL_PREFIX}/]`,
                    message:
                        'Use the Wayfinder helpers (@/routes, @/actions) instead of a hard-coded URL.',
                },
            ],
        },
    },
    {
        name: 'furny/engine-purity',
        files: ENGINE_FILES,
        rules: enginePurityRules(null),
    },
    {
        name: 'furny/engine-purity/clip',
        files: ['resources/js/engine/geometry/clip.ts'],
        rules: enginePurityRules('clipper2-ts'),
    },
    {
        name: 'furny/engine-purity/triangulate',
        files: ['resources/js/engine/geometry/triangulate.ts'],
        rules: enginePurityRules('earcut'),
    },
    {
        name: 'furny/message-body-v-html',
        files: ['resources/js/components/orders/MessageBody.vue'],
        rules: {
            'vue/no-v-html': 'off',
        },
    },
    prettier,
);
