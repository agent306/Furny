# Task 25 review: Fortify login and registration, Turnstile (71d383a..04a4912)

Reviewed in one pass from the diff file (all hunks complete; no changed file had to be re-read except for line numbers).
Controller rulings (accepted and queued) were not re-flagged.

### Spec Compliance

- ❌ Issues found:
  - `app/Actions/Fortify/AuthenticateUser.php:21,33,62`: the "no enumeration" property of 13 §2 step 3 does not hold under php-fpm (17 O2). Details under Important 1.
  - `resources/js/pages/Auth/Login.vue:49`, `resources/js/pages/Auth/Register.vue:62-67`: 15 §10.1 requires focus to move to the first invalid field after submit. Neither page does this. Details under Important 2.
- ✅ Everything else in the brief has its hunk and matches the spec:
  - `config/fortify.php` matches 13 §2 exactly (FortifyConfigTest).
  - The pipeline matches 13 §2: the conditional `EnsureLoginIsNotThrottled` is left out because `limiters.login` is set.
  - All three responses, `IntendedRedirect`, `TurnstileToken`, the four listeners, `CustomerRegistered`, `ContactVerified`, `SendWelcomeNotification` and `Welcome` are present.
  - `Password::defaults` matches 13 §2 (`AppServiceProvider.php`).
  - The lang keys match 12 §3.7 and 13 §5.1.
  - `route-access.php` is updated.
  - Every listed test file is present.
- ⚠️ Cannot verify from the diff:
  - After registering, the user lands on `customer.dashboard`. `EnsureCustomerOnboarded` then sends them to `customer.onboarding.show`, which is not built yet; the implementer flagged this. The controller should confirm that the onboarding task lands before anyone follows this redirect end to end.
  - 10 §4 asks for `auth.errors.throttled` with a live countdown on auth pages. 13 §10 asks for the `errors.rate_limited` flash toast, which is what the pre-existing `RateLimitedResponse` gives. The two spec sections disagree; the controller should pick one.

### Checks run

- `vendor/bin/pest tests/Feature/Auth tests/Unit/Rules`: 356 passed (1157 assertions). No warnings, deprecations or risky tests in the output.
- `yarn vitest run resources/js/pages/Auth`: 20 passed (2 files). Clean.
- Scratch copy for mutation testing: `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/mut`. It holds a real `vendor/composer`, `vendor/bin` and `vendor/pestphp`, with the other packages symlinked. Autoload was verified to resolve `app/` from the scratch copy. The worktree was not touched (`git status` is clean).

Mutation results. Unless noted, the suite was Feature/Auth, Unit/Rules and Unit/Auth/IntendedRedirectTest.

| # | Mutation | Result |
|---|---|---|
| M1 | Remove the `remember=false` merge in ApplyRememberPolicy | killed (4) |
| M2 | Allow `//host` in IntendedRedirect | killed (3) |
| M3 | Drop the userinfo check | killed (1) |
| M4 | Drop the backslash/control-character regex | killed (8) |
| M5 | Ignore the port in the origin compare | killed (3) |
| M6 | Check `is_active` before the password | killed (1) |
| M7 | Skip the placeholder `Hash::check` for an unknown email | **survived** |
| M8 | Drop the Turnstile hostname check | killed (3) |
| M9 | Drop the Turnstile action check | killed (2) |
| M10 | Invert fail-open | killed (4) |
| M11 | Always add Cloudflare to the CSP (also ran SecurityHeadersTest) | killed (16) |
| M12 | Unmask the email in `auth.login_failed` | killed (2) |
| M13 | Unmask the IP in `auth.login` | killed (1) |
| M14 | Drop `ShouldDispatchAfterCommit` from CustomerRegistered | **survived** |
| M15 | Drop `event(new Lockout)` from the login limiter response | killed (1) |
| M16 | Send Welcome by database only | killed (1) |
| M17 | Drop PrepareAuthenticatedSession (LoginTest only) | survived: `SessionGuard::login()` already calls `session->migrate(true)`, so fixation stays covered. FortifyConfigTest pins the pipeline. Not a finding. |
| M18 | Use the raw email in ApplyRememberPolicy | killed (1) |
| M19 | Drop the closed-registration 403 | killed (3) |
| M20 | Drop `afterCommit()` from Welcome | **survived** |

