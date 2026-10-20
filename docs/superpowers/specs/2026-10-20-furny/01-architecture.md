# 01 — Architecture

Read the master document `../2026-10-20-furny-design.md` first.

## 1. Pinned stack (verified 2026-10-20)

Pin **exact** versions for pre-1.0 packages; use caret ranges for stable ones. If a listed version is unavailable when you install, take the latest patch of the same minor and note it in the PR.

### 1.1 Backend (composer)

| Package | Version | Purpose |
|---|---|---|
| php | `^8.4` (composer `require.php`) | PHP 8.4 required (activitylog 5, model-states 2.14, Pest 5 need it; Nixpacks supports up to 8.4) |
| laravel/framework | `^13.38` | Framework |
| inertiajs/inertia-laravel | `^3.5` | Inertia server adapter |
| laravel/fortify | `^1.37` | Headless auth (from starter kit) |
| laravel/wayfinder | `0.1.23` (exact) | Typed route helpers for TS |
| laravel/horizon | `^5.50` | Redis queue dashboard/supervisor |
| laravel/reverb | `^1.12` | WebSocket server |
| laravel/socialite | `^5.31` | Google OAuth |
| laravel/pulse | `^1.8` | Production monitoring (staff-only dashboard) |
| spatie/laravel-permission | `^8.3` | Roles & permissions |
| spatie/laravel-medialibrary | `^11.23` | File/media handling |
| spatie/laravel-activitylog | `^5.1` | Audit log |
| spatie/laravel-model-states | `^2.14` | Order / import state machines |
| spatie/laravel-data | `^4.23` | DTOs + validation + TS transform |
| spatie/laravel-typescript-transformer | `^3.3` | Generate TS types from PHP Data/Enums |
| spatie/laravel-pdf | `^2.14` | PDFs via Gotenberg driver |
| brick/money | `^0.15` | Money arithmetic |
| laravel-notification-channels/webpush | `^13.0` | Web push |
| laravel-notification-channels/twilio | `^4.2` | SMS (Twilio driver) |
| league/flysystem-aws-s3-v3 | `^3.0` | S3-compatible storage |
| giggsey/libphonenumber-for-php-lite | `^9.0` | E.164 phone validation |
| twilio/sdk | `^8.0` | Twilio webhook signature validation + WhatsApp/SMS Twilio drivers (declared explicitly although transitive, `12 §7`) |
| symfony/postmark-mailer | `^7.3` | Mail transport `postmark` (`17` O12) |
| symfony/http-client | `^7.3` | HTTP client required by the Symfony mailer transports |
| resend/resend-php | latest stable at install time (pin the resolved version in `composer.lock`) | Optional mail transport `resend` (env-only switch, `12 §8.2`) |
| sentry/sentry-laravel | `^4` (**optional**) | Error tracking, active only when `SENTRY_LARAVEL_DSN` is set (`17 §13.5`) |
| **dev:** pestphp/pest `^5.3`, pestphp/pest-plugin-laravel, larastan/larastan `^3.13`, laravel/pint `^1.32`, laravel/telescope `^5.26` (local/staging only; `composer.json` `extra.laravel.dont-discover: ["laravel/telescope"]`, registered conditionally when `TELESCOPE_ENABLED=true`, `17 §5.11`), laravel/boost `^2.10` |

Not used (decided): Prism, `laravel/ai`, `anthropic-ai/sdk` in PHP. **All LLM calls happen in the Python vision service**; Laravel never calls an LLM directly. (Rationale: the LLM step needs the image-processing toolchain for crop/zoom tool loops, and keeping all provider keys in one service keeps secrets in one place.)

Required PHP extensions (declare as `ext-*` in composer `require`; the same list is installed by `nixpacks.toml` `php84Extensions.*`, `17 §5.2`): `ext-pdo_pgsql`, `ext-redis`, `ext-gd`, `ext-exif`, `ext-intl`, `ext-bcmath`, `ext-pcntl`, `ext-posix`, `ext-zip`, `ext-fileinfo`, `ext-sodium`.

### 1.2 Frontend (yarn 4 via corepack)

Package manager: **yarn 4** through corepack (owner decision, master D34). `package.json` contains `"packageManager": "yarn@4.x.y"` (exact version written by `corepack use yarn@4` when the repository is created) and `"engines": { "node": ">=22.12 <23" }`; `.yarnrc.yml` sets `nodeLinker: node-modules`; `yarn.lock` is committed; `package-lock.json` must not exist. Commands: `yarn install` (CI/builds: `yarn install --immutable`), `yarn dev`, `yarn build` (= `vite build && yarn build:engine-cli`), `yarn build:engine-cli`, `yarn test` (Vitest), `yarn lint`.

