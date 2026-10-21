# Task 26 re-review, fix round 1 (f310782..0f3667a)

Mutation checks ran in a scratch copy (`.../scratchpad/mut2`) of HEAD 0f3667a. The worktree was not touched. I did not re-run the suite; the report claims 2003 tests, and the covering tests are named in the report.

### Finding Verdicts

1. **Minor 1: `Planned`/`hasError`/`PointSchema` duplicated across command files** — ADDRESSED.
   - `Planned` and `hasError` now live once at validators.ts:18-23, imported by rooms, placements, fixtures, annotations and openings.
   - `PointParamSchema` is in define.ts:15.
   - A grep of `const hasError|type Planned|const PointSchema` finds no local copies left, including moves.ts and walls.ts.
2. **Minor 2: y-range gaps for `addFixture` and `movePlacement`** — ADDRESSED.
   - fixtures.test.ts adds the `{ y: -1_000_001 }` case. placements.test.ts adds `move({ y: -2_000_000 })`.
   - Mutation: deleting `checkCoord('y', ...)` in either command is now killed.
3. **Minor 2b: `setFixtureProps` `keep` with `rotation` in one call** — ADDRESSED.
   - The new test "turns the footprint about the kept corner when a rotation comes with the resize" ends in an undo deep-equal.
   - Mutation: using `f.rotation` for the new corner offset is killed.
4. **Minor 2c: an old short dimension can still be moved or detached** — ADDRESSED.
   - annotations.test.ts has a free dimension 4 mm long and an attached one 1.4 mm long. It sets the offset on both, detaches, and undoes to the start.
   - Mutation: judging length even when neither `a` nor `b` is given is killed.
5. **Minor 3: no wall-move test for an `addDimension`-made attached dimension** — ADDRESSED.
   - The new `moveWall` test checks the recomputed face (y = −185), that the offset is kept, and undo.
   - It passes through the `followDimensions` clause that handles dimensions on related walls. The pre-existing mutant that drops the `changed` clause is also still killed.
6. **Minor 4: attached `addDimension` `a`/`b` contract and the stored-point range check** — ADDRESSED for the documented part.
   - The annotations.ts header now states the P4 contract: attached `a`/`b` must still be at least 10 mm apart.
   - The second half, the range check on stored points, was "very unlikely" and was left as is. Accepted.

### Merge-chain id replay (extra scrutiny)

- **Replay logic.** `replayingNewId` (pipeline.ts:~118-150) copies the previous per-prefix lists. It returns the next recorded id per prefix in issue order, then draws fresh ids and appends them.
  - Because the old record is carried forward, an id used by an earlier step survives a step that does not need it (replay.test.ts case 4).
  - `state()` is `undefined` when no id was ever issued. Entries for commands that issue no ids are therefore unchanged: no `runState` key (runState.test.ts case 3).
  - `postProcess` and `reconcile` never call `newId`, so nothing issues ids after `state()` is read (grep).
- **Bus stays generic.** `runState` is `unknown` on `HistoryEntry`, `PipelineOutput` and `Pipeline`. The bus only passes `top.runState` to the re-run (bus.ts:~420) and stores `out.runState` on the merged entry or on a new entry. It never inspects the value.
- **Merge-base cache, seal and compose unchanged.**
  - The cache key and assignment (`seq`, `doc`, `base`; `mergeBase = ...` after commit) are untouched; only the `pipeline(...)` call gained an argument.
  - `seal()`, `step()` and `sealTop()` are unchanged.
  - The compose path calls `pipeline` without `runState` and `merged(...)` without it, so a compose merge keeps the top entry's `runState` through the `...top` spread.
  - Mutant "pass `runState` to compose" is killed (runState.test.ts case 2).
- **Failed or refused re-run leaves the record intact.**
  - The bus returns `refused(...)` before touching `top`, the undo stack or `mergeBase`.
  - `executePlanCommand` returns no state on any failure path (validate, `CommandAbort`, `introduces_error`).
  - I wrote a scratch test (not in the worktree): a split drag, then a merged step refused with `wall_too_short`, then another split step. The top entry object and its `runState` stay identical, the replayed ids match, and undo is deep-equal to the start. It passes.
- **Undo/redo deep-equal.** Every replay test ends with an undo whose document equals the start (replay.test.ts 1, 2, 3, 4). `step()` only moves entries. Patches are unchanged by `runState`.
- **Mutation check of the replay (scratch copy).** 12 mutants: 11 killed, 1 survived.
  - Killed:
    - replay disabled;
    - non-per-prefix indexing;
    - previous ids not carried over;
    - fresh ids not appended;
    - `state()` always undefined;
    - `runState` not output;
    - `planPipeline` drops `runState`;
    - the bus does not hand back `runState`;
    - the bus does not store `runState` on a merge;
    - the bus does not store `runState` on a first entry;
    - `runState` passed to compose.
  - Survivor: the previous lists shared instead of copied (see Minor 1 below).

### New Breakage in the Fix Diff

None Critical or Important.

- Minor 1: the copy at pipeline.ts:~126 (`ids[prefix] = [...list]`) is what keeps a failed re-run from appending to the recorded entry. No test covers a re-run that draws an id and then fails. With the copy removed (`= list`), all 97 tests still pass.
  - My scratch test fails before any id is drawn (`wall_too_short` at validate), so it cannot catch it either.
  - Consequence is small: an unused id would be replayed later.
  - Suggest a test where a command issues an id and then aborts, or a unit test of `replayingNewId`.
- Minor 2: `runState` stays on entries after they are sealed or moved to the redo stack. `withSealed` (bus.ts:~226) and `step()` spread it along. A sealed entry can never be merged again, so the value is dead weight.
  - It is a small per-prefix id list, bounded by the history cap of 200, and not otherwise exposed.
  - `withSealed` could drop it: `({ ...rest, sealed: true })` without `runState`.
  - This is not a leak beyond the entry, so it is acceptable as is.

### Out-of-Scope Observations

None.

### Verdict

**Fix round:** All findings addressed, no new Critical/Important breakage. APPROVED. Two Minor notes remain, neither blocking.
