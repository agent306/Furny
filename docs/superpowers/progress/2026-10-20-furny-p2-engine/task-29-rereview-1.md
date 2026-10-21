### Finding Verdicts

- **Hex colours lower-cased in seed and schema (controller ruling)** — ADDRESSED. All 21 `colorHex` values in `seed-snapshot.json` are lower-case. `ColorHex` in `snapshot.ts` now has `.transform(h => h.toLowerCase())` before `.nullable()`. Tests cover upper-case input being normalised, `red` being rejected, and a raw-JSON scan for lower-case. The non-colorHex part of the JSON diff is empty. Re-running `cmp.py` against the new JSON gives 21 diffs, all case-only hex differences against the spec's upper-case hex; there are no other mismatches.
- **Minor 1: seed transcription only spot-checked** — ADDRESSED. `snapshot.test.ts` adds a `toMatchFileSnapshot` guard to `__snapshots__/seed-rows.txt` (100 lines). It pins the header, pricing and every row of all six tables as one JSON line each. The pinned file contains the lower-cased hex. The report states it was verified to fail on a single price change.
- **Minor 2: trivial `typechecks role keys` test** — ADDRESSED. The test is removed (`catalogIndex.test.ts` diff), and the now-unused `HardwareRoleKey` import is gone.
- **Minor 3: local `MATERIAL_ROLES` duplicate** — ADDRESSED. `catalogIndex.test.ts` imports `MATERIAL_ROLES` from `../../catalog/snapshot`, and a new `MATERIAL_ROLES` describe pins it to the 9 roles of 03 §2.
- **Minor 4: `sheetTrimMm` allowed decimals** — ADDRESSED. `snapshot.ts` `PricingSettingsSchema` now uses `sheetTrimMm: Minor` (int, non-negative), with a test rejecting 2.5.
- **Minor 5: zero-valued dimensions and lengths accepted** — ADDRESSED. `sheetLengthMm` and `sheetWidthMm` are `PositiveInt`, the drawer-slide and sliding-track `lengthMm` are `Int.min(1)` (`specs.ts`), and tests cover 0 being rejected.
- **Minor 6: spec errors re-emitted as `custom`** — accepted as is. Not re-verdicted.
- **Minor 7: `seedCatalog` pricing patch skipped validation** — ADDRESSED. `seedCatalog.ts` runs the merged pricing through `PricingSettingsSchema.parse`. Tests show `edgePremillMm: 9` and `sheetTrimMm: 1.5` throw.
- **Minor 8: JSON re-parsed on every `seedCatalog()` call** — ADDRESSED. It is parsed once into a module-level `base` (`base ??=`). A patched call re-validates only the pricing and shares the rest.
- **Minor 9: `generatedAt` unvalidated** — ADDRESSED. `snapshot.ts` now uses `z.iso.datetime()`, with a test rejecting `'yesterday'`. See New Breakage item 1 for a caveat.
- **Minor 10: stale index when a seed snapshot is mutated after indexing** — ADDRESSED. `seedCatalog()` now returns a deep-frozen shared snapshot, and tests assert `isFrozen` on the snapshot, materials, specs and pricing. The "different indexes" memo test now uses a `mutateCatalog` result, and a new test covers indexing the shared seed once.

### New Breakage in the Fix Diff

1. Minor, `snapshot.ts` `generatedAt: z.iso.datetime()`: the zod default accepts only a `Z` suffix and rejects numeric offsets such as `+00:00`. 08 §2.1 says "ISO-8601 UTC", but a PHP builder that emits `Carbon::toIso8601String()` would produce `+00:00` and fail the parse. Either note this in the server builder task, or relax to `z.iso.datetime({ offset: true })`.
2. Minor, `seedCatalog.ts`: `seedCatalog()` now returns a deep-frozen shared object. Any test or later task that mutates the result directly will throw in strict mode. Callers must use `mutateCatalog`. This is documented in the JSDoc, and the report's full engine run passes (2177 tests).

Nothing Critical or Important.

### Out-of-Scope Observations

None.

### Verdict

**Fix round:** All findings addressed, no new Critical/Important breakage. The two Minor notes above are non-blocking.
