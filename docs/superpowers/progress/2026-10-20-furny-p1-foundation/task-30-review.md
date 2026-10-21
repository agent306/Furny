# Task 30 review: staff invitations and staff management (4953785..0820486)

### Spec Compliance

- ✅ Spec compliant. Rulings accepted by the controller were not re-flagged: C10 names, `CodedValidationException` and `staff.invitation_closed`, superseding expired invitations, resend keeping old links, the check order, `googleConnected`, and `pending_method.user`.
  - **Props.** `StaffIndexProps`, `StaffRowData`, `StaffInvitationRowData` and `UserRefData` match 11 §7 and 10 §3 field for field (StaffRowData.php:16-27, StaffInvitationRowData.php:15-24, StaffController.php:50-79, generated.d.ts:4744-4777). `InvitationInvalidProps` matches 14 §3.4.
  - **`passwordRules`.** `AcceptInvitation` has an extra prop, `passwordRules`. It is not in 11 §7.1, but it follows the existing `Register.vue`/`ResetPassword.vue` convention, so it is not counted as a finding.
  - **Routes and middleware** match 14 §3.4 and §10: `signed` covers both GET and POST of `staff/invitations/{invitation}`, `can:staff.manage` covers `admin.staff.*`, and `throttle:invitations` covers store and resend (routes/web.php:87-90, routes/admin.php:46-57).
  - **ULID patterns.** These are global, per 14 §1.6. Only the new routes use `{user}` or `{invitation}`. I checked this with a grep over `routes/`.
  - **13 §5.9 steps 1-5.** Covered: lower-cased email, `withTrashed` email checks, a 72 h `expires_at`, a signed URL that uses `expires_at`, an on-demand mail, accept under a row lock with a re-check, `email_verified_at`, `terms_accepted_at`, business defaults, login without remember, session regeneration, audit, and redirect.
  - **13 §5.10 reset.** All three Fortify columns are cleared (ResetTwoFactor.php:45-49). The migration has only those three `two_factor_*` columns. I checked the users migration.
  - **13 §17 events and properties** match: `staff.*` events in the `staff` log with masked email and role, `staff.role_changed {from,to}`, field names for deactivate and reactivate, and `auth.2fa_reset {via}` in `security`.
  - **12 §3.3 and §3.7** `staff.invited` strings and parameters match.
- ⚠️ **Cannot verify from the diff.** These parts live outside it:
  - The partial unique index on open invitations per email, which the `InviteStaff` race handling depends on.
  - The `Gate::before` that denies inactive staff.
  - The 13 §17 "403 on admin.* to the security channel" logger.
  - `RevokeSessions::all` → `SessionRegistry::destroyAll`, which rotates `remember_token`. I checked this one: SessionRegistry.php:201-207 calls `rotateRememberToken`.

### Strengths

- **Signed links are solid.**
  - The POST is behind `signed` on the same path, so A's signature cannot be used on B.
  - A tampered link, a missing signature or an unknown id renders `invalid`, with no oracle about whether the invitation exists (Auth/StaffInvitationController.php:37-46).
  - An expired signature is told apart from a wrong one (InvalidInvitationLink.php:19-21).
- **Accept is race-safe.**
  - `lockForUpdate` on the invitation, then a re-check of accepted, revoked and expired (AcceptStaffInvitation.php:48-59).
  - Email and Google are re-checked with `withTrashed`.
  - A savepoint around the insert maps unique violations to `staff.email_in_use`.
- **The Google choice is bound to the invitation.** It is stored as `invitation.google.{id}` and written only by the callback after `email === invitation.email` (GoogleController.php:339-356). Reading it only by the invitation's own id (StaffInvitationController.php:131) means a choice made for A cannot be carried over to B.
- **The last owner is protected under concurrency.** A Postgres advisory transaction lock is taken before the active owners are counted (StaffAccess.php:83-102). It is backed by real multi-process tests.
- **Owner-gate checks are done twice**, in the requests and again in the actions. `syncRoles` also strips a stray second role.
- **Coded refusals render to spec.** JSON gets `{code, message, errors}` (14 §1.8). Inertia gets the errors bag plus `code` (14 §1.9) (bootstrap/app.php:2167-2169 in the diff).
- **Tests are thorough and behavioural.** I found no mocks of the code under test.

### Mutation checks

I ran these in a scratch copy, which I have deleted. The worktree was not touched.

| Mutation | Result |
|---|---|
| Remove `signed` from the accept POST only | caught (1 failure: tampered-signature accept) |
| Drop `withTrashed()` in the `InviteStaff` email check | caught |
| Count inactive owners in `isLastActiveOwner` | caught |
| Read any `invitation.google.*` instead of this invitation's | caught (2) |
| Drop the revoke-sessions call in `ResetTwoFactor` | caught (3) |
| `assignRole` instead of `syncRoles` | caught (4) |
| Drop the self check in `DeactivateUser` | caught (2) |
| Drop the accepted re-check under lock | caught |
| Drop the expiry re-check under lock | caught |
| Drop `code` from the JSON envelope | caught (17) |
| Drop `lockOwners()` in `UpdateStaffMember` | caught (concurrency demote test) |
| Drop `lockForUpdate` in `AcceptStaffInvitation` | caught (concurrency accept test) |
| Show owner in `StaffRolePicker` regardless of the gate (vitest) | caught (2) |
| `StaffInvited` URL built with `now()->addHours(72)` instead of `expires_at` | **survived** |
| Drop `authorizeTarget` in the `UpdateStaffMember` action | **survived** (the request still guards) |
| Drop `authorizeTarget` in the `ActivateUser` action | **survived** |

