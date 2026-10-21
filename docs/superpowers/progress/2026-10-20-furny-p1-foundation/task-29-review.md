# Task 29 review: phone OTP sign-in/sign-up, phone verification, re-authentication (ee70418..5ede333)

Read in one pass: the full diff (8157 lines, non-empty), the brief, the report and its carries, and spec 13 §4, §5.2, §5.7, §6.2, §6.4, §12.7, §20.6, spec 10 §1.1, §4.4, §4.8, §13.2.3, and spec 15 §9.31. Probes and mutants ran in a scratch copy outside the worktree, against real Postgres and Redis. That copy has been deleted, and `git status` in the worktree is clean.

### Spec Compliance

- ❌ Issues found:
  - **`auth.reauthenticate.store` accepts users who have a password.** Spec 13 §6.4 and the brief say this route is for passwordless users only. Only `show` checks for a password (`ReauthenticateController.php:36`); `store` (`:51-83`) does not. See Critical 1.
  - **The resend countdown in `PhoneVerify` does not restart after a resend.** This misses the 60 s countdown of 13 §4.4 and 10 §4.4. See Important 3.
- ✅ Everything else in the brief is present and matches the accepted rulings:
  - all 8 `auth.otp.*` routes, `guest` except `status` (`routes/web.php:47-58`);
  - `account.phone.send|verify` and `auth.reauthenticate(.store)` (`routes/web.php:71-80`);
  - `RegisterCustomer::fromPhone`;
  - `OtpException` rendering (`OtpErrorResponse`);
  - all pages, `VerifyContactBanner` and `PhoneVerifyDialog`;
  - Login and Register show "Use my phone instead";
  - the `route-access` entries;
  - every listed test file;
  - carries 1–4 and the Task 28 fold-ins (a)–(c).
- ⚠️ Cannot verify from the diff:
  - The `IntendedRedirect::resolve` same-origin rule (13 §12.7) is existing code. I checked that it is used (`ReauthenticateController.php:82`), but the Task 29 tests do not pin it (mutant R5 below).
  - `fallBackToSms` has no caller; this is carried to P8 by ruling.

### Strengths

- **Non-enumeration holds when measured.**
  - Probe: 40 known and 40 unknown numbers, alternating the login and register intents, real Redis cache.
  - The sets of `{status, Location, flash keys, otp.challenge keys, session keys}` were identical.
  - Median send time: 4.65 ms (known) vs 4.60 ms (unknown); p90: 10.15 vs 9.51 ms. These are equal within noise.
  - `send` never touches `users` (`PhoneOtpController.php:58-69`), and the implementer's query-count test pins that.
- **`otp.challenge` handling.**
  - The challenge is bound to the number and the purpose, filtered by intent per flow (`OtpChallenge::current`), and replaced on every send.
  - It is forgotten as soon as the code is used (`PhoneOtpController.php:99`, `ReauthenticateController.php:78`, `Account/PhoneController.php:46`).
  - A register intent that verifies an existing number signs that customer in and ignores the name (tested), as 13 §5.2 intends.
  - `complete` after 16 minutes redirects to `auth.otp.create` with `otp_expired` (tested; the boundary mutant M6 is killed).
- **Login outcomes.**
  - Trashed, then staff, then inactive are refused before `markPhoneVerified` runs (`ResolvePhoneAccount.php:59-74`; mutants A1 and A2 killed).
  - Remember is set for customers only.
  - `auth.pending_method = {method: otp, user}` is set before `Auth::login` (mutant M7 killed).
  - The session id changes on login.
- **Verify limiters count first, then compare** (`VerifyOtp.php:83-92`).
  - I re-ran the parallel probe 3 times and it passed every time.
  - The check-then-hit mutant failed both parallel tests, including a variant that hits later.
  - Laravel's window-open race is documented and is inherited, not introduced.
- **Account phone.**
  - `phone_unavailable` is answered only after the code, so a number cannot be probed without owning it. Soft-deleted users are included.
  - The audit masks both the old and the new number (mutants V2 and V3 killed).
  - `ContactVerified` fires only on the first verified contact, through the conditional UPDATE in `ContactVerification::mark`.
- **The `X-Throttle-Toast` header cannot be abused.** It only chooses between an inline error and a toast for an inline route's 429 (`RateLimitedResponse.php:76`); the limiter has already refused the request. It is also not a CORS-safelisted header. Mutant T1 is killed.
- **Task 28 fold-ins.**
  - The deferral, renewing the remember cookie and forgetting the stash on a password sign-in are all pinned (mutants G1, G2, L1, L3 and U1 killed).
  - The keep-session test is now meaningful: the `others()` → `all()` mutant is killed.