| Package | Version | Purpose |
|---|---|---|
| vue | `^3.5.44` | UI |
| @inertiajs/vue3 | `^3.9` | Inertia client |
| @inertiajs/vite | `^3.9` | Inertia Vite plugin |
| vite | `^8.3` | Bundler (Node ≥ 22.12 required) |
| tailwindcss + @tailwindcss/vite | `^4.3` | Styling (CSS-first config) |
| typescript, vue-tsc | `^5.9` / latest | Types |
| reka-ui | `^2.9` | Headless primitives (shadcn-vue components copied into `resources/js/components/ui`) |
| @vueuse/core | latest | Utilities |
| @lucide/vue | latest | Icons |
| vue-sonner | latest | Toasts |
| pinia | `^4.1` | Editor stores |
| zod | `^4` | Document schemas & runtime validation (engine) |
| mutative | `^2.0` | Immutable updates with patches (command system) |
| three | `0.186.1` (exact) | 3D |
| @types/three | matching `0.186.x` | Types |
| @tresjs/core, @tresjs/cientos | `5.9.3` (exact) | Vue 3D shell, controls |
| camera-controls | `^3.1` | Smooth camera transitions (ortho/persp) |
| three-mesh-bvh | `^0.9.16` | Raycast acceleration |
| clipper2-ts | `2.0.1-18` (exact) | Polygon offset/boolean |
| earcut | `^3.2` | Triangulation |
| flatbush | `^4.6` | Spatial index for 2D hit-testing/snapping |
| nanoid | `^5` | Document entity IDs |
| @tarikjabiri/dxf | `^2.9` | DXF export |
| jspdf + svg2pdf.js | `^4.2` / `^2.8` | Client-side vector PDF of plans |
| laravel-echo + @laravel/echo-vue + pusher-js | `^2.6` | Reverb client |
| @fontsource-variable/inter, @fontsource-variable/jetbrains-mono | `^5.2` | Self-hosted UI fonts (`15 §2`) |
| tw-animate-css | `^1.3` | Animations for shadcn-vue on Tailwind 4 |
| intl-messageformat | `^10.7` | ICU MessageFormat runtime (i18n, `15 §15`) |
| libphonenumber-js | `^1.12` | Client-side phone parsing (`PhoneInput`) |
| @sentry/vue | `^10` (**optional**) | Browser error tracking, active only when `VITE_SENTRY_DSN` is set |
| **dev:** vitest `^3`, @vue/test-utils, eslint, prettier, @playwright/test (via Pest browser plugin), culori `^4.0` (token contrast test, `15 §14.6`), concurrently (`composer dev`, `17 §3.3`) |

### 1.3 Vision service (Python)

| Package | Purpose | Licence |
|---|---|---|
| python 3.12 | runtime | — |
| fastapi + uvicorn[standard] | HTTP API | MIT/BSD |
| pydantic v2 | schemas | MIT |
| opencv-python-headless | CV | Apache-2.0 |
| numpy, scipy, shapely | geometry/solver | BSD |
| rapidocr (onnxruntime backend) | OCR (PP-OCR models via ONNX) | Apache-2.0 |
| pdfplumber | vector PDF line extraction | MIT |
| pypdfium2 | PDF rasterisation | Apache-2.0/BSD |
| pi-heif | HEIC decode | see `06` §licensing note |
| pillow | imaging | MIT-CMU |
| ezdxf | DXF parsing | MIT |
| anthropic | Claude provider | MIT |
| openai | OpenAI + OpenAI-compatible (local) providers | Apache-2.0 |
| httpx | HTTP | BSD |
| scikit-image | Sauvola threshold, skeletonize | BSD-3-Clause |
| onnxruntime | RapidOCR backend | MIT |
| pydantic-settings | service configuration (`18 §4`) | MIT |
| anyio | worker-thread offloading (via FastAPI) | MIT |
| sentry-sdk[fastapi] `^2` (**optional**) | error tracking when `SENTRY_DSN` is set | MIT |
| pytest, ruff, mypy; `uv` (dependency locking: `pyproject.toml` + `uv.lock`, `requirements.txt` exported for Nixpacks) | dev | — |

**Do not use**: PyMuPDF (AGPL), Ultralytics YOLO (AGPL), CubiCasa5k weights (non-commercial), Raster-to-Graph (GPL + data licence).

### 1.4 Infrastructure

