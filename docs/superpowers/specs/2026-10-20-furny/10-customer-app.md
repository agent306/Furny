# 10 — Customer App

Read the master document, `01`, `02`, `03`, `09` and `15` first. This file is normative for **every customer-facing page**: route name, URL, Inertia page component, layout, props, sections, actions, validation messages, empty/loading/error states, visibility, responsive behaviour, real-time behaviour and acceptance criteria.

Owned elsewhere (referenced, not re-specified): plan editor canvas, tools, panels, view-only mode → `05`; blueprint import pipeline, import API (A1–A12), options step details (page picker, photo corner editor) and the review-mode editor → `06`; furniture create page internals and builder (`FurnitureBuilder.vue`, modes) → `07`; BOM/pricing → `08`; notification catalogue, `NotificationPayloadData`, preferences matrix rules, web push and service worker → `12`; authentication flows, OTP, Google, sessions, recent-auth, uploads security (`api.uploads.*`), media serving, account deletion/export, permissions → `13`; AI credits (`CreditSummaryData`, ledger rules) → `18`; controllers/FormRequests → `14` (built from §2 here and §2 of `11`); tokens/components/layouts → `15`.

---

## 1. Conventions used in this file

- **Route names:** `customer.*` (authenticated customer pages/actions); auth routes use Fortify names or `auth.*`/`account.*` as defined in `13`; cross-audience names without prefix (`welcome`, `legal.*`, `media.show`, `manifest`, `links.order`); JSON endpoints `api.*`.
- **Resource URLs:** creation is nested under the parent (`/projects/{project}/plans`), existing resources are flat (`/plans/{plan}/edit`, `/furniture/{design}/edit`, `/imports/{import}`, `/orders/{order}`) — matching `06`, `07`, `12`.
- **Middleware** (from `13` §1): customer group `['web', 'auth', 'active', 'customer']` plus `onboarded` (§5.1). `verified.contact` (verified email **or** phone) additionally gates: order submission (T2), starting an **auto** blueprint import, posting messages, account data export. Pages never require verification; the UI explains what is blocked (§1.1).
- **Page components** under `resources/js/pages/`. Every page sets `<Head :title="t(...)">` and a persistent layout via `defineOptions`.
- **Wire format (decision, aligned with `06`, `07`, `12`, `13`, `18`):** Inertia props and JSON responses are **camelCase** (spatie/laravel-data classes with camelCase PHP properties; generated TS types). Request bodies are **camelCase** too, **except** Fortify-handled forms and the auth endpoints of `13` (login, register, password reset/update/confirm, `user-profile-information`, 2FA, OTP), which keep the field names given in `13` (`password_confirmation`, `current_password`, `marketing_opt_in`, `cf_turnstile_response`, `terms`, `phone`, `code`). Query-string parameters keep Laravel conventions (`page`, `per_page`, `sort`, `search`, `filter[...]`). DB columns, settings keys and enum values are snake_case (prose that names a column uses `table.column`). Validation error keys equal the submitted field names (camelCase dot paths, e.g. `items.2.quantity`).
- **Prop notation:** `Inertia.Deferred<T>` = prop sent with `Inertia::defer()` (type `T | undefined` until loaded; rendered inside `<Deferred data="…">` with the stated skeleton). `Inertia.ScrollProp<T>` = prop sent with `Inertia::scroll()` (merged by `<InfiniteScroll>`). `Paginated<T>` = `15` §9.29.
- **Abilities:** customers have no spatie permissions; ownership policies decide (`13` §8). Pages receive a `can` object computed server-side; the client never re-derives state rules.
- **Responsive:** phone < 768 px = view, approve, chat, quotes, progress **and simple forms** (projects, order draft/submit, account settings, uploads). The **editors** (plan editor, import review, furniture builder) are view-only on phones (`05`/`06`/`07`). Tablet 768–1023 and desktop ≥ 1024 = everything.
- **Strings:** given as `translation.key` "English value". Keys not listed follow `15` §15.2.
- **Error pages:** 403/404/419/429/500/503 via `pages/Error.vue` (§4.10). Non-owners get 404 (`13` §8).

### 1.1 Unverified contact UX (shared)
When `auth.user.emailVerified === false && auth.user.phoneVerified === false`:
- `VerifyContactBanner` (`15` §9.31) shows in `CustomerLayout` `#banner`: "Verify your email or phone to send orders and messages." + **Resend email link** (Fortify `verification.send`, only if an email exists) + **Verify phone** (opens `PhoneVerifyDialog`, §13.2.3).
- Gated actions render disabled with the same inline explanation (`common.verify_required` "Verify your email or phone first.") and a **Verify** link: order Submit (§11.3), import **Analyze** (§9.2; Trace stays available), message composer (§11.9), data export (§13.7). Server responses 403 `{code:'contact_unverified'}` show the same message as a toast.

---

## 2. Route & page index (complete)

### 2.1 Pages (GET, Inertia)

| # | Route name | Path | Page component | Layout | § |
|---|---|---|---|---|---|
| 1 | `welcome` | `/` | `Welcome` | AuthLayout `wide` | 4.1 |
| 2 | `login` (Fortify) | `/login` | `Auth/Login` | AuthLayout | 4.2 |
| 3 | `register` (Fortify) | `/register` | `Auth/Register` | AuthLayout | 4.3 |
| 4 | `auth.otp.create` (13) | `/login/phone` | `Auth/PhoneLogin` | AuthLayout | 4.4 |
| 5 | `auth.otp.verify.show` (13) | `/auth/otp/verify` | `Auth/PhoneVerify` | AuthLayout | 4.4 |
| 6 | `auth.otp.complete.show` (13) | `/auth/otp/complete` | `Auth/PhoneComplete` | AuthLayout | 4.4 |
| 7 | `password.request` (Fortify) | `/forgot-password` | `Auth/ForgotPassword` | AuthLayout | 4.5 |
| 8 | `password.reset` (Fortify) | `/reset-password/{token}` | `Auth/ResetPassword` | AuthLayout | 4.5 |
| 9 | `verification.notice` (Fortify) | `/email/verify` | `Auth/VerifyEmail` | AuthLayout | 4.6 |
| 10 | `two-factor.login` (Fortify) | `/two-factor-challenge` | `Auth/TwoFactorChallenge` | AuthLayout | 4.7 |
| 11 | `password.confirm` (Fortify) | `/user/confirm-password` | `Auth/ConfirmPassword` | AuthLayout | 4.8 |
| 12 | `auth.reauthenticate` (13) | `/auth/reauthenticate` | `Auth/Reauthenticate` | AuthLayout | 4.8 |
| 13 | `legal.terms` | `/terms` | `Legal/Terms` | AuthLayout `wide` (guest) / CustomerLayout (auth) | 4.9 |
| 14 | `legal.privacy` | `/privacy` | `Legal/Privacy` | same | 4.9 |
| 15 | `customer.onboarding.show` | `/onboarding` | `Customer/Onboarding/Wizard` | AuthLayout `wide` | 5 |
| 16 | `customer.dashboard` | `/dashboard` | `Customer/Dashboard` | CustomerLayout | 6 |
| 17 | `customer.projects.index` | `/projects` | `Customer/Projects/Index` | CustomerLayout | 7.1 |
| 18 | `customer.projects.create` | `/projects/create` | `Customer/Projects/Create` | CustomerLayout | 7.2 |
| 19 | `customer.projects.show` | `/projects/{project}` | `Customer/Projects/Show` | CustomerLayout | 7.3 |
| 20 | `customer.projects.edit` | `/projects/{project}/edit` | `Customer/Projects/Edit` | CustomerLayout | 7.4 |
| 21 | `customer.plans.edit` | `/plans/{plan}/edit` | `Customer/Plans/Edit` | EditorLayout | 8.2 |
| 22 | `customer.projects.imports.create` (06) | `/projects/{project}/imports/new` | `Customer/Imports/Create` | CustomerLayout | 9.1 |
| 23 | `customer.imports.show` (06) | `/imports/{import}` | `Customer/Imports/Show` | CustomerLayout | 9.2 |
| 24 | `customer.imports.review` (06) | `/imports/{import}/review` | `Customer/Imports/Review` | EditorLayout | 9.3 |
| 25 | `customer.furniture.index` | `/furniture` | `Customer/Furniture/Index` | CustomerLayout | 10.1 |
| 26 | `customer.projects.furniture.create` (07) | `/projects/{project}/furniture/create` | `Customer/Furniture/Create` | CustomerLayout | 10.2 |
| 27 | `customer.furniture.edit` (07) | `/furniture/{design}/edit` | `Customer/Furniture/Edit` | EditorLayout | 10.3 |
| 28 | `customer.orders.index` | `/orders` | `Customer/Orders/Index` | CustomerLayout | 11.1 |
| 29 | `customer.projects.orders.create` | `/projects/{project}/orders/create` | `Customer/Orders/Create` | CustomerLayout | 11.2 |
| 30 | `customer.orders.edit` | `/orders/{order}/edit` | `Customer/Orders/Draft` | CustomerLayout | 11.3 |
| 31 | `customer.orders.show` | `/orders/{order}` | `Customer/Orders/Show` | CustomerLayout | 11.4 |
| 32 | `customer.orders.proposals.show` | `/orders/{order}/proposals/{proposal}` | `Customer/Orders/ProposalReview` | CustomerLayout | 11.5 |
| 33 | `customer.orders.quotes.show` | `/orders/{order}/quotes/{quote}` | `Customer/Orders/Quote` | CustomerLayout | 11.6 |
| 34 | `customer.orders.completion` | `/orders/{order}/completion` | `Customer/Orders/CompletionReview` | CustomerLayout | 11.8 |
| 35 | `customer.notifications.index` | `/notifications` | `Customer/Notifications/Index` | CustomerLayout | 12 |
| 36 | `customer.account.profile` | `/account/profile` | `Customer/Account/Profile` | CustomerLayout + `AccountNav` | 13.2 |
| 37 | `customer.account.security` (13) | `/account/security` | `Customer/Account/Security` | same | 13.3 |
| 38 | `customer.account.preferences` | `/account/preferences` | `Customer/Account/Preferences` | same | 13.4 |
| 39 | `customer.account.notifications` (12) | `/account/notifications` | `Customer/Account/Notifications` | same | 13.5 |
| 40 | `customer.account.ai-credits` (18) | `/account/ai-credits` | `Customer/Account/AiCredits` | same | 13.6 |
| 41 | `customer.account.delete` (13) | `/account` | `Customer/Account/Delete` | same | 13.7 |
| 42 | `customer.help` | `/help` | `Customer/Help` | CustomerLayout | 14 |
| 43 | `links.order` (12) | `/o/{number}` | (redirect, `12` §3.6) | — | — |
| 44 | `manifest` (12) | `/manifest.webmanifest` | (JSON) | — | 15 |

`/` for an authenticated customer redirects to `customer.dashboard` (or onboarding); for staff to `admin.dashboard`. Fortify `home` = `/dashboard`; staff visiting customer pages are redirected to `admin.dashboard` by the `customer` middleware (`13` §1).

### 2.2 Actions

Unless stated, actions redirect back (Inertia) with a translated `flash.success`. Auth/account routes owned by `13`/`12`/`18` are listed for completeness with their owner in brackets.

