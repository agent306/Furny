# Task 16 report: snap index, `snapPoint`, grid

Status: DONE_WITH_CONCERNS (concerns below are design choices and file size, not failures).

## What was implemented
- `resources/js/engine/plan/snapping.ts` (new): `SNAP_KINDS`, `SnapKind`, `SnapSettings`, `defaultSnapSettings(system)`, `SnapModifiers`, `SnapInput`, `SnapGuide`, `SnapMarker`, `SnapResult`, `SnapIndex` (+ item types), `buildSnapIndex(doc, geom, footprints)`, `snapPoint(input, index)`, `gridStepFor(zoom, system)`, `rawStepFor(zoom)`. All re-exported from `engine/index.ts`.
- Index (04 5.2): one Flatbush per class (`nodes`, `centerlines`, `faces`, `footprints`, `keyPoints`), each `{ tree, items }` with items aligned to insertion order, `null` when empty. Items are sorted by entity id (nodes, walls, openings, footprints), so builds are deterministic. Extra lookup maps `wallById`, `wallsAtNode`. Footprint items carry `Footprint`, `elevation`, `height` for Task 17. Key points = wall midpoints + two jamb centre points per opening.
- Algorithm 5.5 steps 1-9 with the 5.4 priority table; tolerances 5.3 (8/16 px, raw step from `rawStepFor`); grid 5.6 with literal major spacings (no float noise).
- Display angle: `normDeg(-angleOf(p - origin) deg)` per 04 2.1-10 (y-down screen angle is clockwise, so display = negated, CCW from east). Implemented from the spec formula; the (1000,900) -> (950,950) example gives 315 as a consequence. Rounded to 0.01 and re-normalised.
- Leftover Task 15 tests added to `conflicts.test.ts`: double_swing on the 30 degree wall (both leaves: hinge, closed end, open end, for swing left and right); item top exactly at door head / window head is exempt, head+1 mm is flagged (door and window variants). Note the pre-existing "taller than head" test is head+100, there was no head+1 case, so both exact and +1 are pinned.

## Tests
- `yarn vitest run --project engine resources/js/engine/plan/__tests__/snapping.test.ts`: 69 passed.
- `conflicts.test.ts`: 67 passed (6 new cases).
- Full engine suite: 32 files, 972 passed.
- Gates: `yarn eslint resources/js/engine` clean, `yarn prettier --check resources/js/engine` clean, `yarn vue-tsc --noEmit` clean.

### TDD evidence
- RED: wrote `snapping.test.ts` first; `yarn vitest run --project engine resources/js/engine/plan/__tests__/snapping.test.ts` -> "Test Files 1 failed, Tests no tests" (module `../snapping` did not exist, import failed). Expected failure.
- GREEN: first run with the implementation: 67/68 passed; the one failure was `displayAngleDeg` 15.01 vs 15 for a 15 degree ray at 3000 mm (rounding the point before computing the angle). Fixed by taking the angle towards the unrounded snap point (length stays from the rounded point). Then 68/68, later 69/69 after adding a shift guide_intersection test.
- conflicts tests were added to code that already behaved correctly (characterisation tests); the +1 cases prove they are not vacuous.

### Performance (in the normal suite, `snapPoint performance` test)
1000 calls each (mixed zoom 0.05/0.1/0.3, half with an origin, every 10th with shift), after 100 warm-up calls, three runs:
- HDB 3-room: 0.0145 / 0.0159 / 0.0174 ms per call
- 22 x 22 grid plan (`makeGridPlan(22, 22)`, 529 nodes, 1012 walls): 0.0069 / 0.0074 / 0.0097 ms per call
Assertion is < 0.5 ms (about 30x headroom). Set `SNAP_PERF_LOG=1` to print the numbers.

## Files changed
- `resources/js/engine/plan/snapping.ts` (new)
- `resources/js/engine/plan/__tests__/snapping.test.ts` (new)
- `resources/js/engine/plan/__tests__/conflicts.test.ts` (6 tests added)
- `resources/js/engine/index.ts` (exports)

