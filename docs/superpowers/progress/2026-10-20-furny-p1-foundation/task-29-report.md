# Task 29 report: phone OTP routes and pages, phone verification, re-authentication

Status: DONE_WITH_CONCERNS

Commit (pushed to origin/build/p1-foundation): `5ede333` feat(auth): phone OTP sign-in/sign-up, phone verification and re-authentication

## What was implemented

### Phone sign-in and sign-up (13 §5.2, 14 §3.2)
- Routes (all `guest` except `status`): `auth.otp.create|send|verify.show|verify|resend|status|complete.show|complete` in `routes/web.php`; entries in `tests/Feature/Security/route-access.php`.
- `Auth\PhoneOtpController` + requests `Auth\{SendOtpRequest,VerifyOtpRequest,ResendOtpRequest,CompleteOtpSignupRequest}`.
- Send does not look the number up: known and unknown numbers get the same redirect, flash (`channel`, `maskedPhone`) and challenge keys (a test counts the `users` queries of a send: zero).
- `OtpChallenge` (`app/Domain/Identity/Otp`): the session `otp.challenge` = `{e164, purpose, intent, name?, channel, otpId, expiresAt}`, set on send, followed on resend, forgotten on success. `intent` is `login|register|reauthenticate|verify_phone`, and each flow reads only its own purposes/intents (a `verify_phone` challenge cannot be verified through the guest routes, and a sign-in challenge cannot confirm a re-authentication).
- `ResolvePhoneAccount` action (one place for the 13 §5.2 step 2 decisions): soft-deleted -> `auth.errors.account_pending_deletion`, staff -> `staff_use_email`, inactive -> `auth.inactive`, registration closed -> `auth.registration_closed`, existing -> `phone_verified_at ??= now()` through `ContactVerification` (so `ContactVerified` fires once), unknown + name -> `RegisterCustomer::fromPhone`, unknown without a name -> `otp.verified_phone {phone, at}` (15 minutes) and `auth.otp.complete.show`. A unique violation on the number (two sign-ups racing) signs in the winner's account.
- `RegisterCustomer::fromPhone(e164, name)` through the shared `create()` (now `?string $email`, `?string $verifiedPhone`): phone verified, no password, no email, terms accepted, business defaults, `CustomerRegistered` then the first-contact `ContactVerified`. The welcome is in-app only (no email, tested: `Welcome` goes by `['database']`).
- Sign-in: `auth.pending_method = {method: otp, user}` before `Auth::login($user, remember: true)` (customers), `session()->regenerate()`, `IntendedRedirect::response`.
- `OtpErrorResponse` (registered in `bootstrap/app.php`): `OtpException` -> JSON `{code, ...context}` with its status (and `Retry-After`) for machines; for forms back with the 14 §1.9 errors bag: message under the field (`phone` for parse/send/limit errors, the code field for `otp_invalid|otp_expired|otp_too_many_attempts|phone_unavailable|reauth_no_phone`, `cf_turnstile_response` for the captcha ones), machine code under `code` (`reason` when the field is itself `code`), context as strings, and `rate_limited` = `retryAfter` for the inline countdown. `otp_invalid` uses `trans_choice` with `:attemptsLeft`.
- `RateLimitedResponse::INLINE_ROUTES` gained `auth.otp.send|verify|resend|complete` and `auth.reauthenticate.store` (these pages count their wait down).
- Pages `Auth/{PhoneLogin,PhoneVerify,PhoneComplete}` per 10 §4.4: required marks, focus on the first error, inline 429 countdown, Turnstile widget only after `captcha_required`, `auth_ui` strings. PhoneVerify: one code field that submits itself at 6 digits, 60 s resend countdown, **Resend on WhatsApp** / **Send by SMS** per available channel, **Change number**, the status poll (5 s, 2 min, WhatsApp only) with the fallback sentence.
- Shared `OtpCodeField` (`inputmode=numeric autocomplete=one-time-code pattern=[0-9]* maxlength=6`, digits only, `complete` event) with WebOTP guarded by `'OTPCredential' in window` and aborted on unmount.
- "Use my phone instead" (`AlternativeSignIn` component: "or" line, phone button when `features.whatsapp || features.sms`, Google) on Login (`auth.otp.create`) and Register (`?intent=register`).