| Route name | Method | Path | Body | Effect / transition | Redirect |
|---|---|---|---|---|---|
| Fortify `login`, `logout`, `register`, `password.email`, `password.update`, `verification.send`, `two-factor.login`, `password.confirm`, `user-password.update`, `user-profile-information.update` | POST/PUT | Fortify defaults | Fortify fields (`13`) | `13` | per `13` |
| `auth.otp.send` [13] | POST | `/auth/otp/send` | `phone`, `intent` (`login`\|`register`), `name?`, `cf_turnstile_response?` | send OTP | `auth.otp.verify.show` |
| `auth.otp.verify` [13] | POST | `/auth/otp/verify` | `code` | login / register | intended / dashboard |
| `auth.otp.resend` [13] | POST | `/auth/otp/resend` | `channel?`, `cf_turnstile_response?` | resend | back |
| `auth.otp.complete` [13] | POST | `/auth/otp/complete` | `name`, `terms` | create account | dashboard |
| `auth.google.redirect` / `auth.google.callback` [13] | GET | `/auth/google/redirect?intent=`, `/auth/google/callback` | — | OAuth | — |
| `account.google.unlink` [13] | DELETE | `/account/google` | — | unlink Google (`recent.auth`) | back |
| `account.phone.send` [13] | POST | `/account/phone/otp` | `phone` | OTP purpose `verify_phone` | back |
| `account.phone.verify` [13] | POST | `/account/phone/verify` | `code` | set + verify phone | back |
| `account.sessions.destroy` / `account.sessions.destroy-others` [13] | DELETE | `/account/sessions/{sessionKey}`, `/account/sessions` | — | revoke sessions | back |
| `customer.onboarding.store` | POST | `/onboarding` | §5.3 | profile + project (+ plan), sets `onboarded_at` | per choice |
| `customer.onboarding.skip` | POST | `/onboarding/skip` | `terms?` | sets `onboarded_at` (and `terms_accepted_at` when required) | dashboard |
| `customer.projects.store` | POST | `/projects` | `name`, `propertyType`, `notes?`, `siteAddressId?`, `siteAddress?` | `CreateProject` | `customer.projects.show` |
| `customer.projects.update` | PUT | `/projects/{project}` | same | update | `customer.projects.show` |
| `customer.projects.archive` | POST | `/projects/{project}/archive` | — | `ArchiveProject` | back |
| `customer.projects.unarchive` | POST | `/projects/{project}/unarchive` | — | status → active | back |
| `customer.projects.destroy` | DELETE | `/projects/{project}` | `confirmation` (= project name) | soft delete (blocked with any non-draft order) | `customer.projects.index` |
| `customer.projects.plans.store` | POST | `/projects/{project}/plans` | `name`, `levelIndex`, `start` (`blank`\|`starter`), `starterKey?` | `CreatePlan` | `customer.plans.edit` |
| `customer.plans.update` | PATCH | `/plans/{plan}` | `name?`, `levelIndex?` | rename / reorder | back |
| `customer.plans.duplicate` | POST | `/plans/{plan}/duplicate` | `name` | `DuplicatePlan` | back |
| `customer.plans.destroy` | DELETE | `/plans/{plan}` | — | soft delete | `customer.projects.show` |
| `customer.projects.furniture.store` [07] | POST | `/projects/{project}/furniture` | `name`, `templateKey`, `presetId?`, `document`, `returnPlanId?` | `CreateFurnitureDesign` | `customer.furniture.edit` (+ `?return_plan=`) |
| `customer.furniture.update` | PATCH | `/furniture/{design}` | `name` | rename | back |
| `customer.furniture.destroy` | DELETE | `/furniture/{design}` | — | soft delete (blocked if locked or referenced by any order item) | project designs tab |
| `customer.projects.orders.store` | POST | `/projects/{project}/orders` | `designIds[]` | **T1** | `customer.orders.edit` |
| `customer.orders.update` | PUT | `/orders/{order}` | §11.3.4 | save draft | back |
| `customer.orders.submit` | POST | `/orders/{order}/submit` | §11.3.4 (full payload) | save + **T2** (`verified.contact`) | `customer.orders.show` |
| `customer.orders.destroy` | DELETE | `/orders/{order}` | — | `DeleteDraftOrder` (never-submitted draft) | `customer.orders.index` |
| `customer.orders.cancel` | POST | `/orders/{order}/cancel` | `note?` | **T3** | `customer.orders.show` |
| `customer.orders.withdraw` | POST | `/orders/{order}/withdraw` | `note?` | **T29** | `customer.orders.show` |
| `customer.orders.reopen` | POST | `/orders/{order}/reopen` | — | **T5** | `customer.orders.edit` |
| `customer.orders.proposals.resolve` | POST | `/orders/{order}/proposals/{proposal}/resolve` | `decisions[]: {itemId, decision, comment?}`, `comment?` | **T7** | `customer.orders.show` |
| `customer.orders.quotes.accept` | POST | `/orders/{order}/quotes/{quote}/accept` | `acceptTerms` (`true`) | **T10** | `customer.orders.show` |
| `customer.orders.quotes.negotiate` | POST | `/orders/{order}/quotes/{quote}/negotiate` | `message`, `proposedTotalMinor?`, `itemComments?[]: {orderItemId, comment}` | **T11** | `customer.orders.show` |
| `customer.orders.quotes.decline` | POST | `/orders/{order}/quotes/{quote}/decline` | `reason` | **T14** | `customer.orders.show` |
| `customer.orders.quotes.pdf` | GET | `/orders/{order}/quotes/{quote}/pdf` | — | 302 to temporary URL; 404 `pdf_not_ready` while rendering | — |
| `customer.orders.completion.approve` | POST | `/orders/{order}/completion/approve` | — | **T21** | `customer.orders.show` |
| `customer.orders.issues.store` | POST | `/orders/{order}/issues` | `issues[]: {description, orderItemId?, uploadIds[]}` (≥ 1) | **T22** | `customer.orders.show` |
| `customer.orders.messages.store` | POST | `/orders/{order}/messages` | `body`, `uploadIds[]`, `template?` (`callback_request`), `callbackAt?` | `PostMessage` (`verified.contact`) | back (`preserveScroll`) |
| `customer.orders.messages.update` | PATCH | `/orders/{order}/messages/{message}` | `body` | edit own within 10 min | back |
| `customer.orders.messages.read` | POST | `/orders/{order}/messages/read` | `lastMessageId` | `MarkThreadRead` | 204 (XHR) |
| `customer.account.avatar.update` | PUT | `/account/avatar` | `uploadId` \| null | set/remove avatar | back |
| `customer.account.preferences.update` | PUT | `/account/preferences` | `unitSystem`, `lengthUnit`, `timezone` | update | back |
| `customer.account.notifications.update` [12] | PUT | `/account/notifications` | `preferences[]: {eventKey, channel, enabled}` | `UpdatePreferences` | back |
| `customer.account.notifications.reset` | DELETE | `/account/notifications` | — | delete all preference rows (`12` §10.2 "Reset to defaults") | back |
| `customer.account.notifications.test-push` | POST | `/account/notifications/test-push` | — | test web push to own subscriptions (throttle 3/min) | back |
| `customer.account.destroy` [13] | DELETE | `/account` | `confirmation` | `RequestAccountDeletion` (`recent.auth`) | public "deletion scheduled" page (`13` §9.1) |
| `customer.account.export` [13] | GET | `/account/export` | — | JSON download (`recent.auth`, `verified.contact`) | — |

### 2.3 JSON endpoints used by customer pages

| Name | Method | Path | Owner | Used by |
|---|---|---|---|---|
| `api.uploads.presign` / `api.uploads.confirm` / `api.uploads.show` | POST/POST/GET | `/api/uploads/presign`, `/api/uploads/{upload}/confirm`, `/api/uploads/{upload}` | `13` §11 | `FileDropzone`, `ImageUploader` |
| `api.imports.*` (A1–A12) | — | `/api/projects/{project}/imports`, `/api/imports/{import}/…` | `06` §4.3 | import pages |
| `api.notifications.index` | GET | `/api/notifications?filter=&cursor=&limit=` | `12` §8.4 | bell, notification center |
| `api.notifications.read` / `.unread` / `.read-all` | POST | `/api/notifications/{id}/read`, `/unread`, `/api/notifications/read-all` | `12` | bell, center |
| `api.push-subscriptions.store` / `.destroy` | POST/DELETE | `/api/push-subscriptions` | `12` §8.3 | `PushOptIn` |
| `api.ai.credits` | GET | `/api/me/ai-credits` | `18` | `CreditBadge` refresh |
| `api.furniture-designs.duplicate` | POST | `/api/furniture-designs/{design}/duplicate` | `07` | design card menu, builder |
| `api.furniture-revisions.show` | GET | `/api/furniture-revisions/{revision}` | this file (Appendix A8) | `Thumbnail3D`, proposal viewer |
| `media.show` | GET | `/media/{media:uuid}?conversion=` | `13` §8.9 | every `MediaData.url` |
| Editors: `/api/plans/{plan}/working-copy`, `/api/furniture-designs/{design}/working-copy`, revisions, `/api/catalog/snapshot` | — | — | `03`, `05`, `07` | editors |

---

## 3. Shared data objects (customer)

```ts
type Ulid = string;
type IsoDateTime = string;          // ISO-8601 UTC
type IsoDate = string;              // "YYYY-MM-DD" (business TZ date)
type OrderStateKey = 'draft' | 'submitted' | 'in_review' | 'changes_proposed' | 'quoted' | 'negotiating'
  | 'accepted' | 'confirmed' | 'in_production' | 'completed' | 'rework' | 'ready_for_delivery'
  | 'delivered' | 'closed' | 'cancelled' | 'on_hold';
type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'primary';
type PropertyType = 'apartment' | 'independent_house' | 'villa' | 'office' | 'other';

interface UserRefData { id: Ulid; name: string; avatarUrl: string | null; isStaff: boolean }

interface AddressData {
  id: Ulid; label: string | null; line1: string; line2: string | null; city: string;
  region: string | null; postalCode: string | null; countryCode: string;
  oneLine: string;                  // server-formatted single line
}
interface AddressFormData {
  label: string | null; line1: string; line2: string | null; city: string;
  region: string | null; postalCode: string | null; countryCode: string;
}

interface MediaData {
  id: string;                       // media uuid
  name: string; mimeType: string; size: number;
  url: string;                      // route('media.show', uuid) — stable; policy-checked redirect (13 §8.9)
  thumbUrl: string | null;          // ?conversion=thumb (images)
  largeUrl: string | null;          // ?conversion=large
  width: number | null; height: number | null;
}

interface ProjectSummaryData {
  id: Ulid; name: string; propertyType: PropertyType; status: 'active' | 'archived';
  coverUrl: string | null;          // project cover or first plan thumbnail
  planCount: number; designCount: number; activeOrderCount: number;
  actionNeededCount: number;        // orders of this project with a customer action (§11.4.2)
  updatedAt: IsoDateTime;
}
interface ProjectData extends ProjectSummaryData {
  notes: string | null; siteAddress: AddressData | null; createdAt: IsoDateTime;
  can: { update: boolean; archive: boolean; unarchive: boolean; delete: boolean; createOrder: boolean };
}
interface ProjectRefData { id: Ulid; name: string; status: 'active' | 'archived' }

interface PlanSummaryJson { wallCount: number; roomCount: number; totalAreaMm2: number; rooms: { id: string; name: string; areaMm2: number }[] }  // plans.summary (02 §3.2)
interface PlanSummaryData {
  id: Ulid; projectId: Ulid; name: string; levelIndex: number;
  source: 'drawn' | 'imported' | 'traced' | 'duplicated';
  thumbnailUrl: string | null; thumbnailSmallUrl: string | null;
  summary: PlanSummaryJson;
  workingSavedAt: IsoDateTime | null; updatedAt: IsoDateTime;
}

interface FurnitureEstimateJson { totalMinor: number; currency: string; partCount: number; sheetCount: number; catalogVersion: number; engineVersion: string; computedAt: string }  // furniture_designs.estimate
interface OrderRefData { id: Ulid; number: string; state: OrderStateKey }
interface FurnitureDesignSummaryData {
  id: Ulid; projectId: Ulid; projectName: string; name: string;
  templateKey: string; templateLabel: string;     // translated (07)
  thumbnailUrl: string | null;
  widthMm: number; heightMm: number; depthMm: number;
  estimate: FurnitureEstimateJson | null;
  estimateStale: boolean;           // estimate.catalogVersion < current catalog.version
  lockedByOrder: OrderRefData | null;
  updatedAt: IsoDateTime;
}

interface CustomerOrderAction {
  kind: 'finish_draft' | 'resubmit' | 'review_proposal' | 'review_quote' | 'check_completion';
  href: string; since: IsoDateTime;
}
interface OrderSummaryData {
  id: Ulid; number: string; isDraftNumber: boolean; title: string;
  state: OrderStateKey; stateBeforeHold: OrderStateKey | null;
  project: ProjectRefData; itemCount: number;
  thumbnailUrls: string[];          // up to 3
  quoteTotalMinor: number | null;   // current sent/accepted quote total
  productionProgress: number; productionStageLabel: string | null;
  action: CustomerOrderAction | null;
  expectedDeliveryOn: IsoDate | null;
  unreadMessages: number;
  submittedAt: IsoDateTime | null; updatedAt: IsoDateTime;
}

interface TimelineEntryData {       // 09 §12 (customer variant: internal entries removed server-side)
  id: string;
  kind: 'state_change' | 'proposal' | 'quote' | 'negotiation' | 'call' | 'production_update' | 'issue' | 'delivery' | 'system';
  at: IsoDateTime; actor: UserRefData | null;
  titleKey: string; params: Record<string, string | number | null>;
  bodyHtml: string | null;          // sanitised server-side (13 §12.6); rendered only via MessageBody.vue
  photos: MediaData[];
  links: { labelKey: string; href: string }[];
  visibility: 'customer' | 'internal';
  state: OrderStateKey | null;
}

interface MessageData {
  id: Ulid; kind: 'text' | 'system' | 'internal_note';
  author: UserRefData | null;
  body: string;                     // raw Markdown subset (own messages, for editing)
  bodyHtml: string;                 // Str::markdown per 13 §12.6
  systemEvent: string | null; systemPayload: Record<string, unknown> | null;
  attachments: MediaData[];
  editedAt: IsoDateTime | null; createdAt: IsoDateTime;
  canEdit: boolean;                 // own text message < 10 min old
}

// From 12 §4.5 (unchanged): NotificationPayloadData { id, eventKey, titleKey, bodyKey, params, url, icon, createdAt, readAt }
// From 18 §9.6 (unchanged): CreditSummaryData { balance, pending, unlimited, monthlyCredits, nextTopUpOn, creditsPerRecognition,
//                                                creditsPerRecognitionNone, dailyLimit, usedToday, aiAvailable }
// From 06 §4.3 (unchanged): ImportStatusData, ImportHints
```

