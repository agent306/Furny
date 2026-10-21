### Task 26: Password reset, email verification, profile and password updates, `ContactVerified`

**Files:**
- Create: `app/Actions/Fortify/{ResetUserPassword,UpdateUserProfileInformation,UpdateUserPassword}.php` (replace kit versions); `app/Http/Responses/GenericPasswordResetLinkResponse.php`; `app/Notifications/Auth/{ResetPassword,VerifyEmail}.php`; `app/Domain/Identity/Support/ContactVerification.php`; `app/Listeners/HandleEmailVerified.php`; `resources/js/pages/Auth/{ForgotPassword,ResetPassword,VerifyEmail,ConfirmPassword}.vue`
- Modify: `User` (`sendPasswordResetNotification`, `sendEmailVerificationNotification` no-op without email, `markEmailAsVerified` via `ContactVerification`), `config/auth.php` (`passwords.users.expire 60`, `throttle 60`, `verification.expire 60`, `password_timeout 600`), `app/Providers/FortifyServiceProvider.php`, `resources/lang/en/{passwords,auth,notifications,account}.php`, `route-access.php`
- Test: `tests/Feature/Auth/{ForgotPasswordTest,ResetPasswordTest,EmailVerificationTest,ProfileInformationTest,PasswordUpdateTest,ContactVerifiedTest}.php`

**Spec refs:** `13 §2` (notifications, auth config), `§5.5`, `§5.6`, `§5.8`, `§17`, `§20.11`; `10 §4.5`, `§4.6`, `§4.8`; `12 §3.3`; P1-D5

**Interfaces:**
- Consumes: Tasks 23–25.
- Produces: `ContactVerification::markEmailVerified(User $u): void` and `markPhoneVerified(User $u): void` (set timestamps; dispatch `ContactVerified` after commit iff both were null before); `ResetPassword`/`VerifyEmail` mail notifications (keys `notifications.auth.password_reset.{subject,title,body,action}`, `notifications.auth.email_verification.{…}`; verification URL = temporary signed `verification.verify`, 60 min); generic forgot-password response (`status` = `trans('passwords.sent_generic')` for existing, unknown, throttled users); profile update rules of `13 §5.8` (email change requires recent auth via `RecentAuthenticationRequired`; unique incl. soft-deleted → `auth.email_unavailable`; clearing the last login method → `auth.errors.last_login_method`; audit `account.email_changed` with masked `from`/`to`); password update (current password only when the user has one; destroys other sessions; audit `auth.password_changed`); reset (`email_verified_at ??= now()` through `ContactVerification`, rotate `remember_token`, `SessionRegistry::destroyAll`, audit `auth.password_reset`).

- [ ] **Step 1: Write the failing tests**
  - `ForgotPasswordTest`: existing and unknown email get the identical response (status text and redirect); `ResetPassword` is sent only to the existing user; the 4th request for one email within an hour still returns the generic response; a passwordless user with an email receives a link.
  - `ResetPasswordTest`: valid token sets the new password, sets `email_verified_at` when null, rotates `remember_token`, destroys the user's registered sessions, writes `auth.password_reset`; the token works once; after 61 minutes it is rejected.
  - `EmailVerificationTest`: the signed link verifies and writes `account.email_verified`; a link opened 61 minutes later is rejected; a logged-out click redirects to `login` and returns after sign-in; `sendEmailVerificationNotification()` sends nothing for a phone-only user.
  - `ContactVerifiedTest`: first verification (email) dispatches `ContactVerified` once; a later phone verification does not; a user created already verified (`markPhoneVerified` on a new user with both null) dispatches once.
  - `ProfileInformationTest`: email change without recent auth → redirect `password.confirm`; with recent auth → email updated, `email_verified_at` null, `VerifyEmail` sent, activity `account.email_changed` with masked values; email used by a soft-deleted user → `auth.email_unavailable`; clearing the email of a user without phone/Google → `auth.errors.last_login_method`; `marketing_opt_in` saved.
  - `PasswordUpdateTest`: wrong `current_password` → error; passwordless user sets a password without `current_password`; other sessions destroyed; activity `auth.password_changed`.
- [ ] **Step 2: Run, expect FAIL** — `vendor/bin/pest tests/Feature/Auth`
- [ ] **Step 3: Implement** — per Interfaces; pages per `10 §4.5`, `§4.6`, `§4.8`.
- [ ] **Step 4: Run tests, expect PASS** — `vendor/bin/pest tests/Feature/Auth`
- [ ] **Step 5: Quality gates** — Gates-PHP, Gates-JS, Gates-Gen.
- [ ] **Step 6: Commit** — `git add app config resources tests` → `feat(auth): password reset, email verification, profile updates and ContactVerified` + trailer.

