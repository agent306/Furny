# Task 40 report: table templates, furniture fixtures, template property test

Status: DONE_WITH_CONCERNS

Commits on `build/p2-engine` (pushed):
- d4993aa feat(engine): split long horizontal panels at seams, fit aprons to the leg section
- c270ff7 feat(engine): add table templates, furniture fixtures and template property test

Commit d4993aa passes on its own: I checked it out in a temporary worktree and ran `vitest run resources/js/engine/furniture`, which gave 31 files and 1114 tests passing. The worktree was then removed.

## What was implemented

- **Table templates.** `templates/{study_desk,dining_table,coffee_table,console_table}.ts` follow 07 §2.4.14 to §2.4.17. `TEMPLATES` now has 19 keys and uses `satisfies Record<TemplateKey, TemplateDefinition>`.
  - New shared helpers in `common.ts`:
    - `tableDocument`, `TABLE_SHAPES`, `NOT_ROUND`, `tableTop` and `tableDims`;
    - the sheet clamps `leafFitsSheet` and `sheetDoors`.
- **Fixtures.** Five files in `database/fixtures/furniture/`: `tv-unit-1800`, `bookshelf-5shelf` (height 2100, 5 shelves per column), `kitchen-base-600`, `dining-table-6seat` and `study-desk-cabinet`.
  - Each one is `getTemplate(key).generate(params, { catalog: indexCatalog(seedCatalog()), newId: testIds() })`.
  - `fixtures.test.ts` rewrites them under `UPDATE_FIXTURES=1`. It formats with the prettier API, using the project config without plugins, so a rewrite is byte-identical. I checked this: two update runs gave identical md5 sums, and `prettier --check` is clean.
  - The tests cover:
    - deep-equal with the template output;
    - byte-equality with the formatter output;
    - schema parse and determinism;
    - no errors and no warnings.
  - `wardrobe-3door.json` is unchanged, and its Task 31 test passes.
- **Property test.** `templates/__tests__/property.test.ts` implements 07 §12.5 and R40-4. Each of the 19 templates gets its defaults plus 50 sets from its own `mulberry32(42)`.
  - Lengths are snapped to `step`, selects are uniform, booleans are 50/50, and an `allowAuto` int is `'auto'` 25% of the time.
  - Each set is checked against `paramsSchema` first.
  - The checks are:
    - no `error` from `validateFurniture`;
    - at most 400 parts (qty counted);
    - `length >= width > 0` for every part;
    - every part's box or extruded outline inside the bbox (±1 mm);
    - no overlap from the Task 38 helper. The grooved-back exemption covers only `carcass.back*` against `carcass.side.*`, `carcass.top*` and `carcass.bottom*`, including their split pieces.
  - A failure prints the params and the problems. Runtime is about 0.5 s (the whole file 1.3 s).
- **R40-1 split.** New module `furniture/panelSplit.ts`, wired into `generateCarcass` and `tableParts` just before `connectorsForJoints`. `greedySeams` moved there from `carcass/back.ts`, which now imports it.

## Property-test findings and root fixes

Each fix below has a regression test. Example failing params come from my surveys: 300 to 1500 random sets per template plus the min and max of every field, with seeds 7, 99 and 1234. After the fixes, all of them come back clean.

1. **`wardrobe_hinged` doors 1 or 2 gave `section_tree_invalid` (R40-3).** The template built a one-child columns split, for example `{doors:1}`.
   - Fix: a single column is now the root itself, as in the loft.
   - Tests: `wardrobe_hinged.test.ts` "one or two doors build a single column as the root".
2. **`wardrobe_hinged` gave `section_too_small` / `front_too_small` with too many doors for the width,** for example `{doors:12, width:600}`.
   - Fix: `fitDoors`, the C9 clamp of Task 39 that `wardrobe_hinged` never had.
   - Test: "explicit doors win over the width while each door gets 100 mm".
