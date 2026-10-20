# 11 — Admin (Staff) App

Read the master document, `01`, `02`, `03`, `09`, `10` and `15` first. This file is normative for **every staff-facing page**: route name, URL, Inertia page component, layout, props, sections, actions, validation messages, empty/loading/error states, permission-based visibility, responsive behaviour, real-time behaviour and acceptance criteria.

Owned elsewhere: transition rules and side effects → `09` (this file only says which UI calls which T#); editor internals (plan editor, furniture builder in proposal/preset mode) → `05`/`07`; BOM, cut list, nesting, pricing, quote line generation → `08`; notification catalogue and delivery → `12`; role ↔ permission matrix, 2FA, invitation security → `13`; controllers/requests → `14` (written from §2 of this file); components/tokens/layouts → `15`. Shared data objects defined in `10` §3 and §11.0 are reused here unchanged unless an `Admin…Data` variant is defined.

---

## 1. Conventions

- **Routes:** names `admin.*`, URL prefix `/admin`, middleware `web`, `auth`, `staff` (rejects `type = customer`: GET → redirect `customer.dashboard`, other → 403), `staff.active` (deactivated → logout), `two-factor.enforced` (owner/admin without confirmed 2FA are redirected to `admin.account.security` for every admin route except that page and logout — `13`). Controllers in `app/Http/Controllers/Admin/*`.
- **Authorisation:** each route lists the **permission(s)** required (any of them unless "all"). Controllers authorise via policies that check these permissions **and** state rules (`09`). The UI hides controls the user cannot use (`usePermissions().can()`), but every action is enforced server-side.
- **Permission names** (from the brief; matrix in `13`): `orders.view`, `orders.review`, `orders.assign`, `orders.propose_changes`, `quotes.create`, `quotes.send`, `orders.confirm`, `orders.cancel`, `orders.hold`, `orders.close`, `production.manage`, `messages.post`, `customers.view`, `customers.manage`, `catalog.manage`, `presets.manage`, `templates.manage`, `settings.manage`, `staff.manage`, `ai.manage`, `reports.view`, `plans.edit_any`, `audit.view`. Role-only checks: T30 requires role `owner`; assigning roles `owner`/`admin` requires role `owner`.
- **Cost visibility rule:** internal costs, margins, `cost_snapshot`, `PriceBreakdown` cost lines and `internal_notes` on quotes are visible only with `quotes.create`. Production/support staff never receive them in props (server-side omission, tested).
- **Props:** snake_case Data objects (`15` Appendix 6). Lists use `Paginated<T>` and query conventions from `15` §9.29.
- **Density:** compact (h-9 controls, `text-sm`) ≥ 768 px; comfortable below.
- **Phones (< 768 px):** supported for: dashboard, order list (list view only), order detail (read), messages & internal notes, call logging (with `tel:` links), **production update composer with photos**, completion dialog, issue resolution, delivery scheduling/recording, customers (read), notifications. **Not on phones** (render `ScreenTooSmall`): quote builder, proposal item builder, preset builder, catalog CSV import preview, settings pages with tables (production stages, price table, templates), imports debug viewer. Plan/design viewers open in view-only mode.

---

## 2. Route & page index (complete)

### 2.1 Pages (GET, Inertia)

| # | Route name | Path | Page component | Layout | Permission |
|---|---|---|---|---|---|
| 1 | `admin.dashboard` | `/admin` | `Admin/Dashboard` | AdminLayout | `orders.view` (any staff; tiles filtered) |
| 2 | `admin.orders.index` | `/admin/orders` | `Admin/Orders/Index` | AdminLayout | `orders.view` |
| 3 | `admin.orders.show` | `/admin/orders/{order}` | `Admin/Orders/Show` | AdminLayout | `orders.view` |
| 4 | `admin.orders.items.show` | `/admin/orders/{order}/items/{item}` | `Admin/Orders/ItemDesign` | AdminLayout | `orders.view` |
| 5 | `admin.orders.proposals.items.edit` | `/admin/orders/{order}/proposals/{proposal}/items/{proposalItem}/edit` | `Admin/Orders/ProposalItemBuilder` | EditorLayout | `orders.propose_changes` |
| 6 | `admin.orders.proposals.preview` | `/admin/orders/{order}/proposals/{proposal}/preview` | `Admin/Orders/ProposalPreview` | AdminLayout | `orders.propose_changes` |
| 7 | `admin.orders.quotes.edit` | `/admin/orders/{order}/quotes/{quote}/edit` | `Admin/Orders/QuoteBuilder` | AdminLayout (full-width variant) | `quotes.create` |
| 8 | `admin.customers.index` | `/admin/customers` | `Admin/Customers/Index` | AdminLayout | `customers.view` |
| 9 | `admin.customers.show` | `/admin/customers/{user}` | `Admin/Customers/Show` | AdminLayout | `customers.view` |
| 10 | `admin.projects.show` | `/admin/projects/{project}` | `Admin/Projects/Show` | AdminLayout | `customers.view` |
| 11 | `admin.plans.show` | `/admin/projects/{project}/plans/{plan}` | `Admin/Plans/Editor` | EditorLayout | `customers.view` (edit requires `plans.edit_any`) |
| 12 | `admin.designs.show` | `/admin/projects/{project}/designs/{design}` | `Admin/Designs/Viewer` | AdminLayout | `customers.view` |
| 13 | `admin.staff.index` | `/admin/staff` | `Admin/Staff/Index` | AdminLayout | `staff.manage` |
| 14 | `admin.catalog.materials.index` | `/admin/catalog/materials` | `Admin/Catalog/Materials` | AdminLayout | `catalog.manage` |
| 15 | `admin.catalog.edge-bands.index` | `/admin/catalog/edge-bands` | `Admin/Catalog/EdgeBands` | AdminLayout | `catalog.manage` |
| 16 | `admin.catalog.hardware.index` | `/admin/catalog/hardware` | `Admin/Catalog/Hardware` | AdminLayout | `catalog.manage` |
| 17 | `admin.catalog.finishes.index` | `/admin/catalog/finishes` | `Admin/Catalog/Finishes` | AdminLayout | `catalog.manage` |
| 18 | `admin.catalog.labour-rates.index` | `/admin/catalog/labour-rates` | `Admin/Catalog/LabourRates` | AdminLayout | `catalog.manage` |
| 19 | `admin.catalog.tax-rates.index` | `/admin/catalog/tax-rates` | `Admin/Catalog/TaxRates` | AdminLayout | `catalog.manage` |
| 20 | `admin.catalog.imports.show` | `/admin/catalog/imports/{token}` | `Admin/Catalog/ImportPreview` | AdminLayout | `catalog.manage` |
| 21 | `admin.presets.index` | `/admin/presets` | `Admin/Presets/Index` | AdminLayout | `presets.manage` |
| 22 | `admin.presets.create` | `/admin/presets/create` | `Admin/Presets/Create` | AdminLayout | `presets.manage` |
| 23 | `admin.presets.builder` | `/admin/presets/{preset}/builder` | `Admin/Presets/Builder` | EditorLayout | `presets.manage` |
| 24 | `admin.templates.index` | `/admin/templates` | `Admin/Templates/Index` | AdminLayout | `templates.manage` |
| 25 | `admin.settings.edit` | `/admin/settings/{group}` (`group` ∈ `business\|units\|pricing\|workflow\|ai\|notifications`) | `Admin/Settings/{Business\|Units\|Pricing\|Workflow\|Ai\|Notifications}` | AdminLayout + `SettingsNav` | `settings.manage` (group `ai`: `ai.manage`) |
| 26 | `admin.ai.usage` | `/admin/ai/usage` | `Admin/Ai/Usage` | AdminLayout | `ai.manage` or `reports.view` |
| 27 | `admin.ai.ledger` | `/admin/ai/ledger` | `Admin/Ai/Ledger` | AdminLayout | `ai.manage` |
| 28 | `admin.imports.index` | `/admin/imports` | `Admin/Imports/Index` | AdminLayout | `customers.view` |
| 29 | `admin.imports.show` | `/admin/imports/{import}` | `Admin/Imports/Show` | AdminLayout | `customers.view` |
| 30 | `admin.notifications-log.index` | `/admin/notifications-log` | `Admin/NotificationsLog/Index` | AdminLayout | `customers.view` |
| 31 | `admin.audit.index` | `/admin/audit` | `Admin/Audit/Index` | AdminLayout | `audit.view` |
| 32 | `admin.system.index` | `/admin/system` | `Admin/System/Index` | AdminLayout | `settings.manage` |
| 33 | `admin.notifications.index` | `/admin/notifications` | `Admin/Notifications/Index` | AdminLayout | any staff |
| 34 | `admin.account.profile` | `/admin/account/profile` | `Admin/Account/Profile` | AdminLayout + `AccountNav` | any staff |
| 35 | `admin.account.password` | `/admin/account/password` | `Admin/Account/Password` | same | any staff |
| 36 | `admin.account.security` | `/admin/account/security` | `Admin/Account/Security` | same | any staff |
| 37 | `admin.account.preferences` | `/admin/account/preferences` | `Admin/Account/Preferences` | same | any staff |
| 38 | `admin.account.notifications` | `/admin/account/notifications` | `Admin/Account/Notifications` | same | any staff |
| 39 | `auth.invitation.show` | `/invitation/{user}` (signed URL, 7 days) | `Auth/AcceptInvitation` | AuthLayout | guest |

External dashboards (gates in `13`): Horizon `/horizon`, Pulse `/pulse` — role `owner` or `admin`.

### 2.2 Actions

All POST/PUT/PATCH/DELETE redirect back (Inertia) with `flash.success` unless stated. State-changing actions return 409 → redirect back with `flash.error` `orders.errors.invalid_transition` "This order changed in the meantime. The page has been refreshed." when the transition is no longer allowed.

**Orders**

| Route name | Method | Path (`/admin/orders/{order}` prefix = `…`) | Body | Effect | Permission |
|---|---|---|---|---|---|
| `admin.orders.bulk-assign` | POST | `/admin/orders/bulk-assign` | `order_ids[]` (1–100), `assigned_to` (staff id \| null) | assign estimator | `orders.assign` |
| `admin.orders.assign` | POST | `…/assign` | `assigned_to?`, `production_assignee_id?` | assign | `orders.assign` (production assignee also `production.manage`) |
| `admin.orders.start-review` | POST | `…/start-review` | — | **T4** | `orders.review` |
| `admin.orders.items.update` | PATCH | `…/items/{item}` | `quantity?` (1–99), `staff_notes?` | edit item (`in_review` for quantity; staff notes any Active state) | `orders.review` |
| `admin.orders.items.cut-list` | GET | `…/items/{item}/cut-list?format=csv\|pdf` | — | CSV streamed; PDF see §5.6.4 | `orders.view` |
| `admin.orders.proposals.store` | POST | `…/proposals` | — | create proposal draft | `orders.propose_changes` |
| `admin.orders.proposals.update` | PATCH | `…/proposals/{proposal}` | `message?`, `items?: [{id, staff_note}]` | edit draft text | `orders.propose_changes` |
| `admin.orders.proposals.destroy` | DELETE | `…/proposals/{proposal}` | — | delete **draft** proposal | `orders.propose_changes` |
| `admin.orders.proposals.items.store` | POST | `…/proposals/{proposal}/items` | `order_item_id` | add item to draft (from = pinned revision) → redirect to item builder | `orders.propose_changes` |
| `admin.orders.proposals.items.destroy` | DELETE | `…/proposals/{proposal}/items/{proposalItem}` | — | remove item from draft | `orders.propose_changes` |
| `admin.orders.proposals.send` | POST | `…/proposals/{proposal}/send` | — | **T6** | `orders.propose_changes` |
| `admin.orders.proposals.withdraw` | POST | `…/proposals/{proposal}/withdraw` | — | **T8** | `orders.propose_changes` |
| `admin.orders.quotes.store` | POST | `…/quotes` | `from_quote_id?`, `negotiation_id?` | `BuildQuoteDraft` (or copy of a quote) → redirect builder | `quotes.create` |
| `admin.orders.quotes.update` | PUT | `…/quotes/{quote}` | §5.9.3 | save draft | `quotes.create` |
| `admin.orders.quotes.regenerate` | POST | `…/quotes/{quote}/regenerate` | — | rebuild lines from BOMs (`08` §6) | `quotes.create` |
| `admin.orders.quotes.preview` | GET | `…/quotes/{quote}/preview` | — | renders draft PDF synchronously (Gotenberg, 60 s timeout) inline `application/pdf` with "DRAFT" watermark | `quotes.create` |
| `admin.orders.quotes.send` | POST | `…/quotes/{quote}/send` | `valid_until`, `answer_message?` (required when order is `negotiating`) | **T9** (from `in_review`) / **T13** (from `negotiating`) | `quotes.send` |
| `admin.orders.quotes.destroy` | DELETE | `…/quotes/{quote}` | — | delete draft | `quotes.create` |
| `admin.orders.quotes.pdf` | GET | `…/quotes/{quote}/pdf` | — | 302 temporary URL | `orders.view` |
| `admin.orders.negotiations.keep-price` | POST | `…/negotiations/{negotiation}/keep-price` | `answer_message`, `valid_until?` | **T12** | `quotes.send` |
| `admin.orders.calls.store` | POST | `…/calls` | `called_at`, `phone_e164`, `outcome`, `notes?`, `callback_at?` | log call | `orders.confirm` |
| `admin.orders.confirm` | POST | `…/confirm` | `expected_delivery_on`, `production_assignee_id?`, `call?` (same fields as calls.store, outcome forced `confirmed`) | **T16** | `orders.confirm` |
| `admin.orders.back-to-negotiation` | POST | `…/back-to-negotiation` | `call_id` \| `call`, `message` (customer's requested changes, becomes negotiation message) | **T17** | `orders.confirm` |
| `admin.orders.start-production` | POST | `…/start-production` | — | **T19** | `production.manage` |
| `admin.orders.production-updates.store` | POST | `…/production-updates` | `stage`, `progress`, `title`, `body?`, `visibility`, `upload_tokens[]` | post update | `production.manage` |
| `admin.orders.complete` | POST | `…/complete` | `title`, `body?`, `upload_tokens[]` (≥ `require_completion_photos`) | **T20** | `production.manage` |
| `admin.orders.issues.store` | POST | `…/issues` | `description`, `order_item_id?`, `upload_tokens[]` | **T31** (from `delivered`) | `orders.close` |
| `admin.orders.issues.update` | PATCH | `…/issues/{issue}` | `status` (`in_progress`\|`resolved`\|`rejected`), `resolution_note?` (required for resolved/rejected) | resolve issue | `production.manage` |
| `admin.orders.delivery.schedule` | PUT | `…/delivery` | `scheduled_for`, `scheduled_until?`, `notes?` | schedule delivery | `production.manage` |
| `admin.orders.deliver` | POST | `…/deliver` | `delivered_at`, `installed`, `recipient_name?`, `notes?`, `upload_tokens[]` | **T24** | `production.manage` |
| `admin.orders.close` | POST | `…/close` | — | **T25** | `orders.close` |
| `admin.orders.hold` | POST | `…/hold` | `reason` | **T26** | `orders.hold` |
| `admin.orders.resume` | POST | `…/resume` | — | **T27** | `orders.hold` |
| `admin.orders.cancel` | POST | `…/cancel` | `reason` (enum), `note` | **T18** (from `accepted`) / **T28** / **T30** (production states; role owner) | `orders.cancel` |
| `admin.orders.messages.store` | POST | `…/messages` | `body`, `kind` (`text`\|`internal_note`), `upload_tokens[]` | post message / internal note | `messages.post` |
| `admin.orders.messages.update` | PATCH | `…/messages/{message}` | `body` | edit own within 10 min | `messages.post` |
| `admin.orders.messages.read` | POST | `…/messages/read` | `last_message_id` | mark read (204) | `orders.view` |
| `admin.revisions.recompute-bom` | POST | `/admin/furniture-revisions/{revision}/recompute-bom` | — | re-dispatch `ComputeRevisionBom` (only if `bom_status = failed`) | `quotes.create` |

**Customers, projects, designs**

| Route name | Method | Path | Body | Permission |
|---|---|---|---|---|
| `admin.customers.store` | POST | `/admin/customers` | `name`, `email?`, `phone_e164?` (≥ 1 of the two), `send_password_link` | `customers.manage` |
| `admin.customers.update` | PUT | `/admin/customers/{user}` | `name`, `email?`, `phone_e164?`, `unit_system`, `timezone` | `customers.manage` |
| `admin.customers.notes.update` | PUT | `/admin/customers/{user}/notes` | `notes_internal` (≤ 10 000) | `customers.manage` |
| `admin.customers.deactivate` | POST | `/admin/customers/{user}/deactivate` | `reason` | `customers.manage` |
| `admin.customers.activate` | POST | `/admin/customers/{user}/activate` | — | `customers.manage` |
| `admin.customers.password-link` | POST | `/admin/customers/{user}/password-link` | — | `customers.manage` |
| `admin.customers.projects.store` | POST | `/admin/customers/{user}/projects` | `name`, `property_type`, `notes?` | `customers.manage` |
| `admin.designs.save-as-preset` | POST | `/admin/designs/{design}/save-as-preset` | `name`, `category`, `description?`, `source` (`working`\|`revision`), `revision_id?` | `presets.manage` |
| `admin.ai.credits.store` | POST | `/admin/ai/credits` | `user_id`, `kind` (`admin_grant`\|`admin_revoke`), `amount` (1–1000), `note` | `ai.manage` |
| `admin.ai.usage.export` | GET | `/admin/ai/usage/export?…filters` | CSV | `ai.manage` or `reports.view` |
| `admin.imports.rerun` | POST | `/admin/imports/{import}/rerun` | `provider` (`current`\|`none`) | `ai.manage` |
| `admin.notifications-log.retry` | POST | `/admin/notifications-log/{delivery}/retry` | — | `settings.manage` |

**Staff**

| Route name | Method | Path | Body | Permission |
|---|---|---|---|---|
| `admin.staff.store` | POST | `/admin/staff` | `name`, `email`, `role` | `staff.manage` (role owner/admin: role `owner`) |
| `admin.staff.update` | PUT | `/admin/staff/{user}` | `name`, `role` | same |
| `admin.staff.deactivate` | POST | `/admin/staff/{user}/deactivate` | — | `staff.manage` |
| `admin.staff.activate` | POST | `/admin/staff/{user}/activate` | — | `staff.manage` |
| `admin.staff.resend-invitation` | POST | `/admin/staff/{user}/resend-invitation` | — | `staff.manage` |
| `admin.staff.destroy` | DELETE | `/admin/staff/{user}` | — (only never-logged-in invitees) | `staff.manage` |
| `admin.staff.reset-two-factor` | POST | `/admin/staff/{user}/reset-two-factor` | — | role `owner` |
| `auth.invitation.accept` | POST | `/invitation/{user}` (signed) | `name`, `password`, `password_confirmation` | guest |

**Catalog** — for each `{t}` ∈ `materials`, `edge-bands`, `hardware`, `finishes`, `tax-rates`, `labour-rates` (all `catalog.manage`):

| Route name | Method | Path | Notes |
|---|---|---|---|
| `admin.catalog.{t}.store` | POST | `/admin/catalog/{t}` | not for `labour-rates` |
| `admin.catalog.{t}.update` | PUT | `/admin/catalog/{t}/{id}` | |
| `admin.catalog.{t}.archive` | POST | `/admin/catalog/{t}/{id}/archive` | soft delete; only materials, edge-bands, hardware, finishes |
| `admin.catalog.{t}.restore` | POST | `/admin/catalog/{t}/{id}/restore` | same four |
| `admin.catalog.{t}.export` | GET | `/admin/catalog/{t}/export` | CSV download |
| `admin.catalog.{t}.import` | POST | `/admin/catalog/{t}/import` | multipart `file` (csv ≤ 2 MB) → redirect `admin.catalog.imports.show` |
| `admin.catalog.imports.commit` | POST | `/admin/catalog/imports/{token}` | apply previewed import |

**Presets & templates**

| Route name | Method | Path | Body | Permission |
|---|---|---|---|---|
| `admin.presets.store` | POST | `/admin/presets` | `name`, `category`, `template_key`, `description?` | `presets.manage` |
| `admin.presets.update` | PUT | `/admin/presets/{preset}` | `name`, `slug`, `category`, `description?`, `is_active` | `presets.manage` |
| `admin.presets.reorder` | POST | `/admin/presets/reorder` | `ids[]` (full ordered list of one category) | `presets.manage` |
| `admin.presets.duplicate` | POST | `/admin/presets/{preset}/duplicate` | — | `presets.manage` |
| `admin.presets.destroy` | DELETE | `/admin/presets/{preset}` | — (soft delete) | `presets.manage` |
| `api.presets.document.update` | PUT | `/api/furniture-presets/{preset}/document` | `document`, `updated_at` (lock token), `thumbnail_upload_token?` | `presets.manage` |
| `admin.templates.update` | PUT | `/admin/templates/{templateKey}` | `is_enabled`, `default_overrides` | `templates.manage` |
| `admin.templates.reorder` | POST | `/admin/templates/reorder` | `keys[]` | `templates.manage` |

**Settings & account**

| Route name | Method | Path | Body | Permission |
|---|---|---|---|---|
| `admin.settings.update` | PUT | `/admin/settings/{group}` | group fields (§12) | `settings.manage` / `ai.manage` |
| `admin.settings.notifications.test` | POST | `/admin/settings/notifications/test` | `channel` (`whatsapp`\|`sms`\|`mail`), `to` | `settings.manage` |
| `admin.account.profile.update` | PUT | `/admin/account/profile` | `name`, `email`, `phone_e164?` | any staff |
| `admin.account.avatar.update` | PUT | `/admin/account/avatar` | `upload_token` \| null | any staff |
| `admin.account.phone.send-code` | POST | `/admin/account/phone/send-code` | `phone_e164`, `channel?` | any staff |
| `admin.account.phone.verify` | POST | `/admin/account/phone/verify` | `phone_e164`, `code` | any staff |
| `admin.account.preferences.update` | PUT | `/admin/account/preferences` | `unit_system`, `length_unit`, `timezone` | any staff |
| `admin.account.notifications.update` | PUT | `/admin/account/notifications` | `changes[]` | any staff |
| `admin.account.notifications.test-push` | POST | `/admin/account/notifications/test-push` | — | any staff |
| Fortify 2FA: `two-factor.enable`, `two-factor.confirm`, `two-factor.disable`, `two-factor.qr-code`, `two-factor.recovery-codes`, `two-factor.regenerate-recovery-codes`; `user-password.update` | | Fortify defaults | | any staff |

### 2.3 JSON endpoints (staff)

| Name | Method | Path | Response | Permission |
|---|---|---|---|---|
| `api.staff.search` | GET | `/api/staff?search=&permission=` | `{ data: UserRefData[] }` (active staff, optionally holding a permission) | `orders.view` |
| `api.customers.search` | GET | `/api/customers?search=` | `{ data: { id, name, email, phone_e164 }[] }` (max 20) | `customers.view` |
| `api.revisions.cut-list-pdf` | GET | `/api/furniture-revisions/{revision}/cut-list-pdf` | `{ status: 'missing'\|'rendering'\|'ready', url?: string }` | `orders.view` |
| `api.revisions.bom-status` | GET | `/api/furniture-revisions/{revision}/bom-status` | `{ bom_status }` | `orders.view` |
| `api.change-proposal-items.draft` | PUT | `/api/change-proposal-items/{item}/draft` | `03` §5 protocol | `orders.propose_changes` |
| `api.system.checks` | POST | `/api/admin/system/storage-check` | `{ ok, duration_ms, error? }` | `settings.manage` |
| plus the shared endpoints of `10` §2.3 (`api.uploads.presign`, `api.notifications.index`, `api.push-subscriptions.*`, `api.furniture-revisions.show`, `media.show`, `notifications.read*`) | | | | |

---

## 3. Admin data objects

```ts
interface StaffRefData extends UserRefData { roles: string[] }

interface AdminCustomerCardData {
  id: Ulid; name: string; email: string | null; email_verified: boolean;
  phone_e164: string | null; phone_verified: boolean; avatar_url: string | null;
  timezone: string; is_active: boolean;
  notes_internal: string | null;            // only with customers.view
  order_count: number; active_order_count: number; created_at: IsoDateTime;
  href: string;                             // admin.customers.show
}

type AttentionReason = 'submitted_unpicked' | 'negotiation_unanswered' | 'accepted_no_call' | 'callback_due'
  | 'proposal_waiting_customer' | 'quote_waiting_customer' | 'completion_waiting_customer' | 'quote_expiring';

interface OrderBoardCardData {
  id: Ulid; number: string; title: string; state: OrderStateKey; state_before_hold: OrderStateKey | null;
  customer: { id: Ulid; name: string };
  project: { id: Ulid; name: string };
  assignee: UserRefData | null; production_assignee: UserRefData | null;
  item_count: number; quote_total_minor: number | null;
  production_progress: number;
  state_changed_at: IsoDateTime;            // orders.state_changed_at (Appendix B1)
  attention: { reason: AttentionReason; since: IsoDateTime; overdue: boolean } | null;
  unread_messages: number;                  // unread for the current staff user
  submitted_at: IsoDateTime | null; updated_at: IsoDateTime;
}

interface StaffOrderAbilities {
  start_review: boolean; assign: boolean; assign_production: boolean; edit_items: boolean; edit_staff_notes: boolean;
  create_proposal: boolean; edit_proposal: boolean; send_proposal: boolean; withdraw_proposal: boolean;
  create_quote: boolean; edit_quote: boolean; send_quote: boolean; keep_price: boolean;
  log_call: boolean; confirm: boolean; back_to_negotiation: boolean;
  cancel_after_call: boolean;               // T18 available (declined call logged, or ≥ 3 no_answer)
  start_production: boolean; post_update: boolean; complete: boolean;
  resolve_issue: boolean; raise_issue: boolean;   // T31
  schedule_delivery: boolean; deliver: boolean; close: boolean;
  hold: boolean; resume: boolean; cancel: boolean;   // T28 or T30 (server decides which)
  post_message: boolean; post_internal_note: boolean;
  view_costs: boolean; view_audit: boolean; save_as_preset: boolean;
}

interface AdminOrderData {
  id: Ulid; number: string; is_draft_number: boolean; title: string;
  state: OrderStateKey; state_before_hold: OrderStateKey | null; hold_reason: string | null;
  state_changed_at: IsoDateTime;
  project: ProjectRefData;
  customer: AdminCustomerCardData;
  assignee: UserRefData | null; production_assignee: UserRefData | null;
  site_address: AddressData | null; needs_installation: boolean;
  preferred_delivery_on: IsoDate | null; expected_delivery_on: IsoDate | null;
  customer_notes: string | null;
  production_progress: number; production_stage: string | null; production_stage_label: string | null;
  cancel_reason: string | null; cancel_note: string | null;
  milestones: OrderData['milestones'];
  last_customer_activity_at: IsoDateTime | null; last_staff_activity_at: IsoDateTime | null;
  current_quote_id: Ulid | null; accepted_quote_id: Ulid | null;
  open_proposal_id: Ulid | null; draft_proposal_id: Ulid | null; draft_quote_id: Ulid | null;
  negotiation: { rounds_used: number; rounds_max: number; open: QuoteNegotiationData | null };
  call_stats: { total: number; no_answer_count: number; confirmed_call_id: Ulid | null; declined_call_id: Ulid | null; last_call_at: IsoDateTime | null; next_callback_at: IsoDateTime | null };
  attention: OrderBoardCardData['attention'];
  can: StaffOrderAbilities;
}

interface AdminOrderItemData extends OrderItemData {
  staff_notes: string | null;
  revision_reason: string | null;           // furniture_revisions.reason of pinned revision
  engine_issue_counts: { error: number; warning: number; info: number } | null;
  server_price: { unit_price_minor: number; direct_cost_minor: number | null } | null;   // direct_cost only with view_costs
}

interface ConfirmationCallData {
  id: Ulid; staff: UserRefData; called_at: IsoDateTime; phone_e164: string;
  outcome: 'confirmed' | 'no_answer' | 'callback_requested' | 'wrong_number' | 'customer_wants_changes' | 'customer_declined';
  notes: string | null; callback_at: IsoDateTime | null; created_at: IsoDateTime;
}

interface AdminQuoteLineData extends QuoteLineData { is_visible_to_customer: boolean }
interface AdminQuoteData extends Omit<QuoteData, 'status' | 'lines'> {
  status: 'draft' | QuoteData['status'];
  lines: AdminQuoteLineData[];
  internal_notes: string | null;            // view_costs only, else null
  cost_snapshot: QuoteCostSnapshot | null;  // view_costs only
  created_by: UserRefData; catalog_version: number; engine_version: string;
  pdf_status: 'none' | 'rendering' | 'ready' | 'failed';
  updated_at: IsoDateTime;                  // optimistic lock token for drafts
}
interface QuoteCostSnapshot {                // shape defined in 08 §6; UI reads these keys
  items: { order_item_id: Ulid; direct_cost_minor: number; price_minor: number }[];
  totals: { material_minor: number; edge_band_minor: number; hardware_minor: number; finishing_minor: number; labour_minor: number; direct_cost_minor: number };
}

interface AdminChangeProposalItemData extends ChangeProposalItemData {
  has_staff_draft: boolean;                 // staff_draft_document not null
  staff_draft_version: number;
  edit_href: string;                        // admin.orders.proposals.items.edit
}
interface AdminChangeProposalData extends Omit<ChangeProposalData, 'items'> { items: AdminChangeProposalItemData[] }

interface ProductionStageData { key: string; label: string; default_progress: number }
```

---

## 4. Layout, navigation, global elements

- `AdminLayout` and sidebar items/permissions: `15` §7.2 (normative).
- **Shared prop `staffCounters`** (`{ submitted, to_call }`) feeds sidebar badges; computed lazily (Inertia optional prop on full loads, cached 30 s); refreshed by `useStaffChannel` events (`OrderSubmitted`, `OrderNeedsAttention`) via `router.reload({ only: ['staffCounters'] })` throttled 10 s.
- **Global search** in the top bar: submits to `admin.orders.index?view=list&search={q}`. Search matches order number (prefix, case-insensitive, with or without `ORD-`), customer name/email/phone (normalised E.164 digits), order title.
- **Breadcrumbs:** every page passes `breadcrumbs: { label: string; href?: string }[]` via a `#breadcrumbs` slot.
- **Notification bell:** `15` §9.17 (staff events from `12`).
- **Live indicator:** order pages show "Live updates paused" when the socket is disconnected (`15` §12).

---

## 5. Orders

### 5.1 Dashboard — `admin.dashboard` · `/admin` · `Admin/Dashboard`

Props:
```ts
interface AdminDashboardProps {
  kpis: {
    submitted_awaiting_review: number;      // state submitted
    in_review: number;                      // state in_review
    proposals_awaiting_customer: number;    // changes_proposed
    quotes_awaiting_customer: number;       // quoted
    to_call: number;                        // accepted
    in_production: number;                  // confirmed + in_production + rework
    completed_awaiting_customer: number;    // completed
    overdue: number;                        // count of attention items with overdue = true
    median_first_response_hours_30d: number | null;   // median(reviewed_at − submitted_at) of orders submitted in the last 30 days (master §2.1)
  };
  attention: Inertia.Deferred<OrderBoardCardData[]>;   // all orders with attention != null, overdue first, then since asc (max 50)
  to_call: Inertia.Deferred<OrderBoardCardData[]>;     // accepted, by accepted_at asc
  my_orders: OrderBoardCardData[];                     // Active, assigned_to = me OR production_assignee_id = me (max 10)
  charts: Inertia.Deferred<DashboardChartsData> | null;  // null when !reports.view
  ai_spend: Inertia.Deferred<{ month: string; cost_usd: number; budget_usd: number; behavior: 'fallback_none' | 'block' }> | null;   // ai.manage or reports.view
}
interface DashboardChartsData {
  orders_by_state: { state: OrderStateKey; count: number }[];          // Active states only
  monthly_quotes: { month: string /* YYYY-MM */; sent_minor: number; accepted_minor: number }[];   // last 12 months
  conversion: { month: string; quoted: number; accepted: number; rate: number | null }[];        // last 12 months
  ai_monthly: { month: string; cost_usd: number; budget_usd: number }[];                         // last 6 months
}
```
Definitions (implemented in `App\Domain\Orders\Queries\DashboardQuery`):
- **Attention reasons** (09 §13): `submitted_unpicked` (state `submitted` > 24 h), `negotiation_unanswered` (`negotiating` with open negotiation > 24 h), `accepted_no_call` (`accepted` > 24 h with no call logged), `callback_due` (latest call `callback_requested` with `callback_at` ≤ now + 1 h and no later call), `proposal_waiting_customer` / `quote_waiting_customer` (sent > `workflow.reminder_after_hours`), `completion_waiting_customer` (`completed` > 48 h), `quote_expiring` (`quoted`, `valid_until` ≤ today + 2). `overdue = true` for the first four (staff-side) when past their threshold; customer-side reasons are informational (`overdue = false`).
- **monthly_quotes.sent_minor**: for each month, sum of `total_minor` of the **latest quote version per order** with `sent_at` in that month (status ≠ draft). `accepted_minor`: sum of `total_minor` of quotes with `accepted_at` in that month.
- **conversion**: per month m: `quoted` = orders with `quoted_at` in m; `accepted` = those of them with `accepted_at` not null; `rate = accepted / quoted` (null when quoted = 0).
- Money in business currency; AI cost from `ai_usage_events.cost_micro_usd`.

Layout (desktop grid):
1. `PageHeader` "Dashboard" + `RelativeTime` "Updated …" + **Refresh** (reload all).
2. **KPI row**: 8 `KpiTile`s (4 per row ≥ 1280, 2 per row tablet/phone), each linking to filtered views: submitted → `admin.orders.index?view=list&filter[state]=submitted`; in review → `filter[state]=in_review`; proposals → `changes_proposed`; quotes → `quoted`; to call → `queue=to_call`; in production → `filter[state]=confirmed,in_production,rework`; completed → `completed`; overdue (tone `danger` when > 0) → `queue=needs_attention`. Ninth tile "First response (median, 30 d)" formatted hours ("5.2 h", "—").
3. **Needs attention** (deferred, `LoadingState table rows=5`): table rows: order number, customer, `StatusBadge`, reason label (`admin.attention.{reason}` e.g. "Not picked up for {hours} h"), since (`RelativeTime`), assignee; overdue rows tinted `bg-danger-subtle/40`. Empty: icon `check-circle` "Nothing needs attention".
4. **To call** (deferred): list with customer name, phone (`tel:` link), accepted quote total, accepted `RelativeTime`, calls so far, next callback; button **Log call** opens the call dialog (§5.7) inline. Empty: "No calls waiting".
5. **My orders**: compact board cards.
6. **Charts** (only with `reports.view`; deferred, skeleton): `HBarChart` orders by state (bars clickable → list filtered; colours by `ORDER_STATE_TONE`); `BarChart` monthly quotes (sent primary bars, accepted secondary, `formatMoney compact`); `BarChart` conversion rate (% per month, `formatPercent`); **AI spend vs budget** (`MeterBar` this month + `BarChart` last 6 months; only with `ai.manage` or `reports.view`).

Role-specific emphasis: users holding `production.manage` but not `orders.review` see **My orders** and **In production** first (section order swapped).
Real-time: `useStaffChannel` → `OrderSubmitted`/`OrderNeedsAttention` → `router.reload({ only: ['kpis', 'attention', 'to_call', 'my_orders'] })` throttled 10 s.
Phone: KPI tiles 2-up; tables become card lists; charts full width.
Acceptance: KPI counts equal the list view counts behind their links; charts render with `sr-only` tables; production staff see no money values in charts (charts hidden without `reports.view`).

### 5.2 Order board & list — `admin.orders.index` · `/admin/orders` · `Admin/Orders/Index`

Query: `view` (`board` default ≥ 768 px, `list`; phones always list), `queue` (`to_call` | `needs_attention` | `mine` | `unassigned`), `search`, `filter[state]` (comma list), `filter[assignee]` (staff id | `me` | `none`), `filter[production_assignee]`, `filter[date_field]` (`submitted_at` default | `created_at` | `updated_at` | `expected_delivery_on`), `filter[from]`, `filter[to]`, `filter[include_closed]` (`1` to include `closed`/`cancelled`/never-submitted drafts in list view; default excluded), `sort` (`-state_changed_at` default for list; allowed: `number`, `submitted_at`, `updated_at`, `state_changed_at`, `quote_total`, `expected_delivery_on`), `page`, `per_page`.
Props:
```ts
interface AdminOrdersIndexProps {
  view: 'board' | 'list';
  columns: { key: BoardColumnKey; states: OrderStateKey[]; count: number; cards: OrderBoardCardData[] }[] | null;   // board only; ≤ 50 cards per column
  orders: Paginated<OrderBoardCardData> | null;                                                                  // list only
  filters: { queue: string | null; search: string | null; state: OrderStateKey[]; assignee: string | null; production_assignee: string | null; date_field: string; from: IsoDate | null; to: IsoDate | null; include_closed: boolean; sort: string };
  staff: UserRefData[];                     // active staff with orders.review or production.manage (filter options + bulk assign)
  can: { bulk_assign: boolean };
}
type BoardColumnKey = 'new' | 'review' | 'quoting' | 'to_confirm' | 'production' | 'finishing' | 'on_hold';
```
**Board columns** (fixed order; state filter applies within):

| Column | Label | States |
|---|---|---|
| `new` | New | `submitted` |
| `review` | Review | `in_review`, `changes_proposed` |
| `quoting` | Quoting | `quoted`, `negotiating` |
| `to_confirm` | To confirm | `accepted` |
| `production` | Production | `confirmed`, `in_production`, `rework` |
| `finishing` | Completion & delivery | `completed`, `ready_for_delivery`, `delivered` |
| `on_hold` | On hold | `on_hold` (column collapsed by default; expand toggle) |

`draft`, `closed`, `cancelled` never appear on the board (list view with `include_closed`).

Board UI: horizontally scrollable columns (min-w 288 px each, tablet scroll-snap), column header with label + count + "…" link "Open in list" (list filtered by the column's states). Cards (`OrderBoardCard`): number (mono) + `StatusBadge` (staff) + attention flag (`triangle-alert` danger if overdue, `clock` warning otherwise, tooltip reason), customer name, title (1 line), item count, quote total (`MoneyDisplay`; quote totals are not cost data and are shown to all staff), assignee avatar(s), unread messages badge, "{n} d in state". Cards sorted by `state_changed_at` asc (oldest first). Card click → order detail. **No drag-and-drop** (transitions require dialogs; decided). Columns with > 50 cards show "+{n} more — open in list".

List UI: `FilterBar` (state multi-select grouped by column, assignee, production assignee, date range with date-field select, include closed switch) + queue segmented control (All / Needs attention / To call / Mine / Unassigned) + `SearchInput`. `DataTable` columns: select checkbox (if `can.bulk_assign`), Number, Customer, Title (hideBelow lg), State, Assignee, Items (hideBelow lg), Quote total, Submitted, In state since, Attention. Bulk bar (sticky bottom when selection ≥ 1): "{n} selected" + **Assign to…** (`Select` of `staff` incl. "Unassigned") → `admin.orders.bulk-assign`; only Active orders selectable (checkbox disabled otherwise). Pagination 25/page.
Empty: board with no Active orders → `EmptyState` icon `inbox` "No active orders" "New orders appear here as soon as customers submit them."; filtered list → no-results state.
Real-time: `useStaffChannel` → reload `columns`/`orders` throttled 10 s (skipped while a bulk selection exists; then a pill "New updates — refresh" appears).
Phone: list only (board toggle hidden), cards instead of table, filters in a drawer.
Acceptance: the to-call queue lists exactly `accepted` orders sorted by `accepted_at`; bulk assign updates all selected Active orders and dispatches `order.assigned` once per order.

### 5.3 Order detail — `admin.orders.show` · `/admin/orders/{order}` · `Admin/Orders/Show`

Query: `tab` ∈ `overview` (default) | `items` | `proposals` | `quotes` | `production` | `messages` | `calls` | `activity`.
Props:
```ts
interface AdminOrderShowProps {
  order: AdminOrderData;
  items: AdminOrderItemData[];
  staff_options: { estimators: UserRefData[]; production: UserRefData[] };   // holders of orders.review / production.manage
  proposals: Inertia.Deferred<AdminChangeProposalData[]>;                    // all, newest first
  quotes: Inertia.Deferred<AdminQuoteData[]>;                                // all versions incl. draft, newest first
  calls: ConfirmationCallData[];
  production_updates: Inertia.Deferred<ProductionUpdateData[]>;             // incl. internal
  issues: OrderIssueData[];
  delivery: DeliveryData | null;
  timeline: Inertia.Deferred<TimelineEntryData[]>;                           // staff variant incl. internal entries
  activity: Inertia.Deferred<AuditEntryData[]> | null;                       // only with audit.view (§16)
  messages: Inertia.ScrollProp<MessageData>;                                 // incl. internal notes
  last_read_message_id: Ulid | null;
  production_stages: ProductionStageData[];
  last_visible_progress: number;                                             // min progress for the next customer-visible update
  cancel_reasons: ('customer_withdrew' | 'quote_declined' | 'declined_on_call' | 'unresponsive' | 'staff_cancelled' | 'duplicate' | 'other')[];  // allowed for the current state/path
  settings: { require_completion_photos: number; max_negotiation_rounds: number; quote_validity_days: number; reminder_after_hours: number };
}
```

#### 5.3.1 Structure
- `PageHeader`: title "Order {number}", description = title; meta: `StatusBadge` (staff), attention flag, "In state for {duration}", customer link. Actions: primary action of the current state (from §5.3.3, max 1 primary + 2 secondary buttons) + overflow (`DropdownMenu`): Print order sheet, Hold/Resume, Cancel, Copy customer link (copies the customer URL `customer.orders.show`), View in audit log (if `audit.view`).
- `Stepper` (same component, staff audience labels) under the header; cancelled → danger Alert with reason/note; on hold → warning Alert with reason and since.
- Two-column (≥ 1280): main tabs (8/12) + **right rail** (4/12, sticky top-20): Customer card, Assignment card, Key dates card, Money card. 1024–1279: rail below the action panel. < 1024: rail cards collapse into an "Order info" accordion at the top of Overview.
- `Tabs` with counts: Overview · Items (n) · Proposals (n) · Quotes (n) · Production (n) · Messages (unread) · Calls (n) · Activity (only `audit.view`).

#### 5.3.2 Right rail
- **Customer** (`AdminCustomerCardData`): avatar, name (link `admin.customers.show`), phone `tel:` + WhatsApp link (`https://wa.me/{digits}`) + verified pill, email `mailto:` + verified pill, timezone (local time now), orders count, internal notes excerpt (expand) with **Edit** (`customers.manage`, dialog → `admin.customers.notes.update`).
- **Assignment**: Estimator `Select` (from `staff_options.estimators`, "Unassigned") → `admin.orders.assign` (`can.assign`; else read-only text); Production `Select` (`can.assign_production`).
- **Key dates**: submitted, reviewed, quoted, accepted, confirmed, production started, completed, approved, delivered, closed/cancelled (only non-null), preferred delivery, **expected delivery** (bold).
- **Money**: current quote total + status pill + valid until; accepted quote total; if `view_costs`: cost total from `cost_snapshot.totals.direct_cost_minor` and margin (`(total excl. tax − cost) / total excl. tax` as %), tone `danger` if margin < 10 %.
- **Site**: address one-line + map link (`https://www.google.com/maps/search/?api=1&query=` + encoded address), installation yes/no.

#### 5.3.3 Staff action panel (Overview tab, top) — per state
`ActionPanel` with title/body (`admin.orders.panel.{state}.*`) and buttons (each hidden when the corresponding `can.*` is false):

| State | Title / body | Primary | Secondary |
|---|---|---|---|
| `draft` (submitted before) | "Customer is editing the order" / "Reopened {since}." | — | Message customer (no transitions: T28 does not apply to `draft`) |
| `submitted` | "New order — not picked up yet" / "Submitted {ago}. Customer notes: …" | **Start review** (T4, no dialog) | Assign · Hold · Cancel |
| `in_review` | "Reviewing" / proposal draft / quote draft status lines ("Proposal draft #2 — 1 item edited", "Quote draft v3 — {total}") | **Create quote** / **Continue quote** (→ builder) | **Propose changes** / **Continue proposal** (→ Proposals tab) · Send quote (if `draft_quote_id` and no blockers; opens Send dialog) · Hold · Cancel |
| `changes_proposed` | "Waiting for the customer to review proposal #{n}" / "Sent {ago}." | — | Withdraw proposal (T8, Confirm "The customer will no longer be able to review it.") · Hold · Cancel |
| `quoted` | "Quote {number} sent — waiting for the customer" / "{total} · valid until {date} ({days} days)" | — | View quote · Hold · Cancel |
| `negotiating` | "Counter-offer received" / open negotiation: message, target total (`MoneyDisplay`) vs current total (delta), item comments, round {used}/{max} | **Revise quote** (→ `admin.orders.quotes.store` `{from_quote_id: current, negotiation_id}` → builder) | **Keep price** (T12 dialog) · Hold · Cancel |
| `accepted` | "Call the customer to confirm" / phone + accepted total + call stats ("2 calls · 1 no answer · next callback {time}") | **Log call** (dialog §5.7) | **Mark confirmed** (T16 dialog; enabled when `call_stats.confirmed_call_id` or always — the dialog can log the confirming call) · Back to negotiation (T17, only after a `customer_wants_changes` call) · Cancel (T18 when `can.cancel_after_call`, else T28) · Hold |
| `confirmed` | "Confirmed — expected delivery {date}" | **Start production** (T19, Confirm "Start production? The customer will be notified.") | Post update · Log call · Hold · Cancel |
| `in_production` | "In production — {stage} {progress}%" + latest update excerpt | **Post update** | **Mark completed** (T20) · Hold · Cancel (owner only, T30) |
| `completed` | "Waiting for the customer to check the photos" / "Completed {ago}." | — | Message customer · Hold · Cancel (owner) |
| `rework` | "Rework — {open} open issue(s)" + issue list with status selects | **Resolve issues** (→ Production tab issues) | Post update · Mark completed (enabled when no open/in-progress issues; tooltip otherwise "Resolve or reject all issues first") · Hold · Cancel (owner) |
| `ready_for_delivery` | delivery scheduled ? "Delivery scheduled {window}" : "Schedule the delivery" | **Schedule delivery** / **Record delivery** (when scheduled) | Record delivery (T24) · Reschedule · Hold · Cancel (owner) |
| `delivered` | "Delivered {date} — {installed}" ; auto-close note "Closes automatically on {date} if no issues." | **Close order** (T25; disabled with open issues) | Raise issue for customer (T31) · Hold · Cancel (owner) |
| `closed` | "Closed {date}" | — | — |
| `cancelled` | (Alert above) | — | — |
| `on_hold` | "On hold since {date}" / reason, previous state | **Resume** (T27, Confirm "Resume to {state}?") | Cancel (T28) |

#### 5.3.4 Overview tab
1. Action panel.
2. **Customer request** card: customer notes, preferred date, installation.
3. **Latest production update** (if any; internal ones marked) + `ProductionProgress`.
4. **Timeline** (`<Deferred data="timeline">`, staff audience, internal entries marked).

#### 5.3.5 Items tab
Table/cards per item: thumbnail (`Thumbnail3D` interactive), name, template, `DimensionText`, quantity (inline `number-field` when `can.edit_items` — change shows Confirm "The customer will be notified that the quantity changed." → `admin.orders.items.update`), room label, customer notes, **staff notes** (inline textarea, save on blur, `can.edit_staff_notes`), pinned revision `#n` + reason, BOM status pill (`pending` spinner / `ready` / `failed` danger with **Recompute** if `quotes.create`), engine issue counts, server unit price (+ cost if `view_costs`), **Open design** (→ `admin.orders.items.show`).

#### 5.3.6 Proposals tab
- If `can.create_proposal` and no draft: `EmptyState`-style card "Suggest design changes to the customer" + **Propose changes** (→ `admin.orders.proposals.store`, then this tab shows the draft).
- **Draft proposal card** (status draft):
  - Overall message textarea (≤ 5000; autosave on blur → `admin.orders.proposals.update`; label "Message to the customer").
  - Item list: every order item with state: "Not changed" + **Edit design** (→ `admin.orders.proposals.items.store` → builder) | "Edited" (has_staff_draft) + **Continue editing** (→ `edit_href`) + **Discard changes** (→ `admin.orders.proposals.items.destroy`, Confirm) + per-item **Note to customer** textarea (≤ 2000, autosave on blur).
  - Footer: **Preview** (→ `admin.orders.proposals.preview`, enabled when ≥ 1 item edited), **Send to customer** (T6; Confirm "Send proposal #{n} with {k} changed item(s)? The order will wait for the customer's decision." → `admin.orders.proposals.send`; 422 `proposal_empty` → `proposals.errors.empty` "None of the edited designs differ from the current version."), **Discard draft** (Confirm destructive → `admin.orders.proposals.destroy`).
  - Blockers shown inline: order not `in_review` ("Proposals can only be sent while the order is in review.").
- **Sent/resolved/withdrawn proposals**: collapsible cards with `StatusPill`, sent date, message, per item `DiffList` (major only, expand), price before/after, customer decision pill + comment, overall customer comment. Sent proposal has **Withdraw** (T8) when `can.withdraw_proposal`.
- Phone: list read-only; edit buttons hidden (builder not available on phones).

#### 5.3.7 Quotes tab
- **Draft** card (if any): version, total, last saved, **Open builder**, **Preview PDF**, **Delete draft**.
- **Create quote** / **Revise quote** button when `can.create_quote` and no draft (states `in_review`, `negotiating`).
- List of versions (newest first): `QuoteView` (staff variant: hidden lines shown with `eye-off` icon and "Hidden from customer" pill, internal notes, cost/margin block when `view_costs`), status pill, sent/accepted dates, **Download PDF** (`pdf_status`), negotiation threads under the version they refer to (customer message, target, item comments, staff answer).
- **Keep price** dialog (T12): Answer message* (≤ 2000, "Explain why the price stays the same"), optional **Extend validity to** (`DateInput`, ≥ current `valid_until`, ≤ today + 90) → `admin.orders.negotiations.keep-price`.

#### 5.3.8 Production tab
Sections:
1. **Progress** header: `ProductionProgress`, stage chip, expected delivery, production assignee. Buttons **Post update** (`can.post_update`), **Mark completed** (`can.complete`), **Start production** (`can.start_production`).
2. **Issues** (if any): cards (`OrderIssueData`) with photos, item, description, raised date; staff controls (`can.resolve_issue`): status `Select` (In progress / Resolved / Rejected) + resolution note (required for resolved/rejected: `issues.errors.note_required` "Add a note for the customer.") → `admin.orders.issues.update`. **Raise issue for customer** (T31) when `can.raise_issue`.
3. **Delivery** card: scheduled window, delivered at, installed, recipient, notes, photos; buttons **Schedule** / **Reschedule** (`can.schedule_delivery`), **Record delivery** (`can.deliver`).
4. **Updates** list (`<Deferred>`): each update with author, stage, progress, title, body, gallery, visibility pill ("Internal" warning pill for internal).

#### 5.3.9 Messages tab
`MessageThread` (staff audience) with internal toggle (`can.post_internal_note`), composer "Reply to customer" / "Internal note" (`15` §9.16), → `admin.orders.messages.store`. Closed/cancelled > 90 days: customer replies disabled (`can.post_message` false) but internal notes remain allowed.

#### 5.3.10 Calls tab
Counter chips: total, no answer, last call. Table: called at, staff, phone, outcome pill (`admin.call_outcomes.{outcome}`), notes, callback at. **Log call** button (`can.log_call`).

#### 5.3.11 Activity tab (`audit.view`)
`<Deferred data="activity">`: `AuditEntryData[]` (§16) for this order and its children (quotes, proposals, items, calls, updates, issues, delivery, messages edits), newest first, with properties diff expandable.

#### 5.3.12 Real-time
`useOrderChannel(order.id)`: `OrderStateChanged` → reload `order`, `items`, `timeline`, `quotes`, `proposals`, `calls`, `issues`, `delivery` + toast "Order updated by {actor}" when actor ≠ me; `MessagePosted` → append; `QuoteSent`/`ChangeProposalSent`/`ProductionUpdatePosted` → reload related props. Polling fallback 30 s. If a dialog is open while the state changes, the dialog shows a warning banner "This order just changed to {state}." and its submit is re-validated server-side.

#### 5.3.13 Print order sheet
`OrderPrintSheet` (print-only): `PrintHeader`, order number/title/state, customer + phone + site address, installation, expected delivery, items table (name, dims, qty, room, staff notes), accepted quote total, production assignee. Used by the workshop.

#### 5.3.14 Phone behaviour
Header compact; tabs scrollable; **sticky bottom action bar** with the state's primary action — for `confirmed`/`in_production`/`rework` it is **Post update** (opens the composer as a full-screen `Drawer`), for `accepted` **Log call**, for `ready_for_delivery` **Record delivery**. Quote/proposal builders are not reachable on phones (buttons show `ScreenTooSmall` tooltip "Open on a larger screen").

#### 5.3.15 Acceptance
- For each state the panel shows exactly the actions permitted by `09` filtered by the user's permissions (Pest browser tests with roles owner, estimator, production, support).
- Support role: sees order, messages, calls; cannot see costs/margins; no transition buttons except those its permissions allow.
- Production staff on a 390 px phone can post an update with 3 camera photos (compressed ≤ 2560 px) and see it in the timeline.

### 5.4 Transition & action dialogs (exact fields)

All dialogs: `Dialog` (desktop/tablet) or full-screen `Drawer` (phone); submit button disabled while processing; server errors inline; on success close + toast (`admin.orders.toasts.{action}`) + partial reload.

| Dialog | Fields (validation → message key "English") | Submits |
|---|---|---|
| **Assign** (rail select) | `assigned_to` active staff with `orders.review` or null | `admin.orders.assign` |
| **Hold (T26)** | `reason`* textarea ≤ 500 → `orders.errors.hold_reason_required` "Give a reason for putting the order on hold." | `admin.orders.hold` |
| **Resume (T27)** | Confirm only | `admin.orders.resume` |
| **Cancel (T18/T28/T30)** | `reason`* radio from `cancel_reasons` (labels `orders.cancel_reasons.*`: Customer withdrew, Quote declined, Declined on call, Unresponsive, Cancelled by us, Duplicate order, Other); `note`* ≤ 2000 → `orders.errors.cancel_note_required` "Add a note explaining the cancellation."; T30 additionally requires typing the order number (`ConfirmDialog.requireText`) and shows warning "This order is already in production." Copy: "The customer will be notified and the designs unlocked." | `admin.orders.cancel` |
| **Close (T25)** | Confirm "Close order {number}? The customer's designs will be unlocked." ; blocked with open issues (`orders.errors.open_issues` "Resolve all issues before closing.") | `admin.orders.close` |
| **Start review (T4)** | none | `admin.orders.start-review` |
| **Start production (T19)** | Confirm | `admin.orders.start-production` |
| **Keep price (T12)** | see §5.3.7 | `admin.orders.negotiations.keep-price` |
| **Log call** | §5.7 | `admin.orders.calls.store` / `confirm` / `back-to-negotiation` / `cancel` |
| **Mark confirmed (T16)** | §5.7.2 | `admin.orders.confirm` |
| **Post production update** | §5.8.1 | `admin.orders.production-updates.store` |
| **Mark completed (T20)** | §5.8.2 | `admin.orders.complete` |
| **Resolve issue** | status + note | `admin.orders.issues.update` |
| **Raise issue (T31)** | `description`* ≤ 2000, `order_item_id` (Select "Whole order"/item), photos (`ImageUploader` purpose `issue_photo`, ≤ 10); copy "The order will move back to rework." | `admin.orders.issues.store` |
| **Schedule delivery** | `date`* (`DateInput` ≥ today), `from`* time, `to` time (> from) → combined in business TZ to `scheduled_for`/`scheduled_until`; `notes` ≤ 2000 (shown to customer: "Shared with the customer"). Errors: `delivery.errors.window` "End time must be after start time." | `admin.orders.delivery.schedule` |
| **Record delivery (T24)** | `delivered_at`* (`DateTimeInput`, default now, ≤ now → `delivery.errors.future` "Delivery time can't be in the future."), `installed` switch (default = `needs_installation`), `recipient_name` ≤ 120, `notes` ≤ 2000, photos ≤ 20 (`delivery_photo`) | `admin.orders.deliver` |

### 5.5 Quotes — send dialog (T9/T13)
Opened from the builder or Overview. Shows: version, total, line count, validity `DateInput` (default existing `valid_until`, min tomorrow, max today + 90 → `quotes.errors.valid_until_range` "Choose a date between tomorrow and {max}."), customer contact the notification goes to (email/phone/channels), checklist of **send blockers** (from server prop `send_blockers` of the builder or computed in `can.send_quote`): `bom_pending` "Some designs are still being calculated.", `bom_failed` "A design's calculation failed — recompute it.", `no_lines` "Add at least one line.", `below_minimum` "The total is below the minimum order value of {min}.", `proposal_sent` "A change proposal is waiting for the customer.", `wrong_state` "Quotes can only be sent while the order is in review or negotiating.", `stale` "This draft was changed elsewhere — reload." When the order is `negotiating`: **Answer to the customer*** textarea (≤ 2000, `quotes.errors.answer_required` "Write a reply to the customer's counter-offer."). Button **Send quote** (`quotes.send`; hidden for users with only `quotes.create`, who see "Ask a colleague with send permission" text).

### 5.6 Item design viewer — `admin.orders.items.show` · `/admin/orders/{order}/items/{item}` · `Admin/Orders/ItemDesign`

Query: `tab` ∈ `model` (default) | `cut_list` | `edge_banding` | `hardware` | `sheets` | `costs` | `issues` | `revisions`; `revision` (view another revision of the design, default pinned).
Props:
```ts
interface ItemDesignProps {
  order: Pick<AdminOrderData, 'id' | 'number' | 'title' | 'state' | 'customer' | 'project'>;
  item: AdminOrderItemData;
  revision: {
    id: Ulid; number: number; reason: string; author: UserRefData | null; author_kind: 'customer' | 'staff'; created_at: IsoDateTime;
    document: FurnitureDocument;
    bom_status: 'pending' | 'ready' | 'failed';
    bom: Bom | null;                        // 03 §3.2 (server)
    price: PriceBreakdown | null;           // 03 §3.3 — only with view_costs, else null
    engine_version: string | null; catalog_version: number | null;
    change_summary: ChangeItem[] | null;
  };
  revisions: { id: Ulid; number: number; reason: string; author_kind: string; created_at: IsoDateTime; is_pinned: boolean }[];
  catalog_labels: { materials: Record<string, string>; edge_bands: Record<string, string>; hardware: Record<string, { name: string; category: string; unit: string }>; finishes: Record<string, string> };   // code → name (incl. archived)
  can: { view_costs: boolean; export: boolean; save_as_preset: boolean; recompute: boolean };
}
```
UI:
- `PageHeader` "{item name}" (description "Order {number} · Revision #{n} ({reason}) · Qty {quantity}"), back → order Items tab. Actions: **Export cut list** (`DropdownMenu`: CSV / PDF), **Save as preset** (`can.save_as_preset`, dialog: name*, category*, description → `admin.designs.save-as-preset` with `source=revision`), revision `Select` (switch via `?revision=`).
- BOM pending: all BOM tabs show `LoadingState` + text "Calculating materials… this usually takes a few seconds."; poll `api.revisions.bom-status` every 5 s, then `router.reload({ only: ['revision'] })`. Failed: `ErrorState` "The calculation failed." + **Recompute** (`can.recompute`).
- Tabs:
  - **Model**: read-only furniture viewer from `07` (3D + 2D elevation toggle, dimensions overlay) for `revision.document`; `KeyValueList` of dims, template, materials per role (names from `catalog_labels`), construction summary; notes.
  - **Cut list**: `DataTable` of `bom.cutList` — columns: #, Part (`t(nameKey, nameParams)`), Material (name + code mono), T (mm), Length, Width, Cut L, Cut W, Qty, Grain (icon ↕/↔/—), Edges (four mini chips L1 L2 W1 W2 showing band code or —). Footer totals: parts count, total qty. Sort by material then length desc. Lengths in **mm always** (workshop), regardless of user unit.
  - **Edge banding**: table code, name, total length (m, 2 dp), with allowance note (`08` §3.3).
  - **Hardware**: table code, name, category, qty, unit; generated vs extra; reason (`t(reasonKey)`) expandable from model hardware lines.
  - **Sheets & nesting**: per material: summary row (sheets billed, nested, utilisation %, net area m²); for each sheet an inline SVG (`NestingSheetSvg` component: sheet rect at scale fit-width, trim margin hatched, parts as rects labelled with row index and size, rotated parts marked ↻, guillotine cut lines dashed `--dimension`), `Print sheets` button (print-only layout one sheet per page). Unplaced parts → danger Alert listing them (`bom.part_exceeds_sheet`).
  - **Costs** (`can.view_costs` only; tab hidden otherwise): `PriceBreakdown.lines` table (kind, code, description, quantity, unit, unit cost, cost), totals: material, edge band, hardware, finishing, labour, **direct cost**, overhead, margin, **unit price**, installation, × quantity = total before tax; catalog version note "Computed with catalog v{n}, engine {v} on {date}". If catalog version < current: warning "Catalog has changed since this calculation. Quote drafts use these server BOMs; regenerate the quote to apply new prices." (BOMs are per revision; recompute only on failure.)
  - **Issues**: engine `bom.issues` + model issues (error/warning/info with icon and `t(messageKey, params)`), including `furniture.override_orphaned`.
  - **Revisions**: list of `revisions` with reason, author kind, date, pinned marker; click switches `?revision=`; change summary (`DiffList`) vs previous.
- Export: CSV → `admin.orders.items.cut-list?format=csv` (streamed: header row `part,material_code,material_name,thickness_mm,length_mm,width_mm,cut_length_mm,cut_width_mm,qty,grain,edge_l1,edge_l2,edge_w1,edge_w2`, filename `{order}-{item-slug}-cutlist.csv`).

#### 5.6.4 Cut list PDF
`admin.orders.items.cut-list?format=pdf`: if `exports/cut-lists/{revision_id}-c{catalog_version}.pdf` exists on the private disk → 302 temporary URL; else dispatch `RenderCutListPdf` (queue `pdf`) and redirect back with `flash.info` "Preparing the PDF…"; the page polls `api.revisions.cut-list-pdf` every 3 s (max 2 min) and opens the URL when `ready` (toast with **Download** action if the popup is blocked).
Phone: Model, Cut list (card rows), Hardware readable; sheets SVG scrollable.
Acceptance: production staff can open the cut list but never see the Costs tab or cost columns; CSV columns exactly as listed.

### 5.7 Confirmation calls (dialogs)

#### 5.7.1 Log call dialog
Header: customer name, **phone** big with `tel:` button "Call now" (and WhatsApp link), customer local time, preferred-time notes (latest customer message with `template = callback_request` if any), accepted quote total, items list (name × qty) — per 09 §7.
Fields: `called_at`* (`DateTimeInput`, default now, ≤ now + 5 min), `phone_e164`* (`PhoneInput`, default customer phone), `outcome`* (radio cards: Confirmed · No answer · Call back requested · Wrong number · Wants changes · Declined), `notes` (≤ 2000; required for `customer_wants_changes` and `customer_declined`: `calls.errors.notes_required` "Summarise what the customer said."), `callback_at` (required for `callback_requested`, > now: `calls.errors.callback_future` "Choose a future time.").
Outcome-dependent follow-ups (shown only when the order is `accepted`):
- `confirmed` → checkbox **Mark the order confirmed now** (default checked; `can.confirm`) revealing `expected_delivery_on`* and production assignee → submit goes to `admin.orders.confirm` with `call` payload (atomic T16).
- `customer_wants_changes` → checkbox **Move back to negotiation** (default checked; `can.back_to_negotiation`) → `admin.orders.back-to-negotiation` with `call` and `message` = notes (T17).
- `customer_declined` → checkbox **Cancel the order** (default checked) → `admin.orders.cancel` `{ reason: 'declined_on_call', note: notes, call }` (T18).
- `no_answer` → info "No-answer calls so far: {n}. After 3 you can cancel the order as unresponsive." The customer automatically gets the `call.no_answer` system message (09 §7).
Unchecked follow-ups → plain `admin.orders.calls.store`.

#### 5.7.2 Mark confirmed dialog (T16)
Fields: `expected_delivery_on`* (`DateInput` ≥ today; default today + accepted quote `lead_time_days` if set; `orders.errors.expected_delivery_required` "Set the expected delivery date."), `production_assignee_id` (Select). If no confirmed call exists, the dialog embeds the call fields (outcome fixed `confirmed`). Copy: "The customer will be notified that the order is confirmed." → `admin.orders.confirm`.

### 5.8 Production (composer & completion)

#### 5.8.1 Production update composer
Desktop/tablet: right `Sheet` (w-[480px]); phone: full-screen `Drawer` with large controls. Available in `confirmed`, `in_production`, `rework` (`can.post_update`).
Fields:
- **Stage*** `Select` of `production_stages` (+ for `rework`: all stages allowed, default the last used); default = the stage after the order's current `production_stage` (first stage if none).
- **Progress*** `Slider` (step 1) + numeric input; default = stage `default_progress` clamped to `[last_visible_progress, 99]`; min `last_visible_progress` when visibility is customer (0 when internal); max 99. Errors: `production.errors.progress_min` "Progress can't go below {min}%.", `production.errors.progress_max` "Use “Mark as completed” for 100%."
- **Title*** ≤ 160 (default = stage label; editing it detaches from stage changes).
- **Details** textarea ≤ 5000 (Markdown subset).
- **Photos** `ImageUploader` (purpose `production_photo`, ≤ 20, camera button prominent on phones, client compression ≤ 2560 px JPEG 0.85).
- **Visible to customer** `Switch` (default on; off → "Internal — only staff will see this update").
Submit **Post update** (disabled while uploads in progress: "Waiting for photos to upload…"). Success: close, toast "Update posted", reload `production_updates`, `order`, `timeline`.
Draft safety: unsent text is kept in `localStorage['fs:produpdate:{orderId}']` (try/catch) until success.

#### 5.8.2 Mark completed dialog (T20)
Fields: title* (default `production.completion_title` "Your furniture is ready"), message (≤ 5000), photos* (`ImageUploader`, min `require_completion_photos`, max 20 → `production.errors.completion_photos` "Add at least {min, plural, one {# photo} other {# photos}}."). Blockers (rework): open issues → disabled with list. Copy: "The customer will be asked to check the photos and approve." → `admin.orders.complete`.

### 5.9 Quote builder — `admin.orders.quotes.edit` · `/admin/orders/{order}/quotes/{quote}/edit` · `Admin/Orders/QuoteBuilder`

Only for `status = draft` (else redirect to the order Quotes tab). Desktop/tablet only (phones: `ScreenTooSmall`).
Props:
```ts
interface QuoteBuilderProps {
  order: Pick<AdminOrderData, 'id' | 'number' | 'title' | 'state' | 'customer' | 'needs_installation' | 'negotiation' | 'can'>;
  quote: AdminQuoteData;                    // draft
  items: (AdminOrderItemData & { price: PriceBreakdown | null })[];   // server BOM prices of pinned revisions (costs only with view_costs)
  previous_quote: AdminQuoteData | null;    // latest sent version, for comparison
  tax_rates: { id: Ulid; name: string; rate_bps: number; is_default: boolean }[];   // active
  settings: { prices_include_tax: boolean; minimum_order_minor: number; quote_validity_days: number; currency: string; default_terms: string };
  send_blockers: ('bom_pending' | 'bom_failed' | 'no_lines' | 'below_minimum' | 'proposal_sent' | 'wrong_state')[];
}
```
Layout: AdminLayout full-width; two columns ≥ 1280 (editor 8/12, summary 4/12 sticky); stacked on tablet.

#### 5.9.1 Lines editor (left)
- Groups: one per order item (header: thumbnail, name, qty, BOM status pill, server unit price `MoneyDisplay` and, with `view_costs`, unit direct cost) followed by **Order-level** group (lines with `order_item_id = null`).
- Line row (`QuoteLineRow`): drag handle (reorder within group; keyboard: Alt+↑/↓), Kind `Select` (`quotes.line_kinds.*`), Description* `Input` (≤ 255), Details (expand button → textarea "Details shown on the PDF", stored as `details.text`; existing structured `details` from `08` shown read-only as key/value), Quantity* (decimal input, 3 dp, > 0, ≤ 99999.999), Unit (`Input` ≤ 16, datalist: item, sheet, m, m², pcs, set, lot), Unit price* (`CurrencyInput`; negative allowed only when kind = `discount`, else ≥ 0), Tax `Select` (tax rates + "No tax"), Visible `Switch` (eye icon; hidden lines still count — tooltip "Hidden lines are included in totals but not shown to the customer"), Amount (computed, read-only, `tabular-nums`), Delete (icon). Row errors inline under the row.
- Group actions: **+ Line** (custom, defaults: kind `custom`, qty 1, unit `item`, tax default). Order-level group extra quick-adds: **+ Installation** (kind `installation`, description "Installation"), **+ Delivery** (`delivery`), **+ Discount** (`discount`, negative price, tax as default).
- Toolbar: **Regenerate from designs** (Confirm destructive "Replace all lines with freshly generated ones? Your manual edits will be lost." → `admin.orders.quotes.regenerate`), **Compare with v{n}** toggle (shows previous quote amount per matching line and total delta).

#### 5.9.2 Summary panel (right, sticky)
- Live totals computed client-side with `lib/quoteTotals.ts` (same algorithm as PHP `QuoteCalculator`, `09` §5): Subtotal, Discount, tax breakdown rows (per rate: taxable, tax), **Total** (xl), "Prices include tax" / "excl. tax" label. Minimum check: below `minimum_order_minor` → danger text.
- **Cost & margin** (`view_costs`): direct cost (sum of item direct cost × qty from `items[].price`), margin amount and % of total excl. tax, colour thresholds (< 10 % danger, < 20 % warning).
- Fields: **Valid until*** (`DateInput`, default today + `quote_validity_days`, min tomorrow, max today + 90), **Lead time (days)** (0–365), **Notes to customer** (≤ 5000), **Terms*** (textarea ≤ 20 000, default `business.quote_terms`, "Reset to default" link), **Internal notes** (≤ 5000, `view_costs` only, "Never shown to the customer").
- If revising after a negotiation: card showing the customer's counter-offer (message, target total, item comments) with "Target: {target} · Current total: {total} · Difference: {delta}".
- Buttons: **Save** (also autosave 2 s after last change; status "Saved · {time}" / "Saving…" / "Not saved"), **Preview PDF** (opens `admin.orders.quotes.preview` in a new tab after saving), **Send** (opens §5.5 dialog; disabled with tooltip listing `send_blockers`), overflow **Delete draft**.

#### 5.9.3 Save payload & validation (`admin.orders.quotes.update`, PUT)
```ts
{
  updated_at: IsoDateTime;                  // lock token → 409 'version_conflict' if the draft changed (dialog: Reload / Overwrite)
  valid_until: IsoDate; lead_time_days: number | null;
  notes_to_customer: string | null; terms: string; internal_notes: string | null;
  lines: { id?: Ulid; order_item_id: Ulid | null; kind: string; description: string; details: Record<string, unknown> | null;
           quantity: string; unit: string; unit_price_minor: number; tax_rate_id: Ulid | null;
           is_visible_to_customer: boolean; sort_order: number }[];
}
```
Server recomputes `amount_minor` and totals (`QuoteCalculator`) and returns the saved quote (Inertia partial reload `only: ['quote', 'send_blockers']`). Messages: `lines` min 1 (`quotes.errors.no_lines` "Add at least one line."), `lines.*.description` required ("Describe this line."), quantity format ("Enter a quantity greater than 0 with up to 3 decimals."), unit price sign (`quotes.errors.discount_negative` "Discount lines must have a negative price." / `quotes.errors.price_positive` "Price can't be negative."), tax rate exists & active, `order_item_id` belongs to the order, `valid_until` range, `terms` required.
Acceptance: client totals equal server totals for all fixtures in `tests/fixtures/quotes/*.json`; sending creates the PDF and moves the order to `quoted`.

### 5.10 Proposal item builder — `admin.orders.proposals.items.edit` · `Admin/Orders/ProposalItemBuilder`
EditorLayout hosting the furniture builder (`07`) in **proposal mode**. Props:
```ts
interface ProposalItemBuilderProps {
  order: Pick<AdminOrderData, 'id' | 'number' | 'customer'>;
  proposal: { id: Ulid; number: number; status: 'draft' };
  proposal_item: { id: Ulid; order_item_id: Ulid; item_name: string; from_revision_id: Ulid; staff_note: string | null };
  document: FurnitureDocument;              // staff_draft_document ?? from_revision.document
  draft_version: number;                    // staff_draft_version
  from_document: FurnitureDocument;         // for the "Compare with original" toggle
  other_items: { proposal_item_id: Ulid | null; order_item_id: Ulid; name: string; href: string }[];   // switcher
  catalog_version: number;
}
```
Chrome: `#banner` (warning tone, persistent) `admin.proposals.mode_banner` "Proposal mode — the customer will review these changes"; title "{item} — proposal #{n}"; `#topbar-end`: item switcher, **Compare with original** toggle (07 diff view), **Back to proposal** (→ order Proposals tab). Autosave via `api.change-proposal-items.draft` (`03` §5). Staff note editable in a side panel (`#inspector` extra tab "Note to customer") saving through `admin.orders.proposals.update`. If the proposal is no longer a draft (sent elsewhere) → 409 → read-only banner with link back.

### 5.11 Proposal preview — `admin.orders.proposals.preview` · `Admin/Orders/ProposalPreview`
Props: `{ order: …; proposal: ChangeProposalData /* with server-computed diff changes for each edited item */ }`. Renders the customer `ProposalReview` page body component (`components/orders/ProposalReviewBody.vue`, shared with `10` §11.5) with `preview = true` (decision controls disabled) under a sticky banner "Preview — this is what the customer will see" + **Back** + **Send to customer** (T6). Items with an empty diff are listed in a notice "These items have no changes and will be dropped: …" (09 §4 step 5).

---

## 6. Customers

### 6.1 Customers list — `admin.customers.index` · `Admin/Customers/Index`
Props: `{ customers: Paginated<AdminCustomerRowData>; filters: { search: string | null; status: 'active' | 'deactivated' | 'all'; has_active_orders: boolean | null; from: IsoDate | null; to: IsoDate | null; sort: string }; can: { create: boolean } }`.
```ts
interface AdminCustomerRowData {
  id: Ulid; name: string; email: string | null; email_verified: boolean; phone_e164: string | null; phone_verified: boolean;
  project_count: number; active_order_count: number; accepted_total_minor: number;
  ai_balance: number; last_login_at: IsoDateTime | null; created_at: IsoDateTime; is_active: boolean;
}
```
Search: name, email, phone digits. Sort: `name`, `-created_at` (default), `-last_login_at`, `-active_order_count`. Columns: Name (+ deactivated pill), Contact (email/phone with verified icons), Projects, Active orders, Accepted value (hideBelow lg), AI credits, Last login, Joined. **New customer** (`customers.manage`) → dialog: name*, email, phone (one required: `customers.errors.contact_required` "Enter an email or a phone number."), checkbox **Email a link to set a password** (only when email) → `admin.customers.store` → redirect to the customer page.
Empty: "No customers yet" icon `users`.

### 6.2 Customer detail — `admin.customers.show` · `Admin/Customers/Show`
Query `tab` ∈ `overview` | `projects` | `orders` | `credits` | `notifications` | `activity`.
Props:
```ts
interface AdminCustomerShowProps {
  customer: AdminCustomerCardData & { unit_system: string; length_unit: string; locale: string; last_login_at: IsoDateTime | null; marketing_opt_in: boolean; sign_in_methods: { password: boolean; phone: boolean; google: boolean } };
  addresses: AddressData[];
  projects: ProjectSummaryData[];
  orders: OrderBoardCardData[];             // all, newest first
  credits: AiCreditsData | null;            // ai.manage or customers.view (read)
  ledger: Inertia.Deferred<Paginated<AiLedgerEntryData>>;
  recent_deliveries: Inertia.Deferred<NotificationDeliveryData[]>;   // last 20 (§15)
  activity: Inertia.Deferred<AuditEntryData[]> | null;              // audit.view
  can: { update: boolean; notes: boolean; deactivate: boolean; activate: boolean; password_link: boolean; create_project: boolean; grant_credits: boolean };
}
```
Header: avatar, name, pills (Active/Deactivated, email/phone verified), actions: **Edit** (dialog: name, email, phone, units, timezone → `admin.customers.update`; changing email/phone clears its verification and notifies per `13`), overflow: Send password link, Deactivate (`ReasonDialog`, note required; "The customer won't be able to log in. Active orders continue.") / Activate, **New project for customer** (dialog name/property type → `admin.customers.projects.store` → `admin.projects.show`).
Tabs:
- **Overview**: contact card (tel/WhatsApp/mail links, timezone, units), addresses list, **Internal notes** (editable with `can.notes`, textarea ≤ 10 000, save button; "Only staff can see these notes."), stats (orders by state counts, accepted total).
- **Projects**: project cards → `admin.projects.show`.
- **Orders**: list rows → order detail.
- **AI credits**: balance card + **Grant / revoke credits** (`can.grant_credits`; dialog: kind radio Grant/Revoke, amount* 1–1000, note* ≤ 255 → `admin.ai.credits.store`; revoke > balance → `credits.errors.revoke_exceeds` "You can revoke at most {balance} credits.") + ledger table (deferred).
- **Notifications**: recent deliveries (channel, event, status, time) + link to the log filtered by this user.
- **Activity** (`audit.view`).
**No impersonation in v1 (decided).** Staff see customer projects read-only; with `plans.edit_any` they can edit plans (§6.4).
Phone: tabs scrollable; contact actions large.

### 6.3 Customer project (read) — `admin.projects.show` · `Admin/Projects/Show`
Props: `{ project: ProjectData & { owner: { id: Ulid; name: string } }; plans: PlanSummaryData[]; designs: FurnitureDesignSummaryData[]; orders: OrderBoardCardData[]; imports: ImportSummaryData[] }`. Same sections as the customer project page (`10` §7.3) without create/edit actions; plan cards link to `admin.plans.show` ("View plan" / "Edit plan" with `plans.edit_any`); design cards to `admin.designs.show`; imports rows to `admin.imports.show`.

### 6.4 Customer plan — `admin.plans.show` · `Admin/Plans/Editor`
Props: as `10` §8.2 `PlanEditorPageProps` plus `customer: { id, name }`; `read_only = !can('plans.edit_any')` (also read-only on phones). Banner when editing: `admin.plans.editing_banner` "You're editing {customer}'s plan. A backup revision is saved before your first change." (`03` §5 staff_edit revision). Back → `admin.projects.show`. No placement handoff for staff.

### 6.5 Customer design — `admin.designs.show` · `Admin/Designs/Viewer`
Props: `{ project: ProjectRefData; customer: { id: Ulid; name: string }; design: FurnitureDesignSummaryData; working_document: FurnitureDocument; revisions: ItemDesignProps['revisions']; catalog_labels: ItemDesignProps['catalog_labels']; can: { save_as_preset: boolean } }`. Read-only builder viewer (07 view-only) plus client-side estimate panels (cut list, hardware via the engine Web Worker; labelled "Estimate from the current working copy"). Action **Save as preset** (`source=working`). Locked designs show "In order {number}" link.

---

## 7. Staff management — `admin.staff.index` · `Admin/Staff/Index`
Props:
```ts
interface StaffIndexProps {
  staff: StaffRowData[];                    // all staff incl. deactivated, ordered by name
  roles: { name: 'owner' | 'admin' | 'estimator' | 'production' | 'support'; label: string; description: string; assignable: boolean }[];   // assignable per current user
  current_user_id: Ulid;
}
interface StaffRowData {
  id: Ulid; name: string; email: string; role: string; two_factor_enabled: boolean; two_factor_required: boolean;
  is_active: boolean; invitation_pending: boolean; invited_at: IsoDateTime | null; last_login_at: IsoDateTime | null;
  can: { edit: boolean; deactivate: boolean; activate: boolean; resend: boolean; revoke: boolean; reset_two_factor: boolean };
}
```
UI: `PageHeader` "Staff" + **Invite staff member**. Table: Name/email, Role (`Badge`), 2FA (`shield-check` success "On" / `shield-alert` danger "Off — required" when required / neutral "Off"), Status (Active / Invited · {date} / Deactivated), Last login, actions menu (Edit role, Resend invitation, Revoke invitation, Deactivate/Activate, Reset 2FA).
Invite dialog: name* (≤ 120), email* (unique among users: `staff.errors.email_taken` "A user with this email already exists."), role* (radio with descriptions; owner/admin only for owners) → `admin.staff.store` → creates staff user (`password = null`, `onboarded_at = now()`) and emails a signed invitation link (`auth.invitation.show`, valid 7 days, event in `12`).
Rules (server-enforced, with messages): cannot deactivate yourself (`staff.errors.self`), cannot deactivate/demote the last active owner (`staff.errors.last_owner` "There must be at least one active owner."), admins cannot edit owners (`staff.errors.owner_protected`). Revoke only for never-logged-in invitees (hard delete).
Empty: impossible (current user listed).

### 7.1 Accept invitation — `auth.invitation.show` · `Auth/AcceptInvitation`
Props: `{ user: { name: string; email: string; role_label: string }; app_name: string; expires_at: IsoDateTime }`. Invalid/expired signature → error page 403 with message `staff.invitation.expired` "This invitation link has expired. Ask an administrator to resend it." Form: name (prefilled), password*, confirm* → `auth.invitation.accept` → logs in → owner/admin redirected to `admin.account.security` with info "Set up two-factor authentication to continue."; others to `admin.dashboard`.

---

## 8. Catalog management

### 8.1 Common table page (`components/admin/catalog/CatalogTablePage.vue`)
Props of every catalog page:
```ts
interface CatalogPageProps<T> {
  rows: Paginated<T>;                       // per_page 50
  filters: { search: string | null; status: 'active' | 'inactive' | 'archived' | 'all'; sort: string; [k: string]: unknown };
  options: Record<string, { value: string; label: string }[]>;   // enums (board types, categories, units…)
  catalog_version: number;
}
```
UI: `PageHeader` (title, description "Changes apply to new estimates immediately and to quotes built after the change."), actions **Add** (except labour rates), **Import CSV** (file picker → `admin.catalog.{t}.import`), **Export CSV** (`admin.catalog.{t}.export`, exports all rows incl. inactive, excluding archived unless filter archived). Status segmented: Active / Hidden (is_active = false) / Archived (soft-deleted; not for labour/tax) / All. Search (code, name). `DataTable` with table-specific columns; row click opens the **edit Sheet** (right, w-[560px]; phone full-screen) with the form; the sheet footer has **Save**, and for soft-deletable tables **Archive** / **Restore**.
Concepts shown in a help popover: **Hide** (`is_active = false`): not offered for new choices in the builder, existing designs keep working. **Archive** (soft delete): removed from lists; documents referencing the code show warning `furniture.archived_code` (`03` §2.4). **There is no permanent delete** (codes are referenced by immutable revisions and quotes; decided).
`code` is **immutable after creation** (disabled in edit; tooltip "Codes are referenced by saved designs and can't be changed.").
Every successful write bumps `catalog.version` (`02` §6) and shows toast "Saved. Catalog version {n}."

### 8.2 Tables, columns and form rules
Money fields use `CurrencyInput` (minor units); percentages `PercentInput`; colours a colour input + hex text.

**Materials** (`Admin/Catalog/Materials`) — columns: swatch/texture thumb, Code (mono), Name, Board type, Thickness, Sheet (L × W), Grain, Price/sheet, Status. Filters: board type, surface.
Form (`materials`): code* (≤ 40, regex `^[A-Z0-9][A-Z0-9._-]*$`, unique incl. archived: "This code is already used."), name* ≤ 120, board_type* enum, thickness_mm* 1.0–100.0 step 0.1, sheet_length_mm* 300–6000, sheet_width_mm* 300–3000, has_grain, decor_name ≤ 120, color_hex (`^#[0-9a-fA-F]{6}$`, stored lower-case), surface* enum, price_per_sheet_minor* ≥ 0, waste_factor* 0–0.500 (3 dp; shown as %), density_kg_m3 50–3000 or empty, usage* (multi-select of MaterialRole, ≥ 1: "Choose at least one use."), default_edge_band_code (Select of active edge bands or none), is_active, sort_order (int), **texture** (`ImageUploader` single, purpose `catalog_texture`, jpg/webp ≤ 4 MB; recommended "seamless 1024 × 1024").

**Edge bands** — columns: swatch, Code, Name, Thickness × Width, Price/m, Status. Form: code*, name* ≤ 120, thickness_mm* 0.10–5.00 (2 dp), width_mm* 10–100, color_hex, price_per_meter_minor* ≥ 0, is_active.

**Hardware** — columns: image, Code, Name, Category, Unit, Price, Defaults (tags), Status. Filter: category. Form: code*, name* ≤ 160, category* enum, unit* enum, price_minor* ≥ 0, **specs** (category-specific fields rendered from `resources/js/lib/catalog/hardwareSpecFields.ts`, a TS map category → field definitions mirroring `08` §2.3; categories without a definition use a `JsonViewer` editable textarea that must parse to a JSON object: `catalog.errors.specs_json` "Specs must be a valid JSON object."), is_default_for (`tags-input`, values validated against the role-key list exported by `07` §6: `catalog.errors.default_role_unknown` "Unknown role key {key}."), image (`hardware_image`), is_active, sort_order. Server validates specs against the `08` schema.

**Finishes** — columns: swatch, Code, Name, Type, Price/m², Applies to, Status. Form: code*, name* ≤ 120, finish_type* enum, price_per_sqm_minor* ≥ 0, applies_to* (multi-select board types, ≥ 1), color_hex, texture (`catalog_texture`), is_active.

**Labour rates** — columns: Key (mono), Name, Unit, Rate, Status. No create/archive (keys fixed by `08` §4.3; missing keys are seeded). Form: key (read-only), name* ≤ 120, unit (read-only), rate_minor* ≥ 0, is_active.

**Tax rates** — columns: Name, Rate (%), Default, Status. Form: name* ≤ 60 unique, rate_bps* 0–10000 (`PercentInput`, 2 dp), is_default (switch; turning on unsets the previous default in the same transaction; the default can't be turned off directly: "Choose another default first."), is_active (the default rate can't be deactivated). No archive (rows referenced by quote lines); "Hide" only.

### 8.3 CSV import / export (exact formats)
Format: UTF-8 (BOM tolerated), comma separator, `"` quoting (RFC 4180), first row = header with **exactly** these column names (order free on import, fixed on export), max 5000 data rows, max 2 MB. Booleans accept `1/0/true/false/yes/no` (case-insensitive); export writes `1`/`0`. Money columns are **major units** with `.` decimal separator and no grouping or symbol (e.g. `3450.00`), converted with the business currency's fraction digits; export writes the same. List columns use `|` separators. Empty cell = null for nullable columns, error for required ones.

| Table | Columns (export order) | Match key |
|---|---|---|
| materials | `code,name,board_type,thickness_mm,sheet_length_mm,sheet_width_mm,has_grain,decor_name,color_hex,surface,price_per_sheet,waste_factor,density_kg_m3,usage,default_edge_band_code,is_active,sort_order` | `code` |
| edge-bands | `code,name,thickness_mm,width_mm,color_hex,price_per_meter,is_active` | `code` |
| hardware | `code,name,category,unit,price,specs_json,is_default_for,is_active,sort_order` | `code` |
| finishes | `code,name,finish_type,price_per_sqm,applies_to,color_hex,is_active` | `code` |
| labour-rates | `key,name,unit,rate,is_active` | `key` (unknown keys are errors; no creation) |
| tax-rates | `name,rate_percent,is_default,is_active` | `name` (`rate_percent` decimal, e.g. `18` or `12.5`; at most one row with `is_default = 1`) |

Import flow: upload → server parses & validates every row with the same rules as the forms (plus: a code matching an **archived** row → error "Code {code} is archived. Restore it first."), stores the parsed result in cache under a random token (30 min, scoped to the user) → **Import preview** page `admin.catalog.imports.show`:
Props: `{ table: string; token: string; filename: string; summary: { create: number; update: number; unchanged: number; errors: number }; rows: { line: number; action: 'create' | 'update' | 'unchanged' | 'error'; code: string; changes: { field: string; before: string | null; after: string | null }[]; errors: string[] }[]; expires_at: IsoDateTime }`.
UI: summary tiles, filter by action, table with per-row diffs and errors. **Apply import** (disabled when errors > 0: "Fix the errors in your file and upload it again.") → `admin.catalog.imports.commit` (single transaction; rows not in the file are untouched; images/textures are not part of CSV). Success → back to the table page with toast "{n} rows imported." Expired token → 404 page with "This preview expired. Upload the file again."

Acceptance: exporting then importing an unchanged file yields `unchanged = rows`, `errors = 0`; a price change on one material shows exactly one `update` with the price diff.

---

## 9. Presets

### 9.1 Presets list — `admin.presets.index` · `Admin/Presets/Index`
Props: `{ presets: AdminPresetData[]; categories: { key: string; label: string }[]; templates: { key: string; label: string; is_enabled: boolean }[] }`.
```ts
interface AdminPresetData {
  id: Ulid; name: string; slug: string; category: string; template_key: string; template_label: string;
  description: string | null; is_active: boolean; sort_order: number;
  thumbnail_url: string | null; width_mm: number; height_mm: number; depth_mm: number;
  template_enabled: boolean; created_by: UserRefData | null; updated_at: IsoDateTime;
}
```
UI: `PageHeader` "Presets" + **New preset**. Grouped by category (accordion sections in category order); within a group, rows sortable by drag handle and keyboard (Alt+↑/↓); order change → optimistic → `admin.presets.reorder` (ids of that category). Row: thumbnail, name, template (with "Template disabled" warning pill → preset hidden from customers), dims, active `Switch` (→ `admin.presets.update`), actions: **Edit details** (Sheet: name*, slug* (auto from name, `^[a-z0-9-]+$`, unique), category*, description ≤ 2000, active), **Open builder**, Duplicate, Delete (Confirm; soft delete; "Existing designs made from it are not affected.").
Also: "Create from a customer design" hint: "Use **Save as preset** on any design or order item."
Empty: icon `armchair` "No presets yet" + **New preset**.

### 9.2 New preset — `admin.presets.create` · `Admin/Presets/Create`
Props: `{ templates: FurnitureTemplateCardData[] /* all, incl. disabled with flag */; categories: … }`. Choose template (cards), name*, category*, description → `admin.presets.store` (document = template defaults merged with `default_overrides`) → redirect `admin.presets.builder`.

### 9.3 Preset builder — `admin.presets.builder` · `Admin/Presets/Builder`
EditorLayout hosting the builder (`07`) in **preset mode** (no order/lock logic, no autosave). Props: `{ preset: AdminPresetData; document: FurnitureDocument; updated_at: IsoDateTime; catalog_version: number }`. `#topbar-end`: **Save preset** (PUT `api.presets.document.update` with `document`, `updated_at`, and a fresh thumbnail uploaded via presign purpose `preset_thumbnail`; 409 `version_conflict` → dialog Reload / Overwrite; 422 invalid document → issues list). Unsaved changes guard on leave. Desktop/tablet only.

### 9.4 Save as preset (from designs)
Dialog (from `admin.orders.items.show` and `admin.designs.show`): name* (≤ 120), category*, description, info "A copy of this design is saved as a preset. Customer-specific notes are removed." → `admin.designs.save-as-preset` (server copies the revision or working document, clears `notes`, sets `is_active = false` by default so it can be reviewed; toast with link "Open preset").

---

## 10. Templates — `admin.templates.index` · `Admin/Templates/Index`
Props:
```ts
interface TemplatesIndexProps {
  templates: {
    key: string; label: string; description: string; family: 'carcass' | 'table'; icon: string;
    is_enabled: boolean; sort_order: number; default_overrides: Record<string, unknown>;
    code_defaults: Record<string, unknown>;   // from the 07 registry (exported to PHP via a generated JSON, 07)
    preset_count: number; design_count: number;
  }[];
}
```
UI: table sortable (drag + keyboard → `admin.templates.reorder`), columns: icon + label, key (mono), family, presets, designs, **Enabled** switch (→ `admin.templates.update`; disabling Confirm "Customers won't be able to start new designs from this template or its presets. Existing designs are not affected."), **Defaults** button → Sheet with the template parameter form from `07` (`TemplateDefaultsForm`, props `templateKey`, `modelValue: default_overrides`, `codeDefaults`) showing overridden fields highlighted, **Reset to code defaults**, **Save** → `admin.templates.update`. Server validates by generating the template default document with overrides and running engine `validate-furniture` (Appendix B8); errors → 422 `templates.errors.invalid_defaults` "These defaults produce an invalid design: {issues}".
Desktop/tablet only for the defaults sheet.

---

## 11. Staff exports & print (summary)

| Export | Where | Format | Permission |
|---|---|---|---|
| Quote PDF (sent versions) | Order → Quotes tab | PDF (`admin.orders.quotes.pdf`) | `orders.view` |
| Draft quote preview | Quote builder | PDF inline, "DRAFT" watermark (`admin.orders.quotes.preview`) | `quotes.create` |
| Cut list | Item design viewer | CSV / PDF (§5.6) | `orders.view` |
| Nesting sheets | Item design viewer → Sheets | Print (one sheet per page) | `orders.view` |
| Order sheet | Order detail overflow | Print (§5.3.13) | `orders.view` |
| Catalog tables | Catalog pages | CSV (§8.3) | `catalog.manage` |
| AI usage | AI usage page | CSV (§13.1) | `ai.manage` or `reports.view` |
| Plan exports (PNG/SVG/PDF/DXF/GLB) | Plan viewer/editor | per `05` | `customers.view` |

Print uses the rules of `15` §16 (light palette, `PrintHeader`).

---

## 12. Settings pages — `admin.settings.edit` · `/admin/settings/{group}`

Shell: `SettingsNav` (left on desktop, pills on smaller): Business · Units · Pricing · Workflow · AI · Notifications (items hidden without the group's permission). Each page: `FormSection`s, `StickyActionBar` (Discard / **Save changes**) → `admin.settings.update` (PUT, whole group). On success toast "Settings saved." Validation errors inline. Props common: `{ group: string; values: <GroupData>; updated_at: IsoDateTime | null; updated_by: UserRefData | null }` + group-specific `meta`. Field names = `02` §13 keys.

### 12.1 Business (`Admin/Settings/Business`) — `settings.manage`
Meta: `{ currency_locked: boolean /* any quote exists */; currencies: string[] /* ISO list */; locales: string[] /* en-IN, en-US, en-GB, en-AE, en-SG, en-AU */; timezones: string[]; countries: { code: string; name: string }[]; logo_url: string | null }`.
Fields & rules: name* ≤ 120; legal_name ≤ 200; tax_id ≤ 32 (label "Tax ID (e.g. GSTIN)"); email* email; phone_e164 (`PhoneInput`); address (`AddressFields` without label; optional, all-or-nothing on line1/city/country); currency* (Select; disabled when `currency_locked` with note "Currency can't be changed after the first quote."); locale* in list (preview line "Example: {formatted money and date}"); timezone* valid IANA; logo (`ImageUploader` purpose `business_logo`, png/jpg/webp/svg ≤ 2 MB, preview on light & dark); quote_terms* ≤ 20 000; working_hours* ≤ 120.

### 12.2 Units (`Admin/Settings/Units`) — `settings.manage`
Fields: default_system* (metric/imperial); default_length_unit* (consistent with system: metric `mm|cm|m`, imperial `ftin|in`); default_wall_height_mm* 2000–6000; default_exterior_wall_thickness_mm* 50–1000; default_interior_wall_thickness_mm* 50–1000 (≤ exterior: "Interior walls can't be thicker than exterior walls."); default_door_width_mm* 300–6000; default_door_height_mm* 1500–(wall height) ("Door height must be lower than the wall height."); default_window_width_mm* 300–6000; default_window_height_mm* 300–3000; default_window_sill_mm* 0–3000 with sill + height ≤ wall height ("Window doesn't fit in the default wall height."). All length fields use `LengthInput`. Note: "Applies to new users and new drawings; existing plans keep their values."

### 12.3 Pricing (`Admin/Settings/Pricing`) — `settings.manage`
Meta: `{ tax_rates: { id, name, rate_bps }[]; estimate_disclaimer_preview: string }`.
Fields: prices_include_tax (switch; changing shows warning "Affects new quotes and estimates only."); default_tax_rate_id* (active tax rate); margin_bps* 0–50000 (`PercentInput`, label "Markup on cost"); overhead_bps* 0–10000; minimum_order_minor* ≥ 0; rounding_minor* one of `1, 100, 500, 1000, 10000` minor units (Select showing formatted amounts "Round to nearest {amount}"); installation_bps* 0–5000; delivery_flat_minor* ≥ 0; kerf_mm* 0.0–10.0 step 0.5; sheet_trim_mm* 0–50; nesting_allow_rotation_default (switch). `estimate_disclaimer_key` is not editable (read-only preview of the text; change it in translations). Saving bumps `catalog.version` (pricing is part of the snapshot, `01` §5.3) — note under the save bar.

### 12.4 Workflow (`Admin/Settings/Workflow`) — `settings.manage`
Meta: `{ used_stage_keys: string[] }` (distinct `production_updates.stage`).
Fields: quote_validity_days* 1–90; auto_close_days* 1–90; reminder_after_hours* 12–168; require_completion_photos* 0–20; allow_customer_counter_offer (switch); max_negotiation_rounds* 1–20; **production_stages** editor (desktop/tablet): ordered rows with drag handle, **Key** (mono; editable only for new rows; regex `^[a-z][a-z0-9_]{1,31}$`, unique, not `completed` (reserved pseudo-stage): `settings.errors.stage_key`), **Label** (built-in rows show the translated `label_key` and may override with a custom `label`; new rows require `label` ≤ 60), **Default progress*** 1–99, strictly increasing down the list ("Each stage's progress must be higher than the previous one."); delete button disabled for keys in `used_stage_keys` (tooltip "Used by existing updates — can't be removed."); at least 1 stage. Stage shape: Appendix B6.

### 12.5 AI (`Admin/Settings/Ai`) — `ai.manage`
Meta: `{ vision: { reachable: boolean; version: string | null; providers: Record<'anthropic' | 'openai' | 'openai_compatible' | 'none', { configured: boolean; models: string[] }>; checked_at: IsoDateTime } ; month_cost_usd: number }` (fetched from the vision service `/capabilities` with 3 s timeout, cached 60 s; unreachable → warning Alert "The vision service is unreachable; showing saved settings.").
Fields: provider* (radio cards with "Configured"/"Not configured" pills; unconfigured providers disabled except the current value; note "API keys are set on the vision service, not here (see deployment docs)."); model* (Combobox: models from capabilities for the provider + free text; must have a row in price_table unless provider is `none`/`openai_compatible`: "Add a price for this model below."); effort* (low/medium/high, shown only for anthropic); agentic_crops (switch); fallback_to_none_on_error (switch); signup_credits* 0–100; monthly_credits* 0–1000; credits_per_recognition* 0–100; credits_per_recognition_none* 0–100; max_recognitions_per_day* 1–100; global_monthly_budget_usd* 0–100000.00 (0 = unlimited; `MeterBar` showing this month's spend); budget_exhausted_behavior* (`fallback_none` "Switch to basic recognition" / `block` "Stop automatic recognition"); **price_table** rows (provider Select, model text ≤ 100, input_per_mtok_usd 0–1000 (4 dp), output_per_mtok_usd 0–1000; unique provider+model); staff_unlimited (switch).

### 12.6 Notifications (`Admin/Settings/Notifications`) — `settings.manage`
Meta: `{ events: { key: string; label: string; channels: string[] }[]; translation_keys: string[] /* ICU keys under notifications.sms.* */; whatsapp_configured: boolean; sms_configured: boolean }`.
Fields: **WhatsApp templates** table — per event supporting whatsapp: template name (≤ 512, `^[a-z0-9_]+$`), language code (e.g. `en`, `en_US`), components (JSON textarea; must parse to an array: "Components must be a JSON array."); empty name = event not sent via WhatsApp. **SMS driver*** (`twilio` | `msg91` | `log`); **SMS templates** per event: text key (Select from `translation_keys`), DLT template id (≤ 64, optional; required when driver = msg91: "DLT template ID is required for MSG91."). **OTP channel order*** (sortable list of `whatsapp`, `sms`; both present). **Staff digest hour*** 0–23 (business TZ). **Send a test**: channel Select (mail/whatsapp/sms), recipient (email or `PhoneInput`) → `admin.settings.notifications.test` → toast with result. Exact semantics per `12`.

---

## 13. AI usage

### 13.1 Usage report — `admin.ai.usage` · `Admin/Ai/Usage`
Query: `filter[from]`/`filter[to]` (months `YYYY-MM`, default last 6 months incl. current), `filter[provider]`, `filter[model]`, `search` (user), `page`.
Props:
```ts
interface AiUsageProps {
  filters: { from: string; to: string; provider: string | null; model: string | null; search: string | null };
  budget: { month: string; cost_usd: number; budget_usd: number; behavior: 'fallback_none' | 'block'; exhausted: boolean };
  totals: { runs: number; succeeded: number; failed: number; credits_consumed: number; cost_usd: number; avg_cost_usd: number | null; input_tokens: number; output_tokens: number; images: number };
  by_month: { month: string; runs: number; cost_usd: number; budget_usd: number }[];
  by_model: { provider: string; model: string | null; runs: number; failed: number; input_tokens: number; output_tokens: number; images: number; cost_usd: number }[];
  by_user: Paginated<{ user: { id: Ulid; name: string; is_staff: boolean } | null; month: string; runs: number; credits_consumed: number; cost_usd: number }>;   // per user per month, sorted cost desc
}
```
UI: `PageHeader` "AI usage" + month range + provider/model filters + **Export CSV** (`admin.ai.usage.export`, columns `month,user_id,user_name,provider,model,runs,failed,credits_consumed,input_tokens,output_tokens,images,cost_usd`). Sections: budget `MeterBar` (this month vs budget; exhausted → danger Alert with behaviour), KPI tiles (runs, success rate, credits consumed, cost, avg cost per run), `BarChart` monthly cost with budget shown as secondary, table by provider/model, table by user/month (user link → customer page, ledger link). Costs formatted USD (`Intl` currency `USD`, 2 dp; < 0.01 → "< $0.01"). Cost source: `ai_usage_events.cost_micro_usd`.
Empty: "No AI usage in this period".

### 13.2 Credit ledger — `admin.ai.ledger` · `Admin/Ai/Ledger`
Props: `{ entries: Paginated<AiLedgerEntryData & { user: { id: Ulid; name: string }; created_by: UserRefData | null }>; filters: { search: string | null; kind: string[]; from: IsoDate | null; to: IsoDate | null } }` (`per_page` 50).
UI: filters (user search, kind multi-select, date range), table (date, user, kind pill, delta ±, balance after, reference link, note, by). **Grant / revoke credits** → dialog with customer `Combobox` (`api.customers.search`), kind, amount, note (rules §6.2) → `admin.ai.credits.store`.

---

## 14. Imports monitor

### 14.1 List — `admin.imports.index` · `Admin/Imports/Index`
Query: `filter[status]` (multi), `filter[source_kind]`, `filter[provider]`, `filter[mode]`, `filter[from]`/`filter[to]`, `search` (file name, customer name/email), `sort` (`-created_at` default, `duration_ms`, `credits_charged`).
Props: `{ imports: Paginated<AdminImportRowData>; filters: …; counts: Record<ImportStatus, number> /* last 30 days */ }`.
```ts
interface AdminImportRowData {
  id: Ulid; created_at: IsoDateTime; user: { id: Ulid; name: string; is_staff: boolean }; project: { id: Ulid; name: string };
  original_filename: string; source_kind: string | null; mode: 'auto' | 'trace'; status: ImportStatus;
  ai_provider: string | null; ai_model: string | null; credits_charged: number; attempts: number;
  duration_ms: number | null;               // finished_at − started_at
  error_code: string | null;
}
```
UI: status count chips (clickable filters; failed highlighted), `DataTable` columns: Started, Customer, File (truncate) + kind, Mode, Status pill, Provider/model, Credits, Duration, Error code. Row → detail. Real-time: none (refresh button; auto-refresh every 30 s while any visible row is non-terminal).

### 14.2 Detail — `admin.imports.show` · `Admin/Imports/Show`
Props:
```ts
interface AdminImportShowProps {
  import: ImportData & { user: { id: Ulid; name: string }; ai_provider: string | null; ai_model: string | null; attempts: number; error_message: string | null; started_at: IsoDateTime | null; finished_at: IsoDateTime | null };
  source: MediaData | null; normalized: MediaData | null;
  debug: MediaData[];                       // debug collection: PNG overlays and JSON
  result_meta: unknown | null;              // ImportResultMeta (06 §6)
  result_summary: { walls: number; openings: number; rooms: number; confidence: { high: number; med: number; low: number } } | null;
  usage_events: { id: Ulid; provider: string; model: string | null; request_count: number; input_tokens: number; output_tokens: number; image_count: number; cost_micro_usd: number; duration_ms: number; status: string; created_at: IsoDateTime }[];
  ledger: AiLedgerEntryData[];
  plan: { id: Ulid; name: string; href: string } | null;
  can: { rerun: boolean };
}
```
UI: header (file name, status pill, customer link, project link, created), action **Re-run** (`can.rerun`, `ai.manage`; dialog: "Re-run with current AI settings" / "Re-run without AI (basic recognition)"; note "The customer is not charged for staff re-runs." → `admin.imports.rerun`; allowed from terminal statuses per `06`), **Open plan** (if `plan`).
Sections: **Overview** (`KeyValueList`: mode, source kind, MIME, size, pages, selected page, hints JSON summary, provider/model, attempts, timings, credits reserved/charged), **Error** (danger card: `error_code`, internal `error_message` monospace, copy button), **Images**: side-by-side source preview and normalized image; **Debug overlays** viewer (desktop/tablet): normalized image as base with each PNG in `debug` as a toggleable layer (checkbox list with opacity slider per layer), zoom/pan (wheel + drag, buttons), JSON debug files listed with `JsonViewer`; **Result**: summary counts + confidence bars (`confidence-high/med/low` colours with labels) + `JsonViewer` of `result_meta` (collapsed depth 2); **AI usage**: table of usage events with cost in USD; **Credits**: ledger entries referencing this import.
Real-time: `useImportChannel(import.id)` → reload on status change.
Phone: overview, error and images only; overlays hidden behind `ScreenTooSmall` note.

---

## 15. Notifications log — `admin.notifications-log.index` · `Admin/NotificationsLog/Index`
Data source: notification delivery records defined in `12` (Appendix B4 proposes `notification_deliveries`; if `12` defines another table, this page binds to it with the same columns).
Query: `filter[channel]` (multi: `database|mail|whatsapp|sms|webpush`), `filter[status]` (multi), `filter[event]`, `filter[from]`/`filter[to]`, `search` (recipient name/email/phone, order number).
Props: `{ deliveries: Paginated<NotificationDeliveryData>; filters: …; events: { key: string; label: string }[]; can: { retry: boolean } }`.
```ts
interface NotificationDeliveryData {
  id: Ulid; created_at: IsoDateTime; user: { id: Ulid; name: string; is_staff: boolean } | null;
  event_key: string; channel: 'database' | 'mail' | 'whatsapp' | 'sms' | 'webpush';
  status: 'queued' | 'sent' | 'delivered' | 'read' | 'failed' | 'skipped';
  skip_reason: string | null;               // e.g. preference_off, no_phone, feature_off
  recipient: string | null;                 // masked email/phone/endpoint host
  provider_message_id: string | null; error: string | null; attempts: number;
  sent_at: IsoDateTime | null; delivered_at: IsoDateTime | null;
  order: { id: Ulid; number: string } | null;
}
```
Status tones: queued info, sent info, delivered success, read success, failed danger, skipped neutral. Table: time, recipient, event label, channel icon (`bell`, `mail`, `message-circle`, `smartphone`, `globe`), status pill, order link, error (truncate). Row → detail `Sheet` (all fields, error full text, timeline sent → delivered → read). **Retry** (failed only, `settings.manage`) → `admin.notifications-log.retry`.
Empty: "No notifications in this period".

---

## 16. Audit log — `admin.audit.index` · `Admin/Audit/Index`
Query: `filter[causer]` (user id), `filter[subject_type]` (Select: Order, Quote, ChangeProposal, User, Project, Plan, FurnitureDesign, FurniturePreset, Material, EdgeBand, HardwareItem, Finish, LabourRate, TaxRate, AppSetting, BlueprintImport), `filter[subject_id]`, `filter[event]` (prefix, e.g. `order.`), `filter[from]`/`filter[to]`, `search` (description).
Props: `{ entries: Paginated<AuditEntryData>; filters: …; subject_types: { value: string; label: string }[] }` (`per_page` 50).
```ts
interface AuditEntryData {
  id: number; created_at: IsoDateTime; log_name: string | null; event: string | null; description: string;
  causer: { id: Ulid; name: string; is_staff: boolean } | null;
  subject: { type: string; id: string; label: string; href: string | null } | null;
  properties: Record<string, unknown>;      // includes 'old'/'attributes' when present
  ip: string | null; user_agent: string | null;   // from properties when logged
}
```
UI: filter bar (causer via `api.staff.search` + `api.customers.search` combobox, subject type, event prefix, date range, search), table: time, causer, event (mono), subject (label + link), description. Row → `Sheet`: all fields; if `properties.old` & `properties.attributes` → diff table (field, before, after); else `JsonViewer`. Read-only (no export in v1).

---

## 17. System health — `admin.system.index` · `Admin/System/Index`
Props (each card is its own deferred group so slow checks don't block):
```ts
interface SystemIndexProps {
  app: { version: string; environment: string; php: string; laravel: string; engine_version: string; catalog_version: number; timezone: string; features: Record<string, boolean> };
  queues: Inertia.Deferred<{ horizon_status: 'running' | 'paused' | 'inactive'; queues: { name: string; pending: number; wait_seconds: number | null }[]; failed_last_24h: number; recent_failed: { id: string; job: string; queue: string; failed_at: IsoDateTime; exception_head: string }[] }>;
  scheduler: Inertia.Deferred<{ last_heartbeat_at: IsoDateTime | null; healthy: boolean }>;   // healthy = heartbeat < 2 min old
  vision: Inertia.Deferred<{ reachable: boolean; latency_ms: number | null; version: string | null; status: string | null; capabilities: unknown | null; error: string | null }>;
  gotenberg: Inertia.Deferred<{ reachable: boolean; latency_ms: number | null; error: string | null }>;
  channels: { mail: { driver: string; configured: boolean }; whatsapp: { configured: boolean }; sms: { driver: string; configured: boolean }; webpush: { configured: boolean } };
  links: { horizon: string | null; pulse: string | null };       // null when the user's role can't open them
}
```
UI: grid of cards with status dots (success/warning/danger): **Application**, **Queues** (Horizon status, per-queue pending + wait, failed in 24 h with recent list; link **Open Horizon**), **Scheduler** (last heartbeat `RelativeTime`), **Real-time** (client-side: current Echo connection state + `ws` host), **Vision service** (`GET {VISION_URL}/health` + `/capabilities`, 3 s timeout, Bearer token: reachable, latency, version, providers configured with models, OCR loaded — `JsonViewer` for raw capabilities), **PDF (Gotenberg)** (`/health`), **Storage** (button **Run check** → `api.system.checks` writes/reads/deletes `tmp/health/{ulid}.txt` on the private disk; shows duration or error), **Notification channels** (configured flags), links **Open Pulse**. **Refresh** reloads all deferred groups.
Acceptance: with the vision service stopped, the page loads in < 4 s and the vision card shows "Unreachable" with the error.

---

## 18. Staff account pages (`admin.account.*`)
Same UI as customer settings (`10` §13) reusing `components/settings/*` sections, with AdminLayout and `AccountNav` (Profile · Password · Security · Preferences · Notifications):
- **Profile**: name, email (required for staff), phone (`PhoneInput`; the same verification dialog as customers (`10` §13.2.3) posting to `admin.account.phone.send-code` / `admin.account.phone.verify`, Appendix B9), avatar. Saved via `admin.account.profile.update`; avatar via `admin.account.avatar.update`.
- **Password**: Fortify `user-password.update`.
- **Security** (`Admin/Account/Security`): 2FA with Fortify: status; **Enable** (`two-factor.enable` → requires password confirmation) → QR code (`two-factor.qr-code` SVG) + setup key + `PinInput` confirm (`two-factor.confirm`) → recovery codes (show, copy, download .txt, **Regenerate**); **Disable** (not allowed when `two_factor_required` — owner/admin: "Two-factor authentication is required for your role."). Banner when redirected by `two-factor.enforced`.
- **Preferences**: units, length unit, timezone, appearance.
- **Notifications**: matrix of staff-audience events (`12`) + this-device push card (`admin.account.notifications.test-push`).
- **Notifications center** `admin.notifications.index`: as `10` §12 with AdminLayout.

---

## 19. Real-time summary (staff)

| Page | Channel | Behaviour |
|---|---|---|
| All (AppShell) | `users.{id}` | `NotificationCreated` → bell + toast |
| Dashboard, order board/list, sidebar counters | `staff` | `OrderSubmitted`, `OrderNeedsAttention` → partial reload (throttled 10 s) |
| Order detail, quote builder (state banner), proposal preview | `orders.{id}` | §5.3.12; quote builder shows "Order changed to {state}" banner and re-validates send blockers |
| Item design viewer | `furniture-designs.{designId}` | `RevisionCreated` → reload `revisions`; BOM status by polling (§5.6) |
| Import detail | `imports.{id}` | reload on `ImportStatusChanged` |

---

## 20. Acceptance criteria (admin, cross-cutting)

1. Every route in §2 exists with its name, method, path, permission middleware/policy and page component; a Pest test iterates the route table and asserts 403 for a staff user lacking the permission and 200/302 for one holding it.
2. Sidebar items, tabs, buttons and dialogs are hidden exactly when the user lacks the permission (browser tests per role: owner, admin, estimator, production, support).
3. Cost data (`cost_snapshot`, `price` cost lines, margins, quote `internal_notes`) never appears in props for users without `quotes.create` (feature tests on JSON page payloads).
4. Every transition T4, T6, T8, T9, T12, T13, T16–T20, T24–T28, T30, T31 is reachable from the order detail UI only in its `09` states, with the dialogs and validation of §5.4–5.9.
5. Production update with photos works on a 390 × 844 viewport (touch), including camera capture input and client compression.
6. Catalog CSV round-trip (export → import) is lossless for all six tables.
7. All lists implement search/filter/sort/pagination per `15` §9.29 and echo filters in props.
8. No admin page renders a horizontal page scroll at 1024 px; desktop-only pages show `ScreenTooSmall` below 768 px.

---

## Appendix: Proposed additions to other documents

**B1 — 02 §8.1 `orders`:** add `state_changed_at timestamptz not null default now()` (set by every transition, incl. hold/resume; index (`state`, `state_changed_at`)). Used for board ordering, "in state for", attention rules.

**B2 — 02 §8.11 `deliveries`:** add `scheduled_until timestamptz null` (same as 10 Appendix A4).

**B3 — Permissions (13):** no new permission names. Role-only rules: T30 and assigning roles `owner`/`admin` require role `owner`; Horizon/Pulse gates: roles `owner`, `admin`. Page permission mapping as in §2.1 (imports monitor & notifications log: `customers.view`; imports re-run: `ai.manage`; system health: `settings.manage`; AI settings group: `ai.manage`; cost visibility: `quotes.create`; production assignee: `orders.assign` or `production.manage`).

**B4 — 02 (new table, if 12 does not define an equivalent) `notification_deliveries`:** `id ulid`, `notification_id uuid null` (FK-less ref to `notifications.id`), `user_id ulid FK users N null`, `event_key string(64)`, `channel string(16)` (`database|mail|whatsapp|sms|webpush`), `status string(16)` (`queued|sent|delivered|read|failed|skipped`), `skip_reason string(32) null`, `recipient string(254) null` (masked), `provider_message_id string(128) null` (index), `error text null`, `attempts smallint default 0`, `order_id ulid FK orders N null`, `sent_at`, `delivered_at`, `read_at` timestamptz null, timestamps. Indexes (`created_at`), (`user_id`, `created_at`), (`status`, `channel`). Updated by channel classes and delivery-status webhooks (`01` §3 Webhooks).

**B5 — Scheduler heartbeat (01 §7):** every-minute closure `Cache::put('scheduler:heartbeat', now()->toIso8601String(), 600)`.

**B6 — 02 §13 `workflow.production_stages` item shape:** `{ key: string, label_key: string | null, label: string | null, default_progress: int }` — built-in stages have `label_key` (`production.stages.{key}`), custom stages have `label`; UI shows `label ?? t(label_key)`. Key `completed` is reserved for the completion pseudo-stage.

**B7 — Storage keys:** cut-list PDFs cached at `exports/cut-lists/{revision_id}-c{catalog_version}.pdf` on the private disk (job `RenderCutListPdf`, pruned after 30 days by `media:cleanup-orphans`); status endpoint `api.revisions.cut-list-pdf`.

**B8 — Engine CLI (01 §5.4):** add command `template-default` — request `{ templateKey, overrides, catalog }` → result `{ document: FurnitureDocument, issues: Issue[] }` (used by template defaults validation and `admin.presets.store`).

**B9 — Staff phone verification routes:** `admin.account.phone.send-code` POST `/admin/account/phone/send-code` and `admin.account.phone.verify` POST `/admin/account/phone/verify` (same bodies as `customer.settings.phone.*`).

**B10 — Quotes optimistic lock:** draft quote saves use `updated_at` as lock token (`409 { code: 'version_conflict' }` when it differs); no new column.

**B11 — Presets document endpoint:** `api.presets.document.update` PUT `/api/furniture-presets/{preset}/document` `{ document, updated_at, thumbnail_upload_token? }` → validates with engine `validate-furniture`, stores, returns `{ updated_at }`; `409 version_conflict`; `422 invalid_document`. Presets created via save-as-preset default to `is_active = false`.

**B12 — Customer creation by staff:** `admin.customers.store` creates `users.type = customer` with `onboarded_at = null` (the customer sees onboarding on first login); `send_password_link` uses the standard Fortify password-reset broker email.

**B14 — Notification events (12):** `staff.invited` (mail only, to the invitee, contains the signed `auth.invitation.show` link, valid 7 days) and `system.test_push` (webpush only, not configurable). Not order events, so `09` §11 is unaffected.

**B15 — Sidebar "Settings" link target:** `admin.settings.edit` with group `business` when the user has `settings.manage`, otherwise group `ai` (user holds only `ai.manage`).

**B13 — Activity properties:** T26 stores `reason` in activity `properties` (used for `hold_reason`); customer deactivation stores `reason`.
