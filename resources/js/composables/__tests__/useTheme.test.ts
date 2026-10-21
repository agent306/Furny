import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, watch } from 'vue';

type Listener = (event: { matches: boolean }) => void;

let systemDark = false;
let listeners: Listener[] = [];
let cookieWrites: string[] = [];
let cookieHeader = '';

function mockMatchMedia(): void {
    vi.stubGlobal(
        'matchMedia',
        vi.fn((query: string) => ({
            media: query,
            get matches() {
                return systemDark;
            },
            addEventListener: (_: string, listener: Listener) => {
                listeners.push(listener);
            },
            removeEventListener: (_: string, listener: Listener) => {
                listeners = listeners.filter((entry) => entry !== listener);
            },
        })),
    );
}

function setSystemDark(value: boolean): void {
    systemDark = value;
    listeners.forEach((listener) => listener({ matches: value }));
}

// Each test gets a fresh module: the composable keeps module-level state.
async function loadTheme() {
    vi.resetModules();

    return (await import('@/composables/useTheme')).useTheme();
}

const html = () => document.documentElement;
const themeColor = () =>
    document.head
        .querySelector('meta[name="theme-color"]')
        ?.getAttribute('content');

beforeEach(() => {
    systemDark = false;
    listeners = [];
    cookieWrites = [];
    cookieHeader = '';
    html().className = '';
    document.head.innerHTML = '<meta name="theme-color" content="#fbfaf7">';
    localStorage.clear();
    mockMatchMedia();
    Object.defineProperty(document, 'cookie', {
        configurable: true,
        get: () => cookieHeader,
        set: (value: string) => {
            cookieWrites.push(value);
        },
    });
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Reflect.deleteProperty(document, 'cookie');
});

describe('useTheme', () => {
    it('defaults to system and resolves it from the media query', async () => {
        systemDark = true;
        const theme = await loadTheme();

        expect(theme.appearance.value).toBe('system');
        expect(theme.resolved.value).toBe('dark');
        expect(html().classList.contains('dark')).toBe(true);
    });

    it('setAppearance("dark") adds the class, stores localStorage and a one-year Lax cookie', async () => {
        const theme = await loadTheme();

        theme.setAppearance('dark');

        expect(html().classList.contains('dark')).toBe(true);
        expect(theme.appearance.value).toBe('dark');
        expect(theme.resolved.value).toBe('dark');
        expect(localStorage.getItem('fs:appearance')).toBe('dark');
        expect(cookieWrites).toHaveLength(1);

        const cookie = cookieWrites[0]?.toLowerCase() ?? '';
        expect(cookie).toContain('appearance=dark');
        expect(cookie).toContain('max-age=31536000');
        expect(cookie).toContain('samesite=lax');
        expect(cookie).toContain('path=/');
        // happy-dom serves http://localhost: Secure is for https only.
        expect(cookie).not.toContain('secure');
    });

    it('setAppearance("light") removes the class', async () => {
        html().classList.add('dark');
        const theme = await loadTheme();

        theme.setAppearance('light');

        expect(html().classList.contains('dark')).toBe(false);
        expect(theme.resolved.value).toBe('light');
    });

    it('marks the cookie Secure on https', async () => {
        vi.spyOn(window, 'location', 'get').mockReturnValue({
            protocol: 'https:',
        } as Location);
        const theme = await loadTheme();

        theme.setAppearance('dark');

        expect(cookieWrites[0]?.toLowerCase()).toContain('secure');
    });

    it('updates the theme-color meta to the resolved background', async () => {
        const theme = await loadTheme();

        theme.setAppearance('dark');
        expect(themeColor()).toBe('#1d1a17');

        theme.setAppearance('light');
        expect(themeColor()).toBe('#fbfaf7');
    });

    it('creates the theme-color meta when the page has none', async () => {
        document.head.innerHTML = '';
        const theme = await loadTheme();

        theme.setAppearance('dark');

        expect(themeColor()).toBe('#1d1a17');
    });

    it('system follows prefers-color-scheme changes', async () => {
        const theme = await loadTheme();
        theme.setAppearance('system');

        expect(theme.resolved.value).toBe('light');

        setSystemDark(true);
        await nextTick();
        expect(theme.resolved.value).toBe('dark');
        expect(html().classList.contains('dark')).toBe(true);
        expect(themeColor()).toBe('#1d1a17');

        setSystemDark(false);
        await nextTick();
        expect(theme.resolved.value).toBe('light');
        expect(html().classList.contains('dark')).toBe(false);
    });

    it('ignores media query changes while an explicit appearance is set', async () => {
        const theme = await loadTheme();
        theme.setAppearance('light');

        setSystemDark(true);

        expect(theme.resolved.value).toBe('light');
        expect(html().classList.contains('dark')).toBe(false);
    });

    it('restores the stored appearance on load', async () => {
        localStorage.setItem('fs:appearance', 'dark');
        const theme = await loadTheme();

        expect(theme.appearance.value).toBe('dark');
        expect(html().classList.contains('dark')).toBe(true);
    });

    it('ignores a stored value outside light, dark and system', async () => {
        localStorage.setItem('fs:appearance', '"><script>');
        const theme = await loadTheme();

        expect(theme.appearance.value).toBe('system');
    });

    it('does not break when localStorage throws', async () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('denied');
        });
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('denied');
        });
        const theme = await loadTheme();

        expect(theme.appearance.value).toBe('system');
        expect(() => theme.setAppearance('dark')).not.toThrow();
        expect(theme.appearance.value).toBe('dark');
        expect(html().classList.contains('dark')).toBe(true);
        expect(cookieWrites[0]).toContain('appearance=dark');
    });

    it('does not break when writing the cookie throws', async () => {
        Object.defineProperty(document, 'cookie', {
            configurable: true,
            get: () => '',
            set: () => {
                throw new Error('blocked');
            },
        });
        const theme = await loadTheme();

        expect(() => theme.setAppearance('dark')).not.toThrow();
        expect(html().classList.contains('dark')).toBe(true);
    });

    it('rejects values outside the allow-list', async () => {
        const theme = await loadTheme();

        // @ts-expect-error deliberately invalid
        theme.setAppearance('sepia');

        expect(theme.appearance.value).toBe('system');
        expect(cookieWrites).toEqual([]);
    });
});

