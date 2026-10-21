# Task 27 review: phone OTP core (+ Task 26 fold-ins)

Range `1b598cb..648ca0e` (commits `b1d085f`, `648ca0e`), read from `review-1b598cb..648ca0e.diff` (2 648 lines, non-empty, read in full in three passes). File:line references are to the new files. Line numbers come from the diff hunks.

### Spec Compliance

- ✅ **Spec compliant, with the controller rulings applied.** Every file in the brief's Create, Modify and Test lists has its hunk. All of the brief's Step 1 test cases are present, and they pass.
  - Extra files: `OtpLimits` (accepted), `tests/Unit/Otp/OtpDeliveryBindingTest.php`, `RateLimitKey::forIp`, and the `OtpCode::LIFETIME_MINUTES/MAX_ATTEMPTS` constants. Each is small and has a clear purpose.
  - 13 §4.1 parameters:
    - The code is generated at `SendOtp.php:71`.
    - The hash is made at `:155`.
    - Expiry is set at `:171`.
    - Earlier codes are expired at `:158-163`.
    - Pruning is in `OtpPrune.php:19`.
  - 13 §4.2 steps 1–7 are followed in the spec's order (`SendOtp.php:55-90`). Step 8 `otp.challenge` was carried to a later task.
  - 13 §4.3 steps 2–5 are in `VerifyOtp.php:34-77`. The extra `expires_at` guard was accepted.
  - 13 §4.5 item 6 is in `OtpMonitor.php:28-47`.
  - §17 `auth.otp_sent` is at `SendOtp.php:78-87` and `auth.otp_locked` at `VerifyOtp.php:59-62`. Both carry only masked values.
  - 12 §3.7 text and the appName fallback: `notifications.php`, `SendOtp.php:238-243`.
  - 02 §13: settings are read for the channel order, templates, allowed countries and cap.
- ⚠️ **Cannot verify from diff:**
  - Schedule entries, `otp.challenge`, the async WhatsApp fallback and the WhatsApp-unreachable check were all carried to later tasks.
  - Whether the later HTTP controller maps `OtpException`, and keeps it out of `report()`, has to be checked in the controller task.
  - The 12 §3.7 boot-time warning for an `app.name` longer than 20 characters is not in this diff.

### Checks run

1. `vendor/bin/pest tests/Feature/Auth/Otp tests/Unit/Phone` in the worktree: **115 passed (341 assertions)**. The output had no warnings or deprecations.
2. **Mutation run** on a scratch copy (separate `furny_review` Postgres DB, vendor hard-linked, worktree untouched). 41 mutants, 39 killed.
   - Killed:
     - Code generation: constant code; plaintext stored.
     - Verify: any code accepted; attempt cap removed; consume without the `consumed_at` guard; consume without the `expires_at` guard.
     - Send limits: no cooldown; no IP send limit; no phone send limit.
     - Captcha: threshold 3; no session trigger; no `captcha_always`; fail-open.
     - Clearing after a successful verify: no send-phone clear; no verify-phone clear.
     - Monitor: `>=`→`>`; minimum 49.
     - Prune: 23 h; 25 h.
     - Logging: `LogOtpDelivery` logs the message.
     - Expiry after failed delivery: none when all channels fail; none on an unexpected throwable.
     - Channels: no channel update; no global cap; cap `<=`; no global increment.
     - Phone parsing: no mobile check; no region check.
     - Verify limits: no IP limit; no phone limit.
     - Verify behaviour: a typo costs an attempt; the lock does not expire the code.
     - Send side effects: no expiry of previous codes; no session increment; no IP hit.
     - Keys and audit: raw phone in the key; no IPv6 /64; unmasked audit IP.
     - Fold-ins: forgot-password without the catch; seeder without `first_contact_verified_at`.
   - "No `str_pad`" was killed only by chance (see Minor 3).
   - Survived:
     - `random_int(100000, 999999)` (Minor 3).
     - Renaming the `auth.otp_locked` *description* (equivalent: the test queries `event`, which is still set).
3. **Concurrency probes** on the scratch copy: separate PHP processes, real Postgres, shared Redis cache (DB 11), bcrypt rounds 12, started at the same instant.
   - Verify:
     - 2 parallel correct → exactly 1 `OK`, 1 `otp_expired`.
     - 5 parallel correct, three runs → 1 `OK`, 4 `otp_expired` each time. Atomicity holds.
     - 20 parallel wrong → `attempts = 5` and exactly 5 `otp_invalid`; the rest `otp_too_many_attempts` or `otp_expired`. The cap holds.
     - 10 mixed → `attempts = 5`.
   - Send: **10 parallel sends to one phone from one IP all delivered (10 rows)**, and **15 parallel sends to 15 phones from one IP all delivered**, with Turnstile keys set. See Important 1.
