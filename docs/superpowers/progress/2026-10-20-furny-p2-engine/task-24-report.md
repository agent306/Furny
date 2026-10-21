# Task 24 report: node/wall move commands

Status: DONE_WITH_CONCERNS (concerns are readings to confirm, see the last section).
Commit: 9aed457 `feat(engine): add node and wall move commands with drag merging` (base 136a0d9).

## What was implemented
- `resources/js/engine/plan/commands/moves.ts` (new, `MOVE_COMMANDS`), spread into `PLAN_COMMANDS` in `registry.ts`.
- `moveNode { nodeId, to, finalize }`, mergeKey `moveNode:{id}`, replace, result `{ mergedInto: string | null }`.
  - validate: node exists, `to` inside +-MAX_COORD (`out_of_range` field `to.x` / `to.y`), every incident wall >= MIN_WALL_LENGTH to the position the node ends at (`wall_too_short`).
  - run, `finalize:false`: set the position, `reclampOpenings(wall, movedEnd, oldLength)` for each incident wall. No scan of nodes or other walls, no topology.
  - run, `finalize:true`: (1) snap target = nearest other node within 5 mm; (2) else nearest non-incident wall within 5 mm (`splitWallAt`, then merge into the new T node; a drop projecting within 10 mm of the wall end snaps to that end node, as `resolveEndpoint` does); the moved node is placed ON the target, openings re-fitted for that final position, `mergeNodeInto`; (3) `splitIntersections` for each incident wall that still exists.
- `moveWall { wallId, distance, finalize }`, mergeKey `moveWall:{id}`, replace, no result. `+n = perpLeft(dir)` (left of a->b on screen, 04 §2.1). Each end: exactly one other wall, not parallel (`lineIntersection` returns null within ANGLE_TOL) and `|P'-P| <= 10*|distance| + 1000` -> slide along that wall; otherwise translate by `n*distance`. Validate: all touched walls (moved wall plus walls at both ends) >= 10 mm, new positions inside the coordinate range. Run: positions, then `reclampOpenings` (moved wall: `both` = keep offsets; neighbours: the end that moved). `finalize` -> `splitIntersections` for the moved wall and neighbours.
- `setWallLength { wallId, length, anchor }`, no merge, result `{ movedNodeId }`. Anchor `a` moves b, `b` moves a, `auto` = b if deg(b)=1, else a if deg(a)=1, else b. New position = fixed + dir*length (rounded), then exactly the `moveNode { finalize: true }` code path (same validate and run functions).

## Spec readings and choices (to log in 19)
1. Merge target (see above): the 04 §6.6 exception "walls to a node within NODE_MERGE_TOL of `to`" is read as "the wall(s) to the one merge target"; any other incident wall must still be >= 10 mm to the final position, else `wall_too_short`. A wall to the merge target is merged away with its openings, not re-fitted first (tested).
2. `mergedInto` for the wall case is the new T node's id (spec: "merge into the new node"). `setWallLength.movedNodeId` is the node that was moved; it may no longer exist after the finalize merge.
3. `moveWall` at an end with 0 or >= 2 other walls: spec is explicit (translate, walls stretch). Tested with three walls at one end (two diagonal neighbours at `a`: `a` translated; the single diagonal neighbour at `b`: `b` slid).
4. `moveWall` has no node merge on finalize (spec asks only for `splitIntersections`). `distance` is rounded to whole mm and the new node positions are rounded (so a slanted wall may differ from exact parallel by < 1 mm).
5. A finalize drop exactly on a door of the target wall aborts `split_through_opening` (from `splitWallAt`); the document stays at the previous merged step. Pre-existing opening overlaps do not block a move (Task 22 ruling, via `reclampOpenings`).
6. `distance` bound +-2*MAX_COORD (`out_of_range` field `distance`), `length` in [10, 2*MAX_COORD] (field `length`); positions beyond +-MAX_COORD give `out_of_range` field `position.x|y`.

