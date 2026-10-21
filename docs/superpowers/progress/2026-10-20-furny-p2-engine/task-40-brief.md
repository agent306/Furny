### Task 40: Table templates (4), furniture fixtures, template property test

**Files:**
- Create: `resources/js/engine/furniture/templates/{study_desk,dining_table,coffee_table,console_table}.ts`, `database/fixtures/furniture/tv-unit-1800.json`, `bookshelf-5shelf.json`, `kitchen-base-600.json`, `dining-table-6seat.json`, `study-desk-cabinet.json`
- Modify: `resources/js/engine/furniture/templates/index.ts` (`TEMPLATES` becomes `satisfies Record<TemplateKey, TemplateDefinition>`)
- Test: `resources/js/engine/furniture/templates/__tests__/tableTemplates.test.ts`, `fixtures.test.ts`, `property.test.ts`

**Spec refs:** `07 §2.4.14–§2.4.17`, `§2.1` rule 3, `§12.5`, `03 §6`

**Interfaces:**
- Consumes: Tasks 31, 37–39.
- Produces: the 4 table templates; complete `TEMPLATES` (19 keys, `Object.keys(TEMPLATES).length === 19`); the five fixture JSON files.

- [ ] **Step 1: Write the failing tests** — table templates: `study_desk` defaults = table spec of §2.4.14 (cabinet_ends 400, drawers ×3, `apron.enabled false`, stretcher true, `preferredMaterials.top PB25-WHITE`); `dining_table` defaults → top `{ shape: 'rectangle', thickness: 'material', cornerRadius: 0, overhang: 50 }`, apron 90/15, `legSource 'solid'`; `shape 'round'` forces `depth = width`; `rounded_rectangle` → cornerRadius 100; `coffee_table` overhang 30, apron 70/10, lowerShelf true; `console_table` drawers 2 → `storage.drawers { count: 2, side: 'front', slideCode: null }`, 0 → null. Fixtures (each = `getTemplate(key).generate(params, { catalog: indexCatalog(seedCatalog()), newId: testIds() })`, written once with `UPDATE_FIXTURES=1` then compared): `tv-unit-1800` = `tv_unit` defaults; `bookshelf-5shelf` = `bookshelf { …defaults, height: 2100 }` (shelfCount(2004, 330) = 5 per column, the reason for the file name); `kitchen-base-600` = `base_cabinet` defaults; `dining-table-6seat` = `dining_table` defaults; `study-desk-cabinet` = `study_desk` defaults; the wardrobe fixture test of Task 31 still passes. Property test (07 §12.5): `mulberry32(42)`, for each of the 19 templates the defaults plus 50 random parameter sets inside the declared field ranges (length fields snapped to `step`, selects uniformly, booleans 50/50, `allowAuto` ints 'auto' 25 %): `validateFurniture` has **no `error`** issues, ≤ 400 parts, every part `length ≥ width > 0`, every part box inside the bbox (±1 mm).
- [ ] **Step 2: Run it, expect FAIL** — `yarn vitest run resources/js/engine/furniture/templates`
- [ ] **Step 3: Implement** — 4 template files per §2.4.14–§2.4.17; then fix any template/generator combination the property test exposes (the failing seed and params are printed by the test via `expect(…, JSON.stringify(params))`).
- [ ] **Step 4: Run tests, expect PASS** — `UPDATE_FIXTURES=1 yarn vitest run resources/js/engine/furniture/templates/__tests__/fixtures.test.ts` once, then `yarn vitest run resources/js/engine/furniture`
- [ ] **Step 5: Quality gates** — `yarn eslint resources/js/engine && yarn prettier --check resources/js/engine database/fixtures/furniture && yarn vue-tsc --noEmit`
- [ ] **Step 6: Commit** — `git add resources/js/engine/furniture/templates database/fixtures/furniture` → `feat(engine): add table templates, furniture fixtures and template property test`


## Controller additions (binding)

The property test will expose known problems. These rulings settle them in advance. Log each one for spec 19.

**R40-1: long panels are split at seams.** This is a spec-19 addition modelled on the back split in §3.4.1.
- **Which parts:** a non-back, non-glass horizontal panel that fails `fitsSheet` along its length is split into pieces at seams. These are the carcass top and bottom, fixed shelves, the plinth front and back, the countertop, and the table top or its layers.
- **Choosing seams:** use the greedy rule of §3.4.1. Prefer seams over partitions (centre line) or over leg/apron supports for tables. Otherwise split evenly.
- **Part keys:** `<key>.1`, `<key>.2`, and so on.
- **Joints:** each seam gets a joint (connectors per §6.9).
- **Issues:** info `furniture.panel_split { partKey, count }`. If any seam has no support below it, also emit warning `furniture.panel_seam_unsupported { partKey, position }`.
- `part_exceeds_sheet` (error) stays only for a piece that still fails `fitsSheet` after splitting, or for a part that cannot be split. Sides are never split.

**R40-2: vertical parts taller than the sheet.** A side or upright whose length exceeds the largest sheet length of its material, after trim, stays an error. Adjust the template height ranges so that every in-range combination fits the **seed** catalog. Only `wardrobe_sliding` and `custom_box` are affected so far. Record each adjusted range in the report.

**R40-3: known template bugs.** Fix each of these at the root:
- `wardrobe_hinged` with doors 1 or 2 builds a one-child split (`section_tree_invalid`). Use `evenSplit`/`fitDoors`.
- `custom_box` height 100–115 gives `section_too_small`. Fix the range minimum or the layout.
- Table four_legs with thin legs (leg section ≠ board thickness): the §3.13 aprons cut into the legs and the stretchers collide. Position the aprons relative to the actual leg section.
- `console_table` at depth 350–355 gives `drawer_no_slide`. Raise the depth minimum, or use a shorter slide family if the catalog has one.

**R40-4: the property test also asserts no overlaps.** Use the no-overlap helper from Task 38, with the grooved-back exemption limited to the back against the sides, top and bottom. Every template, defaults plus 50 random sets.

If the property test exposes anything beyond R40-1..3, fix it at its root with a regression test and list it in the report. If a fix needs a design decision beyond these rulings, stop with NEEDS_CONTEXT and include the failing params.
