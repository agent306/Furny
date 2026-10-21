### Task 47: Quote totals TS port + shared quote fixtures

**Files:**
- Create: `resources/js/lib/quoteTotals.ts`, `tests/fixtures/quotes/exclusive-two-rates.json`, `inclusive-two-rates.json`, `fractional-qty.json`, `untaxed-group.json`, `discount-exceeds.json`
- Test: `resources/js/lib/__tests__/quoteTotals.test.ts`

**Spec refs:** `08 §6.2–§6.3`, `08 §10.6`, `02 §8.6` (quote line kinds)

**Interfaces:**
- Consumes: `costFromMilli`, `applyBps`, `netFromGross` from `@/engine` (the public index).
- Produces (P7's PHP `QuoteCalculator` must pass the same fixture files): `QuoteLineKind = 'furniture'|'materials'|'hardware'|'labour'|'finishing'|'installation'|'delivery'|'discount'|'custom'`; `QuoteTotalsLine { kind; quantity: string; unitPriceMinor: number; taxRateId: string | null }`; `QuoteTaxRate { id; name; rateBps }`; `QuoteTotalsInput { pricesIncludeTax: boolean; taxRates: QuoteTaxRate[]; lines: QuoteTotalsLine[] }`; `QuoteTotals { amounts: number[]; subtotal: number; discount: number; tax: number; total: number; taxBreakdown: Array<{ taxRateId: string; name: string; rateBps: number; taxableMinor: number; taxMinor: number }> }`; `computeQuoteTotals(input): { ok: true; totals: QuoteTotals } | { ok: false; code: 'discount_exceeds_subtotal' }`; `parseQuantityMilli(q: string): number` (exact string parse, ≤ 3 decimals, throws `RangeError` otherwise). **Fixture file shape:** `{ "description": string, "pricesIncludeTax": boolean, "taxRates": [...], "lines": [...], "expected": QuoteTotals | { "error": "discount_exceeds_subtotal" } }` with tax rate ids `tax-gst18` (`GST 18%`, 1800) and `tax-gst12` (`GST 12%`, 1200).

- [ ] **Step 1: Write the failing tests** — fixtures (08 §10.6; values computed with the §6.3 formulas):
  1. `exclusive-two-rates`: lines furniture `"1.000"` × 2431300 (gst18), installation `"1.000"` × 194600 (gst18), custom `"1.000"` × 500000 (gst12), discount `"1.000"` × −100000 (null) → `amounts [2431300, 194600, 500000, -100000]`, `subtotal 3125900`, `discount 100000`, breakdown `[{ tax-gst18, 'GST 18%', 1800, taxableMinor 2541895, taxMinor 457541 }, { tax-gst12, 'GST 12%', 1200, 484005, 58081 }]`, `tax 515622`, `total 3541522`.
  2. `inclusive-two-rates`: same lines, `pricesIncludeTax true` → breakdown taxable (= net) 2154148 / 432147, tax 387747 / 51858, `tax 439605`, `total 3025900`.
  3. `fractional-qty`: custom `"2.500"` × 99999 (gst18) → `amounts [249998]`, `subtotal 249998`, `discount 0`, `tax 45000`, `total 294998`.
  4. `untaxed-group`: custom `"1.000"` × 100000 (null), furniture `"1.000"` × 100000 (gst18), discount `"1.000"` × −3 → allocation base 1 + 1, equal remainders, the extra unit goes to `tax-gst18` (taxRateId asc, null last) → gst18 taxable 99998 tax 18000, null group taxable 99999 no tax and not in the breakdown; `subtotal 200000`, `discount 3`, `tax 18000`, `total 217997`.
  5. `discount-exceeds`: furniture 1 × 1000 (gst18), discount 1 × −1001 → `{ error: 'discount_exceeds_subtotal' }`.
  The test globs `tests/fixtures/quotes/*.json` and runs each; plus `parseQuantityMilli('2.5') === 2500`, `('0.001') === 1`, `('1.0001')` throws.
- [ ] **Step 2: Run it, expect FAIL** — `yarn vitest run resources/js/lib/__tests__/quoteTotals.test.ts`
- [ ] **Step 3: Implement** — 08 §6.3 verbatim: line amounts by `costFromMilli`; allocation `base_g = floor(D × S_g / S)` in BigInt, remainders, leftovers to largest remainders (ties taxRateId asc, null last); exclusive vs inclusive group tax; breakdown ordered `rateBps desc, name asc`.
- [ ] **Step 4: Run tests, expect PASS** — same command.
- [ ] **Step 5: Quality gates** — `yarn eslint resources/js/lib && yarn prettier --check resources/js/lib tests/fixtures/quotes && yarn vue-tsc --noEmit`
- [ ] **Step 6: Commit** — `git add resources/js/lib/quoteTotals.ts resources/js/lib/__tests__/quoteTotals.test.ts tests/fixtures/quotes` → `feat(quotes): port quote totals calculator to TypeScript with shared fixtures`