3. **Front leaves larger than a sheet** in `wardrobe_hinged`, `wardrobe_sliding` and `loft_cabinet`. Too few doors at a large width, for example `{doors:1, width:1800}`, gives an 1818 mm leaf against 1200 usable.
   - The same root also caused the loose-shelf and drawer-part `part_exceeds_sheet` errors in over-wide single-door columns.
   - Fix: a new clamp, `sheetDoors` (`common.ts`), raises the door count until every leaf fits one sheet of the template's front material. The sheet comes from the catalog, not a constant. A flap spans its whole column.
   - `wardrobe_sliding` raises the leaf count up to 4, using `(W + (n-1)·30)/n`.
   - If no count fits (only the height is too large), the requested count is kept. The existing back-split test, which uses a 2700 mm wardrobe on purpose, caught a first version that jumped to 12 doors.
   - Tests:
     - `common.test.ts` "sheet clamps";
     - `wardrobe_hinged.test.ts` "raises the door count…";
     - `carcassTemplates.test.ts` "raises the leaf count…" (sliding) and the loft equivalent.
4. **Sides and partitions longer than the 2420 usable sheet length (R40-2),** for example wardrobe height 2700 with plinth 0.
   - Fix: height ranges capped (see the adjusted ranges below).
   - Tests: pinned field specs plus validity at 2420 with plinth 0.
5. **Carcass top and bottom, plinth front and back, table top and aprons longer than a sheet (R40-1).** Examples: `custom_box` width 6000, `wardrobe_*`, `loft`, `tv_unit` and `sideboard` over about 2476, dining 3000.
   - Fix: `panelSplit.ts`.
   - Tests: `__tests__/panelSplit.test.ts` (10 tests), `tableTemplates.test.ts` "3000 wide…", and `carcassTemplates.test.ts` `custom_box` 6000.
6. **`custom_box` height 100 to 110 gave `section_too_small` (R40-3).**
   - Fix: minimum height 120.
   - Test: validity at 120 for floor, wall and loft.
7. **`console_table` depth 350 gave `drawer_no_slide` (R40-3).** The available depth is 254 against the 250 + 10 needed.
   - Fix: minimum depth 360, which gives 264. The catalog has no slide shorter than 250.
   - Test: "depth starts at 360…", with 1 to 3 drawers.
8. **Round tops gave `dims_range`.** Round forces `depth = width`, so for example dining `{shape:'round', width:1880}` gives depth 1880, over the 1200 limit of 03 §2.4. Coffee had the same problem with depth 1600. As side effects, a round dining top at 2820 and the pedestal base plate could not fit a sheet.
   - Fix: `tableDims` caps the round diameter at the depth field's maximum (dining 1200, coffee 900).
   - Tests: `tableTemplates.test.ts` round-cap tests and `common.test.ts` `tableDims`.
9. **Thin legs (R40-3).** The templates never reach this case: their solid legs have s = t_leg = 50, and study_desk's hardware legs have s 60. I reproduced it with `diningTable` `legSection 40`. The left apron overlapped the front leg by 10 mm in z, and the centre stretcher overlapped the side stretchers by 5 mm.
   - The fix adds `Frame.legDepth`, which is t_leg for solid legs and s for hardware legs:
     - side aprons and side stretchers span `[bz0 + legDepth, bz0 + Db − legDepth]`;
     - the apron inset clamp uses `min(s, legDepth) − t_c`;
     - the centre stretcher runs between the side stretchers' inner faces, `[bx0 + s/2 + t_leg/2, …]`, which equals the spec's `[bx0+s, …]` when t_leg = s;
     - the side-drawer bays along z use `legDepth`.
   - Tests: `generateTable.test.ts` "thin solid legs…" (2 tests).

I found no overlaps, part-count, size or bbox violations in any template.

## Adjusted ranges (pinned specs updated)