### Account phone verification (13 §5.7)
- `Account\PhoneController` (the C10 name; the brief says `AccountPhoneController`), `account.phone.send|verify`, `VerifyPhone` action (another user, soft-deleted included -> `phone_unavailable` only after the code, so a number cannot be probed without owning it; audit `account.phone_verified {from, to}` masked; `ContactVerification::markPhoneVerified`). The send flashes `info` (`account.otp_sent`) plus `channel`/`maskedPhone` for the dialog.
- `PhoneVerifyDialog` (props `open`, `initialPhone?`; emits `update:open`, `verified`): phone step -> code step after a successful send, 60 s resend wait, change number, resets on reopen.

### Re-authentication (13 §6.4)
- `Auth\ReauthenticateController` + `ReauthenticateRequest`; `auth.reauthenticate` (users with a password -> `password.confirm`), `auth.reauthenticate.store` `{step: send|verify, code}` (C10 shape). Send -> OTP purpose `login` to the user's verified phone, challenge intent `reauthenticate`, flash `info`. Verify needs a challenge of that intent for that user's number, then `auth.password_confirmed_at = now()->getTimestamp()` and redirect to the intended URL. Page `Auth/Reauthenticate` (code and/or Google). The Task 26 skipped test is un-skipped and passes. `AccessProbe` learned that this route sends a user with a password to `password.confirm`.

### VerifyContactBanner (10 §1.1, 15 §9.31)
- `VerifyContactBanner` in `CustomerLayout`'s `#banner` (above any page banner; the region also opens when only the banner is there). Shown when `emailVerified === false && phoneVerified === false` for a customer. **Resend email link** (only with an email) posts `verification.send`; **Verify phone** opens `PhoneVerifyDialog`.

### Carries
1. **Verify limiters atomic.** `VerifyOtp::countAttempt` now hits first and compares the count that came back (address first; an address that is refused does not count against the number). Parallel-process tests in `OtpConcurrencyTest` (real processes): 15 requests from one IP -> exactly the limit pass, the rest throttled; 25 requests for one number from 25 IPs likewise.
2. **`otp.challenge` + status + fallback.** See above. `auth.otp.status` -> `{channel, fallbackSent}` (404 `{code:'no_challenge'}`); `fallbackSent` is true only when `SendOtp::fallBackToSms($otpId)` really replaced a WhatsApp code with an SMS one (cache `otp:fallback:{sha256(e164)}` = `sms`, 10 min, cleared by the next normal send). `fallBackToSms` follows 13 §4.2: only for a live unconsumed WhatsApp code; bypasses the cooldown; counts toward the hourly limits (only the number's limit and the global cap can stop it); expires the old code; if the SMS cannot be sent the WhatsApp code is restored. Nothing calls it yet: it is the contract for the status webhook of the notifications plan (delivery status is not available in P1). `ArrayOtpDelivery` is synchronous, so `fallbackSent` is false unless the test calls the action.
3. **Banner 429.** Chosen: a request header, `X-Throttle-Toast` (`RateLimitedResponse::TOAST_HEADER`). `verification.send` stays in `INLINE_ROUTES` (the verify page posts without the header and keeps its countdown); a request with the header gets the Inertia error flash (toast) instead. The banner sends it and does not announce success when the response carried an error flash. Documented in the `RateLimitedResponse` docblock; tested both ways (PHP: toast with seconds, header decides over the page, verify page still inline, machines unchanged; Vitest: the banner sends the header).
4. **Task 28 fold-ins.**
   - (a) `GoogleController::signInOrUp`: staff with a confirmed 2FA found by an **unverified** address do not get linked at the callback; `{user, googleId}` goes to `auth.pending_google_link` and the visitor to the challenge. `ApplyPendingGoogleLink` (a `Login` listener) links (clear password, rotate token, revoke sessions, audit) only when the challenge signs that same user in (not for a remember-cookie sign-in, not for another user; a password sign-in forgets the stash in `AuthenticateUser`). If the link has become impossible meanwhile the sign-in still completes and a warning is logged. Tests: untouched until the challenge, applied after it, failed/abandoned challenge, bound to the user, forgotten by a password sign-in, not by remember cookie, verified address / no-2FA staff unchanged, link impossible meanwhile.
   - (b) the `link` callback renews the current device's recaller (`RememberCookie::renew`, the `destroy-others` approach) when the token was rotated; tests for cookie present / absent / token not rotated.
   - (c) the keep-current-session test registers a pinned current session first (cookie + a real request through `TrackSession`) and asserts the registry afterwards. Mutant `others() -> all()` in `LinkGoogleAccount` fails it (verified).

## Decisions / deviations (please check)
1. **Google link deferred as a whole, not only the clean-up** (fold-in a). Linking sets `google_id` and verifies the address; if that happened before the challenge and the challenge were abandoned, the take-over condition (`email_verified_at === null`) would be gone for good and the pre-hijacker's password would survive. So for this one case nothing is touched until the challenge passes.
2. **Reauthenticate body.** C10 says `{step: send|verify, code}`, the brief says `{code?}`. `step` is accepted; when it is missing it is inferred (a code -> verify, else send), so both shapes work. Unknown steps are a validation error.
3. **Names.** `Account\PhoneController` (C10) rather than `AccountPhoneController`.
4. **`reason` key.** 14 §1.9 puts the machine code under `code`, but the verify input is itself named `code`. For refusals that belong to the code input the message is under `code` and the machine code under `reason`; the pages read the code input's error only when `reason` is present. Send-side refusals follow 14 §1.9 exactly.
5. **One code field**, not shadcn `PinInput` + hidden input (13 §4.4 is satisfied literally by one field; the field also serves WebOTP and autofill). `maxlength=6` per spec means a pasted "123 456" is cut by the browser before the script sees it.
6. **`SendOtp` additions** (additive): optional 5th argument `?OtpChannel $preferred` (the resend buttons), `OtpSendResult::$expiresAt`, `fallBackToSms()`.
7. **`OtpChallenge` survives the code's expiry**: a visitor who types an expired code gets `otp_expired` on the verify page and can resend, rather than being thrown back to the start. `expiresAt` is stored as asked but nothing drops the challenge on it.
8. **`auth.otp.status`** serves both the login and the `verify_phone` challenge (route is `web`, not `guest`).
9. **`RateLimiter::hit` caveat.** Laravel's `hit` can lose one count when parallel requests open a window together (its `add` + `increment` + `put(1)` sequence). The parallel tests therefore open the windows with one try first and assert the exact remainder; the mutant "check, then hit" fails both tests in 4 of 4 runs. A strictly atomic counter would need Redis-only Lua or fixed windows; not done (Task 27's `SendOtp` uses the same `hit`).
10. Test-support changes: `AccessProbe` knows the guest steps that need session state (`auth.otp.verify.show`, `auth.otp.complete.show` -> `auth.otp.create`), the public status route (404 without a challenge) and the password redirect of `auth.reauthenticate`; `FortifyConfigTest` expects two `Login` listeners; `LoginTest` lists the new inline routes; `ProfileInformationTest` skip removed.
11. `AuthPageProps::make()` extracted from `FortifyServiceProvider` so the new controllers share it.
12. Sign-in uses `Inertia::location` (full page load), like the other sign-in responses; re-authentication uses a plain redirect.

