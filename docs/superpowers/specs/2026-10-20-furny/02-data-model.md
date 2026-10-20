# 02 — Data Model

Read the master document first. This file is the **single source of truth for the database schema**. If a section file needs a column that is not here, it must not invent one — it must be added here first (in review).

## 0. Conventions

- PostgreSQL 18. Laravel migrations, one migration file per table (plus separate migrations for cross-table FKs if ordering requires). Migration file names: `YYYY_MM_DD_HHMMSS_create_{table}_table.php` with timestamps ordered as listed in §15.
- `id`: `ulid` primary key (`$table->ulid('id')->primary()`) unless stated otherwise.
- `timestampsTz()` on every domain table (`created_at`, `updated_at` as `timestamptz`).
- `softDeletesTz()` only where stated.
- Enums: `string` columns (`varchar(32)` unless stated) backed by PHP `enum`s in `app/Domain/*/Enums`. Values listed here are exhaustive.
- Money: `bigInteger(..._minor)`; never nullable unless stated; default 0.
- Lengths: `integer` mm. Areas: `bigInteger` mm².
- JSON: `jsonb`. Validate shape in PHP via Data objects or the engine CLI before writing.
- FK naming: `foreignUlid('project_id')->constrained()->cascadeOnDelete()` etc. ON DELETE behaviour is specified per FK: **C** = cascade, **R** = restrict, **N** = set null.
- Index naming: Laravel defaults.
- "Indexes" lists only non-PK, non-FK-default indexes (Laravel `foreignUlid()->constrained()` does **not** create an index in PostgreSQL — add `->index()` explicitly where listed).

---

## 1. Identity

### 1.1 `users`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | ulid PK | | | |
| type | string(16) | no | | `customer` \| `staff` |
| name | string(120) | no | | |
| email | string(254) | yes | | unique (case-insensitive: store lower-cased) |
| email_verified_at | timestamptz | yes | | |
| phone_e164 | string(20) | yes | | unique; E.164 |
| phone_verified_at | timestamptz | yes | | |
| password | string | yes | | null for OTP-only/Google-only users |
| google_id | string(64) | yes | | unique |
| avatar_media_id | — | | | (avatar via medialibrary collection `avatar`, no column) |
| unit_system | string(8) | no | `'metric'` | `metric` \| `imperial` |
| length_unit | string(4) | no | `'mm'` | editor input unit when metric: `mm` \| `cm` \| `m`; when imperial: `ftin` \| `in` |
| locale | string(8) | no | `'en'` | |
| timezone | string(64) | no | `'Asia/Kolkata'` | IANA; default copied from business setting at creation |
| is_active | boolean | no | true | deactivated users cannot log in |
| last_login_at | timestamptz | yes | | |
| two_factor_secret / two_factor_recovery_codes / two_factor_confirmed_at | per Fortify | yes | | staff 2FA (required for owner/admin, see 13) |
| remember_token | string(100) | yes | | |
| marketing_opt_in | boolean | no | false | |
| notes_internal | text | yes | | staff-only notes about a customer |
| timestamps, softDeletesTz | | | | soft delete = anonymisation flow in 13 |

Indexes: unique(`email`) where not null (partial unique), unique(`phone_e164`) where not null, unique(`google_id`) where not null, index(`type`, `created_at`).
Constraint: at least one of `email`, `phone_e164` not null (CHECK).

### 1.2 `addresses`

| Column | Type | Null | Notes |
|---|---|---|---|
| id | ulid | | |
| user_id | ulid FK users **C** | no | |
| label | string(60) | yes | "Home", "Site" |
| line1 | string(200) | no | |
| line2 | string(200) | yes | |
| city | string(100) | no | |
| region | string(100) | yes | state/province |
| postal_code | string(20) | yes | |
| country_code | char(2) | no | ISO-3166-1 alpha-2 |
| latitude, longitude | decimal(10,7) | yes | optional, not used for logic |
| timestamps | | | |

### 1.3 `otp_codes`

| Column | Type | Null | Notes |
|---|---|---|---|
| id | ulid | | |
| phone_e164 | string(20) | no | index |
| purpose | string(16) | no | `login` \| `verify_phone` |
| channel | string(16) | no | `whatsapp` \| `sms` |
| code_hash | string(255) | no | `Hash::make` of 6-digit code |
| attempts | smallint | no | default 0; max 5 |
| expires_at | timestamptz | no | now + 10 min |
| consumed_at | timestamptz | yes | |
| ip | inet | yes | |
| timestamps | | | |

### 1.4 `notification_preferences`

| Column | Type | Null | Notes |
|---|---|---|---|
| id | ulid | | |
| user_id | ulid FK users **C** | no | |
| event_key | string(64) | no | from event catalogue in `12` |
| channel | string(16) | no | `database` \| `mail` \| `whatsapp` \| `sms` \| `webpush` |
| enabled | boolean | no | |
| timestamps | | | |

Unique(`user_id`, `event_key`, `channel`). Absence of a row = event default from `config/notification_events.php`.

### 1.5 Framework/package tables (created by their packages' migrations, unchanged unless stated)

- `password_reset_tokens`, `sessions` (database driver NOT used — sessions in Redis; still publish the migration for completeness), `cache`, `jobs`, `job_batches`, `failed_jobs`.
- `permissions`, `roles`, `model_has_permissions`, `model_has_roles`, `role_has_permissions` (spatie; `model_morph_key` must be configured as **string** with `model_has_*.model_id` column type `char(26)` since users use ULIDs — set `'model_morph_key' => 'model_id'` and change the published migration column to `$table->ulid('model_id')`).
- `media` (spatie medialibrary; `model_id` column changed to `ulidMorphs('model')` style: `string model_type`, `char(26) model_id`).
- `activity_log` (spatie; `subject_id`/`causer_id` changed to `char(26)` nullable via `nullableUlidMorphs`).
- `notifications` (Laravel database notifications; `notifiable_id` as `char(26)` via `ulidMorphs('notifiable')`).
- `push_subscriptions` (webpush package; `subscribable_id` as `char(26)`).
- `pulse_*`, `telescope_*` per packages.

