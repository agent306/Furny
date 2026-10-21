# Task 28 re-review, fix round 1

Range: `1c0ba0e..9a7b875` (commit 9a7b875). I read the diff once, in full.

Scratch checks ran in a fresh copy of `resources/js` at HEAD: `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/t28r`, with `node_modules` symlinked. The worktree was not changed (`git status` is clean).

Baseline in the scratch copy: `plan/commands/__tests__` gives 15 files and 610 tests, all passing.

## Finding Verdicts

### Queued A. Fold a duplicate split piece into the existing wall — ADDRESSED

**What the code does now**
- `splitAtNode` now folds any piece that joins a node pair another wall already joins (helpers.ts, D:2000-2008).
- The fold lives in one helper, `foldWall` (D:2038-2104). `mergeNodeInto` now calls it with `conflict: 'delete'` (D:2294), replacing its old inline copy (D:2242-2293), so there is no duplication.
- The new `overlaps(...)` check (helpers.ts:867-872) is exactly the negation of the old inline `clear` test, so `mergeNodeInto` behaves the same.
- Openings are re-projected by centre, and hinge/swing flip when the walls run opposite ways.
- An overlap in the split path refuses with `opening_overlap` (D:2067-2077). Placements and dimensions move to the kept wall with sides and faces flipped (D:2091-2102).
- `splitIntersections` now finds what is left to cut with `wallJoining(cut, far)` (D:2213-2221). `splitCrossedWalls` skips a wall that an earlier fold deleted (D:2170).

**Caller audit** (risk: `splitAtNode` can now delete walls)
- `splitWallAt` always cuts at a brand-new node, so its callers can never fold: `splitWall`, `resolveEndpoint` T nodes, `moveNode` snapping, and the crossings in `splitCrossedWalls`.
- I probed `moveNode` and `nudgeEntities` collapsing two walls at a node onto one line, in both id orders. All 4 cases succeed with no errors and undo restores the start. See Minor N2.

**Tests**
- helpers.test.ts D:256-315: fold into a reversed wall, then cut that wall again; `opening_overlap` refusal.
- moves.test.ts D:747-770: the `setWallLength` case from property-test sequence 46.
- dirty-import.test.ts D:34-86: finalized `moveNode` on corners (0,0) and (5000,0); `moveWall` on the left and right walls. These are the overlapped-wall moves the controller asked for. Each undoes to a deep-equal document.

**Mutations (scratch)**

| Mutant | Result | Tests that caught it |
|---|---|---|
| Fold disabled | Killed | 5 (helpers ×2, moves, dirty ×2) |
| refuse→delete | Killed | the `opening_overlap` test |
| No hinge/swing flip | Killed | 2 |
| No side flip | Killed | 2 |
| `rest` loop broken | Killed | 4 |
| Dimensions not moved | Killed | 2 |
| `splitCrossedWalls` deleted-wall guard removed | Survived | — (Minor N3) |

**Net-off measurement.** With the pipeline's `introduces_error` check disabled, `invariants.test.ts` and `dirty-import.test.ts` both pass (14 of 14). So no command relies on the check any more; the old `setWallLength ×6 plan.wall_duplicate` is gone.

### Important 1. Property test barely exercised a quarter of the commands — ADDRESSED

**Changes**
- Setup steps run inside the invariant before each random phase (D:428-524, D:685-688).
- Targeted generators: `straightNodes` for `mergeCollinearWalls` (D:398-420, D:551-558), a `setPlacementProps` that always changes a prop (D:586-598), and fewer empty fragments (D:375).
- The guard now requires every command to have at least `MIN_CHANGES = 5` random-phase successes that change the document (`after !== before`, D:682). It prints the full table when it fails (D:719-721).

**Re-measured (scratch instrumentation, `mulberry32(1234)` unchanged)**
- Per-command counts of successes that changed the document match the report's table exactly. The minimum is `addOpening` at 12.
- All 9 setup steps succeeded in all 500 sequences, 4500 of 4500.
- `mergeCollinearWalls` now succeeds 45 of 55 times (was 1 of 92), `setPlacementProps` 52 of 61 (was 0 of 6).
- No `introduces_error` refusals remain.
- The test takes 7.4 s.

**Guard mutations**
- `setPlacementProps` always refuses: guard fails, naming `setPlacementProps`.
- `mergeCollinearWalls` always refuses: guard fails, naming `mergeCollinearWalls`.

The report's false "all 43 succeed" claim is corrected in the fix-round section.

### ⚠️ Item C. Anchor under a merged translate — ADDRESSED

