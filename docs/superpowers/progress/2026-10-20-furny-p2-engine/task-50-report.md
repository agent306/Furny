# Task 50 report: performance budgets

Status: DONE_WITH_CONCERNS (concerns below are minor). Branch `build/p2-engine`.

## Implemented (spec 16 §10, per carries C4/C1)

- `yarn bench:check` = `vitest bench --run --outputJson build/bench.json && node scripts/check-bench.mjs build/bench.json resources/js/engine/bench-thresholds.json` (text as in 16 §10). `build/` was already gitignored.
- `scripts/check-bench.mjs`: reads the vitest bench JSON and the thresholds file; fails on a median or p95 over its limit, on a threshold with no matching benchmark, and on an unknown metric key. Benchmarks without a threshold are printed as `info` (report-only).
- `resources/js/engine/bench-thresholds.json`: the CI column (30 / 8 / 400 / 1 / 6 / 12 / 6, generateFurniture 15, estimateFurniture 60 + p95 100, computeBom 20, nestSheets 200).
- Bench files at the 16 paths: `plan/derive.bench.ts`, `furniture/generate.bench.ts`, `bom/bom.bench.ts`, `bom/nesting/nesting.bench.ts`. `benchmark.include` is set inside project `engine` in `vitest.config.ts` (no mergeConfig); project `app` has `benchmark.include: []` so bench files never run under happy-dom.
- Fixtures `engine/testing/perf.ts`: `perfWardrobe()` and `randomParts(300, mulberry32(5))`.
- Tests: `engine/__tests__/checkBench.test.ts` (pass, median fail, p95 fail, missing entry, unknown metric; runs the real script), `engine/__tests__/perfFixtures.test.ts` (wardrobe part count in 45..70, randomParts deterministic).
- No `vitest.perf.config.ts`, `__perf__/` or `test:perf` (dropped per C4).

Commits (all on top of e440b75):
1. `166d64e` refactor(engine): reuse shared cmpId in guillotine nesting
2. `608e4d4` test(engine): add bench:check performance budgets
3. `47108e4` perf(engine): index room label text once per owner in buildHitIndex
4. `1cb289d` perf(engine): skip the insertFragment dry run when no wall can be a duplicate
5. this report.

## Budgets: CI threshold vs measured median (final `yarn bench:check`, Windows host, mildly loaded; two runs shown as range)

| Budget | CI threshold | Measured median |
|---|---|---|
| cold derive 7x6 (97 walls) | 30 ms | 6.7 to 7.7 ms |
| warm derive after moveNode | 8 ms | 1.9 to 2.2 ms |
| cold derive 22x22 (1012 walls) | 400 ms | 67 to 82 ms |
| snapPoint 511 walls | 1 ms | 0.003 ms |
| buildSnapIndex + buildHitIndex 511 walls | 6 ms | 2.4 to 4.3 ms (was 5.4 to 5.6 before the fix) |
| moveNode non-finalize incl. derive, 97 walls | 12 ms | 2.8 to 3.7 ms |
| validatePlan 97 walls (geom supplied, fresh doc identity) | 6 ms | 0.34 to 0.49 ms |
| generateFurniture wardrobe | 15 ms | 0.23 to 0.35 ms |
| estimateFurniture wardrobe median | 60 ms | 0.46 to 0.53 ms |
| estimateFurniture wardrobe p95 | 100 ms | 0.88 to 1.29 ms (reported p99, see concerns) |
| computeBom without nesting | 20 ms | 0.12 ms |
| nestSheets 300 random parts | 200 ms | 2.3 to 2.7 ms |
| planarFaces 22x22 (report only) | none | about 9 to 10.5 ms |

Local smoke (I13, not a gate): built CLI `compute-bom` with the committed 3-door fixture request, 155 to 167 ms per spawn including Node start (3 runs).

## Perf carries

- 4a planarFaces: bench `planarFaces 22x22` added (report only), about 9 to 10.5 ms.
- 4b warm derive: measured median 1.9 to 2.2 ms (alternating two one-node drags through a shared deriver); well under 8 ms. The earlier 4.7 ms figure is not reproduced.
- 4c localBoxes O(faces x walls): cold 22x22 is 67 to 82 ms vs 400 ms, no regression, flatbush not needed.
- 4d cmpId: only one copy was still local (`compareStr` in `bom/nesting/guillotine.ts`); the other two were already hoisted to `engine/compare.ts`. Replaced with the shared import. Nesting/BOM suites green (152 tests).
- 4e replace-merge drag: measured through the bus with `merge: true` on the 97-wall plan, median about 3.0 ms; well under 12 ms.
- 4f polylabel/net reuse: not needed, all budgets pass.
- 4g insertFragment dry run: `mayAddNoWall(d, seg, covered)` runs the dry run only when an existing wall covers the segment, has both ends on it, or the segment is within 4 merge tolerances long; otherwise `addsWall` is skipped (wall_duplicate is impossible there). Pasting the 97-wall grid into an empty plan: about 117 ms to 64 ms. Tests: four `mayAddNoWall` cases in `plan/commands/__tests__/entities.test.ts`; the existing insertFragment tests (duplicate skipping, T nodes, idMap) stay green, so output is unchanged.
- Unplanned fix: `buildHitIndex` was O(rooms^2) for rooms without metadata (all share key `''`; groups were re-spread and re-flattened per room). That made snap+hit index 5.4 to 5.6 ms against the 6 ms CI line (target 3 ms). Items are now collected once per key; 511-wall hit index 5.5 to 1.7 ms. Output identical (plan suite 1589 tests green).

