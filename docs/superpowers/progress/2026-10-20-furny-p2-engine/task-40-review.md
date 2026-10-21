# Task 40 review (2133940..c270ff7)

### Spec Compliance

- ✅ **Spec compliant**, given the accepted controller rulings.
  - **Templates.** The 4 templates match 07 §2.4.14–§2.4.17 field by field and in what they generate:
    - `study_desk.ts:27-105` matches exactly, including `preferredMaterials.top` and the cabinet content shapes.
    - `dining_table.ts` matches, except for the accepted round cap and the pedestal option that is always offered.
    - `coffee_table.ts` matches: overhang 30, apron 70/10, solid legs 50, no stretcher. The round rules are accepted.
    - `console_table.ts` matches. The depth minimum is 360 under R40-3.
  - **Registry.** `TEMPLATES` uses `satisfies Record<TemplateKey, TemplateDefinition>` and has 19 keys (`index.ts:31-52`).
  - **Fixtures.** The five fixtures match 03 §6 and the brief:
    - tv_unit defaults, 1800 wide;
    - bookshelf with height 2100, `[5, 5]` shelves (`bookshelf-5shelf.json` interior counts 5 and 5);
    - base_cabinet defaults, 600 wide;
    - dining defaults, 1800 × 900, rectangle, overhang 50;
    - study_desk defaults.
  - **R40-1 to R40-4** are implemented as ruled.
- ⚠️ **Cannot verify from the diff:** the English texts for the issue codes and part names. These are deferred to Task 51.

### Checks run (all in a scratch copy, which has been deleted; the worktree is untouched)

- **The property test is not vacuous.**
  - `model.bbox` comes from `doc.dims` (`generate.ts:153`), not from the parts, so the bbox check is real.
  - Every set goes through `paramsSchema.safeParse` before `generate`.
  - Overlaps use the Task 38 helper, with the groove exemption limited to `carcass.back*` against the sides, top and bottom (`property.test.ts` `TONGUE_PARTNER`).
- **Coverage of seed 42 × 50, per template.**
  - **Selects:** every option of every select is drawn, for example:
    - dining `shape` 4/4, `base` 3/3, `legSource` 2/2;
    - study `base` 3/3;
    - wardrobe `backType` 4/4.
  - **Discrete combinations:** all are covered except dining at 22/24.
  - **Booleans:** each splits between 19/31 and 26/24.
  - **`'auto'`:** drawn 11 to 19 times per 50 sets.
  - **Length fields:** most reach both range ends, and distinct values cover 13–100% of the step grid (wide fields have about 45 of 200–586 steps).
  - **Hidden fields:** the test randomises them too. This is a harmless superset, because the generators ignore study `cabinetWidth`/`cabinetContent` and dining/coffee `depth` when those fields are hidden.
  - **Exception:** `wardrobe_hinged.singleColumnSide` takes a value that matters while hidden (see Minor 1).
- **Extra seeds 7, 2024 and 31337, each × 200 sets × 19 templates (11,400 documents):** 0 failures.
- **Fixtures and table tests** (`fixtures.test.ts`, `tableTemplates.test.ts`) were re-run in scratch: 68 passed. The bookshelf check asserts `[5, 5]`.
- **Mutation testing:** 44 mutants against the regression files (property test excluded, then re-run on the survivors):
  - 35 were killed by a named regression test;
  - the 9 survivors are listed under Minor 2 and Minor 3. The property test also kills none of them.
  - Every listed root fix has at least one killing test:
    - the hinged single-column root;
    - `fitDoors` and `sheetDoors` in the hinged and loft templates (including the flap column);
    - the sliding leaf raise;
    - all four range caps (the hinged, sliding and custom_box heights and the console depth);
    - the round cap;
    - both `splitLongPanels` call sites;
    - support on either face;
    - seam joints, joint re-homing, the unsupported warning, outline clipping, seam-edge banding and the chord length;
    - thin-leg aprons, stretchers, the centre stretcher and `legDepth`.
- **Named risk: rules that look up splittable keys after the split.**
  - I grepped `resources/js` for the literal keys. The only consumers are `sag.ts:115-116` (the fixed-shelf regex and `'table.shelf'`) and the `table.top` issues in `frame.ts`, which are emitted before the split.
  - The sag gap is the accepted carried item. Note that it also covers a split `table.shelf`, which no template reaches.

### Strengths

- **`panelSplit.ts` is cleanly factored.**
  - `greedySeams` is shared with `carcass/back.ts` and is a verbatim move of the §3.4.1 rule.
  - Supports, the sheet limit, piece construction, joint re-homing and the issues are each a small function.
  - Extruded outlines are clipped with Sutherland-Hodgman, and the oval test proves the pieces tile the ellipse.
- **The thin-leg fix keeps the spec formulas when `t_leg = s`.** `bases.ts`: the centre stretcher becomes `[bx0 + s/2 + t_leg/2, …]`, and the comment documents the equivalence.
- **The fixture tests are byte-exact.** They use the prettier API, then check deep-equal, schema validity, determinism and the absence of warnings.
- **The property-test failure messages are actionable.** They print the params and readable problem lines.
- **The report is accurate.** Every claim I spot-checked held: the 73 codes, the four adjusted ranges, `legDepth`, the support definition and the orphan side effect.

### Issues

#### Critical (Must Fix)

None.

#### Important (Should Fix)

