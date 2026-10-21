### Task 39: Carcass templates (14)

**Files:**
- Create: `resources/js/engine/furniture/templates/{wardrobe_sliding,loft_cabinet,base_cabinet,wall_cabinet,tall_cabinet,bookshelf,open_shelf_wall,tv_unit,shoe_rack,chest_of_drawers,sideboard,bedside_table,dressing_unit,custom_box}.ts`
- Modify: `resources/js/engine/furniture/templates/index.ts`
- Test: `resources/js/engine/furniture/templates/__tests__/carcassTemplates.test.ts`

**Spec refs:** `07 §2.4.2–§2.4.13`, `§2.4.18–§2.4.19`, `§2.1` rules 2–5, `§2.3`

**Interfaces:**
- Consumes: Task 31 helpers, Task 37 (`validateFurniture`).
- Produces: 14 `TemplateDefinition`s registered in `TEMPLATES`. Every `'auto'` param is resolved to a number before building the document.

- [ ] **Step 1: Write the failing tests** — one `describe` per template asserting its default document structure from §2.4 with `testIds()` (root split, child weights/sizes, contents, fronts, mounting/plinth/back/construction) and that `validateFurniture` has no `error`: e.g. `wardrobe_sliding` → 3 flex columns (shelves / rows[350 empty, rod] / shelves), one sliding front over root with `leaves: 3`, `hingeCode null`, `slidingTrackCode 'auto'`, plinth setback 0, handles `HDL-FLUSH`; `loft_cabinet` → mounting `loft`, back `nailed`, 3 empty columns + hinged fronts; `flap_up` variant → one `flap_up` front per column; `base_cabinet` variants `door` / `drawers` (`SLD-UM-450`, no Front) / `door_drawer` (rows fixed 150 drawers + flex shelves, door over row 2) / `basket`; `countertop: true` sets countertop overhangFront 20 and `materials.top = PB25-WHITE`; `wall_cabinet` height 700 → 2 shelves, 600 → 1, `open` → no front; `tall_cabinet` with niche → rows `[flex, fixed 600 empty, flex]`, doors on rows 1 and 3; `bookshelf` 900 → 2 columns of shelfCount(1704, 330) = 4 shelves, `lowerDoors` → rows with a fixed 700 lower part and hinged fronts; `open_shelf_wall` 1200 × 400 → rows auto 1 → columns auto 2, construction `over_sides`, back `none`, no fronts; `tv_unit` defaults → `columns[w1 drawers(2) | w2 empty | w1 shelves(1)]` + door(col3, 1, right), legs plinth 100 setback 0, top `over_sides`; `shoe_rack` 800 → 2 columns, hinge left then right; `chest_of_drawers` 800 × 1000 → 1 column, `drawerCount auto = 4`; width 1100 → 2 columns; `sideboard` legHeight 0 → plinth none; `bedside_table` three variants; `dressing_unit` rows `[flex columns(3) / fixed 510 columns(2)]` for drawerRows 3; `custom_box` → root leaf empty, no fronts.
- [ ] **Step 2: Run it, expect FAIL** — `yarn vitest run resources/js/engine/furniture/templates`
- [ ] **Step 3: Implement** — one file per template from §2.4 (fields with ranges/defaults/`advanced`/`visibleIf` as tabled; hardware codes only through `ctx.catalog.defaultHardware`).
- [ ] **Step 4: Run tests, expect PASS** — same command.
- [ ] **Step 5: Quality gates** — `yarn eslint resources/js/engine && yarn prettier --check resources/js/engine && yarn vue-tsc --noEmit`
- [ ] **Step 6: Commit** — `git add resources/js/engine/furniture/templates` → `feat(engine): add carcass furniture templates`

