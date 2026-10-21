# Task 46 report: Cut list CSV

## Implemented
`resources/js/engine/bom/exportCsv.ts`: `CUT_LIST_CSV_COLUMNS` (19 names), `csvField`, `cutListCsv(bom, catalog, doc)`; re-exported from `engine/index.ts`. BOM + CRLF (trailing CRLF), RFC 4180 quoting, `.` decimals, `area_m2` computed on integers (half up, 3 decimals), notes = per row key (sorted order): `overrides.parts[key].note` then extra-part (`extra.{id}`) note, joined ` | `.

## Files
- `resources/js/engine/bom/exportCsv.ts` (new)
- `resources/js/engine/bom/__tests__/exportCsv.test.ts` (new, 8 tests)
- `resources/js/engine/index.ts` (export line)
- this report

## TDD
- RED: `yarn vitest run .../exportCsv.test.ts` -> `Error: Cannot find module '../exportCsv'`, 1 file failed, no tests.
- GREEN: 1 file passed, 8 tests passed (wardrobe header, 12 rows, row 1 and row 3 byte-exact, BOM/CRLF, quoting of `Filler, "left"` and newline names, notes joining).

## Gates
- `yarn eslint resources/js/engine`: clean. `yarn prettier --check resources/js/engine`: clean. `yarn vue-tsc --noEmit`: clean.
- `yarn lint`, `yarn typecheck`: clean.
- Full `yarn vitest run`: 5099 tests, 5096 pass, 3 fail = exactly the known host baseline (validate.test.ts furniture code literal; format.test.ts de-CH x2). One "unhandled error" from AppShell.test.ts (`document is not defined` in useRouteFocus timer after teardown) appeared in the first full run; not in engine code, not caused by this task, did not recur on the second run.

## Deviations / decisions
- Formula-injection escaping: spec 08 §8.1 does not require it, so none is applied (would change the byte-exact output). Concern: a user-supplied extra-part name or note starting with `=`, `+`, `-`, `@` is written raw; owner may want a spec amendment.
- `edge_band_mm` uses row `length`/`width` per banded edge. Extruded (non-rectangular) parts are not special-cased (the row has no outline); their edges are not reported per edge anyway.
- Material name falls back to empty if the code is missing from the catalog.
