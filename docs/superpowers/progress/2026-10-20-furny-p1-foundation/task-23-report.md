# Task 23 report: auth middleware, route groups, route coverage map

## Implemented
- Seven middleware (`app/Http/Middleware`): `EnsureUserIsActive`, `EnsureUserType` (`customer`/`staff`), `EnsureCustomerOnboarded` (EXEMPT const), `EnsureContactVerified`, `EnsureTwoFactorEnrolled` (EXEMPT const), `EnforceAbsoluteSessionLifetime`, `RequireRecentAuthentication`; aliases registered in `bootstrap/app.php` (`active, customer, staff, onboarded, verified.contact, 2fa.enrolled, session.absolute, recent.auth`).
- `App\Support\Auth\RecentAuthentication` (`passes(Request)`, key constants, `timeOf()` reading unix timestamps, date strings and dates), `App\Support\Auth\ForcedLogout` (shared by `active` and `session.absolute`: logout, invalidate, regenerate CSRF token, `Inertia::flash('error', ...)`, redirect `login`), `App\Exceptions\RecentAuthenticationRequired` (renders itself; `ShouldntReport`).
- `User::requiresTwoFactor()` (staff holding owner/admin, read from roles each call).
- Route groups in `bootstrap/app.php` `then:`: customer, admin (`/admin`, `admin.`), api (`/api`, `api.`, `throttle:api`), webhooks (stateless, `throttle:webhooks`); `routes/api.php`, `routes/webhooks.php` created (empty, comment only); comments in `routes/customer.php`, `routes/admin.php`.
- Lang: `auth.inactive`, `auth.session_expired`, `auth.2fa_required` added. `common.verify_required` already existed (Task 21), not re-added.
- Fold-in: describe title in `tests/Unit/Logging/RedactPiiProcessorTest.php` renamed.
- Messages use native `Inertia::flash('error', trans_icu(...))` (arrives as top-level `page.flash.error` on the next Inertia page, including after redirect to `login`).

## Tests
- `tests/Feature/Auth/Middleware/{EnsureUserIsActive,EnsureUserType,EnsureCustomerOnboarded,EnsureContactVerified,EnsureTwoFactorEnrolled,EnforceAbsoluteSessionLifetime,RequireRecentAuthentication}Test.php`
  - includes the required extra test: customer on `/admin` and `admin.dashboard` -> 403 Inertia `Error` (status 403), also as an Inertia JSON visit; guest -> `login`.
- `tests/Feature/Security/RouteGroupsTest.php`: aliases, exact group middleware of `customer.dashboard`/`admin.dashboard`, all non-vendor routes named, no duplicate method+path, no duplicate names, allowed prefixes (incl. `fallback`, `unmatched.plain`).
- `tests/Feature/Security/RouteCoverageTest.php` + `route-access.php`: every `route:list --json` route (minus vendor) is in the map; no stale entries; entry shape; per-entry probe (`tests/Support/Routing/AccessProbe.php`) checks middleware matches the audience and, for parameterless GET routes, guest/customer/staff behaviour incl. permission/gate denial; the probe itself is tested with stub routes (accept and reject cases) since no real entry has a permission/gate yet.
- Test support: `tests/Support/InertiaRequest.php`, `tests/Support/Routing/{AccessStubs,RouteInventory,AccessProbe}.php`. Stub routes (`customer.onboarding.show`, `admin.security.two-factor`, `auth.reauthenticate`) are registered in test setup only.

### RED
`vendor/bin/pest tests/Feature/Auth/Middleware tests/Feature/Security/RouteGroupsTest.php tests/Feature/Security/RouteCoverageTest.php` before implementation: `68 failed, 48 passed` (aliases `active`/`customer`/`staff`/... undefined, so the group, middleware and probe tests failed; the 48 passing were tests that do not need the middleware).
### GREEN
Same command after implementation: `116 passed (545 assertions)`.

## Gates
- `vendor/bin/pint --test`: passed. `vendor/bin/phpstan analyse` (level 8): No errors.
- `vendor/bin/pest tests/Unit tests/Feature`: 2291 passed (8877 assertions).
- Gates-Gen: `typescript:transform`, `i18n:export`, `wayfinder:generate` run; `git diff --exit-code -- resources/js/types/generated.d.ts resources/js/lang/generated` clean (no route or enum changes).

## Route map (all named non-vendor routes now)
public: welcome, legal.terms, legal.privacy, manifest, csp.report, fallback, unmatched.plain. guest: login(.store), register(.store), password.request/email/reset/update, two-factor.login(.store). any: logout, verification.*, password.confirm(.store)/confirmation, two-factor.enable/confirm/disable/qr-code/secret-key/recovery-codes/regenerate-recovery-codes. customer: customer.dashboard. staff: admin.dashboard. Excluded as vendor/framework: horizon.*, pulse, telescope*, storage.local*, boost.*, livewire*, default-livewire.*, `up`, `_inertia/*`.