| Component | Version | Notes |
|---|---|---|
| PostgreSQL | 18.x | Coolify-managed. No PostGIS. |
| Redis | 7.x / Valkey 8 | Coolify-managed. Queues, cache, sessions, Reverb scaling, rate limiting. |
| Gotenberg | 8.x (`gotenberg/gotenberg:8`) | PDF rendering service (internal only). |
| Object storage | S3-compatible (Cloudflare R2 recommended; MinIO self-hosted alternative) | Disks `s3` (private) and `s3-public` (public thumbnails/textures). |
| Node.js | 22 LTS | Build and **runtime** (engine CLI). |

---

## 2. System diagram

```
                      ┌─────────────────────── Coolify server ────────────────────────┐
 Browser (Vue/Inertia)│                                                                │
  ├─ HTTPS ──────────►│ app (Nixpacks: nginx + php-fpm, supervisor)                    │
  │                   │   ├─ Horizon workers (queues: default, imports, pdf, notify,   │
  │                   │   │   engine)                                                  │
  │                   │   ├─ scheduler (schedule:work)                                 │
  │                   │   └─ engine CLI (node engine-cli/dist/cli.mjs) via Process     │
  ├─ WSS (ws.domain) ►│ reverb (same image, separate Coolify resource, port 8080)     │
  │                   │                                                                │
  │                   │ vision (Nixpacks Python, FastAPI :8000, internal only) ◄── app │
  │                   │   └─► LLM provider: Anthropic / OpenAI / local OpenAI-compat   │
  │                   │ gotenberg (:3000, internal only) ◄── app                       │
  │                   │ postgres 18 · redis                                            │
  └─ HTTPS (presigned)►  S3-compatible object storage (R2/MinIO) ◄── app, vision       │
                      └────────────────────────────────────────────────────────────────┘
 External: SMTP/Postmark/Resend · Meta WhatsApp Cloud API · Twilio/MSG91 · Web Push services
```

Deployment topology: **three Coolify application resources from the same Git repo**:

