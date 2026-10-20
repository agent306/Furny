# 19 — Reconciliation log & canonical registries

> Status: **informational** (master, precedence rule in its header). Date: 2026-10-20. This file records how the section documents `01`–`13`, `15`, `17`, `18` and the master were reconciled into one consistent set: which "Proposed additions to other documents" appendices were merged where, which proposals were mapped or rejected and why, and which inconsistencies were fixed. Section 8 lists canonical registries compiled from the normative documents (input for `14-routes-and-api.md` and `16-testing-quality.md`, which are written separately). If anything here differs from a section document, the section document wins.

---

## 1. Rules applied

1. Precedence: master > `02` > `03` > `09` > `13` > other section files; for UI behaviour, route names and Inertia page names `10`/`11` preferred among the others (master header).
2. Every appendix "Proposed additions to other documents" was merged into its target document **in place** and the appendix replaced by the line *"Appendix merged into the target documents during reconciliation (see 19-reconciliation-log.md)."* Appendices merged: `04`, `05`, `06`, `07`, `08`, `10`, `11`, `12`, `13`, `15`, `17`, `18` (12 appendices). `17` keeps its own normative appendices A (Railpack) and B (build troubleshooting).
3. Owner decisions (§2) override any proposal. Other proposals were accepted unless they contradicted master/`02`/`03`/`09`; contradictions were resolved towards the option most consistent with the master and logged in §4.
4. `14-routes-and-api.md` and `16-testing-quality.md` were **not** written or edited; proposals addressed to them are collected in §6 and §8.

---

## 2. Owner decisions applied

| Ref | Decision | Where applied | Master |
|---|---|---|---|
| OD-a | `13 §7.1` permission list is authoritative (24 permissions). Not added: `imports.view_all`, `imports.manage`, `ai.credits.manage`, `ai.usage.view`, `settings.ai.manage`, `furniture.export_cutlist`, `furniture.view_costs`. Mapping: imports monitor/view all/debug → `customers.view`; import re-run free, refund, discard on behalf, AI usage report, credit grant/revoke/refund → `ai.manage`; AI settings + provider test → owner gate `settings.manage_restricted`; cut-list export → `orders.view`; costs → `quotes.view_costs`. `ai.manage` verified granted to owner + admin. `orders.propose_changes` = create/send/withdraw + edit drafts; `orders.edit_designs` removed as redundant (same roles). | `13 §7`, `§8.4`, `§8.7`; `06 §4.3`; `07 §8.2`, `§11.2`; `08 §8`; `11 §1`, `§2`; `18 §1`, `§9.5`, `§10.3`, `§15`; `02 §14` (seeder "24 permissions") | D17, D18 |
| OD-b | Event key `import.ready_for_review` everywhere; every event key in `12`'s catalogue; `09 §11` lists order events only and points to `12 §3.3` for the rest. | `06 §4.7–§4.8`, `§15`; `09 §11`; `12 §3.3–§3.7`, `§5.1` | D19 |
| OD-c | One upload mechanism = `13 §11` upload intents (`upload_intents`, `api.uploads.presign|confirm|show`), purposes exhaustive (14 values incl. `blueprint_source`, `plan_thumbnail`, `project_cover`, `furniture_thumbnail`, `preset_thumbnail`). Vision-service presigned URLs stay a separate, server-only mechanism (stated explicitly). | `13 §11.1–§11.3`; `02 §1.6`, `§4.1`, `§10`; `06 §1.1`, `§2`, `§3`, `§4.3–§4.4`, `§4.10`, `§14`, `§16.4`, `§17`; `05 §1.4`; `07 §11.1`; `10 §9.1`; `11 §2.2`; `15 §9.10`; `01 §9` | D20 |
| OD-d | Signup AI credits granted on first contact verification (`ContactVerified`). | `18 §10.1`; `02 §7.1`, `§13 ai.signup_credits`; `13 §5.6`; `01 §4` | D21 |
| OD-e | Accepted additions: plan lock (`plans.locked_at/locked_by`, 423 `plan_locked`, `plans.edit_any`), `notification_deliveries`, `staff_invitations`, `upload_intents`, settings group `auth`, `users.terms_accepted_at/anonymised_at/onboarded_at`, `orders.state_changed_at`, `deliveries.scheduled_until`, `quote_negotiations.item_comments`, `blueprint_imports.review_version` + `pages` collection + extended hints, `pricing.sheet_billing_mode` (`used_area`) + `edge_premill_mm`, `notifications.quiet_hours`, `workflow.min_preferred_delivery_days`, `workflow.production_stages` item shape, `catalog.seed_reviewed`, media `FurnitureRevision.cutlist_pdf`, `ai_usage_events.feature = provider_test`, engine CLI `cutlist-csv` / `template-default` / `compute-bom` options, worker RPC `estimateFurniture`, i18n (`intl-messageformat`, `trans_icu()`, `i18n:export`), fonts (Inter + JetBrains Mono via @fontsource; Noto Sans TTF only for jsPDF), camelCase wire format, Sentry optional, deployment file layout, queue connections `redis`/`redis-long`, one scheduler table with times (heartbeat key `health:scheduler:heartbeat`), channel `orders.{id}.internal`, `routes/webhooks.php`, feature-flag env names, idempotent seeders, `/up/deep`. | `02`, `03`, `09`, `13`, `01`, `05`, `12`, `15`, `17`, master §6 | D22–D25, D33, D35–D37 |
| OD-coord | Owner's proven `docs/ops/owner-reference-nixpacks.toml` is the baseline for `17 §5.2` (structure kept; extended with php84 extensions redis/intl/gd/bcmath/zip/sodium/posix/opcache/fileinfo, `python311Packages.supervisor`, `rclone`; owner's `[variables]` supersede the old php.ini numbers; build-time `php artisan optimize` + re-run at container start; nginx config as `[staticAssets]` with Furny locations `/build`, `/sw.js`, `/up`, `fastcgi_buffer_size 8k`; supervisord runs php-fpm + nginx `-c /etc/nginx/nginx.conf` + horizon + `schedule:work` + `pulse:check`; Reverb = same build, start override). **yarn 4 via corepack** is the package manager everywhere. | `17 §1 O3/O4/O14`, `§3`, `§5.2–§5.8`, `§6`, `§10.2`, Appendix B; `01 §1.2`, `§3`, `§5.4`; `04 §10`; `15 §4`; `13 §19` | D34 |

---
## 3. Merged proposals (source → target)

"Merged" = the content now lives normatively in the target; wording may have been adapted to the target's conventions.

### 3.1 From `04` (geometry engine)

| # | Proposal | Target |
|---|---|---|
| 04-1 | `PlanGeometry` room `holes: Point[][]`; derived coordinates are floats; `areaMm2`/`perimeterMm` rounded | `03 §1.2` |
| 04-2 | Fixture rotation convention (front faces +y at 0°, `(x, y)` = footprint centre) | `03 §1` (`Fixture`) |
| 04-3 | `resources/lang/en/engine.php` holds every `engine.*` key | `15 §15.2` (namespace `engine`, owned by `04`); `05` intro |

### 3.2 From `05` (plan editor)

| # | Proposal | Target |
|---|---|---|
| 05-A1 | Editor JSON endpoints (`api.plans.revisions.index/show`, `api.plans.duplicate-with-document`, `api.plans.thumbnail.store`, `api.projects.cover.store`, `api.plans.lock.store/destroy`, `api.furniture-designs.working-copy.show`) | `05 §1.4` (names + contracts), §8.5 registry; thumbnail/cover bodies changed to `{uploadId}` (see §4) |
| 05-A2 | No new permission for plan locks (`plans.edit_any`); 423 on locked plans | `13 §8.2` (`lock`/`unlock` abilities + 423 rule) |
| 05-A3 | `plans.locked_at`, `plans.locked_by` | `02 §3.2` |
| 05-A4 | 423 `{code:'locked', reason:'plan_locked', lockedBy, lockedAt}` | `03 §5` (client + server step 1) |
| 05-A5 | Host props `lock`, `canLock`, `readOnlyReason` (`no_permission`, `plan_locked`) | `10 §8.2` (`PlanEditPageProps`), `11 §6.4`, `05 §1.3` |
| 05-A6 | `mounting` on `FurnitureDesignSummaryData` | `10 §3` |
| 05-A7 | Snapshot `materials[].colorHex`, `boardType` | already present in `08 §2` (verified) |
| 05-A8 | Self-hosted Noto Sans TTF for jsPDF; `plan_editor.php`, `engine.php` | `15 §2`, `§15.2`; `01 §3` (`public/fonts/`); `05 §14.3` |
| 05-A9 | `SaveStatusIndicator` status `invalid` + click handler | `15 §7.3`, `§9.31`; `05 §11` |

### 3.3 From `06` (blueprint import)

| # | Proposal | Target |
|---|---|---|
| 06-A1 | `blueprint_imports.review_version` | `02 §4.1` |
| 06-A2 | Extended `hints` shape | `02 §4.1` |
| 06-A3 | Media collection `BlueprintImport.pages` | `02 §4.1`, `§10`; `06 §4.2`; `13 §8.9` |
| 06-A4 | `result_meta` holds `inspect` and `review` keys | `02 §4.1` |
| 06-B1 | Python packages scikit-image, onnxruntime, pydantic-settings, anyio, uv | `01 §1.3` |
| 06-B2 | `imports:cleanup-stale` performs all rules of `06 §4.10` | `01 §7` |
| 06-B3 | `ImportStatusChanged` payload | `01 §8` |
| 06-B4 | `config/imports.php`, `App\Support\Vision\VisionClient` | `01 §3` |
| 06-C3 | `engine/plan/roomNames.ts` | already in `04 §0.1`; `01 §5.2` |
| 06-D1/D2 | Editor mode `import-review`, calibrate scale UI | already in `05` (verified) |
| 06-G | Route names `api.imports.*`, import pages | `06 §4.3` (names on every row), §8.5 registry |
| 06-H | Laravel env `VISION_SERVICE_URL`, `VISION_SERVICE_TOKEN`; vision env per `18 §4` | `17 §6.1`, `§6.2` |
| 13-D | Vision `POST /v1/images/normalize` (proposed by `13`) | `06 §5.8` |

### 3.4 From `07` (furniture)

| # | Proposal | Target |
|---|---|---|
| 07-1 | `validate-furniture.valid` uses `SAVE_BLOCKING_CODES` only | `03 §2.4`, `§5` |
| 07-2 | T6 precondition: each `staff_draft_document` has no `error` issues | `09 §2` (T6) |
| 07-3 | Part and hardware key additions (glass frame, table parts, `carcass.connectors.cam/.dowel`, …) | `03 §3.6` |
| 07-4 | `materials.usage` tokens incl. `glass` | `02 §6.1` |
| 07-5 | `hardware_items.is_default_for` keys exhaustive in `07 §6.11` | `02 §6.3` |
| 07-7 | Routes `customer.projects.furniture.create/store`, `customer.furniture.edit`, `admin.furniture.create/store/edit`, `api.furniture-designs.duplicate`, `api.furniture-designs.thumbnail.store` | §8.5 registry; `07 §8.1`, `§11.1` (`returnPlanId` from `10`) |
| 07-8 | Worker RPC `estimateFurniture(doc, catalog) → {bom, price}` | `01 §5.5` |

