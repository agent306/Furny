# Task 31 review: two-factor enforcement and page, plus the Task 30 minors (0820486..3aa6e6d)

Reviewed in one pass from the review package (`review-0820486..3aa6e6d.diff`). I did not re-run the suite and made no mutations; every focused check outside the diff is listed under "Checks run". I did not re-flag the controller rulings: the limiter keyed by `login.id`, customers getting 403 on `two-factor.login*`, the unconditional `ResetTwoFactor`, `enforced = required && !confirmed`, the owners lock in Activate/Reset, and no AccountNav link.

### Spec Compliance

- ✅ **Spec compliant.** Every file and requirement in the brief has its hunk.
  - **Middleware.** Both are in the `web` group (bootstrap/app.php:128-131 in the diff). `PreventRequiredTwoFactorDisable` matches `two-factor.disable` and answers 403 with `auth.errors.2fa_required`. `PreventCustomerTwoFactor` matches `two-factor.*` and answers 403, before `password.confirm` (13 §5.10, 14 §3.1 lines 242-250).
  - **Page.** GET `/admin/account/two-factor` is named `admin.security.two-factor` and is exempt through `EnsureTwoFactorEnrolled::EXEMPT` (routes/admin.php:17). `TwoFactorPageProps` matches 14 line 589.
  - **Page flow** (11 §18):
    - enable, password-confirmed through Fortify's `confirmPassword`;
    - the QR code as an `<img>` data URI, plus the setup key;
    - confirm in Fortify's error bag;
    - the 8 codes with Copy, Download `{app}-recovery-codes.txt`, and a required "I saved these codes" checkbox gating Done;
    - regenerate;
    - Disable hidden when `required`, with the required-for-your-role note.
  - **Audits.** `auth.2fa_enabled`, `auth.2fa_disabled` and `auth.recovery_code_used` go to the `security` log with the user as subject and causer and no properties (13 §17 line 825). The code value is never stored.
  - **Command.** `furny:reset-two-factor {email}` sets causer null and `via: console`.
  - **Challenge page.** It is replaced, and `two-factor.login.store` counts its wait down inline.
  - **Cleanup.** The legacy kit components and the `LEGACY_KIT_FILES` block are removed. `route-access.php` and `AccessProbe` are updated.
  - **Tests.** Every case in brief Step 1 exists: TwoFactorTest.php for redirect, confirm with a real TOTP, owner disable 403, estimator disable, customer enable 403, recovery code once plus audit, 429 on the sixth try, and the console reset. The two vitest cases are in TwoFactor.test.ts ("keeps the button disabled until…", "has no Disable for an owner or an admin").
  - **Task 30 minors 1-8** are all addressed (see Strengths).
- ⚠️ **Cannot verify from the diff.** These sit outside this task's code:
  - **JSON 403 bodies have no `code`.** A JSON 403 from `abort(403, …)` renders Laravel's default `{message}`, without the `code` that 14 §1.8 requires (`two_factor_required` or `forbidden`). I checked `bootstrap/app.php` `withExceptions` and `ErrorPage`: there is no 403 envelope anywhere in the app, so this is app-wide and not introduced here.
  - **`2fa.enrolled` redirects JSON callers too.** Task 23's `EnsureTwoFactorEnrolled` redirects every request, JSON included. 14 §1 line 44 says JSON gets 403 `{code: 'two_factor_required'}`. This is not a bypass (nothing gets through), but it is a spec deviation in consumed code. The controller should decide which task owns it.

### Strengths

- **No enforcement bypass found.**
  - `2fa.enrolled` sits on the whole admin group (bootstrap/app.php:45). Only the page, `two-factor.*`, `password.confirm*` and `logout` are exempt, which matches 13 §5.10 exactly.
  - The new page is the only new admin route, and it only reads.
  - Fortify's `enable` with `force` keeps `two_factor_confirmed_at` (vendor EnableTwoFactorAuthentication.php). So an owner cannot un-enrol through the enable route, and `two-factor.disable` is the only clearing path, which is blocked. The role is read on every request (TwoFactorTest "applies at once when a role change…").
- **The page is rendered safely.**
  - The QR SVG goes through `<img src="data:…">` and never through `v-html` (TwoFactor.vue:118-124).
  - Codes never appear in Inertia props, only in the one-shot JSON read.
  - The listener records no properties. A test asserts that the code string is absent from the audit.
