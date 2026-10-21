# Task 13 report: validatePlan + planSummary

Status: DONE_WITH_CONCERNS (concerns are decisions for the controller, listed below).
Commit: see `git log` on build/p2-engine, subject `feat(engine): validate plans and summarise rooms`.

## Implemented
- `resources/js/engine/plan/validate.ts`: `PLAN_ISSUE_CODES` (12 codes), `validatePlan(doc, geom?)` (memoised by document identity, LRU of 4), `planErrorKeys`, `removeOrphanNodes` (returns the same doc when nothing is orphaned), `PlanIssueCode`.
- `resources/js/engine/plan/summary.ts`: `PlanSummary`, `planSummary(doc, geom?)`.
- `resources/js/engine/plan/rooms.ts`: new exported helper `isAnchorInsideRoom(anchor, room)` (= `pointInPolygon(anchor, room.facePolygon) === 'inside'`). `associateRoomMetas` now calls it, and `validatePlan` calls it, so the two cannot drift. Task 21 `reconcileRoomMetas` must import the same helper (progress.md ruling).
- `index.ts` exports: validatePlan, planErrorKeys, removeOrphanNodes, PLAN_ISSUE_CODES, PlanIssueCode, planSummary, PlanSummary, isAnchorInsideRoom.
- Issue order is deterministic: by rule (PLAN_ISSUE_CODES order), then by entity id.

