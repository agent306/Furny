import {
    defineConfigWithVueTs,
    vueTsConfigs,
} from '@vue/eslint-config-typescript';
import prettier from 'eslint-config-prettier/flat';
import vue from 'eslint-plugin-vue';

/**
 * Starter-kit Vue files that are still present. They predate the i18n rule
 * and are replaced by Furny pages/layouts; Task 31 deletes the last ones and
 * empties this list. Never add new files here.
 */
export const LEGACY_KIT_FILES = [
    'resources/js/components/AlertError.vue',
    'resources/js/components/InputError.vue',
    'resources/js/components/PasswordInput.vue',
    'resources/js/components/TextLink.vue',
    'resources/js/pages/Auth/ConfirmPassword.vue',
    'resources/js/pages/Auth/ForgotPassword.vue',
    'resources/js/pages/Auth/Login.vue',
    'resources/js/pages/Auth/Register.vue',
    'resources/js/pages/Auth/ResetPassword.vue',
    'resources/js/pages/Auth/TwoFactorChallenge.vue',
    'resources/js/pages/Auth/VerifyEmail.vue',
];

// App URLs come from Wayfinder (`@/routes/...`, `@/actions/...`), never from
// hand-written strings (16 §7.2).
const APP_URL_PREFIX =
    '^\\/(api\\/|admin|orders|projects|plans|furniture|imports|account)';

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
    {
        name: 'furny/legacy-kit-files',
        ignores: LEGACY_KIT_FILES,
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
        name: 'furny/message-body-v-html',
        files: ['resources/js/components/orders/MessageBody.vue'],
        rules: {
            'vue/no-v-html': 'off',
        },
    },
    prettier,
);
