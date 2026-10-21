### Task 14: Policies A (projects, plans, furniture designs, imports)

**Files:**
- Create: `app/Policies/{ProjectPolicy,PlanPolicy,FurnitureDesignPolicy,BlueprintImportPolicy}.php`; `app/Policies/Concerns/AuthorizesStaff.php`
- Test: `tests/Feature/Policies/ProjectPolicyTest.php`, `PlanPolicyTest.php`, `FurnitureDesignPolicyTest.php`, `BlueprintImportPolicyTest.php`

**Spec refs:** `13 §8` intro (404 for non-owners, 423 locks, 422 domain codes), `§8.1–§8.4`; master D25

**Interfaces:**
- Consumes: Task 13 permissions; models of Tasks 7–10.
- Produces: `AuthorizesStaff::staffCan(User $u, PermissionName $p): bool` (staff + active + permission); policies registered by auto-discovery (`Gate::getPolicyFor(Project::class) instanceof ProjectPolicy`). Abilities and signatures:
  - `ProjectPolicy`: `viewAny(User)`, `view(User, Project)`, `create(User, ?User $forCustomer = null)`, `update|archive|restore(User, Project)`, `delete(User, Project)` (422 code `project_has_orders` when orders other than never-submitted drafts exist; staff only via gate `data.delete`).
  - `PlanPolicy`: `view|export(User, Plan)`, `create(User, Project)`, `duplicate(User, Plan)`, `update(User, Plan)`, `delete(User, Plan)` (owner only), `lock|unlock(User, Plan)` (`plans.edit_any`).
  - `FurnitureDesignPolicy`: `view`, `create(User, Project)`, `update` (423 code `locked` when `locked_by_order_id` set), `duplicate`, `delete` (owner, not locked, not in `order_items` → 422 `design_in_order`), `saveAsPreset` (`presets.manage`).
  - `BlueprintImportPolicy`: `create(User, Project, ImportMode $mode)` (own project AND (trace OR verified contact), or `plans.edit_any`), `view`, `viewDebug` (`customers.view`), `update|cancel|retry|accept|convertToTrace` (uploader/owner or `plans.edit_any`), `discard|rerun` (uploader/owner or `ai.manage`), `refund` (`ai.manage`).
  - Customers who do not own the record get `Response::denyAsNotFound()` (status 404).

- [ ] **Step 1: Write the failing tests** — dataset-driven per ability using `Gate::forUser($u)->inspect($ability, $args)`: allowed/denied for owner-customer, other customer (status 404), owner/admin/estimator/production/support staff, inactive admin. Specific cases: support may `view` a project (`customers.view`) but not `update`; estimator may `update` a plan (`plans.edit_any`), production may not; `PlanPolicy::delete` denied for admin; `lock` allowed for estimator, denied for support; `ProjectPolicy::delete` allowed with only a never-submitted draft order, denied (status 422, code `project_has_orders`) with a `submitted` order; `FurnitureDesignPolicy::update` on a design with `locked_by_order_id` → status 423 code `locked` for the owner and for admin; `delete` of a design referenced by an order item → 422 `design_in_order`; `BlueprintImportPolicy::create` in mode `auto` for an unverified customer denied, mode `trace` allowed; `refund` only owner/admin staff.
- [ ] **Step 2: Run, expect FAIL** — `vendor/bin/pest tests/Feature/Policies`
- [ ] **Step 3: Implement** — per Interfaces (`Response::denyWithStatus(422|423, __(…), $code)`).
- [ ] **Step 4: Run tests, expect PASS** — `vendor/bin/pest tests/Feature/Policies`
- [ ] **Step 5: Quality gates** — Gates-PHP.
- [ ] **Step 6: Commit** — `git add app/Policies tests/Feature/Policies` → `feat(auth): project, plan, furniture design and import policies` + trailer.