- **The tests exercise the real flows.**
  - A real Google2FA TOTP from the stored secret.
  - The 423 and the redirect for a stale password confirmation.
  - Coming back to the page via `url.intended` after the password is confirmed.
  - The error bag name.
  - The customer 403 before `password.confirm` is asked.
  - Single-use recovery codes, with the other code still working.
  - No remember cookie for staff.
  - The reported middleware no-op mutation (12 failures) is consistent with these tests: removing either middleware, or the enforcement, flips many of them.
- **The Task 30 race fixes are correct and pinned cleverly.** `afterOwnersLock` (StaffManagementTest.php:59-69) commits the competing change exactly when `pg_advisory_xact_lock` runs. The tests would therefore also catch a wrong ordering, such as `refresh()` before `lockOwners()`, not only a missing re-check.
  - `reload()` returns a fresh actor, so its roles are fresh.
  - `refresh()` reloads the target's loaded `roles`.
  - The lock always comes before row writes, so the ordering against other lock holders is consistent.
  - Reactivation revokes sessions after the commit (ActivateUser.php:50-53), and leaves an already-active member alone.
- **Dialogs keep their own errors.** They now use their own `onError` errors and clear them on open and on send. The owner-invitation buttons are gated by the `staff.manage_owners` ability (shared in `auth.user.abilities` per 13 §7.4).
- **`parts()`/`RichText` render tags as slots.** Text is interpolated, never HTML.

### Issues

#### Critical (Must Fix)

None.

#### Important (Should Fix)

1. **False success toasts when the password confirmation has expired.**
   - Where: TwoFactor.vue:175-179 (`submitCode`), 208-211 (`regenerate`) and 232 (`turnOff`).
   - What happens: `router.post`/`router.delete` go to Fortify routes behind `password.confirm`. For an Inertia visit with a stale confirmation (more than 10 minutes, `password_timeout = 600`), `RequirePassword` answers with a redirect to `password.confirm`. Inertia follows it, renders `Auth/ConfirmPassword` with no errors, and fires `onSuccess`. I checked this in @inertiajs/core 3.9.1 dist/index.js:2708-2718: `onSuccess` fires whenever the page has no errors, whatever the component.
   - Scenario: a staff member opens the page on a later visit, more than 10 minutes after the last confirmation, and clicks **Regenerate**, because the old codes may have leaked. They see the toast "You have new recovery codes.", and `showCodes()` fires a 423 and a second visit. After confirming the password they land back on the page. Nothing was regenerated, and the old codes are still valid.
   - The same happens with **Disable**, which toasts "Two-factor authentication is off." while it is still on, and with **Confirm** when the setup took more than 10 minutes, which toasts "Two-factor authentication is on." while it is not confirmed.
   - Why it matters: this is a wrong security-state message on the page whose job is the second factor. No test covers a stale confirmation on the POST/DELETE paths; the vitest stubs only the 423 for the JSON reads.
   - Fix options:
     - In `onSuccess`, act only when the visit came back to this page (`page.component === 'Admin/Account/TwoFactor'`).
     - Or check the state change, e.g. `confirmed` flipped.
     - Or query `password.confirmation` (`GET /user/confirmed-password-status`) before posting, and send the person to confirm first.
     - Add a vitest that resolves a visit onto another component and asserts there is no toast and no `showCodes`.

#### Minor (Nice to Have)

1. **A 423 on the JSON reads does not lead back to the page.**
   - Where: TwoFactor.vue:99-100.
   - `router.visit(confirmPassword.url())` is a direct GET, so nothing sets `url.intended`. Fortify's `PasswordConfirmedResponse` then goes to `fortify.home`, not to the 2FA page.
   - An enforced owner is bounced back by `2fa.enrolled`. An estimator mid-setup lands on the dashboard, and there is no nav link to the page yet (Task 34).
   - The report's claim that "a 423 on the JSON reads does the same [returns to the page]" holds only for enforced users.
   - Fix: visit a URL that stores the intended page, or pass a return path.
2. **The `PreventCustomerTwoFactor` docblock contradicts the code.**
   - Where: PreventCustomerTwoFactor.php:16.
   - It says "The challenge (`two-factor.login*`) … is not touched". In fact `routeIs('two-factor.*')` also answers 403 on the challenge routes, per the ruling, and `AccessProbe` asserts it.
   - Fix: update the comment.
