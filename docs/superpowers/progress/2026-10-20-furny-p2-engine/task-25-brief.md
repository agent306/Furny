### Task 25: Opening commands

**Files:**
- Create: `resources/js/engine/plan/commands/openings.ts`
- Modify: `resources/js/engine/plan/commands/registry.ts`
- Test: `resources/js/engine/plan/commands/__tests__/openings.test.ts`

**Spec refs:** `04 §6.6` (`addOpening`, `moveOpening`, `resizeOpening`, `setOpeningProps`, `flipOpening`, `deleteOpenings`)

**Interfaces:**
- Consumes: Tasks 21–22.
- Produces: registry entries `addOpening`, `moveOpening` (`moveOpening:{id}`), `resizeOpening` (`resizeOpening:{id}`), `setOpeningProps`, `flipOpening`, `deleteOpenings`.

- [ ] **Step 1: Write the failing tests** — `addOpening {kind:'door'}` defaults `single_swing`, 900 × 2100, sill 0, hinge `start`, swing `left`, label `'D1'` (then `'D2'`); window defaults `casement` 1200 × 1200 sill 900, label `'W1'`; `opening` kind → type `'opening'`, label `null`; `type: 'casement'` on a door → `type_mismatch`; window with sill 900 + height 1200 on a 1800 wall → height reduced to 900; on a 1150 wall → `opening_too_tall`; offset 300 with width 900 → `opening_no_fit`; overlap → `opening_overlap`; `moveOpening` to another wall keeps swing/hinge and checks bounds there; `resizeOpening {keep:'start'}` keeps `u0` (`offset' = u0 + width'/2`), `'end'` keeps `u1`, `'center'` keeps offset; `setOpeningProps {kind:'window'}` applies window type/height/sill defaults unless given; `flipOpening 'both'` toggles both; label length 17 → `out_of_range`; undo deep-equal everywhere.
- [ ] **Step 2: Run it, expect FAIL** — `yarn vitest run resources/js/engine/plan/commands/__tests__/openings.test.ts`
- [ ] **Step 3: Implement** — per the 04 §6.6 opening bullets using `ctx.defaults`.
- [ ] **Step 4: Run tests, expect PASS** — `yarn vitest run resources/js/engine/plan`
- [ ] **Step 5: Quality gates** — `yarn eslint resources/js/engine && yarn prettier --check resources/js/engine && yarn vue-tsc --noEmit`
- [ ] **Step 6: Commit** — `git add resources/js/engine/plan/commands` → `feat(engine): add door, window and opening commands`