Baseline in scratch: `tests/Feature/Staff` gave 161 passed: 158 non-concurrency plus 3 concurrency. The staff vitest files gave 37 passed. The output had no warnings.

### Issues

#### Critical (Must Fix)

None.

#### Important (Should Fix)

None.

#### Minor (Nice to Have)

1. **Authorization is evaluated before the owners lock and refresh, and not again after them.**
   - Where: UpdateStaffMember.php:34-39, DeactivateUser.php:36-39 and ActivateUser.php:25-28.
   - `authorizeTarget` and `authorizeGrant` run on the target's and actor's state from before `lockOwners()` and `$staff->refresh()`. Example: an admin edits estimator E while an owner promotes E to owner at the same moment. After the lock, the admin's update applies to a now-owner and demotes them without the gate. Likewise, an owner who was demoted concurrently can still complete an owner-gated action.
   - The last-owner invariant itself holds, and the concurrency test explicitly accepts `forbidden`/`ok` outcomes.
   - Fix: after `lockOwners()` and `refresh()`, also refresh the actor and re-run `authorizeTarget` and `authorizeGrant` inside the transaction.
2. **The mail test cannot tell `expires_at` from `now()+72h`.**
   - Where: InviteStaffTest.php:45-69 (mail) and :252-270 (resend).
   - The clock is frozen, and the invitation was created with `now()+72h`, so a URL built from `now()->addHours(72)` passes too (mutation survived). In production the mail is queued, so the two values differ by the queue delay.
   - Fix: travel between the invite and `toMail()`, or use a factory invitation whose `expires_at` is not now+72h, and assert that `expires` equals it.
3. **The action-level owner-gate checks for targets are untested.**
   - Where: StaffManagementTest.php:583-589 covers only `authorizeGrant` in `UpdateStaffMember` and `InviteStaff`.
   - Removing `authorizeTarget` from `UpdateStaffMember` or `ActivateUser` leaves every test green. The report's claim that "no caller can skip the gate" is therefore only half covered.
   - Fix: add action-level tests, for example `app(DeactivateUser::class)->handle($admin, $owner)` and the same for `ActivateUser`, `ResetTwoFactor` and `UpdateStaffMember`, each throwing `AuthorizationException`.
4. **Reactivation does not revoke sessions or rotate `remember_token`.**
   - Where: ActivateUser.php:19-45.
   - The 13 §5.9 lifecycle line and the brief say that both deactivate and reactivate destroy sessions and rotate the token.
   - In practice deactivation already did both, and an inactive user cannot sign in, so the risk is nil. Still, it is a literal deviation, and the report does not mention it.
   - Fix: either call `RevokeSessions::all` there or record it as a decision.
5. **The report's claim about reset is inaccurate, and reset has no no-op path.**
   - The report says "Deactivate/reactivate/reset of someone already in that state is a no-op without audit".
   - In fact `ResetTwoFactor` always writes `auth.2fa_reset` and revokes sessions, even when the target has no second factor (ResetTwoFactor.php:44-62). The UI offers it only when `twoFactorEnabled` (StaffRowData.php:54).
   - Fix: add a no-op when `two_factor_secret` and `two_factor_confirmed_at` are both null, or correct the report.
6. **Server errors stay on screen after a dialog closes.**
   - Where: InviteStaffDialog.vue:46-58, EditStaffDialog.vue:46, Index.vue:74-82.
   - The dialogs read `page.props.errors`, which persists until the next visit. Two cases:
     - After a refused invite, the user cancels and reopens the dialog. The fields are reset but the old error is still shown.
     - A refused resend (`staff.email_in_use` on field `email`) is toasted, and the same message then shows under the invite dialog's email field the next time it opens.
   - Fix: clear errors when a dialog opens (`router.reload`/`page.props.errors = {}`), or put the resend refusal on its own field or `_error`.
7. **Admins without the owner gate are offered Resend and Revoke on owner invitations.**
   - Where: Index.vue:403-430.
   - The buttons render for every invitation. For an admin, clicking one on an owner invitation lands on the 403 Error page.
   - Fix: hide or disable them when `invitation.role === 'owner' && !can('staff.manage_owners')`.
8. **The terms caption is assembled from sentence fragments.**
   - Where: AcceptInvitation.vue:197-213, staff.php `accept.terms_before|terms_and|terms_after`.
   - Fragment-joined sentences cannot be reordered by translators. The report says this mirrors the existing Google button caption, so this is low priority. Consider one ICU message with link placeholders when i18n is next touched.

### Assessment

**Task quality:** Approved

**Reasoning:** The security-critical paths hold: signed links, invitation binding, the accept row lock and re-check, Google binding, the owner gate in both layers, the concurrent last-owner check, session revocation and token rotation, masked audits, and the limiter. Mutation checks confirm the tests cover them. The remaining items are a narrow authorization-ordering race, two test-strength gaps, and small UI and spec-literal deviations.
