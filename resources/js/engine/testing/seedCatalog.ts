/**
 * Test helpers around the seed catalog (08 §7). The data lives in
 * `tests/fixtures/catalog/seed-snapshot.json`, the single source that the
 * database seeder reuses; this module only loads, patches and mutates it.
 * Test-only: not exported from the engine index.
 */
import { create } from 'mutative';
import seedJson from '../../../../tests/fixtures/catalog/seed-snapshot.json';
import {
    CatalogSnapshotSchema,
    PricingSettingsSchema,
    type CatalogSnapshot,
    type PricingSettings,
} from '../catalog/snapshot';
import type { Draft } from 'mutative';

function deepFreeze<T>(value: T): T {
    if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
        return value;
    }
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
    return value;
}

let base: CatalogSnapshot | undefined;

/**
 * The seed catalog, parsed once and deep-frozen, so it is safe to index and to
 * share; use `mutateCatalog` for variants. A `pricing` patch is validated by
 * `PricingSettingsSchema` and yields a new frozen snapshot sharing the rest.
 */
export function seedCatalog(patch?: {
    pricing?: Partial<PricingSettings>;
}): CatalogSnapshot {
    base ??= deepFreeze(CatalogSnapshotSchema.parse(seedJson));
    if (!patch?.pricing) return base;
    return deepFreeze({
        ...base,
        pricing: PricingSettingsSchema.parse({
            ...base.pricing,
            ...patch.pricing,
        }),
    });
}

/**
 * Applies `recipe` to a mutative draft of `base` and returns the new snapshot
 * (deep-frozen); `base` is not modified and untouched branches are shared.
 */
export function mutateCatalog(
    base: CatalogSnapshot,
    recipe: (draft: Draft<CatalogSnapshot>) => void,
): CatalogSnapshot {
    // mutative types a frozen result as deeply readonly; callers treat it as a CatalogSnapshot
    return create(base, recipe, { enableAutoFreeze: true }) as CatalogSnapshot;
}