## Gates

- `yarn bench:check`: all 12 asserted budgets pass (2 runs after the fixes plus earlier runs).
- `yarn vitest run`: 210 files, 5215 tests, 0 failures on the final run. One earlier full run had a single failure in `AddressFields > country > lists the business country first...` (app project, unrelated); it passed alone (24/24) and in the rerun, so it looks load-flaky. Not investigated.
- `yarn lint`: 0 warnings. `yarn typecheck`: clean. `yarn format:check`: clean.
- Plan suite after each engine fix: 38 files, 1589 tests pass (the 4 new `mayAddNoWall` tests included).

## Deviations and concerns

- vitest's bench JSON has no p95 and `samples` is empty. The `p95` threshold is checked against the reported `p99` (never lower, so a pass is a true pass). Documented in the script header.
- `validatePlan` is benched with a precomputed `geom` and a shallow copy of the doc per call (it caches by document identity). Without `geom` it would include a cold derive (about 7 ms), which is not what the 3 ms/6 ms budget describes; this is my reading of 04 §7.3.
- Warm derive and moveNode benches alternate two target positions so each call is a genuine one-node change; repeating one target would hit the deriver's full-hit cache.
- 22x22 cold derive has only about 10 samples per bench run (500 ms time budget); its median is stable (67 to 82 ms) given the 400 ms line.
- Timing is host-noisy; the thinnest margin after fixes is snap+hit index (2.4 to 4.3 ms of 6 ms).
- Test helper `scripts/` is outside ESLint-ignored/format:check scope (`format:check` covers `resources/` and `engine-cli/` only); `check-bench.mjs` is prettier-formatted anyway and lint passes.

## Fix round 1 (review findings)

Changes
- IMPORTANT 1, `plan/commands/fragment.ts`: `mayAddNoWall(d, seg)` rewritten with bounds derived from `resolveEndpoint`. A resolved endpoint lies at most `SNAP = hypot(MIN_WALL_LENGTH, NODE_MERGE_TOL) + 1` (about 12.2 mm) from its point: existing node or T node within 5 mm, wall-end snap up to hypot(10, 5) = 11.18 mm, rounding under 1 mm. `wall_duplicate` needs (A) both ends on one node, so the points are within `2*SNAP` (about 24.4 mm), or (B) every part covered or joined, which needs an existing wall W with a part within `NODE_MERGE_TOL` of the resolved segment (joined case: its ends are cut nodes within 5 mm of it) or a collinear `intersectSegments` overlap (W starts within 5 mm of the line and is parallel within 0.5 degrees, so it is at most `5 + 0.01*|W|` from the segment over the overlap). The resolved and the pasted segment differ by at most `SNAP`, so the dry run is skipped only when no wall is within `NODE_MERGE_TOL + SNAP + 0.01*|W|` of the pasted segment and the segment is longer than `2*SNAP`. The proof is in the doc comment; the old "two merge tolerances" comment is gone. `addsWall` is now exported for the test.
- Consequence: any wall touching or crossing the pasted segment forces the dry run. The 97-wall grid paste is back to about 117 to 148 ms (every grid wall touches an earlier one); the speedup now only applies to walls clear of everything else. Correctness wins.
- MINOR 3: `check-bench.mjs` `fmt()` no longer throws on a non-number; the FAIL line is printed. MINOR 4: duplicate benchmark names exit 1. MINOR 5: `hitIndex.ts` pushes items in a loop instead of spreading.
- `cmpId` check: `engine/compare.ts` is `a < b ? -1 : a > b ? 1 : 0`, the exact body of the removed `compareStr` (plain code-unit order), so semantics are identical.

Tests (written first, seen red)
- Counterexample as an `insertFragment` test (`entities.test.ts`, "still skips a wall whose ends both snap to one wall-end node"): red before the fix with `wall_too_short`, now green; the wall is skipped, idMap is empty, nodes and walls unchanged.
- Seeded property test (mulberry32(50), 8000 random segments near two plans, spreads 3 to 400 mm): whenever `mayAddNoWall` says skip, `addsWall` must return true. Not vacuous (more than 100 skips asserted). Mutation check: weakening the bounds makes it fail.
- Helper tests updated to the new signature; `checkBench.test.ts` gained non-numeric and duplicate-name cases (7 tests).

Commands and results
- `yarn vitest run resources/js/engine/plan`: 38 files, 1589 tests pass.
- `yarn vitest run resources/js/engine/__tests__/checkBench.test.ts`: 7 pass.
- `yarn lint`: clean. `yarn format:check`: clean. `yarn typecheck`: clean.
- `yarn vitest run` (full): 210 files, 5217 tests, 0 failures. One run caught a purity-test hit on the word "document." in my new comment; reworded.
- `yarn bench:check`: all 12 budgets pass (snap+hit index 1.9 ms, cold derive 7x6 7.1 ms, moveNode 3.0 ms, warm derive 2.1 ms). estimateFurniture p99 read 30 ms in this run (load spike), limit 100 ms.
