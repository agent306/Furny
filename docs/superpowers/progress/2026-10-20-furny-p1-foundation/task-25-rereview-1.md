# Task 25 re-review 1 (fix round 1: 04a4912..fe18e24)

The diff was read in one pass. Probe tests and timing runs were done in the scratch copy `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/mut`, refreshed to fe18e24. The scratch probe files were deleted afterwards. The worktree is untouched (`git status` is clean).

### Finding Verdicts

- **Important 1: login timing revealed which emails exist under php-fpm.** ADDRESSED.
  - `app/Actions/Fortify/AuthenticateUser.php:27` wraps the work in a `Timebox`, configured by `config/auth.php` `login_timebox_microseconds` (200 ms).
  - `:57` makes one `Hash::check` on every failing path.
  - `:76` keeps the placeholder hash in the cache, so it is never made per request.
  - Re-measured at bcrypt cost 12, with a warm cache and 9 runs each:

    | Time box | Wrong password (median) | Unknown email (median) |
    |---|---|---|
    | 200 ms | 200.3 ms | 200.3 ms |
    | 0 ms | 195.6 ms | 195.7 ms |

    Before the fix, the numbers were 198 ms and 396 ms.

- **Important 2: focus did not move to the first invalid field after submit.** ADDRESSED.
  - `resources/js/composables/useFocusFirstError.ts` adds the behaviour.
  - Both forms call it on `@error`: `Login.vue` (`@error="focusFirstError"`) and `Register.vue` (`onError`).
  - Covered by `pages/Auth/__tests__/errors.test.ts`, which checks page order and the Turnstile reset.
  - Focused vitest run: 45/45 passed.

- **Minor 1: no test for the after-commit behaviour.** ADDRESSED.
  - `tests/Feature/Auth/AfterCommitTest.php` covers commit and rollback for both `CustomerRegistered` and `Welcome`.

- **Minor 2: the captcha error was not linked.** ADDRESSED.
  - The widget root now has `role="group"`, an `aria-label`, and an `aria-describedby` that points at `captcha-error` (`TurnstileWidget.vue`, `Register.vue`).

- **Minor 3: required fields had no visual marker.** ADDRESSED.
  - `components/common/RequiredMark.vue` is an `aria-hidden` asterisk.
  - It is on every required label of both forms, and not on the remember or marketing boxes.

- **Minor 4: the password `aria-describedby` could point at a hint that was not rendered.** ADDRESSED.
  - `Register.vue` `describedBy()` lists only the ids that are rendered. Tested.

- **Minor 5: missing TDD evidence.** CLOSED.
  - This was a process note. The fix report now gives mutation evidence for every fix.

Controller items in this round:

- **Profile and password features off until Task 26.** Done.
  - `config/fortify.php` no longer enables them.
  - `FortifyConfigTest` asserts both features are off and both routes are absent.
  - The `route-access.php` entries are removed.

- **Device-only logout.** Done, and verified with probes:
  - **CSRF:** the gathered middleware order for route `logout` is: `EncryptCookies > AddQueuedCookiesToResponse > StartSession > ShareErrorsFromSession > PreventRequestForgery > Authenticate:web > AuthenticateSession > SubstituteBindings > HandleAppearance > HandleInertiaRequests > AddLinkHeadersForPreloadedAssets > TrackSession > FortifyRouteGuards`. With `env=local` (so the CSRF bypass for unit tests is off), a signed-in POST to `/logout` with no token returns 419. The user stays signed in and no `auth.logout` is written.
  - **Inertia:** POST returns 302 to `/`, sets `inertia.clear_history` to true, and writes the audit entry.
  - **JSON:** returns 204 and writes the audit entry.
  - **Audit:** `RecordLogout::handle(Logout|CurrentDeviceLogout)` at `app/Listeners/RecordLogout.php:23` is discovered once for each event (`FortifyConfigTest`).
  - **Remember token:** stays the same, this device's recaller cookie is forgotten, and device B's cookie still signs in (`LoginTest`, `RevokedDeviceTest`).