---

## 2. Settings

### 2.1 `app_settings`

| Column | Type | Null | Notes |
|---|---|---|---|
| key | string(100) PK | no | dot notation group key, e.g. `business`, `pricing`, `ai`, `units`, `workflow`, `notifications`, `catalog.version` |
| value | jsonb | no | |
| updated_by | ulid FK users **N** | yes | |
| timestamps | | | |

Typed access via `App\Support\Settings\Settings::get(SettingsGroup::Business)` returning a Data object; cached in Redis (`settings:{key}`), cache busted on update. The groups, their fields and defaults are defined in §13 of this file.

### 2.2 `number_sequences`

| Column | Type | Notes |
|---|---|---|
| key | string(40) PK | e.g. `order:2026` |
| last_value | bigint | |
| timestamps | | |

---

## 3. Projects & plans

### 3.1 `projects`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | ulid | | | |
| owner_id | ulid FK users **R** | no | | the customer (staff may create on behalf of a customer; `owner_id` is still the customer) |
| created_by | ulid FK users **N** | yes | | actual creator |
| name | string(120) | no | | "My apartment" |
| property_type | string(24) | no | `'apartment'` | `apartment` \| `independent_house` \| `villa` \| `office` \| `other` |
| site_address_id | ulid FK addresses **N** | yes | | |
| notes | text | yes | | |
| status | string(16) | no | `'active'` | `active` \| `archived` |
| cover_media | — | | | medialibrary collection `cover` (auto-generated 3D thumbnail) |
| timestamps, softDeletesTz | | | | |

Indexes: (`owner_id`, `status`, `updated_at`).

### 3.2 `plans`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | ulid | | | |
| project_id | ulid FK projects **C** | no | | |
| name | string(80) | no | `'Ground floor'` | |
| level_index | smallint | no | 0 | display order; 0 = ground, negative = basement |
| source | string(16) | no | | `drawn` \| `imported` \| `traced` \| `duplicated` |
| working_document | jsonb | no | | current `PlanDocument` (see 03) |
| working_version | integer | no | 1 | optimistic-lock counter, +1 on every successful save |
| working_saved_by | ulid FK users **N** | yes | | |
| working_saved_at | timestamptz | yes | | |
| current_revision_id | ulid FK plan_revisions **N** | yes | | latest checkpoint (FK added in a later migration) |
| schema_version | smallint | no | 1 | of working_document |
| summary | jsonb | no | `'{}'` | denormalised from engine `plan-summary`: `{wallCount, roomCount, totalAreaMm2, rooms:[{id,name,areaMm2}]}`; updated on save |
| thumbnail | — | | | medialibrary collection `thumbnail` (PNG 800×600, uploaded by the editor on save, debounced 60 s) |
| timestamps, softDeletesTz | | | | |

Indexes: (`project_id`, `level_index`).

### 3.3 `plan_revisions`

| Column | Type | Null | Notes |
|---|---|---|---|
| id | ulid | | |
| plan_id | ulid FK plans **C** | no | |
| number | integer | no | 1..n per plan |
| document | jsonb | no | immutable |
| schema_version | smallint | no | |
| reason | string(24) | no | `manual_checkpoint` \| `import_accepted` \| `before_restore` \| `staff_edit` \| `auto_daily` |
| label | string(120) | yes | user-provided label |
| author_id | ulid FK users **N** | yes | |
| created_at | timestamptz | no | (no updated_at: immutable; use `const UPDATED_AT = null`) |

Unique(`plan_id`, `number`).

---

## 4. Blueprint imports

### 4.1 `blueprint_imports`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | ulid | | | |
| project_id | ulid FK projects **C** | no | | |
| plan_id | ulid FK plans **N** | yes | | target plan; null until accepted into a new plan |
| user_id | ulid FK users **R** | no | | who uploaded |
| status | string(24) | no | `'awaiting_upload'` | state machine (see `06` §3): `awaiting_upload` \| `uploaded` \| `queued` \| `preprocessing` \| `recognizing` \| `ready_for_review` \| `accepted` \| `discarded` \| `failed` \| `cancelled` |
| mode | string(16) | no | `'auto'` | `auto` (recognition) \| `trace` (background only, no recognition, no credits) |
| source_kind | string(16) | yes | | detected: `raster` \| `pdf_vector` \| `pdf_raster` \| `dxf` \| `heic` |
| original_filename | string(255) | no | | |
| mime_type | string(100) | yes | | sniffed |
| file_size_bytes | bigint | yes | | |
| page_count | smallint | yes | | for PDFs |
| selected_page | smallint | no | 1 | 1-based |
| hints | jsonb | no | `'{}'` | user hints: `{unitSystem?: 'metric'\|'imperial', knownDimension?: {label, mm}, wallHeightMm?, isPhoto?: bool}` |
| ai_provider | string(24) | yes | | `anthropic` \| `openai` \| `openai_compatible` \| `none` (snapshot at run time) |
| ai_model | string(100) | yes | | |
| credits_reserved | integer | no | 0 | |
| credits_charged | integer | no | 0 | |
| result_document | jsonb | yes | | draft `PlanDocument` |
| result_meta | jsonb | yes | | `ImportResultMeta` (see 06 §6): confidence per entity, scale, detected units, warnings, timings, page image size |
| error_code | string(48) | yes | | see `06` §8 error codes |
| error_message | text | yes | | internal (staff) message |
| attempts | smallint | no | 0 | |
| started_at, finished_at | timestamptz | yes | | |
| timestamps | | | | |