## Tests (70, `plan/commands/__tests__/moves.test.ts`)
Registry and merge keys; moveNode (rounding, -0, not_found, range, < 10 mm, multi-wall minimum, openings: node a keeps distance to b / node b keeps offsets / diagonal / opening_no_fit for finalize true and false / clamp / pre-existing overlap / clamp-created overlap); drags (200 steps + finalize = 1 entry, undo deep-equal, redo; no topology work during finalize:false steps; merge + crossing finalize in one entry; failing finalize keeps last merged step); merge into node (3 mm, 5 vs 6 mm boundary, nearest of several, wall to the target merged away with its opening, minimum for other walls, duplicate-pair fold); wall under the drop (T split, no split without finalize, own wall is no target, end-node snap, split_through_opening, opening handed to the right part); crossings split with finalize only; followers (dimension, placement, room meta) in the same entry; moveWall (top wall of makeRectPlan(5000,4000,230) by -500 closed and rectangular, both signs, every wall of the rectangle both ways, zero distance, rounding, diagonal neighbours, slanted wall, parallel neighbour, near-parallel guard on both sides (600 slides, 800 translates), no neighbour, 3 walls at one end, T at both ends, validation, openings on moved wall and neighbours with the right movedEnd, opening_no_fit, finalize splits, 200-step drag with splitting finalize = 1 entry); setWallLength (anchors a/b, diagonal, auto in all four degree cases, openings keep distance to the unmoved end, opening_no_fit, ranges, short other wall, merge into a node, crossing split in one entry, no merging of consecutive edits). Every case asserts undo -> deep-equal (or, for refusals, the very same doc object and no history entry).
- Seeded random drag test (`makeGridPlan(3,3)`, seeds 20261021, 1, 2, 3; 120 iterations each of node/wall drags with finalize, seal, undo, redo interleaved; drop points sometimes on a node). Every undo/redo is compared with the recorded document; no step adds a validate error; at the end undo-all and redo-all. Reach (seed 20261021): 63 drags, 49 finalized, 5 merges, 5 splits, 23 undos, 8 redos; the test asserts the generator reaches merges/splits/undos/redos.
- Mutation checks (each reverted, all killed): no near-parallel guard; flipped normal; never slide; slide with >= 2 walls; no `splitIntersections` on moveNode finalize; reclamp with `none`; snapping without finalize; `auto` always b.

## TDD evidence
Implementation was drafted before the tests (I should have written tests first); RED was then shown by disabling the registry spread:
- RED: `yarn vitest run --project engine .../moves.test.ts` with `...MOVE_COMMANDS` commented out -> `Tests 70 failed (70)`, `Error: command bus: unknown command "moveNode"`.
- First GREEN run: 67/70; the 3 failures were wrong test setups (a 6 mm drop on a wall near its end correctly snaps to the end node; a drop next to a node correctly merges; frozen-doc mutation; wrong expected offset), fixed in the tests, not the code.
- GREEN: `yarn vitest run --project engine resources/js/engine/plan/commands/__tests__/moves.test.ts` -> `Tests 70 passed (70)` (about 12 s, the random tests dominate). Full: `yarn vitest run --project engine` -> 46 files, 1813 tests passed.
- Gates: `yarn eslint resources/js/engine`, `yarn prettier --check resources/js/engine`, `yarn vue-tsc --noEmit` all clean.

## Performance (04 §7.3 row "executePlanCommand('moveNode', finalize false)")
200-step replace-merge drag through `createPlanBus` with the real `moveNode`, `makeGridPlan(7,6)`, last of 4 repetitions timed (Node 22, this container), node at (9000,9000), each step an absolute target:

| Case | avg ms | p50 | p95 | max |
|---|---|---|---|---|
| moveNode, 42 metas (budget case) | 5.51 | 5.16 | 7.28 | 9.73 |
| moveNode, 0 metas | 4.30 | 4.10 | 5.24 | 8.67 |
| moveWall (two nodes move), 42 metas | 6.12 | 5.75 | 9.65 | 11.33 |

Budget (avg <= 6, p95 <= 12) is met for moveNode. The command itself costs: validate 0.013 ms, run 0.31 ms (mutative create with patches); the rest is the pipeline's two incremental derives. moveWall is slightly above 6 ms avg because two nodes change; it has no budget row but is still under 12 ms p95. All runs end in 1 history entry. No timing assertion was committed (perf tests belong to Task 50).

## Files
- new `resources/js/engine/plan/commands/moves.ts` (505 lines)
- new `resources/js/engine/plan/commands/__tests__/moves.test.ts`
- `resources/js/engine/plan/commands/registry.ts` (import and spread `MOVE_COMMANDS`)
- Not added to `engine/index.ts`: result types, like the wall commands (`PLAN_COMMANDS` is already exported).

## Self-review
- Engine purity: no forbidden tokens; imports are relative and engine-only.
- Draft reads: all positions come from the draft; the cached geometry is not used.
- Determinism: all iterations over nodes/walls sort or tie-break by `cmpId`.
- The test file is long (about 2100 lines after prettier) but follows the walls.test.ts layout; no split done.

