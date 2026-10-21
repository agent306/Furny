# Task 30 report: staff invitations and staff management

Status: DONE_WITH_CONCERNS (concerns are decisions to confirm, see the end).

## What was implemented

Backend (`app/`)
- Actions in `App\Domain\Identity\Actions`: `InviteStaff`, `ResendStaffInvitation`, `RevokeStaffInvitation`, `AcceptStaffInvitation`, `UpdateStaffMember`, `DeactivateUser`, `ActivateUser`, `ResetTwoFactor`. Names follow ruling C10 (14's `UpdateStaffMember`/`ActivateUser`), not the brief's `ChangeStaffRole`/`ReactivateUser`.
- `StaffAccess` (Identity/Support): `staff.manage` and the `staff.manage_owners` gate for inviting, granting, editing and acting on owners, asked by the requests and again by every action; plus the last-active-owner check under a Postgres advisory transaction lock (`pg_advisory_xact_lock`), so two owners who demote or deactivate each other at the same moment cannot both succeed.
- `AccountDefaults` (Identity/Support): the one place that reads timezone, units and locale from business settings; `RegisterCustomer` now uses it and `AcceptStaffInvitation` reuses it (no hard-coded `Asia/Kolkata`).
- `CodedValidationException` (Support/Http): a `ValidationException` carrying a code. Forms get the errors bag with `code` (14 §1.9); JSON clients get 422 `{code, message, errors}` (14 §1.8). Rendered in `bootstrap/app.php`. No such helper existed before; codes used: `staff.email_in_use`, `staff.invitation_pending`, `staff.last_owner`, `staff.errors.self`, plus `staff.invitation_closed` (resend/revoke of an accepted or revoked invitation, my addition in the `staff.*` family).
- `InvalidInvitationLink` (Support/Http): a bad or expired signature on `staff.invitations.*` renders `Auth/InvitationInvalid` (`invalid`, or `expired` when the signature is right but has run out) instead of the 403 page.
- `StaffInvited` notification (queued, encrypted, on-demand mail, `URL::temporarySignedRoute('staff.invitations.show', $invitation->expires_at, ...)`); date in the business timezone.
- Controllers `Admin\StaffController`, `Admin\StaffInvitationController`, `Auth\StaffInvitationController`; requests under `Requests/Admin/Staff/*` and `Requests/Auth/AcceptStaffInvitationRequest`; Data `StaffRowData`, `StaffRowAbilitiesData`, `StaffInvitationRowData`, `UserRefData`.
- Routes: `routes/admin.php` (`admin.staff.*`, `can:staff.manage`, `throttle:invitations` on store and resend), `routes/web.php` (`staff.invitations.show|accept`, `signed`). ULID route patterns for `user` and `invitation` (14 §1.6) in `AppServiceProvider`. Route-access entries in `tests/Feature/Security/route-access.php` (that file is the map in this repo; there is no registry.json/authorization.php fixture yet).
- The `invitations` limiter already existed (config + provider): 20 a day per user, shared by invite and resend.
- `RevokeSessions` got `REASON_DEACTIVATED = 'deactivated'` and `REASON_TWO_FACTOR_RESET = '2fa_reset'`; `GoogleController` now reads its invitation session keys from the constants of `Auth\StaffInvitationController` (same values).
- `StaffInvitation` model: `VALID_FOR_HOURS = 72`, `isOpen()`, `isExpired()`.

Frontend (`resources/js`)
- `pages/Admin/Staff/Index.vue`, `components/admin/staff/{InviteStaffDialog,EditStaffDialog,StaffRolePicker}.vue`, `pages/Auth/{AcceptInvitation,InvitationInvalid}.vue`, admin nav group Administration > Staff (`staff.manage`), icons added, types in `types/domain.ts`; strings in `lang/en/{staff,roles,notifications,common}.php`; generated types and i18n catalogue regenerated.

## Decisions and behaviours worth knowing
- Signed links: expiry equals `expires_at`. Resend sets `expires_at = now()+72h` and mails a new link. 13 §5.9 does not say resend invalidates the old link, so the old link stays valid until its own signature expiry, as long as the invitation is still open. A revoke closes all links.
- Accept: row lock (`lockForUpdate`) and re-check of accepted/revoked/expired inside the transaction; email re-checked incl. soft-deleted; a unique violation on insert is mapped to `staff.email_in_use`. Google id is taken from `session("invitation.google.{id}")` (bound to the invitation), dropped when another account (soft-deleted included) has it. Sign-in without remember; `auth.pending_method` is set to `{method: 'google', user: id}` only when Google was linked (the listener's key is `user`, not `userId`). Session keys `invitation.*` are cleared after accept.
- Show page stores `invitation.id` and `invitation.url` (the full signed URL) in the session when it renders the form, so the Google button is a plain link to `auth.google.redirect?intent=invitation`. Extra prop `googleConnected` (not in 11 §7.1) so the page can say Google is connected.
- The invitation is looked up in the controller, not route-bound, so an unknown id looks like a bad signature (no existence oracle). A malformed id is a 404 by the route pattern.
- Open (not accepted, not revoked) invitations count as "pending" for the DB unique index even when expired. `InviteStaff` therefore closes an expired open invitation (`revoked_at`, audited with `reason: superseded`) and issues a new one; otherwise an expired invitation older than the 30-day list window could never be re-invited. An unexpired one gives `staff.invitation_pending`.
- Order of refusals in demote/deactivate: owner gate (403), then `staff.last_owner`, then `staff.errors.self`. This makes the sole owner acting on themselves get `staff.last_owner`, which is the only way to reach that error over HTTP (an actor with the owner gate is always itself an active owner). Role change by someone on themselves with a different role is `staff.errors.self`; a name-only edit of oneself is not blocked server-side, the row just offers no actions on oneself.
- Reset 2FA: nobody resets their own through this action; `actor = null` (console, Task 31) is allowed and audits `via: console` with no causer. Deactivate/reactivate/reset of someone already in that state is a no-op without audit.
- `DeactivateUser`/`ActivateUser` are staff-only for now (LogicException for a customer); the customer variants belong to the customers task.
- A name change without a role change writes no audit entry (13 §17 lists none).
- Responses of the admin actions are `back()` redirects (14 §10), also for JSON requests.

## Tests
TDD, backend: tests first.
- RED: `vendor/bin/pest tests/Feature/Staff` before any implementation: `Tests: 157 failed (6 assertions)` (routes, classes and pages missing).
- GREEN: `vendor/bin/pest tests/Feature/Staff` -> `161 passed (794 assertions)`:
  - `InviteStaffTest` (store, signed mail, audit, email in use incl. soft-deleted, pending, superseded expired, owner/estimator/customer/guest, 21st invite 429, resends counted, resend/revoke rules).
  - `AcceptInvitationTest` (tampered, no signature, unknown id, malformed id, 73 h, DB-expired, revoked, accepted, signed in; accept creates the user with role, `email_verified_at`, `terms_accepted_at`, business timezone, no remember cookie, `ContactVerified`, audits, Google id bound to the invitation, password login vs Google login method; refusals; second POST from another browser gives `accepted` and still one user; double submit from one browser).
  - `StaffManagementTest` (index props shape, `can` flags, roles/assignable; role change, owner rules, last owner, self; deactivate with sessions destroyed, `remember_token` rotated, audits; activate; reset 2FA; actions without a request).
  - `StaffConcurrencyTest` (group `concurrency`, real parallel PHP processes via `tests/Support/staff-worker.php`): four simultaneous accepts of one invitation give exactly one user; two owners demoting each other: one wins; four owners deactivating each other in a ring never leave zero active owners. Mutation-checked: removing the invitation row lock or the owners lock makes these fail (ring test 3 of 3 runs).
- Vitest: `InviteStaffDialog` hides the owner option without `staff.manage_owners`; also `EditStaffDialog`, `Admin/Staff/Index`, `AcceptInvitation`, `InvitationInvalid`, nav. The frontend tests were written after the components; a mutation (owner option always shown) fails the two "hides the owner option" tests.
- Browser (`tests/Browser/StaffPagesTest.php`, `PLAYWRIGHT_BROWSERS_PATH` as given, after `yarn vite build`): staff page, accept page and the three invalid-link pages at 375/820/1280 px (one h1, no horizontal scroll, no JS errors) and axe. I could not test the submit flows end to end: the Pest browser plugin's in-process server does not deliver the request that follows a redirect to an XHR (`fetch` with redirect follow never reaches the app; the POST itself answers 302 correctly), so those flows are covered by Feature tests and vitest.
- Full gates, final run on the commit:
  - `vendor/bin/pint --test`: passed. `vendor/bin/phpstan analyse`: no errors.
  - `vendor/bin/pest tests/Unit tests/Feature`: 3409 passed (14555 assertions) before the last test added (161 in `tests/Feature/Staff` after it).
  - `tests/Browser`: 81 passed.
  - `yarn lint`, `yarn format:check`, `yarn typecheck`: clean; `yarn vitest run`: 85 files, 1315 tests passed.
  - Gates-Gen: `php artisan typescript:transform` and `i18n:export` run, generated files committed.

## Files
Created: `app/Domain/Identity/Actions/{InviteStaff,ResendStaffInvitation,RevokeStaffInvitation,AcceptStaffInvitation,UpdateStaffMember,DeactivateUser,ActivateUser,ResetTwoFactor}.php`, `app/Domain/Identity/Data/{StaffRowData,StaffRowAbilitiesData,StaffInvitationRowData,UserRefData}.php`, `app/Domain/Identity/Support/{AccountDefaults,StaffAccess,InvitationUnavailable}.php`, `app/Http/Controllers/Admin/{StaffController,StaffInvitationController}.php`, `app/Http/Controllers/Auth/StaffInvitationController.php`, `app/Http/Requests/Admin/Staff/*`, `app/Http/Requests/Auth/AcceptStaffInvitationRequest.php`, `app/Notifications/Staff/StaffInvited.php`, `app/Support/Http/{CodedValidationException,InvalidInvitationLink}.php`, Vue files listed above, tests listed above, `tests/Support/staff-worker.php`.
Modified: `routes/{admin,web}.php`, `bootstrap/app.php`, `app/Providers/AppServiceProvider.php`, `RegisterCustomer`, `RevokeSessions`, `StaffInvitation`, `GoogleController`, `resources/lang/en/*`, `resources/js/{lib/adminNav.ts,lib/icons.ts,types/domain.ts,types/generated.d.ts,lang/generated/*,lib/__tests__/nav.test.ts}`, `tests/Feature/Security/route-access.php`.

## Self-review
- Checked the diff for leftovers: scratch files, backups and `tests/Browser/Screenshots` removed.
- Authorization is enforced in requests and actions; `can:` is route middleware, so (as everywhere in the app) a staff member without `staff.manage` gets 404 for a missing `{user}` and 403 for an existing one, because Laravel runs `SubstituteBindings` before `Authorize`. Only ULIDs are involved; noted, not changed.
- File sizes are small; `StaffController::index` builds the props inline (one place); no file grew past its purpose.

## Concerns (decisions to confirm)
1. Action names follow C10 (`UpdateStaffMember`, `ActivateUser`), not the brief's names.
2. New `CodedValidationException` and the extra code `staff.invitation_closed` (no helper existed; 14 §1.9's coded-validation helper is still open for the other codes such as `last_login_method`, which I did not touch).
3. Expired open invitations are closed and replaced by a new invite instead of answering `staff.invitation_pending` (see decisions).
4. Resend does not invalidate older still-signed links (spec silent).
5. Self-protection order puts `staff.last_owner` before `staff.errors.self`.
6. Browser submit flows could not be exercised (plugin limitation above).
