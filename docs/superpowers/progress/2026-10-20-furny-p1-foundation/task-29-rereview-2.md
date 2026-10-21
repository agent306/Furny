# Task 29 re-review 2 (fix round 2, f5756bd..4953785)

Scope:
- the open items of `task-29-rereview-1.md`;
- the controller's ruling (Google `intent=link` needs `recent.auth` whenever the user has any credential, checked at the redirect and at the callback);
- the accepted dialog fix.

The fix diff (634 lines) was read in one pass. Probes, mutants and the dialog Vitest ran in a scratch copy at 4953785, against real Postgres and Redis. The copy has been deleted, and `git status` in the worktree is clean.

### Finding Verdicts

- **Critical: recent-authentication bypass through Google `intent=link` (probe E).** ADDRESSED.
  - Code:
    - `GoogleController.php:93` throws `RecentAuthenticationRequired` at the redirect, before anything is stored in the session.
    - `GoogleController.php:139` refuses at the callback, after the round-trip check and before Socialite is asked.
    - Both use `RecentAuthentication::missingFor` (`RecentAuthentication.php:+31-34`), which `Account/PhoneController` now shares.
  - Probes, all on an aged session (3 hours) unless noted:
    - **E (phone-only user, no email).** The redirect goes to `/auth/reauthenticate`. A forced callback with a primed `oauth.intent=link` goes to `/dashboard` and links nothing: `google_id` and email stay null. A Google reauthenticate callback with the thief's account stamps nothing.
    - **E2 (link started while recent, callback 11 minutes later).** Refused; nothing is linked, and `oauth.intent` is consumed.
    - **E3 (replaying the callback after a legitimate link, session aged).** Both replays (with and without `?intent=link`) fail the state check (`/login`), and the linked id is unchanged.
    - **E4 (reauthenticate round trip finished with `?intent=link` in the query).** `isCurrentRoundTrip` refuses it (`GoogleController.php:192`); no link, no stamp.
    - **E5 (Google-only user, swapping in another Google account).** The redirect goes to `auth.reauthenticate`, the forced callback is refused, and the original `google_id` is kept.
  - Mutants: removing the redirect check fails 2 Google tests; removing the callback check fails 2.
- **Minor: the dialog took a recent-authentication redirect for a success.** ADDRESSED as accepted.
  - Code: `PhoneVerifyDialog.vue:53, 112, 142` compare `visited.component` with the component the visit started on.
  - On a send that left the page, the dialog stays on the phone step. On a verify that left the page, it closes without `verified`.
  - The server side is pinned: an Inertia request goes to `password.confirm` with `url.intended` set to the page it came from (`AccountPhoneTest.php:+239-246`).
  - Dialog Vitest: 17 passed.
  - False-positive check:
    - A legitimate success answers `back()`, which follows the Referer. `Referrer-Policy: strict-origin-when-cross-origin` (`SecurityHeaders.php:47`) keeps the full same-origin URL, so the visit returns to the same page and component.
    - Only a host page whose own GET redirects elsewhere after the change could differ. None of the named hosts (the banner on customer pages, onboarding, order submit, staff account pages) does that today.
    - Even then the result is safe: the number is verified and the server's success toast shows; only `verified` is not emitted.
    - A recent-auth redirect cannot land on the same component unless the dialog sits on `Auth/ConfirmPassword` or `Auth/Reauthenticate`, which it does not.
- **Minor (by ruling): a user with no credential can add a phone and re-authenticate with it (probe F).** Accepted by ruling 2. No change expected.

### New Breakage in the Fix Diff

None.
- The fixtures of the existing link tests now carry a fresh sign-in stamp (`GoogleOAuthTest.php:+108`), so they still exercise the link path rather than the new refusal.
- The new translation key `auth.errors.recent_auth_required` is present (`auth.php:+46`).

### Out-of-Scope Observations

None. A focused check found that adding an email to a phone-only user also goes through `recent.auth` (`FortifyRouteGuards`; pinned in `ReauthenticateTest`), so it is not a further way around.

### Verdict

**Fix round:** All findings addressed, no new Critical/Important breakage.
