# Task 28 review: translate, nudge, fragment, delete + invariant property tests

Range: `0b34341..1c0ba0e` (commits 9665bb6, 1c0ba0e). I read the diff once, in full, in three passes. Line references are to the diff file (`review-0b34341..1c0ba0e.diff`, "D:") or to the new files.

I ran mutation and measurement checks in a scratch copy: `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/t28`. It holds a copy of `resources/js` and symlinks `node_modules`. The worktree was not changed.

## Spec Compliance

✅ **Spec compliant**, for 04 §6.6 (the four bullets), §6.8 (nudges, property test, history cap) and §6.2–§6.3 as they apply here.

**translateEntities** (D:2178-2387)
- Collects nodes: selected nodes plus the ends of selected walls, in one `Set` (D:2193-2199), so each node moves exactly once.
- Moves placements, fixtures and labels, and only the unattached dimensions (D:2243-2249).
- Moves a RoomMeta anchor only when every wall of the face has both ends moved (D:2251-2266).
- Moves `'background'` only when it is present and unlocked (D:2268-2270).
- Openings follow implicitly. On a stretched wall, `reclampOpenings` keeps the distance to the fixed end (D:2354-2363).
- `finalize` snaps each moved node to an unmoved node within `NODE_MERGE_TOL` (`<=`, D:2313), merges it with `mergeNodeInto`, then runs `splitIntersections` on every wall incident to a moved node (D:2382-2386).
- Merge key and mode: replace, `translate:{hash}` (D:2404-2405).

**nudgeEntities**
- Runs the same plan with `finalize` hard-wired to true (D:2420).
- Registered as compose, `nudge:{hash}` (D:2422-2423).

**hash**
- `cyrb53(uniqueSorted(ids).join(','))` (D:2148-2149).
- `uniqueSorted` is `[...new Set(ids)].sort(cmpId)` (validators.ts:136-137). `cmpId` compares code units, so the order does not depend on locale.
- The dedupe goes beyond the spec text; see Minor 4.

**insertFragment** (D:2644-2829)
- The `PlanFragment` type matches 04 §6.6 exactly (D:2020-2027). Its schema reuses the document's record schemas (D:2032-2041).
- Every created entity gets `newId(prefix)` and is offset by `(dx, dy)`.
- Walls go in through `resolveEndpoint` and `insertWallSegment`.
- References are rewritten:
  - opening → pasted piece (D:2721-2728);
  - placement attachment → nearest piece (D:2747-2765);
  - dimension attachment → nearest piece (D:2779-2802).
  - A reference to a wall outside the fragment is cleared.
  - A RoomMeta has no wall reference (schema.ts:136-145), so only its id and anchor change (D:2732-2742).
- An opening with no piece gets the `fragment_opening_dropped` warning, with `params.openingId` (D:2713-2717).
- `too_large` is checked in `validate` (D:2473-2489), and wall capacity again after splitting (D:2694).

**deleteEntities** (D:2841-2884)
- Splits the ids by prefix.
- Deletes walls (the selected walls plus the walls at selected nodes) first, in one `removeWalls` pass (D:2856-2862).
- Then deletes the remaining kinds, each guarded by `has` and `pushDeleted` (D:2864-2880).
- `deletedIds` is the bus array itself, so it includes the post-process cascades.

**Registry and history**
- The registry now has 43 commands (D:2957; test D:283-298).
- The history cap holds: 230 `addLabel` calls leave exactly 200 entries (D:1854-1867).

**Property test** (D:1772-1852)
- Seeded with `mulberry32(1234)`. It runs 500 sequences of length 1–8 on `makeGridPlan(3,3)`.
- Generators exist for all 43 commands. This is asserted (D:1773-1776).
- After each successful command it checks:
  - error keys ⊆ the previous keys;
  - the schema still parses;
  - history ≤ 200.
- After each sequence, a full undo must deep-equal the start document.
- It is deterministic. None of the new test files, `entities.ts`, `testing/random.ts`, `testing/ids.ts` or the fixtures uses `Math.random`, `Date` or `performance.now` (grep).
- How well it covers each command is a separate question; see Important 1.

**Dirty import** (D:91-194): it covers every case in the brief. The controller has already queued an extra test that moves a node on the overlapped wall.

**Task 27 minors**
- Minor 1, offset clamp test (D:1884-1893). It is effective: the mutant `DIMENSION_OFFSET_MAX → 1e12` at plan.ts:211-212 is now killed.
- Minor 4: `scaledPoint` is no longer exported (D:2909).
- Minor 6, limits header (D:3022-3031). I checked the claim against validate.ts:23-31: it imports only the size limits and the wall and opening ranges. Accurate.

⚠️ **Cannot verify from the diff:** that `ctx.geometry`, which RoomMeta anchors use (D:2252), is the geometry of the replace-merge base when the bus re-runs a translate on `base`. The anchor tests pass with and without merge, but none of them checks an anchor during a merged drag. The controller can check this in pipeline/bus `ctx` construction; it is a pre-existing contract.

## Strengths

