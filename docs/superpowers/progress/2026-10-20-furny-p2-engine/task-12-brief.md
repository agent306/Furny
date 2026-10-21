### Task 12: `createPlanDeriver` incremental caching

**Files:**
- Modify: `resources/js/engine/plan/derive.ts`
- Test: `resources/js/engine/plan/__tests__/deriverCache.test.ts`

**Spec refs:** `04 §7.1–§7.2`

**Interfaces:**
- Consumes: Tasks 10–11; `create` from `mutative` (tests only).
- Produces: `createPlanDeriver(): { derive(doc: PlanDocument): DerivedPlan; clear(): void; stats(): DeriverStats }` with `DeriverStats { joins: number; outlines: number; roomNets: number; fullHit: boolean }` (counts recomputed in the last `derive` call; for tests and perf diagnostics). `derivePlanGeometry` = fresh deriver per call.

- [ ] **Step 1: Write the failing tests** — same document twice → identical result object (`toBe`) except `docRef`, `stats().fullHit === true`; changing only `placements`/`view` (via `mutative.create`) → full hit; changing only `rooms` → walls reused (`stats().outlines === 0`) and association recomputed; moving one interior node of `makeGridPlan(7,6)` → `stats().joins ≤ 5` (the node and its ≤ 4 neighbours), `stats().roomNets ≤ 16` (rooms touching those nodes; the other 26+ are reused), and the result deep-equals `derivePlanGeometry(newDoc)` (compare with a float tolerance helper `expectGeomClose`); adding an opening → `stats().outlines === 1` (only that wall's outline/poché); `clear()` forces a full recompute.
- [ ] **Step 2: Run it, expect FAIL** — `yarn vitest run resources/js/engine/plan/__tests__/deriverCache.test.ts`
- [ ] **Step 3: Implement** — reference-identity caches of 04 §7.2 items 1–7 (node-join signature string, per-wall memo keyed by wall object + end join objects + opening objects, per-face net memo keyed by ring coordinate string + intersecting outline objects).
- [ ] **Step 4: Run tests, expect PASS** — `yarn vitest run resources/js/engine/plan`
- [ ] **Step 5: Quality gates** — `yarn eslint resources/js/engine && yarn prettier --check resources/js/engine && yarn vue-tsc --noEmit`
- [ ] **Step 6: Commit** — `git add resources/js/engine/plan` → `perf(engine): cache plan derivation incrementally by entity identity`

