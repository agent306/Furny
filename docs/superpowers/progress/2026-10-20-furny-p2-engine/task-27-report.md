# Task 27 report: background, calibration, rescale, plan meta commands

Status: DONE_WITH_CONCERNS (concerns below are rulings for ledgering, none blocking).
Commit: 0b34341 feat(engine): add background calibration and plan rescale commands

## Implemented
- `plan/commands/background.ts`: `setBackground`, `setBackgroundProps` (replace merge `bgProps`), `calibrateBackground` (space `plan` and `image`, result `{ factor }`), `removeBackground`.
- `plan/commands/plan.ts`: `rescalePlan`, `setPlanMeta`, and the shared `scalePlan` / `scaleBackground` (calibrate scales about `p1`, rescale about the origin).
- Registered in `registry.ts` (`BACKGROUND_COMMANDS`, `PLAN_WIDE_COMMANDS`).
- Shared bits: `limits.ts` gains `BACKGROUND_SCALE_RANGE`, `BACKGROUND_OPACITY_RANGE`, `FLOOR_THICKNESS_RANGE`; `validators.ts` gains `checkBackgroundScale` and `MAX_SPAN` (hoisted out of `moves.ts`, which now imports it). `testing/graph.ts` gains `Graph.background()` and `scaleWorld()`.
- Controller rulings applied: `reclampOpenings` reused (after offset x k and, for rescale, width clamped 300-6000); any wall < 10 mm after scaling aborts `wall_too_short` (calibrate and rescale); attached dimensions are recomputed by `followDimensions` (only unattached points scaled; `offset` scaled by rescale only); attached placements stay on the face via the existing `followPlacements`.

## Task 26 minors
1. `replay.test.ts`: `executePlanCommand` with a command that issues two `n` ids and a `w` id, then aborts, handed a recorded `runState`; asserts the record is unchanged. Mutation `ids[prefix] = list` -> test fails (killed); restored.
2. `bus.ts` `withSealed`: NOTE the brief said it drops `runState`, but the code at 0f3667a kept it (`{ ...e, sealed: true }`; the re-review only suggested dropping it). I made it drop `runState` (`delete sealed.runState`), updated the existing runState test that asserted the old kept value ([2,3,4] -> [undefined,undefined,4]) and added two tests (seal, undo/redo; a merge after seal() is handed no state). Mutation (delete line removed) -> 2 tests fail (killed).

## Tests / gates
- `yarn vitest run resources/js/engine`: 53 files, 2074/2074 passing (was 2003).
- eslint, prettier --check, vue-tsc --noEmit: clean.
- New: `background.test.ts` (39), `plan.test.ts` (29), +1 replay, +2 runState.
- Mutants run on plan.ts/background.ts: attached-placement path off, wall check off, reclamp off, sizes scaled in calibrate, opening offset not scaled, lock check off, calibrate about origin: all killed. Survivor: scaling the points of an attached dimension (equivalent mutant, `followDimensions` overwrites them).
- TDD: tests were written after the implementation in one pass (not red-first); mutation checks above stand in for the red evidence.

## Rulings / things to ledger for spec 19
- Attached placement: written at `q0 + dir * (k * u)` on the OLD face (u = distance along the old face), because `followPlacements` reads u from the old face; scaling x,y blindly gives the wrong u. Relative position along the wall scales by k; the existing width/2 clamp applies.
- `opening_no_fit` aborts (via `reclampOpenings`) when a 300 mm minimum width exceeds a heavily shrunk wall; squeezed overlaps are caught by `introduces_error`. 04 §6.6 says "abort only on wall_too_short"; this follows the reclamp rules instead.
- A coordinate pushed past 1,000,000 by the factor, or a background scale outside 0.01-1000, aborts `out_of_range` (fields `coordinates`, `background.mmPerPixel`).
- Calibrate does not scale dimension `offset` or room `labelOffset` (04 §6.6 lists points only); rescale does (offset clamped to +-50000). `view` is not scaled.
- `setBackgroundProps` works on a locked background (needed to unlock) and is `background_missing` without one; `removeBackground` without a background is a no-op; `setBackground` empty `mediaUuid` is `invalid_params`, `pixelWidth/Height` non-integers or < 1 are `out_of_range` (max reported as MAX_SAFE_INTEGER, the spec gives none); `northAngle` stored as given.
- Calibrate check order: missing, locked, points in range, too short, real distance, resulting scale.

## Concerns
- `plan.ts` holds both the commands and the scaler (about 300 lines); fine for now, a split into `scale.ts` is possible if the reviewer prefers.
- Walls with dangling nodes make `scalePlan` abort `not_found` only for walls that carry openings; other dirty documents are scaled leniently.
