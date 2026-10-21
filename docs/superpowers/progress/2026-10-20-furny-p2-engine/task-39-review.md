# Task 39 review: carcass templates (14), 85921ce..0a6610e

Diff file: `review-85921ce..0a6610e.diff` (136692 bytes, non-empty). The diff plus the template sources at HEAD were read. The brief and the report were treated as claims.

## Spec Compliance

- Spec compliant. All 14 templates match §2.4.2-§2.4.13 and §2.4.18-§2.4.19 field by field and step by step. The only deviations are the accepted rulings: loft columns per §2.4.3, the C9 clamps, chest `columns = auto|1|2`, the bookshelf upper count, and the grooved-tongue exemption.
- Cannot verify from the diff: the `templates.options.auto`, `templates.options.1` and `templates.options.2` lang strings, which are owned by the UI and lang tasks. The `/images/templates/{key}.svg` thumbnails are not in this diff either.

### How fidelity was checked (mechanical)

- **Field lists.** A scratch test (deleted) rebuilt each §2.4 table as data and deep-compared it with `TEMPLATES[k].fields` plus `defaults`. It covered key, kind, labelKey, min, max, step, allowAuto, advanced, visibleIf, options (values and order), default value and field order. All 14 match. The one difference is chest `columns`, which has the extra `auto` option (accepted).
- **Generation.** I read all 14 `generate()` bodies against the §2.4 prose: root split, weights and sizes, contents, fronts, hinge sides, mounting, plinth, back, construction, countertop, materials, handles, and section-then-front id order. No deviation found beyond the accepted rulings.
- **Test strength.** The golden tests are full `toEqual` of hand-written documents (`expected()`, `node`, `leafAt`, `front`, built independently of the implementation). Every default is covered, so `'auto'` resolves before the build: `leaves`, `doors`, `columns`, `rows` and `drawerCount` are numbers in the output.
- **Variants.** All variants named in the brief are covered with a full-document golden or a precise assertion: base_cabinet ×4 plus countertop, bedside ×3, loft `flap_up` and the single-door/no-split case, wall_cabinet 600/601/300/flap_up/open, tall_cabinet niche, bookshelf `lowerDoors` (including one column), tv_unit ×3 plus wall, and chest ×2 columns.
- **Hardware codes.** A grep of the templates finds only `PB25-WHITE` (`base_cabinet.ts:36`, in a `preferredMaterials`-shaped constant, as §2.4.4 names it). Every other code comes from `ctx.catalog.defaultHardware(...)`. Two tests swap the defaults and remove them to prove it.
- **Sweep.** A min/mid/max grid sweep (about 3,500 parameter sets) finds `error` issues only for `part_exceeds_sheet` and `custom_box` `section_too_small` (carried to Task 40). There are no dangling `covers` and no schema failures.
- **Gates.** prettier on `templates/` and `table/` is clean, and eslint on `templates/` is clean. The 214 template tests pass in the scratch copy (not re-run in the worktree).

## Strengths

- The golden default tests are real: each is a full deep-equal against a document written from the spec, not a subset. The id order is pinned (`S(n)`, `FR(n)`).
- `split()` taking thunks keeps ids in pre-order. `evenSplit` handles the one-child case (`treeIssues` needs at least 2 children), and every template that can have a single child (loft, bookshelf, open_shelf_wall, shoe_rack, chest) is tested for it.
- The clamps are tested to an exact boundary: `maxColumns` 217/218/335/336, `maxRows` 177/178, `fitDrawers` 544/584, and the per-template count tests.
- Most behavioural mutants die. Of about 65 mutants, every one that touches generation numbers, plinth/setback/construction/mounting values, the weights, the hinge sides, the `common.ts` content builders or the label keys was killed.
- The Task 38 fold-ins are right. Both mutants (restoring `entityIds: ['table.drawer']`, and dropping `Math.max(0, ...)`) fail `generateTable.test.ts`, and the new `width = 120` case really exercises the negative bay.

## Issues

### Critical (Must Fix)

None.

### Important (Should Fix)

**I1. Field metadata for the non-dimension fields is not pinned by any test.** `carcassTemplates.test.ts:300-380` (`describe.each ... definition`).

Only width/height/depth are checked against the §2.4 ranges (via `SPEC`). For every other field:
- The range, `step`, `advanced`, `visibleIf`, option list and order, and field order are never compared with the spec.
- The "range" test at `:362-381` iterates `t.fields`, so it only checks `paramsSchema` against the template's own fields.
- The field-key check at `:354` sorts the keys, so it ignores order.

