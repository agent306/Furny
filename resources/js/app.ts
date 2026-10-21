import { createInertiaApp } from '@inertiajs/vue3';
import { initializeTheme } from '@/composables/useTheme';
import { resolveLayout } from '@/layouts/resolveLayout';
import { createI18n } from '@/lib/i18n';
import { reloadForStaleI18n } from '@/lib/i18nBoot';
import manifest from './lang/generated/manifest.json';
import type { SharedPageProps } from './types/inertia';

const DEFAULT_LOCALE = 'en';

// One chunk per locale (15 §15.3); `manifest.json` is not a locale.
const catalogues = import.meta.glob<{ default: Record<string, string> }>([
    './lang/generated/*.json',
    '!./lang/generated/manifest.json',
]);

// `withApp` is synchronous, so the locale is read from the initial page here
// to load its messages before the app is created.
function initialI18n(): { locale: string; hash: string | undefined } {
    try {
        const json = document.querySelector(
            'script[data-page="app"][type="application/json"]',
        )?.textContent;
        const page = json
            ? (JSON.parse(json) as {
                  props?: { i18n?: { locale?: unknown; hash?: unknown } };
              })
            : null;
        const { locale, hash } = page?.props?.i18n ?? {};

        return {
            locale:
                typeof locale === 'string' &&
                `./lang/generated/${locale}.json` in catalogues
                    ? locale
                    : DEFAULT_LOCALE,
            hash: typeof hash === 'string' ? hash : undefined,
        };
    } catch {
        return { locale: DEFAULT_LOCALE, hash: undefined };
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

// A stale chunk after a deploy: reload to get the new bundle (01 §6).
window.addEventListener('vite:preloadError', () => window.location.reload());

const bundledHashes: Record<string, string | undefined> = manifest;
const { locale, hash } = initialI18n();

// The catalogue baked into this bundle is older than the server's: reload once
// (a second mismatch in the same tab is left alone, never a reload loop).
reloadForStaleI18n(bundledHashes[locale], hash);

const messages = await loadMessages(locale);

void createInertiaApp({
    // `{page title} · {app name}` (15 §14 item 4); the name is the shared `app.name`, never a literal.
    title: (title, page) => {
        const appName =
            (page.props as Partial<SharedPageProps>).app?.name ?? '';

        return title ? `${title} · ${appName}` : appName;
    },
    layout: (name, page) =>
        resolveLayout(
            name,
            (page.props as Partial<SharedPageProps>).auth?.user,
        ),
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
    // 15 §10.4: the primary colour, shown after 250 ms.
    progress: {
        color: 'var(--primary)',
        delay: 250,
    },
});

// This will set light / dark mode on page load...
initializeTheme();