- **Mutation results.** 18 of 18 mutants on the key behaviours were killed by `entities.test.ts`:
  - anchor `every→some`;
  - background lock ignored;
  - merge tolerance halved;
  - `mergeNodeInto` removed;
  - `splitIntersections` removed;
  - nudge compose→replace;
  - nudge without finalize;
  - hash unsorted;
  - placement or dimension attachment keeping the old wall id;
  - drop warning removed;
  - walls deleted last;
  - `has` and `pushDeleted` guard removed, which gives a double delete;
  - `reclampOpenings` removed;
  - covered-wall pre-skip removed;
  - nodes shifted twice;
  - pasted RoomMeta anchor not shifted.
- **The property test has teeth beyond the pipeline net.**
  - When I turned off the `introduces_error` net (pipeline.ts:242), the property test failed: `setWallLength added plan.wall_duplicate` ×6. That is exactly the queued `splitIntersections` duplicate issue, and it is the only command that relied on the net with this seed.
  - With the net on, an unrounded coordinate written by translate (`target.x + dx + 0.25`) is caught by the schema check.
  - The undo round-trip check is a real, independent invariant.
- **Clean planner/runner split.** `planTranslate` is shared by `validate` and `run`, so the two cannot drift. A refused command leaves the document identical and adds no entry; `expectRefusedUntouched` asserts `toBe` identity.
- **Careful insertFragment piece logic.**
  - Pieces are computed lazily after all walls are inserted, so later crossings are seen.
  - Covered spans are excluded, so an opening never lands on a split-off part of an existing wall. There is a RED/GREEN test for this (D:951-987).
- **Rulings are written down in the file header** (D:1917-1956), ready for the spec 19 ledger.

## Issues

### Critical (Must Fix)

None.

### Important (Should Fix)

#### 1. The property test barely exercises a quarter of the commands; one never succeeds, contrary to the report

Location: `invariants.test.ts`, coverage guard at D:1846-1851, start state at D:1785, `mergeCollinearWalls` generator at D:1408-1422, `NEEDS` and `drawCommand` at D:1737-1761.

**What I measured.** I instrumented the test in the scratch copy. The instrumentation draws nothing from the RNG, so the sequence is unchanged. Results: 2263 attempts, 1690 successes (75 %), 250 `not_found` (11 %), 150 successes that changed nothing.

Per-command successes out of attempts:

| Command | Successes / attempts |
|---|---|
| `setPlacementProps` | 0 / 6 (never) |
| `moveFixture` | 1 / 9 |
| `mergeCollinearWalls` | 1 / 92 (88 refused `not_collinear`) |
| `setDimension` | 1 / 10 |
| `movePlacement` | 3 / 14 |
| `deleteRoomMeta` | 3 / 10 |
| `deletePlacements` | 4 / 17 |
| `rotatePlacement` | 4 / 13 |
| `deleteFixtures` | 4 / 17 |
| `deleteDimensions` | 4 / 18 |
| `calibrateBackground` | 4 / 20 |
| `setLabel` | 6 / 18 |
| `setFixtureProps` | 6 / 14 |
| `setBackgroundProps` | 6 / 11 |
| `removeBackground` | 69 / 69, but 65 of them changed nothing (no background) |
| `insertFragment` | 69 / 69, but 28 of them changed nothing (empty fragment) |

I confirmed this with the unmodified test: `never = ['setPlacementProps']`.

**Why it matters.**
- The report's claim "With this seed all 43 succeed at least once" is false.
- The guard `never.length <= 3` would let up to three commands silently become always-refused (for example a broken `validate`), and the suite would stay green.
- The causes:
  - The start document (`makeGridPlan`) has no placements, fixtures, dimensions, labels, RoomMeta or background. Within sequences of at most 8 steps, the commands that edit those rarely have anything to work on.
  - `mergeCollinearWalls` picks degree-2 nodes, but in a grid those are corners. Corners are never collinear.

**Fix.**
- Use a per-command floor: every command must succeed at least about 5 times *with a changed document*, and `never` must be empty.
- To reach that floor, either:
  - prepend, with some probability, setup steps to each sequence (`setBackground`, `addPlacement`, `addFixture`, `addDimension`, `addLabel`, `setRoomMeta`); or
  - pick the needed `add*` command whenever `NEEDS` fails, instead of re-drawing.
- Make the `mergeCollinearWalls` generator prefer degree-2 nodes whose two walls are collinear, for example right after a `splitWall`, or by inserting a `splitWall` first.
- Correct the report's claim.

### Minor (Nice to Have)

1. **Untested branches in `entities.ts`; the hinge/swing flip looks unreachable.** Two mutants survived the whole suite:
   - (a) Hinge/swing flip on a `reversed` piece (D:2726-2727; mutant `hinge: o.hinge` survives).
     - `insertWallSegment` always builds pieces in `from→to` order (helpers.ts:619-630).
     - `splitAtNode` keeps the piece direction (helpers.ts:190-197).
     - So `reversed` looks unreachable for new pieces. Either add a test that produces a reversed piece, or drop the branch and say why.
   - (b) The unattached-only filter on selected dimensions (D:2243-2245; mutant `(id) => true` survives). Add a test that selects an attached dimension whose wall does not move.
