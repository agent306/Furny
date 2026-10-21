# Task 24 re-review, fix round 1 (0ef2ac8..71d383a)

Checks run: `vendor/bin/pest tests/Feature/Auth --parallel` (4 processes) gave 215 passed, 607 assertions, clean output. The fix report names its covering tests and shows output (2427 passed in the full run; 215 passed in parallel).

## Finding Verdicts

- **Important 1: revoked session resurrected and re-registered by an in-flight request** — ADDRESSED.
  - `revoke()` writes `sess:revoked:{id}` before it touches the handler (SessionRegistry.php:638-642). The TTL is max(remaining meta TTL, lifetime + 60 s).
  - `TrackSession::handle` checks the tombstone before `$next`, but only for an authenticated user (TrackSession.php:354-356, 365-378). It returns `ForcedLogout::toLogin(..., 'session_revoked')`. The `auth.session_revoked` string exists (resources/lang/en/auth.php) and the 401 `{code}` path is covered for machine clients.
  - `track()` returns on a tombstone instead of registering (SessionRegistry.php:524-528).
  - The touch is now one Lua script guarded by `EXISTS` (:471-478, :609-611). A touch racing a revoke cannot recreate a half-made meta, and the script fits the revoke order of tombstone, handler destroy, then forget.
  - Arithmetic check: the tombstone is written at revoke time with TTL ≥ lifetime + 60 s, and a resurrected payload lives at most `lifetime` after its save, so any in-flight request shorter than 60 s is covered.
  - The test TrackSessionTest.php:964-1004 reproduces the race. A route revokes its own session mid-request and the payload is saved again. It then asserts no meta, no ZSET member, and a redirect to login with a destroyed payload on the next request. The report's mutation check (disable the pre-request check, two tests fail) is plausible from the diff.
  - Residual points are listed under New Breakage.
- **Important 2: session key `auth.login_method` should be `auth.method`** — ADDRESSED (TrackSession.php:338). A test pins both keys (TrackSessionTest.php:851-854).
- **Important 3: `dbsize()` tests flake under `--parallel`** — ADDRESSED. They now assert on the test user's own keys (TrackSessionTest.php:911-921, 937-944). I ran the Auth suite with 4 parallel processes and it was green.
- **Queued: move the controller to `Account\SessionController` and add `RevokeSessions`** — ADDRESSED.
  - The controller is at app/Http/Controllers/Account/SessionController.php and routes/web.php imports it.
  - `RevokeSessions` (app/Domain/Identity/Actions/RevokeSessions.php:61-111) owns the registry call, the `auth.sessions_revoked` audit with the number of sessions really open, and `Inertia::clearHistory()`.
  - The audit causer is `Auth::user() ?? $user`, which covers staff acting on a customer. `RevokeSessionsTest` covers the count, the reason, the causer and the history clearing.
- **Queued: no `Auth::login`; re-queue the recaller cookie** — ADDRESSED (SessionController.php:180-186). The condition is cookie presence, not `viaRemember()`. The value is `id|token|hashPasswordForCookie(password)` with `guards.web.remember` minutes. The token is the rotated one, because `$user` is the same instance as the guard's. The new test uses `actingAs` plus a recaller cookie and asserts the cookie value and expiry, the same session id, and that `Login` was not dispatched. A second test asserts no cookie is queued when the request has none.
- **Minor 1: stale entry audited as 1 and flashed** — ADDRESSED. `destroyDevice()` returns 0 for a dead entry and null for an unknown one (SessionRegistry.php:566-579). The action skips the audit for 0 (RevokeSessions.php:115-117), and the controller still flashes success. Tested (SessionRoutesTest.php:1481-1493).
- **Minor 2: ZSET never pruned, and its TTL is last-writer-wins** — ADDRESSED.
  - `register()` prunes members older than lifetime + margin (SessionRegistry.php:496, 615-620).
  - The prune threshold is safe: the score is at most 60 s staler than the last request, and the margin is 60 s.
  - The ZSET TTL is raised only by `EXPIRE_AT_LEAST` and the touch script's `TTL` compare (:476, :481-484, :513).
  - Both behaviours are tested.
