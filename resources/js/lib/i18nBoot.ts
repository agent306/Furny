// Stale-bundle guards (01 §6, 15 §15.3). After a deploy a tab can run old JS
// against new server props: a catalogue whose hash differs from the one the
// server announces (`i18n.hash`), or a chunk that no longer exists
// (`vite:preloadError`). Both are fixed by one full reload.

/** `sessionStorage` key remembering that this tab already reloaded once for a stale catalogue. */
export const I18N_RELOADED_KEY = 'fs:i18n-reloaded';

/** Whether a tab with the `bundled` catalogue hash must reload for the `server` hash. At most once. */
export function shouldReloadForHash(
    bundled: string,
    server: string,
    alreadyReloaded: boolean,
): boolean {
    return bundled !== server && !alreadyReloaded;
}

export type ReloadDeps = {
    storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
    reload: () => void;
};

/**
 * Reloads once when the bundled catalogue hash is not the server's. Returns
 * whether it reloaded. The flag is cleared once the hashes match so the next
 * deploy can reload again. Without a usable `sessionStorage` it never reloads:
 * it could not remember having done so and would loop.
 */
export function reloadForStaleI18n(
    bundled: string | undefined,
    server: string | undefined,
    deps?: ReloadDeps,
): boolean {
    if (bundled === undefined || server === undefined) {
        return false;
    }

    let reload: () => void;

    try {
        // Reading `window.sessionStorage` itself throws when site data is blocked.
        const { storage, reload: reloadPage } = deps ?? {
            storage: window.sessionStorage,
            reload: () => window.location.reload(),
        };
        const alreadyReloaded = storage.getItem(I18N_RELOADED_KEY) !== null;

        if (bundled === server) {
            if (alreadyReloaded) {
                storage.removeItem(I18N_RELOADED_KEY);
            }

            return false;
        }

        if (!shouldReloadForHash(bundled, server, alreadyReloaded)) {
            return false;
        }

        storage.setItem(I18N_RELOADED_KEY, '1');
        reload = reloadPage;
    } catch {
        return false;
    }

    reload();

    return true;
}
