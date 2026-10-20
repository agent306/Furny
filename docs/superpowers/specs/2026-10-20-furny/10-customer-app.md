# 10 — Customer App

Read the master document, `01`, `02`, `03`, `09` and `15` first. This file is normative for **every customer-facing page**: route name, URL, Inertia page component, layout, props, sections, actions, validation messages, empty/loading/error states, visibility, responsive behaviour, real-time behaviour and acceptance criteria.

Owned elsewhere (referenced, not re-specified): plan editor canvas, tools and panels → `05`; blueprint import pipeline and review-mode editor internals → `06`; furniture builder internals → `07`; BOM/pricing formulas → `08`; notification events/channels/templates → `12`; authentication flows, OTP rules, rate limits, account anonymisation → `13`; controllers/FormRequests → `14` (which is written **from the route tables in §2 of this file and of `11`**); tokens/components/layouts → `15`.

---

## 1. Conventions used in this file

- **Route names** `customer.*` (authenticated customer pages and actions), `auth.*` / Fortify names (auth), shared names without prefix only for cross-audience endpoints (`media.show`, `notifications.*`, `pwa.*`, `welcome`), JSON endpoints `api.*`.
- **Controllers** live in `app/Http/Controllers/Customer/*` (pages + form actions), `Auth/*`, `Api/*` (`01` §3). All customer routes use middleware `web`, `auth`, `customer` (middleware `EnsureCustomer`: a staff user requesting a `customer.*` GET route is redirected to `admin.dashboard`; non-GET → 403), and `onboarded` (§5.1). Email verification is **not** required to use the app; only T2 requires a verified email or phone (checked in the action).
- **Page components** under `resources/js/pages/`. Every page sets `<Head :title="t(...)">` and `defineOptions({ layout })`.
- **Props** are TypeScript shapes of spatie/laravel-data objects (names end in `Data`), **snake_case** properties (decision in `15` Appendix 6). JSONB contents (`summary`, `estimate`, `hints`, documents) keep their camelCase keys. Types are generated into `types/generated.d.ts`; the shapes below are normative.
- **Permissions:** customers have no spatie permissions; access is decided by policies (owner of project/order). Every page below is customer-only. "Visible if" conditions refer to the `can` ability object the server sends (never re-derive state rules on the client).
- **Responsive:** phone < 768 px = view, approve, chat, quotes, progress **and simple forms** (projects, orders draft/submit, settings, uploads). The **editors** (plan editor, import review, furniture builder) are view-only on phones (`05`/`06`/`07` view-only modes). Tablet 768–1023 and desktop ≥ 1024 = everything.
- **Strings:** every text below is given as `translation.key` "English value". Keys not listed explicitly follow `15` §15.2.
- **Ids** in URLs are ULIDs; route model binding with `scopeBindings()` for nested routes (a plan must belong to the project in the URL, else 404).
- Error pages: 403/404/419/429/500/503 rendered by the Inertia error page `pages/Error.vue` (§4.9).

---

## 2. Route & page index (complete)

### 2.1 Pages (GET, Inertia)

| # | Route name | Path | Page component | Layout | §|
|---|---|---|---|---|---|
| 1 | `welcome` | `/` | `Welcome` | AuthLayout (variant `wide`) | 4.1 |
| 2 | `login` (Fortify) | `/login` | `Auth/Login` | AuthLayout | 4.2 |
| 3 | `register` (Fortify) | `/register` | `Auth/Register` | AuthLayout | 4.3 |
| 4 | `auth.otp.verify.show` | `/login/phone/verify` | `Auth/PhoneVerify` | AuthLayout | 4.4 |
| 5 | `password.request` (Fortify) | `/forgot-password` | `Auth/ForgotPassword` | AuthLayout | 4.5 |
| 6 | `password.reset` (Fortify) | `/reset-password/{token}` | `Auth/ResetPassword` | AuthLayout | 4.5 |
| 7 | `verification.notice` (Fortify) | `/email/verify` | `Auth/VerifyEmail` | AuthLayout | 4.6 |
| 8 | `two-factor.login` (Fortify) | `/two-factor-challenge` | `Auth/TwoFactorChallenge` | AuthLayout | 4.7 |
| 9 | `password.confirm` (Fortify) | `/user/confirm-password` | `Auth/ConfirmPassword` | AuthLayout | 4.8 |
| 10 | `customer.onboarding.show` | `/onboarding` | `Customer/Onboarding/Wizard` | AuthLayout (variant `wide`) | 5 |
| 11 | `customer.dashboard` | `/dashboard` | `Customer/Dashboard` | CustomerLayout | 6 |
| 12 | `customer.projects.index` | `/projects` | `Customer/Projects/Index` | CustomerLayout | 7.1 |
| 13 | `customer.projects.create` | `/projects/create` | `Customer/Projects/Create` | CustomerLayout | 7.2 |
| 14 | `customer.projects.show` | `/projects/{project}` | `Customer/Projects/Show` | CustomerLayout | 7.3 |
| 15 | `customer.projects.edit` | `/projects/{project}/edit` | `Customer/Projects/Edit` | CustomerLayout | 7.4 |
| 16 | `customer.plans.show` | `/projects/{project}/plans/{plan}` | `Customer/Plans/Editor` | EditorLayout | 8.2 |
| 17 | `customer.imports.create` | `/projects/{project}/imports/create` | `Customer/Imports/Create` | CustomerLayout | 9.1 |
| 18 | `customer.imports.show` | `/projects/{project}/imports/{import}` | `Customer/Imports/Show` | CustomerLayout | 9.2 |
| 19 | `customer.imports.review` | `/projects/{project}/imports/{import}/review` | `Customer/Imports/Review` | EditorLayout | 9.3 |
| 20 | `customer.designs.index` | `/designs` | `Customer/Designs/Index` | CustomerLayout | 10.1 |
| 21 | `customer.designs.create` | `/projects/{project}/designs/create` | `Customer/Designs/Create` | CustomerLayout | 10.2 |
| 22 | `customer.designs.show` | `/projects/{project}/designs/{design}` | `Customer/Designs/Builder` | EditorLayout | 10.3 |
| 23 | `customer.orders.index` | `/orders` | `Customer/Orders/Index` | CustomerLayout | 11.1 |
| 24 | `customer.orders.create` | `/projects/{project}/orders/create` | `Customer/Orders/Create` | CustomerLayout | 11.2 |
| 25 | `customer.orders.edit` | `/orders/{order}/edit` | `Customer/Orders/Draft` | CustomerLayout | 11.3 |
| 26 | `customer.orders.show` | `/orders/{order}` | `Customer/Orders/Show` | CustomerLayout | 11.4 |
| 27 | `customer.orders.proposals.show` | `/orders/{order}/proposals/{proposal}` | `Customer/Orders/ProposalReview` | CustomerLayout | 11.5 |
| 28 | `customer.orders.quotes.show` | `/orders/{order}/quotes/{quote}` | `Customer/Orders/Quote` | CustomerLayout | 11.6 |
| 29 | `customer.orders.completion.show` | `/orders/{order}/completion` | `Customer/Orders/CompletionReview` | CustomerLayout | 11.8 |
| 30 | `customer.notifications.index` | `/notifications` | `Customer/Notifications/Index` | CustomerLayout | 12 |
| 31 | `customer.settings.profile` | `/settings/profile` | `Customer/Settings/Profile` | CustomerLayout + `SettingsNav` | 13.2 |
| 32 | `customer.settings.password` | `/settings/password` | `Customer/Settings/Password` | same | 13.3 |
| 33 | `customer.settings.preferences` | `/settings/preferences` | `Customer/Settings/Preferences` | same | 13.4 |
| 34 | `customer.settings.notifications` | `/settings/notifications` | `Customer/Settings/Notifications` | same | 13.5 |
| 35 | `customer.settings.credits` | `/settings/ai-credits` | `Customer/Settings/Credits` | same | 13.6 |
| 36 | `customer.settings.account` | `/settings/account` | `Customer/Settings/Account` | same | 13.7 |
| 37 | `customer.help` | `/help` | `Customer/Help` | CustomerLayout | 14 |
| 38 | `pwa.manifest` | `/manifest.webmanifest` | (JSON response) | — | 15 |

`/` for an authenticated customer redirects to `customer.dashboard` (or `customer.onboarding.show` if not onboarded); for staff to `admin.dashboard`. Fortify `home` path is `/dashboard`; staff hitting `/dashboard` are redirected to `admin.dashboard`.

### 2.2 Actions (form posts; Inertia redirects back or to the named route)

| Route name | Method | Path | Body (snake_case) | Effect / transition | Redirect |
|---|---|---|---|---|---|
| `auth.otp.send` | POST | `/login/phone` | `phone_e164`, `purpose` (`login`), `channel?` (`whatsapp`\|`sms`), `name?` (registration) | Send OTP (`13`) | `auth.otp.verify.show` |
| `auth.otp.verify` | POST | `/login/phone/verify` | `phone_e164`, `code` | Log in / register (`13`) | intended or dashboard |
| `auth.google.redirect` | GET | `/auth/google/redirect` | — | Socialite | Google |
| `auth.google.callback` | GET | `/auth/google/callback` | — | Login/register (`13`) | dashboard |
| Fortify: `login`, `logout`, `register`, `password.email`, `password.update`, `verification.send`, `two-factor.login`, `password.confirm`, `user-password.update` | POST/PUT | Fortify defaults | per Fortify | per `13` | — |
| `customer.onboarding.store` | POST | `/onboarding` | §5.3 | Profile + optional project/plan, sets `onboarded_at` | per choice |
| `customer.onboarding.skip` | POST | `/onboarding/skip` | — | sets `onboarded_at` | dashboard |
| `customer.projects.store` | POST | `/projects` | `name`, `property_type`, `notes?`, `site_address?` | `CreateProject` | `customer.projects.show` |
| `customer.projects.update` | PUT | `/projects/{project}` | same as store | update | `customer.projects.show` |
| `customer.projects.archive` | POST | `/projects/{project}/archive` | — | `ArchiveProject` | back |
| `customer.projects.unarchive` | POST | `/projects/{project}/unarchive` | — | status → active | back |
| `customer.projects.destroy` | DELETE | `/projects/{project}` | `confirmation` (= project name) | soft delete | `customer.projects.index` |
| `customer.plans.store` | POST | `/projects/{project}/plans` | `name`, `level_index`, `start` (`blank`\|`starter`), `starter_key?` | `CreatePlan` | `customer.plans.show` |
| `customer.plans.update` | PATCH | `/projects/{project}/plans/{plan}` | `name?`, `level_index?` | rename/reorder | back |
| `customer.plans.duplicate` | POST | `/projects/{project}/plans/{plan}/duplicate` | `name` | `DuplicatePlan` | back |
| `customer.plans.destroy` | DELETE | `/projects/{project}/plans/{plan}` | — | soft delete | `customer.projects.show` |
| `customer.imports.start` | POST | `/projects/{project}/imports/{import}/start` | `selected_page`, `hints`, `target` | queue recognition (`06`), reserve credits | `customer.imports.show` |
| `customer.imports.cancel` | POST | `/projects/{project}/imports/{import}/cancel` | — | `CancelImport` (`06`) | `customer.imports.show` |
| `customer.imports.accept` | POST | `/projects/{project}/imports/{import}/accept` | `document`, `plan_name?`, `level_index?` | `AcceptImportIntoPlan` (`06`) | `customer.plans.show` |
| `customer.imports.discard` | POST | `/projects/{project}/imports/{import}/discard` | — | status `discarded` (`06`) | `customer.projects.show` (tab imports) |
| `customer.imports.retry` | POST | `/projects/{project}/imports/{import}/retry` | — | new import copying source (`06`) | `customer.imports.create?import={new}` |
| `customer.imports.trace` | POST | `/projects/{project}/imports/{import}/trace` | `plan_name`, `level_index` | create plan with background, mode `trace` (`06`) | `customer.plans.show` |
| `customer.designs.store` | POST | `/projects/{project}/designs` | `source` (`preset`\|`template`\|`duplicate`), `preset_id?`, `template_key?`, `from_design_id?`, `name`, `return_plan?` | `CreateFurnitureDesign` | `customer.designs.show` (+`?return_plan=`) |
| `customer.designs.update` | PATCH | `/projects/{project}/designs/{design}` | `name` | rename | back |
| `customer.designs.duplicate` | POST | `/projects/{project}/designs/{design}/duplicate` | `name` | `DuplicateFurnitureDesign` (from pinned revision if locked, `09` §3) | `customer.designs.show` (new) |
| `customer.designs.destroy` | DELETE | `/projects/{project}/designs/{design}` | — | soft delete (blocked if locked or in any order) | `customer.projects.show?tab=designs` |
| `customer.orders.store` | POST | `/projects/{project}/orders` | `design_ids[]` | **T1** | `customer.orders.edit` |
| `customer.orders.update` | PUT | `/orders/{order}` | §11.3.4 | save draft | back |
| `customer.orders.submit` | POST | `/orders/{order}/submit` | §11.3.4 (full payload) | save + **T2** | `customer.orders.show` |
| `customer.orders.destroy` | DELETE | `/orders/{order}` | — | `DeleteDraftOrder` (never-submitted draft) | `customer.orders.index` |
| `customer.orders.cancel` | POST | `/orders/{order}/cancel` | `note?` | **T3** | `customer.orders.show` |
| `customer.orders.withdraw` | POST | `/orders/{order}/withdraw` | `note?` | **T29** | `customer.orders.show` |
| `customer.orders.reopen` | POST | `/orders/{order}/reopen` | — | **T5** | `customer.orders.edit` |
| `customer.orders.proposals.resolve` | POST | `/orders/{order}/proposals/{proposal}/resolve` | `decisions[]: {item_id, decision, comment?}`, `comment?` | **T7** | `customer.orders.show` |
| `customer.orders.quotes.accept` | POST | `/orders/{order}/quotes/{quote}/accept` | `accept_terms` (must be `true`) | **T10** | `customer.orders.show` |
| `customer.orders.quotes.negotiate` | POST | `/orders/{order}/quotes/{quote}/negotiate` | `message`, `proposed_total_minor?`, `item_comments?[]: {order_item_id, comment}` | **T11** | `customer.orders.show` |
| `customer.orders.quotes.decline` | POST | `/orders/{order}/quotes/{quote}/decline` | `reason` | **T14** | `customer.orders.show` |
| `customer.orders.quotes.pdf` | GET | `/orders/{order}/quotes/{quote}/pdf` | — | 302 to temporary URL (404 `pdf_not_ready` while rendering) | — |
| `customer.orders.completion.approve` | POST | `/orders/{order}/completion/approve` | — | **T21** | `customer.orders.show` |
| `customer.orders.issues.store` | POST | `/orders/{order}/issues` | `issues[]: {description, order_item_id?, upload_tokens[]}` (≥ 1) | **T22** | `customer.orders.show` |
| `customer.orders.messages.store` | POST | `/orders/{order}/messages` | `body`, `upload_tokens[]`, `template?` (`callback_request`), `callback_at?` | `PostMessage` | back (preserveScroll) |
| `customer.orders.messages.update` | PATCH | `/orders/{order}/messages/{message}` | `body` | edit within 10 min | back |
| `customer.orders.messages.read` | POST | `/orders/{order}/messages/read` | `last_message_id` | `MarkThreadRead` | 204 (XHR via `lib/http.ts`) |
| `notifications.read` | POST | `/notifications/{notification}/read` | — | mark read | 204 |
| `notifications.read-all` | POST | `/notifications/read-all` | — | mark all read | back |
| `customer.settings.profile.update` | PUT | `/settings/profile` | `name`, `email?`, `marketing_opt_in` | update; email change resets `email_verified_at` and sends verification | back |
| `customer.settings.avatar.update` | PUT | `/settings/avatar` | `upload_token` \| null | set/remove avatar | back |
| `customer.settings.phone.send-code` | POST | `/settings/phone/send-code` | `phone_e164`, `channel?` | OTP purpose `verify_phone` (`13`) | back |
| `customer.settings.phone.verify` | POST | `/settings/phone/verify` | `phone_e164`, `code` | sets `phone_e164`, `phone_verified_at` | back |
| `customer.settings.preferences.update` | PUT | `/settings/preferences` | `unit_system`, `length_unit`, `timezone` | update | back |
| `customer.settings.notifications.update` | PUT | `/settings/notifications` | `changes[]: {event_key, channel, enabled}` | `UpdatePreferences` | back |
| `customer.settings.account.destroy` | DELETE | `/settings/account` | `password?` \| `code?`, `confirmation` (= `DELETE`) | anonymise (`13`) + logout | `welcome` |