Mutants that survived the whole templates and table suites (my implementation matches the spec today, so this is a regression hazard):
- `wardrobe_sliding` `plinthHeight` loses `advanced`
- `chest_of_drawers` `slideType` loses `advanced`
- `base_cabinet` `drawerCount` `visibleIf` changed from `drawers` to `door`
- `sideboard` `legHeight` step changed from 10 to 5
- `chest_of_drawers` `DRAWER_COUNT_MAX` 8 to 9 (field and schema together)
- `bookshelf` `COLUMNS_MAX` 6 to 7
- `open_shelf_wall` `COUNT_MAX` 6 to 7
- `wardrobe_sliding` `LEAVES_MAX` 4 to 5
- `tv_unit` `MOUNTINGS` gaining `loft`
- `wall_cabinet` `FRONT_KINDS` gaining an extra value
- `tv_unit`, `loft_cabinet` and `chest_of_drawers` option orders swapped
- `bookshelf` fields `columns` and `lowerDoors` swapped

§2.4 is the fidelity surface of this task, and the report claims "a table-driven definition block ... field ranges". Fix: extend `SPEC` to a full expected field list per template (key, kind, min, max, step, allowAuto, advanced, visibleIf, options, order) and assert `toEqual` on `t.fields`. My scratch table (about 40 lines of data) is a ready model.

### Minor (Nice to Have)

**M1. `loft_cabinet.ts:97-101` copies `hingeSide` verbatim from `wardrobe_hinged.ts`, and one branch is dead in loft.** `columnsFromDoors(doors)` (left default) puts the single-door column only at index 0, so `return index === columns.length - 1 ? 'right' : 'auto'` is unreachable. Removing it leaves all tests green. The `'auto'` doors formula (`clamp(round(width / 600), 1, 12)`, `loft_cabinet.ts:69-75`) also duplicates `wardrobeDoorCount`. Move both into `common.ts`, for example `outerHingeSide(doorsInColumn, index, count)` and `autoDoorCount(width)`.

**M2. Some formula constants are asserted at one operating point only.**
- `loft_cabinet` `AUTO_DOOR_WIDTH` 600 to 700 survives: the 1800 default gives 3 either way, and there is no other width for `'auto'`.
- `shoe_rack` `SHELF_PITCH` 180 to 200 survives: `round(5.02)` and `round(4.52)` both give 5, and only height 1000 is tested. 150 does die.
- `fitDoors` boundary `>= 100` against `> 100` survives: no case lands exactly on 100 mm per door, for example `fitDoors(2, 200)`.

Add one case each.

**M3. The overlap exemption is wider than the tongue.** `carcassTemplates.test.ts:177-181` ignores every pair that involves `carcass.back*` when the back is grooved. That also hides a back-versus-shelf, divider or drawer-box overlap, which is a plausible real bug. Limit the ignore to back versus sides/top/bottom (`carcass.side*`, `carcass.top`, `carcass.bottom`).

**M4. `toEqual` in the goldens tolerates stray `undefined` keys.** `toStrictEqual` would pin the exact shape at no cost.

**M5. Small repeated constants and a hard-coded default.**
- `BOARD_THICKNESS = 18` is redeclared in `loft_cabinet`, `bookshelf`, `open_shelf_wall`, `wardrobe_sliding`, `chest_of_drawers` and `wardrobe_hinged`, plus `CLAMP_BOARD` in `common.ts`.
- `shelvesContent(count, frontSetback = 20)` at `common.ts:~430` hard-codes 20 although `DEFAULT_SHELF_FRONT_SETBACK` exists in `constants.ts`; `wardrobe_sliding` passes that constant.
- The "collect the leaf as the builder runs" closure is repeated in about six templates. A small `collect()` helper would remove it.

**M6. Process note (no code impact).** The report states the implementation was drafted before the tests and the RED run was reconstructed afterwards. The test suite is behaviourally strong (see Strengths), so I take it as acceptable, but it is not literal red-green-refactor.

## Notes for the controller (carried or accepted, not re-flagged)

- The `part_exceeds_sheet` onset in my sweep is lower than the report's "over about 2476": `wardrobe_sliding` errors from width 2430, `tv_unit` from 2430, `sideboard` from 2430, `loft` from 2460, `custom_box` from 2460, and `wardrobe_sliding` from height 2530. That is roughly the top half of the width range for those templates, not just the extremes. This matters for the Task 40 ruling and the 19 log entry.
- `custom_box` heights 100 to 115 and the `wardrobe_hinged` one-child split are as already carried.

## Assessment

**Spec verdict:** compliant.

**Task quality:** Needs fixes. This is for I1 only. The test suite does not lock the field metadata that is this task's main fidelity surface. The implementation is correct today, so the fix is test-only.

**Reasoning:** All 14 templates and the `common.ts` helpers are correct, mechanically verified against §2.4, and the Task 38 fold-ins are correct and covered. The golden and behaviour tests are strong, but ranges, `advanced`, `visibleIf`, options and field order of the non-dimension fields, plus a few formula constants, can change without any test failing.

## Mutation check

Scratch copy only, deleted afterwards (the worktree was not touched). About 65 mutants were run against the templates and table suites.