3. **The re-check of the reloaded actor in `ResetTwoFactor` is not pinned by a test.**
   - Where: StaffManagementTest.php:686-708. The "actor lost the owner role while the request waited" dataset covers `update`, `grant`, `deactivate` and `activate`, but not `reset`.
   - Replacing `$this->access->reload($actor)` with `$actor` at ResetTwoFactor.php:54 would leave the suite green (by inspection).
   - Fix: add `'reset'` to the dataset.
4. **A non-required role cannot abandon a setup it started.**
   - Where: TwoFactor.vue:301 and 422.
   - The Disable button renders only when `confirmed`. An estimator who pressed Enable and never confirmed sees "setup under way" on every later visit, with no way to cancel.
   - This is harmless for security (an unconfirmed secret is not challenged at login), but the state is stuck.
   - Fix: offer Cancel/Disable while `settingUp && !required`.
5. **The Download link's object URL is revoked immediately.**
   - Where: RecoveryCodesPanel.vue:49.
   - `URL.revokeObjectURL(url)` runs straight after `link.click()`, on an anchor that was never attached. Some browsers (historically Safari and Firefox) have cancelled such downloads.
   - Fix: defer the revoke with `setTimeout(…, 0)`. Low confidence that it fails in current browsers.

### Checks run (outside the diff, one per named risk)

| Risk | What I checked | Result |
|---|---|---|
| Enforcement scope or bypass | `EnsureTwoFactorEnrolled.php` (EXEMPT list) and bootstrap/app.php:45 (admin group stack) | Matches 13 §5.10; no extra exemptions. |
| Owner un-enrols via enable `force` | vendor/laravel/fortify `EnableTwoFactorAuthentication` (v1.41.0) | `confirmed_at` is untouched, so it is not a disable path. |
| Recovery code flashed into the session | `dontFlash` in bootstrap/app.php and `RateLimitedResponse::flashBack` | Neither Fortify's failed-challenge response nor the inline 429 calls `withInput`, so the code is not flashed. |
| Owner-invitation ability exposure | `usePermissions` and `AuthUserData::abilities` | The gate is shared, so `can('staff.manage_owners')` works. |
| 403 JSON envelope | bootstrap/app.php `withExceptions` and `ErrorPage` | No 403 `code` anywhere (the ⚠️ above). |
| Inertia `onSuccess` on a redirect to another page | @inertiajs/core dist/index.js:2690-2718 | It fires (Important 1). |
| Return path after a 423 | `route:list --name=password.confirm` | Fortify's default controllers; no custom intended handling (Minor 1). |

### Assessment

**Spec compliance:** ✅

**Task quality:** Needs fixes

**Reasoning:** The server side of the enforcement is sound. The page is reachable only as intended, disable is blocked by role on every request, customers are shut out before any password prompt, the audits never record codes, and the Task 30 re-checks under the lock are correct and pinned by lock-timed tests. One client defect remains: Inertia's `onSuccess` treats the redirect to the password confirmation as success, so regenerate, disable and confirm can report a security change that did not happen.

---

## Re-review 1 (3aa6e6d..100058b)

Scope: the six findings, the ⚠️ ruling, and the fix diff (`review-3aa6e6d..100058b.diff`, one commit). I read the diff once and ran no tests or mutations. The fix report names the covering tests and their RED/GREEN output: Pest 4 failed → 3490 passed, vitest 11 failed → 1369 passed, Browser 95 passed, and the gates are clean.

### Finding verdicts

- **I1 (false success toasts when the password confirmation has expired): ADDRESSED.**
  - **Pre-check.** `ensureConfirmed()` reads `GET /user/confirmed-password-status` before every action that posts: enable, confirm, regenerate, disable and cancel. When the status says not confirmed, it routes through the password confirmation and posts nothing (TwoFactor.vue in the fix diff: `ensureConfirmed`, and the call sites in `start`, `submitCode`, `regenerate` and `turnOff`). For regenerate and disable, the check runs before the dialog.
  - **Guard.** `stayedHere()` checks that `page.component` is still `Admin/Account/TwoFactor` before any toast, `showCodes()` or state change in `onSuccess`, for confirm, regenerate, disable and cancel. That covers a confirmation that expires while the dialog is open, and an unreadable status.
  - **Tests.** The vitest "when the password has to be confirmed again" has four cases where the visit lands on `Auth/ConfirmPassword`, each asserting no toast and no codes read. It also covers the stale-status pre-checks, and one case where a visit that stays on the page still toasts.