### 2.3 JSON endpoints used by customer pages

| Name | Method | Path | Used by | Response |
|---|---|---|---|---|
| `api.uploads.presign` | POST | `/api/uploads/presign` | `FileDropzone` | `15` §9.10 |
| `api.imports.store` | POST | `/api/projects/{project}/imports` | Import wizard | §9.1.4 |
| `api.imports.uploaded` | POST | `/api/imports/{import}/uploaded` | Import wizard | §9.1.4 |
| `api.imports.show` | GET | `/api/imports/{import}` | Import wizard (page previews), progress fallback polling | `{ import: ImportData, pages: ImportPagePreviewData[] }` |
| `api.notifications.index` | GET | `/api/notifications?limit=10` | `NotificationBell` | `{ data: NotificationData[], unread_count: number }` |
| `api.push-subscriptions.store` | POST | `/api/push-subscriptions` | Push enable | `{ endpoint, keys: { p256dh, auth }, content_encoding }` → 201 |
| `api.push-subscriptions.destroy` | DELETE | `/api/push-subscriptions` | Push disable | `{ endpoint }` → 204 |
| `api.furniture-revisions.show` | GET | `/api/furniture-revisions/{revision}` | `Thumbnail3D`, proposal viewer | `{ id, number, document: FurnitureDocument, bom_status, catalog_version }` |
| `media.show` | GET | `/media/{media:uuid}?conversion=` | every `MediaData.url` | 302 → 15-min temporary URL after policy check |
| Editors (`03` §5): `/api/plans/{plan}/working-copy`, `/api/furniture-designs/{design}/working-copy`, revisions, `/api/catalog/snapshot` | — | — | `05`/`07` | `03` |

---

## 3. Shared data objects (customer)

```ts
type Ulid = string;
type IsoDateTime = string;          // ISO-8601 UTC, e.g. "2026-10-20T09:15:00Z"
type IsoDate = string;              // "YYYY-MM-DD" (business TZ date)
type OrderStateKey = 'draft' | 'submitted' | 'in_review' | 'changes_proposed' | 'quoted' | 'negotiating'
  | 'accepted' | 'confirmed' | 'in_production' | 'completed' | 'rework' | 'ready_for_delivery'
  | 'delivered' | 'closed' | 'cancelled' | 'on_hold';
type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'primary';
type PropertyType = 'apartment' | 'independent_house' | 'villa' | 'office' | 'other';

interface UserRefData { id: Ulid; name: string; avatar_url: string | null; is_staff: boolean }

interface AddressData {
  id: Ulid; label: string | null; line1: string; line2: string | null; city: string;
  region: string | null; postal_code: string | null; country_code: string;
  one_line: string;                 // server-formatted single line for display
}
interface AddressFormData {         // form payload (nested key e.g. site_address.*)
  id?: Ulid | null;                 // existing address id to reuse/update
  label: string | null; line1: string; line2: string | null; city: string;
  region: string | null; postal_code: string | null; country_code: string;
}

interface MediaData {
  id: string;                       // media uuid
  name: string; mime_type: string; size: number;
  url: string;                      // route('media.show', uuid) — stable, policy-checked redirect
  thumb_url: string | null;         // media.show?conversion=thumb (images only)
  large_url: string | null;         // media.show?conversion=large
  width: number | null; height: number | null;
}

interface ProjectSummaryData {
  id: Ulid; name: string; property_type: PropertyType; status: 'active' | 'archived';
  cover_url: string | null;         // project cover (auto 3D thumbnail) or first plan thumbnail
  plan_count: number; design_count: number; active_order_count: number;
  action_needed_count: number;      // orders of this project with a customer action (§11.4.2)
  updated_at: IsoDateTime;
}
interface ProjectData extends ProjectSummaryData {
  notes: string | null; site_address: AddressData | null; created_at: IsoDateTime;
  can: { update: boolean; archive: boolean; unarchive: boolean; delete: boolean; create_order: boolean };
}
interface ProjectRefData { id: Ulid; name: string; status: 'active' | 'archived' }

interface PlanSummaryJson { wallCount: number; roomCount: number; totalAreaMm2: number; rooms: { id: string; name: string; areaMm2: number }[] }
interface PlanSummaryData {
  id: Ulid; project_id: Ulid; name: string; level_index: number;
  source: 'drawn' | 'imported' | 'traced' | 'duplicated';
  thumbnail_url: string | null; thumbnail_small_url: string | null;
  summary: PlanSummaryJson;
  working_saved_at: IsoDateTime | null; updated_at: IsoDateTime;
}

interface FurnitureEstimateJson { totalMinor: number; currency: string; partCount: number; sheetCount: number; catalogVersion: number; engineVersion: string; computedAt: string }
interface OrderRefData { id: Ulid; number: string; state: OrderStateKey }
interface FurnitureDesignSummaryData {
  id: Ulid; project_id: Ulid; project_name: string; name: string;
  template_key: string; template_label: string;   // translated template name (07)
  thumbnail_url: string | null;
  width_mm: number; height_mm: number; depth_mm: number;
  estimate: FurnitureEstimateJson | null;
  estimate_stale: boolean;          // estimate.catalogVersion < current catalog.version
  locked_by_order: OrderRefData | null;
  updated_at: IsoDateTime;
}

interface CustomerOrderAction {
  kind: 'finish_draft' | 'resubmit' | 'review_proposal' | 'review_quote' | 'check_completion';
  href: string; since: IsoDateTime;
}
interface OrderSummaryData {
  id: Ulid; number: string; is_draft_number: boolean; title: string;
  state: OrderStateKey; state_before_hold: OrderStateKey | null;
  project: ProjectRefData; item_count: number;
  thumbnail_urls: string[];         // up to 3 item thumbnails
  quote_total_minor: number | null; // current sent/accepted quote total
  production_progress: number; production_stage_label: string | null;
  action: CustomerOrderAction | null;
  expected_delivery_on: IsoDate | null;
  unread_messages: number;
  submitted_at: IsoDateTime | null; updated_at: IsoDateTime;
}

interface TimelineEntryData {       // 09 §12 (customer variant filters internal entries server-side)
  id: string;
  kind: 'state_change' | 'proposal' | 'quote' | 'negotiation' | 'call' | 'production_update' | 'issue' | 'delivery' | 'system';
  at: IsoDateTime; actor: UserRefData | null;
  title_key: string; params: Record<string, string | number | null>;
  body_html: string | null; photos: MediaData[];
  links: { label_key: string; href: string }[];
  visibility: 'customer' | 'internal';
  state: OrderStateKey | null;      // for state_change entries (icon/tone)
}

interface MessageData {
  id: Ulid; kind: 'text' | 'system' | 'internal_note';
  author: UserRefData | null;
  body: string;                     // raw Markdown subset (for editing own messages)
  body_html: string;                // sanitised HTML rendered server-side (Str::markdown, html_input=strip, allow_unsafe_links=false)
  system_event: string | null; system_payload: Record<string, unknown> | null;
  attachments: MediaData[];
  edited_at: IsoDateTime | null; created_at: IsoDateTime;
  can_edit: boolean;                // own text message, < 10 min old
}

interface NotificationData {
  id: string;                       // notifications.id (uuid)
  event_key: string;                // 12 catalogue
  title: string; body: string | null;   // rendered server-side with trans_icu from the stored payload (12)
  action_url: string | null; icon: string;   // lucide icon name from the event group
  read_at: IsoDateTime | null; created_at: IsoDateTime;
}

interface AiCreditsData {
  balance: number; monthly_allowance: number; next_grant_on: IsoDate;
  cost_per_recognition: number; cost_per_recognition_none: number;
  recognitions_today: number; max_recognitions_per_day: number;
  ai_available: boolean;            // ai.provider !== 'none' and budget not exhausted with behaviour 'block'
}
```

---

## 4. Public & authentication pages

All use `AuthLayout` (`15` §7.4). Flows, rate limits and security behaviour are defined in `13`; this section defines UI only. Every form shows field errors inline and a generic error `Alert` for `_error`. Throttling responses (429) show `auth.errors.throttled` "Too many attempts. Try again in {seconds} seconds." with a live countdown.

### 4.1 Welcome — `welcome` · `/` · `Welcome`
Props: `{ can_register: boolean }` (+ shared `features`, `business`).
Content (no marketing site): logo + app name (Display), tagline `welcome.tagline` "Design furniture that fits your home perfectly.", three rows with icons: `scan-line` `welcome.points.upload` "Upload your floor plan or draw it", `armchair` `welcome.points.design` "Design custom furniture in 2D and 3D", `package-check` `welcome.points.track` "Get a quote and follow production to delivery". Buttons: **Create account** (primary, → `register`, hidden if `!can_register`) and **Log in** (outline, → `login`). Footer: business phone (`tel:`), email (`mailto:`), working hours.
Phone: single column, buttons full-width. Acceptance: no external requests other than to own origin; Lighthouse accessibility ≥ 95.

### 4.2 Login — `login` · `/login` · `Auth/Login`
Props: `{ status: string | null; can_reset_password: boolean; can_register: boolean; phone_login_enabled: boolean /* features.whatsapp || features.sms */; google_enabled: boolean }`.
- Title `auth_ui.login.title` "Log in".
- If `phone_login_enabled`: `Tabs` "Email" | "Phone" (remember last tab in `localStorage['fs:ui:login-tab']`).
- Email tab: Email (`type=email`, `autocomplete=username`), Password (`autocomplete=current-password`, show/hide toggle), "Remember me" checkbox, "Forgot password?" link (→ `password.request`), **Log in** button (full width). Errors: Fortify `auth.failed` rendered under email.
- Phone tab: `PhoneInput`, helper `auth_ui.login.phone_hint` "We'll send a 6-digit code by WhatsApp or SMS.", **Send code** → `auth.otp.send` (`purpose=login`) → `auth.otp.verify.show`.
- Divider "or", **Continue with Google** (outline, Google "G" SVG mark inline, only if `google_enabled`) → `auth.google.redirect`.
- Footer: "New here? Create an account" (→ `register`).
- `status` (e.g. after password reset) shown as `success` Alert.
- Staff use the same page; after login staff go to `admin.dashboard`; if 2FA is enabled Fortify redirects to `two-factor.login`.

### 4.3 Register — `register` · `/register` · `Auth/Register`
Props: `{ phone_login_enabled: boolean; google_enabled: boolean }`.
- Tabs "Email" | "Phone" (as login). Email tab fields: Name (≤ 120), Email, Password (with strength hint `auth_ui.password_rules` "At least 8 characters."), Confirm password, checkbox "Send me occasional updates and offers" (`marketing_opt_in`, unchecked). **Create account** → Fortify `register` → `verification.notice`.
- Phone tab: Name, `PhoneInput` → **Send code** → `auth.otp.send` with `purpose=login`, `name` → verify page; on verify the account is created (`13`).
- Google button as on login.
- Legal line `auth_ui.register.consent` "By creating an account you agree to our privacy notice." linking to `customer.help#privacy` (help is authenticated; for guests the link opens a dialog containing `help.privacy.body`).

### 4.4 Phone code — `auth.otp.verify.show` · `/login/phone/verify` · `Auth/PhoneVerify`
Props: `{ phone_e164: string; phone_masked: string; channel: 'whatsapp' | 'sms'; resend_available_in: number /* seconds */; alternate_channel: 'whatsapp' | 'sms' | null }` (session-backed; visiting without a pending OTP redirects to `login`).
- Text `auth_ui.otp.sent` "We sent a code to {phone} via {channel, select, whatsapp {WhatsApp} other {SMS}}."
- shadcn `PinInput` 6 digits (`inputmode=numeric`, `autocomplete=one-time-code`), auto-submits on the 6th digit → `auth.otp.verify`.
- "Resend code" (disabled with countdown), "Send by SMS instead" / "Send by WhatsApp instead" when `alternate_channel`. "Use a different number" → back.
- Errors: `auth.otp.invalid` "That code isn't right. {remaining, plural, one {# attempt} other {# attempts}} left.", `auth.otp.expired` "This code has expired. Request a new one.", `auth.otp.too_many` "Too many wrong codes. Request a new code."

### 4.5 Forgot / reset password — `password.request`, `password.reset`
`Auth/ForgotPassword` props `{ status: string | null }`: Email field, **Email reset link**; success Alert with `status`. `Auth/ResetPassword` props `{ email: string; token: string }`: Email (read-only), Password, Confirm, **Reset password** → redirect to login with status.

### 4.6 Verify email — `verification.notice` · `Auth/VerifyEmail`
Props `{ status: string | null; email: string }`. Text `auth_ui.verify.body` "We sent a verification link to {email}. Click it to verify your address." Buttons: **Resend email** (`verification.send`; success "A new link has been sent."), **Continue without verifying** (→ dashboard — verification is required only to submit orders, which may also be satisfied by a verified phone), **Log out** (link button).

