# Task 20 report: shared Inertia props and frontend types

Status: DONE_WITH_CONCERNS. Commit: `ee46e7f feat(http): typed camelCase shared Inertia props` (base d47e75c).

## Implemented
- `HandleInertiaRequests::share`: `app {name, logoUrl, version}`, `auth.user` (AuthUserData, 18 fields), `business` (BusinessPublicData), `features` (Features::all()), `flash {success,error,info,warning}` (session keys of the same names), `i18n {locale, hash}` (hash from `resources/js/lang/generated/manifest.json`, English fallback), `unreadNotifications` (authenticated only), `staffCounters` (`Inertia::optional`, active staff only, cache `staff:counters` 30 s; one grouped query on `orders`), `healthBanners` (authenticated; entries only for users with `settings.manage`; one per present `health:whatsapp|sms|otp` key whose `status` is a `[a-z][a-z0-9_]*` identifier). DB-touching props are closures, so partial reloads compute only what they ask for.
- `AuthUserData::fromUser` builds the 18 fields explicitly (no model serialisation, so no hash/2FA/remember token/google_id/notes can leak). Roles, permissions and abilities are `[]` unless the user is active staff (inactive staff and customers get `[]`, matching Gate::before). Roles, role permissions and direct permissions are eager-loaded (`loadMissing`).
- `BusinessPublicData::fromSettings` (+ nested `BusinessUnitsData`, an extra small file beyond the brief's list so the units shape is generated, not hand-written). `defaultCountryCode = address.country_code ?? 'IN'` (upper-cased). Settings come through the cached `Settings` service (typed groups, never toArray of a whole group).
- `app.logoUrl`: media url of `business.logoMediaId`, cached forever under `business:logo-url:{mediaId}` (the id changes when the logo is replaced, so no invalidation needed; guests stay query-free).
- Frontend: `types/inertia.d.ts` (SharedPageProps + `InertiaConfig.sharedPageProps` augmentation, moved out of `global.d.ts`); `AuthUserData`, `BusinessPublicData`, `BusinessUnitsData` generated into `types/generated.d.ts`; `types/auth.ts` now exports `AuthUser`/`BusinessPublic` aliases (the old starter-kit `User`/`Auth` types are removed). `usePermissions`, `useFormat`, `useBusinessCountry`, `useLengthUnit`, `StatusBadge` lost their local minimal types and `as` casts; starter-kit `UserInfo`, `UserMenuContent`, `NavUser`, `AppHeader`, `AppLogo`, `AuthSplitLayout` follow the new shape (`avatarUrl`, `app.name`, null user guards).
- `lib/i18nBoot.ts`: `shouldReloadForHash(bundled, server, alreadyReloaded)` and `reloadForStaleI18n` (flag `sessionStorage['fs:i18n-reloaded']` in try/catch; cleared when hashes match; never reloads when storage is unusable, to avoid a loop). `app.ts`: `vite:preloadError` reload and the stale-hash check using the bundled manifest.
- Task 19 leftovers: (a) `parseMajorToMinor` maps every `\p{Nd}` digit to ASCII (distance from the start of the Nd stretch mod 10) and strips U+200E/U+200F (plus U+061C, the Arabic letter mark `Intl` emits for negative ar numbers); ar-EG `'١٬٢٣٤٫٥٦'` -> 123456. (b) `AddressFields.update()` always emits `countryCode: country.value` (shown default) then the edited key; still no emit on mount. (c) one-line template comment on the dotted country `name`.

## Tests
- `tests/Feature/Http/SharedPropsTest.php` (31 tests): guest props, feature key order, version, i18n hash and fallback, business keys/units/country, no internal settings for guests, logo url, 18 keys for customer, phone-only/not-onboarded, 2FA/imperial, avatar, admin 24 permissions, owner 5 abilities, production subset, inactive owner -> `[]` x3, customer with stray permission -> `[]`, secrets/other-user data absent from first-load page JSON, partial-reload JSON and full props (password hash, 2FA secret + recovery codes raw and decrypted, remember token, google id, notes, other user's name/email/phone/id, key names), unread count 2 of 3 (+ other user's ignored), staffCounters (partial only, `{2,1}`, cache 30 s with `travel`, null for customer/guest/inactive, no cache entry), health banners (admin/estimator/order/malformed/inactive/customer), flash, sidebar cookie, query counts.
- Query budgets: warm guest = 0 queries; cold guest = only `app_settings`; customer = 2 (avatar media, unread count); owner/admin = 5 (roles, role permissions, direct permissions, media, unread count) with fresh model instances after warm caches; no `orders` query on a normal page load.
- JS: `i18nBoot.test.ts` (8), format tests for Unicode digits/bidi/ar-EG/look-alikes (3 new; the two old "rejects ١٢٣/１２３" cases moved to the new accepting test), AddressFields (3 tests replacing 1).

### TDD evidence
- RED PHP: `vendor/bin/pest tests/Feature/Http/SharedPropsTest.php` -> `Tests: 26 failed, 5 passed` (no `app`/`business`/etc. shared props yet; 5 tests passed because they assert absences).
- RED JS: `yarn vitest run lib/__tests__/i18nBoot.test.ts lib/__tests__/format.test.ts components/inputs/__tests__/AddressFields.test.ts` -> 3 failed files, 4 failed tests (i18nBoot module missing; digit parsing returned null; AddressFields emitted `countryCode: ''`).
- GREEN: `vendor/bin/pest tests/Feature/Http` -> `31 passed (202 assertions)`; same vitest command -> `3 files, 150 passed`.

### Gates
- Gates-PHP: `pint --test` passed; `phpstan analyse` `[OK] No errors`; `pest tests/Unit tests/Feature` -> `1760 passed (6566 assertions)`.
- Gates-JS: `yarn lint` clean; `yarn format:check` clean; `yarn typecheck` clean; `yarn vitest run` -> `45 files, 891 passed`.
- Gates-Gen: `typescript:transform` regenerated `generated.d.ts` (3 new types, committed); `i18n:export` produced no diff.

## Files changed
New: `app/Domain/Identity/Data/AuthUserData.php`, `app/Domain/Settings/Data/BusinessPublicData.php`, `app/Domain/Settings/Data/BusinessUnitsData.php`, `resources/js/types/inertia.d.ts`, `resources/js/lib/i18nBoot.ts`, `resources/js/lib/__tests__/i18nBoot.test.ts`, `tests/Feature/Http/SharedPropsTest.php`.
Modified: `HandleInertiaRequests.php`, `resources/js/app.ts`, `types/{auth,global,generated}`, `lib/format.ts` (+test), `AddressFields.vue` (+test), the composables/components listed above.

## Decisions and concerns
1. `sidebarOpen` is kept as a shared prop (outside the brief's list): `AppShell` still reads it and `sidebar_state` stays unencrypted until Task 21 (Task 16 ruling). Task 21 can drop it with AppShell.
2. Old `name` shared prop removed (replaced by `app.name`); consumers updated.
3. Inactive staff also get `roles: []` (brief only named permissions/abilities); done so `hasRole()` cannot contradict Gate::before. Easy to revert if the controller wants factual roles.
4. Only `AuthUserData`, `BusinessPublicData` (+ `BusinessUnitsData`) are generated; `app`, `features`, `flash`, `i18n`, `staffCounters`, `healthBanners` shapes are hand-written in `inertia.d.ts` (15 §8 says the interface is hand-written; `features` keeps snake_case flag names).
5. `i18n.locale` is `app()->getLocale()` (falls back to `en` when no catalogue exists); no locale-resolution middleware exists yet, so a future one (user locale) automatically feeds it.
6. `staffCounters` and `healthBanners` keys exist for every authenticated user (null / `[]` when not applicable), absent for guests.
7. The `usePermissions`/`useFormat` composables keep `?.`/`?? []` tolerance for pages without props (test mounts); not casts.
8. `vite:preloadError` reloads unconditionally (spec 01 §6 verbatim), no loop guard.
9. The `TestPageProps` helper in `resources/js/test/inertiaPage.ts` stays a loose test-only type.
