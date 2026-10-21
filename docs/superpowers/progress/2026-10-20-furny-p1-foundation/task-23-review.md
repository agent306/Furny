# Task 23 review: access middleware, route groups, route coverage map (e5b3902..03e658b)

## Spec Compliance

- ✅ Spec compliant. Every listed file has a hunk. The aliases, the four route groups, the EXEMPT constants, `RecentAuthentication::passes`, `RecentAuthenticationRequired` and the `route-access.php` map match the brief and 13 §1, §5.10, §6.1, §6.4, 10 §5.1 and 17 §5.11.
- Brief items that look missing but are not: `common.verify_required` already existed from Task 21 (`resources/lang/en/common.php:97`). The Gates-Gen output has no `auth.*` keys, so the new lang keys need no regeneration.
- Extras: `ForcedLogout` (shared by `active` and `session.absolute`), `User::requiresTwoFactor()` and the test-support classes. All are justified. `StaffRole::requiresTwoFactor()` already existed.
- ⚠️ Cannot verify from the diff (carried to later tasks, per the controller rulings):
  - `auth.reauthenticate` route and `auth.login_at` writer. Until they exist, a passwordless user on a `recent.auth` route gets a `RouteNotFoundException` (500, fail-closed).
  - api and webhooks group middleware assertions. Both groups are empty, so they cannot be asserted from a real route. I read `bootstrap/app.php`: the api group is `web, auth, active, throttle:api` and webhooks is `throttle:webhooks` only. Both limiters exist (`config/security.php:168` and `:183`).
  - Spec 12.7 (same-origin `url.intended`) is not enforced where it is consumed. Fortify's confirm-password controller does that, and so will the later login task. See finding M1.

## Verification I ran

- `vendor/bin/pest tests/Feature/Auth/Middleware tests/Feature/Security` gives 347 passed (1413 assertions), clean output.
- Scratch copy at `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/copy`. The worktree is untouched (`git status` is empty).
- Mutation checks of `RouteCoverageTest` and `RouteGroupsTest` in the copy:

| Mutation | Result |
|---|---|
| Named route `customer.mutant` added to `routes/customer.php` with no map entry | `lists every route in the access map` FAILS and names `customer.mutant` |
| Unnamed route added to `routes/customer.php` (the group prefix makes its name `customer.`) | coverage test FAILS |
| Unnamed route added to `routes/web.php` | `gives every non-vendor route a name` and `names every route with an allowed prefix` FAIL |
| Named route `mutant3` added to `routes/web.php`, not in the map | `RouteCoverageTest` and `RouteGroupsTest` both FAIL |

- Gate names: `OwnerGate` values (`orders.cancel_late`, `staff.manage_owners`, `settings.change_currency`, `settings.manage_restricted`, `data.delete`) share no value with any `PermissionName`. Closest pairs are `orders.cancel`, `staff.manage` and `settings.manage`. The `owner` gate is a role name, not a permission. ✅
- 2FA exemption prefix trick. Route names are set server-side. Every route registered from `routes/admin.php` is forced to start with `admin.`, so only the exact name `admin.security.two-factor` can match inside the admin group. `Str::is` anchors the patterns, so `admin.security.two-factor.x` is not exempt, and `two-factor.*` and `password.confirm*` require their literal prefix. A request cannot influence the matched route name, and a null route is not exempt. No bypass found. ✅ See M4 for a test gap.
- Resolved order of the real route stacks (`Router::gatherRouteMiddleware`): `... Authenticate > SubstituteBindings > ... > EnsureUserIsActive > EnsureUserType > EnsureTwoFactorEnrolled > EnforceAbsoluteSessionLifetime`. See I1.

## Strengths

- Every middleware fails closed on the user: `EnsureUserType` throws `AuthenticationException` on a non-`User`, and `RecentAuthentication` treats a missing, unreadable or session-less stamp as not recent.
- `ForcedLogout` does logout, then `session()->invalidate()`, then `regenerateToken()`, and only then `Inertia::flash`. The flash lands in the fresh session. The tests prove the cart is destroyed and the message shows once on `login`.
- `RecentAuthenticationRequired` is `ShouldntReport` and renders its own response. Inertia visits get a redirect, and a DELETE from Inertia is converted to 303 (I checked in the scratch copy). JSON and machine paths get the exact `{code}` body.
- The 2FA requirement is read from roles on each request, with a test for a role change taking effect.
- `RouteCoverageTest` has a stale-entry check, an entry-shape check, and an `AccessProbe` that is tested on both its accept and reject paths using stubs. That is not vacuous even though no real entry has a permission or gate yet.
- The webhooks group is stateless with no `web` group, and `webhooks/*` is CSRF-exempt.

## Issues

### Critical (Must Fix)
None.

### Important (Should Fix)

**I1. `SubstituteBindings` runs before `active`, the user-type middleware, `2fa.enrolled` and `session.absolute`.**
- Where: `bootstrap/app.php:565-572` plus the framework middleware priority.
- I confirmed the resolved order with `gatherRouteMiddleware`, and empirically in the scratch copy with an admin route `u/{user}`:
  - A customer on `/admin/u/{existing}` gets 403.
  - A customer on `/admin/u/{missing}` gets 404.
  - An inactive user on `/admin/u/{missing}` gets 404 instead of being logged out with `auth.inactive`.
