### Task 13: Roles, permissions, owner gates, dashboard gates, owner seeder

**Files:**
- Create: `app/Domain/Identity/Enums/{PermissionName,OwnerGate}.php`; `app/Providers/AuthServiceProvider.php`; `database/seeders/{RolesAndPermissionsSeeder,OwnerSeeder}.php`; `config/seed.php`
- Modify: `StaffRole` (`permissions(): list<PermissionName>`), `User` (`HasRoles`; `permissionNames(): list<string>`; `abilities(): list<string>`), `UserFactory` (states `owner()`, `admin()`, `estimator()`, `production()`, `support()`), `database/seeders/DatabaseSeeder.php`, `bootstrap/providers.php`, `app/Providers/HorizonServiceProvider.php` (gate), `config/pulse.php`/Telescope provider gates
- Test: `tests/Feature/Auth/RolesAndPermissionsSeederTest.php`, `tests/Feature/Auth/OwnerGatesTest.php`, `tests/Feature/Auth/DashboardGatesTest.php`, `tests/Feature/Seeders/OwnerSeederTest.php`, `tests/Feature/Seeders/DatabaseSeederTest.php`

**Spec refs:** `13 §7.1–§7.4`; `02 §14` items 1, 5 and idempotency; `17 §5.11` item 12, `§6.1` (`SEED_OWNER_*`); master D17, D18; `19 §8.1`

**Interfaces:**
- Consumes: Tasks 4–12.
- Produces: `PermissionName` (24 cases; values exactly `13 §7.1`, `#[TypeScript]`); `OwnerGate` (`orders.cancel_late`, `staff.manage_owners`, `settings.change_currency`, `settings.manage_restricted`, `data.delete`); gate `owner` + the five abilities (each `Gate::forUser($u)->allows('owner')`); `Gate::before` returning `false` for inactive staff; gates `viewHorizon`, `viewPulse`, `viewTelescope` (active staff with role `owner` or `admin`); `RolesAndPermissionsSeeder::ensureSeeded(): void` (used by factory role states); `User::abilities()` (owner gates passed), `User::permissionNames()`; `UserFactory` role states (staff + `assignRole`); `DatabaseSeeder` order: Roles → Settings → TaxRates → Catalog → Owner.

- [ ] **Step 1: Write the failing tests**
  - `RolesAndPermissionsSeederTest`: 24 permissions named exactly `orders.view, orders.review, orders.assign, orders.propose_changes, quotes.create, quotes.send, quotes.view_costs, orders.confirm, orders.cancel, orders.hold, orders.close, production.manage, messages.post, customers.view, customers.manage, catalog.manage, presets.manage, templates.manage, settings.manage, staff.manage, ai.manage, reports.view, plans.edit_any, audit.view` (guard `web`); 5 roles; dataset per role: owner = all 24; admin = all 24; estimator = `orders.view, orders.review, orders.assign, orders.propose_changes, quotes.create, quotes.send, quotes.view_costs, orders.confirm, orders.cancel, orders.hold, messages.post, customers.view, presets.manage, plans.edit_any`; production = `orders.view, orders.hold, production.manage, messages.post, customers.view`; support = `orders.view, orders.confirm, messages.post, customers.view`; running twice keeps 24/5 and removes a manually added extra permission from a role (sync).
  - `OwnerGatesTest`: owner passes all five owner abilities and `owner`; admin fails all; inactive owner fails; customer fails; an inactive estimator is denied `orders.view` (`Gate::before`); `User::abilities()` = the five for owner, `[]` for admin and customers.
  - `DashboardGatesTest`: `viewHorizon`/`viewPulse`/`viewTelescope` true for owner and admin, false for estimator, support and customers; `GET /horizon` as estimator → 403, as owner → 200.
  - `OwnerSeederTest`: with `config('seed.owner')` = name/email/password → creates staff user with role owner, `onboarded_at`, `email_verified_at`, `terms_accepted_at` set, `timezone 'Asia/Kolkata'`; second run creates nothing; `app()->environment('production')` + empty email + no owner → `RuntimeException`; production + empty email + an existing owner → no exception.
  - `DatabaseSeederTest`: `db:seed` twice succeeds; table counts after the second run equal those after the first.
- [ ] **Step 2: Run, expect FAIL** — `vendor/bin/pest tests/Feature/Auth tests/Feature/Seeders/OwnerSeederTest.php tests/Feature/Seeders/DatabaseSeederTest.php`
- [ ] **Step 3: Implement** — `config/seed.php` = `['owner' => ['name' => env('SEED_OWNER_NAME', 'Owner'), 'email' => env('SEED_OWNER_EMAIL'), 'password' => env('SEED_OWNER_PASSWORD')]]` (config-cache safe; seeders never call `env()`); seeder uses `Permission::findOrCreate`/`Role::findOrCreate` + `syncPermissions`, then `PermissionRegistrar::forgetCachedPermissions()`.
- [ ] **Step 4: Run tests, expect PASS** — same as Step 2.
- [ ] **Step 5: Quality gates** — Gates-PHP, Gates-Gen.
- [ ] **Step 6: Commit** — `git add app/Domain/Identity app/Providers bootstrap/providers.php config/seed.php config/pulse.php database/seeders database/factories tests resources/js` → `feat(auth): roles, permission matrix, owner gates and seeders` + trailer.