### 3.5 From `08` (BOM & costing)

| # | Proposal | Target |
|---|---|---|
| 08-1 | `pricing.sheet_billing_mode` (`used_area`), `pricing.edge_premill_mm` (0) | `02 §13` |
| 08-2 | `quotes.discount_minor` derived; discount line rules | `02 §8.5`, `§8.6` |
| 08-3 | Media `FurnitureRevision.cutlist_pdf` | `02 §10`; `13 §8.9` (access `orders.view`) |
| 08-4 | Snapshot includes inactive/archived rows | `01 §5.3` |
| 08-5 | `compute-bom` options `allowRotation`, `price`; command `cutlist-csv` | `01 §5.4` |
| 08-6 | `computeBom` options, edge banding incl. allowance + waste, instance keys `key#k` | `03 §3.2` |
| 08-8 | Cut-list routes `admin.furniture-revisions.cutlist.csv`, `.cutlist.pdf.store`, `.cutlist.pdf.show` | `08 §8` (paths added), `11 §2.2`, §8.5 registry |
| 08-9 | `catalog.seed_reviewed` + dashboard banner | `02 §2.1`, `§13`; `08 §7` |

### 3.6 From `10` (customer app)

| # | Proposal | Target |
|---|---|---|
| 10-A1 | `users.onboarded_at`, middleware `onboarded` | `02 §1.1`; `13 §1` |
| 10-A2 | `quote_negotiations.item_comments` | `02 §8.7`; `09 §6` |
| 10-A3 | `config/plan_starters.php` registry | `10 §8.3` (normative there; `05` defines none); `01 §3` |
| 10-A4 | `deliveries.scheduled_until` | `02 §8.11`; `09 §9` |
| 10-A5 | `workflow.min_preferred_delivery_days` (7) | `02 §13` |
| 10-A6 | `UpdateProject` creates a new address row when referenced by an Active order | `10 §7.4`; `01 §4` |
| 10-A7 | camelCase wire format | master §6.6; `01 §6` |
| 10-A8 | `api.furniture-revisions.show` | `10 §2.3` (contract inline), §8.5 registry |
| 10-A9 | `customer.account.notifications.reset`, `.test-push`, staff equivalents; event `system.test_push` | `10 §2.2`, `11 §2.2`, `12 §3.3`, §8.5 registry |
| 10-A10 | `legal.terms`, `legal.privacy` | `10 §2.1`, §8.5 registry |
| 10-A11 | Customer route names; `returnPlanId` | `10 §2`, `07 §8.1`, §8.5 registry |
| 10-A12 | `OrderData.holdReason` from activity properties of T26 | `09 §2` (T26), `10 §11.0` |
| 10-A13 | `can.postMessage` = `MessagePolicy::create` + blocked reason | `10 §11.0` |

### 3.7 From `11` (admin app)

| # | Proposal | Target |
|---|---|---|
| 11-B1 | `orders.state_changed_at` + index | `02 §8.1`; `09 §2` |
| 11-B2 | `deliveries.scheduled_until` | `02 §8.11` |
| 11-B3 | Permission usage (no new names) | confirmed by OD-a |
| 11-B4 | Notifications log binds to `notification_deliveries` | `11 §15` (→ `02 §1.7`) |
| 11-B6 | `workflow.production_stages` item shape | `02 §13` |
| 11-B8 | Engine CLI `template-default` | `01 §5.4` |
| 11-B9 | Admin route names (settings groups, account, search, storage check, save-as-preset, recompute BOM) | `11 §2`, §8.5 registry |
| 11-B10 | Quote draft optimistic lock via `updated_at` | `11 §3` |
| 11-B11 | `api.presets.document.update` | `11 §2.2`, §8.5 registry |
| 11-B12 | Shared prop `healthBanners` | `01 §6` |
| 11-B13 | Activity properties store `reason` (T26, customer deactivation) | `09 §2` (T26); `11 §6.2` |
| 11-B14 | `Admin/Account/Security` vs `Admin/Account/TwoFactor` split | `13 §5.10` |
| 11-B15 | Staff-created customers (`onboarded_at`/`terms_accepted_at` null, password link) | `13 §5.1` |

### 3.8 From `12` (notifications)

| # | Proposal | Target |
|---|---|---|
| 12-A1 | Table `notification_deliveries` | `02 §1.7` |
| 12-A2 | `notifications` indexes | `02 §1.8` |
| 12-A3 | `notifications.quiet_hours`, `whatsapp_templates` and `sms_templates` shapes | `02 §13` |
| 12-B | `eventId()`, `occurredAt()`; `DispatchCallbackDue`; `call.no_answer` | `09 §11`, `§7` |
| 12-C | Composer mail transports, `twilio/sdk`; `routes/webhooks.php`; scheduler `notifications:staff-digest`, `notifications:prune`; contract `UserNotifiableEvent` | `01 §1.1`, `§3`, `§7`, `§4` |
| 12-D | Feature-flag env names | master §6.7 |
| 12-E | Route names | §8.5 registry |
| 12-F | Settings → Notifications page content | already in `11 §12.5` (verified) |

### 3.9 From `13` (auth & security)

| # | Proposal | Target |
|---|---|---|
| 13-A1 | `users.terms_accepted_at`, `users.anonymised_at` | `02 §1.1` |
| 13-A2 | Table `staff_invitations` | `02 §1.5` |
| 13-A3 | Table `upload_intents` | `02 §1.6` |
| 13-A4 | Settings group `auth` | `02 §13` |
| 13-A5 | Roles seeder = `13 §7.1–§7.2` | `02 §14` (24 permissions, OD-a) |
| 13-B | `features.captcha` | master §6.7; `01 §6` |
| 13-C | Scheduler `otp:monitor`, `users:anonymise-deleted`, `activitylog:clean`; channel `orders.{orderId}.internal`; `routes/webhooks.php`, `config/security.php`; `twilio/sdk` | `01 §7`, `§8`, `§3`, `§1.1` |
| 13-D | Vision `/v1/images/normalize` | `06 §5.8` |
| 13-E | Route names | §8.5 registry |
| 13-F | Customer/admin security pages, export, deletion, invitations, audit, health banners | already in `10 §13`, `11 §7`, `§16`, `§18` (verified) |
| 13-G | Self-hosted fonts; only `MessageBody.vue` may use `v-html` | `15 §2`, `§15.4` |
| 13-H | `ContactVerified` for signup credits | `18 §10.1` (OD-d) |

### 3.10 From `15` (UI design system)

| # | Proposal | Target |
|---|---|---|
| 15-1 | Frontend packages (fontsource, tw-animate-css, intl-messageformat, libphonenumber-js, culori) | `01 §1.2` |
| 15-2 | i18n decision (`intl-messageformat`, `trans_icu()`, `i18n:export`, generated JSON, `app.supported_locales`) | master §6.6; `01 §3`; `12 §1` |
| 15-3 | Uploads implement `13 §11` | `15 §9.10` (now also for `blueprint_source`) |
| 15-4/5 | Shared props `staffCounters`, `healthBanners`, `features.captcha`, exact `auth.user`/`business` fields, `app.logoUrl` | `01 §6` |
| 15-6 | `appearance` cookie | `13 §12.2` |

### 3.11 From `17` (deployment & ops)

| # | Proposal | Target |
|---|---|---|
| 17-1 | Optional Sentry packages; `engines.node`; Telescope `dont-discover` | `01 §1.1–§1.3` |
| 17-2 | Deployment file layout | `01 §3` |
| 17-3 | `EngineCli` uses `config('engine.node_binary')` | `01 §5.4` |
| 17-4 | Queue connections `redis`/`redis-long`, Horizon waits/staging, `pulse:check` under supervisor | `01 §7` |
| 17-5 | Scheduler conventions + heartbeat + prune tasks | `01 §7` (single table) |
| 17-6 | `app.version`, `vite:preloadError` reload | `01 §6` |
| 17-7 | Reverb `allowed_origins`, scaling | `01 §8` |
| 17-8 | No DB/Redis/HTTP during boot | `01 §2` (cross-cutting rule) |
| 17-9 | Feature-flag env names | master §6.7 |
| 17-10 | Idempotent seeders, `SEED_OWNER_NAME` | `02 §14` |
| 17-13 | `health.deep` `GET /up/deep` | §8.5 registry |
| 17-14 | PDF images as data URIs | `13 §12.9`; master D33; `17 §7.9` (Gotenberg flags) |

### 3.12 From `18` (AI providers & quotas)

| # | Proposal | Target |
|---|---|---|
| 18-A1 | `ai_usage_events.feature = provider_test` | `02 §7.2` |
| 18-A2 | `monthly_grant` rows may have `delta = 0` | `02 §7.1` |
| 18-A3 | `ai` group semantics (provider/model/effort/DXF pricing/0 = unlimited) | `02 §13` |
| 18-B1 | `ResolveRecognitionPlan`, `RefundCredits` methods, `CreditBalance`, `BudgetGuard` | `01 §4` |
| 18-B3 | `AiCreditsChanged` payload | `01 §8` |
| 18-C | AI notification events | `12 §3.3–§3.7`, `§5.1` (params renamed, §4) |
| 18-D | Limiters `imports-start`, `ai-provider-test` | `13 §10` |
| 18-E | Route names | §8.5 registry |
| 18-F | Vision env per `18 §4`; Laravel needs only `VISION_SERVICE_URL`/`TOKEN` | `17 §6.2` |

---
## 4. Rejected or mapped proposals