- **Inline 429 countdown.** Done.
  - `RateLimitedResponse::INLINE_ROUTES` sends `login.store` and `register.store` back with the validation error `rate_limited` and no toast.
  - `useThrottleCountdown` and `ThrottleNotice` show the countdown. `Alert` has `role="alert"`; the countdown itself is `aria-hidden`, and a static `sr-only` copy is what gets announced.
  - The submit button is disabled until the countdown reaches zero.

### New Breakage in the Fix Diff

- **Important: the "exactly one hash check" test is false-green for the correct password, and a successful login runs the check twice.**
  - Where: `tests/Feature/Auth/LoginTest.php:502-513` (dataset row `'the right password'`).
  - What happens on a correct password without 2FA: Fortify calls the `authenticateUsing` callback twice. `RedirectIfTwoFactorAuthenticatable::validateCredentials` calls it once, then `AttemptToAuthenticate::handleUsingCustomCallback` calls it again.
  - Result: two `Hash::check` calls and two time boxes, so at least 400 ms per successful login.
  - A probe with a counting hasher saw `checks=2` on success.
  - With the test's `shouldReceive('check')->once()`, the second call throws inside the request. Laravel turns that into a 500, the probe saw `status=500 authed=no`, and the test still passes because it never asserts the response.
  - Failing paths are not affected: the first call throws or returns null, so the check runs once there. The enumeration fix holds.
  - The problem is twofold:
    - The test asserts nothing for that dataset row.
    - The report's claim "exactly one `Hash::check` on every path … success" is false.
  - Fix:
    - Memoise the result per request in `AuthenticateUser::handle`, for example in `$request->attributes`, so the second pipeline call reuses it.
    - Make each dataset row assert its response: a redirect to the dashboard for success, `auth.failed` or `auth.inactive` otherwise.

- **Minor: forced revocation now also writes `auth.logout`.**
  - Where: `app/Listeners/RecordLogout.php:23`.
  - Because the listener now also handles `CurrentDeviceLogout`, these paths write an extra entry:
    - `ForcedLogout` with reason `session_revoked` (`app/Support/Auth/ForcedLogout.php:29`) now records the user as logging themselves out.
    - Revoking the current device from the device list (`app/Domain/Identity/Actions/RevokeSessions.php:45`) now writes `auth.logout` in addition to `auth.sessions_revoked`.
  - Fix: either have `FortifyRouteGuards::logout` write the audit itself, or have the listener skip `auth.logout` when the session is already marked revoked.

- **Minor: the guest branch in the logout guard never runs.**
  - Where: `app/Http/Middleware/FortifyRouteGuards.php:44`.
  - Middleware priority sorts `Authenticate:web` ahead of `FortifyRouteGuards`, so a guest never reaches this branch.
  - It is harmless, but the comment describes an order that does not exist.

- **Minor: the placeholder cache read happens only on the unknown-email and passwordless paths.**
  - Where: `AuthenticateUser.php:57,76`. The `??` is lazy, so the cache read (a Redis GET in production) only runs when there is no user or no password.
  - The time box hides this. A residual of under 1 ms would show only if bcrypt ever took longer than the time box.
  - Fix: read the placeholder unconditionally before the check.

- **Design note (non-blocking): rebinding the controller would be cleaner.**
  - The interception is safe as built: CSRF, auth, JSON, Inertia and audit were all verified above.
  - It would be cleaner to bind `Laravel\Fortify\Http\Controllers\AuthenticatedSessionController` to an app subclass whose `destroy()` calls `logoutCurrentDevice()`.
  - Advantages:
    - Fortify's route and its middleware stay authoritative.
    - The logic runs inside the route action.
    - The global web-group middleware no longer special-cases a route name.
  - Recommended for the Task 26 or final pass, not as a blocker.

### Out-of-Scope Observations

None.

### Verdict

**Fix round:** Findings remain open. All original findings are addressed. One new Important issue is open: the success path runs `AuthenticateUser` twice, and the one-check test is false-green because a 500 goes unasserted (`tests/Feature/Auth/LoginTest.php:502-513`).
