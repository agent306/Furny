// Setup for the Vitest `app` project (happy-dom, 16 §2). The i18n install
// with the generated `en` messages is added together with the i18n layer.

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
