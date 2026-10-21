# Task 25 re-review 2 (fix round 2: fe18e24..4f1f6b6)

I read the diff in one pass. The probes and mutations ran in the scratch copy `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/mut`, refreshed to 4f1f6b6, and the probe files were deleted afterwards. The worktree is untouched (`git status` is clean).

### Checks run

- **Full suite:** `vendor/bin/pest tests/Unit tests/Feature` in the worktree at 4f1f6b6 gave **2647 passed (10215 assertions)** in 95.9 s with exit 0. There were no warnings or deprecations in the output. This matches the implementer's count, and the last-added test is now confirmed in a full run.
- **Memo leak probe:** a Feature test ran three logins in one long-running test process:
  1. User A, right password.
  2. User A again, same credentials, as a new request.
  3. User B, wrong password.

  Result: the counting hasher saw `checks=2` for requests 2 and 3, so the memo was not reused across requests. User B got `auth.failed` and stayed a guest. The memo attribute was absent from `app('request')` afterwards.
- **Mutations** (on `tests/Feature/Auth`):

  | # | Mutation | Result |
  |---|---|---|
  | R1 | Turn off the memo | killed (2) |
  | R2 | Memo ignores the credential key | killed (1) |
  | R3 | Placeholder read lazily again (`?? self::placeholderHash()`) | **survived** |
  | R4 | Controller uses `logout()` | killed (2) |
  | R5 | Controller does not set `USER_INITIATED` | killed (3) |
  | R6 | Listener always audits | killed (4) |
  | R7 | Controller binding removed | killed (5) |
  | R8 | Controller does not invalidate the session | killed (1) |

### Finding Verdicts

From re-review 1:

- **Important: the success path ran `AuthenticateUser` twice, and the one-check test was false-green.** ADDRESSED.
  - `app/Actions/Fortify/AuthenticateUser.php:40-58` memoises `{key, user}` in `$request->attributes`. The key is the sha256 of the normalised email and the password.
  - The second call Fortify makes for the same login reuses the answer.
  - `tests/Feature/Auth/LoginTest.php:459-500` counts checks through `Tests\Support\CountingHasher`, which subclasses `HashManager` and calls the real hasher. Every row asserts exactly one check and no make, plus its response: the dashboard redirect, `auth.failed` or `auth.inactive`.
  - New tests cover reuse across the two calls (`:502`) and no reuse for other credentials (`:513`).
- **Is the memo per request?** Yes.
  - It lives only in the attributes of the `Request` instance Fortify passes through its pipeline. There is no static state.
  - The key is bound to the credentials, which R2 checks.
  - Octane and the test harness create a new `Request` for every request, and the probe above confirms nothing is carried over.
  - An inactive account is not memoised because the exception leaves before `set`, but Fortify's pipeline stops at that first throw, so this costs nothing.
- **Minor: forced revocation also wrote `auth.logout`.** ADDRESSED.
  - `app/Listeners/RecordLogout.php` writes `auth.logout` only when the request attribute `RecordLogout::USER_INITIATED` is set. The new app controller sets it.
  - `tests/Feature/Auth/RevokedDeviceTest.php` checks that no entry is written for:
    - a revoked device;
    - a deactivated user;
    - an expired staff session;
    - the current device signed out from the device list, where `auth.sessions_revoked` is still written.
  - It also checks that one entry is written for each user logout, by form or by JSON (R5 and R6 are killed).
- **Minor: the guest branch in `FortifyRouteGuards` never ran.** ADDRESSED. The logout interception is removed from `app/Http/Middleware/FortifyRouteGuards.php`, and with it the branch and its comment.
- **Minor: the placeholder was read only on the unknown-email path.** ADDRESSED in code. `AuthenticateUser.php:84-85` reads `self::placeholderHash()` before every check. See the new Minor below for the missing test.
- **Design note: bind an app controller instead of intercepting.** ADDRESSED.
  - `app/Http/Controllers/Auth/AuthenticatedSessionController.php` extends Fortify's controller and is bound over it in `FortifyServiceProvider::register`.
  - Its `destroy()` does the following, in order:
    1. Sets `USER_INITIATED`.
    2. Calls `logoutCurrentDevice()`.
    3. Invalidates the session.
    4. Regenerates the CSRF token.
    5. Returns `LogoutResponse`.
  - Fortify's route and its `auth:web` middleware are unchanged, and `FortifyConfigTest` checks the controller and the middleware.
  - The tests now cover:
    - the CSRF 419, with the user still signed in and no audit entry;
    - the Inertia 302 to `/` with history cleared;
    - the JSON 204;
    - other devices' remember cookies still working (R4, R7 and R8 are killed).
  - The other routes that use this controller (`login`, `login.store`) inherit Fortify's methods unchanged.

All the findings from the first review stay closed (see re-review 1).

### New Breakage in the Fix Diff

- **Minor: no test pins the unconditional placeholder read.**
  - Where: `AuthenticateUser.php:84`.
  - Mutation R3, which makes the read lazy again, survives the suite.
  - The difference is a cache GET of under 1 ms, which the 200 ms time box hides. This does not block.
  - Fix: in the counting test, assert one cache read of the placeholder key on every row, for example with `Cache::spy()`.

### Out-of-Scope Observations

None.

### Verdict

**Fix round:** All findings are addressed, and there is no new Critical or Important breakage. One non-blocking Minor remains: no test pins the unconditional placeholder read (R3 survives).