- **M1 (a 423 on the JSON reads does not lead back to the page): ADDRESSED.**
  - `TwoFactorController::show` with `?confirm-password=1` and a stale confirmation stores `url.intended` as the fixed `route('admin.security.two-factor')` (`IntendedRedirect::SESSION_KEY === 'url.intended'`, IntendedRedirect.php:21) and redirects to `password.confirm`. With a fresh confirmation, it renders the page.
  - Every hand-off on the page now uses `confirmPasswordFirst()`.
  - Feature tests cover estimator, admin and owner (redirect, then confirm lands on the page) and the already-confirmed case (TwoFactorTest, the "sends anyone who needs the password confirmed…" dataset).
- **M2 (stale `PreventCustomerTwoFactor` docblock): ADDRESSED.** PreventCustomerTwoFactor.php:16-18 now states the 403 on `two-factor.login*` for a signed-in customer.
- **M3 (no test for an actor demoted while a reset waits for the lock): ADDRESSED.** `'reset'` is in the dataset (StaffManagementTest.php:700 and 708), with an added assertion that the target's `two_factor_confirmed_at` is untouched. The implementer reports that the `reload($actor)` → `$actor` mutation now fails.
- **M4 (a non-required role cannot cancel an unconfirmed setup): ADDRESSED.**
  - A "Cancel setup" button (`v-if="!required"`, inside the setup block shown when `enabled && !confirmed`) calls `turnOff(true)` → `DELETE two-factor.disable`.
  - The server still refuses owner/admin through `PreventRequiredTwoFactorDisable`, whatever the factor's state.
  - Tests: estimator and support can cancel (columns cleared); owner and admin get 403 and keep the secret (TwoFactorTest "does not let an owner or an admin cancel…"); vitest checks that the button is not rendered for required roles.
- **M5 (object URL revoked immediately): ADDRESSED.** RecoveryCodesPanel.vue:49-50 now uses `setTimeout(() => URL.revokeObjectURL(url), 0)`. The test asserts it is not revoked synchronously, and is revoked afterwards.
- **⚠️ (`2fa.enrolled` redirects JSON requests too): ADDRESSED.**
  - EnsureTwoFactorEnrolled.php: when there is no `X-Inertia` header and `expectsJson()` is true, it answers `403 {code: 'two_factor_required'}`. Inertia visits keep the redirect and the flash. Exempt routes are unchanged.
  - Tests cover GET and POST JSON with the exact body, an Inertia visit with a JSON-accepting header, and a JSON request to an exempt route.

### Enforcement bypass check (the controller's named risks)

- **The `?confirm-password=1` hand-off is not a bypass.**
  - It is not a new route, only a branch in the already-exempt GET page.
  - It writes only a fixed, server-generated internal URL to `url.intended`, and never takes a URL from the request, so it is no open redirect.
  - It runs no Fortify action, and only redirects to `password.confirm`, which is itself in EXEMPT.
  - Afterwards the enforced user is back on the enrolment page. Every other admin route still goes through `2fa.enrolled`.
- **The M4 cancel path is not a bypass.**
  - The only server path is `two-factor.disable`. It is still refused for any `requiresTwoFactor()` user, confirmed or not, by role read per request (PreventRequiredTwoFactorDisable, unchanged).
  - The button's `!required` condition is display-only and is not relied on.
  - An enforced owner or admin cannot clear an unconfirmed setup, nor disable a confirmed one (feature tests above plus the existing "is refused for an owner or an admin" dataset).
- **The JSON branch is not a bypass.** It only changes the refusal's shape and still refuses: the `return` comes before `$next`.

### New breakage in the fix diff

- **Minor: the new JSON 403 has `code` but no `message`.** EnsureTwoFactorEnrolled.php (the JSON branch) returns `{code: 'two_factor_required'}` with no `message`. 14 §1.8 makes `message` a required field of `ApiError`. 14 §1 line 44 shows only the code, and the implementer cites `EnsureContactVerified` as following the same pattern, so this belongs with the app-wide 403 envelope item already carried to the final review.

No Critical or Important breakage.

### Out-of-scope observations

None.

### Verdict

**Spec compliance:** ✅

**Fix round:** All findings addressed, no new Critical/Important breakage.

**Task quality:** APPROVED
