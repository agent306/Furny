# P1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deployable, CI-green Laravel 13 / Inertia 3 / Vue 3.5 skeleton of the product with the complete database schema (every table of `02`, with models, casts, relations, factories and seeders), typed settings, roles/permissions/policies, every authentication flow of `13`, upload intents, the i18n layer, the design-system foundation and layouts, real-time/queue/scheduler wiring, health checks and deployment files — so P2–P9 only add domain behaviour.

**Architecture:** The Laravel app lives at the repository root, scaffolded from `laravel/vue-starter-kit` (main). Business code sits in `app/Domain/{Identity,Projects,Imports,Furniture,Catalog,Orders,Messaging,Ai,Settings,Shared}` (`01 §4`), cross-cutting helpers in `app/Support`; controllers stay thin (policy → FormRequest → one Action). The frontend is Inertia pages on shadcn-vue + Tailwind v4 tokens with an ICU i18n layer and camelCase typed shared props; the TS engine (`resources/js/engine`) is only stubbed here for P2.

**Tech Stack:** PHP 8.4, Laravel ^13.38, Inertia ^3.5 (`@inertiajs/vue3` ^3.9), Fortify ^1.37, Wayfinder 0.1.23, Socialite, Horizon, Reverb, Pulse, spatie permission / medialibrary / activitylog / model-states / laravel-data / typescript-transformer, brick/money, libphonenumber; Vue 3.5, TypeScript 5.9, Vite 8, Tailwind 4.3, reka-ui (shadcn-vue), intl-messageformat, libphonenumber-js; Pest 5, Larastan 3 (level 8), Pint, Vitest 3, ESLint, Prettier, vue-tsc; PostgreSQL (16 locally, 18 in production), Redis 7; yarn 4 via corepack.

**Spec:** `docs/superpowers/specs/2026-10-20-furny-design.md` (master, all) + section files in `docs/superpowers/specs/2026-10-20-furny/`:
- `01-architecture.md` — all (§5 engine only as the P2 stub of Task 1).
- `02-data-model.md` — all (§14 item 6 `DemoSeeder` deferred to P4, see Decisions).
- `13-auth-security.md` — §1–§17, §19, §20 (§18 backups are operated per `17`).
- `15-ui-design-system.md` — §1–§16 except the order/editor/chart components owned by later milestones (`Stepper`, `ActionPanel`, `Timeline`, `MessageThread`, `MessageComposer`, `MessageBody`, `DiffList`, `Quote*`, `ProductionProgress`, `Thumbnail3D`, `CreditBadge`, charts, `DateInput`/`DateRangeInput`/`DateTimeInput`, `DataTable`/`FilterBar`/`Pagination`/`SearchInput`, `PrintHeader`).
- `17-deployment-ops.md` — §3, §5, §6, §10 (repository files), §14.
- `19-reconciliation-log.md` — §2 owner decisions, §8 registries (route registry §8.5 replaces the not-yet-written `14`; `16` is replaced by `17 §10.2` + `13 §20`).
- Partial: `10-customer-app.md` §1, §2 (auth/legal/onboarding/account rows), §3 (shared types used here), §4, §5, §13.1–§13.4, §13.7, §15; `11-admin-app.md` §1, §2 (staff/settings/account rows), §4, §7, §12.1–§12.4, §12.7, §18; `12-notifications.md` §2, §3.3 (auth/account/staff rows), §3.7 strings used here, §4.4 (`User` contract), §5.1 (`categories`), §8.3 (manifest), §8.4 (`unreadNotifications`); `08-bom-and-costing.md` §7 (catalog seed); `06-blueprint-import.md` §4.1 (`config/imports.php`), §4.2 (model); `09-order-workflow.md` §1 (states), §8 (production stages).

**Environment:** `docs/superpowers/plans/2026-10-20-furny-roadmap.md` § "Local environment notes" (PHP 8.4 at `/usr/local/bin/php`, Composer source installs + `composer-seed-dist`, yarn via corepack, Postgres `furny`/`furny_test` (user/password `furny`/`furny`), Redis, no Docker). Start services first: `service postgresql start && service redis-server start`.

## Global Constraints

