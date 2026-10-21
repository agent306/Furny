# P2 Engine: pre-flight conflict scan

**Plan scanned:** `docs/superpowers/plans/2026-10-20-furny-p2-engine.md` (51 tasks, read in full).

**Spec authority:**
- master §6
- `01` §1.2, §3, §5
- `03` (all)
- `04` (all)
- `07` (all)
- `08` (all)
- `19`
- `14` and `16`, both normative for API and test conventions
- Cross-checks: `02` §13–§14, `05` §1.1/§9/§10.4/§19, `06` §7.8, `15` §15.2

**Cross-plan inputs:**
- P1 plan Task 1.
- P1 preflight rulings, especially C2, C3, C4 and C13 (a–d).
- Roadmap "Local environment notes".

**Evidence:** I recomputed every worked number the plan copies from the spec in Python or by hand. That covers:
- money and quote fixtures
- the ₹24,313 wardrobe price and the `whole_sheets` variant
- the cut list, edge banding and weight
- the 07 §12.2–§12.4 construction values
- every HDB room area and the brochure areas (Kitchen, Toilet 1, W/M, Bedroom 1, Bedroom 2, Deck, Toilet 2, Living/Dining)
- the grid wall counts and the table/desk values

**Result:**
- **18 conflicts (C1–C18)** need a ruling. Spec is binding.
- **15 minor internal issues (I1–I15)** need fixing during execution but no owner decision.
- Most of the worked arithmetic in the plan matches the spec exactly (§d). The exceptions are listed as conflicts: C8, C14 and C15.

---

## 0. Conflict register and proposed rulings

