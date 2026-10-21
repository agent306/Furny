### Spec Compliance

- ✅ Spec compliant. Every file the brief lists is present in the diff. The seed JSON has zero transcription mismatches against 08 §7. Pricing, tax rates, role keys, density table, index behaviour and spec schemas also match.
- ⚠️ Cannot verify from diff: the "future PHP generator emits the same bytes" and "DB seeder reuses this JSON" claims (header comment of seedCatalog.ts) live in later tasks.

#### Mechanical transcription check (scratchpad `r29/cmp.py`)
The script parses the 08 §7.1–§7.5 markdown tables, expands the SLD rows per length and compares against `tests/fixtures/catalog/seed-snapshot.json`.

- **Materials (12):** sortOrder, code, id `seed-<code>`, name, boardType, thicknessMm, sheet L×W, hasGrain, decorName (`—` → null), colorHex, surface, ₹/sheet × 100, wasteFactor, densityKgM3, usage list, defaultEdgeBandCode (`—` → null), isActive, null texture URLs, exact key set. 0 mismatches.
- **Edge bands (8):** all fields, price × 100, exact key set. 0 mismatches. Array is code-asc as 08 §2.1 requires.
- **Hardware (40):** SLD-BB ×8 and SLD-UM ×4 expanded. For each row: id, name (with `{L}` substituted), category, unit, price × 100, `specs` deep-equal to the 08 §7.3 spec literal, `isDefaultFor` (SLD-BB-450 and SLD-UM-450 only), and `sortOrder` = expanded row number × 10. 0 mismatches. Row count 40.
- **Finishes (6):** all fields, appliesTo order, colour. 0 mismatches.
- **Labour (14):** key, name, unit, rate × 100. 0 mismatches.
- **Tax (4):** ids `seed-tax-gst18|gst12|gst5|none`, names, bps, isDefault. 0 mismatches.
- **Header and pricing:** version 1, INR, generatedAt `2026-10-20T00:00:00Z`. The pricing block equals the 02 §13 defaults and the brief (kerfMm 4, sheetTrimMm 10, edgePremillMm 0, `defaultTaxRateId 'seed-tax-gst18'`).
- **Array sort orders (08 §2.1):** materials by sortOrder, edge bands/finishes by code, hardware by category/sortOrder/code, labour by key, tax by rateBps desc. All hold.
- **Role keys:** parsed 07 §6.11 mechanically. All 28 keys are assigned to exactly one seed row, each row's category equals the category column of 07 §6.11, and no extra keys are assigned.
- **HARDWARE_ROLE_KEYS (specs.ts:17-46):** same 28 keys as 07 §6.11, in order.
- **DEFAULT_DENSITY (weight.ts):** equals the 07 §6.1 table.
- **Hex case:** upper-case in the JSON, same as the spec. Queued per controller ruling, not flagged.

### Strengths
- The seed JSON is byte-faithful to 08 §7 down to spec literals (`holeSpacingMm: 0`, `crankMm: 9.5`), including the SLD per-length naming and prices.
- Spec schemas (specs.ts:49-175) match the 08 §2.3 table field by field. Required fields: hinge `overlay`; slide `type/family/lengthMm`; plinth_leg `minHeightMm/maxHeightMm`; connector `kind`; sliding_track `lengthMm`. Ranges and defaults (`boringDistanceMm` 3–6 default 4, `cupDiameterMm` 35, `holeCount` 2/1, rod 1200) match. The type-dependent slide defaults are handled correctly: side_mount gets 12.7, undermount gets 42/10/13/16.
- `satisfies Record<HardwareCategory, ZodTypeAny>` makes the category table exhaustive at compile time. `HardwareSpecsOf<C>` is derived from the schemas.
- Spec errors surface at `hardware.N.specs.<field>` and a test covers this (snapshot.ts:194-205).
- `CatalogIndex` matches 07 §1.5 and §2.3:
  - Defaults and families filter active rows and sort by (sortOrder, code) or (lengthMm, code). A missing `lengthMm` becomes Infinity and falls through to the code tie-break, because `Infinity - Infinity` is NaN, which is falsy in `||`.
  - `material()` and the other code lookups include inactive rows.
  - `defaultMaterialFor` falls back to role, then carcass, then any active row. The `Map.has` memo correctly caches `undefined`.
  - `glassMaterial` and `densityOf` are correct.
  - `indexCatalog` is `WeakMap`-memoised by object identity.
