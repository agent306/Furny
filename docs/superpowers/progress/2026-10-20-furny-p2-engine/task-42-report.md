# Task 42 report: `computeBom`

**Status:** DONE_WITH_CONCERNS (one brief golden changed because spec 08 contradicts itself; see concern 1)
**Commit:** `989261a feat(engine): compute bill of materials and cut list` (pushed to `origin/build/p2-engine`)
**Tests:** bom 61/61; full suite 109 files / 3629 tests passing; output clean. Gates: eslint, prettier --check and vue-tsc all clean.

## What I built

Files in `resources/js/engine/bom/`:

| File | Contents |
|---|---|
| `types.ts` | `Bom`, `CutListRow`, `NestingResult` (plus `NestedSheet`, `NestingPlacement`), `BomMaterial`, `BomOperations`, `ComputeBomOptions`. These follow 03 §3.2 and 08 §3. |
| `constants.ts` | `EDGE_ALLOWANCE_MM = 50`, `EDGE_WASTE_PERMILLE = 50`, `FINISH_AREA_STEP_MM2 = 10_000` |
| `cutSizes.ts` | `cutSize(part, catalog, premillMm)`. Uses µm sums and `roundHalfUpDiv(Δ, 1000)`. Bands on W1/W2 shorten the length; bands on L1/L2 shorten the width (§3.2). |
| `edgeBanding.ts` | `edgeBandLengths(parts, catalog)`. Each banded edge counts qty × (edge + 50). An extruded part counts as one continuous edge: qty × (round(P) + 50), where P is the sum of the outline segments and the band is the first non-null of L1, L2, W1, W2. The result is `ceilDiv(Σ × 1050, 1000)` per code, sorted by code (§3.3). |
| `rowKey.ts` | `fnv1a32` (UTF-16 code units, `Math.imul`, `>>> 0`), `rowIdentity`, `rowKeyFor`, and the helper `rowKeyOfIdentity` (§3.4). |
| `bom.ts` | `bomOptionsFor(doc, nesting)`, `computeBom(model, catalog, options)` and `mergeIssues(modelIssues, bomIssues)`. |

`computeBom` implements these parts of 08:
- **§3.4 rows:** parts are grouped by identity. When two identities share a hash, the one that sorts later gets suffix `-2`, `-3`, …. `partKeys` are sorted, each key once, and `qty` is the sum. All other fields come from the first part by key. The cut size comes from `catalog.pricing.edgePremillMm`. The name lists unique English names in key order, with `+{n} more` after 3. Rows are ordered by material asc, thickness desc, length desc, width desc, then rowKey.
- **§3.5 materials:** code asc, with `wasteMilli = Math.round(wasteFactor × 1000)`. Without nesting, `sheetsNested` and `utilization` are null and `sheetsBilled = sheetsEstimated`.
- **§3.6** finishing, **§3.7** operations and **§3.8** hardware (merged by code, lines with qty ≤ 0 dropped, code asc).
- **§3.9 issues:** the model issues, copied, followed by any BOM issues not already present by `code + entityIds`. Task 43 will pass the nesting issues in.
- **Nesting:** `options.nesting === true` throws `Error('nesting not implemented')`, as the brief says.
- **Exports:** everything is exported from `engine/index.ts`.

Tests in `resources/js/engine/bom/__tests__/`:
- `cutSizes.test.ts` (11): all §3.2/§10.3 cases, plus the W/L axis split, a pre-mill larger than the band, and an unknown band code.
- `edgeBanding.test.ts` (7): the constants, rectangle allowance and waste, summing and sorting by code, the Ø1000 64-gon (round(P) = 3140, raw 3190 → 3350), the extruded first-non-null band × qty, and an extruded part with no band.
- `rowKey.test.ts` (9): FNV vectors `''`, `'a'` and `'foobar'`, surrogate pairs, the exact identity string, the `/^r[0-9a-f]{8}$/` format, zero padding (`r00e99e73`), L1↔L2 and W1↔W2 equivalence, and which fields change or do not change the key.
- `bom.test.ts` (24):
  - `bomOptionsFor`.
  - Row merging, the name rule (unique names, `+n more`), and row order.
  - A real FNV-1a collision: 535×296 and 1232×420 both hash to `re389dbf9`. The later identity gets `-2`.
  - Split pieces as ordinary parts: two equal pieces form the row "Top 1 / Top 2"; the odd piece gets its own row.
  - Sheet estimates and the exact boundary at 2 706 181 / 2 706 182 mm², and an unknown material.
  - Finishing per role, operations × qty, hardware merging, an empty model, issue copying, `mergeIssues` dedupe, the nesting throw, catalog pre-mill and no input mutation.
  - An invariant test over all 6 furniture fixtures.
