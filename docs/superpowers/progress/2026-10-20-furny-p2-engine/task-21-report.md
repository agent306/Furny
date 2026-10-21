# Task 21 report: plan command pipeline, post-process, room-meta reconciliation

Status: DONE_WITH_CONCERNS (concerns are spec readings and one budget number, listed below)

Commits (branch build/p2-engine, base 1377cfa):
- 8ef3676 test(engine): make the bus no-op seal test bite and rename undoAtCap (Task 20 leftover)
- b64c9de feat(engine): add plan command pipeline with post-processing and room re-association

## What was implemented

Files (all under resources/js/engine):
- plan/commands/paths.ts: `planPathToEntityId` (04 §6.3). Whole-collection paths and any unknown top-level key give `'*'`; `['background']` alone gives `'background'`, `['view']` alone gives `null`.
- plan/commands/pipeline.ts: `PlanCommandContext`, `PlanDefaults`, `defaultPlanDefaults(doc, exteriorThickness = 230)`, `PLAN_COMMAND_ERROR_CODES` (22 codes, 04 §6.7), `planCommandMessage(code, params)`, `executePlanCommand` (04 §6.4 steps 1-5), `planPipeline`.
- plan/commands/postprocess.ts: `postProcess(draft, info, out)`: orphan nodes, dimensions, placements, `reconcileRoomMetas`; only entities related to `changed`.
- plan/commands/define.ts: `definePlanCommand<P, R>`.
- plan/commands/registry.ts: `PLAN_COMMANDS` (empty), `PlanCommandType`, `createPlanBus`.
- plan/reconcile.ts: `reconcileRoomMetas` (04 §4.4 b items 1-7). Uses `isAnchorInsideRoom` from rooms.ts for every anchor-in-room test (holes excluded); no second containment helper.
- index.ts: exports of all of the above.
- Tests: plan/commands/__tests__/pipeline.test.ts (44 tests), plan/__tests__/reconcile.test.ts (13 tests).

Binding carries applied:
- `isAnchorInsideRoom` is the only containment test in reconcile (a dedicated island test fails if the holes are ignored).
- `planPipeline` uses `shouldAutoFreeze()` for both mutative `create` calls.
- The pipeline uses the deriver in the context. `createPlanBus` owns one `createPlanDeriver()`, and `getContext(doc)` derives `doc` eagerly, so the before-geometry is cached and `validatePlan(doc, ctx.geometry)` does not re-derive.
- `introduces_error` is emitted only for keys in `planErrorKeys(after) \ planErrorKeys(before)`, with `params.issue` = the code of the first new key. Dirty plans stay editable (tested with `makeDirtyPlan()`, in both directions).
- Params are not parsed in the pipeline: the bus parses them (preflight I5 option 2, accepted in progress.md).

Leftover from Task 20 review (commit 8ef3676): the old no-op test was vacuous because undo had already sealed the top. A new test starts from a single unsealed `inc` execute, runs a no-op `zoom`, and asserts `sealed === true` and that the next merge starts a new entry. Mutation check: removing `if (!merging) sealTop()` in bus.ts fails it. The old test keeps its other assertions (no entry, no event, redo kept). `capHit` renamed `undoAtCap` in bus.property.test.ts.

## Tests and TDD evidence

RED (reconcile): `yarn vitest run --project engine resources/js/engine/plan/__tests__/reconcile.test.ts` failed with "Failed to load url ../reconcile ... Does the file exist?" (module not written yet; expected).
RED (pipeline): same for `../pipeline`, `../registry`, `../define`, `../paths` (modules written after the test file).
GREEN: `yarn vitest run --project engine resources/js/engine/plan/commands resources/js/engine/plan/__tests__/reconcile.test.ts` gives 2 files, 57 tests passed. Full engine project: 43 files, 1541 tests passed. `yarn eslint resources/js/engine`, `yarn prettier --check resources/js/engine`, `yarn vue-tsc --noEmit`: all clean (no output / "All matched files use Prettier code style!"). The engine purity test is in the full run and passes.

