# Task 51 — carries (binding; preflight C2, C3, C5, C6, C17 + ledger)

1. C2: only ADD the `test:coverage:engine` script; `@vitest/coverage-v8` is already a devDependency (P1). No new dependency.
2. C5: v8 coverage thresholds per glob — engine-wide (`resources/js/engine/**`) 90 % lines / 85 % branches, plus units/geometry/plan ≥ 90 % lines; exclude `**/testing/**`, `**/__tests__/**`, `*.bench.ts`. Do NOT set editor/lib/composables thresholds (P4/P5 own them). Ledger ruling (P1 Task 1 review): add coverage.exclude for generated code (wayfinder output, generated types) and kit `ui/**` before thresholds.
3. C6: plan-issue messageKey = `'plan_editor.issues.' + rule` (rule = code minus `plan.`). P2 writes NO texts for these keys (P4 owns plan_editor.php); Task 51 only asserts the key pattern for plan issues. Fix any plan text / constraint wording still saying `engine.plan.issue.*`.
4. C17: keep the 07 §3.7 `sections.interior|column|row` literals; create `resources/lang/en/sections.php`. engine.* label keys of depth 5 are an accepted exception.
5. Furniture/BOM issue keys are `engine.furniture.issue.<code minus 'furniture.'>` and `engine.bom.issue.<code minus 'bom.'>` (Task 30/43 rulings) — the coverage test must use these, not the plan's `issues.*`.
6. Engine lang strings are ICU (e.g. `{leaves}`); `hinges_for_door` takes param `{leaves}`. Include strings for panel_split, panel_seam_unsupported, table_drawers_dont_fit, apron_inset_clamped. Piece-name wording: 'Fixed shelf 2 – piece 3' (en dash).
7. Exempt from the translation-coverage gate (spec-fixed English): CHANGE_FIELD_LABELS_EN, diff front-kind/role English names, CutListRow.name, PriceBreakdown.lines[].description, CSV export.
8. Dedupe: bom/intMath.ts duplicates money.ts safe-int / ceil-div helpers — keep one (money.ts), update imports, tests green.
9. Ledger ruling (units parser, Task 3): thousands regex gets a `(?!\d)` guard (so '1,2345' → decimal-comma branch, not 12345) and ´ is mapped before NFKC — both with pinned tests.
10. C3/E2: the lang test may shell out to PHP (`php artisan i18n:export` or reading lang files) — furny-env.sh puts PHP 8.4 on PATH; use `execFileSync('php', …)` without POSIX-only paths.
11. After adding lang files run `php artisan i18n:export` and commit the generated output (Gates-Gen must show no diff).
