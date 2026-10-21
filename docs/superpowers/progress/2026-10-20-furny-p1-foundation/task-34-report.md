# Task 34 report: account pages (customer and staff)

Status: DONE_WITH_CONCERNS (concerns at the end). Commits on `build/p1-foundation`:

1. `49ab1d6` test(ui): unmount app shells after each test so the route announcer timer cannot outlive the file (carry 7, its own commit)
2. `1f0ffd3` feat(account): customer and staff profile, security and preference pages
3. `2090ca4` fix(account): Google link lands on the account security page, and the phone sticky bar clears the tab bar
4. this report (docs commit)

## What was implemented

Backend
- Routes: `customer.account.{profile,security,preferences,preferences.update,avatar.update}` (routes/customer.php, URLs `/account/...`, exempt from `onboarded` through the existing `customer.account.*` pattern) and `admin.account.{profile,security,preferences,preferences.update,avatar.update}` (routes/admin.php, `/admin/account/...`). Entries added to `tests/Feature/Security/route-access.php` (the brief says `route-access.php`; that is its real path).
- Controllers `Customer\Account\{Profile,Security,Preferences,Avatar}Controller` and the `Admin\Account\` four. They are thin; props are built by Data classes.
- Data (all `#[TypeScript]`): `AccountProfileProps {user, marketingOptIn, otpChannels}`, `AccountSecurityProps {hasPassword, googleLinked, googleEnabled, sessions}`, `AccountPreferencesProps {unitSystem, lengthUnit, timezone, timezones}`, `SessionData {id, uaSummary, ipMasked, lastActiveAt, isCurrent, method}` (id is the `SessionKey`; no session id reaches the page, tested).
- Actions: `UpdateDisplayPreferences` (C10 name; the plan's `UpdatePreferences` collides with P8) and `UpdateAvatar` (`ConsumeUploadIntent` purpose `avatar`, `null` clears the collection, in one transaction).
- FormRequests `Account\UpdateDisplayPreferencesRequest` (camelCase keys, enum shapes) and `Account\UpdateAvatarRequest` (`uploadId` present|nullable|ulid).
- Lang: `account.php` (nav, profile, security, preferences, errors, three new toasts), `common.nav.account|my_account`, `auth_ui.register.terms`.

Frontend
- `components/account/`: `AccountNav` (vertical 220 px from 1024 px, scrolling pills below; `aria-current="page"`), `AccountPage` (heading + nav + sections frame, shared by the six pages), `ProfileForm` (photo with `ImageUploader`, details via Fortify `user-profile-information.update` with `StickyActionBar`, email verification resend, phone section with `PhoneVerifyDialog`), `PasswordForm` (Fortify `user-password.update`, "Set a password" without a current field for passwordless users), `GoogleLinkCard` (`GoogleButton intent="link"`, disconnect), `SessionsList` (sign out one or all others, confirm), `PreferencesForm` (system radio cards, length unit select that resets on system change, searchable time zone via Popover+Command, device-level appearance).
- `lib/account.ts` (audience-specific nav items and URLs), type aliases in `types/domain.ts`.
- Pages `Customer/Account/{Profile,Security,Preferences}.vue` and `Admin/Account/{Profile,Security,Preferences}.vue` (layouts come from `resolveLayout`).
- `UserMenu`: Account (customer) / My account (staff) link. `customerNav`: Account tab (tab only: new `NavItem.headerHidden` and `match`).

## Files changed (material)
app/Domain/Identity/{Actions/UpdateDisplayPreferences,Actions/UpdateAvatar,Data/AccountProfileProps,Data/AccountSecurityProps,Data/AccountPreferencesProps,Data/SessionData}.php; app/Http/Controllers/{Customer,Admin}/Account/*.php (8); app/Http/Requests/Account/{UpdateDisplayPreferencesRequest,UpdateAvatarRequest}.php; routes/{customer,admin}.php; resources/lang/en/{account,common,auth_ui}.php; resources/js/{components/account/*, pages/{Customer,Admin}/Account/*, lib/account.ts, lib/customerNav.ts, types/{domain,navigation}.ts, components/app/{UserMenu,AppHeader,MobileTabBar}.vue, components/auth/TermsCheckbox.vue}; generated: resources/js/types/generated.d.ts, resources/js/lang/generated/*. Tests: tests/Feature/Account/{ProfilePageTest,SecurityPageTest,PreferencesTest,AvatarTest}.php, tests/Browser/AccountPagesTest.php, resources/js/components/account/__tests__/{AccountNav,PreferencesForm}.test.ts, plus updates to UserMenu, CustomerLayout, nav and AppShell vitest files.

## TDD evidence

RED (PHP, before any implementation): `vendor/bin/pest tests/Feature/Account` -> `Tests: 42 failed (0 assertions)`, every one `Route [customer.account.security] not defined` (or the admin/profile/preferences/avatar name). After routes, controllers and lang the run was 34 passed, 8 failed, all `Inertia page component file [Customer/Account/Profile] does not exist` (the page files did not exist yet).

GREEN (PHP): `vendor/bin/pest tests/Feature/Account` -> 4 files, all passing (see gate counts below). One test of mine was wrong, not the code: an empty time zone is `required`, not "invalid"; moved to the missing-fields test.

RED (carry 7): mutation check of the composable test: with the `clearTimeout` removed from `onScopeDispose`, `useRouteFocus.test.ts > cancels the pending announcement when its scope is disposed` failed with `expected 1 to be +0` (1 test failed, 1 passed); restored, 2 passed.

Vitest GREEN for the two required files: `AccountNav.test.ts` (5 tests: customer and staff items, two-factor link `/admin/account/two-factor`, `aria-current="page"` on exactly one item, query string ignored, none elsewhere) and `PreferencesForm.test.ts` (7 tests: switching to imperial gives `ftin`, to metric gives `mm`, same system keeps the unit, discard, PUT url and camelCase body for each audience, appearance sends nothing). While writing the form test I found that a native `<select>` whose options are swapped keeps a stale value in the DOM; the select is now keyed by the system (a real fix, not only a test fix).

## Gate results
- Gates-PHP: pint pass; phpstan level 8 no errors; full `vendor/bin/pest tests/Unit tests/Feature`: 3923 passed, 0 failed (17143 assertions; 3872 at the start, +51). A first full run found 13 failures in GoogleOAuthTest:  fell back to the dashboard until the security page existed, and 12 tests (13 assertions) expected that fallback. Now the page exists, the fallback is removed and the tests name the security pages (commit 2090ca4). The second full run is the one reported.
- Gates-Gen: `typescript:transform && i18n:export && git diff --exit-code` clean after the feature commit (GEN-OK).
- Gates-JS: `yarn lint` clean, `yarn format:check` clean, `yarn typecheck` clean, `yarn vitest run` 203 files, 5062 tests, 0 failures (5045 at the start).
- Browser (run before the last fix commit, which touches no browser-covered behaviour beyond a phone-only class; UserMenu, tab bar and AppShell behaviour changed): `yarn vite build && vendor/bin/pest tests/Browser` -> 109 passed (270 assertions), including the new `AccountPagesTest` (customer pages at 375/820/1280 px without horizontal scroll or script errors, staff pages with the Two-factor nav item, the Account tab, the time zone list).

## Carries
1. Staff AccountNav has Two-factor linking to `admin.security.two-factor` (the Task 31 route, imported from Wayfinder, none created). The two-factor page itself does not render the nav (see concerns).
2. TermsCheckbox: its caption strings were already in `auth_ui.php` (`terms_before`, `terms_and`) but as sentence fragments, the pattern Task 30's review rejected. Converted to one ICU message with tags, `auth_ui.register.terms`, rendered with `RichText` like `staff.accept.terms`; the two fragment keys are gone; the existing test (same visible text) still passes; `i18n:export` regenerated.
3. Phone visibility of `UserMenu` (15 §7 draws no account control on phones): decision, keep it visible at every width. The customer tab bar now has the Account tab, but nothing on a phone offers log out or the theme except the menu, and Task 21 only said to hide it "when Task 34 adds the Account tab". Staff on phones have no tab bar, so the menu is also their only account link. Comment in `AppHeader` records it.
4. Customer "Delete account": left out; Task 35 adds the item (and its route) to `accountNavItems` in `lib/account.ts`. Likewise Notifications and AI credits.
5. Uploads: avatar uses `ImageUploader` (purpose `avatar`, 5 MB, one file), which uploads through `uploadWithIntent`; a ready upload is sent at once to `*.account.avatar.update`; `ConsumeUploadIntent` refusals show as `_error`. The shared prop `auth.user.avatarUrl` reads the `thumb` conversion (tested).
6. Not done (as stated, final review): the coded `last_login_method` helper. `GoogleLinkCard` shows the `google` field error the unlink action raises today.
7. Own commit `49ab1d6`: see Deviations (the code part of the carry was already in the tree).

## Deviations / decisions
- Action named `UpdateDisplayPreferences` (C10 ruling in preflight), not the brief's `UpdatePreferences`. The length-unit and time zone checks live in the action only (one owner), the request checks shapes; messages `account.errors.length_unit` and `account.errors.timezone` on `lengthUnit` and `timezone`.
- Avatar removal flashes `account.toasts.avatar_removed` ("Photo removed."), update flashes `avatar_updated` (spec lists only the latter).
- Carry 7: `useRouteFocus` already cleared its timer on scope dispose and `AppShell.test.ts` already had a test for it. The flake came from shells a test left mounted (the 50 ms timer outlives the file and reads `document` after teardown). The fix is `enableAutoUnmount(afterEach)` in `AppShell.test.ts` (registered after the body-clearing hook, so it runs first) plus a composable-level test; no production code change.
- Time zone control is Popover + Command (the shadcn combobox pattern) rather than reka `Combobox`; the vendored `Command` renders items only inside a `CommandGroup`, so the list uses one. Length unit is a native select (`NativeSelect`), not the reka `Select`.
- The Connect button is `GoogleButton intent="link"` whose label is the shared "Continue with Google".
- The Help link of UserMenu (15 §9.31) is not added: `customer.help` does not exist yet.
- `AccountProfileProps.otpChannels` is `OtpChannelResolver::available('')`: the number is not known before the dialog.
- New `NavItem.headerHidden` and `match` (Account tab only on phones, active on all three account pages).

## Concerns
- `Admin/Account/TwoFactor.vue` does not show `AccountNav` (it keeps its own layout; wrapping it in `AccountPage` would add dividers between its cards). The nav reaches it, but there is no nav back from it except the menu. Worth a small follow-up.
- The browser runner (pest-plugin-browser) never returns the response to a non-GET Inertia visit: the existing logout button hangs the same way (`inertia:start` fires, nothing finishes). So no browser test saves a form; saves are covered by Feature tests and the form logic by vitest. Not caused by this task.
- Unverified in a real browser: uploading a photo end to end, the Google connect round trip, `PhoneVerifyDialog` from the profile page (components built earlier, only mounted here), sign out of a device.
- The sticky action bar of the forms sits in the page flow (`sticky bottom-0`); on phones the tab bar is fixed below it, so the bar can sit under the tab bar while scrolled. Not checked on a phone.