| Template | Field | 07 §2.4 | Now | Ruling |
|---|---|---|---|---|
| wardrobe_hinged | height | 1500–2700 | 1500–2420 | R40-2 (not in the brief's list, same cause) |
| wardrobe_sliding | height | 1800–2700 | 1800–2420 | R40-2 |
| custom_box | height | 100–3000 | 120–2420 | R40-3 (min) and R40-2 (max) |
| console_table | depth | 350–450 | 360–450 | R40-3 |

The pinned field specs were updated in `carcassTemplates.test.ts` and `wardrobe_hinged.test.ts`, and the new tables are pinned in `tableTemplates.test.ts`.

## New issue codes

Both are appended to `FURNITURE_ISSUE_CODES` (now 73), and `validate.test.ts` was updated.

- `furniture.panel_split`: info, params `{ partKey, count }`, entities are the piece keys.
- `furniture.panel_seam_unsupported`: warning, params `{ partKey, position }`, entities are the two pieces at the seam.

They still need English texts in `resources/lang/en/issues.php`, which is not part of this task.

## R40-1 details (for spec 19)

- **Which parts split:** `carcass.top/bottom`, `section.*.fixed_shelf.*`, `plinth.front/back`, `countertop`, `table.top` and `table.top.layer.*`. I also split `table.apron.front/back`, `table.stretcher.center/back` (the trestle beam and the modesty panel) and `table.shelf`.
  - The extra ones are covered by R40-1's definition ("a … horizontal panel that fails fitsSheet along its length") but are not in its list.
  - Dining 3000 needs this: the front and back aprons are 2800 long in PB18, and the trestle beam is 2750 in SW50.
- **How a panel is cut:**
  - Seams are always across x (all these parts run along x).
  - The piece length limit is the largest usable sheet side that still fits the panel's depth, with grain respected.
  - A part whose depth alone exceeds the sheet is not split and stays `part_exceeds_sheet` (tested).
  - Sides and other x-thin parts are never split.
- **Seam supports:** a support is a part that:
  - touches either face of the panel along its thin axis;
  - has its x-centre strictly inside the panel;
  - covers at least 50% of the panel's depth;
  - is longer along that depth than along x.

  In practice these are partitions under a top or on a bottom, plinth returns behind the plinth boards and under the bottom, side aprons, end panels and cabinet sides under a table top, and drawer runners. The ruling says "support below it", but I count either face, so a partition standing on the bottom supports the bottom's seam. Please confirm.
- **Pieces:** keys `<key>.1..n`, `nameKey` kept, `nameParams` plus `{ piece: k }`. Bands are kept except on seam edges. Extruded tops are clipped along their outline (convex clip), so the pieces tile the shape (tested with an oval).
- **Joints:** existing joints move to the piece over the other part's x-centre. Each seam adds a joint `{ pieceK, pieceK+1, chord length }`, so cams and dowels follow §6.9.
- **Side effects:**
  - Overrides keyed on an unsplit key become orphaned once it splits.
  - The sag rule's `FIXED_SHELF` regex does not match a split fixed shelf's piece keys. No template produces one.

## Other deviations for spec 19

- **Sheet door clamp (`sheetDoors`) and the sliding leaf raise** (finding 3) go beyond the R40 rulings, on the same principle as the C9 count clamps.
- **Round diameter cap** at the depth maximum (finding 8) goes beyond the rulings. A user asking for a 1800 round dining table gets 1200 × 1200.
- **Depth field visibility:** the dining and coffee `depth` fields have `visibleIf shape ∈ {rectangle, rounded_rectangle, oval}`. The spec says the depth is "hidden and set" for round dining tables and says nothing for coffee.
- **Coffee table gaps:** §2.4.16 is silent on these, so I took the dining rule for both. Round forces `depth = width` (otherwise `round_top_not_square` errors), and `rounded_rectangle` gets a corner radius of 100.
- **Dining "pedestal only visibleIf shape ∈ round":** a `ParamField` option cannot carry `visibleIf`, so the `base` select always lists pedestal. The generator builds a pedestal for any shape: it is valid and warns `pedestal_unstable` above 1200.
- **Coffee and console materials:** neither has `preferredMaterials` (§2.4 names none), so the top is PB18-WHITE.
- **Thin-leg geometry** (finding 9): the side aprons, side stretchers and centre stretcher differ from the §3.13 table formulas when t_leg ≠ s.

## Tests

### TDD evidence

**RED, templates.** I wrote the property, table and fixture tests before the templates and ran `yarn vitest run resources/js/engine/furniture/templates`:
- Result: `Test Files 3 failed | 3 passed (6); Tests 58 failed | 243 passed (301)`. Saved in `scratchpad/red.txt`.
- The 4 table templates were not registered, so every table definition and generation test failed. `fixtures.test.ts` failed at collection.
- The property test also failed for `wardrobe_hinged`, `wardrobe_sliding`, `loft_cabinet`, `tv_unit`, `sideboard` and `custom_box`. This was expected, since R40-1 to R40-3 were not fixed yet.

**RED, split.** `panelSplit.test.ts` failed with "Cannot find module '../panelSplit'".
- Two test premises were wrong:
  - a 2440 × 500 sheet can still take 451 mm pieces;
  - the oval's inscribed base puts a supporting apron at x 2501.
- I corrected those expectations to match the rule.

**RED, thin legs.** `generateTable.test.ts` had 2 failures:
- the left apron at z 90 instead of 100;
- overlaps in the side-drawer test.

**GREEN.**
- `yarn vitest run resources/js/engine`: 91 files, 3389 tests passing (28.7 s), no stderr noise.
- `yarn eslint resources/js/engine` exit 0; `yarn prettier --check resources/js/engine database/fixtures/furniture` clean; `yarn vue-tsc --noEmit` exit 0.

### Existing tests changed

- `wardrobe_hinged.test.ts`:
  - The "not built yet" registry test now uses a stray key, because every key is registered.
  - Three tests encoded the old one-child and 12-door behaviour. They now use `width: 900` for a single door, and the 12-door case expects `fitDoors`' 5 doors.
  - Height pins changed from 2700 to 2420.
- `carcassTemplates.test.ts`:
  - The registry test now filters by family carcass.
  - The `CarcassKey` type excludes the table keys.
  - `TONGUE_PARTNER` accepts `.n` pieces.
  - The sliding and custom_box height pins changed.

## Files

- **New:**
  - `furniture/panelSplit.ts`;
  - `furniture/__tests__/panelSplit.test.ts`;
  - `templates/{study_desk,dining_table,coffee_table,console_table}.ts`;
  - `templates/__tests__/{tableTemplates,fixtures,property}.test.ts`;
  - five fixture JSONs.
- **Modified:**
  - `carcass/back.ts`, `generate.ts`, `validate.ts` and `__tests__/validate.test.ts`;
  - `table/{frame,bases,drawers,generateTable}.ts` and `table/__tests__/generateTable.test.ts`;
  - `templates/{common,index,wardrobe_hinged,wardrobe_sliding,loft_cabinet,custom_box}.ts` and `templates/__tests__/{common,carcassTemplates,wardrobe_hinged}.test.ts`.

The scratch survey test (`zz_scratch_survey.test.ts`) and the temporary worktree are deleted.

## Concerns

1. Three decisions go beyond R40-1..4. Each is the only fix I could see that keeps the 07 ranges and rule 3, but please confirm them:
   - the sheet door/leaf raise;
   - the round diameter cap;
   - extending R40-1 to aprons, stretchers and the lower shelf, which includes splitting a solid-wood trestle beam with an unsupported-seam warning.
2. Seam support counts a part on either face of the panel, not only below it.
3. The `wardrobe_hinged` height range was capped, although the brief named only `wardrobe_sliding` and `custom_box`.
4. The new issue codes need lang strings, and the sag rule does not see split fixed-shelf pieces (no template reaches it).

## Fix round 1

Commit `012b8e4` fix(engine): 300 mm minimum seam pieces, split after panel overrides (Task 40 fix round 1). Pushed to `build/p2-engine`.

### Important 1: tiny seam pieces

Ruling, for spec 19: every piece of a seam split is at least 300 mm long.

- **Constant:** `MIN_SEAM_PIECE = 300` in `panelSplit.ts`.
- **`greedySeams(from, to, maxSpan, supports, minPiece = 100, minTail = 0)`:** a support `c` is used only if `c ≥ s + minPiece`, `c ≤ s + maxSpan` and `to − c ≥ minTail`. Otherwise the next-best (largest valid) support is taken, else the span splits evenly.
- **Long panels** pass `MIN_SEAM_PIECE` for both bounds.
- **The back split** keeps the 07 §3.4.1 defaults (100, no tail guard), so its behaviour is unchanged.
- **Tests** (`__tests__/panelSplit.test.ts`, "every piece is at least MIN_SEAM_PIECE"):
  - `greedySeams` unit cases: end supports are skipped, the next-best support is taken, and the back split's defaults are unchanged.
  - Dining four_legs at 2790–2850, rectangle and rounded_rectangle: two pieces, all at least 300; 2800 gives [1400, 1400].
  - Trestle at 2790–3000: two pieces, all at least 300; 2950 gives [1475, 1475].
  - Plinth boxes 2421–2429 wide: two pieces, all at least 300.
- **Property test:** it now also checks that every `panel_split` piece is at least `MIN_SEAM_PIECE` along x.

### Important 2: split versus overrides

Ruling, for spec 19: panel splitting runs after part overrides on the base key.

**What `splitLongPanels` does now:**
- For a splittable part with an override on its own key:
  - `removed` means the part is skipped and never split; the normal override step removes it later.
  - Any other override is applied first through the now-exported `applyPartOverride`, covering material, edges, deltas and grain.
- The key is recorded in a new `GenContext.overriddenBeforeSplit`, and `applyPartOverrides` skips those keys, so an override is never applied twice or reported orphaned.
- The split then uses the overridden material's sheet and the resized box.
- **Pieces:**
  - inherit `overridden`;
  - keep their band codes per physical edge, including per-edge overrides, except on seam edges;
  - are recorded in `GenContext.seamPieces`. An override keyed on a piece orphans as usual.

**Side effect:** a panel's `override_invalid` is now raised during generation, so it comes before the other override issues. I updated `overrides.test.ts` with a comment.

**Tests** ("panel overrides apply before the split"):
- A PB25 material override: at 2600 wide the top is not split (it fits PB25); at 3000 the pieces are PB25 and overridden; no orphan in either case.
- `removed: true` on a would-be-split top: no top parts, only the bottom is split, no orphan.
- `lengthDelta +100` on a 2400 top: split into [18, 1250] and [1250, 2482].
- An edge override keeps its codes on the pieces.
- An override on `carcass.top.1` orphans.

### Minors

1. **`wardrobe_hinged.singleColumnSide`** is always visible now; the comment explains why. The pin is in `wardrobe_hinged.test.ts`, not `carcassTemplates.test.ts` (which has no wardrobe_hinged spec). It is now a `toStrictEqual` of the whole field, plus a check that doors 2 at 2400 resolve to 3 and the side matters: `[1, 2]` versus `[2, 1]`.
2. **Thin-leg mutants killed.** I verified both by mutation:
   - `legMin → s`: solid s 60 × t_leg 50 with inset 40 must clamp to 32;
   - `reachZ → reach`: three side drawers with legSection 40 must give runners spanning exactly z [100, 800], left and right.
3. **`panelSplit` branches.** New tests cover:
   - the glass exemption (a GLASS5 material override on a 3000 top, which also exercises the override path);
   - the support filter, via the now-exported `supportsOf` on a synthetic context: share exactly 50% in, 45% out, a wider-than-deep part out, a part 10 mm short of touching out;
   - operations kept on piece 1 (synthetic `splitLongPanels`);
   - grain kept with PB18-OAK;
   - the `fixed_shelf`, `countertop`, `table.shelf` and `table.top.layer.n` entries.

   A mutation run over 13 `panelSplit` mutants killed all 13. The share mutant 0.5 → 0.4 needed the 45% case.
4. **Piece names:** `PART_NAMES_EN` adds ` {piece}` to the 12 splittable name keys, giving "Top 1", "Top 2" and "Fixed shelf 2 3". `partNames.test.ts` covers this. `resources/lang/en/parts.php` needs the same placeholders (Task 51).
5. **Seam over a partition:** a part centred on a seam (within 0.5 mm) now joins both pieces. The joint is duplicated, so the partition gets twice the cams of an off-seam partition (tested).
6. **Overlap helper:** `testing/overlaps.ts` now treats extruded parts by their outline's bounding box, so shaped tops and their pieces are checked. The property-test header says so. No new overlaps appeared.

### Verification

- **`yarn vitest run resources/js/engine`:** 91 files, 3407 tests passing (37 s).
- **Gates:** `yarn eslint resources/js/engine` exit 0; `yarn prettier --check resources/js/engine database/fixtures/furniture` clean; `yarn vue-tsc --noEmit` exit 0.
- **Fixtures:** unchanged (no diff).
- **Extra property-test seeds,** run locally through a scratch copy with an env-driven seed and count. The copy was deleted afterwards.

  | Seed | Sets | Result |
  |---|---|---|
  | 42 | 50 | 39/39 |
  | 7 | 200 | 39/39 |
  | 2024 | 200 | 39/39 |
  | 31337 | 200 | 39/39 |
  | 777 | 200 | 39/39 |
