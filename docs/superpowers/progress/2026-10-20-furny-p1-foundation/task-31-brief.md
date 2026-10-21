### Task 31: Two-factor authentication enforcement

**Files:**
- Create: `app/Http/Middleware/{PreventRequiredTwoFactorDisable,PreventCustomerTwoFactor}.php`; `app/Http/Controllers/Admin/Account/TwoFactorController.php`; `app/Listeners/RecordTwoFactorEvents.php`; `app/Console/Commands/ResetTwoFactorCommand.php`; `resources/js/pages/Admin/Account/TwoFactor.vue`; `resources/js/pages/Auth/TwoFactorChallenge.vue` (replace kit)
- Delete: remaining kit Vue files and the `LEGACY_KIT_FILES` block in `eslint.config.js`
- Modify: `bootstrap/app.php` (both middleware in `web`), `routes/admin.php` (`admin.security.two-factor`), `resources/lang/en/{auth,auth_ui,account}.php`, `route-access.php`
- Test: `tests/Feature/Auth/TwoFactorTest.php`, `resources/js/pages/Admin/Account/__tests__/TwoFactor.test.ts`

**Spec refs:** `13 §5.10`, `§17` (2FA events), `§20.9`; `11 §18` (Two-factor page); `10 §4.7`

**Interfaces:**
- Consumes: Task 23 `2fa.enrolled`, Task 30 `ResetTwoFactor`.
- Produces: page `admin.security.two-factor` (GET `/admin/account/two-factor`, `Admin/Account/TwoFactor`, exempt from `2fa.enrolled`) — enable (password-confirmed) → QR SVG + setup key → confirm → 8 recovery codes with Copy/Download `{app-name}-recovery-codes.txt` and required "I saved these codes" checkbox, regenerate; Disable hidden for owner/admin; `PreventRequiredTwoFactorDisable` (route `two-factor.disable` → 403 `auth.errors.2fa_required` for owner/admin); `PreventCustomerTwoFactor` (`two-factor.*` → 403 for customers); audits `auth.2fa_enabled` / `auth.2fa_disabled` / `auth.recovery_code_used`; command `furny:reset-two-factor {email}` (audit with causer null and `via: console`).

- [ ] **Step 1: Write the failing tests**
  - Owner without 2FA requesting `admin.dashboard` → redirect `admin.security.two-factor`; after enabling + confirming with a valid TOTP (`Google2FA` from the stored secret) → passes; owner `DELETE /user/two-factor-authentication` → 403; estimator may disable; customer `POST /user/two-factor-authentication` → 403; a recovery code logs in once and fails the second time, auditing `auth.recovery_code_used`; the 6th challenge attempt in a minute → 429; `furny:reset-two-factor owner@x.test` clears the columns and audits `auth.2fa_reset` with `via: console`.
  - Vitest: the confirm button for recovery codes stays disabled until the checkbox is ticked; Disable is not rendered for role `admin`.
- [ ] **Step 2: Run, expect FAIL** — `vendor/bin/pest tests/Feature/Auth/TwoFactorTest.php && yarn vitest run resources/js/pages/Admin`
- [ ] **Step 3: Implement** — per Interfaces; remove the legacy kit files and ignore block (`yarn lint` must pass with `vue/no-bare-strings-in-template` on every file).
- [ ] **Step 4: Run tests, expect PASS** — same as Step 2.
- [ ] **Step 5: Quality gates** — Gates-PHP, Gates-JS, Gates-Gen.
- [ ] **Step 6: Commit** — `git add -A app bootstrap/app.php routes resources eslint.config.js tests` → `feat(auth): mandatory TOTP for owners/admins and two-factor management page` + trailer.

