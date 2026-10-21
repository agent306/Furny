# Task 35 report: account deletion, anonymisation, data export

Status: DONE_WITH_CONCERNS (concerns are scope notes, none blocks). Commit: `35ebe3a feat(account): account deletion, 30-day anonymisation and data export`.

## Implemented

- `RequestAccountDeletion` (`DELETE /account`, `customer.account.destroy`, `recent.auth`): confirmation word (`account.delete_word`, case-insensitive, trimmed) then Active-order check (`active_orders`, numbers in the message and `orders` in the JSON context). One transaction: tagged `account.deletion_steps` run, `DeletionScheduled` mail (queued, after commit; date = now + 30 days in the business time zone), soft delete, push subscriptions deleted, audit `account.deletion_requested`. After the commit: `RevokeSessions::all` (registry sessions destroyed, remember token rotated, audit `auth.sessions_revoked`). The controller logs out, invalidates the session, clears Inertia history and redirects to `account.deletion-scheduled` with a one-time `anonymiseOn` flash.
- `AccountDeletionStep` contract + `DeleteNeverSubmittedDraftOrders` (hard delete of `draft` orders with `submitted_at` null, soft-deleted ones included), tagged in `AppServiceProvider::register()`.
- `AnonymiseUser::handle(User, via, ?actor)`: table of 13 §9.2, one transaction. Clears/replaces name, email, phone, the three verification stamps (including `first_contact_verified_at`), password, google_id, remember_token, `two_factor_*`, notes_internal, last_login_at, marketing_opt_in, sets `anonymised_at`. Deletes avatar, unused addresses (scrubs used ones), projects without orders (media of project/plans/designs/revisions/imports deleted explicitly, soft-deleted rows included), strips projects with orders (rename, notes null, plans and imports and their media deleted, designs kept), notifications, preferences, OTP codes by phone, push subscriptions, upload intents (and the bucket objects of unused ones), `password_reset_tokens` by email, DB `sessions` rows; nulls `notification_deliveries.user_id`; masks `confirmation_calls.phone_e164` and `quotes.accepted_by_ip`. Registry sessions are destroyed first. Immediate path (`via admin`) refuses with `active_orders`, runs the deletion steps and soft-deletes first. Audit `account.anonymised` (causer null for the scheduler, `via`).
- `users:anonymise-deleted` (`AnonymiseDeletedUsers`): customers with `deleted_at <= now()-30d`, `anonymised_at` null, chunked, one transaction per user, per-user failure is reported and the run fails but continues.
- `ExportUserData::stream` (`GET /account/export`, `recent.auth`, `verified.contact`, `throttle:data-export`): streamed JSON, `{app-slug}-export-{Y-m-d}.json`, version 1, `lazyById(100)` over every list, explicit column allowlist per section (camelCase keys), sections of 13 §9.3, `media[]` metadata only, audit `account.data_exported`.
- `RestoreDeletedAccount` + `Admin\CustomerController@restore` (`customers.manage`, 30 day window, not anonymised, else `restore_window_passed`) and `@anonymise` (`can:data.delete`, confirmation `ANONYMISE`). `{user}` routes use `withTrashed()`; staff targets are 404.
- UI: `Customer/Account/Delete.vue`, `Auth/AccountDeletionScheduled.vue`, "Delete account" AccountNav item (Wayfinder `deleteMethod`), `AccountDeleteProps`, `AccountDeletionScheduledProps`, `ActiveOrderRefData` (TypeScript-transformed), lang keys in `account`, `notifications`, `customers`.
- Test infra: `tests/Support/AccountDataFixture.php`; route-access entries; `AccessProbe` now treats a `recent.auth` redirect to `password.confirm` as "opened" (as it already did for `RequirePassword`).

## Files changed

New: `app/Domain/Identity/{Actions/{RequestAccountDeletion,AnonymiseUser,ExportUserData,RestoreDeletedAccount},Contracts/AccountDeletionStep,Data/{AccountDeleteProps,AccountDeletionScheduledProps,ActiveOrderRefData}}.php`, `app/Domain/Orders/Support/DeleteNeverSubmittedDraftOrders.php`, `app/Notifications/Account/DeletionScheduled.php`, `app/Console/Commands/AnonymiseDeletedUsers.php`, controllers `Customer/Account/{DeletionController,DataExportController}`, `Auth/AccountDeletedController`, `Admin/CustomerController`, requests `Account/RequestAccountDeletionRequest`, `Admin/Customers/{CustomerLifecycleRequest,RestoreCustomerRequest,AnonymiseCustomerRequest}`, the two Vue pages, tests below.
Modified: `User` (`activeOrders()`), `RevokeSessions` (`REASON_ACCOUNT_DELETION`), `AppServiceProvider`, `routes/{customer,web,admin}.php`, `resources/lang/en/{account,notifications,customers}.php`, `resources/js/lib/account.ts`, `types/domain.ts`, generated `generated.d.ts`/`lang/generated`, `AccountNav.test.ts`, `route-access.php`, `AccessProbe.php`.
Tests: `tests/Feature/Account/{AccountDeletionTest,AnonymiseUserTest,DataExportTest,CustomerLifecycleTest}.php`, `resources/js/pages/Customer/Account/__tests__/Delete.test.ts`, `resources/js/pages/Auth/__tests__/AccountDeletionScheduled.test.ts`.

