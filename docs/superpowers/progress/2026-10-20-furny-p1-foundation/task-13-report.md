# Task 13 report: roles, permission matrix, owner gates, dashboard gates, seeders

Status: DONE_WITH_CONCERNS (concerns below are design notes, none blocking).

## Implemented
- `PermissionName` (24 cases, exact 13 §7.1 values, `#[TypeScript]`), `OwnerGate` (5 cases + `OWNER = 'owner'` const), `StaffRole::permissions()`.
- `RolesAndPermissionsSeeder` (`findOrCreate` + `syncPermissions`, registrar cache flushed, `ensureSeeded()`), `OwnerSeeder`, `config/seed.php`, `DatabaseSeeder` order Roles, Settings, TaxRates, Catalog, Owner (the old "Test User" is gone).
- `AuthServiceProvider`: `Gate::before` denying inactive staff, then spatie's permission check registered by hand, the `owner` gate and the five abilities, and `viewHorizon`/`viewPulse`/`viewTelescope` (active staff with role owner or admin).
- `HorizonServiceProvider` (new, C6; listed in `bootstrap/providers.php`); its `gate()` and Telescope's are intentionally empty so they cannot override the AuthServiceProvider gates (Telescope's provider is not registered in tests, so `viewTelescope` could not live there).
- `User`: `HasRoles`, `permissionNames()`, `abilities()`.
- `UserFactory`: `staff()`/owner/admin/estimator/production/support now `afterCreating` call `ensureSeeded()` + `assignRole` (needs `create()`; 2FA defaults for owner/admin unchanged per C11).
- Rulings applied: Task 13 spatie roles in factory states; C6 Horizon provider; C2 `TestBaselineSeeder` (`tests/Support/Seeders`, 4 seeders) + `TestCase::$seed = true`; catalog seeders wired into DatabaseSeeder; `generated.d.ts` regenerated.
- `config/permission.php`: `register_permission_check_method` set to false. Reason: spatie's `Gate::before` is registered by its own provider before ours, and the first non-null result wins, so an inactive estimator holding `orders.view` would have been allowed. We register spatie's check immediately after our deny.

## Tests (TDD)
RED: `vendor/bin/pest tests/Feature/Auth tests/Feature/Seeders/OwnerSeederTest.php tests/Feature/Seeders/DatabaseSeederTest.php` before implementation: 32 failed, 6 passed (missing classes, DatabaseSeeder still creating test@example.com and violating the unique index).
GREEN: same command: 38 passed (120 assertions). Full `vendor/bin/pest tests/Unit tests/Feature`: 776 passed (4702 assertions); `--testsuite=Unit,Feature --parallel` also 776 passed. Pint, PHPStan level 8, `typescript:transform` + `i18n:export` (only generated.d.ts changed, committed), `config:cache` ok.
`GET /horizon`: estimator 403, owner 200 with the real gate and no Redis stubbing needed in the testing env.

Existing tests adjusted for the baseline seeding (C2): CatalogVersionBumpTest (rollback test compares row counts with the pre-count), CatalogModelsTest (soft delete counts relative), CatalogSchemaTest (clears the seeded default tax rate), SettingsSchemaTest (deletes the seeded `units` row before inserting). Added a role-state test to IdentityFactoriesTest (fresh DB, all five roles).

## Concerns / notes
- OwnerSeeder follows 02 §14 literally: it skips only when a user with the configured email exists. If the env email changes later while another owner exists, a second owner is created. Production with empty email and no owner, or missing password, throws; non-production with empty email skips silently; a missing password outside production creates a passwordless owner.
- `Gate::before` deny applies to `Gate::forUser`/`can`; direct `hasPermissionTo()` calls still ignore `is_active` (as per spec, gate-level only).
- The factory role assignment happens in `afterCreating`, so `make()` users have no role.
- Timezone for the seeded owner comes from the `business` settings group default (`Asia/Kolkata`).

## Files
Created: app/Domain/Identity/Enums/{PermissionName,OwnerGate}.php, app/Providers/{AuthServiceProvider,HorizonServiceProvider}.php, config/seed.php, database/seeders/{RolesAndPermissionsSeeder,OwnerSeeder}.php, tests/Support/Seeders/TestBaselineSeeder.php, tests/Feature/Auth/{RolesAndPermissionsSeederTest,OwnerGatesTest,DashboardGatesTest}.php, tests/Feature/Seeders/{OwnerSeederTest,DatabaseSeederTest}.php.
Modified: StaffRole, User, UserFactory, TelescopeServiceProvider, DatabaseSeeder, bootstrap/providers.php, config/permission.php, tests/TestCase.php, resources/js/types/generated.d.ts, four existing tests listed above, IdentityFactoriesTest.
`config/pulse.php` needed no change (its `Authorize` middleware checks `viewPulse`, now defined).

## Fix round 1
1. OwnerSeeder (ruled): first check = any active staff user with role owner, then skip with `Log::info`. Otherwise: empty email throws in production, skips elsewhere; a user (any type/state, incl. soft-deleted) already holding the configured email is never promoted: RuntimeException in production, `Log::warning` + skip elsewhere. Production password rules (>= 16 chars, not "password", not the email) are asserted before any write. The owner lookup uses `whereHas('roles')` because the `role()` scope throws when the role row does not exist. `.env.example`: `SEED_OWNER_PASSWORD` blank with the >= 16 comment. Note: the "not 'password'" rule is subsumed by the length rule (the word is 8 chars); kept as specified.
2. `Gate::before` in AuthServiceProvider now returns false for any non-staff user on an ability that is a `PermissionName` value (before spatie's check). Tests: customer with a role, a direct permission, or both is denied `orders.view`/`quotes.view_costs`/`owner`; unrelated abilities are unaffected.
3. `authorization()` overridden in `HorizonServiceProvider` and `TelescopeServiceProvider` (gate check only, no local bypass; the empty `gate()` overrides were removed). Tests with env switched to `local`: guest and estimator get 403 on `/horizon`, estimator 403 on `/pulse`, admin 200; `/pulse` owner/admin 200, estimator/customer/guest 403; Telescope (not registered in testing) verified via `Telescope::check` after registering the provider by hand.
4. `tests/Feature/Auth/RouteAuthorizationConventionTest.php`: fails if any route (groups expanded) uses `permission:`, `role:`, `role_or_permission:` or the three spatie middleware classes; a second test proves the detector flags them.
5. Hygiene: matrix moved to `tests/Support/PermissionMatrix.php`; global helpers renamed `authSeedRoles`, `authPermissionsOf`, `ownerSeederConfigure`, `ownerSeederRun`, `dbSeederTableCounts`. Cache tests: the last permission-cache reset must happen after the seeder's transaction has closed (verified discriminating: fails when the explicit `forgetCachedPermissions()` is removed), and a stale cached grant is gone after a run.
Mutation checks: removing the `authorization()` overrides or the non-staff deny fails 5 of the new tests.

Commands: `vendor/bin/pest tests/Unit tests/Feature` -> 796 passed (4758 assertions); `--testsuite=Unit,Feature --parallel` -> 796 passed; `vendor/bin/pint --test` passed; `vendor/bin/phpstan analyse` no errors; `typescript:transform` produces no diff.
