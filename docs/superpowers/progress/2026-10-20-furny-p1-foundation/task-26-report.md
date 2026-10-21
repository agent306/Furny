# Task 26 report: password reset, email verification, profile and password updates, `ContactVerified`

Branch `build/p1-foundation`, base `4f1f6b6`.

## What was implemented

Backend
- `config/fortify.php`: `updateProfileInformation` and `updatePasswords` are on. `config/auth.php`: `verification.expire 60`, `password_timeout 600` (default of the env var), plus `password_reset_timebox_microseconds` (production 1.5 s, tests 0 in `tests/Pest.php`). `passwords.users.expire/throttle 60` were already there.
- `App\Domain\Identity\Support\ContactVerification` (`markEmailVerified`, `markPhoneVerified`): in a transaction, row locked, sets the timestamp and dispatches `ContactVerified` (after commit) iff both timestamps were null in the database. `User::markEmailAsVerified()` goes through it; `sendEmailVerificationNotification()` is a no-op without an email; `sendPasswordResetNotification()` uses the new notification.
- `App\Notifications\Auth\{ResetPassword,VerifyEmail}`: transactional mail, keys `notifications.auth.{password_reset,email_verification}.{subject,title,body,action}`; verification URL is the temporary signed `verification.verify` (60 min). Both are sent synchronously and not queued: the reset token must not sit in a queue payload.
- `App\Actions\Fortify\{ResetUserPassword,UpdateUserPassword,UpdateUserProfileInformation}` (reset replaces the kit version):
  - reset: validates, sets password, `email_verified_at` through `ContactVerification` when null, audit `auth.password_reset`, `RevokeSessions::all(..., 'password_reset')` (which rotates `remember_token` through `SessionRegistry::destroyAll`).
  - password update: `current_password` only when the user has a password; audit `auth.password_changed`; `RevokeSessions::others(..., 'password_changed')`; the remember cookie of the browser that made the request is re-queued with the new token and hash (`App\Support\Auth\RememberCookie`, extracted from `SessionController::destroyOthers`, which now uses it).
  - profile: 13 section 5.8 rules (unique including soft-deleted, `auth.email_unavailable`; clearing the last login method, `auth.errors.last_login_method`; changed email starts unverified, `VerifyEmail` sent, audit `account.email_changed` with masked `from`/`to`); staff email required; `marketing_opt_in` for customers.
