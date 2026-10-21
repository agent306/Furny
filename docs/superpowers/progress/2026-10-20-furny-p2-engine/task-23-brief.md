### Task 23: Wall commands

**Files:**
- Create: `resources/js/engine/plan/commands/walls.ts`
- Modify: `resources/js/engine/plan/commands/registry.ts`
- Test: `resources/js/engine/plan/commands/__tests__/walls.test.ts`

**Spec refs:** `04 §6.6` (`addWall`, `addWallChain`, `splitWall`, `mergeCollinearWalls`, `deleteWalls`, `deleteNode`, `setWallProps` rows and semantics), `04 §6.8`, `04 §4.9` (re-association via commands)

**Interfaces:**
- Consumes: Tasks 21–22.
- Produces: registry entries `addWall`, `addWallChain`, `splitWall`, `mergeCollinearWalls`, `deleteWalls`, `deleteNode`, `setWallProps` (params/results exactly as the 04 §6.6 table, each with a zod `paramsSchema`, `labelKey 'engine.plan.command.label.<snake_type>'`).

- [ ] **Step 1: Write the failing tests** (via `createPlanBus`, `testIds()`; every case also asserts `undo()` restores a deep-equal doc): drawing a wall across an existing wall → 4 walls sharing one new node, one undo restores the single wall (04 §6.8); end 3 mm from a node joins it; 3 mm from a centre line → T node; exactly over an existing wall → `wall_duplicate`, doc unchanged; longer wall overlapping half of one → only the uncovered part; defaults (`exterior` → 230, else 115; height 2700; material brick); `addWallChain` closed with 4 points creates a room (1 new face) and requires ≥ 3 points (`invalid_params`/`out_of_range`); `splitWall` with `at: 5` → `out_of_range` (`params.field === 'at'`); deleting the stem of a T merges the collinear pieces into one wall when props are equal (04 §6.8) and keeps them when props differ; `mergeCollinearWalls` errors `not_collinear` and `props_differ`, shifts openings of K by `len(R)` when K.a was replaced; `deleteWalls` cascades openings and attached dimensions, detaches placements; `setWallProps` lowercases `colorHex '#AABBCC'`, rejects `'red'`, rejects a height below an opening (`opening_too_tall`), thickness change makes an attached placement follow the face; command re-association (04 §4.9): deleting the wall between two named rooms keeps the larger room's meta and deletes the other **in the same history entry**, undo restores both; adding a wall that splits a named room keeps the meta in the anchor part.
- [ ] **Step 2: Run it, expect FAIL** — `yarn vitest run resources/js/engine/plan/commands/__tests__/walls.test.ts`
- [ ] **Step 3: Implement** — one `definePlanCommand` per row; ranges of 04 §6.6 intro (`out_of_range` with `field/min/max`); add to `PLAN_COMMANDS`.
- [ ] **Step 4: Run tests, expect PASS** — `yarn vitest run resources/js/engine/plan`
- [ ] **Step 5: Quality gates** — `yarn eslint resources/js/engine && yarn prettier --check resources/js/engine && yarn vue-tsc --noEmit`
- [ ] **Step 6: Commit** — `git add resources/js/engine/plan/commands` → `feat(engine): add wall drawing, splitting, merging and deletion commands`

