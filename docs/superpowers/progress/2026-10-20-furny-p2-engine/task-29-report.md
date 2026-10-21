# Task 29 report: catalog snapshot, hardware specs, seed catalog, CatalogIndex

Status: DONE (with notes below)

## Implemented
- `engine/catalog/snapshot.ts`: enum const arrays + types (BoardType, Surface, HardwareCategory, FinishType, LabourUnit, LabourKey (14), HardwareUnit, SheetBillingMode, MaterialRole/MATERIAL_ROLES), per-row schemas, `PricingSettingsSchema`, `CatalogSnapshotSchema` (zod object, strips unknown keys). Hardware rows are parsed through the category spec schema in a transform; spec errors surface at `hardware.N.specs.<field>`.
- `engine/catalog/specs.ts`: `HARDWARE_SPEC_SCHEMAS` (21 categories, `z.looseObject` = zod 4 `.passthrough()`), `parseHardwareSpecs(category, specs)` (returns zod safeParse result), `HARDWARE_ROLE_KEYS` (28) + `HardwareRoleKey`. Documented defaults applied at parse: hinge cup 35 / boring 4 / integratedPlate false, handle holeCount 2, knob holeCount 1, rod maxLengthMm 1200, slide geometry by type (side_mount clearance 12.7; undermount 42/10/13/16).
- `engine/furniture/catalogIndex.ts`: `CatalogIndex`, `indexCatalog` (WeakMap-memoised); `engine/furniture/rules/weight.ts`: `DEFAULT_DENSITY` only (partWeightKg is not in this brief).
- `tests/fixtures/catalog/seed-snapshot.json`: 12/8/40/6/14/4 rows, ids `seed-<code|key>`, tax ids `seed-tax-*`, prices rupees x 100, hardware `sortOrder` = expanded 08 §7.3 row number x 10, arrays in 08 §2.1 sort order. Generated once by a throwaway script (scratchpad), not committed; the JSON is the source of truth.
- `engine/testing/seedCatalog.ts`: `seedCatalog(patch?)` (imports the JSON, parses with the schema, fresh copy per call), `mutateCatalog(base, recipe)` (mutative `create`, autoFreeze on).
- `engine/index.ts`: exports catalog schemas/types, specs, `indexCatalog`, `CatalogIndex`, `DEFAULT_DENSITY`. `seedCatalog` is test-only and not exported (like `testIds`).

## Tests / TDD
- RED: `yarn vitest run resources/js/engine/catalog resources/js/engine/furniture/__tests__/catalogIndex.test.ts` failed with "Failed to load url ../../catalog/specs" (modules absent), 2 files failed, 0 tests.
- GREEN: same command, 2 files / 49 tests passing. Full `yarn vitest run resources/js/engine`: 58 files, 2170 tests passing (includes engine purity test over the new files).
- Gates: eslint, prettier --check (engine + tests/fixtures/catalog), vue-tsc all clean.
- Covers 16 §7.1 / C16 "hinge without overlay is rejected".

## Spec conflicts / observations
- 07 §6.11 vs 08 §7.3 role keys: NO conflicts. All 28 keys appear exactly once in 08 §7.3 with matching categories (anti_tip.default -> BRK-ANTITIP wall_bracket; basket.default -> BSK-PULL-600 category other). HDL-BAR-320 and DMP-PUSH carry no key, as in 08.
- 08 §7.1 colour hex values are upper-case (`#F4F4F2`); 11/14 say admin-entered hex is stored lower-case. Seed keeps 08 §7 verbatim (schema accepts both cases). The future PHP generator (C13) must emit the same bytes.
- 08 §2.1 types `HardwareSpecs` without defining it; I defined it as `Record<string, unknown>` plus per-category `HardwareSpecsOf<C>`.
- Spec defaults vs. consumer: the spec lists "(35)", "default 4", etc. in 08 §2.3; I apply them in the schema so consumers read concrete values. HNG-HO-SC / HNG-IN-SC therefore gain `integratedPlate: false` after parsing (JSON stays verbatim to 08 §7.3).

## Notes for later tasks
- `MaterialRole`/`MATERIAL_ROLES` are defined in `catalog/snapshot.ts` (needed now by `defaultMaterialFor`). Task 30 (`furniture/schema.ts`, which the plan lists as producing `MaterialRole`) should re-export these rather than redefine them.
- `CatalogSnapshotSchema` does not re-sort arrays; the index sorts itself. `mutateCatalog` does not re-sort after the recipe either.
- The index is memoised per snapshot object identity; `mutateCatalog` results are frozen, so mutating a snapshot after indexing is unsupported.

## Files
resources/js/engine/catalog/{snapshot.ts,specs.ts,__tests__/snapshot.test.ts}, resources/js/engine/furniture/{catalogIndex.ts,rules/weight.ts,__tests__/catalogIndex.test.ts}, resources/js/engine/testing/seedCatalog.ts, resources/js/engine/index.ts, tests/fixtures/catalog/seed-snapshot.json

## Fix round 1
Changes:
- A. Hex colours: all 21 colours in `seed-snapshot.json` lower-cased; `ColorHex` in `snapshot.ts` now transforms any valid input to lower case. Tests: upper-case input parses to lower case, bad hex still rejected, every seed colour is lower-case. (Supersedes the earlier "hex kept upper-case" note.)
- B1. Regression guard: `catalog/__tests__/snapshot.test.ts` writes one JSON line per row of every table plus header and pricing to `catalog/__tests__/__snapshots__/seed-rows.txt` via `toMatchFileSnapshot`. Verified it fails when a single hardware price is changed (and the file was restored).
- B2. Removed the `typechecks role keys` test. B3. `catalogIndex.test.ts` imports `MATERIAL_ROLES`; a new test pins it to the 9 roles of 03 §2.
- B4. `sheetTrimMm` is an integer. B5. `sheetLengthMm`/`sheetWidthMm` positive ints; slide and sliding-track `lengthMm` >= 1. B8. `generatedAt` is `z.iso.datetime()`.
- B6. `seedCatalog` validates the `pricing` patch through `PricingSettingsSchema` (tests: `edgePremillMm: 9`, `sheetTrimMm: 1.5` throw).
- B7. `seedCatalog` parses once and returns one deep-frozen snapshot (same object each call; a pricing patch returns a new frozen snapshot sharing the rest). The "independent copy" test was replaced by parse-once / frozen tests; the index memoisation test now uses a `mutateCatalog` result as the differing snapshot.
- Minor 6 (spec errors re-emitted as `custom`) accepted as is.

Verification: `yarn vitest run resources/js/engine` 58 files, 2177 tests passing; eslint, prettier --check (engine + tests/fixtures/catalog) and vue-tsc clean.
