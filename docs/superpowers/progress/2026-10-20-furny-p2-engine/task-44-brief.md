### Task 44: Pricing — `priceBom`, `displayUnitPrice`, `estimateFurniture`

**Files:**
- Create: `resources/js/engine/bom/pricing.ts`, `resources/js/engine/bom/estimate.ts`
- Test: `resources/js/engine/bom/__tests__/pricing.test.ts`, `pricing.labour.test.ts`, `estimate.test.ts`

**Spec refs:** `08 §4.1–§4.7`, `08 §10.2` (price), `§10.5`, `03 §3.3`, `07 §8.10`, `master §2.1` (estimate = quote)

**Interfaces:**
- Consumes: Tasks 2, 42–43.
- Produces: `PriceBreakdown`, `PriceOptions`, `priceBom(bom, catalog, pricing, options): PriceBreakdown`, `displayUnitPrice(amountExclMinor, pricing, taxRates): number`, `LABOUR_KEYS_ORDER` (table order of 08 §4.3); `estimateFurniture(doc, catalog): { bom: Bom; price: PriceBreakdown }` (generate → `computeBom(model, catalog, bomOptionsFor(doc, true))` → `priceBom(…, catalog.pricing, { quantity: 1, includeInstallation: false })`).

- [ ] **Step 1: Write the failing tests** — wardrobe, seed catalog, `used_area`, `{ quantity: 1, includeInstallation: true }`: lines exactly 08 §4.7 (material PB18-WHITE qty 4.27 unit `sheet` unitCost 215000 cost 918050, description `'PB 18 mm Frosty White (18 mm)'`; HDF3-WHITE 1.30 → 84500; edge band 32.77 m → 19662; hardware lines per code (HNG-FO-SC 8 × 12000 = 96000 … BRK-ANTITIP 6000, sum 298400); labour cutting 5.57 → 83550, edge banding 32.77 → 39324, hinge cup boring 12 → 12000, drilling 302 → 30200, assembly 20 → 80000, hinge install 12 → 24000, hardware fitting 7 → 17500, packing 1 → 30000); totals `materialCostMinor 1002550, edgeBandCostMinor 19662, hardwareCostMinor 298400, finishingCostMinor 0, labourCostMinor 316574, directCostMinor 1637186, overheadMinor 163719, marginMinor 630317, unitPriceMinor 2431300, installationMinor 194600, totalBeforeTaxMinor 2625900, currency 'INR'`; line order materials → edge bands → hardware → finishing → labour; zero-quantity lines omitted. `whole_sheets` (with nesting) → material 1205000, cutting 105000, direct 1861086, overhead 186109, margin 716518, `unitPriceMinor 2763800`. `displayUnitPrice(2431300, { …pricing, pricesIncludeTax: true }, taxRates) === 2869000`; false → unchanged. **Estimate = quote:** the same doc priced from `computeBom(…, nesting false)` gives a deep-equal `PriceBreakdown` in `used_area`. Labour unit tests (minimal BOMs): `assembly_per_part` excludes instances whose key matches `/\.drawer\.\d+\./` and glass rows; `drawer_assembly_each` counts `…drawer.N.side.left` keys; `hinge_install_each` counts only category `hinge` (12 for the wardrobe — plates are not counted, matching §4.7); `hardware_fitting_each` category list; `sliding_door_fitting_each` = Σ `sliding_roller` qty; `glass_fitting_each` = Σ glass row qty; `finishing_per_sqm` = Σ finishing qtyH; `installation_per_item`/`general_per_hour` never produce lines; an inactive labour rate → no line; glass material priced by area even in `whole_sheets` and excluded from cutting; installation minimum (`unitPrice 100000`, 8 % = 8000 < 150000 → 150000); `roundingMinor 0` and `1` → no rounding. `estimateFurniture(wardrobe, seed).price.unitPriceMinor === 2431300` and `installationMinor === 0`.
- [ ] **Step 2: Run it, expect FAIL** — `yarn vitest run resources/js/engine/bom`
- [ ] **Step 3: Implement** — 08 §4.1–§4.6 formulas with `costFromHundredths`, `applyBps`, `roundUpToStep`; quantities in lines = `qtyH / 100` for fractional units, integers for count units.
- [ ] **Step 4: Run tests, expect PASS** — same command.
- [ ] **Step 5: Quality gates** — `yarn eslint resources/js/engine && yarn prettier --check resources/js/engine && yarn vue-tsc --noEmit`
- [ ] **Step 6: Commit** — `git add resources/js/engine/bom resources/js/engine/index.ts` → `feat(engine): price BOMs and estimate furniture`

