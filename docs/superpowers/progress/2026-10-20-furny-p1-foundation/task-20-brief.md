### Task 20: Shared Inertia props and frontend types

**Files:**
- Create: `app/Domain/Identity/Data/AuthUserData.php`, `app/Domain/Settings/Data/BusinessPublicData.php`, `resources/js/types/inertia.d.ts`, `resources/js/lib/i18nBoot.ts`
- Modify: `app/Http/Middleware/HandleInertiaRequests.php`, `resources/js/app.ts` (`vite:preloadError` reload; stale i18n hash → reload once)
- Test: `tests/Feature/Http/SharedPropsTest.php`, `resources/js/lib/__tests__/i18nBoot.test.ts`

**Spec refs:** `01 §6`; `15 §8`, `§15.3`; `13 §7.4`; `11 §4` (staffCounters, healthBanners); `12 §8.4` (unreadNotifications); `17 §5.11` items 9, 11; P1-D12

**Interfaces:**
- Consumes: Tasks 2, 3, 6, 13.
- Produces: shared props exactly `app {name, logoUrl, version}`, `auth.user` (`AuthUserData` = the 18 fields of `15 §8`), `business` (`BusinessPublicData` with `defaultCountryCode = business.address.country_code ?? 'IN'`), `features` (`Features::all()`), `flash {success, error, info, warning}`, `unreadNotifications` (authenticated only), `i18n {locale, hash}` (hash from `resources/js/lang/generated/manifest.json`), `staffCounters` (`Inertia::optional`, staff only, cache key `staff:counters` 30 s: `submitted` = orders in state `submitted`, `toCall` = orders in state `accepted`), `healthBanners` (users with `settings.manage`: one entry per present cache key `health:whatsapp|sms|otp` → `{key, messageKey: 'admin.health.{key}.{status}'}`); `resources/js/types/inertia.d.ts` augmenting `@inertiajs/core` `PageProps` with `SharedPageProps`; `shouldReloadForHash(bundled: string, server: string, alreadyReloaded: boolean): boolean`.

- [ ] **Step 1: Write the failing tests**
  - `SharedPropsTest` (renders a test route registered in the test, `Route::middleware('web')->get('/_props', fn () => Inertia::render('Welcome'))`; partial reloads via `X-Inertia-Partial-Data`): guest → `auth.user` null, no `unreadNotifications`, `features` keys `['payments','whatsapp','sms','web_push','google_login','dxf_import','walkthrough_camera','captcha']`, `app.version === config('app.version')`, `i18n.hash` = manifest `en`; customer → `auth.user` keys exactly `id,type,name,email,emailVerified,phoneE164,phoneVerified,avatarUrl,roles,permissions,abilities,unitSystem,lengthUnit,timezone,locale,onboarded,hasPassword,twoFactorEnabled`, `roles/permissions/abilities = []`; admin → 24 permissions, `abilities []`; owner → 5 abilities; `business` keys exactly `name,currency,locale,timezone,phoneE164,email,workingHours,units,defaultCountryCode` and `units = {defaultSystem:'metric', defaultLengthUnit:'mm'}`; `unreadNotifications` counts 2 unread of 3 inserted database notifications; `staffCounters` on partial reload = `{submitted: 2, toCall: 1}` for staff with 2 submitted + 1 accepted orders and `null` for a customer; `healthBanners` for an admin with `Cache::put('health:otp', ['status' => 'low_conversion'])` = `[{key:'otp', messageKey:'admin.health.otp.low_conversion'}]` and `[]` for an estimator; session flash `success` appears in `flash.success`.
  - `i18nBoot.test.ts`: `shouldReloadForHash('a','b',false) === true`, `('a','a',false) === false`, `('a','b',true) === false`.
- [ ] **Step 2: Run, expect FAIL** — `vendor/bin/pest tests/Feature/Http/SharedPropsTest.php && yarn vitest run resources/js/lib/__tests__/i18nBoot.test.ts`
- [ ] **Step 3: Implement** — props built without DB access for guests except settings (cached); `app.ts` stores the reload flag in `sessionStorage['fs:i18n-reloaded']` (try/catch).
- [ ] **Step 4: Run tests, expect PASS** — same as Step 2.
- [ ] **Step 5: Quality gates** — Gates-PHP, Gates-JS, Gates-Gen.
- [ ] **Step 6: Commit** — `git add app/Domain/Identity/Data app/Domain/Settings/Data app/Http/Middleware/HandleInertiaRequests.php resources/js tests/Feature/Http` → `feat(http): typed camelCase shared Inertia props` + trailer.