Timing probe, in a scratch Pest test at bcrypt cost 12 (the production default). The static `placeholderHash` was reset before each call to model one php-fpm request per call. Medians over 8 runs:
- unknown email: 396 ms
- known email with a wrong password: 198 ms

Extra open-redirect probes, all returning `null`:
- `https:evil.test`
- `https:/evil.test`
- `https:///evil.test`
- `https://furny.example.com:443@evil.test/`
- `https://evil.test?https://furny…`
- `https://evil.test#https://furny…`
- `https://furny.example.com%2F@evil.test`
- `https://furny.example.com。evil.test/`
- `https://furny.example.com./x`

Some probes stay same-site:
- `/%2F%2Fevil.test` gives `https://<app>/%2F%2Fevil.test`; the encoding is preserved.
- `/%5Cevil.test` and `/ /evil.test` resolve to paths on our own host.

### Strengths

- `IntendedRedirect::sameSitePath` (`app/Support/Auth/IntendedRedirect.php:48-80`) is stricter than 13 §12.7 asks for:
  - It rejects backslashes, control characters, userinfo, non-http(s) schemes, and other ports or schemes.
  - It rebuilds a single leading slash and caps the length.
  - Every trick in the review list is rejected and has a test (`tests/Unit/Auth/IntendedRedirectTest.php:38-71`, `LoginTest` intended dataset).
  - `RecentAuthenticationRequired` now reuses it instead of carrying a second copy.
- The remember policy is enforced on the server:
  - `ApplyRememberPolicy` runs before `RedirectIfTwoFactorAuthenticatable`, so `login.remember` is false through the 2FA challenge too.
  - Tests check that no recaller cookie is set, that the registry stores `remembered=0`, and that the 2FA session carries the flag.
- An inactive user with a wrong password and a plain wrong password follow the same code path and give the same error. `auth.inactive` appears only after a correct password (M6 is killed).
- Throttling:
  - The `email_ip` key is normalised (NFKC, trim, lower) and hashed (`RateLimitKey::email`).
  - The test sends `' Asha@example.com'` on the 6th try.
  - Another IP or another email is not throttled.
  - Lockout is fired and logged masked.
- The register limiter sits in front of validation, and the closed-registration 403 comes before counting. Both are tested.
- Turnstile follows 13 §3 to the letter:
  - The rule is implicit.
  - `success === true`, hostname and action are all required.
  - A 5xx is treated as unavailable.
  - The log never contains the token or the secret.
  - The CSP adds Cloudflare to `script-src`, `connect-src` and `frame-src` only while captcha is on, and sets `frame-src 'none'` otherwise.
  - Tests cover both keys, the relaxed dashboard policy and the exact count of sources.
- Audit properties are exactly `{method, ip masked, ua}` for `auth.login` and `{email masked, ip masked}` with no causer for `auth.login_failed`. A test asserts that neither the password nor the raw email is present.
- Registration:
  - Defaults come from settings, and a test changes the settings to prove they are not constants.
  - The email is lower-cased before `unique`, and soft-deleted rows are included.
  - `email_unavailable` is used for both live and soft-deleted rows, as the 13 §5.1 decision intends.
  - `Welcome` goes to database and mail, with the payload shape of 12 §4.5.
- The Vue pages:
  - Every string is i18n'd; there is no hard-coded English.
  - Each field has a label, `aria-invalid`, and `aria-describedby` pointing at the `InputError` id.
  - The password hint is linked to its field.
  - Remember is ticked by default and tested through `aria-checked` and `FormData`.
  - Terms and marketing are unticked.
  - The Turnstile widget loads with the page nonce and resets after an error.

### Issues

#### Critical (Must Fix)

None.

#### Important (Should Fix)

