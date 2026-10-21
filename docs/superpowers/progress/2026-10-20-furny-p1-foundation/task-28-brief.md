### Task 28: Google OAuth

**Files:**
- Create: `app/Http/Controllers/Auth/GoogleController.php`; `resources/js/components/auth/GoogleButton.vue`
- Modify: `config/services.php` (`google`), `routes/web.php` (`auth.google.redirect`, `auth.google.callback`, `account.google.unlink`), `resources/js/pages/Auth/{Login,Register}.vue` (Google button + caption), `resources/lang/en/{auth,auth_ui}.php`, `route-access.php`
- Test: `tests/Feature/Auth/GoogleOAuthTest.php`, `resources/js/components/auth/__tests__/GoogleButton.test.ts`

**Spec refs:** `13 §5.3`, `§5.4`, `§5.9` step 4, `§6.2`, `§17` (`auth.google_linked`, `auth.google_unlinked`), `§20.7`; master §6.7 (`features.google_login`); P1-D11

**Interfaces:**
- Consumes: Tasks 23–26 (`IntendedRedirect`, `ContactVerification`, `CustomerRegistered`).
- Produces: `GET /auth/google/redirect?intent=login|link|invitation|reauthenticate` (throttle `oauth`; 404 when `features.google_login` is false; `link`/`reauthenticate` require auth; `invitation` requires session `invitation.id`), stateful Socialite with scopes `openid profile email` and `prompt=select_account`; callback branches of `13 §5.3` steps 1–7 plus `reauthenticate` (Google id must equal the current user's → session `auth.password_confirmed_at = now()`, redirect intended; else `auth.errors.google_email_mismatch`); for `invitation` the callback stores session `invitation.google_id` + name prefill and redirects to session `invitation.url`; `DELETE /account/google` (`recent.auth`) unlinks only when a password or verified phone remains (else 422 `auth.errors.last_login_method`).

- [ ] **Step 1: Write the failing tests** (Socialite mocked via `Socialite::shouldReceive('driver')`)
  - `?error=access_denied` → redirect `login` with `auth.errors.oauth_cancelled`; `InvalidStateException` → `auth.errors.oauth_state_invalid`; other exception → `auth.errors.oauth_failed` + warning log; `email_verified: false` → `auth.errors.google_email_unverified`.
  - intent `login`: known `google_id` → logged in (customer with remember); unknown id but email `Asha@Example.com` matching `asha@example.com` → links `google_id`, sets `email_verified_at`, audits `auth.google_linked` (Review Focus 1); soft-deleted match → `auth.errors.account_pending_deletion`; inactive → `auth.inactive`; email with a pending staff invitation → `auth.errors.pending_staff_invitation` and no user created; new email → customer created (`password null`, `terms_accepted_at` set, `email_verified_at` set, name fallback = part before `@` when Google name is empty), `CustomerRegistered` and `ContactVerified` dispatched; registration closed → `auth.registration_closed`; staff with confirmed 2FA → not logged in, session `login.id` set, redirect `two-factor.login`; staff without 2FA → logged in without remember; session id regenerated.
  - intent `link`: id used by another user → `auth.errors.google_in_use`; different email → `auth.errors.google_email_mismatch`; phone-only user → email set + verified unless taken (`auth.errors.email_unavailable`).
  - intent `invitation`: without session `invitation.id` → 403; email ≠ invitation email → `auth.errors.google_email_mismatch`; match → session `invitation.google_id` set, redirect to `invitation.url`.
  - intent `reauthenticate`: matching id → `auth.password_confirmed_at` set; mismatch → error.
  - unlink: without recent auth → redirect `password.confirm`; user with password → unlinked + `auth.google_unlinked`; Google-only user without phone → 422 `auth.errors.last_login_method`.
  - `features.google_login = false` → redirect route 404.
  - Vitest: `GoogleButton` renders only when `features.google_login` and shows the terms caption.
- [ ] **Step 2: Run, expect FAIL** — `vendor/bin/pest tests/Feature/Auth/GoogleOAuthTest.php && yarn vitest run resources/js/components/auth`
- [ ] **Step 3: Implement** — per Interfaces.
- [ ] **Step 4: Run tests, expect PASS** — same as Step 2.
- [ ] **Step 5: Quality gates** — Gates-PHP, Gates-JS, Gates-Gen.
- [ ] **Step 6: Commit** — `git add app/Http/Controllers/Auth config/services.php routes/web.php resources tests` → `feat(auth): Google OAuth login, linking, invitation and re-authentication intents` + trailer.

