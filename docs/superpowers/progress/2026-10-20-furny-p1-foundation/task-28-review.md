# Task 28 review: Google OAuth (0a1900f..654918d)

I read the diff file once, all 2620 lines (non-empty), plus the brief, the report and spec 13 §5.3, §5.4, §5.8, §5.9, §6.2, §6.4, §17 and §20.7, and 14 §3.2 and §3.3. The controller rulings were not re-examined.

### Spec Compliance

- ✅ **Spec compliant.** Every brief bullet has code and a test:
  - redirect/callback/unlink routes: `routes/web.php` hunk;
  - 404 when the feature is off: `GoogleController.php:71,107`;
  - stateful Socialite with the scopes and `prompt`, tested with the real driver;
  - callback steps 1–7, plus `reauthenticate`;
  - the 2FA hand-off: `GoogleController.php:255-260`;
  - invitation prefill: `GoogleController.php:314-315`;
  - unlink with `recent.auth`;
  - `GoogleButton` on Login and Register.
- `config/services.php` is listed as "Modify" in the brief and has no hunk. Its `google` block already exists at the base (`git show 0a1900f:config/services.php` lines 33–38), so nothing is missing.
- Minor deviation: 14 §3.3 names `Account\UnlinkGoogleRequest` for `account.google.unlink`. No such FormRequest exists, and the controller uses a plain `Request` (`GoogleLinkController.php`). It has no rules, so behaviour is the same.
- ⚠️ **Cannot verify from the diff:**
  - Task 30 must read `invitation.google_id`/`invitation.google_name` and set `invitation.id`/`invitation.url`. The keys are defined only here.
  - Vitest and the JS gates were not re-run. The report claims 1179 passed.
  - `tests/Browser` cannot run here, as the report says.

### Strengths

- **Round-trip integrity is tight.**
  - The intent is `pull`ed from the session before anything else (`GoogleController.php:110`), so it is single-use.
  - A query `intent` that differs from the session's is refused (`:176`).
  - A link or reauthenticate callback is bound to the user who started it through `oauth.user`.
  - Socialite stays stateful and its own `state` is `pull`ed (vendor `AbstractProvider::hasInvalidState`), so a code cannot be replayed.
  - The test "rejects a state that does not match … (the real driver)" proves that forged state fails end to end.
- **Login CSRF is not exploitable.**
  - An attacker's callback URL (their code and state) reaching a victim's browser fails twice: the victim's session has no `oauth.intent` (`:116`), and Socialite's state does not match.
  - Forcing a victim through `redirect?intent=login|link` only reaches Google's `select_account` chooser, where the victim picks their own account.
  - Linking the attacker's Google to the victim needs the attacker's code with the victim's state, which the attacker cannot get. `link` also requires the email to match.
- **`email_verified` is checked strictly and once, before every branch** (`:144`, `=== true` at `:192`). The check covers login, link, invitation and reauthenticate. A string `"true"` and an absent claim are refused (tested).
- **Session handling is right.**
  - Customers get the remember cookie and staff never do (`:262`).
  - Staff with 2FA are never logged in. The session is regenerated, then `login.id`/`login.remember=false` are set (`:255-260`).
  - The full Fortify challenge is exercised with a recovery code, and `auth.method=google` is asserted after the challenge.
  - `auth.login_at` is an int and `auth.method` is set (tested).
- **Reauthenticate** demands an exact `google_id` match, including a null `google_id` (`:288`). It writes `time()` as an int (`:293`), and the result passes `recent.auth` (tested end to end through the unlink route).
- **Error log is safe.** `Log::warning` (`:132`) logs only the exception class and message. Socialite sends the client secret in the token request *body* and the access token in a header, so Guzzle exception messages carry neither.
- **Tests are strong.** There are 95 tests with real DB, Redis and Fortify. Run here: `vendor/bin/pest tests/Feature/Auth/GoogleOAuthTest.php`: 95 passed (431 assertions). The output was clean, with no warnings or deprecations.

### Mutation check

I ran this in a scratch copy, outside the worktree, with the vendor packages symlinked and pest copied. The copy has been deleted, and `git status` in the worktree is clean. There were 30 mutants.

- **Killed (24):**
  - loose `email_verified`;
  - the starter check on link/reauthenticate;
  - the query-intent check;
  - the trashed check and the inactive check;
  - the pending-invitation block and the revoked filter;
  - the staff remember cookie;
  - the 2FA bypass, and no regenerate on the 2FA path;
  - reauthenticate accepting any Google id;
  - reauthenticate writing a Carbon stamp instead of an int;
  - the invitation email check and the invitation expiry check;
  - the redirect's invitation guard;
  - the callback feature flag;
  - `get` instead of `pull` for the intent (replay);
  - an empty email;
  - the same-site check on `invitation.url`;
  - the link email mismatch;
  - the link audit;
  - the unlink check on a verified phone and the unlink last-method rule.
- **Survived, equivalent or unreachable (5):**
  - `Login => true` for the starter check is unreachable, because a login intent is only stored for guests.
  - Dropping `$session->regenerate()` after `Auth::login` is equivalent, because `SessionGuard::login` already migrates the session.
  - Dropping the `google_in_use` pre-check or the phone-only `email_unavailable` pre-check is caught by the unique index, which `LinkGoogleAccount.php:83-86` maps to the same error.
  - `abort_if($user === null)` in reauthenticate is unreachable.
