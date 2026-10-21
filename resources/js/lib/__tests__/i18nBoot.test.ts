import { describe, expect, it, vi } from 'vitest';
import {
    I18N_RELOADED_KEY,
    reloadForStaleI18n,
    shouldReloadForHash,
} from '@/lib/i18nBoot';
import type { ReloadDeps } from '@/lib/i18nBoot';

describe('shouldReloadForHash', () => {
    it('reloads when the bundled and the server hash differ', () => {
        expect(shouldReloadForHash('a', 'b', false)).toBe(true);
    });

    it('does not reload when the hashes match', () => {
        expect(shouldReloadForHash('a', 'a', false)).toBe(false);
    });

    it('reloads at most once', () => {
        expect(shouldReloadForHash('a', 'b', true)).toBe(false);
    });
});

function deps(initial: Record<string, string> = {}): {
    deps: ReloadDeps;
    store: Record<string, string>;
    reload: ReturnType<typeof vi.fn>;
} {
    const store = { ...initial };
    const reload = vi.fn();

    return {
        store,
        reload,
        deps: {
            storage: {
                getItem: (key) => store[key] ?? null,
                setItem: (key, value) => {
                    store[key] = value;
                },
                removeItem: (key) => {
                    delete store[key];
                },
            },
            reload,
        },
    };
}

describe('reloadForStaleI18n', () => {
    it('remembers the reload in sessionStorage and reloads once on a stale hash', () => {
        const { deps: d, store, reload } = deps();

        expect(reloadForStaleI18n('old', 'new', d)).toBe(true);
        expect(reload).toHaveBeenCalledTimes(1);
        expect(store[I18N_RELOADED_KEY]).toBe('1');
        expect(I18N_RELOADED_KEY).toBe('fs:i18n-reloaded');
    });

    it('does not loop when the hash is still stale after the reload', () => {
        const { deps: d, reload } = deps({ [I18N_RELOADED_KEY]: '1' });

        expect(reloadForStaleI18n('old', 'new', d)).toBe(false);
        expect(reload).not.toHaveBeenCalled();
    });

    it('clears the flag once the hashes match, so the next deploy can reload again', () => {
        const { deps: d, store, reload } = deps({ [I18N_RELOADED_KEY]: '1' });

        expect(reloadForStaleI18n('same', 'same', d)).toBe(false);
        expect(store[I18N_RELOADED_KEY]).toBeUndefined();
        expect(reload).not.toHaveBeenCalled();
    });

    it('does nothing without a server hash or a bundled hash', () => {
        const { deps: d, reload } = deps();

        expect(reloadForStaleI18n('old', undefined, d)).toBe(false);
        expect(reloadForStaleI18n(undefined, 'new', d)).toBe(false);
        expect(reload).not.toHaveBeenCalled();
    });

    it('survives unavailable storage (treated as not yet reloaded, reloads)', () => {
        const reload = vi.fn();
        const broken: ReloadDeps = {
            reload,
            storage: {
                getItem: () => {
                    throw new Error('blocked');
                },
                setItem: () => {
                    throw new Error('blocked');
                },
                removeItem: () => {
                    throw new Error('blocked');
                },
            },
        };

        expect(reloadForStaleI18n('old', 'new', broken)).toBe(false);
        expect(reload).not.toHaveBeenCalled();
    });
});
