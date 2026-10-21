# Task 45 report: `diffFurniture` + `highlightMap`

Status: DONE

## Implemented
- `resources/js/engine/furniture/diff.ts`: `ChangeItem`, `ChangeKind`, `CHANGE_KINDS` (rank order, 07 §10.3), `CHANGE_MESSAGE_KEYS` (all 24 `changes.*` keys), `CHANGE_FIELD_LABELS_EN` (English labels for construction paths), `diffFurniture(before, after, catalog)`.
  - Pipeline per 07 §10.1: `migrateFurniture` both, `generateFurniture`, `computeBom(bomOptionsFor(doc, true))`, `priceBom({ quantity: 1, includeInstallation: false })`, same catalog on both sides.
  - Rules per 07 §10.2: price (major iff `abs(delta)*100 > 2*max(1,before)`, integer arithmetic; `deltaPct` one decimal), dims, material / edge band / finish (roles with parts in either model only), construction (flattened paths; length paths use `beforeMm/afterMm`), sections (layout / size / top-most added / top-most removed), content, fronts, parts (collapse above 10 per list), hardware by code from the BOMs, notes.
  - Ordering per 07 §10.3 via a stable comparator (significance, kind rank, entityId with null first via `cmpId`, messageKey).
  - Reuses `cmpId`, `partNameEn`, `layoutSections` labels (07 §3.7 rendering "Column 2 › Row 1"), `indexCatalog`, `migrateFurniture`.
- `resources/js/engine/furniture/diffHighlight.ts`: `Highlight`, `highlightMap(beforeModel, afterModel)` per 07 §10.4 (box min/size delta > 1 mm).
- `resources/js/engine/index.ts`: exports `CHANGE_FIELD_LABELS_EN`, `CHANGE_KINDS`, `CHANGE_MESSAGE_KEYS`, `diffFurniture`, `ChangeItem`, `ChangeKind`, `highlightMap`, `Highlight`.
- Test: `resources/js/engine/furniture/__tests__/diff.test.ts` (27 tests).

## TDD evidence
RED (before `diff.ts` / `diffHighlight.ts` existed):
```
Caused by: Error: Failed to load url ../diff (resolved id: ../diff) in .../__tests__/diff.test.ts. Does the file exist?
Test Files  1 failed (1)   Tests  no tests
```
First GREEN run: 25/27 passed; the two failures were wrong test assumptions (changing only the carcass material touches 5 parts, not >10; the back panel key is split), fixed in the tests (no code change): the collapse test now changes five roles, the highlight test checks every `carcass.back*` key.

GREEN: `yarn vitest run resources/js/engine/furniture/__tests__/diff.test.ts` -> `Test Files 1 passed (1), Tests 27 passed (27)`.

## Gates
- `yarn eslint resources/js/engine`: clean. `yarn prettier --check resources/js/engine`: clean. `yarn vue-tsc --noEmit`: clean.
- `yarn lint`: exit 0. `yarn typecheck`: clean.
- Full `yarn vitest run`: 201 files, 5091 tests. Only the ENV.md known baseline failures: `validate.test.ts > contains every furniture code literal…`, `format.test.ts` de-CH x2. A first full run also showed `AddressFields.test.ts` timing out (5000 ms) and an AppShell `document is not defined` unhandled error under load; a second full run did not reproduce either (host-load flakes in unrelated app tests).

## Test coverage (07 §12.6 and rules)
Identical docs -> `[]`; width 2100 (price major up, dims 1800 -> 2100, `parts_changed_many`, no `front_*`); `fr_0000000002` half overlay (`front_changed { fields: 'overlay' }` minor, HNG-FO-SC 8 -> 4, HNG-HO-SC 4 -> 8, leaf part changes); extra `LCK-CAM-20 x 1` -> `hardware_added { qty: 1 }`; hardware_removed; notes; carcass material major, drawer_box minor (wardrobe with `internalDrawers: 2`, per ruling I6), role without parts emits nothing, edge band minor ('Default'), finish major ('None'); construction `mounting` major, `plinth.height` minor with `beforeMm/afterMm`, countertop null -> set as one item, `templateKey` major; section size / layout / added / removed; content summaries; front added / removed / glass change major; part added / removed / collapse (changed, added, removed); ordering; determinism and input immutability; `highlightMap` changed / added / removed / empty.

## Deviations / decisions
1. `contentChanges`: `content: null` is treated as `{ type: 'empty' }` before the deep compare, so null vs empty is not reported (it would read "empty -> empty").
2. Construction paths: carcass paths are relative to `carcass` (`mounting`, `plinth.height`, `back.type`), table paths are prefixed `table.` (matching the major list in 07 §10.2). A nullable object (e.g. `countertop`, `table.storage.drawers`) going between null and set yields one item on the object path, with the string "Set" in the params (raw object in `before/after`); sub-fields are not listed separately. Paths present on only one side (e.g. the whole `carcass` vs `table` after a family change) are not itemised; `templateKey` / `family` cover that.
3. `section_changed.before/after` are `{ id, split, content }` (spec: "section JSON without children"); sizes are therefore visible only in the message, not the payload.
4. English names invented where the spec gives none: front kinds ("Door", "Sliding door", "Flap up", "Flap down"), front field names ("hinge side", "sliding track", ...), part field names ("material", "edges", ...), material role names, construction field labels (`CHANGE_FIELD_LABELS_EN`, exported so Task 51 can use it for `changes.fields.*`).
5. `notes_changed` uses strict `!==` (null vs '' counts as a change), the literal reading of "notes differ".
6. Section label rendering: the root's "Interior" is dropped from a chain ("Column 2 › Row 1") and shown alone only for the root. Section and front labels prefer the "after" side, with the "before" side as fallback and the raw id as last resort (table documents have no labels).
7. `highlightMap` also compares extruded geometry (y, thickness, outline points within 1 mm) and flags a geometry-kind change as `changed`; the spec only names boxes.

## Concerns
None blocking. Section sizes are not in the `section_changed` payload (deviation 3); a UI that needs them reads the documents.