| Source | Proposal | Outcome | Reason |
|---|---|---|---|
| `06` F | Permissions `imports.view_all`, `imports.manage` | **Mapped** → `customers.view` (view all, debug) / `ai.manage` (free re-run, refund, discard on behalf); edit/accept on behalf → `plans.edit_any` | OD-a, D17 |
| `07` 6, `08` 7 | Permission `furniture.export_cutlist` (and `furniture.view_costs`) | **Mapped** → `orders.view` / `quotes.view_costs` | OD-a |
| `18` D | Permissions `ai.credits.manage`, `ai.usage.view`, `settings.ai.manage` | **Mapped** → `ai.manage` / owner gate `settings.manage_restricted` | OD-a |
| `13` A.5 | Seeder with 25 permissions incl. `orders.edit_designs` | **Changed** → 24 permissions, `orders.edit_designs` removed | OD-a, D18 |
| `06` F | Rate limiter `imports-presign` 20/h | **Rejected** → shared `uploads-presign` (30/min, 300/day) | OD-c: one upload mechanism |
| `06` G / §4.3 | `api.imports.confirm`, A1 returning a presigned PUT, status `awaiting_upload`, action `ConfirmImportUpload`, error `upload_missing` | **Rejected** → A1 takes `{uploadId, mode, planId?}`, creates the import in `uploaded`; A2 number kept free | OD-c, D20 |
| `06` E | Notification `import.ready` (email when processing > 60 s; params `projectName, filename, reviewUrl`) | **Rejected** → `import.ready_for_review` with `12`'s channels (email default off) and params (`fileName`) | OD-b; `12` owns channel policy (D31) |
| `06` H | Vision container memory 4 GB | **Rejected** → 3.5 GB | `17 §4.2` memory budget is the binding deployment number (D27) |
| `06` C1/C2 | Commands `plan.rescale`, `plan.background.calibrate` | **Mapped** → existing `04 §6.6` commands `rescalePlan`, `calibrateBackground {space:'image', a, b, distanceMm}` | `04` already defines them; `03`/`04` naming convention |
| `07` 7 | Thumbnail upload as multipart `file` | **Rejected** → upload intent purpose `furniture_thumbnail`, body `{uploadId}` | OD-c |
| `05` A1 | Thumbnail/cover body `{uploadKey}` | **Changed** → `{uploadId}` | OD-c (`13 §11` returns `uploadId`) |
| `08` 8 | Route `admin.orders.quotes.rebuild` (POST `…/rebuild`) | **Rejected** → `11`'s `admin.orders.quotes.regenerate` (POST `…/regenerate`); behaviour of `08 §6` (keeps custom/discount lines) | Route names follow `10`/`11` (D30) |
| `11` B5 | Heartbeat `Cache::put('scheduler:heartbeat', ISO string)` | **Rejected** → `health:scheduler:heartbeat` = unix timestamp, healthy < 3 min | Owner decision OD-e; `17 /up/deep` already reads it (D36) |
| `11` B7 | Fallback route `admin.orders.items.cut-list` | **Rejected** | `08 §8` defines revision-level cut-list routes |
| `12` C | `resend/resend-php ^0.x latest` | **Changed** → "latest stable at install time, pinned in `composer.lock`" | An open version range is not reproducible |
| `17` 11 | Vision `GET /health`, env `REQUEST_TIMEOUT_SECONDS`, `MAX_CONCURRENT_JOBS`, `LOG_LEVEL`; `OPENAI_COMPAT_SUPPORTS_JSON_SCHEMA=true`, `OPENAI_COMPAT_MAX_IMAGE_PX=1536` | **Rejected** → `/healthz` (`06 §5.7`), variables and defaults of `18 §4` (`VISION_RECOGNIZE_DEADLINE_S`, `VISION_LOG_LEVEL`, JSON schema `false`, max image 1280) | `06`/`18` own the service contract (D27) |
| `17` 12 | `trustProxies(at: '*')`; nginx owning `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy`, `Permissions-Policy`, HSTS | **Rejected** → `13 §12.8` CIDR list (`TRUSTED_PROXIES`), `13 §12.1` header ownership | `13` has precedence over `17` (D28) |
| `17` §6.1 | `SESSION_ENCRYPT=false`, `SESSION_COOKIE=furny_session`, global logout by renaming the cookie | **Rejected** → `13 §6.1` (`true`, `__Host-session`, `SESSION_CONNECTION=sessions`, `REDIS_SESSION_DB=2`); global logout = flush session DB | D29 |
| `17` §7.7 / `13 §18` | DB backup retention 14 days vs 30 daily; client-side `age` encryption | **Changed** → 30 days in B2; SSE-B2 default encryption, no client-side encryption | D32 |
| `18` B2 | `GrantSignupCredits` listens to `CustomerRegistered` | **Changed** → `ContactVerified`; `CustomerRegistered` kept (welcome notification) | OD-d, D21 |
| `18` C | Notification params `amount`, `filename` | **Renamed** → `credits`, `fileName` | `12 §3.5` parameter dictionary is normative |
| owner baseline | `add_header X-Frame-Options "SAMEORIGIN"` in nginx | **Not used** | `13 §12.1`: Laravel sends `DENY` on PHP responses; nginx adds only `nosniff` + HSTS on static files |
| `17` §5.2 (old) | `"..."` provider defaults + `NIXPACKS_NODE_VERSION`, `npm ci`, `nginx.template.conf`, `PHPRC`-only php.ini numbers (512M / 50M / 60 s) | **Replaced** by the owner baseline (explicit `nixPkgs`, yarn, `[staticAssets]` nginx.conf, `[variables]` 200M/210M/512M/600 s) | OD-coord, D34 |

---

## 5. Inconsistencies fixed (file: old → new)

| File | Old | New |
|---|---|---|
| `01 §1.2` | heading "Frontend (npm)", `npm run build:engine-cli` | yarn 4 via corepack (`packageManager`, `.yarnrc.yml nodeLinker: node-modules`), `yarn build:engine-cli` |
| `01 §3` | `nginx.template.conf`; routes list without `webhooks.php`; no config files | owner-baseline `nixpacks.toml` (`[staticAssets]` nginx), `docker/` file list, `routes/webhooks.php`, `config/{security,imports,notification_events,plan_starters,engine,features}.php`, `resources/js/lang/generated`, `public/fonts` |
| `01 §4` | Imports actions `RunBlueprintRecognition (job)` etc.; no Shared domain | full `06 §4.1` action list; `Shared` domain (`UploadIntent`, contracts); Identity events/actions |
| `01 §5.2` | engine tree (`bom/bom.ts computeBom(model, catalog)`, `nesting/guillotine.ts nestSheets`, no drawing/summary/roomNames) | tree matching `04 §0.1`, `07 §0.1`, `08 §0` |
| `01 §5.4` | `['node', …]`; `validate-plan` without summary; `compute-bom {nesting}` only | `config('engine.node_binary')`; `validate-plan` returns `summary`; `compute-bom` options per `08 §9.2`; `cutlist-csv`, `template-default` |
| `01 §6` | snake_case `auth.user` fields; `i18n` "loaded namespaces hash" | camelCase field list; `i18n {locale, hash}`; `staffCounters`, `healthBanners`, `features.captcha` |
| `01 §6`, master §6.7 | `features` keys camelCase (01 draft) vs master flag names (15 §8) | master flag names (snake_case) as the one deliberate exception to camelCase |
| `01 §7` | scheduler table without times for several tasks; missing tasks from `12`/`13`/`17` | one complete table with times and owners; queue connections |
| `01 §8` | `orders.{orderId}` carried internal events; `imports.{importId}` "importing user + staff" | customer-safe `orders.{id}`, new `orders.{id}.internal`; policy-based authorisation per `13 §8.10` |
| `01 §9` | "max sizes enforced by the presign policy" | upload intents with signed `Content-Type`/`Content-Length`; vision presigns separate |
| master §6.6 | translations via "`laravel-vue-i18n`-style loader" | ICU + `intl-messageformat` + `trans_icu()` + `i18n:export`; wire format; yarn |
| master §6.7 | flags without env names; no `captcha` | env-name column; `features.captcha` |
| master glossary | Catalog = "`catalog_*` tables" | actual table names; new term "Upload intent" |
| master header | precedence ended at `09` | `… > 09 > 13 > others`, `10`/`11` preferred for UI names; `19` informational |
| `02 §1.1` | no `terms_accepted_at`, `onboarded_at`, `anonymised_at` | added |
| `02 §4.1` | status enum incl. `awaiting_upload` (default) | without `awaiting_upload`, default `uploaded`; `review_version`; extended hints |
| `02 §10` | media table without purpose column; no `BlueprintImport.pages`, `FurnitureRevision.cutlist_pdf`, `BusinessProfile.logo` | column "Filled from upload purpose" + missing collections |
| `02 §14` | Roles seeder unspecified count; non-idempotent wording | 24 permissions per `13 §7`; all seeders idempotent |
| `03 §5` | server lock check for staff via design-edit permission; no 423 for plans; client-error route unnamed | `orders.propose_changes`; 423 `plan_locked`; `api.client-errors.store` |
| `04 §6.6` | "`rescalePlan` (`06`'s `plan.rescale`)" | "used by `06 §11.3` Check a dimension" |
| `04 §10` | `npm run test -- engine` | `yarn test engine` |
| `05 §1.4` | endpoints "proposed in Appendix A1", bodies `{uploadKey}` | names + contracts inline; `{uploadId}` via upload intents; lock semantics |
| `05 §4.3`, `§4.6` | canvas "paper", identical colours in both themes; room fills as hex | colours from `15 §3` tokens (theme-aware), exports `EXPORT_PALETTE`; room fills via `15 §3.4` (hex informative) — D26 |
| `05` | references "Appendix A2/A3/A6/A8/A9", "`04` appendix" | references to `02`/`10`/`13`/`15` |
| `06 §1.1`, `§3`, `§4.1`, `§4.3`, `§4.4`, `§4.10` | import-specific presign/confirm, `awaiting_upload`, `ConfirmImportUpload`, `presign_ttl_minutes`, cleanup rule for `awaiting_upload` | upload intents (OD-c); `vision_presign_ttl_minutes`; cleanup rule 4 = vision exchange objects |
| `06 §4.3` | middleware "`auth` + `verified-any`"; policy with `imports.view_all`/`imports.manage` | API group of `13 §1`; policy summary = `13 §8.4` |
| `06 §4.1`, `§4.7`, `§4.8`, `§15` | event `ImportReady`, key `import.ready`, "Appendix" | `ImportReadyForReview`, `import.ready_for_review`, `12 §3.3` |
| `06 §5.2` | container limit 4 GB | 3.5 GB (`17 §4.2`) |
| `06 §11.3`, `§12.2` | commands `plan.rescale`, `plan.background.calibrate` | `rescalePlan`, `calibrateBackground` (`04 §6.6`) |
| `06 §14.1` | `upload_missing`; `file_too_large`/`dwg_not_supported` raised by "presign/confirm" | removed; raised by upload intents (as rejection reason) / vision |
| `07 §8.1`, `§8.2`, `§11.1`, `§11.2` | `orders.edit_designs`; multipart thumbnail; `furniture.export_cutlist` | `orders.propose_changes`; upload intent `furniture_thumbnail`/`preset_thumbnail`; `orders.view` |
| `08 §2`, `§6`, `§7`, `§8` | "Appendix" refs; "Rebuild lines from designs"; `furniture.export_cutlist` | `02`/`01` refs; `admin.orders.quotes.regenerate` ("Regenerate from designs"); `orders.view`; `catalog.seed_reviewed` semantics |
| `09` | transitions did not set `state_changed_at`; event list mixed | every transition sets `state_changed_at`; order events only, pointer to `12 §3.3`; T26 stores `reason` |
| `10 §2.2` | Fortify POST names `login`, `register`, `two-factor.login`, `password.confirm` | `login.store`, `register.store`, `two-factor.login.store`, `password.confirm.store` |
| `10 §7.3` (ImportStatus) | `'awaiting_upload'` | removed |
| `10 §8.3` | "If `05` defines a starter registry, `05` wins" | `10` normative, full registry shape |
| `10 §9.1` | dropzone against `api.imports.store` → presigned PUT → `api.imports.confirm`; cancel = `api.imports.cancel` | upload intent then `api.imports.store {uploadId}`; cancel aborts the PUT (no import yet) |
| `11 §1`, `§2` | `orders.edit_designs` in list and on 4 routes | removed / `orders.propose_changes` |
| `11 §2` | `admin.revisions.recompute-bom`, `api.revisions.bom-status` | `admin.furniture-revisions.recompute-bom`, `api.furniture-revisions.bom-status` (prefix matches path) |
| `11 §5.9`, `§12`, `§15`, `§17` | "Appendix B1/B6/B10/F/A.1/A.3/A5" refs; scheduler healthy "< 2 min" | refs to `02`; heartbeat key + "< 3 min" (= `/up/deep`) |
| `11 §6.4` | `readOnly = !can('plans.edit_any')` | `readOnlyReason` `no_permission` / `plan_locked` / `archived`; `canLock` |
| `12 §1` | `App\Support\I18n\Icu::trans()` | `trans_icu()` (`15 §15.3`) |
| `12 §3.3–§3.7`, `§5.1` | AI events of `18` and `system.test_push` missing; "proposed addition/refinement" wording; "schema in appendix" | events, payloads, params, strings, categories, icons added; references to `02`/`01`/`09` |
| `12 §7.9`, `§8.2` | one route name for GET+POST (`webhooks.whatsapp`, `notifications.unsubscribe`) | `webhooks.whatsapp.verify` (GET) / `webhooks.whatsapp` (POST); `notifications.unsubscribe` (GET) / `notifications.unsubscribe.store` (POST) |
| `13 §1` | 403 page `Errors/Forbidden` | page `Error` with `status: 403` (`10 §4.10`) |
| `13 §7` | 25 permissions incl. `orders.edit_designs` | 24; mapping note (D17/D18) |
| `13 §8.2` | no lock abilities | `lock`/`unlock` + 423 rule |
| `13 §8.4` | import policy with ad-hoc staff rules | mapped abilities (`plans.edit_any`, `ai.manage`, `customers.view`) |
| `13 §11.1` | stale table header; `design_thumbnail`; blueprint uploads outside the enum | exhaustive 14-purpose table; `furniture_thumbnail`; vision presign paragraph |
| `13 §11.3` | consumer errors unspecified | 422 `upload_invalid` |
| `13 §9.1`, `10 §2.1`, `12 §8.2` | unnamed public "deletion scheduled" page; `Auth/Unsubscribe` page not in the page index | `account.deletion-scheduled` GET `/account-deleted` (`Auth/AccountDeletionScheduled`); both pages listed in `10 §2.1` |
| `13 §5.10` | `Admin/Account/Security.vue` as 2FA page | `Admin/Account/TwoFactor.vue` |
| `13 §12.2` | `appearance` cookie missing | listed (unencrypted, functional) |
| `13 §18` | "decrypting a backup" | SSE-B2, no client-side encryption; restore drill wording |
| `15 §2` | fonts note without jsPDF fonts | Noto Sans TTF for jsPDF only |
| `15 §4` | `npx shadcn-vue@latest add` | `yarn dlx shadcn-vue@latest add` |
| `15 §9.7` | `parseLength(text, { defaultUnit })` | `parseLength(text, { unit })` (`04 §1`) |
| `15 §9.10` | "imports use `06`'s endpoints"; `design_thumbnail`; 13 purposes | every upload incl. `blueprint_source`; 14 purposes generated from the PHP enum |
| `15 §9.3` | `IMPORT_STATUS_TONE.awaiting_upload` | removed |
| `15 §15.2` | namespace `editor`; missing `engine`, `roles`, `ai`, `issues`, `calls`, `delivery`, `estimates` | `plan_editor` + the missing namespaces; `auth` messages note |
| `17 §1 O3/O4/O14`, `§3`, `§5.2–§5.8` | old Nixpacks plan, npm, `nginx.template.conf`, `/etc/nginx.conf`, php.ini 512M/50M/55M/60 s, fpm 120 s | owner baseline (D34) |
| `17 §4.1`, `§7.10`, `§8`, `§16.2`, `§5.11` | vision health `/health` | `/healthz` (Gotenberg keeps its own `/health`) |
| `17 §4.1`, `§7.9` | Gotenberg plain Docker image | Dockerfile resource with `--chromium-disable-javascript=true --chromium-allow-list=^file:///tmp/.*` (`13 §12.9`) |
| `17 §5.11` item 1 | `trustProxies(at: '*')` | `13 §12.8` |
| `17 §6.1`, `§6.3` | session vars per old values; `NIXPACKS_NODE_VERSION`; no `TRUSTED_PROXIES`, `CSP_REPORT_ONLY`, `REDIS_SESSION_DB`; local `VISION_SERVICE_TOKEN` < 32 chars | `13` values; removed; added; 37-char local token (`18 §4` requires ≥ 32) |
| `17 §6.2` | vision variables `LOG_LEVEL`, `MAX_CONCURRENT_JOBS`, `REQUEST_TIMEOUT_SECONDS` | `18 §4` variables |
| `17 §7.4`, `§7.7`, `§12.1`, `§12.4`, `§16.9` | no SSE on B2; 14-day retention; session DB 0; cookie rename for logout | SSE-B2; 30 days; sessions in DB 2; flush DB 2 |
| `17 §10.2` | `npm ci`, `npx …`, `cache: npm` | `corepack enable`, `yarn install --immutable`, `yarn …`, `cache: yarn` |
| `12 §8.2`, `17 §1 O12`, `§6.1` | mail transport `ses` with `AWS_*`/`SES_REGION` (collides with the R2 `AWS_*` keys); `RESEND_KEY`, `SESSION_HTTP_ONLY`, `SESSION_EXPIRE_ON_CLOSE` missing from `17 §6.1` | `ses` dropped (`postmark`\|`resend`\|`smtp`\|`log`); variables added to `17 §6.1` |
| `18 §0–§16` | `ai.usage.view`, `ai.credits.manage`, `settings.ai.manage`, `CustomerRegistered`, presign 20/h, `settings.ai_updated`, params `amount/filename` | `ai.manage`, gate `settings.manage_restricted`, `ContactVerified`, `uploads-presign`, `ai.settings_updated`, `credits/fileName`; `SENTRY_DSN` in §4 |

