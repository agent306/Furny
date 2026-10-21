# Task 42 review: `computeBom` (3e9a95a..989261a)

Reviewed in one pass from the diff package (`review-3e9a95a..989261a.diff`). No hunk was cut off. Spec: 08 §3.1–§3.8, §10.2, §10.3; 03 §3.2. Controller rulings applied as given.

### Spec Compliance

- ✅ **Spec compliant.**
  - §3.2 cut sizes: `cutSizes.ts:46-51` sums integer µm per axis and rounds with `roundHalfUpDiv(Δ, 1000)`. Bands on W1/W2 shorten the length and bands on L1/L2 shorten the width. `edgePremillMm` is `z.number().int()` (`catalog/snapshot.ts:259`), so `pmUm` is always an integer and `roundHalfUpDiv`'s safe-integer guard cannot trip. Every §3.2/§10.3 example is pinned in `cutSizes.test.ts`.
  - §3.3 edge banding: `edgeBanding.ts:33-48` adds `qty × (edge + 50)` for each banded edge. An extruded part counts as one edge with `qty × (round(P) + 50)`, and its band is the first non-null in `EDGE_IDS` order (`furniture/schema.ts:58` = L1, L2, W1, W2). The total is `ceilDiv(Σ × 1050, 1000)`, sorted by code.
  - §3.4 identity, FNV and rows:
    - `rowKey.ts:12-18` hashes with `charCodeAt` (UTF-16 code units), `Math.imul` and `>>> 0`.
    - The edge pairs are sorted with `cmpId`, which compares code units like the default `.sort()` (`compare.ts:2`).
    - Collision suffixes: `bom.ts:65-73` sorts the identities, groups them by hash and suffixes the later ones. The collision test proves this with a real collision.
    - Rows are built from key-sorted parts. `partKeys` is unique and sorted, `qty` is a sum, and the other fields come from the first part. Names are unique, in key order, with "+n more" (`bom.ts:76-83`). Order: material asc, thickness/length/width desc, then rowKey (`bom.ts:85-93`).
    - Naming follows the ruling: "Bottom / Top" (`bom.wardrobe.test.ts:63`).
  - §3.5: `wasteMilli = Math.round(wasteFactor × 1000)` and `ceilDiv(net × (1000 + w), L × W × 1000)` (`bom.ts:139-147`). Without nesting, `sheetsNested` and `utilization` are null and `sheetsBilled` = `sheetsEstimated`.
  - §3.6: area is length × width × visibleFaces × qty, summed per code, code asc, with zero rows dropped (`bom.ts:159-174`).
  - §3.7 × qty (`bom.ts:177-187`). §3.8 merges by code, then drops lines with qty ≤ 0, code asc (`bom.ts:190-199`).
  - §3.9: model issues are kept as they are; only BOM issues are deduplicated (`bom.ts:212-225`). This matches the ruling.
  - `nesting: true` throws, as the brief requires.
  - Types match 03 §3.2 (`types.ts`). All 08 §0 exports are present, plus the ruled extras.
- Rulings checked against the code: an unknown band counts as 0 µm (`cutSizes.ts:16-20`, tested). An unknown material gives 0 sheets (`bom.ts:141-148`, tested). Split pieces are ordinary parts (`bom.test.ts` "split panel"). `edgeBandLengths` keeps the unused `catalog` parameter (`edgeBanding.ts:56-57`).
- ⚠️ Cannot verify from the diff: none for this scope. The §10.2 nesting values (`sheetsNested` and `utilization`) belong to Task 43.

### Independent hand computation (non-wardrobe fixtures)

I generated the fixtures with `generateFurniture` against the seed catalog and checked every value by hand. All of them match the implementation.

- **dining-table-6seat**
  - Aprons 1600×90 and 700×90 are banded on L2, so the width drops by 1: 1600×89 and 700×89, qty 2 each.
  - The top is 1800×900 with EB10 (1.0 mm) on all 4 edges: 1798×898.
  - The legs are SW50 725×50, qty 4.
  - Net PB18 = 2·1600·90 + 2·700·90 = 414 000. With 10 % waste that is 1 sheet.
  - EB08 = 2·1650 + 2·750 = 4800, × 1.05 = 5040. EB10 = 2·1850 + 2·950 = 5600, × 1.05 = 5880.
  - Hardware sorts as CON-DOWEL-8 < CON-TBL-CORNER < SCR-PACK.
- **study-desk-cabinet** (drawer unit)
  - Bottom 579×364 is banded on W1 only, so the length drops: 578×364.
  - Drawer fronts are 397×239 with 4 bands: 395×237, qty 3, named "Drawer front 1 / Drawer front 2 / Drawer front 3".
  - The PLY12 drawer sides split into two rows, 550×190 (qty 4) and 550×180 (qty 2). The 725-long sides and end panel tie on length, so width desc decides: 600 before 582.
  - Net PB18 = 283 084 + 435 000 + 843 900 + 210 756 + 284 649 = 2 057 389.
  - EB08 raw = 414 + 3·1472 + 1550 + 1550 + 832 = 8762, × 1.05 = 9200.1, rounded up to 9201. EB10 = 3800, × 1.05 = 3990.
  - Operations: dowels 14, cams 14, slide screw sets 6, handle holes 6.