Media collections on the model: `source` (original upload, single file), `normalized` (PNG page image used for recognition and as editor background, single file), `debug` (staff-only overlays, multiple).

Indexes: (`user_id`, `created_at`), (`status`).

---

## 5. Furniture

### 5.1 `furniture_designs`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | ulid | | | |
| project_id | ulid FK projects **C** | no | | |
| owner_id | ulid FK users **R** | no | | customer who owns it (= project owner) |
| created_by | ulid FK users **N** | yes | | |
| name | string(120) | no | | |
| template_key | string(40) | no | | see `07` template catalogue |
| preset_id | ulid FK furniture_presets **N** | yes | | started from |
| working_document | jsonb | no | | `FurnitureDocument` |
| working_version | integer | no | 1 | optimistic lock |
| working_saved_by | ulid FK users **N** | yes | | |
| working_saved_at | timestamptz | yes | | |
| current_revision_id | ulid FK furniture_revisions **N** | yes | | (FK in later migration) |
| locked_by_order_id | ulid FK orders **N** | yes | | non-null ⇒ customer cannot edit (see 09 §2) |
| estimate | jsonb | no | `'{}'` | denormalised client estimate: `{totalMinor, currency, partCount, sheetCount, catalogVersion, engineVersion, computedAt}` (display only; never used for quoting) |
| width_mm, height_mm, depth_mm | integer | no | | denormalised bbox from engine for listings |
| thumbnail | — | | | media collection `thumbnail` |
| timestamps, softDeletesTz | | | | |

Indexes: (`project_id`, `updated_at`), (`locked_by_order_id`).

### 5.2 `furniture_revisions`

| Column | Type | Null | Notes |
|---|---|---|---|
| id | ulid | | |
| furniture_design_id | ulid FK furniture_designs **C** | no | |
| number | integer | no | per design |
| document | jsonb | no | immutable FurnitureDocument |
| schema_version | smallint | no | |
| bom | jsonb | yes | `Bom` computed **server-side** by engine CLI (null until `ComputeRevisionBom` job finishes) |
| price | jsonb | yes | `PriceBreakdown` server-side |
| bom_status | string(16) | no | `pending` \| `ready` \| `failed`; default `pending` |
| engine_version | string(16) | yes | |
| catalog_version | integer | yes | |
| reason | string(24) | no | `manual_checkpoint` \| `order_submitted` \| `staff_proposal` \| `proposal_applied` \| `before_restore` |
| author_id | ulid FK users **N** | yes | |
| author_kind | string(8) | no | `customer` \| `staff` |
| change_summary | jsonb | yes | `ChangeItem[]` vs previous revision (engine diff) |
| created_at | timestamptz | no | immutable |

Unique(`furniture_design_id`, `number`).

### 5.3 `furniture_presets`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | ulid | | | |
| name | string(120) | no | | |
| slug | string(140) | no | | unique |
| template_key | string(40) | no | | |
| category | string(32) | no | | `wardrobe` \| `kitchen` \| `storage` \| `shelving` \| `tv_unit` \| `table` \| `desk` \| `bed` \| `other` |
| description | text | yes | | |
| document | jsonb | no | | FurnitureDocument |
| is_active | boolean | no | true | |
| sort_order | integer | no | 0 | |
| created_by | ulid FK users **N** | yes | | |
| thumbnail | — | | | media `thumbnail` |
| timestamps, softDeletesTz | | | | |

### 5.4 `furniture_template_settings`

Code-defined templates (see `07`) can be toggled and ordered by admins.

| Column | Type | Notes |
|---|---|---|
| template_key | string(40) PK | |
| is_enabled | boolean | default true |
| sort_order | integer | default 0 |
| default_overrides | jsonb | default `'{}'`: partial param defaults merged over code defaults |
| timestamps | | |

---

## 6. Catalog

Every write to any table in this section increments `app_settings['catalog.version']` in the same transaction (implemented in a model `saved`/`deleted` observer calling `CatalogVersion::bump()` inside the surrounding transaction).

### 6.1 `materials` (sheet goods & solid stock)

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | ulid | | | |
| code | string(40) | no | | unique, stable, referenced by documents (e.g. `PB18-WHITE`) |
| name | string(120) | no | | |
| board_type | string(24) | no | | `particle_board` \| `mdf` \| `hdf` \| `plywood` \| `blockboard` \| `solid_wood` \| `glass` \| `acrylic` \| `metal_sheet` |
| thickness_mm | decimal(5,1) | no | | e.g. 18.0, 3.0 |
| sheet_length_mm | integer | no | | along grain (e.g. 2440 / 2800) |
| sheet_width_mm | integer | no | | (e.g. 1220 / 2070) |
| has_grain | boolean | no | false | if true, parts must align their grain axis with sheet length |
| decor_name | string(120) | yes | | "Frosty White", "Natural Oak" |
| color_hex | char(7) | yes | | for 3D/2D when no texture |
| texture | — | | | media `texture` (seamless JPG/WebP, 1024², public disk) |
| surface | string(24) | no | `'melamine'` | `raw` \| `melamine` \| `laminate` \| `veneer` \| `painted` \| `lacquered` \| `pre_laminated` |
| price_per_sheet_minor | bigint | no | | purchase/cost basis per full sheet |
| waste_factor | decimal(4,3) | no | 0.100 | added on top of nested usage for estimate safety |
| density_kg_m3 | integer | yes | | for door weight → hinge count |
| usage | jsonb | no | `'["carcass","shelf","front","back","top"]'` | which part roles may use it (UI filter) |
| default_edge_band_code | string(40) | yes | | matching edge band |
| is_active | boolean | no | true | |
| sort_order | integer | no | 0 | |
| timestamps, softDeletesTz | | | | |

