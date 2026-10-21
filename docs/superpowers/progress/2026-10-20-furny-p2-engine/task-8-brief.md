### Task 8: Plan schema, migrate, shared types, test plan builders

**Files:**
- Create: `resources/js/engine/plan/types.ts`, `resources/js/engine/plan/schema.ts`, `resources/js/engine/plan/migrate.ts`, `resources/js/engine/errors.ts`, `resources/js/engine/plan/testing/fixtures.ts`
- Test: `resources/js/engine/plan/__tests__/schema.test.ts`, `migrate.test.ts`, `testingFixtures.test.ts`

**Spec refs:** `03 §1` (all types), `03 §4`, `04 §0.4`, `04 §9` (builders)

**Interfaces:**
- Consumes: `FIXTURE_KEYS`, `ROOM_TYPES` (Task 7), `isEntityId` (Task 1).
- Produces:
  - `plan/types.ts`: `EngineMessage`, `DeriveIssue`, `Result<T,E>`, `Issue` + `IssueSchema` (`{ code; severity: 'error'|'warning'|'info'; messageKey; params; entityIds }`, shared by plan and furniture).
  - `plan/schema.ts`: zod schemas with `Schema` suffix and inferred types for `PlanDocument, PlanMeta, WallNode, Wall, Opening, DoorType, WindowType, RoomMeta, FurniturePlacement, Fixture, DimensionAnnotation, TextLabel, BackgroundImage, ViewState, Point`; `DOOR_TYPES`, `WINDOW_TYPES`, `WALL_KINDS`, `WALL_MATERIALS`, `FLOOR_FINISHES`. Schema is **structural** (types, enums, `.int()` for every `Mm`, `Deg` in `[0,360)`, record key === entity `id`, ids match `{prefix}_[0-9a-z]{10}`, `TextLabel.text` ≤ 200, colour `^#[0-9a-fA-F]{6}$|null`); numeric *ranges* are `validatePlan`'s job (Task 13) so imported documents still load.
  - `migrate.ts`: `PLAN_SCHEMA_VERSION = 1`, `PLAN_MIGRATIONS: Record<number, (doc: unknown) => unknown>` (empty for v1), `migratePlan(doc: unknown): PlanDocument` (runs migrations stepwise, then `PlanDocumentSchema.parse`).
  - `errors.ts`: `class EngineInputError extends Error { code: 'invalid_input' | 'unsupported_schema_version'; details?: unknown }` (thrown by `migratePlan`/`migrateFurniture`; CLI maps it).
  - `plan/testing/fixtures.ts` (test-only, not exported from index): `emptyPlan(meta?)`, `makeRectPlan(w, h, t, newId = testIds())`, `makeLPlan(newId?)`, `makeGridPlan(cols, rows, cell = 3000, newId?)`, `makeDirtyPlan(newId?)`.

- [ ] **Step 1: Write the failing tests** — schema accepts `emptyPlan()` and every builder output; rejects a wall with `thickness: 115.5` (non-integer), a record whose key ≠ `id`, a fixture with `libraryKey: 'piano'`, `rotation: 360`; `migratePlan({...doc, schemaVersion: 1})` returns an equal document; `migratePlan({schemaVersion: 2, …})` throws `EngineInputError` with code `unsupported_schema_version`; `migratePlan('nope')` throws code `invalid_input`; a registry test injects a fake `PLAN_MIGRATIONS[0]` step (v0→v1) and proves stepwise execution. Builders (deterministic ids):
  - `makeRectPlan(5000, 4000, 230)`: 4 nodes `(0,0),(5000,0),(5000,4000),(0,4000)`, 4 exterior walls in that cyclic order (`a→b`), meta `{ defaultWallHeight: 2700, defaultWallThickness: 115, floorThickness: 150, northAngle: null, createdWith: 'editor' }`, `view: { mode2d: null, mode3d: null, lastMode: '2d' }`.
  - `makeLPlan()`: nodes `(0,0),(5000,0),(8000,0),(8000,3500),(5000,3500),(5000,6000),(0,6000)`; exterior 230 walls `(0,0)→(5000,0)`, `(5000,0)→(8000,0)`, `(8000,0)→(8000,3500)`, `(8000,3500)→(5000,3500)`, `(5000,3500)→(5000,6000)`, `(5000,6000)→(0,6000)`, `(0,6000)→(0,0)`; interior 115 wall `(5000,0)→(5000,3500)`; door `single_swing` on the interior wall offset 1750 width 900; `main_entrance` on `(5000,6000)→(0,6000)` offset 2500 width 1000; casement windows on `(0,0)→(5000,0)` offset 2500 width 1500 and on `(8000,0)→(8000,3500)` offset 1750 width 1200 (sill 900, height 1200).
  - `makeGridPlan(cols, rows, cell)`: nodes `(i·cell, j·cell)` created for `j = 0..rows`, `i = 0..cols`; then horizontal walls `(i,j)→(i+1,j)` for `j` outer, `i` inner; then vertical walls `(i,j)→(i,j+1)` for `i` outer, `j` inner; boundary walls exterior 230, others interior 115; a `single_swing` 900 door (height 2100, offset `cell/2`) on each of the first 40 interior walls in ascending id order. Assert `makeGridPlan(7,6)` has 97 walls and 40 openings; `makeGridPlan(22,22)` has 1012 walls.
  - `makeDirtyPlan()`: the rect plan plus (a) two interior walls crossing without a shared node, (b) a wall collinear-overlapping half of the top wall, (c) one orphan node, (d) a window whose `offset` puts it 200 mm past the wall end, (e) two nodes 0.3 mm apart each with its own wall. Schema-valid.
- [ ] **Step 2: Run it, expect FAIL** — `yarn vitest run resources/js/engine/plan`
- [ ] **Step 3: Implement** — schemas per 03 §1; `Fixture.libraryKey: z.enum(FIXTURE_KEYS)`; `Opening.type` = union of door/window types and `'opening'` (kind consistency is a validate concern).
- [ ] **Step 4: Run tests, expect PASS** — same command.
- [ ] **Step 5: Quality gates** — `yarn eslint resources/js/engine && yarn prettier --check resources/js/engine && yarn vue-tsc --noEmit`
- [ ] **Step 6: Commit** — `git add resources/js/engine/plan resources/js/engine/errors.ts resources/js/engine/index.ts` → `feat(engine): add plan document schema, migrations and test builders`

