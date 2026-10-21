# Task 28 report: translate, nudge, fragment, delete + invariant property tests

**Status:** DONE_WITH_CONCERNS (all gates green; concerns are below. None of them blocks the task.)

**Commits** (pushed to `origin/build/p2-engine`):
- `9665bb6` feat(engine): add selection-wide plan commands and command invariant tests
- `1c0ba0e` refactor(engine): test the dimension offset clamp, unexport scaledPoint, fix limits header

## What I implemented

### `plan/commands/entities.ts` (new)
- **`PlanFragment` type.** It matches the 04 §6.6 type exactly. Its schema reuses the document's own record schemas (`PlanDocumentSchema.shape.*`), so entity shape and key = id are enforced. A key that differs from its id gives `invalid_params`.
- **Id handling.** Ids are classified by prefix (`n_ w_ o_ r_ f_ x_ d_ t_`) or as `'background'`.
  - Every id must exist, else `not_found { id }`.
  - `'background'` without a background is also `not_found`.
  - An unknown prefix is `not_found`.
- **`translateEntities`** (replace merge, `translate:{cyrb53(sorted unique ids joined ',')}`).
  - Moves the nodes of the selected walls plus the selected nodes, each once.
  - Walls with one moved end stretch. If such a wall drops below 10 mm, the command is refused `wall_too_short`. Openings on stretched walls are re-fitted with `reclampOpenings`, which keeps the distance to the fixed end.
  - Moves the selected free placements, fixtures and labels, and the selected unattached dimensions.
  - Moves a RoomMeta anchor only when every wall of its face (from `ctx.geometry`) has both nodes moved.
  - Moves `'background'` only when it is unlocked. A locked background stays where it is, with no refusal.
  - A placement attached to a moving wall follows the wall in post-process. A selected attached placement whose wall does not move is translated and detached.
  - Range checks: `dx`/`dy` within ±MAX_SPAN, and every moved point within ±MAX_COORD (`out_of_range` on `position.x/y`).
  - `finalize`:
    1. Each moved node within 5 mm of an unmoved node is snapped onto it.
    2. Walls whose length changed get a length check and an opening re-fit.
    3. `mergeNodeInto` merges the snapped nodes.
    4. `splitIntersections` runs on every surviving wall at a moved node.
- **`nudgeEntities`.** Same logic with `finalize` always on; compose merge, `nudge:{hash}`.
- **`insertFragment` → `{ idMap }`.**
  - Fragment nodes are resolved lazily with `resolveEndpoint`, so they join existing nodes and make T junctions. Walls go in with `insertWallSegment`, so pasted walls split and join existing ones.
  - A fragment wall that existing walls already cover end to end is skipped up front, so the walls under it are not split. A `wall_duplicate` from `insertWallSegment` is treated as "nothing to paste", following the `addWallChain` precedent.
  - Openings go on the pasted piece that holds their centre. They are dropped with the `fragment_opening_dropped` warning (`params.openingId`) when there is no such piece, when they don't fit (more than 5 mm of clamp needed), or when they would overlap.
  - Pieces on parts that existing walls covered are excluded, so an opening is never put on a split-off part of an existing wall.
  - Rooms, placements, fixtures, dimensions and labels get new ids and offset coordinates. Attachments to fragment walls are remapped to the nearest pasted piece; other attachments are cleared.
  - Validation: `dx`/`dy` range, every shifted point in range, wall ends present in the fragment (`not_found`), and `too_large` capacity for walls, openings, placements and fixtures.
- **`deleteEntities` → `{ deletedIds }`.**
  - Walls run first, in one `removeWalls` pass: the selected walls plus the walls at selected nodes. This is the same cascade and collinear re-merge as `deleteWalls`/`deleteNode`.
  - Then any selected openings, rooms, placements, fixtures, dimensions and labels that still exist, then the background.
  - `pushDeleted` dedupes, so nothing is deleted or listed twice.
