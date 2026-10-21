### Task 7: Projects and plans schema, `AsJsonDocument`

**Files:**
- Create: migrations `2026_10_20_040000_create_projects_table`, `_040100_create_plans_table`, `_040200_create_plan_revisions_table`, `_040300_add_current_revision_fk_to_plans_table`; `app/Domain/Projects/Models/{Project,Plan,PlanRevision}.php`; `app/Domain/Projects/Enums/{PropertyType,ProjectStatus,PlanSource,PlanRevisionReason}.php`; `app/Support/Json/JsonDocument.php`; `app/Support/Casts/AsJsonDocument.php`; `database/factories/Support/Documents.php`; factories `ProjectFactory`, `PlanFactory`, `PlanRevisionFactory`
- Modify: `User` (`projects()`), `MorphMap` (`project`, `plan`, `plan_revision`)
- Test: `tests/Feature/Schema/ProjectsSchemaTest.php`, `tests/Unit/Support/JsonDocumentTest.php`, `tests/Feature/Models/PlanTest.php`

**Spec refs:** `02 §3`, `§10` (Project cover, Plan thumbnail), `§11`, `§12`, `§15` group 4; `03 §1` (PlanDocument top-level shape), `§5`; P1-D13

**Interfaces:**
- Consumes: Tasks 4–6.
- Produces: `JsonDocument::decode(string $json): array` (assoc arrays, but every empty JSON object becomes `new \stdClass()`; throws `JsonException`), `JsonDocument::encode(array $doc): string` (`JSON_PRESERVE_ZERO_FRACTION | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR`); cast `AsJsonDocument` (get = decode, set accepts array or JSON string); models `Project` (SoftDeletes; `owner()`, `createdBy()`, `plans()`, `siteAddress()`; media `cover` on `s3-public`), `Plan` (SoftDeletes; `project()`, `revisions()`, `currentRevision()`, `lockedBy()`, `isLocked(): bool`; media `thumbnail` on `s3` with conversion `small` 320w), `PlanRevision` (`const UPDATED_AT = null`; updating throws `LogicException`); enums `PropertyType` (`apartment, independent_house, villa, office, other`), `ProjectStatus` (`active, archived`), `PlanSource` (`drawn, imported, traced, duplicated`), `PlanRevisionReason` (`manual_checkpoint, import_accepted, before_restore, staff_edit, auto_daily`); `Documents::emptyPlan(array $metaOverrides = []): array` (schemaVersion 1, meta `{defaultWallHeight: 2700, defaultWallThickness: 115, floorThickness: 150, northAngle: null, createdWith: 'editor'}`, empty-object records `nodes, walls, openings, rooms, placements, fixtures`, `annotations {dimensions: {}, labels: {}}`, `background: null`, `view {mode2d: null, mode3d: null, lastMode: '2d'}`). Factory states: `Project::archived()`, `Plan::locked()`, `Plan::imported()`, `Plan::traced()`, `PlanRevision::reason(PlanRevisionReason)`.

- [ ] **Step 1: Write the failing tests**
  - `JsonDocumentTest` (Review Focus 4): `JsonDocument::encode(JsonDocument::decode('{"nodes":{},"walls":{},"angle":90.0,"list":[],"n":{"a":{}}}')) === '{"nodes":{},"walls":{},"angle":90.0,"list":[],"n":{"a":{}}}'`; invalid JSON throws `JsonException`.
  - `PlanTest`: a plan saved with `Documents::emptyPlan()` and reloaded keeps `{}` records (`JsonDocument::encode($plan->fresh()->working_document)` contains `"nodes":{}`); `working_version` default 1, `schema_version` 1, `summary` default `{}` decoded to `[]` array; `PlanRevision::factory()->create()->update(['label' => 'x'])` throws `LogicException`; unique `(plan_id, number)` enforced; `isLocked()` true for `locked()`; deleting a project cascades plans and revisions; deleting the owner user with projects throws (R); deleting the `current_revision` nulls `plans.current_revision_id`.
  - `ProjectsSchemaTest`: columns per `02 §3.1–§3.3`; `plan_revisions` has no `updated_at`; indexes `projects(owner_id, status, updated_at)`, `plans(project_id, level_index)`; defaults `property_type 'apartment'`, `status 'active'`, `plans.name 'Ground floor'`.
- [ ] **Step 2: Run, expect FAIL** — `vendor/bin/pest tests/Unit/Support/JsonDocumentTest.php tests/Feature/Schema/ProjectsSchemaTest.php tests/Feature/Models/PlanTest.php`
- [ ] **Step 3: Implement** — decode walks the result of `json_decode($json, false, 512, JSON_THROW_ON_ERROR)` converting `stdClass` with properties → array (recursively) and keeping empty `stdClass` instances.
- [ ] **Step 4: Run tests, expect PASS** — same as Step 2.
- [ ] **Step 5: Quality gates** — Gates-PHP, Gates-Gen.
- [ ] **Step 6: Commit** — `git add database/migrations app/Domain/Projects app/Support/Json app/Support/Casts database/factories app/Domain/Identity/Models/User.php app/Support/MorphMap.php tests resources/js` → `feat(projects): projects, plans and revisions schema with JSON document cast` + trailer.