- Versions: `php ^8.4`; `laravel/framework ^13.38`; `inertiajs/inertia-laravel ^3.5`; `@inertiajs/vue3 ^3.9`; `vue ^3.5.44`; `vite ^8.3`; `tailwindcss ^4.3`; `typescript ^5.9`; exact pins `laravel/wayfinder 0.1.23`, `three 0.186.1`, `@tresjs/core`/`@tresjs/cientos 5.9.3`, `clipper2-ts 2.0.1-18` (`01 §1`).
- Package manager: **yarn 4 via corepack** only; `package.json` has `"packageManager": "yarn@4.x.y"` and `"engines": {"node": ">=22.12 <23"}`; `.yarnrc.yml` `nodeLinker: node-modules`; `yarn.lock` committed; `package-lock.json` must not exist.
- PHP: `declare(strict_types=1);` in every file; final classes by default; PSR-12 via Pint (Laravel preset); PHPStan level 8 via Larastan.
- TS: `strict: true`, no `any` (use `unknown` + zod); Vue SFCs `<script setup lang="ts">`; component files PascalCase; composables `useXxx.ts`.
- Domain code under `app/Domain/{Area}/{Models,Actions,Data,Enums,Events,States,Jobs,Queries}`; cross-cutting code under `app/Support`. Actions are `final`, single-purpose, wrap multi-row writes in `DB::transaction`, dispatch domain events after commit; controllers: authorise → FormRequest → one Action → response.
- Lengths are integer millimetres; money is integer minor units in `*_minor` `bigint` columns; areas `bigint` mm².
- Primary keys are ULIDs (`char(26)`, `HasUlids`) for all domain tables; bigint only for framework/package tables listed in master §6.3. Timestamps `timestamptz` (`timestampsTz()`); app timezone `UTC`; users see `users.timezone` (default `business.timezone` = `Asia/Kolkata`).
- Database naming: snake_case plural tables, `*_id` FKs, `*_at` timestamptz, `*_on` dates, `is_*`/`has_*` booleans; enums are `string` columns backed by PHP backed enums (never PG enums); ON DELETE per `02` (C/R/N); Postgres does not auto-index FKs — add the indexes `02` lists.
- Wire format: Inertia props, JSON responses and request bodies are **camelCase** (exceptions: `features` flag keys, Laravel paginator `meta` keys, Fortify/`13` auth form field names); query strings snake_case.
- i18n: no user-visible literal strings in Vue templates or PHP notifications/flash; ICU messages in `resources/lang/en/{namespace}.php` (Laravel-format only for `validation`, `passwords`, `pagination`, `auth`); PHP renders with `trans_icu()`, Vue with `t()`; `php artisan i18n:export` output committed and CI-checked.
- Never hard-code the product name: `config('app.name')` / `usePage().props.app.name`.
- Routes: every route has exactly one name, method and path, names dot-separated with the prefixes of master §6.6; names/paths come from `19 §8.5` (spec `14` is not written yet). TS never hard-codes URLs (Wayfinder `@/routes/...` / `@/actions/...`).
- Service providers and config files never touch the database, Redis or HTTP while booting; config files contain no closures (`config:cache`/`php artisan optimize` safe).
- Tests: PHP = Pest 5 (`vendor/bin/pest`), TS = Vitest (`yarn vitest run`). DB tests use Postgres `furny_test` with `RefreshDatabase` (never SQLite). `Http::preventStrayRequests()` is global; S3, mail, notifications, queues are faked (`Storage::fake('s3')`, `Mail::fake()`, …).
- Security: only `MessageBody.vue` may use `v-html` (P7); PII in logs/audit is masked (`App\Support\Privacy\Mask`); no PII in URLs, cache keys, job names or channel names.
- Commits: conventional commits; every message ends with the trailer
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01X1MLnD93h3fkmdHrLPbw3u` (written below as **+ trailer**).
- Quality gates (referenced by every task's Step 5):
  - **Gates-PHP** = `vendor/bin/pint --test && vendor/bin/phpstan analyse --no-progress --memory-limit=1G && vendor/bin/pest tests/Unit tests/Feature`
  - **Gates-JS** = `yarn lint && yarn format:check && yarn typecheck && yarn vitest run`
  - **Gates-Gen** = `php artisan typescript:transform && php artisan i18n:export && git diff --exit-code -- resources/js/types/generated.d.ts resources/js/lang/generated` (from Task 3 on)

## Review Focus

1. **Identity normalisation** — emails with mixed case/whitespace (`"  Asha.K@Example.COM "`) and identities held by **soft-deleted** users (email/phone/Google id still "taken"). Tests: Task 4 (mutator), Task 25 (login + register), Task 30 (invitation), Task 28 (Google).
2. **Phone input variety** — `09876 543 210`, `+91-98765-43210`, `+91 98765 43210`, landline `+91 80 2222 3333`, foreign `+1 415 555 0100`, garbage `12ab`. Tests: Task 27 (`SendOtp` dataset) and Task 19 (`PhoneInput`).
3. **Hostile or mislabelled uploads** — PNG renamed `.jpg`, SVG declared as PNG, DWG renamed `.dxf`, 50 MP image, EXIF-rotated photo with GPS, names `../../etc/passwd`, RTL override, emoji, 300 chars. Tests: Task 32.
4. **JSON documents and settings surviving storage** — empty objects `{}` must not come back as `[]`, floats like `1.0` keep their type; stored settings groups missing a field added later still load with the default. Tests: Task 7 (`AsJsonDocument`), Task 6 (`Settings::get`).
5. **Concurrency / double submission** — two transactions allocating order numbers, a double-submitted OTP verify, a double-submitted invitation acceptance, settings cache served stale after an update. Tests: Task 6 (sequence + cache bust), Task 27 (verify), Task 30 (accept).

## Decisions taken in this plan (spec gaps / sequencing)

| # | Decision | Why |
|---|---|---|
| P1-D1 | `User` lives at `App\Domain\Identity\Models\User` (`01 §4`); the kit's `App\Models\User` is removed and `config/auth.php` points to the domain class. `NotificationDelivery` is also an Identity model (`01 §4`), although `12 §4.1` lists `app/Models/NotificationDelivery.php` — `01` is the architecture owner. | One domain layout. |
| P1-D2 | Morph map (enforced in `AppServiceProvider::boot`): `user, address, staff_invitation, upload_intent, notification_delivery, app_setting, business_profile, project, plan, plan_revision, blueprint_import, furniture_design, furniture_revision, furniture_preset, material, edge_band, hardware_item, finish, labour_rate, tax_rate, order, order_item, change_proposal, change_proposal_item, quote, quote_line, quote_negotiation, confirmation_call, production_update, order_issue, delivery, payment, message, ai_credit_ledger_entry, ai_usage_event`. | `02` uses "morph alias" (`upload_intents.target_type`) without listing aliases. |
| P1-D3 | `LengthInput` is built now on a **metric-only placeholder adapter** `resources/js/lib/lengthAdapter.ts`; **P4** replaces the adapter body with re-exports of the engine's `parseLength`/`formatLength` (`04 §1`) and adds imperial tests. | P1 runs in parallel with P2; settings pages need the component. |
| P1-D4 | Onboarding: P1 ships the gate, steps 1–2 (About you + terms, Units) and `customer.onboarding.store`/`.skip`; **P4** adds steps 3–4 (first project, `StartPlanChooser`) and the project/plan branches of `store` (they need `CreatePlan`, plan starters and the project/plan pages). | Target routes of steps 3–4 do not exist in P1. |
| P1-D5 | Transactional auth/account notifications (`auth.email_verification`, `auth.password_reset`, `staff.invited`, `account.welcome`, `account.deletion_scheduled`) are plain Laravel notifications in `app/Notifications/{Auth,Staff,Account}` rendering `trans_icu()` strings; **P8** moves them onto `EventNotification`. Keys for verification/reset mails are not in `12 §3.7`; P1 defines `notifications.auth.email_verification.{subject,title,body,action}` and `notifications.auth.password_reset.{subject,title,body,action}`. | Auth must work before P8. |
| P1-D6 | OTP delivery goes through `App\Domain\Identity\Otp\OtpDelivery` (drivers `log`, `array`); **P8** binds the real WhatsApp/SMS channels. The `log` driver writes the message text only when `app()->isLocal()` (developers need the code); elsewhere it logs masked phone + channel only, so `13 §20.6` ("code never in logs") holds in testing/staging/production. | Local usability vs. `13 §4.1`. |
| P1-D7 | `OrderState` + the 16 concrete state classes exist with names only; **P7** adds transitions. | Casts/factories need the classes. |
| P1-D8 | `RequestAccountDeletion` runs tagged `App\Domain\Identity\Contracts\AccountDeletionStep` services: P1 registers `DeleteNeverSubmittedDraftOrders`; **P6** adds import cancellation, **P7** adds T3 for submitted drafts (`13 §9.1` step 2). | Those actions belong to later domains. |
| P1-D9 | `DemoSeeder` (`02 §14` item 6) and the Noto Sans TTF files for jsPDF (`15 §2`) are deferred to **P4** (they need P2 fixtures / the PDF export). | Dependencies. |
| P1-D10 | Navigation data (`resources/js/lib/customerNav.ts`, `lib/adminNav.ts`, `AccountNav` items) lists only routes that exist; each later milestone appends its items. `Customer/Dashboard` and `Admin/Dashboard` are placeholder pages (replaced by P4/P7). | Wayfinder imports must resolve. |
| P1-D11 | Google re-authentication for passwordless users (`13 §6.4`) uses a fourth intent `reauthenticate` on `auth.google.redirect` (auth required; callback requires the Google id to equal the current user's, then sets `auth.password_confirmed_at`). | `13 §5.3` lists only `login|link|invitation`. |
| P1-D12 | Health cache values: `health:otp` = `{status: 'low_conversion', sent, verified, at}`; banner `messageKey` = `admin.health.{key}.{status}` (`health:whatsapp`/`health:sms` use the `status` field defined in `12 §7.6`). | `11 §4` names keys only. |
| P1-D13 | `JsonDocument::decode()` keeps empty JSON objects as `stdClass` so documents round-trip; controllers that accept documents (P4–P6) must decode raw bodies with it. | PHP `json_decode(assoc)` turns `{}` into `[]`, which the engine's zod records reject. |
| P1-D14 | Sentry packages are not installed (optional per `17 §13.5`); the owner adds them when a DSN exists. | Optional dependency. |
| P1-D15 | CI `deploy` job and helper scripts land in Task 40 guarded by repository variable `DEPLOY_ENABLED == 'true'`; the `vision` job is guarded by the presence of `vision/pyproject.toml` until P3. | Keeps CI green before Coolify/vision exist. |

## Task index

1. Repository scaffold, dependencies, tooling and CI (unblocks P2/P3)
2. Configuration foundation, feature flags, domain skeleton
3. i18n layer (`trans_icu`, `i18n:export`, `t()`)
4. Identity schema and models
5. Infrastructure and package tables (permissions, media, activity log, notifications, deliveries, push, upload intents, queues, pulse)
6. Settings service, settings seeder, number sequences
7. Projects and plans schema, `AsJsonDocument`
8. Catalog schema, catalog-version observer, tax and catalog seeders
9. Furniture and blueprint-import schema
10. Orders schema A (orders, items, change proposals) and order states
11. Orders schema B (quotes … payments, deferred FKs)
12. Messaging and AI schema; whole-schema checks
13. Roles, permissions, owner gates, dashboard gates, owner seeder
14. Policies A (projects, plans, furniture designs, imports)
15. Policies B (orders, quotes, change proposals, messages)
16. Design tokens, fonts, theme
17. shadcn-vue components and UI composables
18. Common and display components, formatting
19. Input components (Currency, Phone, Length placeholder, Percent, Address)
20. Shared Inertia props and frontend types
21. Layouts, app shell, public pages (welcome, error, legal, manifest), placeholder dashboards
22. HTTP hardening: security headers, CSP, cookies, proxies, log redaction, rate limiters
23. Auth middleware and route groups
24. Session registry, devices, recent authentication
25. Fortify login and registration, Turnstile
26. Password reset, email verification, profile and password updates, `ContactVerified`
27. Phone OTP core
28. Google OAuth
29. Phone OTP routes and pages, phone verification, re-authentication
30. Staff invitations and staff management
31. Two-factor authentication enforcement
32. Upload intents backend
33. Media serving and media components
34. Account pages (customer and staff)
35. Account deletion, anonymisation, data export
36. Customer onboarding (steps 1–2)
37. Admin settings pages (business, units, pricing, workflow, security)
38. Real-time wiring (Reverb, channels, Echo)
39. Queues, Horizon, scheduler, health endpoints
40. Deployment files, CI hardening, README

---

### Task 1: Repository scaffold, dependencies, tooling and CI

**Files:**
- Create (copied from the kit clone): `composer.json`, `package.json`, `artisan`, `app/**`, `bootstrap/**`, `config/**`, `database/**`, `public/**`, `resources/**`, `routes/**`, `vite.config.ts`, `tsconfig.json`, `eslint.config.js`, `.prettierrc`, `components.json`, `phpunit.xml`, `.editorconfig`, `.gitattributes`, `.gitignore`, `.env.example`
- Create: `.yarnrc.yml`, `yarn.lock`, `composer.lock`, `pint.json`, `phpstan.neon`, `vitest.config.ts`, `engine-cli/src/cli.ts`, `engine-cli/vite.config.ts`, `resources/js/engine/index.ts`, `resources/js/engine/version.ts`, `resources/js/types/generated.d.ts`, `.github/workflows/ci.yml`, `tests/Pest.php`, `tests/TestCase.php`
- Delete: `package-lock.json`; the kit's PHPUnit tests (`tests/Feature/**`, `tests/Unit/**`); kit settings area (`routes/settings.php`, `app/Http/Controllers/Settings/`, `resources/js/pages/settings/`, `resources/js/layouts/settings/`)
- Move: `resources/js/pages/auth/*` → `resources/js/pages/Auth/*` (update view names in `app/Providers/FortifyServiceProvider.php`)
- Test: `tests/Feature/HealthUpTest.php`, `tests/Unit/ArchTest.php`, `tests/Unit/ComposerPlatformTest.php`, `tests/Browser/SmokeTest.php`, `resources/js/__tests__/package-manager.test.ts`, `resources/js/engine/__tests__/version.test.ts`, `engine-cli/__tests__/cli.test.ts`

**Spec refs:** master §6.6, D2, D34; `01 §1.1`, `§1.2`, `§3`, `§5.1`, `§5.4`; `17 §3.1`, `§5.2` notes, `§10.2`; `19 §6` (input for 16); roadmap "Local environment notes"

**Interfaces:**
- Consumes: nothing.
- Produces (P2 and P3 start from these):
  - `package.json` scripts: `dev` (`vite`), `build` (`vite build && yarn build:engine-cli`), `build:engine-cli` (`vite build --config engine-cli/vite.config.ts`), `test` (`vitest run`), `lint` (`eslint . --max-warnings=0`), `format:check` (`prettier --check resources/ engine-cli/`), `typecheck` (`vue-tsc --noEmit`); every runtime/dev package of `01 §1.2` already installed (P2 must not need lockfile changes for `zod`, `mutative`, `clipper2-ts`, `earcut`, `flatbush`, `nanoid`).
  - `tsconfig.json` with `strict: true`, path alias `@/*` → `resources/js/*`, includes `resources/js/**/*`, `engine-cli/**/*`.
  - `vitest.config.ts` with two projects: `engine` (environment `node`; include `resources/js/engine/**/*.test.ts`, `engine-cli/**/*.test.ts`) and `ui` (environment `jsdom`; include `resources/js/**/*.test.ts`, exclude the engine globs); alias `@`.
  - `eslint.config.js` with `no-restricted-imports` for `resources/js/engine/**` (forbids `vue`, `three`, `@tresjs/*`, `@inertiajs/*`, `@/components/*`, `@/editor/*`), `vue/no-v-html: error` (override allowing `resources/js/components/orders/MessageBody.vue`), `vue/no-bare-strings-in-template: error` with allowlist `['×','—','·','/',':','%','+']`, and an exported `LEGACY_KIT_FILES` ignore array for kit files still present (emptied by Task 26).
  - `resources/js/engine/version.ts` (`export const ENGINE_VERSION = '1.0.0'`), `resources/js/engine/index.ts` (re-exports it) — owned by P2 from now on.
  - `engine-cli/src/cli.ts` exporting `run(command: string, input: unknown): CliResponse` where `CliResponse = { ok: true; result: unknown } | { ok: false; error: { code: string; message: string; details?: unknown } }`, plus a `main()` that reads stdin JSON, writes the response JSON, exits 0; built to `engine-cli/dist/cli.mjs` (Vite library mode, `ssr: true`, target `node22`, deps bundled; `engine-cli/dist` git-ignored). P2 adds the real commands.
  - CI workflow `.github/workflows/ci.yml` with jobs `php`, `frontend`, `vision`, `browser` (P3 removes the vision guard).

- [ ] **Step 1: Write the failing tests** (after cloning, before adapting the kit):
  - Preflight: `service postgresql start && service redis-server start`; ensure branch `develop` exists (`git branch --list develop` or create it from the current `main` HEAD), then `git checkout -b build/p1-foundation develop`.
  - Scaffold: `git clone --depth 1 https://github.com/laravel/vue-starter-kit /tmp/furny-kit && rsync -a --exclude .git --exclude README.md --exclude CHANGELOG.md --exclude LICENSE.md /tmp/furny-kit/ ./`; verify `git status --porcelain -- docs vision` prints nothing (existing `docs/` and `vision/tests/fixtures/` untouched).
  - `resources/js/__tests__/package-manager.test.ts` (reads files with `node:fs`):
    ```ts
    it('pins yarn 4 via corepack', () => { expect(pkg.packageManager).toMatch(/^yarn@4\.\d+\.\d+$/); expect(pkg.engines.node).toBe('>=22.12 <23'); expect(existsSync('package-lock.json')).toBe(false); expect(readFileSync('.yarnrc.yml','utf8')).toContain('nodeLinker: node-modules') })
    it('pins exact pre-1.0 packages', () => { expect(pkg.dependencies.three).toBe('0.186.1'); expect(pkg.dependencies['@tresjs/core']).toBe('5.9.3'); expect(pkg.dependencies['@tresjs/cientos']).toBe('5.9.3'); expect(pkg.dependencies['clipper2-ts']).toBe('2.0.1-18') })
    it('loads no fonts from third-party hosts', () => { for (const f of ['vite.config.ts','resources/views/app.blade.php','resources/css/app.css']) expect(readFileSync(f,'utf8')).not.toMatch(/bunny|fonts\.googleapis/) })
    ```
  - `resources/js/engine/__tests__/version.test.ts`: `expect(ENGINE_VERSION).toBe('1.0.0')`.
  - `engine-cli/__tests__/cli.test.ts`: `expect(run('version', {})).toEqual({ ok: true, result: { engineVersion: '1.0.0' } })`; `expect(run('nope', {})).toMatchObject({ ok: false, error: { code: 'unknown_command' } })`.
  - `tests/Unit/ComposerPlatformTest.php`: `require.php === '^8.4'`; `ext-*` keys exactly `['ext-bcmath','ext-exif','ext-fileinfo','ext-gd','ext-intl','ext-pcntl','ext-pdo_pgsql','ext-posix','ext-redis','ext-sodium','ext-zip']` (sorted); `require['laravel/wayfinder'] === '0.1.23'`; `extra.laravel.dont-discover` contains `laravel/telescope`.
  - `tests/Unit/ArchTest.php`: `arch('strict types')->expect('App')->toUseStrictTypes();` `arch('no debug calls')->expect(['dd','dump','ray','var_dump'])->not->toBeUsed();`
  - `tests/Feature/HealthUpTest.php`: `it('answers the framework health route', fn () => $this->get('/up')->assertOk());`
  - `tests/Browser/SmokeTest.php`: `it('renders the welcome page without JS errors', fn () => visit('/')->assertNoJavaScriptErrors());`
- [ ] **Step 2: Run, expect FAIL** — `yarn vitest run` fails (`package-lock.json` exists / no `packageManager` / bunny fonts present; engine files missing); `vendor/bin/pest` not yet installed.
- [ ] **Step 3: Implement**
  - Composer: `name` `furny/app`; `require.php ^8.4` + the 11 `ext-*` (value `*`); require every backend package of `01 §1.1` with its constraint (`resend/resend-php` = latest stable, pinned by the lock; Sentry not installed, P1-D14); dev: `pestphp/pest ^5.3`, `pestphp/pest-plugin-laravel`, `pestphp/pest-plugin-browser`, `larastan/larastan ^3.13`, `laravel/pint ^1.32`, `laravel/telescope ^5.26`, `laravel/boost ^2.10` (keep the kit's `laravel/pail`); remove `phpunit/phpunit` as a direct dev dependency if Pest provides it. `extra.laravel.dont-discover: ["laravel/telescope"]`. `composer install` (source installs; for packages without a source, e.g. `phpstan/phpstan`, run `composer-seed-dist <pkg> <tag> <dist-url from composer.lock>` and retry).
  - Yarn: `corepack enable && corepack use yarn@4`; write `.yarnrc.yml`; `engines`; delete `package-lock.json`; `yarn add` every runtime package of `01 §1.2` with its constraint (exact pins as listed; `@lucide/vue`, `@vueuse/core`, `vue-sonner`, `vue-tsc` "latest"), dev: `vitest@^3`, `@vue/test-utils`, `jsdom`, `culori@^4.0`, `@types/culori`, `concurrently`, `playwright`. Scripts as in Interfaces.
  - Remove the bunny font plugin/import from `vite.config.ts`, `resources/views/app.blade.php` and `resources/css/app.css` (fonts come from `@fontsource-variable/*` in Task 16).
  - Remove the kit settings area; move kit auth pages to `pages/Auth/` and update Fortify view names; keep the kit welcome/dashboard pages working (replaced later). Put every remaining kit Vue file into `LEGACY_KIT_FILES`.
  - `pint.json`: `{"preset":"laravel","rules":{"declare_strict_types":true}}`; run `vendor/bin/pint` once over the kit code. `phpstan.neon`: include `vendor/larastan/larastan/extension.neon`, `level: 8`, paths `app`, `config`, `database`, `routes`.
  - Pest: `tests/Pest.php` → `pest()->extend(Tests\TestCase::class)->use(Illuminate\Foundation\Testing\RefreshDatabase::class)->in('Feature', 'Browser'); beforeEach(fn () => Http::preventStrayRequests());`. `phpunit.xml` env (not forced): `APP_ENV=testing`, `DB_CONNECTION=pgsql`, `DB_HOST=127.0.0.1`, `DB_DATABASE=furny_test`, `DB_USERNAME=furny`, `DB_PASSWORD=furny`, `CACHE_STORE=array`, `SESSION_DRIVER=array`, `QUEUE_CONNECTION=sync`, `MAIL_MAILER=array`, `BROADCAST_CONNECTION=null`, `BCRYPT_ROUNDS=4`, `PULSE_ENABLED=false`, `TELESCOPE_ENABLED=false`.
  - spatie/laravel-typescript-transformer v3: configure per its README to collect `#[TypeScript]` classes and enums under `app/` and write `resources/js/types/generated.d.ts`; commit the (empty) generated file.
  - Engine stub + CLI per Interfaces; `.gitignore` adds `engine-cli/dist`.
  - `.github/workflows/ci.yml`: `17 §10.2` verbatim for jobs `php`, `frontend`, `vision`, `browser` (no `deploy` job, P1-D15) with these changes: (a) `frontend` runs `php artisan wayfinder:generate --with-form` before ESLint (vue-tsc needs the generated routes); (b) `vision` gets a first step `id: probe` writing `present=true|false` from `test -f vision/pyproject.toml`, and every later step has `if: steps.probe.outputs.present == 'true'`.
- [ ] **Step 4: Run tests, expect PASS** — `yarn vitest run`; `yarn build` then `echo '{}' | node engine-cli/dist/cli.mjs version | grep -q '"ok":true'`; `vendor/bin/pest tests/Unit tests/Feature`; `yarn playwright install chromium && vendor/bin/pest tests/Browser`.
- [ ] **Step 5: Quality gates** — Gates-PHP, Gates-JS; `php artisan typescript:transform && git diff --exit-code -- resources/js/types/generated.d.ts`.
- [ ] **Step 6: Commit** — `git add -A && git diff --cached --stat -- docs vision` (must be empty) → `git commit -m "chore(scaffold): bootstrap app from vue-starter-kit with yarn 4, Pest 5, Larastan 8, Vitest and CI"` + trailer.

### Task 2: Configuration foundation, feature flags, domain skeleton

**Files:**
- Create: `config/features.php`, `config/engine.php`, `config/imports.php`, `config/notification_events.php`, `app/Support/Features.php`, `app/Support/AppVersion.php`, `app/Domain/{Identity,Projects,Imports,Furniture,Catalog,Orders,Messaging,Ai,Settings,Shared}/{Models,Actions,Data,Enums,Events,States,Jobs,Queries}/.gitkeep`
- Modify: `.env.example`, `config/app.php`, `config/database.php`, `config/session.php`, `config/cache.php`, `config/queue.php`, `config/filesystems.php`, `config/mail.php`, `config/services.php`, `config/cors.php`, `bootstrap/app.php`, `app/Providers/AppServiceProvider.php`
- Test: `tests/Unit/Support/FeaturesTest.php`, `tests/Unit/Support/AppVersionTest.php`, `tests/Feature/Config/ConfigValuesTest.php`, `tests/Feature/Config/EnvExampleTest.php`, `tests/Feature/Config/BootWithoutServicesTest.php`, `tests/Feature/Config/MaintenanceModeTest.php`, `tests/Unit/ArchTest.php` (extend)

**Spec refs:** master §6.5, §6.7; `01 §2` (cross-cutting rule), `§3`, `§4`, `§5.4`, `§7` (queue connections); `06 §4.1` (`config/imports.php`); `12 §5.1` (categories); `13 §6.1`, `§12.5`; `17 §5.11` items 2, 3, 4, 6, 8, 9, 10, `§6.1`

**Interfaces:**
- Consumes: Task 1 skeleton.
- Produces: `App\Support\Features::enabled(string $flag): bool` and `Features::all(): array<string,bool>` (keys in this order: `payments, whatsapp, sms, web_push, google_login, dxf_import, walkthrough_camera, captcha`); `App\Support\AppVersion::resolve(?string $appVersion, ?string $sourceCommit): string`; config keys `app.version`, `app.supported_locales` (`['en']`), `engine.node_binary`, `imports.*` (exactly `06 §4.1`), `notification_events.categories` (exactly `12 §5.1`) and `notification_events.events` (`[]` until P8); Redis connections `default` (DB 0), `cache` (DB 1), `sessions` (DB `REDIS_SESSION_DB`, default 2); queue connections `redis` (retry_after 180) and `redis-long` (retry_after 720, queue `imports`); disks `s3` and `s3-public` (`17 §5.11` item 6).

- [ ] **Step 1: Write the failing tests**
  - `FeaturesTest`: defaults from `config/features.php` with no env → `payments=false, whatsapp=false, sms=false, web_push=true, google_login=false, dxf_import=true, walkthrough_camera=true`; `web_push` is `false` when `webpush.vapid.public_key` or `.private_key` is empty even if `FEATURE_WEB_PUSH=true`; `captcha` is `true` only when both `services.turnstile.site_key` and `.secret_key` are filled; `Features::all()` keys equal the 8 names in order.
  - `AppVersionTest`: `resolve(null, 'abcdef1234') === 'abcdef1'`; `resolve('1.4.0', 'abc') === '1.4.0'`; `resolve(null, null) === 'dev'`; `resolve('', 'abcdef1234') === 'abcdef1'`.
  - `ConfigValuesTest`: `config('app.timezone') === 'UTC'`; `config('app.supported_locales') === ['en']`; `config('queue.connections.redis.retry_after') === 180`; `config('queue.connections.redis-long.retry_after') === 720`; `config('queue.connections.redis-long.queue') === 'imports'`; `config('database.redis.sessions.database') == 2`; `config('filesystems.disks.s3.visibility') === 'private'`, `s3-public` `public`, both `throw === true`, `use_path_style_endpoint === true`, `region === 'auto'`; `config('engine.node_binary') === 'node'`; `config('imports.max_bytes.dxf') === 15 * 1024 * 1024`, `max_pdf_pages === 20`, `max_active_per_user === 2`, `vision.recognize_timeout_s === 600`, `retention.discard_ready_after_days === 60`; `array_keys(config('notification_events.categories')) === ['orders','changes','quotes','production','messages','imports_ai','staff']`; `config('cors.paths') === []`; a recursive walk of `config()->all()` finds no `Closure`.
  - `EnvExampleTest`: parses `.env.example`; asserts every variable name of `17 §6.1` is present (list them in the test as a constant) and local values: `SESSION_DRIVER=redis`, `SESSION_CONNECTION=sessions`, `SESSION_ENCRYPT=true`, `SESSION_COOKIE=furny_session`, `REDIS_CACHE_DB=1`, `REDIS_SESSION_DB=2`, `QUEUE_CONNECTION=redis`, `FEATURE_SMS=true`, `TURNSTILE_SITE_KEY=1x00000000000000000000AA`, `strlen(VISION_SERVICE_TOKEN) >= 32`, no `APP_TIMEZONE` key.
  - `BootWithoutServicesTest` (Review Focus 5): runs `php artisan optimize` then `php artisan route:list --json` via `Process` with env `DB_HOST=invalid.invalid REDIS_HOST=invalid.invalid` and `APP_CONFIG_CACHE`/`APP_ROUTES_CACHE`/`APP_EVENTS_CACHE` pointing into a temp dir; both exit 0.
  - `MaintenanceModeTest`: with maintenance active, `GET /up` → 200 and `GET /` → 503.
  - `ArchTest`: each of the 10 domain directories exists under `app/Domain`.
- [ ] **Step 2: Run, expect FAIL** — `vendor/bin/pest tests/Unit/Support tests/Feature/Config` (missing classes/config keys).
- [ ] **Step 3: Implement** — configs as listed (`config/app.php` `'version' => AppVersion::resolve(env('APP_VERSION'), env('SOURCE_COMMIT'))`, `'timezone' => 'UTC'`); `.env.example` = every `17 §6.1` variable with its Local value (secrets empty); `bootstrap/app.php`: `->withRouting(health: '/up', …)`, `$middleware->trustProxies(at: env('TRUSTED_PROXIES', '10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,127.0.0.1'), headers: X_FORWARDED_FOR|HOST|PORT|PROTO)`, `$middleware->preventRequestsDuringMaintenance(except: ['up', 'up/deep'])`; `AppServiceProvider::register()` registers `TelescopeServiceProvider` only when `class_exists(...) && config('telescope.enabled')`; `boot()` logs a warning when `mb_strlen(config('app.name')) > 20` (`12 §3.7`). `config/notification_events.php` returns `['categories' => [ …exactly 12 §5.1… ], 'events' => []]`.
- [ ] **Step 4: Run tests, expect PASS** — `vendor/bin/pest tests/Unit/Support tests/Feature/Config`
- [ ] **Step 5: Quality gates** — Gates-PHP.
- [ ] **Step 6: Commit** — `git add .env.example config app/Support/Features.php app/Support/AppVersion.php app/Domain bootstrap/app.php app/Providers/AppServiceProvider.php tests` → `feat(config): feature flags, queue/redis/session/storage config and domain skeleton` + trailer.

### Task 3: i18n layer (`trans_icu`, `i18n:export`, `t()`)

**Files:**
- Create: `app/Support/I18n/helpers.php`, `app/Console/Commands/ExportTranslations.php`, `resources/lang/en/{common,a11y,auth_ui,legal,onboarding,account,dashboard,projects,plans,imports,designs,orders,quotes,proposals,production,messages,notifications,settings,credits,help,uploads,units,money,phone,errors,states,changes,parts,hardware,plan_editor,engine,builder,admin,catalog,presets,templates,reports,audit,system,staff,customers,roles,ai,issues,calls,delivery,estimates,emails,pdf}.php`, `resources/lang/en/{auth,validation,passwords,pagination}.php`, `resources/js/lib/i18n.ts`, `resources/js/composables/useI18n.ts`, `resources/js/lang/generated/en.json`, `resources/js/lang/generated/manifest.json`, `vite/i18n-watch.ts`
- Modify: `composer.json` (`autoload.files`), `bootstrap/app.php` (lang path `resources/lang`), `vite.config.ts`, `resources/js/app.ts`, `.github/workflows/ci.yml` (php job step "Generated translations are current")
- Test: `tests/Unit/I18n/TransIcuTest.php`, `tests/Feature/I18n/ExportTranslationsTest.php`, `resources/js/lib/__tests__/i18n.test.ts`, `resources/js/__tests__/i18n-keys.test.ts`

**Spec refs:** master §6.6, D23; `15 §15.1–§15.5`; `12 §1` item 4; `19 §6`

**Interfaces:**
- Consumes: Task 2 `config('app.supported_locales')`.
- Produces: global PHP function `trans_icu(string $key, array $params = [], ?string $locale = null): string`; command `php artisan i18n:export`; TS `createI18n(options: { locale: string; messages: Record<string,string>; timeZone?: string; numberLocale?: string }): I18nPlugin`, `useI18n(): { t(key: string, params?: Record<string, unknown>): string; has(key: string): boolean; locale: Ref<string> }`, global `$t`; `resources/js/lang/generated/{locale}.json` (flat sorted dot keys) + `manifest.json` (`{ "en": "<sha1>" }`); the `i18n-keys` test's `ENUM_KEY_PATTERNS` map (pattern → generated TS type name), which later tasks extend.

- [ ] **Step 1: Write the failing tests**
  - `TransIcuTest`: with `common.photo_n` = `Photo {n}` and `common.counts.items` = `{count, plural, one {# item} other {# items}}`: `trans_icu('common.photo_n', ['n' => 3]) === 'Photo 3'`; `trans_icu('common.counts.items', ['count' => 1]) === '1 item'`; `['count' => 4]` → `'4 items'`; missing key returns the key and `Log::shouldReceive('warning')` once.
  - `ExportTranslationsTest`: after `artisan('i18n:export')->assertSuccessful()`: `en.json` contains `"common.photo_n": "Photo {n}"`; keys sorted; no key starts with `validation.`, `passwords.`, `pagination.`, `auth.`; `manifest.json` = `{"en": sha1_file(en.json)}`; a temporary namespace file `resources/lang/en/zz_test.php` with `'bad' => '{count, plural, one {#}'` makes the command fail with output containing `zz_test.bad` (file deleted in `afterEach`).
  - `i18n.test.ts`: `t('a.b', { name: 'Asha' })` → `'Hello Asha'`; plural `{count}` 1 → `'1 item'`, 2 → `'2 items'`; missing key returns the key; two calls with the same key construct `IntlMessageFormat` once (spy).
  - `i18n-keys.test.ts`: globs `resources/js/**/*.{vue,ts}` (excluding `lang/generated`, tests) for `t('…')`, `$t('…')`, `labelKey: '…'`, `titleKey: '…'` literals; each key exists in `en.json`. For each entry of `ENUM_KEY_PATTERNS` whose type exists in `types/generated.d.ts`, every union member's key exists (initial map from `15 §15.2`: `orders.states.{v}`/`OrderStateKey`, `projects.property_types.{v}`/`PropertyType`, `catalog.board_types.{v}`/`BoardType`, `catalog.hardware_categories.{v}`/`HardwareCategory`, `imports.statuses.{v}`/`ImportStatus`, `quotes.statuses.{v}`/`QuoteStatus`, `quotes.line_kinds.{v}`/`QuoteLineKind`, `orders.cancel_reasons.{v}`/`CancelReason`, `orders.call_outcomes.{v}`/`CallOutcome`).
- [ ] **Step 2: Run, expect FAIL** — `vendor/bin/pest tests/Unit/I18n tests/Feature/I18n && yarn vitest run resources/js/lib resources/js/__tests__/i18n-keys.test.ts`
- [ ] **Step 3: Implement** — helper per `15 §15.3` (`MessageFormatter::formatMessage($locale ?? app()->getLocale(), trans($key, [], $locale), $params)`; key missing when `trans()` returns the key); command validates each message with `MessageFormatter::create` (fail naming the key), flattens nested arrays, sorts, writes JSON with `JSON_PRETTY_PRINT|JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES`. Create every namespace file listed in `15 §15.2` (returning `[]` unless keys are needed now: `common.photo_n`, `common.counts.items`, `common.actions.{back,confirm,cancel,save_changes,discard,retry,close}`, `common.a11y.skip_to_content`). Publish Laravel lang files into `resources/lang/en`. Vite plugin `vite/i18n-watch.ts` runs `php artisan i18n:export` debounced 300 ms on `resources/lang/**/*.php` changes then sends a full reload. `app.ts` installs the plugin with messages from `import.meta.glob('./lang/generated/*.json')` for `page.props.i18n.locale` (fallback `en`; the stale-hash reload is added in Task 20). CI php job: step `php artisan i18n:export && git diff --exit-code -- resources/js/lang/generated`.
- [ ] **Step 4: Run tests, expect PASS** — same commands as Step 2.
- [ ] **Step 5: Quality gates** — Gates-PHP, Gates-JS, Gates-Gen.
- [ ] **Step 6: Commit** — `git add app/Support/I18n app/Console/Commands/ExportTranslations.php resources/lang resources/js/lib/i18n.ts resources/js/composables/useI18n.ts resources/js/lang vite composer.json composer.lock bootstrap/app.php vite.config.ts resources/js/app.ts .github/workflows/ci.yml tests resources/js/lib/__tests__ resources/js/__tests__` → `feat(i18n): ICU translation layer with trans_icu, i18n:export and t()` + trailer.

### Task 4: Identity schema and models

**Files:**
- Delete: kit migrations `database/migrations/0001_01_01_000000_create_users_table.php` and the kit's `*_add_two_factor_columns_to_users_table.php`; `app/Models/User.php`
- Create: `database/migrations/2026_10_20_010000_create_users_table.php`, `…_010100_create_addresses_table.php`, `…_010200_create_password_reset_tokens_table.php`, `…_010300_create_otp_codes_table.php`, `…_010400_create_notification_preferences_table.php`, `…_010500_create_staff_invitations_table.php`; `app/Domain/Identity/Models/{User,Address,OtpCode,NotificationPreference,StaffInvitation}.php`; `app/Domain/Identity/Enums/{UserType,UnitSystem,LengthUnit,OtpPurpose,OtpChannel,StaffRole}.php`; `app/Domain/Shared/Enums/NotificationChannel.php`; `database/factories/Domain/Identity/{UserFactory,AddressFactory,OtpCodeFactory,NotificationPreferenceFactory,StaffInvitationFactory}.php`
- Modify: `config/auth.php` (provider model), `config/fortify.php` references, every kit reference to `App\Models\User`
- Test: `tests/Feature/Schema/IdentitySchemaTest.php`, `tests/Feature/Models/UserTest.php`, `tests/Feature/Models/IdentityFactoriesTest.php`

**Spec refs:** `02 §0`, `§1.1–§1.5`, `§11`, `§15` group 1; master §6.1, §6.3, §6.5; `12 §4.4` (`HasLocalePreference`, `receivesBroadcastNotificationsOn`); `13 §2` (`MustVerifyEmail`, notifications), `§5.10` (Fortify 2FA columns)

**Interfaces:**
- Consumes: Task 2.
- Produces:
  - Migration filename scheme for all of P1: `database/migrations/2026_10_20_{GG}{NN}00_create_{table}_table.php`, where `GG` = `02 §15` group (01–10) and `NN` = position in the group (00, 01, …); FK-only migrations use `…_add_{what}_foreign_keys` / `…_add_current_revision_fk_to_{table}_table`.
  - `User` (final, `HasUlids`, `SoftDeletes`, `Notifiable`, `TwoFactorAuthenticatable`, implements `MustVerifyEmail`, `HasLocalePreference`): casts `type: UserType`, `unit_system: UnitSystem`, `length_unit: LengthUnit`, `is_active`/`marketing_opt_in: bool`, `*_at: immutable_datetime`, `password: hashed`; `email` set-mutator trims + lower-cases, empty string → `null`; methods `isStaff(): bool`, `isCustomer(): bool`, `hasVerifiedContact(): bool` (email or phone verified), `hasPassword(): bool`, `preferredLocale(): string`, `receivesBroadcastNotificationsOn(): string` (= `'users.'.$id`); relations `addresses()`. Relations to models created later are added by the task creating that model.
  - Enums: `UserType` (`customer`, `staff`), `UnitSystem` (`metric`, `imperial`), `LengthUnit` (`mm`, `cm`, `m`, `ftin`, `in`; method `allowedFor(UnitSystem): bool`), `OtpPurpose` (`login`, `verify_phone`), `OtpChannel` (`whatsapp`, `sms`), `StaffRole` (`owner`, `admin`, `estimator`, `production`, `support`), `NotificationChannel` (`database`, `mail`, `whatsapp`, `sms`, `webpush`); all `#[TypeScript]`.
  - `UserFactory` states: default customer (verified email, password `password`, onboarded, terms accepted), `staff()`, `unverified()`, `phoneOnly()` (no email/password, verified phone), `withPhone(?string $e164 = null)`, `passwordless()`, `inactive()`, `notOnboarded()`, `termsPending()`, `withTwoFactor()`, `pendingDeletion()` (soft-deleted), `anonymised()`; `StaffInvitationFactory` states `pending()` (default), `accepted()`, `revoked()`, `expired()`; `OtpCodeFactory` states `expired()`, `consumed()`, `withCode(string $code)`.