**New tests**
- entities.test.ts D:135-156: a replace-merged whole-room drag of dx 100, 250, 400 puts the anchor at `2500+dx` each step, without accumulating. It ends as one entry and undo restores.
- D:158-187: a probe command shows that `ctx.geometry.docRef` is the drag-start document on the first run (identity). On the re-runs it is deep-equal to the start document, not the previous step.

This closes the ⚠️ item.

### Minor findings

| Finding | Verdict | Evidence |
|---|---|---|
| Minor 1: untested reversed flip / dimension filter | ADDRESSED | The flip was dropped as unreachable; reasoning in the fragment.ts header (D:1434-1438), consistent with `insertWallSegment` laying pieces `from→to`. The dimension-filter test is at D:189-207. The `(id) => true` mutant is now killed. |
| Minor 2: swallowed `wall_duplicate` kept side effects | ADDRESSED | The dry run `addsWall` uses `create(current(d))` (D:1625-1647). Real endpoint resolution happens only after the dry run says the wall adds something (D:1788-1793). The catch is gone, so an unexpected refusal now refuses the whole paste. The dry-run-off mutant is killed. See N1 (cost) and N4 (test gap). |
| Minor 3: file size | ADDRESSED | `fragment.ts` (515 lines) is split out and registered (D:2320, D:2342). `entities.ts` is 502 lines. |
| Minor 4: hash dedupe | ADDRESSED | Ledgered in the `entities.ts` header (diff of entities.ts, header lines 53-55). |
| Minor 5: no-op successes counted | ADDRESSED | Only `after !== before` counts (D:682, D:695-697). |
| Minor 6: process (not test-first) | ADDRESSED | Ledger note only; the fold tests were shown failing with the fold disabled, and my F1 mutation reproduces that. |

## New Breakage in the Fix Diff

### Minor N1. The dry run roughly doubles the cost of a large paste

Location: fragment.ts `addsWall` (D:1625-1647), called for every fragment wall (D:1788).

Each call copies the whole draft (`current(d)`) and runs `resolveEndpoint` plus `insertWallSegment` twice.

Measured in scratch, pasting a whole grid at an offset onto itself:

| Paste | Before (1c0ba0e) | After (9a7b875) |
|---|---|---|
| 220 walls (`makeGridPlan(10,10)`) | 0.76 s | 1.14 s |
| 840 walls (`makeGridPlan(20,20)`) | 7.2 s | 14.8 s |

There is no 04 §7.3 budget for `insertFragment`, and the base cost was already high (see Out-of-Scope). Still, this is a synchronous editor command.

Fix: skip the dry run when no existing wall or node lies within `NODE_MERGE_TOL` of the segment, which is the common case for an offset paste. A cheap check is `coveredSpans` being empty and no node near either end. Alternatively, dry-run only the covered-span case.

### Minor N2. `splitIntersections` can now delete walls, but one caller does not guard for it

`moves.ts:293` (`moveNode`, the finalize branch with no merge) loops `for (const w of incident) splitIntersections(d, w.id, …)` without the `has(d.walls, w.id)` guard. Its sibling loops do guard: moves.ts:299, moves.ts:442, entities.ts:400.

If an earlier call folds away a later incident wall, the command would refuse with a spurious `not_found` (from `wallOf`); it would not crash. My probes did not reproduce it: the fold deletes the wall being processed, not a later one.

Fix: add the same `has()` guard, for consistency.

### Minor N3. The deleted-wall guard in `splitCrossedWalls` is untested

`splitCrossedWalls` (D:2168-2170): removing the guard passes every test in helpers, moves, dirty-import, invariants and walls (275 tests).

Add a case where it fires, or note why it cannot.

### Minor N4. No test pins that only `wall_duplicate` makes a fragment wall skippable

fragment.ts D:1641-1642: the mutant "the dry run swallows every refusal" (`return false;`) survives `entities.test.ts` and `invariants.test.ts`. A paste whose wall would cut through an existing opening would then silently drop that wall instead of refusing.

The property test hits `insertFragment` → `split_through_opening` 6 times, but never asserts that it is a refusal.

Fix: add one test that pastes a wall across an existing door and expects `split_through_opening`.

## Out-of-Scope Observations

- `insertFragment` was already slow on large fragments before this round: 7.2 s for 840 walls. Pieces, covered spans and `insertWallSegment` all scan the whole draft for each fragment wall. Ledger this for the whole-branch review, or for a perf budget in spec 19.

## Verdict

**Fix round:** All findings addressed, with no new Critical or Important breakage. Four new Minors are open (N1–N4); none of them blocks the task.
