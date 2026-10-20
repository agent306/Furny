# Furny — Product Requirements & Design Specification

> Status: **Draft for review** · Date: 2026-10-20 · Working product name: **Furny** (the real name is `APP_NAME`; never hard-code "Furny" in UI strings, use `config('app.name')` / `usePage().props.app.name`).

This is the **master document**. It defines the product, the global conventions every part of the system must obey, and the index of the detailed section specs. **Every implementing agent must read this file in full, plus `01-architecture.md`, `02-data-model.md` and `03-design-documents.md`, before reading the section file for its assigned work.**

Rule of precedence when two documents disagree: this file > `02-data-model.md` > `03-design-documents.md` > `09-order-workflow.md` > `13-auth-security.md` > any other section file (for UI behaviour, route names and page names, `10`/`11` are preferred among the other section files). If you find a contradiction, follow the higher-precedence document and record the contradiction in your PR description; do not invent a third behaviour.

`19-reconciliation-log.md` is **informational**: it records how the section documents were reconciled (merged proposals, mapped/rejected proposals, fixed inconsistencies) and lists canonical registries (permissions, event keys, settings keys, upload purposes, routes, queues, scheduled commands) compiled from the normative documents. The merged section documents are normative; if `19` and a section document ever differ, the section document wins.

---

## 1. Section index (reading order)

| # | File | Contents |
|---|------|----------|
| 00 | this file | Vision, personas, scope, glossary, global conventions, decision log |
| 01 | `2026-10-20-furny/01-architecture.md` | Stack + pinned versions, system diagram, repository layout, module boundaries, engine packaging, background jobs, real-time |
| 02 | `…/02-data-model.md` | Every database table, column, index, relation, enum |
| 03 | `…/03-design-documents.md` | JSON schemas (TypeScript types + zod) for Plan documents and Furniture documents, derived outputs, revisions, autosave |
| 04 | `…/04-geometry-engine.md` | Units parsing/formatting, wall graph, miters, room detection, openings, snapping, command system, undo/redo |
| 05 | `…/05-plan-editor.md` | 2D/3D plan editor UX: tools, interactions, panels, shortcuts, touch, view-only mode |
| 06 | `…/06-blueprint-import.md` | Upload, supported formats, Python vision service, recognition pipeline, review/correction UX, trace fallback |
| 07 | `…/07-furniture-system.md` | Furniture templates, parametric model, modules, construction rules, hardware rules, builder UX |
| 08 | `…/08-bom-and-costing.md` | Bill of materials derivation, cut list, edge banding, sheet nesting, pricing formulas, catalog |
| 09 | `…/09-order-workflow.md` | Order state machine, change proposals, quotes & negotiation, confirmation calls, production, completion, delivery |
| 10 | `…/10-customer-app.md` | Every customer-facing page, component and state |
| 11 | `…/11-admin-app.md` | Every staff-facing page, component and state |
| 12 | `…/12-notifications.md` | Event catalogue, channels (in-app, email, WhatsApp, SMS, web push), templates, preferences |
| 13 | `…/13-auth-security.md` | Authentication flows, roles & permissions matrix, policies, rate limiting, upload security, privacy |
| 14 | `…/14-routes-and-api.md` | Every route, controller, form request, Inertia page props and JSON endpoint shape (written from the route registry in `19` §8.5) |
| 15 | `…/15-ui-design-system.md` | Design tokens, components, layouts, accessibility, i18n |
| 16 | `…/16-testing-quality.md` | Test strategy, required test suites, fixtures, CI |
| 17 | `…/17-deployment-ops.md` | Coolify resources, nixpacks.toml, env vars, backups, monitoring, runbooks |
| 18 | `…/18-ai-providers-and-quotas.md` | AI provider abstraction (Anthropic / OpenAI / OpenAI-compatible local / none), credits, budgets, usage metering |
| 19 | `…/19-reconciliation-log.md` | Informational: reconciliation log and canonical registries (see precedence rule above) |

---

## 2. Product vision

Furny is a web application for **one custom-furniture business** (a carpentry/joinery workshop) and its customers.