### 4.7 Two-factor challenge — `two-factor.login` · `Auth/TwoFactorChallenge`
Staff only in practice. Props `{}`. `PinInput` 6 digits for TOTP or toggle "Use a recovery code" (text input). **Continue**.

### 4.8 Confirm password — `password.confirm` · `Auth/ConfirmPassword`
Props `{}`. Password field + **Confirm**. Used before account deletion and staff sensitive actions (`13`).

### 4.9 Error page — `pages/Error.vue`
Props `{ status: 403 | 404 | 419 | 429 | 500 | 503 }`. Uses CustomerLayout when authenticated customer, AdminLayout for staff, AuthLayout for guests (decided in `HandleInertiaRequests` exception renderer). `EmptyState` per status: 403 `lock` "You don't have access to this page."; 404 `map-pin-off` "We couldn't find that page."; 419 `refresh-cw` "Your session expired. Please reload."; 429 `hourglass` "Too many requests. Please wait a moment."; 500 `triangle-alert` "Something went wrong on our side."; 503 `wrench` "We're doing maintenance. Back shortly." Actions: "Go to dashboard", "Reload" (419/500/503).

---

## 5. Onboarding (first login wizard)

### 5.1 Gate
Middleware `EnsureCustomerOnboarded` (alias `onboarded`) on all `customer.*` routes except `customer.onboarding.*`, `customer.settings.*`, `customer.help`, `logout`, notifications: if `auth()->user()->type === 'customer' && onboarded_at === null` → redirect (GET only) to `customer.onboarding.show`. Uses column `users.onboarded_at` (Appendix A1).

### 5.2 Page — `customer.onboarding.show` · `/onboarding` · `Customer/Onboarding/Wizard`
Props:
```ts
interface OnboardingProps {
  user: { name: string; email: string | null; phone_e164: string | null; phone_verified: boolean };
  defaults: { unit_system: 'metric' | 'imperial'; length_unit: string; timezone: string };  // from business settings
  property_types: PropertyType[];
  starters: PlanStarterData[];                 // §8.3
  ai_credits: AiCreditsData;                   // shows "You have N free credits to recognise a blueprint"
}
```
Layout: AuthLayout `wide` variant (card `max-w-2xl`). Header: step indicator "Step {n} of 4" + `Progress` bar. Footer: **Back** (ghost, hidden on step 1), **Continue** (primary), link "Skip for now" (→ `customer.onboarding.skip`, confirm dialog "You can set this up later from your dashboard.").

Steps (client-side; one final POST):
1. **About you** — Name (prefilled, required, ≤ 120); Phone (`PhoneInput`, optional if email exists, required if not; hint `onboarding.phone_hint` "We'll call this number to confirm orders."). Validation: `onboarding.errors.name_required` "Please enter your name.", `phone.errors.invalid`.
2. **Units** — Radio cards: **Metric** (mm · cm · m, example "2400 mm") / **Imperial** (feet & inches, example `7' 10 1/2"`); then length unit select (metric: mm/cm/m, imperial: ft-in/in) and timezone `Combobox` (default: `Intl.DateTimeFormat().resolvedOptions().timeZone` if in `Intl.supportedValuesOf('timeZone')`, else business default).
3. **Your first project** — Project name (default `onboarding.default_project_name` "My home"), property type (radio cards with icons: apartment `building`, independent_house `house`, villa `building-2`, office `briefcase`, other `shapes`).
4. **How do you want to start?** — `StartPlanChooser` (§8.1) with three large option cards:
   - **Upload a blueprint** (`upload`): "Photo, scan, PDF or DXF — we'll turn it into an editable plan." + `CreditBadge` "Uses {cost} credit · you have {balance}" (if `cost_per_recognition` > 0). Phone shows this option too (uploading from the camera is supported).
   - **Draw from scratch** (`pencil-ruler`): "Draw walls, doors and windows yourself." (on phone: disabled with note "Drawing needs a tablet or computer.")
   - **Start from a template room** (`layout-template`): reveals starter gallery (§8.3) to pick one (phone: disabled like draw).
   Selecting a card + **Finish** submits.

### 5.3 Submit — `customer.onboarding.store` (POST)
Body: `{ name, phone_e164?, unit_system, length_unit, timezone, project: { name, property_type }, start: 'upload' | 'draw' | 'starter' | 'none', starter_key? }`.
Server: updates user, sets `onboarded_at`, creates project; `draw` → creates plan "Ground floor" (`start=blank`) → redirect `customer.plans.show`; `starter` → creates plan from starter → `customer.plans.show`; `upload` → `customer.imports.create` for the new project; `none` → `customer.projects.show`.
Validation messages: `name` required; `phone_e164` E.164 + unique (`phone.errors.taken` "This number is already linked to another account."); `unit_system` in enum; `length_unit` consistent with system (`settings.errors.length_unit` "Choose a unit that matches your measurement system."); `timezone` valid IANA; `project.name` required ≤ 120 (`projects.errors.name_required` "Give your project a name."); `starter_key` required if `start=starter`, must exist.
Acceptance: a new customer is redirected to onboarding on first login; finishing with "Draw" lands in the plan editor of a new project; "Skip" never shows the wizard again; staff never see it.

---

## 6. Dashboard — `customer.dashboard` · `/dashboard` · `Customer/Dashboard`

Props:
```ts
interface CustomerDashboardProps {
  action_items: ActionItemData[];                 // sorted: tone danger/warning first, then since asc
  projects: ProjectSummaryData[];                 // up to 6 active, by updated_at desc
  project_count: number;
  orders_in_progress: OrderSummaryData[];         // Active orders (09 §1), up to 5, by updated_at desc
  ai_credits: AiCreditsData;
  contact_status: { email_verified: boolean; phone_verified: boolean };
}
interface ActionItemData {
  kind: 'review_proposal' | 'review_quote' | 'quote_expiring' | 'check_completion' | 'resubmit_order'
      | 'finish_draft' | 'review_import' | 'import_failed' | 'verify_contact';
  title_key: string; params: Record<string, string | number>;
  description_key: string | null;
  href: string; since: IsoDateTime; tone: Tone;
}
```
Action item sources: order `changes_proposed` → `review_proposal` (warning); `quoted` → `review_quote` (warning) or `quote_expiring` (danger, ≤ 2 days left); `completed` → `check_completion` (warning); `draft` with `submitted_at` → `resubmit_order` (info); `draft` never submitted, updated < 30 days ago → `finish_draft` (neutral); imports `ready_for_review` → `review_import` (warning); imports `failed` in last 7 days and not retried → `import_failed` (danger); no verified email **and** no verified phone → `verify_contact` (info, href `customer.settings.profile`).

Sections (desktop: 12-col grid; main 8 cols + side 4 cols):
1. `PageHeader` title `dashboard.title` "Hello, {name}"; actions: **New project** (primary).
2. **Action needed** (main, only if items): heading + list of `ActionPanel`-style compact cards (icon, title, description, `RelativeTime` since, chevron). Whole card is a link.
3. **Orders in progress** (main): rows with thumbnail stack, number, title, `StatusBadge`, compact `Stepper`, `ProductionProgress` (compact) when in production, unread message badge. "View all orders" link. Empty: hidden if no orders at all (the projects section carries the CTA).
4. **Your projects** (main): card grid (2 cols tablet/desktop, 1 col phone): cover image (16:10, placeholder grain), name, property type, counts "2 floors · 5 designs", action badge if `action_needed_count`. "+ New project" ghost card. "View all ({count})".
5. **AI credits** widget (side): big number balance, text `credits.widget.body` "Credits are used to recognise uploaded blueprints automatically. You get {monthly} free credits every month (next on {date})." Link **Upload a blueprint** (→ project chooser dialog if > 1 project, else import create of that project; if no project → `customer.projects.create`). Link "History" → `customer.settings.credits`. If `!ai_available`: note `credits.widget.ai_off` "Automatic recognition is unavailable right now; you can still trace your plan manually."
6. **Help** card (side): "Need help?" with business phone/WhatsApp and link to Help.

Empty state (no projects): replaces sections 3–4 with `EmptyState` (lg, icon `house`) title `dashboard.empty.title` "Let's start with your home", description "Create a project, then upload your floor plan or draw it.", action **Create your first project**.
Loading: initial props are not deferred (fast queries). Errors: standard Inertia error page.
Real-time: `useUserChannel` → `NotificationCreated` triggers `router.reload({ only: ['action_items', 'orders_in_progress'] })` (throttled); `AiCreditsChanged` → reload `ai_credits`.
Phone: single column order: Action needed → Orders → Projects → Credits → Help.
Acceptance: an order in `quoted` shows a "Review your quote" action linking to the quote page; an import `ready_for_review` shows "Review your imported plan"; credits update live after an import is charged.

---

## 7. Projects

### 7.1 Index — `customer.projects.index` · `/projects` · `Customer/Projects/Index`
Props: `{ projects: Paginated<ProjectSummaryData>; filters: { status: 'active' | 'archived'; search: string | null; sort: 'updated_at' | 'name' } }`. Default `status=active`, `sort=-updated_at`, `per_page=12`.
UI: `PageHeader` "Projects" + **New project**. Toolbar: segmented control Active / Archived, `SearchInput` (name), sort select (Recently updated / Name A–Z). Card grid (same card as dashboard) + `Pagination`.
Empty (active, no search): `EmptyState` icon `house` "No projects yet" + **Create project**. Empty archived: "No archived projects". No results: "No projects match “{search}”" + Clear.

### 7.2 Create — `customer.projects.create` · `/projects/create` · `Customer/Projects/Create`
Props: `{ property_types: PropertyType[]; addresses: AddressData[] /* user's saved */; default_country_code: string }`.
Form (`<Form>` → `customer.projects.store`): Name* (≤ 120), Property type* (radio cards), Site address (optional; `Select` of saved addresses or "Add an address" → `AddressFields` inline; nested `site_address.*`), Notes (≤ 2000, textarea). Buttons: **Create project** / Cancel. After creation → project page with the **Start** chooser open (empty project state §7.3.6).
Validation: `projects.errors.name_required`, `name` max "Name must be at most 120 characters." (Laravel default message), address fields per `AddressFields`.

### 7.3 Project page — `customer.projects.show` · `/projects/{project}` · `Customer/Projects/Show`
Query: `tab` ∈ `plans` (default) | `designs` | `orders` | `imports`; `plan` (selected plan id within plans tab).
Props:
```ts
interface ProjectShowProps {
  project: ProjectData;
  plans: PlanSummaryData[];                               // ordered by level_index asc
  designs: FurnitureDesignSummaryData[];                  // all non-deleted, updated_at desc
  orders: OrderSummaryData[];                             // all orders of the project, created desc (incl. drafts, closed, cancelled)
  imports: Inertia.Deferred<ImportSummaryData[]>;         // deferred (tab imports), last 50
  starters: PlanStarterData[];
  ai_credits: AiCreditsData;
}
interface ImportSummaryData {
  id: Ulid; original_filename: string; status: ImportStatus; mode: 'auto' | 'trace';
  source_kind: string | null; credits_charged: number; plan: { id: Ulid; name: string } | null;
  created_at: IsoDateTime; finished_at: IsoDateTime | null;
  href: string;                                           // show or review page
}
type ImportStatus = 'awaiting_upload' | 'uploaded' | 'queued' | 'preprocessing' | 'recognizing' | 'ready_for_review' | 'accepted' | 'discarded' | 'failed' | 'cancelled';
```

#### 7.3.1 Header
`PageHeader`: title = project name; meta: property type label, site address one-line (or "No address yet" link to edit), `Badge` "Archived" if archived. Actions: **New order** (primary; visible if `can.create_order` and ≥ 1 design; → `customer.orders.create`), overflow `DropdownMenu`: Edit project (→ edit), Archive / Unarchive (ConfirmDialog; archive copy `projects.confirm.archive` "Archive {name}? It will be hidden from your dashboard. You can restore it any time."), Delete (only if `can.delete`; ConfirmDialog destructive with `requireText` = project name; copy "This permanently removes the project, its plans and designs.").
Archived banner: `Alert` info "This project is archived. Unarchive it to make changes." + **Unarchive**. While archived, all create/edit actions are hidden and editors open read-only.

#### 7.3.2 Tabs
`Tabs` synced to `?tab=` via `router.get(..., { preserveState: true, replace: true, only: [] })` (no reload; tab content already in props except deferred imports). Tab labels with counts: Plans (n), Designs (n), Orders (n), Imports.

#### 7.3.3 Plans tab
- Floor sub-tabs (`ToggleGroup` / scrollable pills) — one per plan in `level_index` order, plus **+ Add floor**.
- Selected plan panel: large thumbnail (`aspect-[16/10]`, `object-contain`, `bg-canvas-bg`; placeholder "Preview will appear after the first save" if null), stats `KeyValueList`: Rooms `summary.roomCount`, Floor area `AreaDisplay(summary.totalAreaMm2)`, Walls `summary.wallCount`, Last saved `RelativeTime(working_saved_at)`, Source label (`plans.sources.{source}`: Drawn / Imported from blueprint / Traced / Duplicated). Room list (collapsible): name + area.
- Buttons: **Open editor** (primary, → `customer.plans.show`; phone label "View plan"), overflow: Rename (dialog, name ≤ 80), Move up/down (`customer.plans.update` `level_index` swap), Duplicate (dialog with name default "{name} (copy)" → `customer.plans.duplicate`), Delete (ConfirmDialog destructive: "Delete {name}? Furniture designs are kept; only their placement on this floor is removed." → `customer.plans.destroy`; always allowed, including for the last plan).
- **Add floor** opens `Dialog` "Add a floor": Name* (default by level: `plans.default_names.{n}` "Ground floor", "First floor", "Second floor", "Basement"), Level select (−2…10, default max+1), then `StartPlanChooser` (§8.1).

#### 7.3.4 Designs tab
- Toolbar: **New design** (→ `customer.designs.create`), `SearchInput` (name, client-side filter), filter chips All / Available / In an order.
- Grid of `DesignCard` (2 cols phone, 3 tablet, 4 desktop): `Thumbnail3D` (static), name, template label, `DimensionText` (W×H×D), estimate `MoneyDisplay approx` (+ "May be outdated" muted text if `estimate_stale`), `Badge` "In order {number}" (link) if `locked_by_order`. Card click → builder. Card menu: Rename, Duplicate, Order this design (→ `customer.orders.create?designs={id}`), Delete (disabled with tooltip "It's part of order {number}" when locked; ConfirmDialog otherwise).
- Empty: `EmptyState` icon `armchair` "No furniture designs yet" "Design a wardrobe, shelves, a TV unit and more." + **New design**.

#### 7.3.5 Orders tab
List of `OrderRow` (same as orders index rows) + **New order**. Empty: icon `package` "No orders yet" "When your designs are ready, send them to us for a quote." + **New order** (disabled if no designs, tooltip "Create a design first").

