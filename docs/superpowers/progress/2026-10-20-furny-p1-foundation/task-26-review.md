# Task 26 review: password reset, email verification, profile and password updates, `ContactVerified`

Diff `4f1f6b6..63b28b5` (one commit, 48 files). I reviewed it in one pass from the review package and the brief, and checked against 13 §2, §5.5, §5.6, §5.8, §6.3, §6.4, §10, §17, §20.11; 14 §3.1; 10 §4, §4.5, §4.6, §4.8; and 12 §3.3. The worktree was not modified (`git status` is clean). The timing measurement, the mutation runs and the browser probes all ran in a scratch copy at `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/mut`.

### Spec Compliance

- ✅ **Spec compliant, apart from the Minor items below.** Every file in the brief has its hunk. All six test files exist. Fortify `updateProfileInformation` and `updatePasswords` are on (`config/fortify.php:150-151`), their Actions are bound (`FortifyServiceProvider.php` `configureActions`), and both routes are in `tests/Feature/Security/route-access.php` as `any`. The auth config matches 13 §2: `passwords.users.expire/throttle 60`, `verification.expire 60`, `password_timeout 600`.
- ⚠️ **Cannot verify from the diff alone:**
  - For a passwordless user, an email change redirects to `auth.reauthenticate`, which does not exist yet. That test is skipped (`ProfileInformationTest.php`, "a user without a password"), so until the OTP task lands, a phone-only user adding an email without recent auth gets a broken redirect. The controller should check this when the OTP task lands.
  - The `verification.send` inline 429 will also apply to the future `VerifyContactBanner` (implementer's concern 3). This is a cross-task item.

### Checks I ran

- **Auth suite.** `vendor/bin/pest tests/Feature/Auth` gave 500 passed, 1 skipped (the `auth.reauthenticate` skip), 1730 assertions. The output was clean apart from that skip.
- **Mutation checks: 39 mutants, 33 killed.**
  - Reset path, all killed:
    - revocation removed;
    - email verification removed;
    - verify-even-when-verified;
    - audit renamed;
    - `expire` set to 120.
  - `ContactVerification`, killed:
    - always-first;
    - dispatch on email only;
    - bypassing it from `User::markEmailAsVerified`.
  - Forgot-password guards, all killed:
    - Failed response unbound;
    - the throttle answering 429;
    - email validation skipped on the throttled path;
    - Turnstile removed;
    - Turnstile failing closed;
    - `ShouldQueue` added to `ResetPassword`.
  - Profile, all killed:
    - recent-auth check removed;
    - verification kept on change;
    - unmasked `from`;
    - no `VerifyEmail` sent;
    - `withoutTrashed()` on the unique rule;
    - last-login-method check always passing;
    - Google alone enough without a phone.
  - Password update, all killed:
    - current password always required;
    - current password never required;
    - `all()` instead of `others()`;
    - wrong reason;
    - no revocation;
    - no remember-cookie renewal.
  - Verification, all killed:
    - `signedRoute` with no expiry;
    - `verification.expire` set to 600;
    - mail sent without an email;
    - unmasked `account.email_verified`;
    - `verification.send` not inline;
    - not throttled.
  - **Survivors:**
    - M7: the reset time box removed (see Minor 1).
    - M9: the profile guard compares case-sensitively (Minor 2).
    - M34: the profile guard treats an absent `email` as a change (Minor 2).
    - M4: `lockForUpdate` removed (Minor 6).
    - M36 and M37: lower-casing or trimming removed in the Action. These two are equivalent mutants: `TrimStrings` and Fortify's `Str::lower` already normalise before the Action runs.
- **Forgot-password timing.** I ran a scratch Pest test of 5 samples each, with the array mailer and real notification rendering.
  - Production box (1.5 s): known 1503.5 ms, unknown 1503.2 ms, throttled 1502.9 ms (median), with a spread of 1503 to 1508 ms. The three are indistinguishable.
  - With the app box at 0: known ≈ 204 ms and unknown ≈ 203 ms, because Laravel's `PasswordBroker::sendResetLink` has its own 200 ms Timebox. Throttled takes ≈ 2 ms.
  - So the app box is what hides the throttle state and a mail send longer than 200 ms (SMTP in production).
- **Reset token.**
  - Single use: the broker deletes the token after the callback, which is tested.
  - 60-minute expiry: tested at 59 and 61 minutes, and mutation-checked.
  - `#[SensitiveParameter]` is on `sendPasswordResetNotification`.
  - Nothing is queued: the notification is mail-only and synchronous, tested and mutation-checked.
  - No app listener on `NotificationSent` or `MessageSent` could log the token (grep of `app/` found none).
- **Signed verification URL.**
  - The URL is a temporary signed route of 60 minutes (`VerifyEmail.php:40`).
  - The 61-minute link, a tampered signature, another signed-in user, and a changed email all return 403 and are tested. Fortify's `VerifyEmailRequest` checks the id and the `sha1(email)` hash.
  - A logged-out click goes to `login` and returns to the link afterwards (tested).
- **The current session survives a password change.** In this Fortify version, `PasswordController::update` does not re-store `password_hash_web`. `AuthenticateSession` is in the web group (`bootstrap/app.php:119`), but its post-response `tap` re-stores the hash from the updated in-memory user, so the current session is not logged out on the next request. Fortify also calls `broker()->deleteToken()`, so an outstanding reset link dies on a password change.
- **Remember token on reset.** It is rotated twice, by `SessionRegistry::destroyAll` and by Fortify's `CompletePasswordReset`. The test asserts a new 60-character token.

### Strengths

- `GenericPasswordResetLinkResponse` is bound for both the success and failure contracts. The silent-limiter approach in `FortifyRouteGuards::passwordEmail` is careful:
  - It reuses the framework throttle middleware, so keys and counters stay the framework's.
  - It swallows only the limiter's own refusal (the `$reached` flag).
  - It still validates the email on the throttled path.
  - It wraps everything, Turnstile and validation errors included, in a Timebox that also waits on exceptions.
- The recent-auth check runs before validation (`FortifyRouteGuards.php:96`), so a taken address is not revealed to someone without recent auth. This is tested.
- `ContactVerification` reads the previous state under a row lock and dispatches through `ShouldDispatchAfterCommit`. There are tests for the commit and rollback cases.
- Extracting `RememberCookie::renew` removes duplication with `SessionController::destroyOthers`. Password change renews the cookie with the new token and password hash, without a `Login` event, and this is tested.
- The audit properties are masked and the tests check them against the full activity JSON, including that no password or token appears.
- The Vue pages:
  - contain no literal English (grep of all four templates);
  - each have one `h1`;
  - mark required fields with `RequiredMark` and `aria-required`;
  - move focus to the first error through `useFocusFirstError` on Forgot, Reset and Confirm (vitest covers it);
  - show the inline `ThrottleNotice` countdown and disable the button on VerifyEmail.
  - ForgotPassword has no countdown, which is correct because its limit is silent.
  - ResetPassword offers "Request a new link" on a token error.

### Issues

#### Critical (Must Fix)

None.

#### Important (Should Fix)

None.

#### Minor (Nice to Have)

1. **The time-box test cannot fail.**
   - Where: `tests/Feature/Auth/ForgotPasswordTest.php:192`.
   - What's wrong: it sets the box to 150 ms, but the broker's own 200 ms Timebox already makes known and unknown requests take ≥ 200 ms. Removing the app Timebox entirely (M7) leaves the test green. Its title also promises a throttled case that it never sends.
   - Fix: use a box above 200 ms (for example 600 ms), and include a throttled request, which takes ≈ 2 ms without the box. Or bind a spy `Timebox` and assert the configured duration.
2. **The recent-auth guard's normalisation and "field absent" rules are untested.**
   - Where: `ProfileInformationTest.php:47` and `:59` send their requests with a login stamp 0 hours old, so recent auth always passes.
   - What's wrong: M9 (case-sensitive compare at `FortifyRouteGuards.php:119`) and M34 (an absent `email` treated as a change) both survive. The behaviour is correct today, but a regression would either force needless re-authentication or, the other way round, go unnoticed.
   - Fix: repeat both cases with `SessionStamp::loginHoursAgo(3)`.
3. **The plaintext reset token is flashed into the session on a failed reset.**
   - Where: `bootstrap/app.php:131`.
   - What's wrong: `dontFlash` lists `password`, `password_confirmation`, `current_password`, `code` and `cf_turnstile_response`, but not `token`. When the new password fails validation on `POST /reset-password`, `token` and `email` are stored in the Redis session as old input for one request. This does not reach logs or the queue, but it contradicts the "secrets never flashed" intent of 13 §16 rule 3.
   - Fix: add `token`.
4. **Residual timing and error side channels on forgot-password, from the synchronous SMTP send (accepted ruling).**
   - Where: `config/auth.php:146`, `FortifyRouteGuards.php:64-88`.
   - What's wrong: when SMTP takes longer than 1.5 s, a known address is slower than an unknown one. When SMTP fails, a known address gets a 500 while an unknown one gets the generic 302, an enumeration oracle during mail outages.
   - Fix: catch the transport exception inside the box, report it, and return the generic response. Consider a metric or alert on reset-mail duration close to the box.
5. **The 1.5 s Timebox holds a PHP worker for every forgot-password POST, throttled ones included.**
   - Where: `FortifyRouteGuards.php:64`.
   - What's wrong: a few dozen concurrent requests can occupy every FPM worker, which is cheap worker exhaustion.
   - Fix: none needed now. Note it for the deployment worker count (17), or rate-limit at the proxy.
6. **The row lock in `ContactVerification` is untested.**
   - Where: `ContactVerification.php:37`.
   - What's wrong: removing `lockForUpdate` (M4) survives. A real concurrency test is costly.
   - Fix: none required. The fix round adds `first_contact_verified_at`, which can make the "once" rule a single conditional `UPDATE … WHERE first_contact_verified_at IS NULL` instead of relying on the lock.
7. **`ContactVerification::markEmailVerified` does not guard against a null email.**
   - Where: `ContactVerification.php:21`.
   - What's wrong: only `User::markEmailAsVerified` checks for a null email, so a direct caller could stamp `email_verified_at` on a user with no email.
8. **The `account.email_verified` audit properties differ from 13 §17.**
   - Where: `HandleEmailVerified.php:29`.
   - What's wrong: the entry has `{email: masked}`, while the 13 §17 row groups this event with masked `from`/`to`. `{email}` is the more sensible shape, so the spec table may be what needs correcting. Recording it so the deviation is deliberate.
9. **Two test titles say something other than what the tests check.**
   - `ProfileInformationTest.php:180` "lets sign-in with the old email stay as it is" actually signs in with the **new** email.
   - `PasswordUpdateTest.php:181` "is not written twice …" asserts that the count is 2.
10. **A Turnstile-only error does not move focus on the forgot page.**
    - Where: `ForgotPassword.vue:33`.
    - What's wrong: `focusFirstError` looks for `[aria-invalid="true"]`, and the widget has no such attribute, so focus stays on the button. The error is announced through `aria-describedby` only.

### Browser form-submit hang (implementer's concern 6)

This is a harness or environment problem, not an app bug. I spent about 15 minutes on it, with `yarn vite build` in the scratch copy and `PLAYWRIGHT_BROWSERS_PATH` set.

- **A plain login submit does not hang.** It reached `/dashboard`, so the implementer's claim is inaccurate. `LoginResponse` answers with an Inertia 409 plus `X-Inertia-Location`, so the browser navigates afresh.
- **Forgot-password submit "hangs".** I logged requests with a `RequestHandled` listener. The `POST /forgot-password` is handled and returns 302 with `Location` set and the status flashed. The browser never issues the follow-up GET, and the page fetch/XHR never reaches `loadend`.
- **I isolated it with probe routes** (`fetch()` from the page):

  | Probe | Result |
  |---|---|
  | GET 200 | 0.2–0.3 s |
  | POST 200 (JSON) | 0.2–0.3 s |
  | GET 302 in the web group | 15 s timeout, request re-sent 16 times |
  | POST 302 (JSON or form) | 15 s timeout, request re-sent 16 times |
  | GET 302 outside the web group, empty body, plain `Location` | 15 s timeout, request re-sent 16 times |

- **It is not CSP, Vite assets, Turnstile or the Playwright metadata timeout.** Any 3xx answered by the in-process `Pest\Browser\Drivers\LaravelHttpServer` (pest-plugin-browser v5.1.2, Amp) is never delivered as a redirect to Chromium, so the browser keeps retrying the original request.
- **Consequence:** browser tests can drive only forms whose answer is a 200 or an Inertia 409 location. Every `back()` or `redirect()` form (forgot, reset, confirm, resend, profile) cannot be exercised end to end in this environment. The Feature and vitest coverage stand in for it.
- **Next step:** escalate to the harness (Amp response writing for 3xx, or the sandbox network layer) rather than to the app.

### Assessment

**Task quality:** Approved. The listed Minor items can go into the planned fix round alongside the queued `first_contact_verified_at` change.

**Reasoning:** Every security behaviour asked about was checked directly:
- reset-token single use and expiry;
- identical forgot-password answers, measured at 1.5 s for known, unknown and throttled emails;
- signed-URL expiry, tampering and wrong-user rejection;
- recent-auth before validation, uniqueness including trashed users, normalisation, an unverified new email, `VerifyEmail` to the new address, and the masked audit;
- conditional `current_password`, and other-session revocation with the current session kept.

33 of 39 mutants are killed. Of the 6 survivors, 2 are equivalent and the rest are test gaps, not wrong behaviour.
