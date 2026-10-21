### Task 2: Money helpers + shared money fixtures

**Files:**
- Create: `resources/js/engine/money.ts`, `tests/fixtures/money/minor-math.json`
- Test: `resources/js/engine/__tests__/money.test.ts`

**Spec refs:** `08 §1`, `08 §10.1`, `master §6.4`

**Interfaces:**
- Consumes: —
- Produces: `roundHalfUpDiv(n, d)`, `ceilDiv(n, d)`, `applyBps(amountMinor, bps)`, `grossUp(amountMinor, rateBps)`, `netFromGross(grossMinor, rateBps)`, `roundUpToStep(amountMinor, step)`, `costFromHundredths(qtyHundredths, unitMinor)`, `costFromMilli(qtyMilli, unitMinor)`, `multiplyMinor(amountMinor, factor)` — all `(…numbers) => number`, re-exported from index. P7's PHP `MinorMath` runs the same JSON file.

- [ ] **Step 1: Write the failing test** — `tests/fixtures/money/minor-math.json` is an array `{ "fn": string, "args": number[], "expected": number }` containing every value of 08 §10.1: `roundHalfUpDiv(5,2)=3`, `(-5,2)=-3`, `(4,2)=2`, `(1,3)=0`, `(2,3)=1`; `applyBps(1637186,1000)=163719`; `applyBps(1800905,3500)=630317`; `roundUpToStep(2431222,100)=2431300`; `roundUpToStep(2431200,100)=2431200`; `roundUpToStep(123,1)=123`; `grossUp(2431300,1800)=2868934`; `netFromGross(2541895,1800)=2154148`; `ceilDiv(32767,10)=3277`; `costFromHundredths(427,215000)=918050`; `costFromMilli(1500,999)=1499`; plus `roundHalfUpDiv(-1,2)=-1`, `roundHalfUpDiv(-4,3)=-1`, `ceilDiv(0,7)=0`, `ceilDiv(7,7)=1`, `roundUpToStep(0,100)=0`, `roundUpToStep(123,0)=123`, `applyBps(9007199254741,3333)=3002099511605` (needs BigInt), `multiplyMinor(1000,1.005)=1005`. `money.test.ts` iterates the file (`it.each`) calling the named export; separately asserts `roundHalfUpDiv(1, 0)` and `roundHalfUpDiv(1.5, 2)` throw `RangeError`, and a result above `Number.MAX_SAFE_INTEGER` throws `RangeError`.
- [ ] **Step 2: Run it, expect FAIL** — `yarn vitest run resources/js/engine/__tests__/money.test.ts`
- [ ] **Step 3: Implement** — all arithmetic in `BigInt`; half-away-from-zero: `q = |n|/d`, `r = |n| % d`, `q += (2r ≥ d)`, re-apply sign; validate integer inputs and `d > 0`; `multiplyMinor` = `roundHalfUpDiv(amount × Math.round(factor × 1e6), 1e6)`.
- [ ] **Step 4: Run tests, expect PASS** — same command.
- [ ] **Step 5: Quality gates** — `yarn eslint resources/js/engine && yarn prettier --check resources/js/engine tests/fixtures/money && yarn vue-tsc --noEmit`
- [ ] **Step 6: Commit** — `git add resources/js/engine/money.ts resources/js/engine/index.ts resources/js/engine/__tests__/money.test.ts tests/fixtures/money` → `feat(engine): add integer minor-unit money helpers with shared fixtures`

