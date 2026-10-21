# Task 39 report: carcass templates (14)

Status: DONE_WITH_CONCERNS

Commits (branch `build/p2-engine`, pushed):
- 3d2c518 fix(engine): table_drawers_dont_fit names no entity and never reports negative space (Task 38 fold-ins N1, N2)
- 0a6610e feat(engine): add carcass furniture templates

## What was implemented

- 14 template files in `resources/js/engine/furniture/templates/`, each with `paramsSchema`, `fields`, `defaults` and `generate`, registered in `TEMPLATES` (`index.ts`). The registry now has 15 entries (the 14 plus `wardrobe_hinged`).
- `common.ts` additions (existing exports unchanged except `hingedFront`, whose `leaves` now accepts `Front['leaves']`, so `'auto'`): field constructors (`lengthField`, `intField`, `selectField`, `booleanField`, `dimensionFields`, `selectOptions`), `carcassDocument`, `evenSplit` (a one-child split returns the child, because `treeIssues` requires >= 2 children), `defaultSlideCode`, `drawersContent`, `shelvesContent`, `otherFront`, and the count clamps `maxColumns`, `maxRows`, `fitDoors`, `fitDrawers`.
- Fold-ins from Task 38 re-review (in `table/drawers.ts`, tested in `generateTable.test.ts`): `table_drawers_dont_fit` uses `entityIds: []`, and `available` is clamped to >= 0. RED seen for both before the fix: `entityIds` was `['table.drawer']`, and a 120 mm dining table gave `available: -80`.
- Hardware codes: only `ctx.catalog.defaultHardware(...)` (`handle.default`, `handle.flush`, `slide.side_mount`, `slide.undermount`). The only literal catalog code is `PB25-WHITE` in a conditional `preferredMaterials.top` (base_cabinet with countertop), as 07 §2.4.4 names it. §2.4 names role keys, not `HDL-FLUSH` or `SLD-UM-450`. Those codes are what the seed catalog resolves the roles to, so the tests use them as expected values only.

## Tests

- `templates/__tests__/carcassTemplates.test.ts` (149 tests): per template, a golden deep-equal of the default document written from §2.4 (ids from `testIds()`), every variant and branch, and a table-driven "definition" block for all 14 (metadata, field ranges, defaults, label keys, `paramsSchema` bounds, and `auto` only where `allowAuto`). For each default document: schema parse, no `error` and no `warning` from `validateFurniture`, `isSaveBlocking` false, `templateDefaultDocument` equals `generate`, deterministic, and no part-box overlap using `testing/overlaps.ts`. Hardware tests swap the catalog defaults to prove no literal codes, and drop them to prove the null fallbacks.
- `common.test.ts`: tests for the new helpers.
- Overlap check: `partOverlaps` reports the grooved back, whose 7 mm tongue sits in the groove of the sides, top and bottom (07 §3.4: grooving is not modelled). The test ignores `carcass.back*` pairs only when `back.type === 'grooved'`. Nailed-back templates (loft, bookshelf, shoe_rack) are checked with no exception.
- TDD: honest note. I drafted the implementation before the test file. RED was then recorded by moving the 14 template files aside and reverting `common.ts` and `index.ts` to HEAD: `Test Files 2 failed | 1 passed; Tests 156 failed | 58 passed (214)` (`TypeError`/"is not a function" for the missing helpers, and every template test failing because the template is not registered). Restored: 214/214 pass. Output is in `scratchpad/red.txt`.
- GREEN: `yarn vitest run resources/js/engine` gives 87 files, 3254 tests, all passing. `yarn eslint resources/js/engine`, `yarn prettier --check resources/js/engine` and `yarn vue-tsc --noEmit` are clean.

## Defaults: all valid

All 14 default documents give zero `error` and zero `warning` issues (only info: back_split, anti_tip_added, weight_estimate). No NEEDS_CONTEXT issue on any spec default.

## Concerns and decisions to review

