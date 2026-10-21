### Task 9: Furniture and blueprint-import schema

**Files:**
- Create: migrations `2026_10_20_060000_create_furniture_presets_table`, `_060100_create_furniture_template_settings_table`, `_060200_create_furniture_designs_table`, `_060300_create_furniture_revisions_table`, `_060400_add_current_revision_fk_to_furniture_designs_table`, `_070000_create_blueprint_imports_table`; `app/Domain/Furniture/Models/{FurnitureDesign,FurnitureRevision,FurniturePreset,FurnitureTemplateSetting}.php`; `app/Domain/Furniture/Enums/{PresetCategory,BomStatus,FurnitureRevisionReason,AuthorKind}.php`; `app/Domain/Imports/Models/BlueprintImport.php`; `app/Domain/Imports/Enums/{ImportStatus,ImportMode,ImportSourceKind}.php`; `app/Domain/Ai/Enums/AiProvider.php`; factories
- Modify: `Documents` (add `placeholderFurniture(string $templateKey = 'wardrobe'): array`), `Project` (`furnitureDesigns()`, `blueprintImports()`), `MorphMap`
- Test: `tests/Feature/Schema/FurnitureImportsSchemaTest.php`, `tests/Feature/Models/FurnitureTest.php`, `tests/Feature/Models/BlueprintImportTest.php`

**Spec refs:** `02 §4.1`, `§5.1–§5.4`, `§10`, `§11`, `§12`, `§15` groups 6–7; `06 §4.2`; `03 §2` (top-level FurnitureDocument keys)

**Interfaces:**
- Consumes: Tasks 4–8.
- Produces: models with casts (`working_document`/`document`/`result_document` → `AsJsonDocument`; `estimate`, `bom`, `price`, `change_summary`, `hints`, `result_meta`, `default_overrides` → array; enums), media collections exactly as `02 §10` (`FurnitureDesign.thumbnail` s3 + `small` 320w; `FurnitureRevision.cutlist_pdf` s3 single pdf; `FurniturePreset.thumbnail` s3-public + `small`; `BlueprintImport.source`/`normalized` (single, s3, `normalized` conversion `preview` 1600w webp queued)/`debug`/`pages`); `FurnitureRevision` immutable like `PlanRevision`; `BlueprintImport::isTerminal(): bool` (`accepted, discarded, failed, cancelled`) and `isActiveRun(): bool` (`queued, preprocessing, recognizing`); enums `PresetCategory` (9), `BomStatus` (`pending, ready, failed`), `FurnitureRevisionReason` (`manual_checkpoint, order_submitted, staff_proposal, proposal_applied, before_restore`), `AuthorKind` (`customer, staff`), `ImportStatus` (9 values of `02 §4.1`), `ImportMode` (`auto, trace`), `ImportSourceKind` (`raster, pdf_vector, pdf_raster, dxf, heic`), `AiProvider` (`anthropic, openai, openai_compatible, none`). `Documents::placeholderFurniture()` is a structural placeholder (schemaVersion 1, templateKey, family `carcass`, dims, materials for all 9 roles using seed codes) — P5 switches factories to the P2 fixtures. `furniture_designs.locked_by_order_id` exists without FK (Task 11 adds it).

- [ ] **Step 1: Write the failing tests**
  - `FurnitureImportsSchemaTest`: columns per `02 §4.1`, `§5.1–§5.4`; defaults (`bom_status 'pending'`, `status 'uploaded'`, `mode 'auto'`, `selected_page 1`, `hints '{}'`, `review_version 1`, `credits_* 0`, `estimate '{}'`, `default_overrides '{}'`); unique `furniture_presets.slug`, unique `(furniture_design_id, number)`; indexes `furniture_designs(project_id, updated_at)`, `(locked_by_order_id)`, `blueprint_imports(user_id, created_at)`, `(status)`; `furniture_template_settings` PK `template_key`; `furniture_revisions` has `created_at` only.
  - `FurnitureTest`: revision update throws `LogicException`; deleting a project cascades designs → revisions; deleting a preset nulls `furniture_designs.preset_id`; registered media collections have the names/disks/single-file flags above.
  - `BlueprintImportTest`: dataset over the 9 statuses for `isTerminal()`/`isActiveRun()`; deleting the target plan nulls `plan_id`; deleting the uploading user is restricted (R); `hints` round-trips `{"corners":[[0.1,0.1],[0.9,0.1],[0.9,0.9],[0.1,0.9]]}`.
- [ ] **Step 2: Run, expect FAIL** — `vendor/bin/pest tests/Feature/Schema/FurnitureImportsSchemaTest.php tests/Feature/Models`
- [ ] **Step 3: Implement** — per Files/Interfaces.
- [ ] **Step 4: Run tests, expect PASS** — same as Step 2.
- [ ] **Step 5: Quality gates** — Gates-PHP, Gates-Gen.
- [ ] **Step 6: Commit** — `git add database/migrations app/Domain/Furniture app/Domain/Imports app/Domain/Ai/Enums database/factories app/Domain/Projects app/Support/MorphMap.php tests resources/js` → `feat(schema): furniture designs, revisions, presets and blueprint imports` + trailer.

