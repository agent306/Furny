# Task 44 report: pricing (`priceBom`, `displayUnitPrice`, `estimateFurniture`)

Status: DONE

## Implemented
- `resources/js/engine/bom/pricing.ts`: `PriceBreakdown`, `PriceLine`, `PriceOptions`, `priceBom`, `displayUnitPrice`, `LABOUR_KEYS_ORDER` (alias of `LABOUR_KEYS`, already in the 08 §4.3 table order).
  - 08 §4.1 material lines (area-billed for `used_area` and always for glass, `sheetsBilled x 100` for `whole_sheets`), §4.2 edge band / hardware / finishing, §4.3 all 14 labour keys (`installation_per_item` and `general_per_hour` never emit a line; an inactive or missing rate emits none), §4.4 totals, overhead, margin, `roundUpToStep`, §4.5 installation with the minimum charge, `totalBeforeTaxMinor = (unit + installation) x quantity`.
  - All multiplications go through `money.ts` helpers and `intMath` BigInt helpers (`product`, `ceilDivBig`, `toSafeNumber`); lines are sorted by code, kinds in the order material, edge band, hardware, finishing, labour; zero-quantity lines omitted; unknown catalog codes skipped (already reported as model issues).
- `resources/js/engine/bom/estimate.ts`: `estimateFurniture(doc, catalog)` = `generateFurniture` -> `computeBom(…, bomOptionsFor(doc, true))` -> `priceBom(…, catalog.pricing, { quantity: 1, includeInstallation: false })`.
- `resources/js/engine/index.ts`: exports `estimateFurniture`, `priceBom`, `displayUnitPrice`, `LABOUR_KEYS_ORDER`, types `PriceBreakdown`, `PriceLine`, `PriceOptions`.

## Files changed
- A `resources/js/engine/bom/pricing.ts`, `resources/js/engine/bom/estimate.ts`
- A `resources/js/engine/bom/__tests__/pricing.test.ts`, `pricing.labour.test.ts`, `estimate.test.ts`
- M `resources/js/engine/index.ts`

## TDD evidence
- RED (tests written first, nothing implemented): `yarn vitest run resources/js/engine/bom/__tests__/pricing resources/js/engine/bom/__tests__/estimate` -> `Test Files 3 failed (3)`, `Tests no tests`, each with `Error: Cannot find module '../pricing' imported from …/pricing.test.ts` (and `../estimate`).
- GREEN after implementing: `yarn vitest run resources/js/engine/bom` -> 12 files, 136 tests passed. One intermediate run showed 4 failures that were bugs in my own labour test setup (BRK-ANTITIP triggers `hardware_fitting_each`, so unit price was 102 500 instead of 100 000: `expected 8200 to be 8000`, `expected 34163 to be 33330`); fixed by using SCR-PACK (screw_pack, no fitting labour) in those tests. No production-code change was needed.
- Spec figures reproduced exactly with no tuning: material 1 002 550, edge band 19 662, hardware 298 400, labour 316 574, direct 1 637 186, overhead 163 719, margin 630 317, unit 2 431 300, installation 194 600, total 2 625 900; `whole_sheets` 1 205 000 / 105 000 / 1 861 086 / 186 109 / 716 518 / 2 763 800; display 2 869 000; estimate unit 2 431 300 with installation 0; `nesting: false` deep-equals the estimate price.

## Gates
- `yarn eslint resources/js/engine`: clean. `yarn prettier --check resources/js/engine`: clean. `yarn vue-tsc --noEmit`: clean.
- `yarn lint`: exit 0. `yarn typecheck`: exit 0.
- Full `yarn vitest run`: 200 files / 5064 tests; 3 failed, 5061 passed. The 3 failures are exactly the ENV.md host baseline: `engine/furniture/__tests__/validate.test.ts > contains every furniture code literal…` and `lib/__tests__/format.test.ts` de-CH x2. Re-run alone, they fail the same way.

## Deviations / decisions
1. Per-key drawer exclusion in `assembly_per_part` (08 §4.3 #5): `Bom.cutList` rows merge identical parts and keep only `partKeys` (unique) and a total `qty`, not a quantity per key. For a row mixing drawer and non-drawer keys the excluded count is `round(row.qty x drawerKeys / partKeys.length)`, i.e. an equal share per key. Exact whenever parts in a row have equal `qty` (all generated parts today are qty 1 per key). Glass rows are excluded whole.
2. `drawer_assembly_each` counts part keys matching `/\.drawer\.\d+\.side\.left$/` across all rows (one per key, as the spec says), regardless of row qty.
3. The installation minimum uses `installation_per_item` only when that rate is active (spec: "active labour rate"); otherwise 0.
4. `displayUnitPrice` follows the spec verbatim (looks up `defaultTaxRateId` without an `isActive` check); a missing rate counts as 0 %.
5. `priceBom` emits no issues, so no messageKeys were added.

## Concerns
None blocking. Test-only note: the mixed-row drawer case relies on decision 1.
