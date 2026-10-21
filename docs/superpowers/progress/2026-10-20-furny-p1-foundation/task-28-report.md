# Task 28: Google OAuth — report

Status: DONE_WITH_CONCERNS. Commit: `654918d feat(auth): Google OAuth login, linking, invitation and re-authentication intents` (pushed to `build/p1-foundation`).

## Implemented

- `Auth\GoogleController` (`redirect`, `callback`), routes `auth.google.redirect` / `auth.google.callback` (`throttle:oauth`, `active`; 404 unless `features.google_login`).
  - Redirect: `intent` required and one of `login|link|invitation|reauthenticate` (enum `GoogleIntent`). Stores `oauth.intent` and `oauth.user` in the session, then `Socialite::driver('google')->scopes(['openid','profile','email'])->with(['prompt'=>'select_account'])->redirect()`. It is never stateless.
  - `link` and `reauthenticate` need a signed-in user (a guest goes to login). `login` while signed in goes to the dashboard. `invitation` needs a signed-out visitor and a pending, unexpired invitation in session `invitation.id`, else 403.
  - Callback: `?error=` gives `oauth_cancelled`. The intent is pulled from the session, used once, and is never taken from the query. An intent in the query that differs from the session, a missing intent, another user than the one who started a link or reauthenticate round trip, or `InvalidStateException` all give `oauth_state_invalid`. Any other exception gives `oauth_failed` plus `Log::warning`. `email_verified` must be exactly `true` and the email non-empty, else `google_email_unverified`.
  - `login`: lookup by `google_id`, then by email (both `withTrashed`). Trashed gives `auth.errors.account_pending_deletion`. Inactive gives `auth.inactive`. A match by email links Google (`LinkGoogleAccount::byEmail`), verifies the email through `ContactVerification` and audits `auth.google_linked`. A pending staff invitation for the email gives `pending_staff_invitation` and no user. Registration closed gives `auth.registration_closed`. Otherwise `RegisterCustomer::fromGoogle` creates the customer.
  - Sign-in: customers use `Auth::login($user, true)`, staff `Auth::login($user, false)`. Staff with `two_factor_confirmed_at` are not logged in; the session is regenerated, `login.id` and `login.remember=false` are set, and the visitor goes to `two-factor.login`. Redirect is via `IntendedRedirect::response`.
  - `link`: `LinkGoogleAccount::forSignedInUser` gives `google_in_use`, `google_email_mismatch` or `email_unavailable`. A phone-only user gets the Google email, verified. Failures go to the user's security page (the dashboard until `customer|admin.account.security` exist).
  - `reauthenticate`: the Google id must equal `users.google_id`; sets `auth.password_confirmed_at = time()` (int) and redirects to the intended URL. Mismatch gives `google_email_mismatch`.
  - `invitation`: the email must equal the invitation email. It stores `invitation.google_id` and `invitation.google_name`, then redirects to `invitation.url` (same-site check via `IntendedRedirect::sameSitePath`, else login). Mismatch redirects there with `google_email_mismatch`.
- `DELETE /account/google` (`account.google.unlink`, `auth`, `active`, `recent.auth`): `Account\GoogleLinkController@destroy` calls `UnlinkGoogleAccount`. It is allowed only with a password or a verified phone. Otherwise 422 with field `google` and message `auth.errors.last_login_method`. Audits `auth.google_unlinked`. A JSON request gets 204; a browser gets back plus the toast `account.toasts.google_unlinked`.
- Domain actions named as in spec 14: `RegisterCustomer::fromGoogle`, `LinkGoogleAccount`, `UnlinkGoogleAccount`, plus `GoogleAccountException` and the `GoogleIntent` enum.
- Login method: `RecordSuccessfulLogin` takes session `auth.pending_method` (`otp`|`google`). Google sets it before `Auth::login`, so the `auth.login` audit and `auth.method` say `google`. It also survives the 2FA challenge. `AuthenticateUser::handle` forgets the key, so a password login never inherits it.
- UI: `GoogleButton.vue` is a plain `<a>` to the redirect (not an Inertia visit). It renders only when `features.google_login`, shows the terms caption for the login intent, and has an optional "or" separator. It is on Login and Register. Strings are in `auth_ui.google.*`; errors in `auth.errors.*`; toasts in `account.toasts.*`.
- `oauth` limiter: already present in `config/security.php`, so `RateLimitServiceProvider` needed no change. A test pins 20 per minute and then 429.
- `route-access.php`: `auth.google.redirect` and `auth.google.callback` are `public`; `account.google.unlink` is `any`. `AccessProbe` gained `PUBLIC_REDIRECTS` (a guest GET to those two must be a redirect, since they cannot render a page).

## Tests and gates

- `tests/Feature/Auth/GoogleOAuthTest.php`: 95 tests. They cover every case in the brief plus the real Socialite driver (state in session, `prompt` and scope in the URL, forged state rejected), single use of a round trip, intent in query and starter-user checks, the invitation edge cases, the 2FA hand-off and the method after the challenge, and unlink edge cases.
- `GoogleButton.test.ts` (7 tests), and updates to the Login and Register tests (the "no Google yet" assertions were replaced).
- Gates-PHP: Pint `passed`, PHPStan `No errors`, `vendor/bin/pest tests/Unit tests/Feature`: 3044 passed, 1 skipped (the pre-existing `auth.reauthenticate` skip). Gates-JS: lint, format:check and typecheck exit 0; vitest 1179 passed. Gates-Gen: clean after commit (`generated.d.ts` gained `GoogleIntent`).
- Mutation checks (temporary, reverted): staff remember cookie, ignoring the query intent, not forgetting `auth.pending_method`, a loose `email_verified` check, and no session regeneration on the 2FA path each fail a test.
- TDD note: the implementation was written before the tests, so there is no RED run. Mutation checks stand in for it.
- Browser tests (`tests/Browser`) cannot run here (Playwright outdated); they are outside the gates.

