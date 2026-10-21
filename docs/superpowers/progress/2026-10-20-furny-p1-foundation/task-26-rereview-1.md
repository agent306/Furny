# Task 26 re-review 1: fix round 1 (`63b28b5..1b598cb`, one commit, 22 files)

I read the diff file once and did not run git. The worktree was not modified (`git status` is clean). The timing, payload, race and mutation runs all ran in a scratch copy at `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/rr1` with its own autoloader, so it loads its own `app/`. It uses the `furny_test` database, with every row deleted afterwards.

### Finding Verdicts

The finding numbers are the Minor items 1 to 10 of `task-26-review.md`, which the brief calls M1 to M10.

1. **Time-box test cannot fail** — ADDRESSED, by removal. `FortifyRouteGuards.php:62-77` no longer has a Timebox. The `auth.password_reset_timebox_microseconds` key and the test setting are gone: a grep of `app`, `config`, `tests`, `resources`, `lang` and `docs` finds no remaining reference. The test with the dead title is deleted (`ForgotPasswordTest.php:182-196`). `QueuedAuthMailTest.php:25-31` now checks what replaced it: the request sends nothing and answers the same for known and unknown addresses.
2. **Recent-auth guard: case and absent-field rules untested** — ADDRESSED. `ProfileInformationTest.php:61-79` adds both cases with `loginHoursAgo(3)`. Mutation checks, both killed:
   - Case-sensitive compare (`FortifyRouteGuards.php:116`) fails "needs no recent authentication when the email differs only by case or by spaces".
   - Absent `email` treated as a change (`:107`) fails "needs no recent authentication when the email is not sent".
3. **Plaintext reset token flashed into the session** — ADDRESSED. `bootstrap/app.php:137` lists `token` in `dontFlash`. The test at `ResetPasswordTest.php:214-219` fails when I delete that entry.
4. **Residual timing and error side channels from the synchronous SMTP send** — ADDRESSED (Ruling B). Both mails are queued and `ShouldBeEncrypted` (`ResetPassword.php:19`, `VerifyEmail.php:21`).
   - Measured with a deferred queue: see the timing section.
   - An unreachable SMTP host no longer reaches the request (`QueuedAuthMailTest.php:34-44`).
   - A small residue remains: see Observation 3.
5. **Timebox holds a PHP worker per forgot-password POST** — ADDRESSED. Only the broker's 200 ms box remains. A throttled request takes ≈ 2 ms.
6. **`lockForUpdate` untested** — ADDRESSED (Ruling A). `ContactVerification.php:150-178` has no lock. A single conditional `UPDATE … WHERE first_contact_verified_at IS NULL`, whose affected-row count is compared with `=== 1`, decides which verification is first. See the race section.
7. **`markEmailVerified` does not guard a null email** — ADDRESSED. `ContactVerification.php:135-137` returns early. `ContactVerifiedTest.php` "has nothing to verify for an email that is not there" covers it.
8. **`account.email_verified` audit properties differ from 13 §17** — ADDRESSED as a deliberate deviation. `{email: masked}` is kept, and the report (C, M8) puts the 13 §17 `from`/`to` wording on the spec-fix list for 19. The review asked only for the deviation to be on record.
9. **Two misleading test titles** — ADDRESSED. `ProfileInformationTest.php:194` now says the user signs in with the new email, and `PasswordUpdateTest.php:179` says "is written once for each change of the password". Each matches what its test asserts.
10. **Turnstile-only error does not move focus** — ADDRESSED.
    - `TurnstileWidget.vue` has `tabindex="-1"` on its root.
    - Forgot and Register pass `aria-invalid` for a captcha-only error.
    - The focus assertion is added to `errors.test.ts`; the file passes (17 tests).

### Controller rulings

- **A. `first_contact_verified_at`, conditional UPDATE, dispatch after commit only on 1 row changed: sound.**
  - The migration edit in place is accepted, as ruled.
  - The model docblock and cast, the factory states and the schema-test column list are consistent.
  - Mutation checks, killed:
    - Dropping `whereNull` fails 8 tests in `ContactVerifiedTest`.
    - Never dispatching fails 9 tests in `ContactVerifiedTest`.
  - Behaviour I checked: a verified email changed and then re-verified dispatches nothing, both at model level and over the whole HTTP path.
- **B. `ShouldQueue` + `ShouldBeEncrypted`, app Timebox removed: sound.**
  - Laravel's `SendQueuedNotifications` copies `shouldBeEncrypted` from the notification (`SendQueuedNotifications.php:120`), so the flag takes effect.
  - Dropping the interface in either notification fails `QueuedAuthMailTest` (killed for both).
  - `UpdateUserProfileInformation` sends the verification mail after the transaction closes (`:75-77`), so a queue without `after_commit` cannot run ahead of the commit.
- **Accepted reading of M2: confirmed.** An email that differs only by case or spaces, or an absent field, needs no recent auth. Both are now pinned by tests and killed by the mutants above.