---

## 4. Public & authentication pages

All use `AuthLayout` (`15` §7.4). Flows, limits, captcha (Turnstile when `features.captcha`, widget rendered from the `turnstileSiteKey` prop) and error codes are owned by `13`; this section defines the UI. Every auth page receives `features`, `turnstileSiteKey`, `canRegister` (`13` §2). Field errors inline; `_error`/`code` errors in an `Alert`. 429 responses show `auth.errors.throttled` "Too many attempts. Try again in {seconds} seconds." with a live countdown.

### 4.1 Welcome — `welcome` · `/` · `Welcome`
Props: `{ canRegister: boolean }`.
Content (no marketing site): logo + app name (Display style), tagline `welcome.tagline` "Design furniture that fits your home perfectly.", three rows with icons: `scan-line` "Upload your floor plan or draw it", `armchair` "Design custom furniture in 2D and 3D", `package-check` "Get a quote and follow production to delivery". Buttons **Create account** (primary → `register`; hidden if `!canRegister`) and **Log in** (outline → `login`). Footer: business phone (`tel:`), email (`mailto:`), working hours, links Terms · Privacy.
Phone: single column, full-width buttons. Acceptance: no third-party requests; Lighthouse accessibility ≥ 95.

### 4.2 Login — `login` · `/login` · `Auth/Login`
Props: `{ status: string | null; canResetPassword: boolean; canRegister: boolean; features; turnstileSiteKey: string | null }`.
- Title `auth_ui.login.title` "Log in".
- Email (`autocomplete=username`), Password (`autocomplete=current-password`, show/hide), "Remember me", "Forgot password?" (→ `password.request`), **Log in** (full width).
- **Use my phone instead** (outline, `smartphone` icon) → `auth.otp.create` — shown when `features.whatsapp || features.sms`.
- **Continue with Google** (if `features.google_login`) → `auth.google.redirect?intent=login`; caption "By continuing you accept the Terms and Privacy Policy." (links).
- Footer "New here? Create an account" (→ `register`, if `canRegister`). `status` → success `Alert`.
- Staff use the same page (13: staff never use phone OTP; the phone button is still visible, `13` returns `auth.errors.staff_use_email`).

### 4.3 Register — `register` · `/register` · `Auth/Register`
Props: as login. If `!canRegister` → page shows `auth.registration_closed` text only.
Fields (`13` §5.1, Fortify field names): `name` (2–120), `email`, `password` (hint `auth_ui.password_rules` "At least 8 characters."), `password_confirmation`, `terms` checkbox (required: "I accept the [Terms] and [Privacy Policy]" linking `legal.terms` / `legal.privacy` in a new tab), `marketing_opt_in` checkbox (unchecked, "Send me occasional updates and offers"), Turnstile widget. **Create account** → Fortify `register` → dashboard (verification banner per `13`).
Links: **Use my phone instead** (`auth.otp.create?intent=register`), **Continue with Google**.

### 4.4 Phone sign-in / sign-up — `auth.otp.create`, `auth.otp.verify.show`, `auth.otp.complete.show`
- `Auth/PhoneLogin` (props `{ intent: 'login' | 'register'; features; turnstileSiteKey }`): `PhoneInput` (`phone`), Name field when `intent=register`, `terms` checkbox when `intent=register`, Turnstile when required (422 `captcha_required` → render widget and resubmit), **Send code** → `auth.otp.send`. Hint "We'll send a 6-digit code by WhatsApp or SMS."
- `Auth/PhoneVerify` (props `{ channel: 'whatsapp' | 'sms'; maskedPhone: string; resendAvailableIn: number; channels: ('whatsapp' | 'sms')[] }`): per `13` §4.4 — single code field (`inputmode=numeric`, `autocomplete=one-time-code`, `maxlength=6`, auto-submit at 6 digits; shadcn `PinInput` with a hidden native input carrying `autocomplete=one-time-code` for iOS/Android autofill and WebOTP), text `auth_ui.otp.sent` "We sent a code to {phone} via {channel, select, whatsapp {WhatsApp} other {SMS}}.", resend countdown 60 s, **Resend on WhatsApp** / **Send by SMS**, **Change number**. Polls `auth.otp.status` every 5 s (max 2 min) while channel is WhatsApp; on `fallbackSent` shows "We couldn't reach you on WhatsApp, so we sent an SMS instead." Errors: `auth.errors.otp_invalid` "That code isn't right. {attemptsLeft, plural, one {# attempt} other {# attempts}} left.", `auth.errors.otp_expired`, `auth.errors.otp_too_many_attempts`.
- `Auth/PhoneComplete` (props `{ maskedPhone: string }`): Name*, `terms`* → `auth.otp.complete`.

### 4.5 Forgot / reset password
`Auth/ForgotPassword` (`{ status }`): Email, **Email reset link**; success `Alert` (never reveals existence). `Auth/ResetPassword` (`{ email, token }`): Email (read-only), Password, Confirm → login with status.

### 4.6 Verify email — `verification.notice` · `Auth/VerifyEmail`
Props `{ status: string | null; email: string }`. "We sent a verification link to {email}." **Resend email** (`verification.send`), **Continue to the app** (→ dashboard; app works unverified, §1.1), **Log out**.

### 4.7 Two-factor challenge — `two-factor.login` · `Auth/TwoFactorChallenge`
Staff only (`13` §5.10). Code field (6 digits) or "Use a recovery code" toggle. **Continue**.

### 4.8 Confirm password / reauthenticate
`Auth/ConfirmPassword`: password + **Confirm** (Fortify). `Auth/Reauthenticate` (`13` §6.4, passwordless users): options **Send me a code** (phone OTP, same phone) and **Continue with Google**; success returns to the intended page.

### 4.9 Legal pages — `legal.terms`, `legal.privacy`
Public. Props `{ businessName: string; updatedOn: IsoDate }`. Body = translation `legal.terms.body` / `legal.privacy.body` (ICU with `{business}`; owner edits translations), rendered as paragraphs (no HTML). Layout: AuthLayout `wide` for guests, CustomerLayout for customers, AdminLayout for staff.

### 4.10 Error page — `pages/Error.vue`
Props `{ status: 403 | 404 | 419 | 429 | 500 | 503 }`. Layout by audience (customer/staff/guest). `EmptyState` per status: 403 `lock` "You don't have access to this page."; 404 `map-pin-off` "We couldn't find that page."; 419 `refresh-cw` "Your session expired. Please reload."; 429 `hourglass` "Too many requests. Please wait a moment."; 500 `triangle-alert` "Something went wrong on our side."; 503 `wrench` "We're doing maintenance. Back shortly." Actions: "Go to dashboard", "Reload" (419/500/503).

---

## 5. Onboarding (first-login wizard)

### 5.1 Gate
Middleware `EnsureCustomerOnboarded` (alias `onboarded`) on all `customer.*` routes except `customer.onboarding.*`, `customer.account.*`, `customer.help`, `customer.notifications.index`: for `type = customer` with `users.onboarded_at` null, GET requests redirect to `customer.onboarding.show` (column: Appendix A1). Customers created by staff also see it on first login.

### 5.2 Page — `customer.onboarding.show` · `/onboarding` · `Customer/Onboarding/Wizard`
Props:
```ts
interface OnboardingProps {
  user: { name: string; email: string | null; phoneE164: string | null; phoneVerified: boolean; termsAccepted: boolean };   // termsAccepted = users.terms_accepted_at !== null (13 A.1)
  defaults: { unitSystem: 'metric' | 'imperial'; lengthUnit: string; timezone: string };   // business settings
  propertyTypes: PropertyType[];
  starters: PlanStarterData[];                 // §8.3
  credits: CreditSummaryData;                  // 18
}
```
AuthLayout `wide` (card `max-w-2xl`). Header "Step {n} of 4" + `Progress`. Footer: **Back** (hidden on step 1), **Continue**, link **Skip for now** (ConfirmDialog "You can set this up later from your dashboard." → `customer.onboarding.skip`; when terms are still required the dialog contains the required terms checkbox).

Steps (client-side; one final POST):
1. **About you** — Name* (prefilled, 2–120). When `user.termsAccepted` is false (account created by staff, `11` B15): required checkbox `terms` "I accept the [Terms] and [Privacy Policy]" (`onboarding.errors.terms_required` "Please accept the terms to continue."). Phone is **not** collected here (phone changes require OTP verification, `13` §5.7); instead, when no verified phone: card "Add a phone number for our confirmation calls" with **Verify phone** (opens `PhoneVerifyDialog`, §13.2.3) and "Later".
2. **Units** — radio cards **Metric** (example "2400 mm") / **Imperial** (example `7' 10 1/2"`); length unit `Select` (metric: mm/cm/m; imperial: ft-in/in); time zone `Combobox` (default browser `Intl.DateTimeFormat().resolvedOptions().timeZone` if in `Intl.supportedValuesOf('timeZone')`, else business default).
3. **Your first project** — name (default `onboarding.default_project_name` "My home", ≤ 120), property type (radio cards: apartment `building`, independent_house `house`, villa `building-2`, office `briefcase`, other `shapes`).
4. **How do you want to start?** — `StartPlanChooser` (§8.1, mode `select`): **Upload a blueprint** ("Photo, scan, PDF or DXF — we'll turn it into an editable plan." + "Uses {cost} credit · you have {balance}" when `creditsPerRecognition > 0`), **Draw from scratch**, **Start from a template room** (opens starter gallery). On phones Draw/Template are disabled ("Drawing needs a tablet or computer."); Upload works (camera).

### 5.3 Submit — `customer.onboarding.store` (POST)
Body `{ name, terms?, unitSystem, lengthUnit, timezone, project: { name, propertyType }, start: 'upload' | 'draw' | 'starter' | 'none', starterKey? }` (`terms` required and accepted when `terms_accepted_at` is null; sets it).
Server: update user, set `onboarded_at`, create project; `draw` → plan "Ground floor" blank → `customer.plans.edit`; `starter` → plan from starter → `customer.plans.edit`; `upload` → `customer.projects.imports.create`; `none` → `customer.projects.show`.
Messages: `onboarding.errors.name_required` "Please enter your name."; `account.errors.length_unit` "Choose a unit that matches your measurement system."; timezone "Choose a valid time zone."; `projects.errors.name_required` "Give your project a name."; `starterKey` required for `starter` and must exist.
Acceptance: first login lands in the wizard; finishing with Draw opens the plan editor of the new project; Skip never shows it again; staff never see it.

---

## 6. Dashboard — `customer.dashboard` · `/dashboard` · `Customer/Dashboard`

Props:
```ts
interface CustomerDashboardProps {
  actionItems: ActionItemData[];                  // tone danger/warning first, then since asc
  projects: ProjectSummaryData[];                 // up to 6 active, updatedAt desc
  projectCount: number;
  ordersInProgress: OrderSummaryData[];           // Active orders (09 §1), up to 5
  credits: CreditSummaryData;
}
interface ActionItemData {
  kind: 'review_proposal' | 'review_quote' | 'quote_expiring' | 'check_completion' | 'resubmit_order'
      | 'finish_draft' | 'review_import' | 'import_failed' | 'verify_contact';
  titleKey: string; params: Record<string, string | number>;
  descriptionKey: string | null;
  href: string; since: IsoDateTime; tone: Tone;
}
```
Sources: `changes_proposed` → `review_proposal` (warning); `quoted` → `review_quote` (warning) or `quote_expiring` (danger, ≤ 2 days left); `completed` → `check_completion` (warning); `draft` with `submitted_at` → `resubmit_order` (info); never-submitted `draft` updated < 30 days ago → `finish_draft` (neutral); imports `ready_for_review` → `review_import` (warning); imports `failed` in last 7 days without a newer import from the same source → `import_failed` (danger); no verified email and phone → `verify_contact` (info, href `customer.account.profile#phone`).

