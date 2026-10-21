# Task 37 report: validateFurniture, sag table, model-level rules

Commit: d227d13 feat(engine): validate furniture documents and models (pushed to origin/build/p2-engine; base f9e5b77)

## Implemented
- `furniture/validate.ts`: `validateFurniture(doc, catalog)` = structural checks on the raw document (dims_range, family_mismatch, section_tree_invalid, section_too_small, front_not_rectangle / front_overlap via the pure `frontCoverageIssues` from `fronts/openings.ts`) followed by `generateFurniture(...).issues`, then `dedupeIssues`. Also `SAVE_BLOCKING_CODES` (the 9 codes), `CRITICAL_WARNING_CODES`, `FURNITURE_ISSUE_CODES` (69 codes, 07 §7.3 table order, `part_exceeds_sheet_back` last), `isSaveBlocking`. Structural checks run even when the envelope is null (layout empty, front overlap still found).
- `rules/sag.ts`: `SAG_TABLE`, `sagLimits(boardType, t, clamped)` (07 §7.2), `shelfSagIssues(ctx)` for loose shelves (clamped iff not adjustable, content looked up in the doc), `fixed_shelf` dividers, `table.shelf`, `table.cabinet.shelf.N`. Span = floored x extent of the part box.
- `rules/model.ts`: `modelRules(ctx)` = sag, part_exceeds_sheet, too_many_parts (sum of qty after overrides, > 400), loft_no_access, thin_carcass, back_too_thick_for_groove, drawer_bottom_thick, drawer_box_thickness. `generate.ts` now imports it (stub removed).
- `templates/index.ts`: `templateDefaultDocument` returns `validateFurniture(document, catalog.snapshot)`.
- `index.ts` exports the new public names.

## Carries
1. Flex-only negative space: `allocate` never returns a negative size (clamped to 0) and returns `overBy: null` when there is no fixed child, so layout no longer emits `fixed_sizes_exceed`; validation reports `section_too_small` (width 0). `shelvesFor` reports `shelves_dont_fit` when the shelf would have zero or negative width. A seeded 300-tree fuzz test (`carcass/__tests__/degenerate.test.ts`) checks no negative part, front or section; it detects the pre-fix shelf bug.
2. Explicit `slideCode`: unknown codes were already reported by `codeIssues`; a code that exists but is not a `drawer_slide` now gets `unknown_code { code, kind: 'hardware' }` (once per code), for carcass drawers, table under-top drawers and end cabinet content. Added in `codes.ts` so generation reports it too.
3. Derived default edge bands (`material.defaultEdgeBandCode` of each role without an explicit band, unknown material -> role default as in generation): archived -> `archived_code`, missing -> `unknown_code { kind: 'edge_band' }`, once per code and not repeated when also explicit. Also in `codeIssues`.

## TDD evidence
RED (before any implementation), `yarn vitest run resources/js/engine/furniture/__tests__/validate.test.ts resources/js/engine/furniture/rules`:
```
 FAIL  |engine| resources/js/engine/furniture/__tests__/validate.test.ts [ resources/js/engine/furniture/__tests__/validate.test.ts ]
Error: Cannot find module '../validate' imported from '/home/user/furny-p2/resources/js/engine/furniture/__tests__/validate.test.ts'
Caused by: Error: Failed to load url ../validate (resolved id: ../validate) in /home/user/furny-p2/resources/js/engine/furniture/__tests__/validate.test.ts. Does the file exist?
 FAIL  |engine| resources/js/engine/furniture/rules/__tests__/sag.test.ts [ resources/js/engine/furniture/rules/__tests__/sag.test.ts ]
Error: Cannot find module '../model' imported from '/home/user/furny-p2/resources/js/engine/furniture/rules/__tests__/sag.test.ts'
Caused by: Error: Failed to load url ../model (resolved id: ../model) in /home/user/furny-p2/resources/js/engine/furniture/rules/__tests__/sag.test.ts. Does the file exist?
⎯⎯⎯⎯⎯⎯ Failed Tests 13 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  |engine| resources/js/engine/furniture/rules/__tests__/model.test.ts > part_exceeds_sheet (07 §7.3, §3.4.1 fit) > flags a side taller than a PB18 sheet, with the sheet dimensions
AssertionError: expected [] to deeply equal [ [ 'carcass.side.left' ], …(1) ]
 FAIL  |engine| resources/js/engine/furniture/rules/__tests__/model.test.ts > part_exceeds_sheet (07 §7.3, §3.4.1 fit) > respects the grain of a grained material
AssertionError: expected [] to deeply equal [ 'extra.p_0000000001' ]
 FAIL  |engine| resources/js/engine/furniture/rules/__tests__/model.test.ts > part_exceeds_sheet (07 §7.3, §3.4.1 fit) > does not check glass
```
validate.test.ts and sag.test.ts failed to load (`../validate`, `../model` did not exist); the 13 model.test.ts tests failed because modelRules was a no-op (expected [] ...).
GREEN: `yarn vitest run resources/js/engine` -> Test Files 85 passed (85), Tests 2942 passed (2942) (baseline before the task: 2815 + earlier). Gates: `yarn eslint resources/js/engine` 0, `yarn prettier --check resources/js/engine` clean, `yarn vue-tsc --noEmit` 0.

## Tests added
validate.test.ts (structural checks, boundaries, carries, 401/400 parts, save blocking, dedupe, code list incl. a source scan that every `'furniture.x'` literal in the furniture engine is in the set), rules/__tests__/sag.test.ts (table, lookup, 07 §12.4 cases, fixed shelves, table shelves), rules/__tests__/model.test.ts, carcass/__tests__/degenerate.test.ts, and layout.test.ts updates (negative clamp). Existing assertions changed: layout `allocate` degenerate case ([-5,-5] -> [0,0]); wardrobe_hinged `templateDefaultDocument` issues now the 3 info codes. New test helpers `withoutEdgeBand`, `withThickness` in `furniture/testing/catalogs.ts`.

## Deviations and decisions to log (spec 19)
- **Dedupe key.** Controller rule: code + sorted entityIds. `unknown_code` / `archived_code` have no entityIds (Task 36 ruling), so two different unknown codes would collapse into one. For issues with no entityIds the params are part of the key. Issues with entities follow the rule exactly (first kept).
- `part_exceeds_sheet` carries an extra `materialCode` param (the message needs {material}); back parts (role back, generated) are skipped since back.ts splits them or reports `part_exceeds_sheet_back`; glass skipped by boardType; extras checked.
- `table.shelf` (lower shelf) is treated as clamped (fixed, doweled); `table.cabinet.shelf.N` follows the content's `adjustable`. Task 38 should confirm key names; the rule is key-based so tables need no change here.
- `thin_carcass` fires for the carcass family or any carcass-role part; drawer_bottom_thick / drawer_box_thickness fire only when such parts exist, once per design (no entities).
- `frontCoverageIssues` lives in `fronts/openings.ts` (not `fronts.ts`).
- `CRITICAL_WARNING_CODES` is a readonly array (07 §7.1 shows an array); `SAVE_BLOCKING_CODES` a `ReadonlySet<string>`.
- 07 §7.2 sag lookup gives non-integer limits when scaling (hdf 2 mm -> 200 / 266.67); not rounded.

## Self-review
Diff read. No spec edits. Purity test caught a comment containing "document." and it was reworded. Scratch files removed.
