# 14 — Routes, Controllers & API Contracts

Read the master document, `01`, `02`, `03`, `09` and `13` first; `10` and `11` define the pages, `05`/`06`/`07`/`08`/`12`/`18` define the editor, import, furniture, BOM, notification and AI endpoints. This file is the **contract between frontend and backend agents**: for every route it fixes name, method, path, route file, middleware, controller, FormRequest + validation rules, authorisation, Action, and response (Inertia page + props type, redirect + flash, or JSON shape incl. error codes). It was written from the route registry `19 §8.5` (all 300+ entries are present; additions found while writing are marked **[added]** and logged in `19 §5`).

Precedence: where an owning section (`03`, `05`, `06`, `09`, `10`, `11`, `12`, `13`, `18`) specifies a body, response or rule, that section is normative and this file restates it; where the owning section is silent, this file is normative.

---

## 1. Conventions

### 1.1 Route files and middleware groups

| Code | Middleware (in order) | Used for | Route file |
|---|---|---|---|
| `PUB` | `web` | public pages (`welcome`, `legal.*`, `manifest`), CSP report | `routes/web.php` |
| `GST` | `web`, `guest` | custom guest auth pages/actions (`auth.otp.*` except `status`) | `routes/web.php` |
| `AUTH` | `web`, `auth`, `active` | both audiences: `account.*`, `auth.reauthenticate*`, `media.show`, `links.order` | `routes/web.php` |
| `SGN` | `web`, `signed` | `staff.invitations.*`, `notifications.unsubscribe*` | `routes/web.php` |
| `CUS` | `web`, `auth`, `active`, `customer`, `onboarded` | customer pages/actions (name prefix `customer.`, no URL prefix) | `routes/customer.php` |
| `CUS0` | `web`, `auth`, `active`, `customer` | onboarding-exempt customer routes: `customer.onboarding.*`, `customer.account.*`, `customer.help`, `customer.notifications.index` (`13 §1`, `10 §5.1`) | `routes/customer.php` |
| `ADM` | `web`, `auth`, `active`, `staff`, `2fa.enrolled`, `session.absolute` | staff pages/actions (name prefix `admin.`, URL prefix `/admin`) | `routes/admin.php` |
| `API` | `web`, `auth`, `active`, `throttle:api` | editor/app JSON (name prefix `api.`, URL prefix `/api`); routes with a named limiter in §1.11 replace `throttle:api` by it (`->withoutMiddleware('throttle:api')`) | `routes/api.php` |
| `APIS` | `API` + `staff`, `2fa.enrolled`, `session.absolute` | staff-only JSON endpoints (route-level additions; customers get 403 `forbidden`) | `routes/api.php` |
| `HOOK` | `throttle:webhooks` (stateless: no session, cookies, CSRF; `SubstituteBindings` only) | `webhooks.*` | `routes/webhooks.php` |
| `HLTH` | none (stateless, no throttle, no session — must answer while Redis is down) | `health.deep` | `routes/webhooks.php` (stateless file) |
| `FTF` | registered by `laravel/fortify ^1.37` with `web` + Fortify's own `guest`/`auth`/`signed`/`throttle`/`password.confirm` | Fortify routes (§3.1) | package |

Registration (`bootstrap/app.php` `withRouting`): `web: routes/web.php` (which `require`s nothing else), `then:` registers `routes/customer.php` (`Route::middleware('web')->name('customer.')->group(...)`, each group inside applies `CUS`/`CUS0`), `routes/admin.php` (`Route::middleware(ADM)->prefix('admin')->name('admin.')`), `routes/api.php` (`Route::middleware(API)->prefix('api')->name('api.')`), `routes/webhooks.php` (no `web` group). Laravel's default `api` middleware group is **not** used. `channels.php` registers `Broadcast::routes(['middleware' => ['web', 'auth', 'active', 'throttle:broadcasting-auth']])` (`POST /broadcasting/auth`, package route, unnamed). Package dashboards: `/horizon`, `/pulse`, `/telescope` (local/staging) behind gates `viewHorizon`/`viewPulse`/`viewTelescope` (roles owner, admin). Framework `/up` (`health:` in `withRouting`).

The `web` group is Laravel's default plus, appended in this order: `HandleInertiaRequests`, `AddLinkHeadersForPreloadedAssets`, `SecurityHeaders` (`13 §12.1`), `AuthenticateSession`, `TrackSession` (`13 §6.3`), `PreventCustomerTwoFactor` and `PreventRequiredTwoFactorDisable` (`13 §5.10`, match route names), `FortifyRouteGuards` **[added]** (§3.1: per-route throttles, Turnstile and `recent.auth` for Fortify routes, which this app cannot decorate otherwise because `Fortify::ignoreRoutes()` is not used, `13 §5.10`). CSRF exceptions: `webhooks/*`, `csp-report` (`13 §12.3`).

### 1.2 Middleware aliases and JSON behaviour

Aliases of `13 §1` (`active`, `customer`, `staff`, `onboarded`, `verified.contact`, `2fa.enrolled`, `session.absolute`, `recent.auth`, `track.session`) plus `permission` = `Spatie\Permission\Middleware\PermissionMiddleware`, `role` = `RoleMiddleware`, Laravel's `can`, `signed`, `throttle`, `guest`, `auth`. Behaviour for requests that `expectsJson()` (all `/api/*`, XHR):

| Middleware | Inertia/HTML response | JSON response |
|---|---|---|
| `auth` | redirect `login` (intended URL kept) | 401 `{code: 'unauthenticated'}` |
| `active` | logout + redirect `login` with error `auth.inactive` | 401 `{code: 'account_inactive'}` |
| `customer` | staff → redirect `admin.dashboard` | 403 `{code: 'forbidden'}` |
| `staff` | customer → page `Error` status 403 | 403 `{code: 'forbidden'}` |
| `onboarded` | GET → redirect `customer.onboarding.show`; other methods pass | pass |
| `verified.contact` | redirect back with flash `error` = `common.verify_required` | 403 `{code: 'contact_unverified'}` |
| `2fa.enrolled` | redirect `admin.security.two-factor` + banner `auth.2fa_required` | 403 `{code: 'two_factor_required'}` |
| `session.absolute` | logout + redirect `login` with `auth.session_expired` | 401 `{code: 'session_expired'}` |
| `recent.auth` | redirect `password.confirm` (password users) or `auth.reauthenticate` (passwordless), intended URL kept | 403 `{code: 'recent_auth_required'}` |
| `permission:x` / `can:x` / policy denial | page `Error` status 403 (customer records: 404 per `13 §8`) | 403 `{code: 'forbidden'}` (404 `{code: 'not_found'}` for customer records) |
| `signed` | page `Error` 403 (invitation routes render `Auth/InvitationInvalid` reason `invalid` instead, `13 §5.9`) | 403 `{code: 'invalid_signature'}` |
| `throttle:*` | redirect back + flash `error` = `errors.rate_limited` (`{seconds}`) | 429 `{code: 'rate_limited', retryAfter}` + `Retry-After` |

### 1.3 Naming

