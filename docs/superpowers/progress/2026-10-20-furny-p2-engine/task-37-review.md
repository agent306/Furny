# Task 37 review (f9e5b77..d227d13)

### Spec Compliance

- ✅ Spec compliant. Every check in the brief matches 03 §2.4 / 07 §1.4, §7.1–§7.3, §12.4 (details below).
- ⚠️ Cannot verify from this diff: table-family shelf keys (`table.shelf`, `table.cabinet.shelf.N`) and the `hasRole('carcass')` branch of `thin_carcass`. No table generator exists yet (Task 38), so the sag rule's key patterns and the `endCabinets.content` lookup are untested against real keys. Task 38 must confirm them.
- ⚠️ Logging: carry 1 changes the literal reading of 07 §3.7 rule 3 / 03 §2.4 ("rem < 0 -> fixed_sizes_exceed"). When no child is fixed, `allocate` returns `overBy: null` and sizes 0. The report lists this under carries but not under "Deviations to log (spec 19)". The controller should log it.

Checks run (mutation testing in a scratch copy, since deleted; the worktree was not touched; about 115 mutants):

1. `SAVE_BLOCKING_CODES` (validate.ts, SAVE_BLOCKING_CODES): extracted mechanically and diffed against the 07 §7.1 list. Exactly the 9 codes, same order. Mutants "add archived_code" and "drop front_overlap" are killed.
2. `FURNITURE_ISSUE_CODES`: extracted all 69 `furniture.*` codes from the 07 §7.3 table (the trailing `part_exceeds_sheet_back` note included) and diffed against the array. Identical, including order. The completeness test (validate.test.ts ~1060-1090) scans all non-test sources for `'furniture.x'` literals. Mutants killed: a new literal `'furniture.brand_new'` added in model.ts, and `slide_resized` dropped from the list. The scan is one-directional (source is a subset of the list), and matches single-quoted literals only.
3. Structural checks: dims ranges (150/6000, 100/3000, 100/1200), family_mismatch (both directions, one issue), section_tree_invalid (dup ids, split/children/content consistency), section_too_small (100/80 on the laid-out leaf, boundaries 99/100 and 79/80), front_not_rectangle and front_overlap via `frontCoverageIssues`. Params match 07 §7.3. All boundary mutants are killed. Behaviour on early stop: dims, family, tree and fronts still run (tested, validate.test.ts:601). `section_too_small` is skipped when the envelope is too small, because the layout is empty (probe: 140 wide gives dims_range + envelope_too_small only). See M1.
4. Sag: all 19 table rows compared to 07 §7.2 (each row mutated, all killed). Lookup (largest thickness <= t, else scale the smallest, else 44t/55t) is correct, and `<=` / `findLast` mutants are killed. The 1.5 factor applies to fixed shelves, non-adjustable loose shelves, `table.shelf`, and non-adjustable cabinet shelves. Comparison is strictly `>`, so the limit itself is OK (`>=` mutants killed). The `limit` param is the scaled limit. All 07 §12.4 cases are covered by tests (801, 1001, fixed 1164 and 1201, MDF18 900, PLY18 1100). Survivor: span `Math.floor` vs `Math.round` (no fractional-span test; box sizes are integers in practice).
5. Model rules:
   - `part_exceeds_sheet`: sheet dims, trim, grain and glass skip are all killed; params carry `materialCode`.
   - `too_many_parts`: Σqty after overrides, `> 400` (an `>=` mutant is killed).
   - `loft_no_access`: loft only, covers must hit an existing section.
   - Thresholds and severities verified by mutation: thin_carcass `< 15` warning, back groove `> 8` warning (grooved only), drawer_bottom `> 8` warning, drawer_box outside 12-16 info.
6. Carries:
   - Flex-only negative: `allocate` clamps to 0 and gives `overBy: null` without a fixed child. The shelf zero-width guard is in contents.ts. `section_too_small` width 0 is reported, and no negative sizes appear (fuzz + crowded test). The clamp, overBy and guard mutants are killed.
   - Non-slide `slideCode`: `unknown_code {code, kind: 'hardware'}`. Kind-check, carcass and table-drawer mutants are killed.
   - Derived default edge bands: `unknown_code` / `archived_code` reported. The off-switch and "explicit band set" mutants are killed.