## Controller rulings applied (each has a test)
- wall `a === b` -> `plan.wall_degenerate` (error, params `{wallId, length: 0}`). Also not double-reported with `node_missing`.
- Dangling attachments: opening `wallId`, `placement.wallAttachment.wallId`, `dimension.attachedTo.wallId` (the only entities carrying wall references in 03 §1) -> all `plan.opening_wall_missing` (error), params `{ wallId, field }` with `field` = `opening.wallId` / `placement.wallAttachment.wallId` / `dimension.attachedTo.wallId`. 03/04 name no other code, so I did not invent one.
- `background.mmPerPixel` <= 0 or non-finite -> `plan.value_out_of_range`, params `{ field: 'background.mmPerPixel', min: 0 }`, `entityIds: []`.
- Anchor containment reuses the Task 11 test (hole = outside, boundary = outside). Test: a 300x300 closed box (below MIN_ROOM_NET_AREA, so a hole with no room) inside a 10 m room; anchor in it is flagged and `derivePlanGeometry` association agrees (only the other meta attaches).
- `walls_intersect`: only a `point` intersection that is strictly interior to both walls (param * length > EPS and (1-param) * length > EPS on both). Skips pairs sharing a node id, T-junctions (endpoint on the other wall's interior), distinct nodes at equal coordinates meeting end to end, and collinear `overlap` results. Flatbush bbox candidates (bbox inflated by EPS), each pair reported once, sorted ids, params `{x, y}` of the crossing. Walls shorter than 10 mm or a===b are excluded from this check (already flagged).
- 04 §4.8 has no crossing definition at all (it is only the PlanSummary type); the rule comes from 04 §6.4 (`kind point`, t in (0,1), strictly inside W), which I followed.

## Spec vs brief conflicts (spec wins)
1. **messageKey**: brief says `'engine.plan.issue.' + rule`. Preflight C6 (adopted in progress.md: "adopt every proposed ruling C1-C18") and spec 05 §10.4 / §19 say `plan_editor.issues.<code>`. I used `'plan_editor.issues.' + rule` (single constant `MESSAGE_KEY_PREFIX` in validate.ts; a one-line change if the controller decides otherwise). Tests assert the new prefix. Existing `schema.test.ts` IssueSchema sample still uses the old string; it is only a schema round-trip sample and is unaffected. Plan Task 51 text and global-constraints.md still say `engine.plan.issue.*` and need the C6 edit.
2. No severity/code conflict found between 03 §1.1 / 04 and the brief; all severities match 03 §1.1.

## Decisions to review
- `value_out_of_range` params are exactly `{ field, min, max }` (no `value`). Fields: `wall.thickness`, `wall.height`, `opening.width`, `opening.sillHeight`, `node.x/y`, plus coordinate checks for `room.anchor.x/y`, `placement.x/y`, `fixture.x/y`, `label.position.x/y`, `dimension.a|b.x/y`, `background.position.x/y` (03 §1.1 says "coordinates", not only nodes). NaN/non-finite count as out of range.
- `too_large` params `{ kind, count, max }`, `kind` in walls | openings | placements | fixtures | json (for json `count` is the UTF-8 byte length). JSON size uses a local `utf8ByteLength` over `JSON.stringify(doc)`; the exact count is skipped when `length*3` cannot exceed 2 MiB.
- `node_missing` is one issue per missing end: params `{ wallId, nodeId, end: 'a'|'b' }`.
- `wall_duplicate` is one issue per group (3 walls on one pair = 1 issue, count 3).
- `opening_overlap` is one issue per overlapping pair, params `{ wallId, overlap }` (mm; touching = no issue).
- `opening_out_of_bounds` uses float centre-line length with 1e-6 tolerance; params `{wallId, offset, width, wallLength}`.
- `room_anchor_outside` derives geometry only if there is at least one RoomMeta and `geom` was not passed.
- `planSummary`: `wallCount` = walls in the document (including undrawable ones); `areaMm2` rounded to whole mm2 and `totalAreaMm2` = sum of the rounded areas; `bbox` null when no wall is drawable (derived walls empty), integer mm, -0 normalised.

## Concerns
- 03 §1.1 has no code for opening kind/type mismatch (e.g. kind `door` with a window type); `schema.ts` comment says validatePlan owns it, but no code exists in the 12-code list, so it is NOT checked. Needs a spec decision (new code, or drop the comment).
- Dangling placement/dimension attachments share the opening code `plan.opening_wall_missing`; P4 text for `plan_editor.issues.opening_wall_missing` should be worded generically ("referenced wall no longer exists") or a dedicated code added later.
- Collinear overlapping walls (makeDirtyPlan case b) are not reported by `walls_intersect` (spec: crossings only).
- `validate.ts` is 586 lines after prettier (many small rule functions); left as one file per the plan's file list.
- Memoisation is by object identity: mutating a validated document in place returns stale issues. Documents must be treated as immutable (they are, per mutative). Tests clone before re-validating.

## Tests
- `yarn vitest run --project engine resources/js/engine/plan/__tests__/validate.test.ts resources/js/engine/plan/__tests__/summary.test.ts`
- RED (before implementation): both files failed with `Failed to load url ../validate ... Does the file exist?` / same for `../summary` (modules absent; expected).
- GREEN: validate.test.ts 55 passed, summary.test.ts 6 passed. Full engine project: 28 files, 763 tests passed (purity test included; two comment wordings were changed to avoid the `document.` token).
- Gates: `yarn eslint resources/js/engine` clean, `yarn prettier --check resources/js/engine` clean, `yarn vue-tsc --noEmit` clean.
- Informal timing: validatePlan on a 97-wall grid, cold, about 0.64 ms per call (04 §12 budget 3 ms).
- Test coverage: valid fixtures (rect, L, grid 3x3, empty) -> []; one test per code with exact severity/messageKey/params/entityIds; boundary values (exactly 450 offset, 10 mm wall, 2000 walls, range limits); dirty-import fixture; memo identity + LRU eviction; planErrorKeys; removeOrphanNodes (no mutation, same-doc return); summary rect / named room / empty / grid / precomputed geom / undrawable walls.

## Files changed
- resources/js/engine/plan/validate.ts (new)
- resources/js/engine/plan/summary.ts (new)
- resources/js/engine/plan/rooms.ts (isAnchorInsideRoom; associateRoomMetas uses it)
- resources/js/engine/index.ts (exports)
- resources/js/engine/plan/__tests__/validate.test.ts (new)
- resources/js/engine/plan/__tests__/summary.test.ts (new)

## Fix round 1

Commits: b7cd0c4 `fix(engine): bound polylabel work for very elongated rooms`, da42ea5 `fix(engine): harden validatePlan and flag overlapping walls`.

### Important 1: validatePlan stalls on huge coordinates
Root cause (measured, CPU profile): not a grid/snapping loop in derive, but `geometry/polylabel.ts`. In a long strip (a room whose centre-line ring is extreme in one direction) every cell along the axis has the same distance to the boundary, so `cell.max - best.d <= precision` never prunes them and the search refines the whole length down to 10 mm. Cost grows with length / precision: a 4 m wide strip took 72 ms at 100 m, 0.4 s at 1 km, 5.4 s at 10 km, 86 s at 100 km. Profile of derive at 1e8: 867 ms of 1.6 s self time in polylabel, the rest distToRing/heap/GC. The initial grid (`extent / shortSide` cells) also grew with extent.
- Path taken for (b): contained fix in geometry/ (no derive change needed). `polylabel` now (1) limits the initial grid to 64 cells along the long side (`MAX_AXIS_CELLS`), (2) stops after 10 000 cells (`MAX_CELLS`) keeping the best point so far, (3) returns the bbox corner with distance 0 for non-finite extents. Normal rooms need a few hundred cells and aspect ratios under 64, so all existing polylabel and room-label results are unchanged (all 788 engine tests pass untouched). This deviates from 04 §4.7 "stop when the queue is empty" only for pathological shapes; worth a line in 19.
- After the fix, `derivePlanGeometry` with one node at 1e6, 1e8, 1e9, 1e12, 1e15, NaN or Infinity takes about 1-30 ms. Wall thickness 1e12 and 5000 walls (221 ms) were also checked: no other magnitude-dependent cost found. Since derive no longer hangs, the "falls back to refusing such docs" path was not needed.
- (a): `valuesInRange` now returns `{ issues, coordinatesOk }` (coordinatesOk false if any coordinate check failed, which includes NaN and infinities). `runValidation` derives only when `coordinatesOk` (or `geom` was passed); otherwise `room_anchor_outside` is skipped and the doc still gets its `value_out_of_range` issues. Derive is also only called when the doc has at least one RoomMeta (as before).
- Tests: validate.test.ts "untrusted input does not stall validation" (node at 1e12 / NaN / Infinity plus a meta -> `value_out_of_range` for node.x, finishes under 100 ms, no `room_anchor_outside`); polylabel.test.ts strips of 1e6 and 1e9 mm (under 200 ms, distance 2000, point on the axis) and non-finite extent; derive.test.ts one node at 1e9 / 1e12 / NaN / Infinity derives under 200 ms.
  Note: after fix (b) the time bound alone no longer distinguishes (a); the "no room_anchor_outside" assertion does (verified by mutant, below).

### Ruled change: walls_intersect flags collinear overlaps
- `intersectSegments` kind `overlap`: length = (t1 - t0) x wall length; reported when > 1 mm (`MIN_OVERLAP`). Warning, `entityIds` = both wall ids sorted, params `{ overlapMm }` (integer mm). Crossings keep params `{ x, y }`.
- Shared-node skip relaxed: the node check now applies only through geometry. A `point` hit between walls sharing a node always lies on an end of both, so it fails the interior test; an `overlap` hit is reported even when a node is shared (A->B and A->C same direction). Collinear walls running opposite ways from a shared node give a `point` touch and are not reported. Removing the explicit shared-node `continue` was an equivalent mutant (survived), so it was deleted instead of kept as dead code.
- Same unordered node pair is skipped (already `wall_duplicate`); test asserts only `plan.wall_duplicate` is emitted.
- The old "does not report collinear overlaps" test was flipped; the dirty-import fixture now yields 4 issues (orphan node, out-of-bounds window, crossing, overlap).

### Minor items
- Near-miss tests: vertical wall ending 2 mm short (none), overshoot 0.4 mm (none), 0.6 mm (flagged), 1 mm (flagged with x/y); parallel walls 2 mm apart (none). The ±EPS bbox-inflation mutant is only observable for near-collinear walls whose bounding boxes do not touch (fractions of a mm apart): test "collinear walls that are a fraction of a millimetre apart" (0.4 mm off) kills it. For real crossings inflation is behaviourally equivalent, so the near-miss cases alone cannot kill it.
- Lower/upper exact bound: openings offset 450 / 4550 width 900 on a 5000 wall -> no issue.
- MIN_WALL_LENGTH filter in wallsIntersect: 9 mm wall crossing wall 1 yields only `wall_degenerate`.
- 4-byte characters: 400 000 emoji (1.6 MB) must not be flagged; 540 000 (2.16 MB, 1.08 M UTF-16 units) must.
- Range tests: opening width 6001 (and 6000 accepted); placement.x, label.position.y, dimension.b.x, background.position.y each 1 000 001.
- NaN: wall with a NaN node gives `wall_degenerate` with `params.length` 0; `finiteMm` keeps params finite; openings on walls with non-finite length skip `opening_out_of_bounds`; non-finite-length walls are excluded from the intersect index (Flatbush never sees NaN).
- `validatePlan` result is `Object.freeze`d (array only); memo test asserts `Object.isFrozen`. The `issues` temporary in `runValidation` is gone.

### Mutation check (each mutant applied, targeted tests run, file restored)
Killed: ±EPS bbox inflation removed; MIN_WALL_LENGTH filter removed; OOB lower bound `>`; OOB upper bound `<`; utf8 4-byte counted as 3; utf8 surrogate pairing removed; opening width max 7000; placement/label/dimension.b/background coordinate checks removed (each separately); NaN length via `mm`; Object.freeze removed; always-derive (coordinatesOk ignored); overlap threshold `> 0` and `>= 0`; overlap skipped for shared nodes; wall_duplicate pair skip removed; non-finite OOB skip removed; polylabel `MAX_CELLS` break removed (hangs, killed by 90 s timeout); polylabel `MAX_AXIS_CELLS` cap removed (killed by timeout); polylabel non-finite guard removed. Survived: only the explicit shared-node `continue` for point hits (equivalent, code deleted). Harness: scratchpad/mut.py.

### Verification
- `yarn vitest run --project engine`: 28 files, 788 tests passed (was 763; +25).
- `yarn eslint resources/js/engine`, `yarn lint`, `yarn vue-tsc --noEmit`, `yarn prettier --check resources/js/engine`: clean.