- **Minor 3: the remembered flag is rarely set** — ADDRESSED in the middleware. TrackSession.php:401 sets it for a request carrying the recaller cookie or `session('auth.remember') === true`. See the ledger note on `auth.remember` below.
- **Minor 4: the meta can expire before the session** — ADDRESSED. The TTL carries a 60 s margin (SessionRegistry.php:681) and a test covers it.
- **Minor 5: one Redis read per request** — Acknowledged, not a defect. It is now two round trips; see New Breakage.
- **Minor 6: test gaps** — ADDRESSED.
  - A login to logout end-to-end test was added (TrackSessionTest.php:1022-1042).
  - The stateless exclusion is asserted structurally through the gathered middleware stack plus the manifest behaviour (:925-944).
  - The literal `'15'` pin is gone.
- **Minor 7: DB 13 and 15 sharing** — ADDRESSED. `REDIS_SESSION_DB` is back to 13 with a comment (phpunit.xml diff), and the config test asserts it differs from the cache and default databases.
- **Minor 8: `save()` on token rotation** — ADDRESSED. It is now `forceFill(...)->saveQuietly()` (SessionRegistry.php:667), with a no-model-event test.

## New Breakage in the Fix Diff

No Critical or Important issues.

- **Minor: forced logout of a revoked session rotates the remember token for every device.** TrackSession.php:355 goes through `ForcedLogout::toLogin`, which calls `Auth::guard()->logout()` (ForcedLogout.php:427), and Laravel's `logout()` cycles `remember_token`. After the user signs out one device by single revoke, which the spec says does not rotate the token, that device's next request invalidates the remember cookies of all their other devices. This is not a security hole, only unexpected loss of persistence. Fix: for `session_revoked`, invalidate the session and forget the recaller cookie without cycling the token (a dedicated branch or a flag on `ForcedLogout`).
- **Minor: a window remains between the tombstone check and `register()`.** SessionRegistry.php:524-528. `track()` reads the tombstone, then registers non-atomically. A revoke landing between the two leaves a meta and ZSET member for a revoked id. If the in-flight request also resurrected the payload, `list()` shows a ghost device until that id is hit once more (forced logout destroys the payload) or the prune takes it. It self-heals and needs a very tight interleave. A small register script that checks `EXISTS sess:revoked:{id}` would close it.
- **Minor: tombstone TTL margin is 60 s.** SessionRegistry.php:640. An in-flight request that outlives 60 s after the revoke (an upload) can save a payload that outlives the tombstone. Consider a larger margin, for example the maximum request time.
- **Minor: two Redis round trips on every authenticated request.** `EXISTS` in TrackSession.php:372 plus `HMGET` in `touchIfKnown`. Fine at this scale; they could be pipelined later.
- **Minor: `auth.remember` is a new session key that 13 §5 does not name.** The login flow must set it, or the +14 d meta TTL never applies on the login request itself. At login the recaller cookie is not yet on the request, and `touch` never upgrades an existing meta's `remembered` flag. Task 25 should set the key, and the spec should be updated.

## Out-of-Scope Observations

- `RevokeSessions::all()` tombstones the acting user's own current session when `$user` is the actor. That user is forced out on their next request, with the "signed out of this device" message. Later callers (a password change by the signed-in user) should use `others()`. `all()` fits deactivation, reset and the other flows where the user is not the actor, or where signing out the current device is intended.
- `RevokeSessions` (a domain action) reaches for `Auth`, `session()` and `Inertia`. This is the controller's chosen layout and works, but it ties the action to an HTTP request, which matters when queued jobs call it later.
- Sessions that are absent from the user's ZSET (a failed registry write, or older than the registry) are not reached by "sign out all other devices". That follows from the registry design in 13 §6.3.

## Verdict

**Fix round:** All findings addressed, no new Critical/Important breakage.

**APPROVED**
