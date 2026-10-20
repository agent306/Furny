# 13 — Authentication, Authorization & Security

Read the master document, `01`, `02`, `03` and `09` first; `12` defines the messages (OTP, password reset, verification, invitation) that the flows below send. This file is normative for **authentication flows, sessions, roles & permissions, policies, rate limits, upload security, HTTP security, secrets, PII, audit logging and security testing**.

Tables, columns and settings used here (`staff_invitations`, `upload_intents`, `notification_deliveries`, `users.terms_accepted_at`, `users.anonymised_at`, settings group `auth`) are defined in `02`.

---

## 1. Overview & decisions

| # | Decision | Rationale |
|---|---|---|
| S1 | One `web` session guard (Fortify) for customers **and** staff; user kind = `users.type` (`customer` \| `staff`); staff capabilities via spatie roles/permissions; customers have **no roles** and are authorised by ownership. | One login page and code path; ownership rules are clearer than a "customer" role. |
| S2 | Customer sign-in methods: email + password, phone OTP (WhatsApp first, SMS fallback), Google. Staff: email + password (+ TOTP 2FA), optionally Google **linked** to an invited account. Staff can never sign in with phone OTP. | OTP would bypass staff 2FA. |
| S3 | Staff accounts always have a password, even when Google is linked. | Fortify password confirmation and 2FA flows assume a password; one code path. |
| S4 | 2FA (TOTP via Fortify) **mandatory** for roles `owner` and `admin`, optional for other staff, not offered to customers. | Highest-privilege accounts protected; customers use passwordless options. |
| S5 | Captcha provider: **Cloudflare Turnstile**. | Free, privacy-friendly, mostly invisible, works well in India; no Google tracking (reCAPTCHA) or puzzles (hCaptcha). |
| S6 | No ClamAV in v1. | See §11.7. |
| S7 | GDPR/DPDP-style **data export: yes in v1**, as a synchronous streamed JSON download. | Cheap to build (no storage/notification); satisfies data-access requests under India's DPDP Act 2023 and GDPR-style expectations. |
| S8 | No staff impersonation of customers in v1. | Avoids a high-risk feature; staff see customer data in admin views. |
| S9 | Account deletion = soft delete immediately, **anonymise after 30 days**; orders/quotes retained with anonymised identity. | Recovery window for mistakes; accounting/tax records must survive. |

Middleware aliases (registered in `bootstrap/app.php`):

| Alias | Class | Behaviour |
|---|---|---|
| `active` | `App\Http\Middleware\EnsureUserIsActive` | If authenticated user has `is_active = false` or is soft-deleted → logout, invalidate session, redirect `login` with error `auth.inactive`. |
| `customer` | `App\Http\Middleware\EnsureUserType:customer` | Staff → redirect `admin.dashboard`. |
| `staff` | `App\Http\Middleware\EnsureUserType:staff` | Customer → 403 (Inertia page `Error` with `status: 403`, 10 §4.10). |
| `onboarded` | `App\Http\Middleware\EnsureCustomerOnboarded` | Customers with `users.onboarded_at` null are redirected (GET only) to `customer.onboarding.show` (10 §5.1). |
| `verified.contact` | `App\Http\Middleware\EnsureContactVerified` | Passes if `email_verified_at` or `phone_verified_at` non-null; else 403 JSON `{code:'contact_unverified'}` / Inertia redirect back with error banner. |
| `2fa.enrolled` | `App\Http\Middleware\EnsureTwoFactorEnrolled` | §5.10. |
| `session.absolute` | `App\Http\Middleware\EnforceAbsoluteSessionLifetime` | §6. |
| `recent.auth` | `App\Http\Middleware\RequireRecentAuthentication` | §6.4. |
| `track.session` | `App\Http\Middleware\TrackSession` | §6.3 (appended to `web` group). |

Route groups: customer `['web', 'auth', 'active', 'customer', 'onboarded']` (`onboarded` skipped for `customer.onboarding.*`, `customer.account.*`, `customer.help`, `customer.notifications.index`); admin `['web', 'auth', 'active', 'staff', '2fa.enrolled', 'session.absolute']`; API (editor JSON) `['web', 'auth', 'active', 'throttle:api']` (session auth, CSRF-protected). Gated customer actions additionally use `verified.contact`: order submission (T2), starting an **auto** blueprint import, posting messages, account data export.

---

## 2. Fortify configuration

`config/fortify.php`:

```php
'guard' => 'web',
'passwords' => 'users',
'username' => 'email',
'email' => 'email',
'lowercase_usernames' => true,
'home' => '/dashboard',            // overridden by custom LoginResponse (staff → admin.dashboard)
'prefix' => '',
'domain' => null,
'middleware' => ['web'],
'limiters' => ['login' => 'login', 'two-factor' => 'two-factor'],
'views' => true,                   // Inertia views registered in FortifyServiceProvider
'features' => [
    Features::registration(),
    Features::resetPasswords(),
    Features::emailVerification(),
    Features::updateProfileInformation(),
    Features::updatePasswords(),
    Features::twoFactorAuthentication(['confirm' => true, 'confirmPassword' => true, 'window' => 1]),
],
```

`App\Providers\FortifyServiceProvider::boot()`:

- Views: `Fortify::loginView` → `Auth/Login`, `registerView` → `Auth/Register`, `requestPasswordResetLinkView` → `Auth/ForgotPassword`, `resetPasswordView` → `Auth/ResetPassword`, `verifyEmailView` → `Auth/VerifyEmail`, `confirmPasswordView` → `Auth/ConfirmPassword`, `twoFactorChallengeView` → `Auth/TwoFactorChallenge`. Each passes `features` (google_login, captcha), `turnstileSiteKey`, `canRegister` (setting `auth.allow_customer_registration`).
- `Fortify::createUsersUsing(CreateNewUser::class)`, `updateUserProfileInformationUsing(UpdateUserProfileInformation::class)`, `updateUserPasswordsUsing(UpdateUserPassword::class)`, `resetUserPasswordsUsing(ResetUserPassword::class)` (all in `app/Actions/Fortify/`).
- `Fortify::authenticateUsing(fn (Request $r) => App\Actions\Fortify\AuthenticateUser::handle($r))`:
  1. `$user = User::where('email', mb_strtolower(trim($r->email)))->first()` (soft-deleted excluded by default scope).
  2. `null` or `password` null or `! Hash::check($r->password, $user->password)` → return `null` (generic `auth.failed`).
  3. `! $user->is_active` → throw `ValidationException::withMessages(['email' => __('auth.inactive')])` (only after a correct password → no enumeration).
  4. Return `$user`.
- `Fortify::authenticateThrough(fn () => array_filter([config('fortify.limiters.login') ? null : EnsureLoginIsNotThrottled::class, ApplyRememberPolicy::class, RedirectIfTwoFactorAuthenticatable::class, AttemptToAuthenticate::class, PrepareAuthenticatedSession::class]))`. `App\Actions\Fortify\ApplyRememberPolicy` merges `remember = false` into the request when the email belongs to a staff user (staff never get remember cookies).
- Custom `LoginResponse` / `TwoFactorLoginResponse` / `RegisterResponse`: redirect to `session()->pull('url.intended')` if it is a same-origin path, else staff → `admin.dashboard`, customer → `customer.dashboard`. Inertia requests receive `Inertia::location()`.
- `Password::defaults(fn () => app()->isProduction() ? Password::min(10)->max(128)->uncompromised() : Password::min(8)->max(128))` in `AppServiceProvider`. Rationale: NIST 800-63B — length + breached-password check, no composition rules. `uncompromised()` calls the HIBP k-anonymity API; on network failure Laravel treats the password as not compromised (fail open, acceptable).
- `User::sendPasswordResetNotification($token)` → `App\Notifications\Auth\ResetPassword`; `User::sendEmailVerificationNotification()` → `App\Notifications\Auth\VerifyEmail` (no-op when `email` is null). `User implements MustVerifyEmail`, but routes **never** use Laravel's `verified` middleware (phone-only users have no email) — they use `verified.contact`.
- `config/auth.php`: `passwords.users.expire = 60`, `passwords.users.throttle = 60`, `verification.expire = 60`, `password_timeout = 600` (password confirmation valid 10 min).

---

## 3. Captcha (Cloudflare Turnstile)

- Env `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`. Feature flag `features.captcha` (master §6.7) = both set. When false (local/tests), captcha checks pass.
- Frontend component `resources/js/components/auth/TurnstileWidget.vue` loads `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit` with the page CSP nonce, renders managed mode with `data-action` = the form name (`register`, `password_reset`, `otp_send`), emits the token; hidden input `cf_turnstile_response`.
- Validation rule `App\Rules\TurnstileToken(string $action, bool $failOpen)`: `POST https://challenges.cloudflare.com/turnstile/v0/siteverify` form `{secret, response, remoteip, idempotency_key: Str::uuid()}`, timeout 5 s. Valid iff `success === true` AND `hostname` equals `parse_url(APP_URL, PHP_URL_HOST)` AND `action === $action`. Network error/timeout: `failOpen` true → pass + `Log::warning('captcha.unavailable')`; false → fail with `auth.captcha_unavailable`.
- Where: **registration** (always, fail open), **password reset request** (always, fail open), **OTP send** (conditional §4.3, **fail closed** — SMS cost risk).

---

## 4. Phone OTP

### 4.1 Parameters (normative)

| Parameter | Value |
|---|---|
| Code | 6 digits, `str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT)` |
| Storage | `otp_codes.code_hash = Hash::make($code)` (02 §1.3); plaintext never stored, logged, queued or broadcast |
| Comparison | `Hash::check()` (bcrypt `password_verify`, constant-time) after input normalisation (strip spaces; must match `^\d{6}$`, else `otp_invalid` without consuming an attempt) |
| Expiry | 10 minutes (`expires_at = now()->addMinutes(10)`) |
| Max verify attempts per code | 5 (`otp_codes.attempts`), then the code is dead |
| Resend cooldown | 60 s per phone |
| Max sends | 5 per phone per hour; 10 per IP per hour |
| Captcha | required after 2 sends (per session, per phone or per IP within the hour) |
| Country allowlist | setting `auth.otp_allowed_country_codes` (default `["IN"]`) |
| Number types | libphonenumber `MOBILE` or `FIXED_LINE_OR_MOBILE` only |
| Global cap | setting `auth.otp_global_hourly_cap` (default 200 sends/hour across the system) — beyond it SMS is disabled for OTP (WhatsApp only) |
| Previous codes | sending a new code expires all unconsumed codes for the same phone + purpose |
| Purposes | `login` (sign-in **and** sign-up), `verify_phone` (authenticated user adds/changes phone) — values per 02 |
| Pruning | `otp:prune` daily 03:00 (01 §7) deletes rows with `expires_at < now() - 24h` |

### 4.2 Sending — `App\Domain\Identity\Actions\SendOtp::handle(string $rawPhone, OtpPurpose $purpose, ?string $ip, ?string $captchaToken): OtpSendResult`