- [ ] **Step 1: Write the failing tests**
  - `IdentitySchemaTest`: exact column lists per table (`Schema::getColumnListing`) as in `02 §1.1–§1.5`; `users.id` type `character(26)`; inserting a user with `email` and `phone_e164` both null throws `QueryException` (CHECK); `pg_indexes` shows partial uniques `users(email) WHERE email IS NOT NULL`, `users(phone_e164) WHERE …`, `users(google_id) WHERE …`, index `(type, created_at)`, `staff_invitations(email) WHERE accepted_at IS NULL AND revoked_at IS NULL`, `staff_invitations(created_at)`, `otp_codes(phone_e164)`; unique `notification_preferences(user_id, event_key, channel)`; `otp_codes.ip` type `inet`, `attempts` `smallint` default 0; a soft-deleted user's email still blocks a second user with the same email (Review Focus 1).
  - `UserTest`: `User::factory()->create(['email' => '  Asha.K@Example.COM '])->email === 'asha.k@example.com'`; `email = ''` stores `null`; defaults on a minimal insert: `unit_system metric`, `length_unit mm`, `locale en`, `timezone Asia/Kolkata`, `is_active true`, `marketing_opt_in false`; `preferredLocale()` returns `users.locale`; `receivesBroadcastNotificationsOn()` returns `'users.'.$user->id`; `hasVerifiedContact()` true for phone-only verified, false for `unverified()` without phone; deleting a user cascades `addresses` and `notification_preferences` (C) and nulls `staff_invitations.invited_by` / `user_id` (N); `LengthUnit::Ftin->allowedFor(UnitSystem::Metric) === false`.
  - `IdentityFactoriesTest`: dataset over every listed state creates a valid row.
