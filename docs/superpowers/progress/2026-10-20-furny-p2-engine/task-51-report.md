# Task 51 report: translation keys, coverage gate, public API check

Status: DONE_WITH_CONCERNS (concerns are design notes below, no failing gate).

Branch `build/p2-engine`. Commits (oldest first):

| Commit | Subject |
|---|---|
| `7987aa7` | feat(engine): add engine translation keys and public API check |
| `66ac662` | test(engine): add the engine coverage gate |
| `894eda3` | refactor(engine): keep one set of safe-integer helpers in money.ts |
| `83ef559` | fix(engine): guard the thousands separator and map the acute accent before NFKC |
| (this report) | docs(sdd): P2 Task 51 report |

## What was implemented

1. Six ICU lang files in `resources/lang/en/`: `engine.php`, `parts.php`, `hardware.php`, `changes.php`, `templates.php`, `sections.php`. No `issues.php` (see deviations). `php artisan i18n:export` output (`en.json`, `manifest.json`) is committed.
   - `engine.php`: `engine.units.error.*` (8), `engine.plan.command.*` (22 codes) and `.label.*` (43), `engine.plan.derive.*` (6), `engine.plan.snap.kind.*` (12) plus `opening_no_fit|opening_overlap`, `engine.plan.conflict.*` (4), `engine.furniture.command.*` (6) and `.label.*` (28), `engine.furniture.issue.*` (all 73 codes, incl. `panel_split`, `panel_seam_unsupported`, `table_drawers_dont_fit`, `apron_inset_clamped`, `part_exceeds_sheet_back`), `engine.bom.issue.part_exceeds_sheet`.
   - `parts.php` (38 part names), `hardware.php` (`reason.*`, 23 keys), `changes.php` (24 keys of 07 §10.2), `templates.php` (19 names + descriptions, 31 field labels, 1 help, 41 options, `range`), `sections.php` (`interior|column|row`).