1. **Login timing reveals which emails exist under php-fpm.**
   - Where: `app/Actions/Fortify/AuthenticateUser.php:21,33,60-62`.
   - What is wrong: `placeholderHash()` memoises `Hash::make(Str::random(32))` in a static property. Production runs php-fpm (17 O2), where statics live for one request. So every unknown-email (or passwordless) login pays one `Hash::make` plus one `Hash::check`, where a known email pays only one `Hash::check`.
   - Measured at cost 12: 396 ms against 198 ms. That gap is easy to tell apart over the network.
   - Why it matters: 13 §2 step 3 makes "no enumeration" a property of login. The class comment claims that property. The 13 §5.1 decision accepts enumeration only on registration, and only behind 5/hour/IP plus Turnstile. Login allows 30/min/IP with no captcha, so this is the cheaper oracle.
   - Mutation M7, which removes the placeholder check entirely, also survives. Nothing tests this.
   - Fix: make the dummy check cost exactly one verification.
     - Option A: a placeholder hash that is not computed per request, such as `Cache::rememberForever('auth:placeholder:'.config('hashing.driver').':'.config('hashing.bcrypt.rounds'), …)`, or one built at deploy time.
     - Option B: wrap the whole handle in `Illuminate\Support\Timebox`, as `SessionGuard::attempt` does.
   - Test to add: spy on the hasher and assert one `check` and no `make` for an unknown email in a fresh request. Alternatively, reset the static and assert timings within a tolerance.

2. **Focus does not move to the first invalid field after a failed submit (15 §10.1, §14.8).**
   - Where: `resources/js/pages/Auth/Login.vue:49` and `resources/js/pages/Auth/Register.vue:62-67`.
   - What is wrong: neither `<Form>` has an `@error` handler that does `nextTick(() => document.querySelector('[aria-invalid="true"]')?.focus())`. `Register.vue` uses `@error` only to reset Turnstile.
   - Why it matters: after an Inertia validation error, focus stays on the submit button, and screen-reader users are not taken to the error. This is a stated spec requirement and was on the review list.
   - Fix: add the handler on both pages, or in a small shared composable, since `ReasonDialog.vue:105` already does the same thing. Add a vitest case that mounts the page with an error and asserts `document.activeElement`.

#### Minor (Nice to Have)

1. **The after-commit behaviour is not tested.**
   - Where: `app/Domain/Identity/Events/CustomerRegistered.php:18` and `app/Notifications/Account/Welcome.php:29`.
   - Mutations M14 and M20 survive.
   - Registration is not wrapped in a transaction today, so behaviour is correct now. However, the brief names "dispatched after commit" as part of the contract, and the OTP-complete path will run inside one.
   - Suggested test: in `RegisterTest` or a unit test, wrap the dispatch in `DB::transaction` and assert the listener or notification has not run until commit, and does not run on rollback.

2. **The captcha error is not linked to anything.**
   - Where: `resources/js/pages/Auth/Register.vue:204`.
   - `id="captcha-error"` is never referenced by any `aria-describedby`.
   - Suggested fix: link it from the widget container, or give the error an alert role when there is no field to describe.

3. **Required fields have no visual `*` marker (15 §10.1 "Required fields marked with `*` (visually)").**
   - Where: `Login.vue` and `Register.vue`.
   - The fields carry `required` and `aria-required` only.

4. **The `aria-describedby` on the password field can point at an id that is not rendered.**
   - Where: `Register.vue` password field.
   - It always includes `password-hint`, but the hint is only rendered when `minLength !== null`.
   - Low risk, because `passwordRules` always carries `minlength`.

5. **TDD evidence is missing.**
   - The report says RED was never run separately, because the controller asked for the whole task at once.
   - Mutation checks partly make up for this; the ones run here are listed above.
   - This is noted only for the record.

### Assessment

**Task quality:** Needs fixes

**Reasoning:**
- Security behaviour is careful and well tested: redirects, the remember policy, throttling, Turnstile, CSP and audit masking. 17 of 20 security mutations are killed.
- Two problems remain:
  - The login timing oracle breaks the spec's "no enumeration" guarantee under the production runtime (php-fpm).
  - The required focus-on-first-error behaviour is missing from both pages.
