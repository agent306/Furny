/**
 * Catalog variants shared by the furniture tests: the seed catalog with a
 * role default unassigned, rows archived or rows deleted (catalog drift).
 * Test-only; not exported from the engine index.
 */
import type { CatalogSnapshot } from '../../catalog/snapshot';
import type { HardwareRoleKey } from '../../catalog/specs';
import { mutateCatalog, seedCatalog } from '../../testing/seedCatalog';

/** `base` with no hardware item flagged as the default of `roleKey`. */
export function withoutDefault(
    roleKey: HardwareRoleKey,
    base: CatalogSnapshot = seedCatalog(),
): CatalogSnapshot {
    return mutateCatalog(base, (draft) => {
        for (const h of draft.hardware) {
            h.isDefaultFor = h.isDefaultFor.filter((k) => k !== roleKey);
        }
    });
}

/**
 * `base` with every material, edge band, hardware item and finish whose code
 * is in `codes` marked inactive (archived: still resolvable by code).
 */
export function archived(
    codes: string | readonly string[],
    base: CatalogSnapshot = seedCatalog(),
): CatalogSnapshot {
    const set = new Set(typeof codes === 'string' ? [codes] : codes);
    return mutateCatalog(base, (draft) => {
        for (const rows of [
            draft.materials,
            draft.edgeBands,
            draft.hardware,
            draft.finishes,
        ]) {
            for (const row of rows) {
                if (set.has(row.code)) row.isActive = false;
            }
        }
    });
}

/** `base` without the hardware rows of `codes` (deleted from the catalog). */
export function withoutHardware(
    codes: string | readonly string[],
    base: CatalogSnapshot = seedCatalog(),
): CatalogSnapshot {
    const set = new Set(typeof codes === 'string' ? [codes] : codes);
    return mutateCatalog(base, (draft) => {
        draft.hardware = draft.hardware.filter((h) => !set.has(h.code));
    });
}