#### 7.3.6 Imports tab
`<Deferred data="imports">` with `LoadingState variant=table rows=4`. Table: File name, Status (`StatusPill` with `IMPORT_STATUS_TONE`), Floor (plan link or —), Credits used, Started (`RelativeTime`). Row link → `href`. Button **Upload a blueprint** (→ `customer.imports.create`). Empty: icon `scan-line` "No blueprint uploads yet".

#### 7.3.7 Empty project (no plans)
Plans tab shows `EmptyState` (lg) "Add your floor plan" + inline `StartPlanChooser` (three option cards, §8.1).

Real-time: none (static page); imports in non-terminal status show a spinner pill and the page polls `only: ['imports']` every 10 s while any import is non-terminal and the tab is visible.
Phone: tabs become a horizontally scrollable `TabsList`; plan panel stacks; "Open editor" reads "View plan".
Acceptance: switching tabs does not reload the page; deleting a plan returns to the plans tab; an archived project shows no create/edit actions.

### 7.4 Edit — `customer.projects.edit` · `/projects/{project}/edit` · `Customer/Projects/Edit`
Props: `{ project: ProjectData; property_types: PropertyType[]; addresses: AddressData[] }`. Same form as create, prefilled, submit → `customer.projects.update`. Changing the site address does **not** change existing orders' addresses (orders copy the address id at submission; editing an address row used by an Active order creates a new address row instead — `UpdateProject` action rule, Appendix A6).

---

## 8. Plans

### 8.1 `StartPlanChooser` component (`components/projects/StartPlanChooser.vue`)
Props: `{ projectId: Ulid; levelIndex: number; planName: string; starters: PlanStarterData[]; credits: AiCreditsData; mode: 'navigate' | 'select' }` (`select` = onboarding: emits `select(choice)` instead of navigating). Emits `select({ start: 'upload' | 'draw' | 'starter', starter_key? })`.
Three option cards (as §5.2 step 4). In `navigate` mode: Upload → `customer.imports.create?level_index=&plan_name=`; Draw → POST `customer.plans.store` `{ name, level_index, start: 'blank' }`; Template → opens starter picker `Dialog` → POST `{ start: 'starter', starter_key }`. Phone: Draw and Template disabled (tooltip/inline note `plans.phone_draw_disabled` "Drawing needs a tablet or computer.").

