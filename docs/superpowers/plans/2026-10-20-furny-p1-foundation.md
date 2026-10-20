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
- Test: `tests/Feature/HealthUpTest.php`, `tests/Unit/ArchTest.php`, `tests/Unit/ComposerPlatformTest.php`, `tests/Browser/SmokeTest.php`, `resources/js/__tests__/package-manager.test.ts`, `resources/js/engine/__tests__/version.test.ts`, `engine-cli/src/__tests__/cli.test.ts`

**Spec refs:** master §6.6, D2, D34; `01 §1.1`, `§1.2`, `§3`, `§5.1`, `§5.4`; `17 §3.1`, `§5.2` notes, `§10.2`; `19 §6` (input for 16); roadmap "Local environment notes"

**Interfaces:**
- Consumes: nothing.
- Produces (P2 and P3 start from these):
  - `package.json` scripts: `dev` (`vite`), `build` (`vite build && yarn build:engine-cli`), `build:engine-cli` (`vite build --config engine-cli/vite.config.ts`), `test` (`vitest run`), `lint` (`eslint . --max-warnings=0`), `format:check` (`prettier --check resources/ engine-cli/`), `typecheck` (`vue-tsc --noEmit`); every runtime/dev package of `01 §1.2` already installed (P2 must not need lockfile changes for `zod`, `mutative`, `clipper2-ts`, `earcut`, `flatbush`, `nanoid`).
  - `tsconfig.json` with `strict: true`, path alias `@/*` → `resources/js/*`, includes `resources/js/**/*`, `engine-cli/**/*`.
  - `vitest.config.ts` with two projects: `engine` (environment `node`; include `resources/js/engine/**/*.test.ts`, `engine-cli/src/**/*.test.ts`; exclude `**/__perf__/**`) and `ui` (environment `jsdom`; include `resources/js/**/*.test.ts`, exclude the engine globs); alias `@`.
  - flat `eslint.config.js` (the engine `no-restricted-imports`/`no-restricted-globals` blocks of `01 §5.1` are added by P2 Task 1, which owns engine purity) with `vue/no-v-html: error` (override allowing `resources/js/components/orders/MessageBody.vue`), `vue/no-bare-strings-in-template: error` with allowlist `['×','—','·','/',':','%','+']`, and an exported `LEGACY_KIT_FILES` ignore array for kit files still present (emptied by Task 31).
  - `resources/js/engine/version.ts` (`export const ENGINE_VERSION = '1.0.0'`), `resources/js/engine/index.ts` (re-exports it) — owned by P2 from now on.
  - `engine-cli/src/cli.ts` exporting `dispatch(command: string, rawInput: string): CliResponse` where `CliResponse = { ok: true; result: unknown } | { ok: false; error: { code: string; message: string; details?: unknown } }` (codes so far `unknown_command`, `invalid_json`), plus a `main()` that reads all of stdin, writes the response JSON + newline, exits 0; built to `engine-cli/dist/cli.mjs` (Vite `build.ssr`, target `node22`, deps bundled; `engine-cli/dist` git-ignored). P2 replaces/extends these files with the real commands (same `dispatch` contract).
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
  - `engine-cli/src/__tests__/cli.test.ts`: `expect(dispatch('version', '{}')).toEqual({ ok: true, result: { engineVersion: '1.0.0' } })`; `expect(dispatch('nope', '{}')).toMatchObject({ ok: false, error: { code: 'unknown_command' } })`; `expect(dispatch('version', '{')).toMatchObject({ ok: false, error: { code: 'invalid_json' } })`.
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
  - `pint.json`: `{"preset":"laravel","rules":{"declare_strict_types":true}}`; run `vendor/bin/pint` once over the kit code and fix Larastan level-8 findings in the kept kit code (no baseline file). `phpstan.neon`: include `vendor/larastan/larastan/extension.neon`, `level: 8`, paths `app`, `config`, `database`, `routes`.
  - Pest: `tests/Pest.php` → `pest()->extend(Tests\TestCase::class)->use(Illuminate\Foundation\Testing\RefreshDatabase::class)->in('Feature', 'Browser'); beforeEach(fn () => Http::preventStrayRequests());`. `phpunit.xml` env (not forced): `APP_ENV=testing`, `DB_CONNECTION=pgsql`, `DB_HOST=127.0.0.1`, `DB_DATABASE=furny_test`, `DB_USERNAME=furny`, `DB_PASSWORD=furny`, `CACHE_STORE=array`, `SESSION_DRIVER=array`, `QUEUE_CONNECTION=sync`, `MAIL_MAILER=array`, `BROADCAST_CONNECTION=null`, `BCRYPT_ROUNDS=4`, `PULSE_ENABLED=false`, `TELESCOPE_ENABLED=false`.
  - spatie/laravel-typescript-transformer v3: configure per its README to collect `#[TypeScript]` classes and enums under `app/` and write `resources/js/types/generated.d.ts`; commit the (empty) generated file.
  - Engine stub + CLI per Interfaces; `.gitignore` adds `engine-cli/dist`. ESLint: kit config + `vue/no-v-html` (override for `components/orders/MessageBody.vue`) + `vue/no-bare-strings-in-template` + `LEGACY_KIT_FILES` ignores.
  - `.github/workflows/ci.yml`: `17 §10.2` verbatim for jobs `php`, `frontend`, `vision`, `browser` (no `deploy` job, P1-D15) with these changes: (a) `frontend` runs `php artisan wayfinder:generate --with-form` before ESLint (vue-tsc needs the generated routes); (b) `vision` gets a first step `id: probe` writing `present=true|false` from `test -f vision/pyproject.toml`, and every later step has `if: steps.probe.outputs.present == 'true'`.
- [ ] **Step 4: Run tests, expect PASS** — `yarn vitest run`; `yarn build` then `echo '{}' | node engine-cli/dist/cli.mjs version | grep -q '"ok":true'`; `vendor/bin/pest tests/Unit tests/Feature`; `yarn playwright install chromium && vendor/bin/pest tests/Browser` (if the Playwright browser download is blocked by the local proxy, rely on the CI `browser` job and note it in the PR).
- [ ] **Step 5: Quality gates** — Gates-PHP, Gates-JS; `php artisan typescript:transform && git diff --exit-code -- resources/js/types/generated.d.ts`.
- [ ] **Step 6: Commit** — `git add -A -- . ':(exclude)docs' ':(exclude)vision'` (the scaffold must not touch `docs/` or `vision/`) → `git commit -m "chore(scaffold): bootstrap app from vue-starter-kit with yarn 4, Pest 5, Larastan 8, Vitest and CI"` + trailer.

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
- Produces: global PHP function `trans_icu(string $key, array $params = [], ?string $locale = null): string`; command `php artisan i18n:export`; TS `createI18n(options: { locale: string; messages: Record<string,string>; timeZone?: string; numberLocale?: string }): I18nPlugin`, `useI18n(): { t(key: string, params?: Record<string, unknown>): string; has(key: string): boolean; locale: Ref<string> }`, global `$t`; `resources/js/lang/generated/{locale}.json` (flat sorted dot keys) + `manifest.json` (`{ "en": "<sha1>" }`); the `i18n-keys` test's `ENUM_KEY_PATTERNS` map (pattern → generated TS type name; **empty in Task 3** — Task 18 adds the three order-state patterns and later milestones add the pattern of each enum when they first render it).

- [ ] **Step 1: Write the failing tests**
  - `TransIcuTest`: with `common.photo_n` = `Photo {n}` and `common.counts.items` = `{count, plural, one {# item} other {# items}}`: `trans_icu('common.photo_n', ['n' => 3]) === 'Photo 3'`; `trans_icu('common.counts.items', ['count' => 1]) === '1 item'`; `['count' => 4]` → `'4 items'`; missing key returns the key and `Log::shouldReceive('warning')` once.
  - `ExportTranslationsTest`: after `artisan('i18n:export')->assertSuccessful()`: `en.json` contains `"common.photo_n": "Photo {n}"`; keys sorted; no key starts with `validation.`, `passwords.`, `pagination.`, `auth.`; `manifest.json` = `{"en": sha1_file(en.json)}`; a temporary namespace file `resources/lang/en/zz_test.php` with `'bad' => '{count, plural, one {#}'` makes the command fail with output containing `zz_test.bad` (file deleted in `afterEach`).
  - `i18n.test.ts`: `t('a.b', { name: 'Asha' })` → `'Hello Asha'`; `t('a.b')` (missing argument) does not throw and returns `'Hello '` with a dev warning; plural `{count}` 1 → `'1 item'`, 2 → `'2 items'`; missing key returns the key; two calls with the same key construct `IntlMessageFormat` once (spy).
  - `i18n-keys.test.ts`: globs `resources/js/**/*.{vue,ts}` (excluding `lang/generated`, tests) for `t('…')`, `$t('…')`, `labelKey: '…'`, `titleKey: '…'` literals; each key exists in `en.json`. For each entry of `ENUM_KEY_PATTERNS` whose type exists in `types/generated.d.ts`, every union member's key exists in `en.json` (the map starts empty; patterns of `15 §15.2` are added by the task that first renders the enum).
- [ ] **Step 2: Run, expect FAIL** — `vendor/bin/pest tests/Unit/I18n tests/Feature/I18n && yarn vitest run resources/js/lib resources/js/__tests__/i18n-keys.test.ts`
- [ ] **Step 3: Implement** — helper per `15 §15.3` (`MessageFormatter::formatMessage($locale ?? app()->getLocale(), trans($key, [], $locale), $params)`; key missing when `trans()` returns the key); command validates each message with `MessageFormatter::create` (fail naming the key), flattens nested arrays, sorts, writes JSON with `JSON_PRETTY_PRINT|JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES`. Create every namespace file listed in `15 §15.2` (returning `[]` unless keys are needed now: `common.photo_n`, `common.counts.items`, `common.actions.{back,confirm,cancel,save_changes,discard,retry,close}`, `common.a11y.skip_to_content`). Publish Laravel lang files into `resources/lang/en`. `t()` never throws: a missing simple argument renders as an empty string (dev `console.warn`); every message must be valid ICU — non-ICU shorthands such as `{n?}` are rejected by `i18n:export` (use `select`/explicit params instead). Vite plugin `vite/i18n-watch.ts` runs `php artisan i18n:export` debounced 300 ms on `resources/lang/**/*.php` changes then sends a full reload. `app.ts` installs the plugin with messages from `import.meta.glob('./lang/generated/*.json')` for `page.props.i18n.locale` (fallback `en`; the stale-hash reload is added in Task 20). CI php job: step `php artisan i18n:export && git diff --exit-code -- resources/js/lang/generated`.
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
  - `MigrationOrderTest`: the sorted basenames of `database/migrations/*.php` equal exactly (each prefixed `2026_10_20_`): `010000_create_users_table, 010100_create_addresses_table, 010200_create_password_reset_tokens_table, 010300_create_otp_codes_table, 010400_create_notification_preferences_table, 010500_create_staff_invitations_table, 020000_create_permission_tables, 020100_create_media_table, 020200_create_activity_log_table, 020300_create_notifications_table, 020400_create_notification_deliveries_table, 020500_create_push_subscriptions_table, 020600_create_upload_intents_table, 020700_create_jobs_table, 020800_create_job_batches_table, 020900_create_failed_jobs_table, 021000_create_cache_table, 021100_create_sessions_table, 021200_create_pulse_tables, 021300_create_telescope_entries_table, 030000_create_app_settings_table, 030100_create_number_sequences_table, 040000_create_projects_table, 040100_create_plans_table, 040200_create_plan_revisions_table, 040300_add_current_revision_fk_to_plans_table, 050000_create_materials_table, 050100_create_edge_bands_table, 050200_create_hardware_items_table, 050300_create_finishes_table, 050400_create_labour_rates_table, 050500_create_tax_rates_table, 060000_create_furniture_presets_table, 060100_create_furniture_template_settings_table, 060200_create_furniture_designs_table, 060300_create_furniture_revisions_table, 060400_add_current_revision_fk_to_furniture_designs_table, 070000_create_blueprint_imports_table, 080000_create_orders_table, 080100_create_order_items_table, 080200_create_change_proposals_table, 080300_create_change_proposal_items_table, 080400_create_quotes_table, 080500_create_quote_lines_table, 080600_create_quote_negotiations_table, 080700_create_confirmation_calls_table, 080800_create_production_updates_table, 080900_create_order_issues_table, 081000_create_deliveries_table, 081100_create_payments_table, 081200_add_order_foreign_keys, 090000_create_messages_table, 090100_create_message_reads_table, 100000_create_ai_credit_ledger_table, 100100_create_ai_usage_events_table` (= `02 §15` order).
  - `AllFactoriesTest`: dataset of every factory under `database/factories/Domain` → `create()` succeeds.
  - `ArchTest`: every class in `App\Domain\*\Models` is final and uses `HasUlids`, except `AppSetting`, `BusinessProfile`, `FurnitureTemplateSetting`, `MessageRead`; every class in `App\Domain\*\Actions` is final.
- [ ] **Step 2: Run, expect FAIL** — `vendor/bin/pest tests/Feature/Schema tests/Feature/Models/AllFactoriesTest.php tests/Unit/ArchTest.php`
- [ ] **Step 3: Implement** — per Files/Interfaces; also `php artisan migrate:fresh` on the dev database `furny` must succeed.
- [ ] **Step 4: Run tests, expect PASS** — `vendor/bin/pest tests/Feature/Schema tests/Feature/Models tests/Unit/ArchTest.php`
- [ ] **Step 5: Quality gates** — Gates-PHP, Gates-Gen.
- [ ] **Step 6: Commit** — `git add database/migrations app/Domain/Messaging app/Domain/Ai database/factories app/Domain app/Support/MorphMap.php tests resources/js` → `feat(schema): messaging and AI metering tables; migration order and factory checks` + trailer.

### Task 13: Roles, permissions, owner gates, dashboard gates, owner seeder

**Files:**
- Create: `app/Domain/Identity/Enums/{PermissionName,OwnerGate}.php`; `app/Providers/AuthServiceProvider.php`; `database/seeders/{RolesAndPermissionsSeeder,OwnerSeeder}.php`; `config/seed.php`
- Modify: `StaffRole` (`permissions(): list<PermissionName>`), `User` (`HasRoles`; `permissionNames(): list<string>`; `abilities(): list<string>`), `UserFactory` (states `owner()`, `admin()`, `estimator()`, `production()`, `support()`), `database/seeders/DatabaseSeeder.php`, `bootstrap/providers.php`, `app/Providers/HorizonServiceProvider.php` (gate), `config/pulse.php`/Telescope provider gates
- Test: `tests/Feature/Auth/RolesAndPermissionsSeederTest.php`, `tests/Feature/Auth/OwnerGatesTest.php`, `tests/Feature/Auth/DashboardGatesTest.php`, `tests/Feature/Seeders/OwnerSeederTest.php`, `tests/Feature/Seeders/DatabaseSeederTest.php`

**Spec refs:** `13 §7.1–§7.4`; `02 §14` items 1, 5 and idempotency; `17 §5.11` item 12, `§6.1` (`SEED_OWNER_*`); master D17, D18; `19 §8.1`

**Interfaces:**
- Consumes: Tasks 4–12.
- Produces: `PermissionName` (24 cases; values exactly `13 §7.1`, `#[TypeScript]`); `OwnerGate` (`orders.cancel_late`, `staff.manage_owners`, `settings.change_currency`, `settings.manage_restricted`, `data.delete`); gate `owner` + the five abilities (each `Gate::forUser($u)->allows('owner')`); `Gate::before` returning `false` for inactive staff; gates `viewHorizon`, `viewPulse`, `viewTelescope` (active staff with role `owner` or `admin`); `RolesAndPermissionsSeeder::ensureSeeded(): void` (used by factory role states); `User::abilities()` (owner gates passed), `User::permissionNames()`; `UserFactory` role states (staff + `assignRole`); `DatabaseSeeder` order: Roles → Settings → TaxRates → Catalog → Owner.

- [ ] **Step 1: Write the failing tests**
  - `RolesAndPermissionsSeederTest`: 24 permissions named exactly `orders.view, orders.review, orders.assign, orders.propose_changes, quotes.create, quotes.send, quotes.view_costs, orders.confirm, orders.cancel, orders.hold, orders.close, production.manage, messages.post, customers.view, customers.manage, catalog.manage, presets.manage, templates.manage, settings.manage, staff.manage, ai.manage, reports.view, plans.edit_any, audit.view` (guard `web`); 5 roles; dataset per role: owner = all 24; admin = all 24; estimator = `orders.view, orders.review, orders.assign, orders.propose_changes, quotes.create, quotes.send, quotes.view_costs, orders.confirm, orders.cancel, orders.hold, messages.post, customers.view, presets.manage, plans.edit_any`; production = `orders.view, orders.hold, production.manage, messages.post, customers.view`; support = `orders.view, orders.confirm, messages.post, customers.view`; running twice keeps 24/5 and removes a manually added extra permission from a role (sync).
  - `OwnerGatesTest`: owner passes all five owner abilities and `owner`; admin fails all; inactive owner fails; customer fails; an inactive estimator is denied `orders.view` (`Gate::before`); `User::abilities()` = the five for owner, `[]` for admin and customers.
  - `DashboardGatesTest`: `viewHorizon`/`viewPulse`/`viewTelescope` true for owner and admin, false for estimator, support and customers; `GET /horizon` as estimator → 403, as owner → 200.
  - `OwnerSeederTest`: with `config('seed.owner')` = name/email/password → creates staff user with role owner, `onboarded_at`, `email_verified_at`, `terms_accepted_at` set, `timezone 'Asia/Kolkata'`; second run creates nothing; `app()->environment('production')` + empty email + no owner → `RuntimeException`; production + empty email + an existing owner → no exception.
  - `DatabaseSeederTest`: `db:seed` twice succeeds; table counts after the second run equal those after the first.
- [ ] **Step 2: Run, expect FAIL** — `vendor/bin/pest tests/Feature/Auth tests/Feature/Seeders/OwnerSeederTest.php tests/Feature/Seeders/DatabaseSeederTest.php`
- [ ] **Step 3: Implement** — `config/seed.php` = `['owner' => ['name' => env('SEED_OWNER_NAME', 'Owner'), 'email' => env('SEED_OWNER_EMAIL'), 'password' => env('SEED_OWNER_PASSWORD')]]` (config-cache safe; seeders never call `env()`); seeder uses `Permission::findOrCreate`/`Role::findOrCreate` + `syncPermissions`, then `PermissionRegistrar::forgetCachedPermissions()`.
- [ ] **Step 4: Run tests, expect PASS** — same as Step 2.
- [ ] **Step 5: Quality gates** — Gates-PHP, Gates-Gen.
- [ ] **Step 6: Commit** — `git add app/Domain/Identity app/Providers bootstrap/providers.php config/seed.php config/pulse.php database/seeders database/factories tests resources/js` → `feat(auth): roles, permission matrix, owner gates and seeders` + trailer.

### Task 14: Policies A (projects, plans, furniture designs, imports)

