# Task 39 re-review 1: fix round 1 (0a6610e..2133940)

Diff read: `review-0a6610e..2133940.diff`. The fix report's "Fix round 1" section names its covering tests and the full-engine result (87 files, 3259 tests, gates clean); I did not re-run the engine suite. In a scratch copy (deleted afterwards) at 2133940 I ran the templates suite once (219 tests pass), plus eslint and prettier on `templates/` (both clean), and then the mutants below.

## Finding Verdicts

- **I1. Field metadata for non-dimension fields not pinned** — ADDRESSED. `carcassTemplates.test.ts` `SPEC` is now the full §2.4 field list per template (key, kind, labelKey, min, max, step, allowAuto, advanced, visibleIf, options in order). It is built with test-local constructors (`L`, `I`, `SEL`, `B`, `DIMS`), not taken from `common.ts`. It is asserted with `expect(t.fields).toStrictEqual(fields)` (diff lines ~330-345 of the test hunk), and the defaults are `toStrictEqual` too. All 15 surviving I1 mutants from my review now fail:
  - sliding `plinthHeight` advanced removed
  - base `drawerCount` `visibleIf`
  - sideboard `legHeight` step 5
  - chest `slideType` advanced removed
  - `tv_unit` layout reorder
  - bookshelf field order swap
  - loft `frontKind` reorder
  - chest `DRAWER_COUNT_MAX` 9
  - bookshelf `COLUMNS_MAX` 7
  - `open_shelf_wall` `COUNT_MAX` 7
  - sliding `LEAVES_MAX` 5
  - sliding `LEAVES_MIN` 1
  - `tv_unit` mountings gaining `loft`
  - `wall_cabinet` kinds gaining `x`
  - chest slide-type order swap
- **M1. Duplicated hinge-side and door-count logic, plus the dead loft branch** — ADDRESSED. `autoDoorCount`, `DOORS_MAX` and `outerHingeSide` are now in `common.ts:~166-190`. `loft_cabinet.ts` and `wardrobe_hinged.ts` both call them, so the local copies and the unreachable loft branch are gone. `wardrobeDoorCount` stays as a thin wrapper. `common.test.ts` ("door helpers") tests both new helpers, including 1-column and last-column cases. The mutants `outerHingeSide` last to `auto` and first to `auto` are both killed.
- **M2. Constants only tested at their defaults** — ADDRESSED. All three survivors now die:
  - loft `AUTO_DOOR_WIDTH` 700: new "doors 'auto' ... away from the default" test at 400/890/900/1500/2100/3600
  - shoe_rack `SHELF_PITCH` 200: killed
  - `fitDoors` `>=` to `>`: `fitDoors(2, 200/199)` and `(3, 318/317)` kill it
- **M3. Grooved exemption too wide** — ADDRESSED. `overlapsOf` now exempts a grooved back only against `/^carcass\.(side\.(left|right)|top|bottom)$/`. The regex matches the real part keys (`panels.ts:45,46,79,85`), and `back.ts:191` produces `carcass.back` and `carcass.back.{n}`. All 14 default-document overlap checks (`expectValid`) still pass with the narrow exemption. A mutant whose regex matches nothing fails, so the exemption is both needed and the only one in use.
- **M4. `toEqual` in goldens** — ADDRESSED. All assertions in `carcassTemplates.test.ts` are `toStrictEqual`. A mutant adding `extra: undefined` to `carcassDocument` is killed.
- **M5. Repeated constants, hard-coded 20, leaf-collecting closures** — ADDRESSED.
  - There is a single exported `BOARD_THICKNESS` (`common.ts:26`). A grep finds no other `BOARD_THICKNESS =` or `CLAMP_BOARD`, and mutating it to 17 is killed.
  - `shelvesContent` defaults to `DEFAULT_SHELF_FRONT_SETBACK`, and mutating it to 0 is killed.
  - `tracked(into, build)` replaces the closures in tv_unit, shoe_rack, sideboard, dressing_unit, bedside_table, tall_cabinet, bookshelf, base_cabinet, loft and wardrobe_hinged. It is tested (`common.test.ts`), and removing its push is killed.
  - The refactor preserves build order: `tall_cabinet` uses `rows[0]` as upper and `rows[1]` as lower, with the niche row untracked, and the goldens are unchanged and green.
  - M6 (process note) needs no action.

## New Breakage in the Fix Diff

None. The fix is test and refactor only, and the generated documents are unchanged: all goldens pass unmodified apart from the stricter matcher. eslint and prettier are clean on `templates/`. No unused imports remain.

## Out-of-Scope Observations

None.

## Verdict

**Fix round:** All findings addressed, no new Critical/Important breakage. APPROVED.