1. Parse: `PhoneNumberUtil::parse($rawPhone, $defaultRegion)` where `$defaultRegion` = `business.address.country_code ?? 'IN'`. Invalid → 422 `phone_invalid`. Type not mobile → 422 `phone_not_mobile`. Region not allowlisted → 422 `phone_country_not_supported`. Normalise to E.164.
2. Limits (`RateLimiter`, §10): `otp-cooldown:{e164}` (1 per 60 s) → 429 `otp_cooldown` with `retryAfter`; `otp-send:phone:{e164}` (5/h) and `otp-send:ip:{ip}` (10/h) → 429 `otp_rate_limited`.
3. Captcha required when `features.captcha` AND any of: session `otp.sends` ≥ 2; hits on `otp-send:phone:{e164}` ≥ 2; hits on `otp-send:ip:{ip}` ≥ 2; cache flag `auth:captcha_always` set (§4.5). Missing/invalid token → 422 `{code:'captcha_required'}` (client renders the widget and resubmits).
4. Channel list = setting `notifications.otp_channel_order` (default `["whatsapp","sms"]`) filtered by availability: WhatsApp needs `features.whatsapp`, mapping `notifications.whatsapp_templates['auth.otp']` and the phone not WhatsApp-unreachable (12 §7.7); SMS needs `features.sms`, mapping `notifications.sms_templates['auth.otp']` and the global hourly cap (`otp:global:{YmdH}` counter) not reached. Empty → 503 `otp_unavailable` + `Log::critical('otp.no_channel')`.
5. In a DB transaction: expire previous unconsumed codes (`UPDATE otp_codes SET expires_at = now() WHERE phone_e164 = ? AND purpose = ? AND consumed_at IS NULL AND expires_at > now()`); insert the new row (`channel` = first channel, `ip`).
6. Hit the limiters; increment `otp:global:{YmdH}` (TTL 2 h) and session `otp.sends`.
7. Deliver **synchronously** (never queued, so the plaintext never reaches Redis): for each channel in order, `Notification::sendNow(Notification::route($channel, $e164), new OtpCode($code, $otpId), [$channelClass])`. On `WhatsAppSendException`/`SmsSendException` → try the next channel and update `otp_codes.channel`. All failed → expire the row, 503 `otp_send_failed`.
8. Store session `otp.challenge = {phone_e164, purpose, intent, name, sent_at}` and return `{channel, maskedPhone}`. Audit `auth.otp_sent` (§17).

**Asynchronous WhatsApp failure** (status webhook `failed` for an `auth.otp` delivery whose `context.otpId` is still unconsumed and unexpired): if SMS is available and the per-phone hourly limit allows, generate a **new** code (expire the old one), send it by SMS, set cache `otp:fallback:{phone_hash}` = `sms` (TTL 10 min). The verify page polls `GET /auth/otp/status` (`auth.otp.status`, every 5 s for at most 2 min while the channel is WhatsApp) which returns `{channel: 'whatsapp'|'sms', fallbackSent: bool}` and shows "We couldn't reach you on WhatsApp, so we sent an SMS instead." Fallback sends bypass the 60 s cooldown but count toward the hourly limits.

### 4.3 Verifying — `App\Domain\Identity\Actions\VerifyOtp`

1. Require session `otp.challenge` (else redirect to `auth.otp.create`). Limiters `otp-verify:ip:{ip}` (10/min) and `otp-verify:phone:{e164}` (20/h).
2. Load the **latest** row for (`phone_e164`, `purpose`) with `consumed_at IS NULL AND expires_at > now()`; none → 422 `otp_expired`.
3. Atomic attempt: `UPDATE otp_codes SET attempts = attempts + 1, updated_at = now() WHERE id = ? AND attempts < 5 RETURNING attempts`; no row → set `expires_at = now()`, 422 `otp_too_many_attempts`, audit `auth.otp_locked`.
4. `Hash::check` fails → 422 `otp_invalid` with `attemptsLeft = 5 - attempts`.
5. Success → `UPDATE … SET consumed_at = now() WHERE id = ? AND consumed_at IS NULL` (0 rows → treat as expired: double-submit protection). Clear limiter hits for the phone. Continue per §5.2 / §5.7.

### 4.4 UX requirements

Code input: one field, `inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="6"`, auto-submit when 6 digits are present. WebOTP: on mount, if `'OTPCredential' in window`, call `navigator.credentials.get({ otp: { transport: ['sms'] }, signal })` (AbortController aborted on unmount) and fill the code (the SMS text ends with `@{host} #{code}`, 12 §3.7). Show channel used, masked phone (`+91 ••••• •3210`), a countdown for resend (60 s) with buttons **Resend on WhatsApp** / **Send by SMS** (each subject to availability), and **Change number**.

### 4.5 SMS-pumping defences (summary)

1. Country allowlist + mobile-type check (§4.1). 2. Per-phone/IP limits + cooldown. 3. Turnstile after 2 sends. 4. Global hourly cap disabling SMS. 5. WhatsApp first (pumping fraud targets SMS termination). 6. **Conversion monitor**: command `otp:monitor` every 5 minutes computes, for the last 60 min, `sent = count(otp_codes)` and `verified = count(consumed_at not null)`; if `sent ≥ 50` and `verified / sent < 0.2` → `Cache::put('auth:captcha_always', true, 1h)` and `Log::critical('otp.low_conversion', …)` (shown as an admin dashboard banner via cache key `health:otp`). 7. The `auth` settings group is owner-only.

---

## 5. Authentication flows

All auth pages live in `resources/js/pages/Auth/*` with `AuthLayout`. Error codes below are translation keys under `auth.errors.*`.

### 5.1 Register with email + password (customers)

1. `GET /register` (Fortify) → `Auth/Register`: fields name, email, password, password_confirmation, `terms` checkbox (required; links to terms & privacy pages), `marketing_opt_in` checkbox (unchecked), Turnstile; links **Continue with Google** (if `features.google_login`) and **Use my phone instead** (`auth.otp.create`). If `auth.allow_customer_registration = false` → page shows `auth.registration_closed` and POST returns 403.
2. `POST /register` → `CreateNewUser::create(array $input)`: validate `name` (required, string, 2–120, must not contain `http://`/`https://`/`www.`), `email` (required, `email:rfc`, max 254, lower-cased before validation, `Rule::unique('users','email')` — soft-deleted rows included → error `auth.email_unavailable` "This email can't be used. Try signing in or resetting your password."), `password` (`Password::defaults()`, confirmed), `terms` (`accepted`), `cf_turnstile_response` (`TurnstileToken('register', failOpen: true)`), throttle `register`.
3. Create user: `type = customer`, `timezone = business.timezone`, `unit_system = units.default_system`, `length_unit = units.default_length_unit`, `locale = 'en'`, `terms_accepted_at = now()`, `marketing_opt_in`. Fortify fires `Registered` → Laravel's `SendEmailVerificationNotification` → `auth.email_verification`. Dispatch `CustomerRegistered` (`UserNotifiableEvent`, key `account.welcome`).
4. Logged in; redirect to `customer.dashboard` with a persistent banner "Verify your email to submit orders" + **Resend** (Fortify `POST /email/verification-notification`, throttle `verification-resend`). Unverified customers may create projects, draw plans, trace, and design furniture; they cannot submit orders, start auto imports, post messages or export data (`verified.contact`).

**Staff-created customers** (`admin.customers.store`, 11 §6): `type = customer`, `onboarded_at = null`, `terms_accepted_at = null`, contacts unverified; the customer accepts the terms at first login (onboarding, 10 §5.1, shows a required terms checkbox while `terms_accepted_at` is null); `sendPasswordLink = true` sends a Fortify password-reset link (broker `users`). `ContactVerified` fires when the customer later verifies a contact.

Decision: registration reveals that an email is taken (UX), mitigated by the `register` limiter and Turnstile; password reset and OTP never reveal existence.

### 5.2 Phone OTP sign-up / sign-in (customers)

Routes (`app/Http/Controllers/Auth/PhoneOtpController.php`):

| Name | Method + path | Purpose |
|---|---|---|
| `auth.otp.create` | GET `/login/phone` | Page `Auth/PhoneLogin` (step 1). Query `?intent=register` shows a Name field. |
| `auth.otp.send` | POST `/auth/otp/send` | `{phone, intent: 'login'\|'register', name?: string(2..120), cf_turnstile_response?}` |
| `auth.otp.verify.show` | GET `/auth/otp/verify` | Page `Auth/PhoneVerify` (needs session challenge) |
| `auth.otp.verify` | POST `/auth/otp/verify` | `{code}` |
| `auth.otp.resend` | POST `/auth/otp/resend` | `{channel?: 'whatsapp'\|'sms', cf_turnstile_response?}` (reuses session phone) |
| `auth.otp.status` | GET `/auth/otp/status` | JSON `{channel, fallbackSent}` |
| `auth.otp.complete.show` | GET `/auth/otp/complete` | Page `Auth/PhoneComplete` (name for a new account) |
| `auth.otp.complete` | POST `/auth/otp/complete` | `{name, terms}` |

All are `guest` middleware except `status`. The flow is **identical for existing and new numbers** (no enumeration):

1. Send (§4.2, purpose `login`). Response: redirect to `auth.otp.verify.show` with flash `{channel, maskedPhone}`.
2. Verify (§4.3). On success, look up `User::withTrashed()->where('phone_e164', $e164)->first()`:
   - soft-deleted → error `auth.errors.account_pending_deletion` ("This account is scheduled for deletion. Contact us to restore it.");
   - `type = staff` → error `auth.errors.staff_use_email` (S2);
   - `is_active = false` → `auth.inactive`;
   - exists → `phone_verified_at ??= now()`; `Auth::login($user, remember: true)`; `session()->regenerate()`; `Login` event fires; redirect intended / `customer.dashboard`;
   - not found and `auth.allow_customer_registration = false` → error `auth.registration_closed`;
   - not found and the challenge carries `name` (intent register) and `terms` accepted at step 1 → `App\Domain\Identity\Actions\RegisterCustomer::fromPhone($e164, $name)` (`phone_verified_at = now()`, `password = null`, `email = null`, `terms_accepted_at = now()`, defaults as §5.1) → login → `account.welcome` (in-app only; no email) → `customer.dashboard`;
   - not found and no name → session `otp.verified_phone = {phone, at}` (valid 15 min) → redirect `auth.otp.complete.show`; POST validates name + terms, requires `otp.verified_phone` younger than 15 min, creates the account as above.
3. `session()->forget('otp.challenge')` after success.

### 5.3 Google OAuth (Socialite)

Config `config/services.php` → `google`: `client_id` = `GOOGLE_CLIENT_ID`, `client_secret` = `GOOGLE_CLIENT_SECRET`, `redirect` = `GOOGLE_REDIRECT_URI` (default `{APP_URL}/auth/google/callback`). Hidden unless `features.google_login`.

