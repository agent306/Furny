# Task 12 report: messaging and AI schema; whole-schema checks

Status: DONE_WITH_CONCERNS (concerns are observations for the controller, none blocks). Commit: f39985e `feat(schema): messaging and AI metering tables; migration order and factory checks`.

## Implemented
- Migrations (02 §9, §7, §15 groups 9, 10): `messages`, `message_reads` (PK order_id+user_id, no timestamps), `ai_credit_ledger` (created_at only; partial unique index `ai_credit_ledger_one_monthly_grant_per_period` on (user_id, period) WHERE kind = 'monthly_grant'), `ai_usage_events`. Defaults only where 02 gives them (`messages.kind 'text'`, three token/image counters 0); `created_at` has no DB default, Eloquent writes it.
- Enums (all `#[TypeScript]`): `MessageKind`, `CreditLedgerKind` (8 values, 02 order), `AiFeature`, `AiUsageStatus`. `AiProvider` already existed.
- Models: `Message` (SoftDeletes, Fillable `['body']` only, `system_payload` array cast, media `attachments` s3, `thumb` 400w), `MessageRead`, `AiCreditLedgerEntry` (immutable: `updating` throws LogicException, ruling b; `reference(): MorphTo`; nothing mass-assignable), `AiUsageEvent` (nothing mass-assignable).
- `MessageRead` has no Eloquent key (`$primaryKey = null`, not incrementing, no timestamps). I overrode `setKeysForSaveQuery`, `setKeysForSelectQuery` and `delete()` to address the row by (order_id, user_id). Without the select override `fresh()` silently returned an arbitrary row (where null = null), which I found while writing tests; without the delete override `delete()` throws. Both are tested. Not final-HasUlids by design (ArchTest exception).
- Relations: `Order::messages()` (oldest first, id tie-break), `User::aiCreditLedgerEntries()`, `BlueprintImport::ledgerEntries()` / `usageEvents()` (morphMany `reference`, oldest first). MorphMap gains `message`, `message_read`, `ai_credit_ledger_entry`, `ai_usage_event` (`blueprint_import` already existed). Order docblock no longer says messages are pending.
- Factories (Messaging/, Ai/): owners resolved via callables (message author and read-mark reader = order customer; usage event's import is created for the same user, project owner and uploader). States: Message `by`, `system`, `internalNote`, `edited`; MessageRead `by`, `lastRead`; Ledger `by`, one state per kind with the sign of 18 §9.1 (`monthlyGrant($period, $delta)` etc.); Usage `providerTest`, `failed`. Link an import with `->for($import, 'reference')`.
- Ruling (a) indexes: see list below. Edited inside the existing Task 11 create migrations; no new migration file.
- Ruling (d): `AllFactoriesTest` scans `database/factories/Domain/*/*Factory.php` (dataset), `create()` per factory in isolation, plus a test that every model using HasFactory has a discovered factory.
- Ruling (e): `ArchTest` checks every `App\Domain\*\Models` class is final and uses HasUlids except AppSetting, BusinessProfile, FurnitureTemplateSetting, MessageRead (and the exceptions must still exist), and every `Actions` class is final. No existing class violated it, so I changed none (no Actions exist yet).
- `tests/Support/PgSchema.php` gains `indexNames($table)` (complete sorted index-name list, used to pin full index sets).

## Indexes added (for the spec 19 log)
Into existing Task 11 migrations (plain, non-unique, Laravel default names):
1. `quote_lines_quote_id_index` (quote_lines.quote_id)
2. `quote_negotiations_quote_id_index` (quote_negotiations.quote_id)
3. `quote_negotiations_order_id_index` (quote_negotiations.order_id)
4. `confirmation_calls_order_id_index` (confirmation_calls.order_id)
5. `order_issues_order_id_index` (order_issues.order_id)
6. `payments_order_id_index` (payments.order_id)

New in Task 12 tables (same ruling, FK columns with no covering index or PK/unique prefix):
7. `messages_author_id_index` (messages.author_id)
8. `message_reads_user_id_index` (message_reads.user_id; the PK covers order_id only)
9. `ai_credit_ledger_created_by_index` (ai_credit_ledger.created_by)

Not added: `ai_credit_ledger.user_id`, `ai_usage_events.user_id` (covered by the 02 composite indexes), `messages.order_id` (covered by (order_id, created_at)). Pinned in `OrdersSchemaBTest` (full index-name sets of the five edited tables) and `MessagingAiSchemaTest` (full sets of the four new tables).

## Tests
- Focused: `vendor/bin/pest tests/Feature/Schema tests/Feature/Models tests/Unit/ArchTest.php` -> 558 passed.
- Gates-PHP: `pint --test` passed; `phpstan analyse` level 8 `[OK] No errors`; `pest tests/Unit tests/Feature` -> 729 passed (4389 assertions), output pristine.
- Gates-Gen: `typescript:transform` + `i18n:export` run; only `resources/js/types/generated.d.ts` changed (4 new enum types), committed.
- `php artisan migrate:fresh` on dev DB `furny` succeeded (all 56 migrations).
- New tests: `tests/Feature/Schema/MessagingAiSchemaTest.php` (columns type/length/null for all four tables, default sweep + null-default complement, enum column sizing, complete index sets, PK, partial unique with real inserts in savepoints incl. two admin_grants and null periods not colliding, all FK actions + referenced tables in one toEqual, cascade/null behaviours, constraint-name assertions), `MigrationOrderTest`, `AllFactoriesTest`, `MessagingAiModelsTest` (enums, factories, casts, Fillable exclusions, soft delete, thread order, media collection/conversion/attach, MessageRead keying/fresh/refresh/save/delete, ledger immutability, morph reference both ways, aliases, DB defaults), ArchTest extension, join-key index pins in `OrdersSchemaBTest`.

## TDD evidence
- RED 1: `vendor/bin/pest tests/Feature/Schema/MessagingAiSchemaTest.php tests/Feature/Schema/MigrationOrderTest.php tests/Feature/Models/AllFactoriesTest.php tests/Unit/ArchTest.php` -> `Tests: 21 failed, 38 passed` (missing tables/classes/factories, migration list short by four files, MessageRead absent from ArchTest). Expected: nothing implemented yet.
- RED 2: `vendor/bin/pest tests/Feature/Schema/OrdersSchemaBTest.php` -> `1 failed, 32 passed` on the new join-key index test (indexes did not exist). Expected.
- The model tests (`MessagingAiModelsTest`) were written before the models existed but I did not run them in isolation before implementing (they reference missing classes, so they could only fail on class-not-found); first run was after implementation.
- GREEN: commands above; during GREEN I fixed test-side mistakes (factory state closures cannot be `static`; jsonb reorders map keys so payload compared with toEqual; users that own projects cannot be deleted so deletion tests use staff authors and provider-test events; `fresh()` vs in-memory attributes).

## Files changed
New: 4 migrations, `app/Domain/Messaging/{Enums/MessageKind,Models/Message,Models/MessageRead}.php`, `app/Domain/Ai/{Enums/CreditLedgerKind,Enums/AiFeature,Enums/AiUsageStatus,Models/AiCreditLedgerEntry,Models/AiUsageEvent}.php`, 4 factories under `database/factories/Domain/{Messaging,Ai}`, 4 test files (MessagingAiSchemaTest, MigrationOrderTest, AllFactoriesTest, MessagingAiModelsTest).
Modified: 5 Task 11 migrations (indexes), `Order`, `User`, `BlueprintImport`, `app/Support/MorphMap.php`, `tests/Unit/ArchTest.php`, `tests/Feature/Schema/OrdersSchemaBTest.php`, `tests/Support/PgSchema.php`, `resources/js/types/generated.d.ts`.

## Self-review
- Message Fillable is `['body']` only: kind is set by the post action (a customer-fillable `system`/`internal_note` would be a hole). Payment/ledger/usage follow the D16 "nothing mass-assignable" pattern.
- System-message factory body is `''` (UI renders from event key + payload, 09 §10); body stays NOT NULL per 02. Event keys in factories follow 09 §11 (`order.submitted`), not the `order.quote_sent` example in 02 §9.1, which is not a real key.
- `system_payload` uses the plain `array` cast (nullable, no `{}` default, so AsJsonMap does not apply). Like `result_meta`, an empty `{}` map would round-trip as `[]`; flag for P7 if payloads may be empty maps.

## Concerns / observations for the controller
1. Other FK columns in earlier tasks still have no covering index (52 in total at the Task 11 baseline, mostly cold audit columns: created_by, updated_by, recorded_by, working_saved_by, answered_by, resolved_by; plus projects.site_address_id, orders.project_id, orders.site_address_id, orders.production_assignee_id, order_items.furniture_design_id / furniture_revision_id, furniture_designs.owner_id / preset_id, blueprint_imports.project_id / plan_id, quote_lines.order_item_id / tax_rate_id, payments.quote_id, quote_negotiations.resulting_quote_id / customer_id, addresses.user_id, plans.current_revision_id). Beyond the ruling's scope, so untouched; notably `orders.project_id` and `blueprint_imports.project_id` look hot (project page lists) and `addresses.user_id` (user's address book). Suggest a ruling.
2. `reference_type/reference_id` morph columns have no index (not FKs; 02 lists none). `BlueprintImport::ledgerEntries()/usageEvents()` filter on them; per-import tables are small, but add (reference_type, reference_id) if admin usage queries need it.
3. Message `thumb` conversion is registered for the whole `attachments` collection; spatie silently skips it when no image generator matches (PDF only gets a thumb where Imagick/PDF generator exists). 02 says "for images".
4. `MessageRead` overrides three Eloquent internals; P7 read actions should use `forceFill(...)->save()` or query `where` on both columns, not `updateOrCreate` with order_id/user_id as mass-assigned attributes (owner columns are not fillable).
5. Ledger immutability is model-level only (ruling b); DB-level cascade on user delete and query-builder writes bypass it, as with PlanRevision.

