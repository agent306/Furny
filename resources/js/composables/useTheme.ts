import type { Ref } from 'vue';
import { ref } from 'vue';
import { applyThemeColor } from '@/lib/theme/meta';
import type { Appearance, ResolvedAppearance } from '@/types';

export type { Appearance, ResolvedAppearance };

export type UseThemeReturn = {
    appearance: Ref<Appearance>;
    resolved: Ref<ResolvedAppearance>;
    setAppearance: (value: Appearance) => void;
};

// Appearance is a device-level preference (15 §11): localStorage for the
// client, a plain cookie so `app.blade.php` can render the class server-side.
const STORAGE_KEY = 'fs:appearance';
const COOKIE_NAME = 'appearance';
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60;
const DARK_QUERY = '(prefers-color-scheme: dark)';

const APPEARANCES: readonly Appearance[] = ['light', 'dark', 'system'];

function isAppearance(value: unknown): value is Appearance {
    return APPEARANCES.includes(value as Appearance);
}

const appearance = ref<Appearance>('system');
const resolved = ref<ResolvedAppearance>('light');
let initialised = false;

function systemPrefersDark(): boolean {
    try {
        return window.matchMedia(DARK_QUERY).matches;
    } catch {
        return false;
    }
}

function readStored(): Appearance | null {
    try {
        const value = localStorage.getItem(STORAGE_KEY);

        return isAppearance(value) ? value : null;
    } catch {
        return null;
    }
}

function readCookie(): Appearance | null {
    try {
        const match = new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]*)`).exec(
            document.cookie,
        );

        return isAppearance(match?.[1]) ? match[1] : null;
    } catch {
        return null;
    }
}

function writeStored(value: Appearance): void {
    try {
        localStorage.setItem(STORAGE_KEY, value);
    } catch {
        // Private mode or blocked storage: the cookie still carries the choice.
    }
}

function writeCookie(value: Appearance): void {
    try {
        const secure = window.location.protocol === 'https:' ? ';Secure' : '';

        document.cookie = `${COOKIE_NAME}=${value};path=/;max-age=${COOKIE_MAX_AGE};SameSite=Lax${secure}`;
    } catch {
        // Cookies blocked: the choice only lasts as long as localStorage.
    }
}

function applyToDocument(): void {
    const next: ResolvedAppearance =
        appearance.value === 'system'
            ? systemPrefersDark()
                ? 'dark'
                : 'light'
            : appearance.value;

    // Class first: anything reacting to `resolved` (e.g. readEditorColors)
    // must already see the new theme's CSS variables.
    document.documentElement.classList.toggle('dark', next === 'dark');
    resolved.value = next;
    applyThemeColor(next);
}

function initialise(): void {
    if (initialised || typeof window === 'undefined') {
        return;
    }

    initialised = true;

    const stored = readStored();
    const cookie = readCookie();

    appearance.value = stored ?? cookie ?? 'system';

    // The cookie is what the server renders from (app.blade.php) and it
    // expires; refresh it from localStorage so an explicit `dark` does not
    // flash light on the first load after expiry.
    if (stored !== null && stored !== cookie) {
        writeCookie(stored);
    }

    applyToDocument();

    try {
        window.matchMedia(DARK_QUERY).addEventListener('change', () => {
            if (appearance.value === 'system') {
                applyToDocument();
            }
        });
    } catch {
        // No matchMedia: `system` is resolved once, on load.
    }
}

function setAppearance(value: Appearance): void {
    if (!isAppearance(value)) {
        return;
    }

    initialise();
    appearance.value = value;
    writeStored(value);
    writeCookie(value);
    applyToDocument();
}

/** Applies the saved appearance on page load and starts following the OS setting. */
export function initializeTheme(): void {
    initialise();
}

export function useTheme(): UseThemeReturn {
    initialise();

    return { appearance, resolved, setAppearance };
}
