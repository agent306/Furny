### Task 24: Session registry, devices, recent authentication

**Files:**
- Create: `app/Support/Auth/{SessionRegistry,UserAgentSummary,SessionKey}.php`; `app/Http/Middleware/TrackSession.php`; `app/Http/Controllers/Auth/SessionController.php`
- Modify: `config/session.php` (driver/connection/encrypt/cookie from env per `13 §6.1`), `config/database.php` (redis `sessions` connection), `bootstrap/app.php` (append `TrackSession` and `AuthenticateSession` to `web`, alias `track.session`), `app/Providers/AppServiceProvider.php` (`Auth::guard('web')->setRememberDuration(20160)`), `routes/web.php` (`account.sessions.destroy`, `account.sessions.destroy-others`), `route-access.php`
- Test: `tests/Unit/Auth/UserAgentSummaryTest.php`, `tests/Feature/Auth/SessionRegistryTest.php`, `tests/Feature/Auth/SessionRoutesTest.php`

**Spec refs:** `13 §6.1–§6.4`, `§17` (`auth.sessions_revoked`), `§20.10`; master D29

**Interfaces:**
- Consumes: Tasks 22–23 (`Mask`, `recent.auth`).
- Produces: `SessionRegistry` (Redis connection `sessions`): `register(User $u, string $sessionId, Request $r, string $method, bool $remembered): void`, `touch(string $sessionId): void`, `list(User $u, ?string $currentSessionId): list<SessionEntry>` (`{key, uaSummary, ipMasked, lastActiveAt, isCurrent, method}`, prunes entries whose session no longer exists), `destroy(User $u, string $sessionKey): bool`, `destroyOthers(User $u, string $currentSessionId): int` (also rotates `remember_token`), `destroyAll(User $u): int` (rotates `remember_token`); `SessionKey::for(string $sessionId): string` (HMAC-SHA256 with `app.key`, first 32 hex chars — raw session ids never leave the server); `UserAgentSummary::from(string $ua): string` (`"{Browser} on {OS}"`, regex only); routes `account.sessions.destroy` (DELETE `/account/sessions/{sessionKey}`) and `account.sessions.destroy-others` (DELETE `/account/sessions`, `recent.auth`), both `['web','auth','active']`; audit `auth.sessions_revoked {count, reason}` in log `security`.

- [ ] **Step 1: Write the failing tests**
  - `UserAgentSummaryTest` dataset: Chrome/Windows → `'Chrome on Windows'`; Safari/iPhone → `'Safari on iOS'`; Firefox/Linux → `'Firefox on Linux'`; Edge/Windows → `'Edge on Windows'`; Chrome/Android → `'Chrome on Android'`; empty → `'Unknown browser on Unknown OS'`.
  - `SessionRegistryTest` (real Redis DB `REDIS_SESSION_DB`, keys cleaned in `afterEach`): two registered sessions are listed with `ipMasked '203.0.113.0'` and the current flagged; an entry whose session was destroyed in the handler disappears on `list()`; `destroyOthers()` leaves only the current one, returns 1 and changes `remember_token`; `touch()` updates `last_active_at` at most once per 60 s (`Carbon::setTestNow`).
  - `SessionRoutesTest`: `DELETE account.sessions.destroy-others` without recent auth → redirect `password.confirm`; with recent auth → other sessions revoked and activity `auth.sessions_revoked` with `properties.count = 1`; deleting another user's `sessionKey` → 404; `Auth::guard('web')->getRememberDuration() === 20160`.
- [ ] **Step 2: Run, expect FAIL** — `vendor/bin/pest tests/Unit/Auth tests/Feature/Auth/SessionRegistryTest.php tests/Feature/Auth/SessionRoutesTest.php`
- [ ] **Step 3: Implement** — keys `sess:user:{userId}` (ZSET) and `sess:meta:{sessionId}` (HASH, TTL `SESSION_LIFETIME` minutes, +14 days when remembered); destroying uses `Session::getHandler()->destroy($id)`.
- [ ] **Step 4: Run tests, expect PASS** — same as Step 2.
- [ ] **Step 5: Quality gates** — Gates-PHP.
- [ ] **Step 6: Commit** — `git add app/Support/Auth app/Http config bootstrap/app.php app/Providers/AppServiceProvider.php routes/web.php tests` → `feat(auth): session registry with device list and remote sign-out` + trailer.