### 6.2 `edge_bands`

| Column | Type | Null | Notes |
|---|---|---|---|
| id | ulid | | |
| code | string(40) | no | unique |
| name | string(120) | no | |
| thickness_mm | decimal(4,2) | no | 0.40, 0.80, 1.00, 2.00 |
| width_mm | integer | no | 22, 28, 45 |
| color_hex | char(7) | yes | |
| price_per_meter_minor | bigint | no | |
| is_active | boolean | no | default true |
| timestamps, softDeletesTz | | | |

### 6.3 `hardware_items`

| Column | Type | Null | Notes |
|---|---|---|---|
| id | ulid | | |
| code | string(40) | no | unique (e.g. `HINGE-CUP35-FO-SC`) |
| name | string(160) | no | |
| category | string(24) | no | `hinge` \| `hinge_plate` \| `drawer_slide` \| `handle` \| `knob` \| `leg` \| `plinth_leg` \| `hanging_rod` \| `rod_support` \| `shelf_support` \| `connector` \| `lock` \| `lift_mechanism` \| `sliding_track` \| `sliding_roller` \| `gas_strut` \| `damper` \| `screw_pack` \| `wall_bracket` \| `led_strip` \| `other` |
| specs | jsonb | no | category-specific typed specs (schema in `08` §2.3), e.g. hinge `{overlay:'full', openingAngle:110, softClose:true, maxDoorWeightKg:…}`, slide `{type:'side_mount', lengthMm:450, loadKg:35, softClose:true, clearancePerSideMm:12.7}`, handle `{lengthMm:160, holeSpacingMm:128}` |
| unit | string(16) | no | `piece` \| `pair` \| `set` \| `meter` \| `pack` |
| price_minor | bigint | no | per unit |
| is_default_for | jsonb | no | default `'[]'`: role keys this item is the default for, e.g. `["hinge.full_overlay","slide.side_mount"]` (see 07 §6) |
| image | — | | media `image` |
| is_active | boolean | no | default true |
| sort_order | integer | no | 0 |
| timestamps, softDeletesTz | | | |

### 6.4 `finishes`

| Column | Type | Null | Notes |
|---|---|---|---|
| id | ulid | | |
| code | string(40) | no | unique |
| name | string(120) | no | |
| finish_type | string(24) | no | `none` \| `laminate` \| `veneer` \| `paint` \| `pu` \| `lacquer` \| `duco` \| `membrane` |
| price_per_sqm_minor | bigint | no | applied per visible face area |
| applies_to | jsonb | no | board types it can be applied to |
| color_hex | char(7) | yes | |
| texture | — | | media `texture` |
| is_active | boolean | no | default true |
| timestamps, softDeletesTz | | | |

### 6.5 `labour_rates`

| Column | Type | Null | Notes |
|---|---|---|---|
| id | ulid | | |
| key | string(48) | no | unique; exhaustive list in `08` §4.3 (e.g. `cutting_per_sheet`, `edge_banding_per_meter`, `assembly_per_part`, `drawer_assembly_each`, `hinge_install_each`, `installation_per_item`, `finishing_per_sqm`) |
| name | string(120) | no | |
| unit | string(16) | no | `sheet` \| `meter` \| `part` \| `piece` \| `item` \| `sqm` \| `hour` |
| rate_minor | bigint | no | |
| is_active | boolean | no | default true |
| timestamps | | | |

### 6.6 `tax_rates`

| Column | Type | Null | Notes |
|---|---|---|---|
| id | ulid | | |
| name | string(60) | no | "GST 18%" |
| rate_bps | integer | no | basis points (1800 = 18%) |
| is_default | boolean | no | exactly one default (partial unique index where is_default) |
| is_active | boolean | no | default true |
| timestamps | | | |

---

## 7. AI metering

### 7.1 `ai_credit_ledger`

Append-only. Balance = SUM(delta) per user.

| Column | Type | Null | Notes |
|---|---|---|---|
| id | ulid | | |
| user_id | ulid FK users **C** | no | |
| delta | integer | no | + grant/refund, − consumption/reservation |
| kind | string(24) | no | `monthly_grant` \| `admin_grant` \| `admin_revoke` \| `reservation` \| `reservation_release` \| `consumption` \| `refund` \| `signup_grant` |
| period | char(7) | yes | `YYYY-MM` for `monthly_grant` (unique with user_id+kind where kind=monthly_grant) |
| reference_type / reference_id | string / char(26) | yes | morph: BlueprintImport, etc. |
| note | string(255) | yes | admin reason |
| created_by | ulid FK users **N** | yes | |
| created_at | timestamptz | no | immutable |

Indexes: (`user_id`, `created_at`); partial unique (`user_id`, `period`) where `kind = 'monthly_grant'`.
Cached balance: `users_ai_balance` view **not** used; compute with SUM (indexed) and cache in Redis `ai:balance:{userId}` (busted on insert).

### 7.2 `ai_usage_events`

| Column | Type | Null | Notes |
|---|---|---|---|
| id | ulid | | |
| user_id | ulid FK users **N** | yes | who triggered |
| feature | string(32) | no | `blueprint_recognition` (v1 only) |
| provider | string(24) | no | `anthropic` \| `openai` \| `openai_compatible` \| `none` |
| model | string(100) | yes | |
| request_count | integer | no | number of LLM calls in the run |
| input_tokens | integer | no | default 0 |
| output_tokens | integer | no | default 0 |
| image_count | integer | no | default 0 |
| cost_micro_usd | bigint | no | estimated cost in millionths of USD (from price table in `ai` settings) |
| duration_ms | integer | no | |
| status | string(16) | no | `succeeded` \| `failed` |
| reference_type / reference_id | | yes | morph to BlueprintImport |
| created_at | timestamptz | no | |

