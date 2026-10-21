# Task 23 re-review, fix round 1 (03e658b..3568ee8)

## Finding Verdicts

- **I1: binding runs before the access checks.** ADDRESSED.
  - `bootstrap/app.php` (the `prependToPriorityList` loop) now puts the five checks before `SubstituteBindings`.
  - I printed the resolved stacks with `gatherRouteMiddleware`. Admin is `Authenticate > EnsureUserIsActive > EnsureUserType:staff > EnsureTwoFactorEnrolled > EnforceAbsoluteSessionLifetime > SubstituteBindings`. Customer is `Authenticate > EnsureUserIsActive > EnsureUserType:customer > EnsureCustomerOnboarded > SubstituteBindings`.
  - `RouteBindingOrderTest` covers customer on admin (403 for an existing and a missing id), staff on a customer route, inactive user (also JSON 401), unenrolled admin, not-onboarded customer, expired session, and the allowed user still getting 404 for a missing record.
  - `RouteGroupsTest` asserts the order on the real groups.
  - Focused run: `tests/Feature/Auth/Middleware`, `RouteBindingOrderTest`, `RouteGroupsTest` and `RouteCoverageTest` give 166 passed.
- **M1: unvalidated intended URL.** ADDRESSED. `RecentAuthenticationRequired.php` (`sameSitePath` and `render`) stores `url.intended` itself.
  - For non-GET it keeps the Referer only when scheme, host and port match the request or `app.url`.
  - It stores only path and query, with a single leading slash.
  - Because it rebuilds a relative path from parsed parts, even a parser-differential Referer such as `https://evil\@host/` cannot yield an external target.
  - Tests cover other host, protocol-relative, `javascript:`, the userinfo trick, another port, a relative or garbage Referer, no Referer, and `//` collapse.
- **M2: staff reach api and Fortify routes without `session.absolute` or `2fa.enrolled`.** CARRIED, per ruling.
- **M3: stamp handling.** ADDRESSED.
  - `RecentAuthentication::timeOf` accepts only a positive int that is not more than 60 s ahead.
  - `EnforceAbsoluteSessionLifetime.php`: a missing (null) stamp starts the clock; an unreadable stamp (zero, negative, string, float, array, false, far future) expires the session, with a test per case.
  - `recent.auth` rejects future, string, float, Carbon, zero, negative and true stamps, with tests.
  - 30 s of skew is tolerated in both.
- **M4: near-miss 2FA exemption tests.** ADDRESSED. `EnsureTwoFactorEnrolledTest` adds seven near-miss names that must still redirect. Leaving `password.confirmation-bogus` out is accepted per ruling.
- **M5: `AccessProbe` permissiveness.** ADDRESSED.
  - `opened()` is now 2xx only, with the password-confirm redirect allowed solely for routes behind `RequirePassword`.
  - `checkMiddleware` requires the full group stack per audience (`requiredStack` and `aliasesOf`).
  - Guest pages must redirect signed-in users to `fortify.home`.
- **M6: JSON clients get a redirect.** ADDRESSED. `ForcedLogout::toLogin` returns `401 {code: inactive|session_expired}` when `ErrorPage::wantsMachineResponse` is true (JSON, XHR or machine path), and still redirects Inertia and browser requests. The helper is shared with `RecentAuthenticationRequired` and `ErrorPage::handles`. Tests cover the active and absolute middleware, and a machine path without an `Accept` header.
- **M7: URI exclusion on named routes.** ADDRESSED. `RouteInventory::isVendor` applies name patterns to named routes and URI patterns only to unnamed ones. Guard tests added.
- **M8: global consts and functions in Pest files.** ADDRESSED. They moved to `AccessProbe::AUDIENCES`, `RouteInventory::ALLOWED_NAME_PREFIXES` and `Tests\Support\SessionStamp`. I found no remaining globals in the diff.

## New Breakage in the Fix Diff

None Critical or Important.

- Minor: for GET requests `RecentAuthenticationRequired.php` (the `render` method) stores `fullUrl()`, which is absolute, not relative as ruling M1 states. It is same-origin by construction (built from the request's own host), so it is not an open redirect, but it is inconsistent with the non-GET branch. `$request->getRequestUri()` would make it relative. Not blocking.

## Out-of-Scope Observations

- `verified.contact`, `recent.auth` and `can:` still run after `SubstituteBindings`. This is acceptable today because the user has already passed the group checks, but keep it in mind for customer routes with ownership-based 404 or 403 semantics.
- The future login writer of `auth.login_at` and `auth.password_confirmed_at` must store integer unix timestamps. Anything else now fails `recent.auth` and expires staff sessions.

## Verdict

**Fix round:** All findings addressed (M2 carried per ruling), no new Critical or Important breakage.

APPROVED
