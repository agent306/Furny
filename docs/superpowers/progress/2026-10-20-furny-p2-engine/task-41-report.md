# Task 41 report: Furniture commands

Status: DONE_WITH_CONCERNS. Commit `e1433bf` `feat(engine): add furniture builder commands`, pushed to `origin/build/p2-engine`.

## What was implemented

`resources/js/engine/furniture/commands/`

| File | Content |
|---|---|
| `pipeline.ts` | `FurnitureCommandContext { catalog, newId }`, `FURNITURE_COMMAND_ERROR_CODES` (the six brief codes), `FURNITURE_COMMAND_KEY_PREFIX = 'engine.furniture.command'`, `furnitureCommandMessage`, `furniturePipeline` (= `defaultPipeline`, then `FurnitureDocumentSchema.safeParse` on the result; failure -> `invalid_document { path, issue }`, no state change; skipped when the command produced no patches). |
| `helpers.ts` | `defineFurnitureCommand` (fixes `mergeMode 'replace'`, `touchesGeometry false`), refusals (`fail`, `notFound`, `checkRange`, `checkCarcass`, `checkTable`, `carcassOf`, `tableOf`), write helpers that avoid empty patches (`assign`, `mergeFields`, `mergeDeep`, `sameJson`), `snapshot` (deep copy of a draft value), `pushDeleted`. |
| `dims.ts` | `setDims` |
| `construction.ts` | `setConstruction`, `setMounting`, `setPlinth`, `setBack`, `setCountertop`, `setHandles` |
| `sections.ts` | `splitSection`, `setChildSize`, `insertChild`, `removeChild`, `mergeSections`, `setContent`; exports `findSection`, `subtreeIds`, `rewireFronts`, `syncBehindDoor` |
| `fronts.ts` | `addFront`, `updateFront`, `removeFront` |
| `materials.ts`, `table.ts`, `notes.ts` | `setMaterial`, `setTable`, `setNotes` |
| `overrides.ts` | `setPartOverride`, `addExtraPart`, `updateExtraPart`, `removeExtraPart`, `setHardwareOverride`, `addExtraHardware`, `updateExtraHardware`, `removeExtraHardware`, `resetOverrides` |
| `registry.ts` | `FURNITURE_COMMANDS` (28 entries keyed `furniture.<name>`), `createFurnitureBus({ initial, catalog, newId?, maxHistory?, mergeBaseCache?, registry? })`, `furniturePathToEntityId(path, doc?)` |