- **Survived, real test gaps (2):** M28 (the pending method accepted on a remember-cookie login) and M30 (the `email_verified` check limited to intent login). See the Minor findings below.

### Issues

#### Critical (Must Fix)

None.

#### Important (Should Fix)

1. **Account pre-hijacking through linking by email to an unverified, password-bearing account.** This is spec-mandated (13 §5.3 step 4, `email_verified_at ??= now()`) and needs a controller or spec ruling.
   - **Code:** `GoogleController.php:199-218` and `LinkGoogleAccount.php:60-75`.
   - **Scenario:**
     1. An attacker registers `victim@example.com` with their own password and never verifies it.
     2. The victim later presses "Continue with Google".
     3. The account is found by email and linked. The email is marked verified and the victim is signed in to the attacker's account.
     4. The attacker's password still works. Their sessions and remember token are left alone.
   - **Proof:** a scratch Pest test, now deleted, signed in by password as the attacker after the victim's Google sign-in.
   - **Impact:** everything the victim enters (addresses, phone, orders, designs) is readable by the attacker. This is the classic "pre-hijack" class.
   - **Fix (recommended):**
     - When the matched user's `email_verified_at` was null, clear `password`, rotate `remember_token` and destroy the user's other sessions (`SessionRegistry`) before linking, so Google now proves who owns the account. Audit this too.
     - Or refuse with a message and ask the user to sign in and verify first.
     - The same applies to staff matched by email. The spec says "customer or staff", and a staff account found by email is linked automatically.

#### Minor (Nice to Have)

2. **An email match silently replaces a different, existing `google_id`, and the audit cannot show it** (`LinkGoogleAccount.php:63,77-81`).
   - This is literally what 13 §5.3 step 4 says (`set google_id = $gid`). I confirmed it in scratch: `attacker-google` was replaced by `victim-google`.
   - The audit `auth.google_linked` has empty properties, so a replacement looks the same as a first link, and the previously linked Google account is evicted without a trace.
   - Suggestion: add `replaced: true` to the audit when the old value was non-null. §17 allows ids, and the Google subject is an id. Or ask the controller whether to refuse when the existing link is different.
3. **The unlink last-method rule counts a password without an email** (`UnlinkGoogleAccount.php:23`).
   - 13 §5.8 defines the methods as "password + email, verified phone, or `google_id`". The reachable path is that `UpdateUserProfileInformation::canSignInWithoutEmail` allows clearing the email when there is a phone and a `google_id`. Unlink then passes because `hasPassword()` is true.
   - I verified this in scratch: the end state is `email=null`, a password present, an unverified phone and no Google link. Only phone OTP login, if enabled, gets that user back in.
   - Fix: `($user->hasPassword() && $user->email !== null)`.
4. **`auth.pending_method` is not bound to a user** (`GoogleController.php:253`, `RecordSuccessfulLogin.php:50`).
   - Only the password path clears it (`AuthenticateUser`). A staff member's Google sign-in can stop at the 2FA challenge, leaving `google` in the session. Fortify registration in the same session (and later Task 30's invitation accept) is then recorded as `method: google`.
   - The impact is limited to the audit and `auth.method`.
   - Fix: store `['method' => 'google', 'user' => id]` and accept it only when `$event->user` matches. Also add a test that a remember-cookie login ignores a pending method (mutant M28 survived).
5. **Test gap: `email_verified: false` is tested only for intent `login`** (`GoogleOAuthTest.php:250`). The guard is shared and correct today, but mutant M30 survived. That mutant made the check apply only to `login`, which let unverified addresses through `link`, `invitation` and `reauthenticate`. Add a dataset over the other three intents.
6. **The customer-defaults block is duplicated.** `RegisterCustomer.php:43-53` repeats `CreateNewUser.php:52-63` (timezone, unit system, length unit, locale, type, terms). OTP `fromPhone` will make a third copy. Have `CreateNewUser` build the user through a shared `RegisterCustomer` helper.
7. **The Google name gets weaker handling than the form** (`RegisterCustomer.php:40`).
   - It skips the `name_no_links` rule (`CreateNewUser.php:39`), so a Google display name can carry a URL into a customer name.
   - `Str::limit` counts display width (`mb_strwidth`), so a CJK name is cut at 60 characters, not 120.
   - Use `mb_substr`, and strip or reject names with links (falling back to the part of the email before the `@`).
8. **`invitation.google_id`/`invitation.google_name` are not tied to `invitation.id`** (`GoogleController.php:314-315`). If another invitation is opened in the same browser before accepting, Task 30 could apply the first Google id to the second invitation. Store them together, for example `invitation.google => {invitation_id, id, name}`, or have Task 30 check the id.
9. **Process: there was no RED run.** The report admits the code was written before the tests. The implementer's mutation checks and the 24 killed mutants above largely make up for it.

### Assessment

**Task quality:** Needs fixes

**Reasoning:** The OAuth state, intent binding, 2FA hand-off, remember policy and reauthenticate are well built and well tested, with no Critical issues. The pre-hijack path (Important 1) is a real takeover-class weakness; the spec wording permits it and it needs a ruling and a small fix. The Minor items are cheap and should be done before Task 30 builds on the invitation keys.