1. `furny-app` — web + Horizon + scheduler in one container via supervisor (Coolify's documented Laravel pattern).
2. `furny-reverb` — same build, start command `php artisan reverb:start --host=0.0.0.0 --port=8080`, domain `ws.<domain>`.
3. `furny-vision` — base directory `/vision`, Nixpacks Python provider.

Plus Coolify services: PostgreSQL, Redis, Gotenberg (Dockerfile resource based on `gotenberg/gotenberg:8`). Details in `17-deployment-ops.md`.

**Cross-cutting rule:** service providers and config files must not access the database, Redis or HTTP while booting (the image build runs `artisan` — Wayfinder, `php artisan optimize` — without services, and `/up` must answer while dependencies are down; `17 §5.11`).

---

## 3. Repository layout (monorepo)

```
/                               Laravel app root (artisan here)
├─ app/
│  ├─ Domain/                   Business domains (see §4)
│  ├─ Http/
│  │  ├─ Controllers/Customer/  Customer-facing Inertia controllers
│  │  ├─ Controllers/Admin/     Staff-facing Inertia controllers
│  │  ├─ Controllers/Api/       JSON endpoints used by editors (autosave etc.)
│  │  ├─ Controllers/Auth/      Auth flows not covered by Fortify (OTP, Google)
│  │  ├─ Controllers/Webhooks/  WhatsApp (Meta) and Twilio/MSG91 delivery-status webhooks
│  │  ├─ Middleware/
│  │  └─ Requests/              FormRequests mirroring controller folders
│  ├─ Notifications/            One class per event key (see 12)
│  ├─ Notifications/Channels/   WhatsAppChannel, SmsChannel (driver-based)
│  ├─ Policies/
│  ├─ Providers/
│  └─ Support/                  Cross-cutting helpers (Money, Units, Settings, Engine\EngineCli, Vision\VisionClient, I18n\helpers.php (`trans_icu()`), Uploads\*)
├─ bootstrap/  database/(migrations, factories, seeders, fixtures/)
├─ config/                      incl. security.php (rate limits, CSP origins), imports.php (06), notification_events.php (12), plan_starters.php (10), engine.php (`node_binary`), features.php (master §6.7)
├─ routes/                      web.php, customer.php, admin.php, api.php, webhooks.php (stateless: no session/CSRF, `throttle:webhooks`), channels.php, console.php
├─ resources/
│  ├─ css/app.css               Tailwind v4 entry + @theme tokens
│  ├─ lang/en/                  PHP translation files (ICU; `15 §15.2`)
│  ├─ views/app.blade.php       Inertia root
│  ├─ views/pdf/                Blade templates rendered by Gotenberg (quote, cut list, plan sheet)
│  └─ js/
│     ├─ app.ts  ssr.ts(not used v1)
│     ├─ engine/                ★ Framework-free TS engine (NO Vue/DOM imports; see §5)
│     ├─ editor/                Vue editor layer (plan editor, furniture builder) on top of engine
│     │  ├─ plan/               2D SVG renderer, 3D Tres scene, tools, panels
│     │  ├─ furniture/          builder UI, 3D preview, elevation view
│     │  ├─ shared/             command bus binding, selection, viewport, autosave
│     │  └─ workers/            engine.worker.ts (BOM + nesting off main thread)
│     ├─ pages/Customer/…  pages/Admin/…  pages/Auth/…   Inertia pages
│     ├─ layouts/               CustomerLayout, AdminLayout, EditorLayout, AuthLayout
│     ├─ components/ui/         shadcn-vue components
│     ├─ components/            App components (domain-agnostic)
│     ├─ composables/
│     ├─ lib/                   i18n, echo, http, upload (upload intents), format helpers
│     ├─ lang/generated/        {locale}.json + manifest.json written by `php artisan i18n:export` (committed, CI-checked)
│     └─ types/                 generated.d.ts (spatie TS transformer) + hand-written
├─ engine-cli/                  Node entry for server-side engine use
│  ├─ src/cli.ts                reads JSON from stdin, writes JSON to stdout
│  └─ vite.config.ts            builds dist/cli.mjs (target node22, bundles engine)
├─ vision/                      Python vision service (pyproject.toml + uv.lock, exported requirements.txt, tests, nixpacks.toml)
├─ public/fonts/                NotoSans-Regular.ttf, NotoSans-Bold.ttf (jsPDF export only, `15 §2`); sw.js; manifest via route
├─ nixpacks.toml                owner-baseline Nixpacks plan incl. `[staticAssets]` nginx.conf (`17 §5.2`)
├─ docker/                      start.sh, check-runtime.sh, backup-objects.sh, php.ini, php-fpm.conf, supervisor/{supervisord,php-fpm,nginx,horizon,scheduler,pulse-check}.conf, dev/pg-init.sql
├─ .dockerignore  compose.dev.yaml  package.json (packageManager yarn@4)  .yarnrc.yml  yarn.lock
├─ .github/                     workflows/ci.yml, scripts/{changed-since-last-deploy,coolify-deploy}.sh
├─ tests/  (Pest: Feature/, Unit/, Browser/)  resources/js/**/__tests__ (Vitest)
└─ docs/                        specs, ops/ (owner reference files), ops-log.md
```

---

## 4. Backend module boundaries (`app/Domain/*`)

Each domain folder contains `Models/`, `Actions/` (single-purpose invokable classes, the ONLY place business mutations happen), `Data/` (spatie/laravel-data DTOs), `Enums/`, `Events/`, `States/` (model states), `Jobs/`, `Queries/` (read models for list pages).

| Domain | Models | Key actions |
|---|---|---|
| `Identity` | User, OtpCode, NotificationPreference, StaffInvitation, NotificationDelivery | RegisterCustomer, SendOtp, VerifyOtp, LinkGoogleAccount, UpdatePreferences, InviteStaff, AcceptStaffInvitation, RequestAccountDeletion, AnonymiseUser. Events: `CustomerRegistered(User)`, `ContactVerified(User)` (first verified contact, `13 §5.6`) |
| `Projects` | Project, Plan, PlanRevision | CreateProject, UpdateProject, CreatePlan, SavePlanWorkingCopy, CreatePlanRevision, RestorePlanRevision, DuplicatePlan, LockPlan, UnlockPlan, ArchiveProject |
| `Imports` | BlueprintImport | CreateBlueprintImport, UpdateImportOptions, StartBlueprintRecognition, CompleteImportRecognition, MarkImportFailed, CancelImport, SaveImportReviewDocument, AcceptImportIntoPlan, DiscardImport, RerunBlueprintImport, ConvertImportToTrace; jobs PrepareImportPreview, RunBlueprintRecognition (`06 §4.1`) |
| `Furniture` | FurnitureDesign, FurnitureRevision, FurniturePreset | CreateFurnitureDesign, SaveFurnitureWorkingCopy, CreateFurnitureRevision, DuplicateFurnitureDesign, SaveAsPreset |
| `Catalog` | Material, EdgeBand, HardwareItem, Finish, LabourRate, TaxRate | Upsert*, Archive*, PublishCatalogSnapshot |
| `Orders` | Order, OrderItem, ChangeProposal, ChangeProposalItem, Quote, QuoteLine, QuoteNegotiation, ConfirmationCall, ProductionUpdate, OrderIssue, Delivery, Payment(phase 2) | One action per workflow transition (see `09`) |
| `Messaging` | Message, MessageRead | PostMessage, MarkThreadRead |
| `Ai` | AiUsageEvent, AiCreditLedgerEntry | ResolveRecognitionPlan, ReserveCredits, CommitCredits, RefundCredits (`releaseReservation`, `refundConsumption`), GrantCredits, RecordUsage; services CreditBalance, BudgetGuard (`18`) |
| `Settings` | AppSetting | UpdateSettings (typed groups) |
| `Shared` | UploadIntent | CreateUploadIntent, ProcessUpload (job); enum UploadPurpose (`13 §11`); contracts `NotifiableDomainEvent` (order events, `09 §11`) and `UserNotifiableEvent` (non-order events, `12 §3.4`) |

**Rules**
- Controllers are thin: authorise (policy), validate (FormRequest), call one Action, return Inertia response/redirect/JSON.
- Actions are `final` classes with an `__invoke` or `handle` method, receive DTOs/models, run inside `DB::transaction` when they touch >1 row, dispatch domain events **after commit** (`DB::afterCommit` or `ShouldDispatchAfterCommit`).
- Notifications are triggered by **listeners on domain events**, never directly from controllers.
- Activity log entries are written in Actions (`activity()->performedOn($model)->causedBy($user)->withProperties([...])->event('order.quote_sent')->log(...)`).

---

## 5. The engine (`resources/js/engine`)

### 5.1 Contract

The engine is pure TypeScript: **no imports from `vue`, `three`, `@tresjs/*`, DOM APIs (`window`, `document`), or `fetch`**. Enforced by an ESLint `no-restricted-imports` rule + a Vitest test that imports every engine module in a Node environment.

Allowed dependencies: `zod`, `mutative`, `clipper2-ts`, `earcut`, `flatbush`, `nanoid`.

### 5.2 Modules

The per-file contracts are owned by `04 §0.1` (units, geometry, plan, commands), `07 §0.1` (furniture) and `08 §0` (money, catalog, bom); this tree is the summary and must match them.

```
engine/
├─ index.ts                 Public API re-exports (the ONLY import path used outside the engine)
├─ version.ts               ENGINE_VERSION = "1.0.0" (semver; bump on any output-affecting change)
├─ ids.ts                   newId(prefix)
├─ money.ts                 roundHalfUpDiv, ceilDiv, applyBps, grossUp, netFromGross, … (08 §1)
├─ units/                   types.ts, parse.ts (parseLength), format.ts (formatLength, formatArea, formatAngle)
├─ geometry/                tolerance, vec2, segment, polygon, clip (only clipper2-ts importer), triangulate (only earcut importer),
│                           planarFaces, polylabel, hash
├─ plan/
│  ├─ schema.ts             zod PlanDocument schema (03 §1)
│  ├─ migrate.ts            schemaVersion migrations (03 §4)
│  ├─ derive.ts             derivePlanGeometry / createPlanDeriver (+ walls.ts, rooms.ts, reconcile.ts)
│  ├─ footprint.ts  conflicts.ts  snapping.ts  hitIndex.ts
│  ├─ validate.ts           validatePlan(doc) → Issue[]
│  ├─ summary.ts            planSummary (engine CLI plan-summary)
│  ├─ fixtures.ts           FIXTURE_LIBRARY (content in 05 §9)
│  ├─ roomNames.ts          ROOM_NAMES, suggestRoomType (content in 06)
│  ├─ commands/             plan commands + registry/helpers/postprocess (04 §6)
│  ├─ drawing/              buildPlanDrawing, draw*, autoDimensions, svgFromDrawing (04 §8)
│  └─ testing/              test document builders
├─ furniture/               constants, schema, migrate, catalogIndex, parts, templates/, generate, carcass/, fronts/, table/,
│                           rules/, overrides, validate (SAVE_BLOCKING_CODES), diff, diffHighlight, partNames, commands/ (07 §0.1)
├─ bom/                     constants, bom (computeBom, bomOptionsFor), cutSizes, edgeBanding, rowKey, nesting/ (guillotine, index),
│                           pricing (priceBom, displayUnitPrice), exportCsv (cutListCsv) (08 §0)
├─ catalog/                 snapshot.ts (CatalogSnapshot + zod), specs.ts (hardware spec schemas) (08 §2)
└─ commands/                generic command bus: bus.ts, types.ts (04 §6.1–6.3)
```

### 5.3 Catalog snapshot

The engine never talks to the database. The server exposes a **catalog snapshot** (`GET /api/catalog/snapshot`, cached, ETag = `catalog_version`) containing materials, edge bands, hardware, finishes, labour rates, tax rates (**including inactive and archived rows, flagged `isActive: false`**, needed for archived-code warnings, `03 §2.4`) and pricing settings in the exact shape of `engine/catalog/CatalogSnapshot` (defined in `08-bom-and-costing.md §2`). Every change to any catalog table or pricing setting increments `app_settings['catalog.version']` (integer) in the same transaction.

Furniture revisions store `catalog_version` and `engine_version` used to compute their BOM.

### 5.4 Engine CLI (server-side execution)

`engine-cli/src/cli.ts` is built with Vite (library mode, `ssr: true`, target `node22`, all deps bundled) into `engine-cli/dist/cli.mjs`. Build script `yarn build:engine-cli` runs as part of `yarn build`.

Protocol: `node engine-cli/dist/cli.mjs <command>`; stdin = JSON request; stdout = JSON response `{ "ok": true, "result": … }` or `{ "ok": false, "error": { "code": string, "message": string, "details"?: unknown } }`; exit code 0 for both (non-zero only on crash).

| Command | Request | Result |
|---|---|---|
| `validate-plan` | `{ document }` | `{ valid: boolean, issues: Issue[], migratedDocument, summary: PlanSummary }` (summary = `plan-summary` result, saves a second spawn, `03 §5`) |
| `validate-furniture` | `{ document, catalog }` | `{ valid, issues, migratedDocument }` |
| `compute-bom` | `{ document, catalog, options: { nesting: boolean, allowRotation?: boolean, price?: { quantity: number, includeInstallation: boolean } } }` (`price` default `{ quantity: 1, includeInstallation: true }`, `08 §9.2`) | `{ bom: Bom, price: PriceBreakdown, engineVersion }` |
| `cutlist-csv` | `{ bom, catalog, document }` | `{ csv: string }` (`08 §8.1`) |
| `template-default` | `{ templateKey, overrides, catalog }` | `{ document, issues }` (generates a template's default document, used by admin template defaults, `11 §10`) |
| `diff-furniture` | `{ before, after, catalog }` | `{ changes: ChangeItem[] }` |
| `plan-summary` | `{ document }` | `{ wallCount, roomCount, rooms: [{id,name,areaMm2}], totalAreaMm2, bbox }` |
| `version` | `{}` | `{ engineVersion }` |

PHP wrapper: `App\Support\Engine\EngineCli` using `Symfony\Component\Process\Process` with `[config('engine.node_binary'), base_path('engine-cli/dist/cli.mjs'), $command]` (`config/engine.php`: `'node_binary' => env('ENGINE_NODE_BINARY', 'node')`; `docker/start.sh` exports the absolute path), input via `setInput(json_encode(...))`, timeout 60 s, throws `EngineCliException` on `ok:false` or crash. Calls from HTTP requests are allowed only for `validate-*` (fast); `compute-bom` with nesting runs inside queued jobs or quote-building actions.

### 5.5 Web Worker

`resources/js/editor/workers/engine.worker.ts` exposes `computeBom`, `nestSheets`, `derivePlanGeometry` and `estimateFurniture(doc, catalog) → { bom, price }` (generate + BOM with nesting + price, `07 §8.10`) via a tiny typed RPC (`postMessage` with `{id, method, params}`); composable `useEngineWorker()` returns promise-based functions, cancels stale requests (only latest request per method returns). Main-thread fallback when Workers are unavailable.

---

## 6. Frontend architecture

- Inertia v3 pages under `resources/js/pages`, resolved by `@inertiajs/vite`. Persistent layouts via `defineOptions({ layout: … })`.
- **Wire format (decision, master §6.6):** Inertia props and JSON are **camelCase** (spatie/laravel-data camelCase properties; generated TS types); request bodies are camelCase except Fortify/`13` auth forms (Fortify field names); query strings are Laravel-style snake_case (`filter[state]`, `per_page`).
- Shared props (`HandleInertiaRequests::share`, exact keys; `15 §8` describes their consumers):
  - `app`: `{ name, logoUrl, version }` — `version` = `config('app.version')` = `env('APP_VERSION') ?: substr(env('SOURCE_COMMIT', 'dev'), 0, 7)`.
  - `auth.user` (null for guests): `{ id, type, name, email, emailVerified, phoneE164, phoneVerified, avatarUrl, roles, permissions, abilities, unitSystem, lengthUnit, timezone, locale, onboarded, hasPassword, twoFactorEnabled }` (`abilities` = owner gates passed, `13 §7.4`).
  - `business`: `{ name, currency, locale, timezone, phoneE164, email, workingHours, units: { defaultSystem, defaultLengthUnit }, defaultCountryCode }`.
  - `features`: every master §6.7 flag under its master name (`payments`, `whatsapp`, `sms`, `web_push`, `google_login`, `dxf_import`, `walkthrough_camera`, `captcha`) — the one deliberate exception to camelCase, together with Laravel paginator `meta` keys (`15 §8`, `§9.29`).
  - `flash`: `{ success, error, info, warning }` (translated strings).
  - `unreadNotifications` (int; authenticated only).
  - `i18n`: `{ locale, hash }` (`15 §15.3`).
  - `staffCounters` (staff only, lazy `Inertia::optional`, cached 30 s): `{ submitted: int, toCall: int }`.
  - `healthBanners` (staff with `settings.manage` only): `{ key: string, messageKey: string }[]` from cache keys `health:whatsapp`, `health:sms`, `health:otp` (`11 §4`).
  - The Turnstile site key and the VAPID public key are **not** shared props; they are page props of the pages that need them (`13 §3`, `12 §8.3`).
- `resources/js/app.ts` registers `window.addEventListener('vite:preloadError', () => window.location.reload())` (stale chunk after a deploy).
- Data types generated from PHP `Data` classes and enums by spatie typescript-transformer into `resources/js/types/generated.d.ts` (`php artisan typescript:transform`); CI fails if the generated file is stale.
- Routing in TS via Wayfinder (`@/routes/...` / `@/actions/...` generated); **never hard-code URLs**.
- Editors are heavy: plan editor and furniture builder pages are **lazy-loaded chunks**; three.js loaded only on those pages.
- State: pages use Inertia props; editors use Pinia stores per open document (`usePlanEditorStore(planId)`, `useFurnitureEditorStore(designId)`), created on mount, disposed on unmount.
- Large documents: store the document in `shallowRef`; renderers subscribe to an entity revision map (`Map<entityId, number>`) bumped by the command bus; three.js objects created with `markRaw`.

---

## 7. Background processing

Queue connections (`config/queue.php`): `redis` (`retry_after` 180) for `default`, `engine`, `pdf`, `notify`; `redis-long` (same Redis, `retry_after` 720) for `imports`. `retry_after` must exceed the longest job timeout on its connection. Horizon supervisors (config in `config/horizon.php`; `environments.staging` = 1 process per queue; `waits`: `redis:default` 60, `redis:notify` 120, `redis:engine` 300, `redis:pdf` 300, `redis-long:imports` 900; `Horizon::routeMailNotificationsTo(env('HORIZON_NOTIFY_EMAIL'))`):

| Queue | Connection | Jobs | Workers (prod) | Timeout | Tries |
|---|---|---|---|---|---|
| `default` | `redis` | misc, activity side effects, `ProcessUpload`, media conversions | 2 | 60 s | 3 |
| `imports` | `redis-long` | `RunBlueprintRecognition`, `PrepareImportPreview` | 2 | 660 s | 2 (backoff 30 s; `RunBlueprintRecognition` uses `retryUntil` + `maxExceptions = 2`, `06 §4.7`) |
| `engine` | `redis` | `ComputeRevisionBom`, `NestOrderSheets` | 2 | 120 s | 2 |
| `pdf` | `redis` | `RenderQuotePdf`, `RenderCutListPdf`, `RenderPlanSheetPdf` | 1 | 120 s | 3 |
| `notify` | `redis` | queued notifications (all channels), webhook processing, `DispatchCallbackDue` | 2 | 60 s | 5 (exp. backoff 10/30/90/270/600 s) |

There is no `queue:work` process: Horizon manages all workers. `php artisan pulse:check` runs as its own supervisor program (`17 §5.7`), not as a scheduler entry.

Scheduler (`routes/console.php`) — the **single** list of scheduled tasks; every entry uses `->onOneServer()->withoutOverlapping()`; times are UTC unless marked "business TZ" (`business.timezone`):

| Schedule | Command / job | Owner |
|---|---|---|
| every minute | closure `scheduler-heartbeat`: `Cache::put('health:scheduler:heartbeat', now()->timestamp, 600)` (read by `/up/deep` and Admin → System; healthy when < 3 min old) | `17 §5.11` |
| every minute | `orders:expire-quotes` (quotes past `valid_until` end-of-day business TZ) | `09` |
| every 5 min | `horizon:snapshot` | — |
| every 5 min | `otp:monitor` (OTP send/verify ratios → `health:otp`) | `13 §4.5` |
| hourly | `imports:cleanup-stale` (all five rules of `06 §4.10`) | `06` |
| hourly at :05 | `notifications:staff-digest` (sends to staff whose digest hour is now) | `12 §9` |
| daily 02:00 | `ai:grant-monthly-credits` (idempotent per user per month) | `18 §10.2` |
| daily 03:00 | `media:cleanup-orphans` (incl. unconsumed `upload_intents` > 24 h), `otp:prune` | `13 §11.5` |
| daily 03:15 | `users:anonymise-deleted` | `13 §9.2` |
| daily 03:30 | `notifications:prune` (notifications + `notification_deliveries`) | `12 §8.4`, `§11` |
| daily 03:40 | `queue:prune-failed --hours=720` | `17` |
| daily 03:45 | `queue:prune-batches --hours=48` | `17` |
| daily 03:50 | `telescope:prune --hours=48` (only when Telescope is installed and enabled) | `17` |
| daily 04:00 | `orders:auto-close-delivered` (delivered > `workflow.auto_close_days`) | `09` |
| daily 09:00 business TZ | `orders:remind-pending` (reminders for proposals/quotes/completions awaiting the customer > `workflow.reminder_after_hours`, and `quote.expiring_soon`) | `09`, `12` |
| monthly, day 1 04:30 | `activitylog:clean` | `13 §17` |

---

## 8. Real-time (Reverb)

Private channels (authorised in `routes/channels.php`):

| Channel | Who | Events |
|---|---|---|
| `users.{userId}` | that user | `NotificationCreated` (in-app notification payload), `AiCreditsChanged` `{balance, pending, delta, kind, at}` (`18 §16`) |
| `orders.{orderId}` | `OrderPolicy::view` — **customer-safe payloads only** | `OrderStateChanged`, `MessagePosted` (non-internal), `QuoteSent`, `ProductionUpdatePosted` (customer-visible), `ChangeProposalSent` |
| `orders.{orderId}.internal` | `OrderPolicy::viewInternal` (staff with `orders.view`) | internal notes, internal production updates, call logs (`13 §8.10`) |
| `imports.{importId}` | `BlueprintImportPolicy::view` (uploader, project owner, staff with `customers.view`) | `ImportStatusChanged` `{importId, status, stage, progress: null, error: {code, messageKey, retryable} \| null, at}` (`06 §15`) |
| `furniture-designs.{designId}` | owner + staff | `FurnitureDesignLocked` / `Unlocked`, `RevisionCreated` |
| `staff` | staff with `orders.view` | `OrderSubmitted`, `OrderNeedsAttention` (for admin dashboards) |

Reverb `allowed_origins` = `REVERB_ALLOWED_ORIGINS` (comma-separated hosts); production runs with `REVERB_SCALING_ENABLED=true`; Laravel publishes through the public host (`17` O8/O9). Client: `@laravel/echo-vue` configured in `resources/js/lib/echo.ts`; composables `useOrderChannel(orderId)` etc. Real-time is an enhancement: every page must also work by reload/polling (`usePoll` 30 s on order pages when the socket is disconnected).

---

## 9. Security architecture summary

(Full detail in `13-auth-security.md`.)
- Session auth (Fortify) for the web app; CSRF on all state-changing requests; Inertia history encryption enabled for authenticated pages.
- Vision service is **not internet-exposed**; reachable only on the Coolify internal network; requests authenticated with a shared bearer token `VISION_SERVICE_TOKEN`. Files exchanged through short-lived presigned S3 URLs (GET 15 min, PUT 15 min).
- All browser uploads use **one mechanism, upload intents** (`13 §11`): `api.uploads.presign` (purpose from the exhaustive `UploadPurpose` enum, incl. `blueprint_source`) → presigned PUT with signed `Content-Type`/`Content-Length` → `api.uploads.confirm` → `ProcessUpload` job (magic bytes, re-encode) → the consuming action attaches the media. Server-side presigned URLs for the vision service (source GET, normalized/debug PUT) are a separate, server-only mechanism and never reach browsers.
- Policies on every model; staff permission checks via spatie permissions; customers can only access their own projects/orders.
