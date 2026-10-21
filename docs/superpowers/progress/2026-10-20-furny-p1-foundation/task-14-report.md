# Task 14 report: Policies A (projects, plans, furniture designs, imports)

Status: DONE_WITH_CONCERNS (concerns are spec ambiguities, listed below).

## Implemented
- `app/Policies/ProjectPolicy`, `PlanPolicy`, `FurnitureDesignPolicy`, `BlueprintImportPolicy`; all auto-discovered (`Gate::getPolicyFor()` tests; `App\Policies` is on Laravel's guess list).
- `app/Policies/Concerns/AuthorizesStaff`: `staffCan(User, PermissionName): bool` (staff + active + `checkPermissionTo`, which returns false instead of throwing for an unknown permission) and `allowOrDeny(bool, User, bool $ownsRecord)`.
- Extra concern `app/Policies/Concerns/ChecksProjectOwnership` (not in the brief's file list; removes triplicate code): `ownsProject`, `ownsProjectOf`, `projectOf` (falls back to `withTrashed()` when the project is soft-deleted).
- No ability is named after a permission string (method names are the brief's), so spatie's permission-named `Gate::before` bypass cannot apply.
- Lang keys (ICU files, exported with `php artisan i18n:export`, generated JSON committed): `projects.errors.has_orders`, `designs.errors.locked`, `designs.errors.in_order`, `common.verify_required`.

## Rulings and choices
- **Denials**: customer who does not own the record -> `Response::denyAsNotFound()` (404); staff, and a customer who owns the record but lacks the right (e.g. owner calling `lock`/`refund`/`saveAsPreset`) -> explicit `denyWithStatus(403)`. Inactive staff are denied by `Gate::before` (status null) before the policy runs; every policy test file has a "denies inactive staff every ability through the policy" test (inactive owner-role user) plus an `inactive-admin` row in each matrix.
- **Ownership** = `projects.owner_id`, always resolved through the project (also for FurnitureDesign: `furniture_designs.owner_id` is NOT used; it is a denormalised copy). Chosen for consistency with the 13 §8 notation; costs one query per check unless `project` is loaded.
- **"Verified contact"** (BlueprintImportPolicy::create, non-trace modes) = `User::hasVerifiedContact()` = `email_verified_at !== null || phone_verified_at !== null` (13 §2 `verified.contact`; phone-only accounts count). Unverified owner in auto mode -> 403 code `contact_unverified` (14 error code), message `common.verify_required`. Trace mode needs only ownership. Staff with `plans.edit_any` bypass the check.
- **Never-submitted draft** = `state = Draft::$name` AND `submitted_at IS NULL` (Task 10 `Draft` state class). `ProjectPolicy::delete` blocks if any order matches the complement: `state != 'draft' OR submitted_at IS NOT NULL`; soft-deleted orders are counted (`withTrashed()`).
- **Messages**: `trans_icu()` (the ICU convention in global-constraints / 15 §15.3), not `__()`; the lang files are ICU namespaces. Messages have no placeholders so both render identically. Tests assert the message equals the rendered text and is not the raw key.
- Order of checks: access (404/403) first, then state (422/423); a stranger never learns of a lock or of orders.
- `FurnitureDesignPolicy::delete`: a locked design returns 422 `design_in_order` too (14 route table: "locked or referenced -> 422 design_in_order"). Reference check: `OrderItem` rows with `furniture_design_id` (no `orderItems()` relation exists on the model).
- `PlanPolicy::update` stays authorised on a locked plan (spec 13 §8.2; actions answer 423 `plan_locked`); tested.
- `PlanPolicy::view/export` delegate via `Gate::forUser($user)->inspect('view', $project)` (ProjectPolicy::view).
- `ProjectPolicy::create(User, ?User $forCustomer)`: customer with null or themselves -> allow; customer for someone else -> 403; staff need `customers.manage` AND a `forCustomer` that is a customer.

## TDD evidence
- RED: `vendor/bin/pest tests/Feature/Policies` before the policies existed: `Tests: 274 failed, 37 passed (343 assertions)`. Failures were "two arrays are identical" (allowed/status mismatch, no policy -> default deny with null status), `null is identical to 423/422/403`, and `UnknownClassOrInterfaceException` for the four auto-discovery tests. The 37 passes are the expected denials that a missing policy also produces.
- GREEN: same command after implementation: `Tests: 311 passed (380 assertions)`.
- Full suite: `vendor/bin/pest tests/Unit tests/Feature` -> `1107 passed (5154 assertions)`.
- Gates: `pint --test` passed, `phpstan analyse` [OK] No errors, `php artisan i18n:export` run (generated JSON committed), `typescript:transform` produced no diff.

## Tests
`tests/Feature/Policies/{Project,Plan,FurnitureDesign,BlueprintImport}PolicyTest.php` (dataset-driven; `Gate::forUser($u)->inspect()`, asserting `allowed()`, `status()`, `code()`, `message()`), helper `tests/Support/PolicyActors.php` (actor resolution + expectation vocabulary).

## Files changed
app/Policies/{ProjectPolicy,PlanPolicy,FurnitureDesignPolicy,BlueprintImportPolicy}.php; app/Policies/Concerns/{AuthorizesStaff,ChecksProjectOwnership}.php; tests/Feature/Policies/*; tests/Support/PolicyActors.php; resources/lang/en/{common,projects,designs}.php; resources/js/lang/generated/{en.json,manifest.json}.

## Concerns
1. 13 §8.1 "staff only via `data.delete`": I read it as "staff need the `data.delete` gate (owner role) and the order guard still applies" (422 for everyone). If the owner should be able to delete a project with live orders, drop the guard for the gate path (one line).
2. Lang namespace: 14 refers to `furniture.errors.locked` (flash key), but 15 §15.2's namespace list has `designs` and no `furniture`. I used `designs.errors.*`; 14/19 should reconcile (the flash key for 423 on `customer.furniture.update` must use whichever is chosen).
3. 14 mentions "rerun (+ verified contact for customers)" and "start requires verified contact (403 contact_unverified)" at controller level; the brief's `rerun` signature has no mode, so the policy does not check contact verification for rerun/start. Needs a controller/request check in P6.
4. Extra file `ChecksProjectOwnership.php` beyond the brief's list.
5. Inactive staff denials have status null (from `Gate::before`), not 403; HTTP rendering turns it into 403.

## Fix round 1

Ruling applied (for spec 19): **`blueprint_imports.user_id` (the uploader) grants nothing on its own.** This deviates from the literal "`user_id` = user" of 13 §8.4 / 06 §11 (view, update, cancel, retry, accept, convertToTrace, discard, rerun). Customers: rights only from owning the project (a customer who uploaded to a project they do not own gets 404 for every ability). Staff: rights only from the ability's permission (`customers.view`, `plans.edit_any`, `ai.manage`); a staff uploader who lost the permission (e.g. moved to production) gets 403. The BlueprintImportPolicy docblock records this.

Changes
- BlueprintImportPolicy: uploader branch removed; every ability now uses `ownerOrStaffCan` / `staffCanOnly`.
- `ChecksProjectOwnership::projectOf()` caches the `withTrashed()` fallback with `setRelation('project', ...)`; tests assert the soft-deleted project is read twice in total (relation load + fallback) over three abilities, and that `FurnitureDesignPolicy::duplicate` reads `projects` once (was twice before: relation load plus a second lookup).
- Duplicated bodies collapsed into `ChecksProjectOwnership::ownerOrStaffCan(user, subject, PermissionName ...)` (own project, or active staff holding any permission) and `staffCanOnly(...)` (staff-only abilities: 403 for the owning customer, 404 for a stranger). PlanPolicy/FurnitureDesignPolicy `edit` and the `create` bodies, ProjectPolicy view/manage, and the import `involvedOr` all use them. `allowOrDeny` moved to the new `Concerns\RespondsWithCodes` trait; `AuthorizesStaff` keeps only `staffCan`. `ChecksProjectOwnership` uses both traits itself (policies list all three; PHP allows that).
- Tests: uploader describe rewritten (customer uploader 404 on all ten abilities; staff uploader demoted estimator->production 403 on the eight permission-gated abilities, still `view` through `customers.view`; estimator uploader keeps exactly plans.edit_any rights). Owner-change tests for plan, design (asserts the stale `owner_id` copy is not consulted) and import: new owner allowed, former owner 404. Archived project (`projects.status = 'archived'`; 02 has no `archived_at`): owner can still view/update/create plans, designs and imports, and policies do not check archived status.
- New `tests/Feature/Policies/StaffChecksTest.php`: a customer with the `owner` role is denied (404 on strangers' records across all four policies, 403 on staff-only abilities of its own records); inactive staff denied when the policies are called directly (no Gate::before); inactive staff via the gate have `status()` null and `authorize()` throws `AuthorizationException`, which the HTTP handler renders as 403.
- Mutation check run by hand: dropping `isStaff()` -> 4 tests fail; dropping `is_active` -> 1 fails; dropping the staff check but keeping is_active -> 3 fail. Original restored.

Carried (controller level, not policy): writes to archived (`status = archived`) or soft-deleted projects, and their plans, designs and imports, must be blocked in the controllers/actions (P4/P5/P6). The policies deliberately authorise by ownership/permission only.

Evidence: `vendor/bin/pest tests/Unit tests/Feature` -> 1125 passed (5218 assertions); `vendor/bin/pest tests/Feature/Policies` -> 329 passed; `pint --test` passed; `phpstan analyse` [OK] No errors.