- `bom.wardrobe.test.ts` (10): the 08 §10.2 wardrobe without nesting.
- `panel.ts`: a test-only part builder.

## TDD evidence

**RED** (`yarn vitest run resources/js/engine/bom`, before any implementation file existed): all 5 test files failed to load, which is what I expected.
```
 FAIL  |engine| resources/js/engine/bom/__tests__/bom.test.ts
Error: Cannot find module '../bom' imported from '.../bom/__tests__/bom.test.ts'
 FAIL  |engine| resources/js/engine/bom/__tests__/bom.wardrobe.test.ts
Error: Cannot find module '../bom' ...
 FAIL  |engine| resources/js/engine/bom/__tests__/cutSizes.test.ts
Error: Cannot find module '../cutSizes' ...
 FAIL  |engine| resources/js/engine/bom/__tests__/edgeBanding.test.ts  (../constants)
 FAIL  |engine| resources/js/engine/bom/__tests__/rowKey.test.ts  (../rowKey)
 Test Files  5 failed (5)
```

**First green run:** 1 failure, and it was a mistake in my test. The plinth-returns row has exactly 3 unique names, so its name is "Plinth return 1 / Plinth return 2 / Plinth return 3" with no "+n more". I fixed the expectation.

**GREEN** (same command):
```
 ✓ edgeBanding.test.ts (7)  ✓ bom.wardrobe.test.ts (10)  ✓ cutSizes.test.ts (11)
 ✓ bom.test.ts (24)  ✓ rowKey.test.ts (9)
 Test Files  5 passed (5)
      Tests  61 passed (61)
```

**Full suite** (`yarn vitest run`): `Test Files 109 passed (109)`, `Tests 3629 passed (3629)`.

**Gates:** `yarn eslint resources/js/engine && yarn prettier --check resources/js/engine && yarn vue-tsc --noEmit` all clean.

## Brief goldens vs final values

The current generator's wardrobe model still matches the 07 §12.2 tables: 20 parts, 14 hardware lines, the same sizes and bands. So every numeric golden reproduces. **1 golden changed:** the name of the top/bottom row.

