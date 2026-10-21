# Task 26 review (8cf3f08..f310782)

Reviewed from the diff file only. The controller rulings 1-6 were not re-filed. Mutation checks ran in a scratch copy (`.../scratchpad/mut`, with a symlinked `node_modules`). The worktree was not touched, and `git status` there is clean.

### Spec Compliance

- ✅ Spec compliant. All 17 commands are present, with the params, results, merge keys and `touchesGeometry` flags that 04 §6.6 gives.
- ⚠️ Cannot verify from the diff: the full-suite and quality-gate results (1993 tests, eslint, prettier, vue-tsc). I took them from the report and did not re-run them.

Checks against the spec:

- **03 §1.1 and `validatePlan`.** The numeric-range row of 03 §1.1 lists only thickness, height, opening width, sill and coordinates within ±1 000 000. It names no fixture size, elevation, dimension offset or label fontSize.
  - `validate.ts::valuesInRange` already checks the coordinates of placements, fixtures, labels, dimension a/b and room anchors.
  - The `limits.ts` only placement of the new ranges is therefore correct and needs no `validatePlan` change. This is not a finding. Report concern 5 is moot.
  - `plan.too_large` for placements (500) and fixtures (1000) is enforced in `addPlacement` and `addFixture` through `checkCollectionCapacity`. 03 sets no limit for dimensions or labels.
- **Merge keys.** All match the table:
  - `roomMeta:{faceKey}`, `placement:{id}`, `placementRot:{id}`, `fixture:{id}`, `dim:{id}`, `label:{id}`.
  - `fixtureProps:{sorted unique ids}` uses the same form as `wallProps` in walls.ts:618.
  - `setPlacementProps` has no merge key, as the table says.
  - Mutation of every key (flattened, unsorted, swapped) was killed by the registry tests.
- **`touchesGeometry`.** It matches the table: true only for `addDimension` and `setDimension` (the "yes¹" rows), false for the other 15.
  - The registry tests assert it per command (annotations.test.ts:46, fixtures.test.ts:66, rooms.test.ts:26).
  - `postprocess.ts::followDimensions` is the only consumer of the geometry pass for dimensions.
- **`rotatePlacement` centre pivot** (placements.ts:~262-285).
  - `placementFootprint(placement, size).center` is `P + f(θ)·D/2`, as in footprint.ts `build()`.
  - `at = center − f(θ')·D/2` with `θ' = storedRotation(p.rotation)` is exactly `P' = C − f(θ')·D/2`.
  - Rounding is applied to P' after the subtraction, so centre drift is at most 0.5 mm (tested at an oblique angle).
  - The 90° exact case is asserted: (2000,1250) stays the centre and P' = (2250,1250).
  - `back_center` keeps x, y. Only `pivot: 'center'` needs the footprint, so `design_unknown` is raised for that pivot alone (tested).
  - Mutations (use stored `placement.rotation`, use back centre as C, `+` instead of `−`) were all killed.
- **Rotation normalisation.** `storedRotation = round(normDeg(d)·100)/100`, with 360 mapped to 0 and `+0`.
  - `normDeg` is `((d % 360) + 360) % 360`, so negatives work: −90 → 270, −45 → 315, −360 → 0, −0.001 → 0.
  - zod 4 rejects NaN and Infinity, so the helper never sees them.
  - It is used by every rotation entry point (add/move/rotate placement, add/move/set fixture, add/set label).
  - Tests cover 370 → 10, −90 → 270, −45 → 315 and 450 → 90. A mutant that dropped `normDeg` was killed (8 tests).
- **Attached-dimension recompute.** The `followDimensions` change is `related.reach.has(wallId) || info.changed.has(dim.id)`.
  - It cannot affect wall commands, because a dimension only appears in `changed` when the command patched it.
  - The cases are sound: `mergeCollinearWalls` / `splitWall` moving dimensions to another wall, `setDimension` detaching (skipped on `attachedTo === null`), and an unchanged result producing no patch.
  - Wall-move recompute is pre-existing (moves.test.ts:1115, walls.test.ts:1012). This task adds a thickness-change test (annotations.test.ts:143).
  - Dropping the `changed` clause was killed by 5 tests.
- **Undo deep-equal.** Every mutating command has a test whose final assertion is `bus.getDoc()` deep-equal to the start document: via `expectUndoRestores`, or `expect(bus.undo())` followed by `toEqual(start)`, including after merge drags.
  - The rotate-detach test undoes 4 steps to the start.
  - Refusals assert the same document identity and an unchanged history length (`expectRefusedUntouched`).
- **Spec rows verified.**
  - `setRoomMeta` create shape, `created` flag and trim.
  - `addFixture` `bed_double` is 1400×1900×900, elevation 0, label null (tested).
  - `setFixtureProps` library reset only when the key differs, and unless sizes are given.
  - `addDimension` 9 vs 10 mm, and offset ±50 000.
  - `addLabel` default 250, trim, and `text_length`.
  - `fixture_unknown` is reachable because `libraryKey` is a plain string in the schema.

### Mutation check (scratch copy, 4 test files, 106 tests)

85 mutants were run (one more had no match and was skipped). 81 were killed and 4 survived (listed under Minor).

