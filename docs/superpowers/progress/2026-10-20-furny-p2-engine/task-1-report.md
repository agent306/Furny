# Task 1 report: engine scaffold, ids, version, purity guards

Status: DONE. Commit b1b2856 `feat(engine): scaffold engine module with ids, version and purity guards` (branch build/p2-engine, not pushed).

## Rulings applied
- C1: no root include/exclude change in vitest.config.ts. The `engine` project globs (`resources/js/engine/**/*.test.ts`, `engine-cli/src/**/*.test.ts`, `__perf__` excluded) already cover everything; `vitest.config.ts` and `package.json` are unchanged.
- C2: all six packages already present at the right versions (zod ^4, mutative ^2.0, clipper2-ts 2.0.1-18, earcut ^3.2 -> 3.2.4, flatbush ^4.6, nanoid ^5 -> 5.1.16). No `yarn add`. earcut 3.2.4 ships `src/earcut.d.ts`, so no `@types/earcut`; yarn.lock unchanged. `engine/index.ts` and `version.ts` were modify/verify (version.ts untouched, index.ts extended); P1's version.test.ts stays green. engine-cli stub untouched (`yarn build:engine-cli` builds, cli/build tests pass).
- C3: vendor present; ran `php artisan wayfinder:generate --with-form` before vue-tsc. Already on build/p2-engine, no branch creation.
- Controller rulings / progress.md `Ruling:` lines: none touch Task 1 (commit trailer uses the attribution given in the session reminder).

## Implemented
- `resources/js/engine/ids.ts`: `IdPrefix`, `ID_ALPHABET`, `newId` (nanoid `customAlphabet(ID_ALPHABET, 10)`), `isEntityId` (exact prefix + 10 alphabet chars).
- `geometry/tolerance.ts`: all constants verbatim from 04 §0.3 (`ANGLE_TOL = ANGLE_TOL_DEG*PI/180`) and `roundMm`.
- `testing/ids.ts` (`testIds`), `testing/random.ts` (`mulberry32`): test-only, not exported from index.
- `index.ts` re-exports ENGINE_VERSION, newId, isEntityId, IdPrefix, tolerance constants, roundMm.
- `eslint.config.js`: `furny/engine-purity` block for `resources/js/engine/**/*.ts` (no-restricted-imports paths vue/three/clipper2-ts/earcut, patterns `@tresjs/*`, `three/*`, `@/*`, `**/editor/**`, `**/components/**`; no-restricted-globals window/document/localStorage/fetch/HTMLCanvasElement/Image), then later blocks for `geometry/clip.ts` (allows clipper2-ts) and `geometry/triangulate.ts` (allows earcut) built from one shared helper.
- Tests: `__tests__/ids.test.ts` (9), `purity.test.ts` (11), `lintRules.test.ts` (13).

## TDD evidence
- RED: `yarn vitest run --project engine resources/js/engine/__tests__` -> 3 files failed, 11 tests failed / 3 passed. ids.test.ts: "Failed to load url ../testing/ids ... Does the file exist?"; purity.test.ts: "Invalid glob import syntax: Could only use literals" (test bug, fixed: glob patterns must be literal, so the list is repeated for the loader and `?raw` globs); lintRules: `expected [] to include 'no-restricted-imports'` / `'no-restricted-globals'` (rules absent). Failures expected: no implementation or lint block yet.
- GREEN: `yarn vitest run` (all projects) -> 7 files, 42 tests passed (engine: ids 9, purity 11, version 1, lintRules 13, engine-cli cli 3 + build 2; app 3).

## Quality gates (all exit 0)
`yarn eslint resources/js/engine eslint.config.js`, `yarn lint` (whole repo, max-warnings=0), `yarn prettier --check` / `yarn format:check`, `yarn typecheck` (vue-tsc), `yarn build:engine-cli`.

## Deviations / notes
- purity.test scans source text via `import.meta.glob(..., { query: '?raw' })` rather than node:fs, so no node types are needed (tsconfig `types: ["vite/client"]`). It also asserts the loader and raw globs list the same files. The two `typeof window/document` assertions carry `eslint-disable-next-line no-restricted-globals` with a reason (the engine rule applies to test files under engine/** too).
- lintRules.test pads the first ESLint call (warm-up in beforeAll, 30 s describe timeout) since the first lint takes ~0.9 s.
- lintRules "reports nothing" cases use code that uses the import (avoids no-unused-vars noise) and assert zero messages of any rule. Added an extra test that clip.ts still blocks earcut and triangulate.ts still blocks clipper2-ts.
- `roundMm(-0.4)` returns -0 per the spec formula (not normalised); the test uses `+ 0` as the brief says.
- Purity regexes will flag the words `window.`/`document.`/`fetch(` even in engine comments; keep those words out of engine comments.

## Files changed
eslint.config.js (modified); resources/js/engine/index.ts (modified); created: resources/js/engine/ids.ts, geometry/tolerance.ts, testing/ids.ts, testing/random.ts, __tests__/ids.test.ts, __tests__/purity.test.ts, __tests__/lintRules.test.ts.
