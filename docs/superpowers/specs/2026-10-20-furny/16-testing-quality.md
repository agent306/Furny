# 16 — Testing & Quality

Read the master document, `01`, `02`, `03`, `09`, `13` and `14` first. This file is normative for **how Furny is tested**: strategy, tools, test databases and fakes, factories and fixtures, the required suites per area with named test cases, browser/3D/performance/accessibility tests, static-analysis gates, coverage targets, the CI matrix (implemented by `17 §10.2`), staging test data, flaky-test policy and how agents run tests in the development container. Section-specific test lists in `04 §9`, `05 §18`, `06 §16`, `07 §12`, `08 §10`, `12 §12`, `13 §20` and `18 §17` are **part of** the required suites below (this file adds to them; it never removes a case).

---

## 1. Strategy and test pyramid

| Layer | Tool | Location | Scope | Share of tests (target) |
|---|---|---|---|---|
| Engine unit & property | Vitest (Node env) | `resources/js/engine/**/__tests__/*.test.ts` | pure TS: units, geometry, plan derive, commands, furniture generation, BOM, nesting, pricing, money | ~35 % |
| Frontend unit/component | Vitest + `@vue/test-utils` + happy-dom | `resources/js/{editor,lib,composables,components,pages}/**/__tests__` | stores, tools, autosave client, http/upload clients, components, i18n keys, token contrast | ~15 % |
| PHP unit | Pest | `tests/Unit` | pure PHP: `QuoteCalculator`, `MinorMath`, `MagicBytes`, `FileName`, `Mask`, `CostCalculator`, rules, Data mappers | ~10 % |
| PHP feature | Pest + Postgres + Redis | `tests/Feature` | HTTP routes (14), Actions, transitions (09), policies (13), jobs, commands, notifications (12), AI ledger (18) | ~30 % |
| Contract | Pest + real engine CLI; pytest + engine CLI; Vitest on vision samples | `tests/Feature/Contract`, `vision/tests/test_schema_contract.py`, `resources/js/engine/plan/__tests__/vision-contract.test.ts` | PHP ↔ engine CLI ↔ vision pydantic ↔ zod; PHP ↔ TS calculators | ~3 % |
| Vision | pytest | `vision/tests` | pipeline, providers, API, accuracy harness | (separate service) |
| Browser journeys | Pest browser plugin (Playwright/Chromium) | `tests/Browser/**/*Test.php` | end-to-end user journeys, role visibility, editors by pointer/touch | ~5 % |
| Browser smoke/a11y/perf | Playwright Test + `@axe-core/playwright` | `tests/Browser/playwright/*.spec.ts` | WebGL/3D smoke, visual snapshots, axe scans, performance traces | ~2 % |

Rules:
1. **Test-first.** Every Action, transition, endpoint and engine function lands with its tests in the same PR; every bug fix adds a regression test at the **lowest** layer that reproduces it.
2. **Deterministic.** No real network (`Http::preventStrayRequests()` globally; vision tests offline; `ReplayProvider`), fixed time (`$this->travelTo()`, `Carbon::setTestNow`, Vitest fake timers), seeded randomness (`mulberry32(42)` in TS, `mt_srand(42)`/Faker seed 42 in PHP), deterministic ids (`testIds()` in TS, `Str::createUlidsUsing()` in PHP where ids are asserted).
3. **Real dependencies where cheap, fakes at system boundaries.** Postgres, Redis and the Node engine CLI are real; S3, Gotenberg, mail, WhatsApp/SMS providers, web push services, Turnstile, Google, HIBP, the vision service and Reverb are faked (§4.4).
4. **Exhaustive datasets over hand-picked examples** wherever a normative table exists (transitions `09 §2`, role matrix `13 §7.2`, event catalogue `12 §3`, route registry `14`, error codes `06 §14`, `18 §14`).
5. A test name states behaviour (`it('rejects T10 when the quote expired')`), not implementation.

---

## 2. Tools and configuration