**Files:**
- Create: `app/Policies/{ProjectPolicy,PlanPolicy,FurnitureDesignPolicy,BlueprintImportPolicy}.php`; `app/Policies/Concerns/AuthorizesStaff.php`
- Test: `tests/Feature/Policies/ProjectPolicyTest.php`, `PlanPolicyTest.php`, `FurnitureDesignPolicyTest.php`, `BlueprintImportPolicyTest.php`

**Spec refs:** `13 §8` intro (404 for non-owners, 423 locks, 422 domain codes), `§8.1–§8.4`; master D25

**Interfaces:**
- Consumes: Task 13 permissions; models of Tasks 7–10.
- Produces: `AuthorizesStaff::staffCan(User $u, PermissionName $p): bool` (staff + active + permission); policies registered by auto-discovery (`Gate::getPolicyFor(Project::class) instanceof ProjectPolicy`). Abilities and signatures:
  - `ProjectPolicy`: `viewAny(User)`, `view(User, Project)`, `create(User, ?User $forCustomer = null)`, `update|archive|restore(User, Project)`, `delete(User, Project)` (422 code `project_has_orders` when orders other than never-submitted drafts exist; staff only via gate `data.delete`).
  - `PlanPolicy`: `view|export(User, Plan)`, `create(User, Project)`, `duplicate(User, Plan)`, `update(User, Plan)`, `delete(User, Plan)` (owner only), `lock|unlock(User, Plan)` (`plans.edit_any`).
  - `FurnitureDesignPolicy`: `view`, `create(User, Project)`, `update` (423 code `locked` when `locked_by_order_id` set), `duplicate`, `delete` (owner, not locked, not in `order_items` → 422 `design_in_order`), `saveAsPreset` (`presets.manage`).
  - `BlueprintImportPolicy`: `create(User, Project, ImportMode $mode)` (own project AND (trace OR verified contact), or `plans.edit_any`), `view`, `viewDebug` (`customers.view`), `update|cancel|retry|accept|convertToTrace` (uploader/owner or `plans.edit_any`), `discard|rerun` (uploader/owner or `ai.manage`), `refund` (`ai.manage`).
  - Customers who do not own the record get `Response::denyAsNotFound()` (status 404).

- [ ] **Step 1: Write the failing tests** — dataset-driven per ability using `Gate::forUser($u)->inspect($ability, $args)`: allowed/denied for owner-customer, other customer (status 404), owner/admin/estimator/production/support staff, inactive admin. Specific cases: support may `view` a project (`customers.view`) but not `update`; estimator may `update` a plan (`plans.edit_any`), production may not; `PlanPolicy::delete` denied for admin; `lock` allowed for estimator, denied for support; `ProjectPolicy::delete` allowed with only a never-submitted draft order, denied (status 422, code `project_has_orders`) with a `submitted` order; `FurnitureDesignPolicy::update` on a design with `locked_by_order_id` → status 423 code `locked` for the owner and for admin; `delete` of a design referenced by an order item → 422 `design_in_order`; `BlueprintImportPolicy::create` in mode `auto` for an unverified customer denied, mode `trace` allowed; `refund` only owner/admin staff.
- [ ] **Step 2: Run, expect FAIL** — `vendor/bin/pest tests/Feature/Policies`
- [ ] **Step 3: Implement** — per Interfaces (`Response::denyWithStatus(422|423, __(…), $code)`).
- [ ] **Step 4: Run tests, expect PASS** — `vendor/bin/pest tests/Feature/Policies`
- [ ] **Step 5: Quality gates** — Gates-PHP.
- [ ] **Step 6: Commit** — `git add app/Policies tests/Feature/Policies` → `feat(auth): project, plan, furniture design and import policies` + trailer.

### Task 15: Policies B (orders, quotes, change proposals, messages)

**Files:**
- Create: `app/Policies/{OrderPolicy,QuotePolicy,ChangeProposalPolicy,MessagePolicy}.php`
- Test: `tests/Feature/Policies/OrderPolicyTest.php`, `QuotePolicyTest.php`, `ChangeProposalPolicyTest.php`, `MessagePolicyTest.php`

**Spec refs:** `13 §8.5–§8.8`; `09 §1` (state names); master D18

**Interfaces:**
- Consumes: Task 14 `AuthorizesStaff`; order models (Tasks 10–12).
- Produces:
  - `OrderPolicy`: `viewAny` (`orders.view`), `view` (own or `orders.view`), `viewInternal` (`orders.view`); owner-only abilities `create, updateDraftItems, deleteDraft, submit, cancelDraft, reopen, acceptQuote, negotiate, declineQuote, approveCompletion, reportIssue, withdraw, requestCallback`; staff abilities `review, editItems` (`orders.review`), `assign` (`orders.assign`), `proposeChanges, withdrawProposal` (`orders.propose_changes`), `createQuote` (`quotes.create`), `sendQuote, answerNegotiation` (`quotes.send`), `logCall, confirm, reopenAfterCall` (`orders.confirm`), `cancel` (`orders.cancel`), `cancelLate` (gate `orders.cancel_late`), `hold, resume` (`orders.hold`), `manageProduction` (`production.manage`), `close, raiseIssueOnBehalf` (`orders.close`). State rules are **not** checked here (P7 state machine).
  - `QuotePolicy`: `view|downloadPdf` ((own order AND status ≠ draft) or `orders.view`), `viewCosts` (`quotes.view_costs`), `create|update|delete` (`quotes.create`; update/delete only drafts), `send` (`quotes.send`), `accept|negotiate|decline` (own order).
  - `ChangeProposalPolicy`: `view` ((own AND status ≠ draft) or `orders.view`), `create|update|send|withdraw|addItem|removeItem|updateItemDraft` (`orders.propose_changes`), `decide` (own order).
  - `MessagePolicy`: `viewThread(User, Order)`, `create(User, Order)` ((own AND verified contact) or `messages.post`; 422 code `thread_closed` when the order is `cancelled`/`closed` and `cancelled_at`/`closed_at` is more than 90 days ago), `createInternalNote(User, Order)` (`messages.post`), `update|delete(User, Message)` (author AND kind `text` AND created < 10 min ago).

- [ ] **Step 1: Write the failing tests** — datasets as in Task 14: production may `manageProduction` and `hold` but not `cancel`; support may `logCall`/`confirm` but not `createQuote`; only owner passes `cancelLate`; customer A gets 404 on customer B's order `view`; customer may `view` a `sent` quote of own order but not a `draft` one; production `view` on quote allowed (orders.view) but `viewCosts` denied; estimator `viewCosts` allowed; `ChangeProposalPolicy::view` draft denied for owner-customer; `MessagePolicy::create` denied for unverified customer, allowed for verified, 422 `thread_closed` for an order closed 91 days ago and allowed for one closed 89 days ago; `update` of own text message allowed at 9 min, denied at 11 min, denied for a `system` message.
- [ ] **Step 2: Run, expect FAIL** — `vendor/bin/pest tests/Feature/Policies`
- [ ] **Step 3: Implement** — per Interfaces.
- [ ] **Step 4: Run tests, expect PASS** — `vendor/bin/pest tests/Feature/Policies`
- [ ] **Step 5: Quality gates** — Gates-PHP.
- [ ] **Step 6: Commit** — `git add app/Policies tests/Feature/Policies` → `feat(auth): order, quote, change proposal and message policies` + trailer.

### Task 16: Design tokens, fonts, theme

**Files:**
- Create/replace: `resources/css/app.css`; `resources/js/lib/theme/editorColors.ts`; `resources/js/lib/theme/meta.ts`; `resources/js/lib/zIndex.ts`; `resources/js/composables/useTheme.ts`
- Modify: `resources/views/app.blade.php` (server-side `dark` class from cookie `appearance`, inline theme script before CSS, `<meta name="theme-color">`), `bootstrap/app.php` (`encryptCookies(except: ['appearance'])`)
- Test: `resources/js/__tests__/tokens-contrast.test.ts`, `resources/js/__tests__/no-raw-palette.test.ts`, `resources/js/lib/theme/__tests__/editorColors.test.ts`, `resources/js/composables/__tests__/useTheme.test.ts`, `tests/Feature/Ui/AppearanceCookieTest.php`

**Spec refs:** `15 §1`, `§2`, `§3.1–§3.5`, `§11`, `§14.6`, `§16` (print rules + print token block); master D24, D26; `13 §12.2` (appearance cookie)

