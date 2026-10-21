# Task 27 review: 0f3667a..0b34341

### Spec Compliance

- ✅ Spec compliant (04 §6.6 background / calibrate / rescale / setPlanMeta bullets, §6.8, 06 §11.3 and §12.2 usage), within the controller rulings.
- ⚠️ Cannot verify from diff: (a) 06 §12.1 says the trace background is `locked` once the editor opens, and `calibrateBackground` refuses a locked background (04 §6.6). 06 §12.2 calibrates before "Continue to editor" locks it, so this works, but the later "Calibrate scale ... from the editor's background panel" (06 §12.2 last line) needs an unlock via `setBackgroundProps` first; the Task 28+ UI must do that. (b) `validatePlan` does not flag a free dimension shorter than 10 mm or two distinct nodes that coincide after a heavy shrink (see Minor 2 and 3); only the pipeline error invariant would, and it does not.

### Spec questions asked

1. Calibrate does not scale dimension `offset` / room `labelOffset`, rescale does: consistent with the spec as written. 04 §6.6 calibrate lists "node, placement x,y, fixture x,y, label position, unattached dimension point, RoomMeta anchor" plus opening offsets, and says "thicknesses and sizes are not scaled". Rescale lists `offset` and `labelOffset` explicitly. The implementation follows both bullets literally. Recommended single rule for the spec 19 ledger: positions scale under both commands (incl. opening offset along its wall); display distances (dimension `offset`, room `labelOffset`) and physical sizes (thickness, opening width, fixture / furniture size, font size) scale only under `rescalePlan` (a pure unit change), never under calibrate (a registration to the image). The `PlanScaling.sizes` flag already encodes exactly that rule.
2. Opening offsets x k then clamped: correct (plan.ts scalePlan, offset `mm(o.offset * factor)` then `reclampOpenings(d, id, 'none', oldLength)`). Rescale additionally scales width, clamped 300-6000. Squeezed overlaps surface as `introduces_error` (probe: calibrate to 400 mm on scaleWorld gave `introduces_error plan.opening_overlap`), `opening_no_fit` when a width exceeds the wall (probe: rescale 0.01 and calibrate 300 both gave it). The plan.ts header comment is accurate (reclamp compares against the already-scaled offsets, so it does not itself raise `opening_overlap`).
3. Background under both commands: calibrate `mmPerPixel *= k` and `position = round(p1 + (position - p1) k)` even without `scaleGeometry`; rescale `mmPerPixel *= f`, `position *= f` about the origin. Both go through `scaleBackground` with the 0.01-1000 check. Matches spec.
4. Image-space: `scaling: null`, only `mmPerPixel = distanceMm / |ab|` written, `position` untouched, `factor = new/old`. Matches 06 §12.2 (position stays at (0,0)).
5. One undo: each command is a single bus entry; postprocess patches (attached dimensions / placements, orphan nodes, room metas) are in the same entry. Tests assert `undo.length === 1` then `getDoc()` deep-equals the start for rescale and for calibrate with `scaleGeometry` (background.test.ts "scales every point ... about p1", plan.test.ts "doubles coordinates ...").

### Folded Task 26 minors

