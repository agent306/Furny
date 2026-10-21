### Task 10: `derivePlanGeometry` — walls, openings, poché, caps, exterior

**Files:**
- Create: `resources/js/engine/plan/derive.ts`
- Test: `resources/js/engine/plan/__tests__/derive.test.ts`

**Spec refs:** `04 §3.1`, `§3.5–§3.8`, `§7.1`, `03 §1.2`

**Interfaces:**
- Consumes: Task 9 (`buildWallGraph`, `computeAllWallEnds`, `buildWallOutline`), Task 5 (`union`, `difference`).
- Produces: `DerivedWall`, `DerivedOpening`, `DerivedRoom` (type only; filled in Task 11), `DerivedPlan` (04 §7.1, incl. `nodes`, `nodeCaps`, `wallsUnion`, `roomIndexByMetaId`, `roomIndexByFaceKey`, `issues`, `docRef`); `derivePlanGeometry(doc: PlanDocument): DerivedPlan`. In this task `rooms = []`, `leftRoomKey = rightRoomKey = exteriorSide = null`. `bbox` = bounding box of all wall outlines (no walls → of nodes; empty → `{min:{x:0,y:0},max:{x:0,y:0}}`).

- [ ] **Step 1: Write the failing tests** — wall `(0,0)→(4000,0)` t = 230 with a door offset 1000 width 900: `openings[o].u0 === 550`, `u1 === 1450`, `center = (1000,0)`; `cut` spans y from −115.5 to 115.5 (extended 0.5 mm) and x 550..1450; `jambStart.left = (550,-115)`; `swing 'left'` → `swingSign 1`; `hinge 'end'` → `hingeU 1450`; `pocheParts.length === 2` and their total area = outline area − 900 × 230 (±1); a wall without openings has `pocheParts = [{ outer: outline, holes: [] }]` (same array values). Opening with `offset` beyond the wall end → derivation clamps for drawing and emits `engine.plan.derive.opening_clamped`; an opening whose `u0 < safeU[0]` emits info `opening_in_junction`; opening on a missing wall → `opening_skipped`. `makeRectPlan(5000,4000,230)`: `exteriorOutline` area = 5230 × 4230 (±1); `nodeCaps` has entries for every node of a T-junction (built with `makeLPlan`'s `(5000,0)` node); a wall with a missing node → `wall_skipped` warning and absent from `walls`; `nodes[nodeId].wallIds` lists incident valid walls; output does not mutate the input (deep-freeze the doc).
- [ ] **Step 2: Run it, expect FAIL** — `yarn vitest run resources/js/engine/plan/__tests__/derive.test.ts`
- [ ] **Step 3: Implement** — opening frames 04 §3.6 (steps 1–5), poché §3.7 (skip Clipper when no openings), node caps and exterior outline §3.8 (largest-area union polygon's outer ring); `wallsUnion` computed once.
- [ ] **Step 4: Run tests, expect PASS** — same command.
- [ ] **Step 5: Quality gates** — `yarn eslint resources/js/engine && yarn prettier --check resources/js/engine && yarn vue-tsc --noEmit`
- [ ] **Step 6: Commit** — `git add resources/js/engine/plan resources/js/engine/index.ts` → `feat(engine): derive wall, opening and poché geometry`