## Tests and results
- `vendor/bin/pest tests/Unit tests/Feature`: **3214 passed** (13105 assertions). `vendor/bin/pint --test` and `phpstan` (level 8): clean.
- `yarn vitest run`: **1268 passed** (79 files). `yarn lint`, `yarn format:check`, `yarn typecheck`: clean. Gates-Gen: `typescript:transform` + `i18n:export` leave no diff after the commit.
- New PHP: `PhoneLoginFlowTest` (64), `AccountPhoneTest` (18), `ReauthenticateTest` (19), `OtpFallbackTest` (14), 2 + 3 in `OtpConcurrencyTest`/`VerifyOtpTest`, 4 banner tests in `EmailVerificationTest`, 12 Google tests (deferral, recaller, meaningful keep-session). New Vitest: `PhoneVerify` (20), `PhoneVerifyDialog` (12), `VerifyContactBanner` (11), `OtpCodeField` (10), `PhoneLogin` (8), `PhoneComplete` (3), `Reauthenticate` (8), `useCountdown` (6), plus Login/Register/CustomerLayout additions.
- `OtpConcurrencyTest` run 5 times (also `--parallel`): stable.

### TDD evidence
- **RED (PHP, before any implementation):** `vendor/bin/pest tests/Feature/Auth/Otp tests/Feature/Auth/GoogleOAuthTest.php tests/Feature/Auth/EmailVerificationTest.php tests/Feature/Auth/LoginTest.php` -> `130 failed, 348 passed`: PhoneLoginFlowTest 61+, ReauthenticateTest 19, AccountPhoneTest 18, OtpFallbackTest 14, GoogleOAuthTest 10, OtpConcurrencyTest 2 and VerifyOtpTest 2 (the new atomic-limit tests), EmailVerificationTest 3, LoginTest 1. Expected: routes, controllers, `SendOtp::fallBackToSms`, `RateLimitedResponse::TOAST_HEADER`, `ApplyPendingGoogleLink` and the check-then-hit limiter did not exist yet. Saved at `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/t29/red-php.txt` (the scratchpad is session-local).
- **GREEN:** the full run above.
- **Frontend:** the Vitest files were written after the components, not before (honest: no separate RED run). Instead, mutants were checked: removing the `complete` emit fails 6 tests; removing the WebOTP abort fails 1; making the resend buttons never disabled fails 2; keeping the dialog on the phone step fails 6; dropping the banner header fails 1.
- Backend mutants: check-then-hit limiter fails both parallel tests; `others() -> all()` fails the keep-session test.