- [ ] **Step 2: Run, expect FAIL** — `vendor/bin/pest tests/Feature/Schema/IdentitySchemaTest.php tests/Feature/Models`
- [ ] **Step 3: Implement** — migrations exactly per `02 §1.1–§1.5` (partial uniques and the CHECK via `DB::statement`; FK behaviours C/R/N as stated); models with `$fillable`/`$casts`; factories under `Database\Factories\Domain\Identity` (models declare `newFactory()`); replace every kit `App\Models\User` reference.
- [ ] **Step 4: Run tests, expect PASS** — `vendor/bin/pest tests/Feature/Schema/IdentitySchemaTest.php tests/Feature/Models`
- [ ] **Step 5: Quality gates** — Gates-PHP, Gates-Gen.
- [ ] **Step 6: Commit** — `git add database/migrations app/Domain/Identity app/Domain/Shared/Enums database/factories config/auth.php config/fortify.php app tests resources/js/types/generated.d.ts` → `feat(identity): users, addresses, otp codes, preferences and staff invitations schema` + trailer.

### Task 5: Infrastructure and package tables

**Files:**
- Delete: kit `0001_01_01_000001_create_cache_table.php`, `0001_01_01_000002_create_jobs_table.php`
- Create: migrations `2026_10_20_020000_create_permission_tables`, `_020100_create_media_table`, `_020200_create_activity_log_table`, `_020300_create_notifications_table`, `_020400_create_notification_deliveries_table`, `_020500_create_push_subscriptions_table`, `_020600_create_upload_intents_table`, `_020700_create_jobs_table`, `_020800_create_job_batches_table`, `_020900_create_failed_jobs_table`, `_021000_create_cache_table`, `_021100_create_sessions_table`, `_021200_create_pulse_tables`, `_021300_create_telescope_entries_table`; `config/permission.php`, `config/media-library.php`, `config/activitylog.php`, `config/webpush.php`, `config/pulse.php`, `config/telescope.php`; `app/Domain/Identity/Models/NotificationDelivery.php`; `app/Domain/Identity/Enums/{DeliveryDriver,DeliveryStatus}.php`; `app/Domain/Shared/Models/UploadIntent.php`; `app/Domain/Shared/Enums/{UploadPurpose,UploadStatus}.php`; `app/Support/Media/Media.php`; `app/Support/MorphMap.php`; factories `NotificationDeliveryFactory`, `UploadIntentFactory`
- Modify: `app/Domain/Identity/Models/User.php` (`HasPushSubscriptions`, `InteractsWithMedia` + `avatar` collection, relations `notificationDeliveries()`, `uploadIntents()`), `app/Providers/AppServiceProvider.php` (`Relation::enforceMorphMap(MorphMap::MAP)`)
- Test: `tests/Feature/Schema/InfrastructureSchemaTest.php`, `tests/Feature/Models/UploadIntentTest.php`, `tests/Feature/Models/MorphMapTest.php`, `tests/Feature/Models/ActivityLogUlidTest.php`

