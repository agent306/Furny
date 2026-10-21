# Task 4 report: units (parseLength / formatLength / formatArea / formatAngle)

Status: DONE_WITH_CONCERNS (spec quirks only, no blockers). Commit a63f797 `feat(engine): add unit-aware length parsing and formatting`.

## Implemented
- `resources/js/engine/units/types.ts`: all types, `PARSE_LENGTH_ERROR_CODES` (8), `FormatLengthOptions`, `MM_PER_INCH/MM_PER_FOOT/MM2_PER_FT2`, `coerceUnitPrefs` (returns a copy, never mutates).
- `units/parse.ts`: `normalizeLengthInput` (returns `{ok,text,negative}` or error; exported for tests only), `parseLength`. Steps 1-6 and P1-P6 built from NUM/INCHVAL/MUNIT/FUNIT/IUNIT fragments with named groups; step 3/4 per 04 §1.2.
- `units/format.ts`: `formatLength` (editor/summary, showUnit, signed, ASCII minus, imperial integer eighths), `formatArea`, `formatAngle`, Intl.NumberFormat cache keyed `locale|min|max|grouping`.
- `engine/index.ts`: exports all public names (normalizeLengthInput not exported).

## Rulings applied
- C16: round trip is 10 000 seeded samples in [0, 100 000] (plus edge values 0, 1, 999, 1000, 1001, 100 000), seed `mulberry32(42)`, for mm/cm/m exact and ftin/in |delta| <= 2. Fuzz also uses `mulberry32(42)` (10 000 strings, 3 contexts).
- Progress ruling on -0: `parseLength` returns +0 (`roundMm(v) + 0`); tested with Object.is.
- Engine purity: no forbidden tokens, no imports beyond `geometry/tolerance`.

## Tests (TDD)
- RED: `yarn vitest run --project engine resources/js/engine/units` before implementation: 2 files failed, "Failed to load url ../format ... Does the file exist?".
- GREEN: same command after: 2 files, 239 tests passing (parse 121, format 117 + extra rows); whole engine project: 10 files, 368 tests passing, output pristine.
- Every row of 04 §1.5 (all parseLength rows, 15 formatLength rows, 4 formatArea rows, round-trip property) is an `it.each` case. Extra: wider grammar, all 8 error codes with params, huge digit runs (Infinity/NaN guard), non-string input, normalizeLengthInput table, locale (de/sv ASCII minus), signed/showUnit/summary, coercion, -0.
- Coverage (units only): lines 99.3 %, branches 97.2 %.
- Gates: `yarn eslint resources/js/engine`, `yarn prettier --check resources/js/engine`, `yarn vue-tsc --noEmit` all clean.

## Files
Created: units/types.ts, units/parse.ts, units/format.ts, units/__tests__/parse.test.ts, units/__tests__/format.test.ts. Modified: engine/index.ts.

## Concerns / spec observations (implemented literally, flagged for controller)
1. Spec 04 §1.2 applies NFKC before char mapping, and NFKC rewrites `´` (U+00B4) to space + U+0301, so the `´` entry in the quote mapping is unreachable (`10´6"` -> syntax). Harmless; not changed.
2. Thousands rule `^\d{1,3}(,\d{3})+(\.\d+)?` is prefix-only, as written: `1,2345` parses as 12345 (the "5" is left after the strip). Adding a `(?!\d)` guard would be safer; left verbatim as the spec is the authority.
3. A locale with a comma decimal (e.g. `de`) formats 3205 mm in m as `3,205 m`, which parseLength reads as thousands (3205 m). Format/parse are not round-trip safe for such locales; v1 is `en` only.
4. Key `engine.units.error.*` texts in `resources/lang/en/engine.php` (04 §1.6 third criterion) are not created here; plan Task 51 owns them.
5. Metric `formatArea` uses no grouping (spec only specifies grouping for ft²); `summary` length uses grouping (spec).
6. Metric formatting rounds to whole mm before handing to Intl (avoids decimal-tie ambiguity); imperial uses the spec's `Math.round(abs/25.4*8)` verbatim.