- **Rulings** (ledgered for the spec 19 reconciliation) are listed in the file header.

### Other files
- `walls.ts`: `removeWalls` is now exported (used by `deleteEntities`).
- `registry.ts`: spreads `ENTITY_COMMANDS`; `PLAN_COMMANDS` now has 43 entries.

### Task 27 Minors
1. `plan.test.ts`: new test "clamps a scaled dimension offset at ±50000". Offset 40000 with factor 2 gives 50000, and −40000 gives −50000.
2. `plan.ts`: `scaledPoint` is no longer exported. Nothing outside the file used it.
3. `limits.ts` header now says that `validatePlan` uses only the size limits and the wall/opening ranges. The `validators.ts` header had the same claim; it now says "some of them shared with `validatePlan`".

## Tests

- `entities.test.ts` (26 tests): every Step 1 case from the brief, plus:
  - free entities and the unlocked background are moved;
  - attached placements follow their wall or are detached;
  - finalize splits crossed walls;
  - refusals: `not_found` (unknown id, unknown prefix, missing background), `wall_too_short`, `out_of_range`;
  - a replace drag merges into one entry and a zero move adds no entry;
  - the partly covered paste case;
  - a missing fragment node gives `not_found`, an out-of-range paste gives `out_of_range`, a bad record key gives `invalid_params`;
  - deleting a node, meta, fixture or opening by id.
  - Undo deep-equals the original wherever a command succeeded.
- `invariants.test.ts`:
  - **Setup:** `mulberry32(1234)`, 500 sequences of length 1–8 on `makeGridPlan(3,3)`. Commands are drawn from all 43, with in-range params based on each command's ranges.
  - **Ids:** about 10 % are unknown.
  - **Draw bias:** a command whose collection is empty is drawn again 85 % of the time. Without this, commands like `moveFixture` almost never succeed.
  - **Merges:** about 50 % of commands that have a `mergeKey` run with `merge: true`, and about 20 % of steps seal first.
  - **Checks after each successful command:** error keys ⊆ previous keys, `PlanDocumentSchema` still parses, and history ≤ 200.
  - **Checks after each sequence:** undoing everything deep-equals the start document.
  - **Coverage guard:** at most 3 commands may never succeed. With this seed all 43 succeed at least once.
  - Separate tests check that a generator exists for each of the 43 commands, and that 230 commands leave exactly 200 history entries.
- `dirty-import.test.ts` (9 tests):
  - `makeDirtyPlan` starts with only the out-of-bounds window error.
  - It derives with every number finite.
  - `moveNode` (two cases), `addWall`, `deleteWalls`, `addOpening` and `setRoomMeta` each succeed without adding errors.
  - `moveOpening` clears the window error, leaving zero errors.

**Property test runtime:** 3.8–5.2 s alone and 8.4 s inside the full parallel suite, within the 15 s limit.

### TDD evidence
- I drafted the implementation before the tests, so this is not a strict test-first record.
- **RED:** the three new test files were run with `ENTITY_COMMANDS` removed from the registry: `yarn vitest run …/entities.test.ts …/invariants.test.ts …/dirty-import.test.ts`.
  - Result: `Test Files 2 failed | 1 passed (3)`, `Tests 27 failed | 11 passed (38)`.
  - The entity tests failed with `command bus: unknown command "translateEntities"`.
  - `dirty-import.test.ts` passed. That is expected: it only exercises earlier commands.
- **Partial-coverage case, RED then GREEN:** with the covered-span filter disabled, the test failed with `expected [] to deeply equal [ { openingId: 'o_0000000001' } ]`. It passed once the filter was restored.
- **GREEN:** final gate runs, all exit code 0:
  - `yarn eslint resources/js/engine`
  - `yarn prettier --check resources/js/engine` ("All matched files use Prettier code style!")
  - `yarn vue-tsc --noEmit`
  - `yarn vitest run resources/js/engine`: `Test Files 56 passed (56)`, `Tests 2113 passed (2113)`.
  - Output is clean.