## Files changed (74)
New: `app/Domain/Identity/{Actions/{ResolvePhoneAccount,VerifyPhone},Otp/OtpChallenge,Support/PhoneAccountOutcome}.php`, `app/Http/Controllers/{Account/PhoneController,Auth/PhoneOtpController,Auth/ReauthenticateController}.php`, `app/Http/Requests/{Account/{SendPhoneOtpRequest,VerifyPhoneRequest},Auth/*}.php`, `app/Listeners/ApplyPendingGoogleLink.php`, `app/Support/{Auth/AuthPageProps,Http/OtpErrorResponse}.php`, `resources/js/{pages/Auth/{PhoneLogin,PhoneVerify,PhoneComplete,Reauthenticate}.vue,components/{account/PhoneVerifyDialog,auth/{OtpCodeField,AlternativeSignIn},common/VerifyContactBanner}.vue,composables/{useCountdown,useOtpStatusPoll,useUnverifiedContact}.ts}` and their tests, four PHP test files under `tests/Feature/Auth/Otp`.
Modified: `SendOtp`, `VerifyOtp`, `RegisterCustomer`, `OtpLimits`, `OtpSendResult`, `GoogleController`, `AuthenticateUser`, `FortifyServiceProvider`, `RateLimitedResponse`, `bootstrap/app.php`, `routes/web.php`, `CustomerLayout.vue`, `Login.vue`, `Register.vue`, `types/inertia.d.ts`, `test/inertiaPage.ts`, lang `{auth,auth_ui,account,common}.php`, generated `en.json`/`manifest.json`, `route-access.php`, `AccessProbe`, and the existing tests named above.

## Self-review
- Re-read the diff for spec drift: error codes and statuses of 14 §3.2/§3.3 are all produced; enumeration: nothing before the code is verified depends on whether the number has an account.
- No scratch copies left in the worktree (backups were in the session scratchpad).

## Concerns
- `SendOtp::fallBackToSms` has no caller until the delivery-status webhook exists (notifications plan); the status poll and the page message are wired and tested against it.
- The hit-then-compare caveat of `RateLimiter::hit` (item 9) is inherited, not introduced.
- `tests/Browser` cannot run in this environment (`PlaywrightOutdatedException`, 61 failures with 0 assertions, unrelated to this change); no browser test was added.
- Under heavy CPU load (a parallel Pest run at the same time) two existing `AddressFields` Vitest tests timed out once, and one full Vitest run once ended with "1 error" that I could not reproduce in 14 further runs; not caused by a failing assertion of this task.
- `resources/js/lang/generated` and the wayfinder routes: the latter are gitignored, regenerate with `php artisan wayfinder:generate --with-form`.

## Fix round 1

Review: `task-29-review.md` (Critical 1, Important 2-4, Minor 5-11).

### Changes
- **Critical 1 / Important 2 (stolen session).**
  - `auth.reauthenticate.store` refuses a user with a password: `RecentAuthenticationRequired` (redirect to `password.confirm`, JSON 403 `recent_auth_required`), before any code is sent or checked.
  - `account.phone.send` and `account.phone.verify` require `recent.auth` when the user has a sign-in credential (`User::hasSignInCredential()`: a password, a verified phone or a linked Google account). A user with none of them may add a first phone without it. The check is in `Account\PhoneController` (route middleware cannot be conditional).
  - **Deviation for spec 19 (beyond 13 §5.7):** changing the phone number requires a recent authentication for any user who already has a way to prove who they are, because the number is where re-authentication codes go. Staff (who have a password) are covered.
  - Re-authentication sends only to the phone the user had verified before: the thief's number cannot be added without `recent.auth`, so it can never become the target.
  - Tests: reviewer's probe A (password user, 3-hour session: `send` and `verify` both go to `password.confirm`, nothing sent, no stamp), probe B (passwordless phone user: adding a number is refused, and the code still goes to the original number), a code asked for while fresh cannot be used by an aged session, machines get 403, Google-only/staff/phone-only cases, the user with no credential is not asked, a confirmation within 10 minutes passes.
