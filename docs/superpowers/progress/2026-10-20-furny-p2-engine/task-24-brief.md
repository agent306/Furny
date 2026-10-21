### Task 24: Node/wall move commands

**Files:**
- Create: `resources/js/engine/plan/commands/moves.ts`
- Modify: `resources/js/engine/plan/commands/registry.ts`
- Test: `resources/js/engine/plan/commands/__tests__/moves.test.ts`

**Spec refs:** `04 §6.6` (`moveNode`, `moveWall`, `setWallLength`), `04 §6.8`

**Interfaces:**
- Consumes: Tasks 21–23.
- Produces: registry entries `moveNode` (mergeKey `moveNode:{id}`, replace), `moveWall` (`moveWall:{id}`), `setWallLength`.

- [ ] **Step 1: Write the failing tests** — 200 `moveNode {finalize:false}` executes with `merge: true` then one `finalize:true` → 1 history entry; undo restores the pre-drag doc (04 §6.8); moving node `a` keeps each opening's distance to node `b`; shrinking a wall below an opening's width → `opening_no_fit`, doc unchanged; validation rejects a move making an incident wall < 10 mm; `finalize` within 5 mm of another node → `mergedInto` that node id and the moved node is gone; `finalize` on a wall centre line → T split; `finalize` across a wall → `splitIntersections`; `moveWall` on the top wall of `makeRectPlan(5000,4000,230)` by −500 keeps the rectangle closed and rectangular (neighbours slide along their lines); near-parallel neighbour → plain translation; `setWallLength {anchor:'auto'}` moves `b` when `deg(b) = 1`, else `a` when `deg(a) = 1`, else `b`; every case undo → deep-equal.
- [ ] **Step 2: Run it, expect FAIL** — `yarn vitest run resources/js/engine/plan/commands/__tests__/moves.test.ts`
- [ ] **Step 3: Implement** — semantics of the three 04 §6.6 bullets (`moveWall` slide rule with the `10·|distance| + 1000` near-parallel guard).
- [ ] **Step 4: Run tests, expect PASS** — `yarn vitest run resources/js/engine/plan`
- [ ] **Step 5: Quality gates** — `yarn eslint resources/js/engine && yarn prettier --check resources/js/engine && yarn vue-tsc --noEmit`
- [ ] **Step 6: Commit** — `git add resources/js/engine/plan/commands` → `feat(engine): add node and wall move commands with drag merging`