## Earlier-command bugs found by the property test

**None.** No successful command added an error, broke the schema, threw, or failed to undo cleanly. This holds for seed 1234 and also for six extra local runs (seeds 1–6, 1500 sequences each, about 9000 sequences in total; not committed).

The invariant is enforced inside the pipeline (`introduces_error`), so the bus-level property is mostly a check that nothing bypasses that net. The checks that could catch real bugs are the ones on top of it: nothing throws, the schema still parses, undo round-trips cleanly, and the history cap holds.

## Concerns

1. **Commands rely on the `introduces_error` net for duplicate walls.**
   - **What happens:** `splitIntersections` splits a wall at nodes near its interior even when an existing wall already joins that pair of nodes. That produces `plan.wall_duplicate`, and the pipeline then refuses the command.
   - **In random runs:** `setWallLength` (6–17 per run), `moveNode` (1–3) and `addWallChain` (1) were refused this way. This is allowed by your ruling, since a refusal is a valid outcome.
   - **On the dirty import it is visible to the user:** because of the overlapping wall (b), every finalized move that touches the top wall is refused `introduces_error (plan.wall_duplicate)`. Examples: `moveNode` of corner (0,0) or (5000,0) with `finalize: true`, and `moveWall` of the left or right wall. The dirty-import tests pass because they use moves that avoid the top wall.
   - **Proposed follow-up (not done here, because it changes Task 21 helpers):** in `splitIntersections`/`splitAtNode`, when a new piece would duplicate an existing node pair, fold it into the existing wall the way `mergeNodeInto` does. Keep the smaller id and hand the openings over.
2. **`idMap` gaps** (`insertFragment`, ledgered). These fragment ids have no entry:
   - walls that were fully covered or whose ends resolved to one node;
   - dropped openings;
   - nodes that no pasted wall uses.

   A node that joined an existing node maps to that existing id, not to a fresh `newId`. Your ruling "idMap covers every entity type" holds when nothing is dropped, and the test checks full coverage in that case.
3. **`insertFragment` and `wall_duplicate`.** A pasted wall whose `insertWallSegment` raises `wall_duplicate` may already have split the walls it crossed before raising. `addWallChain` has the same precedent. The covered-wall pre-check avoids this in the common case of pasting in place.
4. **`deleteEntities` with `'background'` when there is none** is `not_found`. I read "every id must exist" as covering it.
5. **`translateEntities` T-snaps only to nodes.** A moved end dropped onto the middle of an unmoved wall touches it without making a T junction, because spec 04 only asks for node merges. `moveNode` does snap to walls.

## Files changed
- `resources/js/engine/plan/commands/entities.ts` (new)
- `resources/js/engine/plan/commands/registry.ts`
- `resources/js/engine/plan/commands/walls.ts` (export `removeWalls`)
- `resources/js/engine/plan/commands/plan.ts` (unexport `scaledPoint`)
- `resources/js/engine/plan/commands/validators.ts` (header)
- `resources/js/engine/plan/limits.ts` (header)
- `resources/js/engine/plan/commands/__tests__/entities.test.ts` (new)
- `resources/js/engine/plan/commands/__tests__/invariants.test.ts` (new)
- `resources/js/engine/plan/commands/__tests__/dirty-import.test.ts` (new)
- `resources/js/engine/plan/commands/__tests__/plan.test.ts` (offset clamp test)

---

## Fix round 1

**Status:** DONE. **Commit:** `9a7b875` fix(engine): fold duplicate split pieces, harden the command property test (pushed).

**Correction to the first report.** It said "With this seed all 43 succeed at least once". That was wrong: `setPlacementProps` never succeeded, and the old guard (at most 3 commands may never succeed) let it through. The guard is replaced; see B.

### A. Fold duplicate split pieces (queued ruling)

