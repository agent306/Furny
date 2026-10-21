# Task 12 report: createPlanDeriver incremental caching (+ two ruled extras)

Status: DONE

## Commits
- 520ba06 fix(engine): no netRect for rooms with holes; dropped faces are not exterior (extras a, b)
- 2323628 perf(engine): cache plan derivation incrementally by entity identity (Task 12)
(Pushed to origin build/p2-engine.)

## Extras (controller ruling), TDD
- RED: `yarn vitest run --project engine resources/js/engine/plan/__tests__/rooms.test.ts` -> 2 failed (netRect for room with hole was `{width:9770,depth:7770}`; exteriorSide of the thin-gap walls was 'left').
- GREEN: same command, 24/24.
- (a) computeRoomNet: netRect = null when the net has holes.
- (b) rooms.ts analyzeRooms now tracks per wall side whether it faces no face at all (`outside`) vs a face that was dropped; `WallRoomSides` gained `exteriorSide` (side that is outside while the other side is not). derive.ts uses it. Repro (two 115 mm walls 120 mm apart in a 4000 rect) now gives exteriorSide null for both; plan boundary walls stay exterior.

## Main task
- derive.ts: `createPlanDeriver(): { derive, clear, stats }`, `DeriverStats`, `PlanDeriver`; `derivePlanGeometry` = fresh deriver per call. Caches (04 §7.2):
  1. whole result when nodes/walls/openings/rooms refs are unchanged (same doc -> same object; different doc object with equal parts -> shallow copy with new `docRef`, all parts `toBe`-shared);
  2. rooms-only change -> reuse the whole geometry core (incl. walls with room keys), only `associateRoomMetas` + indexes + issues recomputed;
  3. node joins keyed by signature string (node xy + sorted `wallId:a|b:otherXY:thickness`);
  4. per-wall memo, two levels: shape (outline/faces/safeU) keyed by wall object + endA + endB; openings/poché keyed additionally by the opening object list. An added opening therefore recomputes poché of one wall but keeps its outline identity, so union and room nets are untouched;
  5. face walk recomputed whenever nodes/walls/openings changed;
  6. per-face net+polylabel memo keyed by ring/hole coordinate string and the identity list of local outlines (outlines whose bbox overlaps the face bbox, strict overlap: outlines whose bbox only touches an edge cannot change the difference, and inclusive touching made 24 rooms recompute instead of 12 because junction outlines include the node point);
  7. wallsUnion/exteriorOutline/bbox reused when the sorted outline reference list is unchanged.
  Caches are rebuilt per derive from entries used, so they cannot grow.
- rooms.ts: `analyzeRooms` takes an optional `resolveNet` (4th param); new exports `resolveRoomNet` (computeRoomNet + polylabel), `ResolvedRoomNet`, `RoomNetResolver`. Nets now use local outlines directly as clip polygons (clipper treats them as a union) instead of the global union.
- index.ts: exports createPlanDeriver, DeriverStats, PlanDeriver, resolveRoomNet and the new types.

## Tests
`resources/js/engine/plan/__tests__/deriverCache.test.ts` (8 tests): same doc -> toBe + fullHit; view/meta change -> full hit; rooms-only -> joins/outlines/roomNets 0, association correct, deep-equal fresh; moving interior node of makeGridPlan(7,6) -> joins 5 (<=5), roomNets 12 (asserted 4..16, per preflight I2 also deep-equal to fresh derive via `expectGeomClose`); adding an opening -> outlines 1, roomNets 0, outline/wallsUnion identity kept; wall thickness change and wall removal equal fresh; clear() -> counts equal full sizes; alternating unrelated docs equal fresh.
- RED (new tests against pre-change source): 8/8 failed `createPlanDeriver is not a function`. (Implementation was written before the test file; RED was demonstrated afterwards by restoring HEAD sources.)
- GREEN: `yarn vitest run --project engine` 26 files / 696 tests pass; plan dir 9 files / 259 pass. `yarn eslint resources/js/engine`, `yarn prettier --check resources/js/engine`, `yarn vue-tsc --noEmit`, `yarn build:engine-cli` all clean.
- Rough timings (Node, ad hoc, not committed): cold 7x6 ~11 ms (target 15), warm after moveNode ~4.7 ms (target 4, CI 8), cold 22x22 ~84 ms (target 200).

## Concerns / notes
- Warm derive is about 4.7 ms vs 4 ms target; under CI assert (8 ms). Remaining cost is mostly face walk + per-derive record copying; Task 50 benches may want a look.
- Result for a non-identical doc with equal parts is a shallow copy rather than the same object (docRef must differ); brief says "identical except docRef".
- Hole-room `netRect` and `exteriorSide` semantics for a side-outside-vs-dropped-face case (outside + dropped -> 'outside side' is exterior) follow the ruling literally; log in 19 if desired.
- derive.ts is now ~650 lines.

## Fix round 1
Test gap (wall memo key was not exercised for non-geometric edits) closed; renames done.
- deriverCache.test.ts now has 14 tests. Added `createPlanDeriver edits`: wall height/kind/material/colour edits; opening move, resize, delete, reassignment (incl. to a missing wall); wall add (crossing, diagonal), wall delete, node delete; room meta labelOffset, anchor move/delete; revert to an earlier document object; seeded random edit sequences (mulberry32, 8 seeds x 30 steps over makeGridPlan(4,3)/makeLPlan/makeDirtyPlan, ~0.7 s, 10% steps revert to an earlier document). All compare a long-lived deriver with `toEqual` against a fresh derive after every step. The old "retyped" test is retitled "thickened ... removed".
- Mutation checks (temporary, each restored): deleting `prev.wall === info.wall` -> 2 tests fail (wall edits, random); dropping the net `clip` identity check -> 3 fail; dropping the union outline-identity check -> 6 fail; dropping the opening-list check -> 3 fail; dropping thickness from the node signature -> 2 fail.
- derive.ts: `prevShape` -> `reusableEntry`, removed the `cached` alias, `union_` -> `unionEntry`.
- index.ts: no longer exports `resolveRoomNet`, `ResolvedRoomNet`, `RoomNetResolver` (nothing outside plan/ imports them).
- Gates: `yarn vitest run --project engine` 26 files / 702 tests pass; `yarn lint`, `yarn typecheck`, prettier clean.
