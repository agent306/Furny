# Task 43 report: Guillotine nesting

Status: DONE

## Implemented
- `bom/nesting/guillotine.ts`: 08 §5.3 pasted verbatim (prettier-formatted) with type-level edits only (`!` on six indexed accesses: `sheets[s]`, `free[r]`, `sheet.free[c.rect]`, `sheets[choice.sheet]`, `res.sheets[a-1]`, `best.sheets[b-1]`), header comment per ruling C7. Control flow and order untouched.
- `bom/nesting/index.ts`: `nestSheets` per §5.4 (group by material code asc, skip glass and unknown materials, instance keys `key`, `key#k`, rotation from grain / `allowRotation`) and `BOM_ISSUE_CODES = ['bom.part_exceeds_sheet']`.
- `bom/bom.ts`: nesting branch (kerf `Math.ceil(pricing.kerfMm)`, trim `pricing.sheetTrimMm`, `allowRotation ?? pricing.nestingAllowRotationDefault`), `sheetsNested`, `sheetsBilled = sheetsNested ?? sheetsEstimated`, `utilization = round4(sum placed cut areas / (sheets x sheetArea))` (0 with no sheet), unplaced instance -> error issue `bom.part_exceeds_sheet`.
- `engine/index.ts`: exports `NEST_PASSES`, `nestMaterial`, `nestSheets`, `BOM_ISSUE_CODES` and types `NestCut, NestItem, NestMaterialResult, NestOptions, NestPlacement, NestRotation, NestSheetSpec`.

## Files
New: `bom/nesting/guillotine.ts`, `bom/nesting/index.ts`, `bom/__tests__/guillotine.test.ts`, `nestSheets.test.ts`, `bom.nesting.test.ts`.
Modified: `bom/bom.ts`, `engine/index.ts`, `bom/__tests__/bom.test.ts` (the "throws until Task 43" test replaced by an empty-model nesting test), `bom/__tests__/bom.wardrobe.test.ts` (comment only).

## TDD evidence
RED (implementation stashed, nesting dir moved away): `yarn vitest run resources/js/engine/bom` -> `Test Files 3 failed | 6 passed (9)`, `Tests 74 passed`; the 3 new files fail with `Cannot find module '../nesting/guillotine'` / `'../nesting'`.
GREEN: `yarn vitest run resources/js/engine/bom` -> `Test Files 9 passed (9)`, `Tests 105 passed (105)`.
(Implementation was written before the tests; RED was shown by stashing it afterwards.)

## Spec expectations
All met by the verbatim algorithm without tuning: 08 §10.4 A, B, C, D, D' exact; §10.2 wardrobe: all 5 PB and 2 HDF sheets, utilisations (0.7803, 0.8009, 0.7708, 0.6073, 0.9044; 0.7841, 0.3974), every x/y/rotated, HDF3 `sheetsNested 2 / 0.5907`, PB18 `5 / 0.7727`. Property tests (mulberry32(99), 50 sets of 1-300 parts) pass.

## Gates
- `yarn eslint resources/js/engine`, `yarn prettier --check resources/js/engine`, `yarn vue-tsc --noEmit`: clean.
- `yarn lint`, `yarn typecheck`: clean.
- Full `yarn vitest run`: 5033 tests; failures only baseline (`validate.test.ts > contains every furniture code literal`, `format.test.ts` de-CH x2) plus load-induced 5 s timeouts (`pipeline.test.ts` replace-merge cache, `AddressFields.test.ts`, `variants.test.ts`) that vary run to run; those files re-run alone pass (`3 passed`, only the baseline validate test fails).

## Deviations / decisions
1. Issue `messageKey` = `engine.bom.issue.part_exceeds_sheet`, mirroring the Task 30 ruling for furniture issues (`engine.furniture.issue.*`) instead of the plan convention `issues.bom.*`. Task 51 / controller should confirm.
2. Issue `params` / `entityIds` use the base part key (instance suffix `#k` stripped), so a qty-N part yields one issue (dedup by code + entityIds in `mergeIssues`). `nesting.unplaced` keeps the instance keys.
3. Materials that are unknown to the catalog get `sheetsNested null` / `utilization null` (no sheet exists), like glass.
4. `index.ts` does not re-export guillotine's `NestedSheet`; `bom/types.ts` already exports a structurally identical `NestedSheet`, and a second one would collide.
5. Real part keys carry prefixes (`carcass.side.left`, `section.s_0000000002.shelf.2`, `carcass.back.1`); the spec abbreviates them. Placement coordinates match exactly.

## Concerns
None blocking. Full-suite timeouts under load are pre-existing flakiness unrelated to nesting.