Other files:
- `furniture/testing/commands.ts` (test-only: bus on the wardrobe fixture with ids continuing after the fixture's, `roundTrip` = apply / undo / redo check).
- `furniture/validate.ts`: `DIMENSION_RANGES` is now exported, so `setDims` clamps to the single source of 03 §2.4.
- `engine/index.ts`: exports the furniture command API, including `syncBehindDoor`.

Every command has a zod `paramsSchema`, `labelKey` `engine.furniture.command.label.<snake_name>`, and the mergeKey of the 07 §9 table (only those commands that list one).
`syncBehindDoor(draft)` sets `behindDoor` of every drawers leaf to "a front covers it directly or through an ancestor" (the `coveringFront` test). It runs after `splitSection`, `removeChild`, `mergeSections`, `setContent`, `addFront`, `updateFront`, `removeFront`.

## Tests and results

- Focused: `yarn vitest run resources/js/engine/furniture/commands` -> 9 files, 135 tests passed.
- Full: `yarn vitest run resources/js/engine` -> 100 files, 3542 tests passed.
- Gates: `yarn eslint resources/js/engine` clean, `yarn prettier --check resources/js/engine` clean, `yarn vue-tsc --noEmit` clean.

Test files (`commands/__tests__/`): `dims`, `construction`, `sections`, `fronts`, `materials`, `table`, `overrides`, `notes`, `registry`. Beyond the brief's list, `construction`, `notes` and `registry` were added (registry = 28 keys, labelKeys, exact mergeKey table, error codes, `furniturePipeline` with a test-only breaking command, `furniturePathToEntityId` unit cases, and `changedIds` of every one of the 28 commands through the bus). Every command is checked apply -> expected doc, undo -> deep-equal original, redo -> same result. `sections.test.ts` also validates the documents the section commands leave behind with `validateFurniture`: none is save-blocking.

### TDD evidence

RED: tests and the support file were written first. Command: `yarn vitest run resources/js/engine/furniture/commands`.
```
 FAIL  |engine| .../commands/__tests__/construction.test.ts
 FAIL  |engine| .../commands/__tests__/dims.test.ts
 ... (9 files)
Error: Cannot find module '../commands/registry' imported from '.../furniture/testing/commands.ts'
 Test Files  9 failed (9)
      Tests  no tests
```
Expected: the commands modules did not exist.

First GREEN run found 8 failures; all fixed:
- 3 were my test mistakes (merging after an undo/redo is not allowed by the bus; fixed by using a fresh bus).
- 4 were wrong expectations for `changedIds` of array removals (mutative emits a `length` patch, so a removal reads as `'*'`).
- 1 was a real bug: `snapshot()` returned the base object for an unmodified draft, so `syncBehindDoor` mutated the committed document in place after a content move. Fixed by deep-copying (`structuredClone`) in `snapshot`.

GREEN: see the results above.

## Rulings and ambiguities (please ledger for the spec 19 reconciliation)

1. **`furniturePathToEntityId(path, doc?)` needs the document.** Sections and fronts sit in arrays, so a patch path carries indices, not ids; a path-only function cannot return "the section/front id". The function takes an optional `doc`: with it, section / front / extra part / extra hardware paths resolve to ids; without it they are `'*'`. `createFurnitureBus` passes `bus.getDoc()`, which at the time the bus reads patches is the document they apply to. Details:
   - overrides `parts` / `hardware` -> the key;
   - a section path -> the deepest section it reaches; a child added, removed or replaced -> its parent; a child's `size` -> the child;
   - an index the doc does not have (an entity being added) -> parent section or `'*'`.
   Array removals produce a mutative `length` patch, so they contribute `'*'` (documented in the `changedIds` test). It is best effort for multi-patch sequences and for `replace` merges (patch indices are relative to intermediate states); the failure mode is over-reporting (`'*'`), never silence.
2. **`setChildSize` has an optional `drag?: boolean` param.** 07 §9 lists two merge keys, `size:{parentId}:{index}` and `drag:{parentId}`, and the params do not say which applies. `drag: true` -> `drag:{parentId}`, otherwise `size:{parentId}:{index}`. The brief's "mergeKey `drag:{parentId}`" is met when the elevation drag passes `drag: true`. Note for P4: a `replace` merge re-runs only the latest params, so a divider drag that must resize two neighbouring children needs one of them to be flex (or one command per gesture); that follows from 07 §9 + 04 §6.2, not from this task.
3. **Clamp vs refuse.**
   - Only `setDims` clamps (width 150-6000, height 100-3000, depth 100-1200), and rounds to whole mm.
   - A round table's diameter (width leads; depth alone sets it when no width is given) is clamped to 150-1200, the intersection of the width and depth ranges.
   - Others refuse with `out_of_range { field, min, max }`: `splitSection.count` 2-8, indices, `setChildSize`/`insertChild` sizes (`size.mm` 1-6000, `size.weight` 0.01-1000), plinth height / setback and countertop overhangs 0-6000. Bounds other than count 2-8 are my invention (07 §9 gives none).
4. **`removeChild` down to one child:** the parent keeps its id and size and takes the child's content (or split + children). Fronts that covered the child's id now cover the parent's id (otherwise the door of the section that stays would be deleted or dangle). 07 §9 only says "ids of deleted sections are removed from covers; a front left with empty covers is deleted", which is applied to the removed subtree. A front is only deleted when it lost covers in this command.
5. **`setPartOverride` / `setHardwareOverride` `patch` replaces the whole override** (`null` or `{}` deletes), since "empty object deletes too" has no meaning under merge semantics. `updateFront`, `updateExtraPart`, `updateExtraHardware` merge fields.
6. **Carcass / table commands on the wrong family** are refused `not_found { id: 'carcass' }` / `{ id: 'table' }` (no dedicated code in the brief's list).
7. **References are checked:** unknown section ids -> `not_found`; `covers` of a front must be non-empty (`invalid_params`) and name existing sections (`not_found`).
8. **`setMaterial` does not look codes up** in the catalog: `validateFurniture` reports `unknown_code` / `archived_code`. `ctx.catalog` is in the context per the brief but no command uses it yet.
9. **`setTable`:** `content` of storage cabinets is replaced, not merged (union type); a partial object patched into a `null` nullable (`drawers`, `endCabinets`) fails the schema check -> `invalid_document`. Switching a table to `shape: 'round'` through `setTable` does not couple `depth` to `width` (07 §9 only says that for `setDims`); the P4 editor should dispatch `setDims` in the same transaction.
10. `setPartOverride` and `setHardwareOverride` reject the key `__proto__` (`invalid_params`).
11. `syncBehindDoor` normalises every drawers leaf of the document (not only the touched ones), so a loaded document with an inconsistent `behindDoor` is corrected by the next front or content command.
12. `resetOverrides` removes map entries one by one (including `extra.<id>` part overrides); the extras lists are kept.

## Concerns

- Items 1 and 2 above are real deviations from the literal brief text (an extra optional `doc` argument, an extra optional `drag` param) that the controller may want to rule on before P4 relies on them.
- Added files beyond the brief's list: `helpers.ts` (shared refusal/write helpers; the plan side has `define.ts` + `validators.ts`), `furniture/testing/commands.ts`, and the test files `construction`, `notes`, `registry`. `sections.ts` is 466 lines (tree helpers + 6 commands + front rewiring); I did not split it.
- Touched `validate.ts` (one word: `export` on `DIMENSION_RANGES`).
- The new `purity.test.ts` check forbids the text `document.` anywhere in engine sources, comments included; I reworded my comments accordingly.

## Files changed

- `resources/js/engine/furniture/commands/{pipeline,helpers,dims,construction,sections,fronts,materials,table,overrides,notes,registry}.ts`
- `resources/js/engine/furniture/commands/__tests__/{dims,construction,sections,fronts,materials,table,overrides,notes,registry}.test.ts`
- `resources/js/engine/furniture/testing/commands.ts`
- `resources/js/engine/furniture/validate.ts`, `resources/js/engine/index.ts`

## Fix round 1

Review: `task-41-review.md` (spec pass, quality NEEDS FIXES). Rulings 1-9 above were accepted; the corrections below supersede the "never silence" claim of ruling 1.

### I1 (Important): never under-report in multi-patch changes

- **Cause:** the bus read every patch path against `bus.getDoc()`, which is the wrong document for a transaction commit, a redo/undo of a transaction and a rollback, so index paths named the wrong sibling.
- **Generic bus change (smallest additive, in `engine/commands`):** new optional config `entityIdsOf(base, patches)` (`types.ts`). When set it replaces the per-path `pathToEntityId`; `bus.ts::idsOf` now takes the base document. `base` is the pre-command doc for execute, redo, replace/compose merge (inverse then forward patches, both from the current doc) and transaction commit (`marks[0].doc`), and the pre-undo doc for undo and rollback. Without the option nothing changes; the plan bus is untouched. New `commands/__tests__/entityIdsOf.test.ts` pins the base document for each of those events.
- **Furniture:** `furnitureEntityIdsOf(base, patches)` (`registry.ts`, exported from the module) walks the patches in order, reading each path with `furniturePathToEntityId` against the doc it applies to and applying it with mutative's `apply` (only patches under `carcass.interior`, `carcass.fronts` and `overrides.extraParts/extraHardware` can move an index, so only those are applied). `createFurnitureBus` passes it as `entityIdsOf`; the doc-less `furniturePathToEntityId(path)` fallback (`'*'` for index paths) stays.
- **Contract (doc comment):** a reported section id means that section and its subtree may have changed; a front or extra id means that item changed; `'*'` means anything may have changed.
- **Tests (`registry.test.ts`, "changedIds across several patches"):** the reviewer's scenario (transaction `setContent(s_5)` then `insertChild(s_3, 0)`) reports `s_5` and `s_3` on commit, undo and redo, and on a rollback; a replace-merge drag reports the dragged child on the execute and both merges; no patches -> nothing, a `dims` patch -> `'*'`.

### I2 (Important): mergeSections behindDoor

`sections.test.ts` "mergeSections and drawers": drawers `behindDoor:false` in `s_4`, the door only on `s_5`; after `mergeSections(s_3)` the drawers are `behindDoor:true` (and the door covers `s_3`); and the converse with no door stays `false`. Mutation check: deleting `syncBehindDoor(d)` in `mergeSections` makes both fail (2 failed / 29 passed); restored, 31 passed.

### Minors

- M1 pinned and ledgered: `dims.test.ts` shows a replace merge keeps only the latest fields and that sealing between fields avoids it (07 §9: the editor seals on blur). No code change; ledger for P4.
- M2: `table.test.ts` switches an end cabinet from drawers to shelves and expects exactly the shelves content (kills the `ATOMIC` mutation). The pipeline still keeps the unparsed doc (stray keys are not refused); not changed.
- M3: fixed. `setPlinth` now sets height 0 whenever the resulting plinth type is `none` (`setMounting 'wall'` then `setPlinth {height:120}` keeps 0); test added.
- M4 (`syncBehindDoor` normalises all drawers leaves), M5 (`mergeSections` deletes the later front even if it covers other sections: literal 07 §9) and M8 (`fixed_sizes_exceed` is the validator's job): declined as code changes, ledgered for spec 19.
- M6: fixed. `addFront` and `updateFront` list each covered section once; tests added.
- M7: covered by the I1 tests (undo, redo, rollback, transaction commit, replace merge).

### Evidence

RED (before the fix): `yarn vitest run resources/js/engine/furniture/commands` -> 6 failed / 140 passed: the three `registry` I1 tests (commit/undo/redo and rollback reported `s_4`, `s_3` and not `s_5`; `furnitureEntityIdsOf` missing), plus M3 (height stayed 120) and the two M6 tests.
GREEN: `yarn vitest run resources/js/engine` -> 101 files, 3556 tests passed. `yarn eslint resources/js/engine`, `yarn prettier --check resources/js/engine` and `yarn vue-tsc --noEmit` clean.

Files changed: `engine/commands/{bus,types}.ts`, `engine/commands/__tests__/entityIdsOf.test.ts`, `furniture/commands/{registry,construction,fronts}.ts`, and the `dims`, `construction`, `sections`, `fronts`, `table`, `registry` tests.

## Fix round 2

- **M5 (Important), `mergeSections` and fronts that reach beyond the merge.** Deviation from the literal 07 §9 text, for the spec 19 ledger: when two or more fronts end up covering the merged section, the first keeps it; for each later front only the merged id is removed from its `covers`, and the front is deleted only if `covers` becomes empty (07 §9 deletes the whole later front). A section outside the merge that the later front also covered therefore keeps its door, whatever the order of the fronts. Code: `sections.ts` (`mergeSections`).
  - Tests (`sections.test.ts`, "mergeSections and a front that reaches beyond the merge"): the reviewer's reproduction in both front orders (pair front `[s_7, s_5]` first and second): `s_5` and `s_4` are each covered exactly once, the changed section and the front whose covers changed appear in `changedIds`, the expected ids are in `deletedIds`, undo restores the original; plus a document-level case (`fr_2` `[s_6]`, `fr_3` `[s_7, s_5]` -> `[s_4]` and `[s_5]`). Against the previous code 2 of these fail (RED), with the change all pass.
- **Minor, `indexed` in `registry.ts`.** `furnitureEntityIdsOf` now also applies patches that replace an ancestor wholesale (`[]`, `['carcass']`, `['overrides']`), so later index patches in the same list are read against the new document. Test in `registry.test.ts`: a `['carcass']` replace with reversed fronts followed by `fronts[0].overlay` reports `{'*', fr_2}` (RED before: `fr_1`).
- Verification: `yarn vitest run resources/js/engine` -> 101 files, 3560 tests passed; eslint, `prettier --check` and `vue-tsc --noEmit` clean.