- `App\Http\Middleware\FortifyRouteGuards` extended (14 section 3.1, preflight C9):
  - `password.email`: Turnstile `password_reset` (fail open), then the `password-reset` limiter applied silently (the throttle middleware is reused and its refusal is caught, so keys and counters are the framework's): a throttled request validates the email field and gets the generic response, no mail. The whole request is wrapped in a `Timebox`.
  - `verification.send`: `throttle:verification-resend`.
  - `user-profile-information.update`: throws `RecentAuthenticationRequired` when the submitted email differs from the current one (before validation, so a taken address is not disclosed to someone without recent auth). Guests are left to `auth`.
- Responses bound over Fortify's: `GenericPasswordResetLinkResponse` (for both success and failure, status `passwords.sent_generic`), `PasswordUpdatedResponse`, `ProfileUpdatedResponse`, `EmailVerifiedResponse` (flash `account.toasts.*` with `Inertia::flash`, intended redirect for verification).
- `App\Listeners\HandleEmailVerified` (on `Verified`): audit `account.email_verified` (masked email).
- `RateLimitedResponse::INLINE_ROUTES` gained `verification.send` (inline countdown on the verify page, not a toast).
- Verify page view: phone-only users (no email) are redirected to their dashboard; page gets `email`.
- Lang: `passwords.sent_generic`, `auth.errors.last_login_method`, `account.toasts.{email_verified,password_updated,profile_updated}`, `notifications.auth.*`, `auth_ui.{forgot,reset,verify,confirm}.*`; `i18n:export` regenerated.
- `tests/Feature/Security/route-access.php`: `user-profile-information.update`, `user-password.update` (any).

Frontend: `resources/js/pages/Auth/{ForgotPassword,ResetPassword,VerifyEmail,ConfirmPassword}.vue` rewritten from the kit versions in the style of Task 25's Login/Register (i18n via `t()`, one h1, required `*` marks, `aria-invalid`/`aria-describedby`, focus on first invalid field, Turnstile on forgot-password, inline `ThrottleNotice` on the verify page, password hint). Wayfinder routes regenerated locally (they are gitignored).

## Tests and results

- New: `tests/Feature/Auth/{ForgotPassword,ResetPassword,EmailVerification,ContactVerified,ProfileInformation,PasswordUpdate}Test.php` (the six files of the brief), `tests/Support/RegistryFixtures.php`, `resources/js/pages/Auth/__tests__/Recovery.test.ts` and additions to `errors.test.ts`, `tests/Browser/RecoveryPagesTest.php` (layout at 375/820/1280, one h1, axe, no JS errors for the four pages).
- Updated: `FortifyConfigTest` (features on, responses and actions bound), `LoginTest` (INLINE_ROUTES), `RegisterTest` (app `VerifyEmail` class).
- Final runs:
  - `vendor/bin/pest tests/Unit tests/Feature`: 2782 passed, 1 skipped (the passwordless email-change redirect, skipped because `auth.reauthenticate` does not exist yet; a sibling test asserts that the `RecentAuthenticationRequired` exception is thrown for such a user).
  - `yarn vitest run`: 70 files, 1170 passed.
  - Browser suite (after `yarn vite build`, `PLAYWRIGHT_BROWSERS_PATH` set): 61 passed.
  - Pint, PHPStan level 8: clean. `yarn lint`, `format:check`, `typecheck`: clean. `typescript:transform` and `i18n:export`: only the committed `lang/generated` changes.

### TDD evidence
- RED: `vendor/bin/pest` on the six new files before implementation: `Tests: 103 failed, 1 skipped, 28 passed` (missing classes, `Route [user-password.update] not defined`, missing `sent_generic` etc.).
- GREEN: the same six files plus `FortifyConfigTest` after implementation: all pass (ProfileInformation needed two fixes found by the tests: the test's Referer header, and the DB constraint below).

## Findings and judgment calls

1. **DB constraint `users_email_or_phone_check`** (email IS NOT NULL OR phone_e164 IS NOT NULL). Clearing the email of a Google-linked user without a phone number would be a 500. The last-login-method rule therefore needs a phone number on record as well: `phone_e164 !== null && (phone verified || google_id)`. Slight tightening of 13 section 5.8, tested.
2. **`ContactVerified` re-dispatch after an email change.** As decided, it is dispatched on the none-to-some transition. A customer who verified an email, changes it (both timestamps null), and verifies the new one dispatches it a second time, which 13 section 5.6 says must not happen. `GrantSignupCredits` is idempotent by design (18 section 10.1: no existing `signup_grant` row), so no double credit, but the event itself is not "once per user". A fix needs memory of the first contact (a column or an audit lookup); left alone.
3. **`verification.send` inline 429** is applied to every use of that route. When the future `VerifyContactBanner` posts to it from the dashboard, a throttled request will come back as the `rate_limited` validation error instead of a toast; that task should handle it (or narrow `INLINE_ROUTES` by the page the request came from).
4. **Timebox on forgot-password** (1.5 s in production) is my addition, in the spirit of Task 25's login timebox: the reset mail is sent synchronously, so without it a known address is measurably slower than an unknown or throttled one.
5. Passwordless recent-auth path: `RecentAuthenticationRequired` redirects to `auth.reauthenticate`, which does not exist yet; the redirect assertion skips with that reason.
6. Sign-in with the old email after an email change is unaffected, as instructed. The kit pages in `resources/js/components/{InputError,PasswordInput,TextLink}.vue` are probably dead now except for TwoFactorChallenge; not touched.
7. The interactive browser flows (submitting a form) hang in this environment (a plain login form submit also hangs in the Pest browser harness, pre-existing); the browser tests therefore cover rendering and accessibility only. Form behaviour is covered by Feature tests and vitest.

## Files changed

app: `Actions/Fortify/{ResetUserPassword,UpdateUserPassword,UpdateUserProfileInformation}.php`, `Concerns/ProfileValidationRules.php`, `Domain/Identity/{Actions/RevokeSessions,Events/ContactVerified,Models/User}.php`, `Domain/Identity/Support/ContactVerification.php`, `Http/Controllers/Account/SessionController.php`, `Http/Middleware/FortifyRouteGuards.php`, `Http/Responses/{EmailVerified,GenericPasswordResetLink,PasswordUpdated,ProfileUpdated}Response.php`, `Listeners/HandleEmailVerified.php`, `Notifications/Auth/{ResetPassword,VerifyEmail}.php`, `Providers/FortifyServiceProvider.php`, `Support/Auth/RememberCookie.php`, `Support/Http/RateLimitedResponse.php`; config: `auth.php`, `fortify.php`; resources: four Auth pages, `lang/en/{account,auth,auth_ui,notifications,passwords}.php`, `js/lang/generated/*`, tests listed above.

## Self-review

Read the whole diff: no leftover debugging, strict types everywhere, files stay small, no PII in audit properties or cache keys (checked by tests on the audit JSON). No subagents used.

## Fix round 1

Review approved the task; this round applies the coordinator's list.

**A. `ContactVerified` once per user**
- New nullable `users.first_contact_verified_at`, placed after `phone_verified_at` in `create_users_table` (edited in place, like the earlier schema fixes of this branch, so the column sits where the data dictionary would list it). No separate migration and no backfill: nothing is deployed yet, so the create migration has no rows to backfill. If a backfill migration is wanted for an existing database, it is `UPDATE users SET first_contact_verified_at = least(email_verified_at, phone_verified_at)` for rows with either set; say so and I will add it.
- `User` docblock and cast, `UserFactory` (default and `emailVerified`/`withPhone` set it; `unverified`/`phoneOnly` clear it), `IdentitySchemaTest` column list.
- `ContactVerification` sets the timestamp, then runs one conditional `UPDATE users SET first_contact_verified_at = ? WHERE id = ? AND first_contact_verified_at IS NULL` and dispatches `ContactVerified` (after commit) only when it affected 1 row. The row lock is gone (review M6). `markEmailVerified` is a no-op for a null email (M7).
- Tests: change a verified email then verify the new one gives no second dispatch (model level and the whole HTTP path); another request that got there first gives no dispatch for a stale model; first moment kept; null email no-op.
- Spec note for 19: `02 §1.1` (users data dictionary) needs a `first_contact_verified_at timestamptz null` row ("set once, by the first verified email or phone; `ContactVerified` fires when it is set; 13 §5.6"). 13 §9.2 (anonymisation) keeps it: it is not PII. 03 has no users column list.

**B. Mail**
- `ResetPassword` and `VerifyEmail` are `ShouldQueue` and `ShouldBeEncrypted` (`Queueable`). The app Timebox on forgot-password is removed with its config key and the test setting; the broker's own 200 ms box stays. `FortifyRouteGuards` docblock updated.
- New `tests/Feature/Auth/QueuedAuthMailTest.php` (database queue): the request sends nothing and answers the same for known and unknown addresses; an unreachable SMTP transport does not reach the request (302 generic, jobs queued, resend 302); the queued payload does not contain the reset token, the signed-link signature or the email, and its command is not a plain serialised object (mutation check: dropping `ShouldBeEncrypted` fails it).

**C. Minors**
- M2: two tests with a 3-hour-old sign-in: an email that differs only by case or spaces, and an absent `email` field, both need no recent authentication (read as the review states it: the guard's correct behaviour, now pinned).
- M3: `token` added to `dontFlash`; test that a refused reset leaves no `token` in the old input (fails without the entry).
- M8: `account.email_verified` already records the masked email through `Mask::email` (`{email}`); kept, with the existing test. 13 §17's `from`/`to` wording for that event is what should be corrected in 19.
- M9: titles fixed (`ProfileInformationTest` sign-in with the new email; `PasswordUpdateTest` "is written once for each change of the password").
- M10: the Turnstile widget root has `tabindex="-1"`, and Forgot and Register set `aria-invalid` on it for a captcha-only error, so `focusFirstError` moves focus to it (vitest asserts focus).
- Review M1/M4/M5 are resolved by B; M3's form of the timing test is gone with the Timebox.

**Results:** `vendor/bin/pest tests/Unit tests/Feature` 2793 passed, 1 skipped (the `auth.reauthenticate` skip); vitest 1170 passed; browser suite 61 passed; Pint, PHPStan, lint, format:check, typecheck clean; `typescript:transform`/`i18n:export` produce no diff.