Sections (desktop: main 8/12 + side 4/12):
1. `PageHeader` `dashboard.title` "Hello, {name}"; action **New project**.
2. **Action needed** (only if items): compact link cards (icon by tone, title, description, `RelativeTime(since)`, chevron).
3. **Orders in progress**: rows (thumbnail stack, number, title, `StatusBadge`, compact `Stepper`, `ProductionProgress` when in production, unread badge); "View all orders". Hidden when there are none.
4. **Your projects**: cards (2 cols tablet/desktop, 1 phone): cover 16:10 (grain placeholder), name, property type, "{plans} floors · {designs} designs", action badge; ghost card "+ New project"; "View all ({count})".
5. **AI credits** (side): balance (large), `credits.widget.body` "Credits are used to recognise uploaded blueprints automatically. You get {monthly} free credits every month (next on {date})." (omit second sentence when `monthlyCredits = 0`); `pending > 0` → "Pending: {pending}"; **Upload a blueprint** (1 project → its import page; several → project chooser dialog; none → `customer.projects.create`); "History" → `customer.account.ai-credits`. `!aiAvailable` → `credits.widget.ai_off` "Automatic recognition is unavailable right now; you can still trace your plan manually."
6. **Need help?** (side): business phone/WhatsApp, link to Help.

Empty (no projects): `EmptyState` lg icon `house` "Let's start with your home" / "Create a project, then upload your floor plan or draw it." + **Create your first project**.
Real-time: `NotificationCreated` → `router.reload({ only: ['actionItems', 'ordersInProgress'] })` (throttled 2 s); `AiCreditsChanged` → reload `credits`.
Phone order: Action needed → Orders → Projects → Credits → Help.
Acceptance: a `quoted` order shows "Review your quote" linking to the quote page; an import `ready_for_review` shows "Review your imported plan".

---

## 7. Projects

### 7.1 Index — `customer.projects.index` · `Customer/Projects/Index`
Props: `{ projects: Paginated<ProjectSummaryData>; filters: { status: 'active' | 'archived'; search: string | null; sort: '-updated_at' | 'name' } }` (`per_page` 12).
`PageHeader` "Projects" + **New project**; segmented Active / Archived; `SearchInput`; sort select; card grid; `Pagination`.
Empty: active "No projects yet" + **Create project**; archived "No archived projects"; no results "No projects match “{search}”" + Clear.

### 7.2 Create — `customer.projects.create` · `Customer/Projects/Create`
Props: `{ propertyTypes: PropertyType[]; addresses: AddressData[]; defaultCountryCode: string }`.
`<Form>` → `customer.projects.store`: Name* (≤ 120), Property type* (radio cards), Site address (optional: `Select` of saved addresses or "Add an address" → `AddressFields`, payload `siteAddressId` or `siteAddress`), Notes (≤ 2000). **Create project** → project page with the start chooser (§7.3.7).

### 7.3 Project page — `customer.projects.show` · `/projects/{project}` · `Customer/Projects/Show`
Query: `tab` ∈ `plans` (default) | `designs` | `orders` | `imports`; `plan` (selected plan id).
Props:
```ts
interface ProjectShowProps {
  project: ProjectData;
  plans: PlanSummaryData[];                               // levelIndex asc
  designs: FurnitureDesignSummaryData[];                  // updatedAt desc
  orders: OrderSummaryData[];                             // all incl. drafts/closed/cancelled, createdAt desc
  imports: Inertia.Deferred<ImportSummaryData[]>;         // last 50
  starters: PlanStarterData[];
  credits: CreditSummaryData;
}
interface ImportSummaryData {
  id: Ulid; originalFilename: string; status: ImportStatus; mode: 'auto' | 'trace';
  sourceKind: string | null; creditsCharged: number; plan: { id: Ulid; name: string } | null;
  createdAt: IsoDateTime; finishedAt: IsoDateTime | null; href: string;   // customer.imports.show or .review
}
type ImportStatus = 'awaiting_upload' | 'uploaded' | 'queued' | 'preprocessing' | 'recognizing' | 'ready_for_review' | 'accepted' | 'discarded' | 'failed' | 'cancelled';
```

#### 7.3.1 Header
`PageHeader`: project name; meta: property type, site address (or link "Add an address"), `Badge` "Archived". Actions: **New order** (if `can.createOrder` and ≥ 1 design → `customer.projects.orders.create`); overflow: Edit, Archive/Unarchive (Confirm "Archive {name}? It will be hidden from your dashboard. You can restore it any time."), Delete (if `can.delete`; destructive, `requireText` = name; "This permanently removes the project, its plans and designs.").
Archived: info `Alert` "This project is archived. Unarchive it to make changes." + **Unarchive**; create/edit actions hidden; editors open read-only.

#### 7.3.2 Tabs
`Tabs` synced to `?tab=` via `router.get(url, query, { preserveState: true, replace: true, only: [] })`. Labels with counts.

#### 7.3.3 Plans tab
- Floor pills (one per plan, `levelIndex` order) + **+ Add floor**.
- Selected plan: thumbnail (`aspect-[16/10] object-contain bg-canvas-bg`; placeholder "Preview will appear after the first save"), `KeyValueList`: Rooms, Floor area (`AreaDisplay`), Walls, Last saved, Source (`plans.sources.{source}`: Drawn / Imported from blueprint / Traced / Duplicated); collapsible room list (name + area).
- **Open editor** (→ `customer.plans.edit`; phone label "View plan"); overflow: Rename (≤ 80), Move up/down (swap `levelIndex` via `customer.plans.update`), Duplicate (name default "{name} (copy)"), Upload a blueprint for this floor (→ import page with `?plan=`), Delete (destructive: "Delete {name}? Furniture designs are kept; only their placement on this floor is removed.").
- **Add floor** dialog: Name* (default `plans.default_names.{level}`: "Ground floor", "First floor", "Second floor", "Basement"), Level (−2…10, default max + 1), then `StartPlanChooser`.

#### 7.3.4 Designs tab
Toolbar: **New design** (→ `customer.projects.furniture.create`), search (client-side), chips All / Available / In an order. Grid of `DesignCard` (2/3/4 cols): `Thumbnail3D`, name, template label, `DimensionText`, estimate `MoneyDisplay approx` (+ "May be outdated" when `estimateStale`), `Badge` "In order {number}" (link) when `lockedByOrder`. Card → builder. Menu: Rename, Duplicate (`api.furniture-designs.duplicate` → visit returned `editUrl`), Order this design (→ order create `?designs={id}`), Delete (disabled with tooltip "It's part of order {number}" when locked).
Empty: icon `armchair` "No furniture designs yet" / "Design a wardrobe, shelves, a TV unit and more." + **New design**.

#### 7.3.5 Orders tab
`OrderRow` list (§11.1) + **New order**. Empty: icon `package` "No orders yet" / "When your designs are ready, send them to us for a quote." (**New order** disabled without designs: "Create a design first").

#### 7.3.6 Imports tab
`<Deferred data="imports">` (`LoadingState table rows=4`). Columns: File, Status (`StatusPill`, `IMPORT_STATUS_TONE`), Floor, Credits used, Started. Row → `href`. **Upload a blueprint**. Empty: icon `scan-line` "No blueprint uploads yet". While any import is non-terminal and the tab is visible: poll `only: ['imports']` every 10 s.

#### 7.3.7 Empty project (no plans)
`EmptyState` lg "Add your floor plan" + inline `StartPlanChooser`.

Phone: scrollable tabs; panels stack. Acceptance: tab switches don't reload; an archived project shows no create/edit controls.

### 7.4 Edit — `customer.projects.edit` · `Customer/Projects/Edit`
Props `{ project: ProjectData; propertyTypes: PropertyType[]; addresses: AddressData[] }`; same form as create → `customer.projects.update`. Editing an address that an Active order references creates a new address row (Appendix A6).

---

## 8. Plans

### 8.1 `StartPlanChooser` (`components/projects/StartPlanChooser.vue`)
Props `{ projectId: Ulid; levelIndex: number; planName: string; starters: PlanStarterData[]; credits: CreditSummaryData; mode: 'navigate' | 'select' }`; emits `select({ start: 'upload' | 'draw' | 'starter'; starterKey?: string })`.
Three option cards (§5.2 step 4). `navigate` mode: Upload → `customer.projects.imports.create?level_index=&plan_name=`; Draw → POST `customer.projects.plans.store` `{ name, levelIndex, start: 'blank' }`; Template → starter dialog → POST `{ …, start: 'starter', starterKey }`. Phones: Draw/Template disabled (`plans.phone_draw_disabled` "Drawing needs a tablet or computer.").

### 8.2 Plan editor host — `customer.plans.edit` · `/plans/{plan}/edit` · `Customer/Plans/Edit`
Lazy chunk; EditorLayout. Editor internals = `05` (06 links here after accepting an import).
Props:
```ts
interface PlanEditPageProps {
  project: ProjectRefData;
  plan: PlanSummaryData;
  workingDocument: PlanDocument;           // 03 §1
  workingVersion: number;
  floors: { id: Ulid; name: string; levelIndex: number }[];
  designs: FurnitureDesignSummaryData[];   // placeable designs of the project
  placeDesignId: Ulid | null;              // ?place= (handoff §10.4), validated to belong to the project
  backgroundUrl: string | null;            // signed URL (15 min) of BackgroundImage.mediaUuid; refreshed via partial reload `only: ['backgroundUrl']` before expiry
  readOnly: boolean;                       // archived project (phones are forced read-only client-side)
  readOnlyReason: 'archived' | null;
  defaults: { wallHeightMm: number; exteriorWallThicknessMm: number; interiorWallThicknessMm: number; doorWidthMm: number; doorHeightMm: number; windowWidthMm: number; windowHeightMm: number; windowSillMm: number };   // units settings
}
```
Page chrome (outside `05`): `<Head>` "{plan} · {project}"; `title` = plan name; `backHref` = `customer.projects.show?tab=plans&plan={id}`; floor switcher `Select` in `#topbar-start` (navigation guarded per `03` §5); `#topbar-end` overflow: "Order furniture" (→ order create), "Upload a blueprint for this floor". Mounts `<PlanEditor>` (`@/editor/plan`).
Banners: archived → "This project is archived — viewing only." + Unarchive; phone → `plans.phone_view_only` "View only on phones. Open on a tablet or computer to edit."
Acceptance: `?place={designId}` starts placement mode for that design (`05`); the param is removed after placing/cancelling.

### 8.3 Plan starters (`PlanStarterData`)
```ts
interface PlanStarterData { key: string; label: string; description: string; thumbnailUrl: string; totalAreaMm2: number; roomCount: number }
```
Registry `config/plan_starters.php` (Appendix A3): `single_room` (4000 × 3000 mm, one door, one window), `l_shaped_room`, `studio`, `one_bhk`, `two_bhk` (= `database/fixtures/plans/brochure-2bhk.json`), `three_room_hdb` (= `database/fixtures/plans/hdb-3room.json`). Picker dialog: cards (thumbnail, label, "{rooms} rooms · {area}") → **Use this layout**. If `05` defines a starter registry, `05` wins.

---

## 9. Blueprint import pages

The flow, API (A1–A12), statuses, `ImportStatusData`, error codes (`imports.error.{code}`), credit rules and the review editor are defined in `06` (§1, §4.3, §11, §14) and `18` (§15.1). This section fixes the page UI around them.

### 9.1 Upload — `customer.projects.imports.create` · `/projects/{project}/imports/new` · `Customer/Imports/Create`
Query: `plan` (replace target), `level_index`, `plan_name` (new-plan defaults).
Props (06): `{ project: ProjectRefData; plans: { id: Ulid; name: string }[]; credits: CreditSummaryData; limits: { maxBytes: number; maxBytesDxf: number; acceptedExtensions: string[] }; features: { dxfImport: boolean }; target: { planId: Ulid | null; name: string; levelIndex: number } }`.
Layout: `PageHeader` "Import a floor plan" (back → project).
1. **Mode** radio cards: **Analyze automatically** (default; "We recognise walls, doors, windows and rooms." + `CreditBadge` cost "{n} credit(s) · you have {balance}" or "Free") / **Trace it myself (free)** ("Use the drawing as a background and draw over it.").
2. **Target**: "Create a new floor" (name ≤ 80, level) / "Replace a floor" (`Select` of `plans`; warning "The current drawing of this floor is replaced only after you accept the result. A backup revision is kept.").
3. **Dropzone** (`FileDropzone` visuals, single file, implemented with `lib/upload.ts` against `api.imports.store` → presigned PUT → `api.imports.confirm`), **Take a photo** on touch devices (`capture=environment`).
4. **File type guidance** (`Accordion`, open on desktop): ✓ Photos & scans JPG, PNG, WebP, HEIC — "Take the photo straight on, in good light, with the whole plan visible."; ✓ PDF — "Brochures and architect drawings. Vector PDFs work best."; ✓ DXF (if `features.dxfImport`) — "CAD export. Choose millimetres if asked."; ✗ **DWG** — `imports.guidance.dwg` "DWG files can't be opened directly. In your CAD program use **Save As → DXF** (or export to PDF) and upload that file instead."; limits "Up to 25 MB (DXF up to 15 MB)."
Client checks before upload: extension/MIME → `imports.error.unsupported_type`; `.dwg` → `imports.error.dwg_not_supported` (no network request); size → `imports.error.file_too_large` (texts per `06` §14). Upload progress bar + **Cancel** (abort + `api.imports.cancel`). On upload failure: `Alert` "The upload didn't finish. Check your connection and try again." + **Retry** (cancels the unfinished import, restarts with the same `File`).
On confirm success → `router.visit(customer.imports.show)`.
Phone: fully supported (camera upload is a primary use case).

