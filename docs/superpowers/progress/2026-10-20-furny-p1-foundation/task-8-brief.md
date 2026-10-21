### Task 8: Catalog schema, catalog-version observer, tax and catalog seeders

**Files:**
- Create: migrations `2026_10_20_050000_create_materials_table` … `_050500_create_tax_rates_table` (`materials, edge_bands, hardware_items, finishes, labour_rates, tax_rates`); `app/Domain/Catalog/Models/{Material,EdgeBand,HardwareItem,Finish,LabourRate,TaxRate}.php`; `app/Domain/Catalog/Enums/{BoardType,MaterialSurface,HardwareCategory,HardwareUnit,FinishType,LabourUnit}.php`; `app/Domain/Catalog/Observers/BumpCatalogVersion.php`; factories for the six models; `database/seeders/{TaxRatesSeeder,CatalogSeeder}.php`; `database/seeders/data/catalog.php`
- Modify: `MorphMap`
- Test: `tests/Feature/Schema/CatalogSchemaTest.php`, `tests/Feature/Catalog/CatalogVersionBumpTest.php`, `tests/Feature/Seeders/TaxRatesSeederTest.php`, `tests/Feature/Seeders/CatalogSeederTest.php`

**Spec refs:** `02 §6` (all tables + bump rule), `§10` (texture/image collections), `§14` items 3–4; `01 §5.3`; `08 §7.1–§7.6`

**Interfaces:**
- Consumes: Task 6 `CatalogVersion`, `Settings`.
- Produces: six models (SoftDeletes on materials, edge bands, hardware, finishes); casts `usage/specs/is_default_for/applies_to: array`, `thickness_mm` decimal strings, enums; media `Material.texture`/`Finish.texture` (`s3-public`, jpg/webp, conversion `small` 256²), `HardwareItem.image` (`s3-public`, `thumb` 256²); observer `BumpCatalogVersion` attached to all six (`saved`, `deleted`, `restored`, `forceDeleted`) with static `BumpCatalogVersion::muted(callable $fn): mixed`; enums `BoardType` (9 values of `02 §6.1`), `MaterialSurface` (7), `HardwareCategory` (21), `HardwareUnit` (`piece, pair, set, meter, pack`), `FinishType` (8), `LabourUnit` (`sheet, meter, part, piece, item, sqm, hour`); seeders `TaxRatesSeeder`, `CatalogSeeder` (overwrite only when env `FORCE_CATALOG_SEED=true`).

- [ ] **Step 1: Write the failing tests**
  - `CatalogSchemaTest`: columns per `02 §6.1–§6.6`; unique `code` on materials/edge bands/hardware/finishes, unique `key` on labour rates; partial unique `tax_rates(is_default) WHERE is_default`; defaults `waste_factor 0.100`, `surface 'melamine'`, `usage '["carcass","shelf","front","back","top"]'`, `is_default_for '[]'`.
  - `CatalogVersionBumpTest`: dataset over the six factories — creating, updating, soft-deleting and restoring each bumps `Settings::catalogVersion()` by exactly 1 per write; a create inside a rolled-back transaction leaves the version unchanged.
  - `TaxRatesSeederTest`: rows `GST 18%` 1800 default, `GST 12%` 1200, `GST 5%` 500, `No tax 0%` 0; idempotent; sets `pricing.default_tax_rate_id` to the GST 18% id when null and leaves a non-null value alone.
  - `CatalogSeederTest`: counts 12 materials, 8 edge bands, 40 hardware items, 6 finishes, 14 labour rates; spot values: `PB18-OAK` (`has_grain true`, `price_per_sheet_minor 265000`, `waste_factor '0.120'`, `default_edge_band_code 'EB08-OAK'`, `sort_order 20`), `GLASS5-CLEAR` (`board_type 'glass'`, `sheet_width_mm 1830`, `usage ['glass']`), `EB10-WHITE-28` (`thickness_mm '1.00'`, `width_mm 28`, `price_per_meter_minor 1000`), `HNG-FO-SC` (`price_minor 12000`, `specs.overlay 'full'`, `is_default_for ['hinge.full_overlay']`), `SLD-BB-600` (`unit 'pair'`, `price_minor 65000`, `specs.lengthMm 600`), `SLD-UM-450` (`is_default_for ['slide.undermount']`), `LED-STRIP-12V` (`unit 'meter'`), `FIN-PU-GLOSS` (`price_per_sqm_minor 160000`, `applies_to ['mdf']`), `installation_per_item` (`rate_minor 150000`, `unit 'item'`); hardware `sort_order` = row × 10 (first 10, last 400); every `is_default_for` key occurs once across hardware; second run keeps counts, keeps an edited price, bumps `catalog.version` exactly once per run.
- [ ] **Step 2: Run, expect FAIL** — `vendor/bin/pest tests/Feature/Schema/CatalogSchemaTest.php tests/Feature/Catalog tests/Feature/Seeders`
- [ ] **Step 3: Implement** — rows transcribed from `08 §7.1–§7.5` into `database/seeders/data/catalog.php` (rupees × 100 into `*_minor`); `CatalogSeeder` writes inside `BumpCatalogVersion::muted()` then calls `CatalogVersion::bump()` once and prints the console warning "Review the starter catalog prices".
- [ ] **Step 4: Run tests, expect PASS** — same as Step 2.
- [ ] **Step 5: Quality gates** — Gates-PHP, Gates-Gen.
- [ ] **Step 6: Commit** — `git add database/migrations app/Domain/Catalog database/factories database/seeders app/Support/MorphMap.php tests resources/js` → `feat(catalog): catalog schema, version bump observer and starter seed data` + trailer.