1. **loft_cabinet column count vs the brief.** The brief says "3 empty columns". §2.4.3 says columns come from `columnsFromDoors(doors)`; 1800 gives 3 doors, so the columns are `[1, 2]`: two columns with flex weights 1 and 2. Fronts: door(col1, 1, left) and door(col2, 2, auto), as for the wardrobe. I followed the spec. The weights (= doors in the column) are my reading of "as wardrobe"; §2.4.3 does not state them.
2. **C9 clamps (preflight).** The §2.4 ranges allow counts that no layout can hold. As C9 rules, generators clamp before building, with unit tests: loft doors (`fitDoors`: each door's share of the columns >= 100 mm), bookshelf and open_shelf_wall columns and rows (`maxColumns`/`maxRows`), external drawers (`fitDrawers`: 120 mm of carcass height per drawer, which is a 100 mm slot plus the board the end slots lose). `fitDrawers` is used by base_cabinet drawers, chest_of_drawers, tv_unit and sideboard. The 120 mm pitch is empirical: the plain `floor(h/100)` rule still gave `drawer_too_low` in the end drawers. Two more guards go beyond C9 and are not in §2.4: bookshelf `lowerDoors` shortens the fixed 700 lower part to `ih - 18 - 200` on low shelves (it was `fixed_sizes_exceed`), and chest_of_drawers falls back to side-mount slides when the depth is under the shortest undermount slide + 45 (it was `drawer_no_slide`). Please log these in 19 as 07 gaps.
3. **chest_of_drawers `columns`.** §2.4.11 gives the select `1/2` a default of `width > 1000 ? '2' : '1'`, which a static default cannot express, and the brief wants width 1100 to give 2 columns. I made the select `auto | 1 | 2`, default `auto`, with `auto` resolving to that expression. This adds an option beyond the spec's `1/2`. UI strings need `templates.options.auto`.
4. **Bookshelf shelf count with `lowerDoors`.** §2.4.7 says `shelfCount(ih, 330)` per column. With a lower part the upper columns use `ih - 18 - lower` (default 986 mm gives 2 shelves); otherwise the upper part would hold the shelves of the full height. Same precedent as wardrobe_hinged's drawer column. Lower columns get `shelves(1)` with the default 20 mm setback.
5. **"Side-mount default" slide code** (tv_unit, sideboard, bedside_table, dressing_unit) is the explicit `defaultHardware('slide.side_mount')?.code ?? null`, i.e. `SLD-BB-450`, the same form §2.4.11 uses for the chest. Flap fronts use `hingeCode: 'auto'`, `hingeSide: 'auto'`.
6. **Open items for Task 40 / controller (not fixed here):**
   - `part_exceeds_sheet` (error) in range extremes cannot be clamped: carcass top/bottom longer than the 2440 sheet when the width is over ~2476 (wardrobe_sliding, loft, tv_unit, sideboard, custom_box, and wardrobe_hinged up to 3600), and sides over 2440 when height - plinth is over 2440 (wardrobe_sliding up to 2700, custom_box up to 3000). Panels are not split in §3.3, so §2.1 rule 3 / §12.5 cannot hold at those extremes. Needs a ruling (log 19).
   - `custom_box` height 100-115 mm gives `section_too_small` (net height < 80). A range or validator issue; the template has no count to clamp.
   - `wardrobe_hinged` (Task 31) has the same count problems as C9 lists, and also `doors: 1` or `2` builds a one-child columns split, which gives `section_tree_invalid` (error) at any width (`columnsFromDoors` returns a single entry). It can use the new `evenSplit`/`fitDoors`. Not touched, as it is outside Task 39's file list.
   - Fixture `tv-unit-1800.json` and `kitchen-base-600.json` (Task 40) can be generated from the tv_unit and base_cabinet defaults.
7. I probed (not committed) about 7000 grid and random parameter sets across the 14 templates (min/mid/max for each field and 300 random sets each): after the clamps the only `error` issues are the `part_exceeds_sheet` and `custom_box` cases above. There are no part-size, 400-part or bbox (+-1 mm) violations, and no overlaps apart from the grooved-back tongue.

## Fix round 1

Review items I1, M1-M5 addressed in one commit (test-and-refactor only; generated documents are unchanged, all goldens still pass).

- **I1:** `SPEC` in `carcassTemplates.test.ts` is now the complete §2.4 field list per template (key, kind, labelKey, min, max, step, allowAuto, advanced, visibleIf, options in order), built with test-local constructors, asserted with `toStrictEqual` on `t.fields` (order matters). Defaults are `toStrictEqual` too. Checked by mutation: removing `advanced` on wardrobe_sliding `plinthHeight`, `visibleIf` changed on base_cabinet `drawerCount`, sideboard `legHeight` step 5, chest `DRAWER_COUNT_MAX` 9, tv_unit `mounting` gaining `loft`, bookshelf `COLUMNS_MAX` 7 each fail one test.
- **M1:** `autoDoorCount`, `DOORS_MAX` and `outerHingeSide` moved to `common.ts`; `wardrobe_hinged` and `loft_cabinet` use them (`wardrobeDoorCount` stays exported as a wrapper). The unreachable loft branch is gone.
- **M2:** new tests: loft `doors: 'auto'` at 400/890/900/1500/2100/3600 (`AUTO_DOOR_WIDTH` 700 now fails 4 tests); shoe_rack shelf counts at heights 600-1800 (pitch 200 fails); `fitDoors(2, 200/199)` and `(3, 318/317)` (the `>=` to `>` mutant fails).
- **M3:** the grooved-back exemption now covers the back against `carcass.side.*`, `carcass.top` and `carcass.bottom` only; all 14 defaults still have no other overlap.
- **M4:** all assertions in `carcassTemplates.test.ts` use `toStrictEqual`.
- **M5:** single exported `BOARD_THICKNESS` in `common.ts` (the six local copies and `CLAMP_BOARD` removed, `interiorHeight` uses it); `shelvesContent` defaults to `DEFAULT_SHELF_FRONT_SETBACK`; new `tracked(into, build)` replaces the leaf-collecting closures in tv_unit, shoe_rack, sideboard, dressing_unit, bedside_table, tall_cabinet, bookshelf, base_cabinet, loft and wardrobe_hinged. Tests added for the three new helpers.

Verification: `yarn vitest run resources/js/engine` 87 files, 3259 tests passing; eslint, prettier, vue-tsc clean.