---

## 6. Inputs for documents not written in this pass

**For `14-routes-and-api.md`:** §8.5 is the complete deduplicated route registry (name, method, path, owning section). Controllers, FormRequests, Inertia props and JSON shapes are specified in the owning sections. Conventions for 14: one name per method+path; multi-method endpoints get distinct names (`.show`/`.store`/`.update`/`.destroy`, `webhooks.whatsapp.verify`); Fortify keeps its own route names (versions of `laravel/fortify ^1.37`).

**For `16-testing-quality.md`** (from `17` appendix item 15; not merged because `16` is written separately): CI job names `php`, `frontend`, `vision`, `browser` are required status checks (`17 §10.2`); browser tests live in `tests/Browser` (`vendor/bin/pest tests/Browser`); unit/feature `vendor/bin/pest tests/Unit tests/Feature --parallel`; vision tests receive the engine CLI path via env `ENGINE_CLI`; frontend checks `yarn eslint`, `yarn prettier --check`, `yarn vue-tsc --noEmit`, `yarn vitest run`; `php artisan i18n:export` and `php artisan typescript:transform` must leave no diff.

---

## 7. Unresolved items (for owner review; documents contain a decided default)

1. **Fortify route names** (§8.5) are those registered by `laravel/fortify ^1.37`; if the installed version names them differently, Fortify's names win and `10 §2.2` must be aligned (no custom renaming).
2. **`corepack enable` inside Nixpacks**: taken verbatim from the owner's proven file; if a future Nix Node package ships without corepack, install yarn with `npm i -g corepack` in the install phase (record in `17` Appendix B).
3. **php.ini `${ENV}` substitution** of the owner's `[variables]` (`17 §5.5`) depends on PHP's ini env expansion through `PHPRC`; `docker/check-runtime.sh` verifies `memory_limit` at build and start, and `17` Appendix B has the fallback.
4. **`CSP_REPORT_ONLY`** is `true` in the production bulk-paste block for the first 7 days (13 §12.1 rollout) — the owner must flip it to `false` after the report-only week.
5. `14` and `16` must be written from §6/§8 before implementation starts.

---
## 8. Canonical registries

Compiled from the normative documents named in each subsection. Agents implement from those documents; these lists are for cross-checking and for writing `14`/`16`.

### 8.1 Permissions and owner gates (normative: `13 §7`)

O = owner, A = admin, E = estimator, P = production, S = support.

| Permission | O | A | E | P | S |
|---|:-:|:-:|:-:|:-:|:-:|
| `orders.view` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `orders.review` | ✓ | ✓ | ✓ | | |
| `orders.assign` | ✓ | ✓ | ✓ | | |
| `orders.propose_changes` | ✓ | ✓ | ✓ | | |
| `quotes.create` | ✓ | ✓ | ✓ | | |
| `quotes.send` | ✓ | ✓ | ✓ | | |
| `quotes.view_costs` | ✓ | ✓ | ✓ | | |
| `orders.confirm` | ✓ | ✓ | ✓ | | ✓ |
| `orders.cancel` | ✓ | ✓ | ✓ | | |
| `orders.hold` | ✓ | ✓ | ✓ | ✓ | |
| `orders.close` | ✓ | ✓ | | | |
| `production.manage` | ✓ | ✓ | | ✓ | |
| `messages.post` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `customers.view` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `customers.manage` | ✓ | ✓ | | | |
| `catalog.manage` | ✓ | ✓ | | | |
| `presets.manage` | ✓ | ✓ | ✓ | | |
| `templates.manage` | ✓ | ✓ | | | |
| `settings.manage` | ✓ | ✓ | | | |
| `staff.manage` | ✓ | ✓ | | | |
| `ai.manage` | ✓ | ✓ | | | |
| `reports.view` | ✓ | ✓ | | | |
| `plans.edit_any` | ✓ | ✓ | ✓ | | |
| `audit.view` | ✓ | ✓ | | | |

24 permissions. Owner-only gates (role check): `orders.cancel_late`, `staff.manage_owners`, `settings.change_currency`, `settings.manage_restricted` (settings groups `ai`, `auth`; AI provider test), `data.delete`. Dashboards Horizon/Pulse/Telescope: roles owner, admin. Customers have no permissions (ownership policies).

### 8.2 Event keys (normative: order events `09 §11` + `12 §3.2`; non-order events `12 §3.3`)

