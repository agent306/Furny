# Task 22 report: plan command helpers

Status: DONE_WITH_CONCERNS. Commits: 5d7cd1d (Task 21 leftovers a/b/c), 4fc9763 (helpers).

## Implemented
- `plan/commands/helpers.ts`: `EndpointRef`, `WallProps` (= `Omit<Wall,'id'|'a'|'b'>`), `resolveEndpoint`, `splitWallAt`, `insertWallSegment`, `splitIntersections`, `mergeNodeInto`, `reclampOpenings`, `nextOpeningLabel`, `wallLength`; re-exported from `engine/index.ts`. Helpers take `ctx: Pick<PlanCommandContext,'newId'>` and read node positions from the draft. All abort codes (`not_found`, `split_through_opening`, `wall_duplicate`, `wall_too_short`, `opening_no_fit`, `opening_overlap`) are among the 22 `PLAN_COMMAND_ERROR_CODES`.
- Leftover (a): `mergeBaseCache?: boolean` (default true) on `CommandBusConfig` and `PlanBusConfig`; seeded test in `pipeline.test.ts` (24 seeds x 26 ops: drags on two merge keys, plain steps, history:false, transactions, undo/redo, seal, reset) comparing doc, results and history (patches/inverse/mergeKey/sealed) of cached vs uncached `createPlanBus`. Mutation check: removing both identity checks in `bus.ts` fails the test (removing either alone does not: each is sufficient by itself, a plain step seals the top and a new entry changes seq and doc).
- Leftover (b): `cmp` removed from `snapShared.ts` (importers hitIndex/hitTest/snapIndex/snapOpening use `cmpId`); local copies removed from `conflicts.ts`, `buildPlanDrawing.ts`.
- Leftover (c): `followPlacements` skips the rotation write when stored vs recomputed differ by < 1e-6 deg (wrapped at 360); tests for 1e-9 and 360-1e-9 plus a still-writes case (0.01 deg). RED confirmed by temporarily restoring the strict compare.

## Decisions (deviations from the letter of 04 §6.5, all sub-millimetre or edge handling)
1. `splitAtNode` classifies openings against `dist(A, N)` of the actual rounded node (not the unrounded projection `u`) and uses a 1e-6 tolerance, because `validatePlan` checks opening bounds at 1e-6; moved openings get `round(offset - dist(A,N))`, fitted to the tail's integer bounds.
2. `reclampOpenings`/`mergeNodeInto` write integer offsets inside `[ceil(w/2), floor(len - w/2)]`; if no integer offset exists the opening aborts `opening_no_fit` (reclamp) or is deleted (merge transfer). Overlap = strict overlap (touching openings are fine).
3. `mergeNodeInto` transfer: reversed duplicate wall flips `hinge` (start/end) and `swing` (left/right) so the door stays physically the same; "fits" = re-projected rounded offset inside bounds without clamping, else the opening is deleted and reported. Keeper's own openings are not re-projected (reclampOpenings does that).
4. `insertWallSegment`: collinear detection uses `intersectSegments(..., NODE_MERGE_TOL)`; dedupe priority end > existing node > wall split; a pair is "covered" when its mid parameter lies in an overlap interval. New split ids are made in t order, then the new wall ids.
5. `splitIntersections` cuts in ascending order along the wall (tail tracking) so ids are deterministic.

## Tests
- `plan/commands/__tests__/helpers.test.ts`: 53 tests (all brief cases + reversed/partial overlaps, determinism, rounding/-0, opening/placement redistribution, merge transfers, integration through `createPlanBus` incl. undo deep-equal and wall_duplicate leaving the document unchanged).
- TDD evidence: honest note, the implementation was written before the test file; RED shown afterwards by removing helpers.ts: `Error: Cannot find module '../helpers'` (1 failed file), GREEN `53 passed`. Mutation checks done on: placement re-attach, covered skip, movedEnd 'a' formula, opening move condition, reversed flip, -0 normalisation (all fail their tests).
- Full engine project: `yarn vitest run --project engine` 44 files, 1620 passed. `yarn eslint resources/js/engine && yarn prettier --check resources/js/engine && yarn vue-tsc --noEmit` clean.

## Concerns
- Spec corner: nodes 5 to 10 mm apart on the segment survive dedupe but the pair between them is skipped as `< MIN_WALL_LENGTH`, so the new wall can start at the second node and leave `from` unconnected. Followed spec verbatim; a command-level fix (or dedupe at MIN_WALL_LENGTH) may be wanted in Task 23.
- A crossing 5 to 10 mm from a node of the crossed wall splits it leaving a wall under `MIN_WALL_LENGTH`; the pipeline invariant would refuse it as `introduces_error`.
- Two walls crossing S at the same point (an X junction in an already invalid doc) dedupe to one split (smaller id).
- Pre-existing overlapping openings on a wall make `reclampOpenings` abort `opening_overlap` even if the command did not cause it.
- `mergeBaseCache` is a small public config addition to the generic bus (needed for test (a)).

## Fix round 1 (commit 7f48e57)