1. A **customer** uploads the blueprint of their home (photo, scan, PDF, CAD export, real-estate brochure) and gets an **editable 2D plan and a 3D model** of it — or draws the plan themselves. 2D and 3D are two views of the same document; the customer can switch at any moment and edit in either.
2. The customer **designs custom furniture** (wardrobes, cupboards, shelves, tables, TV units, …) with a parametric, modular builder, and **places it in the plan**, in 2D or 3D.
3. The system breaks every furniture design down into a **rough bill of materials** (cut panels, edge banding, hardware, sheet count) and an **estimated price**.
4. The customer submits selected designs as an **order**. **Staff review** the designs, correct/enrich them (e.g. add hinges, change back panels, split a too-wide door), and send a **change proposal** that the customer must **approve**.
5. Staff send a **quote**. The customer **accepts, negotiates (counter-offer / message) or declines**. Quotes are versioned.
6. After acceptance, staff **phone the customer**, log the call, and **manually mark the order confirmed**.
7. During production, staff post **progress updates** (stage, percentage, text, photos).
8. When finished, staff attach **completion photos**; the customer **approves or raises an issue**. Then delivery is recorded and the order is closed.

### 2.1 Success criteria (v1)

| Metric | Target |
|---|---|
| Blueprint import: share of uploads that produce a reviewable draft (not "failed") | ≥ 90% |
| Blueprint import: median customer correction time to an accepted plan (typical 2–3 BHK flat) | ≤ 10 min |
| Plan editor: 2D↔3D switch time on a 100-wall plan (mid-range laptop) | ≤ 500 ms |
| Furniture BOM recomputation after a parameter change | ≤ 100 ms (p95) for a 60-part item |
| Customer-estimate vs. final-quote material cost difference for unmodified designs | ≤ 5% (same engine, same catalog) |
| Time from order submission to first staff action visible to customer | tracked (no target; reported on admin dashboard) |

---

## 3. Personas & roles

| Persona | Account type | Description |
|---|---|---|
| **Customer** | `customer` | Homeowner/tenant. Non-technical. Uses desktop or tablet to design, phone to follow progress, approve, chat. |
| **Owner** | `staff`, role `owner` | Business owner. Everything, including settings, roles, AI budget, deleting data. Exactly ≥1 must exist. |
| **Admin** | `staff`, role `admin` | Runs operations: all orders, catalog, templates, users (except owners). |
| **Estimator** | `staff`, role `estimator` | Reviews designs, creates change proposals and quotes, negotiates. |
| **Production** | `staff`, role `production` | Posts production updates, completion photos, delivery records. Read-only on quotes. |
| **Support** | `staff`, role `support` | Talks to customers (messages, calls), views everything, edits nothing financial or design-related. |

In this spec "**admin**" in lower case means "any staff user with the permission in question"; the exact permission matrix is in `13-auth-security.md`.

---

## 4. Scope

### 4.1 In scope for v1 (must ship)

- Customer self-registration and login (email+password, phone OTP via WhatsApp/SMS, Google OAuth).
- Projects (a home) → Plans (one per floor) → Plan editor (2D/3D) with walls, doors, windows, openings, rooms, fixtures, furniture placement, dimensions, text labels, background image.
- Blueprint import from JPG/PNG/WebP/HEIC/PDF/DXF via the Python vision service with a pluggable AI provider (Anthropic, OpenAI, OpenAI-compatible local, or none) and per-customer AI credits.
- Manual trace mode (background image + scale calibration).
- Furniture builder: carcass-based furniture and table-family furniture from code-defined templates, admin-managed presets, modular sections, fronts, hardware rules, validations, 3D preview, 2D elevation/plan views.
- BOM: cut list, edge banding lengths, hardware list, sheet nesting (guillotine), estimated cost and price.
- Orders with the full workflow in `09-order-workflow.md`: change proposals, quotes (PDF), negotiation, confirmation calls, production updates, completion review, issues/rework, delivery, closing, cancel, hold.
- Order message thread (customer ↔ staff), staff-internal notes.
- Notifications: in-app (database + real-time), email, WhatsApp (Meta Cloud API), SMS (Twilio / MSG91 driver), web push; per-user preferences.
- Admin: dashboard, order board, customers, catalog (materials, edge bands, hardware, finishes, labour rates), presets, template enable/disable, settings (business, currency, tax, units, pricing, AI, notifications), staff & roles, audit log, AI usage report.
- Exports: plan as PNG/SVG/PDF/DXF; 3D as GLB; furniture cut list as CSV/PDF; quote as PDF.
- Responsive: full editing on ≥ 768 px wide viewports (desktop + tablet, mouse or touch); view, approve, chat, quotes, progress on phones.

