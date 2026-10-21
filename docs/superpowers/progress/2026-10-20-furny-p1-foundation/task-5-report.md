# Task 5 report: infrastructure and package tables

Status: DONE (one noted deviation, see Concerns). Commit: fed2a12 `feat(schema): package tables with ULID morphs, upload intents and notification deliveries`.

## Implemented
- Deleted kit `0001_01_01_00000{1,2}` migrations; created the 14 migrations `2026_10_20_020000`..`021300` (permission, media, activity_log, notifications, notification_deliveries, push_subscriptions, upload_intents, jobs, job_batches, failed_jobs, cache(+locks), sessions (recreated, `user_id char(26)` nullable indexed, no FK), pulse, telescope).
  - ULID morphs: `model_has_*.model_id` `$table->ulid('model_id')` (config `model_morph_key = model_id`), `ulidMorphs('model')` for media, `nullableUlidMorphs` for activity_log subject/causer, `ulidMorphs('notifiable')` (+ the two indexes), `ulidMorphs('subscribable')` for push subscriptions.
  - `notification_deliveries`: self-FK `fallback_of_id` (N) is added in a second `Schema::table` because Laravel emits the FK before the PK in the same create (PG error "no unique constraint"); partial unique index `(driver, provider_message_id) WHERE provider_message_id IS NOT NULL`.
  - Pulse migration reduced to the pgsql `key_hash` expression (PG-only app; satisfies Larastan match.unhandled without ignores).
- Configs published and edited: `permission`, `media-library` (disk `env('MEDIA_DISK','s3')`, queue `env('MEDIA_QUEUE','default')`, `QUEUE_CONVERSIONS_BY_DEFAULT`, `media_model` = `App\Support\Media\Media`, `IMAGE_DRIVER` gd; Media Library Pro-only keys removed, Pro not installed), `activitylog`, `webpush` (connection null = default), `pulse` (ingest driver from `PULSE_INGEST_DRIVER`; Pulse user resolver left to Task 22). `config/telescope.php` already existed (Task 2).
- Enums: `DeliveryDriver`, `DeliveryStatus` (Identity), `UploadPurpose` (14 cases), `UploadStatus` (Shared), all `#[TypeScript]`; `generated.d.ts` regenerated.
- Models: `NotificationDelivery` (casts, `user`, `fallbackOf`, `fallbacks`), `UploadIntent` (casts, `user`, `target(): MorphTo`), `App\Support\Media\Media` (`model_id` accessor `rtrim`).
- `User`: `HasPushSubscriptions`, `HasMedia`/`InteractsWithMedia`, `avatar` collection (disk `s3-public`, single file, jpeg/png/webp) + `thumb` conversion (Fit::Crop 128x128, avatar collection only), `notificationDeliveries()`, `uploadIntents()`.
- `MorphMap::MAP` (user, address, otp_code, notification_preference, staff_invitation, upload_intent, notification_delivery; C5 aliases `otp_code`/`notification_preference` added) and `Relation::enforceMorphMap(MorphMap::MAP)` in `AppServiceProvider::boot`.
- Rulings applied: sessions table recreated; Identity models' (User, Address, OtpCode, NotificationPreference, StaffInvitation) `@property` docblocks now `Carbon\CarbonImmutable`; new models use CarbonImmutable.
- Factories: `NotificationDeliveryFactory` (states sms, driver, accepted, sent, delivered, read, failed, fallbackOf), `UploadIntentFactory` (states pending, uploaded, ready, rejected(reason), consumed, expired, purpose, forTarget).

## Tests (all in worktree /home/user/furny-p1)
- RED: `vendor/bin/pest tests/Feature/Schema/InfrastructureSchemaTest.php tests/Feature/Models` before implementation: `Tests: 112 failed (0 assertions)`, cause `Class "App\Support\Media\Media" not found` (medialibrary provider boots with the configured model); expected since nothing existed yet.
- GREEN: same command after implementation: `Tests: 112 passed (532 assertions)`; after adding the config tests, `vendor/bin/pest tests/Unit tests/Feature`: all pass (181 tests; was 179 before the 2 config tests).
- Files: `tests/Feature/Schema/InfrastructureSchemaTest.php`, `tests/Feature/Models/{UploadIntentTest,MorphMapTest,ActivityLogUlidTest,InfrastructureModelsTest}.php` (extra: delivery model/factory behaviour, avatar collection/conversion registration, media padding accessor, push subscription alias), `tests/Feature/Config/ConfigValuesTest.php` (+2: media-library defaults, Pulse ingest driver).
- Gates: `pint --test` passed; `phpstan analyse` "No errors"; `typescript:transform` + `i18n:export` run, only `resources/js/types/generated.d.ts` changed (committed). `migrate:fresh` and `migrate:rollback` verified on the dev DB `furny`.

## Concerns / notes
- Deviation: installed spatie/laravel-activitylog v5 reads `activitylog.clean_after_days` (not `delete_records_older_than_days`). Config sets both to 1095 so the brief's test key and the working `activitylog:clean` agree.
- Conversion generation is not asserted end to end: with `queue_conversions_after_database_commit` true, conversions never fire inside the test transaction. The test asserts the registered conversion list (`['thumb']`) instead.
- `failed_jobs` uses the current framework stub (`connection`/`queue` as text).
- Later tasks (9, 12) must append `furniture_template_setting` and `message_read` to `MorphMap::MAP` (C5), else `MorphMapTest` fails.

## Fix round 1
- `config/media-library.php`: `max_file_size` raised to `1024*1024*40` (largest collection, 02 §10); per-purpose limits stay at presign. Test added in `tests/Feature/Config/ConfigValuesTest.php` (config value >= 40 MB).
- `app/Support/Media/Media.php`: `model_id` accessor now `$value === null ? null : rtrim($value)`; test added in `InfrastructureModelsTest.php` (null stays null).
- Ran: `vendor/bin/pint --test` passed; `vendor/bin/phpstan analyse` no errors; `vendor/bin/pest tests/Unit tests/Feature` 183 passed (920 assertions).
- Commit: see `git log` ("fix(media): accept files up to 40 MB and keep a null model id null").