| Tool | Version / package | Config |
|---|---|---|
| Pest | `pestphp/pest ^5.3`, `pestphp/pest-plugin-laravel`, `pestphp/pest-plugin-browser` (same major) | `phpunit.xml` (suites `Unit`, `Feature` — including `Feature/Contract` —, `Browser`), `tests/Pest.php`, `tests/TestCase.php` |
| Playwright (Chromium) | `playwright` + `@playwright/test`, one pinned version shared by the Pest browser plugin and the Playwright suite; locally the preinstalled browsers in `/opt/pw-browsers` (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`, Chromium revision 1194 — pin the Playwright release that bundles this revision, and bump both together), in CI `yarn playwright install --with-deps chromium` | `playwright.config.ts` (§8.1) |
| Vitest | `vitest ^3`, `@vitest/coverage-v8`, `@vue/test-utils`, `happy-dom`; `vitest bench` | `vitest.config.ts` with projects `engine` (`environment: 'node'`, `include: resources/js/engine/**`) and `app` (`environment: 'happy-dom'`, setup `resources/js/test/setup.ts` installing i18n with the generated `en` messages, a Wayfinder-safe `route()` stub and `ResizeObserver`/`matchMedia` shims) |
| Accessibility | `@axe-core/playwright ^4.10` | §11 |
| Python | pytest, pytest-cov, ruff, mypy (strict), uv | `vision/pyproject.toml` (`[tool.pytest.ini_options] markers = ["live: real provider calls"]`, `addopts = "-m 'not live'"` locally overridable) |
| Static analysis | Larastan `^3.13` level 8, Pint `^1.32`, ESLint, Prettier, vue-tsc, ruff, mypy `--strict` | §14 |

`phpunit.xml` `<php>` env (the testing environment; CI overrides only DB/Redis hosts):

```
APP_ENV=testing  APP_MAINTENANCE_DRIVER=file  BCRYPT_ROUNDS=4
DB_CONNECTION=pgsql  DB_DATABASE=furny_test
CACHE_STORE=array  SESSION_DRIVER=array  QUEUE_CONNECTION=sync  MAIL_MAILER=array
BROADCAST_CONNECTION=log  FILESYSTEM_DISK=s3  PULSE_ENABLED=false  TELESCOPE_ENABLED=false
REDIS_DB=14  REDIS_CACHE_DB=15  REDIS_SESSION_DB=13
VISION_SERVICE_URL=http://vision.test  VISION_SERVICE_TOKEN=test-vision-token-0123456789abcdef0123
GOTENBERG_URL=http://gotenberg.test  HEALTH_CHECK_TOKEN=test-health-token
TURNSTILE_SITE_KEY=  TURNSTILE_SECRET_KEY=  FEATURE_WHATSAPP=true  FEATURE_SMS=true  FEATURE_WEB_PUSH=true  FEATURE_GOOGLE_LOGIN=true
VAPID_PUBLIC_KEY=<test key pair committed in phpunit.xml>  VAPID_PRIVATE_KEY=<…>
ENGINE_NODE_BINARY=node  UPLOADS_TESTING_LOCAL=true
```

`tests/TestCase.php::setUp()` asserts `DB::connection()->getDriverName() === 'pgsql'` (a SQLite run fails immediately — **SQLite is never used**: JSONB operators, partial unique indexes, `FOR UPDATE` and `RETURNING` are part of the behaviour under test), fakes `s3` and `s3-public` (`Storage::fake`), calls `Http::preventStrayRequests()`, binds `FakeWhatsAppClient` and `ArraySmsDriver` (`12 §12`), `Pdf::fake()` (spatie/laravel-pdf), and resets the settings cache.

---

## 3. Test tree

```
tests/
├─ Pest.php                         uses(TestCase, LazilyRefreshDatabase)->in('Feature'); uses(TestCase, RefreshDatabase)->in('Browser');
│                                   uses(TestCase)->in('Unit'); global datasets; expectations (toBeUlid, toBeCamelCaseKeys, toMatchApiError)
├─ TestCase.php
├─ Support/                         Actors.php (actingAsCustomer, actingAsStaff(role), owner/admin/... helpers incl. 2FA confirmed),
│                                   RoleMatrix.php (literal copy of 13 §7.2), FakeVision.php, FakeEngineCli.php, UsesRedis.php,
│                                   InertiaProps.php (assertPropsMatch), ApiAssertions.php, UploadIntents.php (readyUpload()),
│                                   BrowserHelpers.php, coverage-gate.php, Seeders/{TestBaselineSeeder, E2eSeeder}.php
├─ Unit/        Money/ Pricing/ Uploads/ Privacy/ Rules/ Notifications/ Ai/ Settings/ Support/
├─ Feature/     Auth/ Security/ Routes/ Customer/ Admin/ Api/ Orders/Workflow/ Orders/ Quotes/ Imports/ Uploads/
│               Notifications/ Ai/ Catalog/ Settings/ Messaging/ Media/ Jobs/ Console/ Health/ I18n/ Concurrency/
│               Contract/{EngineCli, Vision, Types}/ Performance/ Meta/ Database/
├─ Browser/     Customer/ Staff/ Imports/ PlanEditor/ Furniture/ Roles/ Phone/   (Pest browser, *Test.php)
│  └─ playwright/  smoke-3d.spec.ts visual.spec.ts a11y.spec.ts perf.spec.ts global-setup.ts __screenshots__/
└─ fixtures/    (§5.2)
```

---

## 4. Databases, services and fakes

### 4.1 PostgreSQL

- Database `furny_test` on PostgreSQL (CI: 18; `docker/dev/pg-init.sql` creates it locally, `17 §3.2`). The role needs `CREATEDB`: `--parallel` creates one database per worker (`furny_test_1`, `furny_test_2`, …, Laravel parallel testing).
- The `Feature` suite (incl. `Feature/Contract`) uses **`LazilyRefreshDatabase`** (migrate once per process, each test in a rolled-back transaction, no transaction opened for tests that never touch the DB). `Browser` uses **`RefreshDatabase`** (the Pest browser plugin serves the app in-process, so the test transaction is visible to the app). `tests/Feature/Concurrency` (ledger and design-locking races, `18 §17.2`, `09 §3`) uses **`DatabaseTruncation`** because two real connections must see committed rows.
- Baseline data: `protected bool $seed = true; protected string $seeder = TestBaselineSeeder::class;` = `RolesAndPermissionsSeeder`, `SettingsSeeder`, `TaxRatesSeeder`, `CatalogSeeder` (the production seeders 1–4 of `02 §14`; no owner, no demo data). Tests that need a different catalog build it with factories inside the test.
- Every migration is exercised by `tests/Feature/Database/MigrationsTest.php`: `migrate:fresh` then `migrate:rollback` to zero then `migrate` again (down methods work); schema assertions for the partial unique indexes and CHECK constraints of `02` (e.g. second `sent` quote per order → `UniqueConstraintViolationException`; user without email and phone → CHECK violation).

### 4.2 Redis

Default cache/session/queue in tests are `array`/`sync`. Tests that depend on Redis semantics (collapse windows `12 §6.1`, daily recognition counters `18 §11.1`, rate limiters at their documented thresholds `13 §20.19`, catalog snapshot cache, `health:*` keys, session registry `13 §6.3`) use the `UsesRedis` trait: switches `cache.default` to `redis` (DB 15) and the `sessions` connection to DB 13, and `FLUSHDB`s both before each test. CI provides Redis 7.4 (`17 §10.2`); locally the container's `redis-server` (§19).

### 4.3 Engine CLI

Feature (incl. contract) tests call the **real** CLI (`node engine-cli/dist/cli.mjs`, built by `yarn build:engine-cli` before the PHP suite; `17 §10.2` php job). `FakeEngineCli` (bound with `EngineCli::fake([...command => response])`) is used only where a test must control the CLI result (`08 §10.7` stale-revision refresh, CLI crash paths, `ComputeRevisionBom` failure twice → `failed`).

### 4.4 Boundary fakes (no Docker, no network)

| Boundary | Fake | Notes |
|---|---|---|
| S3 / R2 (`s3`, `s3-public`) | `Storage::fake('s3')`, `Storage::fake('s3-public')`; `Storage::disk(...)->buildTemporaryUrlsUsing(fn ($path, $exp) => URL::temporarySignedRoute('testing.files.show', $exp, ['disk' => …, 'path' => $path]))` | presigned PUT URLs come from `App\Support\Uploads\PresignedUploadUrlGenerator`; with `UPLOADS_TESTING_LOCAL=true` (phpunit.xml) the container binds `LocalTestingUploadUrlGenerator`, which signs `PUT /_testing/uploads/{key}` (route registered only when `config('uploads.testing_local')` is true, which boot refuses outside `local`/`testing`) and enforces the signed `Content-Type`/`Content-Length` exactly like S3 (mismatch → 403); `tests/Unit/Uploads/S3PresignedUploadUrlGeneratorTest.php` covers the production generator against a mocked `S3Client` (signed `Content-Type` and `Content-Length` headers, 15-minute expiry) |
| Gotenberg | `Pdf::fake()` (spatie/laravel-pdf) | assert view, data, paper size, landscape for cut lists; draft watermark |
| Vision service | `Http::fake(['vision.test/*' => FakeVision::sequence(...)])` with recorded bodies from `tests/fixtures/vision/*.json` (§13.4) | `FakeVision` helpers: `inspect('png')`, `inspect('pdf', pages: 3)`, `recognize('hdb-3room.none')`, `busy(retryAfter: 20)`, `error('no_walls_detected', 422)`, `capabilities('anthropic-only')`, `providerTest(ok: true)`, `normalizeImage()` |
| Mail | `Mail::fake()` / `MAIL_MAILER=array` | rendered HTML + text snapshots in `12 §12.14` |
| Notifications | `Notification::fake()` | routing datasets (§6.10) |
| WhatsApp / SMS | `FakeWhatsAppClient`, `ArraySmsDriver` (`12 §12`) | webhook fixtures in `tests/fixtures/webhooks` |
| Web push | `WebPush` client mocked (`Minishlink\WebPush\WebPush` bound to a fake returning `MessageSentReport`s, incl. 410) | |
| Reverb / broadcasting | `BROADCAST_CONNECTION=log`; `Event::fake([ShouldBroadcast classes])` to assert channel, `broadcastAs`, payload | `/broadcasting/auth` tested with the `null` connection replaced by a pusher-compatible fake (`Broadcast::connection('reverb')` bound to `FakePusherBroadcaster`) |
| Queues | `Queue::fake()` / `Bus::fake()` for dispatch assertions; `QUEUE_CONNECTION=sync` otherwise | job classes also have direct `handle()` tests |
| Turnstile | captcha off by default; captcha tests set the keys in config and `Http::fake` `challenges.cloudflare.com/*` | success, wrong hostname, wrong action, timeout (fail-open vs fail-closed) |
| Google OAuth | `Socialite::fake('google', $user)` | `13 §20.7` |
| HIBP (`uncompromised()`) | not called (`Password::defaults()` is the non-production rule in tests); one test runs the production rule with `Http::fake('api.pwnedpasswords.com/*')` | |
| Time / TZ | `travelTo()`; business TZ `Asia/Kolkata`; tests around midnight and month boundaries | |

### 4.5 The `testing` routes

`routes/testing.php` (loaded only when `config('uploads.testing_local')`): `testing.uploads.put` (`PUT /_testing/uploads/{key}`, signed) and `testing.files.show` (`GET /_testing/files/{disk}/{path}`, signed). They are excluded from the route registry test (§6.3) and asserted absent in `APP_ENV=production` (`tests/Feature/Routes/TestingRoutesAbsentTest.php`).

---

## 5. Factories, states and fixtures

### 5.1 Factories (`database/factories`, one per model; every factory's default state is valid and minimal)

Order-state data is assembled by `Database\Seeders\Support\OrderScenarioBuilder` (no Faker; lives under `database/seeders`, autoloaded in production) so that **the same code** builds test states and the staging `DemoSeeder` (§17).

| Model | Factory states |
|---|---|
| `User` | `customer()` (default), `staff(string $role)`, `owner()`, `admin()`, `estimator()`, `production()`, `support()` (staff states set `onboarded_at`, verified email, password, role; `owner()`/`admin()` include a confirmed TOTP secret unless `withoutTwoFactor()`), `unverified()`, `emailVerified()`, `phoneVerified()`, `phoneOnly()`, `passwordless()`, `googleLinked()`, `inactive()`, `notOnboarded()`, `termsPending()` (staff-created customer), `imperial()`, `pendingDeletion(int $days = 5)`, `deletionExpired()` (31 days), `anonymised()` |
| `Address` | `forUser($u)`, `international($cc)` |
| `OtpCode` | `forPhone($e164, code: '123456')`, `verifyPhone()`, `sms()`, `expired()`, `consumed()`, `attempts(int)` |
| `NotificationPreference` | `for($event, $channel)`, `disabled()` |
| `StaffInvitation` | `pending()`, `expired()`, `accepted()`, `revoked()`, `role($r)` |
| `UploadIntent` | `purpose($p)`, `target($model)`, `pending()`, `uploaded()`, `ready(string $fixture)` (writes the processed object to the faked disk from `tests/fixtures/uploads`), `rejected($reason)`, `consumed()`, `expired()` |
| `NotificationDelivery` | `whatsapp()`, `sms()`, `pending()`, `accepted()`, `sent()`, `delivered()`, `read()`, `failed($code)`, `fallbackOf($delivery)`, `otp()` |
| `Project` | `forCustomer($u)`, `archived()`, `withSiteAddress()`, `createdByStaff($s)` |
| `Plan` | `fromFixture('hdb-3room'\|'brochure-2bhk'\|'rect-4000x3000'\|'empty')`, `imported()`, `traced()`, `duplicated()`, `locked($staff)`, `withRevisions(int)`, `withThumbnail()` |
| `PlanRevision` | `manualCheckpoint()`, `importAccepted()`, `beforeRestore()`, `staffEdit()`, `autoDaily()` |
| `BlueprintImport` | `uploaded()`, `inspected(kind)` (`raster`\|`pdf_vector`\|`pdf_raster`\|`dxf`\|`heic`, with `pages` media), `queued()`, `preprocessing()`, `recognizing()`, `readyForReview(fixture)` (result document + `ImportResultMeta` from fixture, `normalized` media), `accepted($plan)`, `discarded()`, `failed($code)`, `cancelled()`, `trace()`, `reserved(int)`, `charged(int)`, `scaleUnconfirmed()` |
| `FurnitureDesign` | `fromFixture('wardrobe-3door'\|'tv-unit-1800'\|'bookshelf-5shelf'\|'kitchen-base-600'\|'dining-table-6seat'\|'study-desk-cabinet')`, `invalid()` (has an `error` issue that is not save-blocking), `lockedBy($order)`, `withEstimate()`, `staleEstimate()`, `withThumbnail()` |
| `FurnitureRevision` | `orderSubmitted()`, `staffProposal()`, `proposalApplied()`, `manualCheckpoint()`, `beforeRestore()`, `bomPending()`, `bomReady()` (bom/price from `tests/fixtures/engine-cli/compute-bom.{fixture}.json`), `bomFailed()`, `staleCatalog()`, `staleEngine()` |
| `FurniturePreset` | `category($c)`, `inactive()`, `fromFixture($f)`, `withThumbnail()` |
| `FurnitureTemplateSetting` | `disabled()`, `withDefaultOverrides(array)` |
| `Material`, `EdgeBand`, `HardwareItem`, `Finish` | `code($c)`, `hidden()` (`is_active = false`), `archived()` (soft-deleted); `Material::withGrain()`, `glass()`; `HardwareItem::category($c)`, `defaultFor(array $keys)` |
| `LabourRate` | `key($k)`, `inactive()` |
| `TaxRate` | `gst18()` (default), `rate(int $bps)`, `inactive()`, `default()` |
| `AiCreditLedgerEntry` | `signupGrant(n)`, `monthlyGrant($period, n)`, `adminGrant(n)`, `adminRevoke(n)`, `reservation($import, n)`, `reservationRelease($import, n)`, `consumption($import, n)`, `refund($import, n)` |
| `AiUsageEvent` | `succeeded()`, `failed()`, `providerTest()`, `provider($p, $model)`, `cost(int $microUsd)`, `at($datetime)` |
| `Order` | one state per `09 §1` state: `draft()` (never submitted, `DRAFT-…` number), `draftReopened()`, `submitted()`, `inReview()`, `changesProposed()`, `quoted()`, `quoteExpired()` (quoted, `valid_until` < today), `negotiating()`, `accepted()`, `confirmed()`, `inProduction(int $progress = 40)`, `completed()`, `rework()`, `readyForDelivery()`, `delivered()`, `closed()`, `cancelled(string $reason = 'staff_cancelled')`, `onHold(string $from = 'in_review')`; modifiers `withItems(int\|array $fixtures)`, `forCustomer($u)`, `assignedTo($s)`, `productionAssignee($s)`, `needsInstallation(bool)`, `withQuotePdf()`, `withCalls(array $outcomes)`, `withDeliveryScheduled()`, `withOpenIssue()`. Each state builds the full consistent history (numbers, pinned `bomReady` revisions, design locks, proposals/quotes/negotiations/calls/updates/issues/delivery rows, milestone timestamps, `state_changed_at`, `state_before_hold`, activity entries) |
| `OrderItem` | `pinned($revision)`, `quantity(n)`, `room($label)` |
| `ChangeProposal` | `draft()`, `sent()`, `resolved()`, `withdrawn()` |
| `ChangeProposalItem` | `withStaffDraft(array $document)`, `unchanged()`, `pending()`, `approved()`, `rejected($comment)` |
| `Quote` | `draft()`, `sent()`, `accepted()`, `declined()`, `superseded()`, `expired()`, `withdrawn()`, `validUntil($date)`, `inclusiveTax()`, `withLinesFromFixture($name)` (`tests/fixtures/quotes`), `withPdf()` |
| `QuoteLine` | `furniture($item)`, `installation($item)`, `delivery()`, `discount(int $minor)`, `custom()`, `hidden()` |
| `QuoteNegotiation` | `open()`, `answeredKeepPrice()`, `answeredWithRevision($quote)`, `closed()`, `withTarget(int)`, `withItemComments()` |
| `ConfirmationCall` | `confirmed()`, `noAnswer()`, `callbackRequested($at)`, `wrongNumber()`, `wantsChanges()`, `declined()` |
| `ProductionUpdate` | `stage($key, $progress)`, `internal()`, `completion()`, `withPhotos(int)` |
| `OrderIssue` | `open()`, `inProgress()`, `resolved()`, `rejected()`, `forItem($item)`, `withPhotos(int)` |
| `Delivery` | `scheduled($from, $until)`, `delivered(bool $installed = true)`, `withPhotos(int)` |
| `Message` / `MessageRead` | `text()`, `system($event, $payload)`, `internalNote()`, `withAttachments(int)`, `editable()` (< 10 min), `old()` (> 10 min); `MessageRead::upTo($message)` |
| `Payment` | default only (phase 2 migration smoke test) |

Settings are changed in tests with `setting('workflow.quote_validity_days', 7)` (helper calling `UpdateSettings`, so cache busting and `catalog.version` bumps are real). Notifications rows are created with `notifyDatabase($user, $eventKey, read: false)`.

### 5.2 Fixtures

| Path | Content | Consumers |
|---|---|---|
| `database/fixtures/plans/{hdb-3room,brochure-2bhk}.json`, `database/fixtures/plan-starters/*.json`, `database/fixtures/furniture/*.json` (6) | `03 §6`, `10 §8.3`, `07 §12.2` | factories, Vitest, contract tests, DemoSeeder |
| `tests/fixtures/catalog/seed-snapshot.json` | `CatalogSnapshot` of the seed catalog (`08 §7`) at `catalog.version = 1`, generated by `php artisan testing:seed-catalog-snapshot` (local/testing-only command; `--check` fails when stale; CI php job) | Vitest `seedCatalog` (`resources/js/engine/testing/seedCatalog.ts`), contract tests |
| `tests/fixtures/money/*.json` | `[{fn, args, expected}]` (`08 §1`, `§10.1`) | Pest `MinorMath` + Vitest `money.ts` (**shared**) |
| `tests/fixtures/quotes/*.json` | the five fixtures of `08 §10.6` + `hidden-lines.json` (bundling, `08 §6.4`) | Pest `QuoteCalculator` + Vitest `quoteTotals.ts` (**shared**) |
| `tests/fixtures/engine-cli/` | request/response pairs: `validate-plan.{hdb-3room,brochure-2bhk}.json`, `plan-summary.*.json`, `validate-furniture.wardrobe-3door.json`, `compute-bom.{each furniture fixture}.json` (wardrobe = `08 §10.2` numbers), `cutlist-csv.wardrobe-3door.csv`, `template-default.{templateKey}.json`, `diff-furniture.wardrobe-width-2100.json`, `invalid-input.json` | contract tests, `FurnitureRevision::bomReady()` |
| `tests/fixtures/vision/` | recorded vision responses (`inspect.*.json`, `recognize.*.json`, `normalize.trace.json`, `images-normalize.json`, `capabilities.*.json`, `providers-test.*.json`, `error.{code}.json`) generated from the FastAPI app (§13.4) | `FakeVision` |
| `tests/fixtures/uploads/` | `exif-gps-rotated.jpg`, `photo.heic`, `plan.png`, `plan.webp`, `plan-3pages.pdf`, `plan-21pages.pdf`, `encrypted.pdf`, `plan.dxf`, `real.dwg` (header `AC1032`), `renamed-dwg.dxf`, `script.svg`, `bomb-50mp.png` (valid header, 7100 × 7100), `jpeg-as-png.png`, `thumb-800x600.png`, `thumb-640x480.png`, `filenames.php` (`13 §20.12` cases) | upload, import, thumbnail tests |
| `tests/fixtures/webhooks/` | WhatsApp status bodies (`sent`, `delivered`, `read`, `failed-131026`, `out-of-order`), Twilio status params, MSG91 DLR bodies | webhook tests |
| `tests/fixtures/notifications/params.php` | parameter values for SMS/WhatsApp rendering (`12 §5.1`) | catalogue test |
| `tests/fixtures/routes/registry.json`, `tests/fixtures/routes/authorization.php` | every route of `14` (name, method, URI, middleware); per route the actor rule (`ownership`, permission, gate, guest, signed, token) | §6.2, §6.3 |
| `tests/fixtures/props/*.keys.json` | key trees of every page props interface, generated from `resources/js/types/pages.d.ts` + `generated.d.ts` by `node scripts/props-keys.mjs` (TypeScript compiler API; committed, CI-checked by the Contract suite) | §6.4 |
| `vision/tests/fixtures/reference/*`, `vision/tests/fixtures/llm/*.labeling.json`, `vision/tests/fixtures/contract/*.json` | `03 §6`, `06 §16` | pytest, evaluate.py, Vitest vision contract |

---
## 6. Backend suites (Pest)

### 6.1 Order workflow — every transition (`tests/Feature/Orders/Workflow`)

`TransitionMatrixTest.php` asserts that `OrderState::config()` allows **exactly** the transitions T1–T31 (T23 unused) of `09 §2`/`§9` and no other pair; then one file per transition (`T04StartReviewTest.php`, …) with these cases, each driven through the HTTP route of `14` (not the Action alone):

1. **allowed**: the allowed actor in every allowed *from* state → success response, new state, `state_changed_at` = now, milestone timestamp, side effects below, domain event dispatched once (`Event::fake([NotifiableDomainEvent])`, `eventId()` is a ULID), system message posted (`messages.kind = system`, `system_event` = event key) where `09` says Msg, activity entry `orders` log with `from`/`to`;
2. **wrong state**: every other state (dataset of the 16 states minus the allowed ones) → 409 `invalid_transition` (Inertia: flash `orders.errors.invalid_transition`), no side effects;
3. **forbidden actors**: guest → login redirect; other customer → 404; customer on staff routes → 403; staff without the permission → 403; staff on customer routes → redirect `admin.dashboard`;
4. **preconditions** listed below each fail with their documented error.

| T | Route (`14`) | From | Allowed | Forbidden actors asserted | Side effects / preconditions asserted | Event(s) |
|---|---|---|---|---|---|---|
| T1 | `customer.projects.orders.store` | — | project owner | other customer, staff | draft order with `DRAFT-` number, items with null revision; design in another Active order → 422 `design_in_active_order`; foreign design → validation error | — |
| T2 | `customer.orders.submit` | `draft` | owner with verified email **or** phone | unverified owner (flash `common.verify_required` / 403 `contact_unverified`) | number `ORD-{YYYY}-{00001}` from `number_sequences` (concurrent submits get distinct numbers, `Concurrency/OrderNumberTest`); reused on resubmission; revision `order_submitted` per item pinned; `locked_by_order_id`; `ComputeRevisionBom` dispatched per item (`Queue::fake`); `submitted_at`; design with an `error` issue → 422 per item; missing address/installation → 422 | `order.submitted` |
| T3 | `customer.orders.cancel` | `draft` (submitted before) | owner | staff | never-submitted draft → 409; `cancel_reason = customer_withdrew`; `cancelled_at` | `order.cancelled` |
| T4 | `admin.orders.start-review` | `submitted` | owner, admin, estimator | production, support | `assigned_to` = actor only when null; `reviewed_at` | `order.review_started` |
| T5 | `customer.orders.reopen` | `submitted`, `in_review`, `changes_proposed`, `quoted`, `negotiating` | owner | staff | sent quote → `withdrawn`; sent/draft proposals → `withdrawn`; designs unlocked; `furniture_revision_id` null; number kept | `order.reopened` |
| T6 | `admin.orders.proposals.send` | `in_review` | owner, admin, estimator | production, support | proposal `sent`; revision `staff_proposal` per changed item; `changes` = engine diff; unchanged items dropped; none left → 422 `proposal_empty`; staff draft with `error` issue → 422; BOM jobs dispatched | `order.changes_proposed` |
| T7 | `customer.orders.proposals.resolve` | `changes_proposed` | owner | staff | undecided item → 422; reject without comment → 422; approved items: pinned revision = `to_revision`, working document replaced, `working_version + 1`, `current_revision_id`; rejected unchanged; proposal `resolved` | `order.changes_resolved` |
| T8 | `admin.orders.proposals.withdraw` | `changes_proposed` | owner, admin, estimator | production, support | proposal `withdrawn` | `order.changes_withdrawn` |
| T9 | `admin.orders.quotes.send` | `in_review` | owner, admin, estimator | production, support | every blocker of `11 §5.5` → 409 `quote_send_blocked` (one case each); previous sent quote `superseded`; `current_quote_id`; `RenderQuotePdf` chained (`Pdf::fake`); `quoted_at` set only the first time | `quote.sent` |
| T10 | `customer.orders.quotes.accept` | `quoted` | owner | an owner-role staff user (no blanket `Gate::before`, `13 §7.3`) → 403 | `acceptTerms` false → 422; expired (`valid_until` < today business TZ) → 409 `quote_expired`; not current → 409 `quote_not_current`; quote `accepted`, `accepted_by_ip`, `accepted_quote_id`, open negotiations `closed` | `quote.accepted` |
| T11 | `customer.orders.quotes.negotiate` | `quoted` | owner | staff | rounds = max → 409 `negotiation_limit`; setting off → 409 `negotiation_disabled`; target ≥ total → 422; negotiation `open` with `item_comments` | `quote.negotiation_opened` |
| T12 | `admin.orders.negotiations.keep-price` | `negotiating` | owner, admin, estimator | production, support | answer required; optional `validUntil` extension (≥ current); negotiation `answered_keep_price`; quote still `sent` | `quote.negotiation_answered` |
| T13 | `admin.orders.quotes.send` | `negotiating` | owner, admin, estimator | production, support | as T9 + `answerMessage` required, negotiation `answered_with_revision`, `resulting_quote_id` | `quote.sent`, `quote.negotiation_answered` |
| T14 | `customer.orders.quotes.decline` | `quoted`, `negotiating` | owner | staff | reason required; quote `declined`; `cancel_reason = quote_declined`; designs unlocked | `quote.declined`, `order.cancelled` |
| T15 | `orders:expire-quotes` | `quoted` | system | — | quote valid until today → untouched; until yesterday (business TZ, test at 23:59/00:01 local) → `expired`, order `in_review`, Msg | `quote.expired` |
| T16 | `admin.orders.confirm` | `accepted` | owner, admin, estimator, support | production | no confirmed call and no `call` → 422 `confirmation_call_required`; embedded call created in the same transaction; `expected_delivery_on` required; `confirmed_at` | `order.confirmed` |
| T17 | `admin.orders.back-to-negotiation` | `accepted` | owner, admin, estimator, support | production | call with `customer_wants_changes` required; quote `superseded`; `accepted_quote_id` null; negotiation created on behalf | `order.reopened_after_call` |
| T18 | `admin.orders.cancel` | `accepted` | owner, admin, estimator | support, production | `unresponsive` requires ≥ 3 `no_answer` calls; `declined_on_call` requires a declined call (or embedded `call`) | `order.cancelled` |
| T19 | `admin.orders.start-production` | `confirmed` | owner, admin, production | estimator, support | `production_started_at`; automatic first update (first stage, customer-visible) | `order.production_started` |
| T20 | `admin.orders.complete` | `in_production`, `rework` | owner, admin, production | estimator, support | fewer photos than `workflow.require_completion_photos` → 422; open/in-progress issue (rework) → 422 `open_issues`; completion update (`is_completion`, progress 100) | `order.completed` |
| T21 | `customer.orders.completion.approve` | `completed` | owner | staff | `customer_approved_at` | `order.customer_approved` |
| T22 | `customer.orders.issues.store` | `completed` | owner | staff | ≥ 1 issue; photos consumed from `issue_photo` intents | `order.issue_raised` |
| T24 | `admin.orders.deliver` | `ready_for_delivery` | owner, admin, production | estimator, support | future `deliveredAt` → 422; `delivered_at` on order and delivery; photos | `order.delivered` |
| T25 | `admin.orders.close` and `orders:auto-close-delivered` | `delivered` | owner, admin; system after `workflow.auto_close_days` | estimator, production, support | open issue → 422 `open_issues`; designs unlocked; scheduler skips orders with open issues | `order.closed` |
| T26 | `admin.orders.hold` | every Active state except `on_hold` (dataset) | owner, admin, estimator, production | support | reason required; `state_before_hold`; activity property `reason` read back as `OrderData.holdReason` | `order.on_hold` |
| T27 | `admin.orders.resume` | `on_hold` | owner, admin, estimator, production | support | returns to `state_before_hold` (dataset over all holdable states), clears it | `order.resumed` |
| T28 | `admin.orders.cancel` | `submitted`, `in_review`, `changes_proposed`, `quoted`, `negotiating`, `accepted`, `confirmed`, `on_hold` | owner, admin, estimator | production, support | reason enum + note required; sent quote `withdrawn`; proposals `withdrawn`; designs unlocked | `order.cancelled` |
| T29 | `customer.orders.withdraw` | `submitted`, `in_review` | owner | staff | `cancel_reason = customer_withdrew` | `order.cancelled` |
| T30 | `admin.orders.cancel` | `in_production`, `rework`, `completed`, `ready_for_delivery`, `delivered` | role owner only (gate `orders.cancel_late`) | admin, estimator → 403 | as T28 | `order.cancelled` |
| T31 | `admin.orders.issues.store` | `delivered` | owner, admin (`orders.close`) | estimator, production, support | issue `open`, order `rework` | `order.issue_raised` |

Non-transition actions (`09 §2` second table) get the same treatment in `Orders/OrderActionsTest.php`: assign/bulk-assign (`order.assigned` once per changed order), production update (progress ≥ last customer-visible, ≤ 99; internal updates never broadcast on `orders.{id}` nor notified), log call (each outcome; `callback_requested` delays `DispatchCallbackDue` to `callback_at` and the job does nothing when a newer call exists or the state moved on), resolve issue, schedule delivery, item quantity edit (`order.items_changed`), messages (90-day closed-thread rule), draft deletion. `Orders/DesignLockingTest.php` covers `09 §3` (423 on customer save of a locked design, duplicate allowed, placements movable, staff edits only via proposal drafts).

### 6.2 Authorisation matrix (`tests/Feature/Security`)

- `PermissionSeederTest`: the seeded roles × 24 permissions equal `tests/Support/RoleMatrix.php` (a literal transcription of `13 §7.2`), idempotent on re-seed.
- `RouteAuthorizationTest`: dataset = every route of `tests/fixtures/routes/registry.json` × actors {guest, customer (owner of the target), other customer, owner, admin, estimator, production, support}; expected status computed from `tests/fixtures/routes/authorization.php` (per route: `public`, `guest`, `signed`, `token`, `ownership`, `permission:x`, `gate:x`, `any_staff`, `auth`) combined with `RoleMatrix`. Route parameters are built by a resolver per parameter name using the factories. Expected: allowed → not 401/403/404 (2xx/3xx/409/422 accepted because state may not allow the action); denied → 403 (staff without permission), 404 (non-owner customer records), 302 to `login` (guest), 302 to `admin.dashboard` (staff on customer routes). This **is** `13 §20.1`'s `RouteCoverageTest` (a route missing from the fixture fails).
- `OwnerGatesTest`: admin cannot T30, cannot invite/grant owner, cannot change currency, cannot open or update `ai`/`auth` settings, cannot anonymise; last active owner cannot be demoted/deactivated; inactive staff denied everything (`Gate::before`).
- `IdorTest` (`13 §20.2`): customer A vs customer B for project, plan, design, import, order, quote, proposal, message, media, upload intent, notification (all 404).
- `CostVisibilityTest`: production and support never receive `costSnapshot`, `internalNotes`, `price` (item viewer), `directCostMinor`, margins in any Inertia or JSON payload (recursive key search over the response).

### 6.3 Routes and FormRequests (`tests/Feature/Routes`, `tests/Unit/Requests`)

- `RouteRegistryTest`: `php artisan route:list --json --except-vendor` plus Fortify routes equals `tests/fixtures/routes/registry.json` (name, method, URI, middleware list); every route is named; no two routes share a name; `testing.*` absent unless enabled.
- One dataset test per FormRequest (`tests/Unit/Requests/{Area}/{Request}Test.php`): a valid payload passes; for each rule of `14` a boundary pair (e.g. `quantity` 1 and 99 pass, 0 and 100 fail; `name` 120 passes, 121 fails); camelCase keys only (snake_case variant rejected as missing) except the Fortify/auth forms; error message keys match `10`/`11` (e.g. `orders.errors.installation_required`).
- `MiddlewareBehaviourTest`: JSON vs Inertia responses of every alias in `14 §1.2`.

### 6.4 Inertia props and JSON contracts (`tests/Feature/{Customer,Admin,Api}`, `tests/Feature/Contract/Types`)

- Every page route: `assertInertia(fn ($p) => $p->component('Customer/Orders/Show'))` and `assertPropsMatch('CustomerOrderShowProps')`, which compares the response prop key tree with `tests/fixtures/props/CustomerOrderShowProps.keys.json` (deferred/optional props checked after a partial reload with `only`). Shared props shape (`SharedProps`) on a customer page, a staff page and a guest page.
- Every JSON endpoint of `14 §18`: success status + body keys; each error code listed for it via `toMatchApiError(status, code)` (asserts `{code, message}` + code-specific fields such as `currentVersion`, `retryAfter`, `issues`).
- `CamelCaseWireTest`: no snake_case key anywhere in Inertia props or JSON (except `features.*` and `meta.*` of paginators), recursive.
- `Contract/Types/GeneratedTypesTest`: `php artisan typescript:transform` output equals the committed file; `props-keys` output equals the fixtures.

### 6.5 Authentication, OTP, sessions (`tests/Feature/Auth`; `13 §20.5–§20.11`)

Named cases (each a separate `it`):
- Login: throttled after 5 failures per email+IP (429/flash), 30/min per IP; inactive message only after a correct password; staff never get a remember cookie; session id rotates on login; intended URL honoured only when same-origin; staff with 2FA → challenge; customer with remember → 14-day cookie.
- Registration: closed registration → 403; email taken incl. soft-deleted → `auth.email_unavailable`; URL in name rejected; Turnstile required when enabled (fail-open on timeout); `CustomerRegistered` dispatched; **no** signup credits until `ContactVerified`.
- OTP send: 6 digits; stored hashed; expires in 10 min; 60 s cooldown (`otp_cooldown` + `retryAfter`); 5 per phone per hour, 10 per IP per hour (`otp_rate_limited`); captcha required on the 3rd send (session, phone or IP counters) and fail-closed on Turnstile timeout; non-allowlisted country → `phone_country_not_supported`; landline → `phone_not_mobile`; new code expires previous ones; WhatsApp first then SMS on `WhatsAppSendException`; all channels failing → 503 `otp_send_failed` and the row expired; global hourly cap disables SMS; code never in logs (`Log::spy`), queue payloads (`Queue::fake` asserts nothing queued), broadcasts or `notification_deliveries.context`; identical responses for existing and unknown numbers.
- OTP verify: wrong code → `otp_invalid` with `attemptsLeft`; 5th wrong attempt kills the code (`otp_too_many_attempts`, audit `auth.otp_locked`); non-numeric input does not consume an attempt; double submit consumes once; expired → `otp_expired`; staff phone → `staff_use_email`; soft-deleted → `account_pending_deletion`; new number with name → account created verified + `ContactVerified`; without name → complete page within 15 min, after 15 min rejected.
- Asynchronous WhatsApp failure → SMS fallback code sent, `auth.otp.status` reports `{channel: 'sms', fallbackSent: true}`.
- Google: state mismatch, user cancel, unverified email, link by verified email, pending invitation email does not create a customer, `intent=link` conflicts (`google_in_use`, `google_email_mismatch`), `intent=reauthenticate` sets `auth.password_confirmed_at`, unlink blocked when last method.
- Invitation: tampered/expired signature → `InvitationInvalid`; 72 h expiry; accepted/revoked reuse rejected; email already a customer → 422; Google option requires same email; owners/admins redirected to 2FA after acceptance.
- 2FA: owner/admin redirected to enrolment until confirmed (HTML) / 403 `two_factor_required` (JSON); disable blocked for owner/admin; recovery code single use; customers get 403 on every `two-factor.*` route; staff reset clears secret and sessions.
- Sessions: 12 h absolute staff lifetime (travel 12 h 1 min → logout); "sign out other devices" destroys other sessions and rotates the remember token; per-session revoke via `sessionKey` (foreign key → 404); password reset revokes sessions; `recent.auth` redirects (password users → `password.confirm`, passwordless → `auth.reauthenticate`) and passes within 10 min.
- Password reset: generic response for unknown email, throttle 3/h per email, token single use, 60 min expiry, sets `email_verified_at`.
- Email change requires recent auth, clears verification, sends verification; clearing the last login method → `last_login_method`.
- Phone verify: number used by another user (incl. soft-deleted) → `phone_unavailable`; first verified contact dispatches `ContactVerified` exactly once (`GrantSignupCredits` grants once; second contact grants nothing).
- Account deletion/export/anonymisation (`13 §20.20`): export excludes password, tokens, 2FA secrets, `notes_internal`, internal notes; deletion blocked with Active orders; drafts deleted/cancelled; anonymisation after 30 days clears every PII column of `13 §9.2` and keeps orders; restore within 30 days; owner immediate anonymisation.

### 6.6 Uploads (`tests/Feature/Uploads`; `13 §11`, `§20.12`)

Presign per purpose (dataset of the 14 purposes): allowed types, size limit, target authorisation (other user's order → 404), DWG extension → 422 `dwg_not_supported`, signed headers returned; confirm: not owner → 404, expired → 422 `upload_invalid`, size mismatch → 422 `upload_size_mismatch` and object deleted; `ProcessUpload`: magic-byte table (JPEG/PNG/WebP/HEIC/PDF/DXF ASCII+binary/DWG), finfo agreement, SVG/GIF/TIFF rejected, 50 MP image rejected (`upload_image_too_large`), EXIF orientation applied and **no GPS tag** after processing (`exif-gps-rotated.jpg`), HEIC via faked `POST /v1/images/normalize`, PDF stored as-is and served as attachment, filename sanitisation cases (`../../etc/passwd`, RTL override, 300 chars, emoji), processed key extension from the sniffed type; consumption: wrong purpose/target/user or already consumed → 422 `upload_invalid` with `uploadId`; consumed intent attaches media to the right collection; `media:cleanup-orphans` deletes unconsumed intents after 24 h; the testing PUT route enforces signed `Content-Type`/`Content-Length` (§4.4).

### 6.7 Autosave and concurrency protocol (`tests/Feature/Api/Autosave`; `03 §5`)

For each of plans, furniture designs, proposal item drafts, import review documents and preset documents (`updatedAt` token):
- success returns the new version (`working_version + 1`) and `savedAt`; plan saves store `summary`; furniture saves store bbox and the display estimate;
- stale `baseVersion` → 409 `version_conflict` with `currentVersion`, `savedBy {id, name}`, `savedAt`; "Keep mine" (resend with `currentVersion`) succeeds;
- concurrent saves with the same `baseVersion` (two DB connections, `Concurrency/AutosaveRaceTest`) → exactly one 200 and one 409;
- locked plan → 423 `plan_locked` for working copy, checkpoint and restore — also for staff; locked design → 423 `in_order` with `orderNumber`; staff working-copy save on a locked design → 423;
- save-blocking issues → 422 `invalid_document` with `issues`; non-blocking `error` issues of furniture are accepted (`03 §2.4`);
- document > 2 MB → 422;
- first staff save on a customer plan creates a `staff_edit` revision of the previous document; first save of a business day creates `auto_daily`; restore creates `before_restore`;
- `autosave` limiter: 61st save within a minute → 429 `rate_limited` (with `UsesRedis`);
- proposal draft on a non-draft proposal → 409 `proposal_not_draft`; requires `orders.propose_changes`.

### 6.8 Quotes, pricing and money parity (`tests/Unit/Pricing`, `tests/Feature/Quotes`)

- `MinorMathTest` runs every case of `tests/fixtures/money/*.json`; `QuoteCalculatorTest` runs every `tests/fixtures/quotes/*.json` (`exclusive-two-rates` total **3 541 522**, `inclusive-two-rates` **3 025 900**, `fractional-qty` **294 998**, `untaxed-group`, `discount-exceeds` → `discount_exceeds_subtotal`, `hidden-lines`) — the **same files** run in Vitest against `quoteTotals.ts` (§7.1), which is the PHP/TS parity guarantee.
- `08 §10.7` feature tests (BuildQuoteDraft lines, prices incl. tax `2 869 000`/`229 700`, stale revision refresh, idempotent draft, `ComputeRevisionBom` ready/failed, cut-list CSV header and 12 rows, customer → 403).
- Quote draft optimistic lock (`updatedAt`) → `version_conflict`; regenerate keeps custom/discount lines; send renders the PDF (`Pdf::fake` asserts `pdf.quote` view, data URIs only — no `http` URLs in the rendered HTML, `13 §12.9`); customer serialisation folds hidden lines (`08 §6.4`) and never exposes them.

### 6.9 Blueprint imports, Laravel side (`tests/Feature/Imports`; `06 §16.4`)

Every case of `06 §16.4` plus: A1–A12 status/error matrix from `14 §18.3` (each listed error code at least once); state machine of `06 §3` (every allowed transition, an invalid one → 409 `invalid_import_state`); `RunBlueprintRecognition` with each vision error code of `06 §14.2` mapped to the `ImportErrorCode`, retryable vs not, credits refunded per table, daily counter give-back; `imports:cleanup-stale` five rules; `ImportStatusChanged` payload `{importId, status, stage, progress: null, error, at}`; contact verification required for auto mode (403 `contact_unverified`) but not for trace; staff on behalf (`plans.edit_any`) keeps `user_id`.

### 6.10 Notifications (`tests/Feature/Notifications`, `tests/Unit/Notifications`; `12 §12`)

All 17 suites of `12 §12`. The **routing dataset** `datasets/routing.php` is hand-written from the tables of `12 §3.2` and `§3.3` (not generated from `config/notification_events.php`, so the config is tested against the spec): one row per (event key, rule) with recipient fixture, audience and expected channels for a user with default preferences, verified email + phone, one push subscription and all features on. Test name: `it('routes {event} rule {n} to {recipient} via {channels}')`. 48 event keys (33 order + 15 non-order) × rules. Additional cases per event: the actor is excluded unless `include_actor`; staff without `orders.view` or inactive are skipped; transactional events bypass preferences and never carry unsubscribe headers; `system.test_push` only web push; quiet hours delay WhatsApp/SMS only; `ensure_external` forces WhatsApp then SMS for `quote.sent`, `order.confirmed`, `order.delivery_scheduled`, `order.cancelled` when the user disabled every external channel.

### 6.11 AI credits, budgets, usage (`tests/Feature/Ai`; `18 §17.2`)

All cases of `18 §17.2` (ledger invariants property test with 200 random operations; two-connection reservation race in `Concurrency/`), plus HTTP: grant/revoke/refund routes (`not_a_customer`, `revoke_exceeds_balance`, `nothing_to_refund`), `api.ai.credits` shape, `AiCreditsChanged` broadcast after every ledger write, AI settings validation and the `settings.manage_restricted` gate, provider test throttle (11th call/min → 429).

### 6.12 Catalog, presets, templates, settings (`tests/Feature/{Catalog,Settings}`)

Every catalog write bumps `catalog.version` once and sets `catalog.seed_reviewed`; `code` immutable; unique incl. archived; hide vs archive semantics in the snapshot (`isActive = false`, still present); `isDefaultFor` key moves between items; tax default switching; CSV export → import of the unchanged file gives `unchanged = rows`, `errors = 0` for all six tables; one changed price → one `update`; invalid rows listed per line; expired token → 404; `api.catalog.snapshot` ETag/304 and cache invalidation on bump. Presets: create via `template-default`, reorder within a category, slug uniqueness, preset document 409/422. Templates: disable hides template and its presets from `customer.projects.furniture.create`; invalid defaults → `invalid_defaults`. Settings: each group's rules (boundaries of `14 §16`), currency lock after the first quote and owner gate, production stage key immutability and used-key protection, pricing save bumps `catalog.version`, `settings.updated` activity with redacted `#[Encrypted]` fields (`13 §15`).

### 6.13 Messaging, media, timeline (`tests/Feature/{Messaging,Media}`)

Customer post requires verified contact; 5000-char limit; ≤ 5 attachments; edit within 10 min only (`edit_window`); internal notes invisible to customers in props, broadcasts (`orders.{id}` vs `orders.{id}.internal`), timeline and exports; read markers; `messages-post` limiter at 21/min; Markdown XSS cases (`<script>`, `javascript:` links, `<img onerror>`) neutralised (`13 §20.17`); `media.show` per model/collection rule of `13 §8.9` (internal production photos 404 for customers, PDFs as attachment, `Cache-Control: private, no-store`); customer timeline excludes internal entries and call details except `no_answer` dates.

### 6.14 Jobs, scheduler, console, health (`tests/Feature/{Jobs,Console,Health}`)

`routes/console.php` schedule equals `01 §7` (command, frequency, time, `onOneServer`, `withoutOverlapping`) — asserted from `Schedule::events()`; each command: `orders:expire-quotes`, `orders:auto-close-delivered`, `orders:remind-pending` (one reminder per order per 48 h, `quote.expiring_soon` 2 days before), `notifications:staff-digest` (configured hour only, once per day), `notifications:prune`, `imports:cleanup-stale`, `ai:grant-monthly-credits` (`18 §10.2`), `media:cleanup-orphans`, `otp:prune`, `otp:monitor` (sets `auth:captcha_always` and `health:otp` at < 20 % conversion with ≥ 50 sends), `users:anonymise-deleted`, `activitylog:clean`; heartbeat closure writes `health:scheduler:heartbeat`. Job contracts: queue name, timeout, tries/backoff/`retryUntil`, uniqueness (`ComputeRevisionBom`, `RunBlueprintRecognition`, `RenderCutListPdf`). `health.deep`: token required (404 without), 200 with `degraded` when vision/gotenberg/reverb/storage fail, 503 when database/redis/horizon/scheduler fail (each check simulated); `/up` answers with the database down.

### 6.15 Security checklist mapping (`13 §20`)

Items 1–20 of `13 §20` are implemented by: 1 → §6.2; 2 → §6.2 `IdorTest`; 3 → §6.7; 4 → §6.2 `OwnerGatesTest`; 5–11 → §6.5; 12 → §6.6; 13 → `Security/HeadersTest` (CSP nonce equals the `@vite` script nonce, `frame-ancestors 'none'`, HSTS only in production over HTTPS, `X-Frame-Options: DENY`, `CSP_REPORT_ONLY` header switch, cookie flags incl. `__Host-session` and the unencrypted `appearance` cookie); 14 → `Security/CsrfTest` (419 on web and `/api` without token, webhooks and `csp-report` exempt); 15 → §6.10 webhooks; 16 → §6.13; 17 → §6.13; 18 → `Security/TrustedProxiesTest`; 19 → `Security/RateLimitsTest` (every limiter of `14 §1.11` at its threshold, using `UsesRedis`, reading limits from `config('security.rate_limits')`); 20 → §6.5. Additional: `Security/LogRedactionTest` (`13 §16`: passwords, tokens, OTP codes, emails and phones masked in every log channel), `Security/SecretsNotLeakedTest` (no `VISION_SERVICE_TOKEN`, provider keys or `APP_KEY` in any Inertia/JSON response or rendered mail).

### 6.16 i18n (`tests/Feature/I18n`)

Every `trans_icu()`/`__()` key used in PHP and every `t('…')` literal in `resources/js` exists in `resources/lang/en/*.php` (static scan); every ICU message parses; `php artisan i18n:export` output equals the committed `resources/js/lang/generated/*` (also a CI step); the pseudo-locale `en-XA` (test-only) changes every label on a sample of pages (`05 §19`).

---
## 7. Frontend suites (Vitest)

### 7.1 Engine (`resources/js/engine/**/__tests__`, project `engine`, Node environment)

Required files and cases are those of `04 §9` (units, geometry, rooms, reconcile, snapping, footprints, conflicts, command bus, plan commands, derive bench, drawing, purity), `07 §12` (deterministic ids, wardrobe fixture snapshot, drawer construction, other construction values, property test with `mulberry32(42)`, diff tests, bench) and `08 §10.1–§10.6`. Concretely asserted numbers (any change is a deliberate engine version bump, `01 §5.2` `ENGINE_VERSION`):

| Area | File | Exact expectations |
|---|---|---|
| Units | `units/parse.test.ts`, `format.test.ts` | every row of `04 §1.5` (`3200`, `320cm`, `3.2m`, `10'6"`, `10' 6 1/2"`, `126in`, …) incl. bare numbers in the user's unit; imperial formatting to 1/8"; round-trip parse(format(x)) = x for 0–100 000 mm (fuzz, 10 000 seeded samples) |
| Geometry | `geometry/*.test.ts` | `04 §9` table; offset of a 1000 square by 100 = 1200 square; planar faces of two adjacent squares = 2 faces + outer |
| Rooms | `plan/rooms.test.ts` | `hdb-3room.json` → ≥ 9 rooms with the named metas (3 bedrooms 3100/3600/3100 wide, 3 toilets, kitchen, living 7600 wide, balcony 3600 × 900); `brochure-2bhk.json` → bedrooms 10'0"×11'0" (3048 × 3353 ± 1 mm), living/dining, kitchen, two toilets, deck; `faceKey` stable after moving an unrelated node |
| Plan validation | `plan/validate.test.ts` | every code of `03 §1.1` (error vs warning; `plan.too_large` limits) |
| Furniture | `furniture/__tests__/*` | `wardrobe-3door.json` equals `TEMPLATES.wardrobe_hinged.generate(defaults)`; 20 parts with the sizes/edges of `07 §12.2`; fronts rects; 14 hardware lines; operations (hinge cups 12, shelf-pin holes 232, handle holes 6, cams 16, dowels 16); issues exactly `back_split {count: 2}`, `anti_tip_added`, `weight_estimate {kg: 144.4}` |
| BOM | `bom/__tests__/wardrobe.test.ts` | 12 cut-list rows (`08 §10.2`); edge banding `EB08-WHITE` = **32 767 mm**; HDF3-WHITE `{partCount 2, netAreaMm2 3 516 884, sheetsNested 2, utilization 0.5907}`; PB18-WHITE `{partCount 18, netAreaMm2 11 531 232, sheetsNested 5, utilization 0.7727}`; operations as above; every nesting placement `(x, y, rotated)` of `08 §10.2` sheet by sheet |
| Nesting | `bom/nesting/__tests__/guillotine.test.ts` | cases A, B, C, D, D′ of `08 §10.4` exactly (A: 1 sheet, util 0.9896, c (0,0), a (0,200), b (604,200), cuts `[{0,196,1000,196},{600,200,600,500}]`); property tests (inside usable area, kerf spacing, each instance once, grain locks, determinism × 3 runs, 300 parts < 200 ms) |
| Pricing | `bom/__tests__/pricing.test.ts` | wardrobe `PriceBreakdown`: material 1 002 550, edge band 19 662, hardware 298 400, finishing 0, labour 316 574, direct **1 637 186**, overhead 163 719, margin 630 317, unit price **2 431 300**, installation 194 600, total before tax 2 625 900; `whole_sheets` unit price 2 763 800; tax-inclusive display 2 869 000; `nesting: false` gives an identical breakdown in `used_area` mode; labour rules of `08 §4.3`; installation minimum |
| Money | `money.test.ts` | every case of `tests/fixtures/money/*.json` (shared with Pest) |
| Quote totals | `resources/js/lib/__tests__/quoteTotals.test.ts` | every `tests/fixtures/quotes/*.json` (shared with Pest) — PHP/TS parity |
| Catalog | `catalog/__tests__/snapshot.test.ts` | `seed-snapshot.json` parses with `CatalogSnapshotSchema`; hardware spec schemas per category accept the seed rows and reject a hinge without `overlay` |
| Migrations | `plan/migrate.test.ts`, `furniture/migrate.test.ts` | v1 no-op migration registry; unknown future version → error |
| Purity | `purity.test.ts` | every engine module imports in Node without DOM; ESLint `no-restricted-imports` also enforced (§14) |

### 7.2 Application (`project app`, happy-dom)

- Plan editor: every file of `05 §18` (viewport, store, tools state machines per `05 §7` table rows, `LengthInput`, fixtures, exports, i18n keys, autosave).
- Furniture builder: store commands (apply/undo deep equality), mode switching on a 423 response, estimate pipeline cancels stale worker requests (`useEngineWorker`), checkpoint/duplicate menu actions call the right Wayfinder routes.
- `lib/http.test.ts`: maps every status/code of `14 §1.8` to the documented client behaviour (toast, editor state, conflict dialog payload, `Retry-After` handling, 419 → reload prompt).
- `lib/upload.test.ts`: presign → PUT (exact signed headers) → confirm → poll until `ready`/`rejected` (1 s, max 60 s), abort cancels the PUT, retry creates a new intent, `rejected` maps `reasonCode` to `imports.error.*`/`uploads.errors.*` keys.
- `autosave.test.ts` (shared editor layer): `03 §5` timings (debounce 1500 ms, max wait 10 s, single in-flight, one queued follow-up), localStorage draft keys `fs:draft:{type}:{id}`, restore offers (same base version vs older), backoff 2/4/8/16/30 s, `beforeunload` keepalive request with `X-XSRF-TOKEN`.
- Components: `StatusBadge`/`StatusPill` tone for every `OrderStateKey` and `ImportStatus`; `MoneyDisplay` (INR `en-IN` grouping, approx prefix); `DimensionText` in metric/imperial; `QuoteView` hides actions unless current + sent + `quoted`; `ProposalReviewBody` disables decisions in preview; `PreferencesMatrix` locked/unavailable/fallback cells; `PushOptIn` iOS non-standalone instructions; `MessageBody` is the only `v-html` user.
- Composables: `useOrderChannel` reload sets (`10 §11.4.8`, `11 §5.3.12`) with a mocked Echo; polling fallback after 5 s disconnected; `useImportChannel` polling while non-terminal.
- `tokens-contrast.test.ts` (`15 §14.6`); `i18n-keys.test.ts` for `resources/js/**` literals.
- Wayfinder discipline: ESLint rule `no-restricted-syntax` forbids string literals and template literals that start with `/api/`, `/admin`, `/orders`, `/projects`, `/plans`, `/furniture`, `/imports`, `/account` in `resources/js/**` (except `resources/js/**/__tests__` and `public/sw.js`).

---

## 8. Browser tests

### 8.1 Runners

| Runner | Scope | Server | Config |
|---|---|---|---|
| **Pest browser plugin** (`tests/Browser/**/*Test.php`) | user journeys, role visibility, editors by mouse/touch, phone viewports | app served **in-process** by the plugin; `RefreshDatabase`; all fakes of §4.4 active (browser uploads go through the testing upload route to the faked disk) | `tests/Pest.php`: `pest()->browser()->timeout(15_000)`; default viewport 1280 × 800, light theme; failure screenshots in `tests/Browser/screenshots`; every test ends with `->assertNoJavaScriptErrors()` and `->assertNoConsoleLogs()` (allowlist: none) |
| **Playwright Test** (`tests/Browser/playwright/*.spec.ts`) | WebGL/3D smoke, visual snapshots, accessibility, performance traces, route-mocked resilience (409 conflict dialog, offline + restore draft) | `php artisan serve --host=127.0.0.1 --port=8123 --env=e2e` started by `webServer`; `.env.e2e` (committed, no secrets): `APP_ENV=testing`, fixed test `APP_KEY`, `DB_DATABASE=furny_test`, `QUEUE_CONNECTION=sync`, `MAIL_MAILER=log`, `BROADCAST_CONNECTION=log`, `SESSION_DRIVER=file`, `CACHE_STORE=file`, `UPLOADS_TESTING_LOCAL=true` + `E2E_LOCAL_DISKS=true` (testing-only switch mapping `s3`/`s3-public` to local disks with signed temporary URLs), vision URL unreachable (the suite never runs recognition); `globalSetup` runs `php artisan migrate:fresh --env=e2e --force` and `php artisan db:seed --env=e2e --force --class="Tests\\Support\\Seeders\\E2eSeeder"` | `playwright.config.ts`: `workers: 1`, `retries: process.env.CI ? 1 : 0`, `failOnFlakyTests: true`, `use: {baseURL: 'http://127.0.0.1:8123', trace: 'retain-on-failure', reducedMotion: 'reduce', launchOptions: {args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']}}`, projects `chromium-light` and `chromium-dark` (cookie `appearance`), reporter HTML to `build/playwright` |

`E2eSeeder` (tests only, deterministic, no Faker): one staff user per role (`{role}@e2e.test`, password `password`; owner/admin with the fixed TOTP secret `JBSWY3DPEHPK3PXP`, generated codes via `Tests\Support\Totp`), customer `customer@e2e.test` (verified email + phone) with project "E2E Flat" (`hdb-3room` plan, the six furniture fixtures as designs with BOM-ready revisions), orders in `quoted` (quote PDF attached from `tests/fixtures/pdf/quote-sample.pdf`) and `completed` (3 completion photos from `tests/fixtures/uploads/plan.png`), an import in `ready_for_review` (`hdb-3room` result), and a 100-wall plan built with `makeGridPlan`-equivalent PHP builder for performance traces.

### 8.2 Customer journey (`tests/Browser/Customer/RegisterToSubmittedOrderTest.php`)

`it('takes a new customer from registration to a submitted order')` — desktop 1280 × 800:
1. `/register`: name, email, password ×2, terms → onboarding wizard; step 1 name; step 2 metric/mm; step 3 project "My home", apartment; step 4 **Draw from scratch** → plan editor (`customer.plans.edit`).
2. Wall tool: draw a closed 4000 × 3000 room by clicking four corners (canvas coordinates computed from the viewport fit) and typing `4000` Enter / `3000` Enter in the length input; door tool on the bottom wall; window tool on the right wall; select the room, rename to "Bedroom" in the properties panel; status indicator reaches **Saved**; DB: `working_version > 1`, 4 walls, 2 openings, room meta "Bedroom".
3. Designs flyout → **New design** → template `wardrobe_hinged` → width `1800` → **Create** → builder; change shelf count in the Layout panel → **Saved**; **Place in plan** → back in the plan editor in placement mode → click against the top wall inside the room → **Saved**; DB: one placement with `wallAttachment` set.
4. Verify email: visit the signed `verification.verify` URL generated in the test (`URL::temporarySignedRoute`) → banner disappears.
5. Builder **Order this design** → order create page with the design preselected → **Continue** → draft: quantity 1, room "Bedroom", new address (all fields), installation **Yes**, preferred date ≥ min → **Submit order** → dialog (optional phone step → **Skip**) → **Send order** → order page shows panel "Waiting for review" and number `ORD-{year}-00001`; DB: order `submitted`, revision `order_submitted` pinned, design locked; `ComputeRevisionBom` ran (sync) → `bom_status = ready`.
6. Re-open the design: read-only banner "part of order …" with **Duplicate to edit**.

Variant `it('runs the same journey on a tablet with touch')` (768 × 1024, `hasTouch`) for steps 2–3.

### 8.3 Staff journey (`tests/Browser/Staff/OrderLifecycleTest.php`)

`it('drives an order from review to closed')` — data: `Order::factory()->submitted()->withItems(['wardrobe-3door'])`; actors switch with `->actingAs()`/logout-login in the same browser (owner/admin log in with TOTP):
1. **Estimator**: `admin.orders.show` → **Start review** (T4) → **Propose changes** → **Edit design** → builder in proposal mode (amber banner) → set the two-leaf front overlay to half → **Saved** → **Back to order** → item note → **Preview** (diff list shows `front_changed` and hinge quantity changes) → **Send to customer** (T6).
2. **Customer**: proposal page → **Approve all** → **Send my decisions** (T7) → order `in_review`.
3. **Estimator**: **Create quote** → builder shows furniture/installation lines → add discount 1000 → **Save** → **Send** (valid until default) (T9) → `Pdf::assertRespondedWithPdf`/rendered.
4. **Customer**: quote page → **Accept quote** with the terms checkbox (T10).
5. **Support**: dashboard **To call** → **Log call** outcome Confirmed with **Mark the order confirmed now** + expected delivery (T16).
6. **Production** (phone viewport 390 × 844): **Start production** (T19) → **Post update** with 3 photos from `tests/fixtures/uploads/plan.png` (upload intents) → **Mark completed** with 1 photo (T20).
7. **Customer**: completion page → **Looks good** (T21).
8. **Production**: **Schedule delivery** (window) → **Record delivery** installed (T24).
9. **Admin**: **Close order** (T25) → state `closed`; designs unlocked.
Assertions after each step: state, the visible panel of `11 §5.3.3`/`10 §11.4.2`, and `Notification::assertSentTo` for the step's event (notifications faked in-process).

### 8.4 Import review journey (`tests/Browser/Imports/ImportReviewJourneyTest.php`)

Per `06 §16.4`: customer uploads `tests/fixtures/uploads/plan.png` on `customer.projects.imports.create` (mode Analyze; vision faked: `inspect('png')`, `recognize('hdb-3room.none')` with three low-confidence entities) → import page progresses to "ready to review" (sync queue) → review page shows amber/red entities and **Needs your attention (n)** → **Looks right** decrements n → **Check a dimension** on a wall of known length rescales by the right factor → **Accept plan** (new plan) → plan editor opens with walls; DB: plan `source = imported`, revision `import_accepted`, credits charged 1 (balance 2 → after signup grant 3). Second test: trace mode calibrates `mmPerPixel` within 0.5 % (`06 §17.10`).

### 8.5 Other required browser suites

| File | Covers |
|---|---|
| `Customer/OrderPanelsTest.php` | for each of the 16 order states (factories) the customer order page shows exactly the `ActionPanel` title and actions of `10 §11.4.2`; expired quote shows no actions |
| `Roles/StaffVisibilityTest.php` | per role (owner, admin, estimator, production, support): sidebar items, settings nav items, order panel buttons per state of `11 §5.3.3`, cost blocks only with `quotes.view_costs` (`11 §20.2`) |
| `PlanEditor/*Test.php` | `05 §18` browser list except the route-mocked cases (in Playwright): 2-room flat by mouse and by touch, 2D↔3D switch keeps selection, furniture placement + 3D gizmo move, checkpoint + restore, all five exports download (PNG/SVG/PDF/DXF/GLB magic bytes), phone viewer, read-only for support/locked plan/archived project |
| `Furniture/BuilderTest.php` | create from preset and from template, simple/advanced modes, locked read-only + **Duplicate to edit**, cut-list exports visible to staff only |
| `Phone/*Test.php` | 390 × 844: customer order page, quote accept, completion approval, message with photo; staff production update with camera input; editors show the view-only notice |
| `Auth/*Test.php` | phone OTP sign-up with the code read from `ArraySmsDriver`/`FakeWhatsAppClient`, Google sign-in (`Socialite::fake`), staff 2FA enrolment flow with QR + recovery codes |
| `playwright/editor-resilience.spec.ts` | `05 §11` conflict dialog (route-mocked 409) with Reload theirs / Keep mine / Save mine as copy; offline (route abort) shows "Offline — changes kept on this device", reload offers **Restore unsaved changes** |

---

## 9. Visual and 3D smoke tests (Playwright Test)

`smoke-3d.spec.ts` (Chromium with SwiftShader, §8.1):
1. Plan editor on the seeded `hdb-3room` plan → switch to 3D → a `<canvas>` with a WebGL2 (or WebGL1) context exists; a canvas screenshot has pixel standard deviation > 8 (not blank) and differs from the 2D screenshot; no console message matching `/WebGL|THREE\.|GL_INVALID|context lost/i`; orbit drag changes the canvas pixels; walk mode (`features.walkthrough_camera`) enters and exits with Esc.
2. Furniture builder (wardrobe) → `Preview3D` renders (same pixel checks); "Doors open" toggle changes pixels; exploded view toggles.
3. `Thumbnail3D` cards on the project designs tab render or show their static thumbnail.
4. Proposal diff viewer (staff preview) renders before/after with the legend.
5. GLB export from the plan editor and the builder: downloaded file > 1 KB, starts with `glTF`, version 2.
6. 3D chunk load failure (route-abort the 3D chunk) → `plan_editor.view3d.load_failed` with **Retry**, 2D still usable (`05 §1.5`).

`visual.spec.ts` (`toHaveScreenshot`, `maxDiffPixelRatio: 0.01`, animations disabled, self-hosted fonts): 2D plan of `hdb-3room` at fit zoom (light and dark), wardrobe front elevation, nesting sheet 1 of the wardrobe item viewer, customer quote page of the seeded quote, admin order board. Baselines live in `tests/Browser/playwright/__screenshots__/` and are produced by the pinned Chromium on Linux (CI and this container use the same revision); updates only via `yarn playwright test visual.spec.ts --update-snapshots` committed with the reason in the PR.

---

## 10. Performance budgets

| Budget (target → CI assertion) | Source | Mechanism |
|---|---|---|
| Cold derive 97 walls 15 → **30 ms**; warm derive after `moveNode` 4 → **8 ms**; cold derive 1012 walls 200 → **400 ms**; `snapPoint` 500 walls 0.5 → **1 ms**; snap+hit index 3 → **6 ms**; `moveNode` command incl. derive 6 → **12 ms**; `validatePlan` 3 → **6 ms** | `04 §7.3` | Vitest bench `plan/derive.bench.ts` |
| `generateFurniture` 60 parts median ≤ **15 ms**; `estimateFurniture` median ≤ **60 ms** (p95 target 100 ms) | `07 §12.7` | Vitest bench `furniture/generate.bench.ts` |
| `computeBom` without nesting 60 parts 10 → **20 ms**; `nestSheets` 300 parts → **< 200 ms** | `08 §9.3` | Vitest bench `bom/bom.bench.ts`, `bom/nesting/nesting.bench.ts` |
| Engine CLI `compute-bom` incl. Node start 1.5 → **3 s** | `08 §9.3` | `tests/Feature/Contract/EngineCli/PerformanceTest.php` (median of 3) |
| Editor JS excl. 3D ≤ **250 KB** gz; 3D chunk ≤ **700 KB** gz | `05 §16.1` | `node scripts/check-bundle-size.mjs` after `yarn build` (exact limits) |
| Props → first 2D frame, 100 walls 300 → **600 ms**; 2D→3D first switch 500 → **1000 ms**, subsequent 150 → **300 ms**; node drag frame 16 → **32 ms**; 3D incremental update after moving a wall 30 → **60 ms**; heap growth after 10 mount/unmount cycles 20 → **40 MB** | `05 §16.1` | `playwright/perf.spec.ts` reading `performance.measure` entries the editor always records (`furny:2d:first-frame`, `furny:3d:ready`, `furny:drag:frame`, `furny:3d:update`) and `performance.memory` |
| Customer order page ≤ 40 queries, admin order page ≤ 60, admin board ≤ 30, catalog snapshot (warm) ≤ 3 | `14` (no N+1) | `tests/Feature/Performance/QueryBudgetTest.php`; `Model::preventLazyLoading()` enabled in tests (lazy load → exception) |

`yarn bench:check` = `vitest bench --run --outputJson build/bench.json && node scripts/check-bench.mjs build/bench.json resources/js/engine/bench-thresholds.json` (thresholds file holds the CI column above; the script fails when a median/p95 exceeds its threshold). Benchmarks are never retried; a regression is fixed or the threshold change is justified in the PR together with the owning section.

---

## 11. Accessibility

`playwright/a11y.spec.ts` runs `new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])` in both themes on: welcome, login, register, phone login, customer dashboard, project page (each tab), plan editor (2D, 3D, with the export, revisions and conflict dialogs open), furniture builder, order page in `quoted` and `completed`, quote page, proposal review, notifications, account notifications (preferences matrix), admin dashboard, admin order board and order detail, quote builder, catalog materials list, settings business, staff page. Pass = **zero `serious` or `critical` violations**; `minor`/`moderate` are reported as test annotations. Exceptions require an entry in `tests/Browser/playwright/a11y-allowlist.json` (`{rule, selector, reason, expiresOn}`); expired entries fail; the list must be empty at each release (`17 §11`).

Keyboard smoke (Pest browser, `Roles/KeyboardTest.php`): after every Inertia navigation focus lands on `#main h1`; dialogs trap focus and return it to the trigger; the plan editor rename-room and wall-thickness flows work with keyboard only (`05 §19`); skip link works. Manual screen-reader checklist before each release (NVDA + Firefox on Windows, VoiceOver + Safari on macOS/iPadOS): sign in, rename a room and change a wall thickness in the plan editor, read the order timeline, accept a quote, post a message, change notification preferences — results recorded in the release PR.

---

## 12. Vision service (pytest)

- Every file of `06 §16.1` and `18 §17.1` (offline: `httpx.MockTransport`, `FakeProvider`, `ReplayProvider`); `test_live_providers.py` is `@pytest.mark.live` and runs only manually (`uv run pytest -m live` with keys set).
- Accuracy harness `scripts/evaluate.py --fail-under` with providers `none` and `replay` on both reference fixtures must meet every target of `06 §16.3` (e.g. `hdb-3room` with `none`: scale error ≤ 5 %, wall IoU ≥ 0.65, room F1 ≥ 0.60; `brochure-2bhk` with `none`: scale error ≤ 8 %, wall IoU ≥ 0.50, key-plan inset excluded) — CI vision job (`17 §10.2`).
- Runtime targets (≤ 60 s `none`, ≤ 240 s LLM on the 2-vCPU production profile) are verified manually on staging before each release; CI asserts ≤ 120 s for `none` per fixture on the GitHub runner.
- `ruff check`, `ruff format --check`, `mypy --strict app`, coverage ≥ 85 % (`pytest-cov`, §15).

---

## 13. Contract tests

1. **Engine CLI ↔ PHP** (`tests/Feature/Contract/EngineCli`): each command of `01 §5.4` with the request fixtures of `tests/fixtures/engine-cli` — `validate-plan` on both plan fixtures (valid, summary equals the committed snapshot), `validate-furniture` on all six furniture fixtures (`valid` uses `SAVE_BLOCKING_CODES` only), `compute-bom` wardrobe equals the `08 §10.2` numbers, `cutlist-csv` header row exactly `08 §8.1` + UTF-8 BOM + CRLF, `template-default` for every template key passes `validate-furniture`, `diff-furniture` wardrobe vs width 2100 begins with `price_changed` then `dims_changed`, `version` equals `resources/js/engine/version.ts`; malformed input → `{ok: false, error: {code: 'invalid_input'}}` with exit code 0; `EngineCli` throws `EngineCliException` on `ok: false` and on a crash (non-zero exit simulated with a fake binary).
2. **PHP Data ↔ TypeScript**: generated types and props key fixtures current (§6.4).
3. **Vision pydantic ↔ engine zod**, both directions: `vision/tests/test_schema_contract.py` writes recognition outputs for both fixtures (providers `none`, `replay`) and the DXF fixture to `vision/tests/out/*.json` and validates each with `node $ENGINE_CLI validate-plan` (no `error` issues); `vision/tests/fixtures/contract/*.json` (committed samples of `/v1/recognize` responses) are parsed by `resources/js/engine/plan/__tests__/vision-contract.test.ts` with `PlanDocumentSchema` and by PHP `VisionRecognizeResultData::from()` in `tests/Feature/Contract/Vision/RecognizeResultTest.php`.
4. **Laravel `VisionClient` ↔ FastAPI**: `vision/scripts/record_contract_fixtures.py` drives the FastAPI app with `TestClient` (providers `none`/`FakeProvider`) and writes `tests/fixtures/vision/*.json` (request + response + status + headers); `vision/tests/test_contract_fixtures_current.py` regenerates and diffs them (CI vision job), and `tests/Feature/Contract/Vision/VisionClientContractTest.php` replays them through `Http::fake`, asserting request bodies sent by `VisionClient` (bearer token, `X-Request-Id`, presigned URL fields, options) equal the recorded requests and that every error body maps to the documented `ImportErrorCode`.
5. **Calculators**: money and quote fixtures shared by Pest and Vitest (§6.8, §7.1).
6. **Broadcast payloads**: `ImportStatusChanged`, `AiCreditsChanged`, `NotificationCreated` (`NotificationPayloadData`), `OrderStateChanged` payloads serialised in Pest and parsed against TS fixtures in Vitest (`resources/js/composables/__tests__/channels.contract.test.ts`).

---

## 14. Static analysis and quality gates

| Gate | Command | Rule |
|---|---|---|
| Larastan | `vendor/bin/phpstan analyse` | level **8** on `app`, `config`, `database`, `routes`, `tests/Support`; no baseline file allowed; `checkMissingIterableValueType` on; generics for collections |
| Pint | `vendor/bin/pint --test` | Laravel preset + `declare_strict_types`, `final_class` (master §6.6) |
| ESLint | `yarn eslint . --max-warnings=0` | Vue/TS recommended + engine purity `no-restricted-imports` (`01 §5.1`, `04 §10`), `vue/no-v-html` (only `MessageBody.vue`), Wayfinder URL rule (§7.2), `@typescript-eslint/no-explicit-any` error |
| Prettier | `yarn prettier --check resources/ engine-cli/` | generated dirs (`resources/js/actions`, `routes`, `wayfinder`, `lang/generated`, `types/generated.d.ts`) in `.prettierignore` |
| vue-tsc | `yarn vue-tsc --noEmit` | `strict: true`, `noUncheckedIndexedAccess: true` |
| ruff | `uv run ruff check .`, `uv run ruff format --check .` | rules E, F, I, B, UP, SIM, RUF |
| mypy | `uv run mypy --strict app` | strict, pydantic plugin |
| Generated artefacts | `typescript:transform`, `i18n:export`, `testing:seed-catalog-snapshot --check`, `vision/requirements.txt` export | must leave no diff |
| Dependency audit | `bash .github/scripts/audit-gate.sh composer\|yarn\|pip` | `13 §19`: high/critical fail unless allowlisted in `security/audit-allowlist.json` with a future `expires_on` |
| Route registry | `RouteRegistryTest` (§6.3) | every route of `14` present, nothing extra |

---

## 15. Coverage targets (enforced in CI)

| Layer | Measured by | Minimum (lines / branches) |
|---|---|---|
| `resources/js/engine/**` (excl. `testing/`) | Vitest v8 coverage thresholds per glob | 90 % / 85 % (`units`, `geometry`, `plan` ≥ 90 % lines per `04 §10`) |
| `resources/js/{editor,lib,composables}/**` | Vitest | 75 % / 65 % |
| `resources/js/components/**`, `resources/js/pages/**` | Vitest | 60 % lines (pages are additionally covered by browser tests) |
| `app/Domain/**` | Pest + pcov, `tests/Support/coverage-gate.php` (per-directory thresholds over the Clover report) | 90 % lines |
| `app/Policies/**`, `app/Http/Requests/**` | same | 95 % lines |
| `app/Http/Controllers/**`, `app/Http/Middleware/**`, `app/Notifications/**`, `app/Support/**` | same | 85 % lines |
| PHP overall | same | 85 % lines |
| `vision/app/**` | `pytest --cov=app --cov-fail-under=85` | 85 % lines; `pipeline/` and `providers/` ≥ 85 % each (`[tool.coverage.report]` per-path config) |

Coverage is a floor, not a goal: a PR may not lower a layer below its minimum; generated code, `database/migrations` and `routes/` are excluded.

---

## 16. CI matrix (implemented by `17 §10.2`; required status checks `php`, `frontend`, `vision`, `browser`)

| Job | Runtime | Services | Steps (in order) |
|---|---|---|---|
| `php` | Ubuntu 24.04, PHP 8.4 (pcov), Node 22 (yarn 4 via corepack) | Postgres 18 (`furny_test`), Redis 7.4 | composer install → `yarn install --immutable` → `yarn build:engine-cli` → Pint → Larastan → composer audit gate → `typescript:transform` diff → `i18n:export` diff → seed-snapshot check → `pest tests/Unit tests/Feature --parallel --ci --coverage-clover` (contract tests live in `tests/Feature/Contract`, so this run includes them) → PHP coverage gate |
| `frontend` | Ubuntu 24.04, PHP 8.4 (artisan for Wayfinder), Node 22 | — | composer install → yarn install → `wayfinder:generate` → ESLint → Prettier → vue-tsc → yarn audit gate → `vitest run --coverage` → `bench:check` → `yarn build` → bundle size → engine CLI smoke |
| `vision` | Ubuntu 24.04, Python 3.12 (uv), Node 22 | — | apt libGL → yarn install + `build:engine-cli` → `uv sync --frozen` → requirements export diff → ruff check/format → `mypy --strict app` → `pytest -m "not live" --cov` (with `ENGINE_CLI`) → `evaluate.py --fail-under` (`none`, `replay`) → pip-audit gate |
| `browser` | Ubuntu 24.04, PHP 8.4, Node 22, Chromium via `yarn playwright install --with-deps chromium` | Postgres 18, Redis 7.4 | composer/yarn install → `yarn build` → `pest tests/Browser --ci` → `yarn playwright test` → artifacts (screenshots, Playwright report) on failure |
| `deploy` | — | — | after all four succeed on `develop`/`main` (`17 §10.2`) |

All jobs run on every PR and on pushes to `develop`/`main`; concurrency cancels superseded PR runs.

---

## 17. Test data for staging

- Staging runs the idempotent production seeders (`php artisan db:seed --force`, `02 §14`) on every deploy and, once after a reset, `php artisan db:seed --class=DemoSeeder --force` (refuses when `APP_ENV=production`).
- `DemoSeeder` (no Faker; uses `OrderScenarioBuilder`, §5.1, and the fixtures of §5.2): staff users per role `{role}@staging.furny.test` (passwords from env `DEMO_STAFF_PASSWORD`; owner/admin TOTP secret from env `DEMO_TOTP_SECRET`); 3 customers (`asha@…` verified email + phone, metric; `ravi@…` phone-only; `meera@…` imperial, unverified) — all addresses on the reserved `.test` domain, phone numbers in the `+91 90000 0000x` test range; projects built from `hdb-3room.json` and `brochure-2bhk.json` (+ a two-floor house from plan starters); the six furniture fixtures as designs; **one order in each of the 16 states** with consistent history (proposals, quotes incl. a superseded version and a negotiation, calls incl. 3 `no_answer`, production updates with photos from `database/fixtures/demo/photos/*.jpg`, issues, a scheduled delivery); imports in `ready_for_review`, `failed` (`no_walls_detected`) and `accepted`; AI ledger rows of every kind; notification rows and WhatsApp/SMS deliveries (driver `log`).
- Reset procedure (staging only): Coolify command `php artisan migrate:fresh --force && php artisan db:seed --force && php artisan db:seed --class=DemoSeeder --force`; object storage prefix `demo/` is overwritten. Production data is never copied (`17 §2`).
- The functional smoke test of `17 §8` step 7 is run on staging before every release with a freshly registered customer.

---

## 18. Flaky-test policy

1. A test that fails and then passes on the same commit is **flaky** and is treated as a failure: Pest and Vitest never retry; Playwright retries once in CI with `failOnFlakyTests: true`, so a flake still fails the job but keeps a trace.
2. The author of the PR that hits a flake opens an issue (label `flaky`) with the run link and trace within the same working day.
3. Fix within **2 working days**. Until then the test may be skipped only with `->skip('flaky: #<issue> until YYYY-MM-DD')` (Pest) / `test.fixme` with the same annotation (Playwright); `tests/Feature/Meta/SkippedTestsTest.php` fails the suite when a skip annotation lacks an issue or its date has passed. Required journeys of §8.2–§8.4, the transition matrix (§6.1) and the authorisation matrix (§6.2) may never be skipped.
4. Common causes and the required fix: time (`travelTo`), ordering (no reliance on insertion order without `ORDER BY`), async UI (Pest `->waitForText()` / Playwright auto-waiting `expect(...).toBeVisible()`, never fixed sleeps), parallel DB collisions (only per-worker databases; no fixed ULIDs across tests), Redis state (`UsesRedis` flushes), animation (reduced motion), randomness (seeds).
5. `vendor/bin/pest --repeat=20 --filter=<test>` and `yarn playwright test --repeat-each=20 <spec>` must pass before a flaky test is un-skipped.

---

## 19. Running tests locally in the agent container

The development container has **no Docker**: PostgreSQL 16 (cluster `16/main`, port 5432) and `redis-server` run as system services; PHP 8.4 (`pdo_pgsql`, `redis`, `gd`, `intl`, `exif`, `sodium`, … — no pcov/xdebug), Node 22 with yarn, Python 3.13 + `uv`, and Playwright browsers in `/opt/pw-browsers` (Chromium 1194). Gotenberg, S3/MinIO, Mailpit, the vision service and Reverb are **not** available and are never needed: tests use the fakes of §4.4 (`Pdf::fake()`, `Storage::fake()` + testing upload routes, `MAIL_MAILER=array`, `Http::fake()` for the vision service, `Notification::fake()`, `BROADCAST_CONNECTION=log` / `Event::fake()`).

One-time setup:

```bash
service postgresql start && service redis-server start          # no-op when already running
su postgres -c "psql -c \"CREATE ROLE furny LOGIN PASSWORD 'secret' CREATEDB\"" || true
su postgres -c "createdb -O furny furny_test" || true
export PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers                 # never run `playwright install` here
composer install && corepack enable && yarn install && yarn build:engine-cli
cp .env.example .env && php artisan key:generate                 # phpunit.xml supplies the testing env
(cd vision && uv python install 3.12 && uv sync)                 # falls back to Python 3.13 when 3.12 cannot be downloaded
```

Daily commands:

| Purpose | Command |
|---|---|
| PHP unit + feature + contract | `vendor/bin/pest tests/Unit tests/Feature --parallel` (single test: `vendor/bin/pest --filter='T10'`) |
| Frontend unit + engine | `yarn vitest run` (one area: `yarn vitest run resources/js/engine/bom`); benches `yarn bench:check` |
| Static analysis | `vendor/bin/pint --test && vendor/bin/phpstan analyse && yarn eslint . && yarn vue-tsc --noEmit` |
| Browser journeys | `yarn build && vendor/bin/pest tests/Browser` |
| Playwright smoke/a11y/perf | `yarn build && yarn playwright test` (uses `.env.e2e`, migrates `furny_test` itself) |
| Vision | `cd vision && uv run pytest -m "not live" && uv run python scripts/evaluate.py --fixtures tests/fixtures/reference --provider none --fail-under` |

Differences from CI that agents must keep in mind: PostgreSQL 16 locally vs 18 in CI (do not use PG 17/18-only SQL features; CI is authoritative); no pcov locally (coverage gates run only in CI); visual snapshots are comparable because both use Chromium 1194 — if `ls /opt/pw-browsers` shows another revision, skip `visual.spec.ts` locally (`--grep-invert @visual`) and let CI decide. Never point tests at a real provider, bucket or mail server; `Http::preventStrayRequests()` will fail such a test.

---

## 20. Acceptance criteria

1. Every route of `14` is covered by `RouteRegistryTest`, `RouteAuthorizationTest` and at least one behaviour test; every FormRequest has a rule test.
2. Every transition T1–T31 (T23 unused) passes allowed/wrong-state/forbidden-actor/precondition/side-effect cases; `TransitionMatrixTest` proves no extra transitions exist.
3. The shared money and quote fixtures pass identically in Pest and Vitest; the wardrobe BOM and price numbers of `08 §10.2`/`§4.7` are asserted exactly in Vitest and through the engine CLI.
4. The reference blueprints meet `06 §16.3` in CI with providers `none` and `replay`; vision output validates against the engine zod schema.
5. The customer, staff and import-review journeys of §8.2–§8.4 pass in Chromium without console errors; 3D smoke, axe (zero serious/critical in both themes) and performance assertions pass.
6. Larastan level 8, Pint, ESLint, Prettier, vue-tsc, ruff, mypy strict and the audit gate are clean; coverage minimums of §15 hold.
7. No test uses SQLite, real network services or unseeded randomness; the four CI jobs are required status checks.