Indexes: (`created_at`), (`user_id`, `created_at`), (`provider`, `created_at`).

---

## 8. Orders

### 8.1 `orders`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | ulid | | | |
| number | string(20) | no | | unique, `ORD-2026-00042`; assigned at **submission** (draft orders have a temporary number `DRAFT-{ulid suffix 8}`) |
| project_id | ulid FK projects **R** | no | | |
| customer_id | ulid FK users **R** | no | | |
| state | string(32) | no | `'draft'` | spatie model state; values in `09` §1 |
| state_before_hold | string(32) | yes | | |
| assigned_to | ulid FK users **N** | yes | | responsible staff (estimator) |
| production_assignee_id | ulid FK users **N** | yes | | |
| title | string(160) | no | | defaults to "{project name} — {n} items" |
| customer_notes | text | yes | | from submission form |
| site_address_id | ulid FK addresses **N** | yes | | delivery/installation address |
| needs_installation | boolean | no | true | |
| preferred_delivery_on | date | yes | | customer preference |
| expected_delivery_on | date | yes | | staff commitment (set at confirmation) |
| accepted_quote_id | ulid FK quotes **N** | yes | | FK added later |
| current_quote_id | ulid FK quotes **N** | yes | | latest sent quote |
| production_progress | smallint | no | 0 | 0–100, latest update |
| production_stage | string(32) | yes | | latest stage key (see 09 §8) |
| cancel_reason | string(32) | yes | | `customer_withdrew` \| `quote_declined` \| `declined_on_call` \| `unresponsive` \| `staff_cancelled` \| `duplicate` \| `other` |
| cancel_note | text | yes | | |
| submitted_at, reviewed_at, quoted_at, accepted_at, confirmed_at, production_started_at, completed_at, customer_approved_at, delivered_at, closed_at, cancelled_at | timestamptz | yes | | milestone timestamps (set by transitions) |
| last_customer_activity_at, last_staff_activity_at | timestamptz | yes | | for SLAs/reminders |
| timestamps, softDeletesTz | | | | |

Indexes: unique(`number`), (`state`, `updated_at`), (`customer_id`, `created_at`), (`assigned_to`, `state`).

### 8.2 `order_items`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | ulid | | | |
| order_id | ulid FK orders **C** | no | | |
| furniture_design_id | ulid FK furniture_designs **R** | no | | |
| furniture_revision_id | ulid FK furniture_revisions **R** | yes | | pinned revision; null while order is `draft` (pinned at submit) |
| quantity | smallint | no | 1 | 1–99 |
| room_label | string(80) | yes | | where it goes ("Master bedroom") — prefilled from placement room |
| customer_notes | text | yes | | |
| staff_notes | text | yes | | internal |
| sort_order | smallint | no | 0 | |
| timestamps | | | | |

Unique(`order_id`, `furniture_design_id`).

### 8.3 `change_proposals`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | ulid | | | |
| order_id | ulid FK orders **C** | no | | |
| number | smallint | no | | 1..n per order |
| status | string(16) | no | `'draft'` | `draft` \| `sent` \| `resolved` \| `withdrawn` |
| message | text | yes | | staff explanation to customer |
| created_by | ulid FK users **R** | no | | |
| sent_at, resolved_at, withdrawn_at | timestamptz | yes | | |
| customer_comment | text | yes | | overall comment on resolution |
| timestamps | | | | |

Unique(`order_id`, `number`).

### 8.4 `change_proposal_items`

| Column | Type | Null | Notes |
|---|---|---|---|
| id | ulid | | |
| change_proposal_id | ulid FK change_proposals **C** | no | |
| order_item_id | ulid FK order_items **C** | no | |
| from_revision_id | ulid FK furniture_revisions **R** | no | revision pinned on the item when proposal was created |
| to_revision_id | ulid FK furniture_revisions **R** | yes | staff's proposed revision (null while staff is still editing in draft) |
| staff_draft_document | jsonb | yes | staff working copy while proposal is `draft` (autosaved; becomes `to_revision` on send) |
| staff_draft_version | integer | no | default 1 (optimistic lock) |
| changes | jsonb | yes | `ChangeItem[]` computed by engine diff at send time |
| staff_note | text | yes | per-item explanation |
| decision | string(16) | no | default `pending`: `pending` \| `approved` \| `rejected` |
| customer_comment | text | yes | required when rejected |
| decided_at | timestamptz | yes | |
| timestamps | | | |

Unique(`change_proposal_id`, `order_item_id`).

