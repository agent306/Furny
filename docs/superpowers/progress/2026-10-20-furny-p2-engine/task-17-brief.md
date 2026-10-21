### Task 17: Opening snapping + footprint snapping

**Files:**
- Modify: `resources/js/engine/plan/snapping.ts`
- Test: `resources/js/engine/plan/__tests__/snapOpening.test.ts`, `snapFootprint.test.ts`

**Spec refs:** `04 §5.7`, `04 §5.8` (snapping part), `04 §5.11`

**Interfaces:**
- Consumes: Task 16, Task 15.
- Produces: `OpeningSnapInput`, `OpeningSnapResult`, `snapOpeningPosition(input): OpeningSnapResult`; `FootprintSnapInput`, `FootprintSnapResult`, `snapFootprint(input, index, geom): FootprintSnapResult`.

- [ ] **Step 1: Write the failing tests** — on a 4000 mm wall (t 230) with a 900 door: cursor near `u = 1990` → snaps to centre `offset 2000` with a `face` guide; cursor near the inner corner → return position `u0 = safeU[0] + 100` (offset = `safeU[0] + 100 + 450`); free position rounds to 10 mm; Alt → 1 mm; width 4100 on a 4000 wall → `valid false`, `reasonKey 'engine.plan.snap.opening_no_fit'`; overlapping an existing door → `opening_overlap`; `swing` = cursor side, `hinge` from cursor u vs offset; `preferredWallId` sticks while within tolerance. Footprint (04 §5.11): a 1200-wide footprint dragged near the left face of a 4000 mm wall attaches `{ wallId, side: 'left' }`, rotation `rotationFromFront(+n)`, back centre clamped so the footprint stays inside the face; flush-to-corner snap at `t = width/2`; `keepRotation` with a 30° mismatch does not attach; furniture alignment snaps our left edge to a neighbour's right edge (same rotation) and emits an `alignment` guide; nothing near → grid when visible, else raw rounding.
- [ ] **Step 2: Run it, expect FAIL** — `yarn vitest run resources/js/engine/plan/__tests__/snapOpening.test.ts resources/js/engine/plan/__tests__/snapFootprint.test.ts`
- [ ] **Step 3: Implement** — 04 §5.7 steps 1–6; §5.8 snapping steps 1–4.
- [ ] **Step 4: Run tests, expect PASS** — same command.
- [ ] **Step 5: Quality gates** — `yarn eslint resources/js/engine && yarn prettier --check resources/js/engine && yarn vue-tsc --noEmit`
- [ ] **Step 6: Commit** — `git add resources/js/engine/plan resources/js/engine/index.ts` → `feat(engine): snap openings along walls and furniture to faces`