- **Controllers**: `App\Http\Controllers\{Customer|Admin|Api|Auth|Account|Webhooks}\…Controller`; single-action controllers use `__invoke`. Controllers are thin (`01 §4`): authorise → validate → one Action → respond.
- **FormRequests**: `App\Http\Requests\{same folder}\{Verb}{Thing}Request` (e.g. `Customer\Orders\SubmitOrderRequest`). Every write route has one, even with an empty body (the request's `authorize()` calls the policy; `rules()` returns `[]`). Body keys are camelCase except Fortify/`13` auth forms (`password_confirmation`, `current_password`, `marketing_opt_in`, `cf_turnstile_response`, `terms`, `phone`, `code`). Validation error keys equal submitted field paths (`items.2.quantity`).
- **Actions**: `App\Domain\{Domain}\Actions\{Verb}{Thing}` (`01 §4`); order transitions are one Action each (`09`).
- **Page props types**: the TS interface named in the page tables (§2–§18) lives in `resources/js/types/pages.d.ts` (hand-written; nested types come from `resources/js/types/generated.d.ts`); names follow `10`/`11` where given, otherwise `{PageComponentPathWithoutSlashes}Props` (e.g. `Customer/Projects/Index` → `CustomerProjectsIndexProps`). Controllers build props exclusively from `spatie/laravel-data` classes (§19) and scalars; Pest asserts shapes with `assertInertia` (`16 §6.4`).

### 1.4 Shared validation rule objects (`app/Rules`)

| Rule | Meaning |
|---|---|
| `Ulid` | Laravel `ulid` rule (Crockford base32, 26 chars) |
| `PhoneE164` | libphonenumber parse (default region `business.address.country_code ?? 'IN'`), normalised to E.164; message `validation.phone` |
| `MobilePhone` | `PhoneE164` + type `MOBILE`/`FIXED_LINE_OR_MOBILE` + region in `auth.otp_allowed_country_codes` (`13 §4.1`); codes `phone_invalid`, `phone_not_mobile`, `phone_country_not_supported` |
| `DecimalString(int $intDigits, int $scale)` | string `^\d{1,i}(\.\d{1,s})?$`, value > 0 |
| `IsoDate` | `date_format:Y-m-d` |
| `LengthUnitForSystem(field)` | `metric` → `mm\|cm\|m`, `imperial` → `ftin\|in`; message `account.errors.length_unit` |
| `UploadIntentRef(UploadPurpose $purpose, ?Model $target)` | intent exists, belongs to the user, `status = ready`, purpose matches, target matches when the intent has one, not consumed (`13 §11.3` step 7); failure → 422 `upload_invalid` with `uploadId` |
| `PlanDocumentPayload` / `FurnitureDocumentPayload` | `array`, encoded JSON ≤ 2 MB (else issue `document_too_large`); engine validation runs in the Action (`03 §5`) |
| `TurnstileToken(action, failOpen)` | `13 §3` |
| `AddressForm(prefix)` | `label` nullable\|string\|max:60; `line1` required\|string\|max:200; `line2` nullable\|string\|max:200; `city` required\|string\|max:100; `region` nullable\|string\|max:100; `postalCode` nullable\|string\|max:20; `countryCode` required\|alpha\|size:2\|in:ISO-3166 list |
| `StaffWithPermission(p)` | active staff user (`type = staff`, `is_active`) holding permission `p` |
| `OwnAddress` | `addresses.id` with `user_id` = the order/project owner |

### 1.5 Wire format

camelCase props, JSON and request bodies (master §6.6, `01 §6`); exceptions: `features` flag keys (snake_case master names), `Paginated<T>.meta` (Laravel keys), Fortify/auth form fields (§1.3), query strings (Laravel snake_case: `page`, `per_page`, `sort`, `search`, `filter[state]`, `filter[from]`, `return_plan`, `hint_width`, `level_index`, `plan_name`). Money = integer minor units (`…Minor`), lengths = integer mm (`…Mm`), dates `YYYY-MM-DD` (business TZ), timestamps ISO-8601 UTC (`…At`). Enum values snake_case strings. Decimal quantities are strings (`"1.000"`).

### 1.6 Route model binding

- **ULID parameters**: `{project}`, `{plan}`, `{import}`, `{design}`, `{order}`, `{proposal}`, `{proposalItem}`, `{item}`, `{quote}`, `{negotiation}`, `{issue}`, `{message}`, `{revision}`, `{upload}`, `{user}`, `{invitation}`, `{preset}`, `{id}` (catalog) are constrained globally in `AppServiceProvider::boot()` with `Route::pattern($name, '[0-7][0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{25}')`; a malformed id → 404 before any query.
- **Other parameters**: `{number}` (`ORD-\d{4}-\d{5}`), `{token}` (catalog import token `[A-Za-z0-9]{40}`; Fortify reset token; MSG91 path token `[A-Za-z0-9]{32,128}`), `{templateKey}` (`[a-z0-9_]{1,40}`), `{sessionKey}` (`[a-f0-9]{32}` = first 32 hex chars of `hash_hmac('sha256', $sessionId, APP_KEY)`; the registry maps key → id, raw session ids never leave the server), `{media:uuid}`, notification `{id}` (uuid), unsubscribe `{event}` (`[a-z_.]+`) and `{channel}` (`mail`).
- **Implicit bindings** resolve models by `id`; soft-deleted rows are excluded except where noted (`withTrashed()` on `admin.customers.show|restore|anonymise`, catalog `{id}` resolved in the controller with `withTrashed()->findOrFail`).
- **Scoped bindings** (`->scopeBindings()`, 404 on mismatch). Parent models implement `resolveChildRouteBinding($childType, $value, $field)` with this map:

| Path pattern | Child param → relation |
|---|---|
| `/orders/{order}/…`, `/admin/orders/{order}/…` | `item` → `Order::items()`; `proposal` → `changeProposals()`; `quote` → `quotes()`; `negotiation` → `quoteNegotiations()`; `issue` → `issues()`; `message` → `messages()` |
| `…/proposals/{proposal}/items/{proposalItem}` | `proposalItem` → `ChangeProposal::items()` |
| `/api/plans/{plan}/revisions/{revision}` | `revision` → `Plan::revisions()` |
| `/api/furniture-designs/{design}/revisions/{revision}` | `revision` → `FurnitureDesign::revisions()` |

- `{user}` on `admin.customers.*` must be `type = customer`, on `admin.staff.*` `type = staff` (enforced by the FormRequest/controller; wrong type → 404).
- Ownership: customer routes authorise through policies; non-owners receive **404** (`13 §8`, `Response::denyAsNotFound()`).

### 1.7 Responses

- **Inertia pages**: `Inertia::render(component, props)`; deferred props via `Inertia::defer()` (`Inertia.Deferred<T>`), infinite scroll via `Inertia::scroll()` (`Inertia.ScrollProp<T>`), optional via `Inertia::optional()`. History encryption on (`13 §12.4`).
- **Inertia actions**: redirect (target per route) with `flash.success` (translated) unless stated; `preserveScroll` decided by the client. 204 for the XHR "read" routes.
- **JSON**: `200`/`201`/`202`/`204` with the bodies below; errors per §1.8.
- **Downloads**: `302` to a 15-minute signed storage URL (`Cache-Control: private, no-store`) or streamed responses (CSV/JSON export).

### 1.8 JSON error envelope (all `/api/*`, XHR on web routes, webhooks excluded)

```ts
interface ApiError {
  code: string;                         // stable machine code (snake_case; a few 13 codes are dotted, e.g. 'staff.last_owner')
  message: string;                      // translated, user-presentable (never exception text)
  details?: Record<string, unknown>;    // extra structured data
  // code-specific top-level fields defined by the owning documents (kept verbatim), e.g.
  // version_conflict: currentVersion, savedBy, savedAt (03 §5) | locked: reason, orderNumber | lockedBy, lockedAt
  // invalid_document: issues: Issue[] | rate_limited: retryAfter | validation_failed: errors
  // invalid_import_state: status | bom_not_ready: items | upload_invalid: uploadId | daily_limit_reached: resetsAt
}
```

Rendered by `bootstrap/app.php` `withExceptions()`: `ValidationException` → 422 `{code: 'validation_failed', message, errors: Record<field, string[]>}` (domain validation that carries a code, e.g. `upload_invalid`, sets `code` to it and keeps `errors`); `AuthorizationException` → 403 `forbidden` (404 `not_found` when denied-as-not-found); `ModelNotFoundException`/`NotFoundHttpException` → 404 `not_found`; `CouldNotPerformTransition` → 409 `invalid_transition` `{details: {state}}`; `InvalidImportTransition` → 409 `invalid_import_state` `{status}`; `ThrottleRequestsException` → 429; `TokenMismatchException` → 419 `csrf_mismatch`; `AiQuotaException` → its `18 §14` status/code; `DomainException` subclasses (`App\Support\Http\CodedHttpException(status, code, details)`) → as given; anything else → 500 `server_error` (503 `service_unavailable` during maintenance).

Status → codes used by this API:

| Status | Codes |
|---|---|
| 400 | `bad_request` (malformed JSON) |
| 401 | `unauthenticated`, `account_inactive`, `session_expired` |
| 402 | `insufficient_credits` (`18 §14`) |
| 403 | `forbidden`, `contact_unverified`, `two_factor_required`, `recent_auth_required`, `invalid_signature` |
| 404 | `not_found`, `pdf_not_ready`, `no_challenge` |
| 409 | `invalid_transition`, `version_conflict`, `invalid_import_state`, `source_not_ready`, `ai_budget_exhausted`, `bom_not_ready`, `bom_not_failed`, `proposal_not_draft`, `proposal_not_open`, `quote_expired`, `quote_not_current`, `quote_send_blocked`, `negotiation_limit`, `negotiation_disabled`, `cutlist_failed` |
| 419 | `csrf_mismatch` |
| 422 | `validation_failed`, `invalid_document`, `upload_invalid`, `upload_size_mismatch`, `unsupported_type`, `dwg_not_supported`, `file_too_large`, `scale_not_confirmed`, `proposal_empty`, `discount_exceeds_subtotal`, `design_in_active_order`, `design_in_order`, `project_has_orders`, `thread_closed`, `edit_window`, `preference_locked`, `push_not_subscribed`, `revoke_exceeds_balance`, `not_a_customer`, `nothing_to_refund`, `active_orders`, `last_login_method`, `captcha_required`, OTP/phone codes of `13 §4`, `staff.*` codes of `13 §5.9`, `restore_window_passed`, `open_issues`, `confirmation_call_required`, `catalog_code_taken`, `invalid_defaults` |
| 423 | `locked` (`reason`: `in_order` + `orderNumber`, or `plan_locked` + `lockedBy`, `lockedAt`) |
| 429 | `rate_limited`, `otp_cooldown`, `otp_rate_limited`, `daily_limit_reached`, `too_many_active_imports` |
| 500 / 503 | `server_error` / `service_unavailable`, `otp_unavailable`, `otp_send_failed` |

### 1.9 Inertia error handling

| Situation | Behaviour |
|---|---|
| Field validation (422) | redirect back; errors in the Inertia errors bag (`form.errors.field`), `errorBag` per form when a page has several forms |
| Coded domain error on an Inertia form (e.g. `design_in_active_order`, `captcha_required`, `otp_invalid`, `proposal_empty`) | thrown as `ValidationException`: errors bag gets the field message (or `_error` when no field applies) **and** `code` = the code string; extra values as strings (e.g. `attemptsLeft`, `retryAfter`) |
| 409 `invalid_transition` / `proposal_not_open` / `quote_not_current` / `quote_expired` | redirect back with `flash.error` (`orders.errors.invalid_transition` "This order changed in the meantime. The page has been refreshed." or the specific key); the page reloads its props |
| 423 on an Inertia route (e.g. renaming a locked design) | redirect back with `flash.error` `furniture.errors.locked` |
| 403 / 404 / 500 / 503 | page `Error` with `{status}` (`10 §4.10`), layout by audience; local debug keeps Ignition |
| 419 | page `Error` status 419 ("reload") |
| 429 | redirect back with `flash.error` `errors.rate_limited` `{seconds}` (`13 §10`) |
| JSON endpoints called from Inertia pages | `lib/http.ts` maps the envelope to toasts or editor states (`03 §5`) |

### 1.10 Pagination

- **Page-based** (`Paginated<T>`, `15 §9.29`) for every Inertia list: query `page`, `per_page` (admin 10–100 default 25; customer card grids 12; catalog 50; designs 24; ledgers 20/50); `meta` keeps Laravel keys; `filters` prop echoes parsed filters; invalid query values are ignored (never 422 on GET).
- **Cursor-based** JSON: `api.notifications.index` (`cursor`, `limit` 1–50 default 25 → `{data, nextCursor, unreadCount}`); plan/furniture revisions (`before` = revision number → `{data, hasMore}`, 50 per page).
- **Inertia infinite scroll**: order messages (`Inertia::scroll()`, cursor = message id, 30 per page; fallback `?before={messageId}`).
- **Sorting**: `sort=field` / `sort=-field`, whitelisted per page.

### 1.11 Rate limiters (consolidated; defined in `App\Providers\RateLimitServiceProvider`, values in `config/security.php` `rate_limits`)

| Name | Limits (all apply) | Key | Applied to |
|---|---|---|---|
| `login` | 5/min; 30/min | `lower(email)\|ip`; `ip` | `login.store` (Fortify `limiters.login`) |
| `two-factor` | 5/min | `session('login.id')` | `two-factor.login.store` (Fortify) |
| `register` | 5/hour | ip | `register.store`, `auth.otp.complete` |
| `password-reset` | 3/hour; 10/hour | `lower(email)`; ip | `password.email` |
| `verification-resend` | 3 per 10 min | user id | `verification.send` (Fortify keeps its `6,1` on `verification.verify`) |
| `otp-send` | 5/hour; 10/hour | phone E.164; ip | `auth.otp.send`, `auth.otp.resend`, `account.phone.send`, `auth.reauthenticate.store` (send step) — applied inside `SendOtp` (`13 §4.2`) |
| `otp-cooldown` | 1 per 60 s | phone | same, checked first |
| `otp-verify` | 10/min; 20/hour | ip; phone | `auth.otp.verify`, `account.phone.verify`, `auth.reauthenticate.store` (verify step) — inside `VerifyOtp` |
| `oauth` | 20/min | ip | `auth.google.redirect`, `auth.google.callback` |
| `uploads-presign` | 30/min; 300/day | user id | `api.uploads.presign` |
| `uploads-confirm` | 60/min | user id | `api.uploads.confirm` |
| `imports-start` | 10/hour | user id | `api.imports.start`, `api.imports.rerun` |
| `ai-provider-test` | 10/min | user id | `admin.settings.ai.test` |
| `thumbnails` | 6/min | user id | `api.plans.thumbnail.store`, `api.projects.cover.store`, `api.furniture-designs.thumbnail.store` |
| `test-push` | 3/min | user id | `customer.account.notifications.test-push`, `admin.account.notifications.test-push` |
| `messages-post` | 20/min; 300/day | user id | `customer.orders.messages.store`, `admin.orders.messages.store` |
| `autosave` | 60/min | `user id\|document type\|document id` | `api.plans.working-copy.update`, `api.furniture-designs.working-copy.update`, `api.change-proposal-items.draft`, `api.imports.review-document` |
| `exports` | 20/hour | user id | `admin.furniture-revisions.cutlist.pdf.store` (the only server-rendered export with a route in v1; plan sheets are client-side, `05 §14.3`) |
| `data-export` | 3/day | user id | `customer.account.export` |
| `invitations` | 20/day | user id | `admin.staff.invitations.store`, `admin.staff.invitations.resend` |
| `broadcasting-auth` | 120/min | user id | `POST /broadcasting/auth` |
| `webhooks` | 600/min | ip | `webhooks.*` |
| `client-errors` | 10/min | ip | `api.client-errors.store` |
| `csp-report` | 30/min | ip | `csp.report` |
| `api` | 120/min (guests 60/min by ip) | user id | every other `/api/*` route |

Non-limiter quotas enforced in Actions: `ai.max_recognitions_per_day` (429 `daily_limit_reached`), `imports.max_active_per_user` (429 `too_many_active_imports`), OTP global hourly cap (`13 §4.1`), push subscriptions ≤ 10 per user (`12 §8.3`).

### 1.12 Wayfinder

`laravel/wayfinder 0.1.23` generates `resources/js/actions/**` (per controller method) and `resources/js/routes/**` (per route name; dots become folders: `customer.orders.quotes.accept` → `import { accept } from '@/routes/customer/orders/quotes'`) during `yarn dev`/`yarn build` (Vite plugin, `--with-form`). Rules: **never hard-code a URL** in Vue/TS; Inertia links use `:href="show(order.id)"` / `<Link :href="show.url(order.id)">`; forms use `useForm(...).submit(accept(order.id, quote.id))` or `<Form v-bind="accept.form(order.id, quote.id)">`; JSON calls go through `lib/http.ts` with `route.url(...)` and `route.method`; query strings via `{ query: { tab: 'quote' } }`. Server-side URLs in props (`href`, `editUrl`, `reviewUrl`, notification `url`) are produced with `route(...)` and relative (`absolute: false`) except where marked absolute (mail, push, SMS). Fortify routes are included (their names are those of §3.1).

### 1.13 Global page props

Shared props (`HandleInertiaRequests::share`, `01 §6`) are typed as `SharedProps` (§19.1). Every page props type below is merged with `SharedProps` by `PageProps<T>`.

---

## 2. Public, legal, PWA, links, media, CSP, health

| Name | Method · Path | File · MW | Controller | Request / rules | Authz | Action | Response |
|---|---|---|---|---|---|---|---|
| `welcome` | GET `/` | web · `PUB` | `WelcomeController` (`__invoke`) | — | — | — | Guest: page `Welcome` · `WelcomeProps {canRegister}`. Authenticated: 302 → `customer.dashboard` (customers; the `onboarded` rule then applies) / `admin.dashboard` (staff) |
| `legal.terms` | GET `/terms` | web · `PUB` | `LegalController@terms` | — | — | — | page `Legal/Terms` · `LegalPageProps {businessName, updatedOn}`; layout by audience |
| `legal.privacy` | GET `/privacy` | web · `PUB` | `LegalController@privacy` | — | — | — | page `Legal/Privacy` · `LegalPageProps` |
| `manifest` | GET `/manifest.webmanifest` | web · `PUB` | `ManifestController` | — | — | — | 200 `application/manifest+json` per `10 §15` (`name`, `short_name`, `id`, `start_url`, `scope`, `display`, colours, 3 icons); `Cache-Control: public, max-age=3600` |
| `links.order` | GET `/o/{number}` | web · `AUTH` | `LinkController@order` | — | owner customer or staff `orders.view`, else 404 | — | 302 to the order's primary page (`12 §3.6`): customer → proposal (`changes_proposed`), quote (`quoted`), completion (`completed`), else `customer.orders.show`; staff → `admin.orders.show`. Logged out → `login` with intended URL |
| `media.show` | GET `/media/{media:uuid}?conversion=` | web · `AUTH` | `MediaController@show` | query `conversion` nullable\|in:thumb,small,large,preview | per `13 §8.9` (model + collection map; unknown → 404) | — | 302 → 15-min signed URL; PDFs/non-images `ResponseContentDisposition: attachment`; `Cache-Control: private, no-store` |
| `account.deletion-scheduled` | GET `/account-deleted` | web · `PUB` | `Auth\AccountDeletedController` | — | — | — | page `Auth/AccountDeletionScheduled` · `AccountDeletionScheduledProps {anonymiseOn: IsoDate \| null, supportEmail}` (`anonymiseOn` from a one-time session flash; null when opened directly) |
| `notifications.unsubscribe` | GET `/notifications/unsubscribe/{user}/{event}/{channel}` | web · `SGN` (no login) | `NotificationUnsubscribeController@show` | — (invalid signature → page `Error` 403) | signature | — | page `Auth/Unsubscribe` · `UnsubscribeProps {eventLabel, channel: 'mail', done: false, preferencesUrl}` |
| `notifications.unsubscribe.store` | POST `/notifications/unsubscribe/{user}/{event}/{channel}` | web · `SGN` (CSRF-exempt for RFC 8058 one-click; signed URL generated with the GET name) | `@store` | `Notifications\UnsubscribeRequest`: — (`{event}` must be a non-transactional catalogue key, `{channel}` = `mail`) | signature | `UnsubscribeFromEvent` (upserts `notification_preferences.enabled = false`) | page `Auth/Unsubscribe` with `done: true` (one-click POST from a mail client: 200 empty body) |
| `csp.report` | POST `/csp-report` | web · `PUB` (CSRF-exempt) + `throttle:csp-report` | `CspReportController` | raw JSON (`application/csp-report` or `application/reports+json`), ≤ 16 KB | — | — | 204; logs to channel `security` truncated to 2 KB (`13 §12.1`) |
| `health.deep` | GET `/up/deep` | webhooks.php · `HLTH` | `HealthController` | header `X-Health-Token` or `?token=` = `HEALTH_CHECK_TOKEN` (else 404) | token | — | 200/503 `{status: 'ok'\|'degraded'\|'down', version, checks: {database, redis, horizon, scheduler, storage, vision, gotenberg, reverb: {ok, ms, error?}}}` (`17 §5.11`) |

---

## 3. Authentication & account security

### 3.1 Fortify routes (file: package, `FTF`)

Fortify's controllers; this app supplies the Actions (`app/Actions/Fortify/*`), views (`13 §2`) and responses. Pages receive `AuthPageProps {features, turnstileSiteKey: string|null, canRegister: boolean}` merged with the listed props. `FortifyRouteGuards` **[added]** adds, by route name: `register.store` → `throttle:register` + Turnstile `register` (fail open); `password.email` → `throttle:password-reset` + Turnstile `password_reset` (fail open); `verification.send` → `throttle:verification-resend`; `user-profile-information.update` → `recent.auth` when `email` differs from the current email.

| Name | Method · Path | Fortify MW | Body (Fortify names) → rules (in our Action) | Action / response |
|---|---|---|---|---|
| `login` | GET `/login` | `guest` | — | page `Auth/Login` · `LoginProps {status, canResetPassword} & AuthPageProps` |
| `login.store` | POST `/login` | `guest`, `throttle:login` | `email` required\|string\|email; `password` required\|string; `remember` boolean (forced false for staff by `ApplyRememberPolicy`) | `AuthenticateUser` (`13 §2`); success → custom `LoginResponse` (intended / `customer.dashboard` / `admin.dashboard`; 2FA users → `two-factor.login`); failure → errors `email: auth.failed`; inactive → `auth.inactive` |
| `logout` | POST `/logout` | `auth` | — | session invalidated, `Inertia::clearHistory()`, 302 `/` |
| `register` | GET `/register` | `guest` | — | page `Auth/Register` · `AuthPageProps`; closed registration renders `auth.registration_closed` |
| `register.store` | POST `/register` | `guest` (+ guards) | `name` required\|string\|min:2\|max:120\|not_regex:/(https?:\/\/\|www\.)/i; `email` required\|email:rfc\|max:254\|unique:users,email (incl. soft-deleted; message `auth.email_unavailable`); `password` required\|`Password::defaults()`\|confirmed; `password_confirmation`; `terms` accepted; `marketing_opt_in` boolean; `cf_turnstile_response` `TurnstileToken('register', true)`; 403 `auth.registration_closed` when disabled | `CreateNewUser` → `CustomerRegistered`; `RegisterResponse` → `customer.dashboard` (→ onboarding) |
| `password.request` | GET `/forgot-password` | `guest` | — | page `Auth/ForgotPassword` · `{status} & AuthPageProps` |
| `password.email` | POST `/forgot-password` | `guest` (+ guards) | `email` required\|email; `cf_turnstile_response` | always back with status `passwords.sent_generic` (`13 §5.5`) |
| `password.reset` | GET `/reset-password/{token}` | `guest` | query `email` | page `Auth/ResetPassword` · `ResetPasswordProps {email, token}` |
| `password.update` | POST `/reset-password` | `guest` | `token` required; `email` required\|email; `password` required\|`Password::defaults()`\|confirmed | `ResetUserPassword` (verifies email, rotates remember token, revokes sessions) → `login` with status |
| `verification.notice` | GET `/email/verify` | `auth` | — | page `Auth/VerifyEmail` · `VerifyEmailProps {status, email}` |
| `verification.verify` | GET `/email/verify/{id}/{hash}` | `auth`, `signed`, `throttle:6,1` | — | Fortify verify → `Verified` → `ContactVerified` (first contact) → `customer.dashboard` / `admin.dashboard` with flash `account.toasts.email_verified` |
| `verification.send` | POST `/email/verification-notification` | `auth` (+ guards) | — | back with status `verification-link-sent` |
| `password.confirm` | GET `/user/confirm-password` | `auth` | — | page `Auth/ConfirmPassword` |
| `password.confirm.store` | POST `/user/confirm-password` | `auth` | `password` required\|current_password | sets `auth.password_confirmed_at`; 302 intended |
| `password.confirmation` | GET `/user/confirmed-password-status` | `auth` | — | 200 `{confirmed: boolean}` |
| `two-factor.login` | GET `/two-factor-challenge` | `guest` | — | page `Auth/TwoFactorChallenge` |
| `two-factor.login.store` | POST `/two-factor-challenge` | `guest`, `throttle:two-factor` | `code` nullable\|string; `recovery_code` nullable\|string | `TwoFactorLoginResponse` → intended / `admin.dashboard` |
| `user-profile-information.update` | PUT `/user/profile-information` | `auth` (+ `recent.auth` on email change) | `name` required\|min:2\|max:120; `email` nullable (required for staff)\|email:rfc\|max:254\|unique incl. soft-deleted (`auth.email_unavailable`); `marketing_opt_in` boolean (customers) | `UpdateUserProfileInformation` (`13 §5.8`; clearing the last login method → `auth.errors.last_login_method`) → back |
| `user-password.update` | PUT `/user/password` | `auth` | `current_password` required_if has password\|current_password; `password` required\|`Password::defaults()`\|confirmed | `UpdateUserPassword` (sets first password for passwordless users) → back flash `account.toasts.password_updated` |
| `two-factor.enable` | POST `/user/two-factor-authentication` | `auth`, `password.confirm` | — | staff only (customers 403); back |
| `two-factor.confirm` | POST `/user/confirmed-two-factor-authentication` | `auth`, `password.confirm` | `code` required\|string | back; audit `auth.2fa_enabled` |
| `two-factor.disable` | DELETE `/user/two-factor-authentication` | `auth`, `password.confirm` | — | owner/admin → 403 `auth.errors.2fa_required` (`PreventRequiredTwoFactorDisable`); else back |
| `two-factor.qr-code` | GET `/user/two-factor-qr-code` | `auth`, `password.confirm` | — | 200 `{svg, url}` |
| `two-factor.secret-key` | GET `/user/two-factor-secret-key` | `auth`, `password.confirm` | — | 200 `{secretKey}` |
| `two-factor.recovery-codes` | GET `/user/two-factor-recovery-codes` | `auth`, `password.confirm` | — | 200 `string[]` (8 codes) |
| `two-factor.regenerate-recovery-codes` | POST `/user/two-factor-recovery-codes` | `auth`, `password.confirm` | — | back |

All `two-factor.*` routes return 403 for `type = customer` (`PreventCustomerTwoFactor`).

### 3.2 Phone OTP, Google, re-authentication (file: `web.php`)

| Name | Method · Path | MW | Controller | Request → rules | Action | Response / errors |
|---|---|---|---|---|---|---|
| `auth.otp.create` | GET `/login/phone` | `GST` | `Auth\PhoneOtpController@create` | query `intent` in:login,register (default login) | — | page `Auth/PhoneLogin` · `PhoneLoginProps {intent} & AuthPageProps` |
| `auth.otp.send` | POST `/auth/otp/send` | `GST` | `@send` | `Auth\SendOtpRequest`: `phone` required\|string\|max:32\|`MobilePhone`; `intent` required\|in:login,register; `name` required_if:intent,register\|string\|min:2\|max:120; `terms` required_if:intent,register\|accepted; `cf_turnstile_response` nullable\|string | `SendOtp` (purpose `login`) | 302 `auth.otp.verify.show` (session challenge). Errors (errors bag + `code`): `phone_invalid`, `phone_not_mobile`, `phone_country_not_supported`, `captcha_required`, `otp_cooldown` (+`retryAfter`), `otp_rate_limited`, `otp_unavailable`, `otp_send_failed` |
| `auth.otp.verify.show` | GET `/auth/otp/verify` | `GST` | `@showVerify` | — (no challenge → 302 `auth.otp.create`) | — | page `Auth/PhoneVerify` · `PhoneVerifyProps {channel, maskedPhone, resendAvailableIn, channels}` |
| `auth.otp.verify` | POST `/auth/otp/verify` | `GST` | `@verify` | `Auth\VerifyOtpRequest`: `code` required\|string\|max:12 (normalised; non-6-digit → `otp_invalid` without consuming an attempt) | `VerifyOtp` → login / `RegisterCustomer::fromPhone` | 302 intended / `customer.dashboard` / `auth.otp.complete.show`. Errors: `otp_invalid` (+`attemptsLeft`), `otp_expired`, `otp_too_many_attempts`, `auth.errors.account_pending_deletion`, `auth.errors.staff_use_email`, `auth.inactive`, `auth.registration_closed`, 429 `rate_limited` |
| `auth.otp.resend` | POST `/auth/otp/resend` | `GST` | `@resend` | `Auth\ResendOtpRequest`: `channel` nullable\|in:whatsapp,sms; `cf_turnstile_response` nullable\|string | `SendOtp` (session phone) | back; errors as `auth.otp.send` |
| `auth.otp.status` | GET `/auth/otp/status` | `web` | `@status` | — | — | 200 `{channel: 'whatsapp'\|'sms', fallbackSent: boolean}`; 404 `no_challenge` |
| `auth.otp.complete.show` | GET `/auth/otp/complete` | `GST` | `@showComplete` | requires `otp.verified_phone` < 15 min, else 302 `auth.otp.create` | — | page `Auth/PhoneComplete` · `{maskedPhone}` |
| `auth.otp.complete` | POST `/auth/otp/complete` | `GST`, `throttle:register` | `@complete` | `Auth\CompleteOtpSignupRequest`: `name` required\|string\|min:2\|max:120; `terms` accepted | `RegisterCustomer::fromPhone` | 302 `customer.dashboard`; expired verification → errors `code: otp_expired` |
| `auth.google.redirect` | GET `/auth/google/redirect` | `web`, `throttle:oauth` | `Auth\GoogleController@redirect` | query `intent` required\|in:login,link,invitation,reauthenticate (`link`/`reauthenticate` require auth; `invitation` requires session `invitation.id`; `login` requires guest) | — | 302 Google (`features.google_login`, else 404) |
| `auth.google.callback` | GET `/auth/google/callback` | `web`, `throttle:oauth` | `@callback` | — | `LinkGoogleAccount` / `RegisterCustomer` per `13 §5.3`; intent `reauthenticate` **[added]**: the Google id must equal the user's `google_id`, sets `auth.password_confirmed_at` | 302 per intent; errors to `login` (or the security page for `link`/`reauthenticate`) with `auth.errors.oauth_cancelled`, `oauth_state_invalid`, `oauth_failed`, `google_email_unverified`, `pending_staff_invitation`, `google_in_use`, `google_email_mismatch`, `email_unavailable`, `registration_closed` |
| `auth.reauthenticate` | GET `/auth/reauthenticate` | `AUTH` | `Auth\ReauthenticateController@show` | — (users with a password → 302 `password.confirm`) | — | page `Auth/Reauthenticate` · `ReauthenticateProps {maskedPhone: string\|null, phoneAvailable: boolean, googleLinked: boolean, googleEnabled: boolean}` |
| `auth.reauthenticate.store` | POST `/auth/reauthenticate` | `AUTH` | `@store` | `Auth\ReauthenticateRequest`: `step` required\|in:send,verify; `code` required_if:step,verify\|string\|max:12 | `SendOtp`/`VerifyOtp` (purpose `login`, the user's verified phone) | `send` → back with flash `info` (channel); `verify` success → sets `auth.password_confirmed_at`, 302 intended. OTP errors as above |

### 3.3 Account security (both audiences; file `web.php`, `AUTH`)

| Name | Method · Path | Extra MW | Controller | Request → rules | Action | Response / errors |
|---|---|---|---|---|---|---|
| `account.google.unlink` | DELETE `/account/google` | `recent.auth` | `Account\GoogleLinkController@destroy` | `Account\UnlinkGoogleRequest`: — | `UnlinkGoogleAccount` | back flash `account.toasts.google_unlinked`; `code: last_login_method` |
| `account.phone.send` | POST `/account/phone/otp` | — | `Account\PhoneController@send` | `Account\SendPhoneOtpRequest`: `phone` required\|string\|max:32\|`MobilePhone`; `cf_turnstile_response` nullable | `SendOtp` (purpose `verify_phone`) | back with flash `info` = `account.otp_sent` `{channel, phone}` (masked); errors as `auth.otp.send` |
| `account.phone.verify` | POST `/account/phone/verify` | — | `@verify` | `Account\VerifyPhoneRequest`: `code` required\|string\|max:12 | `VerifyOtp` + `VerifyPhone` (`13 §5.7`; may dispatch `ContactVerified`) | back flash `account.toasts.phone_verified`; `code: auth.errors.phone_unavailable`, OTP errors |
| `account.sessions.destroy` | DELETE `/account/sessions/{sessionKey}` | — | `Account\SessionController@destroy` | `Account\RevokeSessionRequest`: key belongs to the user (else 404) | `RevokeSessions` | back flash `account.toasts.session_revoked`; revoking the current session logs out (302 `login`) |
| `account.sessions.destroy-others` | DELETE `/account/sessions` | `recent.auth` | `@destroyOthers` | `Account\RevokeOtherSessionsRequest`: — | `RevokeSessions(others: true)` (rotates remember token) | back flash `account.toasts.sessions_revoked` `{count}` |

### 3.4 Staff invitation acceptance (file `web.php`, `SGN`)

| Name | Method · Path | Controller | Request → rules | Action | Response |
|---|---|---|---|---|---|
| `staff.invitations.show` | GET `/staff/invitations/{invitation}` | `Auth\StaffInvitationController@show` | invalid signature/expired/accepted/revoked/signed-in → page `Auth/InvitationInvalid` · `InvitationInvalidProps {reason: 'expired'\|'invalid'\|'accepted'\|'revoked'\|'signed_in'}` | — | page `Auth/AcceptInvitation` · `AcceptInvitationProps {invitation: {email, name, roleLabel, expiresAt}, googleEnabled, prefillName}` (`11 §7.1`) |
| `staff.invitations.accept` | POST `/staff/invitations/{invitation}` | `@accept` | `Auth\AcceptStaffInvitationRequest`: `name` required\|string\|min:2\|max:120; `password` required\|`Password::defaults()`\|confirmed | `AcceptStaffInvitation` | 302 `admin.dashboard` (owners/admins then forced to 2FA enrolment); stale invitation → `InvitationInvalid` page |

---
## 4. Customer: onboarding, dashboard, help, notification center (file `customer.php`)

| Name | Method · Path | MW | Controller | Request → rules | Authz | Action | Response / errors |
|---|---|---|---|---|---|---|---|
| `customer.onboarding.show` | GET `/onboarding` | `CUS0` | `Customer\OnboardingController@show` | — (already onboarded → 302 `customer.dashboard`) | — | — | page `Customer/Onboarding/Wizard` · `OnboardingProps` (`10 §5.2`) |
| `customer.onboarding.store` | POST `/onboarding` | `CUS0` | `@store` | `Customer\Onboarding\StoreOnboardingRequest`: `name` required\|string\|min:2\|max:120; `terms` required (accepted) when `terms_accepted_at` is null, else prohibited; `unitSystem` required\|in:metric,imperial; `lengthUnit` required\|`LengthUnitForSystem(unitSystem)`; `timezone` required\|timezone:all; `project.name` required\|string\|max:120; `project.propertyType` required\|in:`PropertyType`; `start` required\|in:upload,draw,starter,none; `starterKey` required_if:start,starter\|in:keys of `config('plan_starters')` | own | `CompleteOnboarding` (updates user, sets `onboarded_at`/`terms_accepted_at`, `CreateProject`, `CreatePlan` for draw/starter) | 302 per `start`: `draw`/`starter` → `customer.plans.edit`; `upload` → `customer.projects.imports.create`; `none` → `customer.projects.show`. Messages `onboarding.errors.*`, `account.errors.length_unit`, `projects.errors.name_required` |
| `customer.onboarding.skip` | POST `/onboarding/skip` | `CUS0` | `@skip` | `Customer\Onboarding\SkipOnboardingRequest`: `terms` as above | own | `SkipOnboarding` | 302 `customer.dashboard` |
| `customer.dashboard` | GET `/dashboard` | `CUS` | `Customer\DashboardController` | — | — | — | page `Customer/Dashboard` · `CustomerDashboardProps` (`10 §6`) |
| `customer.help` | GET `/help` | `CUS0` | `Customer\HelpController` | — | — | — | page `Customer/Help` · `CustomerHelpProps {business: {name, phoneE164, whatsappUrl, email, workingHours, addressOneLine}}` |
| `customer.notifications.index` | GET `/notifications` | `CUS0` | `Customer\NotificationCenterController` | query `filter` in:all,unread | — | — | page `Customer/Notifications/Index` · `NotificationCenterProps {initial: {data: NotificationPayloadData[], nextCursor, unreadCount}, filter}` (`10 §12`) |

---

## 5. Customer projects & plans (file `customer.php`, `CUS`)

| Name | Method · Path | Controller | Request → rules | Authz (policy) | Action | Response / errors |
|---|---|---|---|---|---|---|
| `customer.projects.index` | GET `/projects` | `Customer\ProjectController@index` | query `filter[status]` in:active,archived (default active), `search`, `sort` in:-updated_at,name, `page` (12/page) | `ProjectPolicy::viewAny` | — | page `Customer/Projects/Index` · `CustomerProjectsIndexProps {projects: Paginated<ProjectSummaryData>, filters: {status, search, sort}}` |
| `customer.projects.create` | GET `/projects/create` | `@create` | — | `create` | — | page `Customer/Projects/Create` · `CustomerProjectsCreateProps {propertyTypes, addresses: AddressData[], defaultCountryCode}` |
| `customer.projects.store` | POST `/projects` | `@store` | `Customer\Projects\StoreProjectRequest`: `name` required\|string\|max:120; `propertyType` required\|in:`PropertyType`; `notes` nullable\|string\|max:2000; `siteAddressId` nullable\|ulid\|`OwnAddress`\|prohibits:siteAddress; `siteAddress` nullable\|array + `AddressForm('siteAddress')` | `create` | `CreateProject` | 302 `customer.projects.show` flash `projects.toasts.created` |
| `customer.projects.show` | GET `/projects/{project}` | `@show` | query `tab` in:plans,designs,orders,imports; `plan` ulid | `view` (404 non-owner) | — | page `Customer/Projects/Show` · `ProjectShowProps` (`10 §7.3`; `imports` deferred) |
| `customer.projects.edit` | GET `/projects/{project}/edit` | `@edit` | — | `update` | — | page `Customer/Projects/Edit` · `CustomerProjectsEditProps {project: ProjectData, propertyTypes, addresses}` |
| `customer.projects.update` | PUT `/projects/{project}` | `@update` | `Customer\Projects\UpdateProjectRequest`: rules of `StoreProjectRequest` | `update` | `UpdateProject` (new address row when the old one is referenced by an Active order, `10 §7.4`) | 302 `customer.projects.show` flash `projects.toasts.updated` |
| `customer.projects.archive` | POST `/projects/{project}/archive` | `@archive` | `Customer\Projects\ArchiveProjectRequest`: — | `archive` | `ArchiveProject` | back flash `projects.toasts.archived` |
| `customer.projects.unarchive` | POST `/projects/{project}/unarchive` | `@unarchive` | `Customer\Projects\UnarchiveProjectRequest`: — | `restore` | `UnarchiveProject` | back flash `projects.toasts.unarchived` |
| `customer.projects.destroy` | DELETE `/projects/{project}` | `@destroy` | `Customer\Projects\DestroyProjectRequest`: `confirmation` required\|string\|same-as project name (message `projects.errors.confirmation`) | `delete` (422 `project_has_orders`) | `DeleteProject` (soft delete) | 302 `customer.projects.index` flash `projects.toasts.deleted` |
| `customer.projects.plans.store` | POST `/projects/{project}/plans` | `Customer\PlanController@store` | `Customer\Plans\StorePlanRequest`: `name` required\|string\|max:80; `levelIndex` required\|integer\|between:-2,10; `start` required\|in:blank,starter; `starterKey` required_if:start,starter\|in:starter keys | `PlanPolicy::create` (project active, else 409 `invalid_transition` → flash `projects.errors.archived`) | `CreatePlan` (`source = drawn`; starter copies the registry document with fresh ids, `10 §8.3`) | 302 `customer.plans.edit` |
| `customer.plans.edit` | GET `/plans/{plan}/edit` | `@edit` | query `place` (ulid; ignored unless a design of the project), `mode` in:2d,3d, `tool`, `panel`, `select` | `PlanPolicy::view` | — | page `Customer/Plans/Edit` · `PlanEditPageProps` (`10 §8.2`; `backgroundUrl` refreshable via `only: ['backgroundUrl']`) |
| `customer.plans.update` | PATCH `/plans/{plan}` | `@update` | `Customer\Plans\UpdatePlanRequest`: `name` sometimes\|required\|string\|max:80; `levelIndex` sometimes\|required\|integer\|between:-2,10 | `PlanPolicy::update` (allowed while locked: metadata only) | `UpdatePlan` | back |
| `customer.plans.duplicate` | POST `/plans/{plan}/duplicate` | `@duplicate` | `Customer\Plans\DuplicatePlanRequest`: `name` required\|string\|max:80 | `PlanPolicy::duplicate` | `DuplicatePlan` (`source = duplicated`, next `level_index`) | back flash `plans.toasts.duplicated` |
| `customer.plans.destroy` | DELETE `/plans/{plan}` | `@destroy` | `Customer\Plans\DestroyPlanRequest`: — | `PlanPolicy::delete` | `DeletePlan` (soft delete) | 302 `customer.projects.show` (`tab=plans`) flash `plans.toasts.deleted` |

---

## 6. Customer import pages (file `customer.php`, `CUS`; JSON API in §18.3)

| Name | Method · Path | Controller | Request | Authz | Response |
|---|---|---|---|---|---|
| `customer.projects.imports.create` | GET `/projects/{project}/imports/new` | `Customer\ImportPageController@create` | query `plan` (ulid of a project plan), `level_index` (int −5..50), `plan_name` (≤ 80) | `BlueprintImportPolicy::create` in trace semantics (`13 §11.1`) | page `Customer/Imports/Create` · `ImportCreateProps {project: ProjectRefData, plans: {id, name}[], credits: CreditSummaryData, limits: {maxBytes, maxBytesDxf, acceptedExtensions}, features: {dxfImport}, target: {planId, name, levelIndex}}` (`10 §9.1`) |
| `customer.imports.show` | GET `/imports/{import}` | `@show` | — | `view` | page `Customer/Imports/Show` · `ImportShowProps {import: ImportStatusData, credits: CreditSummaryData, project: ProjectRefData, contactVerified: boolean}` |
| `customer.imports.review` | GET `/imports/{import}/review` | `@review` | — (status ≠ `ready_for_review` → 302 `customer.imports.show`) | `update` | page `Customer/Imports/Review` · `ImportReviewProps = ImportReviewPayload (A7) & {import: ImportStatusData, project: ProjectRefData, plans: {id, name, levelIndex}[], userUnits: {unitSystem, lengthUnit}, defaults: PlanEditPageProps['defaults']}` |

---

## 7. Customer furniture (file `customer.php`, `CUS`)

| Name | Method · Path | Controller | Request → rules | Authz | Action | Response / errors |
|---|---|---|---|---|---|---|
| `customer.furniture.index` | GET `/furniture` | `Customer\FurnitureDesignController@index` | query `filter[project]`, `filter[template]`, `filter[availability]` in:all,available,in_order, `search`, `sort` in:-updated_at,name, `page` (24) | own designs | — | page `Customer/Furniture/Index` · `CustomerFurnitureIndexProps` (`10 §10.1`) |
| `customer.projects.furniture.create` | GET `/projects/{project}/furniture/create` | `@create` | query `return_plan` (plan of the project), `hint_width` (int mm) | `FurnitureDesignPolicy::create` | — | page `Customer/Furniture/Create` · `FurnitureCreateProps {project: {id, name}, templates: TemplateSummaryData[], presets: PresetSummaryData[], catalogVersion, returnPlan: {id, name} \| null, hintWidthMm: number \| null}` (`07 §8.1`, `10 §10.2`) |
| `customer.projects.furniture.store` | POST `/projects/{project}/furniture` | `@store` | `Customer\Furniture\StoreFurnitureDesignRequest`: `name` required\|string\|max:120; `templateKey` required\|string\|in:enabled template keys; `presetId` nullable\|ulid\|exists active preset with the same `templateKey`; `document` required\|`FurnitureDocumentPayload`; `returnPlanId` nullable\|ulid\|plan of the project | `create` | `CreateFurnitureDesign` (engine `validate-furniture`; save-blocking issues → errors `document` + `code: invalid_document`) | 302 `customer.furniture.edit` (`?return_plan=` when given) |
| `customer.furniture.edit` | GET `/furniture/{design}/edit` | `@edit` | query `return_plan` | `view` | — | page `Customer/Furniture/Edit` · `FurnitureEditPageProps` (§19.1; `mode` = `customer` or `readonly`) |
| `customer.furniture.update` | PATCH `/furniture/{design}` | `@update` | `Customer\Furniture\RenameFurnitureDesignRequest`: `name` required\|string\|max:120 | `update` (locked → 423 → flash `furniture.errors.locked`) | `RenameFurnitureDesign` | back |
| `customer.furniture.destroy` | DELETE `/furniture/{design}` | `@destroy` | `Customer\Furniture\DestroyFurnitureDesignRequest`: — | `delete` (locked or referenced → 422 `design_in_order`) | `DeleteFurnitureDesign` (soft delete; placements become `plan.placement_design_missing` warnings) | 302 `customer.projects.show?tab=designs` flash `furniture.toasts.deleted` |

---

## 8. Customer orders (file `customer.php`, `CUS`)

Transition routes enforce state through the state machine (409 `invalid_transition`, §1.9). All redirects carry `flash.success` `orders.toasts.{action}` unless stated.

| Name | Method · Path | Extra MW | Controller | Request → rules | Authz (`OrderPolicy` unless stated) | Action (T#) | Response / errors |
|---|---|---|---|---|---|---|---|
| `customer.orders.index` | GET `/orders` | — | `Customer\OrderController@index` | query `filter[tab]` in:active,action,drafts,done,cancelled; `search`; `page` (12) | own | — | page `Customer/Orders/Index` · `CustomerOrdersIndexProps` (`10 §11.1`) |
| `customer.projects.orders.create` | GET `/projects/{project}/orders/create` | — | `@create` | query `designs` (comma-separated ulids) | `create` | — | page `Customer/Orders/Create` · `CustomerOrdersCreateProps` (`10 §11.2`) |
| `customer.projects.orders.store` | POST `/projects/{project}/orders` | — | `@store` | `Customer\Orders\StoreOrderRequest`: `designIds` required\|array\|min:1\|max:50 (`orders.errors.no_designs`); `designIds.*` ulid\|distinct\|design of this project, not deleted | `create` | `CreateDraftOrder` (**T1**) | 302 `customer.orders.edit`; `code: design_in_active_order` (`designIds` message `orders.errors.design_in_active_order` `{name, number}`) |
| `customer.orders.edit` | GET `/orders/{order}/edit` | — | `@edit` | — (`state ≠ draft` → 302 `customer.orders.show`) | `updateDraftItems` | — | page `Customer/Orders/Draft` · `OrderDraftProps` (`10 §11.3`) |
| `customer.orders.update` | PUT `/orders/{order}` | — | `@update` | `Customer\Orders\UpdateDraftOrderRequest`: `items` required\|array\|min:1\|max:50; `items.*.id` nullable\|ulid\|item of the order; `items.*.designId` required\|ulid\|distinct\|design of the project; `items.*.quantity` required\|integer\|between:1,99; `items.*.roomLabel` nullable\|string\|max:80; `items.*.customerNotes` nullable\|string\|max:2000; `siteAddressId` nullable\|ulid\|`OwnAddress`\|prohibits:siteAddress; `siteAddress` nullable\|array + `AddressForm`; `setAsProjectAddress` required\|boolean; `needsInstallation` nullable\|boolean; `preferredDeliveryOn` nullable\|`IsoDate`\|after_or_equal:today + `workflow.min_preferred_delivery_days`; `customerNotes` nullable\|string\|max:5000 | `updateDraftItems` | `SaveDraftOrder` | back flash `orders.toasts.draft_saved` |
| `customer.orders.submit` | POST `/orders/{order}/submit` | `verified.contact` | `@submit` | `Customer\Orders\SubmitOrderRequest`: rules of `UpdateDraftOrderRequest` plus: one of `siteAddressId`/`siteAddress` required (`orders.errors.site_address_required`); `needsInstallation` required\|boolean (`orders.errors.installation_required`) | `submit` | `SaveDraftOrder` + `SubmitOrder` (**T2**; engine `validate-furniture` per design) | 302 `customer.orders.show` flash `orders.toasts.submitted` `{number}`. Errors: `items.{i}.designId` `orders.errors.design_invalid` with `code: design_invalid` and issues serialised as `items.{i}.issues` (JSON string of `Issue[]`); `orders.errors.design_in_active_order`; `orders.errors.design_deleted`; `orders.errors.no_items` |
| `customer.orders.destroy` | DELETE `/orders/{order}` | — | `@destroy` | `Customer\Orders\DeleteDraftOrderRequest`: — | `deleteDraft` (never-submitted `draft`, else 409) | `DeleteDraftOrder` | 302 `customer.orders.index` |
| `customer.orders.show` | GET `/orders/{order}` | — | `@show` | query `tab` in:overview,designs,quote,messages,documents; never-submitted draft → 302 `customer.orders.edit` | `view` | — | page `Customer/Orders/Show` · `CustomerOrderShowProps` (`10 §11.4`; `productionUpdates`, `timeline` deferred; `messages` scroll) |
| `customer.orders.cancel` | POST `/orders/{order}/cancel` | — | `@cancel` | `Customer\Orders\CancelDraftOrderRequest`: `note` nullable\|string\|max:2000 | `cancelDraft` | `CancelDraftOrder` (**T3**) | 302 `customer.orders.show` |
| `customer.orders.withdraw` | POST `/orders/{order}/withdraw` | — | `@withdraw` | `Customer\Orders\WithdrawOrderRequest`: `note` nullable\|string\|max:2000 | `withdraw` | `WithdrawOrder` (**T29**) | 302 `customer.orders.show` |
| `customer.orders.reopen` | POST `/orders/{order}/reopen` | — | `@reopen` | `Customer\Orders\ReopenOrderRequest`: — | `reopen` | `ReopenOrder` (**T5**) | 302 `customer.orders.edit` |
| `customer.orders.proposals.show` | GET `/orders/{order}/proposals/{proposal}` | — | `Customer\ChangeProposalController@show` | — (draft → 404) | `ChangeProposalPolicy::view` | — | page `Customer/Orders/ProposalReview` · `ProposalReviewProps` (`10 §11.5`) |
| `customer.orders.proposals.resolve` | POST `/orders/{order}/proposals/{proposal}/resolve` | — | `@resolve` | `Customer\Orders\ResolveChangeProposalRequest`: `decisions` required\|array\|min:1; `decisions.*.itemId` required\|ulid\|distinct\|item of the proposal; `decisions.*.decision` required\|in:approved,rejected; `decisions.*.comment` required_if:decisions.*.decision,rejected\|nullable\|string\|max:1000 (`proposals.errors.comment_required`); `comment` nullable\|string\|max:2000; every proposal item decided (`proposals.errors.undecided`) | `ChangeProposalPolicy::decide` | `ResolveChangeProposal` (**T7**) | 302 `customer.orders.show`; 409 `proposal_not_open` → flash `proposals.errors.not_open` |
| `customer.orders.quotes.show` | GET `/orders/{order}/quotes/{quote}` | — | `Customer\QuoteController@show` | — (draft → 404) | `QuotePolicy::view` | — | page `Customer/Orders/Quote` · `CustomerQuotePageProps` (`10 §11.6`) |
| `customer.orders.quotes.accept` | POST `/orders/{order}/quotes/{quote}/accept` | — | `@accept` | `Customer\Orders\AcceptQuoteRequest`: `acceptTerms` required\|accepted | `QuotePolicy::accept` | `AcceptQuote` (**T10**; stores `accepted_by_ip`) | 302 `customer.orders.show`; 409 `quote_expired` / `quote_not_current` → flash `quotes.errors.expired` / `quotes.errors.not_current` |
| `customer.orders.quotes.negotiate` | POST `/orders/{order}/quotes/{quote}/negotiate` | — | `@negotiate` | `Customer\Orders\NegotiateQuoteRequest`: `message` required\|string\|max:2000; `proposedTotalMinor` nullable\|integer\|min:1\|lt:quote.total_minor (`quotes.errors.target_range`); `itemComments` nullable\|array; `itemComments.*.orderItemId` required\|ulid\|distinct\|item of the order; `itemComments.*.comment` required\|string\|max:500 | `QuotePolicy::negotiate` | `OpenQuoteNegotiation` (**T11**) | 302 `customer.orders.show`; 409 `negotiation_limit` / `negotiation_disabled` → flash `quotes.errors.negotiation_limit` / `negotiation_disabled` |
| `customer.orders.quotes.decline` | POST `/orders/{order}/quotes/{quote}/decline` | — | `@decline` | `Customer\Orders\DeclineQuoteRequest`: `reason` required\|string\|max:2000 | `QuotePolicy::decline` | `DeclineQuote` (**T14**) | 302 `customer.orders.show` |
| `customer.orders.quotes.pdf` | GET `/orders/{order}/quotes/{quote}/pdf` | — | `@pdf` | — | `QuotePolicy::downloadPdf` | — | 302 signed URL (`Quote-{number}.pdf`, attachment); 404 `pdf_not_ready` while rendering (page `Error` 404 for non-XHR) |
| `customer.orders.completion` | GET `/orders/{order}/completion` | — | `Customer\CompletionController@show` | — (states `completed`, `rework`, `ready_for_delivery`, `delivered`, `closed`; else 302 `customer.orders.show`) | `view` | — | page `Customer/Orders/CompletionReview` · `CompletionReviewProps` (`10 §11.8`) |
| `customer.orders.completion.approve` | POST `/orders/{order}/completion/approve` | — | `@approve` | `Customer\Orders\ApproveCompletionRequest`: — | `approveCompletion` | `ApproveCompletion` (**T21**) | 302 `customer.orders.show` |
| `customer.orders.issues.store` | POST `/orders/{order}/issues` | — | `Customer\OrderIssueController@store` | `Customer\Orders\ReportIssuesRequest`: `issues` required\|array\|min:1\|max:5; `issues.*.description` required\|string\|max:2000 (`issues.errors.description_required`); `issues.*.orderItemId` nullable\|ulid\|item of the order; `issues.*.uploadIds` array\|max:10; `issues.*.uploadIds.*` ulid\|distinct\|`UploadIntentRef(issue_photo, order)` | `reportIssue` | `ReportCompletionIssues` (**T22**) | 302 `customer.orders.show` |
| `customer.orders.messages.store` | POST `/orders/{order}/messages` | `verified.contact`, `throttle:messages-post` | `Customer\OrderMessageController@store` | `Customer\Orders\PostOrderMessageRequest`: `body` nullable\|string\|max:5000\|required_without_all:uploadIds,template (`messages.errors.empty`); `uploadIds` array\|max:5; `uploadIds.*` ulid\|distinct\|`UploadIntentRef(message_attachment, order)`; `template` nullable\|in:callback_request; `callbackAt` required_if:template,callback_request\|date\|after:now + 1 hour | `MessagePolicy::create` (422 `thread_closed`) | `PostMessage` (template renders `messages.templates.callback_request`) | back (client reloads `only: ['messages', 'unreadMessages']`) |
| `customer.orders.messages.update` | PATCH `/orders/{order}/messages/{message}` | — | `@update` | `Customer\Orders\UpdateOrderMessageRequest`: `body` required\|string\|max:5000; message older than 10 min → `code: edit_window` (`messages.errors.edit_window`) | `MessagePolicy::update` | `EditMessage` | back |
| `customer.orders.messages.read` | POST `/orders/{order}/messages/read` | — | `@read` | `Customer\Orders\MarkThreadReadRequest`: `lastMessageId` required\|ulid\|message of the order visible to the user | `MessagePolicy::viewThread` | `MarkThreadRead` | 204 (XHR) |

---

## 9. Customer account (file `customer.php`, `CUS0`)

| Name | Method · Path | Extra MW | Controller | Request → rules | Action | Response |
|---|---|---|---|---|---|---|
| `customer.account.profile` | GET `/account/profile` | — | `Customer\Account\ProfileController@show` | — | — | page `Customer/Account/Profile` · `AccountProfileProps {user: AuthUserData, marketingOptIn, otpChannels: ('whatsapp'\|'sms')[]}` |
| `customer.account.avatar.update` | PUT `/account/avatar` | — | `Customer\Account\AvatarController@update` | `Account\UpdateAvatarRequest`: `uploadId` present\|nullable\|ulid\|`UploadIntentRef(avatar, null)` | `UpdateAvatar` (null removes) | back flash `account.toasts.avatar_updated` |
| `customer.account.security` | GET `/account/security` | — | `Customer\Account\SecurityController@show` | — | — | page `Customer/Account/Security` · `AccountSecurityProps {hasPassword, googleLinked, googleEnabled, sessions: SessionData[]}` |
| `customer.account.preferences` | GET `/account/preferences` | — | `Customer\Account\PreferencesController@show` | — | — | page `Customer/Account/Preferences` · `AccountPreferencesProps {unitSystem, lengthUnit, timezone, timezones: string[]}` |
| `customer.account.preferences.update` | PUT `/account/preferences` | — | `@update` | `Account\UpdateDisplayPreferencesRequest`: `unitSystem` required\|in:metric,imperial; `lengthUnit` required\|`LengthUnitForSystem`; `timezone` required\|timezone:all | `UpdateDisplayPreferences` | back flash `account.toasts.preferences_saved` |
| `customer.account.notifications` | GET `/account/notifications` | — | `Customer\Account\NotificationPreferencesController@show` | — | — | page `Customer/Account/Notifications` · `PreferencesPageProps` (`12 §10.2`) |
| `customer.account.notifications.update` | PUT `/account/notifications` | — | `@update` | `UpdateNotificationPreferencesRequest` (`12 §10.2`): `preferences` required\|array\|max:500; `preferences.*.eventKey` required\|string\|non-transactional catalogue key whose rules include the user's audience; `preferences.*.channel` required\|in:mail,whatsapp,sms,webpush\|offered for that event; `preferences.*.enabled` required\|boolean; locked cell → `code: preference_locked` | `UpdatePreferences` | back flash `notifications.prefs.saved` |
| `customer.account.notifications.reset` | DELETE `/account/notifications` | — | `@reset` | `Account\ResetNotificationPreferencesRequest`: — | `ResetNotificationPreferences` | back |
| `customer.account.notifications.test-push` | POST `/account/notifications/test-push` | `throttle:test-push` | `@testPush` | `Account\SendTestPushRequest`: user has ≥ 1 push subscription (`code: push_not_subscribed`) | `SendTestPush` (event `system.test_push`) | back flash `notifications.push.test_sent` |
| `customer.account.ai-credits` | GET `/account/ai-credits` | — | `Customer\AiCreditsController` | query `page` (20) | — | page `Customer/Account/AiCredits` · `CustomerAiCreditsProps {credits: CreditSummaryData, entries: Paginated<CustomerLedgerEntryData>}` (reservation rows hidden, `18 §15.1`) |
| `customer.account.delete` | GET `/account` | `recent.auth` | `Customer\Account\DeletionController@show` | — | — | page `Customer/Account/Delete` · `AccountDeleteProps {activeOrders: {id, number}[], canExport: boolean}` |
| `customer.account.destroy` | DELETE `/account` | `recent.auth` | `@destroy` | `Account\RequestAccountDeletionRequest`: `confirmation` required\|in:`__('account.delete_word')` (case-insensitive; `account.errors.confirmation`); Active orders → `code: active_orders` (`account.errors.active_orders` with numbers) | `RequestAccountDeletion` | logout, `Inertia::clearHistory()`, 302 `account.deletion-scheduled` |
| `customer.account.export` | GET `/account/export` | `recent.auth`, `verified.contact`, `throttle:data-export` | `Customer\Account\DataExportController` | — | `ExportUserData` | 200 streamed `application/json`, `Content-Disposition: attachment; filename="{app-slug}-export-{Y-m-d}.json"` (`13 §9.3`) |

---
## 10. Admin: dashboard & orders (file `admin.php`, `ADM`)

Permission middleware is listed as `perm:x` (= `permission:x`); `gate:x` = `can:x`. Policies add state/ownership checks; transitions return 409 `invalid_transition` (flash `orders.errors.invalid_transition`). Unless stated, actions redirect back with `flash.success` `admin.orders.toasts.{action}`; the client reloads only the affected props.

### 10.1 Pages

| Name | Method · Path | MW | Controller | Query | Response |
|---|---|---|---|---|---|
| `admin.dashboard` | GET `/admin` | any staff | `Admin\DashboardController` | — | page `Admin/Dashboard` · `AdminDashboardProps` (`11 §5.1`; widgets null/absent without permission; `attention`, `toCall`, `charts`, `aiSpend` deferred) |
| `admin.orders.index` | GET `/admin/orders` | `perm:orders.view` | `Admin\OrderController@index` | `view` in:board,list; `queue` in:to_call,needs_attention,mine,unassigned; `search`; `filter[state]` (comma list of `OrderStateKey`); `filter[assignee]` (ulid\|me\|none); `filter[production_assignee]`; `filter[date_field]` in:submitted_at,created_at,updated_at,expected_delivery_on; `filter[from]`, `filter[to]`; `filter[include_closed]` 1; `sort` in:number,submitted_at,updated_at,state_changed_at,quote_total,expected_delivery_on (± prefix, default `-state_changed_at`); `page`, `per_page` | page `Admin/Orders/Index` · `AdminOrdersIndexProps` (`11 §5.2`) |
| `admin.orders.show` | GET `/admin/orders/{order}` | `perm:orders.view` | `@show` | `tab` in:overview,items,proposals,quotes,production,messages,calls,activity | page `Admin/Orders/Show` · `AdminOrderShowProps` (`11 §5.3`; cost fields only with `quotes.view_costs`) |
| `admin.orders.items.show` | GET `/admin/orders/{order}/items/{item}` | `perm:orders.view` | `Admin\OrderItemController@show` | `tab` in:model,cut_list,edge_banding,hardware,sheets,costs,issues,revisions; `revision` (ulid of a revision of the item's design; default pinned) | page `Admin/Orders/ItemDesign` · `ItemDesignProps` (`11 §5.6`; `price` only with `quotes.view_costs`) |
| `admin.orders.proposals.preview` | GET `/admin/orders/{order}/proposals/{proposal}/preview` | `perm:orders.propose_changes` | `Admin\ChangeProposalController@preview` | — (engine `diff-furniture` per item, server-side) | page `Admin/Orders/ProposalPreview` · `ProposalPreviewProps {order, proposal: ChangeProposalData, droppedItems: string[]}` |
| `admin.orders.proposals.items.edit` | GET `/admin/orders/{order}/proposals/{proposal}/items/{proposalItem}/edit` | `perm:orders.propose_changes` | `Admin\ChangeProposalItemController@edit` | — (non-draft proposal → read-only builder banner) | page `Admin/Orders/ProposalItemEdit` · `ProposalItemEditProps` = `FurnitureEditPageProps` (mode `proposal`, `workingDocument = staff_draft_document ?? from_revision.document`, `workingVersion = staff_draft_version`) & `{order, proposal, proposalItem, otherItems}` (`11 §5.10`) |
| `admin.orders.quotes.edit` | GET `/admin/orders/{order}/quotes/{quote}/edit` | `perm:quotes.create` | `Admin\QuoteController@edit` | — (non-draft → 302 `admin.orders.show?tab=quotes`) | page `Admin/Orders/QuoteBuilder` · `QuoteBuilderProps` (`11 §5.9`) |

### 10.2 Order actions

| Name | Method · Path | MW | Controller | Request → rules | Policy | Action (T#) | Response / errors |
|---|---|---|---|---|---|---|---|
| `admin.orders.bulk-assign` | POST `/admin/orders/bulk-assign` | `perm:orders.assign` | `Admin\OrderController@bulkAssign` | `Admin\Orders\BulkAssignOrdersRequest`: `orderIds` required\|array\|min:1\|max:100; `orderIds.*` ulid\|distinct\|exists:orders,id (Active only); `assignedTo` present\|nullable\|ulid\|`StaffWithPermission(orders.review)` | `assign` per order | `AssignOrders` (one `order.assigned` per changed order) | back flash `admin.orders.toasts.assigned` `{count}` |
| `admin.orders.assign` | POST `/admin/orders/{order}/assign` | `perm:orders.assign` | `@assign` | `Admin\Orders\AssignOrderRequest`: `assignedTo` sometimes\|nullable\|ulid\|`StaffWithPermission(orders.review)`; `productionAssigneeId` sometimes\|nullable\|ulid\|`StaffWithPermission(production.manage)`; at least one present | `assign` | `AssignOrder` | back |
| `admin.orders.start-review` | POST `/admin/orders/{order}/start-review` | `perm:orders.review` | `Admin\OrderTransitionController@startReview` | `Admin\Orders\StartReviewRequest`: — | `review` | `StartReview` (**T4**) | back |
| `admin.orders.items.update` | PATCH `/admin/orders/{order}/items/{item}` | `perm:orders.review` | `Admin\OrderItemController@update` | `Admin\Orders\UpdateOrderItemRequest`: `quantity` sometimes\|integer\|between:1,99 (only `in_review`, else 409); `staffNotes` sometimes\|nullable\|string\|max:2000 | `editItems` | `UpdateOrderItem` (`order.items_changed` + Msg on quantity change) | back |
| `admin.orders.proposals.store` | POST `/admin/orders/{order}/proposals` | `perm:orders.propose_changes` | `Admin\ChangeProposalController@store` | `Admin\Orders\CreateChangeProposalRequest`: — (state `in_review`) | `proposeChanges` | `CreateChangeProposal` (returns the existing draft if any) | 302 `admin.orders.show?tab=proposals` |
| `admin.orders.proposals.update` | PATCH `/admin/orders/{order}/proposals/{proposal}` | `perm:orders.propose_changes` | `@update` | `Admin\Orders\UpdateChangeProposalRequest`: `message` sometimes\|nullable\|string\|max:5000; `items` sometimes\|array; `items.*.id` required\|ulid\|item of the proposal; `items.*.staffNote` present\|nullable\|string\|max:2000 | `ChangeProposalPolicy::update` (draft, else 409 `proposal_not_draft`) | `UpdateChangeProposalDraft` | back |
| `admin.orders.proposals.destroy` | DELETE `/admin/orders/{order}/proposals/{proposal}` | `perm:orders.propose_changes` | `@destroy` | `Admin\Orders\DeleteChangeProposalRequest`: — | `update` (draft) | `DeleteChangeProposalDraft` | back |
| `admin.orders.proposals.items.store` | POST `/admin/orders/{order}/proposals/{proposal}/items` | `perm:orders.propose_changes` | `Admin\ChangeProposalItemController@store` | `Admin\Orders\AddChangeProposalItemRequest`: `orderItemId` required\|ulid\|item of the order with a pinned revision (returns the existing proposal item when present) | `addItem` | `AddChangeProposalItem` (`from_revision_id` = pinned revision) | 302 `admin.orders.proposals.items.edit` |
| `admin.orders.proposals.items.destroy` | DELETE `/admin/orders/{order}/proposals/{proposal}/items/{proposalItem}` | `perm:orders.propose_changes` | `@destroy` | `Admin\Orders\RemoveChangeProposalItemRequest`: — | `removeItem` (draft) | `RemoveChangeProposalItem` | back |
| `admin.orders.proposals.send` | POST `/admin/orders/{order}/proposals/{proposal}/send` | `perm:orders.propose_changes` | `Admin\ChangeProposalController@send` | `Admin\Orders\SendChangeProposalRequest`: — | `send` | `SendChangeProposal` (**T6**; drops unchanged items, validates drafts with the engine) | 302 `admin.orders.show?tab=proposals`; `code: proposal_empty` (`proposals.errors.empty`); `code: invalid_document` with `items.{id}` messages listing engine errors |
| `admin.orders.proposals.withdraw` | POST `/admin/orders/{order}/proposals/{proposal}/withdraw` | `perm:orders.propose_changes` | `@withdraw` | `Admin\Orders\WithdrawChangeProposalRequest`: — | `withdraw` | `WithdrawChangeProposal` (**T8**) | back |
| `admin.orders.quotes.store` | POST `/admin/orders/{order}/quotes` | `perm:quotes.create` | `Admin\QuoteController@store` | `Admin\Orders\CreateQuoteRequest`: `fromQuoteId` nullable\|ulid\|quote of the order with status `sent`; `negotiationId` nullable\|ulid\|open negotiation of the order | `createQuote` (states `in_review`, `negotiating`) | `BuildQuoteDraft` / `DuplicateQuoteAsDraft` (returns an existing draft) | 302 `admin.orders.quotes.edit`; 409 `bom_not_ready` (flash `quotes.errors.bom_pending`) |
| `admin.orders.quotes.update` | PUT `/admin/orders/{order}/quotes/{quote}` | `perm:quotes.create` | `@update` | `Admin\Orders\SaveQuoteDraftRequest` (`11 §5.9.3`, `08 §6.2`): `updatedAt` required\|date (≠ stored `updated_at` → `code: version_conflict`); `validUntil` required\|`IsoDate`\|after:today\|before_or_equal:today+90 (`quotes.errors.valid_until_range`); `leadTimeDays` nullable\|integer\|between:0,365; `notesToCustomer` nullable\|string\|max:5000; `terms` required\|string\|max:20000; `internalNotes` nullable\|string\|max:5000 (ignored without `quotes.view_costs`); `lines` required\|array\|min:1\|max:200 (`quotes.errors.no_lines`; ≥ 1 non-discount line); `lines.*.id` nullable\|ulid\|line of the quote; `lines.*.orderItemId` nullable\|ulid\|item of the order; `lines.*.kind` required\|in:furniture,materials,hardware,labour,finishing,installation,delivery,discount,custom; `lines.*.description` required\|string\|max:255; `lines.*.details` nullable\|array; `lines.*.quantity` required\|`DecimalString(7,3)` (> 0, ≤ 9 999 999.999); `lines.*.unit` required\|string\|max:16; `lines.*.unitPriceMinor` required\|integer\|between:-1e12,1e12, ≥ 0 unless `discount` (`quotes.errors.price_positive`), ≤ 0 for `discount` (`quotes.errors.discount_negative`); `lines.*.taxRateId` nullable\|ulid\|active tax rate, must be null for `discount`; `lines.*.isVisibleToCustomer` required\|boolean; `lines.*.sortOrder` required\|integer\|min:0; total discount ≤ subtotal (`code: discount_exceeds_subtotal`) | `QuotePolicy::update` (draft) | `SaveQuoteDraft` (`QuoteCalculator`) | back (client reloads `only: ['quote', 'sendBlockers']`); `version_conflict` → errors `code` (dialog Reload/Overwrite; Overwrite resends with the new `updatedAt`) |
| `admin.orders.quotes.regenerate` | POST `/admin/orders/{order}/quotes/{quote}/regenerate` | `perm:quotes.create` | `@regenerate` | `Admin\Orders\RegenerateQuoteRequest`: — | `update` (draft) | `RegenerateQuoteLines` (`08 §6.1`: replaces furniture/installation/delivery lines) | back; 409 `bom_not_ready` |
| `admin.orders.quotes.preview` | GET `/admin/orders/{order}/quotes/{quote}/preview` | `perm:quotes.create` | `@preview` | — | `update` | `RenderQuotePdf` synchronously (Gotenberg, 60 s, "DRAFT" watermark) | 200 `application/pdf` inline (`Content-Disposition: inline; filename="Quote-{number}-draft.pdf"`); Gotenberg failure → 503 page |
| `admin.orders.quotes.send` | POST `/admin/orders/{order}/quotes/{quote}/send` | `perm:quotes.send` | `@send` | `Admin\Orders\SendQuoteRequest`: `validUntil` required\|`IsoDate`\|after:today\|before_or_equal:today+90; `answerMessage` required when the order is `negotiating`\|nullable\|string\|max:2000 (`quotes.errors.answer_required`) | `sendQuote` | `SendQuote` (**T9** / **T13**) | 302 `admin.orders.show?tab=quotes`; blockers → `code: quote_send_blocked` with `blockers` (comma list of `bom_pending`, `bom_failed`, `no_lines`, `below_minimum`, `proposal_sent`, `wrong_state`) |
| `admin.orders.quotes.destroy` | DELETE `/admin/orders/{order}/quotes/{quote}` | `perm:quotes.create` | `@destroy` | `Admin\Orders\DeleteQuoteDraftRequest`: — | `delete` (draft) | `DeleteQuoteDraft` | 302 `admin.orders.show?tab=quotes` |
| `admin.orders.quotes.pdf` | GET `/admin/orders/{order}/quotes/{quote}/pdf` | `perm:orders.view` | `@pdf` | — | `downloadPdf` | — | 302 signed URL; 404 `pdf_not_ready` |
| `admin.orders.negotiations.keep-price` | POST `/admin/orders/{order}/negotiations/{negotiation}/keep-price` | `perm:quotes.send` | `Admin\NegotiationController@keepPrice` | `Admin\Orders\KeepQuotePriceRequest`: `answerMessage` required\|string\|max:2000; `validUntil` nullable\|`IsoDate`\|after_or_equal:current quote `valid_until`\|before_or_equal:today+90 | `answerNegotiation` (negotiation `open`) | `KeepQuotePrice` (**T12**) | back |
| `admin.orders.calls.store` | POST `/admin/orders/{order}/calls` | `perm:orders.confirm` | `Admin\ConfirmationCallController@store` | `Admin\Orders\LogCallRequest`: `calledAt` required\|date\|before_or_equal:now+5 minutes; `phoneE164` required\|`PhoneE164`; `outcome` required\|in:confirmed,no_answer,callback_requested,wrong_number,customer_wants_changes,customer_declined; `notes` required_if:outcome,customer_wants_changes,customer_declined\|nullable\|string\|max:2000 (`calls.errors.notes_required`); `callbackAt` required_if:outcome,callback_requested\|nullable\|date\|after:now (`calls.errors.callback_future`) | `logCall` (states `accepted`, `confirmed`) | `LogConfirmationCall` (`call.no_answer`, delayed `DispatchCallbackDue`) | back |
| `admin.orders.confirm` | POST `/admin/orders/{order}/confirm` | `perm:orders.confirm` | `Admin\OrderTransitionController@confirm` | `Admin\Orders\ConfirmOrderRequest`: `expectedDeliveryOn` required\|`IsoDate`\|after_or_equal:today (`orders.errors.expected_delivery_required`); `productionAssigneeId` nullable\|ulid\|`StaffWithPermission(production.manage)`; `call` nullable\|array with `call.calledAt`, `call.phoneE164`, `call.notes` (rules of `LogCallRequest`; outcome forced `confirmed`); no confirmed call and no `call` → `code: confirmation_call_required` | `confirm` | `ConfirmOrder` (**T16**; logs the call in the same transaction) | back |
| `admin.orders.back-to-negotiation` | POST `/admin/orders/{order}/back-to-negotiation` | `perm:orders.confirm` | `@backToNegotiation` | `Admin\Orders\BackToNegotiationRequest`: `callId` required_without:call\|nullable\|ulid\|call of the order with outcome `customer_wants_changes`; `call` required_without:callId\|nullable\|array (call fields; outcome forced `customer_wants_changes`); `message` required\|string\|max:2000 | `reopenAfterCall` | `ReopenNegotiationAfterCall` (**T17**) | back |
| `admin.orders.start-production` | POST `/admin/orders/{order}/start-production` | `perm:production.manage` | `@startProduction` | `Admin\Orders\StartProductionRequest`: — | `manageProduction` | `StartProduction` (**T19**) | back |
| `admin.orders.production-updates.store` | POST `/admin/orders/{order}/production-updates` | `perm:production.manage` | `Admin\ProductionUpdateController@store` | `Admin\Orders\PostProductionUpdateRequest`: `stage` required\|in:configured stage keys (not `completed`); `progress` required\|integer\|min:(lastVisibleProgress when `visibility = customer`, else 0)\|max:99 (`production.errors.progress_min` / `progress_max`); `title` required\|string\|max:160; `body` nullable\|string\|max:5000; `visibility` required\|in:customer,internal; `uploadIds` array\|max:20; `uploadIds.*` ulid\|distinct\|`UploadIntentRef(production_photo, order)` | `manageProduction` (states `confirmed`, `in_production`, `rework`) | `PostProductionUpdate` | back |
| `admin.orders.complete` | POST `/admin/orders/{order}/complete` | `perm:production.manage` | `Admin\OrderTransitionController@complete` | `Admin\Orders\CompleteOrderRequest`: `title` required\|string\|max:160; `body` nullable\|string\|max:5000; `uploadIds` array\|min:`workflow.require_completion_photos`\|max:20 (`production.errors.completion_photos`); `uploadIds.*` as above; open/in-progress issues (rework) → `code: open_issues` | `manageProduction` | `CompleteOrder` (**T20**) | back |
| `admin.orders.issues.store` | POST `/admin/orders/{order}/issues` | `perm:orders.close` | `Admin\OrderIssueController@store` | `Admin\Orders\RaiseIssueRequest`: `description` required\|string\|max:2000; `orderItemId` nullable\|ulid\|item of the order; `uploadIds` array\|max:10; `uploadIds.*` `UploadIntentRef(issue_photo, order)` | `raiseIssueOnBehalf` | `RaiseIssueOnBehalf` (**T31**) | back |
| `admin.orders.issues.update` | PATCH `/admin/orders/{order}/issues/{issue}` | `perm:production.manage` | `@update` | `Admin\Orders\UpdateOrderIssueRequest`: `status` required\|in:in_progress,resolved,rejected; `resolutionNote` required_if:status,resolved,rejected\|nullable\|string\|max:2000 (`issues.errors.note_required`) | `manageProduction` (state `rework`) | `ResolveOrderIssue` | back |
| `admin.orders.delivery.schedule` | PUT `/admin/orders/{order}/delivery` | `perm:production.manage` | `Admin\DeliveryController@schedule` | `Admin\Orders\ScheduleDeliveryRequest`: `scheduledFor` required\|date\|after_or_equal:today (business TZ); `scheduledUntil` nullable\|date\|after:scheduledFor (`delivery.errors.window`); `notes` nullable\|string\|max:2000 | `manageProduction` (state `ready_for_delivery`) | `ScheduleDelivery` | back |
| `admin.orders.deliver` | POST `/admin/orders/{order}/deliver` | `perm:production.manage` | `Admin\OrderTransitionController@deliver` | `Admin\Orders\RecordDeliveryRequest`: `deliveredAt` required\|date\|before_or_equal:now (`delivery.errors.future`); `installed` required\|boolean; `recipientName` nullable\|string\|max:120; `notes` nullable\|string\|max:2000; `uploadIds` array\|max:20; `uploadIds.*` `UploadIntentRef(delivery_photo, order)` | `manageProduction` | `RecordDelivery` (**T24**) | back |
| `admin.orders.close` | POST `/admin/orders/{order}/close` | `perm:orders.close` | `@close` | `Admin\Orders\CloseOrderRequest`: — (open issues → `code: open_issues`) | `close` | `CloseOrder` (**T25**) | back |
| `admin.orders.hold` | POST `/admin/orders/{order}/hold` | `perm:orders.hold` | `@hold` | `Admin\Orders\HoldOrderRequest`: `reason` required\|string\|max:500 (`orders.errors.hold_reason_required`) | `hold` | `HoldOrder` (**T26**) | back |
| `admin.orders.resume` | POST `/admin/orders/{order}/resume` | `perm:orders.hold` | `@resume` | `Admin\Orders\ResumeOrderRequest`: — | `resume` | `ResumeOrder` (**T27**) | back |
| `admin.orders.cancel` | POST `/admin/orders/{order}/cancel` | `perm:orders.cancel` | `@cancel` | `Admin\Orders\CancelOrderRequest`: `reason` required\|in:customer_withdrew,quote_declined,declined_on_call,unresponsive,staff_cancelled,duplicate,other (must be in the `cancelReasons` allowed now); `note` required\|string\|max:2000 (`orders.errors.cancel_note_required`); `call` nullable\|array (call fields; outcome forced `customer_declined`) | `cancel` (T18/T28) or `cancelLate` (T30, gate `orders.cancel_late` → 403) chosen by state | `CancelOrder` (dispatches **T18**/**T28**/**T30**) | back |
| `admin.orders.messages.store` | POST `/admin/orders/{order}/messages` | `perm:messages.post`, `throttle:messages-post` | `Admin\OrderMessageController@store` | `Admin\Orders\PostStaffMessageRequest`: `body` nullable\|string\|max:5000\|required_without:uploadIds; `kind` required\|in:text,internal_note; `uploadIds` array\|max:5; `uploadIds.*` `UploadIntentRef(message_attachment, order)` | `MessagePolicy::create` / `createInternalNote` (`text` on a closed thread → 422 `thread_closed`) | `PostMessage` | back |
| `admin.orders.messages.update` | PATCH `/admin/orders/{order}/messages/{message}` | `perm:messages.post` | `@update` | `Admin\Orders\UpdateStaffMessageRequest`: `body` required\|string\|max:5000; > 10 min → `code: edit_window` | `MessagePolicy::update` | `EditMessage` | back |
| `admin.orders.messages.read` | POST `/admin/orders/{order}/messages/read` | `perm:orders.view` | `@read` | `Admin\Orders\MarkThreadReadRequest`: `lastMessageId` required\|ulid\|message of the order | `MessagePolicy::viewThread` | `MarkThreadRead` | 204 |

---

## 11. Admin: furniture revisions & cut lists (file `admin.php`, `ADM`)

| Name | Method · Path | MW | Controller | Request | Action | Response / errors |
|---|---|---|---|---|---|---|
| `admin.furniture-revisions.recompute-bom` | POST `/admin/furniture-revisions/{revision}/recompute-bom` | `perm:quotes.create` | `Admin\FurnitureRevisionController@recomputeBom` | `Admin\Furniture\RecomputeBomRequest`: — (`bom_status = failed`, else 409 `bom_not_failed`) | `RecomputeRevisionBom` (re-dispatch `ComputeRevisionBom`) | back flash `admin.items.toasts.recomputing` |
| `admin.furniture-revisions.cutlist.csv` | GET `/admin/furniture-revisions/{revision}/cutlist.csv` | `perm:orders.view` | `Admin\CutListController@csv` | — (BOM not ready → 409 `bom_not_ready`) | engine CLI `cutlist-csv` | 200 `text/csv; charset=utf-8` attachment `cutlist-{slug}-r{number}.csv` (`08 §8.1`) |
| `admin.furniture-revisions.cutlist.pdf.store` | POST `/admin/furniture-revisions/{revision}/cutlist-pdf` | `perm:orders.view`, `throttle:exports` | `@storePdf` | `Admin\Furniture\RenderCutListPdfRequest`: — (BOM ready, else 409 `bom_not_ready`) | `RenderCutListPdf` (unique per revision + catalog version) | 202 `{status: 'queued'}` (JSON) |
| `admin.furniture-revisions.cutlist.pdf.show` | GET `/admin/furniture-revisions/{revision}/cutlist-pdf` | `perm:orders.view` | `@showPdf` | — | — | 302 signed URL when ready; 202 `{status: 'queued' \| 'rendering'}`; 409 `{code: 'cutlist_failed', status: 'failed'}` |

---

## 12. Admin: customers, projects, plans, furniture (file `admin.php`, `ADM`)

| Name | Method · Path | MW | Controller | Request → rules | Authz | Action | Response / errors |
|---|---|---|---|---|---|---|---|
| `admin.customers.index` | GET `/admin/customers` | `perm:customers.view` | `Admin\CustomerController@index` | query `search`; `filter[status]` in:active,deactivated,pending_deletion,all; `filter[has_active_orders]` 0/1; `filter[from]`/`filter[to]`; `sort` in:-created_at,name,-last_login_at,-active_order_count; `page`, `per_page` | — | — | page `Admin/Customers/Index` · `AdminCustomersIndexProps {customers: Paginated<AdminCustomerRowData>, filters, can: {create}}` |
| `admin.customers.store` | POST `/admin/customers` | `perm:customers.manage` | `@store` | `Admin\Customers\StoreCustomerRequest`: `name` required\|string\|min:2\|max:120; `email` nullable\|email:rfc\|max:254\|unique:users,email (incl. soft-deleted)\|required_without:phoneE164 (`customers.errors.contact_required`); `phoneE164` nullable\|`PhoneE164`\|unique:users,phone_e164\|required_without:email; `sendPasswordLink` required\|boolean (requires `email`) | `customers.manage` | `CreateCustomerByStaff` (`13 §5.1`) | 302 `admin.customers.show` |
| `admin.customers.show` | GET `/admin/customers/{user}` | `perm:customers.view` | `@show` | query `tab` in:overview,projects,orders,credits,notifications,activity (withTrashed) | — | — | page `Admin/Customers/Show` · `AdminCustomerShowProps` (`11 §6.2`) |
| `admin.customers.update` | PUT `/admin/customers/{user}` | `perm:customers.manage` | `@update` | `Admin\Customers\UpdateCustomerRequest`: `name` required\|min:2\|max:120; `email` nullable\|email:rfc\|max:254\|unique except self (incl. soft-deleted); `phoneE164` nullable\|`PhoneE164`\|unique except self; one of email/phone required; `unitSystem` required\|in:metric,imperial; `timezone` required\|timezone:all | — | `UpdateCustomerByStaff` (changed email/phone clears its verification) | back |
| `admin.customers.notes.update` | PUT `/admin/customers/{user}/notes` | `perm:customers.manage` | `@updateNotes` | `Admin\Customers\UpdateCustomerNotesRequest`: `notesInternal` present\|nullable\|string\|max:10000 | — | `UpdateCustomerNotes` | back |
| `admin.customers.deactivate` | POST `/admin/customers/{user}/deactivate` | `perm:customers.manage` | `@deactivate` | `Admin\Customers\DeactivateCustomerRequest`: `reason` required\|string\|max:500 | — | `DeactivateUser` (sessions destroyed; activity `reason`) | back |
| `admin.customers.activate` | POST `/admin/customers/{user}/activate` | `perm:customers.manage` | `@activate` | `Admin\Customers\ActivateCustomerRequest`: — | — | `ActivateUser` | back |
| `admin.customers.password-link` | POST `/admin/customers/{user}/password-link` | `perm:customers.manage` | `@passwordLink` | `Admin\Customers\SendPasswordLinkRequest`: customer has an email (else `code: no_email`) | — | `SendPasswordResetLink` (broker `users`) | back flash `admin.customers.toasts.password_link_sent` |
| `admin.customers.restore` | POST `/admin/customers/{user}/restore` | `perm:customers.manage` | `@restore` | `Admin\Customers\RestoreCustomerRequest`: soft-deleted, not anonymised, ≤ 30 days (else `code: restore_window_passed`) | — | `RestoreDeletedAccount` | back |
| `admin.customers.anonymise` | POST `/admin/customers/{user}/anonymise` | `gate:data.delete` | `@anonymise` | `Admin\Customers\AnonymiseCustomerRequest`: `confirmation` required\|in:ANONYMISE; Active orders → `code: active_orders` | owner | `AnonymiseUser` | 302 `admin.customers.index` |
| `admin.customers.projects.store` | POST `/admin/customers/{user}/projects` | `perm:customers.manage` | `Admin\CustomerProjectController@store` | `Admin\Customers\StoreCustomerProjectRequest`: `name` required\|string\|max:120; `propertyType` required\|in:`PropertyType`; `notes` nullable\|string\|max:2000 | `ProjectPolicy::create` (staff for customer) | `CreateProject` (`owner_id` = customer, `created_by` = staff) | 302 `admin.projects.show` |
| `admin.customers.ai-credits.grant` | POST `/admin/customers/{user}/ai-credits/grant` | `perm:ai.manage` | `Admin\CustomerAiCreditsController@grant` | `Admin\Ai\GrantCreditsRequest`: `amount` required\|integer\|between:1,1000; `note` required\|string\|min:3\|max:255; staff target → `code: not_a_customer` | — | `GrantCredits::admin` | back flash `credits.toasts.granted` |
| `admin.customers.ai-credits.revoke` | POST `/admin/customers/{user}/ai-credits/revoke` | `perm:ai.manage` | `@revoke` | `Admin\Ai\RevokeCreditsRequest`: `amount` required\|integer\|min:1\|≤ balance (`code: revoke_exceeds_balance`, `credits.errors.revoke_exceeds`); `note` required\|string\|min:3\|max:255 | — | `GrantCredits::revoke` | back |
| `admin.projects.show` | GET `/admin/projects/{project}` | `perm:customers.view` | `Admin\ProjectController@show` | — | `ProjectPolicy::view` | — | page `Admin/Projects/Show` · `AdminProjectShowProps` (`11 §6.3`) |
| `admin.plans.edit` | GET `/admin/plans/{plan}/edit` | `perm:customers.view` | `Admin\PlanController@edit` | query as `customer.plans.edit` (no `place`) | `PlanPolicy::view` | — | page `Admin/Plans/Edit` · `AdminPlanEditPageProps = PlanEditPageProps & {customer: {id, name}}` with `readOnlyReason` `'no_permission'\|'plan_locked'\|'archived'\|null`, `canLock` (`11 §6.4`) |
| `admin.furniture.create` | GET `/admin/furniture/create` | `perm:plans.edit_any` | `Admin\FurnitureDesignController@create` | query `project` nullable\|ulid; `customer` nullable\|ulid (picker step: the customer combobox uses `api.customers.search`, then reloads with `?customer=`) | — | — | page `Admin/Furniture/Create` · `AdminFurnitureCreateProps = Omit<FurnitureCreateProps, 'project'> & {project: {id, name, owner: {id, name}} \| null, customer: {id, name} \| null, customerProjects: ProjectRefData[]}` |
| `admin.furniture.store` | POST `/admin/furniture` | `perm:plans.edit_any` | `@store` | `Admin\Furniture\StoreFurnitureDesignRequest`: `projectId` required\|ulid\|exists:projects,id (active); `name`, `templateKey`, `presetId`, `document` as §7 | `FurnitureDesignPolicy::create` | `CreateFurnitureDesign` (`owner_id` = project owner) | 302 `admin.furniture.edit` |
| `admin.furniture.edit` | GET `/admin/furniture/{design}/edit` | `perm:customers.view` | `@edit` | — | `view` | — | page `Admin/Furniture/Edit` · `FurnitureEditPageProps` (mode `staff` when unlocked and `plans.edit_any`, else `readonly`; `customer: {id, name}` added) |
| `admin.furniture.save-as-preset` | POST `/admin/furniture/{design}/save-as-preset` | `perm:presets.manage` | `@saveAsPreset` | `Admin\Furniture\SaveAsPresetRequest`: `name` required\|string\|max:120; `category` required\|in:wardrobe,kitchen,storage,shelving,tv_unit,table,desk,bed,other; `description` nullable\|string\|max:2000; `source` required\|in:working,revision; `revisionId` required_if:source,revision\|ulid\|revision of the design; `thumbnailUploadId` nullable\|ulid\|`UploadIntentRef(preset_thumbnail, null)` | `FurnitureDesignPolicy::saveAsPreset` | `SaveAsPreset` (clears `notes`, `is_active = false`) | back flash `presets.toasts.saved` with link `admin.presets.builder` |

---

## 13. Admin: staff (file `admin.php`, `ADM`)

| Name | Method · Path | MW | Controller | Request → rules | Action | Response / errors |
|---|---|---|---|---|---|---|
| `admin.staff.index` | GET `/admin/staff` | `perm:staff.manage` | `Admin\StaffController@index` | — | — | page `Admin/Staff/Index` · `StaffIndexProps` (`11 §7`) |
| `admin.staff.invitations.store` | POST `/admin/staff/invitations` | `perm:staff.manage`, `throttle:invitations` | `Admin\StaffInvitationController@store` | `Admin\Staff\InviteStaffRequest`: `email` required\|email:rfc\|max:254; `name` required\|string\|min:2\|max:120; `role` required\|in:owner,admin,estimator,production,support (`owner` requires gate `staff.manage_owners` → 403) | `InviteStaff` | back; `code: staff.email_in_use`, `staff.invitation_pending` |
| `admin.staff.invitations.resend` | POST `/admin/staff/invitations/{invitation}/resend` | `perm:staff.manage`, `throttle:invitations` | `@resend` | `Admin\Staff\ResendInvitationRequest`: pending (not accepted/revoked) | `ResendStaffInvitation` | back |
| `admin.staff.invitations.revoke` | DELETE `/admin/staff/invitations/{invitation}` | `perm:staff.manage` | `@revoke` | `Admin\Staff\RevokeInvitationRequest`: — | `RevokeStaffInvitation` | back |
| `admin.staff.update` | PUT `/admin/staff/{user}` | `perm:staff.manage` | `Admin\StaffController@update` | `Admin\Staff\UpdateStaffRequest`: `name` required\|string\|min:2\|max:120; `role` required\|in:roles (owner changes require `staff.manage_owners`); self role change → `code: staff.errors.self`; last active owner demotion → `code: staff.last_owner` | `UpdateStaffMember` (`syncRoles`) | back |
| `admin.staff.deactivate` | POST `/admin/staff/{user}/deactivate` | `perm:staff.manage` | `@deactivate` | `Admin\Staff\DeactivateStaffRequest`: not self (`staff.errors.self`); not last owner; owners need gate | `DeactivateUser` | back |
| `admin.staff.activate` | POST `/admin/staff/{user}/activate` | `perm:staff.manage` | `@activate` | `Admin\Staff\ActivateStaffRequest`: owners need gate | `ActivateUser` | back |
| `admin.staff.two-factor.reset` | DELETE `/admin/staff/{user}/two-factor` | `perm:staff.manage` | `@resetTwoFactor` | `Admin\Staff\ResetTwoFactorRequest`: owners need gate | `ResetTwoFactor` (sessions destroyed) | back |

---
## 14. Admin: catalog (file `admin.php`, `ADM`, all `perm:catalog.manage`)

Controllers `Admin\Catalog\{Material|EdgeBand|Hardware|Finish|LabourRate|TaxRate}Controller` (`index`, `store`, `update`, `archive`, `restore`) and `Admin\Catalog\CatalogCsvController` (`export`, `import`, `show`, `commit`; table passed as route default `table`). Every write runs inside one transaction with `CatalogVersion::bump()` and sets `catalog.seed_reviewed = true` (`02 §6`, `§13`); responses redirect back with flash `catalog.toasts.saved` `{version}`. `code` is immutable (prohibited on update). `{id}` resolves `withTrashed()`.

| Table `{t}` | Index page · props | Store/update FormRequest → rules | Actions |
|---|---|---|---|
| `materials` | `Admin/Catalog/Materials` · `CatalogPageProps<MaterialRowData>` (filters `boardType`, `surface`) | `Admin\Catalog\UpsertMaterialRequest`: `code` (store) required\|string\|max:40\|regex:/^[A-Z0-9][A-Z0-9._-]*$/\|unique incl. archived (`code: catalog_code_taken`, "This code is already used."); `name` required\|string\|max:120; `boardType` required\|in:`BoardType`; `thicknessMm` required\|numeric\|between:1,100\|multiple_of:0.1; `sheetLengthMm` required\|integer\|between:300,6000; `sheetWidthMm` required\|integer\|between:300,3000; `hasGrain` required\|boolean; `decorName` nullable\|string\|max:120; `colorHex` nullable\|regex:/^#[0-9a-fA-F]{6}$/ (stored lower-case); `surface` required\|in:`Surface`; `pricePerSheetMinor` required\|integer\|min:0; `wasteFactor` required\|numeric\|between:0,0.5; `densityKgM3` nullable\|integer\|between:50,3000; `usage` required\|array\|min:1; `usage.*` distinct\|in:`MaterialRole` values,glass; `defaultEdgeBandCode` nullable\|exists:edge_bands,code; `isActive` required\|boolean; `sortOrder` required\|integer\|min:0; `textureUploadId` nullable\|ulid\|`UploadIntentRef(material_texture, null)`; `removeTexture` boolean | `UpsertMaterial`, `ArchiveCatalogItem`, `RestoreCatalogItem` |
| `edge-bands` | `Admin/Catalog/EdgeBands` · `CatalogPageProps<EdgeBandRowData>` | `UpsertEdgeBandRequest`: `code` (as above); `name` required\|max:120; `thicknessMm` required\|numeric\|between:0.1,5\|multiple_of:0.01; `widthMm` required\|integer\|between:10,100; `colorHex` nullable\|hex; `pricePerMeterMinor` required\|integer\|min:0; `isActive` required\|boolean | `UpsertEdgeBand`, archive/restore |
| `hardware` | `Admin/Catalog/Hardware` · `CatalogPageProps<HardwareRowData>` (filter `category`) | `UpsertHardwareItemRequest`: `code`; `name` required\|max:160; `category` required\|in:`HardwareCategory`; `unit` required\|in:piece,pair,set,meter,pack; `priceMinor` required\|integer\|min:0; `specs` required\|array (validated against the category schema of `08 §2.3` → `catalog.errors.specs_json`); `isDefaultFor` present\|array; `isDefaultFor.*` distinct\|in:role keys of `07 §6.11` (`catalog.errors.default_role_unknown`); `imageUploadId` nullable\|`UploadIntentRef(hardware_image, null)`; `removeImage` boolean; `isActive` required\|boolean; `sortOrder` required\|integer\|min:0 | `UpsertHardwareItem` (moves `isDefaultFor` keys from other items), archive/restore |
| `finishes` | `Admin/Catalog/Finishes` · `CatalogPageProps<FinishRowData>` | `UpsertFinishRequest`: `code`; `name` required\|max:120; `finishType` required\|in:`FinishType`; `pricePerSqmMinor` required\|integer\|min:0; `appliesTo` required\|array\|min:1; `appliesTo.*` distinct\|in:`BoardType`; `colorHex` nullable\|hex; `textureUploadId` nullable\|`UploadIntentRef(finish_texture, null)`; `removeTexture` boolean; `isActive` required\|boolean | `UpsertFinish`, archive/restore |
| `labour-rates` | `Admin/Catalog/LabourRates` · `CatalogPageProps<LabourRateRowData>` | update only — `UpdateLabourRateRequest`: `name` required\|max:120; `rateMinor` required\|integer\|min:0; `isActive` required\|boolean (`key`, `unit` read-only) | `UpdateLabourRate` |
| `tax-rates` | `Admin/Catalog/TaxRates` · `CatalogPageProps<TaxRateRowData>` | `UpsertTaxRateRequest`: `name` required\|string\|max:60\|unique except self; `rateBps` required\|integer\|between:0,10000; `isDefault` required\|boolean (turning off the current default → `catalog.errors.default_required` "Choose another default first."); `isActive` required\|boolean (default cannot be inactive) | `UpsertTaxRate` (setting default unsets the previous one) |

Routes (for every `{t}` above; `store`, `archive`, `restore` only where the table allows, see registry `19 §8.5`):

| Name pattern | Method · Path | Request | Response |
|---|---|---|---|
| `admin.catalog.{t}.index` | GET `/admin/catalog/{t}` | query `search`, `filter[status]` in:active,hidden,archived,all (archived only for the four soft-deletable tables), table filters, `sort`, `page`, `per_page` (50) | page per table above |
| `admin.catalog.{t}.store` | POST `/admin/catalog/{t}` (not labour-rates) | table request | back |
| `admin.catalog.{t}.update` | PUT `/admin/catalog/{t}/{id}` | table request (`code` prohibited) | back |
| `admin.catalog.{t}.archive` / `.restore` | POST `/admin/catalog/{t}/{id}/archive`, `/restore` (materials, edge-bands, hardware, finishes) | `Admin\Catalog\ArchiveCatalogItemRequest` / `RestoreCatalogItemRequest`: — | back |
| `admin.catalog.{t}.export` | GET `/admin/catalog/{t}/export` | — | 200 `text/csv` attachment `{t}-{Y-m-d}.csv` (columns `11 §8.3`) |
| `admin.catalog.{t}.import` | POST `/admin/catalog/{t}/import` | `Admin\Catalog\ImportCatalogCsvRequest`: `file` required\|file\|mimetypes:text/csv,text/plain,application/csv\|max:2048 (≤ 5000 rows) | `ParseCatalogCsv` (token cached 30 min, user-scoped) → 302 `admin.catalog.imports.show` |
| `admin.catalog.imports.show` | GET `/admin/catalog/imports/{token}` | — (expired/foreign token → 404 page "This preview expired. Upload the file again.") | page `Admin/Catalog/ImportPreview` · `CatalogImportPreviewProps` (`11 §8.3`) |
| `admin.catalog.imports.commit` | POST `/admin/catalog/imports/{token}` | `Admin\Catalog\CommitCatalogImportRequest`: preview has 0 errors | `CommitCatalogImport` (one transaction, one version bump) → 302 `admin.catalog.{table}.index` flash `catalog.toasts.imported` `{created, updated}` |

Explicit list (route registration order: `export` and `import` are registered **before** `{id}` routes so `/export` never binds as an id): `admin.catalog.materials.index` GET `/admin/catalog/materials` → `Admin\Catalog\MaterialController@index`; `admin.catalog.materials.store` POST `/admin/catalog/materials` → `Admin\Catalog\MaterialController@store`; `admin.catalog.materials.update` PUT `/admin/catalog/materials/{id}` → `Admin\Catalog\MaterialController@update`; `admin.catalog.materials.archive` POST `/admin/catalog/materials/{id}/archive` → `Admin\Catalog\MaterialController@archive`; `admin.catalog.materials.restore` POST `/admin/catalog/materials/{id}/restore` → `Admin\Catalog\MaterialController@restore`; `admin.catalog.materials.export` GET `/admin/catalog/materials/export` → `Admin\Catalog\CatalogCsvController@export`; `admin.catalog.materials.import` POST `/admin/catalog/materials/import` → `Admin\Catalog\CatalogCsvController@import`; `admin.catalog.edge-bands.index` GET `/admin/catalog/edge-bands` → `Admin\Catalog\EdgeBandController@index`; `admin.catalog.edge-bands.store` POST `/admin/catalog/edge-bands` → `Admin\Catalog\EdgeBandController@store`; `admin.catalog.edge-bands.update` PUT `/admin/catalog/edge-bands/{id}` → `Admin\Catalog\EdgeBandController@update`; `admin.catalog.edge-bands.archive` POST `/admin/catalog/edge-bands/{id}/archive` → `Admin\Catalog\EdgeBandController@archive`; `admin.catalog.edge-bands.restore` POST `/admin/catalog/edge-bands/{id}/restore` → `Admin\Catalog\EdgeBandController@restore`; `admin.catalog.edge-bands.export` GET `/admin/catalog/edge-bands/export` → `Admin\Catalog\CatalogCsvController@export`; `admin.catalog.edge-bands.import` POST `/admin/catalog/edge-bands/import` → `Admin\Catalog\CatalogCsvController@import`; `admin.catalog.hardware.index` GET `/admin/catalog/hardware` → `Admin\Catalog\HardwareController@index`; `admin.catalog.hardware.store` POST `/admin/catalog/hardware` → `Admin\Catalog\HardwareController@store`; `admin.catalog.hardware.update` PUT `/admin/catalog/hardware/{id}` → `Admin\Catalog\HardwareController@update`; `admin.catalog.hardware.archive` POST `/admin/catalog/hardware/{id}/archive` → `Admin\Catalog\HardwareController@archive`; `admin.catalog.hardware.restore` POST `/admin/catalog/hardware/{id}/restore` → `Admin\Catalog\HardwareController@restore`; `admin.catalog.hardware.export` GET `/admin/catalog/hardware/export` → `Admin\Catalog\CatalogCsvController@export`; `admin.catalog.hardware.import` POST `/admin/catalog/hardware/import` → `Admin\Catalog\CatalogCsvController@import`; `admin.catalog.finishes.index` GET `/admin/catalog/finishes` → `Admin\Catalog\FinishController@index`; `admin.catalog.finishes.store` POST `/admin/catalog/finishes` → `Admin\Catalog\FinishController@store`; `admin.catalog.finishes.update` PUT `/admin/catalog/finishes/{id}` → `Admin\Catalog\FinishController@update`; `admin.catalog.finishes.archive` POST `/admin/catalog/finishes/{id}/archive` → `Admin\Catalog\FinishController@archive`; `admin.catalog.finishes.restore` POST `/admin/catalog/finishes/{id}/restore` → `Admin\Catalog\FinishController@restore`; `admin.catalog.finishes.export` GET `/admin/catalog/finishes/export` → `Admin\Catalog\CatalogCsvController@export`; `admin.catalog.finishes.import` POST `/admin/catalog/finishes/import` → `Admin\Catalog\CatalogCsvController@import`; `admin.catalog.labour-rates.index` GET `/admin/catalog/labour-rates` → `Admin\Catalog\LabourRateController@index`; `admin.catalog.labour-rates.update` PUT `/admin/catalog/labour-rates/{id}` → `Admin\Catalog\LabourRateController@update`; `admin.catalog.labour-rates.export` GET `/admin/catalog/labour-rates/export` → `Admin\Catalog\CatalogCsvController@export`; `admin.catalog.labour-rates.import` POST `/admin/catalog/labour-rates/import` → `Admin\Catalog\CatalogCsvController@import`; `admin.catalog.tax-rates.index` GET `/admin/catalog/tax-rates` → `Admin\Catalog\TaxRateController@index`; `admin.catalog.tax-rates.store` POST `/admin/catalog/tax-rates` → `Admin\Catalog\TaxRateController@store`; `admin.catalog.tax-rates.update` PUT `/admin/catalog/tax-rates/{id}` → `Admin\Catalog\TaxRateController@update`; `admin.catalog.tax-rates.export` GET `/admin/catalog/tax-rates/export` → `Admin\Catalog\CatalogCsvController@export`; `admin.catalog.tax-rates.import` POST `/admin/catalog/tax-rates/import` → `Admin\Catalog\CatalogCsvController@import`. `admin.catalog.imports.show` GET `/admin/catalog/imports/{token}` → `Admin\Catalog\CatalogCsvController@show`; `admin.catalog.imports.commit` POST `/admin/catalog/imports/{token}` → `@commit`.

---

## 15. Admin: presets & templates (file `admin.php`, `ADM`)

| Name | Method · Path | MW | Controller | Request → rules | Action | Response / errors |
|---|---|---|---|---|---|---|
| `admin.presets.index` | GET `/admin/presets` | `perm:presets.manage` | `Admin\PresetController@index` | — | — | page `Admin/Presets/Index` · `AdminPresetsIndexProps {presets: AdminPresetData[], categories: {key, label}[], templates: {key, label, isEnabled}[]}` |
| `admin.presets.create` | GET `/admin/presets/create` | `perm:presets.manage` | `@create` | — | — | page `Admin/Presets/Create` · `AdminPresetsCreateProps {templates: {key, label, description, icon, isEnabled}[], categories}` |
| `admin.presets.store` | POST `/admin/presets` | `perm:presets.manage` | `@store` | `Admin\Presets\StorePresetRequest`: `name` required\|string\|max:120; `category` required\|in:preset categories (`02 §5.3`); `templateKey` required\|in:registry keys; `description` nullable\|string\|max:2000 | `CreatePreset` (engine `template-default` with the template's `default_overrides`; unique slug from name) | 302 `admin.presets.builder` |
| `admin.presets.reorder` | POST `/admin/presets/reorder` | `perm:presets.manage` | `@reorder` | `Admin\Presets\ReorderPresetsRequest`: `ids` required\|array\|min:1; `ids.*` ulid\|distinct\|exists presets, all of one category | `ReorderPresets` | back (204 for XHR) |
| `admin.presets.builder` | GET `/admin/presets/{preset}/builder` | `perm:presets.manage` | `@builder` | — | — | page `Admin/Presets/Builder` · `PresetBuilderProps {preset: AdminPresetData, document: FurnitureDocument, updatedAt, catalogVersion}` |
| `admin.presets.update` | PUT `/admin/presets/{preset}` | `perm:presets.manage` | `@update` | `Admin\Presets\UpdatePresetRequest`: `name` required\|max:120; `slug` required\|string\|max:140\|regex:/^[a-z0-9-]+$/\|unique except self; `category` required\|in; `description` nullable\|max:2000; `isActive` required\|boolean | `UpdatePreset` | back |
| `admin.presets.duplicate` | POST `/admin/presets/{preset}/duplicate` | `perm:presets.manage` | `@duplicate` | `Admin\Presets\DuplicatePresetRequest`: — | `DuplicatePreset` (`is_active = false`) | back |
| `admin.presets.destroy` | DELETE `/admin/presets/{preset}` | `perm:presets.manage` | `@destroy` | `Admin\Presets\DeletePresetRequest`: — | `DeletePreset` (soft delete) | back |
| `admin.templates.index` | GET `/admin/templates` | `perm:templates.manage` | `Admin\TemplateController@index` | — | — | page `Admin/Templates/Index` · `TemplatesIndexProps` (`11 §10`) |
| `admin.templates.reorder` | POST `/admin/templates/reorder` | `perm:templates.manage` | `@reorder` | `Admin\Templates\ReorderTemplatesRequest`: `keys` required\|array\|min:1; `keys.*` distinct\|in:registry keys | `ReorderTemplates` | back |
| `admin.templates.update` | PUT `/admin/templates/{templateKey}` | `perm:templates.manage` | `@update` | `Admin\Templates\UpdateTemplateRequest`: `isEnabled` required\|boolean; `defaultOverrides` present\|array (engine `template-default` + `validate-furniture`; errors → `code: invalid_defaults`, `templates.errors.invalid_defaults` `{issues}`) | `UpdateTemplateSettings` | back; unknown key → 404 |

---

## 16. Admin: settings (file `admin.php`, `ADM`)

Page props: `SettingsPageProps<G, M> {values: G, updatedAt: IsoDateTime \| null, updatedBy: UserRefData \| null, meta: M}` (`11 §12`; values = `02 §13` group in camelCase). Updates replace the whole group via `App\Domain\Settings\Actions\UpdateSettings` (typed group Data), write `settings.updated` activity, redirect back with flash `settings.toasts.saved`. Controllers `Admin\Settings\{Business|Units|Pricing|Workflow|Notification|Ai|Auth}SettingsController` (`show`, `update`, plus `test` where listed).

| Name | Method · Path | MW | Request → rules | Response |
|---|---|---|---|---|
| `admin.settings.business` / `admin.settings.business.update` | GET / PUT `/admin/settings/business` | `perm:settings.manage` | `UpdateBusinessSettingsRequest`: `name` required\|max:120; `legalName` nullable\|max:200; `taxId` nullable\|max:32; `email` required\|email:rfc\|max:254; `phoneE164` nullable\|`PhoneE164`; `address` nullable\|array + `AddressForm` (all-or-nothing on line1/city/countryCode); `currency` required\|in:ISO-4217 list — a change requires gate `settings.change_currency` and no quote rows (`settings.errors.currency_locked`); `locale` required\|in:en-IN,en-US,en-GB,en-AE,en-SG,en-AU; `timezone` required\|timezone:all; `logoUploadId` nullable\|`UploadIntentRef(business_logo, null)`; `removeLogo` boolean; `quoteTerms` required\|string\|max:20000; `workingHours` required\|string\|max:120 | page `Admin/Settings/Business` · `SettingsPageProps<BusinessSettingsData, BusinessSettingsMeta>` (`11 §12.1` meta) |
| `admin.settings.units` / `admin.settings.units.update` | GET / PUT `/admin/settings/units` | `perm:settings.manage` | `UpdateUnitsSettingsRequest`: `defaultSystem` required\|in:metric,imperial; `defaultLengthUnit` required\|`LengthUnitForSystem(defaultSystem)`; `defaultWallHeightMm` required\|integer\|between:2000,6000; `defaultExteriorWallThicknessMm` required\|integer\|between:50,1000; `defaultInteriorWallThicknessMm` required\|integer\|between:50,1000\|lte:defaultExteriorWallThicknessMm; `defaultDoorWidthMm` required\|integer\|between:300,6000; `defaultDoorHeightMm` required\|integer\|min:1500\|lt:defaultWallHeightMm; `defaultWindowWidthMm` required\|integer\|between:300,6000; `defaultWindowHeightMm` required\|integer\|between:300,3000; `defaultWindowSillMm` required\|integer\|between:0,3000; sill + height ≤ wall height | page `Admin/Settings/Units` · `SettingsPageProps<UnitsSettingsData, {}>` |
| `admin.settings.pricing` / `admin.settings.pricing.update` | GET / PUT `/admin/settings/pricing` | `perm:settings.manage` | `UpdatePricingSettingsRequest`: `pricesIncludeTax` required\|boolean; `defaultTaxRateId` required\|ulid\|active tax rate; `marginBps` required\|integer\|between:0,50000; `overheadBps` required\|integer\|between:0,10000; `minimumOrderMinor` required\|integer\|min:0; `roundingMinor` required\|in:1,100,500,1000,10000; `installationBps` required\|integer\|between:0,5000; `deliveryFlatMinor` required\|integer\|min:0; `kerfMm` required\|numeric\|between:0,10\|multiple_of:0.5; `sheetTrimMm` required\|integer\|between:0,50; `nestingAllowRotationDefault` required\|boolean; `sheetBillingMode` required\|in:used_area,whole_sheets; `edgePremillMm` required\|integer\|between:0,3 (`estimateDisclaimerKey` read-only) | page `Admin/Settings/Pricing` · `SettingsPageProps<PricingSettingsData, {taxRates, estimateDisclaimerPreview}>`; update bumps `catalog.version` |
| `admin.settings.workflow` / `admin.settings.workflow.update` | GET / PUT `/admin/settings/workflow` | `perm:settings.manage` | `UpdateWorkflowSettingsRequest`: `quoteValidityDays` required\|integer\|between:1,90; `autoCloseDays` required\|integer\|between:1,90; `reminderAfterHours` required\|integer\|between:12,168; `requireCompletionPhotos` required\|integer\|between:0,20; `allowCustomerCounterOffer` required\|boolean; `maxNegotiationRounds` required\|integer\|between:1,20; `minPreferredDeliveryDays` required\|integer\|between:0,90; `productionStages` required\|array\|min:1; `productionStages.*.key` required\|regex:/^[a-z][a-z0-9_]{1,31}$/\|distinct\|not_in:completed (`settings.errors.stage_key`); existing keys immutable, used keys (`usedStageKeys`) cannot be removed; `productionStages.*.labelKey` nullable\|string (built-in only); `productionStages.*.label` nullable\|string\|max:60 (required when `labelKey` null); `productionStages.*.defaultProgress` required\|integer\|between:1,99, strictly increasing | page `Admin/Settings/Workflow` · `SettingsPageProps<WorkflowSettingsData, {usedStageKeys: string[]}>` |
| `admin.settings.notifications` / `admin.settings.notifications.update` | GET / PUT `/admin/settings/notifications` | `perm:settings.manage` | `UpdateNotificationSettingsRequest`: `whatsappTemplates` present\|array (keys `event_key` or `event_key@staff` of the catalogue); `whatsappTemplates.*.name` required\|string\|max:128; `.language` required\|string\|max:16; `.components` present\|array; `.components.*.type` required\|in:body,button; body → `params` array of strings; button → `subType` in:url, `index` integer 0–2, `param` string; `smsDriver` required\|in:twilio,msg91,log; `smsTemplates` present\|array (catalogue keys incl. `auth.otp`); `smsTemplates.*.textKey` required\|string; `.dltTemplateId` nullable\|string\|max:64 (required when `smsDriver = msg91`: "DLT template ID is required for MSG91."); `.providerTemplateId` nullable\|string\|max:64 (required for msg91); `otpChannelOrder` required\|array\|min:1\|max:2; `otpChannelOrder.*` distinct\|in:whatsapp,sms; `staffDigestHour` required\|integer\|between:0,23; `quietHours.enabled` required\|boolean; `quietHours.start`, `quietHours.end` required\|date_format:H:i | page `Admin/Settings/Notifications` · `SettingsPageProps<NotificationSettingsData, NotificationSettingsMeta>` (`NotificationSettingsMeta {events: {key, label, audiences}[], templateStatus: Record<string, 'approved'\|'pending'\|'rejected'\|'missing'>, health: {whatsapp, sms}, counts30d, inboundToday, recentDeliveries: NotificationDeliveryData[]}`) |
| `admin.settings.notifications.test` | POST `/admin/settings/notifications/test` | `perm:settings.manage` | `Admin\Settings\SendTestNotificationRequest`: `channel` required\|in:mail,whatsapp,sms; `to` required\|string (email:rfc for mail, `PhoneE164` otherwise); `eventKey` nullable\|in:catalogue keys | `SendTestNotification` → back flash `settings.notifications.test_sent` / `flash.error` with the provider error |
| `admin.settings.ai` / `admin.settings.ai.update` | GET / PUT `/admin/settings/ai` | `gate:settings.manage_restricted` | `UpdateAiSettingsRequest` (`18 §15.2`): `provider` required\|in:anthropic,openai,openai_compatible,none (configured per capabilities unless `none`); `model` nullable\|string\|max:100; `effort` required\|in:low,medium,high; `agenticCrops`, `fallbackToNoneOnError`, `staffUnlimited` required\|boolean; `signupCredits`, `monthlyCredits`, `creditsPerRecognition`, `creditsPerRecognitionNone` required\|integer\|between:0,1000; `maxRecognitionsPerDay` required\|integer\|between:0,100; `globalMonthlyBudgetUsd` required\|numeric\|between:0,100000\|decimal:0,2; `budgetExhaustedBehavior` required\|in:fallback_none,block; `priceTable` present\|array; `priceTable.*.provider` required\|in providers; `.model` required\|string\|max:100; distinct (provider, model); `.inputPerMtokUsd`, `.outputPerMtokUsd` required\|numeric\|between:0,1000\|decimal:0,4 | page `Admin/Settings/Ai` · `SettingsPageProps<AiSettingsData, {capabilities: VisionCapabilitiesData, spentThisMonthUsd: number, priceMissing: boolean}>`; also activity `ai.settings_updated` |
| `admin.settings.ai.test` | POST `/admin/settings/ai/test` | `gate:settings.manage_restricted`, `throttle:ai-provider-test` | `Admin\Settings\TestAiProviderRequest`: `provider` required\|in providers; `model` nullable\|string\|max:100 | `TestAiProvider` (`VisionClient::testProvider`, `RecordUsage` feature `provider_test`) → 200 JSON `ProviderTestResultData` (`18 §5.3`); vision unreachable → 503 `service_unavailable` |
| `admin.settings.auth` / `admin.settings.auth.update` | GET / PUT `/admin/settings/auth` | `gate:settings.manage_restricted` | `UpdateAuthSettingsRequest`: `allowCustomerRegistration` required\|boolean; `otpAllowedCountryCodes` required\|array\|min:1; `otpAllowedCountryCodes.*` distinct\|size:2\|in:ISO list; `otpGlobalHourlyCap` required\|integer\|between:10,10000; `staffSessionAbsoluteHours` required\|integer\|between:1,72 | page `Admin/Settings/Auth` · `SettingsPageProps<AuthSettingsData, {captchaEnabled: boolean, otpHealth: {lowConversion: boolean} }>` |

---

## 17. Admin: AI, imports, logs, audit, system, notifications, account (file `admin.php`, `ADM`)

| Name | Method · Path | MW | Controller | Request → rules | Action | Response |
|---|---|---|---|---|---|---|
| `admin.ai.usage` | GET `/admin/ai/usage` | `perm:ai.manage` | `Admin\AiUsageController@index` | query `month` (`YYYY-MM`, default current, business TZ) | — | page `Admin/Ai/Usage` · `AdminAiUsageProps {month, months: string[], report: AiUsageReportData}` |
| `admin.ai.usage.export` | GET `/admin/ai/usage/export` | `perm:ai.manage` | `@export` | query `month` required\|date_format:Y-m | — | 200 streamed `text/csv` `ai-usage-{month}.csv` (one row per `ai_usage_events` row, USD 6 dp) |
| `admin.ai.ledger` | GET `/admin/ai/ledger` | `perm:ai.manage` | `Admin\AiLedgerController@index` | query `search`, `filter[kind]` (comma list), `filter[from]`, `filter[to]`, `page` (50) | — | page `Admin/Ai/Ledger` · `AdminAiLedgerProps {entries: Paginated<AiLedgerEntryData & {user: {id, name}}>, filters}` |
| `admin.imports.index` | GET `/admin/imports` | `perm:customers.view` | `Admin\ImportController@index` | query `filter[status]`, `filter[source_kind]`, `filter[provider]`, `filter[mode]`, `filter[from]`, `filter[to]`, `search`, `sort` in:-created_at,duration,credits_charged, `page` | — | page `Admin/Imports/Index` · `AdminImportsIndexProps {imports: Paginated<AdminImportRowData>, filters, counts: Record<ImportStatus, number>}` |
| `admin.imports.show` | GET `/admin/imports/{import}` | `perm:customers.view` | `@show` | — | — | page `Admin/Imports/Show` · `AdminImportShowProps` (`11 §14.2`) |
| `admin.imports.refund` | POST `/admin/imports/{import}/refund` | `perm:ai.manage` | `@refund` | `Admin\Ai\RefundImportCreditsRequest`: `note` required\|string\|min:3\|max:255; `credits_charged = 0` → `code: nothing_to_refund` | `RefundCredits::refundConsumption` | back flash `credits.toasts.refunded` |
| `admin.notifications-log.index` | GET `/admin/notifications-log` | `perm:customers.view` | `Admin\NotificationsLogController` | query `filter[channel]`, `filter[status]`, `filter[event]`, `filter[user]`, `filter[from]`, `filter[to]`, `search`, `page` | — | page `Admin/NotificationsLog/Index` · `NotificationsLogProps {deliveries: Paginated<NotificationDeliveryData>, filters, events: {key, label}[]}` |
| `admin.audit.index` | GET `/admin/audit` | `perm:audit.view` | `Admin\AuditController` | query `filter[causer]`, `filter[subject_type]`, `filter[subject_id]`, `filter[event]` (prefix), `filter[from]`, `filter[to]`, `search`, `page` (50) | — | page `Admin/Audit/Index` · `AuditIndexProps {entries: Paginated<AuditEntryData>, filters, subjectTypes: {value, label}[]}` |
| `admin.system.index` | GET `/admin/system` | `perm:settings.manage` | `Admin\SystemController` | — | — | page `Admin/System/Index` · `SystemIndexProps` (`11 §17`; groups deferred, each with a 4 s budget) |
| `admin.notifications.index` | GET `/admin/notifications` | any staff | `Admin\NotificationCenterController` | query `filter` in:all,unread | — | page `Admin/Notifications/Index` · `NotificationCenterProps` |
| `admin.account.profile` | GET `/admin/account/profile` | any staff | `Admin\Account\ProfileController@show` | — | — | page `Admin/Account/Profile` · `AccountProfileProps` |
| `admin.account.avatar.update` | PUT `/admin/account/avatar` | any staff | `Admin\Account\AvatarController@update` | `Account\UpdateAvatarRequest` | `UpdateAvatar` | back |
| `admin.account.security` | GET `/admin/account/security` | any staff | `Admin\Account\SecurityController@show` | — | — | page `Admin/Account/Security` · `AccountSecurityProps` |
| `admin.security.two-factor` | GET `/admin/account/two-factor` | staff (exempt from `2fa.enrolled`: route uses `ADM` minus `2fa.enrolled`) | `Admin\Account\TwoFactorController@show` | — | — | page `Admin/Account/TwoFactor` · `TwoFactorPageProps {enabled: boolean, confirmed: boolean, required: boolean, enforced: boolean}` (`enforced` = redirected by `2fa.enrolled`) |
| `admin.account.preferences` / `admin.account.preferences.update` | GET / PUT `/admin/account/preferences` | any staff | `Admin\Account\PreferencesController@show/update` | `Account\UpdateDisplayPreferencesRequest` | `UpdateDisplayPreferences` | page `Admin/Account/Preferences` · `AccountPreferencesProps` / back |
| `admin.account.notifications` / `admin.account.notifications.update` / `admin.account.notifications.reset` | GET / PUT / DELETE `/admin/account/notifications` | any staff | `Admin\Account\NotificationPreferencesController@show/update/reset` | `UpdateNotificationPreferencesRequest` / `Account\ResetNotificationPreferencesRequest` | `UpdatePreferences` / `ResetNotificationPreferences` | page `Admin/Account/Notifications` · `PreferencesPageProps` / back |
| `admin.account.notifications.test-push` | POST `/admin/account/notifications/test-push` | any staff, `throttle:test-push` | `@testPush` | `Account\SendTestPushRequest` | `SendTestPush` | back |

---
## 18. JSON API (file `api.php`) and webhooks (file `webhooks.php`)

All `API` routes use session auth + CSRF (`X-XSRF-TOKEN`), return the envelope of §1.8 on errors, and are called through `lib/http.ts`. "Policy" names the ability; non-owners of customer records get 404.

### 18.1 Uploads (`13 §11`)

| Name | Method · Path | MW | Controller | Request → rules | Policy | Action | Response / errors |
|---|---|---|---|---|---|---|---|
| `api.uploads.presign` | POST `/api/uploads/presign` | `API` with `throttle:uploads-presign` | `Api\UploadController@presign` | `Api\Uploads\PresignUploadRequest`: `purpose` required\|in:`UploadPurpose` (14 values); `filename` required\|string\|max:255; `size` required\|integer\|min:1\|≤ purpose max (blueprints: by extension, DXF 15 MB); `contentType` required\|string\|max:100\|in:purpose allowlist (blueprints: `application/octet-stream`/`text/plain` only with `.dxf`/`.heic`); `target` nullable\|array (required for purposes with a target, prohibited otherwise); `target.type` required_with:target\|in:project,order,plan,furniture_design,furniture_preset (must match the purpose); `target.id` required_with:target\|ulid | target policy per `13 §11.1` | `CreateUploadIntent` | 201 `UploadPresignData {uploadId, url, headers: Record<string, string>, expiresAt}`; 422 `validation_failed`, `unsupported_type`, `dwg_not_supported`, `file_too_large`; 403/404; 429 |
| `api.uploads.confirm` | POST `/api/uploads/{upload}/confirm` | `API` with `throttle:uploads-confirm` | `@confirm` | `Api\Uploads\ConfirmUploadRequest`: — (intent owned, `pending`, not expired, else 422 `upload_invalid`) | owner | `ConfirmUploadIntent` (HeadObject, dispatch `ProcessUpload`) | 202 `{uploadId, status: 'processing'}`; 422 `upload_size_mismatch` |
| `api.uploads.show` | GET `/api/uploads/{upload}` | `API` | `@show` | — | owner | — | 200 `UploadIntentStatusData {uploadId, status: 'pending'\|'processing'\|'ready'\|'rejected'\|'consumed'\|'expired', reasonCode: string \| null, previewUrl: string \| null, width: number \| null, height: number \| null}` (DB `uploaded` is reported as `processing`) |

### 18.2 Editor endpoints (`03 §5`, `05 §1.4`, `07 §8`, `08 §2.4`, `09 §4`, `11 §2.2`)

Autosave responses (normative `03 §5`): 200 `{version, savedAt, …}`; 409 `{code: 'version_conflict', message, currentVersion, savedBy: {id, name}, savedAt}`; 423 `{code: 'locked', message, reason: 'in_order', orderNumber}` or `{code: 'locked', message, reason: 'plan_locked', lockedBy: {id, name}, lockedAt}`; 422 `{code: 'invalid_document', message, issues: Issue[]}`.

| Name | Method · Path | MW | Controller | Request → rules | Policy | Action | Response / errors |
|---|---|---|---|---|---|---|---|
| `api.catalog.snapshot` | GET `/api/catalog/snapshot` | `API` | `Api\CatalogSnapshotController` | header `If-None-Match` | any authenticated user | `BuildCatalogSnapshot` (cached) | 200 `CatalogSnapshot` (`08 §2.1`), `ETag: "catalog-{version}"`, `Cache-Control: private, max-age=0, must-revalidate`; 304 on match |
| `api.client-errors.store` | POST `/api/client-errors` | `API` with `throttle:client-errors` | `Api\ClientErrorController@store` | `Api\ReportClientErrorRequest`: `context` required\|string\|max:64 (e.g. `plan_editor`, `furniture_builder`, `autosave`, `import_review`); `message` required\|string\|max:2000; `url` required\|string\|max:2000; `details` nullable\|array (encoded ≤ 16 KB; e.g. `planId`, `designId`, `zodIssues`, `status`, `code`) | — | `ReportClientError` (log channel `client`, Sentry when enabled; PII-redacted) | 204 |
| `api.plans.working-copy.update` | PUT `/api/plans/{plan}/working-copy` | `API` with `throttle:autosave` | `Api\PlanWorkingCopyController@update` | `Api\Plans\SavePlanWorkingCopyRequest`: `document` required\|`PlanDocumentPayload`; `baseVersion` required\|integer\|min:1 | `PlanPolicy::update` | `SavePlanWorkingCopy` (engine `validate-plan` + summary, staff_edit/auto_daily revisions) | 200 `{version, savedAt, summary: PlanSummaryJson}`; 409; 423 `plan_locked`; 422 |
| `api.plans.revisions.index` | GET `/api/plans/{plan}/revisions` | `API` | `Api\PlanRevisionController@index` | query `before` nullable\|integer\|min:1 | `PlanPolicy::view` | — | 200 `{data: PlanRevisionSummaryData[], hasMore: boolean}` (50, newest first) |
| `api.plans.revisions.store` | POST `/api/plans/{plan}/revisions` | `API` | `@store` | `Api\Plans\CreatePlanRevisionRequest`: `label` nullable\|string\|max:120 | `update` | `CreatePlanRevision` (`manual_checkpoint`) | 201 `PlanRevisionSummaryData`; 423 |
| `api.plans.revisions.show` | GET `/api/plans/{plan}/revisions/{revision}` | `API` | `@show` | — | `view` | — | 200 `PlanRevisionData {id, number, document: unknown /* migrated client-side */, schemaVersion, reason, label, createdAt}` |
| `api.plans.revisions.restore` | POST `/api/plans/{plan}/revisions/{revision}/restore` | `API` | `@restore` | `Api\Plans\RestorePlanRevisionRequest`: — | `update` | `RestorePlanRevision` (`before_restore` first) | 200 `{workingDocument, workingVersion}`; 423 |
| `api.plans.duplicate-with-document` | POST `/api/plans/{plan}/duplicate-with-document` | `API` | `Api\PlanController@duplicateWithDocument` | `Api\Plans\DuplicatePlanWithDocumentRequest`: `document` required\|`PlanDocumentPayload`; `name` required\|string\|min:1\|max:80 | `duplicate` | `DuplicatePlan` (with document; `source = duplicated`, same `level_index`) | 201 `{planId, editUrl}`; 422 `invalid_document` |
| `api.plans.thumbnail.store` | POST `/api/plans/{plan}/thumbnail` | `API` with `throttle:thumbnails` | `Api\PlanThumbnailController@store` | `Api\Plans\StorePlanThumbnailRequest`: `uploadId` required\|ulid\|`UploadIntentRef(plan_thumbnail, plan)` | `update` | `StorePlanThumbnail` | 204; 422 `upload_invalid` |
| `api.plans.lock.store` | POST `/api/plans/{plan}/lock` | `APIS`, `perm:plans.edit_any` | `Api\PlanLockController@store` | `Api\Plans\LockPlanRequest`: — | `PlanPolicy::lock` | `LockPlan` (idempotent) | 200 `PlanLockData {lockedAt, lockedBy: {id, name}}` |
| `api.plans.lock.destroy` | DELETE `/api/plans/{plan}/lock` | `APIS`, `perm:plans.edit_any` | `@destroy` | `Api\Plans\UnlockPlanRequest`: — | `unlock` | `UnlockPlan` | 204 |
| `api.projects.cover.store` | POST `/api/projects/{project}/cover` | `API` with `throttle:thumbnails` | `Api\ProjectCoverController@store` | `Api\Projects\StoreProjectCoverRequest`: `uploadId` required\|ulid\|`UploadIntentRef(project_cover, project)` | `ProjectPolicy::update` | `StoreProjectCover` | 204 |
| `api.furniture-designs.working-copy.show` | GET `/api/furniture-designs/{design}/working-copy` | `API` | `Api\FurnitureWorkingCopyController@show` | — | `FurnitureDesignPolicy::view` | — | 200 `{document: FurnitureDocument, version, updatedAt}` |
| `api.furniture-designs.working-copy.update` | PUT `/api/furniture-designs/{design}/working-copy` | `API` with `throttle:autosave` | `@update` | `Api\Furniture\SaveFurnitureWorkingCopyRequest`: `document` required\|`FurnitureDocumentPayload`; `baseVersion` required\|integer\|min:1; `estimate` nullable\|array: `estimate.totalMinor` required_with\|integer\|min:0, `.currency` size:3, `.partCount`/`.sheetCount` integer\|min:0, `.catalogVersion` integer\|min:1, `.engineVersion` string\|max:16, `.computedAt` date | `update` (locked → 423 `in_order`) | `SaveFurnitureWorkingCopy` (`validate-furniture`, SAVE_BLOCKING only; bbox + estimate denormalised) | 200 `{version, savedAt}`; 409; 423; 422 |
| `api.furniture-designs.revisions.index` | GET `/api/furniture-designs/{design}/revisions` | `API` | `Api\FurnitureDesignRevisionController@index` | query `before` | `view` | — | 200 `{data: FurnitureRevisionSummaryData[], hasMore}` |
| `api.furniture-designs.revisions.store` | POST `/api/furniture-designs/{design}/revisions` | `API` | `@store` | `Api\Furniture\CreateFurnitureRevisionRequest`: — (furniture revisions have no `label` column, `02 §5.2`; a sent `label` is ignored) | `update` | `CreateFurnitureRevision` (`manual_checkpoint`, dispatch `ComputeRevisionBom`) | 201 `FurnitureRevisionSummaryData` (`bomStatus: 'pending'`); 423 |
| `api.furniture-designs.revisions.restore` | POST `/api/furniture-designs/{design}/revisions/{revision}/restore` | `API` | `@restore` | `Api\Furniture\RestoreFurnitureRevisionRequest`: — | `update` | `RestoreFurnitureRevision` | 200 `{workingDocument, workingVersion}`; 423 |
| `api.furniture-designs.duplicate` | POST `/api/furniture-designs/{design}/duplicate` | `API` | `Api\FurnitureDesignController@duplicate` | `Api\Furniture\DuplicateFurnitureDesignRequest`: `name` nullable\|string\|max:120 (default "{name} (copy)") | `duplicate` | `DuplicateFurnitureDesign` (locked designs copy the pinned revision document, `09 §3`) | 201 `{id, editUrl}` (`customer.furniture.edit` or `admin.furniture.edit` by audience) |
| `api.furniture-designs.thumbnail.store` | POST `/api/furniture-designs/{design}/thumbnail` | `API` with `throttle:thumbnails` | `Api\FurnitureThumbnailController@store` | `Api\Furniture\StoreFurnitureThumbnailRequest`: `uploadId` required\|ulid\|`UploadIntentRef(furniture_thumbnail, design)` (sniffed PNG, exactly 800 × 600) | `update` (locked → 423) | `StoreFurnitureThumbnail` | 204; 422 `upload_invalid` |
| `api.furniture-revisions.show` | GET `/api/furniture-revisions/{revision}` | `API` | `Api\FurnitureRevisionController@show` | — | `FurnitureDesignPolicy::view` on the revision's design | — | 200 `FurnitureRevisionDocumentData {id, number, document, bomStatus, catalogVersion}` (`10 §2.3`) |
| `api.furniture-revisions.bom-status` | GET `/api/furniture-revisions/{revision}/bom-status` | `APIS`, `perm:orders.view` | `@bomStatus` | — | — | — | 200 `{bomStatus: 'pending'\|'ready'\|'failed'}` |
| `api.change-proposal-items.draft` | PUT `/api/change-proposal-items/{item}/draft` | `APIS`, `perm:orders.propose_changes`, `throttle:autosave` | `Api\ChangeProposalItemDraftController@update` (`{item}` binds `ChangeProposalItem`) | `Api\Orders\SaveProposalItemDraftRequest`: `document` required\|`FurnitureDocumentPayload`; `baseVersion` required\|integer\|min:1 | `ChangeProposalPolicy::updateItemDraft` | `SaveProposalItemDraft` (`staff_draft_document`, `staff_draft_version`) | 200 `{version, savedAt}`; 409 `version_conflict`; 409 `proposal_not_draft`; 422 |
| `api.presets.document.update` | PUT `/api/furniture-presets/{preset}/document` | `APIS`, `perm:presets.manage` | `Api\PresetDocumentController@update` | `Api\Presets\UpdatePresetDocumentRequest`: `document` required\|`FurnitureDocumentPayload`; `updatedAt` required\|date; `thumbnailUploadId` nullable\|ulid\|`UploadIntentRef(preset_thumbnail, preset)` | — | `UpdatePresetDocument` (every `error` issue blocks) | 200 `{updatedAt}`; 409 `{code: 'version_conflict', message, updatedAt, savedBy}`; 422 `invalid_document` |

### 18.3 Blueprint imports (`06 §4.3`, A1–A12; responses `ImportStatusData`)

| Name | Method · Path | MW | Controller | Request → rules | Policy | Action | Response / errors |
|---|---|---|---|---|---|---|---|
| `api.imports.store` (A1) | POST `/api/projects/{project}/imports` | `API` | `Api\ImportController@store` | `Api\Imports\StoreImportRequest`: `uploadId` required\|ulid; `mode` required\|in:auto,trace; `planId` nullable\|ulid\|plan of the project | `BlueprintImportPolicy::create` | `CreateBlueprintImport` | 201 `ImportStatusData`; 422 `upload_invalid`; 403 |
| `api.imports.show` (A3) | GET `/api/imports/{import}` | `API` | `@show` | — | `view` | — | 200 |
| `api.imports.update` (A4) | PATCH `/api/imports/{import}` | `API` | `@update` | `Api\Imports\UpdateImportOptionsRequest`: `selectedPage` sometimes\|integer\|between:1,page_count; `hints` sometimes\|array; `hints.unitSystem` nullable\|in:metric,imperial; `hints.knownDimension` nullable\|array; `hints.knownDimension.label` required_with:hints.knownDimension\|string\|max:80; `hints.knownDimension.mm` required_with:hints.knownDimension\|integer\|between:100,100000; `hints.wallHeightMm` nullable\|integer\|between:2000,6000; `hints.isPhoto` nullable\|boolean; `hints.corners` nullable\|array\|size:4; `hints.corners.*` array\|size:2; `hints.corners.*.*` numeric\|between:0,1 | `update` | `UpdateImportOptions` | 200; 409 `invalid_import_state` (not `uploaded`/`failed`) |
| `api.imports.start` (A5) | POST `/api/imports/{import}/start` | `API` with `throttle:imports-start` | `@start` | `Api\Imports\StartImportRequest`: `basic` nullable\|boolean | `update` + auto mode requires verified contact (403 `contact_unverified`) | `StartBlueprintRecognition` | 202 (`queued`); 402 `insufficient_credits`; 409 `ai_budget_exhausted`, `invalid_import_state`, `source_not_ready`; 429 `daily_limit_reached` (`resetsAt`), `too_many_active_imports`, `rate_limited` |
| `api.imports.cancel` (A6) | POST `/api/imports/{import}/cancel` | `API` | `@cancel` | `Api\Imports\CancelImportRequest`: — | `cancel` | `CancelImport` | 200; 409 |
| `api.imports.review` (A7) | GET `/api/imports/{import}/review` | `API` | `@review` | — | `update` | — | 200 `ImportReviewPayload {document: PlanDocument, reviewVersion, meta: ImportResultMeta, backgroundUrl, backgroundPreviewUrl}`; 409 unless `ready_for_review` |
| `api.imports.review-document` (A8) | PUT `/api/imports/{import}/review-document` | `API` with `throttle:autosave` | `@saveReviewDocument` | `Api\Imports\SaveImportReviewRequest`: `document` required\|`PlanDocumentPayload`; `baseVersion` required\|integer\|min:1; `review` required\|array; `review.reviewedIds` present\|array\|max:5000; `review.reviewedIds.*` string\|max:16; `review.scaleConfirmed` required\|boolean; `review.unitConfirmed` required\|boolean; `review.rescaleFactor` required\|numeric\|between:0.01,100 | `update` | `SaveImportReviewDocument` | 200 `{version, savedAt}`; 409 `version_conflict` / `invalid_import_state`; 422 `invalid_document` |
| `api.imports.accept` (A9) | POST `/api/imports/{import}/accept` | `API` | `@accept` | `Api\Imports\AcceptImportRequest`: `target` required\|array; `target.kind` required\|in:new,replace; `target.name` required_if:target.kind,new\|string\|max:80; `target.levelIndex` required_if:target.kind,new\|integer\|between:-5,50; `target.planId` required_if:target.kind,replace\|ulid (plan of the project, else 403); `keepBackground` required\|boolean; `document` required\|`PlanDocumentPayload`; `baseVersion` required\|integer\|min:1 | `accept` | `AcceptImportIntoPlan` | 200 `{planId, redirectUrl}` (customer or admin plan editor); 422 `invalid_document` (+`issues`), `scale_not_confirmed`; 409 |
| `api.imports.discard` (A10) | POST `/api/imports/{import}/discard` | `API` | `@discard` | `Api\Imports\DiscardImportRequest`: — | `discard` | `DiscardImport` | 200; 409 |
| `api.imports.rerun` (A11) | POST `/api/imports/{import}/rerun` | `API` with `throttle:imports-start` | `@rerun` | `Api\Imports\RerunImportRequest`: `useAi` required\|boolean | `rerun` (+ verified contact for customers) | `RerunBlueprintImport` | 201 new import; errors as A5 |
| `api.imports.convert-to-trace` (A12) | POST `/api/imports/{import}/convert-to-trace` | `API` | `@convertToTrace` | `Api\Imports\ConvertImportToTraceRequest`: — | `convertToTrace` | `ConvertImportToTrace` | 201 new trace import (`uploaded`); 409 |

### 18.4 Notifications, push, credits, staff utilities

| Name | Method · Path | MW | Controller | Request → rules | Action | Response |
|---|---|---|---|---|---|---|
| `api.notifications.index` | GET `/api/notifications` | `API` | `Api\NotificationController@index` | query `filter` in:all,unread (default all); `cursor` nullable\|string; `limit` integer\|between:1,50 (default 25) | — | 200 `{data: NotificationPayloadData[], nextCursor: string \| null, unreadCount: number}` |
| `api.notifications.read` | POST `/api/notifications/{id}/read` | `API` | `@read` | — (another user's notification → 404) | `MarkNotificationRead` | 200 `{unreadCount}` |
| `api.notifications.unread` | POST `/api/notifications/{id}/unread` | `API` | `@unread` | — | `MarkNotificationUnread` | 200 `{unreadCount}` |
| `api.notifications.read-all` | POST `/api/notifications/read-all` | `API` | `@readAll` | — | `MarkAllNotificationsRead` | 200 `{unreadCount: 0}` |
| `api.push-subscriptions.store` | POST `/api/push-subscriptions` | `API` | `Api\PushSubscriptionController@store` | `Api\Notifications\StorePushSubscriptionRequest`: `endpoint` required\|url\|starts_with:https://\|max:500; `keys.p256dh` required\|string\|max:255; `keys.auth` required\|string\|max:255; `contentEncoding` nullable\|in:aesgcm,aes128gcm; `features.web_push` off → 404 | `UpdatePushSubscription` (keeps the newest 10) | 204 |
| `api.push-subscriptions.destroy` | DELETE `/api/push-subscriptions` | `API` | `@destroy` | `Api\Notifications\DestroyPushSubscriptionRequest`: `endpoint` required\|url\|max:500 | `DeletePushSubscription` | 204 |
| `api.ai.credits` | GET `/api/me/ai-credits` | `API` | `Api\AiCreditsController` | — | — | 200 `CreditSummaryData` |
| `api.staff.search` | GET `/api/staff` | `APIS`, `perm:orders.view` | `Api\StaffSearchController` | query `search` nullable\|string\|max:100; `permission` nullable\|in:24 permission names | — | 200 `{data: UserRefData[]}` (active staff, ≤ 20, by name) |
| `api.customers.search` | GET `/api/customers` | `APIS`, `perm:customers.view` | `Api\CustomerSearchController` | query `search` required\|string\|min:2\|max:100 (name, email, phone digits) | — | 200 `{data: CustomerSearchResultData[]}` (≤ 20) |
| `api.system.storage-check` | POST `/api/admin/system/storage-check` | `APIS`, `perm:settings.manage` | `Api\SystemStorageCheckController` | `Api\System\StorageCheckRequest`: — | `CheckStorage` (write/read/delete `health/check-{ulid}.txt`) | 200 `{ok: boolean, durationMs: number, error?: string}` |

### 18.5 Webhooks (`12 §7.9`, `§8.1`, `13 §14`; file `webhooks.php`, `HOOK`)

| Name | Method · Path | Controller | Verification | Action | Response |
|---|---|---|---|---|---|
| `webhooks.whatsapp.verify` | GET `/webhooks/whatsapp` | `Webhooks\WhatsAppWebhookController@verify` | `hub_mode = subscribe` and `hash_equals(WHATSAPP_WEBHOOK_VERIFY_TOKEN, hub_verify_token)` | — | 200 `text/plain` = `hub_challenge`; 403 |
| `webhooks.whatsapp` | POST `/webhooks/whatsapp` | `@handle` | `X-Hub-Signature-256` HMAC over the raw body (`WHATSAPP_APP_SECRET`) | dispatch `ProcessWhatsAppWebhook` (queue `notify`) | 200 `{}` immediately; 403 + `security` log |
| `webhooks.twilio.status` | POST `/webhooks/twilio/status` | `Webhooks\TwilioStatusWebhookController` | `RequestValidator(TWILIO_AUTH_TOKEN)` on full URL + POST params | dispatch `ProcessTwilioStatus` | 204; 403 |
| `webhooks.msg91` | POST `/webhooks/msg91/{token}` | `Webhooks\Msg91WebhookController` | `hash_equals(MSG91_WEBHOOK_TOKEN, $token)` | dispatch `ProcessMsg91Report` | 200 `{}`; 403 |

All webhook jobs are idempotent and never move a delivery status backwards (`12 §7.9`).

---
## 19. Data classes registry

Every wire type is a `spatie/laravel-data` class annotated `#[TypeScript]` (generated into `resources/js/types/generated.d.ts` by `php artisan typescript:transform`, CI-checked) unless marked **engine** (zod schema + type in `resources/js/engine`, mirrored on the PHP side as `array` properties annotated `#[LiteralTypeScriptType('X')]` so generated types reference the engine type) or **page** (hand-written props interface in `resources/js/types/pages.d.ts`). Enums (`OrderStateKey`, `ImportStatus`, `UploadPurpose`, `PropertyType`, `BoardType`, …) are generated from the PHP backed enums.

### 19.1 Defined in this file (normative here)

```ts
type Ulid = string; type IsoDateTime = string; type IsoDate = string;   // as 10 §3

interface SharedProps {                                  // HandleInertiaRequests::share (01 §6)
  app: { name: string; logoUrl: string | null; version: string };
  auth: { user: AuthUserData | null };
  business: BusinessSharedData;
  features: { payments: boolean; whatsapp: boolean; sms: boolean; web_push: boolean; google_login: boolean;
              dxf_import: boolean; walkthrough_camera: boolean; captcha: boolean };
  flash: { success: string | null; error: string | null; info: string | null; warning: string | null };
  unreadNotifications?: number;                          // authenticated only
  i18n: { locale: string; hash: string };
  staffCounters?: { submitted: number; toCall: number }; // staff, Inertia::optional, cached 30 s
  healthBanners?: { key: string; messageKey: string }[]; // staff with settings.manage
  errors: Record<string, string>;                        // Inertia validation bag (+ 'code' for coded errors, §1.9)
}
interface AuthUserData {                                 // App\Domain\Identity\Data\AuthUserData
  id: Ulid; type: 'customer' | 'staff'; name: string;
  email: string | null; emailVerified: boolean; phoneE164: string | null; phoneVerified: boolean;
  avatarUrl: string | null; roles: string[]; permissions: string[]; abilities: string[];   // abilities = owner gates passed (13 §7.4)
  unitSystem: 'metric' | 'imperial'; lengthUnit: 'mm' | 'cm' | 'm' | 'ftin' | 'in';
  timezone: string; locale: string; onboarded: boolean; hasPassword: boolean; twoFactorEnabled: boolean;
}
interface BusinessSharedData {                           // App\Domain\Settings\Data\BusinessSharedData
  name: string; currency: string; locale: string; timezone: string; phoneE164: string | null; email: string;
  workingHours: string; units: { defaultSystem: 'metric' | 'imperial'; defaultLengthUnit: string }; defaultCountryCode: string;
}
interface AuthPageProps { features: SharedProps['features']; turnstileSiteKey: string | null; canRegister: boolean }
interface SessionData { id: string /* sessionKey, §1.6 */; uaSummary: string; ipMasked: string; lastActiveAt: IsoDateTime; isCurrent: boolean; method: 'password' | 'otp' | 'google' | 'remember' }
interface TemplateSummaryData {                          // App\Domain\Furniture\Data (07 §8.1)
  key: string; family: 'carcass' | 'table'; category: string; nameKey: string; descriptionKey: string;
  thumbnail: string; defaults: Record<string, unknown>;  // code defaults merged with furniture_template_settings.default_overrides
}
interface PresetSummaryData { id: Ulid; name: string; category: string; templateKey: string; thumbnailUrl: string | null; dims: { widthMm: number; heightMm: number; depthMm: number } }
interface FurnitureEditPageProps {                       // page: Customer/Furniture/Edit, Admin/Furniture/Edit, Admin/Orders/ProposalItemEdit (base)
  mode: 'customer' | 'staff' | 'proposal' | 'readonly';
  design: FurnitureDesignSummaryData & { currentRevision: { id: Ulid; number: number; bomStatus: 'pending' | 'ready' | 'failed' } | null };
  workingDocument: FurnitureDocument;                    // engine; proposal mode: staff_draft_document ?? from_revision.document
  workingVersion: number;                                // proposal mode: staff_draft_version
  project: ProjectRefData;
  returnPlan: { id: Ulid; name: string } | null;         // customer only (10 §10.3)
  plans: { id: Ulid; name: string; levelIndex: number }[];
  lockedByOrder: OrderRefData | null;
  readOnlyReason: 'in_order' | 'no_permission' | 'archived' | 'proposal_closed' | null;
  catalogVersion: number;
  can: { createRevision: boolean; duplicate: boolean; delete: boolean; saveAsPreset: boolean; exportCutList: boolean; viewCosts: boolean };
  customer?: { id: Ulid; name: string };                 // admin pages
}
interface UploadPresignData { uploadId: Ulid; url: string; headers: Record<string, string>; expiresAt: IsoDateTime }
interface UploadIntentStatusData { uploadId: Ulid; status: 'pending' | 'processing' | 'ready' | 'rejected' | 'consumed' | 'expired'; reasonCode: string | null; previewUrl: string | null; width: number | null; height: number | null }
interface PlanRevisionSummaryData { id: Ulid; number: number; reason: 'manual_checkpoint' | 'import_accepted' | 'before_restore' | 'staff_edit' | 'auto_daily'; label: string | null; author: { id: Ulid; name: string } | null; createdAt: IsoDateTime }
interface PlanRevisionData extends Omit<PlanRevisionSummaryData, 'author'> { document: unknown; schemaVersion: number }
interface PlanLockData { lockedAt: IsoDateTime; lockedBy: { id: Ulid; name: string } }
interface FurnitureRevisionSummaryData { id: Ulid; number: number; reason: 'manual_checkpoint' | 'order_submitted' | 'staff_proposal' | 'proposal_applied' | 'before_restore'; authorKind: 'customer' | 'staff'; author: { id: Ulid; name: string } | null; bomStatus: 'pending' | 'ready' | 'failed'; isCurrent: boolean; createdAt: IsoDateTime }
interface FurnitureRevisionDocumentData { id: Ulid; number: number; document: FurnitureDocument; bomStatus: 'pending' | 'ready' | 'failed'; catalogVersion: number | null }
interface ImportReviewPayload { document: PlanDocument; reviewVersion: number; meta: ImportResultMeta; backgroundUrl: string; backgroundPreviewUrl: string }   // 06 A7
interface CustomerSearchResultData { id: Ulid; name: string; email: string | null; phoneE164: string | null }
interface CustomerLedgerEntryData { id: Ulid; createdAt: IsoDateTime; kind: 'signup_grant' | 'monthly_grant' | 'admin_grant' | 'admin_revoke' | 'consumption' | 'refund'; delta: number; descriptionKey: string /* ai.ledger.{kind} */; params: Record<string, string | number>; importHref: string | null }
interface AiUsageReportData {                            // 18 §15.4 (AiUsageReportQuery::forMonth)
  totals: { costMicroUsd: number; runs: number; aiRuns: number; failedRuns: number; tests: number; inputTokens: number; outputTokens: number; images: number };
  budget: { spentUsd: number; limitUsd: number; percent: number | null; behavior: 'fallback_none' | 'block' };
  daily: { date: IsoDate; costMicroUsd: number; runs: number }[];
  byModel: { provider: string; model: string | null; runs: number; inputTokens: number; outputTokens: number; costMicroUsd: number; avgCostMicroUsd: number; avgDurationMs: number }[];
  topUsers: { user: { id: Ulid; name: string; isStaff: boolean }; runs: number; costMicroUsd: number }[];   // 20
  latestRuns: { id: Ulid; createdAt: IsoDateTime; user: { id: Ulid; name: string } | null; provider: string; model: string | null; status: 'succeeded' | 'failed'; inputTokens: number; outputTokens: number; costMicroUsd: number; durationMs: number; importHref: string | null }[];   // 50
}
interface ProviderTestResultData { ok: boolean; provider: string; model: string | null; latencyMs: number | null; visionVerified: boolean; jsonSchemaVerified: boolean; error: { code: string; message: string } | null }   // 18 §5.3 (usage recorded server-side, not returned)
interface CatalogPageProps<T> { rows: Paginated<T>; filters: { search: string | null; status: 'active' | 'hidden' | 'archived' | 'all'; sort: string; [k: string]: unknown }; options: Record<string, { value: string; label: string }[]>; catalogVersion: number }   // 11 §8.1
type CatalogRowStatus = 'active' | 'hidden' | 'archived';
interface MaterialRowData extends CatalogMaterial { status: CatalogRowStatus; updatedAt: IsoDateTime }   // CatalogMaterial etc.: 08 §2.1
interface EdgeBandRowData extends CatalogEdgeBand { status: CatalogRowStatus; updatedAt: IsoDateTime }
interface HardwareRowData extends CatalogHardware { status: CatalogRowStatus; updatedAt: IsoDateTime }
interface FinishRowData extends CatalogFinish { status: CatalogRowStatus; updatedAt: IsoDateTime }
interface LabourRateRowData extends CatalogLabourRate { updatedAt: IsoDateTime }
interface TaxRateRowData extends CatalogTaxRate { updatedAt: IsoDateTime }
interface CatalogImportPreviewProps { table: string; token: string; filename: string; summary: { create: number; update: number; unchanged: number; errors: number }; rows: { line: number; action: 'create' | 'update' | 'unchanged' | 'error'; code: string; changes: { field: string; before: string | null; after: string | null }[]; errors: string[] }[]; expiresAt: IsoDateTime }   // 11 §8.3
interface SettingsPageProps<G, M> { values: G; updatedAt: IsoDateTime | null; updatedBy: UserRefData | null; meta: M }
// Settings group Data (App\Support\Settings\Groups\*SettingsData): camelCase of 02 §13 groups —
// BusinessSettingsData, UnitsSettingsData, PricingSettingsData, WorkflowSettingsData (productionStages: {key, labelKey, label, defaultProgress}[]),
// NotificationSettingsData, AiSettingsData, AuthSettingsData. BusinessSettingsData.logoMediaId is replaced on the wire by meta.logoUrl.
interface ApiError { code: string; message: string; details?: Record<string, unknown>; [codeSpecific: string]: unknown }   // §1.8
```

### 19.2 Defined elsewhere (referenced; the owning section is normative)

| Type | PHP class (namespace `App\Domain\…\Data` unless noted) | Defined in | Used by |
|---|---|---|---|
| `UserRefData`, `AddressData`, `AddressFormData`, `MediaData` | `Identity\Data\UserRefData`, `Identity\Data\AddressData`, `Identity\Data\AddressFormData`, `Shared\Data\MediaData` | `10 §3` | everywhere |
| `ProjectSummaryData`, `ProjectData`, `ProjectRefData`, `PlanSummaryData` (+ `PlanSummaryJson`), `PlanStarterData` | `Projects\Data\*` | `10 §3`, `§8.3` | §4, §5, §12 |
| `FurnitureDesignSummaryData` (+ `FurnitureEstimateJson`), `OrderRefData` | `Furniture\Data\*`, `Orders\Data\OrderRefData` | `10 §3` | §5, §7, §8, §19.1 |
| `ActionItemData`, `CustomerOrderAction`, `OrderSummaryData`, `TimelineEntryData` | `Orders\Data\*` | `10 §3`, `§6` | customer dashboard, orders |
| `ImportSummaryData` | `Imports\Data\ImportSummaryData` | `10 §7.3` | `customer.projects.show`, `admin.projects.show` |
| `MessageData` | `Messaging\Data\MessageData` | `10 §3` | order pages (customer + staff variants) |
| `OrderItemData`, `CustomerOrderAbilities`, `OrderData`, `ChangeProposalSummaryData`, `QuoteLineData`, `QuoteNegotiationData`, `QuoteData`, `QuoteVersionData`, `ProductionUpdateData`, `OrderIssueData`, `DeliveryData`, `ChangeProposalData`, `ChangeProposalItemData` | `Orders\Data\*` | `10 §11.0`, `§11.5` | §8, staff pages |
| `AdminCustomerCardData`, `OrderBoardCardData`, `StaffOrderAbilities`, `AdminOrderData`, `AdminOrderItemData`, `ConfirmationCallData`, `AdminQuoteLineData`, `AdminQuoteData`, `QuoteCostSnapshotData`, `AdminChangeProposalItemData`, `AdminChangeProposalData`, `ProductionStageData` | `Orders\Data\Admin\*`, `Identity\Data\AdminCustomerCardData` | `11 §3` | §10–§12 |
| `DashboardChartsData` | `Orders\Data\Admin\DashboardChartsData` | `11 §5.1` | `admin.dashboard` |
| `AdminCustomerRowData`, `AiLedgerEntryData` | `Identity\Data\AdminCustomerRowData`, `Ai\Data\AiLedgerEntryData` | `11 §6.1`, `§6.2` | customers, AI ledger |
| `StaffRowData`, `StaffInvitationRowData` | `Identity\Data\*` | `11 §7` | `admin.staff.index` |
| `AdminPresetData` | `Furniture\Data\AdminPresetData` | `11 §9.1` | presets |
| `AdminImportRowData` | `Imports\Data\AdminImportRowData` | `11 §14.1` | `admin.imports.index` |
| `NotificationDeliveryData` | `App\Notifications\Data\NotificationDeliveryData` | `11 §15` | notifications log, customer detail |
| `AuditEntryData` | `Shared\Data\AuditEntryData` | `11 §16` | audit, activity tabs |
| `NotificationPayloadData` | `App\Notifications\Data\NotificationPayloadData` | `12 §4.5` | notification center, bell, broadcast |
| `PreferencesPageProps` | page (`App\Notifications\Data\PreferencesPageData` builds it) | `12 §10.2` | `*.account.notifications` |
| `CreditSummaryData` | `Ai\Data\CreditSummaryData` | `18 §9.6` | imports, dashboard, credits pages, `api.ai.credits` |
| `VisionCapabilitiesData` | `App\Support\Vision\VisionCapabilitiesData` | `18 §5.1–§5.2` | AI settings, system page |
| `RecognitionPlanData` | `Ai\Data\RecognitionPlanData` (internal, not on the wire) | `18 §8.1` | `StartBlueprintRecognition` |
| `ImportStatusData`, `ImportHints` (`ImportHintsData`) | `Imports\Data\*` | `06 §4.3` | §6, §18.3, `ImportStatusChanged` |
| `ImportResultMeta`, `ReviewState` | stored JSON; PHP `array` + literal TS type | `06 §6` | A7/A8, admin import detail |
| `PlanDocument`, `PlanGeometry`, `FurnitureDocument`, `FurnitureModel`, `Part`, `HardwareLine`, `Issue`, `Bom`, `CutListRow`, `NestingResult`, `PriceBreakdown`, `ChangeItem` | **engine** | `03 §1–§3` | editors, revisions, item viewer, proposals |
| `CatalogSnapshot`, `CatalogMaterial`, `CatalogEdgeBand`, `CatalogHardware`, `CatalogFinish`, `CatalogLabourRate`, `CatalogTaxRate`, `PricingSettings` | **engine** (PHP `BuildCatalogSnapshot` returns the array) | `08 §2.1` | `api.catalog.snapshot`, catalog pages (§19.1 row types) |
| `Paginated<T>` | page helper (`App\Support\Http\PaginatedData`) | `15 §9.29` | all lists |

### 19.3 Page props index (page component → props type)

Customer: `Welcome` → `WelcomeProps {canRegister}`; `Legal/Terms`, `Legal/Privacy` → `LegalPageProps`; `Auth/*` → §3 (`LoginProps`, `ResetPasswordProps`, `VerifyEmailProps`, `PhoneLoginProps`, `PhoneVerifyProps`, `{maskedPhone}` for `Auth/PhoneComplete`, `ReauthenticateProps`, `AcceptInvitationProps`, `InvitationInvalidProps`, `AccountDeletionScheduledProps`, `Auth/Unsubscribe` → `UnsubscribeProps {eventLabel: string, channel: 'mail', done: boolean, preferencesUrl: string}`; `Auth/ConfirmPassword`, `Auth/TwoFactorChallenge` → `AuthPageProps`); `Customer/Onboarding/Wizard` → `OnboardingProps`; `Customer/Dashboard` → `CustomerDashboardProps`; `Customer/Projects/Index|Create|Show|Edit` → `CustomerProjectsIndexProps`, `CustomerProjectsCreateProps`, `ProjectShowProps`, `CustomerProjectsEditProps`; `Customer/Plans/Edit` → `PlanEditPageProps`; `Customer/Imports/Create|Show|Review` → `ImportCreateProps`, `ImportShowProps`, `ImportReviewProps`; `Customer/Furniture/Index|Create|Edit` → `CustomerFurnitureIndexProps`, `FurnitureCreateProps`, `FurnitureEditPageProps`; `Customer/Orders/Index|Create|Draft|Show|ProposalReview|Quote|CompletionReview` → `CustomerOrdersIndexProps`, `CustomerOrdersCreateProps`, `OrderDraftProps`, `CustomerOrderShowProps`, `ProposalReviewProps`, `CustomerQuotePageProps`, `CompletionReviewProps`; `Customer/Notifications/Index` → `NotificationCenterProps`; `Customer/Account/Profile|Security|Preferences|Notifications|AiCredits|Delete` → `AccountProfileProps`, `AccountSecurityProps`, `AccountPreferencesProps`, `PreferencesPageProps`, `CustomerAiCreditsProps`, `AccountDeleteProps`; `Customer/Help` → `CustomerHelpProps`; `Error` → `ErrorPageProps {status: 403 | 404 | 419 | 429 | 500 | 503}`.

Admin: `Admin/Dashboard` → `AdminDashboardProps`; `Admin/Orders/Index|Show|ItemDesign|ProposalItemEdit|ProposalPreview|QuoteBuilder` → `AdminOrdersIndexProps`, `AdminOrderShowProps`, `ItemDesignProps`, `ProposalItemEditProps`, `ProposalPreviewProps`, `QuoteBuilderProps`; `Admin/Customers/Index|Show` → `AdminCustomersIndexProps`, `AdminCustomerShowProps`; `Admin/Projects/Show` → `AdminProjectShowProps`; `Admin/Plans/Edit` → `AdminPlanEditPageProps`; `Admin/Furniture/Create|Edit` → `AdminFurnitureCreateProps`, `FurnitureEditPageProps`; `Admin/Staff/Index` → `StaffIndexProps`; `Admin/Catalog/*` → `CatalogPageProps<…RowData>`, `Admin/Catalog/ImportPreview` → `CatalogImportPreviewProps`; `Admin/Presets/Index|Create|Builder` → `AdminPresetsIndexProps`, `AdminPresetsCreateProps`, `PresetBuilderProps`; `Admin/Templates/Index` → `TemplatesIndexProps`; `Admin/Settings/*` → `SettingsPageProps<G, M>`; `Admin/Ai/Usage|Ledger` → `AdminAiUsageProps`, `AdminAiLedgerProps`; `Admin/Imports/Index|Show` → `AdminImportsIndexProps`, `AdminImportShowProps`; `Admin/NotificationsLog/Index` → `NotificationsLogProps`; `Admin/Audit/Index` → `AuditIndexProps`; `Admin/System/Index` → `SystemIndexProps`; `Admin/Notifications/Index` → `NotificationCenterProps`; `Admin/Account/Profile|Security|TwoFactor|Preferences|Notifications` → `AccountProfileProps`, `AccountSecurityProps`, `TwoFactorPageProps`, `AccountPreferencesProps`, `PreferencesPageProps`.

Props whose shape is given in `10`/`11` (e.g. `OnboardingProps`, `ProjectShowProps`, `AdminOrderShowProps`) are normative there; props defined only by name + inline object in this file are normative here.

---

## 20. Enforcement

1. `tests/Feature/Routes/RouteRegistryTest.php` compares `php artisan route:list --json` (name, method, URI, middleware) with `tests/fixtures/routes/registry.json`, which lists every route of this file; an extra, missing or renamed route fails CI (`16 §6.3`).
2. `tests/Feature/Security/RouteCoverageTest.php` (`13 §20.1`) requires every route in the role × route authorisation dataset.
3. Every FormRequest has a unit test for its rules (`16 §6.3`); every JSON endpoint has a contract test asserting the success shape and each listed error code; every Inertia page has an `assertInertia` test of its props type keys (camelCase, no snake_case leaks, no cost fields without `quotes.view_costs`).
4. `resources/js/types/generated.d.ts` is regenerated in CI and must not differ from the committed file; the Wayfinder output (`resources/js/actions`, `resources/js/routes`, `resources/js/wayfinder`) is generated by every `yarn dev`/`yarn build`, git-ignored, and a stale or missing helper fails `vue-tsc` in CI.