### 8.5 `quotes`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | ulid | | | |
| order_id | ulid FK orders **C** | no | | |
| version | smallint | no | | 1..n per order |
| number | string(24) | no | | `{order.number}-Q{version}` unique |
| status | string(16) | no | `'draft'` | `draft` \| `sent` \| `accepted` \| `declined` \| `superseded` \| `expired` \| `withdrawn` |
| currency | char(3) | no | | snapshot of business currency |
| prices_include_tax | boolean | no | | snapshot |
| subtotal_minor | bigint | no | 0 | sum of non-discount lines before tax |
| discount_minor | bigint | no | 0 | positive number |
| tax_minor | bigint | no | 0 | |
| total_minor | bigint | no | 0 | |
| tax_breakdown | jsonb | no | `'[]'` | `[{taxRateId, name, rateBps, taxableMinor, taxMinor}]` |
| valid_until | date | no | | default today + `workflow.quote_validity_days` |
| lead_time_days | smallint | yes | | estimated manufacturing days after confirmation |
| notes_to_customer | text | yes | | |
| terms | text | no | | default from `business.quote_terms` |
| internal_notes | text | yes | | |
| cost_snapshot | jsonb | no | `'{}'` | internal: material/hardware/labour cost totals and margin per item at quoting time (staff only) |
| catalog_version | integer | no | | |
| engine_version | string(16) | no | | |
| pdf | — | | | media `pdf` (single) |
| created_by | ulid FK users **R** | no | | |
| sent_at, accepted_at, declined_at, expired_at, superseded_at, withdrawn_at | timestamptz | yes | | |
| decline_reason | text | yes | | customer-provided |
| accepted_by_ip | inet | yes | | |
| timestamps | | | | |

Unique(`order_id`, `version`), unique(`number`). Only one quote per order may have status `sent` (partial unique index on `order_id` where status = 'sent').

### 8.6 `quote_lines`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | ulid | | | |
| quote_id | ulid FK quotes **C** | no | | |
| order_item_id | ulid FK order_items **N** | yes | | null for order-level lines |
| kind | string(16) | no | | `furniture` \| `materials` \| `hardware` \| `labour` \| `finishing` \| `installation` \| `delivery` \| `discount` \| `custom` |
| description | string(255) | no | | |
| details | jsonb | yes | | optional breakdown shown on PDF (e.g. dimensions, key materials) |
| quantity | decimal(12,3) | no | 1 | |
| unit | string(16) | no | `'item'` | |
| unit_price_minor | bigint | no | | negative allowed only for `discount` |
| amount_minor | bigint | no | | `round(quantity × unit_price)` |
| tax_rate_id | ulid FK tax_rates **N** | yes | | null = no tax |
| is_visible_to_customer | boolean | no | true | hidden lines still count (used to bundle) — see 08 §6 |
| sort_order | smallint | no | 0 | |
| timestamps | | | | |

### 8.7 `quote_negotiations`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | ulid | | | |
| quote_id | ulid FK quotes **C** | no | | |
| order_id | ulid FK orders **C** | no | | |
| customer_id | ulid FK users **R** | no | | |
| proposed_total_minor | bigint | yes | | customer's counter price (optional) |
| message | text | no | | |
| status | string(16) | no | `'open'` | `open` \| `answered_with_revision` \| `answered_keep_price` \| `closed` |
| answered_by | ulid FK users **N** | yes | | |
| answer_message | text | yes | | |
| answered_at | timestamptz | yes | | |
| resulting_quote_id | ulid FK quotes **N** | yes | | revised quote |
| timestamps | | | | |

### 8.8 `confirmation_calls`

| Column | Type | Null | Notes |
|---|---|---|---|
| id | ulid | | |
| order_id | ulid FK orders **C** | no | |
| staff_id | ulid FK users **R** | no | |
| called_at | timestamptz | no | |
| phone_e164 | string(20) | no | number dialled |
| outcome | string(24) | no | `confirmed` \| `no_answer` \| `callback_requested` \| `wrong_number` \| `customer_wants_changes` \| `customer_declined` |
| notes | text | yes | |
| callback_at | timestamptz | yes | when `callback_requested` |
| timestamps | | | |

### 8.9 `production_updates`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | ulid | | | |
| order_id | ulid FK orders **C** | no | | |
| author_id | ulid FK users **R** | no | | |
| stage | string(32) | no | | stage key from `workflow.production_stages` (default list in 09 §8) |
| progress | smallint | no | | 0–100; must be ≥ previous visible update's progress |
| title | string(160) | no | | |
| body | text | yes | | |
| visibility | string(16) | no | `'customer'` | `customer` \| `internal` |
| is_completion | boolean | no | false | true for the "completed" post (completion photos) |
| photos | — | | | media `photos` (≤ 20, images only) |
| timestamps | | | | |

Index: (`order_id`, `created_at`).

### 8.10 `order_issues`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | ulid | | | |
| order_id | ulid FK orders **C** | no | | |
| order_item_id | ulid FK order_items **N** | yes | | |
| raised_by | ulid FK users **R** | no | | customer |
| description | text | no | | |
| status | string(16) | no | `'open'` | `open` \| `in_progress` \| `resolved` \| `rejected` |
| resolution_note | text | yes | | |
| resolved_by | ulid FK users **N** | yes | | |
| resolved_at | timestamptz | yes | | |
| photos | — | | | media `photos` (customer evidence, ≤ 10) |
| timestamps | | | | |

### 8.11 `deliveries`

| Column | Type | Null | Notes |
|---|---|---|---|
| id | ulid | | |
| order_id | ulid FK orders **C** | no | unique (one delivery record per order in v1) |
| scheduled_for | timestamptz | yes | |
| delivered_at | timestamptz | yes | |
| installed | boolean | no | default false |
| recipient_name | string(120) | yes | |
| notes | text | yes | |
| recorded_by | ulid FK users **N** | yes | |
| photos | — | | media `photos` |
| timestamps | | | |

### 8.12 `payments` (PHASE 2 — migrate only; no models' business logic, routes, UI)

| Column | Type | Null | Notes |
|---|---|---|---|
| id | ulid | | |
| order_id | ulid FK orders **R** | no | |
| quote_id | ulid FK quotes **N** | yes | |
| kind | string(16) | no | `advance` \| `balance` \| `refund` \| `adjustment` |
| amount_minor | bigint | no | |
| currency | char(3) | no | |
| method | string(24) | no | `cash` \| `bank_transfer` \| `upi` \| `card` \| `cheque` \| `online_gateway` |
| status | string(16) | no | `pending` \| `succeeded` \| `failed` \| `refunded` |
| gateway | string(24) | yes | `razorpay` \| `stripe` |
| gateway_reference | string(120) | yes | |
| paid_at | timestamptz | yes | |
| recorded_by | ulid FK users **N** | yes | |
| notes | text | yes | |
| timestamps | | | |

