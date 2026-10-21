# Task 26 report: room meta, placement, fixture, dimension, label commands

Status: DONE_WITH_CONCERNS. Commit f310782 `feat(engine): add room, placement, fixture and annotation commands` (pushed to origin/build/p2-engine).

## Implemented
- `plan/commands/rooms.ts`: setRoomMeta (replace merge `roomMeta:{faceKey}`), deleteRoomMeta.
- `plan/commands/placements.ts`: addPlacement, movePlacement (`placement:{id}`), rotatePlacement (`placementRot:{id}`), setPlacementProps, deletePlacements.
- `plan/commands/fixtures.ts`: addFixture, moveFixture (`fixture:{id}`), setFixtureProps (`fixtureProps:{sorted ids}`), deleteFixtures.
- `plan/commands/annotations.ts`: addDimension, setDimension (`dim:{id}`), deleteDimensions, addLabel, setLabel (`label:{id}`), deleteLabels. touchesGeometry true only for add/setDimension.
- `registry.ts`: spreads ROOM/PLACEMENT/FIXTURE/ANNOTATION_COMMANDS.
- `limits.ts`: new ranges (FIXTURE_SIZE/HEIGHT, ELEVATION, LABEL_FONT_SIZE, LABEL_TEXT, ROOM_NAME, DIMENSION_OFFSET_MAX, DIMENSION_MIN_LENGTH).
- `validators.ts`: checkCoord, checkPoint, checkCollectionCapacity (MAX_PLACEMENTS / MAX_FIXTURES -> too_large).
- `postprocess.ts`: `storedRotation` exported and reused for rotation normalisation; `followDimensions` now also recomputes an attached dimension the command itself changed (previously only dimensions on related walls), so attached points come from the wall face after addDimension/setDimension.
- Ids use `ctx.newId('r'|'f'|'x'|'d'|'t')`, the same generator as the other commands.

## Rulings (all ledgered in file header comments as "ledgered for the spec 19 reconciliation")
- setFixtureProps `keep`: the named corner is the one that stays fixed (matches brief and 05 §7 editor usage; 04 §6.6 text says "opposite corner", loosely worded). A corner keep moves x,y only when width or depth ends up different; library key resets sizes only when it differs from the current key.
- rotatePlacement: attachment judged for both pivots; face orientation = wall normal (left side) or its opposite (right side); diff modulo 360 > 0.5 deg detaches; a wall with no derived geometry detaches. Pivot center on a design with no footprint -> design_unknown.
- Rotations stored as postprocess `storedRotation` (0.01 deg, [0,360)).
- Room name: trimmed, code points, 0..80, out_of_range on `props.name`. labelOffset range-checked. floorColorHex lower-cased (schema regex -> invalid_params on bad hex, as setWallProps).
- Dimension length judged on rounded a/b even when attached; setDimension judges length only when a or b is given; attachedTo undefined keeps, null detaches.
- Fixture label stored as given (spec sets no limit).
- Objects (labelOffset, wallAttachment, dimension a/b/attachedTo) are written field by field so a same-value write makes no patch and the no-op drops its entry.

## Tests
- New: rooms 15, placements 31, fixtures 29, annotations 31 (106 tests); all with undo deep-equal where a command mutates.
- Full run: `yarn vitest run resources/js/engine` -> 49 files, 1993 tests passed. `yarn eslint resources/js/engine`, `yarn prettier --check resources/js/engine`, `yarn vue-tsc --noEmit` all clean.
- RED evidence: tests were written after the implementation (not strict TDD order). I then removed the four spreads from registry.ts and ran the four files: 4 files failed, 106 tests failed; restored and green.

## Files changed
resources/js/engine/plan/commands/{rooms,placements,fixtures,annotations}.ts (new), registry.ts, postprocess.ts, validators.ts, resources/js/engine/plan/limits.ts, and the four new test files under commands/__tests__/.

## Concerns
1. Tests were not written red-first (see above).
2. The `keep` wording discrepancy between 04 §6.6 and the brief (resolved per brief).
3. Replace-merge of setRoomMeta that creates a meta re-runs on the base doc, so each merged call gets a fresh `r_` id (only the last survives; consistent with replace semantics).
4. Fixture label unbounded.
5. validatePlan was not extended with the new ranges (out of scope).

## Fix round 1

### A. Merge-chain id replay (controller ruling, ledgered for the spec 19 reconciliation)
- Bus stays generic: `Pipeline` takes an optional 5th arg `runState`; `PipelineOutput` may return `runState`; `HistoryEntry` gets an optional opaque `runState` (set only when the pipeline returned one). A `replace` merge passes `top.runState` to the re-run and stores what the re-run returns on the merged entry. Merge-base cache, seal and compose paths are unchanged (compose never passes it).
- Plan pipeline (`plan/commands/pipeline.ts`): `executePlanCommand`/`planPipeline` wrap `ctx.newId` with `replayingNewId`. `PlanRunState = { ids: { [prefix]: string[] } }` records every id issued; a re-run replays per prefix in issue order, then draws fresh ids and appends them. The returned record is the old one plus additions, so ids of a step that did not need them survive for later steps. Failed runs return nothing (record unchanged). No state is stored when no id was issued, so existing entries are byte-identical.
- Tests: `commands/__tests__/runState.test.ts` (3, generic bus hand-back, seal, key change); `plan/commands/__tests__/replay.test.ts` (4: setRoomMeta x3 keeps one `r_` id and results agree; moveNode drag with a splitting finalize keeps split node and wall ids across 4 steps; after `seal()` + undo a new drag gets fresh ids and is stable within itself; preview step with no ids then a splitting step, then a non-splitting step then a splitting one gets the same id back). All undo checks deep-equal the start. Mutation: replay disabled -> all 4 plan tests fail; restored. Existing bus tests untouched.

### B. Review minors
1. `Planned<T>` and `hasError` hoisted to `validators.ts`; `PointParamSchema` hoisted to `define.ts`. Used in rooms, placements, fixtures, annotations, openings, moves and walls (walls/moves carried the same local PointSchema).
2. y-range tests added: `addFixture` (y), `movePlacement` (y).
3. `setFixtureProps` keep + rotation in one call tested (mutant `f.rotation` killed).
4. Test: an old short dimension (attached and free) can still be moved (offset) and detached.
5. Test: `moveWall` on a wall carrying an `addDimension`-made attached dimension recomputes points (right face y=-185).
6. annotations.ts header states the attached `addDimension` a/b contract carried to P4.

### Results
`yarn vitest run resources/js/engine`: 51 files, 2003 tests passed. eslint, prettier --check, vue-tsc clean.