### 4.2 Phase 2 (design for, do NOT build in v1)

- Online payments (Razorpay/Stripe). The `payments` table **is migrated in v1** (schema stability) but has no UI, routes, or jobs in v1. Feature flag `features.payments` = `false`.
- Real-time multi-user co-editing (CRDT). v1 uses optimistic locking.
- AI furniture assistant ("describe a wardrobe in words"). The AI credit system is generic (`feature` column) so this can be added.
- Multiple businesses / tenants. **Not** planned; do not add `tenant_id` columns.
- Multi-language UI content (strings go through i18n from day one; only `en` ships).
- Native mobile apps.
- Cost-optimised CNC output (drilling programs, DXF per part for CNC).

### 4.3 Explicit non-goals

- Structural engineering, electrical/plumbing layouts, building-code compliance.
- Photorealistic rendering (we do real-time PBR-lite only).
- DWG import (customers are asked to export DXF or PDF; reason: LibreDWG is GPL and ODA converter needs a paid membership for commercial use).
- Multi-storey plans inside one plan document (each floor is its own Plan).

---

## 5. Glossary (use these exact terms in code, UI and docs)

| Term | Meaning | Code identifier |
|---|---|---|
| Project | A customer's home/site. Owns plans, furniture designs, orders. | `Project` / `projects` |
| Plan | One floor of a project, edited in the plan editor. | `Plan` / `plans` |
| Plan document | JSON content of a plan (walls, openings, rooms, …). | `PlanDocument` |
| Plan revision | Immutable snapshot of a plan document. | `PlanRevision` / `plan_revisions` |
| Working copy | The mutable, autosaved latest document on `plans.working_document` / `furniture_designs.working_document`. | `working_document` |
| Furniture design | One piece of custom furniture designed by a customer or staff. | `FurnitureDesign` / `furniture_designs` |
| Furniture document | JSON parametric definition of a furniture design. | `FurnitureDocument` |
| Furniture revision | Immutable snapshot of a furniture document **plus** its derived BOM. | `FurnitureRevision` / `furniture_revisions` |
| Placement | An instance of a furniture design positioned in a plan. Lives inside the plan document. | `FurniturePlacement` |
| Fixture | Non-custom object from a static library (bed, sofa, WC, basin, fridge, kitchen counter…) placed in a plan for context. Not quoted. | `Fixture` |
| Template | Code-defined generator for a furniture family (e.g. `wardrobe`). | `TemplateKey` |
| Preset | Admin-saved furniture document used as a starting point (e.g. "3-door wardrobe 1800"). | `FurniturePreset` / `furniture_presets` |
| Part | A single panel/board derived from a furniture document. | `Part` |
| Hardware line | A hardware item + quantity derived from a furniture document. | `HardwareLine` |
| BOM | Bill of materials: parts, edge banding, hardware, sheets, costs. | `Bom` |
| Engine | The framework-free TypeScript library containing geometry, furniture generation, BOM, nesting, pricing. | `resources/js/engine` |
| Order | A request for manufacturing one or more furniture designs. | `Order` / `orders` |
| Order item | One furniture design (pinned to a revision) in an order, with quantity. | `OrderItem` / `order_items` |
| Change proposal | A set of staff-made revisions to order items, awaiting customer decision. | `ChangeProposal` |
| Quote | Versioned priced offer for an order. | `Quote` / `quotes` |
| Counter-offer | Customer's negotiation response to a quote. | `QuoteNegotiation` |
| Confirmation call | Logged phone call after quote acceptance. | `ConfirmationCall` |
| Production update | Staff progress post during production. | `ProductionUpdate` |
| Completion review | Customer's decision on completion photos. | (state transition + `order_issues`) |
| Blueprint import | One upload + recognition run producing a draft plan document. | `BlueprintImport` |
| Upload intent | A server-approved browser upload (presign → PUT → confirm → processing) with an exhaustive purpose; the only way any browser upload enters the system (`13 §11`). | `UploadIntent` / `upload_intents` |
| Vision service | Python FastAPI service that performs recognition. | `vision/` |
| AI credit | Unit of customer AI allowance. | `ai_credit_ledger` |
| Catalog | Materials, edge bands, hardware, finishes, labour rates, tax rates with prices. | `materials`, `edge_bands`, `hardware_items`, `finishes`, `labour_rates`, `tax_rates` |