**Spec refs:** `02 §1.6`, `§1.7`, `§1.8`, `§10` (User avatar), `§15` group 2; `13 §11.1` (purposes), `§16` item 8 (activity log 1095 days); `17 §6.1` (`MEDIA_DISK`, `MEDIA_QUEUE`, `QUEUE_CONVERSIONS_BY_DEFAULT`, `IMAGE_DRIVER`, `PULSE_*`); P1-D2

**Interfaces:**
- Consumes: Task 4 `User`.
- Produces: `App\Support\MorphMap::MAP` (`array<string, class-string<Model>>`; every later model task appends its aliases from P1-D2); `UploadPurpose` with exactly 14 cases (`blueprint_source, message_attachment, production_photo, issue_photo, delivery_photo, avatar, business_logo, material_texture, finish_texture, hardware_image, plan_thumbnail, project_cover, furniture_thumbnail, preset_thumbnail`, `#[TypeScript]`); `UploadStatus` (`pending, uploaded, ready, rejected, consumed, expired`); `UploadIntent` (casts purpose/status enums, `expires_at`/`consumed_at` immutable; `user()`, `target(): MorphTo` via `target_type`/`target_id`); `NotificationDelivery` (casts `channel: NotificationChannel`, `driver: DeliveryDriver` (`meta, twilio, msg91, log, array`), `status: DeliveryStatus` (`pending, accepted, sent, delivered, read, failed`), `context: array`, `billable: bool`); `App\Support\Media\Media` (medialibrary media model; `model_id` accessor `rtrim`s `char(26)` padding); `User` `avatar` collection (disk `s3-public`, single file, jpg/png/webp, conversion `thumb` 128×128).

- [ ] **Step 1: Write the failing tests**
  - `InfrastructureSchemaTest`: `model_has_roles.model_id` and `model_has_permissions.model_id` are `character(26)`; `media.model_id` `character(26)`, `media.model_type` varchar; `activity_log.subject_id`/`causer_id` `character(26)` nullable; `notifications.id` `uuid`, `notifiable_id` `character(26)`, indexes `(notifiable_id, read_at)` and `(notifiable_id, created_at)`; `notification_deliveries` columns per `02 §1.7`, partial unique `(driver, provider_message_id) WHERE provider_message_id IS NOT NULL`, indexes `(user_id, channel, created_at)`, `(to_hash, channel, created_at)`, `(event_key, created_at)`, `(status, created_at)`, `fallback_of_id` self-FK N; `push_subscriptions.subscribable_id` `character(26)`; `upload_intents` columns per `02 §1.6`, default `status = 'pending'`, indexes `(user_id, created_at)`, `(status, created_at)`; `sessions.user_id` `character(26)`; tables `jobs`, `job_batches`, `failed_jobs`, `cache`, `cache_locks`, `pulse_values`, `pulse_entries`, `pulse_aggregates`, `telescope_entries` exist.
  - `UploadIntentTest`: `count(UploadPurpose::cases()) === 14` and values equal the list above; factory states `pending()`, `uploaded()`, `ready()`, `rejected(string $reason)`, `consumed()`, `expired()`; `target` morphs to a `User` via alias `user`.
  - `MorphMapTest`: every value of `MorphMap::MAP` is an existing class; every concrete `Model` class under `app/Domain/*/Models` appears in the map (this test keeps later tasks honest); `(new User)->getMorphClass() === 'user'`.
  - `ActivityLogUlidTest`: `activity('security')->performedOn($u)->causedBy($u)->event('auth.login')->log('auth.login')` stores `subject_id === $u->id` (26 chars); `config('activitylog.delete_records_older_than_days') === 1095`.
- [ ] **Step 2: Run, expect FAIL** — `vendor/bin/pest tests/Feature/Schema/InfrastructureSchemaTest.php tests/Feature/Models`
- [ ] **Step 3: Implement** — publish each package's migration/config and edit to ULID morphs (`ulidMorphs`/`nullableUlidMorphs`, `$table->ulid('model_id')` with `permission.column_names.model_morph_key = 'model_id'`); medialibrary config: `disk_name` = `env('MEDIA_DISK','s3')`, `queue_name` = `env('MEDIA_QUEUE','default')`, `queue_conversions_by_default` = `env('QUEUE_CONVERSIONS_BY_DEFAULT', true)`, `media_model` = `App\Support\Media\Media`, image driver `env('IMAGE_DRIVER','gd')`; Pulse `ingest.driver` from `PULSE_INGEST_DRIVER`, Pulse::user resolver deferred to Task 22; `MorphMap::MAP` with `user`, `address`, `staff_invitation`, `upload_intent`, `notification_delivery`.
- [ ] **Step 4: Run tests, expect PASS** — same as Step 2.
- [ ] **Step 5: Quality gates** — Gates-PHP, Gates-Gen.
- [ ] **Step 6: Commit** — `git add database/migrations config app/Domain app/Support/Media app/Support/MorphMap.php app/Providers/AppServiceProvider.php database/factories tests resources/js/types/generated.d.ts` → `feat(schema): package tables with ULID morphs, upload intents and notification deliveries` + trailer.

### Task 6: Settings service, settings seeder, number sequences

**Files:**
- Create: migrations `2026_10_20_030000_create_app_settings_table`, `_030100_create_number_sequences_table`; `app/Domain/Settings/Models/{AppSetting,BusinessProfile}.php`; `app/Support/Settings/{Settings,SettingsGroup,CatalogVersion}.php`; `app/Support/Settings/Groups/{SettingsData,BusinessSettings,UnitsSettings,PricingSettings,WorkflowSettings,AiSettings,NotificationsSettings,AuthSettings}.php` (+ nested Data: `ProductionStageData`, `QuietHoursData`, `AiPriceRowData`, `WhatsAppTemplateData`, `SmsTemplateData`); `app/Support/Settings/Attributes/Encrypted.php`; `app/Support/Settings/Casts/EncryptedStringCast.php`; `app/Support/Numbers/{NumberSequence,OrderNumber,QuoteNumber}.php`; `database/seeders/SettingsSeeder.php`; `resources/lang/en/quotes.php` (`default_terms`), `resources/lang/en/production.php` (`stages.*`)
- Modify: `app/Support/MorphMap.php` (`app_setting`, `business_profile`)
- Test: `tests/Feature/Settings/SettingsTest.php`, `tests/Unit/Settings/EncryptedStringCastTest.php`, `tests/Feature/Settings/SettingsSeederTest.php`, `tests/Feature/Numbers/NumberSequenceTest.php`, `tests/Feature/Numbers/NumberSequenceConcurrencyTest.php`

**Spec refs:** `02 §2.1`, `§2.2`, `§10` (BusinessProfile logo), `§13` (every group, field, default), `§14` item 2; master §6.3 (order/quote numbers), §6.4; `09 §8` (stages); `11 §12` (camelCase field names); `13 §15` (`#[Encrypted]`); `12 §3.7` (`sms_templates` text keys)

**Interfaces:**
- Consumes: Tasks 4–5.
- Produces:
  - `SettingsGroup` enum (`business, units, pricing, workflow, ai, notifications, auth`) with `dataClass(): class-string<SettingsData>` and `isRestricted(): bool` (`ai`, `auth`).
  - `SettingsData` (abstract spatie Data, `#[MapName(SnakeCaseMapper::class)]`): `static defaults(): static`, `toStorage(): array` (snake_case keys, encrypts `#[Encrypted]` props), `toWire(): array` (camelCase keys via a transformation context without property-name mapping; empty maps rendered as JSON objects).
  - `Settings` (container singleton): `get(SettingsGroup $group): SettingsData` (cache key `settings:{group}`, merges stored fields over defaults), `put(SettingsGroup $group, SettingsData $data, ?User $by): void` (upsert + `updated_by`, cache bust after commit), `catalogVersion(): int`, `seedReviewed(): bool`, `markSeedReviewed(): void`; typed shortcuts `business(): BusinessSettings`, `units()`, `pricing()`, `workflow()`, `ai()`, `notifications()`, `auth()`.
  - `CatalogVersion::bump(): int` (atomic increment of `app_settings['catalog.version']` on the current connection/transaction, cache bust after commit).
  - `BusinessProfile::instance(): BusinessProfile` — Eloquent model on table `app_settings` with string key `key`, the row `business`; implements `HasMedia`, collection `logo` (disk `s3-public`, single, png/webp/jpg).
  - `NumberSequence::next(string $key): int`; `OrderNumber::next(?CarbonInterface $at = null): string` (`ORD-{YYYY}-{00001}`, year in `business.timezone`); `OrderNumber::draft(string $ulid): string` (`DRAFT-` + last 8 chars); `QuoteNumber::for(string $orderNumber, int $version): string` (`{orderNumber}-Q{version}`).
  - `SettingsSeeder` (inserts missing keys and missing fields only).

