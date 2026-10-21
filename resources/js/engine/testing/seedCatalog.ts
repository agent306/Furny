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
    type CatalogSnapshot,
    type PricingSettings,
} from '../catalog/snapshot';
import type { Draft } from 'mutative';

/** A fresh, schema-parsed copy of the seed catalog on every call. */
export function seedCatalog(patch?: {
    pricing?: Partial<PricingSettings>;
}): CatalogSnapshot {
    const parsed = CatalogSnapshotSchema.parse(seedJson);
    return patch?.pricing
        ? { ...parsed, pricing: { ...parsed.pricing, ...patch.pricing } }
        : parsed;
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
