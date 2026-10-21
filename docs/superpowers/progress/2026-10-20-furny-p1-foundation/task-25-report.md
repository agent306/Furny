# Task 25 report: Fortify login and registration, Turnstile

Status: DONE_WITH_CONCERNS

Commit (pushed to origin/build/p1-foundation): 04a4912 feat(auth): Fortify login and registration with remember policy, Turnstile and audit

## Implemented

Backend
- `config/fortify.php`: features exactly as 13 section 2 (adds `updateProfileInformation`, `updatePasswords`, 2FA `window` 1). Limiters stay `login` / `two-factor`.
- `AuthenticateUser::handle` (trim + lower-case, soft-deleted excluded, wrong email / wrong password / no password all give `null`; a placeholder hash is checked when there is nothing to compare so a wrong email is not faster; `auth.inactive` only after a correct password). `ApplyRememberPolicy` (staff: `remember=false`). `FortifyServiceProvider`: `authenticateUsing`, `authenticateThrough` (ApplyRememberPolicy, RedirectIfTwoFactorAuthenticatable, AttemptToAuthenticate, PrepareAuthenticatedSession; no Fortify throttle step because the route carries `throttle:login`), response bindings, every auth view gets `features`, `turnstileSiteKey` (null unless captcha on), `canRegister`.
- Responses `LoginResponse`, `TwoFactorLoginResponse`, `RegisterResponse` (`Inertia::location` of `IntendedRedirect::resolve`), plus `LogoutResponse` (see Decisions 2).
- `IntendedRedirect::resolve(Request, User): string` and `sameSitePath`: accepts a relative path or a same-origin absolute URL (request origin or `app.url`), returns an absolute URL of this site; rejects other hosts, other ports/schemes, userinfo, `//x`, any backslash or control character, non-http(s) schemes, over 2048 bytes. `RecentAuthenticationRequired` now uses the same `sameSitePath` (its duplicated private helpers are gone; it still accepts only an absolute Referer, as Task 23's tests require).
- Listeners (found by event discovery): `RecordSuccessfulLogin` (last_login_at without touching updated_at, session `auth.login_at` int, `auth.method`, `auth.remember`, audit `auth.login {method, ip masked, ua}`; does NOT register the session; `TrackSession` registers the regenerated id), `RecordFailedLogin` (no causer, masked email and IP, never reads the password in the event), `RecordLockout` (`Log::warning('auth.lockout')`, masked), `RecordLogout` (registry `destroy` for the current session key, audit `auth.logout`).
- `CreateNewUser` (via the shared `ProfileValidationRules` trait, now with the 14 section 3.1 limits): name 2-120 without links, email `email:rfc` max 254 unique including soft-deleted (`auth.email_unavailable`), `Password::defaults()` confirmed, `terms` accepted, `marketing_opt_in`, `TurnstileToken('register', failOpen: true)`. Defaults from settings: `business.timezone`, `units.defaultSystem`, `units.defaultLengthUnit`; locale from `config('app.locale')`. Dispatches `CustomerRegistered` (ShouldDispatchAfterCommit; `eventId()` ULID, `eventKey()` `account.welcome`, `subjectUser()`, `occurredAt()`); `ContactVerified(User)` event class (helper comes in Task 26). `SendWelcomeNotification` (explicit `Event::listen`, lives in the domain) sends `Notifications\Account\Welcome` (database + mail; database only for a user without an email; payload keys `eventKey/titleKey/bodyKey/params/url/icon`).
- `FortifyRouteGuards` (web group, after TrackSession; preflight ruling C9): `register.store` returns 403 (`auth.registration_closed`) while `auth.allow_customer_registration` is off, before counting; otherwise the `register` limiter (5/hour/IP) through the router's `throttle` alias, so 429 rendering is the same as everywhere.
- `RateLimitServiceProvider`: the `login` limits get a response callback that fires `Illuminate\Auth\Events\Lockout` and throws the same `ThrottleRequestsException` (Fortify only fires Lockout from its own throttle step, which a named limiter replaces).
- `TurnstileToken` (`ValidationRule`, implicit so an empty token fails): siteverify form POST `{secret, response, remoteip, idempotency_key}`, 5 s timeout; valid iff `success === true`, hostname equals the `app.url` host (case-insensitive), action equals. ConnectionException or 5xx: fail open passes and logs `captcha.unavailable` (context: form, reason, fail_open; no token); fail closed fails with `auth.captcha_unavailable`.
- `SecurityHeaders`: `https://challenges.cloudflare.com` is in `script-src`, `connect-src` and `frame-src` only while `Features::enabled('captcha')`; `frame-src` is `'none'` otherwise. Relaxed dashboard policy never had it.
- `AppServiceProvider`: `Password::defaults()` = min 8 / max 128 outside production, min 10 / max 128 / `uncompromised()` in production.
- `ForcedLogout` (Task 24 fold-in): a revoked/tombstoned session uses `logoutCurrentDevice()`; other reasons keep `logout()`. It also calls `Inertia::clearHistory()` after the invalidation (13 section 12.4).
- `route-access.php`: `user-profile-information.update`, `user-password.update` (audience `any`).

Frontend
- `Auth/Login.vue`, `Auth/Register.vue` (replace the kit pages; i18n via `auth_ui.*`, no kit components imported per I11; removed from `LEGACY_KIT_FILES`), `components/auth/TurnstileWidget.vue`, `components/auth/PasswordField.vue` (show/hide, replaces the kit `PasswordInput`), `lib/turnstile.ts` (loads the Cloudflare script once, explicit render, with the nonce read from the `nonce` property of a server-rendered script tag).
- Lang: `auth.php` (email_unavailable, name_no_links, terms_required, registration_closed, captcha_failed, captcha_unavailable), `auth_ui.php`, `notifications.php` (`account.welcome.customer.*`, `cta.open_dashboard`). Regenerated `resources/js/lang/generated`.

## Decisions / deviations (please check)
1. Remember-cookie sign-in: the `Login` event also fires when the recaller revives a session. The listener then records method `remember` and does NOT write `auth.login_at`, so a revived cookie does not pass `recent.auth`. The brief says the listener writes `auth.login_at`; it does for every fresh authentication.
2. Extra file `LogoutResponse`: `Inertia::clearHistory()` called from the `Logout` listener would be lost, because Fortify invalidates the session right after the event. The response calls it after the invalidation; 302 `/` as 14 section 3.1.
3. `Fortify` features `updateProfileInformation` / `updatePasswords` are enabled as 13 section 2 says, but their Actions (`UpdateUserProfileInformation`, `UpdateUserPassword`) arrive in Task 26. Until then `PUT /user/profile-information` and `PUT /user/password` fail to resolve their contract (500). Route entries were added as required.
4. Registration closed page text lives in `auth_ui.registration_closed`; `auth` is a Laravel-format namespace that is not exported to the browser. The same sentence is `auth.registration_closed`, used for the 403 message. Two keys, one sentence.
5. Locale of a new user: `config('app.locale')`. The business setting `locale` is `en-IN` (number formatting), not a UI language, so it cannot feed `users.locale`.
6. `config/services.php` already had `turnstile.site_key/secret_key`; no change was needed.
7. `ProfileValidationRules` (unused kit trait) now carries the 14 section 3.1 limits (name 2-120, email rfc max 254) and is used by `CreateNewUser`; Task 26 reuses it.
8. Standard Laravel `logout()` (Fortify `POST /logout`, `RevokeSessions::device` for the current session) cycles `remember_token`, which signs the user out of every other remembered device. Not changed (outside the brief); the same fix as ForcedLogout would be `logoutCurrentDevice()` there.
9. `Inertia::flash` is not used in this task (no flash needed: errors are validation errors).

## Tests
- `tests/Feature/Auth/LoginTest.php` (58), `RegisterTest.php` (40), `RevokedDeviceTest.php` (4), `FortifyConfigTest.php` (15), `tests/Unit/Rules/TurnstileTokenTest.php` (24), `tests/Unit/Auth/IntendedRedirectTest.php` (39), `SecurityHeadersTest` extended (Turnstile on/off, 78 total).
- Vitest: `pages/Auth/__tests__/{Login,Register}.test.ts` (20), `components/auth/__tests__/TurnstileWidget.test.ts` (8), `lib/__tests__/turnstile.test.ts` (7).
- Covered from the brief: login redirects, email normalisation, auth.failed / auth.inactive paths, soft-deleted, staff vs customer recaller, session id change, 6th attempt throttled (+ Lockout log), intended honoured / evil ignored, last_login_at, `auth.login` / `auth.login_failed` / `auth.logout` audit, registry entry removed on logout, exactly one registry entry keyed by `SessionKey::for(new id)` with the right method/remembered flag, registration defaults, events, Welcome via database + mail, name with links, soft-deleted email, missing terms, closed registration (page + 403), 6th registration throttled, `Password::defaults()` outside and inside production, Turnstile rule cases, Vitest cases. Fold-in: revoke device A, A's next request logs out, device B's recaller cookie still authenticates (`RevokedDeviceTest`); mutation check with `logout()` made two tests fail.
- Mutation checks: removing the ApplyRememberPolicy merge fails 4 tests; reverting ForcedLogout to `logout()` fails 2.

Results (all run after the final edit):
- `vendor/bin/pest tests/Unit tests/Feature`: 2613 passed (10086 assertions); the later RegisterTest addition: 40/40.
- `vendor/bin/pint --test`: passed. `vendor/bin/phpstan analyse`: no errors.
- `yarn lint` clean, `yarn format:check` clean, `yarn typecheck` clean, `yarn vitest run`: 1119 passed (64 files).
- `typescript:transform`, `i18n:export` leave no diff after the commit (en.json and manifest.json are in it); `wayfinder:generate --with-form` output is gitignored.
- Note: plain `php artisan wayfinder:generate` (no `--with-form`) overwrites the generated routes without the `.form()` helpers and breaks `yarn typecheck`; the vite plugin passes `formVariants: true`.

## TDD evidence
The tests for each unit were written together with the implementation in one pass (the controller asked for the whole task at once); RED/GREEN was not run as a separate step for each. Behaviour checks by mutation are listed above.

## Files changed
New: `app/Actions/Fortify/{AuthenticateUser,ApplyRememberPolicy}.php`, `app/Domain/Identity/Events/{CustomerRegistered,ContactVerified}.php`, `app/Domain/Identity/Listeners/SendWelcomeNotification.php`, `app/Http/Middleware/FortifyRouteGuards.php`, `app/Http/Responses/{Login,TwoFactorLogin,Register,Logout}Response.php`, `app/Listeners/{RecordSuccessfulLogin,RecordFailedLogin,RecordLockout,RecordLogout}.php`, `app/Notifications/Account/Welcome.php`, `app/Rules/TurnstileToken.php`, `app/Support/Auth/IntendedRedirect.php`, `resources/js/{components/auth/{TurnstileWidget,PasswordField}.vue,lib/turnstile.ts}`, tests listed above.
Modified: `app/Actions/Fortify/CreateNewUser.php`, `app/Concerns/ProfileValidationRules.php`, `app/Exceptions/RecentAuthenticationRequired.php`, `app/Http/Middleware/SecurityHeaders.php`, `app/Providers/{AppServiceProvider,FortifyServiceProvider,RateLimitServiceProvider}.php`, `app/Support/Auth/ForcedLogout.php`, `bootstrap/app.php`, `config/fortify.php`, `eslint.config.js`, `resources/lang/en/{auth,auth_ui,notifications}.php`, `resources/js/lang/generated/*`, `resources/js/pages/Auth/{Login,Register}.vue`, `resources/js/test/inertiaPage.ts`, `tests/Feature/Security/{SecurityHeadersTest,route-access}.php`.

## Concerns
- Items 3 and 8 above.
- After registering, the customer is sent to `customer.dashboard`, and `EnsureCustomerOnboarded` redirects a customer with `onboarded_at = null` to `customer.onboarding.show`, which does not exist yet. Following the redirect before the onboarding task lands would raise a route-not-found error. Tests stop at the redirect.
- No browser (Playwright) test of the Turnstile widget: the real script is not reachable here.

## Fix round 1

Commit: see `git log` (fix(auth): constant-time login, device-only logout, focus and inline throttle on the auth forms).

Rulings and findings addressed
- A. `updateProfileInformation` / `updatePasswords` removed from `config/fortify.php` (comment: the profile and password task enables them); their two `route-access.php` entries removed with a comment; `FortifyConfigTest` asserts they are off and their routes do not exist.
- B. Device-only logout. Fortify's controller calls `logout()` and cannot be changed, so `FortifyRouteGuards` handles route `logout` for a signed-in user: `Auth::guard('web')->logoutCurrentDevice()` (forgets this device's recaller cookie, no `remember_token` cycle), session invalidate, CSRF regenerate, then the `LogoutResponse` (clears the Inertia history). `RevokeSessions::device` for the current device uses `logoutCurrentDevice()` too. `logoutCurrentDevice` fires `CurrentDeviceLogout`, not `Logout`, so `RecordLogout` now handles both (audit `auth.logout` and registry removal). Tests: log out on device A, the DB token is unchanged, the response forgets the recaller cookie, device B's recaller cookie still authenticates (LoginTest); same for "sign out this device" from the device list (RevokedDeviceTest). Mutation to `logout()` fails both.
- C. Login timing. `AuthenticateUser::handle` runs inside `Illuminate\Support\Timebox` (`config('auth.login_timebox_microseconds')`, 200000 by default, 0 for Feature tests via `tests/Pest.php`); the inactive-account exception passes through it too. Exactly one `Hash::check` on every path (unknown email, wrong password, no password, inactive, soft-deleted, success), including an unconditional check for the placeholder. The placeholder hash is made once and kept in the cache (key by hashing config), never per request. Tests: `Hash::partialMock()` expects `check` once and `make` never for eight cases; the placeholder is cached; every way out takes at least the time box; the default is 200 ms. Removing the placeholder check fails 4 of them.
- D. `useFocusFirstError` composable (`composables/useFocusFirstError.ts`), used as `@error` on the Login and Register forms. Vitest: composable (3), pages with a stand-in `Form` (focus on first invalid in page order; Register also resets Turnstile). Removing the handler fails 2 page tests.
- E. 429 on login/register: `RateLimitedResponse::INLINE_ROUTES` (`login.store`, `register.store`; the password reset form joins with its task) comes back with the validation error `rate_limited` = seconds and no Inertia flash, so no toast. The form posts to its own page URL, so the "back is a loop" guard no longer applies to these. `useThrottleCountdown` + `ThrottleNotice` count down inline (`auth_ui.throttled`, ICU plural; sighted countdown is `aria-hidden`, assistive technology hears the wait once) and the submit button is disabled until zero. Tests: PHP (Inertia login and register come back to the form, page props carry `errors.rate_limited` and no `flash`), Vitest (composable, notice, both pages).
- F. `AfterCommitTest`: CustomerRegistered and Welcome do nothing inside the transaction, run after commit, and do not run on rollback. Removing `ShouldDispatchAfterCommit` or `afterCommit()` fails 2 tests each.
- G. The captcha error is referenced by `aria-describedby` of the widget, which is now a `role="group"` with an `aria-label` (`auth_ui.captcha`).
- H. No shared label component supported a required mark (AddressFields uses an inline constant). New `components/common/RequiredMark.vue` (`aria-hidden` asterisk) in the labels of required fields on both forms, including the terms label; the marketing box has none.
- I. The password field's `aria-describedby` lists the error and the hint only when they render.