### Checks I ran

- **`vendor/bin/pest tests/Feature/Auth`**: 511 passed, 1 skipped, 1771 assertions. The skip is the known `auth.reauthenticate` one.
- **Forgot-password timing** (scratch copy, 15 samples each, a different IP per request so the IP limiter does not interfere, a distinct user per sample, array mailer, queue not sync):

  | Queue | Known | Unknown | Throttled (same email, over the hourly limit) |
  |---|---|---|---|
  | database | median 203.6 ms (203.4–204.7) | median 203.3 ms (203.1–204.6) | median 1.7 ms (1.6–3.3) |
  | redis | median 203.6 ms (203.3–204.9) | median 203.4 ms (203.2–204.1) | median 1.7 ms (1.6–2.1) |

  - Known and unknown differ by ≈ 0.3 ms, which is indistinguishable. The broker's 200 ms Timebox holds both.
  - All 18 database-queue requests that should send did queue a job (`jobs=18`). The mail was not sent in the request.
  - The throttled path takes ≈ 2 ms; see Observation 2.
  - Practical warning for anyone repeating this: the `password-reset` limiter is 3/hour per email and 10/hour per IP. Reusing one IP makes later samples silently throttled, which looks like a fast "known" result.
- **Queued payload** (database and redis queues, `queue:work --once` run for each):
  - `displayName` is `App\Notifications\Auth\ResetPassword`, and `data.command` starts with `eyJpdiI6…` (an encrypted blob).
  - The plaintext token (64 characters, taken from the mail the worker actually delivered) is not in the payload.
  - The address `asha@` is not in the payload either.
  - `Crypt::decrypt` of the command gives a serialised object that does contain the token. So the payload is really encrypted and the job really runs.
- **Race safety** (`race.php` in the scratch copy: real Postgres, `default_transaction_isolation` is read committed, `pcntl_fork` children, each with a fresh connection and a spin barrier, 30 rounds per scenario). Dispatches per round:

  | Scenario | Dispatches per round |
  |---|---|
  | email + phone verified concurrently | 1 in 30/30 rounds |
  | email + email (two clicks of the link) | 1 in 30/30 rounds |
  | email + phone, 80 ms pause injected after the first write | 1 in 30/30 rounds |
  | email + email, 80 ms pause injected after the first write | 1 in 30/30 rounds |
  | **Control**: a check-then-set implementation with a 60 ms gap | 2 in 30/30 rounds |

  The control shows the harness can see a double dispatch. Mechanism: `save()` takes the row lock, so the second transaction waits for the first commit and then re-evaluates `WHERE first_contact_verified_at IS NULL` against the committed row, finds 0 rows, and does not dispatch.
- **Focused mutation runs on the fix's new tests**: nine mutants, all killed (list above).
- **`vitest run errors.test.ts`**: 17 passed.

### New Breakage in the Fix Diff

- **Minor: `OwnerSeeder` sets `email_verified_at` directly and not `first_contact_verified_at`** (`database/seeders/OwnerSeeder.php:76`, a file the fix did not touch).
  - Before the column, "first" was derived from the two timestamps, so the seeded owner would not have triggered `ContactVerified` when a phone was verified later.
  - Now the seeded owner's `first_contact_verified_at` is null, so their first later verification (a phone, or a reset) dispatches `ContactVerified` once.
  - Today nothing listens (the grep of `app/` finds only the event, `ContactVerification` and `EnsureContactVerified`), and the owner is staff.
  - Fix: set `first_contact_verified_at` in the seeder. Any later path that creates users already verified (Google, invitation) must do the same or go through `ContactVerification`.
  - It does not block this task.

No Critical or Important issues.

### Out-of-Scope Observations (non-blocking)

1. **Spec follow-ups for 19**: `02 §1.1` needs the `first_contact_verified_at` row, and 13 §17 needs `account.email_verified` corrected to `{email}`. Both are already in the report.
2. **Throttled forgot-password is now ≈ 2 ms against ≈ 203 ms for the others.** The app Timebox that evened this out was removed under Ruling B. It is not an account-existence oracle, because the limiter counts unknown addresses the same way. It only tells a caller that the hourly limit on that address or IP has been reached, which the caller who hit it already knows. If 13 §5.5's "silent" means indistinguishable in time as well, it needs a floor for the throttled path (for example, a `Timebox` of 200 ms around the limiter's refusal).
3. **Queue push failure is an oracle during a queue outage.** The push happens only for a known address, so an outage would give a 500 for a known address and the generic 302 for an unknown one. This is read from the code and not exercised. It is far narrower than the SMTP case this fix replaced, and a worker or queue monitor is the usual answer.
4. The deferred cross-task items from the review still stand: the passwordless `auth.reauthenticate` redirect, the `verification.send` inline 429 on the future `VerifyContactBanner`, and the Pest browser 3xx hang.

## Verdict

**Fix round: all findings addressed, no new Critical/Important breakage.**

**APPROVED**
