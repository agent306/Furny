import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBreakpoint } from '@/composables/useBreakpoint';

type Listener = (event: { matches: boolean }) => void;
type Registration = { query: string; listener: Listener };

let width = 1280;
let listeners: Registration[] = [];

// Evaluates the `(min-width: Npx)` / `(max-width: Npx)` clauses VueUse emits.
function matches(query: string): boolean {
    return [...query.matchAll(/\((min|max)-width:\s*([\d.]+)px\)/g)].every(
        ([, kind, value]) =>
            kind === 'min' ? width >= Number(value) : width <= Number(value),
    );
}

function resizeTo(next: number): void {
    width = next;
    listeners.forEach(({ query, listener }) =>
        listener({ matches: matches(query) }),
    );
}

beforeEach(() => {
    listeners = [];
    vi.stubGlobal(
        'matchMedia',
        vi.fn((query: string) => ({
            media: query,
            get matches() {
                return matches(query);
            },
            addEventListener: (_: string, listener: Listener) => {
                listeners.push({ query, listener });
            },
            removeEventListener: (_: string, listener: Listener) => {
                listeners = listeners.filter(
                    (entry) => entry.listener !== listener,
                );
            },
        })),
    );
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('useBreakpoint (15 §6)', () => {
    it('375 px is a phone: view-only', () => {
        width = 375;
        const bp = useBreakpoint();

        expect(bp.isPhone.value).toBe(true);
        expect(bp.isTablet.value).toBe(false);
        expect(bp.isDesktop.value).toBe(false);
        expect(bp.canEdit.value).toBe(false);
    });

    it('820 px is a tablet: full editing', () => {
        width = 820;
        const bp = useBreakpoint();

        expect(bp.isPhone.value).toBe(false);
        expect(bp.isTablet.value).toBe(true);
        expect(bp.isDesktop.value).toBe(false);
        expect(bp.canEdit.value).toBe(true);
    });

    it('1280 px is a desktop', () => {
        width = 1280;
        const bp = useBreakpoint();

        expect(bp.isPhone.value).toBe(false);
        expect(bp.isTablet.value).toBe(false);
        expect(bp.isDesktop.value).toBe(true);
        expect(bp.canEdit.value).toBe(true);
    });

    it.each([
        [767, 'isPhone'],
        [768, 'isTablet'],
        [1023, 'isTablet'],
        [1024, 'isDesktop'],
    ] as const)('width %i is %s (boundaries)', (value, flag) => {
        width = value;
        const bp = useBreakpoint();

        expect(bp[flag].value).toBe(true);
    });

    it('exactly one of phone, tablet, desktop is true at any width', () => {
        for (const value of [320, 767, 768, 900, 1023, 1024, 1920]) {
            width = value;
            const bp = useBreakpoint();

            expect(
                [bp.isPhone, bp.isTablet, bp.isDesktop].filter(
                    (flag) => flag.value,
                ),
            ).toHaveLength(1);
        }
    });

    it('follows viewport changes', () => {
        width = 1280;
        const bp = useBreakpoint();

        expect(bp.canEdit.value).toBe(true);

        resizeTo(500);

        expect(bp.isPhone.value).toBe(true);
        expect(bp.canEdit.value).toBe(false);
    });
});
