# Task 33 report: section layout, dividers, shelves/rod/baskets, back panels

Status: DONE_WITH_CONCERNS (concerns are spec/brief ambiguities I resolved; see "Spec notes").

Commits (branch `build/p2-engine`, pushed):
- `3fd2fd2` feat(engine): lay out sections and generate dividers, shelves, rods and backs
- `3463fa9` test(engine): close carcass test gaps from the envelope and panels review (Task 32 minors M1-M6)

## What was implemented

- `furniture/sheetFit.ts`: `fitsSheet(a, b, material, grain, trim)` exactly as 07 §3.4.1.
- `carcass/layout.ts`: `SectionBoxInfo`, `SectionLabel`, `Divider`, `SectionLayout`, `Allocation`, `allocate`, `layoutFromEnvelope(ctx, env)`, `layoutSections(doc, catalog)` (public, exported from `engine/index.ts` with the four types), `dividerParts(ctx, layout)`, and `recordEndJoints(ctx, member, endAxis)` (the geometric joint discovery, shared with `contents.ts`).
- `carcass/contents.ts`: `contentDepth(ctx, env, sectionId)`, `shelvesFor`, `rodFor`, `basketsFor`.
- `carcass/back.ts`: `backPanels(ctx, env, layout)` with the greedy split.
- Test support: `furniture/testing/docs.ts` gained `wardrobeFixture`, `leafSection`, `splitSection`, `flex`, `fixed`, `assign` (now exported) and a `BoxOptions.interior` override; new `furniture/testing/carcassRun.ts` drives envelope, panels, layout, dividers, contents, back, plinth and countertop in pipeline order (Task 36 will replace it with `generateFurniture`).

## Design decisions

- **Joint discovery.** `recordEndJoints` compares world boxes of `ctx.parts` after they exist. For a member, at each of its two end faces (partition: y ends; fixed shelf and non-adjustable shelf: x ends) it finds every other part whose facing face is in the same plane (0.5 mm) on the far side and overlaps the end face with positive area. `member` = the part whose end meets the other's face; `length` = the longer side of the overlap (= the shared edge, = z-size in all spec cases); each member/other pair once. `dividerParts` creates all divider parts first, then discovers joints, so a partition inside a row finds the fixed shelf below it.
- `layoutFromEnvelope` also fills `ctx.sections` with the leaves (pre-order, sizes floored), because 07 §3.7 says `FurnitureModel.sections` = leaf entries and the layout step is where they arise. Task 36 (`generateFurniture`) must not push them a second time.
- `SectionBoxInfo.index` = 1-based position among siblings (the `n` of the label), 0 for the root. `Divider.index` = the `{i}` of its key. `layout.dividers` lists a section's own dividers before those of its children.
- `layoutSections` returns an empty layout when the envelope is too small; it throws (`EngineInputError`, via `computeEnvelope`) for a document without a carcass. The issues of the throwaway context are dropped.
- Missing hardware defaults (`shelf_support.default`, `rod.default`, `rod_support.default`, `basket.default`): line omitted, warning `furniture.no_default_hardware { roleKey }` with `entityIds = [hardware key]`, so deduplication by code+entityIds does not merge different lines.
- Reason keys: `hardware.reason.shelf_supports { shelves }`, `hanging_rod`, `rod_supports`, `baskets`.
- Seam warnings carry the keys of the pieces on both sides as `entityIds`.

## Tests and results