A `Payment` Eloquent model may exist (empty, with casts) but nothing references it in v1.

---

## 9. Messaging

### 9.1 `messages`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | ulid | | | |
| order_id | ulid FK orders **C** | no | | one thread per order |
| author_id | ulid FK users **N** | yes | | null for system messages |
| kind | string(24) | no | `'text'` | `text` \| `system` \| `internal_note` |
| body | text | no | | Markdown subset (bold, italic, links, lists) rendered sanitised |
| system_event | string(64) | yes | | for `system`: event key, e.g. `order.quote_sent` |
| system_payload | jsonb | yes | | params for translated rendering |
| attachments | — | | | media `attachments` (≤ 5 files; images/PDF, ≤ 15 MB each) |
| edited_at | timestamptz | yes | | authors may edit within 10 min |
| timestamps, softDeletesTz | | | | |

`internal_note` is visible only to staff. Index: (`order_id`, `created_at`).

### 9.2 `message_reads`

| Column | Type | Notes |
|---|---|---|
| order_id | ulid FK orders **C** | PK part |
| user_id | ulid FK users **C** | PK part |
| last_read_at | timestamptz | |
| last_read_message_id | char(26) | nullable |

PK(`order_id`, `user_id`).

---

## 10. Media collections (spatie medialibrary) — summary

| Model | Collection | Disk | Single? | Accepts | Max size | Conversions |
|---|---|---|---|---|---|---|
| User | `avatar` | s3-public | yes | jpg, png, webp | 5 MB | `thumb` 128² |
| Project | `cover` | s3-public | yes | png, webp | 5 MB | — |
| Plan | `thumbnail` | s3 | yes | png | 5 MB | `small` 320w |
| BlueprintImport | `source` | s3 | yes | see `06` §2 | 25 MB (plans), DXF 15 MB | — |
| BlueprintImport | `normalized` | s3 | yes | png | 40 MB | `preview` 1600w webp |
| BlueprintImport | `debug` | s3 | no | png, json | 40 MB | — |
| FurnitureDesign | `thumbnail` | s3 | yes | png | 5 MB | `small` 320w |
| FurniturePreset | `thumbnail` | s3-public | yes | png | 5 MB | `small` 320w |
| Material, Finish | `texture` | s3-public | yes | jpg, webp | 4 MB | `small` 256² |
| HardwareItem | `image` | s3-public | yes | jpg, png, webp | 4 MB | `thumb` 256² |
| Quote | `pdf` | s3 | yes | pdf | 20 MB | — |
| ProductionUpdate | `photos` | s3 | no | jpg, png, webp, heic→jpg | 15 MB each | `thumb` 400w, `large` 1600w |
| OrderIssue | `photos` | s3 | no | same | 15 MB | same |
| Delivery | `photos` | s3 | no | same | 15 MB | same |
| Message | `attachments` | s3 | no | jpg, png, webp, pdf | 15 MB | `thumb` 400w for images |

Private disk files are served through signed temporary URLs (`$media->getTemporaryUrl(now()->addMinutes(15))`) generated after a policy check.

---

## 11. Model relationships (Eloquent)

- User hasMany Project (owner_id), hasMany Address, hasMany Order (customer_id), hasMany AiCreditLedgerEntry; morphMany notifications.
- Project belongsTo owner(User), hasMany Plan, hasMany FurnitureDesign, hasMany Order, hasMany BlueprintImport, belongsTo siteAddress(Address).
- Plan belongsTo Project, hasMany PlanRevision, belongsTo currentRevision.
- FurnitureDesign belongsTo Project, owner, preset; hasMany FurnitureRevision; belongsTo currentRevision; belongsTo lockedByOrder(Order).
- Order belongsTo Project, customer, assignee, productionAssignee, siteAddress, acceptedQuote, currentQuote; hasMany OrderItem, ChangeProposal, Quote, QuoteNegotiation, ConfirmationCall, ProductionUpdate, OrderIssue, Message; hasOne Delivery.
- OrderItem belongsTo Order, FurnitureDesign, FurnitureRevision.
- ChangeProposal hasMany ChangeProposalItem; ChangeProposalItem belongsTo OrderItem, fromRevision, toRevision.
- Quote hasMany QuoteLine, hasMany QuoteNegotiation.

## 12. Model casts (non-trivial)

- `*.working_document`, `*.document` → custom cast `AsJsonDocument` (array; never Eloquent `AsArrayObject` to avoid accidental mutation of revisions).
- `orders.state` → `OrderState::class` (spatie states). `blueprint_imports.status` → `ImportStatus` enum (simple enum; transitions guarded in actions).
- Money columns → `int`. Display via `App\Support\Money\MoneyFormatter`.
- Enum columns → backed enums.

---

## 13. Settings groups (`app_settings`) — fields and defaults

Each group is a `spatie/laravel-data` class in `app/Support/Settings/Groups`. Defaults are applied by the seeder `SettingsSeeder` and by `Settings::get()` when a key is missing.