## TDD evidence

- RED (before any implementation): `vendor/bin/pest tests/Feature/Account/{AccountDeletionTest,AnonymiseUserTest,DataExportTest,CustomerLifecycleTest}.php` gave `Tests: 94 failed (20 assertions)`: `Route [customer.account.export|destroy|delete|account.deletion-scheduled|admin.customers.*] not defined`, `Class App\Notifications\Account\DeletionScheduled not found`, `CommandNotFoundException` for `users:anonymise-deleted`, `BindingResolutionException` for `AnonymiseUser`.
- GREEN: the four files pass (AccountDeletion all, AnonymiseUser 30+, DataExport 16, CustomerLifecycle all). Two defects found on the way and fixed: controller methods lacked a `User $user` parameter, so `{user}` stayed a string (404); the "one customer fails" test mocked a `final` class and was rewritten around a `User::saving` hook.
- The anonymisation test classifies every column of `users` (`Schema::getColumnListing`) as personal or kept, so a new column fails the test until judged, and asserts each personal column differs from its filled value afterwards. 02 §1.1 lists the PII columns; `first_contact_verified_at` is in the migration but not in 02 (see deviations).

## Gates

- Gates-PHP: pint pass; phpstan level 8 clean; `vendor/bin/pest tests/Unit tests/Feature`: **4024 passed (17725 assertions), 0 failures** (baseline 3924, +100).
- Gates-Gen: `typescript:transform` + `i18n:export` + `git diff --exit-code` clean after the commit.
- Gates-JS: lint, format:check, typecheck clean; vitest **5081 passed (208 files)** (baseline 5072, +9).
- Browser: `yarn vite build && vendor/bin/pest tests/Browser`: 117 passed, 1 failed with `net::ERR_NO_BUFFER_SPACE` (Windows socket exhaustion, `RecoveryPagesTest` on `/email/verify`); rerun of `RecoveryPagesTest` + `AccountPagesTest`: 39 passed.

## Carries

1. AccountNav "Delete account" item added with Wayfinder (`deleteMethod`); `AccountNav.test.ts` counts four customer items and `/account`.
2. Reuses AccountPage/AccountNav, `SessionRegistry` via `RevokeSessions::all`, and `recent.auth` (page, deletion and export).
3. PII: audit properties hold ids and `via` only (test asserts no name/email/phone in the log); no PII in URLs, cache keys, job names; the queued mail carries the user id and a date. Anonymisation covers every `users` PII column (classification test), avatar media, registry and DB sessions, `google_id`, remember token, password reset tokens, OTP codes.
4. The export is streamed, never written to storage or exposed by URL, so there is no file to sign; media are listed as metadata only.
5. No upload path touched; `UploadIntent` rows of the user are deleted at anonymisation.

## Deviations / decisions

- Spec names over the plan's file list (the task says the spec wins; preflight C10): `Customer\Account\DeletionController`/`DataExportController`, `Auth\AccountDeletedController`, `Admin\CustomerController@restore/@anonymise` (not `CustomerLifecycleController`), `RestoreDeletedAccount` (not `RestoreDeletedCustomer`), word key `account.delete_word` (not `account.delete.confirm_word`), `CodedValidationException` codes from 14.
- `customer.account.delete` (the page) is also behind `recent.auth`, per 14 §9 (the brief listed it only on destroy and export).
- Cancelling previously submitted draft orders (T3) and non-terminal imports (`CancelImport`) are not implemented: those actions do not exist yet. They belong to steps P6/P7 register under `account.deletion_steps`. A reopened (submitted-before) draft is left alone and tested as such.
- Blocked-order list on the Delete page shows numbers without links: `customer.orders.show` does not exist yet.
- `admin.customers.anonymise` redirects to `admin.customers.index` when that route exists (P5), else `admin.dashboard`. Restore returns back.
- `users:anonymise-deleted` is not scheduled: the schedule is Task 39 (preflight a93).
- `first_contact_verified_at` (not in 02, in the migration) is nulled with the other verification stamps.
- `AnonymiseUser` has an optional third argument `?User $actor` (the owner) and an `admin` via; scheduled runs never refuse on Active orders (13 §9.2 says only the immediate path does).
- `DeletionScheduled` is queued (restores a soft-deleted user by id) and sends nothing to a customer without an email.
- The unused-upload objects are deleted from the `s3` disk after commit; failures there are not retried (bucket lifecycle on `tmp/` is the backstop).

## Concerns

- Upload-intent object deletion and media-file deletion happen inside the transaction/after commit and cannot be rolled back; a failure mid-way leaves files gone and rows rolled back, and the next run finishes it.
- The export includes `acceptedByIp` of quotes (the customer's own data, unmasked).
- The `RecoveryPagesTest` browser flake above is environmental.