4. **Phone parser edge inputs** (scratch copy):
   - Normalised to `+919876543210` (harmless, because the output is E.164): full-width digits, Arabic-Indic digits, `0091 …`, `00919…`, `+0091 …`, `ext. 123`, `x99`, `#55`, `tel:` URI, trailing newline, NBSP, zero-width space, RTL override, emoji, full-width plus, `(+91)`, dots.
   - `phone_invalid`: Devanagari digits, letters, two numbers, 300 digits, 5 000 characters (<1 ms, because libphonenumber caps input at 250), NUL byte.
   - `phone_not_mobile`: `1860` UAN.
   - Nothing threw outside `OtpException`.
5. **Code in exception traces** (scratch test): an unexpected delivery error's `getTraceAsString()` contains `deliver(…, '785813', Array)` and `send(…, '785813 is your ...', …)` (Minor 1).

### Strengths

- The SQL is exactly what the spec asks for:
  - The attempt counter is `UPDATE … WHERE id = ? AND attempts < ? RETURNING attempts` (`VerifyOtp.php:101-109`).
  - Consume is `UPDATE … WHERE consumed_at IS NULL AND expires_at > ? RETURNING id` (`:112-122`).
  - The probes confirm exactly-once consume and an attempt cap of 5 under real parallelism.
- Code secrecy is handled carefully:
  - The code is a local variable, and the only place it goes is the delivery call (`SendOtp.php:196-201`).
  - The delivery-failure log records the exception class only (`:210`).
  - `OtpSendResult` and `OtpException` contexts carry no code.
  - `otp-dev` is defined only when `APP_ENV=local` and is tapped (`config/logging.php`).
  - `LogOtpDelivery` checks both the env and that the channel exists (`LogOtpDelivery.php:22`).
  - Tests use a `MessageLogged` listener over the success, failure and unavailable paths.
- Limiter keys hash the number and normalise IPv6 to /64 (`OtpLimits.php:29-36`). Thresholds come from `config('security.rate_limits')`, so the action and the future named limiters share one source.
- The racing-hasher tests (`VerifyOtpTest.php:134-164`) are a clean, deterministic way to exercise the double-submit and replaced-code races.
- The channel fallback, expiry when every channel fails, and expiry plus rethrow on an unexpected throwable are all tested. The fallback updates `otp_codes.channel` (`SendOtp.php:215-217`).
- The monitor uses integer arithmetic (`verified*5 >= sent`), and its 50/9, 50/10 and 49/0 boundaries are tested. Prune is tested on both sides of the 24 h line.
- Fold-ins:
  - The seeder sets `first_contact_verified_at` and the test asserts it.
  - The queue-outage test uses a real throwing connector and `Exceptions::assertReported`. It was red without the fix (mutant M37 confirmed this).

### Issues

#### Critical (Must Fix)

None.

#### Important (Should Fix)

1. **Parallel requests bypass the send limits and the captcha escalation.** Affected code: `app/Domain/Identity/Actions/SendOtp.php:104-119` (limit checks), `:127-150` (captcha decision), `:177-188` (hits).
   - **What happens.** The cooldown, the per-phone and per-IP hourly limits, and the captcha trigger are all decided by reading counters (`tooManyAttempts`, `attempts`, `Session::get`). The counters are only incremented in `countSend`, after:
     - libphonenumber,
     - the Turnstile HTTP call (up to 5 s),
     - `Hash::make` (bcrypt),
     - the DB transaction.
   - **Evidence.**
     - 10 simultaneous sends to one number from one IP: **all 10 delivered**. Sequentially, the limits are 1 per 60 s with a captcha from the 3rd send.
     - 15 simultaneous sends to 15 numbers from one IP: **all 15 delivered** (the limit is 10/h per IP, with a captcha from the 3rd send).
     - `features.captcha` was on in both runs.
   - **Why it matters.** One client with a burst of concurrent requests defeats defences 2 and 3 of 13 §4.5, the main SMS-pumping controls. Only the global hourly cap remains. Laravel sessions do not lock, so the session counter does not help either.
   - **The spec's role.** Its step list (check at step 2, hit at step 6) is the origin, but it does not require the check-to-hit window to span the slow steps. The future route middleware will narrow the window but not close it, because the middleware keys differ and `ThrottleRequests` also checks then hits.
   - **Fix.** Reserve before the slow work, atomically:
     - Cooldown: `Cache::add($cooldownKey, 1, 60)`, which is SET NX. If it returns false, answer `otp_cooldown`.
     - Phone and IP limits: `RateLimiter::increment`/`hit` first, then compare the returned count with `max`.
     - Captcha: decide from those reserved counts.
     - If the request is then refused (captcha, no channel), decrement or release, so refused sends still do not count. Alternatively, take `Cache::lock("otp-send:{phoneHash}")` and `Cache::lock("otp-send:{ipKey}")` around check→hit.
   - **Test to add.** A deterministic one: a hasher whose `make()` re-enters `SendOtp::handle` for the same phone once, then assert the inner call gets `otp_cooldown`.