## Concerns
1. Reading 1 above narrows the spec's exception (any node within 5 mm of `to`) to the single merge target; please confirm.
2. A finalize drop on a door aborts `split_through_opening` instead of skipping the snap; the editor must surface this on pointer-up (the drag stays at the last unfinalized step).
3. `setWallLength` with a length of 10-11 mm can, in theory, snap its moved end to the fixed end of another wall and merge the wall away; left as is (consistent with the moveNode finalize).
4. The random tests take about 11 s of the 12 s file time; reduce the iteration count if the suite time matters.

## Fix round 1

Commit: see `git log` (fix(engine): refuse self-merging and flipping moves, share plan command test builders).

Changes
1. `setWallLength` never merges its own wall away: validate resolves the snap target for the moved end and refuses `wall_too_short` when the distance fixed end -> snap point is under MIN_WALL_LENGTH (covers snapping onto the fixed end and onto a node closer than 10 mm to it). Tests: 20 degree neighbour wall that snaps a 10 mm wall onto its fixed end; node 8 mm from the fixed end.
2. `moveWall` refuses `wall_too_short` when any neighbour would reverse (dot of new and old direction <= 0); applied to every neighbour (slid or stretched). Test: `makeRectPlan(5000,300,230)` top wall at -310 (side wall would be 10 mm long but turned round, `params.length` 10); -290 still allowed. To log in spec 19.
3. Random tests: `simulate(seed, iterations)`; 50 iterations for the main seed, 3 seeds x 30 for the second test: 1.7 s total (was about 11 s); reach assertions (finalized, undos, redos, merges/splits) still hold.
4. Test: a neighbour sliding 200 mm along a 45 degree line across a vertical wall splits both walls on finalize (and not before). Mutant `touched.slice(0, 1)` fails it.
5. Test: moved wall with 45 degree neighbours, opening at offset 1000, length 3000 -> 4000 and 2000: the offset stays 1000. Mutant reclamp `'both'` -> `'a'` fails it.
6. Determinism: two incident walls crossing a third, graph built in forward and reversed insertion order: identical documents, ids and result (mutant: unsorted `wallsAt` fails). Equidistant nodes (3 mm each side) and equidistant walls: the smaller id wins in both insertion orders (mutants: no tie-break fail).
7. Boundaries: wall tolerance exactly 5 mm snaps, 6 mm does not (mutant `>=` fails); projection exactly 10 mm from an end snaps to the end node, 11 mm splits, same at the far end 5990/5989 (mutants `<` and `>` fail); `splitIntersections` after a node merge (merge into T, the walls now at T cross a third; mutant without the post-merge split fails).
8. Shared builders: `plan/testing/graph.ts` (`Graph` with node/wall/opening/placement/dimension/meta/run/abortOf, `planBus`, `busOf`, `ok`, `refused`, `oneWall`, `PROPS`, `FOOTPRINT`) now used by `helpers.test.ts`, `walls.test.ts` and `moves.test.ts`; the local copies are gone (walls.test.ts keeps a one-line `oneWall` wrapper that adds the bus).
9. `moveWall` run: the `as Map` cast is a `CommandAbort` on a non-Map.
10. `setWallLength` reports `out_of_range { field: 'length', min: 10, max }` with `max` the longest length that keeps the moved end inside +-MAX_COORD (test: 900 000 + 100 000 is allowed, 200 000 is refused with max 100 000).
11. Notes below.

Mutation checks (scratch, all reverted, each killed by the named new test): finalize on first wall only; reclamp both->a; no flip check; no self-merge check; no node tie-break; no wall tie-break; `u <` / `u >` boundaries; wall tolerance `>=`; no split after merge; unsorted wallsAt; no length reach.

Verification: `yarn vitest run --project engine`: 46 files, 1825 tests passed (moves.test.ts 82). `yarn eslint resources/js/engine`, `yarn prettier --check resources/js/engine`, `yarn vue-tsc --noEmit`: clean.

Notes for the carry list / spec 19
- P4 carry: the editor must call `bus.seal()` after every finalize (pointer-up); otherwise the next `moveNode`/`moveWall` on the same id merges into the finished drag's entry.
- Spec 19: `moveWall` refuses a neighbour reversal (item 2); `setWallLength` never self-merges (item 1); integer rounding of diagonal wall lengths (node positions are whole mm) drifts by up to 0.7 mm per wall, so a slanted `moveWall` is parallel only to within that.