---

## 6. Global conventions (MANDATORY for all code)

### 6.1 Units & numbers

- **All lengths are stored and computed in integer millimetres (`mm`)** in documents, the database and APIs. Never store metres, centimetres, inches or floats for lengths. Where sub-millimetre precision matters (edge band thickness, kerf), use the `*_um` (micrometre) integer suffix, or a `decimal(8,2)` column with `_mm` suffix where explicitly specified in `02-data-model.md`.
- Areas: `mm²` as integer (`bigint`) in storage; displayed as m² or ft².
- Angles: **degrees** as `number` (float allowed) in documents, normalised to `[0, 360)`.
- Display units are a **per-user preference** (`users.unit_system` = `metric` | `imperial`) defaulting to the business setting `units.default_system`. Metric display: lengths ≥ 1000 mm as `m` with 2 decimals in summaries, `mm` in editors (configurable per user: `mm` | `cm` | `m`). Imperial display: feet-inches with fractions to 1/8" (`10' 6 3/8"`).
- Input parsing accepts any unit regardless of preference (see `04-geometry-engine.md §1`): `3200`, `3200mm`, `320cm`, `3.2m`, `10'6"`, `10' 6 1/2"`, `126in`, `10ft`, `10'`, `6"`. Bare numbers are interpreted in the user's current editor unit.

### 6.2 Coordinate systems

- **Plan space (2D):** origin arbitrary, **x → right, y → down** (SVG convention), units mm, integers.
- **World space (3D, three.js):** units **metres**, **y up**. Mapping: `world.x = plan.x / 1000`, `world.z = plan.y / 1000`, `world.y = elevation_mm / 1000`. Never put mm into three.js objects.
- **Furniture local space:** origin at the **back-left-bottom** corner of the furniture bounding box as seen from the front. **x → right (width), y → up (height), z → toward the viewer (depth)**, units mm. The engine outputs part transforms in this space; renderers convert to metres.
- **Placement:** a furniture placement's `(x, y)` in plan space is the position of the **centre of the back edge** of the furniture footprint, and `rotation` is the clockwise angle (plan space, y down) from the default orientation where the front faces **+y** (down on screen). This makes snapping furniture against a wall trivial (back edge on wall face).

### 6.3 Identifiers

- **Database primary keys:** ULIDs (`char(26)`), generated by Laravel `HasUlids`, for all domain tables. Exceptions (bigint auto-increment): framework tables (`jobs`, `failed_jobs`, `cache`, `sessions`, `notifications` uses uuid per Laravel default, `activity_log`, `media`, `permissions`, `roles`, pivot tables).
- **Human-readable numbers:** orders `ORD-{YYYY}-{00001}` (sequence per year, generated in a DB transaction with `SELECT … FOR UPDATE` on `number_sequences`), quotes `{order_number}-Q{version}`.
- **Entity IDs inside documents:** `{prefix}_{nanoid(10)}` with alphabet `0123456789abcdefghijklmnopqrstuvwxyz`. Prefixes: `n` node, `w` wall, `o` opening, `r` room, `f` placement, `x` fixture, `d` dimension annotation, `t` text annotation, `s` furniture section, `fr` front, `p` extra part, `h` extra hardware line. Generated by `engine/ids.ts::newId(prefix)`.
- **Derived part keys** (furniture BOM) are deterministic paths, not random, so overrides survive regeneration (see `03-design-documents.md §3.6`).

### 6.4 Money

- Money is stored as **integer minor units** (`bigint`, columns suffixed `_minor`) plus the business currency code. v1 has **one currency per installation** (`business.currency`, ISO-4217, default `INR`). Changing currency after any quote exists is blocked by the settings UI.
- PHP: `brick/money` for arithmetic and formatting; rounding mode `HALF_UP` at line level; totals are sums of rounded lines.
- TypeScript (engine estimates): integers in minor units; helper `engine/money.ts` (`multiplyMinor(amountMinor, factor): number` rounds half-up). Formatting in UI via `Intl.NumberFormat(locale, {style: 'currency', currency})`.
- Tax: configurable tax rates (`tax_rates` table) with `inclusive` flag at the business level (`pricing.prices_include_tax`). See `08-bom-and-costing.md`.

### 6.5 Time

- Store `timestamptz`, app timezone `UTC`. Display in `users.timezone` (IANA, default business setting `business.timezone`, default `Asia/Kolkata`). Dates without time (e.g. `quotes.valid_until`, `orders.expected_delivery_on`) are `date` columns interpreted in the business timezone.

### 6.6 Naming

- PHP: PSR-12 via Pint (Laravel preset), strict types in every file (`declare(strict_types=1);`), final classes by default, PHPStan level 8 via Larastan.
- Domain code under `app/Domain/{Area}/…` (Actions, Data, Enums, Events, Models live where `01-architecture.md §4` says).
- TS: `strict: true`, no `any` (use `unknown` + zod), ESLint + Prettier (configs from starter kit). Vue SFCs `<script setup lang="ts">`. Component file names PascalCase. Composables `useXxx.ts`.
- Database: snake_case, plural table names, `*_id` FKs, `*_at` timestamps, `*_on` dates, `is_*`/`has_*` booleans, enums stored as `string` columns (not PG enums) with PHP backed enums for validation.
- Routes: named, dot-separated, prefixed `customer.` / `admin.` / `api.` (plus the framework/auth, `webhooks.`, `links.`, `legal.`, `media.`, `health.` groups listed in `14`). Every route has exactly one name, one method and one path.
- **Wire format:** Inertia props and JSON responses are **camelCase** (exceptions: `features` flag keys and Laravel paginator `meta` keys); request bodies are camelCase except Fortify/auth forms (Fortify field names); query strings use Laravel snake_case conventions (`01 §6`).
- **Translations (i18n):** strings live in `resources/lang/en/{namespace}.php` as **ICU MessageFormat** messages (except the Laravel-format namespaces `validation`, `passwords`, `pagination`, `auth`). The frontend uses a thin layer on `intl-messageformat`; PHP renders ICU strings with the helper `trans_icu()`; `php artisan i18n:export` writes `resources/js/lang/generated/{locale}.json` (committed, CI-checked). Details in `15 §15`. **No user-visible literal strings in Vue templates or PHP notifications** — always a translation key.
- **Package manager:** yarn 4 via corepack (`01 §1.2`); never npm/pnpm lockfiles.

### 6.7 Feature flags

Config file `config/features.php` reading env vars, exposed to the frontend as shared Inertia prop `features` whose keys are the flag names below without the `features.` prefix (snake_case, the one deliberate exception to the camelCase wire format, `01 §6`, `15 §8`):

| Flag | Env var | Default | Meaning |
|---|---|---|---|
| `features.payments` | `FEATURE_PAYMENTS` | `false` | Phase 2 payments UI |
| `features.whatsapp` | `FEATURE_WHATSAPP` | `false` until configured | WhatsApp channel available (also requires the WhatsApp env vars of `17 §6.1`) |
| `features.sms` | `FEATURE_SMS` | `false` until configured | SMS channel available |
| `features.web_push` | `FEATURE_WEB_PUSH` | `true` | Web push available (forced `false` when the VAPID keys are missing) |
| `features.google_login` | `FEATURE_GOOGLE_LOGIN` | `false` until configured | Google OAuth button (also requires the Google env vars) |
| `features.dxf_import` | `FEATURE_DXF_IMPORT` | `true` | Accept DXF uploads |
| `features.walkthrough_camera` | `FEATURE_WALKTHROUGH_CAMERA` | `true` | First-person camera in 3D |
| `features.captcha` | — (derived) | `true` when `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` are set, else `false` | Cloudflare Turnstile on auth forms (`13 §3`); the site key itself is a page prop of auth pages only |

### 6.8 Error handling principles

- Every user action that can fail shows a translated, specific message (toast for transient, inline for form fields, full-page state for load failures). Never show raw exception text to customers.
- Long-running work (imports, PDF generation, nesting on server, notifications) always runs in queued jobs, idempotent, with retries and a terminal `failed` state visible in the UI.
- Autosave failures never lose data: the editor keeps the unsaved document in memory and in `localStorage` (key `fs:draft:{type}:{id}`) and retries with backoff (see `03-design-documents.md §5`).

---

## 7. Decision log (with rationale)

| # | Decision | Rationale |
|---|---|---|
| D1 | Single business, no multi-tenancy | Owner's choice; simpler data model. |
| D2 | Laravel 13 + Inertia v3 + Vue 3.5 + TS + Tailwind 4 + PostgreSQL 18, deployed with Nixpacks on Coolify | Owner's stack. Nixpacks is in maintenance mode upstream but fully supported by Coolify and used in Coolify's own Laravel guide; migration path to Railpack documented in `17-deployment-ops.md`. |
| D3 | One framework-free TypeScript **engine** used in browser, Web Worker and Node (server) | Customer estimates and staff quotes come from identical code; server re-derives BOM before quoting so client tampering is impossible. |
| D4 | Separate **Python vision service** (FastAPI + OpenCV + RapidOCR + pdfplumber + pypdfium2 + ezdxf) | Best-in-class CV/OCR libraries are Python; permissive licences. No commercial raster-to-vector API exists with self-serve pricing; open models are non-commercial/GPL. |
| D5 | AI provider is pluggable: `anthropic` (default `claude-opus-5-5`), `openai`, `openai_compatible` (local: Ollama/vLLM/LM Studio), `none` (pure CV) | Owner requirement; avoid lock-in; allow zero-cost operation. |
| D6 | AI usage metered in **credits** per customer with monthly allowance + admin grants + global USD budget | AI is a paid service; owner requirement. |
| D7 | 2D editor renders **SVG** from Vue; 3D uses **TresJS** shell + imperative three.js geometry | SVG gives crisp CAD lines, dimension text and free vector export; Tres gives Vue-idiomatic canvas; imperative geometry avoids Vue reactivity overhead. |
| D8 | Walls cut with **extruded shapes with holes**, not CSG | three-bvh-csg is experimental; extrusion is exact and fast. |
| D9 | Documents stored as **JSONB** working copy + immutable revisions; optimistic locking; no CRDT | Single-user editing; admin edits go through proposals. |
| D10 | Integer millimetres everywhere | No float drift; trivially comparable. |
| D11 | Guillotine nesting implemented in-house in TS | No maintained JS library supports kerf + per-part grain lock + guillotine; ~300 lines. |
| D12 | PDF generation via **Gotenberg** (spatie/laravel-pdf Gotenberg driver) | Keeps Chromium out of the Nixpacks image. |
| D13 | Files on S3-compatible object storage (Cloudflare R2 or MinIO) | Stateless app containers; rolling deploys. |
| D14 | Order workflow via `spatie/laravel-model-states` | Explicit, testable transitions. |
| D15 | DWG not supported | Licensing (see §4.3). |
| D16 | Payments table migrated in v1 but unused | Schema stability for phase 2. |
| D17 | `13 §7.1`'s permission list (24 permissions) and owner gates are authoritative; section docs map their needs onto it: imports monitor/view-all/debug → `customers.view`; import re-run free / refund / discard on behalf, AI usage report, credit grant/revoke/refund → `ai.manage`; AI settings + provider test → owner gate `settings.manage_restricted`; cut-list export → `orders.view`; cost visibility → `quotes.view_costs`. No `imports.*`, `ai.credits.manage`, `ai.usage.view`, `settings.ai.manage`, `furniture.*` permissions exist. | One small, auditable permission model; the proposed extra permissions duplicated existing role sets. |
| D18 | `orders.edit_designs` removed; `orders.propose_changes` covers creating/sending/withdrawing proposals **and** editing their item design drafts | Both were granted to exactly the same roles; two names for one capability invite inconsistent checks. |
| D19 | Import notification key is `import.ready_for_review`; order event keys are listed in `09 §11` and `12 §3.2`, non-order keys (imports, AI, account, staff, auth, system) only in `12 §3.3` (adds `ai.credits_refunded`, `ai.budget_threshold_reached`, `ai.provider_unavailable`, `system.test_push`) | One catalogue per event family; key matches the import status. |
| D20 | Exactly one browser upload mechanism: upload intents (`13 §11`, purposes exhaustive incl. `blueprint_source`); blueprint imports are created from a `ready` intent (`06` A1 `{uploadId, mode, planId?}`), so status `awaiting_upload` and an import-specific confirm endpoint do not exist; vision-service presigned URLs remain a separate server-only mechanism | One audited code path for size/type/magic-byte checks. |
| D21 | Signup AI credits are granted on the customer's first verified contact (`ContactVerified`), not at registration | Deters throwaway-account credit farming. |
| D22 | Wire format camelCase for props/JSON/request bodies (auth forms excepted), snake_case query strings | Matches generated TS types; one convention for agents. |
| D23 | i18n = ICU MessageFormat via `intl-messageformat`, PHP `trans_icu()`, `php artisan i18n:export` | Same strings render server-side (mail/SMS/push/PDF) and client-side; `select`/plural needed. |
| D24 | UI fonts Inter + JetBrains Mono via `@fontsource-variable` (self-hosted); Noto Sans TTF only for client-side jsPDF export | CSP `font-src 'self'`; jsPDF cannot embed variable WOFF2. |
| D25 | Plans can be locked by staff (`plans.locked_at/locked_by`, permission `plans.edit_any`); writes to a locked plan return 423 `plan_locked` | Protects reference plans during production without new permissions. |
| D26 | Plan editor canvas colours follow the theme-aware editor tokens of `15 §3`; exports always use the light `EXPORT_PALETTE` | One token source; exports independent of viewer theme. |
| D27 | Vision service health endpoint is `GET /healthz`; its environment variables are those of `18 §4`; container memory limit 3.5 GB | `06`/`18` own the service contract; `17` deploys it. |
| D28 | Security headers on PHP responses are owned by Laravel (`13 §12.1`); nginx adds only `nosniff` + HSTS on static files; trusted proxies = private Docker CIDRs (`TRUSTED_PROXIES`) | Avoid duplicate/conflicting headers; never trust spoofable forwarded headers from arbitrary peers. |
| D29 | Session config per `13 §6.1` (`__Host-session`, encrypted payloads, dedicated Redis DB 2) | Security baseline; global logout = flush session DB. |
| D30 | Quote "Regenerate from designs" is route `admin.orders.quotes.regenerate` and keeps custom/discount lines (`08 §6`) | UI/route names follow `11`; behaviour follows `08`. |
| D31 | Import notifications use `12`'s channel defaults (`import.ready_for_review`: in-app + push, email off by default; `import.failed`: email on) | `12` owns channel policy. |
| D32 | Database/object backups to Backblaze B2 with SSE-B2 default encryption; no client-side `age` encryption; Postgres retention 30 daily + 12 monthly | Coolify-managed backups cannot encrypt client-side; separate provider + SSE keeps the requirement realistic. |
| D33 | PDF templates embed all images and fonts as data URIs; Gotenberg runs with JavaScript disabled and a `file:///tmp` allow-list | No network access from Chromium (SSRF-safe, works offline). |
| D34 | `nixpacks.toml` follows the owner's proven Coolify baseline (`docs/ops/owner-reference-nixpacks.toml`): explicit `nixPkgs` (php84 + extensions, nodejs_22, nginx, curl, supervisor, rclone), owner's `[variables]` (200M uploads, 512M memory, 600 s execution), build-time `php artisan optimize` (re-run at container start), nginx config as `[staticAssets]`; **yarn 4 via corepack** is the package manager everywhere | Owner decision; one proven deployment pattern across the owner's apps. |
| D35 | Feature flags read `FEATURE_*` env vars (§6.7); `features.captcha` derived from Turnstile keys | Env-only operation in Coolify. |
| D36 | Queue connections `redis` (retry_after 180) and `redis-long` (720, `imports`); one scheduler table in `01 §7`; scheduler heartbeat cache key `health:scheduler:heartbeat` | `retry_after` must exceed job timeouts; one list prevents drift. |
| D37 | Pricing setting `pricing.sheet_billing_mode` defaults to `used_area` (`edge_premill_mm` default 0) | Matches how estimates were specified in `08`; whole-sheet billing remains a setting. |