1. **The greedy seam picks the panel's own end supports and leaves sliver pieces, with no issue raised.** `panelSplit.ts:56-57`
   - **Cause:** the candidate filter is `s + 100 ≤ c ≤ s + maxSpan`, with no guard that the remaining `to − c` is at least `MIN_PIECE`, and nothing excludes supports at the panel ends.
   - Those end supports are the side aprons, trestle ends, end plinth returns and sides, all of which `supportsOf` (`:211-235`) accepts. In §3.4.1's back split the candidates are interior partitions, so this did not arise there.
   - **Reproduced on the template's 10 mm grid with no warning, because the seams count as supported:**
     - `dining_table` with `four_legs`, rectangle or rounded_rectangle, widths 2790–2850: `table.top` is cut at x 2726 into 2726 + a **74 × 900** strip (at width 2800).
     - `trestle`, widths 2790–2880: a 2750 piece plus a **100 mm** piece.
     - `trestle`, widths 2890–3000: **three** pieces, 100 | 2750 | 100 (at width 2950). Two even pieces would have done.
     - Wardrobe, sideboard and other plinths at the off-grid widths 2421–2429, which a document edit can reach (07 §2.1 rule 4): `plinth.front.2` and `plinth.back.2` are **9 mm** long (the seam sits over the end return at W−9).
   - The property test cannot see this, because it checks no piece sizes.
   - **Fix:**
     - Accept a candidate only if `c ≤ to − MIN_PIECE`, and prefer a candidate that does not leave a remainder longer than `maxSpan` from a near-end support. Alternatively, drop supports within `MIN_PIECE` of either end of the panel.
     - Add regression tests at dining 2800 (four_legs) and 2950 (trestle).
2. **Overrides on a part that later splits are orphaned, and only an info issue says so.** `generate.ts:102/142`, `panelSplit.ts:248-310`
   - The split runs before `applyOverrides`. An override keyed `carcass.top` is therefore dropped once the width crosses the sheet limit. Verified with `custom_box` going from 2000 to 3000 wide:
     - `{ materialCode: 'PB25-WHITE' }` silently reverts to PB18 on `carcass.top.1` and `.2`;
     - `{ removed: true }` brings the top back as two pieces.
   - The only signal is info `furniture.override_orphaned { key: 'carcass.top' }`. It does not mention the split, and info is the lowest severity. The price and BOM change without a warning.
   - **Related:** the split decision uses the generator's material, not the overridden one. A material override with a larger sheet cannot prevent a split. An override on `.1`/`.2` is orphaned again when the width drops back.
   - **Fix:** in `applyPartOverrides`, fan an override on `<key>` out to the `<key>.n` pieces when `<key>` was split (`removed`, material and band carry over; length and width deltas apply per piece or are rejected). At minimum, raise a dedicated warning naming the split.
   - The brief asked for this check explicitly. The report lists it only as a "side effect".

#### Minor (Nice to Have)

1. **A hidden field matters.** `wardrobe_hinged.ts:101-103`
   - `singleColumnSide` is visible only for `doors ∈ {auto, odd}`. But the new `sheetDoors` raise and the `fitDoors` cap turn even requests odd, for example:
     - doors 2 at width ≥ 2400 gives 3;
     - doors 12 at width 600 gives 5.
   - Then the hidden default `'left'` decides the layout. I found 43 (doors, width) pairs on a 50 mm grid whose document differs by side.
   - The comment "Only an odd door count has a single-door column" is now false.
   - **Fix:** make the field always visible, or have the clamps preserve parity.
2. **Two parts of the R40-3 thin-leg fix have no killing test.**
   - `frame.ts:189`: mutating `legMin = Math.min(s, legDepth)` to `s` survives. The test at `generateTable.test.ts:831` uses s 40 < t_leg 50, where `min = s`. A case with `s > t_leg` would kill it.
   - `drawers.ts:138`: mutating `reachZ` to `reach` survives the side-drawer test at `generateTable.test.ts:844`.
3. **Several `panelSplit.ts` branches have no killing test:**
   - the glass exemption (`:243`);
   - `MIN_SUPPORT_SHARE` (`:34`);
   - the support aspect filter (`:231`);
   - the `SPLITTABLE` entries for `fixed_shelf`, `countertop`, `table.shelf` and `table.top.layer.n`. Removing any one survives, and `fixed_shelf` and `countertop` are named in R40-1 itself;
   - grain kept on pieces (`grainAxis: null` survives);
   - `operations` kept only on piece 1 (`:307`).
4. **Pieces get identical display names.** `panelSplit.ts:294` adds `nameParams.piece`, but `partNames.ts:10` `'parts.top': 'Top'` (and apron, plinth and the rest) ignore `{piece}`. A cut list then shows two "Top" rows of different sizes. This could be folded into Task 51.
5. **At a supported seam, the partition's joint goes to the left piece only.** `pieceAt` uses `x <= seam.at`, and the seam sits on the partition centre. The right piece, resting on the same partition, gets no connector from it, only the seam joint.
6. **The overlap helper skips extruded parts** (`testing/overlaps.ts:34`). The property test's no-overlap assertion therefore never covers round, oval or rounded tops, or their split pieces. Worth a note in the test header.

Carried item (accepted, not re-flagged): the sag rule does not see split pieces. That includes a split `table.shelf` (`sag.ts:116`), as well as fixed shelves.

### Assessment

**Task quality:** Needs fixes

**Reasoning:** The templates, fixtures and property test are solid, and the property test is a real gate: 11,400 extra random sets came back clean, and the root fixes are pinned by killing tests. However, the seam rule yields 74 to 100 mm sliver tops on standard dining widths with no warning. Also, overrides on split keys are dropped with only an info issue.
