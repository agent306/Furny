# Task 29 re-review 1 (fix round 1, 5ede333..f5756bd)

Rulings applied: 1–6 from the controller.

How the round was checked:
- The fix diff (1946 lines) was read in one pass.
- Probes and mutants ran in a scratch copy at f5756bd, against real Postgres and Redis. The copy has been deleted, and `git status` in the worktree is clean.

### Finding Verdicts

- **Critical 1: `auth.reauthenticate.store` accepted users with a password, so a stolen session could confirm itself with an OTP.** ADDRESSED.
  - Code: `ReauthenticateController.php:55-60` throws `RecentAuthenticationRequired` for a user with a password, before any code is sent or checked. The exception sends browsers to `password.confirm` and machines to 403. `show` already redirects (`:36`).
  - Probe A (password user, 3-hour session): `send` and `verify` both redirect to `/user/confirm-password`, no code is sent, and `confirmed_at` stays null.
  - Mutant P1 (refusal removed) fails 2 tests.
  - Note: the same property is still bypassable through Google `intent=link`. See New Breakage 1.
- **Important 2: changing the phone did not need `recent.auth`.** ADDRESSED as ruled.
  - Code: `Account/PhoneController.php:111-112, 128-129, 154-159` call `User::hasSignInCredential()`, which counts a password, a verified phone or a Google link (`User.php:228-234`).
  - Probe B (phone-only user, aged session): `send` and `verify` both redirect to `auth.reauthenticate`, nothing is sent, and the phone is unchanged.
  - Probe G (Google-only user): adding a phone redirects to `auth.reauthenticate`, and `store` answers `reauth_no_phone`.
  - Probe H (staff): both the phone routes and `store` go to `password.confirm`.
  - Probe I (phone-only user, fresh session): changing the phone still works.
  - A code asked for while the session was fresh cannot be verified after it ages: `verify` is gated too (test at `ReauthenticateTest.php:+1921`).
  - Mutants killed: P2 (check removed, 7 tests), P3 (removed from `verify` only, 2 tests), P4 (Google not counted, 1 test).
- **Important 3: the `PhoneVerify` resend countdown did not restart after a resend.** ADDRESSED.
  - `useCountdown(seconds, key)` watches `[seconds(), key()]` (`useCountdown.ts:+910`).
  - `PhoneVerify.vue:+1132` keys the countdown on the new `expiresAt` prop, which `PhoneOtpController.php:207` sends.
  - Vitest: when the props come back with the same 60 and a new expiry, the buttons are disabled again. The composable test covers the key.
- **Important 4: the dialog emitted `verified` on a throttled verify.** ADDRESSED.
  - `account.phone.send|verify` are now in `INLINE_ROUTES` (`RateLimitedResponse.php:+504-505`). The dialog also ignores a response that carries `flash.error` (`PhoneVerifyDialog.vue:+561-566, +589-596`) and shows the wait (`:+531-538, +618`).
  - Probe D: 302 with `errors.rate_limited = 60` and no error flash.
  - Mutant T2 (routes not inline) fails 1 test. Vitest covers both shapes.
- **Minor 5: the "bound to the user" Google test was vacuous.** ADDRESSED. The test now uses another staff member's 2FA challenge (`GoogleOAuthTest.php:1314-1334`), and mutant L2 fails it.
- **Minor 6: the guest intent filter was untested.** ADDRESSED. New test at `PhoneLoginFlowTest.php:+1846-1858`; mutant M3 fails it.
- **Minor 7: the same-origin redirect after re-authentication was not pinned.** ADDRESSED. Dataset at `ReauthenticateTest.php:+1935-1946` (another host, protocol-relative, backslash); mutant R5 fails 3 tests.
- **Minor 8: `OtpChallenge::$expiresAt` was dead.** ADDRESSED. It is now the countdown key (`PhoneOtpController.php:207`).
- **Minor 9: duplicated terms markup and captcha extraction.** ADDRESSED.
  - `TermsCheckbox.vue` is used by PhoneLogin, PhoneComplete and Register, and has its own test.
  - `HasCaptchaToken` is used by four requests; the copies in the controllers are gone.
- **Minor 10: `Reauthenticate.vue` had no resend countdown.** ADDRESSED. `Reauthenticate.vue:+1183-1185, +1208, +1231-1244`, with a Vitest test.
- **Minor 11: `auth.otp.status` had no rate limit.** ADDRESSED. `routes/web.php:58` adds `throttle:api`; a test asserts the 61st call is 429.
- **Minor 12: pipe plurals in `otp_invalid`.** Not changed. This is plan-mandated (`trans_choice`) and accepted.
- **Minor 13: noise in the implementer's runs.** No new noise reported. The focused Vitest run here (15 files, 156 tests) was clean.

### New Breakage in the Fix Diff

1. **Critical: the recent-authentication bypass survives through Google `intent=link`** (outside the fix diff, but it is the property of Critical 1, which the controller asked to be checked from every angle).
   - Where:
     - `GoogleController.php:154` routes `intent=link` to `link()`.
     - `LinkGoogleAccount::forSignedInUser` (`:59-67`) links Google and, for a user without an email, sets `email` from Google.
     - Neither asks for `recent.auth`. `GoogleOAuthTest.php:936` pins "does not ask for a recent authentication", which 13 §5.3 step 6 allows.
   - Probe E: a phone-only user (email null) with a 3-hour session.
     1. The link callback with the thief's Google account (`999000999`, `thief@example.com`) produced `google_id = 999000999`, `email = thief@example.com`, email verified.
     2. The reauthenticate callback with that Google account then stamped `auth.password_confirmed_at`.
   - Impact:
     - recent.auth falls, so email change, sign-out of other devices, deletion and export are open.
     - The thief also gains a lasting way in: Google sign-in, and password reset through the email now on the account.
   - Fix, needs a ruling (same rationale as ruling 2):
     - Apply the `hasSignInCredential()` + `RecentAuthentication::passes` gate to `intent=link`, both at `auth.google.redirect` and again at the callback.
     - Change the test at `GoogleOAuthTest.php:936` accordingly.
2. **Minor: the dialog takes a recent-authentication redirect for a success.**
   - A `send` or `verify` from `PhoneVerifyDialog` in an aged session is answered by a redirect to `password.confirm` or `auth.reauthenticate`. That is a successful Inertia visit with no `flash.error`, so `verifyCode`'s `onSuccess` still emits `verified` and `update:open` (`PhoneVerifyDialog.vue:+589-598`).
   - Today nothing listens to `verified` across that navigation (the banner ignores it). The order submit dialog and onboarding (10 §13.2.3) would.
   - Fix: check that the visit stayed on the same component, or answer recent-auth refusals of `account.phone.*` with an errors bag.
3. **Minor (by ruling): a user with no credential can add a phone without `recent.auth`, then re-authenticate with it.**
   - Probe F: `confirmed_at` was set.
   - Ruling 2 exempts these users, and such a signed-in user is hardly reachable: every sign-in path leaves a password, a verified phone or a Google link. Recorded so the exemption is a conscious one; ruling 3 holds only in the sense that the number was verified before the attempt.

### Out-of-Scope Observations

None beyond New Breakage 1, which lies outside the diff but is raised as blocking because the controller scoped the bypass check to every angle.

### Verdict

**Fix round:** Findings remain open. All 13 original findings are addressed (Minor 12 accepted as plan-mandated). Open:
- Critical: recent-authentication bypass through Google `intent=link` for phone-only users (probe E).
- Minor: the dialog emits `verified` on a recent-auth redirect.
- Minor (by ruling): a user with no credential can add a phone and re-authenticate with it (probe F).