- RED: `yarn vitest run resources/js/engine/furniture/carcass resources/js/engine/furniture/__tests__/sheetFit.test.ts` before any implementation: `Test Files 4 failed | 2 passed`, with `Error: Cannot find module '../sheetFit'` and `Cannot find module '../carcass/back' imported from .../testing/carcassRun.ts`. Expected: the modules did not exist yet. (The 2 passing files were the unchanged Task 32 suites.)
- GREEN: `yarn vitest run resources/js/engine` -> `Test Files 70 passed (70)`, `Tests 2458 passed (2458)`, no stderr noise. Furniture only: 13 files, 301 tests (layout 31, contents 37, back 26, sheetFit 9, envelope 25, panels 36).
- Gates: `yarn eslint resources/js/engine` clean, `yarn prettier --check resources/js/engine` clean, `yarn vue-tsc --noEmit` clean.
- Brief values verified: columns 582/1164, partition `x [600,618]` 1964 x 569 `L1` banded faces 0; rows 350/1596, fixed shelf `y [1714,1732]` 1164 x 569; labels `Interior`, `Column 1`, `Column 2 › Row 1`; allocate `[334,333,333]`, `fixed_sizes_exceed overBy 100` with fallback `[545,454]`, all-fixed -> `fixed_sizes_adjusted`; shelves 4 x 580 x 549, `SHF-PIN-5 x 16`, pin holes 116 on `carcass.side.left` and on the partition; 18 shelves in 300 mm -> `shelves_dont_fit`; non-adjustable shelf = 2 joints; rod `ROD-OVAL-1200 x 1` + `ROD-SUP x 2`, 1300 wide -> 2 pieces + `rod_span_long`, depth 500 -> `rod_section_shallow { depth: 500 }`, height 850 -> `rod_section_short`; baskets `BSK-PULL-600 x 2` in a 564 x 714 x 529 leaf with no warning, 500 wide -> `basket_size_mismatch`, 5 in 700 -> `baskets_dont_fit`; wardrobe back `carcass.back.1` 1978 x 598 / `.2` 1978 x 1180 at x = 609, info `back_split { count: 2 }`, no seam warning; `custom_box` 2400 x 2000 x 600 nailed -> 2 x 1200 x 2000 + `back_seam_unsupported { axis: 'x', position: 1200 }`; `fitsSheet(1978,1778,HDF3,'none',10) === false`, `(2420,1200) === true`.
- Mutation check (about 70 hand-made mutants over layout/contents/back/sheetFit and the Task 32 minors): all killed except 3 equivalents (`bh >= usableLength` in back.ts is identical because the greedy loop's own condition is the same; `d.kind === 'fixed_shelf'` filter is redundant because a partition is never as wide as a strip; one no-op mutant of my own script). Three real survivors found on the first run (positive-overlap check, `count < 1` guard, `bh <= UW` boundary) got tests and are now killed.

### Task 32 minors folded in (commit `3463fa9`)
Each was verified to fail when its mutant is applied to the Task 32 source.
- M1 grain: oak sides/top/bottom/plinth front/back/returns `length`; oak countertop `length` and `width` when deeper than wide (mutants side grain y->x, plinth front x->z, return z->x, countertop x->z all killed).
- M2 plinth with x0 != 0 (left overhang 30, right 20): front/back x = 30, returns at 30 / 546 / 1062.
- M3 roles: front 25 mm, plinth 12 mm, carcass 18 mm. Panels: `Dc` 535, plinth front z 503, return depth 491. Envelope: `fz` 25, sliding zone 74. Kills `t('front')`->`t('carcass')` and `t('plinth')`->`t('carcass')`.
- M4 wall unit with `bottom: over_sides`: side bottoms not banded.
- M5 sliding front beside a hinged overlay front: `fz` 0, zone 60.
- M6 zero-height plinth (`plinth` and `legs`): no parts, no issue.

## Spec notes and concerns (exact numbers)

1. **07 §3.7 rule 3 order vs the brief example.** The spec says "if no child is flex the last is treated as flex" and then "fixedSum = Σ fixed mm; rem < 0 -> error". Read literally, fixed 600 + fixed 500 in 1000 gives the last child as flex, `rem = 400`, no error. The brief requires `fixed_sizes_exceed { overBy: 100 }` with fallback `[545, 454]`. I run the overflow test on the sum of all fixed mm first, then let the last child absorb `rem` (`adjusted = rem !== 0`). Consequence: all-fixed [400, 500] in 1000 -> `[400, 600]` + info; [600, 500] -> error.
2. **07 §3.4.1 step 4 "x-range covers the strip completely".** A grooved back strip runs 7 mm into the grooves (x [11, 1789] in the wardrobe) while a fixed shelf only spans the interior (x [18, 1782]), so a strict reading never lets a fixed shelf support the outer strips. I clamp the strip to the interior x-range before the cover test (nailed backs have the same effect with 18 mm sides). Test: 1000 x 2700 box with a fixed shelf -> supported seam at y = 1673, no warning. Wardrobe and the 2400 x 2000 example are unaffected.
3. **Brief back-split examples vs the greedy rule: no disagreement.** Wardrobe: back 1778 x 1978 at x [11, 1789], `Px = 1200` (`bh = 1978 > UW = 1200`), candidate 609 in [111, 1211] -> pieces 598 and 1180. `custom_box` 2400 x 2000: unsupported seam `0 + ceil(2400 / ceil(2400 / 1200)) = 1200`. Other numbers I pinned: 3700 x 720 box without partitions -> one seam at x = 1850 (pieces 1839); with an oak (grain-locked) back -> seams at 931 / 1851 / 2770 (strips <= 1200); 1000 x 2700 -> y seam at 1350; 2800 x 2700 -> 6 pieces (x seams 937 / 1863, y seam 1350 in each strip).
4. **Issue params.** The brief abbreviates (`{ overBy: 100 }`, `{ depth: 500 }`); I followed the 07 §7.3 catalogue (`sectionId` plus the value) and `entityIds = [sectionId]`. Tests use full-object equality, so a downstream test written against the abbreviated form would need `toMatchObject`.
5. **`furniture.part_exceeds_sheet_back`** is "reserved" in 07 §7.3 with no params. I emit it (warning, params `{ partKey, length, width }`) only for a piece that still fails `fitsSheet` after splitting, which in practice means a sheet smaller than the trim. Greedy loops return no seams when the usable size is <= 0 (no infinite loop).
6. **Added guard beyond the spec:** shelves with `depth <= 0` (setback >= content depth) report `shelves_dont_fit` instead of producing a zero/negative part.
7. **Not modelled:** the 3D-only rod cylinder (07 §3.10) has no home in `Part`/`FurnitureModel`; the P5 furniture-builder task (`buildFurnitureObject`) must derive it from the hardware line and section box.
8. `Joint.length` is "longer side of the contact overlap"; the spec's "partition z-size / shelf depth" are the same numbers in every case I could construct (thickness is always the shorter side).

## Files changed
- New: `resources/js/engine/furniture/sheetFit.ts`, `carcass/layout.ts`, `carcass/contents.ts`, `carcass/back.ts`, `testing/carcassRun.ts`, tests `__tests__/sheetFit.test.ts`, `carcass/__tests__/layout.test.ts`, `contents.test.ts`, `back.test.ts`.
- Modified: `resources/js/engine/index.ts` (layoutSections + types), `furniture/testing/docs.ts`, `carcass/__tests__/envelope.test.ts`, `carcass/__tests__/panels.test.ts`.

## Self-review
- No emojis or stray comments; naming follows Task 32 files. No source file of Task 32 was changed.
- `layout.ts` (about 330 lines) and `back.ts` (about 230 lines) are the largest additions; both stay single-purpose.
- One test helper (`carcassRun.ts`) duplicates the pipeline order that `generate.ts` will own; it is test-only and small.

## Fix round 1

Review: `task-33-review.md`. Gates after the fixes: `yarn eslint resources/js/engine`, `yarn prettier --check resources/js/engine`, `yarn vue-tsc --noEmit` clean; `yarn vitest run resources/js/engine` -> 70 files, 2470/2470 passing.

- **I1 (ruling, log 19).** In `back.ts` the shelf-cover test now clamps a strip to the inner faces of its column: at a supported vertical seam the edge becomes the face of the partition the seam sits on (left strip: partition min face; right strip: partition max face); at the carcass sides it stays clamped to the interior as before; unsupported seams keep the raw edge (the shelves of that column span both strips). Tests (`back.test.ts`): the reviewer's 1800 x 2700 x 600 two-column box (partition x [891, 909], shelves y [1364, 1382]) gives 4 pieces split at y = 1373 and no `back_seam_unsupported`; the same with a shelf in one column only supports only that strip (other strip: unsupported seam y = 1350, one warning); `wardrobe_hinged` at 2700 mm (plinth 100, back y [111, 2689]) gives pieces `back.3/.4` split at the shelf y = 2323 and a single warning for the shelf-less single-door column (y = 1400). Mutants that restore the old left or right edge are killed.
- **M1** `layout.test.ts` "recordEndJoints contact rules": corner and edge contacts (x-only, z-only, both) give no joint; kills `o <= eps` -> `o < 0`.
- **M2** same block: planes 0.4 mm apart (either side) give a joint, 0.6 mm apart none; kills tolerance 0.01.
- **M3** `contents.test.ts`: two rows of two equal columns (partitions at the same x): pins of the lower leaves go to the lower partition (28), none to the upper one; plus a decoy test with two parts listed first that touch the leaf side but lie above it (y) or in front of it (z), which must not receive pin holes. Kills removal of either overlap check.
- **M4** rod without `maxLengthMm` in its specs (via `mutateCatalog`): 1100 wide -> 1 piece, 1300 -> 2 (kills fallback 1000); `ctx.sections` floors a fractional interior (564.7 x 684.9 x 547.5 -> 564 x 684 x 547) while `layout.byId` keeps the exact box (kills dropping `fl`).
- **M5** `contentDepth` is now the single implementation: its `env` parameter is `Pick<Envelope, 'interior'>`, and `shelvesFor`, `rodFor` and `basketsFor` call it through a small `leafDepth` helper with `{ interior: leaf.box }`.
- **M6** carried to Task 37 (no action). **M7** corrected above (Task 36, not 34; the rod cylinder owner is the P5 builder task).