**What changed in `helpers.ts`:**
- **`splitAtNode`.** After a split, it checks both pieces. A piece that joins two nodes another wall already joins is folded into that existing wall: the existing wall keeps its id and properties.
- **`foldWall`.** This is the single fold helper. It is shared with `mergeNodeInto`, which now uses it with `conflict: 'delete'` and keeps its old behaviour. The split path uses `conflict: 'refuse'`.
  - It re-projects openings by their centres, flipping hinge and swing when the two walls run opposite ways.
  - An opening that would overlap one already on the existing wall refuses the split with `opening_overlap`.
  - An opening that was already out of bounds is clamped where possible, otherwise kept as it was.
  - Placement attachments move to the kept wall (side flipped if reversed). Dimension attachments move too (face flipped unless `center`).
- **`splitIntersections` cut loop.** The part still to cut is now looked up as the wall joining the last cut to the original far end `b`. That wall may be the folded-into wall, running either way.
- **`splitCrossedWalls`** skips a wall that an earlier fold already deleted.
- The ruling is recorded in the `helpers.ts` header, ledgered for the spec 19 reconciliation.

**Tests added:**
- `helpers.test.ts`, under `splitIntersections`:
  - fold into a reversed existing wall, then cut that wall again; the kept wall's props win; opening, placement and dimension are rehomed and flipped; no `wall_duplicate`;
  - `opening_overlap` refusal.
  - Both fail with the fold disabled.
- `moves.test.ts`: the `setWallLength` case from property-test sequence 46. It fails with `introduces_error` on the old helpers.
- `dirty-import.test.ts`:
  - finalized `moveNode` of corner (0,0)→(−300,0) and (5000,0)→(5300,0); the middle piece is folded into the overlapping wall;
  - finalized `moveWall` of the left and right walls.
  - All succeed with no new errors and undo to a deep-equal document. Both tests fail with the fold disabled.

**Net-off measurement.** I disabled the pipeline's `introduces_error` check temporarily (reverted afterwards) and re-ran the property test:
- seed 1234: no additions at all, `setWallLength` included;
- seeds 1–5 at 1500 sequences each, with the new setup and generators: no additions either.

### B. The property test is no longer vacuous

**Setup steps.** Every sequence first runs seeded setup steps through the bus, inside the invariant, checked like any other step:
- `setBackground` (unlocked);
- `addPlacement` twice: one free, one attached to a random wall;
- `addFixture`;
- `addDimension` twice: one free, one attached;
- `addLabel`;
- `setRoomMeta` on a random face;
- `splitWall` 500 mm from a random wall end, which makes a straight degree-2 node.

The bus' footprint provider knows every design id.

**Targeted generators:**
- `mergeCollinearWalls` picks a node with exactly two walls running straight on, 90 % of the time.
- `setPlacementProps` always sends a changing prop.
- Fragments are empty less often.

**Coverage guard.** Every command needs at least 5 random-phase successes that change the document (`bus.getDoc() !== before`); setup steps are not counted. On failure the guard prints the full table. I checked that it catches a broken command: a `setPlacementProps` whose `validate` always refuses fails the guard.

**Final per-command table** (`mulberry32(1234)`, 500 sequences; document-changing random-phase successes):

