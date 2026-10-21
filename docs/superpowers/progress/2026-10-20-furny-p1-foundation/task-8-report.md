# Task 8 report: catalog schema, version-bump observer, tax and catalog seeders

Commit: 1e68685 `feat(catalog): catalog schema, version bump observer and starter seed data` (base 3ed2cf9). Worktree /home/user/furny-p1.

## Implemented
- Migrations 050000..050500 (materials, edge_bands, hardware_items, finishes, labour_rates, tax_rates) per 02 §6.1-§6.6. `tax_rates_is_default_unique` is a partial unique index `WHERE is_default`. Money columns default 0 (02 §0 convention; §6 tables list no default).
- Enums BoardType(9), MaterialSurface(7), HardwareCategory(21), HardwareUnit(5), FinishType(8), LabourUnit(7), all `#[TypeScript]` (generated.d.ts regenerated and committed).
- Six models (HasUlids; SoftDeletes on materials/edge bands/hardware/finishes; CarbonImmutable docblocks; immutable_datetime casts; `thickness_mm` decimal:1 / decimal:2, `waste_factor` decimal:3; array casts for usage/is_default_for/applies_to). `HardwareItem.specs` uses an Attribute mutator so an empty spec set is stored as `{}` (never `[]`). Media: Material/Finish `texture`, HardwareItem `image` (s3-public, single file, 256x256 crop conversions `small`/`thumb`). All six added to `MorphMap::MAP` (material, edge_band, hardware_item, finish, labour_rate, tax_rate).
- `BumpCatalogVersion` observer (`#[ObservedBy]` on all six): `saved`, `deleted`, `restored`, `forceDeleted` + static `muted(callable): mixed` (nest-safe, try/finally). Eloquent double-fires two pairs, so exactly one of each bumps: `restore()` fires `saved` then `restored` (a WeakMap flag set in `restoring` suppresses the `saved` bump); `forceDelete()` fires `deleted` then `forceDeleted` (`deleted` skips when `isForceDeleting()`). Result: exactly +1 per write for create/update/delete/restore/forceDelete.
- Caveat ruling (cache poisoning): the observer only calls `CatalogVersion::bump()` (INSERT..ON CONFLICT .. RETURNING plus `DB::afterCommit` cache forget); it never calls `Settings::catalogVersion()` or touches the cache, so nothing is cached inside an uncommitted transaction. The seeders do not read Settings inside their transactions either: TaxRatesSeeder reads/writes `pricing` only after its transaction commits. Tests: cold cache + rolled-back create leaves `Cache::has('settings:catalog.version')` false inside and after the rollback and `catalogVersion()` unchanged; commit busts a warm cache.
- Factories (database/factories/Domain/Catalog) for the six models with states (inactive, withGrain, glass, defaultFor, default).
- `database/seeders/data/catalog.php`: 12 materials, 8 edge bands, 40 hardware rows (explicit rows, generated from 08 §7.3 and checked: 28 default keys, each once), 6 finishes, 14 labour rates; prices x100 in `*_minor`. Hardware `sort_order` = row x 10 assigned by the seeder.
- `TaxRatesSeeder`: firstOrCreate by name (rows never modified; will not claim `is_default` when another default exists), one muted bump only when something was created, sets `pricing.default_tax_rate_id` to GST 18% only when null.
- `CatalogSeeder`: single transaction, writes inside `BumpCatalogVersion::muted()`, then `CatalogVersion::bump()` once per run, prints warning "Review the starter catalog prices ...". Existing rows (including soft-deleted/archived) untouched unless `FORCE_CATALOG_SEED=true` (read with `Illuminate\Support\Env::get`, not `env()`, because larastan forbids env() outside config and Env::get still sees real process env under a cached config); force mode resets values and un-archives.

## Tests (all new, 4 required files plus CatalogModelsTest)
- tests/Feature/Schema/CatalogSchemaTest.php, tests/Feature/Catalog/CatalogVersionBumpTest.php, tests/Feature/Seeders/TaxRatesSeederTest.php, tests/Feature/Seeders/CatalogSeederTest.php, tests/Feature/Models/CatalogModelsTest.php.
- Per C2 ruling the bump and seeder tests clear the rows they assert on and seed `catalog.version` explicitly (no reliance on baseline seeding).

### TDD evidence
- RED: implementation (models, observer, factories, migrations, seeders) moved aside, `vendor/bin/pest tests/Feature/Schema/CatalogSchemaTest.php tests/Feature/Catalog tests/Feature/Seeders` -> failures: `Class "App\Domain\Catalog\Models\Material" not found`, `relation "materials" does not exist` (expected: nothing implemented). Note: tests and implementation were authored in one pass, RED was demonstrated afterwards by removing the implementation.
- GREEN: same command after restoring -> `Tests: 76 passed (399 assertions)`.
- Full gate: `vendor/bin/pint --test` passed; `vendor/bin/phpstan analyse` `[OK] No errors`; `vendor/bin/pest tests/Unit tests/Feature` -> `361 passed (1973 assertions)`; `php artisan typescript:transform && php artisan i18n:export` produced only the Catalog enum types (committed; no i18n diff).

## Files
app/Domain/Catalog/{Enums (6), Models (6), Observers/BumpCatalogVersion.php}; app/Support/MorphMap.php; database/migrations/2026_10_20_05{00..05}00_*; database/factories/Domain/Catalog/* (6); database/seeders/{TaxRatesSeeder,CatalogSeeder}.php; database/seeders/data/catalog.php; resources/js/types/generated.d.ts; tests listed above.

## Notes / concerns
- DatabaseSeeder is untouched (still the scaffold User factory); wiring TaxRatesSeeder/CatalogSeeder into it belongs to the task that builds the full seeder chain (Task 13 per C2).
- Uniqueness of `is_default_for` keys across hardware (Upsert action) and the seed_reviewed flag are out of scope here (later catalog admin tasks); `tax_rates.name` is not unique per spec, the seeder matches on name.
- Known edge: `restoring` flag is cleared in `restored`; if a restore's save is aborted (returns false) the flag stays on that model instance until it is garbage collected.
- A no-op `save()` on an unchanged model still bumps (Eloquent fires `saved`); harmless (cache invalidation only).