| Golden | Brief | Final | Derivation |
|---|---|---|---|
| Row count | 12 | 12 | HDF: 2 rows. PB: sides, door 606, doors 593, partition, plinth front, plinth back, top/bottom, fixed shelf, shelves, returns = 10 rows. |
| HDF rows | 1978×1180, 1978×598 | same (cut = finished, no bands) | |
| Sides | 2000×582 → 1999×581, qty 2, "Left side / Right side" | same | L1 and W1 are 0.8 each: −1 on width, −1 on length. |
| Door | 1997×606 → 1995×604, qty 1 | same | 4 × 0.8 → −2 on each axis. |
| Doors | 1997×593 → 1995×591, qty 2 | same | Same rule as the door above. |
| Partition | 1964×569 → 1964×568 | same | L1 0.8 → width −1. |
| Plinth pair | 1800×100 → 1798×100 and → 1800×100 | same (compared as a set) | Front has W1 and W2 bands → length −2; back has no bands. |
| **Top/Bottom** | 1764×582 → 1764×581, qty 2, **"Top / Bottom"** | 1764×582 → 1764×581, qty 2, **"Bottom / Top"** | 08 §3.4 step 4 says "unique English names of the row's parts **in key order**". The keys are `carcass.bottom` < `carcass.top` (fixed by 03 §3.6 and not changed by any generator ruling), so the rule gives "Bottom / Top". The example in 08 §3.4 and §10.2 ("Top / Bottom") contradicts the rule (concern 1). |
| Fixed shelf | 1164×569 → 1164×568 | same | L1 0.8. |
| Shelves | 580×549 → 580×548, qty 4, "Shelf 1 / Shelf 2 / Shelf 3 +1 more" | same | 4 unique names; first 3 + "+1 more". |
| Plinth returns | 526×100, qty 3 | same | No bands. The name (not in the brief) is "Plinth return 1 / Plinth return 2 / Plinth return 3", since 3 names fit without "+n more". |
| Edge banding | EB08-WHITE 32767 | 32767 | Raw total is 31 206 over 26 edges:<br>sides 2×(2050+632) = 5364<br>top/bottom 2×1814 = 3628<br>door 606: 2×2047 + 2×656 = 5406<br>doors 593: 2×5380 = 10760<br>plinth front 2×150 = 300<br>partition 2014<br>shelves 4×630 = 2520<br>fixed shelf 1214<br>Then ceil(31206 × 1.05) = ceil(32766.3) = 32767. |
| HDF3-WHITE | partCount 2, net 3516884, est 2, nested null, billed 2, util null | same | 2334040 + 1182844 = 3516884. ceilDiv(3516884 × 1100, 2440 × 1220 × 1000) = ceil(1.2996) = 2. |
| PB18-WHITE | partCount 18, net 11531232, est 5, nested null, billed 5, util null | same | Σ of the 18 PB parts = 11 531 232. ×1.1 / 2 976 800 = 4.261 → 5. |
| Operations | hingeCups 12, shelfPinHoles 232, dowels 16, camLocks 16, slideScrewSets 0, handleHoles 6 | same | Σ over the generated parts, × qty (all qty 1). |
| Hardware | 11 codes (HNG-FO-SC 8, HNG-HO-SC 4, HNG-PLATE-0 12, HDL-BAR-160 3, SHF-PIN-5 16, ROD-OVAL-1200 1, ROD-SUP 2, CON-CAM-15 16, CON-DOWEL-8 16, SCR-PACK 1, BRK-ANTITIP 1) | same, code asc | The 14 model lines merged by code. |
| Finishing (none) | [] | [] | |
| Finishing (FIN-LAM-MATT on front) | 7157248 | 7157248 | 2 × (1997×606 + 2×1997×593) = 2 × 3578624. |
| engineVersion / catalogVersion / nesting / issues | '1.0.0' / 1 / null / model issues | same | |
| 08 worked examples | cut-size deltas, FNV vectors, round top 3190/3350, row key format | all exact | |

## Deviations and notes for spec 19

1. **08 §3.4 row name example contradicts the rule.** "Top / Bottom" (§3.4 step 4 example and §10.2) cannot come from "names in key order", because `carcass.bottom` < `carcass.top`. I implemented the rule, so the row is named "Bottom / Top". Spec 08 should either change the example to "Bottom / Top" or state a different order. If the controller rules for "Top / Bottom", the minimal change is a name order other than key order (for example, generation order). That needs a rule that also keeps "Left side / Right side" and "Shelf 1 / Shelf 2 / …" unchanged, so it is a spec decision.
2. **Unknown catalog codes in the BOM.** 08 is silent on these. The model already reports `furniture.unknown_code` for them.
   - An edge band code the catalog does not know counts as 0 mm thick for cut sizes. It still contributes its length to `edgeBanding`.
   - A material the catalog does not know gets `sheetsEstimated = sheetsBilled = 0`. This can only happen through extra parts or part overrides.
3. **`mergeIssues` dedupe scope.** Model issues are kept exactly as they are. Only BOM issues are deduplicated, against the model issues and against each other, by `code + entityIds`. Deduplicating the model issues too would drop legitimate distinct issues, such as two `furniture.panel_seam_unsupported` issues for the same part at different positions. This is my reading of §3.9's "(deduplicated by code + entityIds)".
4. **Additional exports.** `rowKeyOfIdentity(identity)` (shared by `rowKeyFor` and the collision step), `mergeIssues`, and the types `BomMaterial`, `BomOperations`, `NestedSheet` and `NestingPlacement`. These are not in 08 §0.
5. **`edgeBandLengths(parts, catalog)` does not use `catalog`.** I kept the parameter to match the 08 §0 signature, with an eslint-disable comment, following the precedent in `plan/drawing`.