Routes (`app/Http/Controllers/Auth/GoogleController.php`, throttle `oauth`):
- `auth.google.redirect` GET `/auth/google/redirect?intent=login|link|invitation` → stores `intent` in session (`oauth.intent`; `link` requires auth, `invitation` requires session `invitation.id` set by §5.9) → `Socialite::driver('google')->scopes(['openid','profile','email'])->with(['prompt' => 'select_account'])->redirect()`. Stateful (Socialite `state` in session); never `stateless()`.
- `auth.google.callback` GET `/auth/google/callback`:
  1. `?error=` present (user cancelled) → redirect `login` with `auth.errors.oauth_cancelled`.
  2. `Socialite::driver('google')->user()`; `InvalidStateException` → `auth.errors.oauth_state_invalid`; other exceptions → `auth.errors.oauth_failed` + `Log::warning`.
  3. Require `($g->user['email_verified'] ?? false) === true` and non-empty email → else `auth.errors.google_email_unverified`. `$email = mb_strtolower($g->getEmail())`, `$gid = $g->getId()`.
  4. **intent=login** (guest):
     - `User::withTrashed()->where('google_id', $gid)->first()` → if found: same checks as §5.2 (trashed / inactive) → login (step 5).
     - else `User::withTrashed()->where('email', $email)->first()` → if found (customer or staff): trashed/inactive checks; set `google_id = $gid`; `email_verified_at ??= now()` (Google verified it); audit `auth.google_linked` → login.
     - else if a **pending** `staff_invitations` row exists for `$email` → redirect `login` with `auth.errors.pending_staff_invitation` ("Open the invitation link we emailed you.") — never create a customer account for an invited staff email.
     - else if `auth.allow_customer_registration` → create customer: `name = $g->getName() ?: Str::before($email,'@')` (max 120), `email`, `email_verified_at = now()`, `google_id`, `password = null`, `terms_accepted_at = now()` (the Google button is labelled "By continuing you accept the Terms and Privacy Policy"), avatar **not** imported (no third-party image fetch) → `CustomerRegistered` → login.
     - else `auth.registration_closed`.
  5. Login step: customers → `Auth::login($user, remember: true)`. Staff → if `two_factor_confirmed_at` non-null: `session(['login.id' => $user->id, 'login.remember' => false])` and redirect `two-factor.login` (Fortify's challenge reads these keys); else `Auth::login($user, false)` (the `2fa.enrolled` middleware will force enrolment for owner/admin). Regenerate session; redirect via the custom `LoginResponse` logic.
  6. **intent=link** (authenticated, from profile security page): if `$gid` belongs to another user → `auth.errors.google_in_use`; if current user has an email and it differs from `$email` → `auth.errors.google_email_mismatch`; if current user has no email (phone-only) → set `email = $email`, `email_verified_at = now()` provided no other user has that email (else `auth.errors.email_unavailable`). Set `google_id`. Audit.
  7. **intent=invitation**: see §5.9 step 4.
- Unlink (`DELETE /account/google`, `account.google.unlink`, `recent.auth`): allowed only if the user still has a password or a verified phone (else 422 `auth.errors.last_login_method`). Audit `auth.google_unlinked`.

### 5.4 Login with email + password

1. `GET /login` → `Auth/Login`: email, password, **Keep me signed in** (customers; checked by default; label "for 14 days"), links: forgot password, phone login, Google, register.
2. `POST /login` (Fortify; limiter `login`) → pipeline §2. Fortify handles the 2FA challenge redirect when `two_factor_confirmed_at` is set.
3. `Login` event listener `App\Listeners\RecordSuccessfulLogin`: `last_login_at = now()`, session `auth.login_at = now()` and `auth.method = 'password'|'otp'|'google'|'remember'`, register session (§6.3), audit `auth.login`.
4. `Failed` event → audit `auth.login_failed` (no causer; masked email, masked IP). `Lockout` → `Log::warning('auth.lockout')`.
5. Logout (`POST /logout`): Fortify; listener removes the session from the registry, `Inertia::clearHistory()`, audit `auth.logout`.

### 5.5 Password reset

1. `GET /forgot-password` → email + Turnstile (`password_reset`, fail open). `POST /forgot-password` (limiter `password-reset`): **always** responds with status `passwords.sent_generic` ("If an account exists for that email, we've sent a reset link.") regardless of existence, throttling, or the user being staff/customer (override Fortify's `FailedPasswordResetLinkRequestResponse` to return the same success response). Links are sent only to users with a non-null email; passwordless users may use this to **create** a password.
2. Email `auth.password_reset` with `route('password.reset', ['token' => $t, 'email' => $email])`; token expires in 60 min; one active token per email (Laravel broker).
3. `POST /reset-password` → `ResetUserPassword`: `Password::defaults()`, confirmed; sets password; `email_verified_at ??= now()` (clicking the link proves ownership); rotate `remember_token`; destroy all other sessions (§6.3); audit `auth.password_reset`; redirect `login` with status.

### 5.6 Email verification

- Signed temporary URL (`verification.verify`, 60 min) from `auth.email_verification`. Laravel's verify route requires authentication: logged-out clicks go to `login` and return to the URL after sign-in (intended URL).
- On verify: `email_verified_at = now()`; event `Verified` → listener dispatches `ContactVerified` and audit `account.email_verified`.
- **`App\Domain\Identity\Events\ContactVerified(User $user)`** is dispatched (after commit) exactly when a user's **first** verified contact is established, i.e. when `email_verified_at` or `phone_verified_at` becomes non-null while both were null before — including accounts created already verified (phone OTP sign-up §5.2, Google sign-up §5.3, staff invitations §5.9). Consumer: `GrantSignupCredits` (18 §10.1; customers only), which grants the `signup_grant` credits. Later verifications (second contact, re-verification after an email change) do not dispatch it.
- Resend: `POST /email/verification-notification` (limiter `verification-resend`).

### 5.7 Phone verification / change (authenticated users)

Routes: `account.phone.send` POST `/account/phone/otp` `{phone}`; `account.phone.verify` POST `/account/phone/verify` `{code}` (session key `otp.challenge` with purpose `verify_phone`). Flow = §4.2/§4.3 with purpose `verify_phone`, then:
1. If another user (including soft-deleted) has this `phone_e164` → 422 `auth.errors.phone_unavailable` (no further detail).
2. Set `phone_e164`, `phone_verified_at = now()`; audit `account.phone_verified` (masked old/new).
3. Staff may add a phone (for WhatsApp notifications) the same way.

Order submission (09 T2) requires a verified email **or** phone (unchanged). Because staff confirm orders by phone (09 §7), the submit dialog (`10`) shows, for customers without a verified phone, an **optional** inline "Add a phone number for our confirmation call" step using these routes; it can be skipped.

### 5.8 Email change

`PUT /user/profile-information` (Fortify `UpdateUserProfileInformation`): when `email` changes → requires `recent.auth`; validate unique (incl. soft-deleted, error `auth.email_unavailable`); set new email, `email_verified_at = null`; send verification; audit `account.email_changed` (masked from/to). Clearing the email is rejected (422 `auth.errors.last_login_method`) when it would leave the user without a login method (password + email, verified phone, or `google_id`).

### 5.9 Staff invitation

Actors: `staff.manage`. Inviting or assigning role `owner` requires the gate `staff.manage_owners` (§7.3).

1. **Invite** (`admin.staff.invitations.store`, limiter `invitations`): `{email, name, role}` → `App\Domain\Identity\Actions\InviteStaff`: lower-case email; reject if any user (incl. soft-deleted) has the email → 422 `staff.email_in_use` (customers and staff are separate accounts; one email cannot be both); reject if a pending invitation exists → 422 `staff.invitation_pending` (use resend); role ∈ roles the actor may grant. Insert `staff_invitations` (`expires_at = now()+72h`). Send `staff.invited` (12) to the email with `URL::temporarySignedRoute('staff.invitations.show', $invitation->expires_at, ['invitation' => $invitation->id])`. Audit `staff.invited`.
2. **Resend**: sets `expires_at = now()+72h`, sends a new signed link. **Revoke**: `revoked_at = now()`. Both audited.
3. **Open link** `GET /staff/invitations/{invitation}` (`signed` middleware): invalid/expired signature → page `Auth/InvitationInvalid` ("This link has expired or is invalid — ask for a new invitation"). Invitation accepted/revoked/expired → same page with reason. If someone is logged in → page asks to sign out first (button POST `logout`). Else page `Auth/AcceptInvitation`: email (read-only), name (prefilled, editable), password + confirmation, **Continue with Google** (optional link).
4. **Google option**: stores `session(['invitation.id' => $id, 'invitation.url' => request()->fullUrl()])` and redirects `auth.google.redirect?intent=invitation`; callback requires `$email === invitation.email` (else `auth.errors.google_email_mismatch`), stores `session('invitation.google_id')`, redirects back to `invitation.url` with name prefilled from Google. The password is still required (S3).
5. **Accept** `POST /staff/invitations/{invitation}` (same signed URL; `signed` middleware): re-check pending & unexpired; validate name, `Password::defaults()`. Transaction: create user `type = staff`, `email`, `email_verified_at = now()`, `password`, `google_id = session('invitation.google_id')` (if not used by another user), `is_active = true`, `timezone = business.timezone`, `terms_accepted_at = now()`; `assignRole($invitation->role)`; `accepted_at`, `user_id`. Login (no remember), regenerate session, audit `staff.invitation_accepted`. Redirect `admin.dashboard` → owners/admins are redirected to 2FA enrolment by `2fa.enrolled`.
6. Expired invitations remain for audit; `staff_invitations` rows are never deleted.

Staff lifecycle: deactivate/reactivate (`staff.manage`; owners only by the `owner` gate) sets `is_active`, destroys the user's sessions and rotates `remember_token`. Staff users are never deleted (audit integrity). The last active owner can be neither deactivated nor demoted (422 `staff.last_owner`).

### 5.10 Two-factor authentication (Fortify TOTP)

- Page `admin.security.two-factor` (`Admin/Account/TwoFactor.vue`; password, Google link and sessions live on `admin.account.security` → `Admin/Account/Security.vue`, 11 §18): enable (`POST /user/two-factor-authentication`, password-confirmed) → QR (`GET /user/two-factor-qr-code`, SVG) + secret key text → confirm with a code (`POST /user/confirmed-two-factor-authentication`) → show 8 recovery codes (`GET /user/two-factor-recovery-codes`) with Copy/Download (`{app-name}-recovery-codes.txt`) and a required checkbox "I saved these codes". Regenerate codes (`POST /user/two-factor-recovery-codes`).
- `EnsureTwoFactorEnrolled`: for staff with role `owner` or `admin` and `two_factor_confirmed_at` null, every admin route except `admin.security.two-factor`, Fortify `two-factor.*`, `password.confirm*`, `logout` redirects to `admin.security.two-factor` with banner `auth.2fa_required`. Applies immediately when a role change makes 2FA required.
- Disabling: `DELETE /user/two-factor-authentication` is blocked for owner/admin by middleware `PreventRequiredTwoFactorDisable` (applied in the `web` group; matches route name `two-factor.disable`) → 403 `auth.errors.2fa_required`.
- Challenge (`/two-factor-challenge`): code or recovery code; limiter `two-factor`. Recovery code use → audit `auth.recovery_code_used` (Fortify `RecoveryCodeReplaced` event).
- Reset by others: `staff.manage` holders may **Reset 2FA** of another staff user (owners' 2FA only via the `owner` gate) → clears `two_factor_secret`, `two_factor_recovery_codes`, `two_factor_confirmed_at`, destroys that user's sessions; audit `auth.2fa_reset`. Break-glass for a sole owner: `php artisan furny:reset-two-factor {email}` (server access, audited with causer null and property `via: console`).
- Customers: the 2FA UI is not shown, and middleware `App\Http\Middleware\PreventCustomerTwoFactor` (in the `web` group, matching route names `two-factor.*`) returns 403 for `type = customer`. Fortify's routes stay registered as-is (no `Fortify::ignoreRoutes()`).

---

## 6. Sessions

### 6.1 Configuration

| Env / config | Value |
|---|---|
| `SESSION_DRIVER` | `redis` |
| `SESSION_CONNECTION` | `sessions` (separate Redis connection/database `REDIS_SESSION_DB=2` in `config/database.php`) |
| `SESSION_LIFETIME` | `120` (idle minutes, all users) |
| `SESSION_EXPIRE_ON_CLOSE` | `false` |
| `SESSION_ENCRYPT` | `true` (payload encrypted at rest in Redis) |
| `SESSION_COOKIE` | `__Host-session` (the `__Host-` prefix forces Secure, Path=/, no Domain) |
| `SESSION_DOMAIN` | `null` |
| `SESSION_SECURE_COOKIE` | `true` |
| `SESSION_HTTP_ONLY` | `true` |
| `SESSION_SAME_SITE` | `lax` (Google OAuth callback is a top-level GET; `lax` keeps the session) |
| Remember duration | `Auth::guard('web')->setRememberDuration(20160)` (14 days) in `AppServiceProvider::boot()` |

Customers: 120 min idle session + 14-day remember cookie (silent re-login). Staff: 120 min idle, **no remember**, and an **absolute** lifetime of 12 h (setting `auth.staff_session_absolute_hours`): `EnforceAbsoluteSessionLifetime` logs out when `now() - session('auth.login_at') > 12h` (redirect `login` with `auth.session_expired`).

`AuthenticateSession` (Laravel) is added to the `web` group so changing a password invalidates other sessions of password users.

### 6.2 Session fixation & CSRF

Fortify regenerates the session on login; every custom login path (OTP, Google, invitation) calls `session()->regenerate()` after `Auth::login`. Logout invalidates the session and regenerates the CSRF token.

### 6.3 Session registry, device list, logout other devices

`App\Support\Auth\SessionRegistry` (Redis connection `sessions`):
- `ZADD sess:user:{userId} {unix_ts} {sessionId}` on login and on activity; `HSET sess:meta:{sessionId}` `{user_id, ip_masked, ua_summary, created_at, last_active_at, method}` with TTL = `SESSION_LIFETIME` (+ 14 days for remembered customers). `TrackSession` middleware updates `last_active_at` at most once per 60 s. `ua_summary` = `"{Browser} on {OS}"` from a small regex parser `App\Support\Auth\UserAgentSummary` (no external package). Entries whose session key no longer exists are pruned on read.
- Page `customer.account.security` / `admin.account.security` lists sessions (current marked), with **Sign out** per session and **Sign out all other devices**.
- Revoke: `Session::getHandler()->destroy($id)` for each target, delete meta, `ZREM`. "All other devices" also rotates `remember_token` (`$user->setRememberToken(Str::random(60))->save()`), then, if the current request authenticated with a remember cookie or the user ticked remember at login, re-issues it with `Auth::login($user, true)`. Requires `recent.auth`. Audit `auth.sessions_revoked {count}`.
- Automatic revocation: password change/reset, deactivation, 2FA reset, account deletion request.

### 6.4 Recent authentication (`recent.auth`)

Passes if `session('auth.password_confirmed_at')` is within 10 min **or** `session('auth.login_at')` is within 10 min. Otherwise: users with a password → redirect `password.confirm` (Fortify); passwordless users → page `Auth/Reauthenticate` offering phone OTP (purpose `login`, same phone) or Google; success sets `auth.password_confirmed_at = now()`. Used for: email change, Google unlink, sign out other devices, account deletion, data export.

---

## 7. Roles & permissions

### 7.1 Permissions (exhaustive; guard `web`)

`orders.view`, `orders.review`, `orders.assign`, `orders.propose_changes`, `quotes.create`, `quotes.send`, `quotes.view_costs`, `orders.confirm`, `orders.cancel`, `orders.hold`, `orders.close`, `production.manage`, `messages.post`, `customers.view`, `customers.manage`, `catalog.manage`, `presets.manage`, `templates.manage`, `settings.manage`, `staff.manage`, `ai.manage`, `reports.view`, `plans.edit_any`, `audit.view` (**24 permissions**).

`quotes.view_costs` protects `quotes.cost_snapshot`, `internal_notes`, `PriceBreakdown` cost lines and margins everywhere (quote builder, item viewer, furniture builder estimate panel). There is no separate design-editing permission for orders: editing staff proposal drafts is part of `orders.propose_changes` (reconciliation decision D18, master §7). No other permission names exist; features of other files map onto this list (imports monitor and debug artifacts → `customers.view`; staff free re-run, refund and discard-on-behalf of imports, AI usage report, credit ledger and grants → `ai.manage`; AI settings and provider test → gate `settings.manage_restricted`; cut-list exports → `orders.view`; cost visibility → `quotes.view_costs`).

### 7.2 Role × permission matrix (seeded by `RolesAndPermissionsSeeder`, idempotent `findOrCreate` + `syncPermissions`)

| Permission | owner | admin | estimator | production | support | Grants |
|---|:-:|:-:|:-:|:-:|:-:|---|
| `orders.view` | ✓ | ✓ | ✓ | ✓ | ✓ | Admin order list/board/detail, timeline incl. internal entries, `orders.{id}` and `orders.{id}.internal` channels, quote PDFs, item design viewer, cut-list CSV/PDF exports (08 §8) |
| `orders.review` | ✓ | ✓ | ✓ | | | T4; edit item quantity/staff notes in `in_review` |
| `orders.assign` | ✓ | ✓ | ✓ | | | Assign/reassign estimator; set production assignee |
| `orders.propose_changes` | ✓ | ✓ | ✓ | | | Create/edit/send/withdraw proposals (T6, T8), add/remove proposal items, edit proposal item design drafts (`PUT /api/change-proposal-items/{item}/draft`, proposal builder page) |
| `quotes.create` | ✓ | ✓ | ✓ | | | Create/edit quote drafts |
| `quotes.send` | ✓ | ✓ | ✓ | | | T9, T12, T13 |
| `quotes.view_costs` | ✓ | ✓ | ✓ | | | See `cost_snapshot`, margins, `internal_notes` |
| `orders.confirm` | ✓ | ✓ | ✓ | | ✓ | Log calls, T16, T17 |
| `orders.cancel` | ✓ | ✓ | ✓ | | | T18, T28 |
| `orders.hold` | ✓ | ✓ | ✓ | ✓ | | T26, T27 |
| `orders.close` | ✓ | ✓ | | | | T25, T31 |
| `production.manage` | ✓ | ✓ | | ✓ | | T19, T20, production updates, issues, delivery (schedule, T24) |
| `messages.post` | ✓ | ✓ | ✓ | ✓ | ✓ | Post messages and internal notes |
| `customers.view` | ✓ | ✓ | ✓ | ✓ | ✓ | Customer list/profile, their projects/plans/designs/imports (read-only), imports monitor incl. debug artifacts, notifications log |
| `customers.manage` | ✓ | ✓ | | | | Edit customer profile/contact, deactivate/reactivate, restore deleted (≤ 30 days), create projects on a customer's behalf |
| `catalog.manage` | ✓ | ✓ | | | | Materials, edge bands, hardware, finishes, labour rates, tax rates |
| `presets.manage` | ✓ | ✓ | ✓ | | | Furniture presets (incl. "save as preset") |
| `templates.manage` | ✓ | ✓ | | | | Enable/order templates, default overrides |
| `settings.manage` | ✓ | ✓ | | | | Settings groups `business` (except currency), `units`, `pricing`, `workflow`, `notifications` |
| `staff.manage` | ✓ | ✓ | | | | Invite, resend, revoke, change roles, deactivate, reset 2FA (non-owners) |
| `ai.manage` | ✓ | ✓ | | | | Grant/revoke customer credits, refund import credits, AI usage report (USD costs) and CSV export, AI credit ledger, free staff re-run and discard of a customer's import |
| `reports.view` | ✓ | ✓ | | | | Reports/dashboards with financial aggregates |
| `plans.edit_any` | ✓ | ✓ | ✓ | | | Edit customers' plans and unlocked designs; start imports on their behalf |
| `audit.view` | ✓ | ✓ | | | | Audit log page |

Production is read-only on quotes (customer-visible quote view via `orders.view`, no costs). Support edits nothing financial or design-related.

### 7.3 Owner-only gates (role check, defined in `AuthServiceProvider`)

`Gate::define('owner', fn (User $u) => $u->type === 'staff' && $u->is_active && $u->hasRole('owner'))` and these abilities, each implemented as `Gate::define($ability, fn (User $u) => Gate::forUser($u)->allows('owner'))`:

| Ability | Covers |
|---|---|
| `orders.cancel_late` | T30 (cancel `in_production`, `rework`, `completed`, `ready_for_delivery`, `delivered`) |
| `staff.manage_owners` | Invite with role owner; grant/revoke owner role; deactivate/reactivate/reset 2FA of an owner |
| `settings.change_currency` | Change `business.currency` (also blocked by settings UI once any quote exists — master §6.4) |
| `settings.manage_restricted` | Settings groups `ai` (provider, model, budgets, price table) and `auth` |
| `data.delete` | Immediate anonymisation of a customer (§9.3), hard delete of a customer's projects/imports, purge actions |

No blanket `Gate::before` for owners (an owner must not pass customer-ownership checks such as accepting a quote). `Gate::before(fn (User $u) => ($u->type === 'staff' && ! $u->is_active) ? false : null)` denies everything to inactive staff.

Admin restrictions: admins cannot grant/revoke `owner`, cannot change their own role, cannot deactivate themselves. Any role change for the last active owner is rejected (`staff.last_owner`). Each staff user has exactly one role (UI uses a single select; `syncRoles([$role])`).

### 7.4 Exposure to the frontend

Shared prop `auth.user` (01 §6) includes `roles: string[]`, `permissions: string[]` (spatie `getAllPermissions()->pluck('name')`) and `abilities: string[]` (the owner gates the user passes). The frontend only hides/disables UI; every request is authorised server-side.

---

## 8. Policies (`app/Policies`, auto-discovered)

Notation: **own** = the authenticated user is the customer who owns the record (`projects.owner_id`, `orders.customer_id`, …); **S[p]** = staff with permission `p`. State checks for order transitions are enforced by the state machine (09 → 409 `invalid_transition`), not by policies; policies answer "may this user attempt it". A policy denial returns 403 (`Response::deny`); locks return 423 via `Response::denyWithStatus(423)`. Non-owners of customer records get **404** instead of 403 on direct URL access (implemented with `Response::denyAsNotFound()`) to avoid revealing existence.

### 8.1 `ProjectPolicy`

| Ability | Rule |
|---|---|
| `viewAny` | customer (own list) or S[`customers.view`] |
| `view` | own, or S[`customers.view`] |
| `create` | customer; staff creating for a customer: S[`customers.manage`] (`owner_id` = that customer) |
| `update` / `archive` / `restore` | own, or S[`customers.manage`] |
| `delete` | own and the project has no orders except never-submitted drafts (else 422 `project_has_orders`); staff only via `data.delete` |

### 8.2 `PlanPolicy`

| Ability | Rule |
|---|---|
| `view` / `export` | `ProjectPolicy::view` on its project |
| `create` / `duplicate` | own project, or S[`plans.edit_any`] |
| `update` (working copy, revisions, restore) | own project, or S[`plans.edit_any`] (staff saves create the `staff_edit` revision per `03 §5`) |
| `delete` | own project only |
| `lock` / `unlock` | S[`plans.edit_any`] (`api.plans.lock.store` / `api.plans.lock.destroy`; audit `plan.locked` / `plan.unlocked`) |

While `plans.locked_at` is set, `update` still authorises but the save/restore/checkpoint actions return **423** `{code: 'locked', reason: 'plan_locked', lockedBy, lockedAt}` (03 §5) for everyone, including staff, until the plan is unlocked.

### 8.3 `FurnitureDesignPolicy`

| Ability | Rule |
|---|---|
| `view` | own, or S[`customers.view`] or S[`orders.view`] |
| `create` | own project, or S[`plans.edit_any`] |
| `update` (working copy, revisions, restore) | (own or S[`plans.edit_any`]) AND `locked_by_order_id` null — else **423** `locked` (03 §5) |
| `duplicate` | `view` AND (own or S[`plans.edit_any`]) |
| `delete` | own AND not locked AND not referenced by any `order_items` (else 422 `design_in_order`) |
| `saveAsPreset` | S[`presets.manage`] |

Staff edits of locked designs happen **only** through `ChangeProposalPolicy::updateItemDraft`.

### 8.4 `BlueprintImportPolicy`

| Ability | Rule |
|---|---|
| `create` | own project AND (mode `trace` OR contact verified), or S[`plans.edit_any`] |
| `view` | `user_id` = user, or own project, or S[`customers.view`] |
| `viewDebug` (media `debug`, `error_message`, `result_meta` timings) | S[`customers.view`] |
| `update` (options, review document) / `cancel` / `retry` / `accept` / `convertToTrace` | `user_id` = user or own project, or S[`plans.edit_any`] |
| `discard` | `user_id` = user or own project, or S[`ai.manage`] |
| `rerun` | `user_id` = user or own project (charged), or S[`ai.manage`] (free when `ai.staff_unlimited`, 06 §11.7) |
| `refund` | S[`ai.manage`] (18 §9.5) |

### 8.5 `OrderPolicy`

| Ability | Rule |
|---|---|
| `viewAny` | S[`orders.view`] (customers use their own scoped list) |
| `view` | own (`customer_id`), or S[`orders.view`] |
| `viewInternal` (internal notes, internal updates, calls, cost data via quotes) | S[`orders.view`] |
| `create` (T1), `updateDraftItems`, `deleteDraft`, `submit` (T2, + `verified.contact`), `cancelDraft` (T3), `reopen` (T5), `acceptQuote` (T10), `negotiate` (T11), `declineQuote` (T14), `approveCompletion` (T21), `reportIssue` (T22), `withdraw` (T29), `requestCallback` | own |
| `review` (T4), `editItems` | S[`orders.review`] |
| `assign` | S[`orders.assign`] |
| `proposeChanges` / `withdrawProposal` (T6, T8) | S[`orders.propose_changes`] |
| `createQuote` | S[`quotes.create`] |
| `sendQuote` / `answerNegotiation` (T9, T12, T13) | S[`quotes.send`] |
| `logCall` / `confirm` / `reopenAfterCall` (T16, T17) | S[`orders.confirm`] |
| `cancel` (T18, T28) | S[`orders.cancel`] |
| `cancelLate` (T30) | gate `orders.cancel_late` |
| `hold` / `resume` (T26, T27) | S[`orders.hold`] |
| `manageProduction` (T19, T20, updates, resolve issues, schedule delivery, T24) | S[`production.manage`] |
| `close` / `raiseIssueOnBehalf` (T25, T31) | S[`orders.close`] |

### 8.6 `QuotePolicy`

| Ability | Rule |
|---|---|
| `view` / `downloadPdf` | (own order AND `status ≠ draft`) or S[`orders.view`] |
| `viewCosts` | S[`quotes.view_costs`] |
| `create` / `update` / `delete` (draft only) | S[`quotes.create`] |
| `send` | S[`quotes.send`] |
| `accept` / `negotiate` / `decline` | own order |

Customer-facing serialisation (`QuoteData` customer variant) never includes `cost_snapshot`, `internal_notes`, or hidden lines' breakdown (`is_visible_to_customer = false` lines are folded per `08 §6`).

### 8.7 `ChangeProposalPolicy`

| Ability | Rule |
|---|---|
| `view` | (own order AND `status ≠ draft`) or S[`orders.view`] |
| `create` / `update` / `send` / `withdraw` / `addItem` / `removeItem` / `updateItemDraft` | S[`orders.propose_changes`] |
| `decide` (T7) | own order |

### 8.8 `MessagePolicy`

| Ability | Rule |
|---|---|
| `viewThread` | own order (messages with `kind = internal_note` filtered out server-side) or S[`orders.view`] |
| `create` (text) | (own order AND `verified.contact`) or S[`messages.post`]; denied for orders `cancelled`/`closed` more than 90 days ago (09) → 422 `thread_closed` |
| `createInternalNote` | S[`messages.post`] |
| `update` / `delete` | author AND `kind = text` AND `created_at > now() - 10 min` (delete = soft delete, rendered "Message deleted") |

### 8.9 Media access (`MediaController@show`, route `media.show`, `GET /media/{media:uuid}?conversion=`)

Auth required. Resolve `$media->model` and authorise by model + collection; unknown combination → 404.

| Model / collection | Rule |
|---|---|
| `Plan.thumbnail` | `PlanPolicy::view` |
| `BlueprintImport.source`, `.normalized`, `.pages` | `BlueprintImportPolicy::view` |
| `FurnitureRevision.cutlist_pdf` | S[`orders.view`] |
| `BlueprintImport.debug` | `viewDebug` |
| `FurnitureDesign.thumbnail` | `FurnitureDesignPolicy::view` |
| `Quote.pdf` | `QuotePolicy::downloadPdf` |
| `ProductionUpdate.photos` | `OrderPolicy::view` AND (`visibility = customer` OR `viewInternal`) |
| `OrderIssue.photos`, `Delivery.photos` | `OrderPolicy::view` |
| `Message.attachments` | `MessagePolicy::viewThread` AND (message not `internal_note` OR staff) |
| public-disk collections (`User.avatar`, `Project.cover`, `Material/Finish.texture`, `HardwareItem.image`, `FurniturePreset.thumbnail`, `BusinessProfile.logo`) | not served by this route (public URLs) |

Response: `302` to `$media->getTemporaryUrl(now()->addMinutes(15), $conversion ?? '', $headers)`; for PDFs and any non-image file `$headers = ['ResponseContentDisposition' => 'attachment; filename="'.$safeName.'"', 'ResponseContentType' => $media->mime_type]`; images `inline`. `Cache-Control: private, no-store` on the redirect. Inertia pages may embed temporary URLs directly when the controller has already authorised the parent model (galleries), generated per request with the same 15-minute expiry.

### 8.10 Broadcast channels (`routes/channels.php`)

| Channel | Authorisation |
|---|---|
| `users.{userId}` | `$user->id === $userId` |
| `orders.{orderId}` | `OrderPolicy::view` — **customer-safe payloads only** |
| `orders.{orderId}.internal` | `OrderPolicy::viewInternal` — internal notes, internal production updates, call logs |
| `imports.{importId}` | `BlueprintImportPolicy::view` (uploader, project owner, or staff with `customers.view`) |
| `furniture-designs.{designId}` | `FurnitureDesignPolicy::view` |
| `staff` | `$user->type === 'staff' && $user->can('orders.view')` |

`/broadcasting/auth` uses the `web` + `auth` + `active` + `throttle:broadcasting-auth` middleware. Reverb `allowed_origins` = `[parse_url(APP_URL, PHP_URL_HOST)]`.

---

## 9. Account deletion, anonymisation, data export

### 9.1 Customer requests deletion

Page `customer.account.delete` (`recent.auth`): explanation, list of what is kept (orders/quotes for accounting, anonymised) and deleted, input requiring the user to type the translated word for "DELETE", button. `DELETE /account` (`customer.account.destroy`) → `App\Domain\Identity\Actions\RequestAccountDeletion`:

1. If the customer has any order in an **Active** state (09 §1: not `draft`, `closed`, `cancelled`) → 422 `account.errors.active_orders` with the order numbers ("Finish or cancel these orders first").
2. Transaction:
   1. Hard-delete never-submitted draft orders (`DeleteDraftOrder`); cancel previously submitted `draft` orders via T3 (actor = the customer, `cancel_reason = customer_withdrew`).
   2. Cancel non-terminal blueprint imports (`CancelImport`, refunds per `18`).
   3. Send `account.deletion_scheduled` (12) **before** the soft delete, with `date = now()+30d`.
   4. `users.deleted_at = now()` (soft delete). Delete `push_subscriptions`.
   5. Destroy all sessions (registry) and rotate `remember_token`.
3. Audit `account.deletion_requested`. Logout, `Inertia::clearHistory()`, redirect to the public page `account.deletion-scheduled` (GET `/account-deleted`, page `Auth/AccountDeletionScheduled`, AuthLayout; shows the anonymisation date and the support email).

Restore within 30 days: staff with `customers.manage` (`admin.customers.restore`) → `restore()`; audit `account.deletion_cancelled`. The customer cannot log in while soft-deleted (default scope; OTP/Google show `account_pending_deletion`).

Staff accounts cannot self-delete; they are deactivated (§5.9).

### 9.2 Anonymisation (`users:anonymise-deleted`, daily 03:15)

For each `users` row with `type = customer`, `deleted_at <= now() - 30 days`, `anonymised_at IS NULL` (chunked, one transaction per user, `App\Domain\Identity\Actions\AnonymiseUser`):

| Data | Action |
|---|---|
| `users.name` | `Deleted customer {last 6 chars of id}` |
| `users.email` | `deleted+{id}@invalid.invalid` (keeps the CHECK constraint satisfied; RFC 2606 reserved TLD) |
| `users.phone_e164`, `phone_verified_at`, `email_verified_at`, `password`, `google_id`, `remember_token`, `two_factor_*`, `notes_internal`, `last_login_at` | null |
| `users.marketing_opt_in` | false; `anonymised_at = now()` |
| Avatar media | deleted |
| `addresses` not referenced by any order | deleted |
| `addresses` referenced by orders | `label`, `line1` → `[removed]`, `line2`, `latitude`, `longitude` → null; `city`, `region`, `postal_code`, `country_code` kept (tax/invoice jurisdiction) |
| Projects with no orders | hard-deleted (cascades plans, revisions, designs, imports; media files deleted by medialibrary) |
| Projects with orders | kept (designs pinned by orders are business records) but `projects.name` → `Project {last 6 of id}`, `notes` → null; their plans are hard-deleted (home layout is personal data not needed for accounting) and `blueprint_imports` + media deleted |
| `notifications`, `notification_preferences`, `otp_codes` (by phone), `push_subscriptions` | deleted |
| `notification_deliveries` | `user_id` → null (rows already masked) |
| Orders, quotes, quote lines, negotiations, proposals, production updates, issues, deliveries, messages, AI ledger, activity log | **kept** (accounting, warranty, dispute evidence); they reference the anonymised user |
| `confirmation_calls.phone_e164` (not nullable) | masked in place: keep the country calling code, replace all remaining digits with `0` (e.g. `+910000000000`) |
| `quotes.accepted_by_ip` | set to the /24 network (IPv4) or /48 (IPv6) |

Audit `account.anonymised` (causer null, `via: scheduler`). Owner immediate anonymisation (`data.delete`, `admin.customers.anonymise`) runs the same action without the 30-day wait, still refusing when Active orders exist.

### 9.3 Data export (v1: yes)

`GET /account/export` (`customer.account.export`; middleware `recent.auth`, `verified.contact`, limiter `data-export` 3/day) → `response()->streamDownload()` of `{app-slug}-export-{Y-m-d}.json` (`Content-Type: application/json`), written incrementally with lazy cursors (bounded memory). Contents (version `1`): `profile` (all user columns except password, tokens, 2FA secrets, `notes_internal`), `addresses`, `notificationPreferences`, `projects[]` → `plans[]` (working document + revision list without documents) and `furnitureDesigns[]` (working document), `imports[]` (metadata only), `orders[]` with items, non-draft quotes + visible lines, sent proposals + items, negotiations, messages (excluding internal notes), customer-visible production updates, issues, delivery, `aiCreditLedger[]`, `media[]` (collection, file name, size, created_at — files themselves are not embedded; the page explains they can be downloaded from the app or requested from support). Audit `account.data_exported`.

---

## 10. Rate limiting

Named limiters in `App\Providers\RateLimitServiceProvider::boot()` (`RateLimiter::for(...)`), Redis-backed (`CACHE_STORE=redis`). IPs come from the trusted-proxy-resolved `$request->ip()` (§12.8).

| Name | Limits (all apply) | Key | Used by |
|---|---|---|---|
| `login` | 5/min | `lower(email)|ip` | Fortify login |
| | 30/min | ip | |
| `two-factor` | 5/min | `session('login.id')` | Fortify 2FA challenge |
| `register` | 5/hour | ip | `POST /register`, OTP complete |
| `password-reset` | 3/hour | `lower(email)` | `POST /forgot-password` |
| | 10/hour | ip | |
| `verification-resend` | 3 per 10 min | user id | `POST /email/verification-notification` |
| `otp-send` | 5/hour | phone | `auth.otp.send`, `auth.otp.resend`, `account.phone.send` |
| | 10/hour | ip | |
| `otp-cooldown` | 1 per 60 s | phone | same (separate limiter checked first) |
| `otp-verify` | 10/min | ip | `auth.otp.verify`, `account.phone.verify` |
| | 20/hour | phone | |
| `oauth` | 20/min | ip | Google redirect/callback |
| `uploads-presign` | 30/min and 300/day | user id | `POST /api/uploads/presign` (all purposes, including `blueprint_source`) |
| `uploads-confirm` | 60/min | user id | `POST /api/uploads/{upload}/confirm` |
| `imports-start` | 10/hour | user id | `api.imports.start`, `api.imports.rerun` (plus `ai.max_recognitions_per_day` enforced in the action, 18 §11.1) |
| `ai-provider-test` | 10/min | user id | `admin.settings.ai.test` |
| `thumbnails` | 6/min | user id | `api.plans.thumbnail.store`, `api.projects.cover.store`, `api.furniture-designs.thumbnail.store` |
| `test-push` | 3/min | user id | `customer.account.notifications.test-push`, `admin.account.notifications.test-push` |
| `messages-post` | 20/min and 300/day | user id | post message / internal note |
| `autosave` | 60/min | `user id|document type|document id` | `PUT …/working-copy`, `PUT …/draft` (03 §5) |
| `api` | 120/min | user id (guests: ip, 60/min) | all `/api/*` routes not listed |
| `exports` | 20/hour | user id | server-rendered PDFs (cut list, plan sheet) |
| `data-export` | 3/day | user id | `customer.account.export` |
| `invitations` | 20/day | user id | invite/resend |
| `broadcasting-auth` | 120/min | user id | `/broadcasting/auth` |
| `webhooks` | 600/min | ip | `/webhooks/*` |
| `client-errors` | 10/min | ip | `POST /api/client-errors` |
| `csp-report` | 30/min | ip | `POST /csp-report` |

Exceeded → `ThrottleRequestsException` rendered in `bootstrap/app.php`: JSON/XHR requests → `429 {code:'rate_limited', retryAfter: int}` + `Retry-After` header; Inertia page requests → redirect back with flash `errors.rate_limited` (toast with seconds). OTP-specific 429s use `otp_cooldown` / `otp_rate_limited` codes. Limits are constants in `config/security.php` (`rate_limits` array) so tests can read them.

---

## 11. Upload security

### 11.1 Purposes and limits

Enum `App\Domain\Shared\Enums\UploadPurpose` (limits from 02 §10). The enum has exactly these **14** values (the list is exhaustive; every browser upload in the system uses one of them):

| Purpose | Target collection (02 §10) | Authorisation target (`target`) and check at presign | Accepted (sniffed) types | Max bytes | Re-encode | Consumed by |
|---|---|---|---|---|---|---|
| `blueprint_source` | `BlueprintImport.source` | project → `BlueprintImportPolicy::create` (trace semantics; the contact-verification rule for auto mode is enforced at `api.imports.start`) | jpeg, png, webp, heic, pdf, dxf | 25 MB (dxf 15 MB) | **no** (vision needs the original) | `api.imports.store` (06 §4.4) |
| `message_attachment` | `Message.attachments` | order → `MessagePolicy::create` | jpeg, png, webp, pdf | 15 MB | images yes; pdf no | `customer.orders.messages.store`, `admin.orders.messages.store` |
| `production_photo` | `ProductionUpdate.photos` | order → `OrderPolicy::manageProduction` | jpeg, png, webp, heic | 15 MB | yes (heic → jpeg) | `admin.orders.production-updates.store`, `admin.orders.complete` |
| `issue_photo` | `OrderIssue.photos` | order → `OrderPolicy::reportIssue` (customer) or `raiseIssueOnBehalf` (staff) | jpeg, png, webp, heic | 15 MB | yes (heic → jpeg) | `customer.orders.issues.store`, `admin.orders.issues.store` |
| `delivery_photo` | `Delivery.photos` | order → `OrderPolicy::manageProduction` | jpeg, png, webp, heic | 15 MB | yes (heic → jpeg) | `admin.orders.deliver` |
| `avatar` | `User.avatar` | none (own account) | jpeg, png, webp | 5 MB | yes, max 512 px | `customer.account.avatar.update`, `admin.account.avatar.update` |
| `business_logo` | `BusinessProfile.logo` | none → S[`settings.manage`] | png, webp, jpeg | 2 MB | yes, max 1024 px | `admin.settings.business.update` |
| `material_texture` | `Material.texture` | none → S[`catalog.manage`] | jpeg, webp | 4 MB | yes, square, resized to 1024² | `admin.catalog.materials.store/update` |
| `finish_texture` | `Finish.texture` | none → S[`catalog.manage`] | jpeg, webp | 4 MB | yes, square, resized to 1024² | `admin.catalog.finishes.store/update` |
| `hardware_image` | `HardwareItem.image` | none → S[`catalog.manage`] | jpeg, png, webp | 4 MB | yes, max 1600 px | `admin.catalog.hardware.store/update` |
| `plan_thumbnail` | `Plan.thumbnail` | plan → `PlanPolicy::update` | png | 5 MB | yes | `api.plans.thumbnail.store` |
| `project_cover` | `Project.cover` | project → `ProjectPolicy::update` | png, webp | 5 MB | yes | `api.projects.cover.store` |
| `furniture_thumbnail` | `FurnitureDesign.thumbnail` | furniture design → `FurnitureDesignPolicy::update` | png | 5 MB | yes | `api.furniture-designs.thumbnail.store` |
| `preset_thumbnail` | `FurniturePreset.thumbnail` | preset → S[`presets.manage`] | png | 5 MB | yes | `api.presets.document.update`, `admin.furniture.save-as-preset` |

Server-generated files (quote PDFs, cut-list PDFs, normalized import images, debug artifacts, import page thumbnails) are **not** uploads and never use upload intents. In particular, the **vision service file exchange** (presigned GET of the source and presigned PUTs of the normalized image and debug artifacts, 06 §4.7, 15-minute expiry) uses server-side presigned URLs created by `RunBlueprintRecognition` / `PrepareImportPreview` for the vision service only; these are not upload intents and are never handed to browsers.

**SVG, GIF, TIFF, BMP, HTML, XML, Office documents, archives and executables are never accepted** (SVG can carry script; others are unnecessary).

### 11.2 Presign

`POST /api/uploads/presign` (`api.uploads.presign`, limiter `uploads-presign`) `{purpose, filename, size, contentType, target: {type, id}|null}` → `App\Domain\Shared\Actions\CreateUploadIntent`:
1. Authorise the target per the table in §11.1.
2. Validate `contentType` ∈ purpose allowlist (declared), `1 ≤ size ≤ max`. For `blueprint_source` additionally: extension ∈ 06 §2.1 list (`.dwg` → 422 `dwg_not_supported`; other → 422 `unsupported_type`); `application/octet-stream`/`text/plain` accepted only with the matching `.dxf`/`.heic` extension; size limit by extension kind (DXF 15 MB) → 422 `file_too_large`.
3. Insert `upload_intents` (`object_key = tmp/{purpose}/{Y}/{m}/{ulid}`, `expires_at = now()+15min`, `status = pending`).
4. `Storage::disk('s3')->temporaryUploadUrl($key, now()->addMinutes(15), ['ContentType' => $contentType, 'ContentLength' => $size])` → returns `{url, headers}`; respond `{uploadId, url, headers}`.

**Size/type enforcement note**: `content-length-range` is a condition of S3 *POST policies*; Cloudflare R2 does not support POST policy uploads. Furny therefore uses **presigned PUT with `Content-Type` and `Content-Length` included in the signed headers** — the storage service rejects (403 `SignatureDoesNotMatch`) any PUT whose type or exact byte length differs from what the server approved. The browser must send exactly the returned `headers` (the client sets `Content-Type`; the browser sets `Content-Length` from the body).

### 11.3 Confirm & processing

`POST /api/uploads/{upload}/confirm` (`api.uploads.confirm`, limiter `uploads-confirm`): owner of the intent, `status = pending`, not expired → `HeadObject`: must exist and `ContentLength === declared size ≤ max` (else delete object, `status = rejected`, 422 `upload_size_mismatch`) → `status = uploaded`, dispatch `ProcessUpload` (queue `default`, timeout 60 s, tries 2), respond `202 {uploadId, status: 'processing'}`. The client polls `GET /api/uploads/{upload}` (`api.uploads.show`) every 1 s (max 60 s) until `ready` or `rejected` (`{status, reasonCode, previewUrl?}`).

`ProcessUpload`:
1. Stream the object to a temp file (`storage/app/tmp/{ulid}`; deleted in `finally`).
2. **Magic-byte sniffing** (`App\Support\Uploads\MagicBytes::detect(string $path): ?string`) on the first 64 bytes:
   - JPEG `FF D8 FF`; PNG `89 50 4E 47 0D 0A 1A 0A`; WebP `RIFF????WEBP`; HEIC/HEIF bytes 4–11 `ftypheic|ftypheix|ftyphevc|ftypheim|ftypheis|ftypmif1|ftypmsf1`; PDF `%PDF-` within the first 1024 bytes; DXF ASCII: first non-blank lines `0` then `SECTION`, or binary sentinel `AutoCAD Binary DXF\r\n\x1a\x00`; DWG magic `AC10…`/`AC1012`…`AC1032` → `rejected` with `reason_code = dwg_not_supported` (06 §2.1).
   - Additionally `finfo(FILEINFO_MIME_TYPE)` must agree for jpeg/png/webp/pdf.
   - Sniffed type must be in the purpose allowlist and in the same family as the declared type → else `rejected` (`upload_type_not_allowed` / `upload_type_mismatch`).
3. Images (except `blueprint_source`): `getimagesize()` → width × height ≤ 40 MP and each side ≤ 12 000 px (decompression-bomb guard) → else `upload_image_too_large`. Then `App\Support\Uploads\ImageSanitizer::sanitize($path, $type, $maxEdge)`:
   - JPEG: read EXIF `Orientation` with `exif_read_data`; decode with GD; **apply the orientation to the pixels** (rotate/flip) so photos stay upright everywhere; re-encode progressive JPEG quality 85.
   - PNG: decode, preserve alpha, re-encode (compression 6). WebP: decode, re-encode quality 85 (animated WebP: first frame only).
   - HEIC (photos): `POST {VISION_SERVICE_URL}/v1/images/normalize` with bearer token, body `{sourceUrl: presigned GET 15 min, targetUrl: presigned PUT 15 min, format: 'jpeg', quality: 85, maxEdge: 4096, applyOrientation: true}` (Pillow + pi-heif in vision, 06 §5.8; these are server-side vision presigns, not upload intents) → then run the JPEG path on the result.
   - Downscale to the purpose's max edge (photos 4096 px).
   - Re-encoding with GD writes **no metadata**: EXIF (incl. GPS), XMP, IPTC, ICC and comments are all stripped. A test asserts no `GPS` EXIF tag remains.
4. PDF (`message_attachment`): not parsed, rendered, or re-encoded by the app (the app has no PDF parser; only the vision service parses PDFs, and only for blueprint imports). Stored as-is and only ever served from the storage origin with `Content-Disposition: attachment`.
5. `blueprint_source`: steps 1–2 only (magic bytes vs declared, size, DWG detection); everything else is the vision service's job (06). The processed copy keeps the original bytes.
6. Upload the processed file to `uploads/{purpose}/{Y}/{m}/{ulid}.{ext}` (extension from the **sniffed** type), delete the tmp object, `status = ready`, `processed_key`, `sniffed_mime`, `width`, `height`.
7. The consuming Action (e.g. `PostMessage` with `uploadIds[]`) verifies each intent belongs to the user, is `ready`, matches the purpose (and, when the intent has a target, the same target), and not yet consumed — otherwise 422 `{code: 'upload_invalid', uploadId}`; then `addMediaFromDisk($processedKey, 's3')->usingName($displayName)->usingFileName(basename($processedKey))->toMediaCollection(...)`; marks the intent `consumed`.

### 11.4 Filename sanitisation (`App\Support\Uploads\FileName::sanitize(string $name): string`)

Display name only — object keys never use user input. Steps: Unicode NFC normalise; take `basename` after replacing `\` with `/`; remove control characters (`\p{C}`); replace any char not in `[\p{L}\p{N} ._()-]` with `_`; collapse runs of `_`/spaces; trim dots/spaces from both ends; if empty → `file`; truncate the stem so the whole name ≤ 100 chars, keeping an extension that is replaced by the sniffed type's canonical extension.

### 11.5 Cleanup

`media:cleanup-orphans` (01 §7) also deletes `upload_intents` not `consumed` 24 h after creation (and their objects). S3 lifecycle rule on prefix `tmp/` expires objects after 2 days as a backstop.

### 11.6 Serving

Private files only via 15-minute signed URLs after a policy check (§8.9). Storage responses for non-images force `attachment`. The app origin never serves user-uploaded bytes, so even a malicious file cannot run script in the app origin.

### 11.7 Antivirus decision

**No ClamAV in v1.** Rationale: (1) all served images are decoded and re-encoded (embedded payloads do not survive); (2) PDFs/DXF are never executed or parsed by the app — only by the isolated, non-internet-exposed vision container for imports; (3) files are served from a separate origin as downloads; (4) ClamAV needs ~1–1.5 GB RAM for signatures plus a daemon and updates — significant for a single Coolify server. Revisit if Office documents or archives are ever accepted.

---

## 12. HTTP & transport security

### 12.1 Security headers middleware

`App\Http\Middleware\SecurityHeaders` (appended to the `web` group; also applied to error pages). **Header ownership:** this middleware sets every security header on responses produced by Laravel (CSP, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, `X-Content-Type-Options`, HSTS, and `X-Robots-Tag: noindex, nofollow` when `APP_ENV ≠ production`); nginx (17 §5.2) adds only `X-Content-Type-Options` and HSTS for the static files it serves itself (`/build/*`, `/sw.js`, other files under `public/`). Per request it creates a nonce (`base64_encode(random_bytes(16))`), calls `Vite::useCspNonce($nonce)` (so `@vite` tags carry it), shares it with Blade (`csp_nonce`) for the Turnstile script tag, and sets on HTML responses:

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'nonce-{NONCE}' 'strict-dynamic' https://challenges.cloudflare.com;
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob: {S3_PRIVATE_ORIGIN} {S3_PUBLIC_ORIGIN};
  media-src 'self' blob: {S3_PRIVATE_ORIGIN};
  font-src 'self' data:;
  connect-src 'self' wss://{REVERB_HOST} https://{REVERB_HOST} {S3_PRIVATE_ORIGIN} {S3_PUBLIC_ORIGIN} https://challenges.cloudflare.com blob:;
  worker-src 'self' blob:;
  frame-src https://challenges.cloudflare.com;
  frame-ancestors 'none';
  form-action 'self' https://accounts.google.com;
  base-uri 'self';
  object-src 'none';
  manifest-src 'self';
  upgrade-insecure-requests;
  report-uri /csp-report
```

- `{S3_PRIVATE_ORIGIN}` = scheme+host of presigned URLs (`AWS_ENDPOINT` with bucket host style, or `AWS_URL`), `{S3_PUBLIC_ORIGIN}` = origin of the `s3-public` disk URL; both computed once in `config/security.php`.
- `blob:` is required for Web Workers created from blobs in dev, three.js textures/GLB exports via object URLs and image previews before upload.
- `style-src 'unsafe-inline'`: chosen because reka-ui/vue-sonner and Vue may inject `<style>`/style attributes; CSS injection is far lower risk than script, and script is nonce-locked. No `unsafe-eval` (Vue runtime-only build; no template compilation in the browser). Fonts are self-hosted (no third-party font origins).
- Local dev (`app()->isLocal()` and Vite hot file present): add the Vite dev server origin and its `ws://` origin to `script-src`/`connect-src`/`style-src`.
- `CSP_REPORT_ONLY` env (default `false`): when true, sends `Content-Security-Policy-Report-Only` instead. Production rollout: report-only for the first 7 days, then enforce. `POST /csp-report` (CSRF-exempt, limiter `csp-report`) logs to `Log::channel('security')` (truncated to 2 KB).

Other headers (all responses from Laravel):

| Header | Value |
|---|---|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` (production, secure requests only; no `preload` until the owner opts in) |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=(), fullscreen=(self)` (photo capture uses `<input type=file capture>`, which needs no permission) |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `X-Frame-Options` | `DENY` (legacy companion to `frame-ancestors`) |

`public/sw.js` responses add `Service-Worker-Allowed: /`. nginx (the `nginx.conf` static asset of `nixpacks.toml`, 17 §5.2) sets `server_tokens off`, `X-Content-Type-Options` and HSTS (`max-age=31536000; includeSubDomains` when the request arrived over HTTPS) for static assets; PHP `expose_php = Off`.

### 12.2 Cookies

Session cookie per §6.1 (`__Host-session`, Secure, HttpOnly, SameSite=Lax). Remember cookie inherits Secure/HttpOnly/SameSite. `XSRF-TOKEN` cookie: Secure, SameSite=Lax, **not** HttpOnly (read by the frontend to send `X-XSRF-TOKEN`). All cookies encrypted by `EncryptCookies` except `XSRF-TOKEN` per Laravel default and `appearance` (`light|dark|system`, set by the theme toggle, read by `app.blade.php` to avoid a theme flash; functional, not HttpOnly, Secure, 1 year, SameSite=Lax; listed in `encryptCookies(except: ['appearance'])`, 15 §11).

### 12.3 CSRF

Laravel CSRF middleware on every state-changing `web` request (including `/api/*` editor endpoints, which use the session). Exempt only `webhooks/*` (signature-verified, §14) and `csp-report`. The autosave `keepalive` fetch (03 §5) sends `X-XSRF-TOKEN`.

### 12.4 Inertia history encryption

`config/inertia.php` `'history' => ['encrypt' => true]` (all pages; harmless for guests). Call `Inertia::clearHistory()` on logout, account deletion, and session revocation of the current session — so back-button cache cannot reveal pages after logout on shared devices.

### 12.5 CORS

The app serves no cross-origin API: `config/cors.php` `paths => []`. Object storage CORS (applied by `17` runbook):

Private bucket (presigned PUT/GET from the browser):
```json
[{"AllowedOrigins": ["https://APP_HOST"], "AllowedMethods": ["PUT", "GET", "HEAD"],
  "AllowedHeaders": ["content-type"], "ExposeHeaders": ["ETag"], "MaxAgeSeconds": 3600}]
```
Public bucket (WebGL textures need CORS with `crossOrigin = 'anonymous'`):
```json
[{"AllowedOrigins": ["https://APP_HOST"], "AllowedMethods": ["GET", "HEAD"],
  "AllowedHeaders": ["*"], "MaxAgeSeconds": 86400}]
```

### 12.6 Markdown & output encoding

Message bodies are rendered server-side by `Str::markdown($body, ['html_input' => 'strip', 'allow_unsafe_links' => false, 'max_nesting_level' => 10])` plus a CommonMark extension adding `rel="nofollow noopener noreferrer" target="_blank"` to links; only this server-rendered HTML may be bound with `v-html` (lint rule `vue/no-v-html` enabled with this single allowed component `MessageBody.vue`). Everything else uses Vue's escaping.

### 12.7 Redirect safety

Post-login redirects use only same-origin paths (`url.intended` checked with `Str::startsWith($url, config('app.url'))` or a leading single `/`). `links.order` redirects only to named internal routes.

### 12.8 Trusted proxies (Coolify Traefik)

`bootstrap/app.php`: `$middleware->trustProxies(at: env('TRUSTED_PROXIES', '10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,127.0.0.1'), headers: Request::HEADER_X_FORWARDED_FOR | Request::HEADER_X_FORWARDED_HOST | Request::HEADER_X_FORWARDED_PORT | Request::HEADER_X_FORWARDED_PROTO)` — the Docker networks Traefik connects from. App containers are reachable only through Traefik. If Cloudflare proxies in front of Traefik, Traefik's `forwardedHeaders.trustedIPs` must list Cloudflare's IP ranges so `X-Forwarded-For` carries the real client IP (runbook in `17`); never trust `CF-Connecting-IP` in the app. `URL::forceScheme('https')` in production. A feature test asserts `$request->ip()` resolves to the client IP for a request with a trusted proxy and ignores spoofed headers from untrusted IPs.

### 12.9 Outbound

Gotenberg (internal, no auth): HTML for PDFs is rendered from escaped Blade; **all images (logo, thumbnails, photos) and fonts are embedded as data URIs** (17 §5.11), so Gotenberg never fetches a URL; it runs with `--chromium-disable-javascript=true` and `--chromium-allow-list=^file:///tmp/.*` (no network fetches from HTML; prevents SSRF). Vision service (internal only) is called with `Authorization: Bearer {VISION_SERVICE_TOKEN}`. `Http::preventStrayRequests()` in tests.

---

## 13. Signed URLs

| Use | Mechanism | Lifetime |
|---|---|---|
| Private media (S3) | `getTemporaryUrl` after policy check | 15 min |
| Presigned PUT uploads | `temporaryUploadUrl` with signed Content-Type/Length | 15 min |
| Vision file exchange (server-side presigns, not upload intents) | presigned GET/PUT (01 §9) | 15 min |
| Email verification | `URL::temporarySignedRoute('verification.verify')` | 60 min |
| Password reset | broker token (hashed in `password_reset_tokens`) | 60 min |
| Staff invitation | `URL::temporarySignedRoute('staff.invitations.show')` | 72 h |
| Mail unsubscribe | `URL::signedRoute('notifications.unsubscribe')` | no expiry (invalidated by `APP_KEY` rotation) |

All signed routes use Laravel's `signed` middleware (absolute signatures).

---

## 14. Webhook & service authentication

| Endpoint | Verification | Failure |
|---|---|---|
| `GET /webhooks/whatsapp` | `hash_equals(WHATSAPP_WEBHOOK_VERIFY_TOKEN, hub_verify_token)` and `hub_mode = subscribe` | 403 |
| `POST /webhooks/whatsapp` | `X-Hub-Signature-256` = `sha256=` + HMAC-SHA256(raw body, `WHATSAPP_APP_SECRET`), `hash_equals` | 403 + `security` log |
| `POST /webhooks/twilio/status` | `Twilio\Security\RequestValidator(TWILIO_AUTH_TOKEN)->validate(X-Twilio-Signature, fullUrl, POST params)` | 403 |
| `POST /webhooks/msg91/{token}` | `hash_equals(MSG91_WEBHOOK_TOKEN, $token)` (MSG91 DLRs are unsigned; the 32+ char secret path segment is the credential) | 403 |
| Vision service (inbound to vision) | FastAPI dependency: `secrets.compare_digest(header_token, VISION_SERVICE_TOKEN)`; vision has no public domain | 401 |
| Reverb | app key/secret (`REVERB_APP_KEY/SECRET`), private-channel auth via `/broadcasting/auth` | 403 |

Webhook routes live in `routes/webhooks.php` (stateless: no session, no cookies, no CSRF), are processed asynchronously (queue `notify`) after verification, return 200 quickly, and are idempotent (status updates never move backwards; 12 §7.9).

---

## 15. Secrets management & encryption at rest

- All secrets are **Coolify environment variables** marked as secret (not build-time where not needed); never committed; `.env.example` lists names with empty values (complete variable list: 17 §6). Secrets: `APP_KEY`, `APP_PREVIOUS_KEYS`, `DB_PASSWORD`, `REDIS_PASSWORD`, `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`, `VISION_SERVICE_TOKEN`, `REVERB_APP_SECRET`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `TWILIO_AUTH_TOKEN`, `MSG91_AUTH_KEY`, `MSG91_WEBHOOK_TOKEN`, `GOOGLE_CLIENT_SECRET`, `TURNSTILE_SECRET_KEY`, `VAPID_PRIVATE_KEY`, `POSTMARK_TOKEN` (and `RESEND_KEY` when used), `HEALTH_CHECK_TOKEN`, `OBJECT_BACKUP_B2_APP_KEY`, `SENTRY_*` DSNs, `SEED_OWNER_PASSWORD` (removed after first deploy). AI provider keys exist **only** in the vision service's environment (01).
- Least privilege: the app's storage key is scoped to the app's two buckets; the vision service has **no** storage credentials (presigned URLs only); the backup bucket uses separate credentials not present in the app container.
- `APP_KEY` rotation: generate new key, move old to `APP_PREVIOUS_KEYS` (Laravel decrypts with previous keys), redeploy; sessions are invalidated (acceptable); 2FA secrets and encrypted columns remain readable via previous keys and are re-encrypted lazily on next save; rotate `APP_PREVIOUS_KEYS` out after 90 days only after running `php artisan furny:reencrypt` (re-saves encrypted columns). Unsubscribe links signed with the old key break (acceptable).
- Encrypted columns: Fortify `two_factor_secret`, `two_factor_recovery_codes` (encrypted by Fortify). Settings: any settings Data property annotated `#[Encrypted]` is stored encrypted inside `app_settings.value` via a custom cast `App\Support\Settings\Casts\EncryptedStringCast` and redacted in audit logs; **v1 stores no secrets in settings** (all secrets are env), the mechanism exists for future use and is unit-tested. Sessions encrypted (`SESSION_ENCRYPT=true`).
- At rest: PostgreSQL volume and backup disks on encrypted volumes where the host provider supports it (runbook `17`); object storage server-side encryption (R2 encrypts all objects at rest by default; MinIO must be configured with SSE-S3/KMS).

---

## 16. PII handling & logging

PII inventory: `users` (name, email, phone, IPs in sessions), `addresses`, `otp_codes` (phone, IP), `confirmation_calls.phone_e164`, `quotes.accepted_by_ip`, messages (free text), photos and blueprints (home interiors/layouts), `notification_deliveries` (masked only).

Rules:
1. **Masking helpers** `App\Support\Privacy\Mask`: `email('asha.k@example.com')` → `a****k@e******.com`; `phone('+919876543210')` → `+91******3210`; `ip('203.0.113.45')` → `203.0.113.0` (IPv6 → /48). Used in logs, audit properties and admin delivery logs.
2. **Log redaction**: Monolog processor `App\Support\Logging\RedactPiiProcessor`, attached to every channel via `'tap' => [App\Support\Logging\TapRedaction::class]` in `config/logging.php`. It (a) replaces values of context keys matching `/(password|token|secret|code|otp|authorization|cookie|api[_-]?key|session)/i` with `[redacted]`; (b) masks email addresses and E.164-like phone numbers (`/\+?\d[\d\s-]{8,}\d/`) in messages and string context values; (c) truncates context strings to 2 000 chars.
3. Exceptions: `bootstrap/app.php` `dontFlash` includes `password`, `password_confirmation`, `current_password`, `code`, `cf_turnstile_response`. Request bodies are never logged.
4. Telescope only in local/staging with fake data; `Telescope::hideRequestParameters([...same keys...])`, `hideRequestHeaders(['authorization','cookie','x-xsrf-token'])`.
5. Pulse: `Pulse::user(fn ($u) => ['name' => $u->type === 'staff' ? $u->name : 'Customer …'.substr($u->id, -6), 'extra' => '', 'avatar' => null])` — no customer emails on the dashboard.
6. Never put PII in URLs (order **numbers** and ULIDs only), cache keys (use `to_hash`/ids), queue job names or broadcast channel names.
7. Customer data is visible to staff only via permission-checked admin pages; exports of customer lists are not provided in v1.
8. Retention: business records (orders, quotes, messages) kept indefinitely in v1 (accounting/warranty); personal data reduced by anonymisation (§9.2); `otp_codes` 24 h after expiry; notifications per 12; `notification_deliveries` 180 days; activity log 3 years (`config/activitylog.php` `delete_records_older_than_days = 1095`, `activitylog:clean` scheduled monthly on day 1 at 04:30).

---

## 17. Audit logging (spatie/laravel-activitylog)

Written in Actions/listeners via `activity($logName)->performedOn($subject)->causedBy($actor)->withProperties($props)->event($event)->log($event)`. Properties must contain **ids and masked values only**. The audit UI (`audit.view`) filters by log name, causer, subject type/id, event and date; there are no edit/delete routes.

| Log | Event | Subject | Causer | Properties |
|---|---|---|---|---|
| `security` | `auth.login` | user | user | `method` (password\|otp\|google\|remember), `ip` (masked), `ua` (summary) |
| `security` | `auth.login_failed` | — | — | `email` (masked), `ip` (masked) |
| `security` | `auth.logout` | user | user | — |
| `security` | `auth.otp_sent` | — | user or null | `phone` (masked), `channel`, `purpose`, `ip` (masked) |
| `security` | `auth.otp_locked` | — | — | `phone` (masked), `purpose` |
| `security` | `auth.password_changed` / `auth.password_reset` | user | user | — |
| `security` | `auth.2fa_enabled` / `auth.2fa_disabled` / `auth.recovery_code_used` | user | user | — |
| `security` | `auth.2fa_reset` | target user | staff (or null via console) | `via` |
| `security` | `auth.sessions_revoked` | user | user / staff | `count`, `reason` |
| `security` | `auth.google_linked` / `auth.google_unlinked` | user | user | — |
| `security` | `account.email_verified`, `account.email_changed`, `account.phone_verified` | user | user | masked `from`, `to` |
| `security` | `account.deletion_requested`, `account.deletion_cancelled`, `account.anonymised`, `account.data_exported` | user | user / staff / null | `via` |
| `staff` | `staff.invited`, `staff.invitation_resent`, `staff.invitation_revoked`, `staff.invitation_accepted` | invitation | staff / invitee | `email` (masked), `role` |
| `staff` | `staff.role_changed` | user | staff | `from`, `to` |
| `staff` | `staff.deactivated`, `staff.reactivated`, `customer.deactivated`, `customer.reactivated`, `customer.updated` | user | staff | changed field **names** |
| `settings` | `settings.updated` | `AppSetting` (key) | staff | `group`, `changes: {field: {from, to}}` with `#[Encrypted]`/PII fields as `[redacted]` |
| `catalog` | `catalog.created` / `updated` / `archived` | catalog model | staff | `code`, changed fields with from/to |
| `catalog` | `presets.*`, `templates.updated` | model | staff | changed fields |
| `orders` | every order event key in 09 §11 (state transitions and non-transition actions) | order | actor / null (system) | `from`, `to`, related ids (`quoteId`, `proposalId`, …), `total_minor` for quote events, `ip` (masked) for `quote.accepted` |
| `orders` | `order.design_staff_edit` (staff saves on customer plans/designs) | plan / design | staff | `version` |
| `ai` | `ai.credits_granted` / `ai.credits_revoked` / `ai.credits_refunded` | user (refund: the import) | staff | `delta`, `note` (refund: `importId`) |
| `ai` | `ai.settings_updated` | `AppSetting` (`ai`) | owner | changed fields (18 §15.2; in addition to `settings.updated`) |
| `orders` | `quote.draft_created`, `furniture.revision_bom_refreshed` (08 §6.1) | quote / revision | staff | `quoteId` / `revisionId`, `catalogVersion` |
| `projects` | `plan.locked` / `plan.unlocked` (05 §15.3) | plan | staff | — |
| `imports` | `imports.accepted` (06 §11.5) | import | user / staff | `importId`, `planId`, `target`, `providerUsed` |

Additionally, 403 responses on `admin.*` routes and webhook signature failures are written to `Log::channel('security')` (warning, rate-limited to 1 entry per user/IP per minute), not to the activity log.

---

## 18. Backups (requirements; mechanism in `17`)

1. PostgreSQL: daily full logical backup + retention 30 daily, 12 monthly; stored in a **dedicated** bucket at a different provider (Backblaze B2, 17 §1 O11) with credentials not present in app containers (Coolify's S3 storage credentials live only in Coolify).
2. **Encrypted at rest**: B2 server-side encryption (SSE-B2) is enabled as the default on both backup buckets (17 §7.4); dumps are produced by Coolify's managed backups, which cannot encrypt client-side, so client-side `age` encryption is not used in v1 (reconciliation decision D32, master §7).
3. Object storage: nightly `rclone sync` of both buckets into the versioned B2 bucket `furny-object-backups`, which keeps overwritten/deleted versions for 30 days (17 §12.3).
4. Restore test quarterly (documented in `17 §12.5`), including restoring a backup on a machine that is not the production server.
5. Redis is not backed up (sessions, cache, queues are reconstructible; failed jobs are in Postgres).

---

## 19. Dependency & vulnerability management

- Dependabot (`.github/dependabot.yml`): weekly for `composer`, `npm` (Dependabot's ecosystem name, which handles the project's Yarn 4 lockfile), `pip` (`/vision`), `github-actions`; minor/patch grouped per ecosystem; security updates immediately.
- CI gates: `composer audit --locked`, `yarn npm audit --environment production --severity high`, `pip-audit -r vision/requirements.txt` — fail on high/critical unless listed in `security/audit-allowlist.json` (`{id, reason, expires_on}`; expired entries fail CI).
- Patch SLA: critical 48 h, high 7 days, medium 30 days. Exact-pinned packages (01 §1) reviewed monthly.
- Base images (Gotenberg, Postgres, Redis) updated monthly via Coolify; Nixpacks PHP/Node versions per `17`.

---

## 20. Security testing checklist

Automated (Pest, `tests/Feature/Security/*`), all required:

1. **Authorization matrix**: a dataset over every admin route × each role (+ customer, guest) asserts allowed/denied per §7.2/§8; generated from `php artisan route:list --json` so new routes without a test fail CI (`tests/Feature/Security/RouteCoverageTest.php` requires every route to be in an allowlist map).
2. **IDOR**: customer A cannot view/update customer B's project, plan, design, import, order, quote, proposal, message, media (404).
3. **Locks**: saving a locked design → 423; staff working-copy save on locked design → 423; saving a locked plan → 423 `plan_locked`; proposal draft endpoint requires `orders.propose_changes`.
4. **Owner gates**: admin cannot T30, cannot grant owner, cannot change currency or `ai`/`auth` settings; last-owner protections.
5. **Login**: throttling after 5 attempts; inactive user message only after correct password; staff never receive remember cookie; session id changes on login (fixation).
6. **OTP**: 6 digits; expiry 10 min; 5 wrong attempts kill the code; cooldown 60 s; 5/phone/hour; 10/IP/hour; captcha required on 3rd send; disallowed country rejected; non-mobile rejected; new code expires old; code never appears in logs (log fake asserts) or queued payloads (`Queue::fake` asserts nothing queued); identical responses for existing/non-existing numbers; staff phone → `staff_use_email`.
7. **Google**: state mismatch rejected; unverified Google email rejected; links to existing account by verified email; pending invitation email does not create a customer; staff with 2FA is sent to the challenge.
8. **Invitation**: tampered/expired signature rejected; 72 h expiry; reuse after acceptance rejected; email already a customer → 422.
9. **2FA**: owner/admin redirected to enrolment until confirmed; disabling blocked; recovery code works once.
10. **Sessions**: absolute 12 h staff expiry; "sign out other devices" destroys other sessions and rotates remember token; password reset revokes sessions.
11. **Password reset**: generic response for unknown emails; token single-use; 60 min expiry.
12. **Uploads**: wrong magic bytes rejected; SVG rejected; size mismatch rejected; 50 MP image rejected; EXIF GPS stripped and orientation applied (fixture `tests/fixtures/uploads/exif-gps-rotated.jpg`); filename sanitisation cases (`../../etc/passwd`, RTL override `‮`, 300-char names, emoji).
13. **Headers**: CSP with a nonce matching `@vite` script tags; HSTS in production; `frame-ancestors 'none'`; cookie flags (`Secure`, `HttpOnly`, `SameSite=Lax`, `__Host-` prefix).
14. **CSRF**: POST without token → 419 on web/API routes; webhooks accept without token but require signatures.
15. **Webhooks**: valid/invalid signatures for WhatsApp, Twilio, MSG91 token.
16. **Media**: signed URL redirect only after policy; internal production photos hidden from customers; PDFs served as attachment.
17. **Markdown XSS**: `<script>`, `javascript:` links, `<img onerror>` in messages are neutralised.
18. **Trusted proxies**: spoofed `X-Forwarded-For` from an untrusted IP ignored.
19. **Rate limits**: each named limiter returns 429 with `Retry-After` at the documented threshold.
20. **Data export / deletion**: export excludes secrets and internal notes; deletion blocked with active orders; anonymisation job clears all PII columns listed in §9.2 and keeps orders.

Manual pre-release (owner/staging): OWASP ZAP baseline scan against staging (no high findings); verify CSP report-only logs are clean before enforcing; verify Meta/Twilio/MSG91 webhook URLs and secrets; confirm 2FA enrolled for all owners/admins; confirm backup decrypt/restore.

---

## 21. Acceptance criteria

1. Customers can register and sign in by email/password, phone OTP (WhatsApp first, SMS fallback) and Google; staff only by email/password (+2FA) or a linked Google account.
2. Owners and admins cannot use the admin area until TOTP 2FA is confirmed; they cannot disable it.
3. The role × permission matrix in §7.2 is seeded exactly and enforced by policies; the route coverage test passes.
4. OTP limits (§4.1) hold under automated tests; OTP plaintext never leaves the request process except to the provider.
5. Every uploaded image served to users has no EXIF/GPS metadata; no SVG or unexpected type is accepted.
6. Production responses carry the CSP, HSTS and cookie attributes in §12; webhooks reject bad signatures.
7. A customer can export their data and request deletion; 30 days later their PII is gone while their orders remain with an anonymised name.
8. All events in §17 appear in the audit log with masked PII.

---

_Appendix merged into the target documents during reconciliation (see 19-reconciliation-log.md)._