| # | Conflict | Tasks | Proposed ruling (spec binding) |
|---|---|---|---|
| C1 | **Vitest config shape.** P2 Task 1 Step 3 adds root-level `include`/`exclude` (`resources/js/**/__tests__/**`, `engine-cli/src/**`, `**/__perf__/**`). P1 Task 1, under ruling C2/C13(a), ships inline `projects` `engine` (node; engine and engine-cli globs, `__perf__` excluded) and `app` (happy-dom, setup `resources/js/test/setup.ts`), as 16 §2 also requires. Root `include` is ignored when `projects` exist. Task 50's `vitest.perf.config.ts = mergeConfig(baseConfig, { test: { include: … } })` therefore inherits the projects and runs nothing, or everything. | 1, 50 | Task 1 makes **no root include/exclude change**. It verifies that the `engine` project globs already cover `resources/js/engine/**` and `engine-cli/src/**`, and adds globs **only to project `engine`** if one is missing. Tests under `resources/js/{lib,editor}` (Tasks 47 and 49) run in project `app`. Task 50 must not `mergeConfig` with the projects config (see C4). |
| C2 | **Files and dependencies P1 Task 1 already produced.** <br>• P2 Task 1 "Create"s `engine/index.ts` and `version.ts`, which exist from P1; P1's `engine/__tests__/version.test.ts` also exists. <br>• Task 1 Step 3 runs `yarn add` for zod, mutative, clipper2-ts, earcut, flatbush and nanoid, which P1 already installed ("P2 must not need lockfile changes"). <br>• Task 48 "Create"s `engine-cli/src/cli.ts` and `engine-cli/vite.config.ts` and "Modifies" `package.json` scripts, `.gitignore` and `tsconfig` include, all of which P1 produced. P1's `engine-cli/src/__tests__/cli.test.ts` imports `dispatch` from `cli.ts`, but Task 48 moves `dispatch` to `commands.ts`. <br>• Task 51 adds the `@vitest/coverage-v8@^3` devDependency, which P1 installs per C13(c). | 1, 48, 51 | Treat all of these as **Modify / verify**. <br>• Task 1: check the six packages and their versions in `package.json` and run no `yarn add`. Add `@types/earcut` only if `earcut@3` ships no `.d.ts`, and commit `yarn.lock` with it. <br>• Task 48: keep `dispatch` (and `CliResponse`) exported from `cli.ts` by re-exporting from `commands.ts`. Guard `main()` with an entry check so importing `cli.ts` in tests never reads stdin. P1's `cli.test.ts` must stay green. The package.json, .gitignore and tsconfig edits are no-ops unless something is missing. <br>• Task 51: only add the `test:coverage:engine` script; no devDependency. |
| C3 | **PHP is needed before every task's `vue-tsc` gate.** The plan header says "No PHP … needed by any test except Task 51". The Step-5 gate `yarn vue-tsc --noEmit` type-checks the whole project, including kit pages that import git-ignored Wayfinder output (P1 C13(b), 16 §16, 19 line 314). Branch creation `git checkout -b build/p2-engine <sha>` may also clash with a pre-made worktree (P1 C12). | 1 (Step 0), every Step 5 | Task 1 Step 0 adds a one-time `composer install` and `php artisan wayfinder:generate --with-form` (composer-seed-dist per the roadmap if needed). Re-run Wayfinder whenever the P1 base is merged in. If the worktree is already on a `build/*` branch, commit there and skip branch creation. Correct the header sentence. |
| C4 | **Performance budgets: mechanism and thresholds contradict 16 §10.** 16 says: <br>• `yarn bench:check` = `vitest bench --run --outputJson build/bench.json && node scripts/check-bench.mjs build/bench.json resources/js/engine/bench-thresholds.json`, run in the CI `frontend` job. <br>• Bench files are `plan/derive.bench.ts`, `furniture/generate.bench.ts`, `bom/bom.bench.ts` and `bom/nesting/nesting.bench.ts`. <br>• The `computeBom` CI threshold is **20 ms** (target 10). <br>• The CLI `compute-bom` budget (≤ 3 s) is `tests/Feature/Contract/EngineCli/PerformanceTest.php` (PHP, median of 3). <br>The plan instead uses `vitest.perf.config.ts`, `__perf__/budgets.perf.test.ts`, `test:perf`/`bench` scripts and `__perf__/*.bench.ts`, and asserts `computeBom ≤ 10 ms`, which also breaks its own "CI = 2 × target" rule. P1 preflight C4 flags `bench:check` as unowned. | 50 | Implement 16 §10 exactly: <br>• `scripts/check-bench.mjs` <br>• `resources/js/engine/bench-thresholds.json` holding the CI column: 30/8/400/1/6/12/6 ms for the 04 §7.3 rows; `generateFurniture` 15; `estimateFurniture` median 60 with p95 100; `computeBom` **20**; `nestSheets` 200 <br>• the four bench files at the 16 paths, with `benchmark.include` set inside project `engine` <br>• script `bench:check` <br>Drop `vitest.perf.config.ts`, `__perf__/` and `test:perf`. The CLI timing becomes a local smoke only and is not a gate; its owner is the P5 PHP contract test. `measure()` helpers may live in `engine/testing/`. |
| C5 | **Coverage gate thresholds** (Task 51). The plan sets only "lines 90 for `units`/`geometry`/`plan`". 16 §15 requires `resources/js/engine/**` (excluding `testing/`) at **90 % lines / 85 % branches**, plus ≥ 90 % lines for `units`, `geometry` and `plan` (04 §10). | 51 | Configure the v8 thresholds per glob: engine-wide 90/85, and units/geometry/plan at 90 lines, excluding `**/testing/**`, `**/__tests__/**` and `*.bench.ts`. Do not set the `{editor,lib,composables}` 75/65 thresholds here; P4 and P5 own those layers. |
| C6 | **Message key for plan validation issues.** The plan pins `messageKey = 'engine.plan.issue.{rule}'` and puts the English text in `engine.php` (Plan conventions, Task 13, Task 51). Spec 05 §10.4 and §19 (normative for the editor) render validatePlan issues with **`plan_editor.issues.<code>`**, with the keys owned by 05/P4 (`plan_editor.php`). 04 §0.2 lists no `engine.plan.issue.*` prefix, and 04 §10 does not require plan-issue keys in `engine.php`. The plan creates a second, divergent set of texts. | 13, 51, conventions | `Issue.messageKey` for plan issues = `'plan_editor.issues.' + rule`, where `rule` is the code without `plan.` (e.g. `plan_editor.issues.node_missing`). P2 writes no texts for these keys; P4 adds them to `plan_editor.php`, including the plan-invented `value_out_of_range`. Task 51 only asserts the key pattern for plan issues. Record in 19 §5. |
| C7 | **Normative guillotine code does not type-check.** 08 §5.3 says "paste unchanged". The code indexes arrays without guards: `sheets[s].free`, `free[r]`, `sheet.free[c.rect]`, `res.sheets[a - 1].usedArea`, `place(sheets[choice.sheet], …)`. Under `noUncheckedIndexedAccess: true` (16 §14, P1 C3), `vue-tsc` fails with TS2532/TS2345. | 43 | Paste with **type-only** edits: non-null assertions or local `const x = arr[i]!` lines, and nothing that changes control flow or order. Add a header comment stating that it is the verbatim 08 §5.3 algorithm with type-level edits only. The 08 §10.4 cases and the property tests prove equivalence. Record in 19. |
| C8 | **Reference plan fixture dimensions contradict 16 §7.1 and 03 §6.** <br>(a) Brochure: 16 §7.1 asserts bedrooms `10'0"×11'0"` = **3048 × 3353 ± 1 mm**. The plan geometry gives Bedroom 1 net **3047.5 × 3357.5**, so depth is off by 4.5 mm. Bedroom 2 net is L-shaped: the bottom wall is exterior 230 for x 8010–9630 and interior 115 for x 6410–8010, so `netRect = null`. <br>(b) HDB: 03 §6 and 16 §7.1 say "living 7600 wide". The plan's living room spans centre-lines 0–7900 (net 7727.5). With an overall width of 11 000 and bedroom 3 at 3100, the spec numbers cannot all hold on one measuring basis. The bedroom widths 3100/3600/3100 and the balcony 3600 × 900 match as centre-line spans. | 14 (and P3's `*.expected.json`) | (a) Spec binding: re-pin the brochure before execution. Move the y = 3530 row (A5, A6, A7, A14, A15, A18) to **y = 3525**, giving Bedroom 1 net 3047.5 × 3352.5 within ±1. Make Bedroom 2's bottom wall uniform: A5–A6 thickness 115, or A7–A6 thickness 230 (the HDB N7–N26 trick), with a matching Bedroom 2 rect. Then recompute every brochure area by hand (Task 14 Step 3 rule). <br>(b) Owner decision. The default is to keep 7900 (consistent with the overall 11 000 and bedroom 3 at 3100), test the widths as centre-line spans, and log the 7600 figure as a spec inconsistency in 19 §5. Put the 16 §7.1 named-room checks in `plan/rooms.test.ts` (16) or reference that file from `referencePlans.test.ts`. |
| C9 | **Template property test vs template field ranges.** 07 §2.1 rule 3 and §12.5 require no `error` issue for every parameter combination inside the declared ranges. Several of those ranges force errors under the 07 formulas: <br>• `wardrobe_hinged` width 600, doors 12: 6 columns of (564 − 90)/6 = **79 mm** gives `section_too_small` (< 100) and `front_too_small`. <br>• `loft_cabinet` width 400, doors 12: same failure. <br>• `bookshelf` and `open_shelf_wall` width 300, columns 6: 29 mm columns. <br>• `open_shelf_wall` height 150, rows 6. <br>• `chest_of_drawers` height 500, drawerCount 8: 48 mm slots give `drawer_too_low`. <br>Plan Task 40 Step 3 "fix any combination the test exposes" gives no rule. | 39, 40 | Generators clamp counts before building the document. Columns/doors: `n ≤ floor((Wi + t) / (100 + t))`, then rebalance doors. Rows: `≤ floor((Hi + t) / (80 + t))`. Drawers: so that slot − 40 ≥ 60 (and front ≥ 80). The clamps are deterministic, documented per template, and logged in 19 as a 07 gap. The property test keeps the spec ranges unchanged. |
| C10 | **Engine CLI snapshot location.** 04 §10 requires "results matching committed snapshots". 16 §5.2/§13.1 put them at `tests/fixtures/engine-cli/{validate-plan,plan-summary}.{hdb-3room,brochure-2bhk}.json` as request/response pairs, read by the PHP contract tests, and also list `compute-bom.{fixture}.json`, `validate-furniture.wardrobe-3door.json`, `cutlist-csv.wardrobe-3door.csv`, `template-default.{key}.json`, `diff-furniture.wardrobe-width-2100.json` and `invalid-input.json`. The plan writes `engine-cli/src/__tests__/__snapshots__/…`, which gives two sources of truth. | 48 | Task 48 writes and compares the snapshots at the 16 §5.2 paths, as `{request, response}` JSON with `UPDATE_FIXTURES=1` regeneration. It also generates the remaining `tests/fixtures/engine-cli/*` files, since P2 owns the CLI and the files are pure engine output. Note this in the roadmap so P5 consumes them rather than re-creating them. |
| C11 | **Quote fixtures are incomplete.** 16 §5.2 and §6.8 require the five 08 §10.6 fixtures **plus `hidden-lines.json`** (08 §6.4: hidden lines count in totals). The plan's fixture shape adds `description` and `taxRates` and uses `{error}` for the failure case, while 08 §6.3 shows `{pricesIncludeTax, lines, expected:{subtotal,discount,tax,total,taxBreakdown,amounts}}`. | 47 (↔ P7) | Add `hidden-lines.json`: lines carrying `isVisibleToCustomer: false` and `orderItemId`, with totals identical to the all-visible case. `QuoteTotalsLine` accepts and ignores those optional fields; display bundling stays in P7. Keep the shape extension (tax-rate names are needed for the breakdown ordering) and record it as a shared contract in the PR for P7. |
| C12 | **Shared money fixture contains a TS-only function.** `minor-math.json` (run by P7's PHP `MinorMath` too, 08 §1) includes `multiplyMinor(1000, 1.005)` with a float argument. 08 §0/§1 list the shared functions without `multiplyMinor` (a display helper). PHP parity would then require an extra method with float semantics. | 2 (↔ P7) | Restrict the shared JSON to the eight 08 §1 functions with integer arguments, including the extra edge cases. Test `multiplyMinor` and the `RangeError` cases directly in `money.test.ts`. |
| C13 | **Ownership of `tests/fixtures/catalog/seed-snapshot.json`.** 16 §5.2 says the file is *generated* by `php artisan testing:seed-catalog-snapshot` from the CatalogSeeder, TaxRatesSeeder and SettingsSeeder definitions, with `--check` in CI. P2 Task 29 hand-transcribes it, pinning ids `seed-<code>`, tax ids `seed-tax-gst18…`, `generatedAt '2026-10-20T00:00:00Z'` and `sortOrder = row × 10`. A later generator that differs in ids, URLs or decimals breaks every Vitest expectation. | 29 (↔ P1 T8 / P5) | P2 hand-writes it now; there is no PHP alternative. The pinned values become a **cross-plan contract**: the future command must emit identical bytes, with all `*Url` fields `null` and decimals as JSON numbers (`thicknessMm 18`, `wasteFactor 0.1`, `kerfMm 4`). Record this in the roadmap and the PR. |
| C14 | **Glass-door test value contradicts the 07 §4.5 formula.** The plan expects a "300-wide glass leaf → `glass_door_too_small` and a solid leaf". The rule is `lw < 2·60 + 100 = 220`, so a 300 mm leaf is valid. | 34 | Use a leaf narrower than 220 mm, e.g. 200 mm, which still exceeds the 100 mm `front_too_small` floor. Optionally add 220 as the valid boundary. |
| C15 | **`makeDirtyPlan` (e) is impossible in a schema-valid document.** "Two nodes 0.3 mm apart" cannot exist when node coordinates are `.int()` (03, Task 8 schema). The minimum non-zero gap is 1 mm, which is above `EPS` 0.5, so the review-focus-2 case "near-coincident nodes (< EPS)" is untestable as written. | 8, 28 | (e) becomes **two distinct nodes at identical coordinates** (0 mm < EPS), each with its own wall. The sub-EPS float case stays covered at segment level in Task 6 (0.3 mm cluster). |
| C16 | **16 §7.1 / §1 test-set requirements the plan omits.** 16 adds to the section lists and never removes from them. <br>• Units round trip: **0–100 000 mm, 10 000 seeded samples** (plan: 2000 in [0, 50 000]). <br>• Catalog: hardware spec schemas **reject a hinge without `overlay`**. <br>• `furniture/__tests__/migrate.test.ts` (plan tests migration inside `schema.test.ts`). <br>• File locations: `bom/__tests__/wardrobe.test.ts` and `bom/nesting/__tests__/guillotine.test.ts`. <br>• Seeds: "`mulberry32(42)` in TS" (plan uses 7, 99, 1234 and 5). | 4, 29, 30, 42, 43, 4/28/43/50 | Adopt the 16 names, ranges and cases as a superset: the round trip covers both 04 §1.5 and 16. Use `mulberry32(42)` for every seeded test unless a test needs a second independent stream (then use 43 and note it). |
| C17 | **The `sections.*` namespace is not in 15 §15.2.** 07 §3.7's `SectionLabel` key literals are `sections.interior|column|row`; 15 lists no `sections` namespace and caps key depth at 4, while `engine.plan.command.label.*` has depth 5. (Plan gap 2.) | 33, 51 | Keep the 07 literals and create `resources/lang/en/sections.php` in P2. Log the namespace addition and the depth exception for `engine.*` labels in 19 §5. P1's `i18n:export` already flattens every file. |
| C18 | **Hinge-installation labour quantity.** 08 §4.3 row 7 says "Σ qty of category `hinge` (plates included)", but the §4.7 worked example counts 12, i.e. hinges only. (Plan gap 8.) | 44 | The worked example is binding: count 12. Read "plates included" as "the rate covers fitting the mounting plates", not as a quantity term. Record in 19 §5. |

### Plan spec-gap decisions confirmed (no conflict found)

- Gap 3: `bbox` added to `validate-furniture` (03 §5 step 4 reads it).
- Gap 4: `migratedDocument` returned with orphan nodes removed.
- Gap 5: `paramsSchema`, `labelParams` and `Pipeline` added to `CommandDef`.
- Gap 6: bookshelf fixture at height 2100 gives `shelfCount(2004, 330) = 5`.
- Gap 7: plan fixture coordinates pinned, subject to C8.
- Gap 9: perf wardrobe ≈ 50 parts. The 3600 × 6-door defaults give about 25 parts, so the spec's "≈ 60" is approximate; accept the 45–70 range.
- Gap 10: template label key patterns.
- Gap 11: grid majors.
- Gap 13: CLI error codes. These match P1's `unknown_command` and `invalid_json`.

---

## (a) Shared files and interfaces: one row per producer → consumer pair

Legend: **OK** = contract matches; **C#** = conflict above; **I#** = minor internal issue (§b).

| # | Producer → consumer | Shared file / interface | Finding |
|---|---|---|---|
| a1 | P1 T1 → T1 | `package.json` (packageManager, deps), `tsconfig` (strict, `@/*`, `noUncheckedIndexedAccess`), `vitest.config.ts` projects, `eslint.config.js`, `.prettierrc` | **C1, C2, C3**; C7 (noUnchecked) |
| a2 | P1 T1 → T48 | `engine-cli/src/cli.ts` `dispatch`/`CliResponse`, P1 `cli.test.ts`, `engine-cli/vite.config.ts`, `build:engine-cli`, `.gitignore`, tsconfig include | **C2** (keep `dispatch` exported from `cli.ts`, guard `main`) |
| a3 | P1 T1/T3 → T51 | `@vitest/coverage-v8`, six engine lang files (owned by P2 per P1 C13d), `i18n:export` | **C2**; OK on ownership |
| a4 | P1 T1 → T1 | `engine/index.ts`, `version.ts`, `__tests__/version.test.ts` | **C2** (Modify, not Create) |
| a5 | T1 → all | `tolerance.ts` constants, `roundMm`, `newId`/`isEntityId`, `testIds`, `mulberry32` | OK (seed choice C16) |
| a6 | T1 → T5 | ESLint per-file exceptions for `clip.ts`/`triangulate.ts`, `purity.test.ts` | OK |
| a7 | T2 → T42/T44/T47 | `ceilDiv`, `roundHalfUpDiv`, `applyBps`, `roundUpToStep`, `costFromHundredths/Milli`, `netFromGross`, `grossUp` | OK |
| a8 | T2 ↔ P7 | `tests/fixtures/money/minor-math.json` | **C12** |
| a9 | T3 → T5/T6/T9/T15/T16 | vec2/segment/polygon signatures (04 §2.2–§2.5) | OK |
| a10 | T3 → T15 | `frontVector`/`rotationFromFront` in `vec2.ts`, re-exported by `footprint.ts` | OK (04 §0.1 places them in footprint; a re-export satisfies it) |
| a11 | T4 → T18 | `formatLength`, `formatArea` | OK |
| a12 | T5 → T6/T10/T11/T15/T21/T28 | `union`/`difference`/`intersectionArea`/`cyrb53` | OK |
| a13 | T6 → T11 | `buildPlanarGraph`/`walkFaces`/`nestFaces`/`polylabel` | OK |
| a14 | T7 → T8 | `FIXTURE_KEYS`, `ROOM_TYPES` (Task 7 runs before Task 8) | OK |
| a15 | T7 → T15/T18/T26 | `FIXTURE_LIBRARY` (`noConflict`, symbols, defaults) | OK (I7) |
| a16 | T8 → T9–T28 | Plan types, schema, builders (`makeRectPlan/LPlan/GridPlan/DirtyPlan`) | OK except **C15** |
| a17 | T8 → T13/T30/T37/T48 | `Issue`/`IssueSchema`, `EngineInputError` | OK |
| a18 | T9 → T10 | `buildWallGraph`, `computeAllWallEnds`, `buildWallOutline`, `DERIVE_ISSUE_CODES` | OK |
| a19 | T10 → T11/T12/T15/T16/T18 | `DerivedPlan`/`DerivedWall`/`DerivedOpening` | OK |
| a20 | T11 → T13/T14/T21 | `DerivedRoom`, `faceKey`, association | OK |
| a21 | T12 → T21/T50 | `createPlanDeriver` (+`stats`, a superset of 04 §7.1) | OK (I2) |
| a22 | T13 → T21/T28 | `validatePlan` memo, `planErrorKeys` | OK |
| a23 | T13 → T48 | `removeOrphanNodes`, `planSummary` | OK |
| a24 | T13 ↔ P4 | plan issue `messageKey` vs `plan_editor.issues.<code>` (05 §10.4/§19) | **C6** |
| a25 | T14 → T48, P3, P4/P10 | `database/fixtures/plans/*.json` | **C8**, **C10** |
| a26 | T15 → T16/T17/T19/T21/T26 | `Footprint`, `FootprintProvider` | OK |
| a27 | T16 → T17/T19/T50 | `SnapIndex`, `snapPoint`, `gridStepFor` | OK |
| a28 | T18 → T19 | `PlanDrawing` → `svgFromDrawing`, `buildHitIndex(doc, geom, drawing, footprints)` | OK |
| a29 | T20 → T21/T41 | `createCommandBus`, `defaultPipeline`, `Pipeline`, `paramsSchema`, `messageKeyPrefix` | OK (I5: plan pipeline must parse params too) |
| a30 | T21 → T22–T28 | `PlanCommandContext`, `createPlanBus`, `definePlanCommand`, `PLAN_COMMANDS` | OK |
| a31 | T22 → T23–T28 | `resolveEndpoint`/`splitWallAt`/`insertWallSegment`/`mergeNodeInto`/`reclampOpenings`/`nextOpeningLabel` | OK |
| a32 | T23–T27 → T28 | `PLAN_COMMANDS` complete = 43 (checked against the 04 §6.6 table) | OK |
| a33 | T29 → T30–T50 | `CatalogSnapshot`, `seedCatalog()`, `indexCatalog`, `HardwareRoleKey` (28 keys verified) | OK |
| a34 | T29 ↔ P5 | `tests/fixtures/catalog/seed-snapshot.json` | **C13** |
| a35 | T30 → T31–T38 | `GenContext`, `makePart`, `fl`, `PART_NAMES_EN`, schema/migrate | OK |
| a36 | T31 → T39/T40/T41/T48 | `TEMPLATES`, `templateDefaultDocument`, `reidentify`, `wardrobe-3door.json` | OK (I3: `hingedFront` name clash) |
| a37 | T32 → T33–T36 | `Envelope`, `computeEnvelope`, `coveringFront`, `hasExternalDrawers` | OK |
| a38 | T33 → T34/T35/T36/T45 | `SectionLayout`, labels, dividers, `fitsSheet` | OK |
| a39 | T34 → T35 | `computeOpenings` keyed by frontId vs external-drawer-leaf openings | **I4** |
| a40 | T34 → T36/T37/T38 | hinge/handle/flap rules, `frontCoverageIssues`, `leafWeightKg` | OK (I3) |
| a41 | T35 → T38 | `drawersFor(…, keyPrefix)` for `table.drawer` / `table.cabinet.drawer` | OK |
| a42 | T36 → T37/T38/T42/T45 | `generateFurniture`, `modelRules` hook, `codeIssues` | OK |
| a43 | T37 → T31/T39/T40/T41/T48 | `validateFurniture`, `SAVE_BLOCKING_CODES` (9 codes = 03 §2.4), `isSaveBlocking` | OK |
| a44 | T38 → T40 | `tableParts`, outlines | OK |
| a45 | T39/T40 → T40 property test | template ranges vs rule 3 | **C9** |
| a46 | T42 → T43/T44/T45/T46/T48/T49 | `Bom`, `computeBom`, `bomOptionsFor` (throws on nesting until Task 43) | OK |
| a47 | T43 → T44/T48/T49/T50 | `nestSheets`, `NestingResult` | **C7** |
| a48 | T44 → T45/T48/T49/T50 | `priceBom`, `displayUnitPrice`, `estimateFurniture` | OK |
| a49 | T45/T46 → T48 | `diffFurniture`, `cutListCsv` | OK (I6) |
| a50 | T47 ↔ P7 | `tests/fixtures/quotes/*.json`, `computeQuoteTotals` | **C11** |
| a51 | T48 ↔ P5 contract tests | `tests/fixtures/engine-cli/*`, CLI result shapes (01 §5.4 + `bbox`) | **C10** |
| a52 | T49 ↔ P4/P5 | `useEngineWorker`, RPC types (01 §5.5, 05 §1.1 path verified) | OK (I10, I11) |
| a53 | T50 → CI `frontend` job | `bench:check` | **C4** |
| a54 | T51 ← all code lists | `PARSE_LENGTH_ERROR_CODES`, `PLAN_COMMAND_ERROR_CODES` (22), `PLAN_COMMANDS` (43), `DERIVE_ISSUE_CODES`, `SNAP_KINDS`, `CONFLICT_KINDS`, `PLAN_ISSUE_CODES`, `FURNITURE_*`, `BOM_ISSUE_CODES`, `PART_NAMES_EN`, `HARDWARE_REASON_KEYS`, `CHANGE_MESSAGE_KEYS`, `TEMPLATES` | OK; **C5, C6, C17** |
| a55 | T1 ESLint → T47/T49 (outside engine) | `@/engine` import allowed outside the engine; engine `@/*` ban does not apply | OK |

---

## (b) Per-task internal consistency

| Task | Finding | Verdict |
|---|---|---|
| 1 | Create vs Modify for `index`/`version` (C2). Root Vitest include ignored (C1). `yarn add` not needed (C2). PHP/Wayfinder needed for `vue-tsc` (C3). Gate lacks `--max-warnings=0` (I12). `lintRules.test.ts` needs P1's authored flat config. | **C1, C2, C3** |
| 2 | Values match 08 §10.1 and the extra cases verified (`applyBps(9007199254741,3333)=3002099511605`, `multiplyMinor=1005`). Shared fixture holds a TS-only function (C12). | **C12** |
| 3 | Matches 04 §2.8 (`perpLeft(1,0)=(0,−1)`, `rotationFromFront(1,0)=270`). | OK |
| 4 | All 04 §1.5 rows present. Round trip narrower than 16 §7.1 (C16). | **C16** |
| 5 | Matches 04 §2.6–§2.8. | OK |
| 6 | Matches 04 §4.1–§4.3 and §4.7. The 0.3 mm cluster is a float-segment case (fine). | OK |
| 7 | Counts and defaults match 05 §9.4 and 06 §7.8. "Decals ≤ 1.05 allowed" relaxes 05 §9.5 for no reason (I7). | I7 |
| 8 | Builder wall counts verified: (7,6) = 97, (22,22) = 1012, (16,15) = 511, (3,3) = 24 with 12 doors. `makeDirtyPlan` (e) impossible with int coordinates (C15). | **C15** |
| 9 | Every §3.9 row and coordinate verified (L 1057.5/−57.5, 942.5/57.5; T; X; dangling). | OK |
| 10 | Values verified (`u0` 550, `cut` ±115.5, `jambStart.left` (550,−115), exterior 5230 × 4230). | OK |
| 11 | Areas verified: rect 17 982 900; L 27 717 537.5 → 27 717 538 and 9 245 925; `netRect` float (04 §4.5, not rounded). | OK |
| 12 | `joins ≤ 5` follows 04 §7.2 item 3. `roomNets ≤ 16` is not guaranteed by item 6: invalidation by "outline bbox intersects face bbox" reaches the far end of neighbour walls, up to about 20 faces (I2). | I2 |
| 13 | Rules and ranges match 03 §1.1. `planSummary` rect values verified (bbox ±115, 5115/4115). Message key (C6). | **C6** |
| 14 | All 10 HDB areas recomputed (sum 76 313 726 ✓; Living `netRect` 7727.5 × 3927.5 ✓; bbox max y 8357.5 → 8358 ✓). Brochure areas recomputed ✓. 37/27 walls and 16/13 openings ✓. Conflicts with the 16 §7.1 dimensions (C8). | **C8** |
| 15 | Footprint corners and sign verified (CW, area > 0). 18-point sectors = 16 segments + centre ✓. | OK |
| 16 | Grid table and the raw step 10 verified; the Shift (950,950)/315° case verified. | OK |
| 17 | Consistent with 04 §5.7–§5.8. | OK |
| 18 | Consistent with 04 §8.1–§8.2. | OK |
| 19 | Consistent with 04 §8.3 and §5.12. | OK |
| 20 | Consistent with 04 §6.1–§6.3. The `Object.isFrozen` assertion must run after an execute (the initial doc is not frozen). | OK |
| 21 | 22 error codes ✓. Params must also be zod-parsed in `planPipeline` (04 §6.7 "bus validates before validate") (I5). | I5 |
| 22 | Consistent with 04 §6.5. | OK |
| 23 | "requires ≥ 3 points (`invalid_params`/`out_of_range`)" is ambiguous; pick `invalid_params` via a zod refine (I9). | I9 |
| 24 | Consistent with 04 §6.6 and §6.8. | OK |
| 25 | Window height reduction (1800 → 900; 1150 → 250 < 300 → `opening_too_tall`) ✓. | OK |
| 26 | Defaults match 04 §6.6 and 05 §9.4 (`bed_double` 1400 × 1900 × 900). | OK |
| 27 | Matches 04 §6.6 and §6.8 (factor 3; image 15 mm/px; rescale clamps). | OK |
| 28 | 43 commands ✓. Property test per 04 §6.8 ✓. Dirty-import test depends on C15. Seed (C16). | C15, C16 |
| 29 | Seed counts verified (12/8/40/6/14/4; 28 role keys each once; `bb45` family 8). Missing the 16 §7.1 "reject hinge without overlay" case (C16). Ownership of the snapshot file (C13). | **C13, C16** |
| 30 | `makePart` examples match 07 §1.2. `fl` cases ✓. No `furniture/migrate.test.ts` (C16). | C16 |
| 31 | `shelfCount(1964,400)=4`; `columnsFromDoors` and auto doors ✓. `hingedFront` name reused by Task 34 (I3). | I3 |
| 32 | Envelope, panels, plinth (returns at 0/891/1782; 2/3/4), countertop (`Hc` 725, `Dc` 540) all verified. | OK |
| 33 | Columns 582/1164, rows 350/1596, shelves 580 × 549, `pr = 58` → 116, back split 609 → 598/1180, custom-box back seam 1200 all verified. | OK |
| 34 | Front rects, leaf sizes, hinge counts, weights 14.16/13.86, half-overlay 10/599/601/1190, inset 560, sliding 808/1924 verified. Glass 300 mm case wrong (C14). `computeOpenings` key (I4). | **C14**, I4 |
| 35 | 07 §12.3–§12.4 values copied correctly (Wb 538, Win 514, fronts 597 × 237, boxes 180/190/180, UM 522/546/490, unused 169, heights 73 < 80). "slideScrewSets +1 on each side panel" means the carcass bounding verticals (I8). | I8 |
| 36 | 20 parts, 14 hardware lines, 8 joints × 2 = 16 cams/dowels ✓. Weight 144.41 → 144.4 ✓ (PB 207 562 176 mm³, HDF 10 550 652 mm³). Legs 4/6/8 ✓. Wall brackets 4 ✓. Screw packs 2 for 31 parts ✓. | OK |
| 37 | Sag cases match 07 §7.2 and §12.4. "401 parts (extra part qty 99 × 5)" gives 20 + 495 = **515**, not 401 (I1). | I1 |
| 38 | Dining table (`Hb` 725, `Wb` 1700, legs [50,100]/[800,850], aprons 1600/700, dowels 16/+12/+8) and desk values (397 fronts, `SLD-BB-550` from maxLen 569, modesty 782 × 362, knee 482) all verified. | OK |
| 39 | Template defaults match 07 §2.4 (bookshelf 4, wall_cabinet 2/1, open_shelf 1 × 2, chest 4/2 columns). Range-induced errors (C9). | **C9** |
| 40 | Fixture list = 03 §6. `bookshelf` 2100 → 5 ✓. Property test (C9). | **C9** |
| 41 | 28 commands = 07 §9 rows ✓. Merge keys ✓. | OK |
| 42 | 12 rows and order ✓; cuts ✓; edge banding 31 206 × 1.05 → 32 767 ✓; sheetsEstimated 2/5 ✓; FIN-LAM 7 157 248 ✓; extruded Ø1000: P = 3140.33 → 3190 → 3350 ✓. File name (C16). | C16 |
| 43 | 08 §10.4 and §10.2 expectations copied exactly. Paste-unchanged vs tsconfig (C7). File location (C16). | **C7**, C16 |
| 44 | ₹24,313 example recomputed: material 1 002 550 (427 × 215 000/100 + 130 × 65 000/100); labour 316 574; direct 1 637 186; overhead 163 719; margin 630 317; unit 2 431 300; installation 194 504 → 194 600; total 2 625 900. `whole_sheets`: 1 205 000/105 000/1 861 086/186 109/716 518/2 763 800. Gross 2 868 934 → 2 869 000. All ✓. Hinge labour 12 (C18). | C18 |
| 45 | Matches 07 §12.6. The drawer_box "minor" case needs a document with drawer parts (I6). | I6 |
| 46 | Row 1 `2.334`, row 3 `5164`/`2.328`, header verified against 08 §8.1. | OK |
| 47 | Fixtures recomputed: allocation 84 005/15 995; tax 457 541/58 081 → total 3 541 522; inclusive 2 154 148/432 147 → 439 605/3 025 900; fractional 249 998/45 000/294 998; untaxed 99 998/18 000/217 997. All ✓. `hidden-lines.json` missing (C11). | **C11** |
| 48 | Results match 01 §5.4 and 08 §9.2 (+`bbox`). 2 × 2 431 300 = 4 862 600 ✓. The 7-sheet assertion needs `options.nesting: true` in the request (I15). Snapshot location (C10). File ownership (C2). | **C2, C10**, I15 |
| 49 | Matches 01 §5.5 and 05 §1.1. The app project is happy-dom: stub `Worker` explicitly (I10). Tests import engine `testing/` helpers (I11). | I10, I11 |
| 50 | Mechanism and thresholds vs 16 §10 (C4). "≤ 1.5 s (≤ 3 s CI)" ambiguous (I13). Perf fixture ≈ 50 parts accepted. | **C4**, I13 |
| 51 | Coverage thresholds (C5). Plan-issue keys (C6). `sections.php` (C17). `php` is available at `/usr/local/bin/php`; the ICU `select` for optional params is consistent with P1 Task 3 (it rejects `{n?}`). | **C5, C6, C17** |

### Minor internal issues (no owner ruling needed)

- **I1** (T37): build exactly 401 parts. The fixture has 20 parts, so add extras totalling 381, e.g. qty 76 × 4 + 77. Also assert that 400 gives no `too_many_parts`. `count` = Σ qty after overrides, including extras (spec says "parts"; plan choice accepted).
- **I2** (T12): replace `roomNets ≤ 16` with a bound derived from the implemented rule, or assert `roomNets < 42` together with deep equality to a fresh derive.
- **I3** (T31/T34): keep `hingedFront(covers, …)` as the 07 §2.3 template helper. Rename the Task 34 leaf generator, e.g. `hingedLeaves`. Neither is exported from `index`.
- **I4** (T34/T35): `computeOpenings` returns openings for fronts **and** external drawer leaves, keyed `fr_…` or `s_…` (07 §4.1).
- **I5** (T21): `planPipeline` performs the zod params parse that returns `invalid_params`, or the bus does so for every pipeline.
- **I6** (T45): use a document with drawers, e.g. the wardrobe with `internalDrawers: 2` or the §12.3 box, for the `drawer_box` `material_changed` case. Roles without parts emit nothing (07 §10.2).
- **I7** (T7): drop the "decals ≤ 1.05" relaxation. 05 §9.5 requires every 2D coordinate within [−0.5, 0.5] × [0, 1].
- **I8** (T35): `slideScrewSets += 1` on the left and right bounding vertical parts (carcass side or partition) per drawer, not on the drawer box sides.
- **I9** (T23): a closed `addWallChain` with fewer than 3 points gives `invalid_params` (zod refine), not `out_of_range`.
- **I10** (T49): `vi.stubGlobal('Worker', undefined)` in the `useEngineWorker` fallback test.
- **I11** (T49): tests outside the engine may import `engine/testing/*`. The 01 §5.2 single-entry rule applies to production code only.
- **I12** (all Step 5): add `--max-warnings=0` to the per-task ESLint gate (16 §14).
- **I13** (T50): the CLI timing is not a P2 gate (C4).
- **I14** (T1): add `@types/earcut` only if needed and commit `yarn.lock` with it.
- **I15** (T48): the `compute-bom` test request carries `options: { nesting: true }`.

---

## (c) Plan mandates that a spec-checking reviewer would reject

### c1. Contradictions with the spec, including numeric test values

| Plan mandate | Spec says | Ref → ruling |
|---|---|---|
| Plan validation `messageKey 'engine.plan.issue.{rule}'` (+ texts in `engine.php`) | Editor shows `plan_editor.issues.<code>`; keys owned by 05 | 05 §10.4/§19 → **C6** |
| Paste 08 §5.3 "unchanged" | `noUncheckedIndexedAccess: true` | 16 §14 → **C7** |
| Brochure Bedroom 1 net 3047.5 × **3357.5**; Bedroom 2 not rectangular | 3048 × **3353 ± 1** | 16 §7.1 → **C8a** |
| HDB living room 7900 c/l | "living 7600 wide" | 03 §6, 16 §7.1 → **C8b** (owner) |
| "300-wide glass leaf → `glass_door_too_small`" | threshold `lw < 220` | 07 §4.5 → **C14** |
| `makeDirtyPlan` nodes 0.3 mm apart, schema-valid | node coordinates `.int()` | 03 §1 → **C15** |
| `computeBom` asserted ≤ **10 ms** | CI threshold **20 ms** | 16 §10 → **C4** |
| `vitest.perf.config.ts`, `__perf__/*`, `test:perf`, CLI perf in Vitest | `bench:check`, `bench-thresholds.json`, `check-bench.mjs`, 16 bench paths; CLI perf in a PHP contract test | 16 §10, §16 → **C4** |
| Coverage: lines 90 on units/geometry/plan only | engine 90/85 + units/geometry/plan 90 | 16 §15 → **C5** |
| CLI snapshots in `engine-cli/src/__tests__/__snapshots__` | `tests/fixtures/engine-cli/*` request/response pairs | 16 §5.2, §13.1 → **C10** |
| Five quote fixtures | five + `hidden-lines.json` | 16 §5.2, §6.8 → **C11** |
| Units round trip 2000 samples in [0, 50 000] | 10 000 seeded samples in [0, 100 000] (superset) | 16 §7.1 → **C16** |
| Seeds 7/99/1234/5 | `mulberry32(42)` | 16 §1 rule 2 → **C16** |
| `bom.wardrobe.test.ts`, `bom/__tests__/guillotine.test.ts`, no `furniture/migrate.test.ts`, no hinge-without-overlay case | 16 §7.1 file list and cases | **C16** |
| Template property test "no errors" over the full spec ranges | Impossible with 07 formulas at range extremes | 07 §2.1 r3 vs §2.4 → **C9** |

### c2. Contradictions with the plan's own Global Constraints and header

- **Header** says "no PHP needed except Task 51". The `vue-tsc` gate needs `vendor/` and Wayfinder (C3).
- **Header** says Task 1 "Create"s files P1 produced, and Task 48 "Modify"s scripts P1 already wrote (C2).
- **GC "TS strict, no any"** holds. **P1 C3** adds `noUncheckedIndexedAccess`, which the plan never mentions; it affects every task and is the cause of C7.
- **GC "engine/index.ts is the ONLY import path used outside the engine"** is broken by Task 49 tests importing `engine/testing/*` (I11: tests are exempt).
- **"CI thresholds (2 × target)"** in Task 50 is contradicted by its own `computeBom ≤ 10 ms` (C4).
- **Plan convention "numeric ranges are validatePlan's job"** is consistent: `plan.value_out_of_range` is a plan-invented code. P4 must add `plan_editor.issues.value_out_of_range` (C6).

### c3. Environment feasibility (roadmap notes; P1 preflight E1–E14)

| # | Item | Finding |
|---|---|---|
| E1 | Node 22 / yarn 4 / Vitest 3 + Vite 8 | Feasible. P1 E6 applies: `vitest@3` pulls nested vite 7, and `vitest.config.ts` must not load the Laravel or Wayfinder plugins. The CLI uses Vite 8 SSR build (`engine-cli/vite.config.ts`, no Laravel plugin). |
| E2 | PHP for Task 51 (`execFileSync('php', …)`) | `/usr/local/bin/php` 8.4.26 present. CI `frontend` has PHP (16 §16). |
| E3 | `vue-tsc` | Needs `composer install` (source installs + `composer-seed-dist`) and `wayfinder:generate` once (C3). |
| E4 | Task 48 e2e spawns `node engine-cli/dist/cli.mjs` | Feasible. Build once in `beforeAll`. `ssr.noExternal: true` bundles every dependency. |
| E5 | No Docker | Not needed by any P2 task. |
| E6 | `clipper2-ts 2.0.1-18` API names | Inspect `node_modules` typings first, as the plan says (04 §2.6). |

---

## (d) Arithmetic verification summary: worked examples the plan copies

All recomputed values match:

- **08 §10.1 money and 08 §10.6 quotes** (exclusive, inclusive, fractional, untaxed): untaxed allocation base 1 + 1, extra unit to gst18, totals 217 997.
- **08 §4.7 / §10.2 wardrobe price:** the ₹24,313 chain and the `whole_sheets` 2 763 800 chain; tax-inclusive display 2 869 000.
- **08 §10.2 BOM:** 12 cut-list rows with cut sizes; EB08 32 767; PB 427/5 sheets; HDF 130/2 sheets; operations 12/232/16/16/0/6; 11 hardware codes.
- **07 §12.2 model:** envelope, layout, 20 parts, fronts, 14 hardware lines, 144.4 kg.
- **07 §12.3 / §12.4 construction values:** all listed values.
- **07 §2.4 template counts:** shelf, door, column and drawer counts.
- **07 §3.13 table and desk values:** as listed in the Task 38 row.
- **04:** §1.5 units, §2.8 primitives, §3.9 joins, §4.9 rooms, §5.11 snapping and grid, §6.8 command values.

The only numeric mismatches against the spec are the ones already ruled: **C8** (16 §7.1 room dimensions), **C14** (glass threshold), **C15** (sub-mm nodes) and **I1** (401 parts).

## Controller rulings (2026-10-21)
Ruling: adopt every proposed ruling C1–C18 and I1–I15 as written, EXCEPT C8 HDB living room: the fixture must use 7600 mm living-room width (matches the reference drawing's 7600 dimension and spec 03 §6 / 16 §7.1); adjust neighbouring nodes so the overall 11000 × 8900 envelope and the 3100/3600/3100 bedroom widths still hold — cost if wrong: fixture geometry rework.
Ruling: brochure bedroom depth fix per C8 (move node row to y=3525, uniform Bedroom 2 bottom wall).
Ruling: Task 37 "401 parts" case must actually build >400 parts (I1: adjust inputs so the count is asserted from the generated model, not hard-coded 401).