| Command | Count | Command | Count | Command | Count |
|---|---|---|---|---|---|
| addDimension | 51 | addFixture | 48 | addLabel | 28 |
| addOpening | 12 | addPlacement | 33 | addWall | 26 |
| addWallChain | 20 | calibrateBackground | 54 | deleteDimensions | 39 |
| deleteEntities | 52 | deleteFixtures | 50 | deleteLabels | 50 |
| deleteNode | 62 | deleteOpenings | 38 | deletePlacements | 56 |
| deleteRoomMeta | 47 | deleteWalls | 43 | flipOpening | 38 |
| insertFragment | 57 | mergeCollinearWalls | 45 | moveFixture | 57 |
| moveNode | 43 | moveOpening | 34 | movePlacement | 45 |
| moveWall | 29 | nudgeEntities | 33 | removeBackground | 51 |
| rescalePlan | 54 | resizeOpening | 16 | rotatePlacement | 51 |
| setBackground | 57 | setBackgroundProps | 43 | setDimension | 44 |
| setFixtureProps | 39 | setLabel | 44 | setOpeningProps | 22 |
| setPlacementProps | 52 | setPlanMeta | 50 | setRoomMeta | 47 |
| setWallLength | 36 | setWallProps | 31 | splitWall | 38 |
| translateEntities | 47 | | | | |

The minimum is 12 (`addOpening`).

**Runtime:** 7.6 s alone; 9.3–11.6 s inside the full parallel suite, so within the 15 s limit.

**Earlier-command bugs exposed by the higher coverage:** none. Seed 1234 plus seeds 1–5 at 1500 sequences, with the net on and with it off, found no error added, no exception, no schema break and no undo mismatch. The only earlier-command defect in this round is the duplicate-split issue fixed in A.

### C. Anchor during a merged drag
Two tests added to `entities.test.ts`:
- **Merged drag.** A replace-merged drag of a whole room (dx 100, then 250, then 400 with finalize) moves the RoomMeta anchor to `2500 + dx` at each step. The steps do not accumulate. It ends as one entry and undo restores.
- **Base geometry.** A probe command on a custom registry records `ctx.geometry.docRef` on every replace re-run.
  - The first run sees the start document by identity.
  - The re-runs see a document deep-equal to the start, not the previous step.
  - This confirms that `ctx.geometry` is the base document's geometry. The bus calls `pipeline(base, …, getContext(base), …)`.

### D. Minors
1. **Reversed-piece flip and dimension filter.**
   - The hinge/swing/side/face flips for a reversed pasted piece are removed as unreachable. `insertWallSegment` lays pieces `from → to`, a split keeps a wall's direction, and a pasted piece is never folded into another pasted wall, since that wall would have to overlap it. The reasoning is in the `fragment.ts` header.
   - The unattached-only filter has a test: a dimension attached to an isolated wall, selected together with a moving wall, stays exactly as it was. The mutant `(id) => true` now fails it.
2. **No more swallowed `wall_duplicate`.**
   - `insertFragment` first does a dry run of each fragment wall's endpoint resolution and insertion on `create(current(d))`, with scratch ids.
   - A wall that would add nothing (covered end to end, or both ends resolving to one node) is skipped before anything is split or created.
   - The `wall_duplicate` catch is gone: an unexpected refusal now refuses the whole paste, so no partial split can survive. This replaces the old coverage pre-check.
3. **File split.** `insertFragment`, `PlanFragment` and the fragment helpers moved to `plan/commands/fragment.ts`, which exports `FRAGMENT_COMMANDS`; `registry.ts` spreads it. `entities.ts` is now about 520 lines.
4. **Hash dedupe.** Noted in the `entities.ts` header, ledgered for the spec 19 reconciliation.

### Gates (fix round)
All exit code 0:
- `yarn eslint resources/js/engine`
- `yarn prettier --check resources/js/engine` ("All matched files use Prettier code style!")
- `yarn vue-tsc --noEmit`
- `yarn vitest run resources/js/engine`: `Test Files 56 passed (56)`, `Tests 2121 passed (2121)`.

One intermediate failure, now fixed: `engine purity` flagged the comment text "the document." in `fragment.ts`, and I reworded it.

### Files changed (fix round)
- `plan/commands/helpers.ts`
- `plan/commands/entities.ts`
- `plan/commands/fragment.ts` (new)
- `plan/commands/registry.ts`
- `__tests__/helpers.test.ts`, `moves.test.ts`, `dirty-import.test.ts`, `entities.test.ts`, `invariants.test.ts`