## Concerns

1. **Top/Bottom name** (deviation 1): the controller should rule on the spec contradiction. Changing it later is a one-line test edit plus the ordering rule.
2. **Split pieces.** I read "split pieces are separate parts with their own row identity" as: each piece is an ordinary part, and its identity follows §3.4. So two pieces of equal size and banding merge into one row ("Top 1 / Top 2", qty 2), and a piece of a different length gets its own row. This is tested. If the intent was that pieces never merge, the identity would need the piece or key in it, which contradicts 08 §3.4.
3. `NestingResult` only defines the types. Task 43 fills it and replaces the throw.

## Fix round 1

Review: `task-42-review.md` (spec ✅, quality NEEDS FIXES). The controller accepted my concerns ("Bottom / Top", split pieces sharing rows, the gap choices).

### Changes

- **I1:** the PB18-OAK test now uses 2700 × 1000 = 2 700 000 mm².
  - At 12 % waste: 3 024 000 000 / 2 976 800 000 = 1.016, so `sheetsEstimated` = `sheetsBilled` = 2.
  - A hard-coded 10 % would give 0.998, so 1 sheet.
- **M1:** new test "breaks a tie on material, thickness and size by rowKey, not by part key".
  - Two same-size parts that differ only in grain.
  - The part with the larger rowKey gets the smaller part key.
  - The rows must come out in rowKey order.
- **M2:** new edge banding test: an extruded part with both L2 (EB20) and W1 (EB08) uses EB20.
- **M3:** new test "lists materials by code, whatever the part order". The parts arrive as PB18, HDF3, MDF18; the result must be HDF3, MDF18, PB18.
- **M4:** new test "rounds the waste factor to whole per mille, half up". It uses wasteFactor 0.0355, which gives 35.5 → 36.
  - One sheet holds 2 976 800 000 / 1036 = 2 873 359.07 mm².
  - Area 2 873 359 gives 1 sheet; 2 873 360 gives 2.
  - A 0.035 variant would not kill the mutant, because 1000 + 35.00000000000001 is exactly 1035 as a double.
- **M5:** new `describe('computeBom: order invariance')` over all 6 furniture fixtures.
  - Finishes are set on the front and carcass roles.
  - Each fixture runs 5 seeded shuffles (`mulberry32(42)`) of `parts` and `hardware`.
  - Every result must `toEqual` the unshuffled BOM.
- **M6:** new `bom/intMath.ts` with `product(...factors)`, `toSafeNumber` and `ceilDivBig`.
  - `product` checks that each operand is a safe integer and multiplies in BigInt.
  - These are now computed with it: net area, the sheet estimate (net × (1000 + wasteMilli) / (L × W × 1000)), finishing areas, and raw edge band sums with the × 1050 / 1000 waste.
  - The final value is converted back only through the safe-integer guard.
  - The helper is local to the BOM; `money.ts` and its shared PHP fixtures are untouched.
  - New `intMath.test.ts` (3 tests): exact products beyond 2^53, rejection of non-safe-integer operands, ceil semantics and the range guard.

### Mutants re-run against the new tests

Each mutant was applied to a scratch copy and the bom tests run; all of them fail now:

| Mutant | Result |
|---|---|
| waste hard-coded to 1100 | killed |
| rowKey tie-break removed | killed |
| W-before-L band order for extruded parts | killed |
| material sort removed | killed |
| `Math.round` removed from the waste factor | killed |
| `Math.floor` instead of `Math.round` | killed |
| parts left unsorted | killed |

### Verification

- `yarn vitest run resources/js/engine/bom`: `Tests 74 passed (74)`.
- `yarn vitest run resources/js/engine`: `Test Files 107 passed (107)`, `Tests 3634 passed (3634)`.
- `yarn eslint resources/js/engine && yarn prettier --check resources/js/engine && yarn vue-tsc --noEmit`: all clean.
