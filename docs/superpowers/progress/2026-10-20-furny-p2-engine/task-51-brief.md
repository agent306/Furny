### Task 51: Translation keys, coverage gate, public API check

**Files:**
- Create: `resources/lang/en/engine.php`, `parts.php`, `hardware.php`, `issues.php`, `changes.php`, `templates.php`, `sections.php`; `resources/js/engine/__tests__/messageKeys.test.ts`, `resources/js/engine/__tests__/publicApi.test.ts`
- Modify: `vitest.config.ts` (coverage: provider `v8`, per-glob thresholds), `package.json` (devDependency `@vitest/coverage-v8@^3`, script `test:coverage:engine: vitest run resources/js/engine --coverage`)

**Spec refs:** `04 §1.6` (keys exist), `04 §10`, `07 §1.6`, `§6.12`, `§7.3`, `§10.2`, `15 §15.2`, `01 §5.2`

**Interfaces:**
- Consumes: every exported code list (`PARSE_LENGTH_ERROR_CODES`, `PLAN_COMMAND_ERROR_CODES`, `PLAN_COMMANDS`, `DERIVE_ISSUE_CODES`, `SNAP_KINDS`, `CONFLICT_KINDS`, `PLAN_ISSUE_CODES`, `FURNITURE_COMMAND_ERROR_CODES`, `FURNITURE_COMMANDS`, `FURNITURE_ISSUE_CODES`, `BOM_ISSUE_CODES`, `PART_NAMES_EN`, `HARDWARE_REASON_KEYS` (export it from `rules/hardware.ts` here if not yet exported), `CHANGE_MESSAGE_KEYS`, `TEMPLATES`).
- Produces: the seven ICU lang files (P1's `php artisan i18n:export` picks them up; if P1 already created any of these files, merge keys instead of overwriting); coverage gate.

- [ ] **Step 1: Write the failing tests** — `messageKeys.test.ts` runs `php -r` (via `execFileSync('php', …)`) to `json_encode` the seven files, flattens to dot keys (`engine.units.error.empty`, …) and asserts presence of: `engine.units.error.{code}`; `engine.plan.command.{code}` and `engine.plan.command.label.{snake(type)}` for all 43 plan commands; `engine.plan.derive.{code}`; `engine.plan.snap.kind.{kind}` + `engine.plan.snap.opening_no_fit|opening_overlap`; `engine.plan.conflict.{kind}`; `engine.plan.issue.{rule}`; `engine.furniture.command.{code}` and `engine.furniture.command.label.{snake(name)}` for the 28 furniture commands; `issues.{code}` for every furniture and BOM issue code (English texts of 07 §7.3); `parts.{name}` for every `PART_NAMES_EN` key; `hardware.reason.{key}` (07 §6.12); `changes.{key}` (07 §10.2 incl. `parts_*_many`, `edge_band_changed`, `finish_changed`, `section_*`); `templates.{key}.name|description` for 19 keys, every field `labelKey`/`helpKey`, every select option `templates.options.{value}`, `templates.range`; `sections.interior|column|row`. Every value is a non-empty string. `publicApi.test.ts` asserts `engine/index.ts` exports every public name listed in this plan's *Produces* blocks (list in the test) and nothing from `testing/`.
- [ ] **Step 2: Run it, expect FAIL** — `yarn vitest run resources/js/engine/__tests__/messageKeys.test.ts resources/js/engine/__tests__/publicApi.test.ts`
- [ ] **Step 3: Implement** — PHP files `<?php declare(strict_types=1); return [ … ];` with nested arrays and ICU values (`{count}`, `{direction, select, up {increased} other {decreased}}`); optional params of 07 §1.6 (`Back panel {n?}`) are written as an ICU `select` on the param; English texts from the spec tables. Coverage thresholds `lines: 90` for `resources/js/engine/{units,geometry,plan}/**` excluding `**/testing/**`, `**/__tests__/**`, `**/__perf__/**`.
- [ ] **Step 4: Run tests, expect PASS** — `yarn vitest run` (whole suite) and `yarn test:coverage:engine` (thresholds met)
- [ ] **Step 5: Quality gates** — `yarn eslint resources/js engine-cli && yarn prettier --check resources/js engine-cli && yarn vue-tsc --noEmit && php -l resources/lang/en/engine.php`
- [ ] **Step 6: Commit** — `git add resources/lang/en resources/js/engine/__tests__ vitest.config.ts package.json yarn.lock` → `feat(engine): add engine translation keys and coverage gate`

---

## Self-review

### Spec coverage (requirement → task)

| Requirement | Task |
|---|---|
| 01 §5.1 purity (ESLint rule + Node import test), allowed deps | 1 |
| 01 §5.2 module tree incl. `version.ts`, `ids.ts`, `money.ts`, units, geometry, plan, furniture, bom, catalog, commands | 1–45 |
| 01 §5.3 catalog snapshot shape incl. inactive rows | 29 |
| 01 §5.4 CLI: 8 commands, protocol, exit codes, Vite build to `dist/cli.mjs`, `yarn build:engine-cli` in `yarn build` | 48 |
| 01 §5.5 worker RPC (`computeBom`, `nestSheets`, `derivePlanGeometry`, `estimateFurniture`), stale cancellation, fallback | 49 |
| 03 §1 plan types / §1.1 invariants / §1.2 derived geometry | 8, 10–11, 13 |
| 03 §2 furniture document / §2.4 save-blocking codes | 30, 37 |
| 03 §3.1–§3.4 model, BOM, price, change items; §3.6 keys | 30–45 |
| 03 §4 migrations (registry + no-op test) | 8, 30 |
| 03 §6 fixtures (2 plans, 6 furniture) | 14, 31, 40 |
| 04 §1 units (every table row, fuzz, round trip) | 4 |
| 04 §2 primitives, clip, triangulate | 3, 5 |
| 04 §3 node joins, outlines, faces, openings, poché, caps, exterior | 9–11 |
| 04 §4 planar faces, nesting, room association/re-association, net polygons, faceKey, polylabel, summary | 6, 11, 13, 21 |
| 04 §5 snapping, opening/footprint snapping, footprints, conflicts, hit index | 15–17, 19 |
| 04 §6 command bus, pipeline, post-process, helpers, all 43 commands incl. `rescalePlan`, `calibrateBackground` | 20–28 |
| 04 §7 deriver caching + budgets | 12, 50 |
| 04 §8 drawing model, SVG | 18–19 |
| 04 §10 coverage ≥ 90 %, lint restrictions, CLI snapshots, message keys | 1, 48, 51 |
| 05 §9 fixture library data | 7 |
| 06 §7.8 room-name dictionary (TS mirror) | 7 |
| 07 §1 constants, makePart, catalog index, part names | 29–30 |
| 07 §2 template catalogue (19) + presets `reidentify` + property test | 31, 39–40 |
| 07 §3 generation pipeline, envelope, panels, back split, plinth, countertop, layout, contents, drawers, tables, overrides | 32–38 |
| 07 §4 fronts | 34–35 |
| 07 §5 banding/grain/visible faces | 30, 32–38 |
| 07 §6 hardware rules | 33–36 |
| 07 §7 validation, sag | 37 |
| 07 §9 furniture commands | 41 |
| 07 §10 diff + highlight | 45 |
| 07 §12 required tests (wardrobe 20 parts, drawers, construction, diff, perf) | 31–45, 50 |
| 08 §1 money + shared fixtures | 2 |
| 08 §2 snapshot + specs | 29 |
| 08 §3 computeBom | 42–43 |
| 08 §4 pricing incl. ₹24,313 example, `displayUnitPrice` | 44 |
| 08 §5 nesting (normative code) | 43 |
| 08 §6.3 quote totals TS port + `tests/fixtures/quotes` | 47 |
| 08 §7 seed catalog (as test catalog JSON) | 29 |
| 08 §8.1 cut list CSV | 46 |
| 08 §9.2–§9.3 CLI `compute-bom` contract, budgets | 48, 50 |
| Review focus 1–5 | 28, 5/6/9, 36, 48, 49 |

Out of scope here (owned elsewhere): `vision/tests/fixtures/reference/*.expected.json` and the Python room-name key-parity test (P3); PHP `MinorMath`/`QuoteCalculator` consuming the shared fixtures (P7); `CatalogSeeder`/`BuildCatalogSnapshot` (P5, may compare against `tests/fixtures/catalog/seed-snapshot.json`); Laravel `EngineCli` wrapper (P5); editor/builder UIs (P4/P5).

### Step scan, types, proportion

- Every task has the six steps with exact commands; no step says "handle edge cases" or "add tests" without naming them.
- Names are defined once in an *Interfaces → Produces* block and consumed by later tasks with the same spelling (`DerivedPlan`, `PlanCommandContext`, `GenContext`, `CatalogIndex`, `Bom`, `PriceBreakdown`, `estimateFurniture`, `EngineInputError`, `testIds`, `seedCatalog`).
- Task count is 51, above the 30–45 estimate: the plan-command and furniture-generator areas are split so that each task keeps one reviewable test cycle (merging them would produce tasks with several hundred lines of unrelated assertions).
- Spec tables (template rules, formulas, issue catalogue, command semantics) are referenced, not copied; only test values are copied. The only code reproduced is pinned behaviour the spec itself gives as code (08 §5.3 is pasted by the implementer from the spec, not from this plan).

### Spec gaps found (resolved here; record in the PR description)

1. Message-key patterns for plan validation issues, furniture/BOM issues and furniture command errors are unspecified → pinned in *Plan conventions*; the numeric-range rule of 03 §1.1 has no code → `plan.value_out_of_range`.
2. 15 §15.2 limits keys to depth 4 and lists no `sections` namespace, but 04/07 define `engine.plan.command.label.*` (depth 5) and `sections.*` → spec keys kept as written.
3. 03 §5 server step 4 reads `bbox` from `validate-furniture`, which 01 §5.4 does not return → `bbox` added to the result.
4. "Orphan nodes auto-fixed on save" has no owner → `validate-plan` returns `migratedDocument` with orphans removed.
5. 04 §6.1 `CommandDef` lacks the zod params schema required by 04 §6.7 and the `Pipeline` type → `paramsSchema`, `labelParams`, `Pipeline` pinned in Task 20.
6. `bookshelf-5shelf.json` cannot be the bookshelf defaults (4 shelves) → generated with `height: 2100`.
7. 03 §6 plan fixtures give room lists but no geometry; 04 §9 requires "≥ 9 rooms" → coordinates and expected areas pinned in Task 14 (10 and 8 rooms); P3's `*.expected.json` must derive from them.
8. 08 §4.3 says hinge installation counts hinges "plates included", but the 08 §4.7 worked example counts 12 (hinges only) → hinges only.
9. 07 §12.7's "3600-wide 6-door wardrobe ≈ 60 parts" yields ≈ 25 parts with defaults → perf fixture adds internal drawers (≈ 50 parts).
10. Template field `labelKey`s / option labels and quote-fixture JSON shape (tax rate names, `untaxed-group` numbers) unspecified → pinned (Tasks 31, 47).
11. 04 §5.6 grid majors for 10 000 mm and 50′ unspecified → ×10 and ×2.
12. ICU rendering of optional params (`Back panel {n?}`) depends on P1's `t()` handling of missing arguments → flagged for P1.
13. CLI error codes other than `invalid_input` unspecified → `unknown_command`, `invalid_json`, `engine_error`.
14. Task 51's key check needs `php` on the frontend CI runner (P1/P9 CI config).