### Strengths

- Pure, small modules: validate.ts has one clear job; sag.ts holds table, lookup and rule; model.ts is a flat list of rules.
- Boundary tests are thorough: nearly every threshold mutant was killed, including the exact-limit cases for sag, 400 parts, and the 15/8/12/16 thicknesses.
- The seeded 300-tree fuzz plus the crowded-columns test pin the "no negative size" carry. The `shelvesFor` zero-width guard is checked.
- Structural checks run on the raw document and survive early generation stops, with a test for it.
- The source-scan test is a real guard against a code missing from the catalogue.

### Issues

#### Critical
None.

#### Important
None.

#### Minor

- M1 validate.ts:~200 (`structuralIssues`): `section_too_small` needs the layout, which is empty when the envelope is too small. A document with tiny leaves and `envelope_too_small` yields no `section_too_small`. `envelope_too_small` is not save-blocking, so such a doc saves, though it still blocks ordering. The spec says "any leaf" but gives no way to size leaves without an envelope; accept, or note it in the spec 19 log.
- M2 validate.ts `dedupeIssues` (~line 245): the key is literal "code + entityIds" (07 §7.1), but several generators put the same entity on distinct issues. Probe: 4 drawers in a 300 mm section generate 4 `drawer_too_low {sectionId, drawer: 1..4}`, all with entityIds `[sectionId]`; `validateFurniture` returns only drawer 1 (drawers.ts:375-379). `generateFurniture().issues` and `validateFurniture()` therefore disagree. Spec-literal, so not a defect against the spec; the controller should decide whether to widen the key (for example, include params that differ) or accept.
- M3 codes.ts `derivedEdgeBands`: it checks the default band of every role's material, including roles no part uses. Probe: a box with no countertop and `top = MDF18-GLOSS-WHITE` plus an archived `EB20-WHITE` gives a spurious `archived_code` warning. If the band were missing it would be a save-blocking `unknown_code` for an unused role. This is consistent with how role materials are already reported, so low risk, but worth noting.
- M4 Test gaps (survived mutants):
  - `part_exceeds_sheet` trim: `trim = 0` survives; a part of 2430 in a 2440 sheet is not tested. The existing 2420/2500 pair cannot tell.
  - `part_exceeds_sheet` back handling: skipping all backs, rather than only generated ones, survives; no extra back part test. Likewise the `ctx.mat(part.role)` fallback.
  - `codes.ts`: "once per code" for the misused slide code, the derived-band "not repeated when explicit", and the derived dedupe survive. `validateFurniture`'s own `dedupeIssues` masks them, and there is no direct `codeIssues` test. The unknown-material to role-default fallback in `derivedEdgeBands` is untested.
  - `endCabinets` slide code and the `hasRole('carcass')` branch of `thin_carcass`: untested (no table generator yet; Task 38).
  - Shelf guard `w - 2*clearance <= 0` vs `< 0`: the exactly-zero width case is untested.
- M5 validate.ts: `FurnitureIssueCode` is exported but `furnitureIssue` takes `string`, so the type does not guard call sites; only the source-scan test does (single-quoted literals only). Optional: type the `code` parameter.
- M6 sag.ts `spanOf`: the span is the part's x-extent (floored box size), not `part.length` as 07 §7.2 literally says. The x extent is the physically right span for a shelf narrower than deep, but it should be recorded as an interpretation in the spec 19 log.

### Assessment

**Task quality:** Approved

**Reasoning:** The code matches the spec on the code lists, structural rules, sag table and lookup, model rules and the three carries. About 115 mutants were checked, and the survivors are limited to the test gaps in M4. The remaining findings are minor: the dedupe data loss (M2), the early-stop skip of `section_too_small` (M1) and unused-role band reports (M3) are worth a controller decision.