- [ ] **Step 1: Write the failing tests**
  - `SettingsTest` — defaults without rows (exact `02 §13` values): business `currency 'INR'`, `locale 'en-IN'`, `timezone 'Asia/Kolkata'`, `working_hours 'Mon–Sat 10:00–19:00'`, `name === config('app.name')`; units `default_system 'metric'`, `default_length_unit 'mm'`, `2700/230/115/900/2100/1200/1200/900`; pricing `prices_include_tax false`, `margin_bps 3500`, `overhead_bps 1000`, `minimum_order_minor 0`, `rounding_minor 100`, `estimate_disclaimer_key 'estimates.disclaimer'`, `installation_bps 800`, `delivery_flat_minor 0`, `kerf_mm 4.0`, `sheet_trim_mm 10`, `nesting_allow_rotation_default true`, `sheet_billing_mode 'used_area'`, `edge_premill_mm 0`; workflow `15/14/48`, `require_completion_photos 1`, `allow_customer_counter_offer true`, `max_negotiation_rounds 5`, `min_preferred_delivery_days 7`, `production_stages` keys/progress `material_procurement 10, cutting 25, edge_banding 40, drilling 50, finishing 65, assembly 80, quality_check 90, packing 95` with `label_key 'production.stages.{key}'`, `label null`; ai `provider 'anthropic'`, `model 'claude-opus-5-5'`, `effort 'high'`, `agentic_crops true`, `fallback_to_none_on_error true`, `signup_credits 3`, `monthly_credits 3`, `credits_per_recognition 1`, `credits_per_recognition_none 0`, `max_recognitions_per_day 5`, `global_monthly_budget_usd '50.00'`, `budget_exhausted_behavior 'fallback_none'`, `staff_unlimited true`, `price_table` = anthropic `claude-opus-5-5` 4.00/20.00, `claude-sonnet-5-5` 2.00/10.00, `claude-haiku-5-5` 0.10/0.50; notifications `whatsapp_templates {}`, `sms_driver 'log'`, `otp_channel_order ['whatsapp','sms']`, `staff_digest_hour 9`, `quiet_hours {enabled: true, start: '21:00', end: '08:00'}`; auth `allow_customer_registration true`, `otp_global_hourly_cap 200`, `staff_session_absolute_hours 12`; `catalogVersion() === 1`, `seedReviewed() === false`.
  - `SettingsTest` — a stored `pricing` row lacking `edge_premill_mm` returns `0` for it (Review Focus 4); after `get(Pricing)` warms the cache, `put()` with `margin_bps 4000` makes the next `get()` return 4000 (Review Focus 5); `PricingSettings::defaults()->toWire()` has key `marginBps` and `toStorage()` has `margin_bps`; `NotificationsSettings::defaults()->toWire()['whatsappTemplates']` JSON-encodes as `{}`; `put()` stores `updated_by`.
  - `SettingsTest` — `CatalogVersion::bump()` returns 2 then 3; inside `DB::transaction` that throws, the version is unchanged afterwards; `BusinessProfile::instance()->getKey() === 'business'` and `getMorphClass() === 'business_profile'`.
  - `EncryptedStringCastTest`: a test-only Data class with `#[Encrypted] public ?string $apiKey` → `toStorage()['api_key'] !== 'secret'` and `from(storage)->apiKey === 'secret'`.
  - `SettingsSeederTest`: after seeding, 9 rows with keys `business, units, pricing, workflow, ai, notifications, auth, catalog.version, catalog.seed_reviewed`; `auth.otp_allowed_country_codes === ['IN']`; `notifications.sms_templates` has the 12 keys of `02 §13` with `text_key 'notifications.{key}.customer.sms'` (and `'notifications.auth.otp.sms'` for `auth.otp`), ids null; `business.quote_terms === trans_icu('quotes.default_terms')`; `pricing.default_tax_rate_id === null` (filled by Task 8); re-running keeps a manually changed `business.name` and restores a deleted field.
  - `NumberSequenceTest`: `next('order:2026')` → 1 then 2; `OrderNumber::next(CarbonImmutable::parse('2026-03-01 10:00', 'UTC')) === 'ORD-2026-00001'`; `OrderNumber::next(CarbonImmutable::parse('2026-12-31 19:00', 'UTC'))` (01:00/00:30 IST next day) `=== 'ORD-2027-00001'`; `OrderNumber::draft(str_repeat('0', 18).'ABCDEFGH') === 'DRAFT-ABCDEFGH'`; `QuoteNumber::for('ORD-2026-00042', 3) === 'ORD-2026-00042-Q3'`.
  - `NumberSequenceConcurrencyTest` (Review Focus 5, group `concurrency`): `Process::pool` of 4 `php artisan tinker --execute` processes (env `APP_ENV=testing`) each calling `NumberSequence::next($key)` 25 times for a fresh key `test:{ulid}`; the 100 printed numbers are unique and their max is 100.
- [ ] **Step 2: Run, expect FAIL** — `vendor/bin/pest tests/Feature/Settings tests/Unit/Settings tests/Feature/Numbers`
- [ ] **Step 3: Implement** — `NumberSequence::next` inside `DB::transaction`: `INSERT … ON CONFLICT (key) DO NOTHING`, then `SELECT last_value … FOR UPDATE`, update `+1`, return. `quotes.default_terms` = "This quote is valid until the date shown. Final dimensions are confirmed during our confirmation call. Delivery dates are estimates until production starts." (owner edits).
- [ ] **Step 4: Run tests, expect PASS** — same as Step 2.
- [ ] **Step 5: Quality gates** — Gates-PHP, Gates-Gen.
- [ ] **Step 6: Commit** — `git add database/migrations app/Domain/Settings app/Support/Settings app/Support/Numbers database/seeders/SettingsSeeder.php resources/lang app/Support/MorphMap.php tests resources/js` → `feat(settings): typed settings groups with cache, seeder and number sequences` + trailer.

### Task 7: Projects and plans schema, `AsJsonDocument`

**Files:**
- Create: migrations `2026_10_20_040000_create_projects_table`, `_040100_create_plans_table`, `_040200_create_plan_revisions_table`, `_040300_add_current_revision_fk_to_plans_table`; `app/Domain/Projects/Models/{Project,Plan,PlanRevision}.php`; `app/Domain/Projects/Enums/{PropertyType,ProjectStatus,PlanSource,PlanRevisionReason}.php`; `app/Support/Json/JsonDocument.php`; `app/Support/Casts/AsJsonDocument.php`; `database/factories/Support/Documents.php`; factories `ProjectFactory`, `PlanFactory`, `PlanRevisionFactory`
- Modify: `User` (`projects()`), `MorphMap` (`project`, `plan`, `plan_revision`)
- Test: `tests/Feature/Schema/ProjectsSchemaTest.php`, `tests/Unit/Support/JsonDocumentTest.php`, `tests/Feature/Models/PlanTest.php`

**Spec refs:** `02 §3`, `§10` (Project cover, Plan thumbnail), `§11`, `§12`, `§15` group 4; `03 §1` (PlanDocument top-level shape), `§5`; P1-D13

**Interfaces:**
- Consumes: Tasks 4–6.
- Produces: `JsonDocument::decode(string $json): array` (assoc arrays, but every empty JSON object becomes `new \stdClass()`; throws `JsonException`), `JsonDocument::encode(array $doc): string` (`JSON_PRESERVE_ZERO_FRACTION | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR`); cast `AsJsonDocument` (get = decode, set accepts array or JSON string); models `Project` (SoftDeletes; `owner()`, `createdBy()`, `plans()`, `siteAddress()`; media `cover` on `s3-public`), `Plan` (SoftDeletes; `project()`, `revisions()`, `currentRevision()`, `lockedBy()`, `isLocked(): bool`; media `thumbnail` on `s3` with conversion `small` 320w), `PlanRevision` (`const UPDATED_AT = null`; updating throws `LogicException`); enums `PropertyType` (`apartment, independent_house, villa, office, other`), `ProjectStatus` (`active, archived`), `PlanSource` (`drawn, imported, traced, duplicated`), `PlanRevisionReason` (`manual_checkpoint, import_accepted, before_restore, staff_edit, auto_daily`); `Documents::emptyPlan(array $metaOverrides = []): array` (schemaVersion 1, meta `{defaultWallHeight: 2700, defaultWallThickness: 115, floorThickness: 150, northAngle: null, createdWith: 'editor'}`, empty-object records `nodes, walls, openings, rooms, placements, fixtures`, `annotations {dimensions: {}, labels: {}}`, `background: null`, `view {mode2d: null, mode3d: null, lastMode: '2d'}`). Factory states: `Project::archived()`, `Plan::locked()`, `Plan::imported()`, `Plan::traced()`, `PlanRevision::reason(PlanRevisionReason)`.

- [ ] **Step 1: Write the failing tests**
  - `JsonDocumentTest` (Review Focus 4): `JsonDocument::encode(JsonDocument::decode('{"nodes":{},"walls":{},"angle":90.0,"list":[],"n":{"a":{}}}')) === '{"nodes":{},"walls":{},"angle":90.0,"list":[],"n":{"a":{}}}'`; invalid JSON throws `JsonException`.
  - `PlanTest`: a plan saved with `Documents::emptyPlan()` and reloaded keeps `{}` records (`JsonDocument::encode($plan->fresh()->working_document)` contains `"nodes":{}`); `working_version` default 1, `schema_version` 1, `summary` default `{}` decoded to `[]` array; `PlanRevision::factory()->create()->update(['label' => 'x'])` throws `LogicException`; unique `(plan_id, number)` enforced; `isLocked()` true for `locked()`; deleting a project cascades plans and revisions; deleting the owner user with projects throws (R); deleting the `current_revision` nulls `plans.current_revision_id`.
  - `ProjectsSchemaTest`: columns per `02 §3.1–§3.3`; `plan_revisions` has no `updated_at`; indexes `projects(owner_id, status, updated_at)`, `plans(project_id, level_index)`; defaults `property_type 'apartment'`, `status 'active'`, `plans.name 'Ground floor'`.
- [ ] **Step 2: Run, expect FAIL** — `vendor/bin/pest tests/Unit/Support/JsonDocumentTest.php tests/Feature/Schema/ProjectsSchemaTest.php tests/Feature/Models/PlanTest.php`
- [ ] **Step 3: Implement** — decode walks the result of `json_decode($json, false, 512, JSON_THROW_ON_ERROR)` converting `stdClass` with properties → array (recursively) and keeping empty `stdClass` instances.
- [ ] **Step 4: Run tests, expect PASS** — same as Step 2.
- [ ] **Step 5: Quality gates** — Gates-PHP, Gates-Gen.
- [ ] **Step 6: Commit** — `git add database/migrations app/Domain/Projects app/Support/Json app/Support/Casts database/factories app/Domain/Identity/Models/User.php app/Support/MorphMap.php tests resources/js` → `feat(projects): projects, plans and revisions schema with JSON document cast` + trailer.

### Task 8: Catalog schema, catalog-version observer, tax and catalog seeders