- `replay.test.ts` failed-re-run test: reads correctly. The command draws two `n` ids and one `w` id from a recorded `{ids:{n:['n_recorded1']}}`, aborts, and the test asserts the record is deep-equal to its snapshot and the draw order (`['n','w']`). The recorded-ids-unchanged assertion is real (it fails if `replayingNewId` appends to the caller's lists; the implementer reports the mutation killed, I did not re-mutate pipeline.ts).
- `withSealed` dropping `runState`: safe. bus.ts:400-405 only merges when `!top.sealed`, and `runState` is read only at bus.ts:428 (`top.runState`, replace-merge). Every path that produces a sealed entry (sealTop at 351/452/527, `beginTransaction`, undo/redo `step` at 502-507, transaction entries created `sealed: true`) yields an entry that can never be `top` of a merge again: after undo/redo the entry is sealed (`withSealed(entry)` at 502) and a later execute with `merge: true` fails the `!top.sealed` test. The only unsealed entry keeps its `runState` (`merged()` spreads `...top`). Nothing else reads `runState` (grep in bus.ts: lines 407-428, 483-485 only). No legitimate merge can lose state. Mutation (delete the `delete sealed.runState` line) fails 2 runState tests. The third new test ("a merge after seal() starts fresh") passes even without the change because the bus already refuses to merge into a sealed entry; it is a behaviour pin, not a mutation killer (harmless).

### Strengths

- Clean split: background.ts holds one planner per command shared by `validate` and `run` (no logic drift), plan.ts holds the scaler and the rescale / meta commands. Params are zod-checked, refusal order for calibrate is documented and tested ("locked whatever else is wrong").
- `alongOldFace` is a careful fix for the attached-placement trap: `followPlacements` (postprocess.ts:247-256) reads `u` from the OLD face and clamps only against the new face, so writing `q0 + dir*(k*u)` is exactly right for k > 1 as well. Both factor 2 and 0.6 are tested, and the mutants (path off, `u` not scaled) are killed.
- Atomic aborts: `wall_too_short`, `out_of_range`, `opening_no_fit` leave the document and history untouched (tests use `expectRefusedUntouched`, which asserts document identity).
- Small shared changes are sound: `MAX_SPAN` hoisted to validators.ts, new limits constants, `Graph.background()` and `scaleWorld()` fixtures covering one of everything.
- Test suite is strong: 68 new task tests; mutation score below.

### Mutation check (scratch copy `.../scratchpad/mut`, worktree untouched; 2 files, 68 tests)

Killed (all by at least one test): lock check removed; calibration_too_short threshold 10 -> 1 (plan) and removed (image); `realDistance`/`distanceMm` min 100 -> 0; factor formula inverted (plan, image); image `factor` result; `scaleGeometry` ignored; calibrate about origin; calibrate scaling sizes; setBackgroundProps lock added (unlock path); wall_too_short removed and threshold 10 -> 9; opening offset not scaled; reclamp removed; thickness clamp hi and lo removed; opening width clamp removed; sizes gate on opening width; attached-placement path off; attached `u` not scaled; dimension offset gate inverted / not scaled; free dimension points unscaled; labelOffset not scaled; coordinate range check removed; background scale check removed; background position / mmPerPixel not scaled (rescale and calibrate); background skipped in rescale; rescale factor range 100 -> 1000; northAngle `>= 360` -> `> 360`; setPlanMeta height / thickness / floor ranges; pixel integer check; opacity range; fixtures / labels / room anchors not scaled; `withSealed` runState drop.

Survivors:
- Dimension `offset` clamp to +-50 000 (plan.ts, `DIMENSION_OFFSET_MAX` replaced by 1e12): no test (Minor 1).
- `removeBackground` null-guard removed: equivalent mutant (assigning null over null patches nothing and `pushDeleted` is the only difference; the existing "does nothing" test passes either way because `pushDeleted` would be the only visible effect: not distinguishable via document / history).

### Issues

#### Critical (Must Fix)
None.

#### Important (Should Fix)
None.

#### Minor (Nice to Have)

1. plan.ts (scalePlan, dimension offset clamp): the +-`DIMENSION_OFFSET_MAX` clamp is untested (mutant survives). Add a rescale test with `offset 40000`, factor 2, expecting 50000.
2. plan.ts scalePlan: a free dimension can end shorter than `DIMENSION_MIN_LENGTH` (10 mm) after a hard shrink (probe: 100 mm dimension, factor 0.05 -> 5 mm, `validatePlan` returns no issue, the command succeeds). The spec allows only `wall_too_short` to abort rescale, so this is spec-consistent; record it in the spec 19 ledger or skip.
3. plan.ts scalePlan: distinct, non-adjacent nodes can land on the same point after a shrink toward 0.01 (nothing merges them, the check is only per-wall length). Same status as 2: spec-silent, extreme factors only (the 06 client limits to 0.2-5).
4. plan.ts:89 `scaledPoint` is exported but used only inside plan.ts; drop the `export`.
5. plan.ts scalePlan: openings whose wall is missing get `offset` scaled but are not re-fitted (they are filtered out of `fitted`). Harmless on a valid document; the report already notes dirty-document leniency.
6. limits.ts header says the limits are shared with `validatePlan`, but the new `BACKGROUND_SCALE_RANGE`, `BACKGROUND_OPACITY_RANGE`, `FLOOR_THICKNESS_RANGE` are used by commands only (`validatePlan` checks only `mmPerPixel > 0`). Cosmetic.
7. Process: the report states tests were written after the implementation (not red-first). The mutation evidence above covers it; noting for the ledger.

### Assessment

**Task quality:** Approved

**Reasoning:** Every formula and refusal in 04 §6.6 for these commands is implemented and pinned by tests, and about 45 mutants across the key refusals and formulas were killed (one coverage gap, the dimension offset clamp). The folded bus / replay fixes are sound: a sealed entry can never be the merge target, so dropping `runState` cannot break a legitimate merge.
