### Task 31: Template infrastructure + `wardrobe_hinged` + wardrobe fixture

**Files:**
- Create: `resources/js/engine/furniture/templates/types.ts`, `common.ts`, `index.ts`, `wardrobe_hinged.ts`, `database/fixtures/furniture/wardrobe-3door.json`
- Test: `resources/js/engine/furniture/templates/__tests__/common.test.ts`, `wardrobe_hinged.test.ts`

**Spec refs:** `07 §2.1–§2.3`, `07 §2.4.1`, `07 §2.5` (`reidentify`), `07 §12.1–§12.2` (fixture JSON)

**Interfaces:**
- Consumes: Tasks 29–30, `testIds()`.
- Produces: `TemplateCategory`, `Condition`, `ParamField`, `TemplateContext { catalog: CatalogIndex; newId }`, `TemplateDefinition<P>`; `common.ts`: `resolveDefaultMaterials(def, ctx)`, `commonCarcass(ctx): Omit<CarcassSpec,'interior'|'fronts'>`, `leaf(content, ctx)`, `split(dir, children, ctx)`, `hingedFront(covers, leaves, hingeSide, ctx, overlay = 'full')`, `columnsFromDoors(doors, singleColumnSide = 'left'): number[]`, `interiorHeight(H, plinthHeight)`, `shelfCount(h, pitch)`, `clamp`, `emptyOverrides()`, `reidentify(doc, newId): FurnitureDocument`, `effectiveParams(def, defaultOverrides): P`; `templates/index.ts`: `TEMPLATES` (partial until Task 40), `getTemplate(key)`, `templateDefaultDocument(key, defaultOverrides, catalog, newId = newIdFn): { document: FurnitureDocument; issues: Issue[] }` (issues filled after Task 37; until then `[]`). Field `labelKey`s are `templates.fields.{key}`, select option labels `templates.options.{value}` (pinned; 07 leaves them open).

- [ ] **Step 1: Write the failing tests** — `TEMPLATES.wardrobe_hinged.generate(defaults, { catalog: indexCatalog(seedCatalog()), newId: testIds() })` deep-equals the JSON block of 07 §12.2 (pasted into `database/fixtures/furniture/wardrobe-3door.json`, test reads the file); shelf count 4 (`shelfCount(1964, 400)`); `columnsFromDoors(3) = [1,2]`, `(4) = [2,2]`, `(5,'right') = [2,2,1]`, `(1) = [1]`; doors `'auto'` at width 1800 → 3, at 600 → 1, at 3600 → 6; `internalDrawers: 2` turns the first single column into `rows[ flex 1: shelves(shelfCount(1964 − 18 − 360, 400)) / fixed 360: drawers(2, 'equal', null, behindDoor: true) ]`; `hangingStyle 'double'` → three rows with two rods; `plinthHeight 0` → plinth `none`; field order starts `width, height, depth` with the ranges of §2.4.1; `paramsSchema` rejects `width 3610`; `effectiveParams` merges `{ width: 2400 }`, ignores unknown keys and falls back to code defaults when the merged object fails `paramsSchema`; `reidentify` gives fresh section/front ids, rewrites `covers` and every override key containing an old id (`front.fr_0000000001.leaf.1` → new id); `templateDefaultDocument('wardrobe_hinged', {}, catalog, testIds())` returns the same document.
- [ ] **Step 2: Run it, expect FAIL** — `yarn vitest run resources/js/engine/furniture/templates`
- [ ] **Step 3: Implement** — 07 §2.3 helpers (section ids depth-first pre-order, children left→right/top→bottom, then front ids); `wardrobe_hinged` generation steps 1–5 of §2.4.1; `TEMPLATES = { wardrobe_hinged } satisfies Partial<Record<TemplateKey, TemplateDefinition>>`, `getTemplate` throws `EngineInputError('invalid_input')` for a missing key.
- [ ] **Step 4: Run tests, expect PASS** — same command.
- [ ] **Step 5: Quality gates** — `yarn eslint resources/js/engine && yarn prettier --check resources/js/engine database/fixtures/furniture && yarn vue-tsc --noEmit`
- [ ] **Step 6: Commit** — `git add resources/js/engine/furniture database/fixtures/furniture resources/js/engine/index.ts` → `feat(engine): add template infrastructure and hinged wardrobe template`