#### Minor (Nice to Have)

1. **The plaintext code appears in exception stack traces outside production.**
   - **Where.** `SendOtp.php:196` (`deliver(..., string $code, ...)`) and `:153` (`store(..., string $code, ...)`); `OtpDelivery.php:21` (`string $message`); `VerifyOtp.php:30` (`handle(..., string $code, ...)`).
   - **Evidence.** The scratch probe shows `deliver(Object(OtpCode), '+919876543210', '785813', Array)` in `getTraceAsString()` when a driver throws unexpectedly.
   - **Why it is Minor.** Production and staging set `zend.exception_ignore_args = On` (17, php.ini). On that path the row is already expired. Local, CI and any other host still log it, against 13 §4.1 "never logged".
   - **Fix.** Add `#[SensitiveParameter]` to those parameters. The codebase already does this in `User::sendPasswordResetNotification`.
2. **A Cloudflare outage is reported as `captcha_required`, not `auth.captcha_unavailable`.**
   - **Where.** `SendOtp.php:134-141` calls `->passes()` and drops the rule's `auth.captcha_unavailable` message (`TurnstileToken.php:86-87`; 13 §3: "false → fail with `auth.captcha_unavailable`").
   - **Effect.** During an outage the client keeps re-rendering the widget and resubmitting, and the user is never told why.
   - **Fix.** Surface a distinct code, or put the rule's message in the context.
3. **The leading-zero and range tests are probabilistic.**
   - **Where.** `tests/Feature/Auth/Otp/SendOtpTest.php:115-125`.
   - **Evidence.** 12 sends give about a 72 % chance of catching a dropped `str_pad`. The mutant `random_int(100000, 999999)`, a 10 % entropy cut, survives.
   - **Fix.** Make generation testable deterministically. For example, a `codeGenerator` seam that uses `Random\Randomizer` (default engine `Secure`) and a seeded engine in the test. Or assert `str_pad` output for a forced `0`, `7` and `999999`.
4. **One verify test asserts nothing about VerifyOtp.**
   - **Where.** `tests/Feature/Auth/Otp/VerifyOtpTest.php:106-113`, "caps the attempt counter at five in the statement itself".
   - **What it does.** It runs its own copy of the SQL, not VerifyOtp's, so it tests Postgres, not the code. The countdown test (`:70-85`) is what actually kills the "no cap" mutant.
   - **Fix.** Remove it, or drive it through `VerifyOtp`.
5. **Session `otp.sends` never ages out.**
   - **Where.** `SendOtp.php:187`, `:146`.
   - **Effect.** 13 §4.1 says the captcha is needed "after 2 sends (per session, per phone or per IP within the hour)". The phone and IP counters reset after an hour, but the session counter lives as long as the session. A guest who keeps one session for days needs a captcha on every send from the third ever. The spec is ambiguous (§4.2 step 3 has no window).
   - **Fix.** Store `{count, since}` and reset it after an hour, or confirm the reading with the controller.
6. **Every caller of the password-reset notification now swallows failures.**
   - **Where.** `User.php:231-239`, the Task 26 fold-in.
   - **Effect.** The `Throwable` catch sits on the model, so any future caller of `sendPasswordResetNotification` (an admin "send reset link", say) gets a silent success. The failure is reported, not surfaced.
   - **Fix.** Acceptable for 13 §5.5. Consider narrowing it to the broker path, or naming it in the method docblock (which it already partly does).
7. **The OTP core was not written test-first.** The report says the implementation came before the tests. The 39/41 mutation kill rate shows the tests are strong anyway, so this is recorded as a process note only.

**Not a finding (recorded for the controller).** With 6 or more simultaneous verifies of one code, the request that finds the attempts used up expires the row while the correct-code requests are still in `Hash::check`, so none consume. The probe gave 20 parallel correct → 0 consumed. This needs at least 6 concurrent tries, which an attacker can already use to kill a code with wrong guesses. A real user's double submit (2) or up to 5 behaves correctly.

### Assessment

**Task quality:** Needs fixes

**Reasoning:**
- Verify-side atomicity, code secrecy, channel fallback, parsing, commands and both fold-ins are correct. They are backed by strong tests (39/41 mutants killed), and real-process probes confirmed them.
- On the send side, all limits and the captcha decision are check-then-hit across a multi-second window. Parallel requests defeat the per-phone, per-IP, cooldown and captcha defences against SMS pumping.
