# Task 7 report: projects, plans, plan_revisions, JsonDocument / AsJsonDocument

Status: DONE. Commit 9a1faab `feat(projects): projects, plans and revisions schema with JSON document cast` (base 208332f).

## Implemented
- Migrations 040000 projects, 040100 plans, 040200 plan_revisions, 040300 FK `plans.current_revision_id` -> plan_revisions (N). Columns, types, defaults, indexes per 02 §3.1-§3.3; FKs: projects.owner_id R (`restrictOnDelete`), created_by/site_address_id N, plans.project_id C, working_saved_by/locked_by/current_revision_id N, plan_revisions.plan_id C, author_id N. Index names are the Laravel defaults. `down()` of 040300 drops the FK; rollback --step=4 and re-migrate verified.
- Enums PropertyType, ProjectStatus, PlanSource, PlanRevisionReason (`#[TypeScript]`; `resources/js/types/generated.d.ts` regenerated and committed).
- `App\Support\Json\JsonDocument` (decode keeps empty objects as stdClass, encode flags as briefed) and `App\Support\Casts\AsJsonDocument`.
- Models Project (SoftDeletes; owner/createdBy/plans/siteAddress; media `cover`, s3-public, png/webp, single), Plan (SoftDeletes; project/revisions/currentRevision/lockedBy/isLocked; media `thumbnail`, s3, png, single, conversion `small` width 320), PlanRevision (`UPDATED_AT = null`, `updating` listener throws LogicException; plan()/author()). `User::projects()` (owner_id). MorphMap: `project`, `plan`, `plan_revision`. All @property docblocks use CarbonImmutable.
- `Database\Factories\Support\Documents::emptyPlan(array $metaOverrides = [])` (exact 03 §1 shape, records are stdClass) plus `Documents::plan($name)` (`empty`, or JSON from `database/fixtures/plans` / `plan-starters`; throws InvalidArgumentException when absent).
- Factories (16 §5.1 vocabulary, spec wins over brief where they differ): Project `forCustomer($u)`, `archived()`, `withSiteAddress()` (address belongs to owner), `createdByStaff($s)`; default `created_by` = owner. Plan `fromFixture($name)`, `imported()`, `traced()`, `duplicated()`, `locked(?User $staff = null)` (brief's no-arg form works too), `withRevisions(int)` (sets current_revision_id to the last), `withThumbnail()`. PlanRevision `manualCheckpoint()`, `importAccepted()`, `beforeRestore()`, `staffEdit()`, `autoDaily()` plus the brief's `reason(PlanRevisionReason)`.

## Rulings applied
- I1: cascade/restrict tests use `forceDelete()` on SoftDeletes models (owner restrict, project cascade). A separate test shows a soft-deleted project keeps its plans/revisions.
- Docblocks CarbonImmutable; MorphMap updated; no global functions in tests; Pest `uses` from Pest.php (LazilyRefreshDatabase for Feature).

## TDD evidence
- RED: `vendor/bin/pest tests/Unit/Support/JsonDocumentTest.php tests/Feature/Schema/ProjectsSchemaTest.php tests/Feature/Models/PlanTest.php` before implementation: `Tests: 39 failed (12 assertions)`; cause `Class "App\Support\Json\JsonDocument" not found` / missing tables, as expected.
- GREEN: same command: `Tests: 38 passed (255 assertions)` (the 39 -> 38 difference is one test I dropped, see below).

## Gates
- `vendor/bin/pint` passed; `vendor/bin/phpstan analyse` [OK] No errors (level 8); `vendor/bin/pest tests/Unit tests/Feature`: 273 passed (1485 assertions), output pristine; `typescript:transform` + `i18n:export` run, generated.d.ts diff (4 enums) committed, i18n output unchanged. Gates-JS not run (no JS changes beyond the generated type file).

## Notes / concerns (all minor)
1. `jsonb` normalises key order and spacing, so a stored document comes back with keys re-ordered (e.g. `meta` before `view`). `{}` vs `[]` is preserved, which is what the cast guarantees; nothing may depend on key order of stored documents.
2. (Resolved in fix round 1, see below.) AsJsonDocument now implements ComparesCastableAttributes.
3. `plans.summary` uses the plain `array` cast per the brief ("`{}` decoded to `[]`"), so assigning an empty PHP array writes `[]`, not `{}`. The summary writer (engine `plan-summary`) always has members, but a later task should not write an empty summary array.
4. `JsonDocument::decode` of a top-level `{}` returns `[]` (the `array` return type has no empty-object form); a top-level scalar throws JsonException. Objects keyed solely by `0..n-1` would re-encode as lists; document ids are prefixed strings, noted in the class docblock.
5. Fillable lists exclude owner_id, working_version/saved_*, current_revision_id and lock columns (set by actions / relation / factories). Plan::fillable includes `working_document`; the future save action must still bump version itself.
6. `Plan::fromFixture('hdb-3room' | 'brochure-2bhk' | 'rect-4000x3000')` depends on `database/fixtures/*` that no P1 task creates yet; only `empty` is usable now (unknown names throw). `withThumbnail()` stores a 1x1 PNG and runs the sync `small` conversion (works with GD in this environment).

## Files
Created: database/migrations/2026_10_20_04{0000,0100,0200,0300}_*.php; app/Domain/Projects/Models/{Project,Plan,PlanRevision}.php; app/Domain/Projects/Enums/{PropertyType,ProjectStatus,PlanSource,PlanRevisionReason}.php; app/Support/Json/JsonDocument.php; app/Support/Casts/AsJsonDocument.php; database/factories/Support/Documents.php; database/factories/Domain/Projects/{Project,Plan,PlanRevision}Factory.php; tests/Unit/Support/JsonDocumentTest.php; tests/Feature/Schema/ProjectsSchemaTest.php; tests/Feature/Models/PlanTest.php.
Modified: app/Domain/Identity/Models/User.php, app/Support/MorphMap.php, resources/js/types/generated.d.ts.

## Fix round 1
Changes:
1. `ProjectFactory::withSiteAddress()` now uses a callable attribute (`site_address_id => fn (array $a) => Address::factory()->state(['user_id' => $a['owner_id']])`), evaluated after `owner_id` is resolved, so the address always belongs to the project owner with or without `forCustomer()`. New test: default `withSiteAddress()` gives `siteAddress->user_id === owner_id` and creates only one user.
2. `AsJsonDocument` implements `ComparesCastableAttributes`: both raw values are decoded, object keys sorted recursively (lists keep order), re-encoded and compared as strings; null only equals null; `{}` and `[]` remain different. New tests: identical array / JSON string / key-reordered re-assignment is not dirty, a real change is dirty, `nodes {}` -> `[]` is dirty, and an unchanged `PlanRevision` can be `save()`d without LogicException.
3. `PlanFactory::locked()` evaluates `now()` lazily (`locked_at => static fn () => now()->toImmutable()`).

Tests: `vendor/bin/pest tests/Unit/Support/JsonDocumentTest.php tests/Feature/Schema/ProjectsSchemaTest.php tests/Feature/Models/PlanTest.php` -> 42 passed (263 assertions); full `vendor/bin/pest tests/Unit tests/Feature` run before commit; `vendor/bin/pint` passed; `vendor/bin/phpstan analyse` [OK] No errors.
