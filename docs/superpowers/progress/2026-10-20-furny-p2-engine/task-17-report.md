# Task 17 report: opening snapping + footprint snapping

Status: DONE_WITH_CONCERNS (concerns are interpretation calls, listed below).
Commit: 8f80a8e `feat(engine): snap openings along walls and furniture to faces` (base 73dac52).

## What was implemented

New files (per controller ruling, nothing added to snapping.ts):
- `resources/js/engine/plan/snapShared.ts`: the single home for `z`, `Box`, `SnapPointerType`, `snapTolerance(pointerType, zoom)` (8/8/16 px) and `ALIGNMENT_RADIUS_PX`. `grid.ts`, `snapIndex.ts` and `snapping.ts` now import these (the duplicated `z`, `Box`, `TOL_PX` and the local alignment constant are gone). The `z` copies in derive/rooms/walls/conflicts are outside the ruling's list and were left alone.
- `resources/js/engine/plan/snapOpening.ts`: `OpeningSnapInput`, `OpeningSnapResult`, `snapOpeningPosition`, `OPENING_SNAP_REASONS` (const array for Task 51 coverage).
- `resources/js/engine/plan/snapFootprint.ts`: `FootprintSnapInput`, `FootprintSnapResult`, `snapFootprint(input, index, geom)`.
- Re-exports: `snapping.ts` (10 lines of `export ... from`, net file size 904 -> 905 lines because the dedupe removed as many lines) and `engine/index.ts`.

### Opening snap (04 §5.7)
1. Wall: outline contains cursor (preferred over merely-near), else nearest centre line within `2*tol + thickness/2`; `preferredWallId` wins while it qualifies; id-ordered iteration, strict-less ties.
2. `u` clamp to `[w/2, L-w/2]`; `L < w` gives `valid false`, `engine.plan.snap.opening_no_fit`, offset `round(L/2)`.
3. Targets within `tol` (in u) of the clamped u: centre, `safeU[0]+100+w/2`, `safeU[1]-100-w/2` (only those that fit); one `face` guide across the wall thickness at the target (centre, or the opening edge for returns).
4. Free position rounds to 10 mm; Alt = 1 mm and no targets/guides. Offset is clamped to the integer range `[ceil(w/2), floor(L-w/2)]`.
5. Overlap against `doc.openings` of the wall (excluding `openingId`), touching (gap 0) is valid; `no_fit` outranks `overlap`.
- `swing` = cursor side of the centre line (`left` iff `dot(cursor-a, n) >= 0`), `hinge` = `start` iff cursor u < offset.

### Footprint snap (04 §5.8)
1. Alt / disabled: `rawPoint`, rotation kept (normalised, 0.01 deg), no attachment.
2. Faces (index query, `2*tol`, projection within `[-w/2, L+w/2]`), `front = side==='left' ? +n : -n`, rotation `rotationFromFront(front)` (0.01 deg); `keepRotation` qualifies a face only within 1 deg. Smallest distance wins. `t` clamped to `[w/2, L-w/2]` (to `[0, L]` for a face shorter than the footprint), snapped within `tol` to `w/2`, `L-w/2`, `L/2`; corner-flush emits an `endpoint` marker at the face corner. Guide: `face` along the whole face.
3. Alignment with footprints (placements and fixtures) whose rotation is equal modulo 90 deg (+-0.5): per axis in our local (right, front) frame, smallest move within `tol` over edge-to-edge (same and opposite edges) and centre-to-centre; `alignment` guide spanning our final footprint and the aligned neighbour. When attached only the along-face axis is adjusted.
4. Neither face nor alignment: grid (visible and kind on) else raw rounding. With an alignment on only one axis the result is integer-rounded (no grid).
- Results: integer mm, `z`-cleaned, rotation in `[0,360)`. `exclude` is matched against footprint ids and wall ids only; there is no node expansion, so a tool must pass the dragged placement's id and never a node id.

## Ruling checks
- No additions to snapping.ts logic; `z`/`Box` dedupe done across grid/snapIndex/snapping/new files.
- Furniture snapping never excludes walls via nodes (node ids are inert in `exclude` here).
- Determinism test builds the index from placements inserted in 12 shuffled orders (mulberry32) and asserts identical results, with two equally-distant neighbours so the guide depends on the id sort. Mutation check: removing `footprintItems.sort` in `snapIndex.ts` made exactly this test fail (restored afterwards).
- reasonKey namespace: 04 §0.2 lists `engine.plan.snap.*` and §5.7 names `engine.plan.snap.opening_no_fit | opening_overlap`; 05 and 15 define no snap reason keys (only `engine.plan.snap.kind.<kind>` in 05 §status bar). Keys kept as in the brief; no change.

## TDD evidence
- RED: `yarn vitest run --project engine .../snapOpening.test.ts .../snapFootprint.test.ts` -> both suites failed with `Failed to load url ../snapOpening ... Does the file exist?` (module not yet written); "Test Files 2 failed, no tests".
- GREEN (focused): 2 files, 75 tests (later 76 with the index-export test) passed.
- Full engine project after the final change: `Test Files 34 passed (34), Tests 1098 passed (1098)`.
- Gates: `yarn eslint resources/js/engine`, `yarn prettier --check resources/js/engine`, `yarn vue-tsc --noEmit` all clean.