- Tests cover inactive rows, fallbacks, tie-breaks, memoisation identity, and the exactly-one-owner invariant for role keys. `mutateCatalog` (mutative, auto-freeze, structural sharing) is tested.

### Issues

#### Critical (Must Fix)
None.

#### Important (Should Fix)
None.

#### Minor (Nice to Have)
1. `snapshot.test.ts` / seed JSON: the transcription is only spot-checked in tests (PB18-WHITE, EB08-WHITE, HNG-FO-SC, FIN-DUCO, installation_per_item, row order, counts). The JSON came from a throwaway uncommitted script. Prices and specs of the other ~100 rows have no regression guard, so a later hand-edit could drift silently. Consider a compact table-driven assertion of code → price for hardware and materials, or a committed golden check.
2. `catalogIndex.test.ts:270-273`: `it('typechecks role keys')` asserts only `HARDWARE_ROLE_KEYS` contains a literal that the type system already guarantees. It adds nothing at runtime. Drop it or fold it into a `// @ts-expect-error` check.
3. `catalogIndex.test.ts:8-18`: re-declares the 9 `MATERIAL_ROLES` locally instead of importing `MATERIAL_ROLES` from `catalog/snapshot`. The two lists can drift, and no test pins `MATERIAL_ROLES` to 07's 9 roles.
4. `snapshot.ts:252`: `sheetTrimMm` is `z.number().nonnegative()`. 02 §13 types it as int, and 08 §2.2 says lengths are integers. Use `Minor`. `kerfMm` being a decimal is correct.
5. `snapshot.ts:149-150`, `specs.ts:14`, `specs.ts:66`: `Minor`/`Int` accept 0, so sheet dimensions and slide `lengthMm` of 0 parse. This is harmless now, but a later nesting or family sort could consume them. Consider `.positive()` where 0 is meaningless.
6. `snapshot.ts:197-201`: spec issues are re-emitted as `code: 'custom'`, which drops the original zod issue code (`invalid_type`, `too_small`). Paths and messages are right, so this only matters for consumers that branch on `code`.
7. `seedCatalog.ts:21-23`: the `pricing` patch is spread after parsing, so it bypasses `PricingSettingsSchema`. A bad patch (e.g. `edgePremillMm: 9`) is accepted silently. Re-parse the patched object, or `PricingSettingsSchema.parse`.
8. `seedCatalog.ts:20`: the whole 40-hardware JSON is re-parsed on every call. This is fine for correctness. Cache a frozen parsed copy and `structuredClone` it if test time grows.
9. `snapshot.ts:268`: `generatedAt` is an unvalidated `z.string()`. `z.iso.datetime()` would match the "ISO-8601 UTC" comment in 08 §2.1.
10. `catalogIndex.ts:131-141`: memoisation is by object identity and the index is built lazily/partially mutable (`materialDefaults`). A snapshot mutated after indexing goes stale. This is documented in the JSDoc, and `mutateCatalog` results are frozen. `seedCatalog()` results are not frozen, so test authors could trip on this.

### Assessment

**Task quality:** Approved

**Reasoning:** The seed catalog matches 08 §7 cell for cell (0 mismatches in a mechanical comparison). The spec schemas, `CatalogIndex` semantics, WeakMap memoisation, role keys and density table all match their spec sections. Only minor test-coverage and strictness polish remains.
