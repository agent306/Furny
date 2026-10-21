# Task 25: Opening commands

Status: DONE_WITH_CONCERNS (rulings below need controller sign-off)
Commit: baa9c3f feat(engine): add door, window and opening commands (pushed to origin/build/p2-engine)

## Implemented
- `plan/commands/openings.ts` (new): addOpening, moveOpening (`moveOpening:{id}`, replace), resizeOpening (`resizeOpening:{id}`, replace), setOpeningProps, flipOpening, deleteOpenings. Each editing command has one planner shared by `validate` and `run`; `run` writes only changed fields, so a no-op leaves no patches and the bus drops the entry.
- `registry.ts`: `OPENING_COMMANDS` spread into `PLAN_COMMANDS`.
- `limits.ts`: `OPENING_HEIGHT_RANGE = [300, 10000]`.
- `validators.ts`: `checkOpeningCapacity`, `uniqueSorted`, `checkIds` (walls.ts now imports `uniqueSorted` instead of its local copy).
- `helpers.ts`: `overlaps` exported (reused, not re-derived).
- Tests: `__tests__/openings.test.ts`, 62 tests; uses shared `Graph`, `busOf`, `ok`, `refused`, `oneWall`. Only a local `busOfDefaults` (custom `ctx.defaults`) because `planBus` takes no defaults.

## Verification
- `yarn vitest run resources/js/engine/plan/commands/__tests__/openings.test.ts`: RED first (60/60 failed, "unknown command"), then 62/62 pass.
- Full `yarn vitest run resources/js/engine`: 45 files, 1882 tests passed.
- eslint, prettier --check, vue-tsc --noEmit: all exit 0.
- Every test that undoes asserts deep-equal against the original document.

## Rulings (logged in the file header; for spec 19)
1. Height over the wall top: `addOpening` reduces to `wall.height - sill` for every kind (spec says windows), refusing `opening_too_tall` only if less than 300 remains. `setOpeningProps` reduces only a height that came from a kind default; explicit height/sill in `resizeOpening`/`setOpeningProps` and a `moveOpening` to a lower wall are refused `opening_too_tall`.
2. Height check only runs when height, sill or wall changes (like setWallProps), so an already-too-tall opening can still be moved/flipped/deleted. Bounds/overlap run when offset or width changes, against other openings on the target wall only. Touching openings do not overlap.
3. `label` is not trimmed; `props.label` / `label` out_of_range is 1-16 chars, `null` allowed. Kind change in setOpeningProps keeps the label.
4. resizeOpening rounds the offset to whole mm for odd width changes.
5. Field names in out_of_range: `width`, `height`, `sillHeight`, `label` for addOpening/resizeOpening; `props.*` for setOpeningProps.

## Concerns
- Ruling 1 extends the spec (reduction for non-window kinds on add). Easy to narrow to windows if the controller disagrees.
- `OPENING_HEIGHT_RANGE` is only used by commands; `validatePlan` does not check opening height range (not in scope).

## Fix round 1

Rulings applied (coordinator): height reduction narrowed to windows; concerns 2-4 kept.

- Concern 1 narrowed. `fitHeight` now takes a rule: `reduce` (windows only: `addOpening`, and `setOpeningProps` for a window's kind-default height), `refuse` (`opening_too_tall`), `explicit` (`out_of_range` on `height` / `props.height`, `min 300`, `max wall.height - sill`). A door/opening whose default height does not fit is `opening_too_tall`; an explicit height over the top is `out_of_range`. Under 300 mm above the sill is always `opening_too_tall`. A sill that pushes an existing height over the top stays `opening_too_tall`. I applied the explicit-height rule consistently to `resizeOpening` and `setOpeningProps` too (it was `opening_too_tall` there before), since the §6 range table gives the same max for every command. Header comment rewritten; old "reduces an explicit height too, and a door on a low wall" test replaced.
- 1. Removed the `if (x !== y) x = y` guards in `run` (setOpeningProps uses `Object.assign(opening, plan)`); header comment corrected. The no-op tests still pass.
- 2. Added "can still be resized in width, with or without moving its edge" to the already-too-tall describe (width-only keep center, width + edge keep start, then a sill change is re-judged).
- 3. `BOUNDS_TOL` exported from `validate.ts`, used in `openings.ts`; `SLACK` removed.
- 4. `nextOpeningLabel` takes `Pick<PlanDocument, 'openings'>`; cast and `Draft` import dropped.
- 5. Label length counts code points; emoji test added (16 emoji accepted, 17 refused).
- 6. `planResize` returns `not_found` for the missing wall (`{ id: wallId }`); test added.
- 7. Tests added: setOpeningProps kind change to door/opening on a low wall, and kind change leaving under 300 mm above the sill.
- 8. Header wording: "ledgered for the spec 19 reconciliation".

Verification: openings.test.ts 67/67; full `yarn vitest run resources/js/engine` 45 files, 1887 tests pass; eslint, prettier --check, vue-tsc exit 0.