## Concerns / decisions to review
1. `auth.login_at` is not written by anything yet (the login listener is a later auth task). `session.absolute` therefore starts the clock on the first staff request when the stamp is missing (bounded rather than fail-open or lock-everyone-out); `recent.auth` treats a missing stamp as not recent (fail closed). Once the login listener sets `auth.login_at` (unix timestamp), both behave per spec.
2. `RecentAuthenticationRequired` redirects passwordless users to `auth.reauthenticate`, which does not exist until the OTP task; until then `route()` would throw for such users on a `recent.auth` route (no route uses `recent.auth` yet).
3. The api and webhooks groups are registered but empty, so their middleware cannot be asserted from a real route; RouteGroupsTest covers customer and admin only.
4. `EnsureTwoFactorEnrolled` exempt `logout` is covered by the EXEMPT constant assertion only (the real `logout` route is outside the admin group).
5. Flash key for the 2FA banner is `error` (per the lead's rule), not `warning`.
6. Extra files beyond the brief list: `ForcedLogout`, `User::requiresTwoFactor()`, test support classes.

## Fix round 1

- **I1 binding order:** `bootstrap/app.php` inserts `EnsureUserIsActive`, `EnsureUserType`, `EnsureCustomerOnboarded`, `EnsureTwoFactorEnrolled`, `EnforceAbsoluteSessionLifetime` before `SubstituteBindings` (`prependToPriorityList`, in that order, after `Authenticate`). New `tests/Feature/Security/RouteBindingOrderTest.php` (bound routes in the admin, customer and api-style stacks): customer on admin gets the same 403 `Error` page for an existing and a missing id; staff on a customer route redirects identically; inactive user is logged out (not 404), also JSON 401; unenrolled admin redirected to 2FA; not-onboarded customer redirected; expired staff session expires. `RouteGroupsTest` asserts the resolved order on the real groups. Mutation check: with the priority loop removed, 10 of those tests fail.
- **M1 intended URL:** `RecentAuthenticationRequired` stores `url.intended` itself: the request URL for GET, else the Referer only when scheme+host+port match the request or `config('app.url')`, stored as a relative path with a single leading slash; otherwise nothing. Tests: other host, protocol-relative, `javascript:`, userinfo trick, other port, relative, garbage, no Referer, `//` path collapse, valid request-origin and app.url paths.
- **M3 stamps:** `RecentAuthentication::timeOf` accepts only positive integers not more than 60 s in the future (`SKEW_SECONDS`). `session.absolute`: missing stamp starts the clock; present but unreadable (zero, negative, string, float, array, bool, far future) expires the session. `recent.auth`: future, string, float, Carbon, zero, negative, true all fail as not recent; 30 s skew tolerated in both. Tests for each.
- **M4:** negative tests for `admin.security.two-factor-x`, `admin.security.two-factor.x`, `admin.two-factor.x`, `two-factorx`, `logout.other`, `xlogout`, `my.password.confirm`: all still redirect, no pattern change needed. `password.confirmation-bogus` is deliberately not in the list: it matches the spec glob `password.confirm*` (which exists to cover `password.confirmation`), and no real admin-group route can be named like it (admin-group names always start with `admin.`).
- **M5 AccessProbe:** requires the full group stack (customer `web,auth,active,customer,onboarded`; admin `web,auth,active,staff,2fa.enrolled,session.absolute`; `api.*` and other names get the matching reduced stack); "reached" is now 2xx only, or the password confirmation redirect for routes behind `RequirePassword`; guests on guest pages get 2xx (`two-factor.login` redirects to `login`, listed explicitly); signed-in users on guest pages must redirect to `fortify.home`; `any` is probed with an unverified customer so `verification.notice` renders.
- **M6:** `ForcedLogout::toLogin($request, 'inactive'|'session_expired')` returns `401 {code}` for JSON/XHR and machine paths (new `ErrorPage::wantsMachineResponse`, also used by `RecentAuthenticationRequired` and `ErrorPage::handles`), else redirect to `login` with the flash.
- **M7:** `RouteInventory::isVendor` uses the name patterns for named routes and the URI patterns only for unnamed ones; guard tests added.
- **M8:** globals removed: `AUDIENCES` -> `AccessProbe::AUDIENCES`, `ALLOWED_ROUTE_PREFIXES` -> `RouteInventory::ALLOWED_NAME_PREFIXES`, `loginHoursAgo`/`requestWithSession` -> `Tests\Support\SessionStamp`.
- **M2:** not actioned (carried to later tasks).

Commands: `vendor/bin/pest tests/Feature/Auth tests/Feature/Security` -> 436 passed (1732 assertions); `vendor/bin/pest tests/Unit tests/Feature` -> 2341 passed; Pint clean; PHPStan "No errors"; Gates-Gen clean.
