### Task 4: Units — parseLength, formatLength, formatArea, formatAngle

**Files:**
- Create: `resources/js/engine/units/types.ts`, `resources/js/engine/units/parse.ts`, `resources/js/engine/units/format.ts`
- Test: `resources/js/engine/units/__tests__/parse.test.ts`, `resources/js/engine/units/__tests__/format.test.ts`

**Spec refs:** `04 §1` (all), `master §6.1`

**Interfaces:**
- Consumes: `roundMm`, `MAX_COORD` (Task 1).
- Produces: types `UnitSystem, LengthUnit, UnitPrefs, ParseLengthContext, ParseLengthErrorCode, ParseLengthError, ParseLengthResult`; `PARSE_LENGTH_ERROR_CODES` (the 8 codes); `parseLength(input: string, ctx: ParseLengthContext): ParseLengthResult`; `normalizeLengthInput(input: string)` (exported for tests, not from index); `formatLength(mm, prefs, opts?: FormatLengthOptions): string`; `formatArea(mm2, prefs)`; `formatAngle(deg, locale)`; `MM_PER_INCH = 25.4`, `MM_PER_FOOT = 304.8`, `MM2_PER_FT2 = 92_903.04`; `coerceUnitPrefs(prefs): UnitPrefs` (metric+ftin/in → mm, imperial+mm/cm/m → ftin).

- [ ] **Step 1: Write the failing tests** — every row of 04 §1.5 as an `it.each` table (copy verbatim), e.g.:
  ```ts
  ['10\'6"', 'mm', 3200], ['10′6″','mm',3200], ['10’6”','mm',3200], ['10\'-6"','mm',3200], ['10 ft 6 in','mm',3200], ['10ft6','mm',3200],
  ['10\' 6 1/2"','mm',3213], ['10\' 14"','mm',3404], ['5\'11.5"','mm',1816], ['1,234.5mm','mm',1235 /* rounded:true */],
  ['6 1/2','in',165], ['6 1/2','mm','syntax'], ['10','ftin',254], ['3200 kg','mm','unknown_unit' /* params.unit 'kg' */],
  ['1/0"','mm','division_by_zero'], ['3 200','mm','syntax'], ['2000000','mm','too_large' /* max 1000000 */], ['1,2,3','mm','syntax']
  ```
  plus `-50` with `allowNegative` → −50, without → `negative`; `0` with `allowZero:false` → `zero`; `50` with `min 300` → `too_small` (params.min 300); `''`/`'   '` → `empty`; every error has `messageKey === 'engine.units.error.' + code`. Format table rows of 04 §1.5 (`3205 cm → '320.5 cm'`, `3200 mm summary → '3.20 m'`, `3213 ftin → "10' 6 1/2\""`, `10 ftin → '3/8"'`, `-152 ftin → '-6"'`, `304 ftin → "1' 0\""`, …); `formatArea(12_350_000, metric) === '12.35 m²'`, imperial `'133 ft²'`, `0 → '0.00 m²'`, `116_128_800` imperial → `'1,250 ft²'`; `formatAngle(22.5,'en') === '22.5°'`. Property tests: fuzz 10 000 strings from alphabet `0-9 .,'"/-a-z′″` (seeded `mulberry32(7)`) never throw; round-trip 2000 random ints in [0, 50 000] for mm/cm/m exact, imperial `|Δ| ≤ 2`.
- [ ] **Step 2: Run it, expect FAIL** — `yarn vitest run resources/js/engine/units`
- [ ] **Step 3: Implement** — normalisation steps 1–6 and patterns P1–P6 exactly as 04 §1.2 (build the regexes from the `NUM/INCHVAL/MUNIT/FUNIT/IUNIT` fragments); imperial formatting with integer eighths (04 §1.3); `Intl.NumberFormat` cache keyed `locale|min|max|grouping`.
- [ ] **Step 4: Run tests, expect PASS** — same command.
- [ ] **Step 5: Quality gates** — `yarn eslint resources/js/engine && yarn prettier --check resources/js/engine && yarn vue-tsc --noEmit`
- [ ] **Step 6: Commit** — `git add resources/js/engine/units resources/js/engine/index.ts` → `feat(engine): add unit-aware length parsing and formatting`

