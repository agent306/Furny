### Task 50: Performance budgets (bench + asserted perf tests)

**Files:**
- Create: `vitest.perf.config.ts`, `resources/js/engine/__perf__/measure.ts`, `resources/js/engine/__perf__/budgets.perf.test.ts`, `resources/js/engine/__perf__/plan.bench.ts`, `resources/js/engine/__perf__/furniture.bench.ts`, `resources/js/engine/__perf__/bom.bench.ts`
- Modify: `package.json` (scripts `test:perf: vitest run --config vitest.perf.config.ts`, `bench: vitest bench --run --config vitest.perf.config.ts`)

**Spec refs:** `04 §7.3`, `07 §3.1` (budget), `07 §12.7`, `08 §9.3`, `master §2.1`

**Interfaces:**
- Consumes: everything above; the built CLI (Task 48).
- Produces: `measure(fn, { warmup = 5, iterations = 30 }): { median: number; p95: number }`; perf fixtures `perfWardrobe()` = `wardrobe_hinged { width: 3600, height: 2400, doors: 6, internalDrawers: 4, hangingStyle: 'double' }` (≈ 50 parts; the spec's "≈ 60" is approximate) and `randomParts(300, mulberry32(5))`.

- [ ] **Step 1: Write the failing tests** — `budgets.perf.test.ts` asserts the **CI thresholds** (2 × target, 04 §7.3; 07 §12.7; 08 §9.3), one `it` each: cold `derivePlanGeometry(makeGridPlan(7,6))` median ≤ 30 ms; warm derive after one `moveNode` (shared deriver) ≤ 8 ms; cold `makeGridPlan(22,22)` ≤ 400 ms; `snapPoint` on `makeGridPlan(16,15)` (511 walls) ≤ 1 ms; `buildSnapIndex` + `buildHitIndex` on it ≤ 6 ms; `executePlanCommand('moveNode', { finalize: false })` incl. derive on the 97-wall plan ≤ 12 ms; `validatePlan` on a fresh 97-wall document per iteration ≤ 6 ms; `generateFurniture(perfWardrobe())` median ≤ 15 ms and part count between 45 and 70; `estimateFurniture` median ≤ 60 ms and p95 ≤ 100 ms; `computeBom` without nesting ≤ 10 ms; `nestSheets` on 300 random parts < 200 ms; spawning `node engine-cli/dist/cli.mjs compute-bom` on the wardrobe ≤ 1.5 s (≤ 3 s CI). The `.bench.ts` files `bench()` the same operations for reporting only.
- [ ] **Step 2: Run it, expect FAIL** — `yarn test:perf` (script/config missing).
- [ ] **Step 3: Implement** — `vitest.perf.config.ts` = `mergeConfig(baseConfig, { test: { include: ['resources/js/engine/__perf__/**/*.perf.test.ts'], exclude: [], fileParallelism: false, testTimeout: 120_000 }, benchmark: { include: ['resources/js/engine/__perf__/**/*.bench.ts'] } })`; `measure` uses `performance.now()` (a Node/browser global, not DOM). If a budget fails, profile and fix the engine code (caching of Task 12, Flatbush indexes), never relax the threshold.
- [ ] **Step 4: Run tests, expect PASS** — `yarn build:engine-cli && yarn test:perf` and `yarn bench`
- [ ] **Step 5: Quality gates** — `yarn eslint resources/js/engine && yarn prettier --check resources/js/engine vitest.perf.config.ts && yarn vue-tsc --noEmit`
- [ ] **Step 6: Commit** — `git add vitest.perf.config.ts package.json resources/js/engine/__perf__` → `test(engine): add performance benchmarks and asserted budgets`

