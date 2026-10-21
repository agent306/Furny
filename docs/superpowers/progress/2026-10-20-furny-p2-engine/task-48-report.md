# Task 48 report: Engine CLI

Status: DONE (one known, unrelated intermittent vitest error, see Gates).

## Implemented
- `engine-cli/src/commands.ts`: `CLI_COMMANDS`, `CLI_ERROR_CODES`, `CliResponse`, `dispatch(command, rawInput, options?)` and the eight command handlers. Consumes the engine only through `../../resources/js/engine/index` (relative, no alias).
- `engine-cli/src/requests.ts`: zod request schemas per command (`document` stays `unknown` then `migratePlan` / `migrateFurniture`; `catalog` via `CatalogSnapshotSchema`; `BomInputSchema` = the cut-list rows `cutListCsv` reads; `TemplateKeySchema`; `price.quantity` positive int).
- `engine-cli/src/cli.ts`: now only re-exports `dispatch` / `CliResponse` from `commands.ts` plus `readAll` / `main` (P1 code kept). `main()` is still started only by `engine-cli/src/main.ts` (the Vite entry), so importing `cli.ts` never reads stdin.
- Error mapping: `ZodError` -> `invalid_input` with `details.issues`; `EngineInputError` -> `invalid_input` with `details = { ...engineDetails, code }` (so `details.code === 'unsupported_schema_version'`); other throws -> `engine_error` (message only, no stack); unknown command -> `unknown_command`; bad JSON -> `invalid_json`. Exit code is never set non-zero.
- Results as briefed: `validate-plan` = `{ valid, issues, migratedDocument (orphans removed), summary }`; `validate-furniture` = `{ valid: !isSaveBlocking, issues, migratedDocument, bbox }`; `compute-bom` = `{ bom, price, engineVersion }` (price default `{ quantity: 1, includeInstallation: true }`, `allowRotation` passed through, `finishByRole` via `bomOptionsFor`); `cutlist-csv`, `template-default`, `diff-furniture`, `plan-summary`, `version`.
- `dispatch` takes an optional third argument `{ newId }` (test hook, used only for `template-default`) so the committed template fixtures have deterministic ids. The real CLI passes none (nanoid ids).
- `.gitattributes`: `tests/fixtures/engine-cli/*.csv -text`. The repo default `* text=auto eol=lf` would otherwise rewrite the CRLF cut-list CSV on commit.

## Files
Created: `engine-cli/src/commands.ts`, `engine-cli/src/requests.ts`, `engine-cli/src/__tests__/{commands.test.ts,fixtures.test.ts,cli.e2e.test.ts,fixtureSources.ts}`, `tests/fixtures/engine-cli/*` (below).
Modified: `engine-cli/src/cli.ts`, `.gitattributes`.
Already present from P1, verified, untouched: `engine-cli/vite.config.ts` (entry `src/main.ts`, `ssr.noExternal: true`, target node22, `cli.mjs`), `package.json` scripts, `.gitignore` (`/engine-cli/dist`), `tsconfig.json` include, P1 `cli.test.ts` and `build.test.ts` (both still green).

## Generated fixtures (`tests/fixtures/engine-cli/`, 33 files, about 1.5 MB)
Each `.json` is `{ command, request, response }` (the `command` key is added so `invalid-input.json` and the others are self-describing for P5). Regenerate with `UPDATE_FIXTURES=1 yarn vitest run engine-cli/src/__tests__/fixtures.test.ts`; without the variable the test fails if a committed file differs from the CLI answer.
- `validate-plan.{hdb-3room,brochure-2bhk}.json`, `plan-summary.{hdb-3room,brochure-2bhk}.json`
- `validate-furniture.wardrobe-3door.json`
- `compute-bom.{wardrobe-3door,tv-unit-1800,bookshelf-5shelf,kitchen-base-600,study-desk-cabinet,dining-table-6seat}.json` (request `options: { nesting: true }`; wardrobe: unitPriceMinor 2431300, 7 sheets)
- `cutlist-csv.wardrobe-3door.csv` (raw CSV: UTF-8 BOM, CRLF, 12 data rows)
- `template-default.<key>.json` for every key in `TEMPLATE_KEYS` (`overrides: {}`, deterministic ids)
- `diff-furniture.wardrobe-width-2100.json` (changes begin `price_changed`, `dims_changed`)
- `invalid-input.json` (`compute-bom` with `catalog: {}` -> `invalid_input`)