- Why it matters: this is an existence oracle for staff-only models, and it is a wrong response (404 instead of logout or 403). It will show up as soon as the first parameterised admin or customer route lands. The `[customer, staff]` split is the whole point of this task.
- Fix: in `withMiddleware`, call `$middleware->priority(...)` or `prependToPriorityList(SubstituteBindings::class, [...])` so the aliased classes run before `SubstituteBindings`. Alternatively, use `$middleware->appendToPriorityList` the other way round. Add a regression test with a bound-model stub route in each group (customer on admin: 403 for both existing and missing ids; inactive user: logout).

### Minor (Nice to Have)

**M1. `url.intended` is stored unvalidated (spec 12.7).**
- Where: `app/Exceptions/RecentAuthenticationRequired.php:131`.
- `redirect()->guest()` stores `previous()` (the raw Referer) for non-GET and JSON-expecting requests. In the scratch copy a Referer of `https://evil.example/x` was stored as `url.intended` on an Inertia DELETE.
- Not exploitable today: it needs an authenticated, CSRF-valid request from the app, `SameSite=lax` blocks cross-site cookies, and the GET path stores `fullUrl()`.
- But Fortify's `password.confirm.store` consumes `intended()` with no origin check. Guard at the store side (drop or replace the Referer unless its host equals the app host), or at the consuming login and confirm path.
- `EnsureContactVerified.php:225` `redirect()->back()` has the same Referer trust. That only returns the user to where they came from, so it is harmless.

**M2. Staff reach `api.*` and the Fortify, media and account routes without `session.absolute` or `2fa.enrolled`.**
- Where: `bootstrap/app.php:575`, the api group. This is per spec (13 §1), but it means a staff session older than 12 hours, or an unenrolled owner or admin, can still call editor JSON endpoints.
- Not a task defect. Recommend the controller record that each staff-facing `api.*` route needs its own policy and permission check, or consider adding `session.absolute` to the api group.

**M3. `EnforceAbsoluteSessionLifetime` resets the clock on an unreadable stamp, and `RecentAuthentication::timeOf` accepts future or relative values.**
- Where: `EnforceAbsoluteSessionLifetime.php:174-178` and `RecentAuthentication.php:512-523`.
- Garbage in `auth.login_at` is overwritten with now. A future timestamp (or a string such as "next year") never expires and always counts as recent.
- The session store is server-side and encrypted, so this is hardening only. Treat unreadable as expired, and reject stamps after `now()`.

**M4. Test gap for near-miss exemption names.**
- Where: `EnsureTwoFactorEnrolledTest.php`.
- There is no negative test that an admin-group route named like `admin.security.two-factor-x` or `admin.two-factor.x` still redirects. Add one next to the existing exact-EXEMPT assertion.

**M5. `AccessProbe` is permissive in two ways.**
- Where: `tests/Support/Routing/AccessProbe.php:1734-1737` (the diff's `reached`), plus `checkMiddleware`.
- `reached()` counts any 3xx that is not a redirect to `login` as success. An owner bounced to the 2FA page or a customer bounced to onboarding would pass.
- `checkMiddleware` only checks `Authenticate` and `EnsureUserType`. A future `customer` or `staff` route registered outside the group with just `auth` plus the type middleware would pass without `active`, `onboarded`, `2fa.enrolled` or `session.absolute`.
- Tighten to require status < 300 or an explicit expected redirect, and require the full group stack per audience.

**M6. `ForcedLogout` and `RecentAuthenticationRequired` redirect JSON clients on the api group.**
- Where: `ForcedLogout.php`, via `EnsureUserIsActive` on `/api`.
- A JSON client of an inactive user gets 302 to `/login` instead of a machine response. The spec text says redirect, so this is low priority.
- Revisit when the api routes land: return 401 `{code}` when `expectsJson()` or the path is a machine path.

**M7. `RouteInventory::isVendor` also excludes named routes by URI.**
- Where: `tests/Support/Routing/RouteInventory.php` (`VENDOR_URIS`).
- An app route whose URI starts with `storage/`, `pulse/` or `up` is skipped from the coverage check even when it has an app name. Apply the URI list only when `name === null`.

**M8. Global `const` and `function` definitions in Pest files.**
- `AUDIENCES`, `ALLOWED_ROUTE_PREFIXES`, `loginHoursAgo` and `requestWithSession` are global. They can collide when a later task copies a helper name. Move them into `tests/Support`.

## Assessment

**Spec verdict:** ✅ compliant.
**Task quality:** Needs fixes (one Important: I1, the middleware-priority ordering).

**Reasoning:** The middleware, groups and map are correct and well tested, and the coverage test demonstrably fails when a route lacks a map entry. I1 is a real security-ordering defect that is latent today because no parameterised route exists yet. It should be fixed with a priority-list change and a regression test before any parameterised admin or customer route is added.
