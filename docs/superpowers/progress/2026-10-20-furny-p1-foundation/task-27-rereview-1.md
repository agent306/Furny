# Task 27 re-review 1: fix round 1 (`648ca0e..aeeaba0`)

I read the whole of `review-648ca0e..aeeaba0.diff` (2 003 lines, one commit). File:line references are to the fixed files at `aeeaba0`. The report's "Fix round 1" section names the covering suites and shows their counts.

## Finding Verdicts

- **Important 1: parallel sends got past the cooldown, the per-phone and per-IP hourly limits and the captcha escalation.** **ADDRESSED.**
  - **Code.** Everything is reserved at the start of `SendOtp::handle`, before Turnstile, bcrypt and the transaction:
    - The cooldown is an atomic `Cache::add` (`SendOtp.php:72`, `:150-165`).
    - The phone, IP and global counters are incremented first and then compared (`:78-80`, `:153-182`).
    - The captcha is decided from the reserved counts (`:203-232`).
    - SMS availability is decided from the reserved global place (`OtpChannelResolver.php:57`).
    - A refusal gives back the counters and the cooldown (`:94-98`). A delivery failure gives back the counters and keeps the cooldown (`:105-110`).
  - **Probe.** I re-ran my parallel-process probe in a scratch copy: a separate Postgres DB, a real Redis cache, bcrypt 12, and the processes started at the same instant. Results:

    | Case (all parallel) | Before the fix | After the fix |
    |---|---|---|
    | 10 sends, one number, one IP, captcha on | 10 sent | 1 sent, 9 `otp_cooldown` (1 row, IP count 1, global 1) |
    | 15 numbers, one IP, captcha on, no token | 15 sent | 2 sent, 13 `captcha_required` (IP count 2) |
    | 15 numbers, one IP, captcha off | — | 10 sent, 5 `otp_rate_limited` (IP count 10, global 10) |
    | One number from 15 IPs | — | 1 sent, 14 `otp_cooldown` |

  - **Tests.** The new `OtpConcurrencyTest.php` runs real processes and passed in my scratch run.
- **Minor 1: `#[SensitiveParameter]` on the code and message parameters.** **ADDRESSED.**
  - It is on `SendOtp.php:255` and `:285`, `OtpDelivery::send` (`$message`, `$code`), both implementations, and `VerifyOtp.php:30`.
  - The tests check traces from a delivery driver and from a `VerifyOtp` refusal, plus a reflection check of all nine parameters (`SendOtpTest.php`, "the code stays out of stack traces").
- **Minor 2: a Cloudflare outage was reported as `captcha_required`.** **ADDRESSED.**
  - `SendOtp.php:228-231` answers `captcha_unavailable` with a 503. It tells an outage from a rejection by the rule's `auth.captcha_unavailable` message, which the rule sets only on a connection error or a 5xx (`TurnstileToken.php:84-90`).
  - It stays fail-closed: no send goes out (the test at `SendOtpTest.php` "fails closed …").
- **Minor 3: the code-generation tests were probabilistic.** **ADDRESSED.**
  - `OtpCodeGenerator.php` has an injectable integer source and uses `random_int` by default.
  - The dataset tests force 0, 7, 4521, 123456 and 999999, and assert the range handed to the source is `[0, 999999]`. That kills the earlier surviving `100000` mutant.
- **Minor 4: one verify test exercised its own copy of the SQL.** **ADDRESSED.**
  - That test is removed. The sequential 8-try test (`VerifyOtpTest.php`, "stops at five attempts …") drives the real action.
  - The parallel tests in `OtpConcurrencyTest.php:178-201` are real processes.
  - My probe agrees: 5 parallel right codes, three runs, gave 1 `OK` and 4 `otp_expired` each time. 20 parallel wrong codes gave exactly 5 `otp_invalid` and `attempts = 5`.
- **Minor 5: session `otp.sends` never aged out.** **ADDRESSED.**
  - The window is `otp.sends_since`, and a count older than an hour is read as 0 (`SendOtp.php:236-252`).
  - Tested in "the session count …".
- **Minor 6: the `Throwable` catch sat on `User`.** **ADDRESSED.**
  - `User::sendPasswordResetNotification` throws again (`User.php`). A test shows another caller sees the failure.
  - The catch now lives in `PasswordResetLinkController.php:33`. Apart from that catch it matches Fortify's `store` line for line (checked against `vendor/laravel/fortify/.../PasswordResetLinkController.php:30-48`).
  - The binding is in `FortifyServiceProvider`. The HTML and JSON paths are tested.
