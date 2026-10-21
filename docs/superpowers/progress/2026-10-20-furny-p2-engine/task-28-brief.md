### Task 28: Translate, nudge, fragment, delete + invariant property tests

**Files:**
- Create: `resources/js/engine/plan/commands/entities.ts`
- Modify: `resources/js/engine/plan/commands/registry.ts`
- Test: `resources/js/engine/plan/commands/__tests__/entities.test.ts`, `resources/js/engine/plan/commands/__tests__/invariants.test.ts`, `resources/js/engine/plan/commands/__tests__/dirty-import.test.ts`

**Spec refs:** `04 §6.6` (`translateEntities`, `nudgeEntities`, `insertFragment`, `deleteEntities`), `04 §6.8` (nudges, property test, history cap)

**Interfaces:**
- Consumes: Tasks 21–27.
- Produces: `PlanFragment` type; registry entries `translateEntities` (`translate:{hash(ids)}`), `nudgeEntities` (compose `nudge:{hash(ids)}`), `insertFragment` → `{ idMap }`, `deleteEntities` → `{ deletedIds }`. `PLAN_COMMANDS` is now complete (43 types).

- [ ] **Step 1: Write the failing tests** — translating a wall moves each of its nodes once and stretches walls shared with unselected walls; openings move implicitly; RoomMeta anchors move only when all walls of their face move; locked background is not moved; `finalize` merges moved nodes with unmoved ones within 5 mm; ten `nudgeEntities` with `merge: true` → one entry (compose), `bus.seal()` then another → new entry (04 §6.8); `insertFragment` remaps every id (`idMap` covers all), offsets coordinates, pasted walls split/join existing ones, an opening whose wall was fully covered is dropped with warning `fragment_opening_dropped`; `deleteEntities` with mixed ids (`w_`, `f_`, `t_`, `'background'`) deletes walls first, no double-deletes; `Object.keys(PLAN_COMMANDS).length === 43`. **Property test** (04 §6.8): `mulberry32(1234)`, 500 random command sequences of length 1–8 on `makeGridPlan(3,3)` drawn from all 43 commands with random but in-range params; after each successful command `planErrorKeys(validatePlan(doc))` ⊆ previous set; history never exceeds 200. **Review focus 1** (`dirty-import.test.ts`): `makeDirtyPlan()` derives without throwing and with all coordinates finite; `moveNode`, `addWall`, `deleteWalls`, `addOpening`, `setRoomMeta` each succeed on it without adding errors; the pre-existing out-of-bounds window can be fixed by `moveOpening`.
- [ ] **Step 2: Run it, expect FAIL** — `yarn vitest run resources/js/engine/plan/commands/__tests__/entities.test.ts resources/js/engine/plan/commands/__tests__/invariants.test.ts resources/js/engine/plan/commands/__tests__/dirty-import.test.ts`
- [ ] **Step 3: Implement** — per the four bullets of 04 §6.6; `hash(ids) = cyrb53(sorted ids joined by ',')`.
- [ ] **Step 4: Run tests, expect PASS** — `yarn vitest run resources/js/engine/plan`
- [ ] **Step 5: Quality gates** — `yarn eslint resources/js/engine && yarn prettier --check resources/js/engine && yarn vue-tsc --noEmit`
- [ ] **Step 6: Commit** — `git add resources/js/engine/plan/commands` → `feat(engine): add selection-wide plan commands and command invariant tests`