### 8.2 Plan editor host — `customer.plans.show` · `/projects/{project}/plans/{plan}` · `Customer/Plans/Editor`
Lazy-loaded chunk (three.js only here). Layout `EditorLayout`. The editor itself (tools, canvas, panels, shortcuts, view-only mode, export) is `05`.
Props:
```ts
interface PlanEditorPageProps {
  project: ProjectRefData;
  plan: PlanSummaryData;
  working_document: PlanDocument;          // 03 §1
  working_version: number;
  floors: { id: Ulid; name: string; level_index: number }[];     // floor switcher
  designs: FurnitureDesignSummaryData[];   // placeable designs of this project (07 thumbnails)
  place_design_id: Ulid | null;            // from ?place= (handoff §10.4); validated to belong to the project
  background_url: string | null;           // signed URL (15 min) of BackgroundImage.mediaUuid, refreshed via partial reload when expired
  read_only: boolean;                      // archived project OR phone (client also forces read-only on phone)
  read_only_reason: 'archived' | null;
  defaults: { wall_height_mm: number; exterior_wall_thickness_mm: number; interior_wall_thickness_mm: number; door_width_mm: number; door_height_mm: number; window_width_mm: number; window_height_mm: number; window_sill_mm: number };   // units settings
}
```
Page responsibilities (outside 05's editor component): `<Head>` title "{plan name} · {project name}"; `EditorLayout` `title` = plan name, `backHref` = `customer.projects.show(project)?tab=plans&plan={id}`; floor switcher `Select` in `#topbar-start` (navigates with unsaved-changes guard per `03` §5); `#topbar-end` overflow items owned by the page: "Order furniture" (→ `customer.orders.create`), "Upload a blueprint for this floor" (→ `customer.imports.create?plan={id}`). Mount `<PlanEditor :plan-id … />` from `@/editor/plan` passing props.
Read-only banner (`#banner`) when archived: "This project is archived — viewing only." + Unarchive (POST then reload).
Phone: `05` view-only mode; banner `plans.phone_view_only` "View only on phones. Open on a tablet or computer to edit."
Errors: autosave/conflict per `03` §5 (editor). Load failure is impossible (Inertia props), 404 if plan deleted.
Acceptance: opening a plan with `?place={designId}` starts placement mode for that design (05) and the param is removed from the URL after placing or cancelling.

### 8.3 Plan starters (`PlanStarterData`)
```ts
interface PlanStarterData { key: string; label: string; description: string; thumbnail_url: string; total_area_mm2: number; room_count: number }
```
Registry `config/plan_starters.php` (Appendix A3) with keys: `single_room` (one 4000 × 3000 mm room with a door and a window), `l_shaped_room`, `studio`, `one_bhk`, `two_bhk` (= `database/fixtures/plans/brochure-2bhk.json`), `three_room_hdb` (= `database/fixtures/plans/hdb-3room.json`). Documents in `database/fixtures/plan-starters/{key}.json` (valid `PlanDocument`s), thumbnails `public/images/plan-starters/{key}.svg`. Starter picker dialog: grid of cards (thumbnail, label, "{rooms} rooms · {area}"), select → **Use this layout**. If `05` defines its own starter registry, `05` wins and this list maps onto it.

---

## 9. Blueprint import flow

Pipeline, statuses, error codes, credit rules and the review editor mode are owned by `06`. This section defines the three pages.

### 9.1 Upload wizard — `customer.imports.create` · `/projects/{project}/imports/create` · `Customer/Imports/Create`
Query: `plan` (existing plan id → target existing plan; replaces its content on accept per `06`), `level_index`, `plan_name` (target new plan), `import` (resume an existing `uploaded` import, e.g. after "Try again").
Props:
```ts
interface ImportCreateProps {
  project: ProjectRefData;
  target: { kind: 'new_plan'; name: string; level_index: number } | { kind: 'existing_plan'; plan: { id: Ulid; name: string } };
  existing_plans: { id: Ulid; name: string; level_index: number }[];
  resume_import: ImportData | null;
  credits: AiCreditsData;
  limits: { max_bytes_image_pdf: number /* 25 MB */; max_bytes_dxf: number /* 15 MB */; accepted_mime: string[]; accepted_ext: string[] };
  dxf_enabled: boolean;                    // features.dxf_import
}
interface ImportData {
  id: Ulid; project_id: Ulid; plan_id: Ulid | null; status: ImportStatus; mode: 'auto' | 'trace';
  source_kind: 'raster' | 'pdf_vector' | 'pdf_raster' | 'dxf' | 'heic' | null;
  original_filename: string; mime_type: string | null; file_size_bytes: number | null;
  page_count: number | null; selected_page: number;
  hints: { unitSystem?: 'metric' | 'imperial'; knownDimension?: { label: string; mm: number }; wallHeightMm?: number; isPhoto?: boolean };
  credits_reserved: number; credits_charged: number;
  error_code: string | null;               // customer sees t('imports.errors.' + error_code)
  progress: { stage: string; percent: number | null } | null;   // latest ImportStatusChanged payload (cached server-side)
  source_preview_url: string | null;       // for images: media.show of source; PDFs: page 1 preview
  created_at: IsoDateTime; started_at: IsoDateTime | null; finished_at: IsoDateTime | null;
}
interface ImportPagePreviewData { page: number; thumb_url: string; width: number; height: number; has_vector_content: boolean }
```

Wizard (single page, client-side steps, `Stepper`-like header "1 File · 2 Page · 3 Details · 4 Start"; step 2 shown only for multi-page PDFs):

**Step 1 — File.**
- `ImportDropzone` (FileDropzone visual style, single file; implemented with `lib/upload.ts` but the import endpoints): text "Drop your floor plan here or browse"; on touch devices also **Take a photo** (`capture=environment`).
- **File type guidance** panel (always visible, `Accordion` default open on desktop): 
  - ✓ Photos & scans: JPG, PNG, WebP, HEIC — "Take the photo straight on, in good light, with the whole plan visible."
  - ✓ PDF — "Brochures and architect drawings. Vector PDFs give the best results."
  - ✓ DXF (if `dxf_enabled`) — "CAD export. Choose millimetres if your software asks."
  - ✗ **DWG** — `imports.guidance.dwg` "DWG files can't be opened directly. In your CAD program use **Save As → DXF** (or export to PDF) and upload that file instead."
  - Size limits: "Up to 25 MB (DXF up to 15 MB)."
- Client validation before upload: extension/MIME (`imports.errors.client_type` "This file type isn't supported. Use JPG, PNG, WebP, HEIC, PDF or DXF."); `.dwg` → `imports.errors.dwg` (same text as guidance) without uploading; size (`imports.errors.client_size` "This file is {size}; the limit is {max}.").
- Upload sequence:
  1. `POST api.imports.store` `{ filename, size, mime, target }` → `201 { import: ImportData, upload: { url, method: 'PUT', headers, expires_at } }` (status `awaiting_upload`). Errors: 422 (type/size), 429 `imports.errors.rate_limited` "You've started too many uploads. Try again later."
  2. PUT file to `upload.url` with progress bar (percentage + bytes), **Cancel** (aborts and calls `customer.imports.cancel`).
  3. `POST api.imports.uploaded` → `202 { import }` (status `uploaded`; for PDFs the server dispatches `PrepareImportPreview` which renders page thumbnails).
  4. If `source_kind` is a PDF with `page_count > 1` → step 2 (poll `api.imports.show` every 1.5 s until `pages.length === page_count` or 60 s; show skeleton thumbnails meanwhile; timeout → `imports.errors.preview_timeout` "We couldn't prepare page previews. You can still choose a page number." with a number input fallback). Otherwise → step 3.
- Upload failure (PUT error, network, presign expired): inline `Alert` `imports.errors.upload_failed` "The upload didn't finish. Check your connection and try again." with **Retry**: the client calls `customer.imports.cancel` for the unfinished import (fire-and-forget) and restarts sub-step 1 (`api.imports.store`) with the same `File` object.

**Step 2 — Page picker** (PDF only): grid of page thumbnails (3 cols desktop, 2 phone) with page number and a "Vector" badge if `has_vector_content`; single select (radio semantics, arrow keys move selection); larger preview on hover/focus (desktop). Default selection = first page with vector content, else page 1. Text: "Which page shows the floor plan?"

**Step 3 — Details (hints)**, all optional; collapsed "Why we ask" help text: "These hints make recognition more accurate."
- **Measurements on the plan are in**: radio Metric / Imperial / Not sure (→ `hints.unitSystem` omitted).
- **One known dimension** (recommended): label text (e.g. "Living room width", ≤ 60) + `LengthInput` (any unit; stored mm) → `hints.knownDimension`. Both or neither (`imports.errors.known_dimension_incomplete` "Enter both a label and a length, or leave both empty."). Range 500–50 000 mm.
- **Ceiling height**: `LengthInput` default business `default_wall_height_mm`, range 2000–6000 → `hints.wallHeightMm`.
- **This is a photo of a paper plan** checkbox (prefilled true when the file came from the camera or is JPEG/HEIC with EXIF camera make) → `hints.isPhoto`.
- **Target**: radio "Create a new floor" (name ≤ 80 + level) / "Replace an existing floor" (`Select` of `existing_plans`; warning "The current drawing of this floor will be replaced after you accept the result. A backup revision is kept.").

**Step 4 — Start**:
- **Credit cost display**: card "This uses **{cost}** AI credit(s). Your balance: **{balance}**." With `cost = credits.cost_per_recognition` (or `cost_per_recognition_none` when `!ai_available`, with note "Automatic AI is unavailable right now; we'll use basic recognition."). After start: "Balance after: {balance - cost}".
- Daily limit: if `recognitions_today >= max_recognitions_per_day` → disabled with `imports.errors.daily_limit` "You've reached today's limit of {max} recognitions. Try again tomorrow or trace the plan manually."
- Insufficient credits (`balance < cost`): **Start recognition** disabled; text `imports.errors.no_credits` "You don't have enough credits. They renew on {date}, or contact us for more."; secondary **Trace it manually instead** (always available; no credits) → `customer.imports.trace`.
- Buttons: **Start recognition** (primary) → `customer.imports.start` `{ selected_page, hints, target }`; **Trace manually** (outline) → `customer.imports.trace`.
- Server-side 422 codes mapped to the same messages: `insufficient_credits`, `daily_limit_reached`, `ai_budget_exhausted` (`imports.errors.ai_budget_exhausted` "Automatic recognition is paused. Please trace the plan manually or try later.").

Phone: full wizard supported (upload from camera is a primary use case); after start, progress page says the review needs a tablet/computer.
Acceptance: a DWG file is rejected client-side with the DXF/PDF message and no network upload; a 3-page PDF shows the page picker; insufficient credits disables Start but allows Trace.

### 9.2 Progress — `customer.imports.show` · `/projects/{project}/imports/{import}` · `Customer/Imports/Show`
Props: `{ project: ProjectRefData; import: ImportData; credits: AiCreditsData; can: { cancel: boolean; review: boolean; retry: boolean; trace: boolean; discard: boolean } }`.
UI by status:
- `uploaded` (not started): redirect to the wizard with `?import=`.
- `queued` / `preprocessing` / `recognizing`: centred card: source preview thumbnail, file name, animated indeterminate or determinate `Progress` (`progress.percent` when present), stage text `t('imports.stages.' + progress.stage)` (fallback `imports.statuses.{status}`: "Waiting in line…", "Preparing your image…", "Recognising walls, doors and rooms…"), estimated time note "This usually takes 1–3 minutes. You can leave this page — we'll notify you.", **Cancel** (if `can.cancel`; ConfirmDialog "Cancel recognition? Reserved credits are returned.").
- `ready_for_review`: success card "Your plan is ready to review" + **Review plan** (→ `customer.imports.review`; on phone: disabled with "Open on a tablet or computer to review"), **Discard** (ConfirmDialog; "Credits used for this recognition are not refunded.").
- `accepted`: "Imported into {plan}" + **Open plan**.
- `failed`: danger card with `t('imports.errors.' + error_code)` (fallback `imports.errors.unknown` "We couldn't recognise this plan."), credits note "Your {n} credit(s) have been refunded." (if refunded per `06`), actions **Try again** (`customer.imports.retry`), **Trace manually** (`customer.imports.trace`), **Upload a different file** (→ wizard).
- `cancelled` / `discarded`: neutral card + **Upload again**.
Real-time: `useImportChannel(import.id)` → `ImportStatusChanged` updates `progress`/`status` locally; on terminal status `router.reload({ only: ['import', 'credits', 'can'] })`. Fallback poll every 5 s (`only: ['import']`) when disconnected. Live region announces stage changes.
Acceptance: the page transitions from "recognising" to "ready to review" without manual reload when the socket is connected, and within 5 s via polling when not.

### 9.3 Review — `customer.imports.review` · `/projects/{project}/imports/{import}/review` · `Customer/Imports/Review`
EditorLayout; the plan editor in **import review mode** (`06` §review). Props:
```ts
interface ImportReviewProps {
  project: ProjectRefData;
  import: ImportData;
  result_document: PlanDocument;
  result_meta: unknown;                    // ImportResultMeta (06 §6), passed through
  background_url: string;                  // normalized page image (signed)
  target: ImportCreateProps['target'];
  defaults: PlanEditorPageProps['defaults'];
}
```
Page-owned chrome: `#banner` "Check the recognised plan. Fix anything that's wrong, then accept." ; `#topbar-end`: **Discard** (ConfirmDialog) and **Accept plan** (primary) → `customer.imports.accept` with the corrected document (+ `plan_name`/`level_index` for new plans; editable in the accept dialog). Everything else (confidence overlays, issue list, tools) is `06`. Phone: not available — page renders `ScreenTooSmall` with link back to the progress page. 409/422 on accept are shown in a dialog listing issues (`03` §1.1 codes translated).

---

## 10. Furniture designs

### 10.1 Designs list — `customer.designs.index` · `/designs` · `Customer/Designs/Index`
All designs across the customer's active projects.
Props: `{ designs: Paginated<FurnitureDesignSummaryData>; projects: ProjectRefData[]; templates: { key: string; label: string }[]; filters: { project: Ulid | null; template: string | null; availability: 'all' | 'available' | 'in_order'; search: string | null; sort: '-updated_at' | 'name' } }` (`per_page` 24).
UI: `PageHeader` "Furniture designs" + **New design** (if 1 project → direct; if many → `Dialog` "Which project is it for?" with project select; if none → `customer.projects.create`). `FilterBar` (project, template, availability) + search + sort. Grid of `DesignCard` (§7.3.4) showing project name as meta.
Empty: icon `armchair` "No designs yet" + **New design**. No results: standard.

### 10.2 New design — `customer.designs.create` · `/projects/{project}/designs/create` · `Customer/Designs/Create`
Query: `return_plan` (plan id; placement handoff), `hint_width` (mm, optional prefill from the plan editor's free wall length), `category` (preselect tab).
Props:
```ts
interface DesignCreateProps {
  project: ProjectRefData;
  return_plan: { id: Ulid; name: string } | null;
  hint_width_mm: number | null;
  presets: FurniturePresetCardData[];      // active presets of enabled templates, by category then sort_order
  templates: FurnitureTemplateCardData[];  // enabled templates (furniture_template_settings), sort_order
  categories: { key: string; label: string }[];   // preset categories (02 §5.3)
  copyable_designs: FurnitureDesignSummaryData[]; // other designs of the same customer (any project) for "Copy an existing design"
}
interface FurniturePresetCardData { id: Ulid; name: string; category: string; template_key: string; description: string | null; thumbnail_url: string | null; width_mm: number; height_mm: number; depth_mm: number; estimate_minor: number | null }
interface FurnitureTemplateCardData { key: string; label: string; description: string; icon: string; family: 'carcass' | 'table' }
```
UI: `PageHeader` "New furniture design" (back → project designs tab or plan editor if `return_plan`). `Tabs`: **Ready-made starting points** (presets, grouped by category with category pill filter) | **Start from scratch** (templates grid) | **Copy an existing design**. Cards are radio-selectable; selection shows a bottom `StickyActionBar` with Name* (prefilled with preset/template label, ≤ 120) and **Create design** → `customer.designs.store` `{ source, preset_id | template_key | from_design_id, name, return_plan, hint_width_mm }`. If `hint_width_mm` is set, the server applies it as `dims.width` when within the template's range (07 decides clamping).
Phone: page allowed (choose + create), but the builder opens view-only; show note "You'll be able to adjust it on a tablet or computer."
Empty presets: tab shows "No ready-made designs yet" and defaults to "Start from scratch".

### 10.3 Builder host — `customer.designs.show` · `/projects/{project}/designs/{design}` · `Customer/Designs/Builder`
Lazy chunk. EditorLayout. Builder internals = `07`.
Query: `return_plan` (plan id).
Props:
```ts
interface DesignBuilderPageProps {
  project: ProjectRefData;
  design: FurnitureDesignSummaryData;
  working_document: FurnitureDocument;     // 03 §2
  working_version: number;
  lock: { order: OrderRefData } | null;    // locked_by_order (09 §3) → read-only
  return_plan: { id: Ulid; name: string } | null;
  plans: { id: Ulid; name: string; level_index: number }[];   // for "Place in plan"
  catalog_version: number;                 // builder fetches /api/catalog/snapshot with ETag (01 §5.3)
  read_only: boolean;                      // locked OR archived project (phone handled client-side)
}
```
Page-owned chrome: title = design name (inline rename on click → `customer.designs.update`); `backHref` = plan editor if `return_plan` else project designs tab. `#topbar-end`:
- **Place in plan** (primary when `return_plan`): → `customer.plans.show(project, return_plan)?place={design.id}` (after flushing autosave; waits for "Saved" up to 5 s, otherwise asks "Leave with unsaved changes kept on this device?").
- Without `return_plan`: **Place in plan** `DropdownMenu` listing `plans` (→ same URL pattern); disabled if no plans.
- **Order this design** (outline) → `customer.orders.create?designs={id}` (hidden when locked).
- Overflow: Duplicate (`customer.designs.duplicate`), Save checkpoint (07/03 revisions API), Delete.
Locked banner (`#banner`, info): `designs.locked_banner` "This design is part of order {number} and can't be changed right now." + **Duplicate to edit** + link "View order". (Mirrors `03` §5 423 handling.)
Phone: `07` view-only.
Acceptance: from a plan, "Add furniture → New design" → create → builder → **Place in plan** returns to the same plan with the new design attached to the cursor.

### 10.4 Placement handoff contract (shared with `05`/`07`)
1. Plan editor "Add furniture" panel (05) offers existing project designs (drag/click to place) and **New design**, which visits `customer.designs.create` with `return_plan={planId}` and optionally `hint_width={mm}`.
2. `customer.designs.store` redirects to the builder with `?return_plan={planId}`.
3. Builder **Place in plan** visits `customer.plans.show` with `?place={designId}`; the server validates the design belongs to the project (else ignores the param) and passes `place_design_id`.
4. The plan editor enters placement mode with that design (05). Placing creates a new `FurniturePlacement`; Esc cancels. The editor then removes `place` from the URL with `history.replaceState`.
5. Placing the same design more than once is allowed (05 may warn "Already placed on this floor").

---

## 11. Orders

### 11.0 Shared order data (customer variants)
```ts
interface OrderItemData {
  id: Ulid; sort_order: number;
  design: { id: Ulid; name: string; template_label: string; thumbnail_url: string | null; project_id: Ulid };
  revision: { id: Ulid; number: number; bom_status: 'pending' | 'ready' | 'failed' } | null;   // null while draft
  dims: { width_mm: number; height_mm: number; depth_mm: number };
  quantity: number; room_label: string | null; customer_notes: string | null;
  estimate_minor: number | null;           // draft only: design.estimate.totalMinor × quantity
  estimate_stale: boolean;
  quoted_amount_minor: number | null;      // sum of customer-visible current-quote lines of this item
  open_issue_count: number;
}

interface CustomerOrderAbilities {
  edit_draft: boolean; delete_draft: boolean; submit: boolean;
  cancel_draft: boolean;                    // T3
  withdraw: boolean;                        // T29
  reopen: boolean;                          // T5
  review_proposal: boolean;                 // open sent proposal exists (T7)
  accept_quote: boolean; negotiate: boolean; decline_quote: boolean;   // T10/T11/T14
  approve_completion: boolean; report_issue: boolean;                  // T21/T22
  request_callback: boolean;                // accepted + ≥1 no_answer call
  post_message: boolean;                    // 09 §2 message rule
}

interface OrderData {
  id: Ulid; number: string; is_draft_number: boolean; title: string;
  state: OrderStateKey; state_before_hold: OrderStateKey | null; hold_reason: string | null;
  project: ProjectRefData;
  site_address: AddressData | null; needs_installation: boolean;
  preferred_delivery_on: IsoDate | null; expected_delivery_on: IsoDate | null;
  customer_notes: string | null;
  production_progress: number; production_stage: string | null; production_stage_label: string | null;
  cancel_reason: string | null; cancel_note: string | null;
  was_submitted: boolean;                   // submitted_at !== null
  milestones: Record<'submitted_at' | 'reviewed_at' | 'quoted_at' | 'accepted_at' | 'confirmed_at' | 'production_started_at' | 'completed_at' | 'customer_approved_at' | 'delivered_at' | 'closed_at' | 'cancelled_at', IsoDateTime | null>;
  contact_person: UserRefData | null;       // assigned estimator (name + avatar only)
  current_quote: QuoteData | null;          // status sent | accepted | expired (latest non-draft)
  open_proposal: ChangeProposalSummaryData | null;   // status sent
  negotiation: { rounds_used: number; rounds_max: number; open: QuoteNegotiationData | null };
  no_answer_calls: { called_at: IsoDateTime }[];     // only call outcome 'no_answer' (09 §7)
  delivery: DeliveryData | null;
  open_issues: OrderIssueData[];
  can: CustomerOrderAbilities;
}

interface ChangeProposalSummaryData { id: Ulid; number: number; status: 'sent' | 'resolved' | 'withdrawn'; sent_at: IsoDateTime | null; item_count: number; href: string }

interface QuoteLineData {
  id: Ulid; order_item_id: Ulid | null;
  kind: 'furniture' | 'materials' | 'hardware' | 'labour' | 'finishing' | 'installation' | 'delivery' | 'discount' | 'custom';
  description: string; details: Record<string, unknown> | null;
  quantity: string;                         // decimal string, e.g. "1.000"
  unit: string; unit_price_minor: number; amount_minor: number;
  tax_rate_id: Ulid | null; tax_rate_label: string | null;
  sort_order: number;
}
interface QuoteNegotiationData {
  id: Ulid; quote_id: Ulid; proposed_total_minor: number | null; message: string;
  item_comments: { order_item_id: Ulid; item_name: string; comment: string }[];
  status: 'open' | 'answered_with_revision' | 'answered_keep_price' | 'closed';
  answer_message: string | null; answered_by: UserRefData | null; answered_at: IsoDateTime | null;
  resulting_quote_id: Ulid | null; created_at: IsoDateTime;
}
interface QuoteData {
  id: Ulid; version: number; number: string;
  status: 'sent' | 'accepted' | 'declined' | 'superseded' | 'expired' | 'withdrawn';   // customers never see drafts
  currency: string; prices_include_tax: boolean;
  subtotal_minor: number; discount_minor: number; tax_minor: number; total_minor: number;
  tax_breakdown: { taxRateId: string; name: string; rateBps: number; taxableMinor: number; taxMinor: number }[];
  valid_until: IsoDate; days_left: number;  // ≥ 0 in business TZ; negative never sent
  lead_time_days: number | null;
  notes_to_customer: string | null; terms: string;
  lines: QuoteLineData[];                   // customer-visible lines only
  pdf_url: string | null;                   // customer.orders.quotes.pdf when media exists
  sent_at: IsoDateTime | null; accepted_at: IsoDateTime | null; declined_at: IsoDateTime | null;
  expired_at: IsoDateTime | null; superseded_at: IsoDateTime | null; withdrawn_at: IsoDateTime | null;
  decline_reason: string | null;
  negotiations: QuoteNegotiationData[];
}
interface QuoteVersionData { id: Ulid; version: number; number: string; status: QuoteData['status']; total_minor: number; sent_at: IsoDateTime | null; pdf_url: string | null; href: string }

interface ProductionUpdateData {
  id: Ulid; author: UserRefData; stage: string; stage_label: string; progress: number;
  title: string; body_html: string | null; visibility: 'customer' | 'internal';
  is_completion: boolean; photos: MediaData[]; created_at: IsoDateTime;
}
interface OrderIssueData {
  id: Ulid; order_item_id: Ulid | null; item_name: string | null; raised_by: UserRefData;
  description: string; status: 'open' | 'in_progress' | 'resolved' | 'rejected';
  resolution_note: string | null; resolved_at: IsoDateTime | null; photos: MediaData[]; created_at: IsoDateTime;
}
interface DeliveryData {
  scheduled_for: IsoDateTime | null; scheduled_until: IsoDateTime | null;
  delivered_at: IsoDateTime | null; installed: boolean; recipient_name: string | null;
  notes: string | null; photos: MediaData[];
}
```

### 11.1 Orders list — `customer.orders.index` · `/orders` · `Customer/Orders/Index`
Props: `{ orders: Paginated<OrderSummaryData>; counts: Record<'active' | 'action' | 'drafts' | 'done' | 'cancelled', number>; filters: { tab: 'active' | 'action' | 'drafts' | 'done' | 'cancelled'; search: string | null } }`.
Tabs: **Active** (Active states), **Needs action** (rows with `action` ≠ null), **Drafts** (`draft`), **Completed** (`delivered`, `closed`), **Cancelled**. Search by order number or title. Sort: `updated_at desc` (fixed). `per_page` 12.
Row (`OrderRow`): thumbnails stack, number (mono), title, project name, `StatusBadge`, compact `Stepper` (desktop), quote total (`MoneyDisplay`) when present, progress bar when `in_production`, "Action needed" pill (warning) with the action label, unread message count badge, `RelativeTime(updated_at)`. Whole row links to `customer.orders.show` (drafts never submitted → `customer.orders.edit`).
Empty per tab: Active "No orders in progress", Needs action "You're all caught up" (icon `check-circle`), Drafts "No drafts", Completed "No completed orders yet", Cancelled "No cancelled orders". Global empty (no orders at all): "No orders yet" + **Start an order** (project chooser dialog).

### 11.2 Create (select designs, T1) — `customer.orders.create` · `/projects/{project}/orders/create` · `Customer/Orders/Create`
Query: `designs` (comma-separated ids to preselect).
Props: `{ project: ProjectRefData; designs: (FurnitureDesignSummaryData & { selectable: boolean; unavailable_reason: 'in_active_order' | null })[]; preselected: Ulid[] }`.
UI: `PageHeader` "New order" — description "Choose the furniture you'd like us to make. You can adjust quantities next." Grid of selectable `DesignCard`s (checkbox top-right; unselectable cards dimmed with "Already in order {number}"). Sticky bar: "{n} selected" + **Continue** → `customer.orders.store` `{ design_ids }` → T1 → `customer.orders.edit`.
Validation: `design_ids` required min 1 (`orders.errors.no_designs` "Choose at least one design."); each owned by the project; 422 `design_in_active_order` → `orders.errors.design_in_active_order` "{name} is already part of order {number}."
Empty (no designs): `EmptyState` "Design some furniture first" + **New design**.

### 11.3 Draft editor & submission (T2) — `customer.orders.edit` · `/orders/{order}/edit` · `Customer/Orders/Draft`
Only for `state = draft` (else redirect to `customer.orders.show`).
Props:
```ts
interface OrderDraftProps {
  order: OrderData;                        // state draft
  items: OrderItemData[];
  addable_designs: (FurnitureDesignSummaryData & { selectable: boolean; unavailable_reason: 'in_active_order' | null })[];
  addresses: AddressData[];                // user's saved addresses
  project_site_address_id: Ulid | null;
  room_suggestions: string[];              // distinct room names from the project's plans' summaries
  min_preferred_date: IsoDate;             // today + 7 days (business TZ) — Appendix A5 note
  contact_status: { email: string | null; email_verified: boolean; phone_e164: string | null; phone_verified: boolean };
  estimate_disclaimer: string;             // trans_icu(pricing.estimate_disclaimer_key)
  currency: string;
}
```

#### 11.3.1 Layout
Desktop: left column (8/12) with three `Card` sections; right column (4/12) sticky **Summary** card. Tablet: single column, summary card at bottom. Phone: 3-step wizard (Items → Delivery → Review) with bottom sticky nav (**Back** / **Next** / **Submit order**).
`PageHeader`: "Draft order" (or "Order {number} — reopened" when `was_submitted`), meta `StatusBadge`. Actions: **Save draft** (outline), overflow: Delete draft (if `can.delete_draft`; ConfirmDialog destructive "Delete this draft? Your designs are not affected.") or **Cancel order** (if `can.cancel_draft`, T3; `ReasonDialog` with optional note; copy "Cancel order {number}? We'll stop working on it.").
Reopened info `Alert` (when `was_submitted`): "Your order is open for changes. Edit your designs, then submit it again. Its number stays {number}."

#### 11.3.2 Section 1 — Items
For each item: thumbnail, design name (link → builder, opens in same tab with unsaved-changes guard), `DimensionText`, estimate `MoneyDisplay approx` (× qty; "May be outdated — open the design to refresh" when `estimate_stale`), **Quantity** (`number-field` 1–99), **Room** (`Combobox` free text ≤ 80 with `room_suggestions`), **Notes for us** (textarea ≤ 2000, collapsed "Add a note" link), remove button (`aria-label` "Remove {name}"; disabled if it is the last item, tooltip "An order needs at least one item"). **Add designs** button → `Dialog` listing `addable_designs` (checkboxes) → adds rows client-side.
Per-item server errors (from submit) render under the item: `orders.errors.design_invalid` "{name} has problems that must be fixed before submitting." + list of issue messages (`t(issue.messageKey, issue.params)`) + **Open design**.

#### 11.3.3 Section 2 — Delivery & installation
- **Site address*** — `RadioGroup` of saved addresses (project's site address first, labelled "Project address") + "Use a new address" (reveals `AddressFields`, `site_address.*`, checkbox "Also set as this project's address" default checked if the project has none).
- **Installation*** — radio cards (no default selection on first submission; preselected with the stored value after a reopen): "Yes, deliver and install" / "No, delivery only". Error `orders.errors.installation_required` "Tell us whether you need installation."
- **Preferred delivery date** (optional) — `DateInput` min `min_preferred_date`; hint "We'll confirm the actual date when we call you."
- **Notes** (optional, ≤ 5000) — "Anything we should know? Access, lift, timings…"

#### 11.3.4 Section 3 — Review & submit
- Summary list: items × qty, estimate per item, **Estimated total** (sum of item estimates; `MoneyDisplay approx size=xl`), lines "Installation: included in your quote" / "Delivery: included in your quote", tax note (`orders.draft.tax_note` "Taxes are added in the quote.").
- **Disclaimer** (`Alert` neutral, icon `info`): `estimate_disclaimer` (e.g. "This is an automatic estimate. Your final price is in the quote we send after reviewing your designs.").
- **Contact check**: if neither email nor phone verified → `Alert` warning `orders.errors.contact_unverified` "Verify your email or phone before submitting." with inline actions **Verify phone** (opens the phone verification dialog from §13.2.3, same endpoints) and **Resend email link**. Submit disabled until verified (re-checked server-side).
- **Submit order** (primary, lg) → `customer.orders.submit` with full payload; `processing` shows "Submitting…" spinner (engine validation can take a few seconds).
Payload (both `update` and `submit`):
```ts
{
  items: { id?: Ulid; design_id: Ulid; quantity: number; room_label: string | null; customer_notes: string | null }[];
  site_address_id: Ulid | null;
  site_address: AddressFormData | null;    // when new address
  set_as_project_address: boolean;
  needs_installation: boolean | null;      // null allowed for update, required for submit
  preferred_delivery_on: IsoDate | null;
  customer_notes: string | null;
}
```
Server validation messages (submit): `orders.errors.no_items` "Add at least one item."; `items.*.quantity` 1–99 "Quantity must be between 1 and 99."; `orders.errors.site_address_required` "Choose where we should deliver."; `orders.errors.installation_required`; `preferred_delivery_on` after_or_equal min date "Choose a date on or after {date}."; `orders.errors.design_invalid` (per item, from engine CLI); `orders.errors.design_in_active_order`; `orders.errors.contact_unverified`; `orders.errors.design_deleted` "{name} was deleted. Remove it from the order."
Autosave: none; **Save draft** explicit + save on step change (phone wizard) + unsaved-changes guard.
On success: redirect `customer.orders.show` with flash `orders.toasts.submitted` "Order {number} submitted. We'll review it soon."
Acceptance: submit with an invalid design shows the engine issues on that item and keeps the draft; after submit the design builders open read-only (locked); the order receives an `ORD-YYYY-NNNNN` number.

### 11.4 Order page — `customer.orders.show` · `/orders/{order}` · `Customer/Orders/Show`
Never-submitted drafts redirect to `customer.orders.edit`.
Query: `tab` ∈ `overview` (default) | `designs` | `quote` | `messages` | `documents`.
Props:
```ts
interface CustomerOrderShowProps {
  order: OrderData;
  items: OrderItemData[];
  latest_production_update: ProductionUpdateData | null;
  production_updates: Inertia.Deferred<ProductionUpdateData[]>;   // customer-visible, newest first
  timeline: Inertia.Deferred<TimelineEntryData[]>;
  messages: Inertia.ScrollProp<MessageData>;                       // Inertia infinite scroll, 30 per page, newest page first, rendered oldest→newest
  last_read_message_id: Ulid | null;
  unread_messages: number;
  quote_versions: QuoteVersionData[];                              // all non-draft quotes, newest first
}
```

#### 11.4.1 Header & structure
- `PageHeader`: title "Order {number}"; description = order title; meta: `StatusBadge` (customer audience) + project link + "Submitted {date}". Actions overflow (`DropdownMenu`): **Print summary** (`window.print()` with `OrderPrintSummary`), **Edit my designs** (if `can.reopen`, T5), **Withdraw request** (if `can.withdraw`, T29), **Cancel order** (if `can.cancel_draft`, T3).
- **Stepper** (horizontal ≥ 768, vertical collapsed to current step + "Show all steps" on phone). Cancelled → `Alert` danger "This order was cancelled{reason, select, …}." with `t('orders.cancel_reasons.' + cancel_reason)` and `cancel_note` if any. On hold → `Alert` warning "Your order is on hold: {hold_reason}".
- `Tabs`: Overview · Designs ({items}) · Quote (dot if `can.accept_quote`) · Messages ({unread} badge) · Documents. Tab state in `?tab=` (no reload).
- Desktop ≥ 1024: Overview tab uses 2 columns: main (ActionPanel, production card, timeline) and right rail (Details card, Quote card, Contact card). Other tabs full width.

#### 11.4.2 Action panel per state (`ActionPanel`; exactly one panel)

| State | Tone/icon | Title / body (keys `orders.panel.{state}.*`) | Actions |
|---|---|---|---|
| `draft` (submitted before) | info `file-pen` | "Your order is open for changes" / "Update your designs, then submit again." | **Continue editing** (→ edit), **Cancel order** (T3, ReasonDialog note optional) |
| `submitted` | info `send` | "Waiting for review" / "We usually start reviewing within 1 business day." | **Edit my designs** (T5) · **Withdraw request** (T29) |
| `in_review` | info `search` | "We're reviewing your designs" / "{contact} is checking your designs and will send a quote or suggestions." | **Edit my designs** (T5) · **Withdraw request** (T29) |
| `changes_proposed` | warning `git-compare` | "Action needed: review our suggested changes" / staff `message` excerpt (2 lines) | **Review changes** (primary → proposal page) · overflow: Edit my designs (T5) |
| `quoted` | warning `receipt` | "Action needed: review your quote" / "{total} · valid until {date} ({days} days left)" | **Accept quote** (T10 dialog) · **Negotiate** (T11 dialog, if `can.negotiate`; else **Contact us** → Messages tab) · **Decline** (T14) · link "View quote details" |
| `quoted` & `current_quote.status = expired` (transient before T15 runs; also after T15 the state is `in_review`) | neutral `clock` | "This quote has expired" / "We're preparing an updated one." | — |
| `negotiating` | info `messages-square` | "We're reviewing your response" / your counter-offer summary (target total, message excerpt) | **Decline quote** (T14) · **Edit my designs** (T5) |
| `accepted` | primary `phone` | "Accepted — we'll call you to confirm" / "We'll call {phone} to confirm details." + link "Not your number? Update it" (→ settings) | If `can.request_callback`: sub-panel "We tried to reach you on {date}." + **Request a call back** (dialog) |
| `confirmed` | success `badge-check` | "Confirmed — production will start soon" / "Expected delivery: {expected_delivery_on}" | — |
| `in_production` | primary `hammer` | "In production" / current stage + progress | **See progress** (scrolls to production card) |
| `completed` | warning `camera` | "Action needed: check the photos of your furniture" | **Check photos** (primary → completion page) |
| `rework` | warning `wrench` | "We're fixing the issue you reported" / list of `open_issues` with `StatusPill` | — |
| `ready_for_delivery` | success `truck` | delivery scheduled ? "Delivery scheduled for {date}, {time window}" : "We'll contact you to schedule delivery." | — |
| `delivered` | success `package-check` | "Delivered on {date}" + "{installed, select, true {Installed} other {Delivered only}}" | "Problem? **Message us**" (→ Messages tab) |
| `closed` | neutral `archive` | "Order closed — thank you!" | **Order more furniture** (→ `customer.orders.create` for the project) |
| `cancelled` | — (Alert above replaces panel) | — | — |
| `on_hold` | warning `pause-circle` | "On hold" / `hold_reason` | **Message us** |

Dialogs (all `ConfirmDialog`/`ReasonDialog`, `15` §9.20–21):
- **Edit my designs (T5)** — title "Edit your designs?"; body depends on state: `submitted`/`in_review` "We'll pause our review until you submit again."; `changes_proposed` "Our suggested changes will be withdrawn."; `quoted`/`negotiating` "The current quote will be withdrawn and a new one prepared after you resubmit." Confirm → `customer.orders.reopen` → edit page.
- **Withdraw request (T29)** — `ReasonDialog`, note optional (≤ 2000), destructive, confirm "Withdraw request".
- **Cancel order (T3)** — `ReasonDialog`, note optional.
- **Accept quote (T10)** — `Dialog`: total (`MoneyDisplay xl`), quote number, valid until, collapsible **Terms** (`terms` rendered as plain text with line breaks), required checkbox `quotes.accept.checkbox` "I accept the quote and its terms." (`accept_terms`), button **Accept quote** (success variant). Errors: `quotes.errors.expired` "This quote has expired. We'll send an updated one."; `quotes.errors.not_current` "A newer quote is available." (both reload the page).
- **Negotiate (T11)** — `Dialog` (phone: full-screen `Drawer`): Message* (textarea ≤ 2000, `quotes.negotiate.message_hint` "Tell us what you'd like to change — price, materials, timing…"), **Your target total** (optional `CurrencyInput`, must be > 0 and < quote total: `quotes.errors.target_range` "Enter an amount between {min} and {max}."), **Comments on specific items** (optional repeatable rows: item `Select` + comment ≤ 500; max one per item), info "You can send {remaining, plural, one {# more counter-offer} other {# more counter-offers}}." Submit **Send counter-offer**. Errors: `quotes.errors.negotiation_limit` "You've reached the maximum number of counter-offers. Please message us instead."; `quotes.errors.negotiation_disabled`.
- **Decline (T14)** — `ReasonDialog` destructive: note **required** (`reason`, ≤ 2000, label "Why are you declining?"), body "Declining cancels this order. You can still order these designs again later." confirm "Decline quote".
- **Request a call back** — `Dialog`: `DateTimeInput` (min now + 1 h, within business working hours hint), optional note → posts `customer.orders.messages.store` `{ template: 'callback_request', callback_at, body: note ?? '' }`; the server composes the message text `messages.templates.callback_request` "I'd like a call back at {datetime}." (+ note).

#### 11.4.3 Overview tab content
1. ActionPanel (above).
2. **Production card** (states `in_production`, `completed`, `rework`, `ready_for_delivery`, `delivered`, `closed` when any update exists): `ProductionProgress` (progress + stage label), latest update (title, body, `PhotoGallery max=4`, `RelativeTime`), **All updates** expands `<Deferred data="production_updates">` → vertical list of updates each with gallery (Lightbox), stage chip, progress at that time.
3. **Timeline** (`<Deferred data="timeline">`, `LoadingState variant=list rows=5`; `Timeline` audience customer; error → `ErrorState` with retry `router.reload({ only: ['timeline'] })`).
Right rail: **Details** card (`KeyValueList`: Project, Site address, Installation yes/no, Preferred date, Expected delivery, Contact person with avatar); **Quote** card (if `current_quote`: total, status pill, valid until, "View quote"); **Delivery** card (if `delivery`: scheduled window / delivered at / recipient / installed, photos gallery).

#### 11.4.4 Designs tab
Grid of item cards (1 col phone, 2 tablet, 3 desktop): `Thumbnail3D` (`interactive`, `revisionId` = pinned revision; loads `api.furniture-revisions.show`), name, `DimensionText`, quantity, room label, item notes, quoted amount (if quote), "Revision {n}", issue count pill. Link **Open design** → builder (read-only while locked). While `draft` (reopened) items link to the draft editor.

#### 11.4.5 Quote tab
If `current_quote`: renders `QuoteView` (§11.6.2) inline with actions (same as quote page). Else `EmptyState` icon `receipt` "No quote yet" "We'll send a quote after reviewing your designs."

#### 11.4.6 Messages tab (§11.9).

#### 11.4.7 Documents tab
List: for each `quote_versions` entry — "Quote {number}" + `StatusPill` + date + total + **Download PDF** (`pdf_url`; disabled with "Preparing PDF…" when null). Plus **Order summary** → Print. Empty: "No documents yet".

#### 11.4.8 Real-time
`useOrderChannel(order.id)`:
- `OrderStateChanged` → `router.reload({ only: ['order', 'items', 'timeline', 'quote_versions', 'latest_production_update'] })` + toast `orders.toasts.state_changed` "Order updated: {state}".
- `MessagePosted` → append to thread (if not own) and increment `unread_messages` when the Messages tab is not visible.
- `QuoteSent` / `ChangeProposalSent` → reload `order`, `quote_versions`, `timeline`.
- `ProductionUpdatePosted` → reload `latest_production_update`, `production_updates`, `order`.
Disconnected > 5 s → poll every 30 s (`only: ['order', 'timeline']`).

#### 11.4.9 Responsive
Phone: header compact, Stepper vertical (collapsed), tabs scrollable and sticky under the header, ActionPanel full-width with stacked full-width buttons, right-rail cards move below the timeline in Overview.

#### 11.4.10 Acceptance
- Each of the 16 states renders the panel and actions in §11.4.2 and nothing else (Pest browser test per state using DemoSeeder orders).
- Accepting a quote moves the order to `accepted` and the page updates without reload for other open tabs (socket).
- An expired quote shows no Accept/Negotiate/Decline buttons.

### 11.5 Proposal review (T7) — `customer.orders.proposals.show` · `/orders/{order}/proposals/{proposal}` · `Customer/Orders/ProposalReview`
Props:
```ts
interface ProposalReviewProps {
  order: Pick<OrderData, 'id' | 'number' | 'title' | 'state' | 'project'>;
  proposal: ChangeProposalData;
  can_resolve: boolean;                    // proposal.status = sent && order.state = changes_proposed
}
interface ChangeProposalData {
  id: Ulid; number: number; status: 'draft' | 'sent' | 'resolved' | 'withdrawn';
  message: string | null; created_by: UserRefData;
  sent_at: IsoDateTime | null; resolved_at: IsoDateTime | null; withdrawn_at: IsoDateTime | null;
  customer_comment: string | null;
  items: ChangeProposalItemData[];
}
interface ChangeProposalItemData {
  id: Ulid; order_item_id: Ulid; item_name: string; quantity: number;
  from_revision: { id: Ulid; number: number; bom_status: 'pending' | 'ready' | 'failed' };
  to_revision: { id: Ulid; number: number; bom_status: 'pending' | 'ready' | 'failed' } | null;
  from_thumbnail_url: string | null; to_thumbnail_url: string | null;
  changes: ChangeItem[];                   // 03 §3.4
  staff_note: string | null;
  decision: 'pending' | 'approved' | 'rejected'; customer_comment: string | null; decided_at: IsoDateTime | null;
  price: { before_minor: number | null; after_minor: number | null; ready: boolean };   // per unit, from server revision PriceBreakdown.unitPriceMinor; ready when both BOMs ready
}
```
UI:
- `PageHeader` "Suggested changes" (description "Proposal #{number} · from {staff} · {date}"), back → order page.
- Staff message card (if `message`), with avatar.
- Item cards (one per proposal item):
  - **Viewer** (tablet/desktop: two columns before | after; phone: single viewer with `ToggleGroup` Before / After) — the compare viewer component from `07` (`FurnitureCompareViewer`, props `beforeRevisionId`, `afterRevisionId`, `changes`, `highlightEntity`, `showDifferences`). Toggle **Show differences** (default on): changed parts amber (`--diff-changed`), added green (`--diff-added`), removed red ghost (`--diff-removed-ghost`) with a legend (09 §4.6). Static thumbnails shown until the viewer chunk loads (`Thumbnail3D` placeholders).
  - `DiffList` (major first; hovering a row highlights the entity in the viewer).
  - **Price impact**: `price.ready` ? "Price per item: {before} → {after} ({delta, signed})" with `MoneyDisplay` (delta tone: increase `warning`, decrease `success`) × quantity note : "Calculating new price…" with spinner (reload `only: ['proposal']` every 5 s while any item is not ready).
  - Staff note (quote style).
  - **Decision** (`RadioGroup` as two large toggle buttons): **Approve** (check) / **Reject** (x). Reject reveals required comment textarea (≤ 1000): "Tell us why, so we can adjust." Error `proposals.errors.comment_required` "Please tell us why you're rejecting this change."
- Sticky footer bar: progress "{decided} of {total} decided", **Approve all** (sets every pending item to approved; ConfirmDialog not needed), optional overall comment (expandable, ≤ 2000), **Send my decisions** (primary; disabled until all decided) → `customer.orders.proposals.resolve`.
- Payload: `{ decisions: [{ item_id, decision: 'approved' | 'rejected', comment: string | null }], comment: string | null }`. Errors: `proposals.errors.undecided` "Decide on every change before sending."; `proposals.errors.not_open` "This proposal is no longer open." (reload).
- Read-only mode (`!can_resolve`): decisions shown as `StatusPill` with comments; status banner "Resolved on {date}" / "Withdrawn on {date}".
Phone: fully supported (approve is a phone capability); viewer height 50vh, touch orbit.
Real-time: `ChangeProposalSent`/`OrderStateChanged` → reload. 
Acceptance: Send stays disabled until every item is decided; rejecting without a comment shows the error; after sending, the order moves to `in_review` and the page becomes read-only.

### 11.6 Quote page — `customer.orders.quotes.show` · `/orders/{order}/quotes/{quote}` · `Customer/Orders/Quote`
Props: `{ order: Pick<OrderData, 'id' | 'number' | 'title' | 'state' | 'project' | 'site_address' | 'needs_installation' | 'negotiation' | 'can'>; quote: QuoteData; items: OrderItemData[]; versions: QuoteVersionData[]; is_current: boolean; business: { name: string; legal_name: string | null; tax_id: string | null; address_one_line: string | null; logo_url: string | null } }`.
Drafts → 404.

#### 11.6.1 Header
`PageHeader` "Quote {number}" + `StatusPill`; meta "Sent {date}". Actions: **Download PDF** (`pdf_url`; disabled "Preparing PDF…" when null, reload every 10 s up to 2 min), **Print**.
Banners: expired → `Alert` neutral "This quote has expired; we're preparing an updated one." (09 §5); superseded → "A newer quote is available." + link; withdrawn → "This quote was withdrawn."; accepted → success "You accepted this quote on {date}."; declined → "You declined this quote: {decline_reason}".

#### 11.6.2 `QuoteView` (`components/orders/QuoteView.vue`)
- Validity countdown (if `sent`): "Valid until {date} · {days_left, plural, =0 {last day} one {# day left} other {# days left}}" (warning tone when ≤ 2).
- Per-item sections (lines with `order_item_id`, grouped by item in `items` order): thumbnail, item name, `DimensionText`, quantity, room label; lines table (description, details summary e.g. key materials, qty × unit price, amount).
- Order-level lines (installation, delivery, custom, discount) table.
- `QuoteSummary`: subtotal, discount (negative, success tone), tax breakdown rows ("GST 18% on {taxable}" → tax), **Total** (xl), note "Prices include tax" / "Taxes shown separately" per `prices_include_tax`. Lead time "Made in about {lead_time_days} days after confirmation."
- Notes to customer (if any), Terms (collapsible).
- Negotiation history (if any): each counter-offer (your message, target, item comments) and our answer.
- Actions (only when `is_current && quote.status = sent && order.state = quoted`): **Accept quote**, **Negotiate** / **Contact us**, **Decline** — same dialogs as §11.4.2. In `negotiating`: only **Decline**.
- Version history (`versions` > 1): collapsible list "Earlier versions" with total and delta vs this quote (`MoneyDisplay signDisplay=always`), link to each.
Print: `PrintHeader` + `QuoteView` (actions hidden); the official document remains the PDF.
Phone: tables become stacked rows (description + amount; qty × price on second line).
Acceptance: totals displayed equal server values exactly; hidden lines (`is_visible_to_customer = false`) never appear in props (server-filtered).

### 11.7 Production timeline
Rendered within the order page (§11.4.3). No separate route. Photo galleries open `Lightbox`. Internal updates are never sent to customers (server-filtered).

### 11.8 Completion review (T21/T22) — `customer.orders.completion.show` · `/orders/{order}/completion` · `Customer/Orders/CompletionReview`
Available when state ∈ `completed`, `rework`, `ready_for_delivery`, `delivered`, `closed` (read-only unless `completed`).
Props: `{ order: Pick<OrderData, 'id' | 'number' | 'title' | 'state' | 'can' | 'open_issues'>; completion: ProductionUpdateData | null /* latest is_completion */; previous_completions: ProductionUpdateData[]; items: OrderItemData[]; issues: OrderIssueData[] }`.
UI:
- `PageHeader` "Check your furniture" + back.
- Intro: "Here are photos of your finished furniture. If everything looks right, confirm and we'll schedule delivery." + completion message (`body_html`).
- **Photo gallery** large (`PhotoGallery` columns 1/2/3, aspect 4/3; Lightbox).
- **Compare with your designs**: per item row — design `Thumbnail3D` (interactive) beside the photos (no automatic photo↔item mapping; all photos above).
- Previous issues & resolutions (if rework happened): list with status.
- Actions (if `can.approve_completion`): **Looks good** (success, lg; ConfirmDialog "Confirm everything looks right? We'll schedule delivery next." → `customer.orders.completion.approve` T21) and **Report an issue** (outline → T22 dialog).
- **Report an issue dialog** (phone: full-screen `Drawer`): repeatable issue blocks (min 1, max 5): Item (`Select` "Whole order" or an item), Description* (≤ 2000, "What's wrong?"), Photos (`ImageUploader`, purpose `issue_photo`, ≤ 10). **Send report** → `customer.orders.issues.store` `{ issues: [{ order_item_id, description, upload_tokens }] }`. Errors: `issues.errors.description_required` "Describe the problem."; upload errors per `15`.
Read-only states show the decision outcome ("You approved on {date}" / issues list).
Acceptance: Looks good → `ready_for_delivery`; Report → `rework` with issues listed on the order page.

### 11.9 Message thread
`MessageThread` (`15` §9.16) in the Messages tab; full-height on phone.
- Data: `messages` uses Inertia v3 infinite scrolling (`Inertia::scroll()` server-side, cursor = message id, 30 per page; `<InfiniteScroll>` client-side in reverse mode). If the installed Inertia version lacks it, implement with partial reload `only: ['messages']` + `?before={id}` and prepend (same server query object).
- Post: `customer.orders.messages.store` (`preserveScroll`, `only: ['messages', 'unread_messages']`); attachments via `FileDropzone` purpose `message_attachment` (≤ 5, jpg/png/webp/pdf ≤ 15 MB).
- Read: on view, `customer.orders.messages.read`.
- Disabled (`!can.post_message`): composer replaced by note `messages.closed` "This conversation is closed. Contact us if you need help." + link to Help.
- Validation: `messages.errors.empty`, `body` ≤ 5000 ("Messages can be at most 5,000 characters."), `messages.errors.edit_window` "Messages can only be edited for 10 minutes."
- Staff names show with a "Team" badge; system messages centred (`t('messages.system.' + system_event, system_payload)`); internal notes never sent to customers.

---

## 12. Notifications center — `customer.notifications.index` · `/notifications` · `Customer/Notifications/Index`
Props: `{ notifications: Paginated<NotificationData>; filters: { status: 'all' | 'unread' }; unread_count: number }` (`per_page` 20).
UI: `PageHeader` "Notifications" + **Mark all as read** (if unread; → `notifications.read-all`) + link "Notification settings". Segmented All / Unread. List grouped by day: icon, title, body, `RelativeTime`, unread dot + `bg-accent/40` row; click → mark read (optimistic) + visit `action_url`. Pagination (load more button on phone).
Empty: All → icon `bell` "No notifications yet" "We'll let you know when something happens with your orders."; Unread → "You're all caught up".
Real-time: `NotificationCreated` → prepend when on page 1 and filter allows.
Bell dropdown: `15` §9.17.
Acceptance: unread count in header/tab bar decrements immediately on click and matches the server after reload.

---

## 13. Settings

### 13.1 Settings shell
All settings pages use CustomerLayout with a `SettingsNav` (desktop: left vertical nav 220 px; tablet/phone: horizontal scrollable pills at top): Profile · Password · Preferences · Notifications · AI credits · Account. Each page uses `FormSection` blocks and `StickyActionBar` for dirty forms.

### 13.2 Profile — `customer.settings.profile` · `Customer/Settings/Profile`
Props: `{ user: AuthUserData; marketing_opt_in: boolean; sign_in_methods: { password: boolean; phone: boolean; google: boolean }; google_enabled: boolean; otp_channels: ('whatsapp' | 'sms')[] }`.
Sections:
1. **Photo** — avatar preview + **Change** (`ImageUploader` single, purpose `avatar`) → `customer.settings.avatar.update`; **Remove**.
2. **Your details** — Name* (≤ 120), Email (optional if phone verified; change → `Alert` "We'll send a verification link to the new address."), checkbox marketing opt-in. Save → `customer.settings.profile.update`. Errors: `email` unique "This email is already used by another account."; at least one contact: `settings.errors.contact_required` "Keep at least an email or a phone number."
3. **Phone** — current number + status pill (Verified / Not verified). Buttons **Verify** / **Change number**. Dialog (§13.2.3).
4. **Email verification** — if email unverified: `Alert` + **Resend link** (`verification.send`).
5. **Sign-in methods** — rows: Password (set/changed → link to Password page), Phone code (enabled when phone verified), Google (Connected as … / **Connect** → `auth.google.redirect`, **Disconnect** per `13` if another method exists).

#### 13.2.3 Phone verification dialog
Step 1: `PhoneInput` + channel radio (WhatsApp/SMS, only enabled channels) → **Send code** (`customer.settings.phone.send-code`). Step 2: `PinInput` 6 digits → `customer.settings.phone.verify`; resend countdown 60 s. Success toast `settings.toasts.phone_verified` "Phone number verified." Errors: `phone.errors.taken`, `auth.otp.invalid`, `auth.otp.expired`, throttled. Reused by the order draft contact check (§11.3.4).

### 13.3 Password — `customer.settings.password` · `Customer/Settings/Password`
Props `{ has_password: boolean }`. Fields: Current password (only if `has_password`), New password, Confirm. Submit → Fortify `user-password.update`. When `has_password` is false the form omits Current password and the title reads "Set a password"; the app's Fortify `UpdateUserPassword` action (`13`) accepts a missing `current_password` only when `users.password` is null. Success toast `settings.toasts.password_updated` "Password updated." Errors: Fortify `current_password` "The provided password does not match your current password.", password rules per `13`.

### 13.4 Preferences — `customer.settings.preferences` · `Customer/Settings/Preferences`
Props `{ unit_system: 'metric' | 'imperial'; length_unit: string; timezone: string; timezones: string[] }` (`timezones` = PHP `DateTimeZone::listIdentifiers()`).
Fields: Measurement system (radio cards with examples), Length unit for editing (`Select`: metric → mm/cm/m; imperial → ft-in/in; resets to the first option when the system changes), Time zone (`Combobox`, searchable). Section **Appearance** (device-level, `15` §11): Light / Dark / System radio — saved locally, no server call; note "Saved on this device." Save → `customer.settings.preferences.update`; shared `auth.user` updates (editors re-read units on next load).
Validation: `settings.errors.length_unit`; timezone `in:` list "Choose a valid time zone."

### 13.5 Notifications — `customer.settings.notifications` · `Customer/Settings/Notifications`
Props:
```ts
interface NotificationSettingsProps {
  channels: { channel: 'database' | 'mail' | 'whatsapp' | 'sms' | 'webpush'; available: boolean; unavailable_reason: 'feature_off' | 'no_email' | 'email_unverified' | 'no_phone' | 'phone_unverified' | 'no_push_subscription' | null }[];
  groups: {
    key: string; label: string;            // e.g. "Orders", "Quotes", "Production", "Messages", "Imports", "Reminders"
    events: {
      event_key: string; label: string; description: string;
      cells: Record<'database' | 'mail' | 'whatsapp' | 'sms' | 'webpush', { enabled: boolean; locked: boolean; supported: boolean }>;
    }[];
  }[];
  vapid_public_key: string | null;
  push_subscription_count: number;         // this user's stored subscriptions (all devices)
}
```
Event list, defaults, `locked` (mandatory channels) and `supported` (event × channel combinations that exist) come from `12` (`config/notification_events.php`); only customer-audience events are listed.
UI:
- **This device** card (web push): states —
  - Push unsupported (`!('serviceWorker' in navigator) || !('PushManager' in window)`): if iOS Safari and not standalone (`navigator.standalone !== true` && `!matchMedia('(display-mode: standalone)').matches`): **iOS guidance** box: "To get notifications on iPhone or iPad: 1. Tap the **Share** button. 2. Choose **Add to Home Screen**. 3. Open {app} from your home screen and come back here." (requires iOS 16.4+; include a small inline share-icon glyph). Otherwise: "This browser doesn't support notifications."
  - Permission `denied`: "Notifications are blocked for this site. Allow them in your browser settings."
  - Not subscribed: **Enable notifications on this device** → `usePushSubscription().enable()`: `Notification.requestPermission()` → `navigator.serviceWorker.register('/sw.js', { scope: '/' })` → `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapid_public_key })` → `POST api.push-subscriptions.store` → reload `channels`.
  - Subscribed: "Notifications are on for this device." + **Turn off** (unsubscribe + `DELETE api.push-subscriptions.destroy`) + **Send test** (POST `customer.settings.notifications.test-push` → server sends a `system.test_push` web push; Appendix A9).
  - Hidden entirely when `features.web_push` is false.
- **Matrix** — `Table`: rows = events grouped by `groups` (group header rows), columns = channels (only channels whose `available` or feature is on; unavailable columns rendered disabled with a tooltip explaining `unavailable_reason`, e.g. "Verify your phone to use WhatsApp" with link). Cells: `Switch` (`aria-label` "{event} by {channel}"); `locked` → disabled checked with lock icon tooltip "Required for this notification"; `!supported` → "—". Toggle = optimistic, sends `customer.settings.notifications.update` `{ changes: [{ event_key, channel, enabled }] }` (debounced batch 500 ms); failure reverts + toast.
- Phone: matrix becomes per-event cards with a row of channel switches.
Acceptance: disabling "Quote sent" email persists a `notification_preferences` row with `enabled=false`; locked cells cannot be toggled; iOS Safari (non-standalone) shows the Add-to-Home-Screen guidance.

### 13.6 AI credits — `customer.settings.credits` · `Customer/Settings/Credits`
Props: `{ credits: AiCreditsData; ledger: Paginated<AiLedgerEntryData> }` (`per_page` 20).
```ts
interface AiLedgerEntryData {
  id: Ulid; delta: number; kind: 'monthly_grant' | 'admin_grant' | 'admin_revoke' | 'reservation' | 'reservation_release' | 'consumption' | 'refund' | 'signup_grant';
  note: string | null; created_at: IsoDateTime; balance_after: number;
  reference: { type: 'blueprint_import'; id: Ulid; label: string; href: string } | null;
}
```
UI: balance card (big number, "Next {monthly} free credits on {date}", cost per recognition, today's usage "{n} of {max} recognitions today"); explanation text; ledger table: Date, Description (`t('credits.kinds.' + kind)` + reference link + note), Change (`+3` success / `−1` neutral, `tabular-nums`), Balance after. Reservation/release pairs are shown as-is (transparent). Empty: "No credit activity yet." Real-time: `AiCreditsChanged` → reload.

### 13.7 Account — `customer.settings.account` · `Customer/Settings/Account`
Props: `{ active_order_count: number; has_password: boolean; phone_verified: boolean }`.
Sections: **Download my data** — out of scope v1 (not shown). **Delete account** — explanation `settings.delete.body` "Deleting your account removes your personal details and signs you out. Projects, designs and order records are anonymised and kept for our accounting. This can't be undone." If `active_order_count > 0`: disabled with `settings.delete.blocked` "You have {count} active order(s). Please wait until they're delivered or cancelled, or contact us." Else button **Delete my account** → `Dialog`: password (if `has_password`) or "Send me a code" OTP (if phone verified, purpose `login`) and type `DELETE` → `customer.settings.account.destroy`. Success: logged out, redirect `welcome` with flash "Your account has been deleted."
Errors: `settings.errors.password_incorrect` "That password isn't right.", `settings.errors.confirmation` "Type DELETE to confirm."

---

## 14. Help & contact — `customer.help` · `/help` · `Customer/Help`
Props: `{ business: { name: string; phone_e164: string | null; whatsapp_url: string | null /* https://wa.me/{digits} when phone set */; email: string; working_hours: string; address_one_line: string | null } }`.
Sections: **Contact us** card (call `tel:`, WhatsApp link, email `mailto:`, working hours, address); "Questions about an order? Use the messages on the order page — that's the fastest way to reach your team." + link to orders. **FAQ** (`Accordion`, keys `help.faq.{1..10}.{q,a}`): 1 How do I upload my floor plan? 2 My file is DWG — what do I do? 3 What are AI credits? 4 How accurate is the automatic estimate? 5 Can I change my designs after submitting? 6 What happens after I accept a quote? 7 How do I follow production? 8 What if something is wrong when it's finished? 9 How do I get notifications on my phone? 10 How do I delete my account? **Privacy** (`id="privacy"`): `help.privacy.body` (text owned by `13`).

---

## 15. PWA (installability + web push)

- **Manifest** — route `pwa.manifest` `GET /manifest.webmanifest` (`Content-Type: application/manifest+json`, cache 1 h), built from settings:
```json
{
  "name": "<business.name>", "short_name": "<first 12 chars of app name>",
  "id": "/", "start_url": "/dashboard?source=pwa", "scope": "/",
  "display": "standalone", "orientation": "any",
  "background_color": "#fbfaf7", "theme_color": "#fbfaf7",
  "icons": [
    { "src": "/pwa/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/pwa/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/pwa/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```
  `app.blade.php` links it plus `<link rel="apple-touch-icon" href="/pwa/apple-touch-icon-180.png">`, `<meta name="apple-mobile-web-app-capable" content="yes">`, `<meta name="theme-color">` (§`15` §11). Default icons (committed in `public/pwa/`): a neutral rounded-square mark (walnut `#6b4a33` background, white simple "house + panel" glyph). Owners replace files in place; no admin UI in v1.
- **Service worker** — static `public/sw.js`, scope `/`, served with `Service-Worker-Allowed: /` and `Cache-Control: no-cache`. **No fetch handler and no offline caching in v1.** Handlers:
  - `push`: payload JSON `{ title, body, url, tag?, icon?, badge? }` (exact payload from `12`) → `self.registration.showNotification(title, { body, icon: icon ?? '/pwa/icon-192.png', badge: badge ?? '/pwa/badge-72.png', tag, data: { url }, renotify: !!tag })`.
  - `notificationclick`: close; focus an existing same-origin client and `navigate(url)`, else `clients.openWindow(url)`.
  - `pushsubscriptionchange`: no network call (no CSRF available); the app re-syncs on next load.
- **Registration** — `usePushSubscription()` on app boot (authenticated, `features.web_push`): if `Notification.permission === 'granted'`, register `sw.js`, get the current subscription and POST it (idempotent upsert by endpoint) once per session.
- Acceptance: Chrome "Install app" is offered on the dashboard; a web push for `quote.sent` opens the quote page when clicked; iOS (home-screen app) receives pushes after enabling.

---

## 16. Real-time summary (customer)

| Page | Channel | Events → behaviour |
|---|---|---|
| All (AppShell) | `users.{id}` | `NotificationCreated` → bell count + toast; `AiCreditsChanged` → update `CreditBadge` |
| Dashboard | `users.{id}` | reload `action_items`, `orders_in_progress`, `ai_credits` (throttled 2 s) |
| Order page, quote page, proposal page, completion page | `orders.{id}` | §11.4.8 |
| Import progress | `imports.{id}` | §9.2 |
| Furniture builder | `furniture-designs.{id}` | `FurnitureDesignLocked/Unlocked` → toggle read-only (07) |
| Project page | — | poll imports while non-terminal (§7.3) |

---

## 17. Acceptance criteria (customer app, cross-cutting)

1. Every route in §2 exists with the stated name, method, path, controller folder and page component; Wayfinder helpers are used for all links (no hard-coded URLs).
2. Customers can never load another customer's project/plan/design/order/import (404 via scoped policies), never see staff-internal data (internal notes, internal updates, hidden quote lines, cost snapshots, call details other than `no_answer` dates) — covered by Pest feature tests asserting prop payloads.
3. Every page renders without horizontal scroll at 375 px; editors are view-only below 768 px; touch targets ≥ 44 px.
4. Every list has empty, no-results and loading states as specified; deferred props show skeletons; failures show `ErrorState` with retry.
5. All visible strings come from translation keys (lint + key test pass).
6. Every customer-initiated transition (T1, T2, T3, T5, T7, T10, T11, T14, T21, T22, T29) is reachable from the UI exactly in the states listed in `09`, and nowhere else; each shows the confirmations and validation messages in this file.
7. With the socket disconnected, order and import pages still reflect changes within 30 s (polling).

---

## Appendix: Proposed additions to other documents

**A1 — 02 §1.1 `users`:** add `onboarded_at timestamptz null` (set by onboarding store/skip; staff created with `onboarded_at = now()`). Middleware alias `onboarded` (`App\Http\Middleware\EnsureCustomerOnboarded`).

**A2 — 02 §8.7 `quote_negotiations`:** add `item_comments jsonb not null default '[]'` — array of `{ order_item_id: ulid, comment: string(≤500) }` (09 §6 "optional per-item comments").

**A3 — Plan starters:** `config/plan_starters.php` returning `[key => ['label_key' => 'plans.starters.{key}.label', 'description_key' => …, 'document' => 'database/fixtures/plan-starters/{key}.json', 'thumbnail' => 'images/plan-starters/{key}.svg']]` for keys `single_room`, `l_shaped_room`, `studio`, `one_bhk`, `two_bhk`, `three_room_hdb`; `customer.plans.store` with `start=starter` copies the document (re-generating entity ids with `newId`) and sets `plans.source = 'drawn'`, `meta.createdWith = 'editor'`. (If 05 defines a starter registry, 05 wins.)

**A4 — 02 §8.11 `deliveries`:** add `scheduled_until timestamptz null` (end of the delivery time window; 09 §9 "date/time window").

**A5 — 02 §13 `workflow`:** add `min_preferred_delivery_days int default 7` (minimum days from today for the customer's preferred delivery date; `min_preferred_date` prop).

**A6 — Projects action rule (`UpdateProject`, 01 §4):** editing a site address that is referenced by any Active order creates a new `addresses` row instead of mutating the referenced one.

**A7 — Shared prop:** `app.vapid_public_key: string | null` (from `config('webpush.vapid.public_key')`) for push re-sync on boot.

**A8 — Routes not covered by Fortify (for 13/14):** `auth.otp.send` (POST `/login/phone`), `auth.otp.verify.show` (GET `/login/phone/verify`), `auth.otp.verify` (POST `/login/phone/verify`), `auth.google.redirect`, `auth.google.callback`; phone registration = `auth.otp.send` with `name` and verify creating the account when no user has that phone.

**A9 — Route:** `customer.settings.notifications.test-push` POST `/settings/notifications/test-push` (throttle 3/min) sends a test web push to the user's subscriptions; and the same for staff `admin.account.notifications.test-push` (see 11). Event key `system.test_push` (12; channel webpush only, not user-configurable).

**A10 — Shared routes:** `media.show` GET `/media/{media:uuid}` (query `conversion` ∈ `thumb|large|small|preview`) → policy `MediaPolicy@view` (resolves owning model's policy) → 302 to a 15-minute temporary URL; `notifications.read` POST `/notifications/{notification}/read`; `notifications.read-all` POST `/notifications/read-all`; `api.notifications.index` GET `/api/notifications`; `api.push-subscriptions.store|destroy`; `api.furniture-revisions.show` GET `/api/furniture-revisions/{revision}` (policy: owner of the design's project or staff with `orders.view`); `pwa.manifest`.

**A11 — Import endpoints (for 06/14):** `api.imports.store` POST `/api/projects/{project}/imports` `{ filename, size, mime, target }` → 201 `{ import, upload }`; `api.imports.uploaded` POST `/api/imports/{import}/uploaded` → 202 `{ import }`; `api.imports.show` GET `/api/imports/{import}` → `{ import, pages }`; plus customer actions `customer.imports.start|cancel|accept|discard|retry|trace` (§2.2). `ImportData.progress` is the latest `ImportStatusChanged` payload cached at `import:progress:{id}` (TTL 1 h). If 06 names these differently, 06 wins and 14 maps the names.

**A12 — Order data:** `OrderData.hold_reason` is derived from the latest `order.on_hold` activity-log properties (`reason`); T26 must store `reason` in the activity properties (09 §2 T26 "Msg with reason").
