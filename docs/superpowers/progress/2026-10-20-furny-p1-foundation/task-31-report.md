# Task 31 report: two-factor authentication enforcement

Status: DONE_WITH_CONCERNS (the concerns are decisions to confirm, listed at the end).

Commits (on `build/p1-foundation`, pushed):
- `4efea21` fix(staff): Task 30 review minors (items 1-8)
- `3aa6e6d` feat(auth): mandatory TOTP for owners/admins and two-factor management page

## What was implemented

### Task 30 review minors (commit 4efea21)
1. **Owner gate asked again under the lock.** `StaffAccess::reload($actor)` re-reads the actor. `UpdateStaffMember`, `DeactivateUser` and `ActivateUser` now call `authorizeTarget` (and `authorizeGrant` for the update) once more after `lockOwners()` and `refresh()`, on the reloaded actor and the refreshed target. `ActivateUser` now takes the owners lock too (a promotion to owner takes it, so the two serialise). `ResetTwoFactor` got the same lock and re-check, for the same reason, although the review did not list it.
2. **Mail `expires_at` test.** The mail test travels 2 h between the invite and `toMail()`, the resend test 1 h; both assert that `expires` equals `expires_at` and differs from `now()+72h`. Mutation check: the URL built with `now()->addHours(72)` now fails 2 tests (it survived before).
3. **Target owner-gate tests.** Action-level tests for `UpdateStaffMember`, `DeactivateUser`, `ActivateUser`, `ResetTwoFactor` with an admin on an owner (each throws `AuthorizationException` and changes nothing), plus an owner on an owner.
4. **`ActivateUser` revokes sessions and rotates `remember_token`** (`RevokeSessions::all`, new reason `reactivated`). Audit `auth.sessions_revoked` only when a session was open, as everywhere else. An already-active member is left alone.
5. **`ResetTwoFactor` and the report on a member with no second factor.** Spec 13 §5.10 has no exception: it clears, destroys the sessions and audits. So the **code was right and the Task 30 report was wrong** ("no-op without audit" was true only for deactivate/reactivate). The behaviour is now pinned by tests (a member with nothing, and a never-confirmed enrolment) and documented in the action's docblock. The UI still offers Reset only when `twoFactorEnabled`.
6. **Dialogs clear stale errors.** `InviteStaffDialog` and `EditStaffDialog` show only the refusals of their own send (the `onError` argument), cleared on open and on each send; `page.props.errors` is no longer read, so the toasted resend refusal can never show under the invite dialog's email field.
7. **Resend and Revoke hidden** on `owner` invitations without `staff.manage_owners` (`usePermissions`).
8. **Terms captions as one ICU message with tags.** `staff.accept.terms` and `auth_ui.google.caption` hold the whole sentence with `<terms>` and `<privacy>` tags. New `parts()` in `lib/i18n.ts` (text and tagged runs, never throws) and `components/common/RichText.vue` (one slot per tag). `i18n-keys.test.ts` also checks `message-key="..."` literals. I did not touch the register page's `TermsCheckbox`, which has the same fragment pattern (outside the item).