The key refusals were all killed:

- **`not_found`.** Killed at 15 sites: setRoomMeta, deleteRoomMeta, movePlacement, rotatePlacement, checkAttachment, deletePlacements, setPlacementProps, moveFixture, setFixtureProps, deleteFixtures, setDimension, the dimension wall, setLabel, deleteDimensions and deleteLabels.
- **`design_unknown`.** Killed for addPlacement and for rotate with pivot centre.
- **`fixture_unknown`.** Killed for add and for setFixtureProps.
- **`dimension_too_short`.** Killed for `<10` → `<9`, `<10` → `<=10`, "never judged in set", and "judged on unrounded points".
- **`text_length`.** Killed for min 1 → 0, max 200 → 199/201, no trim in add and in set, UTF-16 length instead of code points, and set unchecked.
- **`out_of_range`.** Killed for:
  - dimension offset bound ±1 and one-sided;
  - fontSize min and max;
  - fixture size, height and elevation, min and max;
  - room name max, UTF-16 length and no trim;
  - setFixtureProps sizes unchecked;
  - setPlacementProps elevation;
  - labelOffset, label position and dimension point b.
- **Also killed.**
  - Rotation tolerance 0.4 and 1.0.
  - `angleBetween` without wrap.
  - Right-side normal not flipped.
  - Never or always detach.
  - `keep` sign, axis and front/back flips.
  - Library reset always, never, or overriding given sizes.
  - `created` flag, default fontSize and label, and `too_large` for placements and fixtures.

### Strengths

- `validate` and `run` share one planner per command, so they cannot disagree. This is the same pattern as openings.ts, and it keeps the `validate` result and the `run` abort identical.
- The no-op discipline is thorough:
  - Objects are written field by field, so same-value writes make no patch and the bus drops the entry. This is tested for setRoomMeta, movePlacement, moveFixture, setDimension and setLabel.
  - Duplicate ids are normalised with `uniqueSorted`.
  - `deletedIds` is sorted.
- Code-point counting for names and labels is handled correctly, with an emoji test at the 200/201 boundary.
- The tests assert exact `params` (`field`/`min`/`max`, `length`/`min`/`max`) as well as the code.
- Rulings are written into file headers and match the controller's rulings.
- The `followDimensions` change is minimal and has an explanatory comment. `storedRotation` is reused rather than duplicated.

### Issues

#### Critical (Must Fix)
None.

#### Important (Should Fix)
None.

#### Minor (Nice to Have)

1. **Duplicated planner scaffolding.**
   - `type Planned<T>` and the `hasError` type guard are copied verbatim into 5 files: annotations.ts:47/51, fixtures.ts:50/52, placements.ts:53/55, rooms.ts:28/30 and openings.ts:71/185 (the last is pre-existing). `PointSchema` is also repeated in rooms.ts:36, annotations.ts:60 and moves.ts:90.
   - Hoist `Planned` and `hasError` into `validators.ts` or `define.ts`. This is a small refactor and can wait for a later cleanup task.
2. **Test gaps (surviving mutants).**
   - `addFixture` `y` range is unchecked by tests (fixtures.test.ts:~181 only drives `x`). Deleting `checkCoord('y', fixture.y)` at fixtures.ts:~167 survives.
   - `movePlacement` `y` range has the same gap. Deleting `checkCoord('y', y)` at placements.ts:~205 survives.
   - `setFixtureProps` with `keep` and a `rotation` in the same call is documented in the file header (fixtures.ts:~13-15) but untested. Using `f.rotation` instead of `next.rotation` for the new corner offset at fixtures.ts:~309 survives.
   - "An old short dimension can still be moved or detached" (header, annotations.ts:~20) is untested. annotations.test.ts:371 covers only the refusal side. Judging length always instead of only when `a`/`b` is given survives.
3. **Wall-move recompute is not integrated for `addDimension`-created dimensions.** annotations.test.ts:143 covers only a thickness change. Wall-move recompute rests on the pre-existing moves.test.ts:1115 test. One `moveWall` or `moveNode` test on an attached dimension made by `addDimension` would close the loop.
4. **Refusal edge cases in `checkDimension`** (annotations.ts:~134-152).
   - An attached `addDimension` must still pass placeholder `a`/`b` at least 10 mm apart, even though post-process overwrites them. An editor that sends `a = b` is refused with `dimension_too_short`. The behaviour is documented, but the editor contract (05) should say so.
   - `setDimension` also range-checks the stored `a`/`b`. A document with an out-of-range stored point cannot have only its offset changed or be detached. This is very unlikely, since `validatePlan` already flags such a document.
5. **Report concern 5 is not a gap.** 03 §1.1 requires no `validatePlan` extension, so the ledger can close it.

### Assessment

**Task quality:** Approved

**Reasoning:** All 17 commands, merge keys, `touchesGeometry` flags, refusal codes, ranges, rotation normalisation and the centre-pivot formula match 04 §6.6 and 03 §1.1. The key refusals were all killed in the scratch mutation run, and the undo deep-equal coverage is complete. Only Minor items remain (small duplicated scaffolding and four surviving mutants).