- **Minor 7: the OTP core was not written test-first (process).** No code change is needed. The new reservation tests were checked red against the previous `SendOtp`, per the report.
- **Queued A: `OtpDelivery::send` takes `$code`.** **ADDRESSED.** `OtpDelivery.php:27-33` takes `$code` and marks it sensitive. `ArrayOtpDelivery::lastCode()` reads it.
- **Queued B: `defaultRegion` reads from settings.** **ADDRESSED.**
  - `PhoneNumberParser::defaultRegion(Settings)` is used by both `SendOtp::parse` and `RateLimitKey::phone`.
  - The literal `IN` is gone.
  - Tested in `RateLimitersTest.php`.

## Refund abuse check (requested)

Probe in the same scratch copy, with captcha on, no token, and a delivery that throws `OtpDeliveryException` on every channel:

- **Same number.** The first send gives `otp_send_failed`. An immediate retry from another IP, and a third with a working delivery, both give `otp_cooldown`. The cooldown is kept as ruled.
- **25 sequential sends from one IP to 25 numbers.** All 25 gave `otp_send_failed`, and none asked for a captcha. Afterwards the IP count and the global counter were both 0. A working send from the same IP then went through without a captcha, and the IP count became 1.
- **25 parallel failing sends from one IP.** 2 gave `otp_send_failed` and 23 `captcha_required`. While requests are in flight, the reservations still escalate the captcha.

What this means:

- Forced failures do give one IP unlimited delivery attempts in an hour, with no captcha. Each number is still limited to 1 attempt per 60 s.
- No code reaches anyone on those attempts, so no SMS quota is gained, as long as `OtpDeliveryException` means "nothing was sent or billed".
- Two things bound the abuse:
  - `otp:monitor` counts the failed rows as sent but not verified, so 50 such rows in an hour switch `auth:captcha_always` on.
  - In practice, forcing a synchronous provider rejection is hard.
- The leftover risk is in the contract. The interface only says it throws "when the channel could not deliver" (`OtpDelivery.php:21`). A future driver that wraps an ambiguous timeout, where the provider may already have sent the message, in `OtpDeliveryException` would have two effects:
  - The send is refunded, so a billed message is not counted.
  - The next channel is tried, so the code may be delivered twice.

  See Minor N2.

## New Breakage in the Fix Diff

- **Important N1: a time-dependent test fails in the last minutes of every hour.**
  - **Where.** `tests/Feature/Auth/Otp/SendOtpTest.php:811-823`, "refuses a number over its hourly limit …".
  - **Cause.** The test travels 5 × 61 s and then asserts `Cache::get(OtpLimits::globalKey())` is 5. The global key is per clock hour (`otp:global:YmdH`), so when the run starts within about 5 minutes of the top of the hour, the sends spread over two keys.
  - **Evidence.** It failed at 11:58 UTC ("Failed asserting that 2 is identical to 5", line 822), both in the full OTP suite run and when run alone. It passed at 12:00 UTC.
  - **Impact.** CI goes red about 8 % of the time.
  - **Fix.** Pin the clock first (`$this->travelTo(now()->startOfHour())`), or drop the global assertion from this test.
  - **Same pattern, smaller window.** `OtpConcurrencyTest.php:164` seeds `globalKey()` in the test process while the workers compute it seconds later, so it can fail at :59:5x.
- **Minor N2: the refund rule for delivery failures has no matching driver contract.**
  - **Where.** `SendOtp.php:105-110` refunds every counter when delivery throws. `OtpDelivery.php:21` says `@throws OtpDeliveryException when the channel could not deliver`.
  - **Fix.** State in the interface that `OtpDeliveryException` means "definitely not sent". An ambiguous outcome, such as a timeout after the request left, must count as sent (return normally, or a distinct exception that is not refunded and does not fall back). Optionally keep the per-IP counter on delivery failure, so failing sends still escalate the captcha for that IP; a legitimate user retrying a failed send loses little.
- **Minor N3: `captcha_unavailable` is detected by comparing translated message text.**
  - **Where.** `SendOtp.php:229` compares against `__('auth.captcha_unavailable')`.
  - **Why it is fragile.** It works today: same locale, and the rule sets that message only for an outage. But it couples the action to the rule's message text and the current locale.
  - **Fix.** A typed signal from the rule, such as a public `unavailable` flag or a small result object, would be sturdier.
- **Minor N4: `OtpConcurrencyTest` wipes the whole Redis cache database.**
  - **Where.** `OtpConcurrencyTest.php:29` and `:50` call `flushdb()` on Redis cache DB 15.
  - **Effect.** Under `pest --parallel` it can wipe the keys of another test that uses the Redis cache store at the same moment.
  - **Fix.** Delete only the keys it created, or give this test its own DB number.

## Out-of-Scope Observations

None.

## Verdict

**Fix round:** Findings remain open. All original findings are addressed, but the fix introduced one Important problem, N1 (the hour-boundary flaky test at `SendOtpTest.php:811-823`). N2, N3 and N4 are Minor.

The scratch copy, its database (`furny_review2`) and Redis DB 10 have been removed. The worktree is unchanged.