### 9.2 Import page — `customer.imports.show` · `/imports/{import}` · `Customer/Imports/Show`
Props (06): `{ import: ImportStatusData; credits: CreditSummaryData; project: ProjectRefData; contactVerified: boolean }`.
Status-driven UI (live via `useImportChannel(import.id)`; fallback poll `api.imports.show` every 5 s when disconnected; terminal statuses reload `only: ['import', 'credits']`; stage changes announced in a polite live region):
- `uploaded` with `sourceKind` null: "Checking your file…" spinner (≤ 30 s).
- `uploaded` (options step, `06` §1.1 step 4): **Page picker** (PDF > 1 page: thumbnail grid from `import.pages`, radio semantics, arrow keys, default page 1), **corner editor** (photos; component from `06`), **hints** (collapsed "Help us read your drawing": unit system Auto/Metric/Feet & inches; "A measurement I know" label ≤ 60 + `LengthInput` 500–50 000 mm — both or neither: `imports.hints.known_dimension_incomplete` "Enter both a label and a length, or leave both empty."; wall height `LengthInput` 2000–6000, default `units.default_wall_height_mm`) saved via `api.imports.update` (debounced 500 ms), **cost line** from `import.cost` + `credits` per `18` §15.1 ("This analysis uses **{n}** AI credit(s). You have **{balance}**." / "Free"), and buttons **Analyze drawing** (→ `api.imports.start`) and, for trace mode, **Start tracing**. Disabled states: insufficient credits (`imports.error.insufficient_credits` text + "Credits renew on {date}" + **Trace it myself instead** → `api.imports.convert-to-trace`), daily limit (`daily_limit_reached`), budget block (`ai_budget_exhausted`), unverified contact (§1.1; trace remains available).
- `queued` / `preprocessing` / `recognizing`: card with source preview, indeterminate `Progress`, stage text `t('imports.stages.' + import.stage)`, elapsed timer, note "This usually takes 1–3 minutes. You can leave this page — we'll notify you.", **Cancel** (Confirm "Cancel? Reserved credits are returned." → `api.imports.cancel`).
- `ready_for_review`: success card "Your plan is ready to review" + **Review plan** (→ `import.reviewUrl`; phone: disabled "Open on a tablet or computer to review") + **Discard** (Confirm "Credits used for this analysis are not refunded." → `api.imports.discard`).
- `accepted`: "Imported into {plan}" + **Open plan**.
- `failed`: danger card `t(import.error.messageKey)`; actions per `06` §1.4: **Try again** (if `error.retryable`; → `api.imports.rerun` `{ useAi: true }` → visit the new import), **Trace it myself instead** (→ `api.imports.convert-to-trace`), **Upload a different file** (→ upload page).
- `cancelled` / `discarded`: neutral card + **Upload again**.
Acceptance: with the socket connected the page moves from "recognising" to "ready to review" without reload; within 5 s by polling otherwise; an unverified customer can start tracing but not analysis.

### 9.3 Review — `customer.imports.review` · `/imports/{import}/review` · `Customer/Imports/Review`
EditorLayout; plan editor in `import-review` mode; props per `06` §4.3 (A7 payload + `{ project, plans, userUnits }`). Page chrome only: `#banner` "Check the recognised plan. Fix anything that's wrong, then accept."; `#topbar-end` **Discard** / **Accept plan** (accept dialog with target name/level per `06` §11.7). Phone: `ScreenTooSmall` with link back to `customer.imports.show`.

---

## 10. Furniture designs

### 10.1 List — `customer.furniture.index` · `/furniture` · `Customer/Furniture/Index`
Props: `{ designs: Paginated<FurnitureDesignSummaryData>; projects: ProjectRefData[]; templates: { key: string; label: string }[]; filters: { project: Ulid | null; template: string | null; availability: 'all' | 'available' | 'in_order'; search: string | null; sort: '-updated_at' | 'name' } }` (`per_page` 24).
`PageHeader` "Furniture designs" + **New design** (1 project → create page; several → project chooser dialog; none → `customer.projects.create`). `FilterBar` (project, template, availability) + search + sort; `DesignCard` grid with project name as meta. Empty / no-results states as §7.3.4.

### 10.2 Create — `customer.projects.furniture.create` · `/projects/{project}/furniture/create` · `Customer/Furniture/Create`
Owned by `07` §8.1 (props, tabs, category chips, side sheet, client-side generation, POST `customer.projects.furniture.store`). Additions from this file:
- Query `return_plan` (plan id) and `hint_width` (mm): props `returnPlan: { id: Ulid; name: string } | null`, `hintWidthMm: number | null`. When `hintWidthMm` is set and within the template's width range, the side sheet pre-fills `width`. The POST includes `returnPlanId`; the server redirects to `customer.furniture.edit?return_plan={id}`.
- Back link: plan editor when `returnPlan`, else project designs tab.
- Phone: page allowed; note "You'll be able to adjust it on a tablet or computer." (builder is view-only on phones).