- **Vue pages.**
  - WebOTP is guarded and aborted on unmount (`OtpCodeField.vue:45-73`).
  - The code field auto-submits at 6 digits; i18n goes through `t()` throughout; aria-invalid/describedby and focus on the first error are in place; 429s count down inline.
  - Browser probe (Chromium, `PLAYWRIGHT_BROWSERS_PATH` set, after `vite build`): `/login/phone`, `/login/phone?intent=register`, `/login`, `/register` and `/auth/reauthenticate` at 375 px show no JS errors, no horizontal scroll, one h1 and no serious axe issues. On the dashboard of an unverified customer the banner renders, passes axe and opens the dialog. The existing `LayoutsTest` and `CspTest` pass: 44 tests.
- **Test runs in the scratch copy.**
  - `pest tests/Feature/Auth/Otp`: 246 passed.
  - Vitest on `pages/Auth`, `components/{account,common,auth}`: 244 passed.
  - Both outputs were clean.

### Issues

#### Critical (Must Fix)

1. **A stolen session can bypass password confirmation: `auth.reauthenticate.store` accepts users with a password, and the phone it sends to can be swapped without `recent.auth`.**
   - Where:
     - `app/Http/Controllers/Auth/ReauthenticateController.php:51-83`: no `hasPassword()` check; only `show` (`:36`) has one.
     - `routes/web.php:71-72`: `account.phone.*` has no `recent.auth`.
   - Probe A: a user with a password and a verified phone, whose session is 3 hours old, posted `{step: send}` and then `{step: verify, code}`. The result was `auth.password_confirmed_at` set to an int.
   - Probe B: the same old session added the attacker's number through `account.phone.send` and `account.phone.verify` (no `recent.auth` needed). Re-authenticating then sent the code to the new number and stamped the confirmation.
   - Together, anyone holding a session cookie, customer or staff (13 §5.7.3 lets staff add a phone), can pass `recent.auth` without the password. That opens sign-out of other devices, email change, Google unlink, deletion and export, which is exactly what 13 §6.4 protects.
   - Fix:
     - (a) In `store`, refuse users with a password: 403, or redirect to `password.confirm`. Add a test.
     - (b) See Important 2 for the phone swap.

#### Important (Should Fix)

2. **Changing the phone does not need `recent.auth`, so re-authentication of passwordless users can be bypassed the same way** (`routes/web.php:71-72`).
   - Probe B shows the chain for a phone-only user. It also works for a Google-only user who has no phone yet.
   - 13 §5.7 does not require `recent.auth`, so this is a spec gap and needs a controller ruling.
   - Suggested rule: `account.phone.*` requires `recent.auth` when the account already has a factor to re-authenticate with (a verified phone or a linked Google account). The banner and onboarding flows, for users with no verified contact, stay as they are.
   - Alternative: re-authentication may send only to a number that was verified before the current session started.
3. **After a resend, the `PhoneVerify` resend countdown does not restart**, so the resend buttons are enabled again at once (`resources/js/pages/Auth/PhoneVerify.vue:39`).
   - Cause: `useCountdown(() => props.resendAvailableIn)` restarts only when the value changes. Inertia v3 `router.post` defaults to `preserveState: true` (core `index.js:3303`), and `verify.show` answers `60` both after the first send and after every resend.
   - Scratch Vitest: wait 60 s, click resend, set `resendAvailableIn` to 60 → the button is still enabled. The test failed with "expected undefined to be defined".
   - A second click then gets `otp_cooldown`.
   - Fix: call `restart(RESEND_SECONDS)` in `resendBy`'s `onSuccess`, as `PhoneVerifyDialog` does, or key the countdown on `otpId`. Add the test.
4. **`PhoneVerifyDialog` emits `verified` and closes when the verify was throttled** (`resources/js/components/account/PhoneVerifyDialog.vue:115-118`).
   - `account.phone.verify` is not in `INLINE_ROUTES`. A 429 from `VerifyOtp::countAttempt` therefore comes back as a plain redirect with `flash.error` and no errors.
   - Probe D confirmed it: 302 back, `errors = null`, flash error "Too many attempts. Try again in 60 seconds."
   - Inertia treats that as success. Consumers named in 10 §13.2.3 (order submit, onboarding) would take the number as verified.
   - Fix: check `visited.flash?.error` the way the banner does, or make the account phone routes answer the errors bag.