2. `resources/js/engine/__tests__/messageKeys.test.ts` (14 tests) and `publicApi.test.ts` (3 tests).
3. `HARDWARE_REASON_KEYS` (23 full keys) exported from `furniture/rules/hardware.ts`; `PlanFragment` type added to `engine/index.ts` (it was in the plan's Produces and missing from the index).
4. Coverage gate in `vitest.config.ts` plus `test:coverage:engine` in `package.json`.
5. Dedupe of `bom/intMath.ts` into `money.ts` (carry 8); units parser fixes (carry 9).

## Files changed

- Created: `resources/lang/en/{engine,parts,hardware,changes,templates,sections}.php`, `resources/js/engine/__tests__/{messageKeys,publicApi}.test.ts`.
- Modified: `resources/js/lang/generated/{en,manifest}.json`, `vitest.config.ts`, `package.json` (script only), `resources/js/engine/index.ts`, `furniture/rules/hardware.ts`, `furniture/partNames.ts` (+ its test), `money.ts`, `bom/{bom,edgeBanding,pricing}.ts`, `units/parse.ts` (+ test), `__tests__/money.test.ts`, `plan/__tests__/schema.test.ts` (one key literal), plan text `docs/superpowers/plans/2026-10-20-furny-p2-engine.md` and `progress/.../global-constraints.md` (carry 3 wording).
- Deleted: `bom/intMath.ts`, `bom/__tests__/intMath.test.ts` (tests moved to `money.test.ts`).

## TDD evidence

RED, lang tests (stub `return [];` files, so the lists fail, not the loader): `13 failed | 1 passed` in `messageKeys.test.ts`, e.g.
`expected [ 'engine.units.error.empty', …(7) ] to deeply equal []`, `expected [ …(89) ] to deeply equal []` (plan keys), `expected [ …(74) ] to deeply equal []` (issues), `parts.side_left {}: expected 'undefined' to be 'Left side'`. `vue-tsc` additionally failed with `Module '"../furniture/rules/hardware"' has no exported member 'HARDWARE_REASON_KEYS'` and `Module '"../index"' has no exported member 'PlanFragment'`.
GREEN after the lang files and exports: 14/14 and 3/3.

RED, part-name wording: `partNames.test.ts` expected `'Fixed shelf 2 – piece 3'`, received `'Fixed shelf 2 3'`.
RED, money: `TypeError: (0 , product) is not a function` (3 tests).
RED, units: 5 failures, e.g. `'10´6″'` normalised to `'10 ́6"'`; `'1,2345'` to `'12345'`; `parseLength('1,2345', m)` returned an error instead of 1235 mm.

## Coverage (`yarn test:coverage:engine`, exit 0, 118 files / 3776 tests passed)

| Glob | Files | Lines | Branches | Threshold |
|---|---|---|---|---|
| `resources/js/engine/**` | 162 | 99.62 % | 94.84 % | 90 / 85 |
| `engine/{units,geometry,plan}/**` | 63 | 99.67 % | 96.24 % | lines 90 |
| units | 3 | 100.00 | 97.90 | |
| geometry | 9 | 99.66 | 97.41 | |
| plan | 51 | 99.67 | 96.05 | |
| furniture | 78 | 99.63 | 93.10 | |
| bom | 11 | 98.73 | 91.61 | |
| commands | 2 | 99.27 | 96.98 | |
| catalog | 2 | 100.00 | 100.00 | |

Thresholds are enforced: a temporary run with 99.9 % failed with `Coverage for lines (99.62%) does not meet "resources/js/engine/**" threshold (99.9%)` and the same for the units/geometry/plan glob (config restored, not committed). Per-directory rows come from `coverage-summary.json` aggregation; only the two globs are gated. The text table also lists non-engine files (P1's include list) at 0 %; no thresholds are set on them (carry 2). Excludes: `**/testing/**`, `**/__tests__/**`, `**/__perf__/**`, `**/*.bench.ts`, `**/*.d.ts`, wayfinder output (`actions`, `routes`, `wayfinder`), `lang/generated`, `components/ui/**`.

## Gate results (after the last commit)

- `yarn test:coverage:engine`: pass (above).
- Full `yarn vitest run`: 211 files, 5241 tests, 0 failures.
- `yarn lint`: exit 0. `yarn typecheck`: clean. `yarn format:check`: clean.
- `vendor/bin/pint --test`: passed. `vendor/bin/pest tests/Feature/I18n`: 7 passed.
- Gates-Gen: `php artisan typescript:transform && php artisan i18n:export && git diff --exit-code -- resources/js/types/generated.d.ts resources/js/lang/generated` exit 0, tree clean.

## Carries

1. No dependency added; only the `test:coverage:engine` script (`vitest run resources/js/engine --coverage`).
2. Per-glob v8 thresholds as specified; excludes as listed incl. generated code and kit `ui/**`; no editor/lib/composables thresholds.
3. Plan issues: test asserts `messageKey === 'plan_editor.issues.' + rule` for a broken doc and that no `engine.plan.issue.*` or `plan_editor.*` text exists in the P2 lang files. Plan text, `global-constraints.md` and one test literal (`schema.test.ts`) corrected. The copy in `D:/Dev/Furny.worktrees/_ctl/p2-engine-constraints.md` is outside this worktree and still says `engine.plan.issue.*`; the controller should update it.
4. `sections.php` created with `interior|column|row`; depth-5 `engine.plan.command.label.*` kept.
5. Furniture/BOM issue keys tested as `engine.furniture.issue.<code minus 'furniture.'>` / `engine.bom.issue.<code minus 'bom.'>`.
6. ICU strings; `hinges_for_door` uses `{leaves}` with plural; the four named issues are present with their real params; piece wording `Fixed shelf 2 – piece 3` (en dash) in `parts.php` and mirrored in `PART_NAMES_EN` (`Table top layer 1 – piece 2` as well; unsplit parts read `Fixed shelf 2`).
7. Exempt strings (`CHANGE_FIELD_LABELS_EN`, diff front-kind/role names, `CutListRow.name`, price line descriptions, CSV) are not checked.
8. `product`, `ceilDivBig`, `toSafeNumber` now live in `money.ts` (reusing its `int`/`toNumber`); `ceilDiv` delegates to `ceilDivBig` with unchanged error order (pinned by a test); bom modules import from `../money`; intMath deleted; same error messages.
9. Thousands regex has `(?!\d)`; `´` is mapped before NFKC; both pinned in `parse.test.ts` (normalize and parse level).
10. The lang test uses `execFileSync('php', ['-r', …])` with an absolute lang dir (no POSIX paths).
11. `php artisan i18n:export` run, generated JSON committed, Gates-Gen shows no diff.

## Deviations

- No `issues.php` (brief listed it): carry 5 moves furniture/BOM issue texts into `engine.php`, and nothing else would use `issues.*`.
- Engine test timeout raised to 20 s (`vitest.config.ts`, engine project). Under `--coverage` and full parallel load `createPlanBus > … replace-merge base cache` exceeded the 5 s default (1.1 s plain, 2.8 s with coverage alone). Thresholds untouched.
- `publicApi.test.ts` lists the names currently exported by the index (370 runtime names, verified against the plan's Produces blocks). Names in Produces that are internal module helpers (e.g. `computeEnvelope`, `fitsSheet`, `normalizeLengthInput`, `ID_ALPHABET`) are deliberately not listed; only `PlanFragment` was a real gap and was added. Types are checked at compile time through a type-only import. The test also asserts no export of a `testing/` module is re-exported through the index.
- `messageKeys.test.ts` goes beyond the brief with an ICU parse check of every message (intl-messageformat, as the client uses), a parity check of `parts.*` against `partNameEn`, and a scan of key literals in the engine sources.
- Issue texts use the param names the engine really emits where they differ from 07 §7.3 (e.g. `part_exceeds_sheet` uses `{partKey}`/`{materialCode}`; `drawer_no_slide` omits the optional `availableDepth`).

## Concerns

1. ICU cannot test for an absent argument, and P1's `t()` renders an absent argument as an empty string. So optional part-name params (`n`, `leaf`, `piece`) are plain `{n}` placeholders (a trailing space at worst), and the "– piece" suffix lists piece numbers 1 to 9 in an ICU `select` and shows nothing beyond 9 (documented in `parts.php`). A panel split into 10 or more pieces renders without the suffix in the UI (the TS mirror still shows it). Real panels split into 2 to 4 pieces.
2. `changes.construction_changed` is `{field}: {before}{beforeMm} → {after}{afterMm}`: the diff emits either the string pair or the Mm pair, and the absent pair renders empty. Lengths come out as bare numbers without a unit.
3. `changes.price_changed` shows `deltaMinor` raw (as the spec text does); the UI should pass a formatted value or format it itself.
4. `package.json` has CRLF line endings in the working copy (git normalises to LF on commit; `prettier --check package.json` warns, but `format:check` only covers `resources/` and `engine-cli/`). Not changed.
5. The messageKeys test needs `php` on PATH for the frontend CI job (plan gap 14).
6. In one standalone run, `lib/__tests__ … lucide imports` timed out at 5 s when run together with the units tests; it passed in the full run. It is outside P2 and unchanged.
