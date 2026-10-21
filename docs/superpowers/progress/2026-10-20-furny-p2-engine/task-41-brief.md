### Task 41: Furniture commands

**Files:**
- Create: `resources/js/engine/furniture/commands/{dims,construction,sections,fronts,materials,table,overrides,notes,registry,pipeline}.ts`
- Test: `resources/js/engine/furniture/commands/__tests__/{dims,sections,fronts,materials,overrides,table}.test.ts`

**Spec refs:** `07 §9`, `07 §12.5` (commands), `04 §6.1–§6.2`

**Interfaces:**
- Consumes: Task 20 (`createCommandBus`, `defaultPipeline`), Tasks 30–40.
- Produces: `FurnitureCommandContext { catalog: CatalogIndex; newId }`; `FURNITURE_COMMAND_ERROR_CODES = ['not_found','invalid_params','not_leaf','not_split','out_of_range','invalid_document']`; `furniturePipeline` (default pipeline + `FurnitureDocumentSchema.safeParse` after `run` → `invalid_document`); `FURNITURE_COMMANDS` (28 entries keyed `furniture.setDims` … `furniture.setNotes`, `mergeMode 'replace'`, `touchesGeometry false`, labelKey `engine.furniture.command.label.<snake_name>`); `createFurnitureBus({ initial, catalog, newId? })`; `furniturePathToEntityId(path)` (sections/fronts by id where the path walks `carcass.interior`/`carcass.fronts`, overrides by key, else `'*'` for root collections).

- [ ] **Step 1: Write the failing tests** (wardrobe fixture, `testIds()` continuing after the fixture ids; each command: apply → expected doc; undo → deep-equal original): `setDims { width: 7000 }` clamps to 6000; round tables keep `depth = width`; consecutive `setDims` with `merge: true` → 1 entry (mergeKey `dims`); `setMounting 'wall'` resets plinth to none; `setPlinth { type: 'none' }` sets height 0; `splitSection` on leaf `s_0000000002` into 2 columns → content moves to child 1, child 2 `empty`, both flex 1, front `fr_0000000001` still covers `s_0000000002`; on a non-leaf → `not_leaf`; drawers moved under a Front get `behindDoor true`; `setChildSize` with mergeKey `drag:{parentId}`; `insertChild` default flex 1; `removeChild` down to one child makes the parent a leaf with that content and deletes fronts left with empty `covers`; `mergeSections` rewires `covers` (dedupe; second front covering the merged id deleted); `setContent` drawers under a Front → `behindDoor true`; `addFront` creates `fr_…` and syncs drawers; `updateFront` covers change re-syncs; `removeFront` resets `behindDoor false`; `setMaterial { role: 'carcass', materialCode: 'PB18-OAK', applyToRoles: ['shelf','plinth'] }`; `setTable` deep-merges and replaces arrays; `setPartOverride` with `null` or `{}` deletes the entry; `removeExtraPart` also deletes `overrides.parts['extra.' + id]`; `resetOverrides 'parts'` keeps extras; `setNotes '  '` → `null`; `furniturePipeline` with a test-only command that writes `dims.width = 1.5` → `invalid_document`, doc unchanged; `Object.keys(FURNITURE_COMMANDS).length === 28`.
- [ ] **Step 2: Run it, expect FAIL** — `yarn vitest run resources/js/engine/furniture/commands`
- [ ] **Step 3: Implement** — one `CommandDef` per 07 §9 row with zod `paramsSchema`, semantics column verbatim; shared `syncBehindDoor(draft)` helper.
- [ ] **Step 4: Run tests, expect PASS** — same command.
- [ ] **Step 5: Quality gates** — `yarn eslint resources/js/engine && yarn prettier --check resources/js/engine && yarn vue-tsc --noEmit`
- [ ] **Step 6: Commit** — `git add resources/js/engine/furniture/commands resources/js/engine/index.ts` → `feat(engine): add furniture builder commands`

