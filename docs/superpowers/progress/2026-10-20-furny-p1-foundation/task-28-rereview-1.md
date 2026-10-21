# Task 28 re-review 1: fix round 654918d..ee70418

**Scope:** the 9 findings in `task-28-review.md`, the controller's rulings for this round, and the fix diff (1114 lines, read once).

**Checks I ran:** a scratch copy outside the worktree, with the vendor packages symlinked. It has been deleted, and the worktree `git status` is clean.

- `GoogleOAuthTest`: 116 passed (529 assertions). That matches the report.
- My original pre-hijack scenario, plus three denial-of-service probes and one staff probe.
- Three takeover mutants.

### Finding Verdicts

1. **Pre-hijack through linking by email to an unverified, password-bearing account** — ADDRESSED.
   - `LinkGoogleAccount.php:74`: `$takeover` requires an existing email with `email_verified_at === null`.
   - The password is cleared and `remember_token` rotated inside the link transaction.
   - The audit `reason: google_link_unverified` is written at `:101`.
   - After the commit, `RevokeSessions::all()` runs on the login path, and `others($user, current)` on the link path (`:111-114`).
   - Sessions are revoked after the commit rather than inside the transaction, unlike the ruling's wording. That is correct, because the registry is Redis.
   - My scratch scenario re-run: after the victim's Google sign-in, the attacker's account has a null password and its registry session is dead. Password login as the attacker now fails with errors and leaves a guest. The audit reads `{replaced: true, reason: google_link_unverified}`.
   - **No denial-of-service lever against verified accounts.**
     - A verified victim plus a *different* Google id with the same verified email: the link is replaced, but the password hash, the remember token and the registry session are all unchanged (scratch).
     - The `link` intent on a verified account changes nothing (scratch).
     - Mutant: dropping `email_verified_at === null` from `:74` is killed by 2 tests, "leaves … verified account alone" and "says in the audit …".
     - Triggering the clean-up needs a Google account whose verified email is the victim's *unverified* address. Such an attacker could already sign in under 13 §5.3, so the clean-up adds no new capability.
2. **`google_id` silently replaced, audit uninformative** — ADDRESSED. `LinkGoogleAccount.php:72,101` records `replaced: bool`, tested with `{replaced: true}` and `{replaced: false, reason}`.
3. **Unlink counted a password without an email** — ADDRESSED. `UnlinkGoogleAccount.php:24` is `hasPassword() && email !== null`. The new test covers email null, a password, an unverified phone and Google.
4. **`auth.pending_method` not bound to a user** — ADDRESSED.
   - It is set as `{method, user}` at `GoogleController.php:255`.
   - `RecordSuccessfulLogin.php:52-57` accepts it only when the login is not via remember, the method is allowed and the user matches.
   - Tests cover Fortify registration in the same session (gets `password`) and a remember-cookie login (gets `remember`).
5. **`email_verified: false` tested only for intent login** — ADDRESSED. A dataset over `login`, `link`, `invitation` and `reauthenticate` asserts the flash, no link, no confirmation stamp and no invitation choice.
6. **Duplicated customer defaults** — ADDRESSED. `RegisterCustomer::create()` (`RegisterCustomer.php:40`) is the single builder. `CreateNewUser` now validates only and delegates, and the email stays unverified on the form path.
7. **Google name skipped `name_no_links`; width-based limit** — ADDRESSED. Names with links fall back to the part of the email before the `@` (`RegisterCustomer.php:86`, shared `NAME_LINK_PATTERN`), and the limit is `mb_substr` to 120 (`:90`, CJK test).
8. **Invitation choice not bound to the invitation** — ADDRESSED. `GoogleController.php:317-321` writes `invitation.google.{invitationId} = {id, name}` after `forget('invitation.google')`. Task 30 must read `session("invitation.google.$id")`; the controller should carry that into the Task 30 brief.
9. **No `UnlinkGoogleRequest`** — ADDRESSED. `app/Http/Requests/Account/UnlinkGoogleRequest.php` has empty `rules()` and `authorize()` only for a `User`, and `GoogleLinkController::destroy` uses it.

### New Breakage in the Fix Diff

- **Minor — the `link` intent's "keeps the session in use" assertion is vacuous** (`GoogleOAuthTest.php:487-503`).
  - Mutant: switching `:114` from `others($user, $keepSessionId, …)` to `all(…)` *survived*. The `actingAs` session is not yet in the registry when the callback runs, so revoking everything does not touch it.
  - The code is correct. The test does not pin it down.
  - Fix: register the current session first, for example with a prior authenticated request or `RegistryFixtures` for the current id, then assert it is still alive.
- **Minor — on the link path, the user's own remember cookie is invalidated.** Rotating `remember_token` (`LinkGoogleAccount.php:91`) also invalidates the remember cookie of the device in use. 13 §6.3 re-issues the cookie in that case for "sign out others". This is a UX issue only: the current session continues, and once it ends the user signs in again. It could re-issue with `Auth::login($user, true)` when the current request was remembered.
- **Minor — a staff member with 2FA and an unverified email loses the password and all sessions before the 2FA challenge is passed.**
  - The takeover runs in `byEmail` (`GoogleController.php:219`) before `signIn` hands off to the challenge. Scratch result: an owner with confirmed 2FA and `email_verified_at = null` ended with password null, the session dead and `google_id` set, while still a guest at `two-factor.login`.
  - The only reachable case is a staff email change that is not yet verified. The holder of the Google account for that new address can lock out the staff member without the TOTP, though not sign in.
  - Linking itself before 2FA predates this round; the destructive clean-up is new.
  - Suggestion: for staff with `two_factor_confirmed_at`, refuse linking by email, or defer the link and take-over until after the challenge.

The mutant that dropped `$setEmail === null` from `:74` survived, but it is equivalent: a phone-only user has a null email at that point, so the condition is redundant. This is not a finding.

### Out-of-Scope Observations

- Linking by email and replacing `google_id` before the staff 2FA challenge passes is pre-existing round-0 behaviour, permitted by 13 §5.3. It is noted for the final review alongside the third Minor item above.

### Verdict

**Fix round:** All findings addressed, no new Critical/Important breakage. Three new Minor items are open: the vacuous session-kept assertion, the current device's remember cookie being invalidated on link, and the staff-with-2FA clean-up running before the challenge.