#### Minor (Nice to Have)

5. **The "is bound to the user" test does not test the binding** (`tests/Feature/Auth/GoogleOAuthTest.php:1314`).
   - It signs in with a password, and `AuthenticateUser` drops the stash before the `Login` event fires.
   - Mutant L2 (remove `($pending['user'] ?? null) !== $user->getKey()`, `ApplyPendingGoogleLink.php:51`) survived all 128 Google tests.
   - The code is correct, but nothing pins it. Use a non-password sign-in for the other user, such as an OTP customer or another user's 2FA challenge.
6. **The intent filter of the guest flow is untested** (`PhoneOtpController.php:47`).
   - Mutant M3, adding `reauthenticate` to `INTENTS`, survived `tests/Feature/Auth/Otp` (249 tests).
   - The impact is low because of `guest`, but the brief asks for "cannot be swapped between intents". Add a test with a reauthenticate challenge on `auth.otp.verify`.
7. **The same-origin redirect after re-authentication is not pinned by the Task 29 tests.**
   - Mutant R5, replacing `IntendedRedirect::resolve` (`ReauthenticateController.php:82`) with a raw `url.intended` pull, survived.
   - Add one test with an off-site `url.intended`.
8. **`OtpChallenge::$expiresAt` is stored but never read** (`OtpChallenge.php:49,84,141`).
   - The challenge lives as long as the session; only the code's own expiry is enforced (`VerifyOtp`). That is acceptable per decision 7, but the field is dead.
   - Either enforce it (for example, drop the challenge on `showVerify` well after expiry) or remove it.
9. **Duplication.**
   - The terms checkbox block is repeated verbatim in `PhoneLogin.vue:124-150`, `PhoneComplete.vue:78-104` and `Register.vue:~175-200`.
   - The captcha-token extraction is repeated in three controllers (`Account/PhoneController.php:30`, `PhoneOtpController.php:225`, `ReauthenticateController.php:61`).
10. **`Reauthenticate.vue` has no resend countdown.** "Send me a code" stays enabled after a send (`:66`); a second click within 60 s shows the cooldown error. 13 §4.4 asks for a countdown.
11. **`auth.otp.status` is public and unthrottled** (`routes/web.php:57`). It does one indexed query plus a session write per call. Consider `throttle` or a cheap limiter.
12. **`auth.errors.otp_invalid` uses Laravel pipe plurals** (`resources/lang/en/auth.php:61`), while the catalogue is otherwise ICU and spec 10 §4.4 writes it in ICU. The brief mandates `trans_choice`; reported as plan-mandated, cosmetic.
13. **Noise in the implementer's reported runs:**
    - one full Vitest run ended with "1 error" and could not be reproduced;
    - two `AddressFields` timeouts under load.

    Both should be tracked as noise. They did not reproduce here.

### Mutation check (scratch copy, deleted afterwards)

- **Killed:**
  - M1 (no remember), M4 (no forget), M6 (15 min boundary), M7 (no pending method);
  - R1 (unverified phone), R2 (intent unchecked), R4 (no forget);
  - V2 and V3 (unmasked audit);
  - A1 (inactive check), A2 (no `withTrashed`);
  - L1 (`viaRemember`), L3 (get vs pull);
  - G1 (no deferral), G2 (no renew);
  - U1 (password login keeps the stash);
  - T1 (toast header);
  - O1 and O1b (check-then-hit, parallel);
  - K1 (`others` → `all`).
- **Survived:**
  - M2 (`regenerate()` removed): equivalent, because `SessionGuard::login` migrates the session id itself.
  - M3: see Minor 6.
  - M5 (name passed for the login intent): equivalent, since a login challenge never carries a name.
  - R3 (`e164` check removed): equivalent, since `VerifyOtp` is called with the user's own number.
  - R5: see Minor 7.
  - V1 (`withTrashed` removed in `VerifyPhone`): behaviour is unchanged, because the unique index on `phone_e164` raises and is caught as `phone_unavailable`.
  - L2: see Minor 5.

### Assessment

**Task quality:** Needs fixes

**Reasoning:** Sign-in and sign-up are solid and well tested: enumeration was measured as equal, the challenge is bound per intent, and the limiters are atomic. But re-authentication can be bypassed with a stolen session (probed for password and passwordless users). The resend countdown and the dialog's throttled-verify path also behave wrongly in ways users will see.