- **Important 3 / Minor 9 (countdown).** `PhoneVerify` gets an `expiresAt` prop (the challenge's `expiresAt`, new with every code) and `useCountdown(seconds, key)` restarts when the key changes, so every resend restarts the 60 s even though the server answers 60 again. This is also the use of `OtpChallenge::$expiresAt`. Vitest: wait 60 s, set the same wait with a new expiry, the buttons are disabled again; plus a composable test for the key.
- **Important 4 (dialog).** `account.phone.send|verify` joined `RateLimitedResponse::INLINE_ROUTES`, so a throttled try comes back as an `rate_limited` error (Inertia's `onError`), shown in the dialog (`auth_ui.throttled`). The dialog also ignores a `flash.error` success (no `verified`, stays open, does not advance to the code step). Tests: PHP (errors, no flash), Vitest for both sides and for a send that came back as a toast.
- **Minor 5.** The Google "bound to the user" test now signs in another staff member through their own 2FA challenge with the owner's stash; mutant L2 (user check removed) now fails it.
- **Minor 6.** Test that a `reauthenticate` challenge is rejected by show/verify/resend of the guest flow; mutant M3 now fails.
- **Minor 7.** Re-authentication redirect pinned for another host, protocol-relative and backslash intended URLs; mutant R5 now fails.
- **Minor 10.** `TermsCheckbox` component (PhoneLogin, PhoneComplete, Register use it; own test) and the `HasCaptchaToken` request concern (four requests; the controllers' copies are gone).
- **Minor 11.** `Reauthenticate.vue` holds the send button for 60 s after a code with a visible wait (Vitest).
- **Minor 12.** `auth.otp.status` has `throttle:api` (60 a minute per address for guests); test: the 61st call is 429.
- Not changed: Minor 12 of the review about pipe plurals in `auth.errors.otp_invalid` (plan-mandated `trans_choice`).

### Results
- `vendor/bin/pest tests/Unit tests/Feature`: 3231 passed. `tests/Feature/Auth/Otp`: 263 passed.
- `yarn vitest run`: 1276 passed. Pint, PHPStan, `yarn lint`, `yarn format:check`, `yarn typecheck`: clean. Gates-Gen: no diff.
- Browser suite (`PLAYWRIGHT_BROWSERS_PATH` set, `yarn vite build` first): 61 passed.
- Mutants run again and killed: removing the password refusal in `store` (3 tests), removing the `recent.auth` check of the phone routes (7), adding `reauthenticate` to the guest intents (1), raw `url.intended` redirect (3), removing the user binding of `ApplyPendingGoogleLink` (1).

## Fix round 2

Re-review: `task-29-rereview-1.md` (New Breakage 1 and 2; 3 accepted by ruling).

- **Google `intent=link` bypass (probe E).** `intent=link` now needs a recent authentication whenever the user has a sign-in credential (password, verified phone or linked Google account), the same rule as `account.phone.*`, now shared as `RecentAuthentication::missingFor($user, $request)`.
  - At `auth.google.redirect` (GET `?intent=link`): `RecentAuthenticationRequired` (to `password.confirm` or `auth.reauthenticate`, the redirect URL kept as the page to return to). Nothing is stored in the session.
  - At the callback, before Google is asked: refused with the flash `auth.errors.recent_auth_required` and no link. A user with no credential is not asked.
  - **Deviation for spec 19:** reverses Task 28's acceptance of 13 §5.3 step 6 (link without `recent.auth`); same rationale as the phone ruling of round 1.
  - Tests: the pinned "does not ask for a recent authentication" test is replaced by a describe: password user and passwordless user at the redirect, recent sign-in / confirmation pass, the callback refuses, probe E (phone-only user, aged session: no `google_id`, no email, and the Google re-authentication stamps nothing), no-credential user not asked, confirmation within 10 minutes links. The `callback` helper and other link tests now carry a fresh sign-in stamp. Mutants (callback check removed, redirect check removed) each fail 2 tests.
- **Dialog and the recent-auth redirect.** Cleanest: no server change. An Inertia visit that `account.phone.*` answers with the redirect to the password confirmation / re-authentication ends on another page, so `PhoneVerifyDialog` compares `visited.component` with the page it started on: it does not advance to the code step, does not emit `verified`, and closes (verify). The server side is pinned: an Inertia request is redirected to `password.confirm` with `url.intended` set to the page it came from. JSON keeps the Task 23 403 `{code: 'recent_auth_required'}` (tested in round 1).
- Results: `vendor/bin/pest tests/Unit tests/Feature` 3239 passed; Vitest 1278 passed; browser suite 61 passed; Pint, PHPStan, lint, format, typecheck and Gates-Gen clean.