**Order events (33):** `order.submitted`, `order.assigned`, `order.review_started`, `order.reopened`, `order.changes_proposed`, `order.changes_resolved`, `order.changes_withdrawn`, `order.items_changed`, `quote.sent`, `quote.negotiation_opened`, `quote.negotiation_answered`, `quote.accepted`, `quote.declined`, `quote.expiring_soon`, `quote.expired`, `order.reopened_after_call`, `order.confirmed`, `order.production_started`, `order.production_update`, `order.completed`, `order.customer_approved`, `order.issue_raised`, `order.issue_resolved`, `order.delivery_scheduled`, `order.delivered`, `order.closed`, `order.cancelled`, `order.on_hold`, `order.resumed`, `message.posted`, `call.callback_due`, `call.no_answer`, `reminder.action_required`.

**Non-order events (15):** `import.ready_for_review`, `import.failed`, `ai.credits_granted`, `ai.credits_refunded`, `ai.credits_low`, `ai.budget_threshold_reached`, `ai.provider_unavailable`, `account.welcome`, `account.deletion_scheduled`, `staff.invited`, `staff.daily_digest`, `system.test_push`, `auth.otp`, `auth.password_reset`, `auth.email_verification`.

Transactional (no preferences, no unsubscribe): `account.welcome`, `account.deletion_scheduled`, `staff.invited`, `system.test_push`, `auth.*`. Activity-log event names (e.g. `order.quote_sent`, `ai.credits_granted`, `ai.settings_updated`, `plan.locked`) are a separate namespace listed in `13 §17`.

### 8.3 Settings keys by group (normative: `02 §13`; `app_settings.key` values: `business`, `units`, `pricing`, `workflow`, `ai`, `notifications`, `auth`, `catalog.version`, `catalog.seed_reviewed`)

| Group | Fields |
|---|---|
| `business` | `name`, `legal_name`, `tax_id`, `email`, `phone_e164`, `address`, `currency`, `locale`, `timezone`, `logo_media_id`, `quote_terms`, `working_hours` |
| `units` | `default_system`, `default_length_unit`, `default_wall_height_mm`, `default_exterior_wall_thickness_mm`, `default_interior_wall_thickness_mm`, `default_door_width_mm`, `default_door_height_mm`, `default_window_width_mm`, `default_window_height_mm`, `default_window_sill_mm` |
| `pricing` | `prices_include_tax`, `default_tax_rate_id`, `margin_bps`, `overhead_bps`, `minimum_order_minor`, `rounding_minor`, `estimate_disclaimer_key`, `installation_bps`, `delivery_flat_minor`, `kerf_mm`, `sheet_trim_mm`, `nesting_allow_rotation_default`, `sheet_billing_mode`, `edge_premill_mm` |
| `workflow` | `quote_validity_days`, `auto_close_days`, `reminder_after_hours`, `production_stages`, `require_completion_photos`, `allow_customer_counter_offer`, `max_negotiation_rounds`, `min_preferred_delivery_days` |
| `ai` (gate `settings.manage_restricted`) | `provider`, `model`, `effort`, `agentic_crops`, `fallback_to_none_on_error`, `signup_credits`, `monthly_credits`, `credits_per_recognition`, `credits_per_recognition_none`, `max_recognitions_per_day`, `global_monthly_budget_usd`, `budget_exhausted_behavior`, `price_table`, `staff_unlimited` |
| `notifications` | `whatsapp_templates`, `sms_driver`, `sms_templates`, `otp_channel_order`, `staff_digest_hour`, `quiet_hours` |
| `auth` (gate `settings.manage_restricted`) | `allow_customer_registration`, `otp_allowed_country_codes`, `otp_global_hourly_cap`, `staff_session_absolute_hours` |
| `catalog.version` | integer (incremented by every catalog/pricing change) |
| `catalog.seed_reviewed` | bool |

### 8.4 Upload purposes (normative: `13 §11.1`; enum `App\Domain\Shared\Enums\UploadPurpose`, exactly 14 values)

| Purpose | Target collection | Consumed by |
|---|---|---|
| `blueprint_source` | `BlueprintImport.source` | `api.imports.store` |
| `message_attachment` | `Message.attachments` | `customer.orders.messages.store`, `admin.orders.messages.store` |
| `production_photo` | `ProductionUpdate.photos` | `admin.orders.production-updates.store`, `admin.orders.complete` |
| `issue_photo` | `OrderIssue.photos` | `customer.orders.issues.store`, `admin.orders.issues.store` |
| `delivery_photo` | `Delivery.photos` | `admin.orders.deliver` |
| `avatar` | `User.avatar` | `customer.account.avatar.update`, `admin.account.avatar.update` |
| `business_logo` | `BusinessProfile.logo` | `admin.settings.business.update` |
| `material_texture` | `Material.texture` | `admin.catalog.materials.store/update` |
| `finish_texture` | `Finish.texture` | `admin.catalog.finishes.store/update` |
| `hardware_image` | `HardwareItem.image` | `admin.catalog.hardware.store/update` |
| `plan_thumbnail` | `Plan.thumbnail` | `api.plans.thumbnail.store` |
| `project_cover` | `Project.cover` | `api.projects.cover.store` |
| `furniture_thumbnail` | `FurnitureDesign.thumbnail` | `api.furniture-designs.thumbnail.store` |
| `preset_thumbnail` | `FurniturePreset.thumbnail` | `api.presets.document.update`, `admin.furniture.save-as-preset` |

Not upload intents (server-generated or server-only presigns): quote PDFs, cut-list PDFs, import `normalized`/`debug`/`pages` media, and the vision-service file exchange (`06 §4.7`).

### 8.5 Route registry (complete, deduplicated; input for `14`)

Every route has exactly one name, method and path. Middleware groups per `13 §1` (customer, admin, API, guest, signed, webhooks stateless); permissions per the owning section.

