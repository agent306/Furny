### Task 37: `validateFurniture`, sag table, model-level rules

**Files:**
- Create: `resources/js/engine/furniture/validate.ts`, `resources/js/engine/furniture/rules/sag.ts`, `resources/js/engine/furniture/rules/model.ts`
- Modify: `resources/js/engine/furniture/generate.ts` (call `modelRules`), `resources/js/engine/furniture/templates/index.ts` (`templateDefaultDocument` returns `validateFurniture` issues)
- Test: `resources/js/engine/furniture/__tests__/validate.test.ts`, `resources/js/engine/furniture/rules/__tests__/sag.test.ts`

**Spec refs:** `03 §2.4`, `07 §1.4`, `§7.1–§7.3`, `§12.4` (sag cases)

**Interfaces:**
- Consumes: Tasks 33–36.
- Produces: `SAVE_BLOCKING_CODES: ReadonlySet<string>` (exactly the 9 codes of 03 §2.4), `CRITICAL_WARNING_CODES`, `FURNITURE_ISSUE_CODES` (every code of 07 §7.3 incl. `furniture.part_exceeds_sheet_back`), `validateFurniture(doc, catalog): Issue[]` (structural + generated issues, deduplicated by `code + entityIds`), `isSaveBlocking(issues): boolean`; `SAG_TABLE`, `sagLimits(boardType, thickness, clamped: boolean): { warn: number; critical: number }`; `modelRules(ctx): void` (sag, `part_exceeds_sheet`, `too_many_parts`, `loft_no_access`, `thin_carcass`, `back_too_thick_for_groove`, `drawer_bottom_thick`, `drawer_box_thickness`).

- [ ] **Step 1: Write the failing tests** — wardrobe fixture → only the 3 info issues, `isSaveBlocking === false`; width 6001 → `dims_range { dimension: 'width', min: 150, max: 6000 }`; `carcass` set on a table-family doc → `family_mismatch`; duplicate section id / `split 'columns'` with one child / leaf with `content null` → `section_tree_invalid`; leaf 95 mm wide → `section_too_small { width: 95, … }`; L-shaped `covers` → `front_not_rectangle`; two fronts on one leaf → `front_overlap`; unknown code → `unknown_code`; 401 parts (extra part qty 99 × 5) → `too_many_parts { count }` (count = Σ qty); every code in `SAVE_BLOCKING_CODES` blocks, `furniture.shelves_dont_fit` (error) does not. Sag (07 §12.4, PB18): adjustable span 801 → `shelf_sag`, 1001 → `shelf_sag_critical`; fixed 1164 → none; fixed 1201 → `shelf_sag`; MDF18 adjustable 900 → `shelf_sag`; PLY18 adjustable 1100 → `shelf_sag` only; `sagLimits('particle_board', 17, false)` uses the 16 mm row; `('hdf', 2, …)` scales the 3 mm row by 2/3; unknown type 20 mm → `44 × 20 / 55 × 20`. A non-back part larger than the sheet (2500 × 600 side) → `part_exceeds_sheet` with sheet dims; loft with no fronts → `loft_no_access`; carcass material 12 mm → `thin_carcass`; grooved back 9 mm → `back_too_thick_for_groove`; `templateDefaultDocument('wardrobe_hinged', {}, …).issues` equals the 3 info issues.
- [ ] **Step 2: Run it, expect FAIL** — `yarn vitest run resources/js/engine/furniture`
- [ ] **Step 3: Implement** — structural checks of 03 §2.4 on the raw doc (run even when generation stops), then `generateFurniture(doc, catalog).issues`; sag lookup rules of 07 §7.2 (largest thickness ≤ t, else scale smallest; ×1.5 for clamped shelves; applies to loose, fixed, table lower and table cabinet shelves).
- [ ] **Step 4: Run tests, expect PASS** — `yarn vitest run resources/js/engine/furniture`
- [ ] **Step 5: Quality gates** — `yarn eslint resources/js/engine && yarn prettier --check resources/js/engine && yarn vue-tsc --noEmit`
- [ ] **Step 6: Commit** — `git add resources/js/engine/furniture resources/js/engine/index.ts` → `feat(engine): validate furniture documents and models`

