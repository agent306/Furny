# Task 30 report: furniture schema, migrate, constants, model types, makePart, part names

## Implemented
- `furniture/schema.ts`: zod 4 schemas for 03 §2 (document, materials, carcass, recursive Section via getters, Content, Front, TableSpec, Overrides, PartOverride, ExtraPart, HardwareOverride, ExtraHardware, EdgeId), `TEMPLATE_KEYS` (19), `PartKey`/`HardwareKey`. `MATERIAL_ROLES`/`MaterialRole` are re-exported from `catalog/snapshot.ts`, not redefined (the index exports them from the catalog only).
- `furniture/migrate.ts`: `FURNITURE_SCHEMA_VERSION = 1`, empty `FURNITURE_MIGRATIONS`, `migrateFurniture` (same shape as `migratePlan`).
- `furniture/constants.ts`: all 55 constants of 07 §1.3 by name and value, plus `fl(v) = Math.floor(v + 1e-6)` (07 §0 defines that epsilon).
- `furniture/types.ts`: Box3, Axis, PhysEdge, Part, HardwareLine, ModelFront, FurnitureModel, PanelSpec, Joint, GenContext (+ PartOperations, PartGeometry, PartGrain).
- `furniture/context.ts`: `createGenContext(doc, catalog)` with `mat`, `t`, `roleBand`, `issue`, `addHardware`.
- `furniture/parts.ts`: `makePart` (rules 1-8 of 07 §1.2), `mapEdges(lengthAxis, widthAxis)`, `mapGrain(grainAxis, lengthAxis, widthAxis)`.
- `furniture/partNames.ts`: `PART_NAMES_EN` (38 templates, one per 07 §1.6 nameKey), `partNameEn`.
- `engine/index.ts`: public exports in the existing explicit style.

## Decisions / interpretations
- Issue `messageKey`: 07 specifies no prefix for furniture issues (it only says English text lives in `issues.php`). Chosen: `engine.furniture.issue.<code without the "furniture." prefix>`, e.g. `furniture.shelf_sag` -> `engine.furniture.issue.shelf_sag` (strips the domain prefix exactly like the plan convention `plan_editor.issues.<code minus "plan.">`). Reuses `Issue` from `plan/types.ts`.
- `createGenContext` accepts a `CatalogSnapshot` (07 §3.1 `generateFurniture(doc, catalog)`) or an already-built `CatalogIndex` (templates use an index).
- `ctx.edgeMap` is `Map<PartKey, Record<EdgeId, PhysEdge>>` as 07 §1.2 says.
- `ctx.mat(role)` throws `EngineInputError('invalid_input')` only when the catalog has no usable material at all (no active material to fall back to). Otherwise an unknown code falls back to `defaultMaterialFor(role)`.
- `makePart` looks the spec's `materialCode` up in the catalog and falls back to `ctx.mat(spec.role)`; `Part.materialCode` is the effective (resolved) code, consistent with 07 §3.1 step 2 ("replaced for generation only"). Thickness and `hasGrain` come from that material.
- `Part.geometry` default is a copy of `box` as given (fractional values kept); only `length`/`width` are floored with `fl`.
- Schema is structural only: no section-tree consistency, family/null pairing or dimension ranges (validateFurniture). Enforced count ranges from the 03 comments: shelves 1..20, drawers 1..10, table drawers 0..3, extra part qty 1..99, flex weight > 0. `leaves` is `int | 'auto'` (no range), `basket count` is an int (03 writes no range). `materials` and `ExtraPart.edges` are exhaustive records (missing role/edge rejected); `PartOverride.edges` is a partial record. Unknown keys are stripped (zod default), as for the plan schema.
- `PartKey`/`HardwareKey` live in `schema.ts` (03 §2.3) and are re-exported from the index.

## TDD evidence
- RED: with the 7 implementation files moved away, `yarn vitest run resources/js/engine/furniture` -> `Test Files 4 failed | 1 passed` (the 4 new test files fail to resolve their modules; catalogIndex still passes).
- GREEN: `yarn vitest run resources/js/engine/furniture` -> 5 files, 68 tests passed (48 new: schema 16, parts 21, partNames 4, context 7).

## Verification
- `yarn eslint resources/js/engine`: clean. `yarn prettier --check resources/js/engine`: clean. `yarn vue-tsc --noEmit`: clean.
- `yarn vitest run resources/js/engine`: 62 files, 2225 tests passed (includes the purity test and lint-rule test).

## Files
Created: `resources/js/engine/furniture/{schema,migrate,constants,types,context,parts,partNames}.ts`, `furniture/__tests__/{schema,parts,partNames,context}.test.ts`. Modified: `resources/js/engine/index.ts`.

## Self-review
- Tests cover 07 §1.2 examples (side/top/door, square-panel grain tie-break, banding, bandCode null/override, grain none/length/width), `fl`, 07 §12.2 fixture round-trip, rejections (count 0, `leaves: 'many'`, `L3`), v1 no-op and v2 throw.
- No deviations from the spec needing a "ledgered for the spec 19 reconciliation" comment; the messageKey prefix is the only gap in 07 and is reported above.

## Concerns
- messageKey prefix `engine.furniture.issue.*` is my mirror of the plan convention; later tasks (validate, lang files) must agree with it.