**Files:**
- Create: migrations `2026_10_20_050000_create_materials_table` … `_050500_create_tax_rates_table` (`materials, edge_bands, hardware_items, finishes, labour_rates, tax_rates`); `app/Domain/Catalog/Models/{Material,EdgeBand,HardwareItem,Finish,LabourRate,TaxRate}.php`; `app/Domain/Catalog/Enums/{BoardType,MaterialSurface,HardwareCategory,HardwareUnit,FinishType,LabourUnit}.php`; `app/Domain/Catalog/Observers/BumpCatalogVersion.php`; factories for the six models; `database/seeders/{TaxRatesSeeder,CatalogSeeder}.php`; `database/seeders/data/catalog.php`
- Modify: `MorphMap`
- Test: `tests/Feature/Schema/CatalogSchemaTest.php`, `tests/Feature/Catalog/CatalogVersionBumpTest.php`, `tests/Feature/Seeders/TaxRatesSeederTest.php`, `tests/Feature/Seeders/CatalogSeederTest.php`

**Spec refs:** `02 §6` (all tables + bump rule), `§10` (texture/image collections), `§14` items 3–4; `01 §5.3`; `08 §7.1–§7.6`

**Interfaces:**
- Consumes: Task 6 `CatalogVersion`, `Settings`.
- Produces: six models (SoftDeletes on materials, edge bands, hardware, finishes); casts `usage/specs/is_default_for/applies_to: array`, `thickness_mm` decimal strings, enums; media `Material.texture`/`Finish.texture` (`s3-public`, jpg/webp, conversion `small` 256²), `HardwareItem.image` (`s3-public`, `thumb` 256²); observer `BumpCatalogVersion` attached to all six (`saved`, `deleted`, `restored`, `forceDeleted`) with static `BumpCatalogVersion::muted(callable $fn): mixed`; enums `BoardType` (9 values of `02 §6.1`), `MaterialSurface` (7), `HardwareCategory` (21), `HardwareUnit` (`piece, pair, set, meter, pack`), `FinishType` (8), `LabourUnit` (`sheet, meter, part, piece, item, sqm, hour`); seeders `TaxRatesSeeder`, `CatalogSeeder` (overwrite only when env `FORCE_CATALOG_SEED=true`).

- [ ] **Step 1: Write the failing tests**
  - `CatalogSchemaTest`: columns per `02 §6.1–§6.6`; unique `code` on materials/edge bands/hardware/finishes, unique `key` on labour rates; partial unique `tax_rates(is_default) WHERE is_default`; defaults `waste_factor 0.100`, `surface 'melamine'`, `usage '["carcass","shelf","front","back","top"]'`, `is_default_for '[]'`.
  - `CatalogVersionBumpTest`: dataset over the six factories — creating, updating, soft-deleting and restoring each bumps `Settings::catalogVersion()` by exactly 1 per write; a create inside a rolled-back transaction leaves the version unchanged.
  - `TaxRatesSeederTest`: rows `GST 18%` 1800 default, `GST 12%` 1200, `GST 5%` 500, `No tax 0%` 0; idempotent; sets `pricing.default_tax_rate_id` to the GST 18% id when null and leaves a non-null value alone.
  - `CatalogSeederTest`: counts 12 materials, 8 edge bands, 40 hardware items, 6 finishes, 14 labour rates; spot values: `PB18-OAK` (`has_grain true`, `price_per_sheet_minor 265000`, `waste_factor '0.120'`, `default_edge_band_code 'EB08-OAK'`, `sort_order 20`), `GLASS5-CLEAR` (`board_type 'glass'`, `sheet_width_mm 1830`, `usage ['glass']`), `EB10-WHITE-28` (`thickness_mm '1.00'`, `width_mm 28`, `price_per_meter_minor 1000`), `HNG-FO-SC` (`price_minor 12000`, `specs.overlay 'full'`, `is_default_for ['hinge.full_overlay']`), `SLD-BB-600` (`unit 'pair'`, `price_minor 65000`, `specs.lengthMm 600`), `SLD-UM-450` (`is_default_for ['slide.undermount']`), `LED-STRIP-12V` (`unit 'meter'`), `FIN-PU-GLOSS` (`price_per_sqm_minor 160000`, `applies_to ['mdf']`), `installation_per_item` (`rate_minor 150000`, `unit 'item'`); hardware `sort_order` = row × 10 (first 10, last 400); every `is_default_for` key occurs once across hardware; second run keeps counts, keeps an edited price, bumps `catalog.version` exactly once per run.
- [ ] **Step 2: Run, expect FAIL** — `vendor/bin/pest tests/Feature/Schema/CatalogSchemaTest.php tests/Feature/Catalog tests/Feature/Seeders`
- [ ] **Step 3: Implement** — rows transcribed from `08 §7.1–§7.5` into `database/seeders/data/catalog.php` (rupees × 100 into `*_minor`); `CatalogSeeder` writes inside `BumpCatalogVersion::muted()` then calls `CatalogVersion::bump()` once and prints the console warning "Review the starter catalog prices".
- [ ] **Step 4: Run tests, expect PASS** — same as Step 2.
- [ ] **Step 5: Quality gates** — Gates-PHP, Gates-Gen.
- [ ] **Step 6: Commit** — `git add database/migrations app/Domain/Catalog database/factories database/seeders app/Support/MorphMap.php tests resources/js` → `feat(catalog): catalog schema, version bump observer and starter seed data` + trailer.

### Task 9: Furniture and blueprint-import schema

**Files:**
- Create: migrations `2026_10_20_060000_create_furniture_presets_table`, `_060100_create_furniture_template_settings_table`, `_060200_create_furniture_designs_table`, `_060300_create_furniture_revisions_table`, `_060400_add_current_revision_fk_to_furniture_designs_table`, `_070000_create_blueprint_imports_table`; `app/Domain/Furniture/Models/{FurnitureDesign,FurnitureRevision,FurniturePreset,FurnitureTemplateSetting}.php`; `app/Domain/Furniture/Enums/{PresetCategory,BomStatus,FurnitureRevisionReason,AuthorKind}.php`; `app/Domain/Imports/Models/BlueprintImport.php`; `app/Domain/Imports/Enums/{ImportStatus,ImportMode,ImportSourceKind}.php`; `app/Domain/Ai/Enums/AiProvider.php`; factories
- Modify: `Documents` (add `placeholderFurniture(string $templateKey = 'wardrobe'): array`), `Project` (`furnitureDesigns()`, `blueprintImports()`), `MorphMap`
- Test: `tests/Feature/Schema/FurnitureImportsSchemaTest.php`, `tests/Feature/Models/FurnitureTest.php`, `tests/Feature/Models/BlueprintImportTest.php`

**Spec refs:** `02 §4.1`, `§5.1–§5.4`, `§10`, `§11`, `§12`, `§15` groups 6–7; `06 §4.2`; `03 §2` (top-level FurnitureDocument keys)

**Interfaces:**
- Consumes: Tasks 4–8.
- Produces: models with casts (`working_document`/`document`/`result_document` → `AsJsonDocument`; `estimate`, `bom`, `price`, `change_summary`, `hints`, `result_meta`, `default_overrides` → array; enums), media collections exactly as `02 §10` (`FurnitureDesign.thumbnail` s3 + `small` 320w; `FurnitureRevision.cutlist_pdf` s3 single pdf; `FurniturePreset.thumbnail` s3-public + `small`; `BlueprintImport.source`/`normalized` (single, s3, `normalized` conversion `preview` 1600w webp queued)/`debug`/`pages`); `FurnitureRevision` immutable like `PlanRevision`; `BlueprintImport::isTerminal(): bool` (`accepted, discarded, failed, cancelled`) and `isActiveRun(): bool` (`queued, preprocessing, recognizing`); enums `PresetCategory` (9), `BomStatus` (`pending, ready, failed`), `FurnitureRevisionReason` (`manual_checkpoint, order_submitted, staff_proposal, proposal_applied, before_restore`), `AuthorKind` (`customer, staff`), `ImportStatus` (9 values of `02 §4.1`), `ImportMode` (`auto, trace`), `ImportSourceKind` (`raster, pdf_vector, pdf_raster, dxf, heic`), `AiProvider` (`anthropic, openai, openai_compatible, none`). `Documents::placeholderFurniture()` is a structural placeholder (schemaVersion 1, templateKey, family `carcass`, dims, materials for all 9 roles using seed codes) — P5 switches factories to the P2 fixtures. `furniture_designs.locked_by_order_id` exists without FK (Task 11 adds it).

- [ ] **Step 1: Write the failing tests**
  - `FurnitureImportsSchemaTest`: columns per `02 §4.1`, `§5.1–§5.4`; defaults (`bom_status 'pending'`, `status 'uploaded'`, `mode 'auto'`, `selected_page 1`, `hints '{}'`, `review_version 1`, `credits_* 0`, `estimate '{}'`, `default_overrides '{}'`); unique `furniture_presets.slug`, unique `(furniture_design_id, number)`; indexes `furniture_designs(project_id, updated_at)`, `(locked_by_order_id)`, `blueprint_imports(user_id, created_at)`, `(status)`; `furniture_template_settings` PK `template_key`; `furniture_revisions` has `created_at` only.
  - `FurnitureTest`: revision update throws `LogicException`; deleting a project cascades designs → revisions; deleting a preset nulls `furniture_designs.preset_id`; registered media collections have the names/disks/single-file flags above.
  - `BlueprintImportTest`: dataset over the 9 statuses for `isTerminal()`/`isActiveRun()`; deleting the target plan nulls `plan_id`; deleting the uploading user is restricted (R); `hints` round-trips `{"corners":[[0.1,0.1],[0.9,0.1],[0.9,0.9],[0.1,0.9]]}`.
- [ ] **Step 2: Run, expect FAIL** — `vendor/bin/pest tests/Feature/Schema/FurnitureImportsSchemaTest.php tests/Feature/Models`
- [ ] **Step 3: Implement** — per Files/Interfaces.
- [ ] **Step 4: Run tests, expect PASS** — same as Step 2.
- [ ] **Step 5: Quality gates** — Gates-PHP, Gates-Gen.
- [ ] **Step 6: Commit** — `git add database/migrations app/Domain/Furniture app/Domain/Imports app/Domain/Ai/Enums database/factories app/Domain/Projects app/Support/MorphMap.php tests resources/js` → `feat(schema): furniture designs, revisions, presets and blueprint imports` + trailer.

### Task 10: Orders schema A (orders, items, change proposals) and order states

**Files:**
- Create: migrations `2026_10_20_080000_create_orders_table`, `_080100_create_order_items_table`, `_080200_create_change_proposals_table`, `_080300_create_change_proposal_items_table`; `app/Domain/Orders/Models/{Order,OrderItem,ChangeProposal,ChangeProposalItem}.php`; `app/Domain/Orders/States/{OrderState,Draft,Submitted,InReview,ChangesProposed,Quoted,Negotiating,Accepted,Confirmed,InProduction,Completed,Rework,ReadyForDelivery,Delivered,Closed,Cancelled,OnHold}.php`; `app/Domain/Orders/Enums/{OrderStateKey,CancelReason,ChangeProposalStatus,ProposalItemDecision}.php`; factories
- Modify: `User` (`orders()`), `Project` (`orders()`), `MorphMap`
- Test: `tests/Feature/Schema/OrdersSchemaATest.php`, `tests/Feature/Models/OrderTest.php`

**Spec refs:** `02 §8.1–§8.4`, `§11`, `§12`, `§15` group 8; `09 §1` (states, Active/terminal); master §6.3, D14; P1-D7