- **kitchen-base-600 / tv-unit-1800** (additional checks)
  - Kitchen base: EB08 raw 7812, × 1.05 = 8202.6, rounded up to 8203. Net PB18 = 2 216 393.
  - TV unit: EB08 raw 11 272, × 1.05 = 11 835.6, rounded up to 11 836.
  - TV top 1800×382 has W1, W2 and L1 bands: 1798×381.
  - The TV sides have different operations but share a row. This is correct, because operations are not part of the identity.

### Other checks run

- **Determinism:** I ran all 6 fixtures with finishes set on two roles. Each ran under 19 seeded shuffles of `parts` and `hardware`, and every result was `toEqual` the unshuffled BOM.
- **Mutation testing:** I used a scratch copy and ran `vitest run resources/js/engine/bom`. 37 mutants were run; 32 were killed and 5 survived.
  - Killed:
    - ceil or floor rounding instead of half-up
    - W/L axis swap
    - unsorted edge pair
    - grain dropped from the identity
    - names not deduplicated
    - reversed collision order
    - rowKey order reversed
    - extruded allowance dropped
    - hardware filtered before merging
    - parts not sorted
    - qty taken as the group length
    - premill forced to 0
    - `codePointAt`
    - faces or qty dropped from finishing
    - qty dropped from operations, net area, edges and extruded edges
    - waste set to 0 or rounded down
    - MAX_ROW_NAMES changed
    - thickness and width sorted ascending
    - premill ignored
    - BOM issues not deduplicated
    - each of the four code sorts (finishing, hardware, edge bands)
    - edges taken from the last part
    - the extruded branch removed
  - Survived: see I1, M1, M2, M3 and M4 below.
- **Test output:** bom tests 61/61 pass on the reviewed code, with no warnings or stderr.

### Strengths

- The integer arithmetic is clean throughout. µm sums, `roundHalfUpDiv` and `ceilDiv` go through the BigInt-guarded money helpers, and nothing rounds on floats in a way that matters.
- The tests check the ingredients of each identity separately: identity string, hash and key format. They use a real FNV collision instead of a mock, and they test zero padding.
- The invariant test over all 6 fixtures catches cross-cutting regressions: every part is covered once, quantities agree, and cut size ≤ finished size.
- The report shows its work. It derives each wardrobe golden, and the "Bottom / Top" contradiction was flagged instead of being silently bent.

### Issues

#### Critical (Must Fix)

None.

#### Important (Should Fix)

- **I1. The per-material waste factor is never verified.**
  - Where: `bom.test.ts:212-235` ("estimates sheets with the material waste factor"); the rule lives at `bom.ts:143`.
  - Problem: I replaced `(1000 + Math.round(material.wasteFactor * 1000))` with the constant `1100`, and all 61 tests still pass. The test that names the rule uses PB18-OAK (waste 0.12) at 1 000 000 mm². At that area, 10 % and 12 % both give 1 sheet: 0.370 and 0.376 of a sheet. The wardrobe materials are all 10 %.
  - Failure scenario: a regression that ignores `wasteFactor`, for example by hard-coding the default, would under-bill every 12 %/15 % material such as PB18-OAK or SW50-RUBBER whenever the extra waste pushes the total over a sheet boundary. `sheetsBilled` drives material cost in `priceBom`.
  - Fix: pick an area between the two boundaries. For PB18-OAK, 2 700 000 mm² (e.g. 2700 × 1000, qty 1) gives 1.12 × 2.7e6 / 2 976 800 = 1.016, so 2 sheets. At 10 % it would be 0.998, so 1 sheet. Assert 2.

#### Minor (Nice to Have)

- **M1. The rowKey tie-break in row order is untested.**
  - Where: `bom.ts:92`.
  - Problem: removing `|| cmpId(a.rowKey, b.rowKey)` survives. The wardrobe assertion `bom.wardrobe.test.ts:60` passes only because the stable sort keeps first-key order (`plinth.back` < `plinth.front`), and that order happens to agree with rowKey order.
  - Fix: add two same-size rows whose key order is the opposite of their rowKey order.
- **M2. The extruded "first non-null of L1, L2, W1, W2" precedence between L and W is untested.**
  - Where: `edgeBanding.test.ts:87-100` nulls L1 and L2, so it only separates W1 from W2.
  - Problem: a W1-first order survives (mutant at `edgeBanding.ts:35`).
  - Fix: add a case with L2 and W1 both set.
- **M3. The material code-asc sort is untested.**
  - Where: `bom.ts:133`.
  - Problem: dropping `.sort(cmpId)` survives. Wardrobe parts arrive with HDF before PB, so they are already in order.
  - Fix: add a model with materials out of order.
- **M4. `Math.round` on `wasteFactor` is untested.**
  - Where: `bom.ts:143`.
  - Problem: removing it survives, because every seed waste factor × 1000 is an exact integer. A waste factor such as 0.035 gives 35.00000000000001, and without the round `ceilDiv` would throw `RangeError`.
  - Fix: add a test with a non-exact waste factor.
