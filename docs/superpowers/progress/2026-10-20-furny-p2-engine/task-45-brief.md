### Task 45: `diffFurniture` + `highlightMap`

**Files:**
- Create: `resources/js/engine/furniture/diff.ts`, `resources/js/engine/furniture/diffHighlight.ts`
- Test: `resources/js/engine/furniture/__tests__/diff.test.ts`

**Spec refs:** `07 §10.1–§10.4`, `07 §12.6`, `03 §3.4`

**Interfaces:**
- Consumes: Tasks 33 (`layoutSections` labels), 36–37, 42–44 (`computeBom`, `bomOptionsFor`, `priceBom`).
- Produces: `ChangeItem` type, `CHANGE_KINDS`, `CHANGE_MESSAGE_KEYS`, `diffFurniture(before: unknown, after: unknown, catalog: CatalogSnapshot): ChangeItem[]`; `Highlight`, `highlightMap(beforeModel, afterModel): Map<PartKey, Highlight>`.

- [ ] **Step 1: Write the failing tests** (07 §12.6) — identical docs → `[]`; wardrobe vs width 2100 → first item `price_changed` (major, `direction 'up'`), then `dims_changed { dimension: 'width', beforeMm: 1800, afterMm: 2100 }` (major); part changes collapsed into one `parts_changed_many { count }` item; no `front_*` items; wardrobe vs `fr_0000000002.overlay = 'half'` → `front_changed { fields: 'overlay' }` minor, `hardware_qty_changed` HNG-FO-SC 8 → 4 and HNG-HO-SC 4 → 8, part changes for the two leaves; extra hardware `LCK-CAM-20 × 1` → `hardware_added { qty: 1 }`; notes change → `notes_changed` minor; `material_changed` for carcass is major, for drawer_box minor, edge band change minor, finish change major; `construction_changed` on `mounting` major, on `plinth.height` minor with `beforeMm/afterMm`; `section_changed` added/removed/layout/size; ordering = significance → kind rank → entityId (null first) → messageKey; `highlightMap`: width change marks `carcass.top` `changed`; a removed extra part → `removed`; an added part → `added`.
- [ ] **Step 2: Run it, expect FAIL** — `yarn vitest run resources/js/engine/furniture/__tests__/diff.test.ts`
- [ ] **Step 3: Implement** — 07 §10.1 steps (migrate both, generate, BOM with nesting, price `{ quantity: 1, includeInstallation: false }`), rule table §10.2, ordering §10.3, highlight rules §10.4 (box delta > 1 mm).
- [ ] **Step 4: Run tests, expect PASS** — same command.
- [ ] **Step 5: Quality gates** — `yarn eslint resources/js/engine && yarn prettier --check resources/js/engine && yarn vue-tsc --noEmit`
- [ ] **Step 6: Commit** — `git add resources/js/engine/furniture resources/js/engine/index.ts` → `feat(engine): diff furniture designs for change review`

