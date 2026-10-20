# 11 — Admin (Staff) App

Read the master document, `01`, `02`, `03`, `09`, `10` and `15` first. This file is normative for **every staff-facing page**: route name, URL, Inertia page component, layout, props, sections, actions, validation messages, empty/loading/error states, permission-based visibility, responsive behaviour, real-time behaviour and acceptance criteria.

Owned elsewhere: transition rules and side effects → `09` (this file says which UI calls which T#); editors (plan editor, furniture builder in `staff`/`proposal`/preset modes) → `05`/`07`; BOM, cut list, nesting, pricing, quote line generation, cut-list exports → `08`; notification catalogue, delivery log table, WhatsApp/SMS settings semantics → `12`; permissions, owner gates, staff invitations, 2FA, sessions, uploads, customer deletion/restore → `13`; AI settings page content, usage report, credit grants/refunds → `18`; import pipeline/API and debug artifacts → `06`; controllers → `14` (written from §2). Shared data objects of `10` §3 and §11.0 are reused unchanged unless an `Admin…Data` variant is defined. Wire format: camelCase props/JSON and request bodies (`10` §1).

---

## 1. Conventions

- **Routes:** names `admin.*`, prefix `/admin`, middleware group `['web', 'auth', 'active', 'staff', '2fa.enrolled', 'session.absolute']` (`13` §1). Controllers in `app/Http/Controllers/Admin/*`.
- **Authorisation:** each route lists the permission (or owner gate) required; policies additionally enforce state rules (`09`). The UI hides controls via `usePermissions().can(name)`, which checks `auth.user.permissions` **and** `auth.user.abilities` (owner gates, `13` §7.4). Every action is enforced server-side.
- **Permissions** (exhaustive list in `13` §7.1): `orders.view`, `orders.review`, `orders.assign`, `orders.propose_changes`, `quotes.create`, `quotes.send`, `quotes.view_costs`, `orders.confirm`, `orders.cancel`, `orders.hold`, `orders.close`, `production.manage`, `messages.post`, `customers.view`, `customers.manage`, `catalog.manage`, `presets.manage`, `templates.manage`, `settings.manage`, `staff.manage`, `ai.manage`, `reports.view`, `plans.edit_any`, `audit.view`. **Owner gates** (`13` §7.3): `orders.cancel_late` (T30), `staff.manage_owners`, `settings.change_currency`, `settings.manage_restricted` (settings groups `ai` and `auth`), `data.delete`.
- **Cost visibility:** `cost_snapshot`, cost lines of `PriceBreakdown`, margins and quote `internal_notes` are sent only to users with `quotes.view_costs` (server-side omission, tested).
- **Props:** camelCase Data objects; lists use `Paginated<T>` and the query conventions of `15` §9.29.
- **Density:** compact (h-9, `text-sm`) ≥ 768 px; comfortable below.
- **Phones (< 768 px):** supported — dashboard, order list (list view), order detail (read), messages & internal notes, call logging (`tel:`), **production update composer with photos**, completion dialog, issue resolution, delivery scheduling/recording, customers (read), notifications, account. Not on phones (`ScreenTooSmall`): quote builder, proposal item builder, preset builder, catalog CSV import preview, settings tables (production stages, price table, WhatsApp templates), template defaults, imports debug viewer. Plan/design editors open view-only.

---

## 2. Route & page index (complete)

### 2.1 Pages (GET, Inertia)

| # | Route name | Path | Page component | Layout | Permission |
|---|---|---|---|---|---|
| 1 | `admin.dashboard` | `/admin` | `Admin/Dashboard` | AdminLayout | any staff (widgets filtered) |
| 2 | `admin.orders.index` | `/admin/orders` | `Admin/Orders/Index` | AdminLayout | `orders.view` |
| 3 | `admin.orders.show` | `/admin/orders/{order}` | `Admin/Orders/Show` | AdminLayout | `orders.view` |
| 4 | `admin.orders.items.show` | `/admin/orders/{order}/items/{item}` | `Admin/Orders/ItemDesign` | AdminLayout | `orders.view` |
| 5 | `admin.orders.proposals.items.edit` (09, 07) | `/admin/orders/{order}/proposals/{proposal}/items/{proposalItem}/edit` | `Admin/Orders/ProposalItemEdit` | EditorLayout | `orders.propose_changes` |
| 6 | `admin.orders.proposals.preview` | `/admin/orders/{order}/proposals/{proposal}/preview` | `Admin/Orders/ProposalPreview` | AdminLayout | `orders.propose_changes` |
| 7 | `admin.orders.quotes.edit` | `/admin/orders/{order}/quotes/{quote}/edit` | `Admin/Orders/QuoteBuilder` | AdminLayout (full width) | `quotes.create` |
| 8 | `admin.customers.index` | `/admin/customers` | `Admin/Customers/Index` | AdminLayout | `customers.view` |
| 9 | `admin.customers.show` | `/admin/customers/{user}` | `Admin/Customers/Show` | AdminLayout | `customers.view` |
| 10 | `admin.projects.show` | `/admin/projects/{project}` | `Admin/Projects/Show` | AdminLayout | `customers.view` |
| 11 | `admin.plans.edit` | `/admin/plans/{plan}/edit` | `Admin/Plans/Edit` | EditorLayout | `customers.view` (editing: `plans.edit_any`) |
| 12 | `admin.furniture.create` (07) | `/admin/furniture/create?project=` | `Admin/Furniture/Create` | AdminLayout | `plans.edit_any` |
| 13 | `admin.furniture.edit` (07) | `/admin/furniture/{design}/edit` | `Admin/Furniture/Edit` | EditorLayout | `customers.view` (editing unlocked designs: `plans.edit_any`) |
| 14 | `admin.staff.index` | `/admin/staff` | `Admin/Staff/Index` | AdminLayout | `staff.manage` |
| 15 | `admin.catalog.materials.index` | `/admin/catalog/materials` | `Admin/Catalog/Materials` | AdminLayout | `catalog.manage` |
| 16 | `admin.catalog.edge-bands.index` | `/admin/catalog/edge-bands` | `Admin/Catalog/EdgeBands` | AdminLayout | `catalog.manage` |
| 17 | `admin.catalog.hardware.index` | `/admin/catalog/hardware` | `Admin/Catalog/Hardware` | AdminLayout | `catalog.manage` |
| 18 | `admin.catalog.finishes.index` | `/admin/catalog/finishes` | `Admin/Catalog/Finishes` | AdminLayout | `catalog.manage` |
| 19 | `admin.catalog.labour-rates.index` | `/admin/catalog/labour-rates` | `Admin/Catalog/LabourRates` | AdminLayout | `catalog.manage` |
| 20 | `admin.catalog.tax-rates.index` | `/admin/catalog/tax-rates` | `Admin/Catalog/TaxRates` | AdminLayout | `catalog.manage` |
| 21 | `admin.catalog.imports.show` | `/admin/catalog/imports/{token}` | `Admin/Catalog/ImportPreview` | AdminLayout | `catalog.manage` |
| 22 | `admin.presets.index` | `/admin/presets` | `Admin/Presets/Index` | AdminLayout | `presets.manage` |
| 23 | `admin.presets.create` | `/admin/presets/create` | `Admin/Presets/Create` | AdminLayout | `presets.manage` |
| 24 | `admin.presets.builder` | `/admin/presets/{preset}/builder` | `Admin/Presets/Builder` | EditorLayout | `presets.manage` |
| 25 | `admin.templates.index` | `/admin/templates` | `Admin/Templates/Index` | AdminLayout | `templates.manage` |
| 26 | `admin.settings.business` | `/admin/settings/business` | `Admin/Settings/Business` | AdminLayout + `SettingsNav` | `settings.manage` |
| 27 | `admin.settings.units` | `/admin/settings/units` | `Admin/Settings/Units` | same | `settings.manage` |
| 28 | `admin.settings.pricing` | `/admin/settings/pricing` | `Admin/Settings/Pricing` | same | `settings.manage` |
| 29 | `admin.settings.workflow` | `/admin/settings/workflow` | `Admin/Settings/Workflow` | same | `settings.manage` |
| 30 | `admin.settings.notifications` | `/admin/settings/notifications` | `Admin/Settings/Notifications` | same | `settings.manage` |
| 31 | `admin.settings.ai` (18) | `/admin/settings/ai` | `Admin/Settings/Ai` | same | gate `settings.manage_restricted` |
| 32 | `admin.settings.auth` | `/admin/settings/auth` | `Admin/Settings/Auth` | same | gate `settings.manage_restricted` |
| 33 | `admin.ai.usage` (18) | `/admin/ai/usage?month=` | `Admin/Ai/Usage` | AdminLayout | `ai.manage` |
| 34 | `admin.ai.ledger` | `/admin/ai/ledger` | `Admin/Ai/Ledger` | AdminLayout | `ai.manage` |
| 35 | `admin.imports.index` (06) | `/admin/imports` | `Admin/Imports/Index` | AdminLayout | `customers.view` |
| 36 | `admin.imports.show` (06) | `/admin/imports/{import}` | `Admin/Imports/Show` | AdminLayout | `customers.view` |
| 37 | `admin.notifications-log.index` | `/admin/notifications-log` | `Admin/NotificationsLog/Index` | AdminLayout | `customers.view` |
| 38 | `admin.audit.index` | `/admin/audit` | `Admin/Audit/Index` | AdminLayout | `audit.view` |
| 39 | `admin.system.index` | `/admin/system` | `Admin/System/Index` | AdminLayout | `settings.manage` |
| 40 | `admin.notifications.index` (12) | `/admin/notifications` | `Admin/Notifications/Index` | AdminLayout | any staff |
| 41 | `admin.account.profile` | `/admin/account/profile` | `Admin/Account/Profile` | AdminLayout + `AccountNav` | any staff |
| 42 | `admin.account.security` (13) | `/admin/account/security` | `Admin/Account/Security` | same | any staff |
| 43 | `admin.security.two-factor` (13) | `/admin/account/two-factor` | `Admin/Account/TwoFactor` | same | any staff (exempt from `2fa.enrolled`) |
| 44 | `admin.account.preferences` | `/admin/account/preferences` | `Admin/Account/Preferences` | same | any staff |
| 45 | `admin.account.notifications` (12) | `/admin/account/notifications` | `Admin/Account/Notifications` | same | any staff |
| 46 | `staff.invitations.show` (13) | `/staff/invitations/{invitation}` (signed) | `Auth/AcceptInvitation` / `Auth/InvitationInvalid` | AuthLayout | guest |

External dashboards: Horizon `/horizon`, Pulse `/pulse` (gates: roles `owner`, `admin`).

### 2.2 Actions

All mutating routes redirect back with `flash.success` unless stated. 409 (transition no longer allowed) → redirect back with `flash.error` `orders.errors.invalid_transition` "This order changed in the meantime. The page has been refreshed."

**Orders** (prefix `…` = `/admin/orders/{order}`)

| Route name | Method | Path | Body | Effect | Permission |
|---|---|---|---|---|---|
| `admin.orders.bulk-assign` | POST | `/admin/orders/bulk-assign` | `orderIds[]` (1–100), `assignedTo` (staff id \| null) | assign estimator | `orders.assign` |
| `admin.orders.assign` | POST | `…/assign` | `assignedTo?`, `productionAssigneeId?` | assign | `orders.assign` |
| `admin.orders.start-review` | POST | `…/start-review` | — | **T4** | `orders.review` |
| `admin.orders.items.update` | PATCH | `…/items/{item}` | `quantity?` (1–99, `in_review` only), `staffNotes?` | edit item | `orders.review` |
| `admin.orders.proposals.store` | POST | `…/proposals` | — | create proposal draft | `orders.propose_changes` |
| `admin.orders.proposals.update` | PATCH | `…/proposals/{proposal}` | `message?`, `items?: [{id, staffNote}]` | edit draft text | `orders.propose_changes` |
| `admin.orders.proposals.destroy` | DELETE | `…/proposals/{proposal}` | — | delete draft | `orders.propose_changes` |
| `admin.orders.proposals.items.store` | POST | `…/proposals/{proposal}/items` | `orderItemId` | add item (from = pinned revision) → redirect to item builder | `orders.propose_changes` |
| `admin.orders.proposals.items.destroy` | DELETE | `…/proposals/{proposal}/items/{proposalItem}` | — | remove item from draft | `orders.propose_changes` |
| `admin.orders.proposals.send` | POST | `…/proposals/{proposal}/send` | — | **T6** | `orders.propose_changes` |
| `admin.orders.proposals.withdraw` | POST | `…/proposals/{proposal}/withdraw` | — | **T8** | `orders.propose_changes` |
| `admin.orders.quotes.store` | POST | `…/quotes` | `fromQuoteId?`, `negotiationId?` | `BuildQuoteDraft` / copy → redirect builder | `quotes.create` |
| `admin.orders.quotes.update` | PUT | `…/quotes/{quote}` | §5.9.3 | save draft | `quotes.create` |
| `admin.orders.quotes.regenerate` | POST | `…/quotes/{quote}/regenerate` | — | rebuild lines from BOMs (`08` §6) | `quotes.create` |
| `admin.orders.quotes.preview` | GET | `…/quotes/{quote}/preview` | — | draft PDF rendered synchronously (Gotenberg, 60 s) inline with "DRAFT" watermark | `quotes.create` |
| `admin.orders.quotes.send` | POST | `…/quotes/{quote}/send` | `validUntil`, `answerMessage?` (required when `negotiating`) | **T9** / **T13** | `quotes.send` |
| `admin.orders.quotes.destroy` | DELETE | `…/quotes/{quote}` | — | delete draft | `quotes.create` |
| `admin.orders.quotes.pdf` | GET | `…/quotes/{quote}/pdf` | — | 302 temporary URL | `orders.view` |
| `admin.orders.negotiations.keep-price` | POST | `…/negotiations/{negotiation}/keep-price` | `answerMessage`, `validUntil?` | **T12** | `quotes.send` |
| `admin.orders.calls.store` | POST | `…/calls` | `calledAt`, `phoneE164`, `outcome`, `notes?`, `callbackAt?` | log call | `orders.confirm` |
| `admin.orders.confirm` | POST | `…/confirm` | `expectedDeliveryOn`, `productionAssigneeId?`, `call?` (call fields, outcome forced `confirmed`) | **T16** | `orders.confirm` |
| `admin.orders.back-to-negotiation` | POST | `…/back-to-negotiation` | `callId` \| `call`, `message` | **T17** | `orders.confirm` |
| `admin.orders.start-production` | POST | `…/start-production` | — | **T19** | `production.manage` |
| `admin.orders.production-updates.store` | POST | `…/production-updates` | `stage`, `progress`, `title`, `body?`, `visibility`, `uploadIds[]` | post update | `production.manage` |
| `admin.orders.complete` | POST | `…/complete` | `title`, `body?`, `uploadIds[]` (≥ `require_completion_photos`) | **T20** | `production.manage` |
| `admin.orders.issues.store` | POST | `…/issues` | `description`, `orderItemId?`, `uploadIds[]` | **T31** (from `delivered`) | `orders.close` |
| `admin.orders.issues.update` | PATCH | `…/issues/{issue}` | `status` (`in_progress`\|`resolved`\|`rejected`), `resolutionNote?` | resolve issue | `production.manage` |
| `admin.orders.delivery.schedule` | PUT | `…/delivery` | `scheduledFor`, `scheduledUntil?`, `notes?` | schedule delivery | `production.manage` |
| `admin.orders.deliver` | POST | `…/deliver` | `deliveredAt`, `installed`, `recipientName?`, `notes?`, `uploadIds[]` | **T24** | `production.manage` |
| `admin.orders.close` | POST | `…/close` | — | **T25** | `orders.close` |
| `admin.orders.hold` | POST | `…/hold` | `reason` | **T26** | `orders.hold` |
| `admin.orders.resume` | POST | `…/resume` | — | **T27** | `orders.hold` |
| `admin.orders.cancel` | POST | `…/cancel` | `reason` (enum), `note`, `call?` | **T18** (`accepted`) / **T28** / **T30** (production states, gate `orders.cancel_late`) | `orders.cancel` |
| `admin.orders.messages.store` | POST | `…/messages` | `body`, `kind` (`text`\|`internal_note`), `uploadIds[]` | post | `messages.post` |
| `admin.orders.messages.update` | PATCH | `…/messages/{message}` | `body` | edit own within 10 min | `messages.post` |
| `admin.orders.messages.read` | POST | `…/messages/read` | `lastMessageId` | mark read (204) | `orders.view` |
| `admin.furniture-revisions.recompute-bom` | POST | `/admin/furniture-revisions/{revision}/recompute-bom` | — | re-dispatch `ComputeRevisionBom` (only if `failed`) | `quotes.create` |

Cut-list exports (CSV/PDF) use the routes of `08` §8: `admin.furniture-revisions.cutlist.csv` (GET `/admin/furniture-revisions/{revision}/cutlist.csv`), `admin.furniture-revisions.cutlist.pdf.store` (POST `/admin/furniture-revisions/{revision}/cutlist-pdf`), `admin.furniture-revisions.cutlist.pdf.show` (GET same path) — permission `orders.view`; the item viewer passes the item's pinned revision.

**Customers, projects, furniture, AI, imports**

| Route name | Method | Path | Body | Permission |
|---|---|---|---|---|
| `admin.customers.store` | POST | `/admin/customers` | `name`, `email?`, `phoneE164?` (≥ 1), `sendPasswordLink` | `customers.manage` |
| `admin.customers.update` | PUT | `/admin/customers/{user}` | `name`, `email?`, `phoneE164?`, `unitSystem`, `timezone` | `customers.manage` |
| `admin.customers.notes.update` | PUT | `/admin/customers/{user}/notes` | `notesInternal` (≤ 10 000) | `customers.manage` |
| `admin.customers.deactivate` / `.activate` | POST | `/admin/customers/{user}/deactivate`, `/activate` | `reason` (deactivate) | `customers.manage` |
| `admin.customers.password-link` | POST | `/admin/customers/{user}/password-link` | — | `customers.manage` |
| `admin.customers.restore` (13) | POST | `/admin/customers/{user}/restore` | — | `customers.manage` |
| `admin.customers.anonymise` (13) | POST | `/admin/customers/{user}/anonymise` | `confirmation` | gate `data.delete` |
| `admin.customers.projects.store` | POST | `/admin/customers/{user}/projects` | `name`, `propertyType`, `notes?` | `customers.manage` |
| `admin.customers.ai-credits.grant` / `.revoke` (18) | POST | `/admin/customers/{user}/ai-credits/grant`, `/revoke` | `amount` (1–1000), `note` (3–255) | `ai.manage` |
| `admin.imports.refund` (18) | POST | `/admin/imports/{import}/refund` | `note` (3–255) | `ai.manage` |
| `admin.furniture.store` (07) | POST | `/admin/furniture` | `projectId`, `name`, `templateKey`, `presetId?`, `document` | `plans.edit_any` |
| `admin.furniture.save-as-preset` | POST | `/admin/furniture/{design}/save-as-preset` | `name`, `category`, `description?`, `source` (`working`\|`revision`), `revisionId?`, `thumbnailUploadId?` (upload intent, purpose `preset_thumbnail`) | `presets.manage` |
| `admin.ai.usage.export` (18) | GET | `/admin/ai/usage/export?month=` | CSV | `ai.manage` |

Import re-run uses `api.imports.rerun` `{ useAi }` (`06` A11; staff runs are free).

**Staff** (`13` §5.9)

| Route name | Method | Path | Body | Permission |
|---|---|---|---|---|
| `admin.staff.invitations.store` | POST | `/admin/staff/invitations` | `email`, `name`, `role` | `staff.manage` (role `owner`: gate `staff.manage_owners`) |
| `admin.staff.invitations.resend` | POST | `/admin/staff/invitations/{invitation}/resend` | — | `staff.manage` |
| `admin.staff.invitations.revoke` | DELETE | `/admin/staff/invitations/{invitation}` | — | `staff.manage` |
| `admin.staff.update` | PUT | `/admin/staff/{user}` | `name`, `role` | `staff.manage` (+ `staff.manage_owners` for owners) |
| `admin.staff.deactivate` / `.activate` | POST | `/admin/staff/{user}/deactivate`, `/activate` | — | `staff.manage` (+ gate for owners) |
| `admin.staff.two-factor.reset` | DELETE | `/admin/staff/{user}/two-factor` | — | `staff.manage` (+ gate for owners) |
| `staff.invitations.accept` | POST | `/staff/invitations/{invitation}` (signed) | `name`, `password`, `password_confirmation` | guest |

**Catalog** — for each `{t}` ∈ `materials`, `edge-bands`, `hardware`, `finishes`, `tax-rates`, `labour-rates` (all `catalog.manage`):

| Route name | Method | Path | Notes |
|---|---|---|---|
| `admin.catalog.{t}.store` | POST | `/admin/catalog/{t}` | not for `labour-rates` |
| `admin.catalog.{t}.update` | PUT | `/admin/catalog/{t}/{id}` | |
| `admin.catalog.{t}.archive` / `.restore` | POST | `/admin/catalog/{t}/{id}/archive`, `/restore` | soft delete; materials, edge-bands, hardware, finishes only |
| `admin.catalog.{t}.export` | GET | `/admin/catalog/{t}/export` | CSV |
| `admin.catalog.{t}.import` | POST | `/admin/catalog/{t}/import` | multipart `file` (csv ≤ 2 MB) → redirect `admin.catalog.imports.show` |
| `admin.catalog.imports.commit` | POST | `/admin/catalog/imports/{token}` | apply previewed import |

**Presets & templates**

| Route name | Method | Path | Body | Permission |
|---|---|---|---|---|
| `admin.presets.store` | POST | `/admin/presets` | `name`, `category`, `templateKey`, `description?` | `presets.manage` |
| `admin.presets.update` | PUT | `/admin/presets/{preset}` | `name`, `slug`, `category`, `description?`, `isActive` | `presets.manage` |
| `admin.presets.reorder` | POST | `/admin/presets/reorder` | `ids[]` (ordered, one category) | `presets.manage` |
| `admin.presets.duplicate` | POST | `/admin/presets/{preset}/duplicate` | — | `presets.manage` |
| `admin.presets.destroy` | DELETE | `/admin/presets/{preset}` | — (soft delete) | `presets.manage` |
| `api.presets.document.update` | PUT | `/api/furniture-presets/{preset}/document` | `document`, `updatedAt`, `thumbnailUploadId?` | `presets.manage` |
| `admin.templates.update` | PUT | `/admin/templates/{templateKey}` | `isEnabled`, `defaultOverrides` | `templates.manage` |
| `admin.templates.reorder` | POST | `/admin/templates/reorder` | `keys[]` | `templates.manage` |

**Settings & account**

| Route name | Method | Path | Body | Permission |
|---|---|---|---|---|
| `admin.settings.{group}.update` (`business`, `units`, `pricing`, `workflow`, `notifications`, `ai`, `auth`) | PUT | `/admin/settings/{group}` | group fields (§12) | as the page |
| `admin.settings.ai.test` (18) | POST | `/admin/settings/ai/test` | `provider`, `model` | gate `settings.manage_restricted` |
| `admin.settings.notifications.test` | POST | `/admin/settings/notifications/test` | `channel` (`mail`\|`whatsapp`\|`sms`), `to`, `eventKey?` | `settings.manage` |
| `admin.account.avatar.update` | PUT | `/admin/account/avatar` | `uploadId` \| null | any staff |
| `admin.account.preferences.update` | PUT | `/admin/account/preferences` | `unitSystem`, `lengthUnit`, `timezone` | any staff |
| `admin.account.notifications.update` (12) | PUT | `/admin/account/notifications` | `preferences[]` | any staff |
| `admin.account.notifications.reset` | DELETE | `/admin/account/notifications` | — | any staff |
| `admin.account.notifications.test-push` | POST | `/admin/account/notifications/test-push` | — | any staff |
| Fortify `user-profile-information.update`, `user-password.update`, `two-factor.*`; `13`: `account.phone.send|verify`, `account.google.unlink`, `account.sessions.*` | | | | any staff |

### 2.3 JSON endpoints (staff)

| Name | Method | Path | Response | Permission |
|---|---|---|---|---|
| `api.staff.search` | GET | `/api/staff?search=&permission=` | `{ data: UserRefData[] }` (active staff, optional permission filter) | `orders.view` |
| `api.customers.search` | GET | `/api/customers?search=` | `{ data: { id, name, email, phoneE164 }[] }` (max 20) | `customers.view` |
| `api.furniture-revisions.bom-status` | GET | `/api/furniture-revisions/{revision}/bom-status` | `{ bomStatus }` | `orders.view` |
| `api.change-proposal-items.draft` (03, 09) | PUT | `/api/change-proposal-items/{item}/draft` | `03` §5 | `orders.propose_changes` |
| `api.system.storage-check` | POST | `/api/admin/system/storage-check` | `{ ok, durationMs, error? }` | `settings.manage` |
| shared: `api.uploads.*` (13), `api.notifications.*` (12), `api.push-subscriptions.*` (12), `api.imports.*` (06), `api.furniture-revisions.show` (10), `media.show` (13) | | | | |

---

## 3. Admin data objects

```ts
interface AdminCustomerCardData {
  id: Ulid; name: string; email: string | null; emailVerified: boolean;
  phoneE164: string | null; phoneVerified: boolean; avatarUrl: string | null;
  timezone: string; isActive: boolean; deletedAt: IsoDateTime | null;   // soft-deleted = pending deletion (13 §9)
  notesInternal: string | null;
  orderCount: number; activeOrderCount: number; createdAt: IsoDateTime;
  href: string;
}

type AttentionReason = 'submitted_unpicked' | 'negotiation_unanswered' | 'accepted_no_call' | 'callback_due'
  | 'proposal_waiting_customer' | 'quote_waiting_customer' | 'completion_waiting_customer' | 'quote_expiring';

interface OrderBoardCardData {
  id: Ulid; number: string; title: string; state: OrderStateKey; stateBeforeHold: OrderStateKey | null;
  customer: { id: Ulid; name: string };
  project: { id: Ulid; name: string };
  assignee: UserRefData | null; productionAssignee: UserRefData | null;
  itemCount: number; quoteTotalMinor: number | null;
  productionProgress: number;
  stateChangedAt: IsoDateTime;             // orders.state_changed_at (02 §8.1)
  attention: { reason: AttentionReason; since: IsoDateTime; overdue: boolean } | null;
  unreadMessages: number;                  // for the current staff user
  submittedAt: IsoDateTime | null; updatedAt: IsoDateTime;
}

interface StaffOrderAbilities {
  startReview: boolean; assign: boolean; assignProduction: boolean; editItems: boolean; editStaffNotes: boolean;
  createProposal: boolean; editProposalDesigns: boolean; sendProposal: boolean; withdrawProposal: boolean;
  createQuote: boolean; editQuote: boolean; sendQuote: boolean; keepPrice: boolean;
  logCall: boolean; confirm: boolean; backToNegotiation: boolean;
  cancelAfterCall: boolean;                // T18 available (declined call logged, or ≥ 3 no_answer)
  startProduction: boolean; postUpdate: boolean; complete: boolean;
  resolveIssue: boolean; raiseIssue: boolean;   // T31
  scheduleDelivery: boolean; deliver: boolean; close: boolean;
  hold: boolean; resume: boolean; cancel: boolean;   // server decides T18/T28/T30
  postMessage: boolean; postInternalNote: boolean;
  viewCosts: boolean; viewAudit: boolean; saveAsPreset: boolean;
}

interface AdminOrderData {
  id: Ulid; number: string; isDraftNumber: boolean; title: string;
  state: OrderStateKey; stateBeforeHold: OrderStateKey | null; holdReason: string | null;
  stateChangedAt: IsoDateTime;
  project: ProjectRefData;
  customer: AdminCustomerCardData;
  assignee: UserRefData | null; productionAssignee: UserRefData | null;
  siteAddress: AddressData | null; needsInstallation: boolean;
  preferredDeliveryOn: IsoDate | null; expectedDeliveryOn: IsoDate | null;
  customerNotes: string | null;
  productionProgress: number; productionStage: string | null; productionStageLabel: string | null;
  cancelReason: string | null; cancelNote: string | null;
  milestones: OrderData['milestones'];
  lastCustomerActivityAt: IsoDateTime | null; lastStaffActivityAt: IsoDateTime | null;
  currentQuoteId: Ulid | null; acceptedQuoteId: Ulid | null;
  openProposalId: Ulid | null; draftProposalId: Ulid | null; draftQuoteId: Ulid | null;
  negotiation: { roundsUsed: number; roundsMax: number; open: QuoteNegotiationData | null };
  callStats: { total: number; noAnswerCount: number; confirmedCallId: Ulid | null; declinedCallId: Ulid | null; wantsChangesCallId: Ulid | null; lastCallAt: IsoDateTime | null; nextCallbackAt: IsoDateTime | null };
  attention: OrderBoardCardData['attention'];
  can: StaffOrderAbilities;
}

interface AdminOrderItemData extends OrderItemData {
  staffNotes: string | null;
  revisionReason: string | null;
  engineIssueCounts: { error: number; warning: number; info: number } | null;
  serverPrice: { unitPriceMinor: number; directCostMinor: number | null } | null;   // directCostMinor only with quotes.view_costs
}

interface ConfirmationCallData {
  id: Ulid; staff: UserRefData; calledAt: IsoDateTime; phoneE164: string;
  outcome: 'confirmed' | 'no_answer' | 'callback_requested' | 'wrong_number' | 'customer_wants_changes' | 'customer_declined';
  notes: string | null; callbackAt: IsoDateTime | null; createdAt: IsoDateTime;
}

interface AdminQuoteLineData extends QuoteLineData { isVisibleToCustomer: boolean }
interface AdminQuoteData extends Omit<QuoteData, 'status' | 'lines'> {
  status: 'draft' | QuoteData['status'];
  lines: AdminQuoteLineData[];
  internalNotes: string | null;            // quotes.view_costs only
  costSnapshot: QuoteCostSnapshotData | null;   // quotes.view_costs only
  createdBy: UserRefData; catalogVersion: number; engineVersion: string;
  pdfStatus: 'none' | 'rendering' | 'ready' | 'failed';
  updatedAt: IsoDateTime;                  // optimistic-lock token for drafts (`updated_at`; 409 `version_conflict` on mismatch, no extra column)
}
interface QuoteCostSnapshotData {          // camelCased view of quotes.cost_snapshot (shape owned by 08 §6)
  items: { orderItemId: Ulid; directCostMinor: number; priceMinor: number }[];
  totals: { materialMinor: number; edgeBandMinor: number; hardwareMinor: number; finishingMinor: number; labourMinor: number; directCostMinor: number };
}

interface AdminChangeProposalItemData extends ChangeProposalItemData { hasStaffDraft: boolean; staffDraftVersion: number; editHref: string }
interface AdminChangeProposalData extends Omit<ChangeProposalData, 'items'> { items: AdminChangeProposalItemData[] }

interface ProductionStageData { key: string; label: string; defaultProgress: number }
```

---

## 4. Layout, navigation, global elements
- `AdminLayout` and the permission-filtered sidebar: `15` §7.2.
- Shared prop `staffCounters` (`{ submitted, toCall }`) feeds sidebar badges (lazy, cached 30 s), refreshed by `useStaffChannel` (`OrderSubmitted`, `OrderNeedsAttention`) via `router.reload({ only: ['staffCounters'] })` throttled 10 s.
- **Global search** (top bar) → `admin.orders.index?view=list&search={q}`: matches order number (prefix, with or without `ORD-`), customer name/email/phone digits, order title.
- **Breadcrumbs** via `#breadcrumbs` slot on every page.
- **Health banners** (`12` §11, `13` §4.5): when cache keys `health:whatsapp`, `health:sms` or `health:otp` report problems, `AdminLayout` shows a dismissible warning bar to users with `settings.manage` linking to Settings → Notifications (shared prop `healthBanners: { key: string; messageKey: string }[]`, 01 §6).

---

## 5. Orders

### 5.1 Dashboard — `admin.dashboard` · `/admin` · `Admin/Dashboard`
Props:
```ts
interface AdminDashboardProps {
  kpis: {
    submittedAwaitingReview: number;       // submitted
    inReview: number;                      // in_review
    proposalsAwaitingCustomer: number;     // changes_proposed
    quotesAwaitingCustomer: number;        // quoted
    toCall: number;                        // accepted
    inProduction: number;                  // confirmed + in_production + rework
    completedAwaitingCustomer: number;     // completed
    overdue: number;                       // attention items with overdue = true
    medianFirstResponseHours30d: number | null;   // median(reviewed_at − submitted_at), orders submitted in last 30 days (master §2.1)
  } | null;                                // null without orders.view
  attention: Inertia.Deferred<OrderBoardCardData[]>;    // attention != null; overdue first, then since asc (max 50)
  toCall: Inertia.Deferred<OrderBoardCardData[]>;       // accepted, by accepted_at asc
  myOrders: OrderBoardCardData[];                       // Active, assignee or production assignee = me (max 10)
  charts: Inertia.Deferred<DashboardChartsData> | null; // reports.view
  aiSpend: Inertia.Deferred<{ month: string; costUsd: number; budgetUsd: number; behavior: 'fallback_none' | 'block' }> | null;   // ai.manage or reports.view
}
interface DashboardChartsData {
  ordersByState: { state: OrderStateKey; count: number }[];               // Active states
  monthlyQuotes: { month: string; sentMinor: number; acceptedMinor: number }[];   // last 12 months
  conversion: { month: string; quoted: number; accepted: number; rate: number | null }[];
  aiMonthly: { month: string; costUsd: number; budgetUsd: number }[];     // last 6 months
}
```
Definitions (`App\Domain\Orders\Queries\DashboardQuery`):
- **Attention reasons** (09 §13, 12 §9): `submitted_unpicked` (`submitted` > 24 h), `negotiation_unanswered` (`negotiating` with open negotiation > 24 h), `accepted_no_call` (`accepted` > 24 h, no call), `callback_due` (latest call `callback_requested`, `callback_at` ≤ now + 1 h, no later call) → `overdue = true`; customer-side `proposal_waiting_customer` / `quote_waiting_customer` (sent > `workflow.reminder_after_hours`), `completion_waiting_customer` (`completed` > 48 h), `quote_expiring` (`valid_until` ≤ today + 2) → `overdue = false`.
- `monthlyQuotes.sentMinor`: per month, sum of `total_minor` of the latest non-draft quote version per order with `sent_at` in the month; `acceptedMinor`: sum of `total_minor` of quotes with `accepted_at` in the month.
- `conversion`: `quoted` = orders with `quoted_at` in the month; `accepted` = those with `accepted_at` not null; `rate = accepted / quoted` (null when 0).
Layout:
1. `PageHeader` "Dashboard" + "Updated {time}" + **Refresh**.
2. **KPI tiles** (`KpiTile`, 4 per row ≥ 1280, 2 per row below): each links to a filtered list — submitted → `?view=list&filter[state]=submitted`; in review; proposals (`changes_proposed`); quotes (`quoted`); to call → `?view=list&queue=to_call`; in production → `filter[state]=confirmed,in_production,rework`; completed; overdue (danger when > 0) → `queue=needs_attention`; plus "First response (median, 30 d)" ("5.2 h" / "—").
3. **Needs attention** (deferred table): number, customer, `StatusBadge`, reason (`admin.attention.{reason}` e.g. "Not picked up for {hours} h"), since, assignee; overdue rows tinted `bg-danger-subtle/40`. Empty `check-circle` "Nothing needs attention".
4. **To call** (deferred; only with `orders.confirm`): customer, phone `tel:`, accepted total, accepted since, calls so far, next callback, **Log call** (opens §5.7 dialog inline). Empty "No calls waiting".
5. **My orders**: compact board cards.
6. **Charts** (`reports.view`, deferred): `HBarChart` orders by state (clickable; `ORDER_STATE_TONE` colours); `BarChart` monthly quotes (sent primary, accepted secondary; `formatMoney` compact); `BarChart` conversion %; **AI spend vs budget** (`MeterBar` + 6-month bars; `ai.manage` or `reports.view`).
Users with `production.manage` but not `orders.review` see **My orders** first.
Real-time: `useStaffChannel` → reload `kpis`, `attention`, `toCall`, `myOrders` (throttled 10 s).
Phone: KPI tiles 2-up, card lists, full-width charts.
Acceptance: KPI counts equal the counts of their linked lists; charts include `sr-only` tables; no money charts without `reports.view`.

### 5.2 Order board & list — `admin.orders.index` · `Admin/Orders/Index`
Query: `view` (`board` default ≥ 768 px; `list`; phones always list), `queue` (`to_call` | `needs_attention` | `mine` | `unassigned`), `search`, `filter[state]` (comma list), `filter[assignee]` (id | `me` | `none`), `filter[production_assignee]`, `filter[date_field]` (`submitted_at` default | `created_at` | `updated_at` | `expected_delivery_on`), `filter[from]`, `filter[to]`, `filter[include_closed]` (`1` adds `closed`, `cancelled` and drafts in list view), `sort` (list default `-state_changed_at`; allowed `number`, `submitted_at`, `updated_at`, `state_changed_at`, `quote_total`, `expected_delivery_on`), `page`, `per_page`.
Props:
```ts
interface AdminOrdersIndexProps {
  view: 'board' | 'list';
  columns: { key: BoardColumnKey; states: OrderStateKey[]; count: number; cards: OrderBoardCardData[] }[] | null;   // ≤ 50 cards per column
  orders: Paginated<OrderBoardCardData> | null;
  filters: { queue: string | null; search: string | null; state: OrderStateKey[]; assignee: string | null; productionAssignee: string | null; dateField: string; from: IsoDate | null; to: IsoDate | null; includeClosed: boolean; sort: string };
  staff: UserRefData[];
  can: { bulkAssign: boolean };
}
type BoardColumnKey = 'new' | 'review' | 'quoting' | 'to_confirm' | 'production' | 'finishing' | 'on_hold';
```
**Board columns**: `new` "New" (`submitted`); `review` "Review" (`in_review`, `changes_proposed`); `quoting` "Quoting" (`quoted`, `negotiating`); `to_confirm` "To confirm" (`accepted`); `production` "Production" (`confirmed`, `in_production`, `rework`); `finishing` "Completion & delivery" (`completed`, `ready_for_delivery`, `delivered`); `on_hold` "On hold" (collapsed by default). `draft`, `closed`, `cancelled` never on the board.
Board UI: horizontally scrollable columns (min-w 288 px, scroll-snap on tablet), header label + count + "Open in list". `OrderBoardCard`: number (mono) + `StatusBadge` + attention flag (`triangle-alert` danger if overdue, `clock` warning otherwise, tooltip), customer, title (1 line), item count, quote total, assignee avatars, unread badge, "{n} d in state". Sorted by `stateChangedAt` asc. **No drag-and-drop** (decided: transitions need dialogs). > 50 → "+{n} more — open in list".
List UI: `FilterBar` (state multi-select grouped by column, assignee, production assignee, date range + field, include closed) + queue segmented control (All / Needs attention / To call / Mine / Unassigned) + search. `DataTable`: select (with `can.bulkAssign`), Number, Customer, Title (hideBelow lg), State, Assignee, Items (hideBelow lg), Quote total, Submitted, In state since, Attention. Bulk bar: "{n} selected" + **Assign to…** → `admin.orders.bulk-assign` (only Active orders selectable). 25 per page.
Empty: board `inbox` "No active orders" / "New orders appear here as soon as customers submit them."; filtered list → no-results.
Real-time: reload `columns`/`orders` (throttled 10 s); paused while a selection exists ("New updates — refresh" pill).
Acceptance: `queue=to_call` lists exactly `accepted` orders by `accepted_at`; bulk assign dispatches `order.assigned` once per changed order.

### 5.3 Order detail — `admin.orders.show` · `Admin/Orders/Show`
Query `tab` ∈ `overview` | `items` | `proposals` | `quotes` | `production` | `messages` | `calls` | `activity`.
Props:
```ts
interface AdminOrderShowProps {
  order: AdminOrderData;
  items: AdminOrderItemData[];
  staffOptions: { estimators: UserRefData[]; production: UserRefData[] };   // active holders of orders.review / production.manage
  proposals: Inertia.Deferred<AdminChangeProposalData[]>;
  quotes: Inertia.Deferred<AdminQuoteData[]>;                               // all versions incl. draft
  calls: ConfirmationCallData[];
  productionUpdates: Inertia.Deferred<ProductionUpdateData[]>;             // incl. internal
  issues: OrderIssueData[];
  delivery: DeliveryData | null;
  timeline: Inertia.Deferred<TimelineEntryData[]>;                          // staff variant incl. internal
  activity: Inertia.Deferred<AuditEntryData[]> | null;                      // audit.view (§16)
  messages: Inertia.ScrollProp<MessageData>;                                // incl. internal notes
  lastReadMessageId: Ulid | null;
  productionStages: ProductionStageData[];
  lastVisibleProgress: number;
  cancelReasons: ('customer_withdrew' | 'quote_declined' | 'declined_on_call' | 'unresponsive' | 'staff_cancelled' | 'duplicate' | 'other')[];   // allowed now
  settings: { requireCompletionPhotos: number; maxNegotiationRounds: number; quoteValidityDays: number; reminderAfterHours: number };
}
```

#### 5.3.1 Structure
- `PageHeader`: "Order {number}", description = title; meta `StatusBadge` (staff), attention flag, "In state for {duration}", customer link. Actions: the state's primary action (max 1 primary + 2 secondary) + overflow: Print order sheet, Hold/Resume, Cancel, Copy customer link (`links.order` URL), View in audit log (`audit.view`).
- `Stepper` (staff labels); cancelled → danger Alert (reason + note); on hold → warning Alert (reason, since).
- ≥ 1280: tabs (8/12) + sticky **right rail** (4/12); 1024–1279: rail below the action panel; < 1024: rail cards in an "Order info" accordion at the top of Overview.
- Tabs with counts: Overview · Items · Proposals · Quotes · Production · Messages (unread) · Calls · Activity (`audit.view`).

#### 5.3.2 Right rail
- **Customer**: avatar, name (→ `admin.customers.show`), phone `tel:` + WhatsApp link + verified pill, email + pill, local time (customer timezone), orders count, internal notes excerpt + **Edit** (`customers.manage` → `admin.customers.notes.update`).
- **Assignment**: Estimator `Select` (`can.assign`), Production `Select` (`can.assignProduction`) → `admin.orders.assign`.
- **Key dates**: non-null milestones; preferred delivery; **expected delivery** (bold).
- **Money**: current quote total + status + valid until; accepted total; with `can.viewCosts`: cost `costSnapshot.totals.directCostMinor` and margin `(total excl. tax − cost) / total excl. tax` (danger < 10 %).
- **Site**: address + map link (`https://www.google.com/maps/search/?api=1&query={encoded}`), installation yes/no.

#### 5.3.3 Staff action panel (Overview, top)

| State | Title / body (`admin.orders.panel.{state}.*`) | Primary | Secondary |
|---|---|---|---|
| `draft` (submitted before) | "Customer is editing the order" / "Reopened {since}." | — | Message customer (no transitions apply) |
| `submitted` | "New order — not picked up yet" / "Submitted {ago}." + customer notes | **Start review** (T4) | Assign · Hold · Cancel (T28) |
| `in_review` | "Reviewing" / draft status lines ("Proposal draft #2 — 1 item edited", "Quote draft v3 — {total}") | **Create quote** / **Continue quote** | **Propose changes** / **Continue proposal** · Send quote (when a draft exists & no blockers) · Hold · Cancel |
| `changes_proposed` | "Waiting for the customer to review proposal #{n}" / "Sent {ago}." | — | Withdraw proposal (T8) · Hold · Cancel |
| `quoted` | "Quote {number} sent — waiting for the customer" / "{total} · valid until {date}" | — | View quote · Hold · Cancel |
| `negotiating` | "Counter-offer received" / message, target vs current total (delta), item comments, round {used}/{max} | **Revise quote** (→ `admin.orders.quotes.store {fromQuoteId, negotiationId}`) | **Keep price** (T12) · Hold · Cancel |
| `accepted` | "Call the customer to confirm" / phone, accepted total, call stats | **Log call** (§5.7) | **Mark confirmed** (T16) · Back to negotiation (T17, after a `customer_wants_changes` call) · Cancel (T18 when `can.cancelAfterCall`, else T28) · Hold |
| `confirmed` | "Confirmed — expected delivery {date}" | **Start production** (T19) | Post update · Log call · Hold · Cancel |
| `in_production` | "In production — {stage} {progress}%" + latest update | **Post update** | **Mark completed** (T20) · Hold · Cancel (T30, owner) |
| `completed` | "Waiting for the customer to check the photos" / "Completed {ago}." | — | Message customer · Hold · Cancel (owner) |
| `rework` | "Rework — {open} open issue(s)" | **Resolve issues** (→ Production tab) | Post update · Mark completed (only with no open/in-progress issues) · Hold · Cancel (owner) |
| `ready_for_delivery` | scheduled ? "Delivery scheduled {window}" : "Schedule the delivery" | **Schedule delivery** / **Record delivery** | Record delivery (T24) · Reschedule · Hold · Cancel (owner) |
| `delivered` | "Delivered {date} — {installed}" / "Closes automatically on {date} if there are no issues." | **Close order** (T25) | Raise issue for customer (T31) · Hold · Cancel (owner) |
| `closed` | "Closed {date}" | — | — |
| `cancelled` | (Alert) | — | — |
| `on_hold` | "On hold since {date}" / reason, previous state | **Resume** (T27) | Cancel (T28) |

#### 5.3.4 Overview tab
Action panel; **Customer request** card (notes, preferred date, installation); latest production update + `ProductionProgress`; **Timeline** (`<Deferred>`, internal entries marked with `lock` and dashed border).

#### 5.3.5 Items tab
Per item: `Thumbnail3D` (interactive), name, template, `DimensionText`, quantity (`number-field` when `can.editItems`; Confirm "The customer will be notified that the quantity changed."), room, customer notes, **staff notes** (textarea, save on blur, `can.editStaffNotes`), pinned revision `#n` + reason, BOM status pill (`failed` → **Recompute** with `quotes.create`), engine issue counts, server unit price (+ direct cost with `can.viewCosts`), **Open design** (→ `admin.orders.items.show`).

#### 5.3.6 Proposals tab
- No draft & `can.createProposal` → card "Suggest design changes to the customer" + **Propose changes** (`admin.orders.proposals.store`).
- **Draft card**: message textarea (≤ 5000, saved on blur → `admin.orders.proposals.update`, "Message to the customer"); every order item: "Not changed" + **Edit design** (`admin.orders.proposals.items.store` → builder) | "Edited" + **Continue editing** (`editHref`) + **Discard changes** (Confirm → `admin.orders.proposals.items.destroy`) + **Note to customer** (≤ 2000, saved on blur). Footer: **Preview** (≥ 1 edited) → preview page; **Send to customer** (T6; Confirm "Send proposal #{n} with {k} changed item(s)? The order will wait for the customer's decision."; 422 `proposal_empty` → `proposals.errors.empty` "None of the edited designs differ from the current version."; engine errors in a staff draft block sending per 09 T6); **Discard draft**.
- **Sent/resolved/withdrawn** cards: status, sent date, message, per item `DiffList` (major; expand), price before/after, customer decisions + comments; **Withdraw** on the sent one (`can.withdrawProposal`).
- Phone: read-only (no edit buttons).

#### 5.3.7 Quotes tab
- **Draft** card: version, total, last saved, **Open builder**, **Preview PDF**, **Delete draft**.
- **Create quote** / **Revise quote** (`can.createQuote`, states `in_review`/`negotiating`, no draft).
- Versions (newest first): `QuoteView` staff variant (hidden lines with `eye-off` "Hidden from customer"; internal notes and cost/margin block with `can.viewCosts`), status, dates, **Download PDF** (`pdfStatus`), negotiations under their quote (customer message, target, item comments, staff answer).
- **Keep price** dialog (T12): answer* (≤ 2000, "Explain why the price stays the same"), optional **Extend validity to** (`DateInput` ≥ current `validUntil`, ≤ today + 90) → `admin.orders.negotiations.keep-price`.

#### 5.3.8 Production tab
1. Progress header: `ProductionProgress`, stage, expected delivery, production assignee; **Post update** / **Mark completed** / **Start production** per `can`.
2. **Issues**: cards (photos, item, description, raised date); `can.resolveIssue` → status `Select` (In progress / Resolved / Rejected) + resolution note (required for resolved/rejected: `issues.errors.note_required` "Add a note for the customer.") → `admin.orders.issues.update`. **Raise issue for customer** (T31) when `can.raiseIssue`.
3. **Delivery** card + **Schedule/Reschedule** / **Record delivery**.
4. **Updates** list (deferred), internal ones with a warning "Internal" pill.

#### 5.3.9 Messages tab
`MessageThread` (staff) with composer toggle "Reply to customer" / "Internal note" (`can.postInternalNote`) → `admin.orders.messages.store`. When the customer thread is closed (09 90-day rule), replies are disabled but internal notes remain.

#### 5.3.10 Calls tab
Chips (total, no answer, last call); table (called at, staff, phone, outcome `admin.call_outcomes.{outcome}`, notes, callback at); **Log call** (`can.logCall`).

#### 5.3.11 Activity tab (`audit.view`)
`<Deferred data="activity">`: `AuditEntryData[]` (§16) for the order and its children, newest first, diff expandable.

#### 5.3.12 Real-time
Subscribe to `orders.{id}` **and** `orders.{id}.internal` (`13` §8.10). `OrderStateChanged` → reload `order`, `items`, `timeline`, `quotes`, `proposals`, `calls`, `issues`, `delivery` + toast "Order updated by {actor}" (actor ≠ me); `MessagePosted` (either channel) → append; `QuoteSent`/`ChangeProposalSent`/`ProductionUpdatePosted` → reload related props. Polling fallback 30 s. Open dialogs show "This order just changed to {state}." when the state changes.

#### 5.3.13 Print order sheet
`OrderPrintSheet` (print-only): `PrintHeader`, number/title/state, customer + phone + site address, installation, expected delivery, items (name, dims, qty, room, staff notes), accepted total, production assignee.

#### 5.3.14 Phone behaviour
Compact header, scrollable tabs, **sticky bottom action bar** with the state's primary action — `confirmed`/`in_production`/`rework`: **Post update** (full-screen `Drawer` composer); `accepted`: **Log call**; `ready_for_delivery`: **Record delivery**. Builder links show "Open on a larger screen".

#### 5.3.15 Acceptance
- Per state, the panel offers exactly the `09` actions filtered by the user's permissions/gates (browser tests with owner, admin, estimator, production, support).
- Support sees order, messages, calls, can log calls (`orders.confirm`) and no costs.
- Production staff on a 390 px phone post an update with 3 camera photos (compressed ≤ 2560 px) that appears in the timeline.

### 5.4 Transition & action dialogs
`Dialog` (desktop/tablet) or full-screen `Drawer` (phone); submit disabled while processing; errors inline; success → close, toast `admin.orders.toasts.{action}`, partial reload.

| Dialog | Fields (validation → message) | Submits |
|---|---|---|
| **Hold (T26)** | `reason`* ≤ 500 → `orders.errors.hold_reason_required` "Give a reason for putting the order on hold." | `admin.orders.hold` |
| **Resume (T27)** | Confirm "Resume to {state}?" | `admin.orders.resume` |
| **Cancel (T18/T28/T30)** | `reason`* radio from `cancelReasons` (`orders.cancel_reasons.*`: Customer withdrew, Quote declined, Declined on call, Unresponsive, Cancelled by us, Duplicate order, Other); `note`* ≤ 2000 → `orders.errors.cancel_note_required` "Add a note explaining the cancellation."; T30 additionally `requireText` = order number + warning "This order is already in production."; copy "The customer will be notified and the designs unlocked." | `admin.orders.cancel` |
| **Close (T25)** | Confirm "Close order {number}? The customer's designs will be unlocked."; open issues → `orders.errors.open_issues` "Resolve all issues before closing." | `admin.orders.close` |
| **Start production (T19)** | Confirm "Start production? The customer will be notified." | `admin.orders.start-production` |
| **Raise issue (T31)** | `description`* ≤ 2000, `orderItemId` (Whole order / item), photos (`issue_photo`, ≤ 10); "The order will move back to rework." | `admin.orders.issues.store` |
| **Schedule delivery** | date* (`DateInput` ≥ today), from* time, to time (> from; `delivery.errors.window` "End time must be after start time.") → `scheduledFor`/`scheduledUntil` (business TZ); notes ≤ 2000 ("Shared with the customer") | `admin.orders.delivery.schedule` |
| **Record delivery (T24)** | `deliveredAt`* (`DateTimeInput`, default now, ≤ now: `delivery.errors.future` "Delivery time can't be in the future."), `installed` (default `needsInstallation`), `recipientName` ≤ 120, `notes` ≤ 2000, photos ≤ 20 (`delivery_photo`) | `admin.orders.deliver` |
| Keep price, Log call, Mark confirmed, Post update, Mark completed | §5.3.7, §5.7, §5.8 | |

### 5.5 Quote send dialog (T9/T13)
Shows version, total, line count; **Valid until** (`DateInput`, default draft `validUntil`, min tomorrow, max today + 90: `quotes.errors.valid_until_range` "Choose a date between tomorrow and {max}."); who is notified (customer email/phone, channels); **send blockers** checklist (`sendBlockers`): `bom_pending` "Some designs are still being calculated.", `bom_failed` "A design's calculation failed — recompute it.", `no_lines` "Add at least one line.", `below_minimum` "The total is below the minimum order value of {min}.", `proposal_sent` "A change proposal is waiting for the customer.", `wrong_state` "Quotes can only be sent while the order is in review or negotiating.", `stale` "This draft was changed elsewhere — reload."; when `negotiating`: **Answer to the customer*** (≤ 2000, `quotes.errors.answer_required` "Write a reply to the customer's counter-offer."). **Send quote** (`quotes.send`; users with only `quotes.create` see "Ask a colleague with send permission").

### 5.6 Item design viewer — `admin.orders.items.show` · `Admin/Orders/ItemDesign`
Query `tab` ∈ `model` | `cut_list` | `edge_banding` | `hardware` | `sheets` | `costs` | `issues` | `revisions`; `revision` (default pinned).
Props:
```ts
interface ItemDesignProps {
  order: Pick<AdminOrderData, 'id' | 'number' | 'title' | 'state' | 'customer' | 'project'>;
  item: AdminOrderItemData;
  revision: {
    id: Ulid; number: number; reason: string; author: UserRefData | null; authorKind: 'customer' | 'staff'; createdAt: IsoDateTime;
    document: FurnitureDocument;
    bomStatus: 'pending' | 'ready' | 'failed';
    bom: Bom | null;                       // 03 §3.2 (server)
    price: PriceBreakdown | null;          // 03 §3.3 — only with quotes.view_costs
    engineVersion: string | null; catalogVersion: number | null;
    changeSummary: ChangeItem[] | null;
  };
  revisions: { id: Ulid; number: number; reason: string; authorKind: string; createdAt: IsoDateTime; isPinned: boolean }[];
  catalogLabels: { materials: Record<string, string>; edgeBands: Record<string, string>; hardware: Record<string, { name: string; category: string; unit: string }>; finishes: Record<string, string> };   // code → name (incl. archived)
  can: { viewCosts: boolean; saveAsPreset: boolean; recompute: boolean };
}
```
- `PageHeader` "{item}" ("Order {number} · Revision #{n} ({reason}) · Qty {quantity}"), back → Items tab. Actions: **Export cut list** (CSV / PDF via `08` §8 routes), **Save as preset** (`can.saveAsPreset`; dialog name*, category*, description → `admin.furniture.save-as-preset` `source=revision`), revision `Select`.
- BOM `pending`: BOM tabs show `LoadingState` + "Calculating materials… this usually takes a few seconds."; poll `api.furniture-revisions.bom-status` every 5 s then reload `revision`. `failed`: `ErrorState` + **Recompute** (`can.recompute`).
- Tabs: **Model** (read-only viewer from `07`, 3D + elevation, dims, materials per role via `catalogLabels`, notes); **Cut list** (`DataTable` of `bom.cutList`: #, Part `t(nameKey, nameParams)`, Material (name + mono code), T, Length, Width, Cut L, Cut W, Qty, Grain icon, Edges L1/L2/W1/W2 chips; totals; lengths always in **mm**); **Edge banding** (code, name, metres 2 dp); **Hardware** (code, name, category, qty, unit, reason); **Sheets & nesting** (per material: sheets billed/nested, utilisation, net area; `NestingSheetSvg` per sheet — fit-width scale, hatched trim, labelled parts, ↻ for rotated, dashed guillotine cuts `--dimension`; **Print sheets** one per page; unplaced parts → danger Alert `bom.part_exceeds_sheet`); **Costs** (`can.viewCosts` only — `PriceBreakdown` lines and totals: material, edge band, hardware, finishing, labour, direct cost, overhead, margin, unit price, installation, total before tax; note "Computed with catalog v{n}, engine {v} on {date}"; warning when the catalog changed since); **Issues** (BOM + model issues incl. `furniture.override_orphaned`); **Revisions** (list; `DiffList` vs previous).
Phone: Model, Cut list (card rows), Hardware readable.
Acceptance: production staff can export the cut list but never see the Costs tab.

### 5.7 Confirmation calls
#### 5.7.1 Log call dialog
Header (09 §7): customer name, phone large + **Call now** (`tel:`) + WhatsApp link, customer local time, latest call-back request message (template `callback_request`), accepted quote total, items (name × qty).
Fields: `calledAt`* (`DateTimeInput`, default now, ≤ now + 5 min), `phoneE164`* (default customer phone), `outcome`* radio cards (Confirmed · No answer · Call back requested · Wrong number · Wants changes · Declined), `notes` (≤ 2000; required for `customer_wants_changes`/`customer_declined`: `calls.errors.notes_required` "Summarise what the customer said."), `callbackAt` (required for `callback_requested`, future: `calls.errors.callback_future` "Choose a future time.").
Follow-ups when the order is `accepted`: `confirmed` → checkbox **Mark the order confirmed now** (default on, `can.confirm`) revealing `expectedDeliveryOn`* + production assignee → `admin.orders.confirm` with `call`; `customer_wants_changes` → **Move back to negotiation** (default on) → `admin.orders.back-to-negotiation` `{ call, message: notes }`; `customer_declined` → **Cancel the order** (default on) → `admin.orders.cancel` `{ reason: 'declined_on_call', note: notes, call }`; `no_answer` → info "No-answer calls so far: {n}. After 3 you can cancel the order as unresponsive." (customer gets `call.no_answer`). Unchecked follow-ups → `admin.orders.calls.store`.
#### 5.7.2 Mark confirmed (T16)
`expectedDeliveryOn`* (`DateInput` ≥ today; default today + accepted `leadTimeDays`; `orders.errors.expected_delivery_required` "Set the expected delivery date."), `productionAssigneeId`; embeds call fields (outcome fixed `confirmed`) when no confirmed call exists. "The customer will be notified that the order is confirmed." → `admin.orders.confirm`.

### 5.8 Production
#### 5.8.1 Production update composer
Desktop/tablet right `Sheet` (w-[480px]); phone full-screen `Drawer` with large controls. States `confirmed`, `in_production`, `rework`.
- **Stage*** (`productionStages`; default = stage after current `productionStage`, first if none; rework: free choice).
- **Progress*** `Slider` + number; default stage `defaultProgress` clamped to `[lastVisibleProgress, 99]`; min `lastVisibleProgress` for customer visibility (0 for internal); max 99. Errors `production.errors.progress_min` "Progress can't go below {min}%.", `production.errors.progress_max` "Use “Mark as completed” for 100%."
- **Title*** ≤ 160 (default stage label). **Details** ≤ 5000.
- **Photos** `ImageUploader` (`production_photo`, ≤ 20, camera prominent on phones, client compression).
- **Visible to customer** `Switch` (default on; off → "Internal — only staff will see this update").
Submit **Post update** (disabled while uploads run: "Waiting for photos to upload…") → `admin.orders.production-updates.store`. Unsent text kept in `localStorage['fs:produpdate:{orderId}']` (try/catch).
#### 5.8.2 Mark completed (T20)
Title* (default `production.completion_title` "Your furniture is ready"), message ≤ 5000, photos* (min `requireCompletionPhotos`, max 20: `production.errors.completion_photos` "Add at least {min, plural, one {# photo} other {# photos}}."). Rework blockers listed. "The customer will be asked to check the photos and approve." → `admin.orders.complete`.

### 5.9 Quote builder — `admin.orders.quotes.edit` · `Admin/Orders/QuoteBuilder`
Draft only (else redirect to Quotes tab). Desktop/tablet only.
Props:
```ts
interface QuoteBuilderProps {
  order: Pick<AdminOrderData, 'id' | 'number' | 'title' | 'state' | 'customer' | 'needsInstallation' | 'negotiation' | 'can'>;
  quote: AdminQuoteData;
  items: (AdminOrderItemData & { price: PriceBreakdown | null })[];   // cost fields only with quotes.view_costs
  previousQuote: AdminQuoteData | null;
  taxRates: { id: Ulid; name: string; rateBps: number; isDefault: boolean }[];
  settings: { pricesIncludeTax: boolean; minimumOrderMinor: number; quoteValidityDays: number; currency: string; defaultTerms: string };
  sendBlockers: ('bom_pending' | 'bom_failed' | 'no_lines' | 'below_minimum' | 'proposal_sent' | 'wrong_state')[];
}
```
Layout: full width; ≥ 1280 editor 8/12 + sticky summary 4/12; stacked on tablet.
#### 5.9.1 Lines editor
- Groups per order item (header: thumbnail, name, qty, BOM pill, server unit price, unit direct cost with `can.viewCosts`) + **Order-level** group.
- `QuoteLineRow`: drag handle (Alt+↑/↓), Kind (`quotes.line_kinds.*`), Description* ≤ 255, Details (expand → textarea stored as `details.text`; structured `08` details shown read-only), Quantity* (> 0, ≤ 99999.999, 3 dp), Unit ≤ 16 (datalist: item, sheet, m, m², pcs, set, lot), Unit price* (`CurrencyInput`; negative only for `discount`), Tax (`Select` + "No tax"), Visible switch (tooltip "Hidden lines are included in totals but not shown to the customer"), Amount (computed), Delete.
- Group actions **+ Line**; order-level quick adds **+ Installation**, **+ Delivery**, **+ Discount**.
- Toolbar: **Regenerate from designs** (Confirm "Replace all lines with freshly generated ones? Your manual edits will be lost." → `admin.orders.quotes.regenerate`), **Compare with v{n}**.
#### 5.9.2 Summary panel
Live totals with `lib/quoteTotals.ts` (`09` §5): subtotal, discount, tax rows, **Total**, incl./excl. tax label, minimum check. **Cost & margin** (`can.viewCosts`): direct cost, margin amount and % (danger < 10 %, warning < 20 %). Fields: **Valid until*** (default today + `quoteValidityDays`, min tomorrow, max today + 90), **Lead time (days)** 0–365, **Notes to customer** ≤ 5000, **Terms*** ≤ 20 000 ("Reset to default"), **Internal notes** ≤ 5000 (`can.viewCosts`). Negotiation context card when revising (message, target, item comments, difference). Buttons **Save** (+ autosave 2 s; status), **Preview PDF** (save then open `admin.orders.quotes.preview`), **Send** (§5.5; disabled with blocker tooltip), overflow **Delete draft**.
#### 5.9.3 Save payload (`admin.orders.quotes.update`)
```ts
{
  updatedAt: IsoDateTime;                   // lock token → 409 'version_conflict' (dialog: Reload / Overwrite)
  validUntil: IsoDate; leadTimeDays: number | null;
  notesToCustomer: string | null; terms: string; internalNotes: string | null;
  lines: { id?: Ulid; orderItemId: Ulid | null; kind: string; description: string; details: Record<string, unknown> | null;
           quantity: string; unit: string; unitPriceMinor: number; taxRateId: Ulid | null;
           isVisibleToCustomer: boolean; sortOrder: number }[];
}
```
Server recomputes `amount_minor` and totals (`QuoteCalculator`) and returns the quote (`only: ['quote', 'sendBlockers']`). Messages: `quotes.errors.no_lines` "Add at least one line."; description "Describe this line."; quantity "Enter a quantity greater than 0 with up to 3 decimals."; `quotes.errors.discount_negative` "Discount lines must have a negative price."; `quotes.errors.price_positive` "Price can't be negative."; tax rate active; item belongs to order; `validUntil` range; terms required.
Acceptance: client totals equal server totals for every fixture in `tests/fixtures/quotes/*.json`; sending produces the PDF and moves the order to `quoted`.

### 5.10 Proposal item builder — `admin.orders.proposals.items.edit` · `Admin/Orders/ProposalItemEdit`
EditorLayout with the builder in **proposal mode** (`07` §8.2: banner "Proposal mode — the customer will review these changes", **Preview changes**, **Back to order**, autosave to `api.change-proposal-items.draft`). Page props additions: `order: Pick<AdminOrderData, 'id' | 'number' | 'customer'>`, `proposal: { id: Ulid; number: number; status: 'draft' }`, `proposalItem: { id: Ulid; orderItemId: Ulid; itemName: string; fromRevisionId: Ulid; staffNote: string | null }`, `otherItems: { proposalItemId: Ulid | null; orderItemId: Ulid; name: string; href: string }[]` (switcher in `#topbar-end`). Extra inspector tab "Note to customer" saving via `admin.orders.proposals.update`. Proposal no longer a draft → 409 → read-only banner with link back.

### 5.11 Proposal preview — `admin.orders.proposals.preview` · `Admin/Orders/ProposalPreview`
Props `{ order: Pick<AdminOrderData, 'id' | 'number' | 'title' | 'state'>; proposal: ChangeProposalData /* server-computed diffs */; droppedItems: string[] }`. Renders `ProposalReviewBody` (`10` §11.5) with `preview = true` under a sticky banner "Preview — this is what the customer will see" + **Back** + **Send to customer** (T6). `droppedItems` → notice "These items have no changes and will be dropped: …".

---

## 6. Customers

### 6.1 List — `admin.customers.index` · `Admin/Customers/Index`
Props: `{ customers: Paginated<AdminCustomerRowData>; filters: { search: string | null; status: 'active' | 'deactivated' | 'pending_deletion' | 'all'; hasActiveOrders: boolean | null; from: IsoDate | null; to: IsoDate | null; sort: string }; can: { create: boolean } }`.
```ts
interface AdminCustomerRowData {
  id: Ulid; name: string; email: string | null; emailVerified: boolean; phoneE164: string | null; phoneVerified: boolean;
  projectCount: number; activeOrderCount: number; acceptedTotalMinor: number;
  aiBalance: number; lastLoginAt: IsoDateTime | null; createdAt: IsoDateTime; isActive: boolean; deletedAt: IsoDateTime | null;
}
```
Search name/email/phone digits; sort `-created_at` (default), `name`, `-last_login_at`, `-active_order_count`. Columns: Name (+ "Deactivated" / "Pending deletion" pills), Contact (verified icons), Projects, Active orders, Accepted value (hideBelow lg), AI credits, Last login, Joined. **New customer** (`customers.manage`): name*, email, phone (one required: `customers.errors.contact_required` "Enter an email or a phone number."), **Email a link to set a password** (email only) → `admin.customers.store` → customer page. Customer lists are not exportable (`13` §16).
Empty: `users` "No customers yet".

### 6.2 Detail — `admin.customers.show` · `Admin/Customers/Show`
Query `tab` ∈ `overview` | `projects` | `orders` | `credits` | `notifications` | `activity`.
Props:
```ts
interface AdminCustomerShowProps {
  customer: AdminCustomerCardData & { unitSystem: string; lengthUnit: string; locale: string; lastLoginAt: IsoDateTime | null; marketingOptIn: boolean; signInMethods: { password: boolean; phone: boolean; google: boolean } };
  addresses: AddressData[];
  projects: ProjectSummaryData[];
  orders: OrderBoardCardData[];
  credits: CreditSummaryData;              // 18
  ledger: Inertia.Deferred<Paginated<AiLedgerEntryData>>;   // 18 CustomerLedgerQuery (staff variant incl. reservations)
  recentDeliveries: Inertia.Deferred<NotificationDeliveryData[]>;   // §15, last 20
  activity: Inertia.Deferred<AuditEntryData[]> | null;
  can: { update: boolean; notes: boolean; deactivate: boolean; activate: boolean; passwordLink: boolean; createProject: boolean; grantCredits: boolean; restore: boolean; anonymise: boolean };
}
interface AiLedgerEntryData { id: Ulid; delta: number; kind: string; note: string | null; createdAt: IsoDateTime; reference: { type: 'blueprint_import'; id: Ulid; label: string; href: string } | null; createdBy: UserRefData | null }
```
Header: avatar, name, pills (Active / Deactivated / Pending deletion until {date}, verified), actions **Edit** (name, email, phone, units, timezone → `admin.customers.update`; changing email/phone clears verification per `13`), overflow: Send password link, Deactivate (`ReasonDialog`, note required; "The customer won't be able to log in. Active orders continue.") / Activate, **New project for customer** (→ `admin.customers.projects.store` → `admin.projects.show`), **Restore account** (pending deletion; `admin.customers.restore`), **Anonymise now** (gate `data.delete`; destructive, `requireText` = "ANONYMISE"; `13` §9).
Tabs: **Overview** (contact links, timezone/units, addresses, **Internal notes** editable with `can.notes` — "Only staff can see these notes.", order stats); **Projects** (→ `admin.projects.show`); **Orders**; **AI credits** (`18` §15.3: balance card, **Grant** / **Revoke** dialogs — amount* 1–1000, note* 3–255 → `admin.customers.ai-credits.grant|revoke`; revoke > balance → `credits.errors.revoke_exceeds` "You can revoke at most {balance} credits."; ledger); **Notifications** (recent WhatsApp/SMS deliveries + link to the log filtered by user); **Activity** (`audit.view`).
**No impersonation in v1** (`13` S8). Staff view customer projects read-only; `plans.edit_any` allows editing plans and unlocked designs.

### 6.3 Customer project — `admin.projects.show` · `Admin/Projects/Show`
Props `{ project: ProjectData & { owner: { id: Ulid; name: string } }; plans: PlanSummaryData[]; designs: FurnitureDesignSummaryData[]; orders: OrderBoardCardData[]; imports: ImportSummaryData[]; can: { editPlans: boolean; createDesign: boolean; startImport: boolean } }`. Same sections as `10` §7.3 without customer actions; plans → `admin.plans.edit`; designs → `admin.furniture.edit`; imports → `admin.imports.show`; **New design for customer** (`plans.edit_any` → `admin.furniture.create?project=`). Starting a blueprint import on a customer's behalf is allowed by policy (`13` §7.2) but has no admin page in v1 (staff ask the customer to upload, or trace in the plan editor's background tools per `05`).

### 6.4 Customer plan — `admin.plans.edit` · `Admin/Plans/Edit`
Props as `10` §8.2 plus `customer: { id: Ulid; name: string }`; `canLock = can('plans.edit_any')` (lock/unlock via `api.plans.lock.store|destroy`, 05 §1.4); `readOnly` = true with `readOnlyReason = 'no_permission'` without `plans.edit_any`, `'plan_locked'` while the plan is locked, `'archived'` for archived projects (and on phones). Banner when editing: `admin.plans.editing_banner` "You're editing {customer}'s plan. A backup revision is saved before your first change." (`03` §5 staff_edit). Back → `admin.projects.show`. No placement handoff.

### 6.5 Customer furniture — `admin.furniture.create`, `admin.furniture.edit`
Owned by `07` (`Admin/Furniture/Create` with project picker; `Admin/Furniture/Edit` mode `staff` for unlocked designs with `plans.edit_any`, else `readonly`; banner "Editing {customer}'s design"). Page addition: **Save as preset** in `#topbar-end` (`presets.manage`, `source=working`); locked designs link to their order.

---

## 7. Staff management — `admin.staff.index` · `Admin/Staff/Index`
Props:
```ts
interface StaffIndexProps {
  staff: StaffRowData[];                      // all staff users incl. deactivated, by name
  invitations: StaffInvitationRowData[];      // pending + expired in the last 30 days
  roles: { name: 'owner' | 'admin' | 'estimator' | 'production' | 'support'; label: string; description: string; assignable: boolean }[];
  currentUserId: Ulid;
}
interface StaffRowData {
  id: Ulid; name: string; email: string; role: string; twoFactorEnabled: boolean; twoFactorRequired: boolean;
  isActive: boolean; lastLoginAt: IsoDateTime | null; googleLinked: boolean;
  can: { edit: boolean; deactivate: boolean; activate: boolean; resetTwoFactor: boolean };
}
interface StaffInvitationRowData { id: Ulid; email: string; name: string; role: string; invitedBy: UserRefData | null; expiresAt: IsoDateTime; expired: boolean; createdAt: IsoDateTime }
```
UI: `PageHeader` "Staff" + **Invite staff member**. **Members** table: Name/email, Role badge, 2FA (`shield-check` "On" / `shield-alert` danger "Off — required" / neutral "Off"), Status, Last login, menu (Edit role/name → `admin.staff.update`; Deactivate/Activate; Reset 2FA → Confirm "They'll have to set up two-factor authentication again." → `admin.staff.two-factor.reset`). **Invitations** table: email, name, role, invited by, expires (or "Expired"), **Resend** (`admin.staff.invitations.resend`, extends expiry), **Revoke** (Confirm → `admin.staff.invitations.revoke`).
Invite dialog: name* (≤ 120), email*, role* (radio with descriptions; `owner` only with gate `staff.manage_owners`) → `admin.staff.invitations.store`. Errors (`13` §5.9/§7.3): `staff.email_in_use` "This email already belongs to an account.", `staff.invitation_pending` "An invitation is already pending — resend it instead.", `staff.last_owner` "There must be at least one active owner.", admins cannot change their own role or deactivate themselves (`staff.errors.self` "You can't change your own account here.").

### 7.1 Accept invitation — `staff.invitations.show` · `Auth/AcceptInvitation` (or `Auth/InvitationInvalid`)
Per `13` §5.9: `AcceptInvitation` props `{ invitation: { email: string; name: string; roleLabel: string; expiresAt: IsoDateTime }; googleEnabled: boolean; prefillName: string | null }`: email (read-only), name, password, confirmation, optional **Continue with Google**, **Create my account** → `staff.invitations.accept` → `admin.dashboard` (owners/admins forced to 2FA enrolment). `InvitationInvalid` props `{ reason: 'expired' | 'invalid' | 'accepted' | 'revoked' | 'signed_in' }` → message + (for `signed_in`) **Sign out** button.

---

## 8. Catalog management

### 8.1 Common table page (`components/admin/catalog/CatalogTablePage.vue`)
Props of every catalog page:
```ts
interface CatalogPageProps<T> {
  rows: Paginated<T>;                         // per_page 50
  filters: { search: string | null; status: 'active' | 'hidden' | 'archived' | 'all'; sort: string; [k: string]: unknown };
  options: Record<string, { value: string; label: string }[]>;   // enums for selects
  catalogVersion: number;
}
```
UI: `PageHeader` (title + "Changes apply to new estimates immediately and to quotes built afterwards."), **Add** (not labour rates), **Import CSV** (→ `admin.catalog.{t}.import`), **Export CSV**. Status segmented: Active / Hidden (`is_active = false`) / Archived (soft-deleted; four tables) / All. Search (code, name). `DataTable`; row → edit `Sheet` (w-[560px]; phone full-screen) with **Save** and **Archive** / **Restore**.
Help popover: **Hide** = not offered for new choices, existing designs keep working; **Archive** = removed from lists, documents using the code show `furniture.archived_code` (`03` §2.4); **no permanent delete** (codes are referenced by immutable revisions and quotes — decided).
`code` immutable after creation ("Codes are referenced by saved designs and can't be changed."). Every write bumps `catalog.version`; toast "Saved. Catalog version {n}."

### 8.2 Tables and form rules
Money: `CurrencyInput` (minor units); percentages `PercentInput`; colours: colour input + hex.
- **Materials** — columns: swatch/texture, Code, Name, Board type, Thickness, Sheet L × W, Grain, Price/sheet, Status; filters board type, surface. Form: `code`* (≤ 40, `^[A-Z0-9][A-Z0-9._-]*$`, unique incl. archived: "This code is already used."), `name`* ≤ 120, `boardType`*, `thicknessMm`* 1.0–100.0 (0.1), `sheetLengthMm`* 300–6000, `sheetWidthMm`* 300–3000, `hasGrain`, `decorName` ≤ 120, `colorHex` (`^#[0-9a-fA-F]{6}$`, stored lower-case), `surface`*, `pricePerSheetMinor`* ≥ 0, `wasteFactor`* 0–0.500 (shown %), `densityKgM3` 50–3000 or empty, `usage`* (≥ 1 of MaterialRole values plus `glass` per 02 §6.1: "Choose at least one use."), `defaultEdgeBandCode`, `isActive`, `sortOrder`, texture (`ImageUploader` single, purpose `material_texture`; "seamless 1024 × 1024").
- **Edge bands** — Code, Name, Thickness × Width, Price/m, Status. Form: `code`*, `name`*, `thicknessMm`* 0.10–5.00, `widthMm`* 10–100, `colorHex`, `pricePerMeterMinor`* ≥ 0, `isActive`.
- **Hardware** — image, Code, Name, Category, Unit, Price, Defaults, Status; filter category. Form: `code`*, `name`* ≤ 160, `category`*, `unit`*, `priceMinor`* ≥ 0, **specs** (category fields from `resources/js/lib/catalog/hardwareSpecFields.ts` mirroring `08` §2.3; fallback JSON textarea: `catalog.errors.specs_json` "Specs must be a valid JSON object."), `isDefaultFor` (`tags-input` of role keys from `07` §6.11: `catalog.errors.default_role_unknown` "Unknown role key {key}."; one item per key enforced by the Upsert action), image (`hardware_image`), `isActive`, `sortOrder`.
- **Finishes** — swatch, Code, Name, Type, Price/m², Applies to, Status. Form: `code`*, `name`*, `finishType`*, `pricePerSqmMinor`* ≥ 0, `appliesTo`* (≥ 1 board type), `colorHex`, texture (`finish_texture`), `isActive`.
- **Labour rates** — Key (mono), Name, Unit, Rate, Status; no create/archive (keys fixed by `08` §4.3). Form: key (read-only), `name`*, unit (read-only), `rateMinor`* ≥ 0, `isActive`.
- **Tax rates** — Name, Rate %, Default, Status. Form: `name`* ≤ 60 unique, `rateBps`* 0–10000, `isDefault` (setting it unsets the previous default; can't be turned off directly: "Choose another default first."), `isActive` (default can't be hidden). No archive.

### 8.3 CSV import / export
UTF-8 (BOM tolerated), comma, RFC 4180 quoting, header row with **exactly** these columns (any order on import, fixed on export), ≤ 5000 rows, ≤ 2 MB. Booleans `1/0/true/false/yes/no` (export `1`/`0`); money in **major units** with `.` decimals, no grouping/symbol (e.g. `3450.00`); lists `|`-separated; empty = null (error if required). CSV headers keep the DB column names (snake_case).

| Table | Columns (export order) | Match key |
|---|---|---|
| materials | `code,name,board_type,thickness_mm,sheet_length_mm,sheet_width_mm,has_grain,decor_name,color_hex,surface,price_per_sheet,waste_factor,density_kg_m3,usage,default_edge_band_code,is_active,sort_order` | `code` |
| edge-bands | `code,name,thickness_mm,width_mm,color_hex,price_per_meter,is_active` | `code` |
| hardware | `code,name,category,unit,price,specs_json,is_default_for,is_active,sort_order` | `code` |
| finishes | `code,name,finish_type,price_per_sqm,applies_to,color_hex,is_active` | `code` |
| labour-rates | `key,name,unit,rate,is_active` | `key` (unknown keys are errors) |
| tax-rates | `name,rate_percent,is_default,is_active` | `name` (`rate_percent` e.g. `18`, `12.5`; ≤ 1 default) |

Flow: upload → server validates every row with the form rules (+ archived code → "Code {code} is archived. Restore it first.") → parsed result cached under a random token (30 min, user-scoped) → **Import preview** `admin.catalog.imports.show`, props `{ table: string; token: string; filename: string; summary: { create: number; update: number; unchanged: number; errors: number }; rows: { line: number; action: 'create' | 'update' | 'unchanged' | 'error'; code: string; changes: { field: string; before: string | null; after: string | null }[]; errors: string[] }[]; expiresAt: IsoDateTime }`: summary tiles, filter by action, per-row diffs/errors; **Apply import** (disabled with errors: "Fix the errors in your file and upload it again.") → `admin.catalog.imports.commit` (one transaction; rows not in the file untouched; images/textures not in CSV). Expired token → 404 "This preview expired. Upload the file again."
Acceptance: export → import of an unchanged file gives `unchanged = rows`, `errors = 0`; one changed price yields exactly one `update`.

---

## 9. Presets

### 9.1 List — `admin.presets.index` · `Admin/Presets/Index`
Props `{ presets: AdminPresetData[]; categories: { key: string; label: string }[]; templates: { key: string; label: string; isEnabled: boolean }[] }`.
```ts
interface AdminPresetData {
  id: Ulid; name: string; slug: string; category: string; templateKey: string; templateLabel: string;
  description: string | null; isActive: boolean; sortOrder: number;
  thumbnailUrl: string | null; widthMm: number; heightMm: number; depthMm: number;
  templateEnabled: boolean; createdBy: UserRefData | null; updatedAt: IsoDateTime;
}
```
Grouped by category (accordion); rows sortable (drag handle + Alt+↑/↓; optimistic → `admin.presets.reorder`). Row: thumbnail, name, template ("Template disabled" warning pill → hidden from customers), dims, active `Switch`, actions **Edit details** (Sheet: name*, slug* `^[a-z0-9-]+$` unique, category*, description ≤ 2000, active), **Open builder**, Duplicate, Delete (soft; "Existing designs made from it are not affected."). Hint: "Use **Save as preset** on any design or order item." Empty `armchair` "No presets yet" + **New preset**.

### 9.2 New preset — `admin.presets.create` · `Admin/Presets/Create`
Props `{ templates: { key: string; label: string; description: string; icon: string; isEnabled: boolean }[]; categories: { key: string; label: string }[] }`. Choose template (cards), name*, category*, description → `admin.presets.store` (document = template defaults with `default_overrides`, via engine CLI `template-default`, 01 §5.4) → builder.

### 9.3 Preset builder — `admin.presets.builder` · `Admin/Presets/Builder`
EditorLayout, builder in preset mode (`07`; no lock/order logic, explicit save). Props `{ preset: AdminPresetData; document: FurnitureDocument; updatedAt: IsoDateTime; catalogVersion: number }`. **Save preset** → `api.presets.document.update` (`document`, `updatedAt`, thumbnail uploaded first with purpose `preset_thumbnail` → `thumbnailUploadId`); 409 → Reload / Overwrite; 422 → issues list. Unsaved-changes guard. Desktop/tablet only.

### 9.4 Save as preset
Dialog (item viewer, staff furniture editor): name* ≤ 120, category*, description; "A copy of this design is saved as a preset. Customer notes are removed." → `admin.furniture.save-as-preset` (copies document, clears `notes`, `is_active = false` for review; toast with "Open preset").

---

## 10. Templates — `admin.templates.index` · `Admin/Templates/Index`
Props:
```ts
interface TemplatesIndexProps {
  templates: {
    key: string; label: string; description: string; family: 'carcass' | 'table'; icon: string;
    isEnabled: boolean; sortOrder: number; defaultOverrides: Record<string, unknown>;
    codeDefaults: Record<string, unknown>;     // from the 07 registry
    presetCount: number; designCount: number;
  }[];
}
```
Sortable table (→ `admin.templates.reorder`): icon + label, key, family, presets, designs, **Enabled** switch (disable Confirm "Customers won't be able to start new designs from this template or its presets. Existing designs are not affected."), **Defaults** → Sheet with `07`'s `TemplateParamsForm` in defaults mode (overridden fields highlighted), **Reset to code defaults**, **Save** → `admin.templates.update`. Server validation via engine `template-default` + `validate-furniture`; errors → `templates.errors.invalid_defaults` "These defaults produce an invalid design: {issues}". Desktop/tablet only for the Sheet.

---

## 11. Staff exports & print (summary)

| Export | Where | Format | Permission |
|---|---|---|---|
| Quote PDF | Order → Quotes | PDF (`admin.orders.quotes.pdf`) | `orders.view` |
| Draft quote preview | Quote builder | inline PDF, "DRAFT" watermark | `quotes.create` |
| Cut list | Item viewer | CSV / PDF (`08` §8) | `orders.view` |
| Nesting sheets | Item viewer → Sheets | Print | `orders.view` |
| Order sheet | Order overflow | Print (§5.3.13) | `orders.view` |
| Catalog tables | Catalog pages | CSV (§8.3) | `catalog.manage` |
| AI usage | AI usage page | CSV (`18` §15.4) | `ai.manage` |
| Plan exports | Plan editor | per `05` | `customers.view` |

Print follows `15` §16.

---

## 12. Settings pages
Shell: `SettingsNav` — Business · Units · Pricing · Workflow · Notifications · AI · Security (auth) — items hidden without permission/gate. Pages use `FormSection`s and `StickyActionBar` (Discard / **Save changes**) → `admin.settings.{group}.update` (whole group). Toast "Settings saved." Common props: `{ values: <Group>; updatedAt: IsoDateTime | null; updatedBy: UserRefData | null; meta: … }`. Field names are the `02` §13 keys in camelCase (e.g. `quote_validity_days` → `quoteValidityDays`).

### 12.1 Business — `settings.manage`
Meta `{ currencyLocked: boolean /* any quote exists */; canChangeCurrency: boolean /* gate settings.change_currency */; currencies: string[]; locales: string[] /* en-IN, en-US, en-GB, en-AE, en-SG, en-AU */; timezones: string[]; countries: { code: string; name: string }[]; logoUrl: string | null }`.
Fields: name* ≤ 120; legalName ≤ 200; taxId ≤ 32 ("Tax ID (e.g. GSTIN)"); email*; phoneE164 (`PhoneInput`); address (`AddressFields`, all-or-nothing on line1/city/country); currency* (disabled unless `canChangeCurrency && !currencyLocked`; note "Currency can't be changed after the first quote."); locale* (preview "Example: {money} · {date}"); timezone*; logo (`ImageUploader`, purpose `business_logo`, png/jpg/webp ≤ 2 MB; preview on light and dark); quoteTerms* ≤ 20 000; workingHours* ≤ 120.

### 12.2 Units — `settings.manage`
defaultSystem*; defaultLengthUnit* (metric `mm|cm|m`, imperial `ftin|in`); defaultWallHeightMm* 2000–6000; defaultExteriorWallThicknessMm* 50–1000; defaultInteriorWallThicknessMm* 50–1000 (≤ exterior: "Interior walls can't be thicker than exterior walls."); defaultDoorWidthMm* 300–6000; defaultDoorHeightMm* 1500 – wall height ("Door height must be lower than the wall height."); defaultWindowWidthMm* 300–6000; defaultWindowHeightMm* 300–3000; defaultWindowSillMm* 0–3000, sill + height ≤ wall height ("Window doesn't fit in the default wall height."). All via `LengthInput`. Note "Applies to new users and new drawings."

### 12.3 Pricing — `settings.manage`
Meta `{ taxRates: { id: Ulid; name: string; rateBps: number }[]; estimateDisclaimerPreview: string }`.
pricesIncludeTax (warning "Affects new quotes and estimates only."); defaultTaxRateId*; marginBps* 0–50000 ("Markup on cost"); overheadBps* 0–10000; minimumOrderMinor* ≥ 0; roundingMinor* ∈ {1, 100, 500, 1000, 10000} (Select "Round to nearest {amount}"); installationBps* 0–5000; deliveryFlatMinor* ≥ 0; kerfMm* 0.0–10.0 (0.5); sheetTrimMm* 0–50; nestingAllowRotationDefault. `estimateDisclaimerKey` read-only preview. Saving bumps `catalog.version` (note under the save bar).

### 12.4 Workflow — `settings.manage`
Meta `{ usedStageKeys: string[] }`.
quoteValidityDays* 1–90; autoCloseDays* 1–90; reminderAfterHours* 12–168; requireCompletionPhotos* 0–20; allowCustomerCounterOffer; maxNegotiationRounds* 1–20; minPreferredDeliveryDays* 0–90 (02 §13 `workflow.min_preferred_delivery_days`); **productionStages** editor (desktop/tablet): ordered rows (drag), **Key** (editable only for new rows; `^[a-z][a-z0-9_]{1,31}$`, unique, not `completed`: `settings.errors.stage_key`), **Label** (built-in rows show `t(labelKey)` with optional custom `label` override; new rows require `label` ≤ 60), **Default progress*** 1–99 strictly increasing ("Each stage's progress must be higher than the previous one."); delete disabled for `usedStageKeys` ("Used by existing updates — can't be removed."); ≥ 1 stage. Item shape: 02 §13 `workflow.production_stages`.

### 12.5 Notifications — `settings.manage`
Content per `12` (§7.5, §8.1, §6.2, §11): **WhatsApp templates** table (per event × audience, pre-filled from config, fields name / language / components editor per the `notifications.whatsapp_templates` shape of 02 §13, status chips from `whatsapp:templates:check`, **Send test** per row); **SMS** driver (`twilio`\|`msg91`\|`log`) and per-event `textKey` / `dltTemplateId` / `providerTemplateId` (DLT id required for msg91: "DLT template ID is required for MSG91."); **Quiet hours** (enabled, start, end `HH:MM`); **OTP channel order** (sortable `whatsapp`, `sms`); **Staff digest hour** 0–23; **Health** (channel health from `health:whatsapp`/`health:sms`, 30-day counts by status and pricing category, inbound counter); **Recent deliveries** (last 50, masked) with link to the full log (§15). **Send a test** (channel, recipient) → `admin.settings.notifications.test`.

### 12.6 AI — gate `settings.manage_restricted`
Content per `18` §15.2 (provider cards with capability status, model, effort, agentic crops, fallback, credits, limits, budget + behaviour, price table, staff unlimited, **Test connection** → `admin.settings.ai.test`). Note "API keys are configured on the vision service."

### 12.7 Security (auth group) — gate `settings.manage_restricted`
Fields (02 §13 `auth` group, 13 §4): allowCustomerRegistration; otpAllowedCountryCodes (multi-select ISO countries, ≥ 1); otpGlobalHourlyCap 10–10 000; staffSessionAbsoluteHours 1–72. Read-only status: `features.captcha`, OTP conversion monitor banner (`health:otp`).

---

## 13. AI usage & credits

### 13.1 Usage report — `admin.ai.usage` · `Admin/Ai/Usage` (`ai.manage`)
Content per `18` §15.4 (month picker, KPI tiles, budget meter, daily cost `BarChart`, by provider/model table, top users, latest 50 runs linking to `admin.imports.show`, **Export CSV** `admin.ai.usage.export?month=`). Costs in USD (`< $0.01` for tiny values).

### 13.2 Credit ledger — `admin.ai.ledger` · `Admin/Ai/Ledger` (`ai.manage`)
Props `{ entries: Paginated<AiLedgerEntryData & { user: { id: Ulid; name: string } }>; filters: { search: string | null; kind: string[]; from: IsoDate | null; to: IsoDate | null } }` (50/page, all kinds incl. reservations). Filters: user search, kind multi-select, date range. Columns: date, user (→ customer page), kind pill, delta ±, reference, note, by. **Grant / revoke credits** → dialog with customer `Combobox` (`api.customers.search`), kind, amount, note → `admin.customers.ai-credits.grant|revoke`.

---

## 14. Imports monitor

### 14.1 List — `admin.imports.index` · `Admin/Imports/Index` (`customers.view`)
Query: `filter[status]` (multi), `filter[source_kind]`, `filter[provider]`, `filter[mode]`, `filter[from]`/`filter[to]`, `search` (file, customer), `sort` (`-created_at` default, `duration`, `credits_charged`).
Props `{ imports: Paginated<AdminImportRowData>; filters: …; counts: Record<ImportStatus, number> /* last 30 days */ }`.
```ts
interface AdminImportRowData {
  id: Ulid; createdAt: IsoDateTime; user: { id: Ulid; name: string; isStaff: boolean }; project: { id: Ulid; name: string };
  originalFilename: string; sourceKind: string | null; mode: 'auto' | 'trace'; status: ImportStatus;
  aiProvider: string | null; aiModel: string | null; creditsCharged: number; attempts: number;
  durationMs: number | null; errorCode: string | null;
}
```
Status chips (clickable; failed highlighted), table (Started, Customer, File + kind, Mode, Status, Provider/model, Credits, Duration, Error). Refresh button; auto-refresh 30 s while visible rows are non-terminal.

### 14.2 Detail — `admin.imports.show` · `Admin/Imports/Show` (`customers.view`)
Props:
```ts
interface AdminImportShowProps {
  import: ImportStatusData & { user: { id: Ulid; name: string }; attempts: number; errorMessage: string | null };   // 06 + internal message
  source: MediaData | null; normalized: MediaData | null;
  debug: MediaData[];                         // 06 §13 artifacts (01-ink.png … 08-scale.json)
  resultMeta: unknown | null;                 // ImportResultMeta (06 §6)
  resultSummary: { walls: number; openings: number; rooms: number; confidence: { high: number; med: number; low: number } } | null;
  usageEvents: { id: Ulid; provider: string; model: string | null; requestCount: number; inputTokens: number; outputTokens: number; imageCount: number; costMicroUsd: number; durationMs: number; status: string; createdAt: IsoDateTime }[];
  ledger: AiLedgerEntryData[];
  plan: { id: Ulid; name: string; href: string } | null;
  can: { rerun: boolean; refund: boolean };   // ai.manage
}
```
Header: file name, status, customer and project links, created. Actions: **Re-run (free)** (`can.rerun`; dialog "With AI" / "Basic recognition (no AI)" → `api.imports.rerun` `{ useAi }`; "The customer is not charged for staff re-runs."), **Refund credits** (`can.refund`, `creditsCharged > 0`; note* 3–255 → `admin.imports.refund`), **Open plan**.
Sections: **Overview** (mode, kind, MIME, size, pages, selected page, hints, provider/model, attempts, timings, credits reserved/charged); **Error** (code, internal message mono, copy); **Images** (source and normalized side by side, Lightbox); **Debug artifacts** (desktop/tablet): normalized image base with PNG artifacts as toggleable layers (checkbox + opacity), zoom/pan; JSON artifacts in `JsonViewer`; **Result** (counts, confidence bars in `confidence-*` colours with labels, `JsonViewer` of `resultMeta` depth 2); **AI usage** table (USD); **Credits** ledger rows.
Real-time: `useImportChannel` → reload on status change. Phone: overview, error, images only.

---

## 15. Notifications log — `admin.notifications-log.index` · `Admin/NotificationsLog/Index` (`customers.view`)
Binds to `notification_deliveries` (02 §1.7; WhatsApp and SMS only — mail, push and in-app are not recorded).
Query: `filter[channel]` (`whatsapp`\|`sms`), `filter[status]` (multi), `filter[event]`, `filter[from]`/`filter[to]`, `search` (customer name, order number).
Props `{ deliveries: Paginated<NotificationDeliveryData>; filters: …; events: { key: string; label: string }[] }`.
```ts
interface NotificationDeliveryData {
  id: Ulid; createdAt: IsoDateTime; user: { id: Ulid; name: string; isStaff: boolean } | null;
  eventKey: string; channel: 'whatsapp' | 'sms'; driver: string;
  status: 'pending' | 'accepted' | 'sent' | 'delivered' | 'read' | 'failed';
  toMasked: string; templateName: string | null; providerMessageId: string | null;
  errorCode: string | null; errorTitle: string | null; attempts: number;
  pricingCategory: string | null; fallbackOfId: Ulid | null;
  acceptedAt: IsoDateTime | null; sentAt: IsoDateTime | null; deliveredAt: IsoDateTime | null; readAt: IsoDateTime | null; failedAt: IsoDateTime | null;
}
```
Tones: pending/accepted/sent info, delivered/read success, failed danger. Table: time, recipient (masked + user link), event, channel icon (`message-circle` / `smartphone`), status, error. Row → `Sheet` with all fields and a status timeline; "SMS fallback of …" link when `fallbackOfId`. Empty "No deliveries in this period".

---

## 16. Audit log — `admin.audit.index` · `Admin/Audit/Index` (`audit.view`)
Query: `filter[causer]`, `filter[subject_type]` (Order, Quote, ChangeProposal, User, Project, Plan, FurnitureDesign, FurniturePreset, Material, EdgeBand, HardwareItem, Finish, LabourRate, TaxRate, AppSetting, BlueprintImport, StaffInvitation), `filter[subject_id]`, `filter[event]` (prefix, e.g. `order.`), `filter[from]`/`filter[to]`, `search`.
Props `{ entries: Paginated<AuditEntryData>; filters: …; subjectTypes: { value: string; label: string }[] }` (50/page).
```ts
interface AuditEntryData {
  id: number; createdAt: IsoDateTime; logName: string | null; event: string | null; description: string;
  causer: { id: Ulid; name: string; isStaff: boolean } | null;
  subject: { type: string; id: string; label: string; href: string | null } | null;
  properties: Record<string, unknown>;       // masked PII per 13 §17
}
```
Filter bar (causer combobox over `api.staff.search` + `api.customers.search`, subject type, event prefix, dates, search); table (time, causer, event mono, subject link, description); row → `Sheet`: `old`/`attributes` diff table when present, else `JsonViewer`. Read-only, no export.

---

## 17. System health — `admin.system.index` · `Admin/System/Index` (`settings.manage`)
Props (each card a separate deferred group):
```ts
interface SystemIndexProps {
  app: { version: string; environment: string; php: string; laravel: string; engineVersion: string; catalogVersion: number; timezone: string; features: Record<string, boolean> };
  queues: Inertia.Deferred<{ horizonStatus: 'running' | 'paused' | 'inactive'; queues: { name: string; pending: number; waitSeconds: number | null }[]; failedLast24h: number; recentFailed: { id: string; job: string; queue: string; failedAt: IsoDateTime; exceptionHead: string }[] }>;
  scheduler: Inertia.Deferred<{ lastHeartbeatAt: IsoDateTime | null; healthy: boolean }>;   // healthy = heartbeat < 3 min old (same rule as /up/deep, 17)
  vision: Inertia.Deferred<{ reachable: boolean; stale: boolean; latencyMs: number | null; version: string | null; capabilities: unknown | null; error: string | null }>;   // VisionClient::capabilities (18 §5.2)
  gotenberg: Inertia.Deferred<{ reachable: boolean; latencyMs: number | null; error: string | null }>;
  channels: { mail: { driver: string; configured: boolean }; whatsapp: { configured: boolean; healthy: boolean | null }; sms: { driver: string; configured: boolean; healthy: boolean | null }; webpush: { configured: boolean } };
  links: { horizon: string | null; pulse: string | null };
}
```
Cards with status dots: **Application**; **Queues** (Horizon status, pending/wait per queue, failures with recent list, **Open Horizon**); **Scheduler** (heartbeat cache key `health:scheduler:heartbeat`, written every minute, 01 §7); **Real-time** (client Echo state + host); **Vision service** (reachable/stale, latency, version, providers/models, OCR, raw `JsonViewer`); **PDF (Gotenberg)**; **Storage** (**Run check** → `api.system.storage-check`); **Notification channels**; **Open Pulse**. **Refresh** reloads all groups.
Acceptance: with the vision service down the page loads in < 4 s and shows "Unreachable".

---

## 18. Staff account pages
AdminLayout + `AccountNav` (Profile · Security · Two-factor · Preferences · Notifications), reusing `components/account/*` from `10` §13:
- **Profile** (`admin.account.profile`): name/email via Fortify `user-profile-information.update` (email required for staff), phone section with `PhoneVerifyDialog` (`account.phone.*`; staff phones are used for WhatsApp notifications), avatar (`admin.account.avatar.update`).
- **Security** (`admin.account.security`): password (Fortify), Google link/unlink (`13` §5.3), devices/sessions (`13` §6.3).
- **Two-factor** (`admin.security.two-factor`, `Admin/Account/TwoFactor`): per `13` §5.10 — enable (password-confirmed) → QR SVG + setup key → confirm code → 8 recovery codes (copy, download `{app}-recovery-codes.txt`, required "I saved these codes" checkbox), regenerate; **Disable** hidden for owner/admin ("Two-factor authentication is required for your role."); enforcement banner `auth.2fa_required` when redirected by `2fa.enrolled`.
- **Preferences** (`admin.account.preferences`): units, length unit, timezone, appearance.
- **Notifications** (`admin.account.notifications`): `12` §10.2 matrix for staff events + `PushOptIn` + test push.
- **Notification center** (`admin.notifications.index`): as `10` §12 with AdminLayout.

---

## 19. Real-time summary (staff)

| Page | Channel | Behaviour |
|---|---|---|
| All (AppShell) | `users.{id}` | `NotificationCreated` → bell + toast |
| Dashboard, order board/list, sidebar counters | `staff` | `OrderSubmitted`, `OrderNeedsAttention` → partial reloads (throttled 10 s) |
| Order detail, quote builder (state banner + blockers), proposal preview | `orders.{id}` + `orders.{id}.internal` | §5.3.12 |
| Item design viewer | `furniture-designs.{designId}` | `RevisionCreated` → reload `revisions`; BOM status by polling |
| Import detail | `imports.{id}` | reload on `ImportStatusChanged` |

---

## 20. Acceptance criteria (admin, cross-cutting)
1. Every route of §2 exists with its name, method, path, permission/gate and page; a Pest test iterates the route table asserting 403 without and 200/302 with the permission.
2. Sidebar items, tabs, buttons and dialogs are hidden exactly when the user lacks the permission/gate (browser tests per role).
3. Cost data never appears in props for users without `quotes.view_costs`.
4. T4, T6, T8, T9, T12, T13, T16–T20, T24–T28, T30, T31 are reachable only in their `09` states with the dialogs and validation of §5.
5. Production update with photos works on a 390 × 844 touch viewport.
6. Catalog CSV export → import round-trip is lossless for all six tables.
7. Lists implement search/filter/sort/pagination per `15` §9.29 and echo filters.
8. No horizontal page scroll at 1024 px; desktop-only pages show `ScreenTooSmall` below 768 px.

---

_Appendix merged into the target documents during reconciliation (see 19-reconciliation-log.md)._
