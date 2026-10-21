# Task 50 — carries (binding; preflight C1, C4, I13 + ledger perf carries). C4 REPLACES the brief's mechanism.

1. C4 — implement spec 16 §10 exactly, NOT the brief's vitest.perf.config.ts / __perf__ / test:perf:
   - `scripts/check-bench.mjs` reading vitest bench JSON output and a thresholds file;
   - `resources/js/engine/bench-thresholds.json` with the CI column: 04 §7.3 rows 30 / 8 / 400 / 1 / 6 / 12 / 6 ms (cold derive 7×6, warm derive after moveNode, cold 22×22, snapPoint 511 walls, buildSnapIndex+buildHitIndex, moveNode non-finalize incl. derive 97 walls, validatePlan 97 walls); generateFurniture 15; estimateFurniture median 60 and p95 100; computeBom **20**; nestSheets (300 random parts) 200;
   - bench files at the 16 paths: `resources/js/engine/plan/derive.bench.ts`, `furniture/generate.bench.ts`, `bom/bom.bench.ts`, `bom/nesting/nesting.bench.ts`, with `benchmark.include` set inside vitest project `engine`;
   - package.json script `bench:check` = `vitest bench --run --outputJson build/bench.json && node scripts/check-bench.mjs build/bench.json resources/js/engine/bench-thresholds.json` (match 16 §10 text exactly); make sure `build/` output is gitignored.
   - Drop vitest.perf.config.ts, __perf__/ and test:perf. `measure()` helpers may live in `engine/testing/`.
   - Fixtures from the brief still apply: perfWardrobe() = wardrobe_hinged {width 3600, height 2400, doors 6, internalDrawers 4, hangingStyle 'double'} (part count 45–70), randomParts(300, mulberry32(5)).
2. C1: do NOT mergeConfig a perf config with the projects config; put benchmark settings inside project `engine` in the existing vitest config.
3. I13: the CLI compute-bom timing is a local smoke only, not a gate (P5 PHP PerformanceTest owns it).
4. If a budget fails: profile and fix engine code; never relax a threshold. Ledger perf carries to address/verify here:
   a. add planarFaces to benches (baseline 22×22 ~12 ms warm / 25 ms cold);
   b. warm derive was ≈4.7 ms vs 4 ms target (under the 8 ms CI line) — report the measured median;
   c. derive localBoxes is O(faces×walls) — use flatbush only if the budget regresses;
   d. cmpId is defined 3× — hoist to one shared helper and import it (pure refactor, tests must stay green);
   e. replace-merge re-derives on fresh apply() and merged drag ~8 ms — confirm within the 12 ms CI line;
   f. polylabel/net reuse for unchanged rooms (derive is 71% of a moveWall step) — implement only if needed to meet a budget;
   g. insertFragment dry run doubles large-paste cost — skip the dry run when nothing is within tolerance (Task 28 N1), with a test.
5. Bench timing on this Windows host under concurrent agent load is noisy: run `yarn bench:check` when the machine is quiet (report the numbers); thresholds are CI values, so a borderline local miss should be re-run before acting.