### `business`
| Field | Type | Default |
|---|---|---|
| name | string | `APP_NAME` |
| legal_name | ?string | null |
| tax_id | ?string | null (e.g. GSTIN) |
| email | string | `MAIL_FROM_ADDRESS` |
| phone_e164 | ?string | null |
| address | ?array (address shape) | null |
| currency | string | `INR` |
| locale | string | `en-IN` (number/currency formatting) |
| timezone | string | `Asia/Kolkata` |
| logo_media_id | ?int | null (logo stored as media on a singleton `BusinessProfile` pseudo-model id `business`) |
| quote_terms | string | default terms text (translation key `quotes.default_terms` resolved at seed time) |
| working_hours | string | `Mon–Sat 10:00–19:00` (shown on contact info) |

### `units`
| Field | Type | Default |
|---|---|---|
| default_system | `metric`\|`imperial` | `metric` |
| default_length_unit | string | `mm` |
| default_wall_height_mm | int | 2700 |
| default_exterior_wall_thickness_mm | int | 230 |
| default_interior_wall_thickness_mm | int | 115 |
| default_door_width_mm | int | 900 |
| default_door_height_mm | int | 2100 |
| default_window_width_mm | int | 1200 |
| default_window_height_mm | int | 1200 |
| default_window_sill_mm | int | 900 |

### `pricing`
| Field | Type | Default |
|---|---|---|
| prices_include_tax | bool | false |
| default_tax_rate_id | ?ulid | seeded GST 18% |
| margin_bps | int | 3500 (35% markup on cost) |
| overhead_bps | int | 1000 (10% on cost) |
| minimum_order_minor | int | 0 |
| rounding_minor | int | 100 (round final item price up to nearest 1.00 unit) |
| estimate_disclaimer_key | string | `estimates.disclaimer` |
| installation_bps | int | 800 (installation as % of item price if `needs_installation`) |
| delivery_flat_minor | int | 0 |
| kerf_mm | decimal | 4.0 |
| sheet_trim_mm | int | 10 (each sheet edge) |
| nesting_allow_rotation_default | bool | true |

### `workflow`
| Field | Type | Default |
|---|---|---|
| quote_validity_days | int | 15 |
| auto_close_days | int | 14 |
| reminder_after_hours | int | 48 |
| production_stages | array of `{key, label_key, default_progress}` | see 09 §8 |
| require_completion_photos | int | 1 (min photos to mark complete) |
| allow_customer_counter_offer | bool | true |
| max_negotiation_rounds | int | 5 |

### `ai`
| Field | Type | Default |
|---|---|---|
| provider | `anthropic`\|`openai`\|`openai_compatible`\|`none` | `anthropic` if vision reports it configured, else `none` |
| model | string | `claude-opus-5-5` |
| effort | `low`\|`medium`\|`high` | `high` (Anthropic only; mapped per provider in 18) |
| agentic_crops | bool | true (use crop/zoom tool loop when provider supports tools) |
| fallback_to_none_on_error | bool | true |
| signup_credits | int | 3 |
| monthly_credits | int | 3 |
| credits_per_recognition | int | 1 |
| credits_per_recognition_none | int | 0 |
| max_recognitions_per_day | int | 5 (per customer, hard rate limit even with credits) |
| global_monthly_budget_usd | decimal | 50.00 (0 = unlimited) |
| budget_exhausted_behavior | `fallback_none`\|`block` | `fallback_none` |
| price_table | array `{provider, model, input_per_mtok_usd, output_per_mtok_usd}` | seeded: anthropic `claude-opus-5-5` 4.00/20.00, anthropic `claude-sonnet-5-5` 2.00/10.00, anthropic `claude-haiku-5-5` 0.10/0.50; openai/openai_compatible rows entered by owner (openai_compatible default 0/0) |
| staff_unlimited | bool | true |

### `notifications`
| Field | Type | Default |
|---|---|---|
| whatsapp_templates | map event_key → `{name, language, components}` | empty (see 12) |
| sms_driver | `twilio`\|`msg91`\|`log` | `log` |
| sms_templates | map event_key → `{text_key, dlt_template_id?}` | see 12 |
| otp_channel_order | array | `["whatsapp","sms"]` |
| staff_digest_hour | int | 9 |

### `catalog.version`
Integer, starts at 1.

---

## 14. Seed data (`DatabaseSeeder`)

1. `RolesAndPermissionsSeeder` — roles & permissions from `13` §3.
2. `SettingsSeeder` — all groups above.
3. `TaxRatesSeeder` — `GST 18%` (default), `GST 12%`, `GST 5%`, `No tax 0%`.
4. `CatalogSeeder` — realistic starter catalog (exact rows in `08` §7).
5. `OwnerSeeder` — creates owner from env `SEED_OWNER_EMAIL`, `SEED_OWNER_PASSWORD` (prod) — fails loudly if missing in production.
6. `DemoSeeder` (local/staging only, `--class=DemoSeeder`) — 3 customers, projects with plans built from fixture documents (`database/fixtures/plans/*.json`, including hand-made recreations of the two reference blueprints), furniture designs, orders in every state.

---

## 15. Migration order

1. users, addresses, password_reset_tokens, otp_codes, notification_preferences
2. permission tables, media, activity_log, notifications, push_subscriptions, jobs/cache/failed_jobs/job_batches, pulse
3. app_settings, number_sequences
4. projects, plans, plan_revisions (+ FK plans.current_revision_id)
5. materials, edge_bands, hardware_items, finishes, labour_rates, tax_rates
6. furniture_presets, furniture_template_settings, furniture_designs, furniture_revisions (+ FK current_revision_id)
7. blueprint_imports
8. orders, order_items, change_proposals, change_proposal_items, quotes, quote_lines, quote_negotiations, confirmation_calls, production_updates, order_issues, deliveries, payments (+ FKs orders.accepted_quote_id, orders.current_quote_id, furniture_designs.locked_by_order_id)
9. messages, message_reads
10. ai_credit_ledger, ai_usage_events
