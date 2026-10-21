# Task 47 report: Quote totals TS port + shared quote fixtures

Status: DONE_WITH_CONCERNS (one pre-existing unrelated vitest unhandled error, see Concerns).

## Implemented
- `resources/js/lib/quoteTotals.ts`: `computeQuoteTotals`, `parseQuantityMilli` and the types from the brief, 08 §6.3 verbatim. Line amounts via `costFromMilli`; discount allocation in BigInt (`base_g = floor(D*S_g/S)`, remainders, leftovers to largest remainder, ties taxRateId asc with null last, using a stable sort over groups pre-sorted by that order); exclusive uses `applyBps`, inclusive uses `netFromGross`; breakdown ordered rateBps desc, name asc (then id for determinism); null group never listed. `D > S` returns `{ ok:false, code:'discount_exceeds_subtotal' }`. Unknown `taxRateId` throws `RangeError` (silently pricing it at 0% would be wrong). Imports only from `@/engine`.
- Ruling C11: `QuoteTotalsLine` has optional `isVisibleToCustomer` and `orderItemId`, ignored by the calculator. Sixth fixture `hidden-lines.json` (installation and custom lines hidden with `orderItemId`; expected identical to `exclusive-two-rates`).
- Fixtures (`tests/fixtures/quotes/`): `exclusive-two-rates`, `inclusive-two-rates`, `fractional-qty`, `untaxed-group`, `discount-exceeds`, `hidden-lines`, plus `README.md` documenting the shared P7 fixture shape.
- Test: `resources/js/lib/__tests__/quoteTotals.test.ts` globs `tests/fixtures/quotes/*.json` (asserts the exact six file names), runs each, and covers `parseQuantityMilli` (`'2.5'`=2500, `'0.001'`=1, `'1.0001'` throws, plus `''`, `'-1'`, `'1e3'`, `'1.'`, max value).

## Files
- resources/js/lib/quoteTotals.ts
- resources/js/lib/__tests__/quoteTotals.test.ts
- tests/fixtures/quotes/{exclusive-two-rates,inclusive-two-rates,fractional-qty,untaxed-group,discount-exceeds,hidden-lines}.json
- tests/fixtures/quotes/README.md

## TDD evidence
RED (module absent):
```
FAIL  app  resources/js/lib/__tests__/quoteTotals.test.ts
Error: Failed to resolve import "../quoteTotals" from "resources/js/lib/__tests__/quoteTotals.test.ts". Does the file exist?
```
GREEN:
```
✓  app  resources/js/lib/__tests__/quoteTotals.test.ts (9 tests)
Test Files  1 passed (1)   Tests  9 passed (9)
```

## Independent verification of the numbers
Before writing code I ran a standalone Node BigInt scratch script (separate implementation of 08 §6.3, not the TS module) on the four computed cases. All results equal the brief and 08 §10.6:
1. exclusive: amounts [2431300,194600,500000,-100000]; S=3125900, D=100000; tax18 (taxable 2541895) 457541, tax12 (taxable 484005) 58081; tax 515622; total 3541522.
2. inclusive: net 2154148 / 432147; tax 387747 / 51858; tax 439605; total 3025900.
3. fractional: 2500*99999/1000 = 249997.5 -> 249998; tax 249998*0.18 = 44999.64 -> 45000; total 294998.
4. untaxed: S=200000, D=3; base 1 / 1, remainder 100000 each, 1 left goes to tax-gst18 -> gst18 taxable 99998, tax 17999.64 -> 18000; null group taxable 99999; total 217997.
5. discount-exceeds: 1001 > 1000, error. (trivial)
No disagreement. (Allocation for #1 is 84005 / 15995 as in 08 §10.6.) Fixture `expected` blocks were generated from the brief values, then compared by the implementation under test.

## Gates
- `yarn eslint resources/js/lib`: clean. `yarn prettier --check resources/js/lib tests/fixtures/quotes`: clean. `yarn vue-tsc --noEmit`: clean.
- `yarn lint` clean, `yarn typecheck` clean, `yarn format:check` clean.
- Full `yarn vitest run`: 203 files / 5117 tests passed, 0 test failures, but the process exits 1 with "Errors 1 error" (see Concerns). Baseline without my changes: 202 files / 5108 tests, same 1 error.

## Deviations
- Test resolves the fixture dir with `join(import.meta.dirname, ...)` instead of `new URL(..., import.meta.url)` (vite's jsdom transform mangles non-literal `new URL`).
- Unknown tax rate id throws (not specified; defensive).

## Concerns
1. Full-suite vitest exits 1 on a pre-existing, unrelated unhandled error: `ReferenceError: document is not defined` from a timer in `resources/js/composables/useRouteFocus.ts:89` firing after teardown, originating in `components/app/__tests__/AppShell.test.ts`. Reproduced on the clean HEAD (my changes stashed). AppShell passes alone (22/22, twice). Not fixed (out of scope); someone should clear the timer on unmount.
2. During the task, `resources/js/engine/index.ts` briefly showed an uncommitted edit I did not make (3 duplicated export lines for pricing/estimate, causing TS2300 duplicate identifiers). `git status` was clean at start. I restored it with `git checkout -- resources/js/engine/index.ts` (it was not part of my work; HEAD is correct) and it did not recur. Source of the stray edit is unknown (possibly another process writing in this worktree); worth the controller checking no other agent is active in p2-engine.
