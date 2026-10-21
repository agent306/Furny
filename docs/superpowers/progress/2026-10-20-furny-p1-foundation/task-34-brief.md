### Task 34: Account pages (customer and staff)

**Files:**
- Create: `app/Http/Controllers/Customer/Account/{ProfileController,SecurityController,PreferencesController,AvatarController}.php`; `app/Http/Controllers/Admin/Account/{ProfileController,SecurityController,PreferencesController,AvatarController}.php`; `app/Domain/Identity/Actions/{UpdatePreferences,UpdateAvatar}.php`; `resources/js/pages/Customer/Account/{Profile,Security,Preferences}.vue`; `resources/js/pages/Admin/Account/{Profile,Security,Preferences}.vue`; `resources/js/components/account/{AccountNav,ProfileForm,PasswordForm,GoogleLinkCard,SessionsList,PreferencesForm}.vue`
- Modify: `routes/customer.php` (`customer.account.profile|security|preferences|preferences.update|avatar.update`), `routes/admin.php` (`admin.account.profile|security|preferences|preferences.update|avatar.update`), `resources/js/components/app/UserMenu.vue` (account links), `resources/lang/en/account.php`, `route-access.php`
- Test: `tests/Feature/Account/{ProfilePageTest,SecurityPageTest,PreferencesTest,AvatarTest}.php`, `resources/js/components/account/__tests__/{PreferencesForm,AccountNav}.test.ts`

**Spec refs:** `10 §13.1–§13.4`; `11 §18`; `13 §5.3` (link/unlink), `§5.7`, `§5.8`, `§6.3`; `15 §9.31` (FormSection, StickyActionBar); P1-D10

**Interfaces:**
- Consumes: Tasks 24, 26, 28, 29, 31, 32–33.
- Produces: customer pages with props of `10 §13.2–§13.4` (`Profile`: `{user, marketingOptIn, otpChannels}`; `Security`: `{hasPassword, googleLinked, googleEnabled, sessions}`; `Preferences`: `{unitSystem, lengthUnit, timezone, timezones}`) and the staff equivalents (`11 §18`; email required for staff); `UpdatePreferences::handle(User, UnitSystem, LengthUnit, string $timezone)` (422 `account.errors.length_unit` when the unit does not match the system; timezone must be in `DateTimeZone::listIdentifiers()`); `UpdateAvatar::handle(User, ?string $uploadId)` (`ConsumeUploadIntent` purpose `avatar`; `null` clears the collection); `AccountNav` items: customer Profile · Security · Preferences · Delete account (Task 35 route), staff Profile · Security · Two-factor · Preferences (P6/P8 append Notifications and AI credits).

- [ ] **Step 1: Write the failing tests**
  - `ProfilePageTest`: customer page component `Customer/Account/Profile` with `otpChannels ['sms']` when only SMS is available; staff page `Admin/Account/Profile`; a customer requesting `admin.account.profile` → 403; staff requesting `customer.account.profile` → redirect `admin.dashboard`.
  - `SecurityPageTest`: `sessions` lists the registry entries with `isCurrent` on the current one; `googleEnabled` mirrors `features.google_login`; `hasPassword false` for phone-only users.
  - `PreferencesTest`: `{unitSystem: 'imperial', lengthUnit: 'ftin', timezone: 'Europe/London'}` saves; `{metric, ftin}` → `account.errors.length_unit`; `timezone 'Mars/Base'` → error; camelCase request keys.
  - `AvatarTest`: ready avatar intent → `avatarUrl` in shared props becomes the public media URL (thumb conversion); `uploadId: null` removes it; another user's intent → 422 `upload_invalid`.
  - Vitest: `PreferencesForm` resets `lengthUnit` to `mm` when switching to metric and to `ftin` when switching to imperial; `AccountNav` marks the active item with `aria-current="page"`.
- [ ] **Step 2: Run, expect FAIL** — `vendor/bin/pest tests/Feature/Account && yarn vitest run resources/js/components/account`
- [ ] **Step 3: Implement** — pages per `10 §13` / `11 §18`, using `FormSection`, `StickyActionBar`, `ImageUploader`, `PhoneVerifyDialog`, `GoogleButton`.
- [ ] **Step 4: Run tests, expect PASS** — same as Step 2.
- [ ] **Step 5: Quality gates** — Gates-PHP, Gates-JS, Gates-Gen.
- [ ] **Step 6: Commit** — `git add app routes resources tests` → `feat(account): customer and staff profile, security and preference pages` + trailer.