## Decisions where the spec is silent or ambiguous (please check)
1. `on_face` has no way to be requested in the 5.1 `SnapInput` ("only when the tool asks for faces"), so I added an optional `includeFaces?: boolean` (default false). `kinds.on_face` stays true by default as spec says. An `on_face` result carries a `face` guide with the face segment (that is how the editor learns which face, `SnapResult` has no side field).
2. Grid (prio 9) has no distance tolerance: "nearest grid intersection if gridVisible", literal. So with the grid visible, a cursor that snaps to nothing else always gets `kind 'grid'`; `none` only when the grid is hidden.
3. Shift lock: no grid snapping while locked (otherwise the brief's (1000,900) -> (950,950) example would become (1000,1000)). Candidates must lie within EPS of the ray; guide lines and walls become "ray meets line": `guide_intersection` (guides `[angle, line]`) or `on_wall`/`on_face` at the crossing. Result kind with nothing else is `angle`. The `angle` guide is always first.
4. Extension lines are only offered when the cursor projects beyond a wall end (inside the segment it is the wall itself); reach is max(600 mm, 60 px) from the nearer end; guide runs from that node to the snap point. On a tie extension beats an identical alignment line (list order).
5. Alignment lines through nodes with equal x (or y) are de-duplicated, keeping the node closest to the cursor.
6. `jamb` key points are indexed (spec 5.2) but are not snap candidates in `snapPoint`: 5.4 defines `midpoint` as the wall midpoint only, and there is no kind for jambs. Task 17 (opening positioning) can use them.
7. Angle rays relative to `previousDir`: parallel (both directions) and perpendicular (both directions), guide kinds `parallel` / `perpendicular`, result kind `angle`; skipped when they coincide with a step ray.
8. `displayAngleDeg` is computed towards the unrounded snap point (so a 15 degree ray reads 15, not 15.01 far from the origin); with `origin === point` it is 0.
9. `endpoint` results leave `wallId` null (the spec's "endpoint-on-wall" was unclear); `intersection` leaves `nodeId`/`wallId` null.
10. Footprint index includes all fixtures (also `noConflict` ones) and all placements of known designs; Task 17 filters.
11. Guides/markers end at the rounded result point. Imperial grid points are rounded to integer mm only for the result.

## Concerns
- `snapping.ts` is about 1150 lines after prettier and Task 17 will add opening and footprint snapping to the same file (the plan says "Modify snapping.ts"). Suggest splitting the index and grid out (e.g. `snapIndex.ts`) when Task 17 starts, if the controller agrees; I did not split without plan guidance.
- `includeFaces` is a (small) addition to the spec'd `SnapInput` (decision 1).

## Fix round 1

### Behaviour changes
1. **Guide lines crossing a wall interior.** `extensionCandidates` now also returns the infinite line of walls the cursor projects onto (found through the centre-line index; no 600 mm reach rule for the interior, the rule still applies beyond an end). The old `guideIntersections` is replaced by one `crossings()` used with and without shift:
   - pass 1: wall/face x guide line (extension, alignment, angle); pass 2: guide x guide. Wall x wall stays the `intersection` point candidate.
   - wall/face x extension/alignment gives `guide_intersection` and now carries `wallId` and `u` of the wall; wall/face x angle ray stays `on_wall` / `on_face` (04 5.5-2 text) with the angle guide.
   - pass 1 runs first, so at equal distance the wall wins the tie (a wall that coincides with an alignment line reports `on_wall`, not `guide_intersection`).
   - all crossings are step-5 results (they beat lone on_wall); a lone on_wall still wins over a lone interior extension.
   - Probes: wall (0,0)-(5000,1000) + node (1500,3000), cursor (1540,320) -> guide_intersection (1500,300), also via extension only (guides [extension, alignment]) or via the wall only; origin (500,-2000), cursor (520,110) -> on_wall (500,100) with and without shift (and guide_intersection [extension, angle] when on_wall is off).
2. **`guide_intersection` toggle under shift.** The locked ray goes through the same `crossings()` which honours the toggle; off -> plain `angle` result (tested with shift and without).
3. **Exclude expansion (ruling 5).** `snapPoint` adds the walls of every excluded node (`index.wallsAtNode`) to the exclude set (copy only when `exclude` is non-empty; the caller's set is untouched). **Deviation from the literal 04 5.1** (which leaves it to the caller): log in spec 19. The now-redundant anchor-node check in the extension code was removed (an excluded node always excludes its walls).
4. `u` is set for `on_face` results (and every surface result) by projecting the final point on the wall centre line.
5. `displayAngleDeg` is still computed towards the unrounded snap point (ruling 11); **log in spec 19**: a point on a 15 degree ray far from the origin reads 15, not 15.01, after integer rounding of the result point.

### Split (ruling 4)
`snapIndex.ts` (index classes, `buildSnapIndex`, `query`; 249 lines), `grid.ts` (`gridStepFor`, `rawStepFor`, `rawPoint`, `gridPoint`; 83), `snapping.ts` (settings, `snapPoint` and helpers; 904, re-exports the above so `engine/index.ts` is unchanged). Snapping.ts is still large; Task 17 should put opening and footprint snapping in new files if it can.

### Tests added (snapping.test.ts 69 -> 119)
- Priority chain table (12 rows: endpoint>intersection>midpoint>perpendicular>guide_intersection>on_wall>alignment/extension>angle>grid>none, plus on_face>grid). Each row switches the winner off and expects the loser, and asserts the loser's point is nearer to the cursor than the winner's (so a distance-only ordering fails).
- Per-kind switch table over `SNAP_KINDS` (11 kinds).
- Same-priority distance tie-break (two nodes, cursor nearer the later one; four competing guide_intersections with the closest being last and first).
- The mislabelled intersection test renamed; intersection vs midpoint now contests in the table. Perpendicular foot-outside-segment test rewritten (origin (4050,2000), cursor (4040,-20); endpoint switched off to expose the rule, plus the in-segment counterpart).
- exclude: alignment, extension with excluded wall, extension with excluded anchor node, node-to-walls expansion (incl. far node still snappable, caller set unchanged).
- Extension reach at zoom 1 (600 mm) and 0.05 (1200 mm); intersection tolerance guard with two shallow crossing walls; alignment de-dup (both id orders); reverse parallel ray; relative ray coinciding with a step ray (0.3 degrees off) skipped and one 2 degrees off kept; `u` on on_face; index determinism with shuffled entity order (HDB, 300 random snaps and the item arrays).
- Two older tests that relied on a wall coinciding with an alignment line now use an orphan node (behaviour change 1).

### Mutation check (scratch mutants applied to snapping.ts, reverted after each)
Mutants killed: swapped/shifted priorities of endpoint, intersection, midpoint, perpendicular, on_wall, extension, angle; distance-only ordering; last-wins and first-only tie-breaks; stage order (singles before crossings, points after lines); removed intersection tolerance; perpendicular without the segment check; no exclude expansion; no exclude for extension walls; guide_intersection gate removed; no alignment de-dup (and keep-last); no interior extension; no reverse parallel ray; no step-ray skip; on_face without `u`; gi without wallId; ray x wall as gi; reach 700 mm / 30 px; no wall x guide pass; guide order under shift; every kind switch ignored (midpoint, perpendicular, intersection, endpoint, on_wall, angle, alignment, extension, grid). Surviving mutants were equivalent: changing only the numeric `prio` of perpendicular (relative to guide_intersection) or of crossings (relative to on_wall) has no effect because those orderings are structural (stages), and the stage-order mutants are killed.

### Results
Full engine suite 32 files, 1022 passed; eslint, prettier --check, vue-tsc clean. Perf unchanged: hdb 0.0135-0.0183 ms, grid22 0.0087 ms per call.