2. **A swallowed `wall_duplicate` keeps the side effects that came before it** (D:2670-2692).
   - `nodeOf` runs `resolveEndpoint` for both ends before `insertWallSegment`. A T node it made on an existing wall, or crossed walls `insertWallSegment` split before throwing, stay in place when the error is swallowed.
   - The same happens on the `from === to` `continue` (D:2672).
   - The result: an extra degree-2 node splits an existing wall into two collinear pieces. It adds no error, and the covered-span pre-check makes the case hard to reach. The report flags it (concern 3).
   - Fix, if wanted: resolve and insert inside a nested draft and drop it on `wall_duplicate`, or remove the new node again with `mergeCollinearWalls` at that node.
3. **`entities.ts` is 982 lines.** The insertFragment half (D:2427-2829: validation, covered spans, pieces, opening placement, the paste) is self-contained. It could move to `fragment.ts` next to the other command modules. `invariants.test.ts` is 715 lines and mostly generator table, which is fine.
4. **`hash(ids)` dedupes before sorting** (D:2148). Spec 04 §6.6/§6.8 says "cyrb53(sorted ids joined by ',')", with no dedupe, and the test pins the dedupe (D:300-309).
   - This only matters when a caller passes duplicate ids, and deduping is the better behaviour: a selection is a set.
   - Add it to the spec 19 ledger with the other rulings in the header.
5. **The success count includes no-op successes.**
   - `succeeded` (D:1816) counts a command whose document did not change, such as `removeBackground` with no background (65 of its 69 successes).
   - That overstates coverage. Count only document-changing successes for the coverage guard; this ties in with Important 1.
6. **Process.** The report says the implementation came before the tests (not red-first); the RED run was done by unregistering the commands. The mutation results above cover the key behaviours. This is noted for the ledger, as in Task 27.

### Queued fix detail (controller ruling: fold a duplicating split piece into the existing wall)

Background: the duplicate arises in `splitAtNode` (helpers.ts:173-218). It is called from `splitIntersections` (helpers.ts:670-674) and from the crossed-wall split paths that `insertWallSegment` uses.

To do the fold safely:

1. **Extract one fold helper** from `mergeNodeInto`'s duplicate-pair logic, for example `foldDuplicateWall(d, keepId, dropId, out)`. It keeps the smaller id, moves the openings that fit without overlap (centres re-projected, hinge and swing flipped if the kept wall runs the other way), deletes the rest, and calls `pushDeleted`. Call it from both places, so the two rules cannot drift (no second copy).
2. **Move the attachments too**, in the same helper:
   - placement `wallAttachment.wallId`, with `side` flipped when the direction is reversed;
   - dimension `attachedTo.wallId`, with `face` flipped likewise except for `'center'`.
   Otherwise post-process will detach or delete them as orphans.
3. **Fix the `tail` loop in `splitIntersections`.** It assumes the tail keeps running `node→b` and that its id survives. If the tail is folded into an existing wall, which may run `b→node`, the next cut must split the kept wall. Look up which surviving piece contains the next cut, rather than reusing `tail`.
4. **Check `split_through_opening` before folding**, as `splitAtNode` does now. Run the fold only after the opening hand-over is known to fit; if it does not fit, keep refusing (`opening_overlap` or `introduces_error`) rather than silently deleting openings the user placed.
5. **Tests:**
   - the dirty-import moves on the overlapped top wall: `moveNode` (0,0) or (5000,0) with `finalize`, and `moveWall` left or right;
   - a `setWallLength` case taken from the property-test trace, with the net off;
   - each must undo to a deep-equal document.

   After the fix, re-run the net-off measurement above. It should report zero `wall_duplicate` additions.

## Checks run (scratch copy only)

- Baseline: the 3 new files pass, 38 tests.
- Per-command success instrumentation: the table in Important 1.
- Net-off run: `setWallLength` added `plan.wall_duplicate` ×6 and nothing else. `translateEntities`, `nudgeEntities` and `insertFragment` added no errors with the net off.
- 23 mutants on `entities.ts` and `pipeline.ts`:
  - 18 of 18 behaviour mutants were killed by `entities.test.ts`.
  - The net-off and unrounded-coordinate mutants were killed by the property test.
  - Two survivors are listed under Minor 1.
  - Two semantic mutants (background not deleted, fixture not offset) survive the property test alone, as expected; `entities.test.ts` covers those behaviours.
- Task 27 Minor 1 mutant (`DIMENSION_OFFSET_MAX → 1e12`): killed by the new plan.test.ts case.

## Assessment

**Task quality:** Needs fixes

**Reasoning:** The four commands match 04 §6.6, and their key behaviours are pinned by tests that kill every targeted mutant. But the property test, the task's main safety net, barely exercises about 14 of the 43 commands and never gets `setPlacementProps` through. Its guard tolerates that, and the report says otherwise. Raising the per-command coverage floor, together with the already-queued duplicate-fold fix, makes the task trustworthy.