# Fix round 1 (commit 4985127 `perf(schema): index every foreign key; harden MessageRead and the credit ledger`)

Worked in /home/user/furny-p1 (the environment banner switched the primary directory to /home/user/furny-p2, but the Task 12 commit and branch build/p1-foundation live in furny-p1, so I kept using it).

## 1. Every FK column indexed (ruled)
Plain indexes edited into the existing create migrations (no new migration file; MigrationOrderTest unchanged), Laravel default names `{table}_{column}_index`. RED evidence: before the edits a pg_constraint/pg_index query listed 46 foreign keys with no leading index (the 6 earlier-ruled ones plus Task 12's 3 were already done). Indexes added in this round (46), for spec 19:
- addresses.user_id; staff_invitations.invited_by, user_id; role_has_permissions.role_id (spatie pivot, in `020000_create_permission_tables`; the PK leads with permission_id); notification_deliveries.fallback_of_id; app_settings.updated_by
- projects.created_by, site_address_id; plans.current_revision_id, locked_by, working_saved_by; plan_revisions.author_id
- furniture_presets.created_by; furniture_designs.created_by, current_revision_id, owner_id, preset_id, working_saved_by; furniture_revisions.author_id; blueprint_imports.plan_id, project_id
- orders.accepted_quote_id, current_quote_id, production_assignee_id, project_id, site_address_id; order_items.furniture_design_id, furniture_revision_id; change_proposals.created_by; change_proposal_items.from_revision_id, order_item_id, to_revision_id
- quotes.created_by; quote_lines.order_item_id, tax_rate_id; quote_negotiations.answered_by, customer_id, resulting_quote_id; confirmation_calls.staff_id; production_updates.author_id; order_issues.order_item_id, raised_by, resolved_by; deliveries.recorded_by; payments.quote_id, recorded_by

Whole-schema test: `tests/Feature/Schema/ForeignKeyIndexTest.php` (helper `PgSchema::unindexedForeignKeys()`): every `contype 'f'` constraint's column list must be a leading prefix of a valid, non-partial index (PK/unique count); allowlist constant `FOREIGN_KEYS_WITHOUT_INDEX` is empty, with a stale-entry check; a probe test creates tables inside the test transaction to prove the detector flags a bare FK, a second-column-only FK, and a partial index, and accepts unique, leading-composite and PK-prefix coverage. A second test pins all 55 plain FK indexes added across rulings (including the earlier 9) by name and column. Per-table pinned sets updated: `OrdersSchemaBTest` now pins the complete index set of all 8 group-B tables; `MessagingAiSchemaTest` sets updated. Dev DB `furny` after `migrate:fresh`: 0 foreign keys without a covering index.

## 2. Morph indexes
`ai_credit_ledger_reference_type_reference_id_index` and `ai_usage_events_reference_type_reference_id_index` on (reference_type, reference_id), in their create migrations; pinned by name and definition in `MessagingAiSchemaTest` (also in the complete sets).

## 3. MessageRead
`is()` overridden (instanceof, order_id and user_id, table, connection; `isNot()` inherits it). `setKeysForSaveQuery`/`setKeysForSelectQuery`/`delete()` use `getOriginal()` with the current attribute as fallback. Docblock warns: no `find()`, no queued serialisation, no collection keying. Tests (RED first: both failed before the change): `is`/`isNot` across same row, other user, other order, null, non-MessageRead; changing user_id in memory then `save()` and `delete()` touches only the originally loaded row.

## 4. AiCreditLedgerEntry append-only
`deleting` now throws LogicException too. Tests: `delete()` throws and the row stays; deleting a user still removes their ledger rows via the FK cascade; the "monthly grant written again" test now removes the row with `DB::table(...)->delete()` (renamed accordingly). Query-builder deletes and the cascade bypass model events by design.

## 5. Helpers
`domainClasses()` -> `archDomainClasses()` (ArchTest), `discoveredFactories()` -> `allFactoriesDiscovered()` (AllFactoriesTest).

## Verification
- `php artisan migrate:fresh` (dev DB furny): all migrations DONE.
- `vendor/bin/pint --test`: passed. `vendor/bin/phpstan analyse`: `[OK] No errors`.
- `vendor/bin/pest tests/Unit tests/Feature`: 737 passed (4570 assertions), output pristine.
- `typescript:transform` + `i18n:export` produced no diff.

Notes: the pre-existing nonstandard case `role_has_permissions` (package table) is indexed rather than allowlisted; pulse/telescope/media/etc. have no foreign keys. Write overhead of 46 extra small btree indexes on cold audit columns is the accepted cost of the ruling.