| Name | Method | Path | Owner (normative) |
|---|---|---|---|
| `welcome` | GET | `/` | 10 §4.1 |
| `legal.terms` | GET | `/terms` | 10 §4.9 |
| `legal.privacy` | GET | `/privacy` | 10 §4.9 |
| `login` | GET | `/login` | 13 §2 (laravel/fortify) |
| `login.store` | POST | `/login` | 13 §2 (laravel/fortify) |
| `logout` | POST | `/logout` | 13 §2 (laravel/fortify) |
| `register` | GET | `/register` | 13 §2 (laravel/fortify) |
| `register.store` | POST | `/register` | 13 §2 (laravel/fortify) |
| `password.request` | GET | `/forgot-password` | 13 §2 (laravel/fortify) |
| `password.email` | POST | `/forgot-password` | 13 §2 (laravel/fortify) |
| `password.reset` | GET | `/reset-password/{token}` | 13 §2 (laravel/fortify) |
| `password.update` | POST | `/reset-password` | 13 §2 (laravel/fortify) |
| `verification.notice` | GET | `/email/verify` | 13 §2 (laravel/fortify) |
| `verification.verify` | GET | `/email/verify/{id}/{hash}` | 13 §2 (laravel/fortify) |
| `verification.send` | POST | `/email/verification-notification` | 13 §2 (laravel/fortify) |
| `password.confirm` | GET | `/user/confirm-password` | 13 §2 (laravel/fortify) |
| `password.confirm.store` | POST | `/user/confirm-password` | 13 §2 (laravel/fortify) |
| `password.confirmation` | GET | `/user/confirmed-password-status` | 13 §2 (laravel/fortify) |
| `two-factor.login` | GET | `/two-factor-challenge` | 13 §2 (laravel/fortify) |
| `two-factor.login.store` | POST | `/two-factor-challenge` | 13 §2 (laravel/fortify) |
| `user-profile-information.update` | PUT | `/user/profile-information` | 13 §2 (laravel/fortify) |
| `user-password.update` | PUT | `/user/password` | 13 §2 (laravel/fortify) |
| `two-factor.enable` | POST | `/user/two-factor-authentication` | 13 §2 (laravel/fortify) |
| `two-factor.confirm` | POST | `/user/confirmed-two-factor-authentication` | 13 §2 (laravel/fortify) |
| `two-factor.disable` | DELETE | `/user/two-factor-authentication` | 13 §2 (laravel/fortify) |
| `two-factor.qr-code` | GET | `/user/two-factor-qr-code` | 13 §2 (laravel/fortify) |
| `two-factor.secret-key` | GET | `/user/two-factor-secret-key` | 13 §2 (laravel/fortify) |
| `two-factor.recovery-codes` | GET | `/user/two-factor-recovery-codes` | 13 §2 (laravel/fortify) |
| `two-factor.regenerate-recovery-codes` | POST | `/user/two-factor-recovery-codes` | 13 §2 (laravel/fortify) |
| `auth.otp.create` | GET | `/login/phone` | 13 §4–§6, §5.9 |
| `auth.otp.send` | POST | `/auth/otp/send` | 13 §4–§6, §5.9 |
| `auth.otp.verify.show` | GET | `/auth/otp/verify` | 13 §4–§6, §5.9 |
| `auth.otp.verify` | POST | `/auth/otp/verify` | 13 §4–§6, §5.9 |
| `auth.otp.resend` | POST | `/auth/otp/resend` | 13 §4–§6, §5.9 |
| `auth.otp.status` | GET | `/auth/otp/status` | 13 §4–§6, §5.9 |
| `auth.otp.complete.show` | GET | `/auth/otp/complete` | 13 §4–§6, §5.9 |
| `auth.otp.complete` | POST | `/auth/otp/complete` | 13 §4–§6, §5.9 |
| `auth.google.redirect` | GET | `/auth/google/redirect` | 13 §4–§6, §5.9 |
| `auth.google.callback` | GET | `/auth/google/callback` | 13 §4–§6, §5.9 |
| `auth.reauthenticate` | GET | `/auth/reauthenticate` | 13 §4–§6, §5.9 |
| `auth.reauthenticate.store` | POST | `/auth/reauthenticate` | 13 §4–§6, §5.9 |
| `account.google.unlink` | DELETE | `/account/google` | 13 §4–§6, §5.9 |
| `account.phone.send` | POST | `/account/phone/otp` | 13 §4–§6, §5.9 |
| `account.phone.verify` | POST | `/account/phone/verify` | 13 §4–§6, §5.9 |
| `account.sessions.destroy` | DELETE | `/account/sessions/{sessionKey}` | 13 §4–§6, §5.9 |
| `account.sessions.destroy-others` | DELETE | `/account/sessions` | 13 §4–§6, §5.9 |
| `staff.invitations.show` | GET | `/staff/invitations/{invitation}` | 13 §4–§6, §5.9 |
| `staff.invitations.accept` | POST | `/staff/invitations/{invitation}` | 13 §4–§6, §5.9 |
| `links.order` | GET | `/o/{number}` | 12 §3.6 |
| `manifest` | GET | `/manifest.webmanifest` | 12 §8.3 |
| `notifications.unsubscribe` | GET | `/notifications/unsubscribe/{user}/{event}/{channel}` | 12 §8.2 (signed) |
| `notifications.unsubscribe.store` | POST | `/notifications/unsubscribe/{user}/{event}/{channel}` | 12 §8.2 (signed) |
| `media.show` | GET | `/media/{media:uuid}` | 13 §8.9 |
| `account.deletion-scheduled` | GET | `/account-deleted` | 13 §9.1 |
| `csp.report` | POST | `/csp-report` | 13 §12.1 |
| `health.deep` | GET | `/up/deep` | 17 §5.11 |
| `webhooks.whatsapp.verify` | GET | `/webhooks/whatsapp` | 12 §7.9, 13 §14 |
| `webhooks.whatsapp` | POST | `/webhooks/whatsapp` | 12 §7.9, 13 §14 |
| `webhooks.twilio.status` | POST | `/webhooks/twilio/status` | 12 §8.1 |
| `webhooks.msg91` | POST | `/webhooks/msg91/{token}` | 12 §8.1 |
| `customer.onboarding.show` | GET | `/onboarding` | 10 §5 |
| `customer.onboarding.store` | POST | `/onboarding` | 10 §5 |
| `customer.onboarding.skip` | POST | `/onboarding/skip` | 10 §5 |
| `customer.dashboard` | GET | `/dashboard` | 10 §6 |
| `customer.projects.index` | GET | `/projects` | 10 §7.1 |
| `customer.projects.create` | GET | `/projects/create` | 10 §7.2 |
| `customer.projects.store` | POST | `/projects` | 10 §7.2 |
| `customer.projects.show` | GET | `/projects/{project}` | 10 §7.3 |
| `customer.projects.edit` | GET | `/projects/{project}/edit` | 10 §7.4 |
| `customer.projects.update` | PUT | `/projects/{project}` | 10 §7.4 |
| `customer.projects.archive` | POST | `/projects/{project}/archive` | 10 §2.2 |
| `customer.projects.unarchive` | POST | `/projects/{project}/unarchive` | 10 §2.2 |
| `customer.projects.destroy` | DELETE | `/projects/{project}` | 10 §2.2 |
| `customer.projects.plans.store` | POST | `/projects/{project}/plans` | 10 §8 |
| `customer.plans.edit` | GET | `/plans/{plan}/edit` | 10 §8.2 |
| `customer.plans.update` | PATCH | `/plans/{plan}` | 10 §2.2 |
| `customer.plans.duplicate` | POST | `/plans/{plan}/duplicate` | 10 §2.2 |
| `customer.plans.destroy` | DELETE | `/plans/{plan}` | 10 §2.2 |
| `customer.projects.imports.create` | GET | `/projects/{project}/imports/new` | 06 §4.3, 10 §9.1 |
| `customer.imports.show` | GET | `/imports/{import}` | 06 §4.3, 10 §9.2 |
| `customer.imports.review` | GET | `/imports/{import}/review` | 06 §11, 10 §9.3 |
| `customer.furniture.index` | GET | `/furniture` | 10 §10.1 |
| `customer.projects.furniture.create` | GET | `/projects/{project}/furniture/create` | 07 §8.1, 10 §10.2 |
| `customer.projects.furniture.store` | POST | `/projects/{project}/furniture` | 07 §8.1 |
| `customer.furniture.edit` | GET | `/furniture/{design}/edit` | 07 §8.2, 10 §10.3 |
| `customer.furniture.update` | PATCH | `/furniture/{design}` | 10 §2.2 |
| `customer.furniture.destroy` | DELETE | `/furniture/{design}` | 10 §2.2 |
| `customer.orders.index` | GET | `/orders` | 10 §11.1 |
| `customer.projects.orders.create` | GET | `/projects/{project}/orders/create` | 10 §11.2 |
| `customer.projects.orders.store` | POST | `/projects/{project}/orders` | 09 T1 |
| `customer.orders.edit` | GET | `/orders/{order}/edit` | 10 §11.3 |
| `customer.orders.update` | PUT | `/orders/{order}` | 10 §11.3 |
| `customer.orders.submit` | POST | `/orders/{order}/submit` | 09 T2 |
| `customer.orders.destroy` | DELETE | `/orders/{order}` | 10 §2.2 |
| `customer.orders.show` | GET | `/orders/{order}` | 10 §11.4 |
| `customer.orders.cancel` | POST | `/orders/{order}/cancel` | 09 T3 |
| `customer.orders.withdraw` | POST | `/orders/{order}/withdraw` | 09 T29 |
| `customer.orders.reopen` | POST | `/orders/{order}/reopen` | 09 T5 |
| `customer.orders.proposals.show` | GET | `/orders/{order}/proposals/{proposal}` | 10 §11.5 |
| `customer.orders.proposals.resolve` | POST | `/orders/{order}/proposals/{proposal}/resolve` | 09 T7 |
| `customer.orders.quotes.show` | GET | `/orders/{order}/quotes/{quote}` | 10 §11.6 |
| `customer.orders.quotes.accept` | POST | `/orders/{order}/quotes/{quote}/accept` | 09 T10 |
| `customer.orders.quotes.negotiate` | POST | `/orders/{order}/quotes/{quote}/negotiate` | 09 T11 |
| `customer.orders.quotes.decline` | POST | `/orders/{order}/quotes/{quote}/decline` | 09 T14 |
| `customer.orders.quotes.pdf` | GET | `/orders/{order}/quotes/{quote}/pdf` | 10 §2.2 |
| `customer.orders.completion` | GET | `/orders/{order}/completion` | 10 §11.8 |
| `customer.orders.completion.approve` | POST | `/orders/{order}/completion/approve` | 09 T21 |
| `customer.orders.issues.store` | POST | `/orders/{order}/issues` | 09 T22 |
| `customer.orders.messages.store` | POST | `/orders/{order}/messages` | 10 §11.9 |
| `customer.orders.messages.update` | PATCH | `/orders/{order}/messages/{message}` | 10 §11.9 |
| `customer.orders.messages.read` | POST | `/orders/{order}/messages/read` | 10 §11.9 |
| `customer.notifications.index` | GET | `/notifications` | 12 §8.4, 10 §12 |
| `customer.account.profile` | GET | `/account/profile` | 10 §13.2 |
| `customer.account.avatar.update` | PUT | `/account/avatar` | 10 §13.2 |
| `customer.account.security` | GET | `/account/security` | 13, 10 §13.3 |
| `customer.account.preferences` | GET | `/account/preferences` | 10 §13.4 |
| `customer.account.preferences.update` | PUT | `/account/preferences` | 10 §13.4 |
| `customer.account.notifications` | GET | `/account/notifications` | 12 §10, 10 §13.5 |
| `customer.account.notifications.update` | PUT | `/account/notifications` | 12 §10 |
| `customer.account.notifications.reset` | DELETE | `/account/notifications` | 12 §10.2 |
| `customer.account.notifications.test-push` | POST | `/account/notifications/test-push` | 10 §13.5 (event system.test_push) |
| `customer.account.ai-credits` | GET | `/account/ai-credits` | 18 §15.1 |
| `customer.account.delete` | GET | `/account` | 13 §9.1 |
| `customer.account.destroy` | DELETE | `/account` | 13 §9.1 |
| `customer.account.export` | GET | `/account/export` | 13 §9.3 |
| `customer.help` | GET | `/help` | 10 §14 |
| `admin.dashboard` | GET | `/admin` | 11 §5.1 |
| `admin.orders.index` | GET | `/admin/orders` | 11 §5.2 |
| `admin.orders.bulk-assign` | POST | `/admin/orders/bulk-assign` | 11 §2.2 |
| `admin.orders.show` | GET | `/admin/orders/{order}` | 11 §5.3 |
| `admin.orders.assign` | POST | `/admin/orders/{order}/assign` | 11 §2.2 |
| `admin.orders.start-review` | POST | `/admin/orders/{order}/start-review` | 09 T4 |
| `admin.orders.items.show` | GET | `/admin/orders/{order}/items/{item}` | 11 §5.6 |
| `admin.orders.items.update` | PATCH | `/admin/orders/{order}/items/{item}` | 11 §2.2 |
| `admin.orders.proposals.store` | POST | `/admin/orders/{order}/proposals` | 09 §4 |
| `admin.orders.proposals.update` | PATCH | `/admin/orders/{order}/proposals/{proposal}` | 09 §4 |
| `admin.orders.proposals.destroy` | DELETE | `/admin/orders/{order}/proposals/{proposal}` | 09 §4 |
| `admin.orders.proposals.preview` | GET | `/admin/orders/{order}/proposals/{proposal}/preview` | 11 §5.11 |
| `admin.orders.proposals.items.store` | POST | `/admin/orders/{order}/proposals/{proposal}/items` | 09 §4 |
| `admin.orders.proposals.items.edit` | GET | `/admin/orders/{order}/proposals/{proposal}/items/{proposalItem}/edit` | 09 §4, 07 §8.2 |
| `admin.orders.proposals.items.destroy` | DELETE | `/admin/orders/{order}/proposals/{proposal}/items/{proposalItem}` | 09 §4 |
| `admin.orders.proposals.send` | POST | `/admin/orders/{order}/proposals/{proposal}/send` | 09 T6 |
| `admin.orders.proposals.withdraw` | POST | `/admin/orders/{order}/proposals/{proposal}/withdraw` | 09 T8 |
| `admin.orders.quotes.store` | POST | `/admin/orders/{order}/quotes` | 08 §6 |
| `admin.orders.quotes.edit` | GET | `/admin/orders/{order}/quotes/{quote}/edit` | 11 §5.9 |
| `admin.orders.quotes.update` | PUT | `/admin/orders/{order}/quotes/{quote}` | 11 §5.9 |
| `admin.orders.quotes.regenerate` | POST | `/admin/orders/{order}/quotes/{quote}/regenerate` | 08 §6, 11 §5.9 |
| `admin.orders.quotes.preview` | GET | `/admin/orders/{order}/quotes/{quote}/preview` | 11 §2.2 |
| `admin.orders.quotes.send` | POST | `/admin/orders/{order}/quotes/{quote}/send` | 09 T9/T13 |
| `admin.orders.quotes.destroy` | DELETE | `/admin/orders/{order}/quotes/{quote}` | 11 §2.2 |
| `admin.orders.quotes.pdf` | GET | `/admin/orders/{order}/quotes/{quote}/pdf` | 11 §2.2 |
| `admin.orders.negotiations.keep-price` | POST | `/admin/orders/{order}/negotiations/{negotiation}/keep-price` | 09 T12 |
| `admin.orders.calls.store` | POST | `/admin/orders/{order}/calls` | 09 §7 |
| `admin.orders.confirm` | POST | `/admin/orders/{order}/confirm` | 09 T16 |
| `admin.orders.back-to-negotiation` | POST | `/admin/orders/{order}/back-to-negotiation` | 09 T17 |
| `admin.orders.start-production` | POST | `/admin/orders/{order}/start-production` | 09 T19 |
| `admin.orders.production-updates.store` | POST | `/admin/orders/{order}/production-updates` | 09 §8 |
| `admin.orders.complete` | POST | `/admin/orders/{order}/complete` | 09 T20 |
| `admin.orders.issues.store` | POST | `/admin/orders/{order}/issues` | 09 T31 |
| `admin.orders.issues.update` | PATCH | `/admin/orders/{order}/issues/{issue}` | 09 §9 |
| `admin.orders.delivery.schedule` | PUT | `/admin/orders/{order}/delivery` | 09 §9 |
| `admin.orders.deliver` | POST | `/admin/orders/{order}/deliver` | 09 T24 |
| `admin.orders.close` | POST | `/admin/orders/{order}/close` | 09 T25 |
| `admin.orders.hold` | POST | `/admin/orders/{order}/hold` | 09 T26 |
| `admin.orders.resume` | POST | `/admin/orders/{order}/resume` | 09 T27 |
| `admin.orders.cancel` | POST | `/admin/orders/{order}/cancel` | 09 T18/T28/T30 |
| `admin.orders.messages.store` | POST | `/admin/orders/{order}/messages` | 11 §5.3 |
| `admin.orders.messages.update` | PATCH | `/admin/orders/{order}/messages/{message}` | 11 §5.3 |
| `admin.orders.messages.read` | POST | `/admin/orders/{order}/messages/read` | 11 §5.3 |
| `admin.furniture-revisions.recompute-bom` | POST | `/admin/furniture-revisions/{revision}/recompute-bom` | 08 §9.1, 11 §2.2 |
| `admin.furniture-revisions.cutlist.csv` | GET | `/admin/furniture-revisions/{revision}/cutlist.csv` | 08 §8.1 |
| `admin.furniture-revisions.cutlist.pdf.store` | POST | `/admin/furniture-revisions/{revision}/cutlist-pdf` | 08 §8.2 |
| `admin.furniture-revisions.cutlist.pdf.show` | GET | `/admin/furniture-revisions/{revision}/cutlist-pdf` | 08 §8.2 |
| `admin.customers.index` | GET | `/admin/customers` | 11 §6.1 |
| `admin.customers.store` | POST | `/admin/customers` | 11 §6.1, 13 §5.1 |
| `admin.customers.show` | GET | `/admin/customers/{user}` | 11 §6.2 |
| `admin.customers.update` | PUT | `/admin/customers/{user}` | 11 §6.2 |
| `admin.customers.notes.update` | PUT | `/admin/customers/{user}/notes` | 11 §6.2 |
| `admin.customers.deactivate` | POST | `/admin/customers/{user}/deactivate` | 11 §6.2 |
| `admin.customers.activate` | POST | `/admin/customers/{user}/activate` | 11 §6.2 |
| `admin.customers.password-link` | POST | `/admin/customers/{user}/password-link` | 11 §6.2 |
| `admin.customers.restore` | POST | `/admin/customers/{user}/restore` | 13 §9.1 |
| `admin.customers.anonymise` | POST | `/admin/customers/{user}/anonymise` | 13 §9.3 |
| `admin.customers.projects.store` | POST | `/admin/customers/{user}/projects` | 11 §6.2 |
| `admin.customers.ai-credits.grant` | POST | `/admin/customers/{user}/ai-credits/grant` | 18 §10.3 |
| `admin.customers.ai-credits.revoke` | POST | `/admin/customers/{user}/ai-credits/revoke` | 18 §10.3 |
| `admin.projects.show` | GET | `/admin/projects/{project}` | 11 §6.3 |
| `admin.plans.edit` | GET | `/admin/plans/{plan}/edit` | 11 §6.4 |
| `admin.furniture.create` | GET | `/admin/furniture/create` | 07 §8.1, 11 §6.5 |
| `admin.furniture.store` | POST | `/admin/furniture` | 07 §8.1 |
| `admin.furniture.edit` | GET | `/admin/furniture/{design}/edit` | 07 §8.2, 11 §6.5 |
| `admin.furniture.save-as-preset` | POST | `/admin/furniture/{design}/save-as-preset` | 07, 11 §9.4 |
| `admin.staff.index` | GET | `/admin/staff` | 11 §7 |
| `admin.staff.invitations.store` | POST | `/admin/staff/invitations` | 13 §5.9 |
| `admin.staff.invitations.resend` | POST | `/admin/staff/invitations/{invitation}/resend` | 13 §5.9 |
| `admin.staff.invitations.revoke` | DELETE | `/admin/staff/invitations/{invitation}` | 13 §5.9 |
| `admin.staff.update` | PUT | `/admin/staff/{user}` | 11 §7 |
| `admin.staff.deactivate` | POST | `/admin/staff/{user}/deactivate` | 11 §7 |
| `admin.staff.activate` | POST | `/admin/staff/{user}/activate` | 11 §7 |
| `admin.staff.two-factor.reset` | DELETE | `/admin/staff/{user}/two-factor` | 13 §5.10 |
| `admin.catalog.imports.show` | GET | `/admin/catalog/imports/{token}` | 11 §8.3 |
| `admin.catalog.imports.commit` | POST | `/admin/catalog/imports/{token}` | 11 §8.3 |
| `admin.presets.index` | GET | `/admin/presets` | 11 §9.1 |
| `admin.presets.create` | GET | `/admin/presets/create` | 11 §9.2 |
| `admin.presets.store` | POST | `/admin/presets` | 11 §9.2 |
| `admin.presets.reorder` | POST | `/admin/presets/reorder` | 11 §9.1 |
| `admin.presets.builder` | GET | `/admin/presets/{preset}/builder` | 11 §9.3 |
| `admin.presets.update` | PUT | `/admin/presets/{preset}` | 11 §9.1 |
| `admin.presets.duplicate` | POST | `/admin/presets/{preset}/duplicate` | 11 §9.1 |
| `admin.presets.destroy` | DELETE | `/admin/presets/{preset}` | 11 §9.1 |
| `admin.templates.index` | GET | `/admin/templates` | 11 §10 |
| `admin.templates.reorder` | POST | `/admin/templates/reorder` | 11 §10 |
| `admin.templates.update` | PUT | `/admin/templates/{templateKey}` | 11 §10 |
| `admin.settings.ai.test` | POST | `/admin/settings/ai/test` | 18 §15.2 |
| `admin.settings.notifications.test` | POST | `/admin/settings/notifications/test` | 12, 11 §12.5 |
| `admin.ai.usage` | GET | `/admin/ai/usage` | 18 §15.4 |
| `admin.ai.usage.export` | GET | `/admin/ai/usage/export` | 18 §15.4 |
| `admin.ai.ledger` | GET | `/admin/ai/ledger` | 11 §13.2 |
| `admin.imports.index` | GET | `/admin/imports` | 11 §14.1 |
| `admin.imports.show` | GET | `/admin/imports/{import}` | 11 §14.2, 06 §13 |
| `admin.imports.refund` | POST | `/admin/imports/{import}/refund` | 18 §9.5 |
| `admin.notifications-log.index` | GET | `/admin/notifications-log` | 11 §15 |
| `admin.audit.index` | GET | `/admin/audit` | 11 §16 |
| `admin.system.index` | GET | `/admin/system` | 11 §17 |
| `admin.notifications.index` | GET | `/admin/notifications` | 12 §8.4 |
| `admin.account.profile` | GET | `/admin/account/profile` | 11 §18 |
| `admin.account.avatar.update` | PUT | `/admin/account/avatar` | 11 §18 |
| `admin.account.security` | GET | `/admin/account/security` | 13, 11 §18 |
| `admin.security.two-factor` | GET | `/admin/account/two-factor` | 13 §5.10 |
| `admin.account.preferences` | GET | `/admin/account/preferences` | 11 §18 |
| `admin.account.preferences.update` | PUT | `/admin/account/preferences` | 11 §18 |
| `admin.account.notifications` | GET | `/admin/account/notifications` | 12 §10 |
| `admin.account.notifications.update` | PUT | `/admin/account/notifications` | 12 §10 |
| `admin.account.notifications.reset` | DELETE | `/admin/account/notifications` | 12 §10.2 |
| `admin.account.notifications.test-push` | POST | `/admin/account/notifications/test-push` | 11 §18 (event system.test_push) |
| `admin.catalog.materials.index` | GET | `/admin/catalog/materials` | 11 §8 |
| `admin.catalog.materials.store` | POST | `/admin/catalog/materials` | 11 §8 |
| `admin.catalog.materials.update` | PUT | `/admin/catalog/materials/{id}` | 11 §8 |
| `admin.catalog.materials.archive` | POST | `/admin/catalog/materials/{id}/archive` | 11 §8 |
| `admin.catalog.materials.restore` | POST | `/admin/catalog/materials/{id}/restore` | 11 §8 |
| `admin.catalog.materials.export` | GET | `/admin/catalog/materials/export` | 11 §8.3 |
| `admin.catalog.materials.import` | POST | `/admin/catalog/materials/import` | 11 §8.3 |
| `admin.catalog.edge-bands.index` | GET | `/admin/catalog/edge-bands` | 11 §8 |
| `admin.catalog.edge-bands.store` | POST | `/admin/catalog/edge-bands` | 11 §8 |
| `admin.catalog.edge-bands.update` | PUT | `/admin/catalog/edge-bands/{id}` | 11 §8 |
| `admin.catalog.edge-bands.archive` | POST | `/admin/catalog/edge-bands/{id}/archive` | 11 §8 |
| `admin.catalog.edge-bands.restore` | POST | `/admin/catalog/edge-bands/{id}/restore` | 11 §8 |
| `admin.catalog.edge-bands.export` | GET | `/admin/catalog/edge-bands/export` | 11 §8.3 |
| `admin.catalog.edge-bands.import` | POST | `/admin/catalog/edge-bands/import` | 11 §8.3 |
| `admin.catalog.hardware.index` | GET | `/admin/catalog/hardware` | 11 §8 |
| `admin.catalog.hardware.store` | POST | `/admin/catalog/hardware` | 11 §8 |
| `admin.catalog.hardware.update` | PUT | `/admin/catalog/hardware/{id}` | 11 §8 |
| `admin.catalog.hardware.archive` | POST | `/admin/catalog/hardware/{id}/archive` | 11 §8 |
| `admin.catalog.hardware.restore` | POST | `/admin/catalog/hardware/{id}/restore` | 11 §8 |
| `admin.catalog.hardware.export` | GET | `/admin/catalog/hardware/export` | 11 §8.3 |
| `admin.catalog.hardware.import` | POST | `/admin/catalog/hardware/import` | 11 §8.3 |
| `admin.catalog.finishes.index` | GET | `/admin/catalog/finishes` | 11 §8 |
| `admin.catalog.finishes.store` | POST | `/admin/catalog/finishes` | 11 §8 |
| `admin.catalog.finishes.update` | PUT | `/admin/catalog/finishes/{id}` | 11 §8 |
| `admin.catalog.finishes.archive` | POST | `/admin/catalog/finishes/{id}/archive` | 11 §8 |
| `admin.catalog.finishes.restore` | POST | `/admin/catalog/finishes/{id}/restore` | 11 §8 |
| `admin.catalog.finishes.export` | GET | `/admin/catalog/finishes/export` | 11 §8.3 |
| `admin.catalog.finishes.import` | POST | `/admin/catalog/finishes/import` | 11 §8.3 |
| `admin.catalog.labour-rates.index` | GET | `/admin/catalog/labour-rates` | 11 §8 |
| `admin.catalog.labour-rates.update` | PUT | `/admin/catalog/labour-rates/{id}` | 11 §8 |
| `admin.catalog.labour-rates.export` | GET | `/admin/catalog/labour-rates/export` | 11 §8.3 |
| `admin.catalog.labour-rates.import` | POST | `/admin/catalog/labour-rates/import` | 11 §8.3 |
| `admin.catalog.tax-rates.index` | GET | `/admin/catalog/tax-rates` | 11 §8 |
| `admin.catalog.tax-rates.store` | POST | `/admin/catalog/tax-rates` | 11 §8 |
| `admin.catalog.tax-rates.update` | PUT | `/admin/catalog/tax-rates/{id}` | 11 §8 |
| `admin.catalog.tax-rates.export` | GET | `/admin/catalog/tax-rates/export` | 11 §8.3 |
| `admin.catalog.tax-rates.import` | POST | `/admin/catalog/tax-rates/import` | 11 §8.3 |
| `admin.settings.business` | GET | `/admin/settings/business` | 11 §12.1 |
| `admin.settings.business.update` | PUT | `/admin/settings/business` | 11 §12.1 |
| `admin.settings.units` | GET | `/admin/settings/units` | 11 §12.2 |
| `admin.settings.units.update` | PUT | `/admin/settings/units` | 11 §12.2 |
| `admin.settings.pricing` | GET | `/admin/settings/pricing` | 11 §12.3 |
| `admin.settings.pricing.update` | PUT | `/admin/settings/pricing` | 11 §12.3 |
| `admin.settings.workflow` | GET | `/admin/settings/workflow` | 11 §12.4 |
| `admin.settings.workflow.update` | PUT | `/admin/settings/workflow` | 11 §12.4 |
| `admin.settings.notifications` | GET | `/admin/settings/notifications` | 11 §12.5, 12 |
| `admin.settings.notifications.update` | PUT | `/admin/settings/notifications` | 11 §12.5, 12 |
| `admin.settings.ai` | GET | `/admin/settings/ai` | 18 §15.2 |
| `admin.settings.ai.update` | PUT | `/admin/settings/ai` | 18 §15.2 |
| `admin.settings.auth` | GET | `/admin/settings/auth` | 11 §12.7, 13 |
| `admin.settings.auth.update` | PUT | `/admin/settings/auth` | 11 §12.7, 13 |
| `api.uploads.presign` | POST | `/api/uploads/presign` | 13 §11.2 |
| `api.uploads.confirm` | POST | `/api/uploads/{upload}/confirm` | 13 §11.3 |
| `api.uploads.show` | GET | `/api/uploads/{upload}` | 13 §11.3 |
| `api.catalog.snapshot` | GET | `/api/catalog/snapshot` | 01 §5.3, 08 §2 |
| `api.client-errors.store` | POST | `/api/client-errors` | 03 §5 |
| `api.plans.working-copy.update` | PUT | `/api/plans/{plan}/working-copy` | 03 §5 |
| `api.plans.revisions.index` | GET | `/api/plans/{plan}/revisions` | 05 §1.4 |
| `api.plans.revisions.store` | POST | `/api/plans/{plan}/revisions` | 03 §5 |
| `api.plans.revisions.show` | GET | `/api/plans/{plan}/revisions/{revision}` | 05 §1.4 |
| `api.plans.revisions.restore` | POST | `/api/plans/{plan}/revisions/{revision}/restore` | 03 §5 |
| `api.plans.duplicate-with-document` | POST | `/api/plans/{plan}/duplicate-with-document` | 05 §1.4 |
| `api.plans.thumbnail.store` | POST | `/api/plans/{plan}/thumbnail` | 05 §1.4 |
| `api.plans.lock.store` | POST | `/api/plans/{plan}/lock` | 05 §1.4, 13 §8.2 |
| `api.plans.lock.destroy` | DELETE | `/api/plans/{plan}/lock` | 05 §1.4, 13 §8.2 |
| `api.projects.cover.store` | POST | `/api/projects/{project}/cover` | 05 §1.4 |
| `api.furniture-designs.working-copy.show` | GET | `/api/furniture-designs/{design}/working-copy` | 05 §1.4 |
| `api.furniture-designs.working-copy.update` | PUT | `/api/furniture-designs/{design}/working-copy` | 03 §5, 07 §8.2 |
| `api.furniture-designs.revisions.index` | GET | `/api/furniture-designs/{design}/revisions` | 03 §5, 07 §8.3 (same contract as api.plans.revisions.index) |
| `api.furniture-designs.revisions.store` | POST | `/api/furniture-designs/{design}/revisions` | 03 §5 |
| `api.furniture-designs.revisions.restore` | POST | `/api/furniture-designs/{design}/revisions/{revision}/restore` | 03 §5 |
| `api.furniture-designs.duplicate` | POST | `/api/furniture-designs/{design}/duplicate` | 07 |
| `api.furniture-designs.thumbnail.store` | POST | `/api/furniture-designs/{design}/thumbnail` | 07 §11.1 |
| `api.furniture-revisions.show` | GET | `/api/furniture-revisions/{revision}` | 10 §2.3 |
| `api.furniture-revisions.bom-status` | GET | `/api/furniture-revisions/{revision}/bom-status` | 11 §2.3 |
| `api.change-proposal-items.draft` | PUT | `/api/change-proposal-items/{item}/draft` | 03 §5, 09 §4 |
| `api.presets.document.update` | PUT | `/api/furniture-presets/{preset}/document` | 11 §2.2 |
| `api.imports.store` | POST | `/api/projects/{project}/imports` | 06 §4.3 A1 |
| `api.imports.show` | GET | `/api/imports/{import}` | 06 A3 |
| `api.imports.update` | PATCH | `/api/imports/{import}` | 06 A4 |
| `api.imports.start` | POST | `/api/imports/{import}/start` | 06 A5 |
| `api.imports.cancel` | POST | `/api/imports/{import}/cancel` | 06 A6 |
| `api.imports.review` | GET | `/api/imports/{import}/review` | 06 A7 |
| `api.imports.review-document` | PUT | `/api/imports/{import}/review-document` | 06 A8 |
| `api.imports.accept` | POST | `/api/imports/{import}/accept` | 06 A9 |
| `api.imports.discard` | POST | `/api/imports/{import}/discard` | 06 A10 |
| `api.imports.rerun` | POST | `/api/imports/{import}/rerun` | 06 A11 |
| `api.imports.convert-to-trace` | POST | `/api/imports/{import}/convert-to-trace` | 06 A12 |
| `api.notifications.index` | GET | `/api/notifications` | 12 §8.4 |
| `api.notifications.read` | POST | `/api/notifications/{id}/read` | 12 §8.4 |
| `api.notifications.unread` | POST | `/api/notifications/{id}/unread` | 12 §8.4 |
| `api.notifications.read-all` | POST | `/api/notifications/read-all` | 12 §8.4 |
| `api.push-subscriptions.store` | POST | `/api/push-subscriptions` | 12 §8.3 |
| `api.push-subscriptions.destroy` | DELETE | `/api/push-subscriptions` | 12 §8.3 |
| `api.ai.credits` | GET | `/api/me/ai-credits` | 18 §9.6 |
| `api.staff.search` | GET | `/api/staff` | 11 §2.3 |
| `api.customers.search` | GET | `/api/customers` | 11 §2.3 |
| `api.system.storage-check` | POST | `/api/admin/system/storage-check` | 11 §17 |