Notes
- `assertSessionHasErrors` and `assertSessionMissing` consume flashed session data in this harness; the inline-throttle tests read the next page's props instead.
- `php artisan wayfinder:generate` needs `--with-form` (the vite plugin passes `formVariants`), otherwise `yarn typecheck` fails on `.form()`.

Results
- `vendor/bin/pest tests/Unit tests/Feature`: 2637 passed (10157 assertions). Pint and PHPStan clean.
- `yarn lint`, `yarn format:check`, `yarn typecheck` clean; `yarn vitest run`: 1147 passed (69 files) before the last test-only refactor, `resources/js/pages/Auth` 32 passed after it.
- `typescript:transform` and `i18n:export` leave no diff after the commit.

## Fix round 2

- Double authentication: `AuthenticateUser::handle` keeps `{key, user}` in the request attributes (key = sha256 of the normalised email and the password, in memory only); the second call Fortify makes for a login reuses it, so one login costs one hash check and one time box. Other credentials on the same request are not reused (tested). Row-by-row `LoginTest` now counts through `Tests\Support\CountingHasher` (a `HashManager` subclass that counts `check` and `make`) and asserts the response of every row: redirect for the right password, `auth.failed` / `auth.inactive` otherwise, each with exactly one check and no `make`. The earlier `Hash::partialMock()->passthru()` could not call the real hasher, so the request failed inside and the test still passed; that is why the success row was false-green. Mutations: dropping the memo fails 2 tests, dropping the placeholder check fails 3.
- Logout: `App\Http\Controllers\Auth\AuthenticatedSessionController` extends Fortify's and is bound over it in `FortifyServiceProvider`; `destroy()` does `logoutCurrentDevice()`, invalidate, `regenerateToken()`, `LogoutResponse`. The interception, its guest branch and its comment are removed from `FortifyRouteGuards`. Tests kept and added: CSRF 419 (env `local`, user stays signed in, no audit), Inertia 302 to `/` with cleared history, JSON 204, other devices' recallers still valid; `FortifyConfigTest` checks the route's controller and its `auth:web` middleware.
- Audit: the controller sets the request attribute `RecordLogout::USER_INITIATED`; `RecordLogout` always removes the session from the registry but writes `auth.logout` only with the attribute. Tests (RevokedDeviceTest) show no `auth.logout` for a revoked device, a deactivated user, an expired staff session and signing out the device in use from the device list (which writes its `auth.sessions_revoked`), and one entry per user logout (form and JSON).
- Dummy hash: the cached placeholder is read before the check on every attempt.

Results: `pest tests/Unit tests/Feature` 2647 passed (the 2646 run plus the new route test); Pint and PHPStan clean. No JS or generated files changed in this round.