## Concerns and decisions

1. `link` does not require `recent.auth`. Spec 13 §5.3 and 14 §3.2 say `link` requires auth only, and 13 §6.4 lists Google unlink, not link, as a `recent.auth` use. I followed the spec, as instructed. Adding it later means one check in the redirect for the `link` intent.
2. Success toasts use spec 14's keys `account.toasts.google_linked` and `google_unlinked` (ICU, in `account.php`), not `auth.php`. Errors are in `auth.errors.*` as instructed.
3. The unlink refusal is a `ValidationException` on field `google`, like Task 26's `last_login_method`. The 14 §1.9 `code: last_login_method` extra is not added; there is no generic coded-validation helper yet.
4. Touched Task 25 code in two small places: the pending-method key in `RecordSuccessfulLogin`, and the one-line reset in `AuthenticateUser::handle`.
5. "Pending" staff invitation, for blocking customer creation, means not accepted and not revoked, expired or not. An expired invitation can be resent, so its email must not become a customer. The `invitation` intent itself requires an unexpired one.
6. Link by email overwrites an existing, different `google_id` on that user, as 13 §5.3 step 4 says. An existing email match also marks the email verified through `ContactVerification`, so `ContactVerified` fires only if it was the first verified contact. The link intent with a matching but unverified email also verifies it. This is slightly beyond the spec text and consistent with the login path.
7. Invitation lookup is real, not stubbed: `StaffInvitation` and its factory already exist, so the tests use them. Task 30 only has to set `invitation.id` and `invitation.url` and read `invitation.google_id` and `invitation.google_name`.
8. Redirect targets for failures in `link` and `reauthenticate` fall back to the dashboard until `customer.account.security` and `admin.account.security` exist (`Route::has` check).
9. Auth pages on `/auth/google/redirect` are a full-page navigation by design; the button must stay an `<a>`.

## Files

app: `Domain/Identity/{Actions/{RegisterCustomer,LinkGoogleAccount,UnlinkGoogleAccount},Enums/GoogleIntent,Support/GoogleAccountException}.php`, `Http/Controllers/{Auth/GoogleController,Account/GoogleLinkController}.php`, `Listeners/RecordSuccessfulLogin.php`, `Actions/Fortify/AuthenticateUser.php`; `routes/web.php`; `resources/lang/en/{auth,auth_ui,account}.php`; `resources/js/{components/auth/GoogleButton.vue, pages/Auth/{Login,Register}.vue, lang/generated/*, types/generated.d.ts}`; tests: `tests/Feature/Auth/GoogleOAuthTest.php`, `tests/Feature/Security/route-access.php`, `tests/Support/Routing/AccessProbe.php`, `GoogleButton.test.ts`, `Login.test.ts`, `Register.test.ts`.

## Fix round 1

Review: `task-28-review.md`. All nine rulings applied.

1. **Pre-hijacking (ruled deviation from 13 §5.3 step 4; log in spec 19).** `LinkGoogleAccount::link` treats the link as a takeover when the user has an email that was never verified. In the same transaction it sets `password = null`, rotates `remember_token` and writes the audit with `reason: google_link_unverified`. After the commit it revokes sessions through `RevokeSessions` with the new reason `REASON_GOOGLE_LINK_UNVERIFIED` (Redis is not transactional). The login path has no session of its own yet, so `all()` runs; the signed-in `link` intent keeps the session in use (`others()`). It applies to customers and staff, and not to a phone-only user who gets the email from Google. Verified accounts are untouched (tested).
2. **Audit.** `auth.google_linked` records `replaced: bool`; the takeover adds `reason`.
3. **Unlink.** A password counts only with an email (`hasPassword() && email !== null`), or a verified phone.
4. **Pending method.** `auth.pending_method` is `{method, user}`. `RecordSuccessfulLogin` applies it only when the logged-in user matches, and never for a remember-cookie login.
5. **Unverified email.** A dataset test covers all four intents.
6. **Defaults.** `RegisterCustomer::create()` is the single builder; `CreateNewUser` (validation only) and `fromGoogle` both use it. The link pattern is `RegisterCustomer::NAME_LINK_PATTERN`.
7. **Google names.** A name with a link or no name falls back to the email local part. The limit is `mb_substr` to 120 characters (CJK tested).
8. **Invitation binding.** The callback stores `invitation.google.{invitationId} = {id, name}` and drops any earlier choice. Task 30 must read `session("invitation.google.$invitation->id")`. The keys `invitation.google_id` and `invitation.google_name` no longer exist.
9. **Request class.** `App\Http\Requests\Account\UnlinkGoogleRequest`: empty `rules()`, `authorize()` true only for a signed-in `User`. `GoogleLinkController::destroy` uses it.

Tests: `GoogleOAuthTest` is now 116 tests (the pre-hijack scenario, staff, link intent and the phone-only exception; `replaced`; no-email password unlink; pending method for another user and for remember; unverified on each intent; names; invitation binding; the request). Mutants killed: unverified check limited to login, pending method on a remember login, the user match of the pending method, and no takeover.
Gates: Pint and PHPStan clean; `pest tests/Unit tests/Feature` 3065 passed, 1 skipped; vitest 1179 passed; lint, format:check and typecheck clean; Gates-Gen no diff.
