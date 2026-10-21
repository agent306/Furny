### Task 13: `validatePlan` + `planSummary`

**Files:**
- Create: `resources/js/engine/plan/validate.ts`, `resources/js/engine/plan/summary.ts`
- Test: `resources/js/engine/plan/__tests__/validate.test.ts`, `summary.test.ts`

**Spec refs:** `03 §1.1`, `04 §0.1` (`validatePlan` row), `04 §4.8`, `01 §5.4` (`plan-summary`)

**Interfaces:**
- Consumes: Tasks 8–12, `intersectSegments`.
- Produces: `PLAN_ISSUE_CODES = ['plan.node_missing','plan.wall_degenerate','plan.wall_duplicate','plan.orphan_node','plan.opening_wall_missing','plan.opening_out_of_bounds','plan.opening_overlap','plan.opening_too_tall','plan.walls_intersect','plan.room_anchor_outside','plan.too_large','plan.value_out_of_range']` (`plan.placement_design_missing` is server-only and not emitted); `validatePlan(doc: PlanDocument, geom?: DerivedPlan): Issue[]` (memoised by document identity, last 4 docs); `planErrorKeys(issues): Set<string>` (`code|sortedEntityIds`, errors only — used by Task 21); `removeOrphanNodes(doc): PlanDocument`; `PlanSummary`, `planSummary(doc: PlanDocument, geom?: DerivedPlan): PlanSummary`.

- [ ] **Step 1: Write the failing tests** — `makeRectPlan`/`makeLPlan`/`makeGridPlan(3,3)` → `[]`; one test per code with a minimal broken doc and exact `severity`, `messageKey ('engine.plan.issue.' + rule)` and `entityIds`: missing node (error), wall of 9 mm (error), two walls on the same unordered node pair (error), orphan node (warning), opening on missing wall (error), `width/2 > offset` (error, `opening_out_of_bounds`), two touching openings (gap 0) → no issue but 1 mm overlap → `opening_overlap`, `sillHeight + height > wall.height` (error), crossing walls without a shared node (warning, both wall ids), meta anchor in no face (warning), 2001 walls (error, `too_large` with `params.kind = 'walls'`), wall thickness 49 / height 10 001 / opening width 299 / sill 3001 / coordinate 1 000 001 → `plan.value_out_of_range` with `params { field, min, max }`. Memoisation: same doc identity twice → same array instance. `removeOrphanNodes` drops only unreferenced nodes. `planSummary(makeRectPlan(5000,4000,230))` = `{ wallCount: 4, roomCount: 1, rooms: [{ id: <faceKey>, name: null, areaMm2: 17982900 }], totalAreaMm2: 17982900, bbox: { min: {x:-115,y:-115}, max: {x:5115,y:4115} } }`; with a meta named "Hall" the room id is the meta id and name `'Hall'`; empty plan → `bbox: null`, counts 0.
- [ ] **Step 2: Run it, expect FAIL** — `yarn vitest run resources/js/engine/plan/__tests__/validate.test.ts resources/js/engine/plan/__tests__/summary.test.ts`
- [ ] **Step 3: Implement** — JSON size check `utf8ByteLength(JSON.stringify(doc)) > 2_097_152`; numeric ranges of 03 §1.1 last row; `walls_intersect` via Flatbush candidates + `intersectSegments` proper crossings not at shared nodes.
- [ ] **Step 4: Run tests, expect PASS** — same command.
- [ ] **Step 5: Quality gates** — `yarn eslint resources/js/engine && yarn prettier --check resources/js/engine && yarn vue-tsc --noEmit`
- [ ] **Step 6: Commit** — `git add resources/js/engine/plan resources/js/engine/index.ts` → `feat(engine): validate plans and summarise rooms`