Rulings applied (log each in spec 19):
1. reclampOpenings aborts opening_overlap only for pairs that did not overlap before the edit (original offsets); pairwise check.
2. Crossings are never left unsplit. Cuts are collected by one shared helper (collectCuts/dedupeCuts/splitCrossedWalls) used by insertWallSegment and splitIntersections. When a crossing's cut is folded into a neighbour (node, segment end, other crossing), the crossed wall is split at the surviving node if the node is within NODE_MERGE_TOL of the wall and both parts stay >= 10 mm, else abort. walls_intersect is NOT among the 22 command codes (it is a plan issue code), so the closest existing code used is wall_too_short (the unresolvable case is a would-be stub). Repros (vertical wall at x=2000 + node (2004,0); wall at x=3996 vs segment end at 4000) are tests; a fold into a rank-2 cut that is later replaced by a node is retargeted (a bug found while testing: two rank-2 cuts folded together were dropped because both nodeIds were null).
3. STUB = max(5, 10) = 10 mm: all cuts are deduped against each other and the segment ends at 10 mm; a crossing within 10 mm (inclusive) of one of the crossed wall's own nodes routes the segment through that node instead of splitting. Tests: node 6 mm from from, two nodes 6 mm apart, crossings 6/9/10 mm from the wall's node, 11 mm splits, rounding case (7,7) where the safety-net pair skip is the only guard.
4. resolveEndpoint skips walls with missing nodes (test with a dangling wall).
5. splitWallAt aborts wall_too_short when the projection is outside the open interval (10, length-10) (closest existing code to not_found). Consequence: resolveEndpoint with a point whose wall projection is in [5, 10] mm of an end (no node within 5 mm) now aborts wall_too_short instead of making a stub; below 5 mm it makes a plain node. Log in 19.
6. mergeNodeInto re-attaches the deleted loser's placements (wallAttachment) and dimensions (attachedTo) to the keeper, same side, flipped (left/right) when the walls are reversed; also verified through the pipeline (nothing nulled/deleted by post-processing).
7. Shared cut collection/dedupe helper; the redundant overlap-branch node push (M13) removed.
8. Mutants pinned (mutated in scratch only, each fails a test): exact 5.000/5.001 boundaries for node reuse (M1), wall snap (M2), u>=5 margin (M2b), interior join (M3); pair-skip < MIN_WALL_LENGTH (M17, via the rounding case); already-joined pair (M16); duplicate groups need a moved wall (M7); end margin 10 mm in splitIntersections (M14, 9 mm refused / 10 mm cut); rank-1 beats rank-2 (M4); STUB value; fold bookkeeping and retarget; splitWallAt guard; pre-existing overlap exemption.
9. Header of helpers.ts documents that after a split dimensions attached to the original wall follow the head part only (spec 6.5 "stay attached") - log in 19.

Verification: yarn vitest run --project engine: 44 files, 1646 passed (helpers.test.ts 79); yarn eslint resources/js/engine, yarn prettier --check resources/js/engine, yarn vue-tsc --noEmit: clean.

## Fix round 2 (commit 1791d77)

1. resolveEndpoint: with no node within 5 mm, a click within 5 mm of a wall's centre line whose projection falls within MIN_WALL_LENGTH (10 mm, inclusive) of an end returns that end node (nothing created or split); beyond 10 mm it splits as before. This supersedes the fix-round-1 behaviour that aborted wall_too_short there and the former plain-node-under-5 mm case (the old 5 mm u-margin no longer exists; the 10 mm boundary is pinned: 10 snaps, 10.001 splits).
2. insertWallSegment / splitIntersections: settleRoundedCuts merges a wall-split node into its neighbouring cut (segment end first) via mergeNodeInto when rounding leaves them under 10 mm apart, so the segment is routed through from/to and no end is orphaned. Existing nodes are never merged away. The test that pinned the old behaviour now expects 0,0>4000,4000 with the crossed wall passing through from; mirrored case at to and the splitIntersections case are tested.
- Abort code for fix-round-1 ruling 2 is wall_too_short because walls_intersect is a plan issue code, not one of the 22 command codes (accepted).

Verification: yarn vitest run --project engine: 44 files, 1647 passed (helpers.test.ts 80); eslint, prettier --check and vue-tsc clean.

## Fix round 3 (commit 93ba122)

- Important (probes V1/V3): collectCuts pushed a crossed wall's end node twice (plain interior node and crossing cut), and the dedupe kept the plain one, losing the wall. Cut.viaWall is now Cut.viaWalls (list); same-node duplicates union their lists, so the later fold into the segment end still produces a Folded entry. V1 geometry (W (0,0)-(3000,0), S (2001,3000)->(3000,-6)) now aborts wall_too_short in both insertWallSegment and splitIntersections (the end is 6 mm from W, over the 5 mm limit).
- Minor 1: the unreachable pair-skip under MIN_WALL_LENGTH was deleted.
- Minor 2: the u < MIN / length - u < MIN abort in splitCrossedWalls is pinned at both ends of the crossed wall (each half fails its mutant).
- Minor 3: settleRoundedCuts records the walls ending at the stray node, merges, then reclampOpenings (end 'a'/'b') on the survivors; opening_no_fit/opening_overlap abort cleanly (tests: offset 24 -> 16, and width 38 aborts opening_no_fit).
- Minor 4: the stray node id is removed from out.deletedIds (it only existed inside the command).

Verification: yarn vitest run --project engine: 44 files, 1652 passed (helpers.test.ts 85); eslint, prettier --check and vue-tsc clean. Mutants checked in scratch: viaWalls union, both stub conditions, deletedIds splice, reclamp call.
