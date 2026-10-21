# P1 Foundation — pre-flight conflict scan

Plan: `docs/superpowers/plans/2026-10-20-furny-p1-foundation.md` (40 tasks). Spec authority: master + `01`, `02`, `13`, `15`, `17`, `19` and — **now written, therefore normative** — `14-routes-and-api.md` and `16-testing-quality.md` (the plan header still says "14 not written / 16 replaced by 17 §10.2 + 13 §20"). Environment: roadmap "Local environment notes". Cross-plan: P2 Task 1 (and the P2 tasks that touch P1 Task 1 outputs: 48, 50, 51).

Evidence gathered beyond the docs: `laravel/vue-starter-kit` main cloned to the scratchpad (HEAD `d282e81`, 2026-09-21); npm/Packagist metadata queried; local toolchain inspected (`/usr/local/bin/php` 8.4.26, Node 22.22, corepack 0.34, Postgres 16.15, Redis 7.0.15, `/opt/pw-browsers/chromium-1194`, `composer-seed-dist` present, global Composer `preferred-install=source`, `use-github-api=false`); git state of the worktree (`build/p1-foundation` checked out, no local `develop`/`main`; `.superpowers/` is excluded via `.git/info/exclude`).

**Result: 16 conflicts (C1–C16) needing a ruling, plus 14 minor internal issues (I1–I14) that a reviewer would flag but that do not need an owner decision.** Rulings follow "spec binding": where the plan and the spec disagree, the spec wins; where two spec files disagree, the owning section (per 14's precedence note and 19) wins.

---

## 0. Conflict register and proposed rulings

| # | Conflict | Tasks | Proposed ruling (spec binding) |
|---|---|---|---|
| C1 | **Starter-kit drift.** Kit main no longer ships `eslint.config.js` or `.prettierrc` (Task 1 says "copied from the kit clone"). It uses `vite-plus` (`vp build/dev/check`, `defineConfig/lazyPlugins` from `vite-plus`, lint/fmt config inside `vite.config.ts`), pnpm (`pnpm-workspace.yaml`, `.npmrc`; there is **no** `package-lock.json`), `laravel/chisel` with a `post-update-cmd` `php artisan install:features` hook (it rewrites the kit when Composer runs), Fortify **passkeys** (config, `2024_01_01_000000_create_passkeys_table.php`, `@laravel/passkeys`, `Passkey*`/`ManagePasskeys` components), `.github/workflows/tests.yml` (PHP 8.3, `composer setup` with npm; fails on every PR), `.github/dependabot.yml`, `config/inertia.php` with `ssr.enabled => true`, PHPUnit tests, phpstan level 7 + carbon include, bunny fonts via `laravel-vite-plugin/fonts` **and** the `@fonts` Blade directive. | 1, 4, 5, 12, 16, 22, 40 | Task 1 runs these steps in this order. (1) Before any `composer require`/`update`, remove chisel: drop `laravel/chisel`, `chisel.php`, `chisel-paths.php`, `app/Console/Commands/InstallFeaturesCommand.php` and the `install:features` script hooks. (2) Delete `pnpm-workspace.yaml`, `.npmrc` and `.github/workflows/tests.yml`. (3) Replace `vite-plus` with plain `vite`: import `defineConfig` from `vite`, drop `lazyPlugins`, and use `vite`/`vite build` scripts. (4) **Author** a flat `eslint.config.js` (eslint-plugin-vue + @vue/eslint-config-typescript) and `.prettierrc`, carrying over the kit's fmt options and the Tailwind class-sorting plugin (master §6.6 and 16 §14 mandate ESLint + Prettier). (5) Remove passkeys everywhere: Fortify feature/config, migration, npm package and components. 13 §2's feature list has no passkeys, and leaving them breaks Task 12's `MigrationOrderTest` and the route registry. (6) Set `inertia.ssr.enabled = false`; SSR is not used in v1 (`01 §3`), and the SSR gateway must never reach `Http::preventStrayRequests()`. (7) Remove `@fonts` from `app.blade.php`. Task 40 **modifies** the existing `dependabot.yml` instead of creating it, and Task 22 **modifies** `config/inertia.php`. |
| C2 | **Test harness contradicts 16 §2–§4.** Plan: Pest `RefreshDatabase` for Feature+Browser, Unit **without** `TestCase`, `beforeEach(Http::preventStrayRequests())` in Pest.php, `BROADCAST_CONNECTION=null`, no TURNSTILE/FEATURE/REDIS-DB/VISION/GOTENBERG/HEALTH/VAPID/UPLOADS env in `phpunit.xml`, Vitest projects `engine` + `ui` on **jsdom**. Spec: `uses(TestCase, LazilyRefreshDatabase)->in('Feature')`, `uses(TestCase, RefreshDatabase)->in('Browser')`, `uses(TestCase)->in('Unit')`, and `TestCase::setUp` asserts pgsql, fakes `s3`/`s3-public`, prevents stray requests and resets the settings cache. The full `phpunit.xml` env block (`BROADCAST_CONNECTION=log`, `TURNSTILE_*` empty, `FEATURE_*=true`, `REDIS_DB=14`/`15`/`13`, `FILESYSTEM_DISK=s3`, …). Vitest projects `engine` (node) + `app` (**happy-dom**, setup `resources/js/test/setup.ts`). Baseline seeding with `TestBaselineSeeder`. Concrete breakages: the Unit tests that need the app fail (Tasks 2 `FeaturesTest`, 3 `TransIcuTest`, 6 `EncryptedStringCastTest`, 22 `MaskTest`/`RedactPiiProcessorTest`, 25 `TurnstileTokenTest`). Without blank `TURNSTILE_*`, the Cloudflare test keys from `.env` (= `.env.example`, 17 §6.1) turn `features.captcha` on in every auth test. | 1, 2, 3, 6, 8, 13, 22, 24, 25 + every later test | Task 1 implements 16 §2–§4 verbatim: Pest.php, `TestCase`, the `phpunit.xml` env (keeping `DB_HOST`/`USERNAME`/`PASSWORD` non-forced) and Vitest projects `engine`/`app` on happy-dom with the setup file. Task 2's `ConfigValuesTest` asserts `database.redis.sessions.database` against the config default (env unset in a child process) rather than `== 2`, and `FeaturesTest` evaluates `config/features.php` with the flag env vars removed. `TestBaselineSeeder` + `$seed = true` arrive in **Task 13**, the first task where all four seeders exist. Tests that assert a pristine state (Task 6 defaults/`catalogVersion() === 1`, Task 8 bump counts, the seeder tests) clear the rows they assert on or set `$seed = false`. `SessionRegistryTest` (Task 24) uses `UsesRedis` (DB 13), never the dev DB 2. |
| C3 | **Tooling/dependency gaps against 01 §1.2 and 16 §2/§14.** The Task 1 dev list omits `happy-dom`, `@vitest/coverage-v8`, `@playwright/test`, `@axe-core/playwright`, `@types/three`, `eslint`, `prettier` and their plugins. Playwright is unpinned (latest is 1.64.1), yet the local browsers are Chromium **1194**, which only Playwright **1.56.x** bundles; 16 §2/§19 say to pin that release and **never** run `playwright install` locally (Task 1 Step 4 runs it). `tsconfig` lacks `noUncheckedIndexedAccess: true`. `pint.json` lacks `final_class`. There is no `.prettierignore` for generated dirs. ESLint lacks `@typescript-eslint/no-explicit-any`, the Wayfinder URL `no-restricted-syntax` rule and global ignores. Flat ESLint does not read `.gitignore`, so `eslint .` would lint `engine-cli/dist`, `public/build`, `vendor` and the Wayfinder output. | 1 (→ P2) | Task 1 installs every 01 §1.2 dev package, pins `playwright` and `@playwright/test` to `1.56.1` with `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`, and drops the local `playwright install`. It adds `noUncheckedIndexedAccess`, Pint `final_class`, a `.prettierignore` (`resources/js/{actions,routes,wayfinder}`, `lang/generated`, `types/generated.d.ts`) and ESLint ignores + rules per 16 §7.2/§14. All of this lands **in Task 1**, so P2 branches with the final compiler/lint settings. |
| C4 | **CI cannot be both "17 §10.2 verbatim" and green in P1.** The spec workflow calls `.github/scripts/audit-gate.sh`, `testing:seed-catalog-snapshot --check`, `tests/Support/coverage-gate.php`, `--coverage-clover` thresholds, `vitest run --coverage`, `yarn bench:check`, `scripts/check-bundle-size.mjs`, `yarn playwright test` and `playwright.config.ts`. P1 creates none of these, and no other plan owns `seed-catalog-snapshot`, `bench:check` or `check-bundle-size`. Task 40 instead builds `scripts/audit-gate.php` with a different CLI, while 16 §14 and 17 §10.2 specify `bash .github/scripts/audit-gate.sh composer\|yarn\|pip`. Task 3 adds an i18n step that 17 §10.2 already contains. | 1, 3, 40 | Copy 17 §10.2 verbatim. Each step whose artefact does not exist yet gets the same probe pattern as `vision` (P1-D15): `test -f`/`hashFiles` per artefact, with a comment naming the owning milestone. Task 3 does not add a second i18n step. Task 40 creates `.github/scripts/audit-gate.sh <composer\|yarn\|pip>` per spec, with `AuditGateTest` exercising the shell script, and does not create `scripts/audit-gate.php`. Track the unowned artefacts (`seed-catalog-snapshot`, `coverage-gate.php`, `bench:check`, `check-bundle-size.mjs`, `playwright.config.ts`) in a roadmap note so P2/P4/P5/P9 pick them up. |
| C5 | **MorphMapTest is unsatisfiable with the P1-D2 alias list.** The test requires every concrete model under `app/Domain/*/Models` to appear in `MorphMap::MAP`. P1-D2 omits `OtpCode` and `NotificationPreference` (Task 4, so the test fails as soon as Task 5 adds it), `FurnitureTemplateSetting` (Task 9) and `MessageRead` (Task 12). | 4, 5, 9, 12 | Extend P1-D2 with `otp_code`, `notification_preference`, `furniture_template_setting` and `message_read`. Task 5 adds the first two; Tasks 9 and 12 add the others. The test stays as written. |
| C6 | **Unowned provider files.** `app/Providers/HorizonServiceProvider.php` is "modified" by Tasks 13 (gate) and 39 (`routeMailNotificationsTo`) but created by no task; Task 13's `GET /horizon → 200/403` test depends on it. `config/horizon.php` is "replace"d by Task 39 but never created. `app/Providers/TelescopeServiceProvider.php` is registered by Task 2 and "modified" by Task 22, but no task creates it. | 2, 5, 13, 22, 39 | Task 2 creates `App\Providers\TelescopeServiceProvider` (the `telescope:install` equivalent). It is not listed in `bootstrap/providers.php`; Task 2's conditional `register()` registers it per 17 §5.11 item 10. Task 13 creates `HorizonServiceProvider` (the gate) and lists it in `bootstrap/providers.php`. Task 39 **creates** `config/horizon.php`. |
| C7 | **Route-coverage mechanism.** The plan's `tests/Feature/Security/route-access.php` map plus `RouteGroupsTest`/`RouteCoverageTest` differs from 14 §20 and 16 §6.2–§6.3: `tests/fixtures/routes/registry.json` (name, method, URI, middleware), `tests/fixtures/routes/authorization.php` (`public\|guest\|signed\|token\|ownership\|permission:x\|gate:x\|any_staff\|auth`), `Routes/RouteRegistryTest`, `Security/RouteAuthorizationTest` and `MiddlewareBehaviourTest` (JSON vs Inertia per 14 §1.2). | 23 + every route task (21, 24–39) | Task 23 creates the spec fixtures and tests. Every route-adding task appends its rows to **both** fixtures, replacing the "add its entry to route-access.php" instruction. The `testing.*` routes (16 §4.5) are excluded as specified. |
| C8 | **`health.deep` placement.** Task 39 puts it in `routes/web.php`; 14 §1.1/§2 place it in stateless `routes/webhooks.php` (`HLTH`: no session, no throttle, "must answer while Redis is down"). Inside the `web` group, the Redis session driver throws before the controller can return 503 `down`. | 39 | Register `health.deep` in `routes/webhooks.php` without `web` middleware. Add a test that it answers while the cache/session store is unavailable. |
| C9 | **Fortify route guards missing; the password-reset throttle contradicts the generic response.** 14 §1.1/§3.1 add `FortifyRouteGuards` to the `web` group: `register.store` → `throttle:register` + Turnstile, `password.email` → `throttle:password-reset` + Turnstile, `verification.send` → `throttle:verification-resend`, and `recent.auth` on email change. The plan never says how Tasks 25/26 attach these limiters to package routes (Task 25 tests "6th registration throttled"). 13 §5.5, the owning section, requires the **generic** response even when throttled, which Task 26 also tests ("4th request still generic"). A plain `throttle:` middleware would answer 302 + `errors.rate_limited` instead. | 22, 25, 26 | Task 25 creates `App\Http\Middleware\FortifyRouteGuards` (appended to `web` after `PreventRequiredTwoFactorDisable`), covering register and email-change. Task 26 extends it for `password.email` and `verification.send`. For `password.email` the limiter is applied **silently**: hit, skip sending, return the generic status. 13 §5.5 beats 14 §3.1 per 14's precedence note. |
| C10 | **Wire-type, class and contract names deviate from 14 §19 / §2–§18 and 16 §4.4.** `BusinessPublicData` (15 §8) → 14 §19.1 `App\Domain\Settings\Data\BusinessSharedData` (15 and 14 disagree; 14 §19.1 is normative for wire types). `App\Support\Media\MediaData` → `App\Domain\Shared\Data\MediaData`. `SessionEntry {key,…}` → `SessionData {id,…}`. Presign returns 200 `{uploadId,url,headers}` → **201** `UploadPresignData {uploadId,url,headers,expiresAt}`. `api.uploads.show` `{status,reasonCode,previewUrl}` → `UploadIntentStatusData {uploadId,status,reasonCode,previewUrl,width,height}`, with DB `uploaded` reported as `processing`. Display-preferences action `UpdatePreferences` → **`UpdateDisplayPreferences`** (`UpdatePreferences` is P8's notification-preferences action; real collision). `auth.reauthenticate.store` body `{code?}` → `{step: send\|verify, code}`. Business settings clear the logo with `removeLogo` (not `logoUploadId: null`). Delete-confirmation key `account.delete.confirm_word` → `account.delete_word` (case-insensitive). Presigner names `UploadPresigner`/`S3UploadPresigner` → 16 §4.4 `PresignedUploadUrlGenerator` / `S3PresignedUploadUrlGenerator` / `LocalTestingUploadUrlGenerator` + `routes/testing.php` + `config('uploads.testing_local')`. Controller/action names: `Account\SessionController`, `Account\PhoneController`, `Account\GoogleLinkController` + `UnlinkGoogleAccount`, `Auth\AccountDeletedController`, `Customer\Account\DeletionController`/`DataExportController`, `Admin\Settings\{Group}SettingsController` + `Update{Group}SettingsRequest`, `UpdateStaffMember`/`ActivateUser`, `SkipOnboarding`, `RevokeSessions`; page props live in `resources/js/types/pages.d.ts`. Also `Socialite::fake('google', …)`, not `shouldReceive`. | 20, 24, 28, 29, 30, 32, 33, 34, 35, 36, 37 | Adopt the 14/16 names and shapes. Log the `BusinessPublicData`/`SharedPageProps` vs `BusinessSharedData`/`SharedProps` discrepancy (15 vs 14) in `19 §5` as resolved in favour of 14. |
| C11 | **Factory and fixture vocabulary deviates from 16 §5.** User states: spec `staff(string $role)`, `emailVerified()`, `phoneVerified()`, `googleLinked()`, `imperial()`, `pendingDeletion(int $days = 5)`, `deletionExpired()`, with `owner()`/`admin()` **including a confirmed TOTP unless `withoutTwoFactor()`**. Plan: `staff()`, `withPhone()`, `withTwoFactor()`, and role states without 2FA. Task 23/31 tests ("admin without 2FA → redirect") rely on the plan's semantics. Order: spec has one named state per 09 state; plan has `inState($class)`. OtpCode/UploadIntent/StaffInvitation state names also differ. Upload fixtures: spec 16 §5.2 names (`photo.heic`, `real.dwg`, `renamed-dwg.dxf`, `script.svg`, `jpeg-as-png.png`, `bomb-50mp.png` 7100², `plan-3pages.pdf`, `encrypted.pdf`, `filenames.php`, …) vs plan's `png-as-jpg.jpg`, `drawing-as-dxf.dxf`, `vector.svg`, `doc.pdf`, … The plan has **no HEIC fixture** although `ProcessUploadTest` needs one. | 4, 10, 13, 23, 27, 30, 31, 32 | Use the 16 §5.1 state names; plan-only states may stay as extra aliases. `owner()`/`admin()` include confirmed 2FA. Task 23/31 tests use `->withoutTwoFactor()`. `Order` gets the named states as thin wrappers over `inState`; full scenario history (`OrderScenarioBuilder`) stays with P7. Task 32 generates the 16 §5.2 fixture set, including a synthetic `photo.heic` with an `ftypheic` header. |
| C12 | **Task 1 preflight is infeasible in this worktree, and setup steps are missing.** The worktree is already on `build/p1-foundation`, so `git checkout -b build/p1-foundation develop` fails, and there is no local `develop` or `main`. Neither `.env` nor `APP_KEY` is created, so Feature tests hit `MissingAppKeyException`, and the `.env` copied from `.env.example` leaks local values into tests (see C2). | 1 | Skip branch creation and commit on the current branch; the orchestrator owns merging to `develop`. Add `cp .env.example .env && php artisan key:generate` to Task 1 Step 1 (16 §19 one-time setup). `.superpowers/` is already git-excluded, so `git add -A` is safe. |
| C13 | **P2 coupling to P1 Task 1.** (a) P2 Task 1 Step 3 adds root-level Vitest `include`/`exclude`, which inline `projects` ignore. P1 already routes `resources/js/engine/**` and `engine-cli/src/**` to project `engine`. (b) P2's gates run `yarn vue-tsc --noEmit` over the whole project. Kit pages import Wayfinder output (`resources/js/{routes,actions,wayfinder}`, git-ignored), which needs `vendor/` + `php artisan wayfinder:generate`; P2 claims "no PHP needed". (c) P2 Task 51 adds `@vitest/coverage-v8`, changing `yarn.lock` and contradicting P1's "no lockfile changes for P2". (d) P1 Task 3 creates empty `engine/parts/hardware/issues/changes/templates.php` while P2 Task 51 creates the same files in a parallel branch (add/add merge). P1's `tsconfig` `include: engine-cli/**/*` with `allowJs` also pulls `engine-cli/dist/*.mjs` into vue-tsc. | 1, 3 ↔ P2 1, 48, 50, 51 | P1 Task 1 **Produces** adds: (a) Vitest projects (`engine`, `app`), with P2 adding globs only to `engine`; (b) a note that the P2 worktree runs `composer install` + `php artisan wayfinder:generate --with-form` once before `vue-tsc`; (c) `@vitest/coverage-v8@^3` already installed; (d) `tsconfig` include `engine-cli/src/**/*.ts`. P1 Task 3 does not create the six engine-owned lang files; P2 Task 51 owns them and P1's `i18n:export` tolerates their absence. |
| C14 | **Stale spec references in the plan header and Global Constraints.** "Routes … come from `19 §8.5` (spec `14` is not written yet)"; "`16` is replaced by `17 §10.2` + `13 §20`". | header, Global Constraints, 23 | Treat 14 as the route/contract authority and 16 as the test authority. Update the Global Constraints line ("Routes: names, paths, middleware, bodies and responses per `14`; tests per `16`"). |
| C15 | **Reverb `allowed_origins` default.** 17 §5.11 item 7 says `explode(',', env('REVERB_ALLOWED_ORIGINS', '*'))`; 13 §8.10 says `[parse_url(APP_URL, PHP_URL_HOST)]`. Task 38 copies 17's wildcard default (spec-internal conflict). | 38 | Keep the env variable (17) but default it to the APP_URL host (13, the security owner). Log in 19. |
| C16 | **Kit pages outlive the layouts Task 21 deletes.** Task 21 deletes kit layouts (`layouts/auth/**`, `AppLayout.vue`, …) and replaces `layouts/AuthLayout.vue` with a `variant`-prop version. Kit auth pages (`Auth/*`, which take `title`/`description` props on `AuthLayout`) live until Tasks 25/26/31, and kit `pages/Dashboard.vue` imports `AppLayout`, so `vue-tsc`/`yarn build` break from Task 21 to Task 31. | 1, 21, 25, 26, 31 | Task 21's new `AuthLayout` also accepts optional `title`/`description` props, slotting them into the card header (also useful for the new pages). Task 21 deletes kit `pages/Dashboard.vue` and the kit layouts only once nothing imports them, and `vue-tsc` stays green at every task. |

---

## (a) Shared files and interfaces — one row per producer → consumer pair

Legend: **OK** = the contract matches; **conflict** = see C#; **issue** = minor internal fix (I#, §b).

| # | Tasks | Shared file / interface | Produced by → consumed by | Finding |
|---|---|---|---|---|
| a1 | 1 → 2 | `bootstrap/app.php`, `config/*`, `AppServiceProvider`, `.env.example`, `tests/Unit/ArchTest.php` | scaffold → config/flags/trusted proxies/maintenance | OK (after C1 cleanup) |
| a2 | 1 → 3 | `composer.json` autoload, `vite.config.ts`, `resources/js/app.ts`, `ci.yml` | scaffold → i18n | **conflict C4** (duplicate i18n CI step) / C1 (vite-plus `vite.config.ts`) |
| a3 | 1 → 4 | kit migrations, `App\Models\User`, kit `database/factories/UserFactory.php`, `config/fortify.php` | scaffold → identity | **conflict C1** (passkeys migration/feature not removed) + I2 (kit UserFactory not deleted) |
| a4 | 1 → 5 | kit cache/jobs migrations | scaffold → package tables | OK |
| a5 | 1 → 12 | `database/migrations/*` set | scaffold → `MigrationOrderTest` | **conflict C1** (kit passkeys migration makes the exact list fail) |
| a6 | 1 → 16 | `resources/css/app.css`, `resources/views/app.blade.php` (fonts removed) | scaffold → tokens/fonts | **conflict C1** (`@fonts` Blade directive left behind) |
| a7 | 1 → 17 | `components.json`, kit `components/ui/*`, `lib/utils.ts` | scaffold → shadcn set | issue I8 (style `new-york` vs kit `new-york-v4` on Tailwind 4; see E10) |
| a8 | 1 → 18 | kit `resources/js/types/ui.ts` | scaffold → Task 18 "Create types/ui.ts" | issue I6 (file exists; Modify/append `Tone`) |
| a9 | 1 → 21 | `LEGACY_KIT_FILES`, kit layouts/pages | scaffold → layouts | **conflict C16**; issue I7 (Task 21 `git add eslint.config.js` not in Files) |
| a10 | 1 → 25/26/31 | kit `pages/Auth/*` (moved), `FortifyServiceProvider` view names | scaffold → replaced pages | OK (with C16) |
| a11 | 1 → 31 | `LEGACY_KIT_FILES` block in `eslint.config.js` | scaffold → emptied | OK (I11: new pages must not import kit components that 31 deletes) |
| a12 | 1 → 22 | kit `config/inertia.php` | scaffold → "Create config/inertia.php" | issue (exists → Modify; C1) |
| a13 | 1 → 40 | `ci.yml`, `composer.json` `scripts.dev`, kit `.github/dependabot.yml` | scaffold → deploy/audit | **conflict C4** (audit gate form, verbatim CI) + C1 (dependabot exists → Modify) |
| a14 | 1 → all PHP tasks | `tests/Pest.php`, `tests/TestCase.php`, `phpunit.xml` | harness → every test | **conflict C2** |
| a15 | 1 → all JS tasks | `vitest.config.ts`, `tsconfig.json`, `eslint.config.js`, `.prettierrc`, scripts | harness → every Vitest/lint gate | **conflict C2/C3** |
| a16 | 1 → P2 T1 | `package.json` deps/scripts, `tsconfig` (`@/*`, strict), `vitest.config.ts`, flat `eslint.config.js`, Prettier | P1 Produces → P2 Step 0/3/5 | **conflict C13(a,b), C1** (ESLint/Prettier not in kit), C3 (`noUncheckedIndexedAccess` must exist before P2 code) |
| a17 | 1 → P2 T48 | `engine-cli/src/cli.ts` `dispatch` + `CliResponse`, `engine-cli/vite.config.ts`, `build`/`build:engine-cli` scripts, `.gitignore engine-cli/dist` | P1 stub → P2 replaces | OK (P2 keeps the contract; its "Modify package.json/tsconfig" become no-ops) |
| a18 | 1 → P2 T50/T51 | `package.json` (coverage-v8, perf/bench scripts), `vitest.config.ts` coverage | P1 → P2 | **conflict C13(c)** |
| a19 | 1 → P2 T1 | `resources/js/engine/{index,version}.ts`, `__tests__/version.test.ts` | P1 stub → P2 owner | OK |
| a20 | 2 → 3 | `config('app.supported_locales')` | config → i18n export | OK |
| a21 | 2 → 5 | disks `s3`/`s3-public`, `MEDIA_*` env | config → medialibrary | OK |
| a22 | 2 → 20 | `Features::all()` key order, `config('app.version')` | config → shared props | OK |
| a23 | 2 → 22 | trusted proxies in `bootstrap/app.php` | config → `TrustedProxiesTest` | OK |
| a24 | 2 → 24 | `config/session.php`, `config/database.php` redis `sessions` | both tasks list them as modified | issue I4 (duplicate ownership; Task 24 must only verify, not redefine) |
| a25 | 2 → 27/32/39 | `config/imports.php` (`vision.url/token/normalize_timeout_s`) | config → HEIC converter, health | OK |
| a26 | 2 → 39 | maintenance `except: ['up','up/deep']` | config → `HealthDeepTest` | OK (C8 moves the route file; the except list still applies) |
| a27 | 2 → 22/13 | `TelescopeServiceProvider` registration | Task 2 registers → Task 22 modifies; nobody creates | **conflict C6** |
| a28 | 3 → 6 | `resources/lang/en/{quotes,production}.php` | Task 3 creates empty → Task 6 lists under "Create" | issue I5 (Modify) |
| a29 | 3 → 18 | `ENUM_KEY_PATTERNS` in `i18n-keys.test.ts` | i18n → status badge keys | OK |
| a30 | 3 → 20 | `lang/generated/manifest.json` hash, `createI18n` | i18n → shared prop + stale reload | OK |
| a31 | 3 → 18/19/21/23/25–37 | `trans_icu`, `t()`, namespace files | i18n → every UI/PHP string | OK |
| a32 | 3 ↔ P2 T51 | `resources/lang/en/{engine,parts,hardware,issues,changes,templates}.php` | both create | **conflict C13(d)** |
| a33 | 4 → 5 | `User` (`HasPushSubscriptions`, media), `MorphMap` | identity → package tables | **conflict C5** (`otp_code`, `notification_preference` aliases missing) |
| a34 | 4 → 13 | `UserFactory`, `StaffRole` | identity → role states | **conflict C11** (16 §5.1 `owner()`/`admin()` carry 2FA) |
| a35 | 4 → 25/26/28/29/30 | `email` mutator, `hasVerifiedContact()`, `hasPassword()`, `MustVerifyEmail` | identity → auth flows | OK |
| a36 | 4 → 23 | `UserFactory::inactive()/notOnboarded()/pendingDeletion()` | identity → middleware tests | OK (C11 for 2FA states) |
| a37 | 5 → 6/7/8/9/10/11/12 | `MorphMap::MAP` appends | each model task | **conflict C5** (Tasks 9 and 12 add models without aliases) |
| a38 | 5 → 32 | `UploadPurpose` (14 cases), `UploadIntent`, `UploadStatus` | schema → upload actions | OK |
| a39 | 5 → 33 | `App\Support\Media\Media` model | schema → media serving | OK; `MediaData` location → C10 |
| a40 | 5 → 22 | Pulse config (`Pulse::user` resolver deferred) | config → Task 22 resolver | OK |
| a41 | 5 → 26/30/35 | `notification_deliveries`, push subscriptions | schema → deletion/anonymisation | OK |
| a42 | 6 → 8 | `CatalogVersion::bump()`, `Settings` | settings → catalog observer/seeder | OK |
| a43 | 6 → 13 | `SettingsSeeder` in `DatabaseSeeder` order | settings → seeders | OK |
| a44 | 6 → 20/23/25/27/37 | `Settings::business()/units()/auth()/notifications()`, `toWire()` | settings → props/middleware/OTP/admin pages | OK |
| a45 | 6 → 10/11 | `OrderNumber::draft/next`, `QuoteNumber::for` | numbers → order/quote `creating` | OK |
| a46 | 7 → 9 | `Documents` helper (`emptyPlan` → `placeholderFurniture`) | projects → furniture factories | OK |
| a47 | 7 → 9/10 | `JsonDocument`/`AsJsonDocument` cast | projects → documents in furniture/proposals | OK |
| a48 | 8 → 9 | seed codes used by `placeholderFurniture` | catalog seed → furniture placeholder | OK |
| a49 | 8 → 6/37 | `TaxRatesSeeder` sets `pricing.default_tax_rate_id` | catalog → settings | OK |
| a50 | 9 → 11 | `furniture_designs.locked_by_order_id` (FK deferred) | furniture → `_081200_add_order_foreign_keys` | OK |
| a51 | 9 → 14/33/38 | `BlueprintImport` (`isTerminal`, media `debug`), `FurnitureDesign` | schema → policies/media/channels | OK |
| a52 | 10 → 11/12 | `Order` relations, deferred quote FKs | orders A → orders B / messages | OK |
| a53 | 10 → 15/18/20/35 | `OrderState` + `OrderStateKey` | states → policies, badges, `staffCounters`, deletion | OK |
| a54 | 4–12 → 12 | `MigrationOrderTest` exact list, `AllFactoriesTest`, model ArchTest | all schema tasks → checks | **conflict C1** (passkeys file); ArchTest exception list OK |
| a55 | 13 → 14/15 | `PermissionName`, `AuthorizesStaff`, owner gates | roles → policies | OK |
| a56 | 13 → 20 | `User::permissionNames()/abilities()` | roles → `auth.user` | OK |
| a57 | 13 → 39 | `HorizonServiceProvider` gate / `routeMailNotificationsTo` | both "modify"; nobody creates | **conflict C6** |
| a58 | 13 → 30/37 | `staff.manage_owners`, `settings.manage_restricted`, `settings.change_currency` gates | roles → staff/settings | OK |
| a59 | 14/15 → 32 | policies for upload targets (`ProjectPolicy::update`, `OrderPolicy::manageProduction`, …) | policies → presign authorisation | OK |
| a60 | 14/15 → 33 | policies for the `media.show` matrix | policies → media access | OK |
| a61 | 14/15 → 38 | `OrderPolicy::view/viewInternal`, `BlueprintImportPolicy::view`, `FurnitureDesignPolicy::view` | policies → channels | OK |
| a62 | 16 → 17/18/21 | semantic tokens, `useTheme`, `Z` | tokens → components/layouts | OK |
| a63 | 17 → 18/19/21/30/37 | `buttonVariants`, `badgeVariants`, `usePermissions`, `useBreakpoint`, `cn` | components → consumers | OK |
| a64 | 17/18/19 → 20 | `usePermissions` reads `auth.user.*`; `useFormat` reads `business.*`; `AddressFields` reads `business.defaultCountryCode` | consumers built **before** Task 20 types the shared props | issue I9 (ordering; Tasks 17–19 declare a local minimal prop type or Task 20's `inertia.d.ts` moves to Task 17) |
| a65 | 18 → 21/34/36/37 | `ConfirmDialog`/`useConfirm`, `PageHeader`, `FormSection`, `StickyActionBar`, `ScreenTooSmall` | components → pages | OK |
| a66 | 19 → 29/34/36/37 | `PhoneInput`, `LengthInput` (placeholder adapter P1-D3), `AddressFields`, `CurrencyInput`, `PercentInput` | inputs → pages | OK |
| a67 | 20 → 21/25–37 | `SharedPageProps`, `AuthUserData`, `BusinessPublicData` | props → all pages | **conflict C10** (`BusinessSharedData` per 14 §19.1) |
| a68 | 21 → 23 | `routes/customer.php`, `routes/admin.php` (temporary `['web','auth']`) | layouts → full groups | OK (C7 for coverage) |
| a69 | 21 → 29/30/34/35/37 | `CustomerLayout #banner`, `adminNav`, `UserMenu`, `AccountNav` | shell → appenders | OK |
| a70 | 21 → 36 | `WelcomeController` | Task 21 creates → Task 36 modifies | OK |
| a71 | 22 → 23/25/27/32/35 | `config('security.rate_limits')`, `RateLimitServiceProvider` (25 limiters), 429 rendering | hardening → limiter users | OK on values; 429 JSON body lacks `message` (14 §1.8 envelope) → covered by C10 |
| a72 | 22 → 25/26 | Fortify `login`/`two-factor` limiters moved; Fortify route throttles | hardening → Fortify | **conflict C9** |
| a73 | 22 → 24/25/27/30/35 | `Mask`, `RedactPiiProcessor` | privacy → audit properties | OK |
| a74 | 22 → 38 | CSP `connect-src` Reverb host | headers → Echo | OK |
| a75 | 23 → 24–39 | middleware aliases, groups, `RecentAuthentication`, route-coverage map | access → every route task | **conflict C7** (fixtures), C14 |
| a76 | 23 → 31 | `EnsureTwoFactorEnrolled::EXEMPT` incl. `admin.security.two-factor` | middleware → 2FA page | OK (stub route in tests until 31) |
| a77 | 23 → 36 | `EnsureCustomerOnboarded::EXEMPT` / CUS0 | middleware → onboarding | OK (14 uses a `CUS0` group instead of an exempt list; same behaviour; prefer 14's group) |
| a78 | 24 → 25/26/30/34/35 | `SessionRegistry` (`register`, `destroyOthers`, `destroyAll`), `SessionKey` | sessions → login/reset/staff/account/deletion | OK; DTO name → C10 |
| a79 | 25 → 26/28/29 | `CustomerRegistered`, `ContactVerified` events, `IntendedRedirect` | login/register → other auth | OK |
| a80 | 25 → 28/29 | `Auth/Login.vue`, `Auth/Register.vue` | 25 creates → 28/29 add buttons | OK |
| a81 | 26 → 28/29/30 | `ContactVerification::markEmailVerified/markPhoneVerified` | verification → Google/OTP/invitation | OK |
| a82 | 27 → 29/34 | `SendOtp`, `VerifyOtp`, `OtpException`, `OtpChannelResolver::available` | OTP core → routes/profile `otpChannels` | OK |
| a83 | 28 → 29 | customer creation on Google sign-up vs `RegisterCustomer` (created in 29) | 28 needs it before it exists | issue I10 |
| a84 | 28 → 30 | Google `invitation` intent session keys | OAuth → acceptance | OK |
| a85 | 28 → 34 | `account.google.unlink`, `GoogleButton` | OAuth → security page | OK (controller name → C10) |
| a86 | 29 → 34/36 | `PhoneVerifyDialog`, `VerifyContactBanner` | OTP pages → account/onboarding | OK |
| a87 | 30 → 31 | `ResetTwoFactor` action | staff mgmt → console command | OK |
| a88 | 32 → 33 | upload intent flow (`api.uploads.*`) | backend → `uploadWithIntent` client | **conflict C10** (201 + `expiresAt`, status DTO) |
| a89 | 32 → 34/37 | `ConsumeUploadIntent` (avatar, business logo) | uploads → account/settings | OK (`removeLogo` → C10) |
| a90 | 33 → 34/37 | `ImageUploader`, `MediaData` | media → pages | OK; `MediaData` namespace → C10 |
| a91 | 34 → 36 | display-preferences action | 34 creates `UpdatePreferences` → 36 consumes | **conflict C10** (`UpdateDisplayPreferences`; collides with P8) |
| a92 | 34 → 35 | `AccountNav` (Delete account item) | account → deletion | OK |
| a93 | 27/32/35 → 39 | `otp:monitor`, `otp:prune`, `media:cleanup-orphans`, `users:anonymise-deleted` | commands → schedule | OK |
| a94 | 21 → 38 | `AppShell` + `useUserChannel` | shell → realtime | OK |
| a95 | 39 → 40 | Horizon supervisors / `docker/supervisor/horizon.conf` | queues → deployment files | OK |

---

## (b) Per-task internal consistency

| Task | Tests vs code / files created vs later touched | Verdict |
|---|---|---|
| 1 | Assumes kit files that no longer exist (C1). Branch commands infeasible (C12). The local `playwright install` contradicts 16 §19 (C3). The Unit tests (`ComposerPlatformTest`) would run without the app if `beforeEach(Http::…)` were global (C2). `format:check`/`lint` lack ignores (C3). | **issue → C1, C2, C3, C12** |
| 2 | `FeaturesTest` "defaults with no env" collides with `.env` and the 16 phpunit env (`FEATURE_SMS=true`, …). `ConfigValuesTest` `sessions.database == 2` fails under 16's `REDIS_SESSION_DB=13`. The Unit tests need the app. `BootWithoutServicesTest` is labelled "Review Focus 5" but tests boot purity (I12). | **issue → C2** |
| 3 | The CI i18n step duplicates 17 §10.2 (C4). It creates engine-owned lang files that P2 also creates (C13d). `TransIcuTest` is in Unit (needs the app, C2). | **issue** |
| 4 | Kit passkeys migration and kit `database/factories/UserFactory.php` not deleted (C1, I2). Cascade/restrict tests use `delete()` on SoftDeletes models, so the FK action never fires; they must use `forceDelete()` (I1). | **issue** |
| 5 | `MorphMapTest` fails immediately (C5). | **conflict C5** |
| 6 | `quotes.php`/`production.php` listed as Create, but Task 3 created them (I5). `EncryptedStringCastTest` in Unit needs the app (C2). The "defaults without rows" tests break once baseline seeding exists (C2 ruling). | **issue** |
| 7 | "deleting the owner user throws (R)" / "deleting a project cascades": SoftDeletes models need `forceDelete()` (I1). | **issue I1** |
| 8 | Consistent with 08 §7 (counts 12/8/40/6/14 and spot values check out). `FORCE_CATALOG_SEED` env replaces 02 §14's `--force-catalog` (not a valid `db:seed` option): an acceptable decision, to record in 19. | OK |
| 9 | Adds a model without a morph alias (C5). The cascade tests need `forceDelete()` (I1). | **issue** |
| 10 | The cascade test on SoftDeletes `Order` needs `forceDelete()` (I1). The factory API differs from 16 §5.1 (C11). | **issue** |
| 11 | "deleting an order nulls `locked_by_order_id`", "deleting an order with payments throws" → `forceDelete()` (I1). | **issue I1** |
| 12 | `MigrationOrderTest` fails while the kit passkeys migration exists (C1). `MessageRead` lacks an alias (C5). | **issue → C1, C5** |
| 13 | Modifies a non-existent `HorizonServiceProvider` (C6); `GET /horizon` test depends on it. Role states lack 16's 2FA default (C11). | **conflict C6** |
| 14 | Consistent with 13 §8.1–§8.4. | OK |
| 15 | Consistent with 13 §8.5–§8.8. | OK |
| 16 | Consistent; `@fonts` removal is part of C1. | OK |
| 17 | `usePermissions` typing depends on Task 20 types (I9). Style `new-york` vs kit `new-york-v4` (I8/E10). | **issue** |
| 18 | `resources/js/types/ui.ts` already exists in the kit (I6). `useFormat` depends on shared props typed in Task 20 (I9). Tones match 15 §9.3. | **issue** |
| 19 | `AddressFields` default from `business.defaultCountryCode` before Task 20 (I9). | **issue I9** |
| 20 | `BusinessPublicData` vs 14 `BusinessSharedData` (C10). Otherwise matches 01 §6/15 §8 (18 `AuthUserData` fields). | **conflict C10** |
| 21 | Deletes kit layouts still imported by kit pages (C16). `git add eslint.config.js` not in Files (I7). | **conflict C16** |
| 22 | Modifies a non-existent `TelescopeServiceProvider` (C6). `config/inertia.php` exists (Modify). The Unit tests need the app (C2). The 429 JSON lacks `message` (14 §1.8). | **issue → C6** |
| 23 | `route-access.php` instead of the spec fixtures (C7). JSON branches of 14 §1.2 untested (16 `MiddlewareBehaviourTest`). Admin 2FA test needs `withoutTwoFactor()` under C11. `Route::pattern` ULID constraints (14 §1.6) are missing; add here. | **conflict C7** |
| 24 | Duplicates Task 2's session/redis config edits (I4). `SessionRegistryTest` touches the dev Redis DB (C2). `SessionEntry` vs `SessionData` (C10). The "revoking the current session logs out" behaviour of 14 §3.3 is untested. | **issue** |
| 25 | No mechanism to throttle `register.store` (C9). `TurnstileTokenTest` in Unit (C2). | **conflict C9** |
| 26 | "4th request still generic" contradicts a plain `throttle:password-reset` (C9). | **conflict C9** |
| 27 | Consistent with 13 §4 (limits, captcha on the 3rd send, the 50/20 % monitor). The `OtpDelivery` abstraction (P1-D6) is an acknowledged deviation from 13 §4.2 step 7. | OK |
| 28 | Creates customers before `RegisterCustomer` exists (Task 29) (I10). `Socialite::shouldReceive` vs 16 `Socialite::fake` (C10). | **issue** |
| 29 | `auth.reauthenticate.store` body `{code?}` vs 14 `{step, code}` (C10). | **conflict C10** |
| 30 | Action names `ChangeStaffRole`/`ReactivateUser` vs 14 `UpdateStaffMember`/`ActivateUser` (C10). Otherwise consistent with 13 §5.9/§7.3. | **issue → C10** |
| 31 | Deleting "remaining kit Vue files" can break new pages that import kit components (`InputError`, `TextLink`, `AppLogoIcon`) (I11). | **issue I11** |
| 32 | Fixture names and HEIC fixture (C11). Presign status/DTO (C10). Presigner/testing route naming (C10/16 §4.4). | **conflict C10/C11** |
| 33 | `MediaData` namespace (C10). Otherwise consistent with 13 §8.9. | **issue → C10** |
| 34 | `UpdatePreferences` naming collision (C10). | **conflict C10** |
| 35 | Confirmation key name, controller names (C10). Otherwise consistent with 13 §9. | **issue → C10** |
| 36 | Consumes the renamed display-preferences action (C10). Store body is a deliberate subset per P1-D4 (14 §4 adds `project`/`start` in P4). | OK (after C10) |
| 37 | Business `removeLogo` (C10). Controller/FormRequest names (C10). Validation boundaries match 14 §16. | **issue → C10** |
| 38 | Reverb origin default (C15). Spec 16 uses `BROADCAST_CONNECTION=log` + a fake broadcaster (C2). | **issue → C15** |
| 39 | `health.deep` route file (C8). Creates no `config/horizon.php`/provider (C6). Schedule matches 01 §7 (P1 subset). | **conflict C8** |
| 40 | `scripts/audit-gate.php` vs `.github/scripts/audit-gate.sh` (C4). `dependabot.yml` exists from the kit (C1). Deployment-file checks reference 17 §5 verbatim (fine). | **conflict C4** |

Minor internal issues (no owner ruling needed):
- **I1:** cascade/restrict tests on SoftDeletes models must use `forceDelete()` (Tasks 4, 7, 9, 10, 11).
- **I2:** delete the kit `database/factories/UserFactory.php` (Task 4).
- **I3:** `ComposerPlatformTest` should read `composer.json` via `__DIR__` or `base_path()` with `TestCase` (Task 1).
- **I4:** session/redis config has a single owner, Task 2 (Task 24).
- **I5:** the lang files of Task 6 are Modify, not Create.
- **I6:** `types/ui.ts` is Modify (Task 18).
- **I7:** Task 21 Files must list `eslint.config.js`.
- **I8:** components.json style (see E10).
- **I9:** Tasks 17–19 need the shared-prop types before Task 20; move `resources/js/types/inertia.d.ts` to Task 17 or let 17–19 declare a minimal local type.
- **I10:** create `RegisterCustomer` (with `fromGoogle`) in Task 28; Task 29 adds `fromPhone`.
- **I11:** Tasks 25–30 must not import kit components that Task 31 deletes.
- **I12:** fix the Review-Focus label of `BootWithoutServicesTest`.
- **I13:** Task 32 needs a HEIC fixture (folded into C11).
- **I14:** Task 23 should add the 14 §1.6 `Route::pattern` ULID constraints.

---

## (c) Plan mandates that would be review defects, contradictions with Global Constraints/spec, environment feasibility

### c1 — Plan mandates a spec-checking reviewer would reject

| Mandate in plan | Spec says | Ref |
|---|---|---|
| Vitest `ui` project on `jsdom`; dev dep `jsdom` | project `app` on `happy-dom` with `resources/js/test/setup.ts` | 01 §1.2, 16 §2/§7.2 → C2 |
| Pest `RefreshDatabase` for Feature; Unit without `TestCase`; `BROADCAST_CONNECTION=null` | `LazilyRefreshDatabase`; `TestCase` in Unit; `log` broadcaster; full env block | 16 §2–§4 → C2 |
| `playwright` unpinned + `yarn playwright install chromium` locally | one pinned version bundling Chromium 1194; never install locally | 16 §2, §19 → C3 |
| `pint.json` with `declare_strict_types` only; tsconfig `strict` only | + `final_class`; + `noUncheckedIndexedAccess` | 16 §14 → C3 |
| CI = 17 §10.2 verbatim (red until P2–P9) and `scripts/audit-gate.php` | `.github/scripts/audit-gate.sh composer\|yarn\|pip` | 16 §14, 17 §10.2, 01 §3 → C4 |
| `tests/Feature/Security/route-access.php` | `tests/fixtures/routes/{registry.json,authorization.php}` | 14 §20, 16 §6.2–§6.3 → C7 |
| `health.deep` in `routes/web.php` | stateless `routes/webhooks.php` | 14 §1.1/§2 → C8 |
| No `FortifyRouteGuards` | required in the `web` group | 14 §1.1/§3.1 → C9 |
| `BusinessPublicData`, `App\Support\Media\MediaData`, `SessionEntry`, `UpdatePreferences`, presign 200, `{code?}` reauth body, `UploadPresigner` | `BusinessSharedData`, `Shared\Data\MediaData`, `SessionData`, `UpdateDisplayPreferences`, 201 + `expiresAt`, `{step, code}`, `PresignedUploadUrlGenerator` | 14 §2–§19, 16 §4.4 → C10 |
| Factory state names (`staff()`, `withTwoFactor()`, `inState()`), upload fixture names | 16 §5.1/§5.2 names; `owner()`/`admin()` with 2FA | 16 §5 → C11 |
| "copy `eslint.config.js`/`.prettierrc` from the kit", "delete `package-lock.json`" | the kit has neither; master §6.6 still mandates ESLint + Prettier | C1 |
| `MorphMapTest` + the P1-D2 alias list | (self-contradiction) | C5 |
| Reverb `allowed_origins` default `*` | APP_URL host (13 §8.10) vs `*` (17 §5.11) | C15 |

### c2 — Contradictions with the plan's own Global Constraints

- **GC "Routes … from `19 §8.5` (spec 14 not written)"**: stale; 14 is now normative (C14).
- **GC "DB tests … `RefreshDatabase`"**: 16 §4.1 mandates `LazilyRefreshDatabase` for Feature (C2).
- **GC "`Http::preventStrayRequests()` is global"**: placed in Pest.php `beforeEach`, it breaks app-less Unit tests; 16 puts it in `TestCase::setUp` with Unit using `TestCase` (C2).
- **GC "Tests … S3 faked (`Storage::fake('s3')`)"**: 16 additionally fakes `s3-public` in `TestCase` and requires the testing upload routes (C2/C10).
- **GC "Package manager: yarn 4 only; `package-lock.json` must not exist"**: the kit brings pnpm files instead; delete `pnpm-workspace.yaml`/`.npmrc` (C1).
- **GC "Quality gates Gates-JS = `yarn lint && yarn format:check …`"**: the kit has no ESLint/Prettier; Task 1 must author them (C1/C3).
- **GC "Wire format camelCase"**: honoured. The 429 JSON should follow the 14 §1.8 envelope (`code` + `message`); covered by C10.
- **Goal "CI-green skeleton"** vs Task 1 "17 §10.2 verbatim" (C4).

### c3 — Environment feasibility

| # | Item | Finding | Action |
|---|---|---|---|
| E1 | PHP 8.4 at `/usr/local/bin/php` | 8.4.26 present; Pest 5.3.3 (needs PHP ^8.4, PHPUnit ^13.4.3), pest-plugin-browser 5.1.2, larastan 3.13.0, framework 13.38.0 and wayfinder 0.1.23 exist on Packagist. | Remove the kit's direct `phpunit/phpunit ^12.5` (it blocks Pest 5). |
| E2 | Composer source installs | Global config is `preferred-install=source`. `phpstan/phpstan` has **no source** (dist only) → `composer-seed-dist` (present). Other packages without a source may surface; the same procedure applies. | Keep the Task 1 instruction. Run chisel removal **before** the first `composer require`/`update`: the kit's `post-update-cmd` runs `php artisan install:features` (C1). |
| E3 | Scaffold clone into the existing root | `git clone --depth 1` works (verified). `rsync --exclude .git` into the worktree root is safe: the kit has no `docs/` or `vision/`, and `.superpowers/` is git-excluded. The kit `.gitignore` overwrites nothing (the repo has none). | Also exclude/delete kit `.github/workflows/tests.yml` after the rsync. Verify `git status -- docs vision` stays empty as planned. |
| E4 | fonts.bunny.net blocked | The kit loads fonts through `laravel-vite-plugin/fonts` `bunny()` **and** a Blade `@fonts` directive; `app.css` names "Instrument Sans". Removing only the plugin leaves `@fonts`. | Remove the `fonts:` option, the `@fonts` directive and the Instrument Sans references (C1). Task 16 adds `@fontsource-variable/*`. |
| E5 | yarn via corepack | Node 22.22 / corepack 0.34; npm registry reachable. `corepack use yarn@4` works. | none |
| E6 | Vitest ^3 with Vite 8 | `vitest@3.2.7` depends on `vite ^5\|^6\|^7` and installs a nested vite 7; `@vitejs/plugin-vue` 6 supports 5–8. Workable, but `vitest.config.ts` must not load `laravel-vite-plugin`, `@inertiajs/vite` or the Wayfinder plugin (the latter runs artisan). | Keep `vitest.config.ts` standalone (vue plugin + alias only). |
| E7 | Playwright | Local browsers are `/opt/pw-browsers/chromium-1194`. Playwright 1.56.1 bundles revision 1194 (verified); latest 1.64.1 would need a download through the proxy (likely blocked). | Pin `playwright`/`@playwright/test` `1.56.1` and export `PLAYWRIGHT_BROWSERS_PATH` (C3). |
| E8 | Postgres `furny_test` | PG 16.15 local, user/password `furny`/`furny` (roadmap). 16 §19/CI use password `secret`; `phpunit.xml` values non-forced, so the CI env overrides. `--parallel` needs `CREATEDB`. | Keep the non-forced env; grant `CREATEDB` to `furny` if `--parallel` is used locally. |
| E9 | `.env` / `APP_KEY` | No step creates them, so Feature tests fail without `APP_KEY`. | Add `cp .env.example .env && php artisan key:generate` (C12). |
| E10 | shadcn-vue registry | `yarn dlx shadcn-vue@latest` needs the shadcn-vue.com registry (may be blocked; the plan has a git-clone fallback). The kit uses style `new-york-v4` (Tailwind 4); spec says `new-york`. | Accept `new-york-v4` as the Tailwind 4 build of new-york (record in 19) rather than pulling v3-era sources. |
| E11 | No Docker | P1 never needs Gotenberg/MinIO/Mailpit locally; `compose.dev.yaml` is a file only (Task 40). The Task 6 concurrency test uses `php artisan tinker` subprocesses (feasible; they inherit the phpunit env). | none |
| E12 | Inertia SSR | Kit `config/inertia.php` has `ssr.enabled => true`. With `Http::preventStrayRequests()` any SSR gateway call fails a test. | Disable SSR (C1). |
| E13 | Fixture generation | `uv run --with pillow` works (PyPI reachable). Pillow cannot encode HEIC. | Craft `photo.heic` from an `ftypheic` header (C11). |
| E14 | Branching | Worktree already on `build/p1-foundation`; no local `develop`/`main`. | Skip Task 1's branch step (C12). P2 branches from P1 Task 1's commit SHA as its plan says. |

---

## (d) P2 Task 1 dependency check (P1 Task 1 Produces vs P2 needs)

| P2 needs | P1 Task 1 Produces | Finding |
|---|---|---|
| `package.json` `packageManager: yarn@4…`, Node engines | yes | OK |
| zod ^4, mutative ^2.0, clipper2-ts 2.0.1-18, earcut ^3.2, flatbush ^4.6, nanoid ^5 pre-installed (no lockfile change) | yes ("every runtime package of 01 §1.2") | OK |
| `@vitest/coverage-v8@^3` (P2 Task 51), `vitest bench` scripts (P2 Task 50) | not installed | **C13(c)**: install in P1 Task 1 |
| scripts `build`, `build:engine-cli`, `test`, `lint`, `format:check`, `typecheck` | yes | OK (P2 Task 48 "Modify scripts" becomes a no-op) |
| `tsconfig.json` strict + `@/*` alias, includes engine + engine-cli | yes (`engine-cli/**/*`) | OK; narrow to `engine-cli/src/**/*.ts`; add `noUncheckedIndexedAccess` **now** (C3) |
| `vitest.config.ts` (Node env for engine tests) | two projects (`engine` node, `ui` jsdom) | **C13(a)/C2**: P2 must extend project `engine`, not add root `include`; rename `ui` → `app` (happy-dom) |
| flat `eslint.config.js` that P2 extends with engine purity blocks; Prettier config | promised but "copied from kit", and the kit has none | **C1**: P1 authors them; P2's `lintRules.test.ts` (`new ESLint({cwd})`) then works |
| `yarn vue-tsc --noEmit` passes on the P1 Task 1 tree | needs Wayfinder output (git-ignored) + kit pages typed | **C13(b)**: the P2 worktree runs `composer install` + `php artisan wayfinder:generate --with-form` first, or P2 gates scope vue-tsc to the engine |
| `engine-cli/src/cli.ts` `dispatch` + `CliResponse`, Vite SSR build to `engine-cli/dist/cli.mjs` | yes (codes `unknown_command`, `invalid_json`) | OK, same contract as P2 Task 48 |
| `resources/js/engine/{index,version}.ts`, `ENGINE_VERSION = '1.0.0'` | yes | OK |
| lang files P2 Task 51 creates | P1 Task 3 creates empty ones | **C13(d)** |