describe('useTheme leftovers (Task 16 review)', () => {
    it('rewrites the cookie when the stored value differs (sliding refresh after expiry)', async () => {
        localStorage.setItem('fs:appearance', 'dark');
        cookieHeader = '';

        await loadTheme();

        expect(cookieWrites).toHaveLength(1);
        expect(cookieWrites[0]?.toLowerCase()).toContain('appearance=dark');
        expect(cookieWrites[0]?.toLowerCase()).toContain('max-age=31536000');
    });

    it('rewrites a cookie that holds a different value than the stored one', async () => {
        localStorage.setItem('fs:appearance', 'dark');
        cookieHeader = 'theme=x; appearance=light';

        await loadTheme();

        expect(cookieWrites).toHaveLength(1);
        expect(cookieWrites[0]?.toLowerCase()).toContain('appearance=dark');
    });

    it('leaves a matching cookie alone', async () => {
        localStorage.setItem('fs:appearance', 'dark');
        cookieHeader = 'appearance=dark';

        await loadTheme();

        expect(cookieWrites).toEqual([]);
    });

    it('does not write a cookie when nothing is stored', async () => {
        cookieHeader = 'appearance=dark';

        const theme = await loadTheme();

        expect(theme.appearance.value).toBe('dark');
        expect(cookieWrites).toEqual([]);
    });

    it('toggles the dark class before it publishes the resolved theme', async () => {
        const theme = await loadTheme();
        const seen: boolean[] = [];

        watch(
            theme.resolved,
            () => seen.push(html().classList.contains('dark')),
            { flush: 'sync' },
        );

        theme.setAppearance('dark');
        theme.setAppearance('light');

        // A reader of `resolved` (e.g. readEditorColors) must already see the new class.
        expect(seen).toEqual([true, false]);
    });
});