### Task 31 (commit 3aa6e6d)
- **Middleware** (both in the `web` group, `bootstrap/app.php`): `PreventRequiredTwoFactorDisable` (`two-factor.disable` for owner/admin: 403 with `auth.errors.2fa_required`) and `PreventCustomerTwoFactor` (every `two-factor.*` route, challenge included, 403 for customers; before `password.confirm`, so no password prompt).
- **Page** `admin.security.two-factor` (`GET /admin/account/two-factor`, `Admin\Account\TwoFactorController@show`, `TwoFactorPageProps {enabled, confirmed, required, enforced}`, `enforced = required && !confirmed`). It sits in the admin group and is exempt through `EnsureTwoFactorEnrolled::EXEMPT`. Route-access entry added (`staff`).
- **`Admin/Account/TwoFactor.vue`** and `components/account/RecoveryCodesPanel.vue`: enable (password-confirmed: a stale confirmation redirects to `password.confirm`, which returns to the page; a 423 on the JSON reads does the same), QR code shown as an `<img>` with a `data:` URI (never `v-html`), setup key with copy, confirmation form in Fortify's error bag, eight recovery codes with Copy, Download (client-side Blob `{app-name}-recovery-codes.txt`, app name kebab-cased, e.g. `furny-joinery-recovery-codes.txt`) and a required "I saved these codes" checkbox that gates the Done button; regenerate (confirm dialog); Disable (confirm dialog) only when `!required`, else the note "Two-factor authentication is required for your role."; enforcement banner; after saving the codes an enforced user continues to the dashboard.
- **`Auth/TwoFactorChallenge.vue`** replaces the kit page: code or recovery-code toggle, required markers, focus on the first error, inline 429 countdown (`two-factor.login.store` added to `RateLimitedResponse::INLINE_ROUTES`), `auth_ui.two_factor.*` strings, help text for someone who lost both.
- **Audit**: `RecordTwoFactorEvents` (Fortify `TwoFactorAuthenticationConfirmed` -> `auth.2fa_enabled`, `TwoFactorAuthenticationDisabled` -> `auth.2fa_disabled`, `RecoveryCodeReplaced` -> `auth.recovery_code_used`; security log, user is subject and causer, no properties, the code is never recorded).
- **Console** `furny:reset-two-factor {email}`: reuses `ResetTwoFactor` with causer null and `via: console`; the address is trimmed and lower-cased; fails for an unknown address and for a customer; resets deactivated staff too.
- **Login method through the challenge**: unchanged mechanism (`auth.pending_method` is pulled by `RecordSuccessfulLogin` when Fortify's challenge logs the user in). Pinned for the password path (audit `method: password`, `auth.method`, `auth.remember` false, `auth.login_at` int); the Google path keeps its existing tests in `GoogleOAuthTest` (and the deferred link tests still pass). OTP cannot reach staff (`staff_use_email`).
- **Legacy kit removal**: deleted `components/{AlertError,InputError,PasswordInput,TextLink}.vue` (unused) and the `TwoFactorConfigContent` type; removed `LEGACY_KIT_FILES` and its ignore block from `eslint.config.js`. The other five names in that list (ConfirmPassword, ForgotPassword, ResetPassword, VerifyEmail, the old challenge) had been rewritten by earlier tasks already. `yarn lint` passes with `vue/no-bare-strings-in-template` on every file; no new violation surfaced, nothing re-ignored.
- **Route map / probe**: `route-access.php` has `admin.security.two-factor`; `AccessProbe` knows that `two-factor.*` answers 403 to a customer (signed-in routes and the guest challenge routes).

## Tests

### TDD evidence
RED (before implementation):
- Task 30 minors, `vendor/bin/pest tests/Feature/Staff/StaffManagementTest.php`: `Tests: 10 failed, 68 passed` (8 re-check-under-lock cases, 2 reactivation cases).
- Mail expiry mutation (after the test rewrite, `StaffInvited` built from `now()->addHours(72)`): `Tests: 2 failed, 44 passed`; restored.
- Dialogs / terms / parts / RichText: vitest failed on the new assertions before the code (`parts is not a function`, stale error shown, owner invitation buttons present).
- Task 31 PHP, `vendor/bin/pest tests/Feature/Auth/TwoFactorTest.php`: `Tests: 32 failed, 13 passed`.
- Task 31 vitest, `yarn vitest run resources/js/pages/Admin/Account`: failed to load (component missing); `TwoFactorChallenge.test.ts`: `Tests 7 failed (7)` against the kit page.

GREEN / final gates (on 3aa6e6d):
- `vendor/bin/pest tests/Unit tests/Feature`: **3478 passed** (15081 assertions), includes the staff concurrency tests.
- `vendor/bin/pest tests/Browser` (after `yarn vite build`, with `PLAYWRIGHT_BROWSERS_PATH`): **95 passed** (14 new in `TwoFactorPagesTest`: three states at 375/820/1280 px, axe, Disable shown/hidden).
- `yarn vitest run`: **88 files, 1358 passed**. `yarn lint`, `yarn format:check`, `yarn typecheck`: clean.
- `vendor/bin/pint --test`: passed. `vendor/bin/phpstan analyse`: no errors.
- Gates-Gen: `typescript:transform` and `i18n:export` run, `git diff --exit-code -- resources/js/types/generated.d.ts resources/js/lang/generated` clean.
- Mutation checks: `PreventRequiredTwoFactorDisable` and `PreventCustomerTwoFactor` made no-ops: 12 of 48 `TwoFactorTest` tests fail; restored.

### New or changed test files
`tests/Feature/Auth/TwoFactorTest.php` (48), `tests/Feature/Staff/{StaffManagementTest,InviteStaffTest}.php`, `tests/Browser/TwoFactorPagesTest.php`, `resources/js/pages/Admin/Account/__tests__/TwoFactor.test.ts` (20), `resources/js/pages/Auth/__tests__/TwoFactorChallenge.test.ts` (7), `components/common/__tests__/RichText.test.ts`, plus the staff dialog, Index, GoogleButton, AcceptInvitation, i18n and i18n-keys tests. `LoginTest` (the INLINE_ROUTES list) and `tests/Support/Routing/AccessProbe.php` were adjusted.

## Files
Created: `app/Http/Middleware/{PreventRequiredTwoFactorDisable,PreventCustomerTwoFactor}.php`, `app/Http/Controllers/Admin/Account/TwoFactorController.php`, `app/Domain/Identity/Data/TwoFactorPageProps.php`, `app/Listeners/RecordTwoFactorEvents.php`, `app/Console/Commands/ResetTwoFactorCommand.php`, `resources/js/pages/Admin/Account/TwoFactor.vue`, `resources/js/components/account/RecoveryCodesPanel.vue`, `resources/js/components/common/RichText.vue`, tests above.
Modified: `bootstrap/app.php`, `routes/admin.php`, `app/Support/Http/RateLimitedResponse.php`, `app/Domain/Identity/{Actions/{ActivateUser,DeactivateUser,UpdateStaffMember,ResetTwoFactor,RevokeSessions},Support/StaffAccess}.php`, `resources/lang/en/{auth,auth_ui,account,staff}.php`, `resources/js/{lib/i18n.ts,lib/icons.ts,pages/Auth/TwoFactorChallenge.vue,pages/Auth/AcceptInvitation.vue,pages/Admin/Staff/Index.vue,components/auth/GoogleButton.vue,components/admin/staff/*Dialog.vue,types/auth.ts}`, generated types and i18n catalogue, `eslint.config.js`.
Deleted: `resources/js/components/{AlertError,InputError,PasswordInput,TextLink}.vue`.

## Self-review
- Read the whole diff. No scratch files left (the scratchpad backups used for the mutation checks are removed; `tests/Browser/screenshots` is clean).
- `StaffAccess::reload` creates a separate model for the actor; the caller's instance is not mutated.
- The new vitest page tests drive Fortify's JSON routes with a stubbed `fetch`; the real flow (enable, QR, confirm, codes) is covered end to end on the server by `TwoFactorTest`, not in a browser (the browser plugin does not deliver redirects after a POST, see Task 26/30 notes).

## Concerns (decisions to confirm)
1. **Rate limiter key.** The brief says "5 per minute per `login.id` and IP"; 13 §10 and 14 §3.1 say 5/min keyed by `session('login.id')` only, and the existing `two-factor` limiter (config + `RateLimitServiceProvider`, pinned by `RateLimitersTest`) does that. I kept the spec: adding the IP would let a botnet multiply the 6-digit guesses per account. No limiter code changed in this task.
2. **`PreventCustomerTwoFactor` also answers the guest challenge routes** (`two-factor.login*`) with 403 for a signed-in customer, because the spec says "every `two-factor.*` route". Before, such a customer was redirected home by the `guest` middleware. `AccessProbe` encodes the new answer.
3. **`enforced` prop** is computed (`required && !confirmed`) rather than from the redirect, so the banner survives a reload; the toast from `EnsureTwoFactorEnrolled` still shows once.
4. **Download file name** is the kebab-cased app name (`furny-joinery-recovery-codes.txt`), so names with spaces stay valid file names.
5. **`ResetTwoFactor` is unconditional** (no no-op path), per spec; the Task 30 report line is the inaccurate side (see item 5 above). I did not edit the old report file.
6. **No navigation entry** to the 2FA page yet: the account pages and `AccountNav` belong to Task 34; today the page is reached through the enforcement redirect or its URL.
7. `ResetTwoFactor` and `ActivateUser` now take the owners advisory lock (small widening of the review's list); `TwoFactorController` has no Form Request because it only reads.

## Fix round 1

Review: `task-31-review.md` (spec ✅, quality NEEDS FIXES). One commit on top of 3aa6e6d.

### Changes
- **I1 (false success when the password confirmation ran out).** `TwoFactor.vue`:
  (a) `ensureConfirmed()` reads `GET /user/confirmed-password-status` before enable, confirm-code, regenerate, disable and cancel-setup; if not confirmed the person is sent through the password confirmation and nothing is posted (for regenerate/disable this happens before the dialog). An unreadable status does not stop the action (the server decides, and (b) catches the redirect).
  (b) `onSuccess` of confirm, regenerate and disable/cancel acts (toast, codes read, state) only when `usePage().component` is still `Admin/Account/TwoFactor`.
  Vitest: each action's visit landing on `Auth/ConfirmPassword` gives no toast and no recovery-code read (4 cases), stale status posts nothing and goes to the confirmation (4 cases), a visit that stays on the page still toasts.
- **M1 (return to the page).** `GET /admin/account/two-factor?confirm-password=1` (no new route, so the exempt list of 13 §5.10 is untouched): when the password is not confirmed within `auth.password_timeout`, the controller stores the page as `url.intended` and redirects to `password.confirm`; when it is confirmed, the page renders. All password-confirmation hand-offs on the page (423 on the JSON reads, stale status) use it. Feature tests for estimator, admin and owner (redirect, then confirm lands on the page) and for the already-confirmed case.
- **M2.** `PreventCustomerTwoFactor` docblock now says the challenge routes are 403 for a signed-in customer too.
- **M3.** `reset` added to the demoted-while-waiting dataset in `StaffManagementTest` (it also asserts the target's second factor is untouched). It was already green because `ResetTwoFactor` reloads the actor; mutating `reload($actor)` to `$actor` now fails it.
- **M4.** "Cancel setup" button (`cancel-setup-button`) while `settingUp && !required`, with its own confirm text and toast, through the same `DELETE two-factor.disable`. Feature tests: estimator/support can cancel an unconfirmed setup (columns cleared); owner/admin get 403 and the secret stays. Note: Fortify fires `TwoFactorAuthenticationDisabled` for a cancelled setup too, so it is audited as `auth.2fa_disabled`.
- **M5.** `RecoveryCodesPanel.vue` revokes the object URL in `setTimeout(…, 0)`; the download test asserts it is not revoked synchronously and is revoked afterwards.
- **⚠️ `2fa.enrolled` and JSON.** `EnsureTwoFactorEnrolled` answers `403 {code: 'two_factor_required'}` to non-Inertia JSON requests (same pattern as `EnsureContactVerified`: no `X-Inertia` header and `expectsJson()`); Inertia visits (even with an Accept that includes JSON) keep the redirect and the flash. Tests: GET and POST as JSON (exact body), Inertia visit keeps the redirect, exempt routes still open to JSON.

### TDD evidence
- RED, `vendor/bin/pest` on `TwoFactorTest`, `EnsureTwoFactorEnrolledTest`, `StaffManagementTest`: `4 failed, 156 passed` (3 password-confirmation return cases, 1 JSON 403 case; the cancel-setup server cases and `reset` were already satisfied by existing behaviour).
- RED, `yarn vitest run resources/js/pages/Admin/Account`: `11 failed` of 31 (stale confirmation, redirect-as-success, cancel button, deferred revoke, new password-page URL).
- GREEN (final tree):
  - `vendor/bin/pest tests/Unit tests/Feature`: 3490 passed (15155 assertions).
  - `vendor/bin/pest tests/Browser` (after `yarn vite build`, `PLAYWRIGHT_BROWSERS_PATH` set): 95 passed.
  - `yarn vitest run`: 88 files, 1369 passed.
  - `vendor/bin/pint --test`, `vendor/bin/phpstan analyse`: clean. `yarn lint`, `yarn format:check`, `yarn typecheck`: clean.
  - Gates-Gen: `typescript:transform` and `i18n:export` re-run, generated files committed.