Non-vacuity (mutations, each reverted, each made a named test fail): reconcile merge winner by area, anchor-holder-first candidate pick, same-faceKey shortcut, anchor clearance, labelOffset reset, hole-blind orphan lookup; pipeline orphan-node delete, dimension recompute, dimension delete, wall-gone detach, related-wall filter for dimensions and for placements, does-not-fit centring, invariant check, inverse-patch order, `touchesGeometry` gating.

Test list highlights:
- planPathToEntityId: the six brief rows plus 14 more.
- Pipeline: orphan node (and an unrelated orphan survives); dimension left/right/center recomputed and rounded, unrelated stale dimension identity-preserved; dimension deleted with its wall and listed in `deletedIds`; placement follows a parallel move (x,y,rotation exact), a slanted wall (on the face, same distance along, rotation = `rotationFromFront` rounded to 0.01), clamps to a shortened face, centres when wider than the face, detaches when the wall is deleted, ignores unrelated walls; no phase 2 for `touchesGeometry:false`; patches = p1+p2 and inverse = i2+i1 (apply/undo deep-equal); duplicate wall gives `introduces_error` / `plan.wall_duplicate` with the doc deep-equal unchanged; dirty plan accepts a no-new-error command and still refuses a new error; CommandAbort gives an error result, other exceptions propagate.
- reconcile: all five brief scenarios plus equal-area tie (smallest id), orphan vs previous-room merge, labelOffset reset, clearance, island/hole, no metas.
- createPlanBus: 200-step replace-merge drag = 1 history entry, followers (placement, dimension) ride along, changedIds contain them, undo/redo deep-equal.

## Performance (04 §7.3), measured, not optimised

200-step replace-merge node drag through `createPlanBus` (node y moved by up to 150 mm, 3 reps, last rep timed, Node 22, this container):

| Fixture | avg ms/step | p50 | p95 | max |
|---|---|---|---|---|
| buildHdb3Room (37 walls, 10 metas), T-node A | 4.62 | 4.60 | 5.75 | 8.90 |
| buildHdb3Room, T-node B | 7.94 | 7.51 | 10.71 | 17.70 |
| makeGridPlan(7,6) (97 walls, 40 doors, no metas) | 7.99 | 7.77 | 9.87 | 15.86 |

Budget row "executePlanCommand('moveNode', finalize false) incl. derive, 97-wall plan": target <= 6 ms, CI assert <= 12 ms.
- A plain (non-merge) `executePlanCommand` step on makeGridPlan(7,6) averages 5.4 ms, of which 5.35 ms is `ctx.derive` (the single incremental derive of the moved node). That meets the 6 ms target and is the same ~5 ms warm derive already noted in progress.md (Task 50 revisit).
- Through the bus, a replace-merge step averages about 8 ms on the 97-wall plan: it re-derives the base (undo of the previous step) and then the new document, roughly two incremental derives per step. That is under the 12 ms CI assert and over the 6 ms target. This confirms the Task 20 carry ("replace-merge re-derives on fresh apply(); check at Task 50").
- `reconcileRoomMetas` costs 0.17 ms per step on HDB (not a hotspot); `validatePlan` of a fresh 97-wall doc is 0.34 ms with no metas.
- Cold derive of makeGridPlan(7,6) measured 7.4 ms (target 15).

## Deviations and spec readings (please confirm)

