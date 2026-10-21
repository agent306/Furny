# Task 27 report: phone OTP core (plus the two Task 26 fold-ins)

Branch `build/p1-foundation`, base `1b598cb`. Commits: `b1d085f` (fold-ins), `648ca0e` (OTP core). Pushed.

## What was implemented

Fold-ins from the Task 26 re-review
- `database/seeders/OwnerSeeder.php` sets `first_contact_verified_at` with `email_verified_at`; `OwnerSeederTest` asserts it.
- `User::sendPasswordResetNotification()` catches `Throwable` from the (queued) `ResetPassword` dispatch and calls `report()`. The broker then answers as usual, so forgot-password gives the generic status for a known address under a queue outage. New test in `ForgotPasswordTest` ("a queue outage") uses a queue connector whose `push` throws and `Exceptions::fake()`. Verified red without the fix (not reported, `assertReported` fails), green with it.

OTP core
- `App\Support\Phone\{PhoneNumberParser, ParsedPhone}`: static `parse($raw, $defaultRegion, $allowedRegions)`: libphonenumber parse and `isValidNumber` (else `phone_invalid`), type MOBILE or FIXED_LINE_OR_MOBILE (else `phone_not_mobile`), region in allowed list (else `phone_country_not_supported`); order is the spec's. All 422 `OtpException`.
- `App\Domain\Identity\Otp\`: `OtpException(errorCode, status, context)` (the machine code is `->errorCode`, since `Exception::$code` is an int), `OtpDeliveryException`, `OtpSendResult`, `OtpDelivery`, `LogOtpDelivery`, `ArrayOtpDelivery` (`sent()`, `lastCode()`, plus `failOn(OtpChannel ...)` for tests), `OtpChannelResolver::available()`, and one helper not in the brief, `OtpLimits` (see judgment calls).
- `SendOtp::handle`: steps 1 to 8 of 13 §4.2 as in the brief. Default region = `business.address.country_code`, else the first of `auth.otp_allowed_country_codes`; allowed regions = `auth.otp_allowed_country_codes` (no `IN` literal in the code). Limits via `RateLimiter` with thresholds read from `config('security.rate_limits')`; keys carry a sha256 of the E.164 and the IP normalised through `RateLimitKey` (IPv6 /64, `unknown` for none). Captcha reuses the `TurnstileToken('otp_send', failOpen: false)` rule through a `Validator`. Code `random_int` padded to 6; `Hash::make`; transaction expires earlier unconsumed codes for phone+purpose and inserts; then limiter hits, `otp:global:{YmdH}` (TTL 2 h) and session `otp.sends`; synchronous delivery with fallback; all failed (or any unexpected throwable) expires the row; audit `auth.otp_sent` (`security` log, masked phone, channel, purpose, masked IP, causer = signed-in user or null). Message = `trans_icu('notifications.auth.otp.sms', code, appName, domain)`; `appName` falls back to the business name cut to 20 chars when `app.name` is longer (12 §3.7).
- `VerifyOtp::handle`: counts the try against `otp-verify` ip (10/min) and phone (20/h) and throws `ThrottleRequestsException` (429 with `Retry-After`) when over; loads the latest live row (none: `otp_expired`); non-6-digit input after stripping whitespace: `otp_invalid` with `attemptsLeft`, no attempt used; raw `UPDATE … SET attempts = attempts + 1 … WHERE id = ? AND attempts < 5 RETURNING attempts` (no row: expire the row, audit `auth.otp_locked`, `otp_too_many_attempts`); `Hash::check` (fail: `otp_invalid`, `attemptsLeft = 5 - attempts`); raw `UPDATE … SET consumed_at … WHERE id = ? AND consumed_at IS NULL AND expires_at > ? RETURNING id` (no row: `otp_expired`); clears `otp-verify:phone` and `otp-send:phone` hits.
- `OtpChannelResolver`: order from `notifications.otp_channel_order` (unknown names ignored, no duplicates); WhatsApp needs `features.whatsapp` and `whatsapp_templates['auth.otp']`; SMS needs `features.sms`, `sms_templates['auth.otp']` and `otp:global:{YmdH}` below `auth.otp_global_hourly_cap`.
- `otp:monitor` (sent and verified over the last 60 min; at 50 or more sent and verified/sent below 0.2, in integers: `auth:captcha_always` for 1 h, `health:otp = {status: 'low_conversion', sent, verified, at}` for 1 h, `Log::critical('otp.low_conversion')`) and `otp:prune` (`expires_at < now() - 24h`).
- Wiring: `AppServiceProvider` binds `OtpDelivery` to `LogOtpDelivery`; `tests/Pest.php` binds the singleton `ArrayOtpDelivery` for the Feature suite; `config/logging.php` defines `otp-dev` (single file `storage/logs/otp-dev.log`, tapped with `TapRedaction`) only when `env('APP_ENV') === 'local'`; `LogOtpDelivery` writes the full message there only when the app env is local AND the channel exists, otherwise `Log::info('otp.delivery', {channel, phone masked, reference})`; lang `notifications.auth.otp.sms` (12 §3.7 text) and regenerated `resources/js/lang/generated`.
- Small edits to existing code: `OtpCode` gained constants `LIFETIME_MINUTES = 10`, `MAX_ATTEMPTS = 5`; `RateLimitKey` gained public `forIp(?string)` (the former private `ip(Request)` now delegates to it, behaviour unchanged).

## Tests

- New: `tests/Unit/Phone/PhoneNumberParserTest.php` (18), `tests/Feature/Auth/Otp/{SendOtpTest (52), VerifyOtpTest (29), OtpCommandsTest (8), OtpDeliveryTest (9 with the unit binding test)}.php`, `tests/Unit/Otp/OtpDeliveryBindingTest.php` (the app binds `LogOtpDelivery`). Covers every case of the brief, plus: IPv6 /64 grouping, no phone number in limiter keys, captcha triggers one by one (session, phone, IP, `auth:captcha_always`), rejected token / other form / other host / missing / Cloudflare down (fail closed), captcha off, business-country default region and allowed countries from settings, appName fallback, cap from settings, unexpected driver error expires the row, double-submit and replaced-code races (a hasher that consumes or expires the row between check and consume), limiter clearing, 429 on the 11th verify per minute and the 21st per hour, `otp-dev` config only in local and tapped, local logging to a real file.
- Final: `vendor/bin/pint --test` passed; `vendor/bin/phpstan analyse --no-progress --memory-limit=1G` `[OK] No errors`; `vendor/bin/pest tests/Unit tests/Feature`: 2910 passed, 1 skipped (the pre-existing skip from Task 26), 11229 assertions.

### TDD evidence
Not a strict red/green for the OTP core: I wrote the implementation before the tests (the parser behaviour was probed first in a scratch script), then the tests, which passed after fixing mistakes in the tests themselves (microsecond precision on `expires_at`, a cooldown clash in one test, `Http::fake` stub order). The fold-in test for the queue outage was checked red (`Exceptions::assertReported` failed with the fix reverted) and green.

## Judgment calls and deviations

1. `OtpLimits` (not in the brief's file list): one place for the limiter keys and the thresholds read from `config('security.rate_limits')` (both actions need them) and the global counter key. Also `OtpCode` constants. The named limiters of `RateLimitServiceProvider` are request-based (middleware), so the actions use the `RateLimiter` facade with the same thresholds.
2. Cache keys carry `sha256(e164)` instead of the raw number as 13 §4.2 writes them (13 §16 rule 6).
3. `VerifyOtp` consume statement has the extra `AND expires_at > now`, so a code that a new send replaced between load and consume cannot be consumed. Malformed input is judged after loading the live row (so it can report `attemptsLeft`, and a malformed try with no live code says `otp_expired`).
4. The 11th verify per minute is a `ThrottleRequestsException` (renders as `429 rate_limited` through the existing handler), not an `OtpException`, because 14 §3.2 lists `429 rate_limited` for verify.
5. `SendOtp` does not store session `otp.challenge` (13 §4.2 step 8): it needs `intent` and `name`, which the brief's signature does not have; the controller task stores it. Same for the 13 §4.3 step 1 "require session challenge".
6. Clearing on success also clears `otp-send:phone` (the brief says "phone limiter hits"); `otp-cooldown` is left.
7. `health:otp` is only written on a low-conversion run; it expires with the captcha flag after an hour rather than being cleared when conversion recovers.

## Concerns for the controller

- WhatsApp "phone not WhatsApp-unreachable" (13 §4.2 step 4, 12 §7.7) is not implemented: it needs the `to_hash`/`ChannelAvailability` of the notifications task, and the brief's channel rule does not list it. If a WhatsApp send to an unreachable phone fails, the SMS fallback already covers it. `OtpChannelResolver::available($e164)` takes the number for that check.
- The asynchronous WhatsApp-failure fallback (webhook, `otp:fallback:{hash}`, `/auth/otp/status`) is out of this task.
- The schedule entries (`otp:monitor` every 5 min, `otp:prune` daily 03:00) are not in `routes/console.php`; the scheduler task owns the table of 01 §7 and its test.
- The delivery message is the SMS text for both channels; a WhatsApp implementation of `OtpDelivery` that needs the bare code for the template parameter will have to extract it from the message or the interface will need a code argument.
- `RateLimitKey::defaultRegion()` (the named limiter's phone key) still falls back to the literal `IN`; `SendOtp` does not use it, so the two can differ only for a business with no address and a non-IN allow list. Not touched.
- No subagents used.

## Files changed

app: `Console/Commands/{OtpMonitor,OtpPrune}.php`, `Domain/Identity/Actions/{SendOtp,VerifyOtp}.php`, `Domain/Identity/Otp/*` (8 files), `Domain/Identity/Models/{OtpCode,User}.php`, `Providers/AppServiceProvider.php`, `Support/Http/RateLimitKey.php`, `Support/Phone/{ParsedPhone,PhoneNumberParser}.php`; `config/logging.php`; `database/seeders/OwnerSeeder.php`; `resources/lang/en/notifications.php`, `resources/js/lang/generated/{en,manifest}.json`; tests: `tests/Pest.php`, the files listed above, `ForgotPasswordTest`, `OwnerSeederTest`.

## Fix round 1

Review: `task-27-review.md` (Important 1, Minors 1 to 6) plus the controller's queued items A and B.

### Important 1: send-side race (SMS pumping)
`SendOtp::handle` now reserves before any slow work (Turnstile, bcrypt, the transaction):
- Cooldown: `Cache::add("otp:cooldown:{sha256(e164)}", endsAt, 60)`; the loser gets `otp_cooldown` with `retryAfter` from the stored end time (1 to 60).
- Hourly limits (phone, IP) and the global counter: increment first (`RateLimiter::hit`, `Cache::increment`), compare the returned count with the limit. The global place goes to `OtpChannelResolver::available($e164, $reservedCount)`, which allows SMS while the place is within `auth.otp_global_hourly_cap`.
- Captcha is decided from the reserved phone and IP counts (`> 2`, i.e. at least two earlier sends) and the session.
- Refunds: a send refused before it is tried (rate limit, captcha, unavailable, store failure) decrements the counters it reserved and frees the cooldown, so a retry with a token is not blocked for 60 s. When delivery fails (every channel, or an unexpected throwable) the counters are refunded and the cooldown is kept (13 §4.2).
- Tests: `tests/Feature/Auth/Otp/OtpConcurrencyTest.php` starts real PHP processes (`tests/Support/otp-worker.php`) at the same instant, against the real Postgres test database and Redis cache (DB 15, flushed before and after; rows are committed by a separate connection and deleted again). 10 parallel sends to one number: 1 delivered, 9 `otp_cooldown`. 15 parallel sends from one IP to 15 numbers: exactly 10 delivered, 5 `otp_rate_limited`, the IP counter ends at 10. 8 parallel sends with the global counter 3 places under the cap: 3 delivered, 5 `otp_unavailable`. Run 3 times, stable. Verified red against the previous `SendOtp` (10 delivered, 15 delivered, 8 delivered). In-process deterministic tests too: a hasher whose `make()` re-enters `SendOtp::handle` (same phone gets `otp_cooldown`; the 11th send from the IP gets `otp_rate_limited`), refund and cooldown cases, reserved-count captcha.

### Minors
1. `#[SensitiveParameter]` on every parameter that carries the code or message: `SendOtp::deliver/store`, `OtpDelivery::send` and its implementations, `VerifyOtp::handle`. Tests: the trace of an exception from a driver and of a `VerifyOtp` refusal does not contain the code (frames show `Object(SensitiveParameterValue)`), plus a reflection check of all nine parameters.
2. A Cloudflare outage now answers `captcha_unavailable` (503), told apart from a rejected token by the rule's own `auth.captcha_unavailable` message; fail-closed stays, set by the existing `TurnstileToken(…, failOpen: false)`.
3. New `OtpCodeGenerator` (injectable integer source, `random_int` by default). Deterministic tests for 0, 7, 4521, 123456, 999999 (leading zeros, hash, message) and for the range handed to the source (0, 999999), which kills the `100000` mutant.
4. The SQL-copy test is gone. `VerifyOtp` is exercised for real: a sequential test (five wrong, then locked, then expired, right code included) and the parallel tests (5 parallel right codes: 1 consumed, 4 `otp_expired`; 12 parallel wrong codes: exactly 5 `otp_invalid`, attempts = 5, not consumed).
5. Session count is windowed: `otp.sends` (count) with `otp.sends_since` (window start); a count older than an hour is read as 0 and restarts on the next send. `otp.sends` keeps its meaning.
6. The `Throwable` catch left `User::sendPasswordResetNotification` (it throws again for other callers; tested). New `App\Http\Controllers\Auth\PasswordResetLinkController` (extends Fortify's, bound in `FortifyServiceProvider`) wraps the `sendResetLink` call: report, then the generic answer. HTML and JSON tested.

### Queued
- A. `OtpDelivery::send(OtpChannel $channel, string $e164, string $message, string $code, string $otpId)`, `message` and `code` sensitive. `ArrayOtpDelivery::sent()` entries gained `code`; `lastCode()` reads it. Done.
- B. `PhoneNumberParser::defaultRegion(Settings)`: business address country, else the first allowed country, else an unknown region; `SendOtp` and `RateLimitKey` both use it, the literal `IN` is gone from `RateLimitKey`. Test in `RateLimitersTest`.

### For spec 19
- 13 §4.2 step 7 / 12 `OtpCode` notification: `OtpDelivery::send` takes the bare `$code` as well as the finished `$message` (WhatsApp authentication templates need the code as a parameter).
- 13 §4.2 steps 2, 3, 6: cooldown, hourly counters and the global counter are reserved at the start (atomic add / increment-then-compare) instead of read at step 2 and hit at step 6; refused sends give them back, a failed delivery keeps the cooldown.
- 13 §4.1/§4.2 step 3: the session count `otp.sends` is windowed to one hour (`otp.sends_since`).
- 13 §3: a Turnstile outage on OTP send answers `captcha_unavailable` (503); `captcha_required` is only for a missing or rejected token.
- 13 §5.5: the queue-outage tolerance of the reset link lives in `PasswordResetLinkController`, not on `User`.
- Cooldown cache key is `otp:cooldown:{sha256(e164)}`.

### Results
- `vendor/bin/pint --test` passed; `vendor/bin/phpstan analyse --no-progress --memory-limit=1G` `[OK] No errors`.
- `vendor/bin/pest tests/Unit tests/Feature`: 2940 passed, 1 skipped (the Task 26 skip), 11399 assertions.
- OTP suites alone: `vendor/bin/pest tests/Feature/Auth/Otp tests/Unit`: 371 passed.

### Notes
- The verify-side limiters (`otp-verify` ip and phone) are still check-then-hit; the review did not ask for them to change. Attempt counting and consumption (the SQL) are atomic as before.
- The concurrency tests skip themselves when Redis is unreachable.

## Fix round 2

Re-review: `task-27-rereview-1.md` (N1 to N4).

- **N1 (hour-boundary flake).** `SendOtpTest` pins the clock at 2026-10-21 12:20:00 UTC in `beforeEach` (`travelTo`) before any clock arithmetic. `OtpConcurrencyTest` pins the parent the same way and passes `OTP_WORKER_NOW` to the workers, which `Carbon::setTestNow` it in `tests/Support/otp-worker.php`, so parent and workers compute the same `otp:global:{YmdH}` key. Scan of the other OTP tests: the only per-clock-hour state is the global counter key; the others (rate-limiter windows, cooldown, monitor, prune, verify) use relative windows or already `freezeTime()`, so nothing else depends on the turn of an hour or minute. The `takes the cap from the auth settings` test travels 61 minutes to reach a new hour, which is now deterministic (12:20 to 13:21).
- **N2 (refund abuse).** On delivery failure `SendOtp` refunds only the phone and global counters; the IP count and the cooldown stay. `OtpDelivery::send` and `OtpDeliveryException` now state that throwing means "definitely not sent" (an unsure outcome, such as a timeout after the request left, must count as sent: return normally). Tests: 10 forced-failure sends from one IP to 10 numbers all give `otp_send_failed`, the 11th gives `otp_rate_limited`; with the captcha on, the third forced failure from one IP gives `captcha_required`; the unexpected-throwable test also keeps the IP count. The earlier "counters given back" test was changed accordingly.
- **N3 (typed signal).** `TurnstileToken` gets a public `$unavailable` flag, reset at the start of `validate()` and set when Cloudflare cannot be reached or answers 5xx (open or closed). `SendOtp` keeps the rule instance and throws `captcha_unavailable` (503) when the flag is set, `captcha_required` otherwise; no translated text is compared. Unit tests in `TurnstileTokenTest` (unreachable, 503, answered, captcha off).
- **N4 (Redis).** `OtpConcurrencyTest` no longer flushes DB 15. Each test gets a unique cache prefix (`otp-test-{random}`), builds its own cache store and limiter with it (`Cache::build`), passes it to the workers as `CACHE_PREFIX`, and deletes only keys that match it (the Redis client's own prefix is stripped before `del`). After a run no `otp` keys are left in DB 15.

### Results
- OTP suites (`tests/Feature/Auth/Otp`, `tests/Unit/Rules`, plus the earlier unit suites): 154 passed, twice in a row; `vendor/bin/pest --parallel tests/Feature/Auth/Otp`: 126 passed (4 processes).
- `vendor/bin/pint --test` passed; `vendor/bin/phpstan analyse --no-progress --memory-limit=1G` `[OK] No errors`.
- `vendor/bin/pest tests/Unit tests/Feature`: 2946 passed, 1 skipped (the Task 26 skip), 11423 assertions.

### For spec 19
- 13 §4.2 step 7: `OtpDeliveryException` means "definitely not sent"; delivery failure refunds the number's and the system's hourly counters, not the IP's, and keeps the cooldown.