### 10.3 Builder host — `customer.furniture.edit` · `/furniture/{design}/edit` · `Customer/Furniture/Edit`
Owned by `07` §8 (mode `customer` / `readonly`, autosave, 423 handling, locked banner with **Duplicate to edit**). Page-level additions (props merged with `07`'s): `project: ProjectRefData`, `returnPlan: { id: Ulid; name: string } | null`, `plans: { id: Ulid; name: string; levelIndex: number }[]`, `lockedByOrder: OrderRefData | null`.
`#topbar-end` actions owned by this file:
- **Place in plan** (primary when `returnPlan`): flush autosave (wait for "Saved" ≤ 5 s, else confirm "Leave with unsaved changes kept on this device?") → `customer.plans.edit(returnPlan)?place={design.id}`. Without `returnPlan`: dropdown of `plans` (disabled if none).
- **Order this design** (outline; hidden when locked) → `customer.projects.orders.create?designs={id}`.
- Title inline rename → `customer.furniture.update`.
Acceptance: plan → "Add furniture → New design" → create → builder → **Place in plan** returns to that plan with the design attached to the cursor.

### 10.4 Placement handoff contract (shared with `05`/`07`)
1. Plan editor "Add furniture" panel (`05`) offers existing designs and **New design**, which visits `customer.projects.furniture.create?return_plan={planId}[&hint_width={mm}]`.
2. Store redirects to `customer.furniture.edit?return_plan={planId}`.
3. **Place in plan** visits `customer.plans.edit?place={designId}`; the server validates the design belongs to the plan's project (else ignores the param) and passes `placeDesignId`.
4. The editor enters placement mode (`05`); placing creates a new `FurniturePlacement`; Esc cancels; the editor then removes `place` with `history.replaceState`.
5. Placing the same design more than once is allowed (`05` may warn).

---

## 11. Orders

### 11.0 Order data (customer variants)
```ts
interface OrderItemData {
  id: Ulid; sortOrder: number;
  design: { id: Ulid; name: string; templateLabel: string; thumbnailUrl: string | null; projectId: Ulid };
  revision: { id: Ulid; number: number; bomStatus: 'pending' | 'ready' | 'failed' } | null;   // null while draft
  dims: { widthMm: number; heightMm: number; depthMm: number };
  quantity: number; roomLabel: string | null; customerNotes: string | null;
  estimateMinor: number | null;            // draft only: design.estimate.totalMinor × quantity
  estimateStale: boolean;
  quotedAmountMinor: number | null;        // sum of customer-visible current-quote lines of this item
  openIssueCount: number;
}

interface CustomerOrderAbilities {         // OrderPolicy (13 §8.5) + state (09)
  editDraft: boolean; deleteDraft: boolean; submit: boolean;
  cancelDraft: boolean;                    // T3
  withdraw: boolean;                       // T29
  reopen: boolean;                         // T5
  reviewProposal: boolean;                 // T7
  acceptQuote: boolean; negotiate: boolean; declineQuote: boolean;   // T10 / T11 / T14
  approveCompletion: boolean; reportIssue: boolean;                  // T21 / T22
  requestCallback: boolean;                // accepted + ≥ 1 no_answer call
  postMessage: boolean;                    // 09 §2 rule AND verified contact
  postMessageBlockedReason: 'thread_closed' | 'contact_unverified' | null;
}

interface OrderData {
  id: Ulid; number: string; isDraftNumber: boolean; title: string;
  state: OrderStateKey; stateBeforeHold: OrderStateKey | null; holdReason: string | null;
  project: ProjectRefData;
  siteAddress: AddressData | null; needsInstallation: boolean;
  preferredDeliveryOn: IsoDate | null; expectedDeliveryOn: IsoDate | null;
  customerNotes: string | null;
  productionProgress: number; productionStage: string | null; productionStageLabel: string | null;
  cancelReason: string | null; cancelNote: string | null;
  wasSubmitted: boolean;
  milestones: Record<'submittedAt' | 'reviewedAt' | 'quotedAt' | 'acceptedAt' | 'confirmedAt' | 'productionStartedAt' | 'completedAt' | 'customerApprovedAt' | 'deliveredAt' | 'closedAt' | 'cancelledAt', IsoDateTime | null>;
  contactPerson: UserRefData | null;       // assigned estimator
  currentQuote: QuoteData | null;          // latest non-draft
  openProposal: ChangeProposalSummaryData | null;
  negotiation: { roundsUsed: number; roundsMax: number; open: QuoteNegotiationData | null };
  noAnswerCalls: { calledAt: IsoDateTime }[];   // outcome no_answer only (09 §7)
  delivery: DeliveryData | null;
  openIssues: OrderIssueData[];
  can: CustomerOrderAbilities;
}

interface ChangeProposalSummaryData { id: Ulid; number: number; status: 'sent' | 'resolved' | 'withdrawn'; sentAt: IsoDateTime | null; itemCount: number; href: string }

interface QuoteLineData {
  id: Ulid; orderItemId: Ulid | null;
  kind: 'furniture' | 'materials' | 'hardware' | 'labour' | 'finishing' | 'installation' | 'delivery' | 'discount' | 'custom';
  description: string; details: Record<string, unknown> | null;
  quantity: string;                        // decimal string "1.000"
  unit: string; unitPriceMinor: number; amountMinor: number;
  taxRateId: Ulid | null; taxRateLabel: string | null;
  sortOrder: number;
}
interface QuoteNegotiationData {
  id: Ulid; quoteId: Ulid; proposedTotalMinor: number | null; message: string;
  itemComments: { orderItemId: Ulid; itemName: string; comment: string }[];
  status: 'open' | 'answered_with_revision' | 'answered_keep_price' | 'closed';
  answerMessage: string | null; answeredBy: UserRefData | null; answeredAt: IsoDateTime | null;
  resultingQuoteId: Ulid | null; createdAt: IsoDateTime;
}
interface QuoteData {
  id: Ulid; version: number; number: string;
  status: 'sent' | 'accepted' | 'declined' | 'superseded' | 'expired' | 'withdrawn';   // customers never see drafts
  currency: string; pricesIncludeTax: boolean;
  subtotalMinor: number; discountMinor: number; taxMinor: number; totalMinor: number;
  taxBreakdown: { taxRateId: string; name: string; rateBps: number; taxableMinor: number; taxMinor: number }[];
  validUntil: IsoDate; daysLeft: number;
  leadTimeDays: number | null;
  notesToCustomer: string | null; terms: string;
  lines: QuoteLineData[];                  // customer-visible lines only
  pdfUrl: string | null;                   // customer.orders.quotes.pdf when the PDF exists
  sentAt: IsoDateTime | null; acceptedAt: IsoDateTime | null; declinedAt: IsoDateTime | null;
  expiredAt: IsoDateTime | null; supersededAt: IsoDateTime | null; withdrawnAt: IsoDateTime | null;
  declineReason: string | null;
  negotiations: QuoteNegotiationData[];
}
interface QuoteVersionData { id: Ulid; version: number; number: string; status: QuoteData['status']; totalMinor: number; sentAt: IsoDateTime | null; pdfUrl: string | null; href: string }

interface ProductionUpdateData {
  id: Ulid; author: UserRefData; stage: string; stageLabel: string; progress: number;
  title: string; bodyHtml: string | null; visibility: 'customer' | 'internal';
  isCompletion: boolean; photos: MediaData[]; createdAt: IsoDateTime;
}
interface OrderIssueData {
  id: Ulid; orderItemId: Ulid | null; itemName: string | null; raisedBy: UserRefData;
  description: string; status: 'open' | 'in_progress' | 'resolved' | 'rejected';
  resolutionNote: string | null; resolvedAt: IsoDateTime | null; photos: MediaData[]; createdAt: IsoDateTime;
}
interface DeliveryData {
  scheduledFor: IsoDateTime | null; scheduledUntil: IsoDateTime | null;
  deliveredAt: IsoDateTime | null; installed: boolean; recipientName: string | null;
  notes: string | null; photos: MediaData[];
}
```

### 11.1 Orders list — `customer.orders.index` · `/orders` · `Customer/Orders/Index`
Props: `{ orders: Paginated<OrderSummaryData>; counts: Record<'active' | 'action' | 'drafts' | 'done' | 'cancelled', number>; filters: { tab: 'active' | 'action' | 'drafts' | 'done' | 'cancelled'; search: string | null } }` (`per_page` 12; sort `updated_at desc`).
Tabs: **Active**, **Needs action** (`action ≠ null`), **Drafts**, **Completed** (`delivered`, `closed`), **Cancelled**; search by number or title.
`OrderRow`: thumbnail stack, number (mono), title, project, `StatusBadge`, compact `Stepper` (desktop), quote total, progress bar when `in_production`, "Action needed" pill with the action label, unread badge, `RelativeTime(updatedAt)`. Row → `customer.orders.show` (never-submitted drafts → `customer.orders.edit`).
Empty per tab: "No orders in progress" / "You're all caught up" (`check-circle`) / "No drafts" / "No completed orders yet" / "No cancelled orders"; no orders at all: "No orders yet" + **Start an order** (project chooser).

### 11.2 Create (select designs, T1) — `customer.projects.orders.create` · `Customer/Orders/Create`
Query `designs` (comma list to preselect). Props: `{ project: ProjectRefData; designs: (FurnitureDesignSummaryData & { selectable: boolean; unavailableReason: 'in_active_order' | null })[]; preselected: Ulid[] }`.
`PageHeader` "New order" — "Choose the furniture you'd like us to make. You can adjust quantities next." Selectable cards (checkbox; unavailable cards dimmed "Already in order {number}"). Sticky bar "{n} selected" + **Continue** → `customer.projects.orders.store` `{ designIds }` (T1) → draft editor.
Errors: `orders.errors.no_designs` "Choose at least one design."; 422 `design_in_active_order` → `orders.errors.design_in_active_order` "{name} is already part of order {number}." Empty: "Design some furniture first" + **New design**.

### 11.3 Draft editor & submission (T2) — `customer.orders.edit` · `/orders/{order}/edit` · `Customer/Orders/Draft`
Only for `state = draft` (else redirect to show).
Props:
```ts
interface OrderDraftProps {
  order: OrderData;
  items: OrderItemData[];
  addableDesigns: (FurnitureDesignSummaryData & { selectable: boolean; unavailableReason: 'in_active_order' | null })[];
  addresses: AddressData[];
  projectSiteAddressId: Ulid | null;
  roomSuggestions: string[];               // distinct room names from the project's plan summaries
  minPreferredDate: IsoDate;               // today + workflow.min_preferred_delivery_days (Appendix A5)
  contact: { email: string | null; emailVerified: boolean; phoneE164: string | null; phoneVerified: boolean };
  estimateDisclaimer: string;              // trans_icu(pricing.estimate_disclaimer_key)
  currency: string;
}
```

#### 11.3.1 Layout
Desktop: three section cards (8/12) + sticky **Summary** card (4/12). Tablet: one column. Phone: 3-step wizard (Items → Delivery → Review) with sticky **Back / Next / Submit order**.
`PageHeader` "Draft order" (or "Order {number} — reopened"); actions **Save draft** (outline) + overflow **Delete draft** (`can.deleteDraft`; "Delete this draft? Your designs are not affected.") or **Cancel order** (`can.cancelDraft`, T3, `ReasonDialog` optional note).
Reopened `Alert`: "Your order is open for changes. Edit your designs, then submit it again. Its number stays {number}."

#### 11.3.2 Items
Per item: thumbnail, design name (link → builder, unsaved-changes guard), `DimensionText`, estimate `MoneyDisplay approx` × qty ("May be outdated — open the design to refresh"), **Quantity** (`number-field` 1–99), **Room** (`Combobox` free text ≤ 80 with `roomSuggestions`), **Notes for us** (≤ 2000, collapsed "Add a note"), remove (`aria-label` "Remove {name}"; disabled for the last item). **Add designs** dialog (checkbox list of `addableDesigns`).
Per-item submit errors: `orders.errors.design_invalid` "{name} has problems that must be fixed before submitting." + issue list (`t(issue.messageKey, issue.params)`) + **Open design**.

#### 11.3.3 Delivery & installation
- **Site address*** — `RadioGroup` of saved addresses (project address first, labelled "Project address") + "Use a new address" (`AddressFields`, payload `siteAddress`; checkbox `setAsProjectAddress`, default checked when the project has none).
- **Installation*** — radio cards "Yes, deliver and install" / "No, delivery only"; no default on first submission (stored value after reopen). `orders.errors.installation_required` "Tell us whether you need installation."
- **Preferred delivery date** (optional) — `DateInput` min `minPreferredDate`; hint "We'll confirm the actual date when we call you."
- **Notes** (≤ 5000) — "Anything we should know? Access, lift, timings…"

#### 11.3.4 Review & submit
- Summary: items × qty with estimates, **Estimated total** (`MoneyDisplay approx xl`), "Installation: included in your quote", "Delivery: included in your quote", `orders.draft.tax_note` "Taxes are added in the quote."
- Disclaimer `Alert` (`info` icon): `estimateDisclaimer`.
- **Submit order** → opens **Submit dialog**: summary line ("{count} items · estimated {total}"); if neither email nor phone verified → required verification block (`orders.errors.contact_unverified` "Verify your email or phone before submitting." + **Verify phone** inline `PhoneVerifyDialog` flow + **Resend email link**); else if no verified phone → optional step (`13` §5.7) "Add a phone number for our confirmation call" with inline phone verification and **Skip**. Confirm button **Send order** → `customer.orders.submit` (processing label "Submitting…"; engine validation can take seconds).
Payload (`update` and `submit`):
```ts
{
  items: { id?: Ulid; designId: Ulid; quantity: number; roomLabel: string | null; customerNotes: string | null }[];
  siteAddressId: Ulid | null;
  siteAddress: AddressFormData | null;
  setAsProjectAddress: boolean;
  needsInstallation: boolean | null;      // null allowed for update; required for submit
  preferredDeliveryOn: IsoDate | null;
  customerNotes: string | null;
}
```
Server messages (submit): `orders.errors.no_items` "Add at least one item."; `items.*.quantity` "Quantity must be between 1 and 99."; `orders.errors.site_address_required` "Choose where we should deliver."; `orders.errors.installation_required`; `preferredDeliveryOn` "Choose a date on or after {date}."; `orders.errors.design_invalid` (per item); `orders.errors.design_in_active_order`; `orders.errors.contact_unverified`; `orders.errors.design_deleted` "{name} was deleted. Remove it from the order."
Save: explicit **Save draft**, save on wizard step change, unsaved-changes guard. Success → `customer.orders.show` with flash `orders.toasts.submitted` "Order {number} submitted. We'll review it soon." After the first ever submission the order page shows the `PushOptIn` card once (`12` §8.3).
Acceptance: an invalid design shows engine issues on its item and keeps the draft; after submit the designs open read-only; the order gets an `ORD-YYYY-NNNNN` number.

### 11.4 Order page — `customer.orders.show` · `/orders/{order}` · `Customer/Orders/Show`
Never-submitted drafts redirect to `customer.orders.edit`. Query `tab` ∈ `overview` (default) | `designs` | `quote` | `messages` | `documents` (`links.order` and notification CTAs may add `#messages`, which selects the Messages tab).
Props:
```ts
interface CustomerOrderShowProps {
  order: OrderData;
  items: OrderItemData[];
  latestProductionUpdate: ProductionUpdateData | null;
  productionUpdates: Inertia.Deferred<ProductionUpdateData[]>;    // customer-visible, newest first
  timeline: Inertia.Deferred<TimelineEntryData[]>;
  messages: Inertia.ScrollProp<MessageData>;                       // 30 per page; rendered oldest → newest
  lastReadMessageId: Ulid | null;
  unreadMessages: number;
  quoteVersions: QuoteVersionData[];                               // non-draft quotes, newest first
  showPushOptIn: boolean;                                          // 12 §8.3 rule
  vapidPublicKey: string | null;                                   // only when showPushOptIn
}
```

#### 11.4.1 Header & structure
- `PageHeader`: "Order {number}", description = title; meta `StatusBadge` + project link + "Submitted {date}". Overflow: **Print summary**, **Edit my designs** (`can.reopen`, T5), **Withdraw request** (`can.withdraw`, T29), **Cancel order** (`can.cancelDraft`, T3).
- **Stepper** (horizontal ≥ 768; vertical collapsed to the current step + "Show all steps" on phone). Cancelled → danger `Alert` "This order was cancelled: {reason}" (`orders.cancel_reasons.{reason}`) + `cancelNote`. On hold → warning `Alert` "Your order is on hold: {holdReason}".
- `Tabs`: Overview · Designs ({n}) · Quote (dot when `can.acceptQuote`) · Messages ({unread}) · Documents.
- Desktop Overview: main column (ActionPanel, production card, timeline) + right rail (Details, Quote, Delivery cards).

#### 11.4.2 Action panel per state (exactly one `ActionPanel`)

| State | Tone/icon | Title / body (`orders.panel.{state}.*`) | Actions |
|---|---|---|---|
| `draft` (submitted before) | info `file-pen` | "Your order is open for changes" / "Update your designs, then submit again." | **Continue editing** · **Cancel order** (T3) |
| `submitted` | info `send` | "Waiting for review" / "We usually start reviewing within 1 business day." | **Edit my designs** (T5) · **Withdraw request** (T29) |
| `in_review` | info `search` | "We're reviewing your designs" / "{contact} is checking your designs and will send a quote or suggestions." | **Edit my designs** (T5) · **Withdraw request** (T29) |
| `changes_proposed` | warning `git-compare` | "Action needed: review our suggested changes" / staff message excerpt | **Review changes** (→ proposal page) · overflow Edit my designs (T5) |
| `quoted` | warning `receipt` | "Action needed: review your quote" / "{total} · valid until {date} ({days} days left)" | **Accept quote** (T10) · **Negotiate** (T11; when `!can.negotiate` → **Contact us** → Messages) · **Decline** (T14) · "View quote details" |
| `quoted` with `currentQuote.status = expired` (until T15 runs) | neutral `clock` | "This quote has expired" / "We're preparing an updated one." | — |
| `negotiating` | info `messages-square` | "We're reviewing your response" / your counter-offer (target, message excerpt) | **Decline quote** (T14) · **Edit my designs** (T5) |
| `accepted` | primary `phone` | "Accepted — we'll call you to confirm" / "We'll call {phone}." + "Not your number? Update it" (→ profile `#phone`) | when `can.requestCallback`: "We tried to reach you on {date}." + **Request a call back** |
| `confirmed` | success `badge-check` | "Confirmed — production will start soon" / "Expected delivery: {date}" | — |
| `in_production` | primary `hammer` | "In production" / stage + progress | **See progress** |
| `completed` | warning `camera` | "Action needed: check the photos of your furniture" | **Check photos** (→ completion page) |
| `rework` | warning `wrench` | "We're fixing the issue you reported" / `openIssues` with `StatusPill` | — |
| `ready_for_delivery` | success `truck` | scheduled ? "Delivery scheduled for {date}, {window}" : "We'll contact you to schedule delivery." | — |
| `delivered` | success `package-check` | "Delivered on {date}" + "{installed, select, true {Installed} other {Delivered only}}" | "Problem? **Message us**" |
| `closed` | neutral `archive` | "Order closed — thank you!" | **Order more furniture** |
| `cancelled` | (Alert replaces panel) | — | — |
| `on_hold` | warning `pause-circle` | "On hold" / `holdReason` | **Message us** |

Dialogs:
- **Edit my designs (T5)** — "Edit your designs?"; body by state: `submitted`/`in_review` "We'll pause our review until you submit again."; `changes_proposed` "Our suggested changes will be withdrawn."; `quoted`/`negotiating` "The current quote will be withdrawn and a new one prepared after you resubmit." → `customer.orders.reopen`.
- **Withdraw request (T29)** / **Cancel order (T3)** — `ReasonDialog`, optional note ≤ 2000, destructive.
- **Accept quote (T10)** — total (`MoneyDisplay xl`), number, valid until, collapsible **Terms**, required checkbox `quotes.accept.checkbox` "I accept the quote and its terms." → `acceptTerms`; button **Accept quote** (success variant). Errors: `quotes.errors.expired` "This quote has expired. We'll send an updated one."; `quotes.errors.not_current` "A newer quote is available." (both reload).
- **Negotiate (T11)** (phone: full-screen `Drawer`) — Message* (≤ 2000, hint "Tell us what you'd like to change — price, materials, timing…"), **Your target total** (optional `CurrencyInput`, > 0 and < total: `quotes.errors.target_range` "Enter an amount between {min} and {max}."), **Comments on specific items** (repeatable: item `Select` + comment ≤ 500, one per item), info "You can send {remaining, plural, one {# more counter-offer} other {# more counter-offers}}." → **Send counter-offer**. Errors: `quotes.errors.negotiation_limit` "You've reached the maximum number of counter-offers. Please message us instead."; `quotes.errors.negotiation_disabled`.
- **Decline (T14)** — `ReasonDialog` destructive, note **required** (`reason`, ≤ 2000, "Why are you declining?"), body "Declining cancels this order. You can still order these designs again later."
- **Request a call back** — `DateTimeInput` (≥ now + 1 h; hint shows business working hours) + optional note → `customer.orders.messages.store` `{ template: 'callback_request', callbackAt, body: note ?? '' }`; server text `messages.templates.callback_request` "I'd like a call back at {datetime}." (+ note).

#### 11.4.3 Overview tab
1. ActionPanel. 2. `PushOptIn` card (when `showPushOptIn`, dismissible). 3. **Production card** (when any update exists): `ProductionProgress`, latest update (title, `MessageBody` body, `PhotoGallery max=4`), **All updates** → `<Deferred data="productionUpdates">` list with galleries. 4. **Timeline** (`<Deferred data="timeline">`, `LoadingState list rows=5`; failure → `ErrorState` retry `router.reload({ only: ['timeline'] })`).
Right rail: **Details** (`KeyValueList`: Project, Site address, Installation, Preferred date, Expected delivery, Contact person), **Quote** (total, status, valid until, "View quote"), **Delivery** (window / delivered at / recipient / installed / photos).

#### 11.4.4 Designs tab
Item cards (1/2/3 cols): `Thumbnail3D` (`interactive`, `revisionId` = pinned), name, `DimensionText`, quantity, room, notes, quoted amount, "Revision {n}", issue pill. **Open design** → builder (read-only while locked).

#### 11.4.5 Quote tab
`QuoteView` (§11.6.2) inline with actions, or `EmptyState` `receipt` "No quote yet" / "We'll send a quote after reviewing your designs."

#### 11.4.6 Messages tab — §11.9.

#### 11.4.7 Documents tab
Per `quoteVersions`: "Quote {number}" + `StatusPill` + date + total + **Download PDF** (disabled "Preparing PDF…" when `pdfUrl` null) ; **Order summary** → Print. Empty "No documents yet".

#### 11.4.8 Real-time
`useOrderChannel(order.id)` (customer-safe channel `orders.{id}`, `13` §8.10): `OrderStateChanged` → `router.reload({ only: ['order', 'items', 'timeline', 'quoteVersions', 'latestProductionUpdate'] })` + toast `orders.toasts.state_changed` "Order updated: {state}"; `MessagePosted` → append (if not own) and bump `unreadMessages` when the tab is hidden; `QuoteSent`/`ChangeProposalSent` → reload `order`, `quoteVersions`, `timeline`; `ProductionUpdatePosted` → reload `latestProductionUpdate`, `productionUpdates`, `order`. Disconnected > 5 s → poll 30 s (`only: ['order', 'timeline']`).

#### 11.4.9 Responsive
Phone: compact header, vertical collapsed Stepper, sticky scrollable tabs, full-width stacked panel buttons, right-rail cards below the timeline.

#### 11.4.10 Acceptance
- Each of the 16 states renders exactly the panel/actions of §11.4.2 (browser test per DemoSeeder order).
- Accepting a quote updates other open tabs via the socket.
- An expired quote shows no Accept/Negotiate/Decline.

### 11.5 Proposal review (T7) — `customer.orders.proposals.show` · `Customer/Orders/ProposalReview`
Props:
```ts
interface ProposalReviewProps {
  order: Pick<OrderData, 'id' | 'number' | 'title' | 'state' | 'project'>;
  proposal: ChangeProposalData;
  canResolve: boolean;                     // proposal sent && order changes_proposed
}
interface ChangeProposalData {
  id: Ulid; number: number; status: 'draft' | 'sent' | 'resolved' | 'withdrawn';
  message: string | null; createdBy: UserRefData;
  sentAt: IsoDateTime | null; resolvedAt: IsoDateTime | null; withdrawnAt: IsoDateTime | null;
  customerComment: string | null;
  items: ChangeProposalItemData[];
}
interface ChangeProposalItemData {
  id: Ulid; orderItemId: Ulid; itemName: string; quantity: number;
  fromRevision: { id: Ulid; number: number; bomStatus: 'pending' | 'ready' | 'failed' };
  toRevision: { id: Ulid; number: number; bomStatus: 'pending' | 'ready' | 'failed' } | null;
  fromThumbnailUrl: string | null; toThumbnailUrl: string | null;
  changes: ChangeItem[];                   // 03 §3.4
  staffNote: string | null;
  decision: 'pending' | 'approved' | 'rejected'; customerComment: string | null; decidedAt: IsoDateTime | null;
  price: { beforeMinor: number | null; afterMinor: number | null; ready: boolean };   // per unit (server PriceBreakdown.unitPriceMinor); ready when both BOMs ready
}
```
The body is `components/orders/ProposalReviewBody.vue` (props `proposal`, `canResolve`, `preview?: boolean` — preview disables decisions), reused by the staff preview (`11` §5.11).
UI:
- `PageHeader` "Suggested changes" ("Proposal #{number} · from {staff} · {date}"), back → order.
- Staff message card.
- Per item card: **viewer** (tablet/desktop two columns before | after; phone single viewer with `ToggleGroup` Before/After) using the compare/diff viewer of `07` §10 (`diffHighlight`: changed parts amber `--diff-changed`, added green `--diff-added`, removed red ghost `--diff-removed-ghost`, legend), loaded lazily over `Thumbnail3D` placeholders; **Show differences** toggle (default on). `DiffList` (major first; hover highlights the entity — 07's `ChangeList` may be reused if it has the same props). **Price impact**: ready → "Price per item: {before} → {after} ({delta})" (increase `warning`, decrease `success`), else "Calculating new price…" (reload `only: ['proposal']` every 5 s). Staff note. **Decision**: Approve / Reject toggle buttons; Reject reveals required comment (≤ 1000, "Tell us why, so we can adjust."; `proposals.errors.comment_required` "Please tell us why you're rejecting this change.").
- Sticky footer: "{decided} of {total} decided", **Approve all**, optional overall comment (≤ 2000), **Send my decisions** (disabled until all decided) → `customer.orders.proposals.resolve` `{ decisions: [{ itemId, decision, comment }], comment }`. Errors: `proposals.errors.undecided` "Decide on every change before sending."; `proposals.errors.not_open` "This proposal is no longer open." (reload).
- Read-only (`!canResolve`): decisions as `StatusPill`s with comments; banner "Resolved on {date}" / "Withdrawn on {date}".
Phone: supported (viewer 50vh, touch orbit). Real-time: `ChangeProposalSent`/`OrderStateChanged` → reload.
Acceptance: Send disabled until all decided; reject without comment errors; after sending the order is `in_review` and the page read-only.

### 11.6 Quote page — `customer.orders.quotes.show` · `Customer/Orders/Quote`
Props: `{ order: Pick<OrderData, 'id' | 'number' | 'title' | 'state' | 'project' | 'siteAddress' | 'needsInstallation' | 'negotiation' | 'can'>; quote: QuoteData; items: OrderItemData[]; versions: QuoteVersionData[]; isCurrent: boolean; business: { name: string; legalName: string | null; taxId: string | null; addressOneLine: string | null; logoUrl: string | null } }`. Drafts → 404.

#### 11.6.1 Header
"Quote {number}" + `StatusPill`; "Sent {date}". Actions **Download PDF** (disabled "Preparing PDF…" when null; reload every 10 s up to 2 min), **Print**.
Banners: expired "This quote has expired; we're preparing an updated one."; superseded "A newer quote is available." + link; withdrawn "This quote was withdrawn."; accepted "You accepted this quote on {date}."; declined "You declined this quote: {declineReason}".

#### 11.6.2 `QuoteView` (`components/orders/QuoteView.vue`, props `quote`, `items`, `audience`, `actions?: boolean`)
- Countdown (if `sent`): "Valid until {date} · {daysLeft, plural, =0 {last day} one {# day left} other {# days left}}" (warning ≤ 2).
- Per item (lines with `orderItemId`, in item order): thumbnail, name, `DimensionText`, quantity, room; lines table (description, details summary, qty × unit price, amount).
- Order-level lines (installation, delivery, custom, discount).
- `QuoteSummary`: subtotal, discount (success tone), tax rows ("GST 18% on {taxable}"), **Total** (xl), "Prices include tax" / "Taxes shown separately"; lead time "Made in about {leadTimeDays} days after confirmation."
- Notes to customer; Terms (collapsible); negotiation history (your counter-offers, our answers).
- Actions (only `isCurrent && quote.status = 'sent' && order.state = 'quoted'`): Accept / Negotiate or Contact us / Decline (dialogs §11.4.2); in `negotiating`: Decline only.
- Earlier versions (collapsible) with delta vs this quote (`signDisplay=always`).
Print: `PrintHeader` + `QuoteView` without actions (the PDF remains the official document). Phone: line tables become stacked rows.
Acceptance: displayed totals equal server values; hidden lines never appear in props.

### 11.7 Production timeline
Within the order page (§11.4.3). Internal updates are never sent to customers.

### 11.8 Completion review (T21/T22) — `customer.orders.completion` · `/orders/{order}/completion` · `Customer/Orders/CompletionReview`
Available in `completed`, `rework`, `ready_for_delivery`, `delivered`, `closed` (read-only unless `completed`).
Props: `{ order: Pick<OrderData, 'id' | 'number' | 'title' | 'state' | 'can' | 'openIssues'>; completion: ProductionUpdateData | null; previousCompletions: ProductionUpdateData[]; items: OrderItemData[]; issues: OrderIssueData[] }`.
UI: `PageHeader` "Check your furniture"; intro "Here are photos of your finished furniture. If everything looks right, confirm and we'll schedule delivery." + completion message; large `PhotoGallery` (1/2/3 cols, 4:3, Lightbox); **Compare with your designs** (per item `Thumbnail3D` interactive); previous issues & resolutions; actions (if `can.approveCompletion`): **Looks good** (success; Confirm "Confirm everything looks right? We'll schedule delivery next." → `customer.orders.completion.approve`, T21) and **Report an issue** (T22 dialog).
**Report an issue** (phone: full-screen `Drawer`): 1–5 issue blocks: Item (`Select` "Whole order"/item), Description* (≤ 2000, "What's wrong?"), Photos (`ImageUploader` purpose `issue_photo`, ≤ 10) → `customer.orders.issues.store` `{ issues: [{ description, orderItemId, uploadIds }] }`. Errors: `issues.errors.description_required` "Describe the problem."
Acceptance: Looks good → `ready_for_delivery`; Report → `rework` with issues on the order page.

### 11.9 Message thread
`MessageThread` + `MessageComposer` (`15` §9.16) in the Messages tab (full height on phone).
- `messages` uses Inertia infinite scroll (`Inertia::scroll()`, cursor = message id, 30 per page, `<InfiniteScroll>` reverse). Fallback if unavailable: partial reload `only: ['messages']` with `?before={id}` and prepend.
- Post → `customer.orders.messages.store` (`preserveScroll`, `only: ['messages', 'unreadMessages']`); attachments via `FileDropzone` purpose `message_attachment` (≤ 5; jpeg/png/webp/pdf ≤ 15 MB) sending `uploadIds`.
- Read → `customer.orders.messages.read` `{ lastMessageId }`.
- Blocked (`!can.postMessage`): `thread_closed` → `messages.closed` "This conversation is closed. Contact us if you need help." + Help link; `contact_unverified` → §1.1 text + **Verify**.
- Validation: `messages.errors.empty` "Write a message or attach a file."; body ≤ 5000 ("Messages can be at most 5,000 characters."); `messages.errors.edit_window` "Messages can only be edited for 10 minutes."
- Staff names show a "Team" badge; system messages centred `t('messages.system.' + systemEvent, systemPayload)`; message HTML only via `MessageBody.vue` (`13` §12.6).

---

## 12. Notification center — `customer.notifications.index` · `/notifications` · `Customer/Notifications/Index`
Per `12` §8.4. Props: `{ initial: { data: NotificationPayloadData[]; nextCursor: string | null; unreadCount: number }; filter: 'all' | 'unread' }` (first page server-rendered; 25 per page).
UI: `PageHeader` "Notifications" + **Mark all as read** (`api.notifications.read-all`, optimistic) + link "Notification settings" (→ `customer.account.notifications`). Tabs All / Unread (`?filter=`). List grouped by day: icon, `t(titleKey, params)` (bold if unread), `t(bodyKey, params)`, `RelativeTime`, unread dot; row click → `api.notifications.read` (fire-and-forget) + `router.visit(url)`; row menu "Mark as read/unread" (`.read` / `.unread`). **Load more** (`api.notifications.index?cursor=`).
Empty: All → `bell` "No notifications yet" / "We'll let you know when something happens with your orders."; Unread → "You're all caught up".
Real-time: `NotificationCreated` → prepend when the filter allows.
Bell dropdown: `15` §9.17. Acceptance: unread counts (header, tab bar, page) update immediately and match the server after reload.

---

## 13. Account

### 13.1 Shell
CustomerLayout + `AccountNav` (desktop: left vertical nav 220 px; tablet/phone: horizontal scrollable pills): Profile · Security · Preferences · Notifications · AI credits · Delete account. Sections use `FormSection`; dirty forms show `StickyActionBar`.

### 13.2 Profile — `customer.account.profile` · `Customer/Account/Profile`
Props: `{ user: AuthUserData; marketingOptIn: boolean; otpChannels: ('whatsapp' | 'sms')[] }`.
1. **Photo** — avatar + **Change** (`ImageUploader` single, purpose `avatar`) → `customer.account.avatar.update` `{ uploadId }`; **Remove** (`uploadId: null`).
2. **Your details** — Fortify `user-profile-information.update` (`13` §5.8) with fields `name` (2–120), `email`, `marketing_opt_in`. Changing the email requires `recent.auth` (redirect to confirm/reauthenticate) and shows "We'll send a verification link to the new address." Errors: `auth.email_unavailable`; `auth.errors.last_login_method` "You need at least one way to sign in."
3. **Phone** (`id="phone"`) — number + pill (Verified / Not verified); **Verify** / **Change number** → `PhoneVerifyDialog`.
4. **Email verification** — if unverified: `Alert` + **Resend link** (`verification.send`).

#### 13.2.3 `PhoneVerifyDialog` (`components/account/PhoneVerifyDialog.vue`)
Step 1: `PhoneInput` → **Send code** (`account.phone.send` `{ phone }`; channel chosen by the server per `13` §4.2; shows "Sent via WhatsApp/SMS"). Step 2: code field (as §4.4) → `account.phone.verify` `{ code }`; resend countdown 60 s. Success toast `account.toasts.phone_verified` "Phone number verified." Errors: `auth.errors.phone_unavailable`, `auth.errors.otp_invalid`, `auth.errors.otp_expired`, throttling. Reused by onboarding, the order submit dialog, `VerifyContactBanner` and staff account pages.

### 13.3 Security — `customer.account.security` · `Customer/Account/Security`
Props: `{ hasPassword: boolean; googleLinked: boolean; googleEnabled: boolean; sessions: { id: string; uaSummary: string; ipMasked: string; lastActiveAt: IsoDateTime; isCurrent: boolean; method: string }[] }` (`13` §6.3).
Sections: **Password** — current (if `hasPassword`), new, confirm → Fortify `user-password.update` (when no password: title "Set a password", no current field; `13`); toast `account.toasts.password_updated` "Password updated." **Google** — "Connected" + **Disconnect** (`account.google.unlink`, `recent.auth`; error `auth.errors.last_login_method`) or **Connect** (`auth.google.redirect?intent=link`). **Phone sign-in** — status + link to Profile `#phone`. **Devices** — session list (browser/OS, masked IP, last active, "This device"), **Sign out** per session (`account.sessions.destroy`), **Sign out all other devices** (`account.sessions.destroy-others`, Confirm).

### 13.4 Preferences — `customer.account.preferences` · `Customer/Account/Preferences`
Props `{ unitSystem: 'metric' | 'imperial'; lengthUnit: string; timezone: string; timezones: string[] }`.
Measurement system (radio cards), editing length unit (`Select`, resets when the system changes), time zone (`Combobox`); **Appearance** (device-level, `15` §11): Light / Dark / System, "Saved on this device." Save → `customer.account.preferences.update`. Errors: `account.errors.length_unit`; "Choose a valid time zone."

### 13.5 Notifications — `customer.account.notifications` · `Customer/Account/Notifications`
Props and rules: `12` §10.2 (`PreferencesPageProps`, `PreferencesMatrix.vue`, locked/unavailable cells, toggle-all, **Reset to defaults** → `customer.account.notifications.reset`, save `{ preferences }`). Top of page: `PushOptIn` card (`12` §8.3: feature detection, iOS Add-to-Home-Screen instructions, denied state, enable/disable; hidden when `!features.web_push`) plus **Send test notification** (when this device is subscribed → `customer.account.notifications.test-push`).
Phone: matrix renders as per-event cards with a row of channel switches.
Acceptance: per `12` §13; iOS Safari non-standalone shows the Add-to-Home-Screen instructions.

### 13.6 AI credits — `customer.account.ai-credits` · `Customer/Account/AiCredits`
Owned by `18` §15.1 (balance, pending, top-up explanation, paginated history without reservation rows). Real-time: `AiCreditsChanged` → reload.

### 13.7 Delete account — `customer.account.delete` · `/account` · `Customer/Account/Delete`
Per `13` §9. Props: `{ activeOrders: { id: Ulid; number: string }[]; canExport: boolean }`.
Sections: **Download my data** — **Download** (`customer.account.export`; `recent.auth`, `verified.contact`; disabled with §1.1 text when unverified). **Delete account** — explanation (what is kept anonymised: orders/quotes; what is deleted; 30-day recovery window), blocked list when `activeOrders` non-empty ("Finish or cancel these orders first: {numbers}" with links); otherwise input "Type DELETE to confirm" (`confirmation`; translated word per `13`) + **Delete my account** (destructive) → `customer.account.destroy`. Errors: `account.errors.active_orders`, `account.errors.confirmation` "Type DELETE to confirm."

---

## 14. Help & contact — `customer.help` · `/help` · `Customer/Help`
Props `{ business: { name: string; phoneE164: string | null; whatsappUrl: string | null; email: string; workingHours: string; addressOneLine: string | null } }` (`whatsappUrl` = `https://wa.me/{digits}` when a phone is set).
Sections: **Contact us** (call, WhatsApp, email, hours, address) + "Questions about an order? Use the messages on the order page — that's the fastest way to reach your team." (link to orders). **FAQ** (`Accordion`, keys `help.faq.{1..10}.{q,a}`): uploading a plan; DWG files; AI credits; estimate accuracy; changing designs after submitting; what happens after accepting a quote; following production; problems when finished; phone notifications; deleting the account. Links to Terms and Privacy.

---

## 15. PWA (installability + web push)
- Manifest route `manifest` and service worker `public/sw.js` are specified in `12` §8.3 (push, notificationclick, pushsubscriptionchange; **no fetch caching**). This file adds:
  - Manifest values: `name` = business name, `short_name` = app name (≤ 12 chars, truncated), `id` `/`, `start_url` `/`, `scope` `/`, `display` `standalone`, `background_color` / `theme_color` `#fbfaf7` (light background token), icons `/icons/app-192.png` (192), `/icons/app-512.png` (512), `/icons/app-maskable-512.png` (512, `purpose: maskable`).
  - `app.blade.php` head: `<link rel="manifest" href="/manifest.webmanifest">`, `<link rel="apple-touch-icon" href="/icons/apple-touch-icon-180.png">`, `<meta name="apple-mobile-web-app-capable" content="yes">`, `<meta name="theme-color">` per `15` §11.
  - Default icon set committed in `public/icons/` (rounded square, walnut `#6b4a33` background, white simple "house + panel" glyph); owners replace files in place (no admin UI in v1). Notification icons per `12` (`/icons/notification-192.png`, `/icons/badge-72.png`).
- Acceptance: Chrome offers "Install app"; a web push for `quote.sent` opens the quote page; iOS home-screen app receives pushes after enabling.

---

## 16. Real-time summary (customer)

| Page | Channel | Behaviour |
|---|---|---|
| All (AppShell) | `users.{id}` | `NotificationCreated` → bell + toast; `AiCreditsChanged` → `CreditBadge` refresh |
| Dashboard | `users.{id}` | reload `actionItems`, `ordersInProgress`, `credits` (throttled 2 s) |
| Order, quote, proposal, completion pages | `orders.{id}` | §11.4.8 |
| Import page | `imports.{id}` | §9.2 |
| Furniture builder | `furniture-designs.{id}` | lock/unlock → read-only toggle (`07`) |
| Project page | — | poll imports while non-terminal (§7.3.6) |

---

## 17. Acceptance criteria (customer app, cross-cutting)

1. Every route in §2 exists with the stated name, method, path and page component; links use Wayfinder helpers.
2. Customers never load another customer's resources (404) and never receive staff-internal data (internal notes, internal updates, hidden quote lines, cost snapshots, call details beyond `no_answer` dates) — Pest tests assert prop payloads.
3. No horizontal scroll at 375 px; editors view-only below 768 px; touch targets ≥ 44 px.
4. Every list has empty, no-results and loading states; deferred props show skeletons; failures show `ErrorState` with retry.
5. All visible strings come from translation keys.
6. Customer transitions (T1, T2, T3, T5, T7, T10, T11, T14, T21, T22, T29) are reachable exactly in their `09` states with the confirmations and messages specified here.
7. With the socket disconnected, order and import pages reflect changes within 30 s.
8. Unverified customers see the explanations of §1.1 instead of failing silently.

---

## Appendix: Proposed additions to other documents

**A1 — 02 §1.1 `users`:** `onboarded_at timestamptz null` (set by onboarding store/skip; staff are created with `onboarded_at = now()`). Middleware alias `onboarded` → `App\Http\Middleware\EnsureCustomerOnboarded`.

**A2 — 02 §8.7 `quote_negotiations`:** `item_comments jsonb not null default '[]'` — array of `{ order_item_id: ulid, comment: string(≤ 500) }` (09 §6 per-item comments).

**A3 — Plan starters:** `config/plan_starters.php` → `[key => ['label_key' => 'plans.starters.{key}.label', 'description_key' => 'plans.starters.{key}.description', 'document' => 'database/fixtures/plan-starters/{key}.json', 'thumbnail' => 'images/plan-starters/{key}.svg']]` for `single_room`, `l_shaped_room`, `studio`, `one_bhk`, `two_bhk`, `three_room_hdb`; `customer.projects.plans.store` with `start=starter` copies the document with fresh entity ids (`newId`), `plans.source = 'drawn'`, `meta.createdWith = 'editor'`. (05 wins if it defines a registry.)

**A4 — 02 §8.11 `deliveries`:** `scheduled_until timestamptz null` (end of the delivery window; 09 §9 "date/time window").

**A5 — 02 §13 `workflow`:** `min_preferred_delivery_days int default 7`.

**A6 — `UpdateProject` rule:** editing an address referenced by an Active order creates a new `addresses` row instead of mutating it.

**A7 — Wire-format convention (01 §6 / 14):** Inertia props and JSON are camelCase (01's `auth.user` field list is serialised as `unitSystem`, `lengthUnit`, …); request bodies camelCase except Fortify/`13` auth forms; query strings Laravel-style snake_case.

**A8 — Route:** `api.furniture-revisions.show` GET `/api/furniture-revisions/{revision}` → `{ id, number, document: FurnitureDocument, bomStatus, catalogVersion }` (policy: `FurnitureDesignPolicy::view` on the revision's design; staff `orders.view`).

**A9 — Routes:** `customer.account.notifications.reset` DELETE `/account/notifications`; `customer.account.notifications.test-push` POST `/account/notifications/test-push` (throttle 3/min) and staff `admin.account.notifications.test-push`; event key `system.test_push` (12: webpush only, not configurable).

**A10 — Public legal pages:** `legal.terms` GET `/terms`, `legal.privacy` GET `/privacy` (pages `Legal/Terms`, `Legal/Privacy`; text keys `legal.terms.body`, `legal.privacy.body`) — targets of the `terms` checkbox links required by `13` §5.1.

**A11 — Customer route names (14):** furniture list `customer.furniture.index` GET `/furniture`, `customer.furniture.update` PATCH `/furniture/{design}`, `customer.furniture.destroy` DELETE `/furniture/{design}`; plans `customer.projects.plans.store`, `customer.plans.edit` GET `/plans/{plan}/edit`, `customer.plans.update|duplicate|destroy`; orders `customer.projects.orders.create|store`; `customer.account.profile|preferences` (+ `.update`), `customer.account.avatar.update`. `07`'s `customer.projects.furniture.store` body gains optional `returnPlanId`.

**A12 — Hold reason:** `OrderData.holdReason` = `reason` stored in the activity-log properties of the latest `order.on_hold` entry (T26).

**A13 — Customer `can.postMessage`** combines `MessagePolicy::create` (13 §8.8, incl. `verified.contact` and the 90-day rule) with `postMessageBlockedReason`.