Test coverage: opening snap 33 tests (wall selection incl. sticky/touch reach, centre/return/free/Alt/clamp targets incl. joined-wall safeU, no_fit/overlap/touching/openingId, swing/hinge on horizontal/vertical/diagonal walls); footprint snap 43 tests (faces left/right/vertical/diagonal, clamp, corner/centre snaps and markers, reach 2*tol and touch, keepRotation 30 deg and 1 deg boundary, grid/raw/Alt/disabled, toggles, alignment same/opposite/centre/90-degree rotated/fixture/exclude, along-face-only, corner-priority, determinism).

## Files changed
- Added: `plan/snapShared.ts`, `plan/snapOpening.ts`, `plan/snapFootprint.ts`, `plan/__tests__/snapOpening.test.ts`, `plan/__tests__/snapFootprint.test.ts`.
- Modified: `plan/grid.ts`, `plan/snapIndex.ts`, `plan/snapping.ts` (imports + re-exports only), `engine/index.ts`.

## Self-review / concerns (interpretation calls to confirm)
1. `keepRotation` with a face within 1 deg: the result takes the face's exact rotation (flush) instead of leaving the input rotation. The spec only says the face qualifies.
2. Kind toggles: wall-face attach is gated by `settings.kinds.on_face`, alignment by `kinds.alignment`, grid by `gridVisible && kinds.grid`. The spec does not map these toggles for furniture.
3. Alignment line set: edge-to-edge in all four combinations (same and opposite edge) plus centre-to-centre on both axes. The spec's enumeration (left/right flush, back=back, front=front, centre) is asymmetric, so I used the symmetric superset.
4. On a face, a corner/centre target snap suppresses the along-face alignment (the "free axis" reading); alignment moves that would push `t` outside `[w/2, L-w/2]` are rejected.
5. No wall under the opening cursor returns `valid false`, `wallId null`, `reasonKey null` (the spec's two keys do not cover it).
6. `elevation`/`height` on `FootprintSnapInput` are carried but unused (the §5.8 algorithm has no vertical test).
7. Odd-width edge: if `ceil(w/2) > floor(L-w/2)` (opening within 1 mm of the wall length) the offset falls back to `round(L/2)`.
8. Log in 19 at milestone end: the node-id inertness of footprint `exclude`; the interpretation calls above.

## Fix round 1

Commit: see `git log` (fix(engine): pick the nearest face target and rank alignment above face centre), on top of 8f80a8e.

Changes
1. `placeOnFace` (Important): every target (corner at face start, corner at face end, face centre) is measured against the clamped cursor `t0`; the nearest within tol wins, ties go to the earlier in that order; `t` is assigned once after the loop. Tests: face 1300 / width 1200 (corners 600/700, centre 650): cursor 650 gives centre with no marker; 624 corner, 626 centre, 674 centre, 676 corner.
2. Wall attach no longer reads `kinds.on_face` (that kind is the Dimension/Measure snap). Alt or `enabled: false` still disable it; alignment stays gated on `kinds.alignment`, grid on `gridVisible && kinds.grid`. The old "honours the on_face toggle" test is replaced by one asserting attach with `on_face` off.
3. Priority along a face: corner-flush > neighbour alignment > face centre. Alignment is measured from the clamped, un-snapped position (`face.free`), so a centre snap no longer suppresses it. Test "lets an alignment beat the face-centre snap" (t 2050 -> 2100, not 2000) plus "still takes the face centre when nothing aligns" and the corner-flush test.
4. Free coordinates round to `rawStepFor(zoom)`: the along-face coordinate (anchored at the plan origin along the face direction, then clamped to the face bounds) and the free axis of a single-axis alignment. Alt keeps the spec path (04 §5.8-1 and snapPoint: raw step); see note below.
5. Short face (`!fits`): the aligned position is clamped to `[0, L]`; test with a wall of 800 and width 1200 (alignment would reach t = 870, result 800). A second test pins the clamp after raw-step rounding (face 798, cursor 797 rounds to 800, result 798).
6. Equality-boundary tests: hinge at cursor u == offset gives `end`; swing with the cursor exactly on the centre line gives `left` (documented: `dot(rel, n) >= 0` is left); neighbour rotated 3 degrees does not align.
7. Diagonal-wall test asserts `side === 'left'`.
8. `TIE_EPS`, `SLACK`, `cmp` live in `snapShared.ts`; `snapOpening`, `snapFootprint`, `snapping` and `snapIndex` import them.

Mutation checks (scratch copy under the session scratchpad, never the worktree): first-target-wins, on_face gating restored, centre suppresses alignment, alignment measured from the snapped point, no along-face rounding, no free-axis rounding, no short-face clamp, no post-rounding clamp, rotation tolerance 5 degrees, hinge `<=`, swing `> 0`. Each was killed by exactly the intended new test (1-2 failures each).

Gates and tests (worktree): `yarn eslint resources/js/engine` clean; `yarn prettier --check resources/js/engine` clean; `yarn vue-tsc --noEmit` clean; `yarn vitest run --project engine` -> Test Files 34 passed, Tests 1110 passed.

Log in 19 (rulings): furniture wall-attach is independent of `kinds.on_face`; face priority corner > alignment > centre; free coordinates use the raw step.
Note: ruling 4 says "1 mm only with Alt". The Alt / disabled early return still rounds to the raw step, because 04 §5.8-1 and `snapPoint` §5.5-1 both say so; only the opening snapper uses 1 mm for Alt (§5.7-6). Say if footprint Alt should be 1 mm.