**Interfaces:**
- Consumes: Task 1.
- Produces: `app.css` exactly per `15 §3.1` (+ `@media print` rules of `15 §16` and the print copy of the light tokens); `EditorColorKey`, `readEditorColors()`, `EXPORT_PALETTE`, `cssColorToHex()`, `roomTypeToColorKey(type: EditorRoomType)` where `EditorRoomType` = the 19 room types of `15 §3.4` (P2's engine `RoomType` must equal this union; P4 switches the parameter type to the engine type); `useTheme(): { appearance: Ref<'light'|'dark'|'system'>; resolved: Ref<'light'|'dark'>; setAppearance(v): void }` (localStorage `fs:appearance` + cookie `appearance` 1 year `SameSite=Lax`, `Secure` on https; all storage access in try/catch); `THEME_COLOR = { light: '#fbfaf7', dark: '#1d1a17' }`; `Z` constants of `15 §3.3`.

- [ ] **Step 1: Write the failing tests**
  - `tokens-contrast.test.ts`: parses `:root` and `.dark` from `app.css`, converts with `culori`, asserts the `15 §14.6` pairs in both themes (foreground and muted-foreground on background/card/muted ≥ 4.5; primary-foreground/primary ≥ 4.5; each status foreground on its base and each subtle-foreground on its subtle ≥ 4.5; accent-foreground/accent ≥ 4.5; ring/background ≥ 3.0; border/background ≥ 1.3; room-label on all ten room fills ≥ 4.5; dimension-text/canvas-bg ≥ 4.5); the print token block equals `:root`.
  - `no-raw-palette.test.ts`: regex of `15 §3` over `resources/js/**/*.vue` excluding `components/ui/` finds no match.
  - `editorColors.test.ts`: `EXPORT_PALETTE` equals the `:root` values parsed from `app.css` for every `EditorColorKey`; `roomTypeToColorKey` dataset per `15 §3.4` (`master_bedroom → room-bedroom`, `toilet → room-bath`, `deck → room-outdoor`, `ots → room-utility`, `corridor → room-circulation`, `other → room-other`, …).
  - `useTheme.test.ts`: `setAppearance('dark')` adds `dark` to `<html>`, writes `localStorage['fs:appearance'] = 'dark'` and a cookie containing `appearance=dark`, `max-age=31536000`, `samesite=lax`; `system` follows a mocked `matchMedia('(prefers-color-scheme: dark)')` change; a throwing `localStorage` does not break it.
  - `AppearanceCookieTest`: request with cookie `appearance=dark` renders `<html` with class `dark` and `<meta name="theme-color" content="#1d1a17">`; the cookie is read unencrypted.
- [ ] **Step 2: Run, expect FAIL** — `yarn vitest run resources/js/__tests__ resources/js/lib/theme resources/js/composables && vendor/bin/pest tests/Feature/Ui`
- [ ] **Step 3: Implement** — tokens verbatim; if a contrast pair fails, adjust only the foreground token's L by the minimum (≤ 0.06) and mirror it into `EXPORT_PALETTE` (`15 §14.6`).
- [ ] **Step 4: Run tests, expect PASS** — same as Step 2.
- [ ] **Step 5: Quality gates** — Gates-JS, Gates-PHP.
- [ ] **Step 6: Commit** — `git add resources/css/app.css resources/js/lib resources/js/composables resources/views/app.blade.php bootstrap/app.php resources/js/__tests__ tests/Feature/Ui` → `feat(ui): design tokens, self-hosted fonts and theme switching` + trailer.

### Task 17: shadcn-vue components and UI composables

**Files:**
- Create: `resources/js/components/ui/**` (46 components: `accordion alert alert-dialog aspect-ratio avatar badge breadcrumb button calendar card checkbox collapsible combobox command context-menu dialog drawer dropdown-menu hover-card input label navigation-menu number-field pagination pin-input popover progress radio-group range-calendar resizable scroll-area select separator sheet sidebar skeleton slider sonner switch table tabs tags-input textarea toggle toggle-group tooltip`), `resources/js/lib/utils.ts`, `resources/js/lib/icons.ts`, `resources/js/composables/{useControlSize,useBreakpoint,usePermissions}.ts`
- Modify: `components.json` (style `new-york`, baseColor `stone`, cssVariables `true`, aliases `@/components`, `@/lib/utils`), `components/ui/button/index.ts`, `components/ui/badge/index.ts`
- Test: `resources/js/components/ui/__tests__/variants.test.ts`, `resources/js/composables/__tests__/{useBreakpoint,usePermissions,useControlSize}.test.ts`, `resources/js/lib/__tests__/icons.test.ts`

**Spec refs:** `15 §4`, `§3.3` (control heights, density), `§6`, `§8` (`usePermissions`), `§13` (icons registry)

**Interfaces:**
- Consumes: Task 16 tokens.
- Produces: `buttonVariants` with variants `default, secondary, outline, ghost, link, destructive, success, warning` and sizes `sm, default, lg, icon, icon-lg`; `badgeVariants` with `default, secondary, outline, destructive, neutral, info, success, warning, danger, primary`; `cn()`; `ICONS` registry + `type IconName` (named lucide imports only); `useControlSize(): ComputedRef<'lg' | 'default'>` (injects `density`), `useBreakpoint(): { isPhone, isTablet, isDesktop, canEdit }` (`@vueuse/core` `breakpointsTailwind`; phone < 768, tablet 768–1023, desktop ≥ 1024), `usePermissions(): { can(nameOrGate: string): boolean; canAny(...names: string[]): boolean; isStaff: boolean; hasRole(role: string): boolean }` (reads `auth.user.permissions ∪ auth.user.abilities`).

- [ ] **Step 1: Write the failing tests** — `buttonVariants({ variant: 'success' })` contains `bg-success` and `text-success-foreground`; `buttonVariants({ size: 'icon-lg' })` contains `size-11`; `badgeVariants({ variant: 'info' })` contains `bg-info-subtle` and `text-info-subtle-foreground`; all 46 component directories exist; `useBreakpoint` with mocked width 375 → `isPhone true, canEdit false`, 820 → `isTablet true, canEdit true`, 1280 → `isDesktop true`; `usePermissions` with `permissions: ['orders.view']`, `abilities: ['settings.manage_restricted']` → `can('orders.view')`, `can('settings.manage_restricted')` true, `can('catalog.manage')` false, `canAny('catalog.manage','orders.view')` true, `isStaff` from `type`; `useControlSize` → `'lg'` under `provide('density','comfortable')`, `'default'` under `compact`; `icons.test.ts` asserts no `import * as` from `@lucide/vue` anywhere in `resources/js`.
- [ ] **Step 2: Run, expect FAIL** — `yarn vitest run resources/js/components/ui resources/js/composables resources/js/lib`
- [ ] **Step 3: Implement** — `yarn dlx shadcn-vue@latest add <names…>`; if the registry is unreachable through the proxy, clone `https://github.com/unovue/shadcn-vue` (depth 1) and copy the `new-york` registry sources of the same components. Replace any raw palette class in generated files with semantic tokens.
- [ ] **Step 4: Run tests, expect PASS** — same as Step 2.
- [ ] **Step 5: Quality gates** — Gates-JS.
- [ ] **Step 6: Commit** — `git add components.json resources/js/components/ui resources/js/lib resources/js/composables package.json yarn.lock` → `feat(ui): shadcn-vue component set with tone variants and UI composables` + trailer.

### Task 18: Common and display components, formatting

**Files:**
- Create: `resources/js/lib/{format.ts,statusTones.ts}`, `resources/js/composables/{useFormat,useConfirm}.ts`; `resources/js/components/common/{PageHeader,EmptyState,GrainMotif,ConfirmDialog,ReasonDialog,ErrorState,LoadingState,ScreenTooSmall,InputError,FormSection,StickyActionBar,CopyButton}.vue`; `resources/js/components/display/{MoneyDisplay,RelativeTime,DateText,UserAvatar,KeyValueList}.vue`; `resources/js/components/orders/{StatusBadge,StatusPill}.vue`; `resources/js/types/ui.ts` (`Tone`)
- Modify: `resources/lang/en/{common,errors,money,orders}.php` (incl. `orders.states.*`, `orders.states_customer.*`, `orders.states_customer_short.*`), `resources/js/__tests__/i18n-keys.test.ts` (`ENUM_KEY_PATTERNS`)
- Test: `resources/js/lib/__tests__/format.test.ts`, `resources/js/components/common/__tests__/*.test.ts`, `resources/js/components/display/__tests__/*.test.ts`, `resources/js/components/orders/__tests__/StatusBadge.test.ts`

**Spec refs:** `15 §9.2`, `§9.3`, `§9.6`, `§9.19–§9.21`, `§9.28`, `§9.31` (ErrorState, LoadingState, InputError, FormSection, StickyActionBar, CopyButton, ScreenTooSmall), `§10.3`, `§13`, `§15.6`; `09 §1` (labels); `15 §17` item 3

**Interfaces:**
- Consumes: Tasks 3, 17.
- Produces: `format.ts` functions exactly as `15 §15.6` (`formatMoney, minorToMajorString, parseMajorToMinor, formatNumber, formatPercent, formatBps, formatDateTime, formatDate, formatRelative, formatFileSize, formatDuration, todayInBusinessTz`; `formatLength`/`formatArea` are added by P4); `useFormat()` binds business locale/currency and user timezone from page props; `ENUM_KEY_PATTERNS` gains `orders.states.{v}`, `orders.states_customer.{v}`, `orders.states_customer_short.{v}` → `OrderStateKey`; `statusTones.ts` with `ORDER_STATE_TONE`, `ORDER_STATE_ICON`, `IMPORT_STATUS_TONE`, `QUOTE_STATUS_TONE`, `PROPOSAL_STATUS_TONE`, `PROPOSAL_DECISION_TONE`, `ISSUE_STATUS_TONE`, `NEGOTIATION_STATUS_TONE` (values of `15 §9.3`); component props exactly as `15 §9.x`; `useConfirm(): { confirm(options): Promise<boolean> }` (single global `ConfirmDialog` mounted by `AppShell`, Task 21).

- [ ] **Step 1: Write the failing tests**
  - `format.test.ts` (locale `en-IN`, currency `INR`): `formatMoney(1234567)` → `'₹12,345.67'`; `formatMoney(1234567890)` uses lakh grouping `'₹1,23,45,678.90'`; `parseMajorToMinor('12,345.67', 2) === 1234567`; `parseMajorToMinor('12.5', 2) === 1250`; `parseMajorToMinor('1.005', 2) === null`; `parseMajorToMinor('abc', 2) === null`; `minorToMajorString(1234567, 'INR') === '12345.67'`; `formatBps(3500) === '35%'`, `formatBps(1250) === '12.5%'`; `formatPercent(0.352) === '35%'`; `formatFileSize(1536) === '1.5 KB'`; `formatDuration(80000) === '1 min 20 s'`; `formatDate('2026-10-20')` contains `20` in timezone `America/Los_Angeles` (no shift); `todayInBusinessTz()` at `2026-10-20T20:00:00Z` with `Asia/Kolkata` → `'2026-10-21'`.
  - `StatusBadge.test.ts`: dataset of 16 states → badge variant per `15 §9.3` (`draft neutral, submitted info, in_review info, changes_proposed warning, quoted warning, negotiating info, accepted primary, confirmed success, in_production primary, completed warning, rework warning, ready_for_delivery success, delivered success, closed neutral, cancelled danger, on_hold warning`); staff audience label = `t('orders.states.quoted')` ("Quote sent"); customer audience label = `t('orders.states_customer_short.quoted')` ("Quote ready") and `aria-label` = `t('orders.states_customer.quoted')`.
  - Components: `MoneyDisplay` `minor=null` renders `—`, `approx` prefixes `≈` and sets `aria-label` from `money.approximately`; `PageHeader` renders exactly one `h1` with `tabindex="-1"` and a back button with `aria-label` = `t('common.actions.back')` when `backHref`; `EmptyState` `size="lg"` renders `GrainMotif`; `ConfirmDialog` with `requireText="ORD-2026-00042"` keeps Confirm disabled until the exact text is typed; destructive tone focuses Cancel first; `useConfirm().confirm()` resolves `true` on confirm, `false` on cancel; `ReasonDialog` with `reasons` and none selected shows `common.validation.reason_required`, `noteRequired` + empty note shows `common.validation.note_required`, valid submit emits `{ reason, note }`; `ErrorState` default title `errors.load_failed` and retry button calls `retry`; `RelativeTime` renders `<time datetime>` with absolute `title`; `StickyActionBar` hidden unless `dirty`.
- [ ] **Step 2: Run, expect FAIL** — `yarn vitest run resources/js/lib resources/js/components`
- [ ] **Step 3: Implement** — per Interfaces; all text via `t()`; English strings for the 16 states copied from `09 §1` ("Label (en)" and "Customer sees as") and `15 §9.3` (short labels).
- [ ] **Step 4: Run tests, expect PASS** — same as Step 2.
- [ ] **Step 5: Quality gates** — Gates-JS, Gates-Gen.
- [ ] **Step 6: Commit** — `git add resources/js/lib resources/js/composables resources/js/components resources/js/types resources/lang resources/js/lang` → `feat(ui): common/display components, status badges and Intl formatting` + trailer.

### Task 19: Input components (Currency, Phone, Length placeholder, Percent, Address)

**Files:**
- Create: `resources/js/components/inputs/{CurrencyInput,PhoneInput,LengthInput,PercentInput,AddressFields}.vue`, `resources/js/lib/lengthAdapter.ts`, `resources/js/types/forms.ts` (`AddressFormData`)
- Modify: `resources/lang/en/{units,money,phone,common}.php`
- Test: `resources/js/components/inputs/__tests__/{CurrencyInput,PhoneInput,LengthInput,PercentInput,AddressFields}.test.ts`, `resources/js/lib/__tests__/lengthAdapter.test.ts`

**Spec refs:** `15 §9.7`, `§9.22`, `§9.23`, `§9.25`, `§9.26`; master §6.1; `02 §1.2` (address lengths); P1-D3

**Interfaces:**
- Consumes: Tasks 17–18.
- Produces: components with props/emits exactly as `15 §9.x`; `lengthAdapter.ts`: `parseLengthInput(text: string, unit: LengthUnitKey): { ok: true; mm: number } | { ok: false; reason: 'invalid' | 'unsupported' }` and `formatLengthValue(mm: number, opts: { system: 'metric' | 'imperial'; unit: LengthUnitKey }): string` — **P1 placeholder**: metric units (`mm`, `cm`, `m`, bare numbers in the current unit, optional suffixes, decimal `.`), imperial input returns `unsupported`; P4 replaces the body with the engine's `parseLength`/`formatLength` (`04 §1`) without changing these signatures.

- [ ] **Step 1: Write the failing tests**
  - `CurrencyInput` (`INR`, `en-IN`): typing `12,345.67` + blur emits `1234567` and shows `12,345.67`; `12345.6` emits `1234560`; `abc` shows `money.errors.invalid` and emits `null`; `-5` with `allowNegative=false` is invalid; the prefix shows `₹`.
  - `PhoneInput` (Review Focus 2, `defaultCountry 'IN'`): `09876 543 210` → emits `'+919876543210'`; `+91-98765-43210` → `'+919876543210'`; `98765 43210` → `'+919876543210'`; pasting `+1 415 555 0100` switches the country to `US` and emits `'+14155550100'`; `12ab` emits `null` and shows `phone.errors.invalid`; national format when blurred; `inputmode="tel"`, `autocomplete="tel-national"`.
  - `LengthInput` (unit `mm`, min 300, max 6000): `2400`, `2400mm`, `240cm`, `2.4m` → emit 2400 on Enter; unit `cm` bare `240` → 2400; `100` → `aria-invalid="true"` + `units.errors.out_of_range`; `abc` → `units.errors.invalid_length`; ArrowUp +10, Shift+ArrowUp +100; Escape restores the last valid value; `role="spinbutton"` with `aria-valuenow`; `inputmode="text"`; `commit` emitted on blur with a valid value.
  - `lengthAdapter.test.ts`: `parseLengthInput("7'10\"", 'mm')` → `{ ok: false, reason: 'unsupported' }`; `parseLengthInput('3.2m', 'mm')` → `{ ok: true, mm: 3200 }`; `formatLengthValue(2400, { system: 'metric', unit: 'mm' }) === '2400'`.
  - `PercentInput`: `modelValue 1250` displays `12.50`; typing `35` emits `3500`.
  - `AddressFields`: `maxlength` label 60, line1 200, line2 200, city 100, region 100, postalCode 20; errors with `errorPrefix 'siteAddress.'` render under the right fields; countryCode defaults to `business.defaultCountryCode`.
- [ ] **Step 2: Run, expect FAIL** — `yarn vitest run resources/js/components/inputs resources/js/lib/__tests__/lengthAdapter.test.ts`
- [ ] **Step 3: Implement** — per `15 §9.x`; `PhoneInput` uses `libphonenumber-js/min`.
- [ ] **Step 4: Run tests, expect PASS** — same as Step 2.
- [ ] **Step 5: Quality gates** — Gates-JS, Gates-Gen.
- [ ] **Step 6: Commit** — `git add resources/js/components/inputs resources/js/lib resources/js/types resources/lang resources/js/lang` → `feat(ui): currency, phone, length (placeholder adapter), percent and address inputs` + trailer.

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

### Task 21: Layouts, app shell, public pages, placeholder dashboards

**Files:**
- Create: `resources/js/layouts/{CustomerLayout,AdminLayout,EditorLayout,AuthLayout}.vue`; `resources/js/components/app/{AppShell,AppHeader,AppSidebar,MobileTabBar,UserMenu,NotificationBell,ThemeToggle}.vue`; `resources/js/components/common/{OfflineBanner,SaveStatusIndicator}.vue`; `resources/js/lib/{customerNav,adminNav}.ts`; `resources/js/pages/{Welcome,Error}.vue`; `resources/js/pages/Legal/{Terms,Privacy}.vue`; `resources/js/pages/Customer/Dashboard.vue`; `resources/js/pages/Admin/Dashboard.vue`; `app/Http/Controllers/{WelcomeController,LegalController,ManifestController}.php`; `app/Http/Controllers/Customer/DashboardController.php`; `app/Http/Controllers/Admin/DashboardController.php`; `routes/customer.php`; `routes/admin.php`; `scripts/generate-icons.php`; `public/icons/{app-192,app-512,app-maskable-512,apple-touch-icon-180,notification-192,badge-72}.png`
- Delete: kit layouts and app components (`resources/js/layouts/app/**`, `layouts/auth/**`, `AppLayout.vue`, kit `components/App*.vue`, `NavMain`, `NavUser`, …) and their `LEGACY_KIT_FILES` entries
- Modify: `routes/web.php`, `bootstrap/app.php` (route files; Inertia `Error` page rendering for 403/404/419/429/503, and 500 when `app.debug` is false), `resources/views/app.blade.php` (manifest, apple-touch-icon, `apple-mobile-web-app-capable`), `resources/lang/en/{common,a11y,legal,errors,notifications,dashboard}.php`
- Test: `resources/js/layouts/__tests__/*.test.ts`, `resources/js/components/app/__tests__/{AppShell,NotificationBell}.test.ts`, `tests/Feature/Pages/{WelcomeTest,LegalPagesTest,ManifestTest,ErrorPageTest}.php`, `tests/Browser/LayoutsTest.php`

**Spec refs:** `15 §7.1–§7.4`, `§9.1`, `§9.17` (shell only), `§9.31` (OfflineBanner, SaveStatusIndicator, ThemeToggle, UserMenu), `§10.3`, `§14` items 4–6, 12; `10 §4.1`, `§4.9`, `§4.10`, `§15`; `12 §8.3` (manifest), `§8.4`; P1-D10

**Interfaces:**
- Consumes: Tasks 16–20.
- Produces: layouts with the regions/slots/props of `15 §7` (`EditorLayout` props `title, backHref, readOnly, saveStatus?, saveStatusCount?`, emits `save-status-click`; `AuthLayout` prop `variant: 'default' | 'wide'`); `AppShell` (provides `density`, mounts `Toaster` — `bottom-right` ≥ 768 px, `top-center` < 768 px — flash bridge deduped per visit, skip link to `#main`, `OfflineBanner`, global `ConfirmDialog`); nav data `customerNav` = `[customer.dashboard]`, `adminNav` = `[admin.dashboard]` (later tasks/milestones append); `UserMenu` with theme submenu + logout (account links added in Task 34); `NotificationBell` shell (count from `unreadNotifications`, `99+`, `aria-label` `notifications.bell.aria`, dropdown with `notifications.empty`; P8 adds data loading); routes `welcome` (GET `/`), `legal.terms`, `legal.privacy`, `manifest` (GET `/manifest.webmanifest`), `customer.dashboard` (GET `/dashboard`, page `Customer/Dashboard` placeholder), `admin.dashboard` (GET `/admin`, page `Admin/Dashboard` placeholder) — the two dashboards registered in `routes/customer.php`/`routes/admin.php` with middleware `['web','auth']` until Task 23 applies the full groups.

- [ ] **Step 1: Write the failing tests**
  - Vitest: `AppShell` calls `toast.success` once for a visit with `flash.success` and not again on a re-render of the same visit; `AdminLayout` renders only nav items whose permission the user has; `EditorLayout` at 375 px hides `#toolrail` and `#inspector`; `AuthLayout variant="wide"` card has `max-w-2xl`; `NotificationBell` with `unreadNotifications=150` shows `99+` and `aria-label` contains `150`.
  - `WelcomeTest`: guest → 200 component `Welcome` with `canRegister true` (`false` when `auth.allow_customer_registration` is false); customer → redirect `customer.dashboard`; staff → redirect `admin.dashboard`.
  - `LegalPagesTest`: `legal.terms` → component `Legal/Terms` with props `businessName = Settings business.name`, `updatedOn = '2026-10-20'`; same for privacy; `legal.terms.body` contains `{business}`.
  - `ManifestTest`: content type `application/manifest+json`; JSON `name` = business name, `short_name` = app name truncated to 12, `id '/'`, `start_url '/'`, `scope '/'`, `display 'standalone'`, `background_color`/`theme_color '#fbfaf7'`, icons `/icons/app-192.png` (192), `/icons/app-512.png` (512), `/icons/app-maskable-512.png` (512, `purpose 'maskable'`); every icon file exists.
  - `ErrorPageTest`: `GET /definitely-missing` → status 404, Inertia component `Error`, prop `status 404`.
  - `LayoutsTest` (browser): welcome and customer dashboard at widths 375, 820 and 1280 have `document.documentElement.scrollWidth <= window.innerWidth`.
- [ ] **Step 2: Run, expect FAIL** — `yarn vitest run resources/js/layouts resources/js/components/app && vendor/bin/pest tests/Feature/Pages && vendor/bin/pest tests/Browser/LayoutsTest.php`
- [ ] **Step 3: Implement** — per Interfaces; Welcome content per `10 §4.1`, Error page states per `10 §4.10`; legal bodies are ICU paragraphs with `{business}`; `scripts/generate-icons.php` draws the walnut (`#6b4a33`) rounded-square icon set with GD and is run once (outputs committed).
- [ ] **Step 4: Run tests, expect PASS** — same as Step 2.
- [ ] **Step 5: Quality gates** — Gates-PHP, Gates-JS, Gates-Gen.
- [ ] **Step 6: Commit** — `git add resources/js app/Http/Controllers routes bootstrap/app.php resources/views/app.blade.php resources/lang scripts/generate-icons.php public/icons eslint.config.js tests` → `feat(ui): layouts, app shell, welcome/legal/error pages and PWA manifest` + trailer.

### Task 22: HTTP hardening — security headers, CSP, cookies, proxies, log redaction, rate limiters

**Files:**
- Create: `app/Http/Middleware/SecurityHeaders.php`; `app/Http/Controllers/CspReportController.php`; `config/security.php`; `config/inertia.php` (history encryption); `app/Providers/RateLimitServiceProvider.php`; `app/Support/Privacy/Mask.php`; `app/Support/Logging/{RedactPiiProcessor,TapRedaction}.php`
- Modify: `bootstrap/app.php` (append `SecurityHeaders` to `web`; CSRF except `csp-report` and `webhooks/*`; `dontFlash` = `password, password_confirmation, current_password, code, cf_turnstile_response`; `ThrottleRequestsException` rendering), `bootstrap/providers.php`, `config/logging.php` (`security` channel; `tap` on every channel), `routes/web.php` (`csp.report`), `app/Providers/AppServiceProvider.php` (`Pulse::user` resolver), `app/Providers/TelescopeServiceProvider.php` (hidden parameters/headers), `resources/views/app.blade.php` (nonce on inline scripts), `resources/lang/en/errors.php` (`errors.rate_limited`)
- Test: `tests/Feature/Security/{SecurityHeadersTest,CspReportTest,TrustedProxiesTest,CookieFlagsTest,RateLimitersTest}.php`, `tests/Unit/Privacy/MaskTest.php`, `tests/Unit/Logging/RedactPiiProcessorTest.php`

**Spec refs:** `13 §10` (limiter table + 429 rendering), `§12.1–§12.4`, `§12.8`, `§16` items 1–5; `17 §5.11` item 1, `§6.1` (`CSP_REPORT_ONLY`, `TRUSTED_PROXIES`); master D28, D29

**Interfaces:**
- Consumes: Tasks 2, 16, 21.
- Produces: `SecurityHeaders` (per-request nonce, `Vite::useCspNonce($nonce)`, Blade `csp_nonce`; CSP of `13 §12.1` with origins from `config('security.csp')`; `Content-Security-Policy-Report-Only` when `CSP_REPORT_ONLY=true`; Vite dev origins when local + hot file; HSTS only in production on secure requests; `X-Robots-Tag: noindex, nofollow` when not production); `config('security.rate_limits')` — array keyed by limiter name, each a list of `{per: 'minute'|'hour'|'day'|'seconds:60'|'minutes:10', max: int, key: 'ip'|'user'|'email'|'email_ip'|'phone'|'session_login_id'|'user_doc'}` exactly as `13 §10`; `RateLimitServiceProvider` registering all 25 named limiters from it; 429 rendering: JSON/XHR → `{code: 'rate_limited', retryAfter: int}` + `Retry-After`; Inertia → redirect back with flash `error = trans_icu('errors.rate_limited', {seconds})`; `Mask::email()`, `Mask::phone()`, `Mask::ip()`; route `csp.report` (POST `/csp-report`, CSRF-exempt, `throttle:csp-report`, logs ≤ 2 KB to `security`, 204).

- [ ] **Step 1: Write the failing tests**
  - `SecurityHeadersTest`: `GET /` has CSP containing `default-src 'self'`, `script-src 'self' 'nonce-…' 'strict-dynamic' https://challenges.cloudflare.com`, `frame-ancestors 'none'`, `object-src 'none'`, `font-src 'self' data:`, `form-action 'self' https://accounts.google.com`, `report-uri /csp-report`; the nonce equals the `nonce` attribute of every `<script` tag in the body; `X-Frame-Options: DENY`; `Referrer-Policy: strict-origin-when-cross-origin`; `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), fullscreen=(self)`; `Cross-Origin-Opener-Policy: same-origin`; `X-Content-Type-Options: nosniff`; no HSTS in testing; HSTS `max-age=31536000; includeSubDomains` with env production on `https://`; `X-Robots-Tag: noindex, nofollow` when not production; header name is `Content-Security-Policy-Report-Only` when `security.csp.report_only` is true.
  - `CspReportTest`: POST without CSRF token → 204; `Log::channel('security')` receives a warning whose payload length ≤ 2048; 31st POST within a minute → 429 JSON `{code:'rate_limited'}` with `Retry-After`.
  - `TrustedProxiesTest` (`13 §20.18`): `REMOTE_ADDR 10.0.0.5` + `X-Forwarded-For: 203.0.113.9` → `request()->ip() === '203.0.113.9'`; `REMOTE_ADDR 198.51.100.7` + spoofed header → `'198.51.100.7'`.
  - `CookieFlagsTest`: with `session.secure = true`, `session.cookie = '__Host-session'`, the session cookie is `Secure; HttpOnly; SameSite=lax; Path=/` without `Domain`; `XSRF-TOKEN` is not HttpOnly; the `appearance` cookie is not encrypted; `config('inertia.history.encrypt') === true`.
  - `RateLimitersTest`: dataset of the 25 names of `13 §10` → `RateLimiter::limiter($name)` is registered and its limits equal the table (e.g. `login` 5/min `email|ip` + 30/min ip; `otp-cooldown` 1 per 60 s; `uploads-presign` 30/min + 300/day; `api` 120/min per user, 60/min per ip for guests; `webhooks` 600/min ip); an Inertia request hitting a throttled test route → 302 back with `flash.error`.
  - `MaskTest`: `Mask::email('asha.k@example.com') === 'a****k@e******.com'`, `Mask::phone('+919876543210') === '+91******3210'`, `Mask::ip('203.0.113.45') === '203.0.113.0'`, `Mask::ip('2001:db8:abcd:12::1') === '2001:db8:abcd::'`.
  - `RedactPiiProcessorTest`: context `{password: 'x', api_key: 'y', otp: '123456', note: 'call +91 98765 43210 or asha@example.com'}` → first three `[redacted]`, `note` has masked phone and email; a 5 000-char context string is truncated to 2 000; the message text is masked too.
- [ ] **Step 2: Run, expect FAIL** — `vendor/bin/pest tests/Feature/Security tests/Unit/Privacy tests/Unit/Logging`
- [ ] **Step 3: Implement** — move the kit's `login`/`two-factor` limiter definitions out of `FortifyServiceProvider` into `RateLimitServiceProvider`; `config/security.php` computes `csp.s3_private_origin` (scheme+host of `AWS_URL` or `AWS_ENDPOINT`), `csp.s3_public_origin` (origin of `AWS_PUBLIC_URL`), `csp.reverb_host` (`REVERB_HOST`), `csp.report_only` (`CSP_REPORT_ONLY`) with `parse_url` only; `Pulse::user` per `13 §16` item 5 (staff name, else `'Customer …'.substr($id, -6)`); Telescope hides the `dontFlash` keys and headers `authorization`, `cookie`, `x-xsrf-token`.
- [ ] **Step 4: Run tests, expect PASS** — same as Step 2.
- [ ] **Step 5: Quality gates** — Gates-PHP, Gates-Gen.
- [ ] **Step 6: Commit** — `git add app/Http app/Providers app/Support/Privacy app/Support/Logging config bootstrap routes/web.php resources tests` → `feat(security): security headers with CSP nonce, PII log redaction and named rate limiters` + trailer.

### Task 23: Auth middleware and route groups

**Files:**
- Create: `app/Http/Middleware/{EnsureUserIsActive,EnsureUserType,EnsureCustomerOnboarded,EnsureContactVerified,EnsureTwoFactorEnrolled,EnforceAbsoluteSessionLifetime,RequireRecentAuthentication}.php`; `app/Support/Auth/RecentAuthentication.php`; `app/Exceptions/RecentAuthenticationRequired.php`; `routes/api.php`; `routes/webhooks.php`; `tests/Feature/Security/route-access.php`
- Modify: `bootstrap/app.php` (aliases `active, customer, staff, onboarded, verified.contact, 2fa.enrolled, session.absolute, recent.auth`; route files with groups), `routes/customer.php`, `routes/admin.php`, `resources/lang/en/auth.php` (`inactive`, `session_expired`, `2fa_required`), `resources/lang/en/common.php` (`verify_required`)
- Test: `tests/Feature/Auth/Middleware/*Test.php` (one per middleware), `tests/Feature/Security/RouteGroupsTest.php`, `tests/Feature/Security/RouteCoverageTest.php`

**Spec refs:** `13 §1` (alias table, route groups), `§5.10` (2FA exemptions), `§6.1` (absolute lifetime), `§6.4`; `10 §5.1` (onboarding exemptions); `11 §1`; `13 §20.1`; `17 §5.11` (webhooks stateless); `19 §8.5`

**Interfaces:**
- Consumes: Tasks 4, 6, 13, 21.
- Produces: middleware aliases above; route groups — customer `['web','auth','active','customer','onboarded']` (name `customer.`), admin `['web','auth','active','staff','2fa.enrolled','session.absolute']` (prefix `/admin`, name `admin.`), api `['web','auth','active','throttle:api']` (prefix `/api`, name `api.`), webhooks stateless (no `web` group, `throttle:webhooks`, empty until P8); `EnsureCustomerOnboarded::EXEMPT = ['customer.onboarding.*','customer.account.*','customer.help','customer.notifications.index']`; `EnsureTwoFactorEnrolled::EXEMPT = ['admin.security.two-factor','two-factor.*','password.confirm*','logout']`; `RecentAuthentication::passes(Request): bool` (session `auth.password_confirmed_at` or `auth.login_at` within 10 min) and `RecentAuthenticationRequired` (rendered: Inertia/HTML → redirect `password.confirm` for users with a password, `auth.reauthenticate` otherwise, intended URL stored; JSON → 403 `{code: 'recent_auth_required'}`); `route-access.php` map `routeName => ['audience' => 'guest'|'customer'|'staff'|'any'|'public'|'webhook', 'permission' => ?string, 'gate' => ?string]` — **every task that adds a route adds its entry**.

- [ ] **Step 1: Write the failing tests** (tests register stub routes named `customer.onboarding.show`, `admin.security.two-factor`, `auth.reauthenticate` when absent)
  - `active`: inactive customer on `customer.dashboard` → logged out, redirect `login` with error `auth.inactive`; soft-deleted user likewise.
  - `customer`: staff on `customer.dashboard` → redirect `admin.dashboard`. `staff`: customer on `admin.dashboard` → 403 with Inertia component `Error`, prop `status 403`.
  - `onboarded`: `notOnboarded()` customer GET `customer.dashboard` → redirect `/onboarding`; POST to a customer route is not redirected; exempt routes pass; staff unaffected.
  - `verified.contact`: unverified user on a JSON test route → 403 `{code:'contact_unverified'}`; Inertia request → redirect back with `flash.error = trans_icu('common.verify_required')`; phone-verified only → passes.
  - `2fa.enrolled`: admin without `two_factor_confirmed_at` → redirect `admin.security.two-factor` with flash `auth.2fa_required`; owner likewise; estimator passes; exempt route names pass.
  - `session.absolute`: staff with session `auth.login_at` 13 h ago → logout, redirect `login` with `auth.session_expired`; 11 h ago passes; with setting `auth.staff_session_absolute_hours = 1`, 2 h ago expires; customers unaffected.
  - `recent.auth`: `auth.password_confirmed_at` 5 min ago passes; `auth.login_at` 9 min ago passes; 11 min ago → redirect `password.confirm` (user with password) or `auth.reauthenticate` (passwordless); JSON → 403 `recent_auth_required`.
  - `RouteGroupsTest`: `customer.dashboard` middleware equals the customer group; `admin.dashboard` the admin group; every non-vendor route has a name; no two routes share method+path; names start with an allowed prefix (`customer.`, `admin.`, `api.`, `auth.`, `account.`, `staff.`, `legal.`, `media.`, `health.`, `webhooks.`, `links.`, `notifications.`, `csp.`, Fortify names, `welcome`, `manifest`).
  - `RouteCoverageTest`: every route from `route:list --json` (excluding vendor dashboards `horizon.*`, `pulse`, `telescope*`, `storage.local`, `boost.*`) is a key of `route-access.php`; for parameterless GET entries with `permission`/`gate`: owner → 200, a staff user without it → 403, customer → 403/redirect per audience; `audience customer` entries: staff → 302 `admin.dashboard`, guest → 302 `login`.
- [ ] **Step 2: Run, expect FAIL** — `vendor/bin/pest tests/Feature/Auth/Middleware tests/Feature/Security/RouteGroupsTest.php tests/Feature/Security/RouteCoverageTest.php`
- [ ] **Step 3: Implement** — per Interfaces; populate `route-access.php` for all routes existing so far (Fortify routes, `welcome`, `legal.*`, `manifest`, `csp.report`, `customer.dashboard`, `admin.dashboard`).
- [ ] **Step 4: Run tests, expect PASS** — same as Step 2.
- [ ] **Step 5: Quality gates** — Gates-PHP, Gates-Gen.
- [ ] **Step 6: Commit** — `git add app/Http/Middleware app/Support/Auth app/Exceptions bootstrap/app.php routes resources/lang tests` → `feat(auth): access middleware, route groups and route coverage map` + trailer.

### Task 24: Session registry, devices, recent authentication

**Files:**
- Create: `app/Support/Auth/{SessionRegistry,UserAgentSummary,SessionKey}.php`; `app/Http/Middleware/TrackSession.php`; `app/Http/Controllers/Auth/SessionController.php`
- Modify: `config/session.php` (driver/connection/encrypt/cookie from env per `13 §6.1`), `config/database.php` (redis `sessions` connection), `bootstrap/app.php` (append `TrackSession` and `AuthenticateSession` to `web`, alias `track.session`), `app/Providers/AppServiceProvider.php` (`Auth::guard('web')->setRememberDuration(20160)`), `routes/web.php` (`account.sessions.destroy`, `account.sessions.destroy-others`), `route-access.php`
- Test: `tests/Unit/Auth/UserAgentSummaryTest.php`, `tests/Feature/Auth/SessionRegistryTest.php`, `tests/Feature/Auth/SessionRoutesTest.php`

**Spec refs:** `13 §6.1–§6.4`, `§17` (`auth.sessions_revoked`), `§20.10`; master D29

**Interfaces:**
- Consumes: Tasks 22–23 (`Mask`, `recent.auth`).
- Produces: `SessionRegistry` (Redis connection `sessions`): `register(User $u, string $sessionId, Request $r, string $method, bool $remembered): void`, `touch(string $sessionId): void`, `list(User $u, ?string $currentSessionId): list<SessionEntry>` (`{key, uaSummary, ipMasked, lastActiveAt, isCurrent, method}`, prunes entries whose session no longer exists), `destroy(User $u, string $sessionKey): bool`, `destroyOthers(User $u, string $currentSessionId): int` (also rotates `remember_token`), `destroyAll(User $u): int` (rotates `remember_token`); `SessionKey::for(string $sessionId): string` (HMAC-SHA256 with `app.key`, first 32 hex chars — raw session ids never leave the server); `UserAgentSummary::from(string $ua): string` (`"{Browser} on {OS}"`, regex only); routes `account.sessions.destroy` (DELETE `/account/sessions/{sessionKey}`) and `account.sessions.destroy-others` (DELETE `/account/sessions`, `recent.auth`), both `['web','auth','active']`; audit `auth.sessions_revoked {count, reason}` in log `security`.

- [ ] **Step 1: Write the failing tests**
  - `UserAgentSummaryTest` dataset: Chrome/Windows → `'Chrome on Windows'`; Safari/iPhone → `'Safari on iOS'`; Firefox/Linux → `'Firefox on Linux'`; Edge/Windows → `'Edge on Windows'`; Chrome/Android → `'Chrome on Android'`; empty → `'Unknown browser on Unknown OS'`.
  - `SessionRegistryTest` (real Redis DB `REDIS_SESSION_DB`, keys cleaned in `afterEach`): two registered sessions are listed with `ipMasked '203.0.113.0'` and the current flagged; an entry whose session was destroyed in the handler disappears on `list()`; `destroyOthers()` leaves only the current one, returns 1 and changes `remember_token`; `touch()` updates `last_active_at` at most once per 60 s (`Carbon::setTestNow`).
  - `SessionRoutesTest`: `DELETE account.sessions.destroy-others` without recent auth → redirect `password.confirm`; with recent auth → other sessions revoked and activity `auth.sessions_revoked` with `properties.count = 1`; deleting another user's `sessionKey` → 404; `Auth::guard('web')->getRememberDuration() === 20160`.
- [ ] **Step 2: Run, expect FAIL** — `vendor/bin/pest tests/Unit/Auth tests/Feature/Auth/SessionRegistryTest.php tests/Feature/Auth/SessionRoutesTest.php`
- [ ] **Step 3: Implement** — keys `sess:user:{userId}` (ZSET) and `sess:meta:{sessionId}` (HASH, TTL `SESSION_LIFETIME` minutes, +14 days when remembered); destroying uses `Session::getHandler()->destroy($id)`.
- [ ] **Step 4: Run tests, expect PASS** — same as Step 2.
- [ ] **Step 5: Quality gates** — Gates-PHP.
- [ ] **Step 6: Commit** — `git add app/Support/Auth app/Http config bootstrap/app.php app/Providers/AppServiceProvider.php routes/web.php tests` → `feat(auth): session registry with device list and remote sign-out` + trailer.

### Task 25: Fortify login and registration, Turnstile

**Files:**
- Create: `app/Actions/Fortify/{AuthenticateUser,ApplyRememberPolicy,CreateNewUser}.php`; `app/Http/Responses/{LoginResponse,TwoFactorLoginResponse,RegisterResponse}.php`; `app/Support/Auth/IntendedRedirect.php`; `app/Rules/TurnstileToken.php`; `app/Listeners/{RecordSuccessfulLogin,RecordFailedLogin,RecordLockout,RecordLogout}.php`; `app/Domain/Identity/Events/{CustomerRegistered,ContactVerified}.php`; `app/Domain/Identity/Listeners/SendWelcomeNotification.php`; `app/Notifications/Account/Welcome.php`; `resources/js/components/auth/TurnstileWidget.vue`; `resources/js/pages/Auth/{Login,Register}.vue` (replace kit versions)
- Modify: `config/fortify.php` (exactly `13 §2`), `app/Providers/FortifyServiceProvider.php`, `app/Providers/AppServiceProvider.php` (`Password::defaults`), `config/services.php` (`turnstile`), `resources/lang/en/{auth.php,auth_ui.php,notifications.php}`, `route-access.php`
- Test: `tests/Feature/Auth/LoginTest.php`, `tests/Feature/Auth/RegisterTest.php`, `tests/Unit/Rules/TurnstileTokenTest.php`, `resources/js/pages/Auth/__tests__/{Login,Register}.test.ts`

**Spec refs:** `13 §2`, `§3`, `§5.1`, `§5.4`, `§12.7`, `§17` (`auth.login`, `auth.login_failed`, `auth.logout`), `§20.5`; `10 §4.2`, `§4.3`; `12 §3.3` (`account.welcome`), `§3.7`; P1-D5

**Interfaces:**
- Consumes: Tasks 22–24.
- Produces: Fortify wiring per `13 §2` (views → Inertia pages with props `features`, `turnstileSiteKey`, `canRegister`; `authenticateUsing(AuthenticateUser::handle)`; `authenticateThrough` with `ApplyRememberPolicy`); `IntendedRedirect::resolve(Request, User): string` (same-origin intended path else `admin.dashboard`/`customer.dashboard`; Inertia requests get `Inertia::location`); `TurnstileToken(string $action, bool $failOpen)` validation rule; events `CustomerRegistered(User $user)` (`UserNotifiableEvent`-shaped: `eventId()`, `eventKey() = 'account.welcome'`, `subjectUser()`, `occurredAt()`, dispatched after commit) and `ContactVerified(User $user)` (dispatch helper added in Task 26); listener `SendWelcomeNotification` (sends `Welcome` via `database` + `mail`, strings `notifications.account.welcome.customer.{title,body}`); login listener writes `last_login_at`, session `auth.login_at`/`auth.method`, registers the session (`SessionRegistry`), audits `auth.login {method, ip (masked), ua}`.

- [ ] **Step 1: Write the failing tests**
  - `LoginTest` (`13 §20.5`, Review Focus 1): customer login → redirect `customer.dashboard`; staff → `admin.dashboard`; email `"  ASHA@Example.com "` logs in a user stored as `asha@example.com`; wrong password → error `auth.failed`; inactive + wrong password → `auth.failed`; inactive + correct password → `email` error = `__('auth.inactive')`; soft-deleted → `auth.failed`; staff with `remember=on` gets no recaller cookie, customer does; the session id changes on login; the 6th attempt within a minute for the same email+IP is throttled; intended `/projects` honoured, intended `https://evil.test/x` ignored; `last_login_at` set; activity `auth.login` with `properties.method = 'password'` and masked IP; failed login writes `auth.login_failed` with masked email and no causer; logout writes `auth.logout` and removes the registry entry.
  - `RegisterTest` (`13 §5.1`): valid → `type customer`, `terms_accepted_at` set, `timezone 'Asia/Kolkata'`, `unit_system 'metric'`, `length_unit 'mm'`, `locale 'en'`, `marketing_opt_in false`, `email` lower-cased; `Registered` and `CustomerRegistered` dispatched; `Welcome` notification sent via `database` and `mail`; name `Visit https://x.test` rejected; email belonging to a soft-deleted user → error `auth.email_unavailable`; missing `terms` → error; setting `auth.allow_customer_registration = false` → `canRegister false` on GET and POST 403; the 6th registration from one IP within an hour is throttled; `Password::defaults()` = min 8 outside production, min 10 + `uncompromised` in production.
  - `TurnstileTokenTest`: `features.captcha` false → passes without token; enabled + `Http::fake` `{success: true, hostname: <APP_URL host>, action: 'register'}` → passes; wrong `action` → fails; wrong `hostname` → fails; connection exception with `failOpen: true` → passes and logs warning `captcha.unavailable`; with `failOpen: false` → fails with `auth.captcha_unavailable`.
  - Vitest: `Register` with `canRegister=false` renders only `auth.registration_closed`; `TurnstileWidget` renders only when `features.captcha`; `Login` renders the remember checkbox checked by default.
- [ ] **Step 2: Run, expect FAIL** — `vendor/bin/pest tests/Feature/Auth/LoginTest.php tests/Feature/Auth/RegisterTest.php tests/Unit/Rules && yarn vitest run resources/js/pages/Auth`
- [ ] **Step 3: Implement** — per `13 §2`/`§5.1`; Turnstile widget loads the Cloudflare script with the page nonce; Login/Register pages per `10 §4.2`/`§4.3` without the Google and phone links (added by Tasks 28 and 29).
- [ ] **Step 4: Run tests, expect PASS** — same as Step 2.
- [ ] **Step 5: Quality gates** — Gates-PHP, Gates-JS, Gates-Gen.
- [ ] **Step 6: Commit** — `git add app config resources tests` → `feat(auth): Fortify login and registration with remember policy, Turnstile and audit` + trailer.

### Task 26: Password reset, email verification, profile and password updates, `ContactVerified`

**Files:**
- Create: `app/Actions/Fortify/{ResetUserPassword,UpdateUserProfileInformation,UpdateUserPassword}.php` (replace kit versions); `app/Http/Responses/GenericPasswordResetLinkResponse.php`; `app/Notifications/Auth/{ResetPassword,VerifyEmail}.php`; `app/Domain/Identity/Support/ContactVerification.php`; `app/Listeners/HandleEmailVerified.php`; `resources/js/pages/Auth/{ForgotPassword,ResetPassword,VerifyEmail,ConfirmPassword}.vue`
- Modify: `User` (`sendPasswordResetNotification`, `sendEmailVerificationNotification` no-op without email, `markEmailAsVerified` via `ContactVerification`), `config/auth.php` (`passwords.users.expire 60`, `throttle 60`, `verification.expire 60`, `password_timeout 600`), `app/Providers/FortifyServiceProvider.php`, `resources/lang/en/{passwords,auth,notifications,account}.php`, `route-access.php`
- Test: `tests/Feature/Auth/{ForgotPasswordTest,ResetPasswordTest,EmailVerificationTest,ProfileInformationTest,PasswordUpdateTest,ContactVerifiedTest}.php`

**Spec refs:** `13 §2` (notifications, auth config), `§5.5`, `§5.6`, `§5.8`, `§17`, `§20.11`; `10 §4.5`, `§4.6`, `§4.8`; `12 §3.3`; P1-D5

**Interfaces:**
- Consumes: Tasks 23–25.
- Produces: `ContactVerification::markEmailVerified(User $u): void` and `markPhoneVerified(User $u): void` (set timestamps; dispatch `ContactVerified` after commit iff both were null before); `ResetPassword`/`VerifyEmail` mail notifications (keys `notifications.auth.password_reset.{subject,title,body,action}`, `notifications.auth.email_verification.{…}`; verification URL = temporary signed `verification.verify`, 60 min); generic forgot-password response (`status` = `trans('passwords.sent_generic')` for existing, unknown, throttled users); profile update rules of `13 §5.8` (email change requires recent auth via `RecentAuthenticationRequired`; unique incl. soft-deleted → `auth.email_unavailable`; clearing the last login method → `auth.errors.last_login_method`; audit `account.email_changed` with masked `from`/`to`); password update (current password only when the user has one; destroys other sessions; audit `auth.password_changed`); reset (`email_verified_at ??= now()` through `ContactVerification`, rotate `remember_token`, `SessionRegistry::destroyAll`, audit `auth.password_reset`).

- [ ] **Step 1: Write the failing tests**
  - `ForgotPasswordTest`: existing and unknown email get the identical response (status text and redirect); `ResetPassword` is sent only to the existing user; the 4th request for one email within an hour still returns the generic response; a passwordless user with an email receives a link.
  - `ResetPasswordTest`: valid token sets the new password, sets `email_verified_at` when null, rotates `remember_token`, destroys the user's registered sessions, writes `auth.password_reset`; the token works once; after 61 minutes it is rejected.
  - `EmailVerificationTest`: the signed link verifies and writes `account.email_verified`; a link opened 61 minutes later is rejected; a logged-out click redirects to `login` and returns after sign-in; `sendEmailVerificationNotification()` sends nothing for a phone-only user.
  - `ContactVerifiedTest`: first verification (email) dispatches `ContactVerified` once; a later phone verification does not; a user created already verified (`markPhoneVerified` on a new user with both null) dispatches once.
  - `ProfileInformationTest`: email change without recent auth → redirect `password.confirm`; with recent auth → email updated, `email_verified_at` null, `VerifyEmail` sent, activity `account.email_changed` with masked values; email used by a soft-deleted user → `auth.email_unavailable`; clearing the email of a user without phone/Google → `auth.errors.last_login_method`; `marketing_opt_in` saved.
  - `PasswordUpdateTest`: wrong `current_password` → error; passwordless user sets a password without `current_password`; other sessions destroyed; activity `auth.password_changed`.
- [ ] **Step 2: Run, expect FAIL** — `vendor/bin/pest tests/Feature/Auth`
- [ ] **Step 3: Implement** — per Interfaces; pages per `10 §4.5`, `§4.6`, `§4.8`.
- [ ] **Step 4: Run tests, expect PASS** — `vendor/bin/pest tests/Feature/Auth`
- [ ] **Step 5: Quality gates** — Gates-PHP, Gates-JS, Gates-Gen.
- [ ] **Step 6: Commit** — `git add app config resources tests` → `feat(auth): password reset, email verification, profile updates and ContactVerified` + trailer.

### Task 27: Phone OTP core

**Files:**
- Create: `app/Domain/Identity/Actions/{SendOtp,VerifyOtp}.php`; `app/Domain/Identity/Otp/{OtpDelivery,LogOtpDelivery,ArrayOtpDelivery,OtpChannelResolver,OtpSendResult,OtpException,OtpDeliveryException}.php`; `app/Support/Phone/{PhoneNumberParser,ParsedPhone}.php`; `app/Console/Commands/{OtpMonitor,OtpPrune}.php`
- Modify: `app/Providers/AppServiceProvider.php` (bind `OtpDelivery` → `LogOtpDelivery`), `tests/Pest.php` (Feature suite binds `ArrayOtpDelivery`), `config/logging.php` (`otp-dev` channel, local only), `resources/lang/en/notifications.php` (`auth.otp.sms`)
- Test: `tests/Feature/Auth/Otp/{SendOtpTest,VerifyOtpTest,OtpCommandsTest,OtpDeliveryTest}.php`, `tests/Unit/Phone/PhoneNumberParserTest.php`

**Spec refs:** `13 §4.1–§4.5`, `§17` (`auth.otp_sent`, `auth.otp_locked`), `§20.6`; `12 §2` (availability), `§3.7` (OTP SMS text); `02 §1.3`, `§13` (`notifications.otp_channel_order`, `sms_templates`, `auth.*`); P1-D6, P1-D12

**Interfaces:**
- Consumes: Tasks 6, 22.
- Produces: `PhoneNumberParser::parse(string $raw, string $defaultRegion, array $allowedRegions): ParsedPhone {e164, region}` throwing `OtpException` codes `phone_invalid` / `phone_not_mobile` / `phone_country_not_supported` (422); `SendOtp::handle(string $rawPhone, OtpPurpose $purpose, ?string $ip, ?string $captchaToken): OtpSendResult {channel: OtpChannel, maskedPhone: string, otpId: string, e164: string}`; `VerifyOtp::handle(string $e164, OtpPurpose $purpose, string $code, ?string $ip): OtpCode`; `OtpException(string $code, int $status, array $context = [])` with codes `otp_cooldown` (429, `retryAfter`), `otp_rate_limited` (429), `captcha_required` (422), `otp_unavailable` (503), `otp_send_failed` (503), `otp_invalid` (422, `attemptsLeft`), `otp_expired` (422), `otp_too_many_attempts` (422); `OtpDelivery::send(OtpChannel $channel, string $e164, string $message, string $otpId): void` (throws `OtpDeliveryException`); `OtpChannelResolver::available(string $e164): list<OtpChannel>` (order from `notifications.otp_channel_order`; WhatsApp needs `features.whatsapp` + `whatsapp_templates['auth.otp']`; SMS needs `features.sms` + `sms_templates['auth.otp']` + global counter `otp:global:{YmdH}` below `auth.otp_global_hourly_cap`); `ArrayOtpDelivery::sent(): list<array{channel, e164, message, otpId}>` and `lastCode(): ?string` for tests; commands `otp:monitor`, `otp:prune`.

- [ ] **Step 1: Write the failing tests**
  - `PhoneNumberParserTest` (Review Focus 2; region `IN`, allowed `['IN']`): `09876 543 210`, `+91-98765-43210`, `+91 98765 43210`, `9876543210` → `'+919876543210'`; `+91 80 2222 3333` → `phone_not_mobile`; `+1 415 555 0100` → `phone_country_not_supported`; `12ab` → `phone_invalid`.
  - `SendOtpTest`: the code delivered is 6 digits and `Hash::check($code, otp_codes.code_hash)`; `expires_at = now()+10 min`; a second send for the same phone+purpose expires the first unconsumed code; second send within 60 s → `otp_cooldown` with `retryAfter` 1…60, after 61 s ok; 6th send in an hour for one phone → `otp_rate_limited`; 11th send in an hour from one IP across different phones → `otp_rate_limited`; with `features.captcha` on, the 3rd send without token → `captcha_required`, with a valid token (Http fake) → ok; `Cache::put('auth:captcha_always', true)` → captcha required on the 1st send; no channel available → `otp_unavailable` + `Log::critical('otp.no_channel')`; WhatsApp configured but delivery throws → falls back to SMS and `otp_codes.channel = 'sms'`; all channels throw → `otp_send_failed` and the row is expired; global cap reached → SMS excluded; nothing is pushed to the queue (`Queue::fake` asserts nothing) and no log record contains the code (`Log::spy`); activity `auth.otp_sent` with masked phone, channel, purpose, masked IP; session `otp.sends` incremented.
  - `VerifyOtpTest`: input `12 34` → `otp_invalid` without consuming an attempt; wrong code → `otp_invalid` with `attemptsLeft 4`; after 5 wrong codes the next attempt → `otp_too_many_attempts`, the code is expired and `auth.otp_locked` is audited; correct code → row consumed and phone limiter hits cleared; verifying the same code twice (Review Focus 5) → second `otp_expired`; after 10 min → `otp_expired`; the 11th verify per minute from one IP → 429.
  - `OtpCommandsTest`: 50 sent / 9 consumed in the last hour → `auth:captcha_always` set for 1 h, `health:otp.status === 'low_conversion'`, `Log::critical('otp.low_conversion')`; 50/10 → not set; 49/0 → not set; `otp:prune` deletes only rows with `expires_at < now() - 24h`.
  - `OtpDeliveryTest`: `LogOtpDelivery` in env `testing` logs masked phone and channel without the message; in env `local` logs the full message to `otp-dev`.
- [ ] **Step 2: Run, expect FAIL** — `vendor/bin/pest tests/Feature/Auth/Otp tests/Unit/Phone`
- [ ] **Step 3: Implement** — steps exactly as `13 §4.2`/`§4.3` (atomic attempt `UPDATE … SET attempts = attempts + 1 … WHERE id = ? AND attempts < 5 RETURNING attempts`; consume `WHERE consumed_at IS NULL`); message = `trans_icu('notifications.auth.otp.sms', ['code' => …, 'appName' => …, 'domain' => host of APP_URL])`; delivery is synchronous.
- [ ] **Step 4: Run tests, expect PASS** — same as Step 2.
- [ ] **Step 5: Quality gates** — Gates-PHP.
- [ ] **Step 6: Commit** — `git add app/Domain/Identity app/Support/Phone app/Console/Commands app/Providers config/logging.php resources/lang tests` → `feat(auth): phone OTP send/verify with limits, captcha escalation and conversion monitor` + trailer.

### Task 28: Google OAuth

**Files:**
- Create: `app/Http/Controllers/Auth/GoogleController.php`; `resources/js/components/auth/GoogleButton.vue`
- Modify: `config/services.php` (`google`), `routes/web.php` (`auth.google.redirect`, `auth.google.callback`, `account.google.unlink`), `resources/js/pages/Auth/{Login,Register}.vue` (Google button + caption), `resources/lang/en/{auth,auth_ui}.php`, `route-access.php`
- Test: `tests/Feature/Auth/GoogleOAuthTest.php`, `resources/js/components/auth/__tests__/GoogleButton.test.ts`

**Spec refs:** `13 §5.3`, `§5.4`, `§5.9` step 4, `§6.2`, `§17` (`auth.google_linked`, `auth.google_unlinked`), `§20.7`; master §6.7 (`features.google_login`); P1-D11

**Interfaces:**
- Consumes: Tasks 23–26 (`IntendedRedirect`, `ContactVerification`, `CustomerRegistered`).
- Produces: `GET /auth/google/redirect?intent=login|link|invitation|reauthenticate` (throttle `oauth`; 404 when `features.google_login` is false; `link`/`reauthenticate` require auth; `invitation` requires session `invitation.id`), stateful Socialite with scopes `openid profile email` and `prompt=select_account`; callback branches of `13 §5.3` steps 1–7 plus `reauthenticate` (Google id must equal the current user's → session `auth.password_confirmed_at = now()`, redirect intended; else `auth.errors.google_email_mismatch`); for `invitation` the callback stores session `invitation.google_id` + name prefill and redirects to session `invitation.url`; `DELETE /account/google` (`recent.auth`) unlinks only when a password or verified phone remains (else 422 `auth.errors.last_login_method`).

- [ ] **Step 1: Write the failing tests** (Socialite mocked via `Socialite::shouldReceive('driver')`)
  - `?error=access_denied` → redirect `login` with `auth.errors.oauth_cancelled`; `InvalidStateException` → `auth.errors.oauth_state_invalid`; other exception → `auth.errors.oauth_failed` + warning log; `email_verified: false` → `auth.errors.google_email_unverified`.
  - intent `login`: known `google_id` → logged in (customer with remember); unknown id but email `Asha@Example.com` matching `asha@example.com` → links `google_id`, sets `email_verified_at`, audits `auth.google_linked` (Review Focus 1); soft-deleted match → `auth.errors.account_pending_deletion`; inactive → `auth.inactive`; email with a pending staff invitation → `auth.errors.pending_staff_invitation` and no user created; new email → customer created (`password null`, `terms_accepted_at` set, `email_verified_at` set, name fallback = part before `@` when Google name is empty), `CustomerRegistered` and `ContactVerified` dispatched; registration closed → `auth.registration_closed`; staff with confirmed 2FA → not logged in, session `login.id` set, redirect `two-factor.login`; staff without 2FA → logged in without remember; session id regenerated.
  - intent `link`: id used by another user → `auth.errors.google_in_use`; different email → `auth.errors.google_email_mismatch`; phone-only user → email set + verified unless taken (`auth.errors.email_unavailable`).
  - intent `invitation`: without session `invitation.id` → 403; email ≠ invitation email → `auth.errors.google_email_mismatch`; match → session `invitation.google_id` set, redirect to `invitation.url`.
  - intent `reauthenticate`: matching id → `auth.password_confirmed_at` set; mismatch → error.
  - unlink: without recent auth → redirect `password.confirm`; user with password → unlinked + `auth.google_unlinked`; Google-only user without phone → 422 `auth.errors.last_login_method`.
  - `features.google_login = false` → redirect route 404.
  - Vitest: `GoogleButton` renders only when `features.google_login` and shows the terms caption.
- [ ] **Step 2: Run, expect FAIL** — `vendor/bin/pest tests/Feature/Auth/GoogleOAuthTest.php && yarn vitest run resources/js/components/auth`
- [ ] **Step 3: Implement** — per Interfaces.
- [ ] **Step 4: Run tests, expect PASS** — same as Step 2.
- [ ] **Step 5: Quality gates** — Gates-PHP, Gates-JS, Gates-Gen.
- [ ] **Step 6: Commit** — `git add app/Http/Controllers/Auth config/services.php routes/web.php resources tests` → `feat(auth): Google OAuth login, linking, invitation and re-authentication intents` + trailer.

### Task 29: Phone OTP routes and pages, phone verification, re-authentication

**Files:**
- Create: `app/Http/Controllers/Auth/{PhoneOtpController,AccountPhoneController,ReauthenticateController}.php`; `app/Http/Requests/Auth/*.php`; `app/Domain/Identity/Actions/RegisterCustomer.php`; `resources/js/pages/Auth/{PhoneLogin,PhoneVerify,PhoneComplete,Reauthenticate}.vue`; `resources/js/components/account/PhoneVerifyDialog.vue`; `resources/js/components/common/VerifyContactBanner.vue`
- Modify: `routes/web.php` (8 `auth.otp.*` routes, `account.phone.send`, `account.phone.verify`, `auth.reauthenticate`, `auth.reauthenticate.store`), `resources/js/layouts/CustomerLayout.vue` (`#banner` → `VerifyContactBanner`), `resources/js/pages/Auth/{Login,Register}.vue` ("Use my phone instead" when `features.whatsapp || features.sms`), `resources/lang/en/{auth,auth_ui,account,common}.php`, `route-access.php`
- Test: `tests/Feature/Auth/Otp/{PhoneLoginFlowTest,AccountPhoneTest,ReauthenticateTest}.php`, `resources/js/pages/Auth/__tests__/PhoneVerify.test.ts`, `resources/js/components/account/__tests__/PhoneVerifyDialog.test.ts`

**Spec refs:** `13 §4.4`, `§5.2`, `§5.7`, `§6.2`, `§6.4`, `§17` (`account.phone_verified`), `§20.6`; `10 §1.1`, `§4.4`, `§4.8`, `§13.2.3`; `15 §9.31` (VerifyContactBanner, PhoneVerifyDialog); P1-D11

**Interfaces:**
- Consumes: Task 27 actions, Task 26 `ContactVerification`, Task 28 Google intents.
- Produces: routes and bodies exactly `13 §5.2` (`auth.otp.create` GET `/login/phone`, `auth.otp.send` POST `/auth/otp/send` `{phone, intent, name?, terms?, cf_turnstile_response?}`, `auth.otp.verify.show`, `auth.otp.verify` `{code}`, `auth.otp.resend` `{channel?, cf_turnstile_response?}`, `auth.otp.status` JSON `{channel, fallbackSent}`, `auth.otp.complete.show`, `auth.otp.complete` `{name, terms}`; all `guest` except `status`); `RegisterCustomer::fromPhone(string $e164, string $name): User` (phone verified, `password null`, `email null`, `terms_accepted_at now`, defaults of `13 §5.1`, dispatches `CustomerRegistered`, `ContactVerified`); `account.phone.send` `{phone}` / `account.phone.verify` `{code}` (purpose `verify_phone`; another user incl. soft-deleted holding the number → 422 `auth.errors.phone_unavailable`); `auth.reauthenticate` GET page / `auth.reauthenticate.store` POST `{code?}` (no code → send OTP purpose `login` to the user's verified phone; with code → verify, set `auth.password_confirmed_at`, redirect intended); `OtpException` rendering: JSON `{code, …context}` with its status; Inertia → back with field error (`phone` for parse/send errors, `code` for verify errors) using `auth.errors.{code}` (`otp_invalid` uses `trans_choice` with `:attemptsLeft`).

- [ ] **Step 1: Write the failing tests**
  - `PhoneLoginFlowTest`: send for an existing and a non-existing number return the same redirect and the same flash keys (`channel`, `maskedPhone`); verify for an existing customer logs in with remember, sets `phone_verified_at` when null, regenerates the session, forgets `otp.challenge`; staff number → `auth.errors.staff_use_email`, not logged in; soft-deleted → `auth.errors.account_pending_deletion`; inactive → `auth.inactive`; new number with `intent=register`, name and terms → account created and logged in, `CustomerRegistered` + `ContactVerified` dispatched, no welcome mail (no email); new number without name → redirect `auth.otp.complete.show`; complete within 15 min creates the account; complete after 16 min → redirect `auth.otp.create` with `auth.errors.otp_expired`; registration closed → `auth.registration_closed`; `auth.otp.verify.show` without challenge → redirect `auth.otp.create`; `auth.otp.status` returns `{channel: 'sms', fallbackSent: false}`.
  - `AccountPhoneTest`: send + verify sets `phone_e164`, `phone_verified_at`, audits `account.phone_verified` with masked numbers; a number held by a soft-deleted user → `auth.errors.phone_unavailable`; staff can add a phone; first verified contact dispatches `ContactVerified`.
  - `ReauthenticateTest`: passwordless phone user → POST without code sends OTP; POST with the code sets `auth.password_confirmed_at` and redirects to the intended URL; wrong code → error on `code`.
  - Vitest: `PhoneVerify` auto-submits when 6 digits are entered; resend buttons disabled during the 60 s countdown; `PhoneVerifyDialog` moves from phone step to code step after a successful send and emits `verified`.
- [ ] **Step 2: Run, expect FAIL** — `vendor/bin/pest tests/Feature/Auth/Otp && yarn vitest run resources/js/pages/Auth resources/js/components/account`
- [ ] **Step 3: Implement** — pages per `10 §4.4`/`§4.8` (WebOTP via `navigator.credentials.get` guarded by `'OTPCredential' in window`, aborted on unmount); `VerifyContactBanner` per `10 §1.1`.
- [ ] **Step 4: Run tests, expect PASS** — same as Step 2.
- [ ] **Step 5: Quality gates** — Gates-PHP, Gates-JS, Gates-Gen.
- [ ] **Step 6: Commit** — `git add app routes/web.php resources tests` → `feat(auth): phone OTP sign-in/sign-up, phone verification and re-authentication` + trailer.

### Task 30: Staff invitations and staff management

**Files:**
- Create: `app/Domain/Identity/Actions/{InviteStaff,ResendStaffInvitation,RevokeStaffInvitation,AcceptStaffInvitation,ChangeStaffRole,DeactivateUser,ReactivateUser,ResetTwoFactor}.php`; `app/Notifications/Staff/StaffInvited.php`; `app/Http/Controllers/Admin/{StaffController,StaffInvitationController}.php`; `app/Http/Controllers/Auth/StaffInvitationController.php`; `app/Http/Requests/Admin/Staff/*.php`; `resources/js/pages/Admin/Staff/Index.vue`; `resources/js/components/admin/staff/{InviteStaffDialog,EditStaffDialog}.vue`; `resources/js/pages/Auth/{AcceptInvitation,InvitationInvalid}.vue`
- Modify: `routes/admin.php` (`admin.staff.index`, `.invitations.store|resend|revoke`, `.update`, `.deactivate`, `.activate`, `.two-factor.reset`), `routes/web.php` (`staff.invitations.show`, `staff.invitations.accept`, `signed` middleware), `resources/js/lib/adminNav.ts` (Staff item, `staff.manage`), `resources/lang/en/{staff,roles,notifications}.php`, `route-access.php`
- Test: `tests/Feature/Staff/{InviteStaffTest,AcceptInvitationTest,StaffManagementTest}.php`, `resources/js/components/admin/staff/__tests__/InviteStaffDialog.test.ts`

**Spec refs:** `13 §5.9`, `§5.10` (reset by others), `§7.3` (admin restrictions), `§13`, `§17` (staff log), `§20.4`, `§20.8`; `11 §2.2`, `§7`, `§7.1`; `12 §3.3`, `§3.7` (`staff.invited`)

**Interfaces:**
- Consumes: Tasks 13, 24, 26, 28.
- Produces: actions (each audits in log `staff`/`security` per `13 §17`): `InviteStaff::handle(User $actor, string $email, string $name, StaffRole $role): StaffInvitation` (422 `staff.email_in_use` if any user incl. soft-deleted has the email; 422 `staff.invitation_pending`; owner role requires gate `staff.manage_owners`); `ResendStaffInvitation` (extends `expires_at` to now+72 h, new mail); `RevokeStaffInvitation`; `AcceptStaffInvitation::handle(StaffInvitation $inv, string $name, string $password, ?string $googleId): User` (row lock; re-checks pending/unexpired); `ChangeStaffRole::handle(User $actor, User $staff, string $name, StaffRole $role)` (`syncRoles([$role])`; audit `staff.role_changed {from, to}`); `DeactivateUser`/`ReactivateUser` (sessions destroyed, `remember_token` rotated); `ResetTwoFactor` (clears Fortify columns, destroys sessions, audit `auth.2fa_reset`); rules: last active owner cannot be deactivated/demoted (422 `staff.last_owner`), actors cannot change their own role or deactivate themselves (422 `staff.errors.self`), owners only via gate; `StaffInvited` mail with `URL::temporarySignedRoute('staff.invitations.show', $inv->expires_at, ['invitation' => $id])`; page props `StaffIndexProps` exactly `11 §7`.

- [ ] **Step 1: Write the failing tests**
  - `InviteStaffTest`: admin invites estimator → row with `expires_at = now()+72h` (lower-cased email), `StaffInvited` mailed to the address (on-demand) with a signed link, audit `staff.invited` with masked email; email of an existing customer (incl. soft-deleted) → `staff.email_in_use`; second invite while pending → `staff.invitation_pending`; admin inviting `owner` → 403, owner may; estimator → 403; the 21st invite in a day → 429 (`invitations`); resend extends expiry and re-mails; revoke sets `revoked_at`.
  - `AcceptInvitationTest` (`13 §20.8`): tampered signature → `Auth/InvitationInvalid` reason `invalid`; after 73 h → `expired`; revoked → `revoked`; accepted → `accepted`; logged-in visitor → `signed_in`; valid accept → staff user with role, `email_verified_at`, `terms_accepted_at`, `timezone 'Asia/Kolkata'`, logged in without remember, redirect `admin.dashboard`, `ContactVerified` dispatched, audit `staff.invitation_accepted`; session `invitation.google_id` is stored when unused; a second POST with the same link (Review Focus 5) → `InvitationInvalid` reason `accepted` and still one user.
  - `StaffManagementTest`: index props shape (`staff`, `invitations` = pending + expired within 30 days, `roles` with `assignable false` for owner unless gate, `currentUserId`, rows with `twoFactorRequired` true for owner/admin); admin cannot change own role or deactivate self → `staff.errors.self`; deactivating or demoting the last active owner → `staff.last_owner`; admin cannot edit an owner (403); role change syncs exactly one role and audits from/to; deactivate → `is_active false`, sessions destroyed, `remember_token` rotated, audit `staff.deactivated`; reset 2FA clears `two_factor_*` and audits `auth.2fa_reset`.
  - Vitest: `InviteStaffDialog` hides the owner option when `can('staff.manage_owners')` is false.
- [ ] **Step 2: Run, expect FAIL** — `vendor/bin/pest tests/Feature/Staff && yarn vitest run resources/js/components/admin`
- [ ] **Step 3: Implement** — per Interfaces; `AcceptInvitation` page includes `GoogleButton` (`intent=invitation`) storing `invitation.id`/`invitation.url` in session first.
- [ ] **Step 4: Run tests, expect PASS** — same as Step 2.
- [ ] **Step 5: Quality gates** — Gates-PHP, Gates-JS, Gates-Gen.
- [ ] **Step 6: Commit** — `git add app routes resources tests` → `feat(staff): staff invitations, acceptance and staff management` + trailer.

### Task 31: Two-factor authentication enforcement

**Files:**
- Create: `app/Http/Middleware/{PreventRequiredTwoFactorDisable,PreventCustomerTwoFactor}.php`; `app/Http/Controllers/Admin/Account/TwoFactorController.php`; `app/Listeners/RecordTwoFactorEvents.php`; `app/Console/Commands/ResetTwoFactorCommand.php`; `resources/js/pages/Admin/Account/TwoFactor.vue`; `resources/js/pages/Auth/TwoFactorChallenge.vue` (replace kit)
- Delete: remaining kit Vue files and the `LEGACY_KIT_FILES` block in `eslint.config.js`
- Modify: `bootstrap/app.php` (both middleware in `web`), `routes/admin.php` (`admin.security.two-factor`), `resources/lang/en/{auth,auth_ui,account}.php`, `route-access.php`
- Test: `tests/Feature/Auth/TwoFactorTest.php`, `resources/js/pages/Admin/Account/__tests__/TwoFactor.test.ts`

**Spec refs:** `13 §5.10`, `§17` (2FA events), `§20.9`; `11 §18` (Two-factor page); `10 §4.7`

**Interfaces:**
- Consumes: Task 23 `2fa.enrolled`, Task 30 `ResetTwoFactor`.
- Produces: page `admin.security.two-factor` (GET `/admin/account/two-factor`, `Admin/Account/TwoFactor`, exempt from `2fa.enrolled`) — enable (password-confirmed) → QR SVG + setup key → confirm → 8 recovery codes with Copy/Download `{app-name}-recovery-codes.txt` and required "I saved these codes" checkbox, regenerate; Disable hidden for owner/admin; `PreventRequiredTwoFactorDisable` (route `two-factor.disable` → 403 `auth.errors.2fa_required` for owner/admin); `PreventCustomerTwoFactor` (`two-factor.*` → 403 for customers); audits `auth.2fa_enabled` / `auth.2fa_disabled` / `auth.recovery_code_used`; command `furny:reset-two-factor {email}` (audit with causer null and `via: console`).

- [ ] **Step 1: Write the failing tests**
  - Owner without 2FA requesting `admin.dashboard` → redirect `admin.security.two-factor`; after enabling + confirming with a valid TOTP (`Google2FA` from the stored secret) → passes; owner `DELETE /user/two-factor-authentication` → 403; estimator may disable; customer `POST /user/two-factor-authentication` → 403; a recovery code logs in once and fails the second time, auditing `auth.recovery_code_used`; the 6th challenge attempt in a minute → 429; `furny:reset-two-factor owner@x.test` clears the columns and audits `auth.2fa_reset` with `via: console`.
  - Vitest: the confirm button for recovery codes stays disabled until the checkbox is ticked; Disable is not rendered for role `admin`.
- [ ] **Step 2: Run, expect FAIL** — `vendor/bin/pest tests/Feature/Auth/TwoFactorTest.php && yarn vitest run resources/js/pages/Admin`
- [ ] **Step 3: Implement** — per Interfaces; remove the legacy kit files and ignore block (`yarn lint` must pass with `vue/no-bare-strings-in-template` on every file).
- [ ] **Step 4: Run tests, expect PASS** — same as Step 2.
- [ ] **Step 5: Quality gates** — Gates-PHP, Gates-JS, Gates-Gen.
- [ ] **Step 6: Commit** — `git add -A app bootstrap/app.php routes resources eslint.config.js tests` → `feat(auth): mandatory TOTP for owners/admins and two-factor management page` + trailer.

### Task 32: Upload intents backend

**Files:**
- Create: `app/Domain/Shared/Actions/{CreateUploadIntent,ConfirmUploadIntent,ConsumeUploadIntent}.php`; `app/Domain/Shared/Jobs/ProcessUpload.php`; `app/Domain/Shared/Data/{PresignUploadData,UploadIntentStatusData}.php`; `app/Support/Uploads/{MagicBytes,ImageSanitizer,FileName,UploadPresigner,S3UploadPresigner,PresignedRequest,HeicConverter,VisionHeicConverter,UploadRejected}.php`; `app/Http/Controllers/Api/UploadController.php`; `app/Http/Requests/Api/PresignUploadRequest.php`; `app/Console/Commands/CleanupOrphanMedia.php`; `tests/fixtures/uploads/generate.py` and its outputs (`exif-gps-rotated.jpg`, `plain.png`, `plain.webp`, `png-as-jpg.jpg`, `doc.pdf`, `plan.dxf`, `binary.dxf`, `drawing-as-dxf.dxf` (DWG `AC1032` header), `vector.svg`, `bomb-50mp.png` (IHDR 8000×6250, tiny IDAT))
- Modify: `UploadPurpose` (methods below), `routes/api.php` (`api.uploads.presign`, `api.uploads.confirm`, `api.uploads.show`), `resources/lang/en/uploads.php` (`errors.*`), `route-access.php`
- Test: `tests/Feature/Uploads/{PresignTest,ConfirmTest,ProcessUploadTest,ConsumeUploadIntentTest,CleanupOrphanMediaTest}.php`, `tests/Unit/Uploads/{MagicBytesTest,FileNameTest}.php`

**Spec refs:** `13 §11.1–§11.7`, `§20.12`; `02 §1.6`, `§10`; `06 §2.1` (blueprint extensions), `§5.8` (normalize endpoint); `01 §7` (`ProcessUpload` on `default`), master D20

**Interfaces:**
- Consumes: Tasks 5, 14–15 (target authorisation), 22 (limiters).
- Produces:
  - `UploadPurpose` methods: `allowedSniffedTypes(): list<string>` (`jpeg, png, webp, heic, pdf, dxf` subsets per `13 §11.1`), `allowedDeclaredMimes(): list<string>`, `maxBytes(?string $extension = null): int` (25 MB; DXF 15 MB for `blueprint_source`; 15/5/2/4 MB per row), `reencodes(): bool`, `maxEdge(): ?int` (avatar 512, business_logo 1024, textures 1024 square, hardware 1600, photos 4096), `targetType(): ?string` (morph alias or null) and `authorizeTarget(User $u, ?Model $target): void` (the policy/permission of `13 §11.1`; 404/403 on failure).
  - `CreateUploadIntent::handle(User $u, PresignUploadData $d): array{uploadId: string, url: string, headers: array<string,string>}` (validation + error codes `upload_type_not_allowed`, `unsupported_type`, `dwg_not_supported`, `file_too_large`; `object_key = tmp/{purpose}/{Y}/{m}/{ulid}`, `expires_at = now()+15 min`).
  - `UploadPresigner::presignPut(string $key, string $contentType, int $size, CarbonInterface $expiresAt): PresignedRequest {url, headers}` (`S3UploadPresigner` uses `Storage::disk('s3')->temporaryUploadUrl` with `ContentType` + `ContentLength`; tests bind a fake).
  - `ConfirmUploadIntent::handle(User $u, UploadIntent $i): void` (size check via `Storage::disk('s3')->size()`; mismatch → delete object, `rejected`, 422 `upload_size_mismatch`; else `uploaded` + dispatch `ProcessUpload` on queue `default`, timeout 60, tries 2) → controller responds `202 {uploadId, status: 'processing'}`; `api.uploads.show` → `{status, reasonCode, previewUrl}`.
  - `MagicBytes::detect(string $path): ?string` (`jpeg|png|webp|heic|pdf|dxf|dwg|null`); `ImageSanitizer::sanitize(string $path, string $type, ?int $maxEdge): array{path, width, height}`; `FileName::sanitize(string $name, ?string $canonicalExtension = null): string`; `HeicConverter::toJpeg(string $sourceKey, string $targetKey): void` (`VisionHeicConverter` posts `{sourceUrl, targetUrl, format: 'jpeg', quality: 85, maxEdge: 4096, applyOrientation: true}` to `{imports.vision.url}/v1/images/normalize` with bearer `imports.vision.token`, timeout `imports.vision.normalize_timeout_s`; end-to-end verified once P3 ships the endpoint).
  - `ConsumeUploadIntent::handle(User $u, string $uploadId, UploadPurpose $p, ?Model $target, HasMedia $model, string $collection): Media` (422 `{code: 'upload_invalid', uploadId}` unless owned, `ready`, same purpose/target, not consumed; marks `consumed`).
  - Command `media:cleanup-orphans` (deletes non-consumed intents older than 24 h and their `object_key`/`processed_key` objects).

- [ ] **Step 1: Write the failing tests** (Review Focus 3; `Storage::fake('s3')`, fake presigner, `Queue::fake`)
  - `PresignTest`: avatar `image/png` 1 MB → 200 `{uploadId, url, headers}` with `Content-Type: image/png` and `Content-Length: 1048576`, row `pending`, key prefix `tmp/avatar/`, `expires_at` +15 min; avatar `image/svg+xml` → 422 `upload_type_not_allowed`; size 0 or 5 MB + 1 → 422 `file_too_large`; `blueprint_source` `plan.dwg` → 422 `dwg_not_supported`; `blueprint_source` `photo.bmp` → 422 `unsupported_type`; `application/octet-stream` + `plan.dxf` accepted, + `plan.bin` rejected; DXF of 16 MB → `file_too_large`; `project_cover` for another customer's project → 404; `business_logo` by estimator → 403, by admin → 200; the 31st presign in a minute → 429.
  - `ConfirmTest`: object size ≠ declared → intent `rejected`, `reason_code upload_size_mismatch`, object deleted, 422; matching → 202 `{status: 'processing'}`, `uploaded`, `ProcessUpload` pushed on `default`; expired intent → 422; another user's intent → 404; `api.uploads.show` returns `{status, reasonCode, previewUrl}`.
  - `ProcessUploadTest`: `png-as-jpg.jpg` declared `image/jpeg` for `avatar` → `rejected` `upload_type_mismatch`; `vector.svg` declared `image/png` → `upload_type_not_allowed`; `drawing-as-dxf.dxf` for `blueprint_source` → `dwg_not_supported`; `bomb-50mp.png` as `production_photo` → `upload_image_too_large` (rejected before decoding); `exif-gps-rotated.jpg` (orientation 6, 400×300 pixels) as `production_photo` → `ready`, processed key `uploads/production_photo/{Y}/{m}/{ulid}.jpg`, `width 300`, `height 400`, `exif_read_data` on the output has no `GPS` section; `doc.pdf` as `blueprint_source` → `ready` with byte-identical content; a HEIC `production_photo` calls `VisionHeicConverter` (`Http::fake` asserts URL, bearer token and body fields) then runs the JPEG path; the tmp object is deleted.
  - `MagicBytesTest`: dataset over all fixtures → expected type; `%PDF-` found at offset 900 → `pdf`; ASCII DXF with leading blank lines → `dxf`.
  - `FileNameTest`: `'../../etc/passwd'` → `'passwd'`; `"invoice\u{202E}gpj.exe"` with canonical `pdf` → no bidi/control characters and ends `.pdf`; 300 × `'a'` + `'.png'` → length ≤ 100 and ends `.png`; `'🛋️ sofa.png'` → no emoji, ends `sofa.png`; `'   '` → `'file'`.
  - `ConsumeUploadIntentTest`: ready avatar intent → one media item in collection `avatar` (disk `s3-public`, copied from `processed_key`), intent `consumed`; second consume → 422 `upload_invalid`; wrong purpose, other user, or `pending` → `upload_invalid`.
  - `CleanupOrphanMediaTest`: pending intent created 25 h ago is deleted with its object; consumed and 23-h-old intents remain.
- [ ] **Step 2: Run, expect FAIL** — `vendor/bin/pest tests/Feature/Uploads tests/Unit/Uploads`
- [ ] **Step 3: Implement** — fixtures generated with `uv run --with pillow python tests/fixtures/uploads/generate.py` (outputs committed); processing steps exactly `13 §11.3` (finfo agreement for jpeg/png/webp/pdf; ≤ 40 MP and ≤ 12 000 px per side; GD re-encode strips metadata; orientation applied to pixels).
- [ ] **Step 4: Run tests, expect PASS** — same as Step 2.
- [ ] **Step 5: Quality gates** — Gates-PHP, Gates-Gen.
- [ ] **Step 6: Commit** — `git add app routes/api.php resources/lang tests` → `feat(uploads): upload intents with presigned PUT, magic-byte sniffing and image sanitising` + trailer.

### Task 33: Media serving and media components

**Files:**
- Create: `app/Http/Controllers/MediaController.php`; `app/Support/Media/MediaAccess.php`; `app/Support/Media/MediaData.php` (spatie Data, `#[TypeScript]`); `resources/js/lib/upload.ts`; `resources/js/composables/{useUpload,useImageCompression}.ts`; `resources/js/components/media/{FileDropzone,ImageUploader,PhotoGallery,Lightbox,AttachmentList}.vue`
- Modify: `routes/web.php` (`media.show`), `resources/lang/en/uploads.php`, `route-access.php`
- Test: `tests/Feature/Media/MediaAccessTest.php`, `resources/js/lib/__tests__/upload.test.ts`, `resources/js/composables/__tests__/useImageCompression.test.ts`, `resources/js/components/media/__tests__/{FileDropzone,PhotoGallery,Lightbox}.test.ts`

**Spec refs:** `13 §8.9`, `§11.6`, `§20.16`; `15 §9.10–§9.13`, `§9.31` (AttachmentList); `10 §3` (`MediaData`); `02 §10`

**Interfaces:**
- Consumes: Tasks 14–15, 32.
- Produces: `GET /media/{media:uuid}?conversion=` (`media.show`, `['web','auth','active']`) → 302 to a 15-minute temporary URL after `MediaAccess::authorize(User, Media)` (matrix of `13 §8.9`; public-disk collections and unknown combinations → 404); non-images get `ResponseContentDisposition: attachment; filename="<sanitised>"` and `ResponseContentType`; `Cache-Control: private, no-store`; `MediaData::fromMedia(Media $m): MediaData` (`{id, name, mimeType, size, url, thumbUrl, largeUrl, width, height}`); `uploadWithIntent(file, purpose, target, onProgress, signal): Promise<UploadedFileRef>` (presign → XHR PUT with exactly the returned headers → confirm → poll `api.uploads.show` every 1 s up to 60 s; rejects with `UploadError {code}`); `compressImage(file: File): Promise<File>` (`15 §9.12`); components with the props of `15 §9.10–§9.13`.

- [ ] **Step 1: Write the failing tests**
  - `MediaAccessTest` (`13 §20.16`): owner opens `Plan.thumbnail` → 302 to a URL containing the media path, header `Cache-Control: private, no-store`; another customer → 404; staff with `customers.view` → 302; `ProductionUpdate.photos` with `visibility internal` → customer 404, staff 302; `Quote.pdf` → 302 with `ResponseContentDisposition` attachment; `FurnitureRevision.cutlist_pdf` → support (orders.view) 302, customer 404; `BlueprintImport.debug` → estimator 302, owner-customer 404; `User.avatar` (public disk) → 404; guest → redirect `login`. (Temporary URLs via `Storage::disk('s3')->buildTemporaryUrlsUsing(...)`.)
  - `upload.test.ts`: the PUT carries exactly the presign `headers`; polling stops at `ready` and resolves `{uploadId, name, size, mime, previewUrl}`; `rejected` with `reasonCode 'upload_type_not_allowed'` rejects with that code; abort cancels the XHR; a 60-s timeout rejects with code `timeout`.
  - `useImageCompression.test.ts` (mocked `createImageBitmap`/canvas): 4000×3000 JPEG → longest side 2560, `image/jpeg`, name `.jpg`; 1200×900 JPEG of 1 MB → returned unchanged; decode failure (HEIC) → original file; result larger than original → original file.
  - `FileDropzone.test.ts`: wrong type → `t('uploads.errors.type', {name})`; too large → `uploads.errors.size`; more than `maxFiles` → `uploads.errors.count`; emits `uploading` true then false; area is a `button` and Enter opens the picker.
  - `PhotoGallery.test.ts`: `max=4` with 10 photos shows a `+6` tile. `Lightbox.test.ts`: ArrowRight/ArrowLeft change index, Escape emits `update:open false`, counter `3 / 12`, focus returns to the thumbnail.
- [ ] **Step 2: Run, expect FAIL** — `vendor/bin/pest tests/Feature/Media && yarn vitest run resources/js/lib resources/js/composables resources/js/components/media`
- [ ] **Step 3: Implement** — per Interfaces.
- [ ] **Step 4: Run tests, expect PASS** — same as Step 2.
- [ ] **Step 5: Quality gates** — Gates-PHP, Gates-JS, Gates-Gen.
- [ ] **Step 6: Commit** — `git add app routes/web.php resources tests` → `feat(media): policy-checked media serving and upload/gallery components` + trailer.

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

### Task 35: Account deletion, anonymisation, data export

**Files:**
- Create: `app/Domain/Identity/Actions/{RequestAccountDeletion,AnonymiseUser,ExportUserData,RestoreDeletedCustomer}.php`; `app/Domain/Identity/Contracts/AccountDeletionStep.php`; `app/Domain/Orders/Support/DeleteNeverSubmittedDraftOrders.php`; `app/Notifications/Account/DeletionScheduled.php`; `app/Console/Commands/AnonymiseDeletedUsers.php`; `app/Http/Controllers/Customer/Account/{DeleteAccountController,ExportController}.php`; `app/Http/Controllers/Admin/CustomerLifecycleController.php`; `app/Http/Controllers/Auth/AccountDeletionScheduledController.php`; `resources/js/pages/Customer/Account/Delete.vue`; `resources/js/pages/Auth/AccountDeletionScheduled.vue`
- Modify: `routes/customer.php` (`customer.account.delete`, `customer.account.destroy` (`recent.auth`), `customer.account.export` (`recent.auth`, `verified.contact`, `throttle:data-export`)), `routes/web.php` (`account.deletion-scheduled` GET `/account-deleted`), `routes/admin.php` (`admin.customers.restore` (`customers.manage`), `admin.customers.anonymise` (gate `data.delete`)), `app/Providers/AppServiceProvider.php` (tag deletion steps), `AccountNav`, `resources/lang/en/{account,notifications}.php`, `route-access.php`
- Test: `tests/Feature/Account/{AccountDeletionTest,AnonymiseUserTest,DataExportTest,CustomerLifecycleTest}.php`

**Spec refs:** `13 §9.1–§9.3`, `§16` item 8, `§17` (account events), `§20.20`; `10 §13.7`; `12 §3.3`, `§3.7` (`account.deletion_scheduled`); `09 §1` (Active states); P1-D8

**Interfaces:**
- Consumes: Tasks 10–12, 24, 26.
- Produces: `AccountDeletionStep::handle(User $user): void` (tag `account.deletion_steps`; P1 registers `DeleteNeverSubmittedDraftOrders` — hard delete of `draft` orders with `submitted_at` null; P6/P7 add theirs); `RequestAccountDeletion::handle(User $u, string $confirmation): void` (active orders → 422 `account.errors.active_orders` with numbers; confirmation must equal `trans_icu('account.delete.confirm_word')` ("DELETE") → else `account.errors.confirmation`; transaction: steps → `DeletionScheduled` mail (date = now+30 days, business locale/timezone) → soft delete → delete push subscriptions → `SessionRegistry::destroyAll`; audit `account.deletion_requested`); `AnonymiseUser::handle(User $u, string $via): void` (table of `13 §9.2` exactly); command `users:anonymise-deleted` (customers with `deleted_at <= now()-30d` and `anonymised_at` null, chunked, one transaction per user, `via: scheduler`); `ExportUserData::stream(User $u): StreamedResponse` (filename `{app-slug}-export-{Y-m-d}.json`, version `1`, sections of `13 §9.3`, lazy cursors); `RestoreDeletedCustomer` (≤ 30 days; audit `account.deletion_cancelled`); admin immediate anonymisation via gate `data.delete` (refuses with active orders).

- [ ] **Step 1: Write the failing tests**
  - `AccountDeletionTest`: customer with a `submitted` order → 422 listing its number; with only a never-submitted draft → draft hard-deleted, user soft-deleted, `DeletionScheduled` sent before the soft delete (captured with `Notification::fake` while the user still has `deleted_at` null), push subscriptions deleted, registry sessions destroyed, logged out, redirect `account.deletion-scheduled`; wrong confirmation word → `account.errors.confirmation`; without recent auth → redirect `password.confirm`; a fake registered step is invoked; logging in afterwards fails (`auth.failed`); staff cannot use the route (redirect `admin.dashboard`).
  - `AnonymiseUserTest`: a customer deleted 31 days ago → `name 'Deleted customer {last 6 of id}'`, `email 'deleted+{id}@invalid.invalid'`, `phone_e164`, `phone_verified_at`, `email_verified_at`, `password`, `google_id`, `remember_token`, `two_factor_*`, `notes_internal`, `last_login_at` null, `marketing_opt_in false`, `anonymised_at` set; avatar media deleted; an address not used by orders deleted; an address used by an order → `label`/`line1 '[removed]'`, `line2`/`latitude`/`longitude` null, `city`/`region`/`postal_code`/`country_code` kept; a project without orders hard-deleted (plans/designs gone); a project with an order renamed `Project {last 6}`, `notes` null, its plans and imports deleted, designs kept; notifications, preferences, `otp_codes` for the phone, push subscriptions deleted; `notification_deliveries.user_id` null; `confirmation_calls.phone_e164 '+910000000000'` for `+919876543210`; `quotes.accepted_by_ip '203.0.113.0'` for `203.0.113.45`; orders and messages kept; deleted 29 days ago → untouched; staff never anonymised; audit `account.anonymised` with causer null and `via: scheduler`.
  - `DataExportTest`: JSON `version 1` with `profile` lacking `password`, `remember_token`, `two_factor_secret`, `two_factor_recovery_codes`, `notes_internal`; messages exclude `internal_note`; quotes exclude drafts; `media[]` metadata only; `Content-Disposition` filename matches `/-export-\d{4}-\d{2}-\d{2}\.json$/`; unverified contact → 403 `contact_unverified`; the 4th export in a day → 429; audit `account.data_exported`.
  - `CustomerLifecycleTest`: `admin.customers.restore` within 30 days restores (`customers.manage`) and audits `account.deletion_cancelled`; estimator → 403; `admin.customers.anonymise` by admin → 403, by owner → anonymised immediately; refuses with an Active order.
- [ ] **Step 2: Run, expect FAIL** — `vendor/bin/pest tests/Feature/Account`
- [ ] **Step 3: Implement** — per Interfaces; `Delete.vue` per `10 §13.7`, `AccountDeletionScheduled.vue` per `13 §9.1`.
- [ ] **Step 4: Run tests, expect PASS** — `vendor/bin/pest tests/Feature/Account`
- [ ] **Step 5: Quality gates** — Gates-PHP, Gates-JS, Gates-Gen.
- [ ] **Step 6: Commit** — `git add app routes resources tests` → `feat(account): account deletion, 30-day anonymisation and data export` + trailer.

### Task 36: Customer onboarding (steps 1–2)

**Files:**
- Create: `app/Http/Controllers/Customer/OnboardingController.php`; `app/Http/Requests/Customer/OnboardingRequest.php`; `app/Domain/Identity/Actions/CompleteOnboarding.php`; `resources/js/pages/Customer/Onboarding/Wizard.vue`
- Modify: `routes/customer.php` (`customer.onboarding.show` GET `/onboarding`, `customer.onboarding.store` POST `/onboarding`, `customer.onboarding.skip` POST `/onboarding/skip`), `app/Http/Controllers/WelcomeController.php` (un-onboarded customers → onboarding), `resources/lang/en/onboarding.php`, `route-access.php`
- Test: `tests/Feature/Customer/OnboardingTest.php`, `resources/js/pages/Customer/Onboarding/__tests__/Wizard.test.ts`

**Spec refs:** `10 §5.1–§5.3`; `13 §5.1` (staff-created customers, terms); `02 §1.1` (`onboarded_at`, `terms_accepted_at`); P1-D4

**Interfaces:**
- Consumes: Tasks 23, 29 (`PhoneVerifyDialog`), 34 (`UpdatePreferences`).
- Produces: page `Customer/Onboarding/Wizard` (AuthLayout `wide`) with props `{user: {name, email, phoneE164, phoneVerified, termsAccepted}, defaults: {unitSystem, lengthUnit, timezone}}` (P4 adds `propertyTypes`, `starters`, `credits`); `CompleteOnboarding::handle(User $u, string $name, UnitSystem $s, LengthUnit $l, string $tz, bool $acceptTerms): void` (sets `terms_accepted_at` when required, `onboarded_at`); store body `{name, terms?, unitSystem, lengthUnit, timezone}` → redirect `customer.dashboard` (P4 extends with `project`, `start`, `starterKey`); skip body `{terms?}`.

- [ ] **Step 1: Write the failing tests**
  - `OnboardingTest`: un-onboarded customer GET `customer.dashboard` → `/onboarding`; `GET /` → `/onboarding`; store with valid data sets `onboarded_at`, preferences and name, redirects to `customer.dashboard`; `termsPending()` user without `terms` → `onboarding.errors.terms_required`, with `terms` → `terms_accepted_at` set; empty name → `onboarding.errors.name_required`; `metric` + `ftin` → `account.errors.length_unit`; skip sets `onboarded_at` (and terms when sent) and the wizard never shows again; staff GET `/onboarding` → redirect `admin.dashboard`.
  - Vitest: Continue moves from step 1 to step 2 and Back returns; the terms checkbox renders only when `user.termsAccepted` is false; Skip opens a `ConfirmDialog` containing the terms checkbox when required; the phone card opens `PhoneVerifyDialog` when no verified phone.
- [ ] **Step 2: Run, expect FAIL** — `vendor/bin/pest tests/Feature/Customer/OnboardingTest.php && yarn vitest run resources/js/pages/Customer`
- [ ] **Step 3: Implement** — wizard header "Step {n} of {total}" + `Progress`; time-zone default from `Intl.DateTimeFormat().resolvedOptions().timeZone` when supported, else business default.
- [ ] **Step 4: Run tests, expect PASS** — same as Step 2.
- [ ] **Step 5: Quality gates** — Gates-PHP, Gates-JS, Gates-Gen.
- [ ] **Step 6: Commit** — `git add app routes/customer.php resources tests` → `feat(onboarding): customer onboarding gate and profile/units steps` + trailer.

### Task 37: Admin settings pages (business, units, pricing, workflow, security)

**Files:**
- Create: `app/Domain/Settings/Actions/UpdateSettings.php`; `app/Http/Controllers/Admin/SettingsController.php`; `app/Http/Requests/Admin/Settings/{BusinessSettingsRequest,UnitsSettingsRequest,PricingSettingsRequest,WorkflowSettingsRequest,AuthSettingsRequest}.php`; `resources/js/pages/Admin/Settings/{Business,Units,Pricing,Workflow,Auth}.vue`; `resources/js/components/admin/settings/{SettingsNav,ProductionStagesEditor}.vue`
- Modify: `routes/admin.php` (`admin.settings.{business,units,pricing,workflow,auth}` GET + `.update` PUT), `resources/js/lib/adminNav.ts` (Settings item: `admin.settings.business`, or `admin.settings.auth` when the user only passes `settings.manage_restricted`), `resources/lang/en/settings.php`, `route-access.php`
- Test: `tests/Feature/Settings/{SettingsPagesTest,UpdateSettingsTest,SettingsValidationTest}.php`, `resources/js/components/admin/settings/__tests__/ProductionStagesEditor.test.ts`

**Spec refs:** `11 §12` (shell), `§12.1–§12.4`, `§12.7`; `02 §13`; `13 §7.2` (`settings.manage`), `§7.3` (`settings.change_currency`, `settings.manage_restricted`), `§17` (`settings.updated`); master §6.4 (currency lock); `01 §5.3` (pricing bumps `catalog.version`)

**Interfaces:**
- Consumes: Tasks 6, 13, 19, 33.
- Produces: `UpdateSettings::handle(SettingsGroup $g, array $camelInput, User $actor): SettingsData` (authorises: `settings.manage` for business/units/pricing/workflow/notifications, gate `settings.manage_restricted` for ai/auth; business currency change requires gate `settings.change_currency` and no quote rows → else 422 `settings.errors.currency_locked`; pricing writes call `CatalogVersion::bump()` in the same transaction; business `logoUploadId` (string|null) consumes a `business_logo` intent onto `BusinessProfile::instance()` collection `logo` or clears it; audit `settings.updated {group, changes: {field: {from, to}}}` with `#[Encrypted]` fields `[redacted]`); page props `{values, updatedAt, updatedBy, meta}` per `11 §12` (business `meta {currencyLocked, canChangeCurrency, currencies, locales: ['en-IN','en-US','en-GB','en-AE','en-SG','en-AU'], timezones, countries, logoUrl}`; pricing `meta {taxRates, estimateDisclaimerPreview}`; workflow `meta {usedStageKeys}`).

- [ ] **Step 1: Write the failing tests**
  - `SettingsPagesTest`: admin GET each of the five pages → components `Admin/Settings/{Business,Units,Pricing,Workflow,Auth}`; admin GET `admin.settings.auth` → 403, owner → 200; estimator GET business → 403; `values` keys are camelCase (`quoteValidityDays`, `marginBps`, `allowCustomerRegistration`).
  - `UpdateSettingsTest`: pricing update bumps `catalog.version` by 1; business update without currency change by admin works; currency change by admin → 403/422 (gate); by owner with an existing quote → 422 `settings.errors.currency_locked`; by owner without quotes → saved; the activity `settings.updated` lists only changed fields with `from`/`to`; after update, the shared prop `business.currency` reflects the new value on the next request (cache bust); `logoUploadId` attaches the logo and `app.logoUrl` becomes non-null.
  - `SettingsValidationTest` (rules of `11 §12.1–§12.4`, `§12.7`): units interior 240 > exterior 230 → error; door height 2800 ≥ wall 2700 → error; sill 900 + window 1900 > 2700 → error; wall height 1999 → error; pricing `roundingMinor 250` → error (allowed 1, 100, 500, 1000, 10000), `marginBps 50001` → error, `kerfMm 10.5` → error; workflow stage key `Cutting!` → `settings.errors.stage_key`, key `completed` → error, duplicate keys → error, default progress not strictly increasing → error, removing a key present in `production_updates.stage` → error, zero stages → error, `quoteValidityDays 91` → error; auth `otpGlobalHourlyCap 9` → error, `staffSessionAbsoluteHours 73` → error, empty `otpAllowedCountryCodes` → error; business `taxId` 33 chars → error, `quoteTerms` 20 001 chars → error.
  - Vitest: `ProductionStagesEditor` disables delete for `usedStageKeys` and makes keys of existing rows read-only.
- [ ] **Step 2: Run, expect FAIL** — `vendor/bin/pest tests/Feature/Settings && yarn vitest run resources/js/components/admin`
- [ ] **Step 3: Implement** — pages with `FormSection` + `StickyActionBar` (Discard / Save changes), toast "Settings saved." (`settings.toasts.saved`); Units page uses `LengthInput`; Business uses `PhoneInput`, `AddressFields`, `ImageUploader` (purpose `business_logo`); desktop-only editors render `ScreenTooSmall` on phones (`11 §1`).
- [ ] **Step 4: Run tests, expect PASS** — same as Step 2.
- [ ] **Step 5: Quality gates** — Gates-PHP, Gates-JS, Gates-Gen.
- [ ] **Step 6: Commit** — `git add app routes/admin.php resources tests` → `feat(settings): admin settings pages for business, units, pricing, workflow and security` + trailer.

### Task 38: Real-time wiring (Reverb, channels, Echo)

**Files:**
- Create: `routes/channels.php`; `resources/js/lib/echo.ts`; `resources/js/composables/{useUserChannel,useOrderChannel,useImportChannel,useStaffChannel,useDesignChannel,useLiveFallback}.ts`
- Modify: `config/broadcasting.php` (reverb connection from `REVERB_*`), `config/reverb.php` (`allowed_origins` = `explode(',', env('REVERB_ALLOWED_ORIGINS', '*'))`, scaling env), `bootstrap/app.php` (`withBroadcasting(__DIR__.'/../routes/channels.php', ['middleware' => ['web','auth','active','throttle:broadcasting-auth']])`), `resources/js/app.ts` (configure Echo), `resources/js/components/app/AppShell.vue` (`useUserChannel`), `route-access.php`
- Test: `tests/Feature/Realtime/ChannelsTest.php`, `resources/js/composables/__tests__/{useOrderChannel,useLiveFallback}.test.ts`

**Spec refs:** `01 §8`; `13 §8.10`, `§14` (Reverb); `15 §12`; `17 §5.11` item 7, `§6.1` (`REVERB_*`, `VITE_REVERB_*`)

**Interfaces:**
- Consumes: Tasks 14–15 policies.
- Produces: channels `users.{userId}`, `orders.{orderId}` (`OrderPolicy::view`), `orders.{orderId}.internal` (`viewInternal`), `imports.{importId}` (`BlueprintImportPolicy::view`), `furniture-designs.{designId}` (`FurnitureDesignPolicy::view`), `staff` (active staff with `orders.view`); `configureEcho()` from `VITE_REVERB_APP_KEY/HOST/PORT/SCHEME`; composables `useUserChannel(handlers)`, `useOrderChannel(orderId, handlers, { internal?: boolean })`, `useImportChannel(importId, handlers)`, `useStaffChannel(handlers)`, `useDesignChannel(designId, handlers)` — each returns `{ connected: Ref<boolean> }` and leaves its channels on unmount; `useLiveFallback(connected: Ref<boolean>, only: string[])` starts `usePoll(30_000, { only })` after 5 s disconnected and stops on reconnect.

- [ ] **Step 1: Write the failing tests**
  - `ChannelsTest` (invoking the registered channel callbacks via the broadcaster): `users.{id}` true only for that user; `orders.{id}` true for the owner-customer and for staff with `orders.view`, false for another customer; `orders.{id}.internal` false for the owner-customer, true for support; `imports.{id}` true for uploader, project owner and staff with `customers.view`; `furniture-designs.{id}` per `FurnitureDesignPolicy::view`; `staff` true for production staff, false for customers and inactive staff; `POST /broadcasting/auth` as guest → redirect/403; the route has the `throttle:broadcasting-auth` middleware.
  - Vitest: `useOrderChannel(id, h, { internal: true })` subscribes to `orders.{id}` and `orders.{id}.internal` and leaves both on unmount; `useLiveFallback` starts polling only after 5 s of `connected=false` and stops when it becomes true (fake timers).
- [ ] **Step 2: Run, expect FAIL** — `vendor/bin/pest tests/Feature/Realtime && yarn vitest run resources/js/composables`
- [ ] **Step 3: Implement** — per Interfaces.
- [ ] **Step 4: Run tests, expect PASS** — same as Step 2.
- [ ] **Step 5: Quality gates** — Gates-PHP, Gates-JS.
- [ ] **Step 6: Commit** — `git add routes/channels.php config bootstrap/app.php resources/js tests` → `feat(realtime): Reverb channel authorisation and Echo composables` + trailer.

### Task 39: Queues, Horizon, scheduler, health endpoints

**Files:**
- Create: `config/horizon.php` (replace); `app/Http/Controllers/HealthController.php`; `app/Support/Health/{HealthCheck,HealthReport}.php`
- Modify: `routes/console.php` (schedule), `routes/web.php` (`health.deep` GET `/up/deep`), `app/Providers/HorizonServiceProvider.php` (`Horizon::routeMailNotificationsTo(config('horizon.notify_email'))`), `route-access.php`
- Test: `tests/Feature/Ops/{ScheduleTest,HorizonConfigTest,HealthDeepTest}.php`

**Spec refs:** `01 §7`; `17 §5.11` items 2, 4, 5, 13, `§13.2`; `13 §11.5`, `§9.2`, `§4.5`, `§16` item 8; master D36; `19 §8.6`

**Interfaces:**
- Consumes: commands of Tasks 27 (`otp:monitor`, `otp:prune`), 32 (`media:cleanup-orphans`), 35 (`users:anonymise-deleted`).
- Produces: Horizon supervisors (production): `default` on `redis` (2 processes, timeout 60, tries 3), `imports` on `redis-long` (2, timeout 660, tries 2, backoff 30), `engine` (2, 120, 2), `pdf` (1, 120, 3), `notify` (2, 60, 5, backoff `[10,30,90,270,600]`); `environments.staging` = 1 process per queue; `waits` = `redis:default 60, redis:notify 120, redis:engine 300, redis:pdf 300, redis-long:imports 900`; prefix `HORIZON_PREFIX`; `horizon.notify_email` = `HORIZON_NOTIFY_EMAIL`. Schedule (all `->onOneServer()->withoutOverlapping()`): closure `scheduler-heartbeat` every minute (`Cache::put('health:scheduler:heartbeat', now()->timestamp, 600)`), `horizon:snapshot` every 5 min, `otp:monitor` every 5 min, `media:cleanup-orphans` + `otp:prune` daily 03:00, `users:anonymise-deleted` 03:15, `queue:prune-failed --hours=720` 03:40, `queue:prune-batches --hours=48` 03:45, `telescope:prune --hours=48` 03:50 (only when the Telescope provider is registered), `activitylog:clean` monthly day 1 04:30 (later milestones add their rows of `01 §7`). `GET /up/deep` per `17 §5.11` item 13 (404 without matching `X-Health-Token` header or `?token=` = `HEALTH_CHECK_TOKEN`; checks `database, redis, horizon, scheduler, storage, vision, gotenberg, reverb`, each `{ok, ms, error?}` with 3-s timeouts; 200 with status `ok`/`degraded` when the first four are ok, else 503 `down`).

- [ ] **Step 1: Write the failing tests**
  - `ScheduleTest`: `Schedule::events()` contains each entry above with cron `* * * * *`, `*/5 * * * *`, `0 3 * * *`, `15 3 * * *`, `40 3 * * *`, `45 3 * * *`, `30 4 1 * *`; every event has `onOneServer` and `withoutOverlapping` set; running the heartbeat closure writes an integer timestamp to `health:scheduler:heartbeat`.
  - `HorizonConfigTest`: production supervisors' `connection`, `queue`, `maxProcesses`, `timeout`, `tries` equal the table; staging has `maxProcesses 1` for each; `waits` keys/values exact.
  - `HealthDeepTest`: no token → 404; wrong token → 404; correct header with all dependencies faked healthy (Horizon master repository mocked, heartbeat 60 s old, `Storage::fake('s3')` containing `health/probe.txt`, `Http::fake` for `{VISION_SERVICE_URL}/healthz` and `{GOTENBERG_URL}/health`, Reverb connection mocked) → 200 `{status: 'ok', version, checks: {…8 keys}}`; vision 500 → 200 `degraded` with `checks.vision.ok false`; heartbeat 4 min old → 503 `down`; `?token=` works like the header; `/up/deep` reachable in maintenance mode.
- [ ] **Step 2: Run, expect FAIL** — `vendor/bin/pest tests/Feature/Ops`
- [ ] **Step 3: Implement** — per Interfaces.
- [ ] **Step 4: Run tests, expect PASS** — `vendor/bin/pest tests/Feature/Ops`
- [ ] **Step 5: Quality gates** — Gates-PHP.
- [ ] **Step 6: Commit** — `git add config/horizon.php app/Http/Controllers/HealthController.php app/Support/Health app/Providers routes tests` → `feat(ops): Horizon supervisors, scheduler heartbeat and deep health check` + trailer.

### Task 40: Deployment files, CI hardening, README

**Files:**
- Create: `nixpacks.toml`; `docker/{start.sh,check-runtime.sh,backup-objects.sh,php.ini,php-fpm.conf}`; `docker/supervisor/{supervisord,php-fpm,nginx,horizon,scheduler,pulse-check}.conf`; `docker/dev/pg-init.sql`; `.dockerignore`; `compose.dev.yaml`; `.github/scripts/{changed-since-last-deploy.sh,coolify-deploy.sh}`; `.github/dependabot.yml`; `security/audit-allowlist.json` (`[]`); `scripts/audit-gate.php`; `README.md`
- Modify: `.github/workflows/ci.yml` (`deploy` job per `17 §10.2` with `if:` additionally requiring `vars.DEPLOY_ENABLED == 'true'`; audit steps), `composer.json` (`scripts.dev` per `17 §3.3`)
- Test: `tests/Feature/Ops/DeploymentFilesTest.php`, `tests/Unit/Ops/AuditGateTest.php` (+ JSON fixtures under `tests/fixtures/audit/`)

**Spec refs:** `17 §1` (O2–O5, O14, O15), `§3.2`, `§3.3`, `§5.1–§5.8`, `§5.10`, `§10.2`, `§10.3`; `13 §19`; master D34; owner baseline `docs/ops/owner-reference-nixpacks.toml`; P1-D15

**Interfaces:**
- Consumes: everything above.
- Produces: the repository deployment files with the **complete contents of `17 §5`** (verbatim), `compose.dev.yaml` + `docker/dev/pg-init.sql` per `17 §3.2`, deploy helper scripts per `17 §10.3`; `scripts/audit-gate.php <composer-audit.json> <yarn-audit.json>` exits 1 on any high/critical advisory not listed in `security/audit-allowlist.json` (`[{id, reason, expires_on}]`) or when any allowlist entry is expired; CI `php` job runs `composer audit --locked --format=json > /tmp/c.json || true`, `frontend` job runs `yarn npm audit --environment production --severity high --json > /tmp/y.json || true`, then the gate (`pip-audit` is added by P3); `vision/nixpacks.toml` (`17 §5.9`) is left to P3. README: product summary (no hard-coded brand beyond `APP_NAME` note), prerequisites, native local setup from the roadmap notes (services, databases `furny`/`furny_test`, `composer install`, `corepack enable && yarn install`, `cp .env.example .env && php artisan key:generate`, `php artisan migrate --seed`, `composer dev`), Docker alternative with `compose.dev.yaml`, test commands (Gates-PHP/JS/Gen), and links to the spec and plans.

- [ ] **Step 1: Write the failing tests**
  - `DeploymentFilesTest`: `nixpacks.toml` contains `php84Extensions.{ext}` for every `ext-*` of `composer.json` plus `opcache`, `nodejs_22`, `python311Packages.supervisor`, `rclone`, `corepack enable`, `yarn install --immutable`, `php artisan optimize`, `[staticAssets]`, `client_max_body_size 200M;`, `fastcgi_buffer_size       8k;`, `location = /up`, `location = /sw.js`, `PHP_UPLOAD_MAX_FILESIZE = "200M"`, `PHP_MEMORY_LIMIT = "512M"`, `PHPRC = "/app/docker/php.ini"` and no `X-Frame-Options`; `bash -n` succeeds for every `docker/*.sh` and `.github/scripts/*.sh`; `docker/start.sh` maps roles `all|web|worker` to the program lists of `17 §5.4` and runs `migrate --force --isolated` only when `RUN_MIGRATIONS=true`; six supervisor files exist and none contains `queue:work`; `docker/php.ini` contains `memory_limit = ${PHP_MEMORY_LIMIT}`, `expose_php = Off`, `opcache.validate_timestamps = 0`, `opcache.save_comments = 1`; `docker/php-fpm.conf` has `pm.max_children = 12`, `request_terminate_timeout = 600s`, `clear_env = no`; `.dockerignore` lines equal `17 §5.1`; `compose.dev.yaml` services `pgsql` (`postgres:18-alpine`), `redis` (`redis:7.4-alpine`), `minio`, `minio-init`, `gotenberg`, `mailpit`; `composer.json` `scripts.dev` equals `17 §3.3`; `ci.yml` has jobs `php, frontend, vision, browser, deploy` and the deploy `if:` contains `vars.DEPLOY_ENABLED == 'true'`; `dependabot.yml` covers `composer`, `npm`, `pip` (`/vision`) and `github-actions` weekly with grouped minor/patch updates.
  - `AuditGateTest`: a high advisory not in the allowlist → exit 1; the same id allowlisted with a future `expires_on` → exit 0; an allowlist entry with a past `expires_on` → exit 1; a moderate advisory → exit 0.
- [ ] **Step 2: Run, expect FAIL** — `vendor/bin/pest tests/Feature/Ops/DeploymentFilesTest.php tests/Unit/Ops`
- [ ] **Step 3: Implement** — copy file contents from `17 §5`/`§3.2`/`§10.3`; make scripts executable (`git update-index --chmod=+x`).
- [ ] **Step 4: Run tests, expect PASS** — same as Step 2; plus a full run of Gates-PHP, Gates-JS, Gates-Gen, `vendor/bin/pest tests/Browser`, `yarn build`.
- [ ] **Step 5: Quality gates** — Gates-PHP, Gates-JS, Gates-Gen.
- [ ] **Step 6: Commit** — `git add nixpacks.toml docker .dockerignore compose.dev.yaml .github security scripts/audit-gate.php README.md composer.json tests` → `chore(deploy): Nixpacks/Coolify files, CI deploy and audit gates, README` + trailer.

---

## Self-review

### Spec coverage (P1 scope → task)

| Requirement (source) | Task |
|---|---|
| Kit scaffold preserving `docs/`, `vision/tests/fixtures`; branch `build/p1-foundation` from `develop` (roadmap) | 1 |
| PHP `^8.4` + 11 `ext-*`; every composer/yarn package of `01 §1.1–§1.2`; yarn 4 + `packageManager`; no bunny fonts | 1 |
| Pint, Larastan 8, ESLint (bare strings, v-html; engine import ban owned by P2 Task 1), Prettier, vue-tsc, Pest 5, Vitest, typescript-transformer, CI jobs `php/frontend/vision/browser` (`17 §10.2`) | 1 (+ 3 i18n CI step, 40 deploy/audit) |
| Engine stub + engine CLI `version` for P2 (`01 §5.4`) | 1 |
| Config: features (master §6.7), queue connections, redis DBs, session, filesystems, engine, imports, notification_events skeleton, `.env.example` (`17 §6.1`), trusted proxies, maintenance exceptions, Telescope conditional, app version, boot without services | 2 |
| `app/Domain/*` skeleton (`01 §4`) | 2 |
| i18n (`15 §15`, master D23): `trans_icu`, `i18n:export`, generated JSON, `t()`, key-coverage test | 3 |
| Every table of `02` in `§15` order, ULID morph package tables, models, casts, relations, factories with states | 4–12 |
| Settings typed groups + cache + `#[Encrypted]` + SettingsSeeder (`02 §2.1`, `§13`, `13 §15`) | 6 |
| Number sequences, order/quote numbers (master §6.3) | 6 |
| CatalogVersion bump observer, tax rates, catalog seed `08 §7` | 8 |
| Roles/permissions (24) + matrix, owner gates, Horizon/Pulse/Telescope gates, OwnerSeeder, DatabaseSeeder | 13 |
| Policies `13 §8.1–§8.8` | 14, 15 |
| Media `13 §8.9`; channels `13 §8.10` | 33; 38 |
| Fortify config, login, register, remember policy, responses, audit (`13 §2`, `§5.1`, `§5.4`) | 25 |
| Turnstile (`13 §3`) | 25 (+27 OTP captcha) |
| Phone OTP (`13 §4`, `§5.2`, `§5.7`) incl. log driver (P1-D6), `otp:monitor`, `otp:prune` | 27, 29 |
| Google OAuth (`13 §5.3`) behind `features.google_login` | 28 |
| Password reset, email verification, email/password change, `ContactVerified` (`13 §5.5–§5.8`) | 26 |
| Staff invitations + staff management (`13 §5.9`, `11 §7`) | 30 |
| 2FA mandatory for owner/admin (`13 §5.10`) | 23 (middleware), 31 |
| Sessions, registry, devices, absolute lifetime, recent auth (`13 §6`) | 23, 24 |
| Middleware aliases + route groups (`13 §1`), route coverage map (`13 §20.1`) | 23 |
| Rate limiters (`13 §10`) | 22 |
| Upload intents (`13 §11`), HEIC via vision normalize (client), cleanup | 32 |
| Security headers, CSP, cookies, CSRF exemptions, history encryption, trusted proxies (`13 §12`) | 22 (+16 appearance cookie) |
| PII masking + log redaction + Pulse/Telescope hiding (`13 §16`) | 22 |
| Audit events of `13 §17` in P1 scope (security, staff, settings, account) | 24–31, 35, 37 |
| Account deletion, anonymisation, export (`13 §9`) | 35 |
| Terms acceptance (registration, OTP, Google, invitations, onboarding) | 25, 28, 29, 30, 36 |
| Onboarding gate + wizard (steps 1–2; P1-D4) | 23, 36 |
| Shared props (`01 §6`, `15 §8`) | 20 |
| Tokens/fonts/theme/print (`15 §2–§3`, `§11`, `§16`), contrast + raw-palette tests | 16 |
| shadcn-vue list + Button/Badge variants (`15 §4`) | 17 |
| Base components: AppShell, PageHeader, StatusBadge, LengthInput (placeholder, P1-D3), MoneyDisplay, FileDropzone, PhotoGallery, EmptyState, ConfirmDialog, ReasonDialog, PhoneInput, CurrencyInput, NotificationBell shell | 18, 19, 21, 33 |
| Layouts Customer/Admin/Editor/Auth (`15 §7`) | 21 |
| Auth pages (`10 §4`), account pages (`10 §13`, `11 §18`), legal pages, error page, welcome | 21, 25, 26, 28–31, 34, 35 |
| Admin settings pages business/units/pricing/workflow/auth (`11 §12`) | 37 |
| PWA manifest + icons (`10 §15`, `12 §8.3`) | 21 |
| Reverb/Echo wiring, all channels of `01 §8` | 38 |
| Horizon config, queues, scheduler skeleton, heartbeat, `/up`, `/up/deep` | 2, 39 |
| Activity log config (1095 days, ULID morphs) | 5 (+39 `activitylog:clean`) |
| Deployment files (`17 §5`), compose, CI deploy, dependabot, audit gates, README | 40 |
| Deferred with owner: DemoSeeder, Noto Sans TTF (P4); onboarding steps 3–4 (P4); AI/notification settings pages (P6/P8); `vision/nixpacks.toml` + `pip-audit` (P3); Sentry (P1-D14) | — |

### Step scan
Every task has Files, Spec refs, Interfaces, six steps, exact test names/assertions with spec values, exact commands and a commit message; no "TBD"/"handle edge cases" steps. Large values (catalog rows, CSP, deployment files) are referenced to their spec section instead of copied, with spot values pinned in tests.

### Type and name consistency
`User`/`StaffRole`/`PermissionName`/`OwnerGate` (Tasks 4, 13) are used unchanged by 14–15, 20, 23, 30; `Settings`, `SettingsGroup`, `CatalogVersion` (6) by 8, 20, 27, 37; `JsonDocument`/`AsJsonDocument` (7) by 9–10; `OrderState` + `OrderStateKey` (10) by 15, 18, 20, 35; `UploadPurpose`/`UploadIntent` (5) extended in 32 and consumed by 33, 34, 37; `SessionRegistry` (24) by 25, 26, 30, 35; `ContactVerification` (26) by 28–30; `SendOtp`/`VerifyOtp`/`OtpException` (27) by 29; `RecentAuthentication`/`RecentAuthenticationRequired` (23) by 24, 26, 28, 35; `route-access.php` (23) extended by every route-adding task; `LEGACY_KIT_FILES` (1) removed in 31; `MorphMap::MAP` (5) extended by 6–12.

### Review Focus placement
1 → Tasks 4, 25, 28, 30 · 2 → Tasks 19, 27 · 3 → Task 32 · 4 → Tasks 6, 7 · 5 → Tasks 6, 27, 30.

### Proportion
The plan pins contracts, file paths, spec values and tests; implementation bodies are left to the implementer except where the spec leaves an algorithmic choice (sequence locking, JSON empty-object handling, OTP atomic attempt), which are stated in one line.
