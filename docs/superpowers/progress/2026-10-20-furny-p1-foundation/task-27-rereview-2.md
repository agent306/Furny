# Task 27 re-review 2: fix round 2 (`aeeaba0..0a1900f`)

I read the whole of `review-aeeaba0..0a1900f.diff` (656 lines, one commit, 8 files). All checks below ran in a scratch copy with its own Postgres DB and its own Redis DB 9. The copy, the DB and the Redis keys are deleted. The worktree is unchanged. To run tests at a set wall-clock time I installed `faketime` (libfaketime) temporarily and removed it afterwards.

## Finding Verdicts

- **N1 (Important): the hour-boundary test was flaky.** **ADDRESSED.**
  - `SendOtpTest.php` `beforeEach` pins the clock at 12:20:00 UTC with `travelTo`.
  - `OtpConcurrencyTest.php` pins the parent the same way and passes `OTP_WORKER_NOW` to the workers. `tests/Support/otp-worker.php` calls `setTestNow` with it, so parent and workers compute the same `otp:global:YmdH` key.
  - The two previously flaky tests, plus everything else in `SendOtpTest` and `OtpConcurrencyTest` (80 tests in all), were run under `faketime` at three wall-clock times:

    | Run | Wall clock | Result |
    |---|---|---|
    | As committed | 11:58:00 | 80 passed |
    | As committed | 11:59:55 | 80 passed |
    | As committed | 12:00:00 | 80 passed |
    | Control: `travelTo` pin removed from `SendOtpTest` | 11:58:00 | "refuses a number over its hourly limit …" fails again |

    The control shows the harness reproduces the original failure, and that the pin is what fixes it.
- **N2 (Minor): forced delivery failures gave one IP unlimited attempts.** **ADDRESSED.**
  - On delivery failure, `SendOtp` drops the IP entry before refunding (`unset($counters['ip'])`, `SendOtp.php` delivery `catch`). So only the phone and global counters are given back. The IP count and the cooldown stay.
  - `OtpDelivery::send`'s `@throws` and the `OtpDeliveryException` docblock now say "definitely not sent", and that an unsure outcome must return normally.
  - I re-ran the forced-failure probe from one IP. Every channel threw `OtpDeliveryException`, each send ran in its own process and session, and the counters lived in real Redis:

    | Case | Results | Counters after |
    |---|---|---|
    | Captcha on, 12 sequential sends to 12 numbers | 2 `otp_send_failed`, then 10 `captcha_required` | IP 2, global 0 |
    | Captcha off, 12 sequential sends | 10 `otp_send_failed`, then 2 `otp_rate_limited` | IP 10, global 0 |
    | Captcha off, 15 parallel sends | 10 `otp_send_failed`, 5 `otp_rate_limited` | IP 10 |
    | A working send from that IP afterwards | `otp_rate_limited` | — |
    | Same number from another IP after a failure | `otp_cooldown` | — |

  - Regression check, 10 parallel sends with a working delivery to one number from one IP: 1 sent, 9 `otp_cooldown`.
- **N3 (Minor): `captcha_unavailable` was detected by comparing message text.** **ADDRESSED.**
  - `TurnstileToken` has a public `$unavailable` flag. It is reset at the start of `validate()` and set only in `unavailable()`, which runs on a connection error or a 5xx, whether the form fails open or closed.
  - `SendOtp::assertCaptcha` keeps the rule instance and branches on `$rule->unavailable`. No translated text is compared any more.
  - `tests/Unit/Rules/TurnstileTokenTest.php` passed in the scratch copy (28 tests). It covers unreachable, 503, answered, rejected and captcha-off. The `SendOtpTest` test "fails closed when Cloudflare cannot be reached" still expects `captcha_unavailable` (503) and passed in the faketime runs.
- **N4 (Minor): `OtpConcurrencyTest` flushed the whole Redis cache DB.** **ADDRESSED.**
  - The `flushdb()` calls are gone. Each test builds its own cache store and limiter with a random prefix, `otp-test-{hex}` (`Cache::build`). The workers get the same prefix through `CACHE_PREFIX`. `afterEach` deletes only the `{prefix}*` keys, stripping the client prefix before `del`.
  - After five faketime runs of the concurrency suite against Redis DB 9 (empty beforehand), the DB was still empty, so nothing leaked out of the prefix.

## New Breakage in the Fix Diff

None.

- The `$counters` array is now keyed by `phone`, `ip` and `global`, and every `release` caller takes it as is.
- The refusal path before delivery still refunds all three counters and frees the cooldown, which the existing dataset test covers.
- The workers' frozen clock does not affect Redis TTLs: `put` and `add` turn their TTLs into relative seconds.

## Out-of-Scope Observations

None.

## Verdict

**Fix round:** All findings addressed, no new Critical or Important breakage. Every finding from the review and from both re-reviews (Important 1, Minors 1–7, queued A and B, N1–N4) is now closed.