- **M5. No test checks that the result is the same under part permutations.**
  - Where: `bom.wardrobe.test.ts:180-184` recomputes with the same part order only.
  - Problem: the property holds (verified above) but has no regression guard.
  - Fix: shuffle `parts` and `hardware` and compare.
- **M6. The overflow guard covers products only after float multiplication.**
  - Where: `bom.ts:143`, `edgeBanding.ts:66`.
  - Problem: §1 asks for BigInt multiplication. These products are formed in float first, and only then checked by `ceilDiv`'s `Number.isSafeInteger` guard. An overflow would throw instead of returning a wrong value. Realistic magnitudes are ≤ about 1e11, so this is a note only.

### Assessment

**Spec compliance:** ✅

**Task quality:** NEEDS FIXES

**Reasoning:** The implementation is correct against 08 §3.1–§3.8. That is confirmed by hand computation on the table, drawer-unit, kitchen-base and TV fixtures, by the shuffle-determinism check, and by 32 of 37 mutants being killed. One priced rule, the per-material waste factor, has no test that would catch its removal (I1). The fix is a one-line test change.

---

## Re-review 1 (fix round 1: 989261a..1dd7dd1)

Scope: the findings below and the fix diff (`review-989261a..1dd7dd1.diff`). The report's fix section names its covering runs: bom 74/74, engine 3634/3634, and the eslint, prettier and vue-tsc gates. I re-ran the mutants in a scratch copy under `rv42`; the baseline there is 74/74, and the copy has since been deleted.

### Finding Verdicts

- **I1: per-material waste factor never verified.** ADDRESSED.
  - `bom.test.ts:238-262` now uses PB18-OAK at 2700×1000 and expects 2 sheets. At 12 % that is 1.016 sheets; at 10 % it would be 0.998, so 1 sheet.
  - Mutant: waste hard-coded to `product(1100)` is killed (2 tests fail).
- **M1: rowKey tie-break untested.** ADDRESSED.
  - `bom.test.ts:172-191` uses two same-size parts that differ only in grain. The part keys are assigned against rowKey order.
  - Mutant: removing `|| cmpId(a.rowKey, b.rowKey)` (`bom.ts:92`) is killed.
- **M2: extruded L-before-W band precedence untested.** ADDRESSED.
  - `edgeBanding.test.ts:102-114` sets L2 = EB20 and W1 = EB08 and expects EB20.
  - Mutant: W1-first order is killed.
- **M3: material code-asc sort untested.** ADDRESSED.
  - `bom.test.ts:281-298` passes PB18, HDF3, MDF18 and expects them sorted by code.
  - Mutant: dropping `.sort(cmpId)` at `bom.ts:133` is killed (7 tests fail, including the new order-invariance tests).
- **M4: `Math.round` on wasteFactor untested.** ADDRESSED.
  - `bom.test.ts:264-279` uses waste 0.0355. In JS, 0.0355 × 1000 is exactly 35.5, which rounds to 36.
  - The boundary checks out: 2 976 800 000 / 1036 = 2 873 359.07, so area 2 873 359 gives 1 sheet and 2 873 360 gives 2.
  - Mutants: removing the round is killed, because `product(1035.5)` throws `RangeError`. Using `Math.floor` (1035) is also killed: the 1035 boundary is 2 876 135, so the test's 2 873 360 would give 1 sheet instead of 2.
- **M5: no permutation-invariance test.** ADDRESSED.
  - `bom.test.ts:490-529` covers all 6 fixtures with front and carcass finishes, 5 `mulberry32(42)` shuffles each of parts and hardware, compared with `toEqual`.
  - Mutants: leaving parts unsorted, or leaving hardware unsorted, are killed (7 and 8 tests fail).
- **M6: products formed in float before the safe-integer guard.** ADDRESSED.
  - `intMath.ts:11-37`: `product` checks that every operand is a safe integer and multiplies in BigInt; `toSafeNumber` and `ceilDivBig` guard the result.
  - These now go through it:
    - net area and the sheet estimate (`bom.ts:136-148`)
    - finishing areas (`bom.ts:166-176`)
    - raw edge sums and the × 1050 / 1000 waste (`edgeBanding.ts:39,46,62-68`)
  - Part sizes are integer mm (`furniture/schema.ts:47`, `Mm = z.number().int()`), so the stricter operand check cannot reject valid models. The fixture invariant and order-invariance tests run finishing on all 6 generated fixtures.

### New Breakage in the Fix Diff

- **Minor:** `resources/js/engine/bom/intMath.ts:22-37` re-implements the safe-integer guard (`int`, `toNumber`) and `ceilDiv` from `money.ts:15-58` as BOM-local BigInt variants. It is a small duplication of the shared money helpers. A follow-up could export BigInt-input variants from `money.ts`. The report's reason for keeping it local, so that the shared PHP fixtures stay untouched, is reasonable. Not blocking.
- No other new problems.

### Out-of-Scope Observations

None.

### Verdict

**Spec compliance:** ✅ (unchanged).

**Task quality:** APPROVED.

**Fix round:** All findings are addressed, and the fix introduced no new Critical or Important breakage.
