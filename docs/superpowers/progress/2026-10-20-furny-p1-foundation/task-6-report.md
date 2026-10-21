# Task 6 report: Settings service, settings seeder, number sequences

Status: DONE (commit 9d33832 `feat(settings): typed settings groups with cache, seeder and number sequences`, branch build/p1-foundation, worktree /home/user/furny-p1).

## Implemented
- Migrations `2026_10_20_030000_create_app_settings_table` (key varchar(100) PK, jsonb value, updated_by FK users nullOnDelete, timestampsTz) and `_030100_create_number_sequences_table` (key varchar(40) PK, bigint last_value, timestampsTz).
- Models `AppSetting`, `BusinessProfile` (table app_settings, string key, HasMedia, `logo` collection s3-public/single/png+webp+jpg, `instance()` = firstOrCreate of the `business` row with an empty `{}` value so stored fields still merge over defaults). Aliases `app_setting`, `business_profile` added to MorphMap::MAP (also added to MorphMapTest's alias list).
- `app/Support/Settings`: `SettingsGroup` enum (dataClass, isRestricted = ai/auth), `Settings` (singleton registered in AppServiceProvider; get/put/catalogVersion/seedReviewed/markSeedReviewed + 7 typed shortcuts), `CatalogVersion::bump()` (single `INSERT .. ON CONFLICT DO UPDATE .. RETURNING` on the current connection; cache bust after commit), `Attributes/Encrypted` (extends spatie WithCast), `Casts/EncryptedStringCast`.
- Groups: `SettingsData` (abstract; defaults/toStorage/toWire), the 7 group classes with every 02 §13 field and default, nested `ProductionStageData`, `QuietHoursData`, `AiPriceRowData`, `WhatsAppTemplateData`, `SmsTemplateData`, plus an extra tiny abstract `SettingsItemData` (see decisions).
- `app/Support/Numbers`: `NumberSequence::next` (transaction, INSERT ON CONFLICT DO NOTHING, SELECT FOR UPDATE, update), `OrderNumber::next/draft`, `QuoteNumber::for`.
- `SettingsSeeder` (inserts missing keys, merges only missing fields via `$stored + $seed`, busts cache after commit); `resources/lang/en/quotes.php` (`default_terms`), `production.php` (`stages.*`, labels from 09 §8). Generated `resources/js/types/generated.d.ts` and `resources/js/lang/generated/*` regenerated and committed.

## Decisions / things later tasks must know
1. Wire vs storage: `toArray()`/`toStorage()` give snake_case, `toWire()` gives camelCase. Inertia props/JSON for settings must use `toWire()`, not `toArray()`/`toResponse`. The generated TS types describe the camelCase wire form. Nested items extend `SettingsItemData` (carries the MapName attribute; the TS transformer does not read inherited class attributes, so the types come out camelCase and match `toWire()`).
2. Empty maps (`whatsapp_templates`, `sms_templates`) render as `{}` in both `toWire()` and `toStorage()` (via `mapProperties()`); `Settings::get` round-trips defaults through JSON so objects become arrays again before `from()`.
3. Cache: `settings:{key}` holds the stored document (array) / scalar for `catalog.*`, rememberForever, default cache store; `get()` merges `[...defaults->toStorage(), ...stored]` at field level (nested objects are replaced whole, not deep-merged). Bust uses `DB::afterCommit` (verified inside a transaction).
4. `EncryptedStringCast` is strict: a value that is not valid ciphertext throws `DecryptException` (no plaintext fallback). Consequence: `SettingsData::from()` expects the storage form. An admin form that supplies a plaintext secret must construct the object with `new`/named args or encrypt first. v1 has no secrets in settings (13 §15). Only top-level string props are supported.
5. Decimals are strings: `global_monthly_budget_usd '50.00'` and `price_table` rows (`'4.00'`/`'20.00'`...); `kerf_mm` is float (4.0). Enum-like fields (provider, effort, sms_driver, sheet_billing_mode, ...) are plain strings; validation belongs to the form requests of the settings task.
6. `defaults()` is self-sufficient: it includes the 12 seeded `sms_templates` entries and the translated `quote_terms`, so an unseeded install behaves like a seeded one. `auth.otp_allowed_country_codes` default is `['IN']`; the seeder derives `[strtoupper(business.address.country_code ?? 'IN')]`.
7. WhatsApp `components` stay raw arrays in Cloud API shape (`sub_type` snake_case inside them, also on the wire); no component Data class (not in the brief).
8. TestCase was not changed (cache store is `array`, new per test app, so no settings-cache reset needed). Tests that need pristine state call `AppSetting::query()->delete()` in `beforeEach` (C2), so they survive Task 13's baseline seeding.
9. jsonb does not preserve key order: stored maps come back in jsonb order (shorter keys first, then alphabetical); tests compare maps order-insensitively.

## Tests (all green)
`vendor/bin/pest tests/Unit tests/Feature`: 232 passed (1211 assertions), output pristine. New: SettingsTest (28), SettingsSeederTest (8), EncryptedStringCastTest (4), NumberSequenceTest (6), NumberSequenceConcurrencyTest (1, group `concurrency`: 4 `artisan tinker --execute` processes x 25, 100 unique numbers, max 100, cleanup of its row on a separate connection), plus an extra SettingsSchemaTest (3) and the MorphMapTest alias addition.
- Mutation check of the concurrency test: removing `lockForUpdate()` makes it FAIL (duplicates), restoring it makes it pass.
- TDD note: tests and implementation were written in one pass (no separate RED run was captured); the mutation check above is the evidence that the concurrency test can fail.
- Gates: `pint --test` passed, `phpstan analyse` no errors, `typescript:transform` + `i18n:export` regenerated and committed (git diff clean afterwards).

## Concerns
- Working directory of this session was reported as /home/user/furny-p2 (not a git repo); all work was done in /home/user/furny-p1 per context.md.
- No Gates-JS run (not required by the brief; no JS source changed besides generated files).

## Fix round 1
1. Media owner: `2026_10_20_020100_create_media_table.php` now uses `string('model_type')`, `string('model_id', 26)` and the composite index `media_model_type_model_id_index` instead of `ulidMorphs` (char(26) blank-padded `'business'`). `InfrastructureSchemaTest` expectation updated (varchar(26) + index). New test in SettingsTest attaches a fake logo to `BusinessProfile::instance()` and asserts `$media->model` is the BusinessProfile (key `business`, morph `business_profile`). The Media rtrim accessor is kept.
2. Seeder: `SettingsData::withEmptyMapsAsObjects()` (public static, also used by `toStorage()`) re-applies `{}` to empty map fields after `$stored + $seed`; change detection compares JSON of the normalised documents, so a no-op reseed writes nothing. New seeder test: deleting `sms_driver` is restored while raw `whatsapp_templates` stays `{}` and a further reseed leaves `updated_at` untouched.
3. `toWire()` omits `#[Encrypted]` properties (new unit test: wire is `['label' => 'visible']`); the `Encrypted` docblock now says audit redaction is enforced by the later audit task.

Evidence: `vendor/bin/pest tests/Unit tests/Feature` 235 passed (1221 assertions); `pint --test` passed; `phpstan analyse` no errors; generated TS/i18n unchanged.