1. `createPlanBus` has an optional `registry` option (default `PLAN_COMMANDS`, empty now). Without it the bus cannot be exercised or benchmarked before Task 23 adds commands. Additive.
2. `PostProcessInfo` has two fields beyond 04 §6.4: `doc` (the phase-1 result, read instead of draft proxies) and `footprints` (needed for the width of an attached placement, since `postProcess` takes no ctx).
3. Anchor clearance uses the signed distance (`signedDistToPolygon`), so an anchor outside the net polygon always counts as too close even if it is more than 100 mm from the boundary (a thick wall band). The spec's unsigned wording would leave such an anchor in the wall. When the anchor is moved, the target is `roundPoint(polylabel(net).point)`, identical to `labelPoint` for rooms without a `labelOffset` but not skewed by an offset label. A move that rounds to the same coordinates writes nothing and is not reported.
4. Areas: the 0.2 overlap ratio uses centre-line face areas (same polygons as the intersection); the merge rule uses the previous room's `areaMm2` (net area, what users see). Overlap ties use a 1 mm2 tolerance, then the smaller `faceKey`.
5. Item 3.3 is literal: with a previous room but no candidate, the meta stays orphaned even if its anchor sits inside some next face (derive then associates it by anchor).
6. Phase-2 deletions (orphan nodes, deleted dimensions, merge-loser metas) are appended to `out.deletedIds`, deduplicated.
7. Rotation written by follow-up is `round(normDeg(r) * 100) / 100` (exact 5.71, not 5.7099999999999795 as `snapFootprint`'s `cleanRotation` would give). snapFootprint was not touched.

## Concerns

- Merge rule on dirty plans: a pre-existing duplicate meta (two metas in one face, `room_meta_duplicate`) has no `prev` for the loser, so it counts as an orphan with area 0 and is deleted by the first geometry command (undo restores it). This follows 04 §4.4 b-4 literally, but it means a geometry command can delete a meta unrelated to its edit. Worth a line in 19.
- Replace-merge drag is ~8 ms/step on a 97-wall plan, above the 6 ms target (below the 12 ms CI assert). Left for Task 50 as ruled.
- `createPlanBus` derives eagerly in `getContext` even for commands that refuse in `validate` (cheap on a cache hit; a lazy getter would save one derive on refused commands only).

## Files changed
- resources/js/engine/commands/__tests__/bus.test.ts, bus.property.test.ts (leftover)
- resources/js/engine/index.ts
- resources/js/engine/plan/reconcile.ts, plan/__tests__/reconcile.test.ts
- resources/js/engine/plan/commands/{paths,pipeline,postprocess,define,registry}.ts, commands/__tests__/pipeline.test.ts

# Fix round 1

## Commits
- refactor(engine): share one id comparator (item 7)
- perf(engine): cache the replace-merge base and memoise plan derivation (item 4)
- fix(engine): scope room reconciliation to affected faces and recompute neighbour walls (items 1-3, 5, 6)

## Rulings applied (log each in spec 19)

1. Reconcile scope (refines 04 §4.4 b).
   - `reconcileRoomMetas(draft, prevGeom, nextGeom, affected?)`: `affected` is a set of faceKeys. Omitted (the 3-argument form) means every face is affected.
   - `postProcess` computes it (`affectedFaceKeys`). A face is affected when its faceKey exists in only one of the two geometries, OR one of its wallIds is in the core related walls (changed walls plus walls incident to changed nodes), OR a meta that the command itself changed (id in `changed`) lives in it (its previous face, or the next face containing its anchor). `changed` containing `'*'` means undefined (all).
   - For a meta with a previous room: if its faceKey survives and is not affected it is skipped entirely, so anchor maintenance and the labelOffset reset (item 6) also act only on affected faces. A vanished faceKey is always followed. An orphan is processed only if the next face holding its anchor is affected.
   - The affected-face test uses the core related walls, not the one-hop `reach` of ruling 2. With the extra hop a neighbouring room would count as affected and the "move A's corner, B and C stay byte-identical" probe could not hold.
   - Derive-level duplicates are never deleted or moved by reconcile: in the orphan path a meta whose anchor lies in a `prevGeom` face owned by a different meta is skipped. This closes the concern in the first report (a pre-existing duplicate was deleted by an unrelated geometry command).
2. Neighbour walls. `Related` has `walls` (core) and `reach` = core plus every wall sharing a node with a core wall (one hop, nodes of walls removed by the command included). Dimension and placement follow-ups use `reach`; orphan-node deletion and face scope use the core sets.
3. Pipeline-level reconcile tests (below).
4. Merged-drag performance. `bus.ts` keeps `{ seq, doc, base }` for replace merges and reuses `base` only while `top.seq` matches and `doc` is exactly the document the last merge produced. It is cleared by undo, redo, reset and a dropped merge, and any other document change misses it. `createPlanBus` puts a 2-slot identity memo (most recently used first) in front of `deriver.derive`.

## Tests added or changed
- reconcile.test.ts (13 -> 23): scope (3-argument form affects all faces; unaffected faces byte-identical; affected-face metas still maintained; derive-level duplicates never deleted); MIN_OVERLAP_RATIO (16.7% overlap leaves the meta orphaned, 25% follows); faceKey tie-break (both mirrorings); signed clearance in a 600 mm wall band; `-0` anchor (trapezoid whose label point is (-0.27, -28.17)); the island test now starts from an unclosed plan so both metas are true orphans (it fails if hole containment is dropped).
- pipeline.test.ts (44 -> 53 plus bus drag test): full `toEqual` of the 22 error codes; dimension rounding on a slanted wall (integers and equal to `roundMm` of the derived face); unrelated walls two hops away stay identical; neighbour probes (side wall thickness 200 -> 400 recomputes the top wall's left dimension and clamps a placement at the face end to x=4300; deleting the right wall recomputes the dimension); `deletedIds` dedupe; pipeline-level reconcile (loser in `deletedIds`, one meta left, `inversePatches` restore both; B and C metas untouched when A's corner moves; no deletion with 3 metas in a 9000x4000 room; a changed meta's face is affected; an affected-face anchor is moved); bus test that deletes a meta mid-drag, restores it when the drag moves back, then undoes in one step.
- bus.test.ts: four base-cache tests (one revert per drag; new entry with the same key gets a new base; refused step keeps the base; dropped merge clears it).
- New test helper plan/testing/strip.ts (`strip`, `metaFactory`), shared by both test files.

## Mutation checks (scratch only, each reverted)
Each of these makes at least one named test fail: MIN_OVERLAP_RATIO to 0; reversed faceKey tie-break; unsigned clearance; no `+ 0` on the anchor; no derive-level-duplicate skip; scope always true; `mm` identity; `reach` replaced by core walls (dimension and placement); no dedupe in `pushDeleted`; no `pushDeleted(out, deletedMetaIds)`; `affected` always undefined; no wall-based affected rule; no changed-meta rule; blind hole containment; no anchor-holder-first. For the bus cache: `mergeBase !== null` forced false fails three tests; removing either the `seq` or the `doc` identity condition alone passes (they are redundant, as every document change also seals the top), removing both fails the cache and property tests.

## Performance, re-measured (200-step replace-merge drag through createPlanBus, last of 4 repetitions timed)
| Fixture | avg ms | p50 | p95 | max |
|---|---|---|---|---|
| makeGridPlan(7,6), 0 metas | 3.18 | 3.22 | 4.27 | 7.37 |
| makeGridPlan(7,6), 42 metas | 4.76 | 4.76 | 5.99 | 16.41 |
| buildHdb3Room T-node A | 1.97 | 2.03 | 3.13 | 4.88 |
| buildHdb3Room T-node B | 3.28 | 3.64 | 4.56 | 7.65 |

Before the fix: 7.99 ms avg (97 walls, 0 metas) and 4.6 / 7.9 ms (HDB). Targets (avg <= 6 ms, p95 <= 12 ms with metas) met; max values are single GC-sized outliers. The one-hop `reach` adds one pass over the walls per command and is not visible in these numbers. The 2-slot memo gets the base hit on every step where phase 2 leaves the document unchanged; when phase 2 edits something the base is evicted and re-derived incrementally, which the numbers above include (HDB metas run phase 2).

## Verification
- `yarn vitest run --project engine`: 43 files, 1564 tests passed.
- `yarn eslint resources/js/engine`, `yarn prettier --check resources/js/engine`, `yarn vue-tsc --noEmit`: clean.
- bus.property.test.ts passes.

## Notes
- `cmpId` now lives in resources/js/engine/compare.ts and replaces the copies in derive, validate, walls, rooms (was `cmpStr`) and reconcile. Other files with their own `cmp` (snapShared, conflicts, buildPlanDrawing) were left alone (outside the five named).
