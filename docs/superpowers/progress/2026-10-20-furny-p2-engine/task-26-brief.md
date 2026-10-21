### Task 26: Room meta, placement, fixture, dimension, label commands

**Files:**
- Create: `resources/js/engine/plan/commands/rooms.ts`, `placements.ts`, `fixtures.ts`, `annotations.ts`
- Modify: `resources/js/engine/plan/commands/registry.ts`
- Test: `resources/js/engine/plan/commands/__tests__/rooms.test.ts`, `placements.test.ts`, `fixtures.test.ts`, `annotations.test.ts`

**Spec refs:** `04 §6.6` (rows `setRoomMeta` … `deleteLabels` and their bullets)

**Interfaces:**
- Consumes: Tasks 15, 21–22, `FIXTURE_LIBRARY`.
- Produces: registry entries `setRoomMeta` (`roomMeta:{faceKey}`), `deleteRoomMeta`, `addPlacement`, `movePlacement` (`placement:{id}`), `rotatePlacement` (`placementRot:{id}`), `setPlacementProps`, `deletePlacements`, `addFixture`, `moveFixture` (`fixture:{id}`), `setFixtureProps` (`fixtureProps:{ids}`), `deleteFixtures`, `addDimension`, `setDimension` (`dim:{id}`), `deleteDimensions`, `addLabel`, `setLabel` (`label:{id}`), `deleteLabels`.

- [ ] **Step 1: Write the failing tests** — `setRoomMeta` on a face without meta creates `{ id: 'r_…', anchor: roundPoint(labelPoint), name: '', type: 'other', floorFinish: 'tile', floorColorHex: null, labelOffset: null, showArea: true, ...props }` with `created: true`; second call updates (`created: false`); unknown faceKey → `not_found`; name trimmed and > 80 chars → `out_of_range`; `addPlacement` with a provider returning `null` → `design_unknown`; rotation 370 normalised to 10; `rotatePlacement {pivot:'center'}` keeps the footprint centre fixed (`P' = C − f(θ')·D/2`) and detaches unless the attached face's rotation matches within 0.5°; `addFixture {libraryKey:'bed_double'}` → 1400 × 1900 × 900, elevation 0, label null; `'piano'` → `fixture_unknown`; `setFixtureProps {width: 1600, keep: 'back_left'}` keeps the back-left corner fixed; changing `libraryKey` resets sizes to the new defaults unless given; `addDimension` with `|a−b| = 9` → `dimension_too_short`, `|offset| > 50000` → `out_of_range`; attached dimension points recomputed from the wall face after the command; `addLabel` text `'  hi  '` stored `'hi'`, empty → `text_length`, default `fontSize 250`; all with undo deep-equal.
- [ ] **Step 2: Run it, expect FAIL** — `yarn vitest run resources/js/engine/plan/commands/__tests__/rooms.test.ts resources/js/engine/plan/commands/__tests__/placements.test.ts resources/js/engine/plan/commands/__tests__/fixtures.test.ts resources/js/engine/plan/commands/__tests__/annotations.test.ts`
- [ ] **Step 3: Implement** — one `definePlanCommand` per row; `touchesGeometry` per the table (dimensions `yes¹`).
- [ ] **Step 4: Run tests, expect PASS** — `yarn vitest run resources/js/engine/plan`
- [ ] **Step 5: Quality gates** — `yarn eslint resources/js/engine && yarn prettier --check resources/js/engine && yarn vue-tsc --noEmit`
- [ ] **Step 6: Commit** — `git add resources/js/engine/plan/commands` → `feat(engine): add room, placement, fixture and annotation commands`

