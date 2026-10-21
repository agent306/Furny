// Setup for the Vitest `app` project (happy-dom, 16 §2).
import { config } from '@vue/test-utils';
import en from '@/lang/generated/en.json';
import { createI18n } from '@/lib/i18n';

// Components under test render real English copy through `t()` / `$t()`.
config.global.plugins = [createI18n({ locale: 'en', messages: en })];

class ResizeObserverStub implements ResizeObserver {
    observe(): void {}

    unobserve(): void {}

    disconnect(): void {}
}

if (!('ResizeObserver' in globalThis)) {
    globalThis.ResizeObserver = ResizeObserverStub;
}

if (typeof window.matchMedia !== 'function') {
    window.matchMedia = (query: string): MediaQueryList => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
    });
}