P5 note: these are the files the PHP contract tests consume. Requests embed the full seed catalog (about 41 KB each), so a contract test can pipe `request` straight to the CLI and compare to `response`; `cutlist-csv` has no request file (build it from the `compute-bom.wardrobe-3door.json` `bom` + catalog + document).

## TDD evidence
RED (tests written first, `yarn vitest run engine-cli/src/__tests__/commands.test.ts engine-cli/src/__tests__/fixtures.test.ts`):

    FAIL engine engine-cli/src/__tests__/fixtures.test.ts
    Error: Cannot find module '../commands' imported from '.../fixtures.test.ts'
    FAIL engine engine-cli/src/__tests__/commands.test.ts
    Caused by: Error: Failed to load url ../commands ... Does the file exist?
    Test Files  2 failed (2)   Tests  no tests

GREEN after implementing (with `UPDATE_FIXTURES=1` once to write the fixtures): 3 files, 60 tests passed; then `yarn vitest run engine-cli`: Test Files 5 passed (5), Tests 72 passed (72) (commands 23, fixtures 34, e2e 10, P1 cli 3 + build 2).

## Gates
- `yarn eslint engine-cli resources/js/engine && yarn prettier --check engine-cli && yarn vue-tsc --noEmit`: pass.
- `yarn build:engine-cli`: pass (`cli.mjs` 992 kB); `echo '{}' | node engine-cli/dist/cli.mjs version` prints `{"ok":true,"result":{"engineVersion":"1.0.0"}}`, exit 0.
- `yarn vitest run` (full): 206 files, 5184 tests, all passed. Vitest also printed the known intermittent `ReferenceError: document is not defined` from `useRouteFocus.ts:89` (1 to 2 unhandled errors; P1 is fixing it). Nothing else.
- `yarn lint`: pass. `yarn typecheck`: pass. `yarn format:check`: pass.

## Carries
1. C2: P1 files verified; `dispatch` / `CliResponse` exported from `cli.ts` (re-export of `commands.ts`); entry guard stays in `main.ts`; P1 `cli.test.ts` / `build.test.ts` green.
2. C10: fixtures at `tests/fixtures/engine-cli/` as `{command, request, response}`, regenerated with `UPDATE_FIXTURES=1`; all files listed in 16 §5.2 generated; no `__snapshots__`.
3. I15: compute-bom test and fixtures carry `options: { nesting: true }`.
4. E4: e2e `beforeAll` runs `yarn build:engine-cli` once (120 s timeout) and spawns `node engine-cli/dist/cli.mjs`.
5. Protocol: stdin JSON, stdout one envelope line, exit 0; e2e asserts exit 0, empty stderr and a single-line stdout for version, invalid JSON, unknown command, empty stdin, wrong-typed input (4 commands x 3 inputs), and a 2.5 MB plan (`ok: true`, `valid: false`, `plan.too_large`).
6. Windows: e2e uses `process.execPath` and `path.resolve`, no POSIX paths.

## Deviations / decisions
- `command` key added to every fixture envelope (spec lists only `{request, response}`).
- `dispatch` has an optional third parameter `{ newId }` for deterministic template ids in fixtures (not in the brief's signature; the two-argument call still works).
- The brief put snapshots in `__snapshots__` with `toMatchFileSnapshot`; carry C10 overrides this, so the plan fixtures are written by `fixtures.test.ts` instead.
- `validate-furniture` fixture only for the wardrobe (as 16 §5.2 lists); the other five furniture documents are covered by the `compute-bom` fixtures.
- The `.gitattributes` edit (outside the brief's file list) is required to keep the CRLF CSV intact.
- The oversize-plan unit test uses 50,000 orphan nodes (cheap to validate) rather than 2,001 walls (2 s of derive, timed out under full-suite load).

## Concerns
- Fixtures total about 1.5 MB because each request embeds the 41 KB seed catalog; P5 could drop `catalog` from the files and inject it from `seed-snapshot.json` if that is unwanted.
- A failing zod parse of a very large invalid catalog could produce a large `details.issues` array; not capped.