External dashboards (package routes, not in this registry's naming scheme): Horizon `/horizon`, Pulse `/pulse`, Telescope `/telescope` (staging/local only); framework health route `/up` (`bootstrap/app.php` `health:`); broadcasting auth `POST /broadcasting/auth`.

### 8.6 Queues and scheduled commands (normative: `01 §7`)

| Queue | Connection (`retry_after`) | Timeout | Tries | Jobs |
|---|---|---|---|---|
| `default` | `redis` (180) | 60 s | 3 | misc, `ProcessUpload`, media conversions |
| `imports` | `redis-long` (720) | 660 s | 2 (`RunBlueprintRecognition`: `retryUntil` 25 min + `maxExceptions` 2) | `PrepareImportPreview`, `RunBlueprintRecognition` |
| `engine` | `redis` (180) | 120 s | 2 | `ComputeRevisionBom`, `NestOrderSheets` |
| `pdf` | `redis` (180) | 120 s | 3 | `RenderQuotePdf`, `RenderCutListPdf` |
| `notify` | `redis` (180) | 60 s | 5 | notifications, webhook processing, `DispatchCallbackDue` |

| Schedule (UTC unless business TZ) | Task |
|---|---|
| every minute | heartbeat closure → `health:scheduler:heartbeat`; `orders:expire-quotes` |
| every 5 min | `horizon:snapshot`; `otp:monitor` |
| hourly | `imports:cleanup-stale` |
| hourly at :05 | `notifications:staff-digest` |
| daily 02:00 | `ai:grant-monthly-credits` |
| daily 03:00 | `media:cleanup-orphans`; `otp:prune` |
| daily 03:15 | `users:anonymise-deleted` |
| daily 03:30 | `notifications:prune` |
| daily 03:40 / 03:45 / 03:50 | `queue:prune-failed --hours=720` / `queue:prune-batches --hours=48` / `telescope:prune --hours=48` (Telescope only) |
| daily 04:00 | `orders:auto-close-delivered` |
| daily 09:00 business TZ | `orders:remind-pending` (incl. `quote.expiring_soon`) |
| monthly day 1 04:30 | `activitylog:clean` |

All entries `->onOneServer()->withoutOverlapping()`. Not scheduled: `pulse:check` (supervisor program), Horizon (supervisor program), `object-backup` (Coolify Scheduled Task `bash /app/docker/backup-objects.sh`, 21:15 UTC, `17 §7.11`), Postgres backups (Coolify, `17 §7.7`).

### 8.7 Environment variables

The complete list (Laravel app/Reverb: `17 §6.1`, production paste block `17 §6.3`, staging deltas `17 §6.4`; vision service: `17 §6.2` with names/defaults owned by `18 §4`; image-level variables in `nixpacks.toml` `[variables]`, `17 §5.2`) is normative in `17 §6`. Feature flags: master §6.7. Values that other documents reference by name (e.g. `TURNSTILE_*` in `13 §3`, `WHATSAPP_*`/`TWILIO_*`/`MSG91_*` in `12 §7–§8`, `VAPID_*` in `12 §8.3`, `TRUSTED_PROXIES`/`CSP_REPORT_ONLY` in `13 §12`, `SESSION_*` in `13 §6.1`, `VISION_*` in `06`/`18`, `HEALTH_CHECK_TOKEN` in `17 §5.11`, `SENTRY_*` in `17 §13.5`) appear in `17 §6` with the same names.
