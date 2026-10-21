### Task 23: Auth middleware and route groups

**Files:**
- Create: `app/Http/Middleware/{EnsureUserIsActive,EnsureUserType,EnsureCustomerOnboarded,EnsureContactVerified,EnsureTwoFactorEnrolled,EnforceAbsoluteSessionLifetime,RequireRecentAuthentication}.php`; `app/Support/Auth/RecentAuthentication.php`; `app/Exceptions/RecentAuthenticationRequired.php`; `routes/api.php`; `routes/webhooks.php`; `tests/Feature/Security/route-access.php`
- Modify: `bootstrap/app.php` (aliases `active, customer, staff, onboarded, verified.contact, 2fa.enrolled, session.absolute, recent.auth`; route files with groups), `routes/customer.php`, `routes/admin.php`, `resources/lang/en/auth.php` (`inactive`, `session_expired`, `2fa_required`), `resources/lang/en/common.php` (`verify_required`)
- Test: `tests/Feature/Auth/Middleware/*Test.php` (one per middleware), `tests/Feature/Security/RouteGroupsTest.php`, `tests/Feature/Security/RouteCoverageTest.php`

**Spec refs:** `13 §1` (alias table, route groups), `§5.10` (2FA exemptions), `§6.1` (absolute lifetime), `§6.4`; `10 §5.1` (onboarding exemptions); `11 §1`; `13 §20.1`; `17 §5.11` (webhooks stateless); `19 §8.5`

**Interfaces:**
- Consumes: Tasks 4, 6, 13, 21.
- Produces: middleware aliases above; route groups — customer `['web','auth','active','customer','onboarded']` (name `customer.`), admin `['web','auth','active','staff','2fa.enrolled','session.absolute']` (prefix `/admin`, name `admin.`), api `['web','auth','active','throttle:api']` (prefix `/api`, name `api.`), webhooks stateless (no `web` group, `throttle:webhooks`, empty until P8); `EnsureCustomerOnboarded::EXEMPT = ['customer.onboarding.*','customer.account.*','customer.help','customer.notifications.index']`; `EnsureTwoFactorEnrolled::EXEMPT = ['admin.security.two-factor','two-factor.*','password.confirm*','logout']`; `RecentAuthentication::passes(Request): bool` (session `auth.password_confirmed_at` or `auth.login_at` within 10 min) and `RecentAuthenticationRequired` (rendered: Inertia/HTML → redirect `password.confirm` for users with a password, `auth.reauthenticate` otherwise, intended URL stored; JSON → 403 `{code: 'recent_auth_required'}`); `route-access.php` map `routeName => ['audience' => 'guest'|'customer'|'staff'|'any'|'public'|'webhook', 'permission' => ?string, 'gate' => ?string]` — **every task that adds a route adds its entry**.

- [ ] **Step 1: Write the failing tests** (tests register stub routes named `customer.onboarding.show`, `admin.security.two-factor`, `auth.reauthenticate` when absent)
  - `active`: inactive customer on `customer.dashboard` → logged out, redirect `login` with error `auth.inactive`; soft-deleted user likewise.
  - `customer`: staff on `customer.dashboard` → redirect `admin.dashboard`. `staff`: customer on `admin.dashboard` → 403 with Inertia component `Error`, prop `status 403`.
  - `onboarded`: `notOnboarded()` customer GET `customer.dashboard` → redirect `/onboarding`; POST to a customer route is not redirected; exempt routes pass; staff unaffected.
  - `verified.contact`: unverified user on a JSON test route → 403 `{code:'contact_unverified'}`; Inertia request → redirect back with `flash.error = trans_icu('common.verify_required')`; phone-verified only → passes.
  - `2fa.enrolled`: admin without `two_factor_confirmed_at` → redirect `admin.security.two-factor` with flash `auth.2fa_required`; owner likewise; estimator passes; exempt route names pass.
  - `session.absolute`: staff with session `auth.login_at` 13 h ago → logout, redirect `login` with `auth.session_expired`; 11 h ago passes; with setting `auth.staff_session_absolute_hours = 1`, 2 h ago expires; customers unaffected.
  - `recent.auth`: `auth.password_confirmed_at` 5 min ago passes; `auth.login_at` 9 min ago passes; 11 min ago → redirect `password.confirm` (user with password) or `auth.reauthenticate` (passwordless); JSON → 403 `recent_auth_required`.
  - `RouteGroupsTest`: `customer.dashboard` middleware equals the customer group; `admin.dashboard` the admin group; every non-vendor route has a name; no two routes share method+path; names start with an allowed prefix (`customer.`, `admin.`, `api.`, `auth.`, `account.`, `staff.`, `legal.`, `media.`, `health.`, `webhooks.`, `links.`, `notifications.`, `csp.`, Fortify names, `welcome`, `manifest`).
  - `RouteCoverageTest`: every route from `route:list --json` (excluding vendor dashboards `horizon.*`, `pulse`, `telescope*`, `storage.local`, `boost.*`) is a key of `route-access.php`; for parameterless GET entries with `permission`/`gate`: owner → 200, a staff user without it → 403, customer → 403/redirect per audience; `audience customer` entries: staff → 302 `admin.dashboard`, guest → 302 `login`.
- [ ] **Step 2: Run, expect FAIL** — `vendor/bin/pest tests/Feature/Auth/Middleware tests/Feature/Security/RouteGroupsTest.php tests/Feature/Security/RouteCoverageTest.php`
- [ ] **Step 3: Implement** — per Interfaces; populate `route-access.php` for all routes existing so far (Fortify routes, `welcome`, `legal.*`, `manifest`, `csp.report`, `customer.dashboard`, `admin.dashboard`).
- [ ] **Step 4: Run tests, expect PASS** — same as Step 2.
- [ ] **Step 5: Quality gates** — Gates-PHP, Gates-Gen.
- [ ] **Step 6: Commit** — `git add app/Http/Middleware app/Support/Auth app/Exceptions bootstrap/app.php routes resources/lang tests` → `feat(auth): access middleware, route groups and route coverage map` + trailer.