**Interfaces:**
- Consumes: Tasks 4–9, `OrderNumber`.
- Produces: `OrderState` (abstract spatie state, default `Draft`, no transitions) and 16 final state classes with `public static string $name` = `draft, submitted, in_review, changes_proposed, quoted, negotiating, accepted, confirmed, in_production, completed, rework, ready_for_delivery, delivered, closed, cancelled, on_hold`; `OrderState::isActive(): bool` (not draft/closed/cancelled), `isTerminal(): bool` (closed/cancelled); `OrderStateKey` backed enum with the same 16 values (`#[TypeScript]`, used by TS types and i18n patterns); `Order` (SoftDeletes, `HasStates`; casts `state: OrderState`, dates immutable, `needs_installation: bool`; `creating` sets `number = OrderNumber::draft($id)` when empty; `isDraftNumber(): bool`; relations `project, customer, assignee, productionAssignee, siteAddress, items, changeProposals`); `OrderItem`, `ChangeProposal`, `ChangeProposalItem` (`staff_draft_document` → `AsJsonDocument`, `changes` → array, `decision` enum); enums `CancelReason` (7 of `02 §8.1`), `ChangeProposalStatus` (`draft, sent, resolved, withdrawn`), `ProposalItemDecision` (`pending, approved, rejected`). `OrderFactory::inState(string $stateClass)` sets the state, `state_changed_at`, matching milestone timestamps and a real `ORD-` number for every state except never-submitted drafts; `OrderFactory::withItems(int $count = 1)`.

- [ ] **Step 1: Write the failing tests**
  - `OrdersSchemaATest`: columns per `02 §8.1–§8.4` (incl. `state_changed_at` default `now()`, `state` default `'draft'`, `production_progress` default 0, `needs_installation` default true); unique `orders.number`; indexes `(state, updated_at)`, `(state, state_changed_at)`, `(customer_id, created_at)`, `(assigned_to, state)`; unique `order_items(order_id, furniture_design_id)`, `change_proposals(order_id, number)`, `change_proposal_items(change_proposal_id, order_item_id)`; `accepted_quote_id`/`current_quote_id` columns exist without FKs yet.
  - `OrderTest`: dataset over the 16 state classes — `Order::factory()->inState($c)->create()->fresh()->state` is an instance of `$c` and `->getValue()` equals its `$name`; `isActive()` true for exactly the 13 non-draft/closed/cancelled states; a new order without number gets `DRAFT-` + last 8 chars of its id; `array_column(OrderStateKey::cases(), 'value')` equals the 16 `$name`s; deleting an order cascades items and proposals; deleting a furniture design referenced by an order item throws (R).
- [ ] **Step 2: Run, expect FAIL** — `vendor/bin/pest tests/Feature/Schema/OrdersSchemaATest.php tests/Feature/Models/OrderTest.php`
- [ ] **Step 3: Implement** — per Files/Interfaces.
- [ ] **Step 4: Run tests, expect PASS** — same as Step 2.
- [ ] **Step 5: Quality gates** — Gates-PHP, Gates-Gen.
- [ ] **Step 6: Commit** — `git add database/migrations app/Domain/Orders database/factories app/Domain/Identity/Models/User.php app/Domain/Projects/Models/Project.php app/Support/MorphMap.php tests resources/js` → `feat(orders): orders, items and change proposals schema with order states` + trailer.

### Task 11: Orders schema B (quotes … payments, deferred FKs)

**Files:**
- Create: migrations `2026_10_20_080400_create_quotes_table`, `_080500_create_quote_lines_table`, `_080600_create_quote_negotiations_table`, `_080700_create_confirmation_calls_table`, `_080800_create_production_updates_table`, `_080900_create_order_issues_table`, `_081000_create_deliveries_table`, `_081100_create_payments_table`, `_081200_add_order_foreign_keys`; `app/Domain/Orders/Models/{Quote,QuoteLine,QuoteNegotiation,ConfirmationCall,ProductionUpdate,OrderIssue,Delivery,Payment}.php`; `app/Domain/Orders/Enums/{QuoteStatus,QuoteLineKind,NegotiationStatus,CallOutcome,ProductionVisibility,IssueStatus,PaymentKind,PaymentMethod,PaymentStatus,PaymentGateway}.php`; factories
- Modify: `Order` (relations `quotes, negotiations, confirmationCalls, productionUpdates, issues, delivery, acceptedQuote, currentQuote, messages` — `messages` in Task 12), `FurnitureDesign` (`lockedByOrder()`), `MorphMap`
- Test: `tests/Feature/Schema/OrdersSchemaBTest.php`, `tests/Feature/Models/QuoteTest.php`

**Spec refs:** `02 §8.5–§8.12`, `§10`, `§11`, `§15` group 8 (deferred FKs); master §6.3 (quote number), D16

**Interfaces:**
- Consumes: Task 10.
- Produces: models with casts (money `int`, `quantity` decimal string, `tax_breakdown`/`cost_snapshot`/`details`/`item_comments` array, `accepted_by_ip` string, enums, dates); `Quote::creating` sets `number = QuoteNumber::for($order->number, $version)` when empty; media `Quote.pdf` (s3 single pdf), `ProductionUpdate.photos`/`OrderIssue.photos`/`Delivery.photos` (s3, conversions `thumb` 400w and `large` 1600w); `Payment` with casts only; enums `QuoteStatus` (`draft, sent, accepted, declined, superseded, expired, withdrawn`), `QuoteLineKind` (9), `NegotiationStatus` (4), `CallOutcome` (6), `ProductionVisibility` (`customer, internal`), `IssueStatus` (4), `PaymentKind` (4), `PaymentMethod` (6), `PaymentStatus` (4), `PaymentGateway` (`razorpay, stripe`). Factory states: `Quote::sent()`, `accepted()`; `QuoteLine::discount()`; `ProductionUpdate::internal()`, `completion()`; `ConfirmationCall::outcome(CallOutcome)`.

- [ ] **Step 1: Write the failing tests**
  - `OrdersSchemaBTest`: columns per `02 §8.5–§8.12`; uniques `quotes(order_id, version)`, `quotes(number)`, `deliveries(order_id)`; partial unique `quotes(order_id) WHERE status = 'sent'` (a second sent quote for the same order throws); index `production_updates(order_id, created_at)`; `quotes.accepted_by_ip` is `inet`; FKs from `_081200`: deleting a quote nulls `orders.accepted_quote_id`/`current_quote_id`; deleting an order nulls `furniture_designs.locked_by_order_id`; deleting an order that has payments throws (R).
  - `QuoteTest`: `Quote::factory()->for($order)->create(['version' => 2])->number === $order->number.'-Q2'`; `QuoteLine` discount state has `unit_price_minor <= 0` and `tax_rate_id null`; `Payment::factory()->create()` round-trips casts.
- [ ] **Step 2: Run, expect FAIL** — `vendor/bin/pest tests/Feature/Schema/OrdersSchemaBTest.php tests/Feature/Models/QuoteTest.php`
- [ ] **Step 3: Implement** — per Files/Interfaces.
- [ ] **Step 4: Run tests, expect PASS** — same as Step 2.
- [ ] **Step 5: Quality gates** — Gates-PHP, Gates-Gen.
- [ ] **Step 6: Commit** — `git add database/migrations app/Domain/Orders app/Domain/Furniture/Models/FurnitureDesign.php database/factories app/Support/MorphMap.php tests resources/js` → `feat(orders): quotes, negotiations, calls, production, issues, deliveries and payments schema` + trailer.

### Task 12: Messaging and AI schema; whole-schema checks

**Files:**
- Create: migrations `2026_10_20_090000_create_messages_table`, `_090100_create_message_reads_table`, `_100000_create_ai_credit_ledger_table`, `_100100_create_ai_usage_events_table`; `app/Domain/Messaging/Models/{Message,MessageRead}.php`; `app/Domain/Messaging/Enums/MessageKind.php`; `app/Domain/Ai/Models/{AiCreditLedgerEntry,AiUsageEvent}.php`; `app/Domain/Ai/Enums/{CreditLedgerKind,AiFeature,AiUsageStatus}.php`; factories
- Modify: `Order` (`messages()`), `User` (`aiCreditLedgerEntries()`), `BlueprintImport` (`ledgerEntries()`, `usageEvents()` morphMany as `reference`), `MorphMap`
- Test: `tests/Feature/Schema/MessagingAiSchemaTest.php`, `tests/Feature/Schema/MigrationOrderTest.php`, `tests/Feature/Models/AllFactoriesTest.php`, `tests/Unit/ArchTest.php` (extend)

**Spec refs:** `02 §7`, `§9`, `§10` (Message attachments), `§11`, `§15` (whole order)

**Interfaces:**
- Consumes: Tasks 4–11.
- Produces: `Message` (SoftDeletes; `kind: MessageKind` (`text, system, internal_note`), `system_payload` array; media `attachments` s3 with `thumb` 400w); `MessageRead` (table `message_reads`, no incrementing key, no timestamps; `order()`, `user()`); `AiCreditLedgerEntry` (table `ai_credit_ledger`, `created_at` only, immutable; `kind: CreditLedgerKind` (8 values of `02 §7.1`), `reference(): MorphTo`); `AiUsageEvent` (`created_at` only; `feature: AiFeature` (`blueprint_recognition, provider_test`), `provider: AiProvider`, `status: AiUsageStatus` (`succeeded, failed`)).

- [ ] **Step 1: Write the failing tests**
  - `MessagingAiSchemaTest`: columns per `02 §7`, `§9`; `message_reads` PK `(order_id, user_id)`; index `messages(order_id, created_at)`; partial unique `ai_credit_ledger(user_id, period) WHERE kind = 'monthly_grant'` (two monthly grants for one period throw; two `admin_grant`s do not); indexes `ai_credit_ledger(user_id, created_at)`, `ai_usage_events(created_at)`, `(user_id, created_at)`, `(provider, created_at)`.
  - `MigrationOrderTest`: the table names derived from the migration basenames (sorted) equal, in order: `users, addresses, password_reset_tokens, otp_codes, notification_preferences, staff_invitations, permission (tables), media, activity_log, notifications, notification_deliveries, push_subscriptions, upload_intents, jobs, job_batches, failed_jobs, cache, sessions, pulse, telescope_entries, app_settings, number_sequences, projects, plans, plan_revisions, (plans fk), materials, edge_bands, hardware_items, finishes, labour_rates, tax_rates, furniture_presets, furniture_template_settings, furniture_designs, furniture_revisions, (designs fk), blueprint_imports, orders, order_items, change_proposals, change_proposal_items, quotes, quote_lines, quote_negotiations, confirmation_calls, production_updates, order_issues, deliveries, payments, (order fks), messages, message_reads, ai_credit_ledger, ai_usage_events` (encode the list as the expected array of basenames' table parts).
  - `AllFactoriesTest`: dataset of every factory under `database/factories/Domain` → `create()` succeeds.
  - `ArchTest`: every class in `App\Domain\*\Models` is final and uses `HasUlids`, except `AppSetting`, `BusinessProfile`, `FurnitureTemplateSetting`, `MessageRead`; every class in `App\Domain\*\Actions` is final.
- [ ] **Step 2: Run, expect FAIL** — `vendor/bin/pest tests/Feature/Schema tests/Feature/Models/AllFactoriesTest.php tests/Unit/ArchTest.php`
- [ ] **Step 3: Implement** — per Files/Interfaces; also `php artisan migrate:fresh --seed` on the dev database `furny` must succeed.
- [ ] **Step 4: Run tests, expect PASS** — `vendor/bin/pest tests/Feature/Schema tests/Feature/Models tests/Unit/ArchTest.php`
- [ ] **Step 5: Quality gates** — Gates-PHP, Gates-Gen.
- [ ] **Step 6: Commit** — `git add database/migrations app/Domain/Messaging app/Domain/Ai database/factories app/Domain app/Support/MorphMap.php tests resources/js` → `feat(schema): messaging and AI metering tables; migration order and factory checks` + trailer.

