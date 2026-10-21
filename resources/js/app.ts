import { createInertiaApp } from '@inertiajs/vue3';
import { initializeTheme } from '@/composables/useAppearance';
import AppLayout from '@/layouts/AppLayout.vue';
import AuthLayout from '@/layouts/AuthLayout.vue';
import { initializeFlashToast } from '@/lib/flashToast';
import { createI18n } from '@/lib/i18n';

const appName = import.meta.env.VITE_APP_NAME || 'Laravel';

const DEFAULT_LOCALE = 'en';

// One chunk per locale (15 §15.3); `manifest.json` is not a locale.
const catalogues = import.meta.glob<{ default: Record<string, string> }>([
    './lang/generated/*.json',
    '!./lang/generated/manifest.json',
]);

// `withApp` is synchronous, so the locale is read from the initial page here
// to load its messages before the app is created.
function initialLocale(): string {
    try {
        const json = document.querySelector(
            'script[data-page="app"][type="application/json"]',
        )?.textContent;
        const page = json
            ? (JSON.parse(json) as { props?: { i18n?: { locale?: unknown } } })
            : null;
        const locale = page?.props?.i18n?.locale;

        return typeof locale === 'string' &&
            `./lang/generated/${locale}.json` in catalogues
            ? locale
            : DEFAULT_LOCALE;
    } catch {
        return DEFAULT_LOCALE;
    }
}

async function loadMessages(locale: string): Promise<Record<string, string>> {
    const load = catalogues[`./lang/generated/${locale}.json`];

    try {
        return load ? (await load()).default : {};
    } catch {
        // A failed chunk load must not stop the app from mounting; it boots with keys.
        return {};
    }
}

const locale = initialLocale();
const messages = await loadMessages(locale);

void createInertiaApp({
    title: (title) => (title ? `${title} - ${appName}` : appName),
    layout: (name) => {
        switch (true) {
            case name === 'Welcome':
                return null;
            case name.startsWith('Auth/'):
                return AuthLayout;
            default:
                return AppLayout;
        }
    },
    withApp: (app) => {
        app.use(createI18n({ locale, messages }));
        app.directive('focus', {
            mounted: (el: HTMLElement, shouldFocus) => {
                if (shouldFocus.value !== false) {
                    el.focus();
                }
            },
        });
    },
    progress: {
        color: '#4B5563',
    },
});

// This will set light / dark mode on page load...
initializeTheme();

// This will listen for flash toast data from the server...
initializeFlashToast();
