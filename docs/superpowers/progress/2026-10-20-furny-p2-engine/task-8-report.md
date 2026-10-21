# Task 8 report: plan schema, migrate, shared types, test builders

Status: DONE (commit 18c0fff, base 7da6c02)

## Implemented
- `engine/errors.ts`: `EngineInputError` (code `invalid_input` | `unsupported_schema_version`, `details?`).
- `plan/types.ts`: `EngineMessage`, `DeriveIssue`, `Result`, `Issue` + `IssueSchema`.
- `plan/schema.ts`: all schemas of 03 §1 with `Schema` suffix and inferred types; `DOOR_TYPES`, `WINDOW_TYPES`, `WALL_KINDS`, `WALL_MATERIALS`, `FLOOR_FINISHES`. Uses `ROOM_TYPES`, `FIXTURE_KEYS`, `isEntityId`.
  Structural: `.int()` on every Mm; Deg in [0,360); record key === id (superRefine); ids checked with `isEntityId(id, prefix)`; text <= 200; colour regex or null; `schemaVersion` literal 1.
- `plan/migrate.ts`: `PLAN_SCHEMA_VERSION = 1`, `PLAN_MIGRATIONS` (empty), `migratePlan`. Step `n` upgrades n -> n+1; the runner stamps `schemaVersion` after each step, so a step cannot loop. Newer version, or an older one with no registered step -> `unsupported_schema_version`; non-object / bad or missing version / non-object step result / schema failure -> `invalid_input` (zod issues in `details.issues`).
- `plan/testing/fixtures.ts`: `emptyPlan`, `makeRectPlan`, `makeLPlan`, `makeGridPlan`, `makeDirtyPlan` (not exported from index). Index exports errors, types, schemas, migrate.

## Decisions / things to know
- C15 applied: `makeDirtyPlan` (e) = two distinct nodes at identical coordinates (4400,3500), each with its own wall. (a) crossing walls (1000,1000)-(4000,3000) and (1000,3000)-(4000,1000); (b) interior wall (1250,0)-(3750,0) over the middle half of the top wall (own nodes); (c) orphan node (6500,500); (d) 1200 casement at offset 3600 on the 4000 mm right wall (ends 200 past the end).
- Numeric ranges of 03 §1.1 (thickness 50-1000, height 300-10000, opening width 300-6000, sill 0-3000, coords +-1e6) are NOT in the schema, per the brief (validatePlan, Task 13). Range checks that ARE in the schema, because they are part of the §1 type definitions: Deg [0,360), `BackgroundImage.opacity` 0..1, `TextLabel.text` <= 200. Vision/pydantic mirror: enforce the same three, and leave the §1.1 ranges to validation. Note zod `max(200)` counts UTF-16 units, pydantic counts code points (differs only for astral chars).
- Cross-entity references (`Wall.a/b`, `Opening.wallId`, `wallAttachment.wallId`, `attachedTo.wallId`, `designId`) are plain strings, not id-format checked, so a dangling/odd reference surfaces as a validatePlan issue rather than a parse failure. `Wall.a !== b` is also left to validatePlan (`wall_degenerate`).
- Objects use zod default (unknown keys stripped, not rejected). Builder doors/windows use hinge `start`, swing `left`, label null; door height 2100; wall material `brick`, height 2700.
- Grid door offset is `Math.round(cell / 2)` to stay integer for odd cells. Grid door walls = first 40 interior wall ids sorted ascending (string sort).
- `migratePlan` throws `EngineInputError` for schema failures instead of a raw ZodError (brief says "then parse"; CLI mapping needs the typed error). `migrateFurniture` is not in this task.

## Tests
- RED: with `schema.ts`/`migrate.ts` removed, `yarn vitest run --project engine resources/js/engine/plan` -> 3 files FAIL, "Cannot find module '../migrate'" / "'../schema'" (expected: implementation absent).
- GREEN: same command, 5 files, 169 tests pass (schema 20, migrate 16, testingFixtures 20 new). Full engine project: 22 files, 606 tests pass (includes purity scan).
- Gates: `yarn eslint resources/js/engine`, `yarn prettier --check resources/js/engine`, `yarn lint`, `yarn typecheck` (vue-tsc) all clean; `yarn build:engine-cli` builds.
- Builder assertions: rect nodes/walls order; L plan nodes, walls, 4 openings with offsets/widths; grid (7,6) = 97 walls/40 openings, (22,22) = 1012 walls, (3,3) = 24 walls/12 doors, 26 exterior/71 interior, creation order; dirty plan items (a)-(e) each asserted (crossing and collinear overlap via `intersectSegments`).

## Files
resources/js/engine/{errors.ts, index.ts}; resources/js/engine/plan/{types.ts, schema.ts, migrate.ts, testing/fixtures.ts}; resources/js/engine/plan/__tests__/{schema,migrate,testingFixtures}.test.ts

## Self-review
No issues outstanding. Minor: `OpeningSchema` accepts kind/type mismatches by design (validate concern).
