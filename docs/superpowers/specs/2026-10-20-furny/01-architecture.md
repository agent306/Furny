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
| **dev:** pestphp/pest `^5.3`, pestphp/pest-plugin-laravel, larastan/larastan `^3.13`, laravel/pint `^1.32`, laravel/telescope `^5.26` (local/staging only), laravel/boost `^2.10` |

Not used (decided): Prism, `laravel/ai`, `anthropic-ai/sdk` in PHP. **All LLM calls happen in the Python vision service**; Laravel never calls an LLM directly. (Rationale: the LLM step needs the image-processing toolchain for crop/zoom tool loops, and keeping all provider keys in one service keeps secrets in one place.)

Required PHP extensions (declare as `ext-*` in composer `require` so Nixpacks installs them): `ext-pdo_pgsql`, `ext-redis`, `ext-gd`, `ext-exif`, `ext-intl`, `ext-bcmath`, `ext-pcntl`, `ext-posix`, `ext-zip`, `ext-fileinfo`, `ext-sodium`.

### 1.2 Frontend (npm)

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
| **dev:** vitest `^3`, @vue/test-utils, eslint, prettier, @playwright/test (via Pest browser plugin) |

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
| pytest, ruff, mypy | dev | — |

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

Plus Coolify services: PostgreSQL, Redis, Gotenberg (Docker image). Details in `17-deployment-ops.md`.

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
│  └─ Support/                  Cross-cutting helpers (Money, Units, Settings, EngineCli)
├─ bootstrap/  config/  database/(migrations, factories, seeders)  routes/(web.php, customer.php, admin.php, api.php, channels.php, console.php)
├─ resources/
│  ├─ css/app.css               Tailwind v4 entry + @theme tokens
│  ├─ lang/en/                  PHP translation files (+ generated JSON for frontend)
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
│     ├─ lib/                   i18n, echo, http, format helpers
│     └─ types/                 generated.d.ts (spatie TS transformer) + hand-written
├─ engine-cli/                  Node entry for server-side engine use
│  ├─ src/cli.ts                reads JSON from stdin, writes JSON to stdout
│  └─ vite.config.ts            builds dist/cli.mjs (target node22, bundles engine)
├─ vision/                      Python vision service (own pyproject, tests, nixpacks.toml)
├─ nixpacks.toml  nginx.template.conf  docker/ (supervisor confs, php.ini overrides)
├─ tests/  (Pest: Feature/, Unit/, Browser/)  resources/js/**/__tests__ (Vitest)
└─ docs/
```

---

## 4. Backend module boundaries (`app/Domain/*`)

Each domain folder contains `Models/`, `Actions/` (single-purpose invokable classes, the ONLY place business mutations happen), `Data/` (spatie/laravel-data DTOs), `Enums/`, `Events/`, `States/` (model states), `Jobs/`, `Queries/` (read models for list pages).

| Domain | Models | Key actions |
|---|---|---|
| `Identity` | User, OtpCode, NotificationPreference | RegisterCustomer, SendOtp, VerifyOtp, LinkGoogleAccount, UpdatePreferences, InviteStaff |
| `Projects` | Project, Plan, PlanRevision | CreateProject, CreatePlan, SavePlanWorkingCopy, CreatePlanRevision, RestorePlanRevision, DuplicatePlan, ArchiveProject |
| `Imports` | BlueprintImport | CreateBlueprintImport, RunBlueprintRecognition (job), AcceptImportIntoPlan, CancelImport |
| `Furniture` | FurnitureDesign, FurnitureRevision, FurniturePreset | CreateFurnitureDesign, SaveFurnitureWorkingCopy, CreateFurnitureRevision, DuplicateFurnitureDesign, SaveAsPreset |
| `Catalog` | Material, EdgeBand, HardwareItem, Finish, LabourRate, TaxRate | Upsert*, Archive*, PublishCatalogSnapshot |
| `Orders` | Order, OrderItem, ChangeProposal, ChangeProposalItem, Quote, QuoteLine, QuoteNegotiation, ConfirmationCall, ProductionUpdate, OrderIssue, Delivery, Payment(phase 2) | One action per workflow transition (see `09`) |
| `Messaging` | Message, MessageRead | PostMessage, MarkThreadRead |
| `Ai` | AiUsageEvent, AiCreditLedgerEntry | ReserveCredits, CommitCredits, RefundCredits, GrantCredits, RecordUsage |
| `Settings` | AppSetting | UpdateSettings (typed groups) |

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

```
engine/
├─ index.ts                 Public API re-exports (the ONLY import path used outside the engine)
├─ version.ts               ENGINE_VERSION = "1.0.0" (semver; bump on any output-affecting change)
├─ ids.ts                   newId(prefix)
├─ units/                   parseLength, formatLength, formatArea, unit types
├─ money.ts                 minor-unit helpers
├─ geometry/                vec2, segment, polygon, offset (clipper), intersections, planar faces (half-edge), triangulate
├─ plan/
│  ├─ schema.ts             zod PlanDocument schema (see 03)
│  ├─ derive.ts             derivePlanGeometry(doc) → wall outlines, miters, room polygons, areas, opening frames
│  ├─ validate.ts           validatePlan(doc) → Issue[]
│  ├─ snapping.ts           snap engine (pure)
│  ├─ commands/             plan command implementations
│  └─ migrate.ts            schemaVersion migrations
├─ furniture/
│  ├─ schema.ts             zod FurnitureDocument schema (see 03)
│  ├─ templates/            one file per template key (generators + param schemas + defaults)
│  ├─ generate.ts           generateFurniture(doc, catalog) → FurnitureModel {parts, hardware, fronts, bbox, issues}
│  ├─ rules/                construction + hardware rules (see 07)
│  ├─ validate.ts
│  ├─ diff.ts               diffFurniture(a, b, catalog) → ChangeItem[]
│  ├─ commands/
│  └─ migrate.ts
├─ bom/
│  ├─ bom.ts                computeBom(model, catalog) → Bom
│  ├─ nesting/guillotine.ts nestSheets(parts, sheetSpecs, options) → NestingResult
│  └─ pricing.ts            priceBom(bom, catalog, pricingSettings) → PriceBreakdown
├─ commands/                generic command bus (apply/undo/redo/merge/transactions) on mutative patches
└─ catalog/                 CatalogSnapshot type + zod schema (what the engine needs from the DB)
```

### 5.3 Catalog snapshot

The engine never talks to the database. The server exposes a **catalog snapshot** (`GET /api/catalog/snapshot`, cached, ETag = `catalog_version`) containing active materials, edge bands, hardware, finishes, labour rates, tax rates and pricing settings in the exact shape of `engine/catalog/CatalogSnapshot` (defined in `08-bom-and-costing.md §2`). Every change to any catalog table or pricing setting increments `app_settings['catalog.version']` (integer) in the same transaction.

Furniture revisions store `catalog_version` and `engine_version` used to compute their BOM.

### 5.4 Engine CLI (server-side execution)

`engine-cli/src/cli.ts` is built with Vite (library mode, `ssr: true`, target `node22`, all deps bundled) into `engine-cli/dist/cli.mjs`. Build script `npm run build:engine-cli` runs as part of `npm run build`.

Protocol: `node engine-cli/dist/cli.mjs <command>`; stdin = JSON request; stdout = JSON response `{ "ok": true, "result": … }` or `{ "ok": false, "error": { "code": string, "message": string, "details"?: unknown } }`; exit code 0 for both (non-zero only on crash).

| Command | Request | Result |
|---|---|---|
| `validate-plan` | `{ document }` | `{ valid: boolean, issues: Issue[], migratedDocument }` |
| `validate-furniture` | `{ document, catalog }` | `{ valid, issues, migratedDocument }` |
| `compute-bom` | `{ document, catalog, options: { nesting: boolean } }` | `{ bom: Bom, price: PriceBreakdown, engineVersion }` |
| `diff-furniture` | `{ before, after, catalog }` | `{ changes: ChangeItem[] }` |
| `plan-summary` | `{ document }` | `{ wallCount, roomCount, rooms: [{id,name,areaMm2}], totalAreaMm2, bbox }` |
| `version` | `{}` | `{ engineVersion }` |

PHP wrapper: `App\Support\Engine\EngineCli` using `Symfony\Component\Process\Process` with `['node', base_path('engine-cli/dist/cli.mjs'), $command]`, input via `setInput(json_encode(...))`, timeout 60 s, throws `EngineCliException` on `ok:false` or crash. Calls from HTTP requests are allowed only for `validate-*` (fast); `compute-bom` with nesting runs inside queued jobs or quote-building actions.

### 5.5 Web Worker

`resources/js/editor/workers/engine.worker.ts` exposes `computeBom`, `nestSheets`, `derivePlanGeometry` via a tiny typed RPC (`postMessage` with `{id, method, params}`); composable `useEngineWorker()` returns promise-based functions, cancels stale requests (only latest request per method returns). Main-thread fallback when Workers are unavailable.

---

## 6. Frontend architecture

- Inertia v3 pages under `resources/js/pages`, resolved by `@inertiajs/vite`. Persistent layouts via `defineOptions({ layout: … })`.
- Shared props (`HandleInertiaRequests::share`): `app` (name, logo url, version), `auth.user` (id, name, type, roles, permissions[], unit_system, length_unit, timezone, locale), `features`, `business` (currency, locale, units defaults), `flash`, `unreadNotifications` (count), `i18n` (locale + loaded namespaces hash).
- Data types generated from PHP `Data` classes and enums by spatie typescript-transformer into `resources/js/types/generated.d.ts` (`php artisan typescript:transform`); CI fails if the generated file is stale.
- Routing in TS via Wayfinder (`@/routes/...` / `@/actions/...` generated); **never hard-code URLs**.
- Editors are heavy: plan editor and furniture builder pages are **lazy-loaded chunks**; three.js loaded only on those pages.
- State: pages use Inertia props; editors use Pinia stores per open document (`usePlanEditorStore(planId)`, `useFurnitureEditorStore(designId)`), created on mount, disposed on unmount.
- Large documents: store the document in `shallowRef`; renderers subscribe to an entity revision map (`Map<entityId, number>`) bumped by the command bus; three.js objects created with `markRaw`.

---

## 7. Background processing

Horizon supervisors (config in `config/horizon.php`):

| Queue | Jobs | Workers (prod) | Timeout | Tries |
|---|---|---|---|---|
| `default` | misc, activity side effects | 2 | 60 s | 3 |
| `imports` | `RunBlueprintRecognition`, `PrepareImportPreview` | 2 | 660 s | 2 (backoff 30 s) |
| `engine` | `ComputeRevisionBom`, `NestOrderSheets` | 2 | 120 s | 2 |
| `pdf` | `RenderQuotePdf`, `RenderCutListPdf`, `RenderPlanSheetPdf` | 1 | 120 s | 3 |
| `notify` | queued notifications (all channels) | 2 | 60 s | 5 (exp. backoff 10/30/90/270/600 s) |

Scheduler (`routes/console.php`):

| Schedule | Command / job |
|---|---|
| every minute | `orders:expire-quotes` (quotes past `valid_until` end-of-day business TZ) |
| hourly | `imports:cleanup-stale` (imports stuck in non-terminal state > 30 min → failed + refund) |
| daily 02:00 | `ai:grant-monthly-credits` (idempotent per user per month) |
| daily 03:00 | `media:cleanup-orphans`, `otp:prune` |
| daily 09:00 business TZ | `orders:remind-pending` (reminders for proposals/quotes awaiting customer > 48 h) |
| daily 04:00 | `orders:auto-close-delivered` (delivered > `workflow.auto_close_days`) |
| every 5 min | `horizon:snapshot` |

---

## 8. Real-time (Reverb)

Private channels (authorised in `routes/channels.php`):

| Channel | Who | Events |
|---|---|---|
| `users.{userId}` | that user | `NotificationCreated` (in-app notification payload), `AiCreditsChanged` |
| `orders.{orderId}` | order's customer + staff with `orders.view` | `OrderStateChanged`, `MessagePosted`, `QuoteSent`, `ProductionUpdatePosted`, `ChangeProposalSent` |
| `imports.{importId}` | importing user + staff | `ImportStatusChanged` ({status, stage, progress?, error?}) |
| `furniture-designs.{designId}` | owner + staff | `FurnitureDesignLocked` / `Unlocked`, `RevisionCreated` |
| `staff` | all staff | `OrderSubmitted`, `OrderNeedsAttention` (for admin dashboards) |

Client: `@laravel/echo-vue` configured in `resources/js/lib/echo.ts`; composables `useOrderChannel(orderId)` etc. Real-time is an enhancement: every page must also work by reload/polling (`usePoll` 30 s on order pages when the socket is disconnected).

---

## 9. Security architecture summary

(Full detail in `13-auth-security.md`.)
- Session auth (Fortify) for the web app; CSRF on all state-changing requests; Inertia history encryption enabled for authenticated pages.
- Vision service is **not internet-exposed**; reachable only on the Coolify internal network; requests authenticated with a shared bearer token `VISION_SERVICE_TOKEN`. Files exchanged through short-lived presigned S3 URLs (GET 15 min, PUT 15 min).
- All file uploads go **directly from browser to S3 via presigned PUT** (max sizes enforced by the presign policy and re-checked server-side on confirm), then validated (magic bytes) by a job.
- Policies on every model; staff permission checks via spatie permissions; customers can only access their own projects/orders.
