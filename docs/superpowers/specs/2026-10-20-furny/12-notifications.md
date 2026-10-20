# 12 — Notifications

Read the master document, `01`, `02`, `03` and `09` first. This file is normative for **which events notify whom, on which channels, with which content**, and for the channel implementations (in-app, email, WhatsApp, SMS, web push), preferences, throttling and quiet hours. Auth-specific flows that *use* these channels (OTP, password reset, verification) are specified in `13`; this file only defines the messages themselves.

Everything not listed in `02` that this file needs is defined in the final **Appendix: Proposed additions to other documents**.

---

## 1. Principles

1. **Notifications are never sent from controllers or Actions.** Domain events (dispatched after commit, see `01 §4`, `09 §11`) are routed by one queued listener to Notification classes. Only exceptions: the four transactional auth messages (`13`) and the staff digest (scheduler).
2. **One Notification class per event key**, sharing one abstract base class. Content is data-driven from `config/notification_events.php` + translation keys; subclasses only build parameters and optional extras (attachments).
3. **In-app (`database` + `broadcast`) is the record of truth.** Every non-transactional event that notifies a user creates exactly one in-app notification per recipient; it cannot be disabled. External channels (mail, WhatsApp, SMS, web push) are preference-controlled except where marked **locked**.
4. **All user-visible strings are translation keys** (master §6.6). Notification strings use **ICU MessageFormat** (`{param}` placeholders, `select`, `plural`) in `resources/lang/en/notifications.php`, rendered in PHP with `App\Support\I18n\Icu::trans()` (wraps `MessageFormatter`, ext-intl) and in Vue by the i18n library from `15`. Rationale: the same string is rendered server-side (mail/SMS/WhatsApp/push) and client-side (bell); one placeholder syntax avoids drift. Never use Laravel `:param` placeholders in `notifications.php`.
5. **Cost-bearing channels (WhatsApp, SMS) are used sparingly**: only "action needed" or high-value milestones default on; quiet hours delay them; throttling collapses bursts.
6. **Idempotent**: re-running the routing listener (queue retry) must not double-notify (see §4.3).

---

## 2. Channels overview

| Channel key (prefs / config) | Laravel channel used in `via()` | Implementation | Availability condition (all must hold) |
|---|---|---|---|
| `database` | `'database'` + `'broadcast'` | Laravel database notifications + Reverb broadcast on `users.{id}` | always (recipient is a `User`) |
| `mail` | `'mail'` | Laravel Mail (Markdown) via `MAIL_MAILER` | user has `email` AND (`email_verified_at` not null OR event is in `allow_unverified_email` = `account.welcome`, `auth.email_verification`, `auth.password_reset`) |
| `whatsapp` | `App\Notifications\Channels\WhatsAppChannel::class` | Meta WhatsApp Cloud API (default) or Twilio | `features.whatsapp` = true AND user has `phone_e164` with `phone_verified_at` AND a template mapping exists in setting `notifications.whatsapp_templates` under `event_key` (customers) or `event_key@staff` (staff) AND phone not flagged unreachable (§7.7) |
| `sms` | `App\Notifications\Channels\SmsChannel::class` | Driver: `twilio` \| `msg91` \| `log` | `features.sms` = true AND verified phone AND `notifications.sms_templates[event_key]` exists (for `msg91` also `provider_template_id` non-empty) AND phone country in `auth.otp_allowed_country_codes` (same SMS-pumping allowlist as `13 §4`) |
| `webpush` | `NotificationChannels\WebPush\WebPushChannel::class` | laravel-notification-channels/webpush ^13 | `features.web_push` = true AND user has ≥ 1 row in `push_subscriptions` |

The availability check is implemented once in `App\Notifications\Routing\ChannelAvailability::isAvailable(User $user, string $channel, string $eventKey): bool` and also used by the preferences UI (to grey out cells, §10).

---

## 3. Event catalogue

### 3.1 Legend

- **Audience**: `C` = customer user (`users.type = customer`), `S` = staff user. Audience selects the translation sub-key (`.customer.` / `.staff.`), CTA route family and channel defaults.
- **Channel cells**: `LOCK` = on, user cannot disable · `on` = default on, user may disable · `off` = default off, user may enable · `fb` = SMS default off but **sent as fallback** when WhatsApp was wanted (preference on) but unavailable or failed permanently (§7.6) — user may also enable it explicitly · `—` = channel not offered for this event/audience.
- **D** = database/in-app (always `LOCK` unless `—`), **M** = mail, **W** = WhatsApp, **S** = SMS, **P** = web push.
- **Q** = quiet hours apply to W/S (§6.2). **X** = `ensure_external` (if no external channel resolves, force the first available of WhatsApp, SMS — §5.3).
- **Recipient resolvers** are defined in §4.2. The **actor** of the event is always excluded unless the rule says `include_actor`.
- **CTA**: route name (defined in `14`, listed in the appendix) + route params from the event. Paths are stored **relative** in the payload.

### 3.2 Order events (keys exhaustive per `09 §11`)

| Event key | Notification class (`App\Notifications\Orders\…`) | Rule | Recipients (resolver) | Aud | D | M | W | S | P | Q/X | CTA route |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `order.submitted` | `OrderSubmitted` | 1 | `customer` (include_actor) | C | LOCK | on | — | — | off | | `customer.orders.show` |
| | | 2 | `permission:orders.review` | S | LOCK | on | off | — | on | Q | `admin.orders.show` |
| `order.assigned` | `OrderAssigned` | 1 | `assignee` (new assignee) | S | LOCK | on | off | — | on | Q | `admin.orders.show` |
| `order.review_started` | `OrderReviewStarted` | 1 | `customer` | C | LOCK | off | — | — | on | | `customer.orders.show` |
| `order.reopened` | `OrderReopened` | 1 | `assignee_or_permission:orders.review` | S | LOCK | on | — | — | on | | `admin.orders.show` |
| `order.changes_proposed` | `ChangesProposed` | 1 | `customer` | C | LOCK | on | on | fb | on | Q | `customer.orders.proposals.show` |
| `order.changes_resolved` | `ChangesResolved` | 1 | `assignee_or_permission:orders.propose_changes` | S | LOCK | on | — | — | on | | `admin.orders.show` |
| `order.changes_withdrawn` | `ChangesWithdrawn` | 1 | `customer` | C | LOCK | on | — | — | off | | `customer.orders.show` |
| `order.items_changed` | `OrderItemsChanged` | 1 | `customer` | C | LOCK | on | — | — | on | | `customer.orders.show` |
| `quote.sent` | `QuoteSent` | 1 | `customer` | C | LOCK | LOCK | on | fb | on | Q X | `customer.orders.quotes.show` |
| `quote.negotiation_opened` | `QuoteNegotiationOpened` | 1 | `assignee_or_permission:quotes.send` | S | LOCK | on | off | — | on | Q | `admin.orders.show` |
| `quote.negotiation_answered` | `QuoteNegotiationAnswered` | 1 | `customer` (external channels suppressed when `payload.status = answered_with_revision`, because `quote.sent` covers it) | C | LOCK | on | on | fb | on | Q | `customer.orders.quotes.show` |
| `quote.accepted` | `QuoteAccepted` | 1 | `customer` (include_actor) | C | LOCK | on | — | — | off | | `customer.orders.show` |
| | | 2 | `assignee_and_permission:orders.confirm` | S | LOCK | on | off | — | on | Q | `admin.orders.show` |
| `quote.declined` | `QuoteDeclined` | 1 | `assignee_or_permission:quotes.send` | S | LOCK | on | — | — | on | | `admin.orders.show` |
| `quote.expiring_soon` | `QuoteExpiringSoon` | 1 | `customer` | C | LOCK | on | on | fb | on | Q | `customer.orders.quotes.show` |
| `quote.expired` | `QuoteExpired` | 1 | `customer` | C | LOCK | on | — | — | off | | `customer.orders.show` |
| | | 2 | `assignee_or_permission:quotes.send` | S | LOCK | off | — | — | on | | `admin.orders.show` |
| `order.reopened_after_call` | `OrderReopenedAfterCall` | 1 | `customer` | C | LOCK | on | — | — | on | | `customer.orders.quotes.show` |
| `order.confirmed` | `OrderConfirmed` | 1 | `customer` | C | LOCK | LOCK | on | fb | on | Q X | `customer.orders.show` |
| | | 2 | `production_assignee_or_permission:production.manage` | S | LOCK | on | — | — | on | | `admin.orders.show` |
| `order.production_started` | `ProductionStarted` | 1 | `customer` | C | LOCK | on | on | off | on | Q | `customer.orders.show` |
| `order.production_update` | `ProductionUpdatePosted` | 1 | `customer` (only `visibility = customer` updates; 09) — **collapse 300 s** | C | LOCK | off | off | — | on | Q | `customer.orders.show` |
| `order.completed` | `OrderCompleted` | 1 | `customer` | C | LOCK | on | on | fb | on | Q | `customer.orders.completion` |
| `order.customer_approved` | `CustomerApproved` | 1 | `assignee` | S | LOCK | on | — | — | on | | `admin.orders.show` |
| | | 2 | `production_assignee_or_permission:production.manage` | S | LOCK | on | — | — | on | | `admin.orders.show` |
| `order.issue_raised` | `IssueRaised` | 1 | `customer` (only when actor is staff — T31) | C | LOCK | on | — | — | on | | `customer.orders.show` |
| | | 2 | `production_assignee_or_permission:production.manage` | S | LOCK | on | off | — | on | Q | `admin.orders.show` |
| | | 3 | `assignee` | S | LOCK | on | — | — | on | | `admin.orders.show` |
| `order.issue_resolved` | `IssueResolved` | 1 | `customer` | C | LOCK | on | — | — | on | | `customer.orders.show` |
| `order.delivery_scheduled` | `DeliveryScheduled` | 1 | `customer` | C | LOCK | on | on | fb | on | Q X | `customer.orders.show` |
| `order.delivered` | `OrderDelivered` | 1 | `customer` | C | LOCK | on | — | — | on | | `customer.orders.show` |
| `order.closed` | `OrderClosed` | 1 | `customer` | C | LOCK | on | — | — | off | | `customer.orders.show` |
| `order.cancelled` | `OrderCancelled` | 1 | `customer` | C | LOCK | LOCK | on | fb | on | Q X | `customer.orders.show` |
| | | 2 | `assignee_or_permission:orders.review` | S | LOCK | on | — | — | on | | `admin.orders.show` |
| | | 3 | `production_assignee` | S | LOCK | on | — | — | on | | `admin.orders.show` |
| `order.on_hold` | `OrderOnHold` | 1 | `customer` | C | LOCK | on | — | — | on | | `customer.orders.show` |
| | | 2 | `assignee` | S | LOCK | off | — | — | on | | `admin.orders.show` |
| `order.resumed` | `OrderResumed` | 1 | `customer` | C | LOCK | on | — | — | on | | `customer.orders.show` |
| `message.posted` | `MessagePosted` | 1 | `customer` (condition `author_is_staff`; `kind = text` only) — **collapse 300 s**, **read-suppression** | C | LOCK | on | off | — | on | Q | `customer.orders.messages` |
| | | 2 | `assignee_or_permission:orders.review` (condition `author_is_customer`) — collapse, read-suppression | S | LOCK | on | off | — | on | Q | `admin.orders.messages` |
| `call.callback_due` | `CallbackReminder` (name fixed by `09 §2`) | 1 | `call_logger` | S | LOCK | on | off | — | on | | `admin.orders.show` |
| `call.no_answer` | `CallNoAnswer` | 1 | `customer` | C | LOCK | on | on | fb | on | Q | `customer.orders.messages` |
| `reminder.action_required` | `ActionRequiredReminder` | 1 | `customer` | C | LOCK | on | on | fb | on | Q | depends on `payload.action` (§3.6) |

Rules for staff recipients of order events: a resolved staff user must hold `orders.view` (otherwise skipped) and `is_active = true`.

### 3.3 Non-order events

| Event key | Notification class | Recipients | Aud | D | M | W | S | P | Notes | CTA route |
|---|---|---|---|---|---|---|---|---|---|---|
| `import.ready_for_review` | `App\Notifications\Imports\ImportReadyForReview` | `subject_user` (uploader) | by user type | LOCK | off | — | — | on | | `customer.imports.show` (C) / `admin.imports.show` (S) |
| `import.failed` | `App\Notifications\Imports\ImportFailed` | `subject_user` | by user type | LOCK | on | — | — | on | | same |
| `ai.credits_granted` | `App\Notifications\Ai\AiCreditsGranted` | `subject_user` — fired **only** for ledger kind `admin_grant` (monthly/signup grants are predictable; notifying them is noise) | C | LOCK | on | — | — | off | | `customer.account.ai-credits` |
| `ai.credits_low` | `App\Notifications\Ai\AiCreditsLow` | `subject_user` — fired when a ledger insert moves the balance from > 0 to ≤ 0; at most once per user per calendar month (cache key `notify:ai-low:{userId}:{YYYY-MM}`, TTL 32 d) | C | LOCK | on | — | — | on | | `customer.account.ai-credits` |
| `account.welcome` | `App\Notifications\Account\Welcome` | `subject_user` (new customer) | C | LOCK | LOCK | — | — | — | bypasses preferences (no prefs exist yet) | `customer.dashboard` |
| `account.deletion_scheduled` | `App\Notifications\Account\DeletionScheduled` | `subject_user` (sent **before** soft delete, see `13 §9`) | C | — | LOCK | — | — | — | transactional; WhatsApp not used | none (support email in body) |
| `staff.invited` | `App\Notifications\Staff\StaffInvited` | on-demand `Notification::route('mail', $invitation->email)` | S | — | LOCK | — | — | — | transactional | `staff.invitations.show` (temporary signed, 72 h) |
| `staff.daily_digest` | `App\Notifications\Staff\StaffDailyDigest` | built by scheduler (§9) | S | — | on | — | — | — | not routed from a domain event; no in-app | `admin.dashboard` |
| `auth.otp` | `App\Notifications\Auth\OtpCode` | on-demand phone | — | — | — | LOCK | LOCK | — | transactional; channel order from `notifications.otp_channel_order`; bypasses preferences, quiet hours and throttles (has its own limits in `13 §4`) | none |
| `auth.password_reset` | `App\Notifications\Auth\ResetPassword` | user | — | — | LOCK | — | — | — | transactional | Fortify `password.reset` |
| `auth.email_verification` | `App\Notifications\Auth\VerifyEmail` | user | — | — | LOCK | — | — | — | transactional; temporary signed URL 60 min | Fortify `verification.verify` |

**Transactional** events (`account.welcome`, `account.deletion_scheduled`, `staff.invited`, `auth.*`) never appear in the preferences UI, have no unsubscribe link and are never collapsed. They are **not** stored in `notifications` (except `account.welcome`, which is also an in-app greeting).

### 3.4 Event payload contract

Every `NotifiableDomainEvent` (`09 §11`) exposes `eventKey()`, `order()`, `actor()`, `payload()`, and (proposed addition, see appendix) `eventId(): string` (a ULID generated in the event constructor) and `occurredAt(): CarbonImmutable`. Non-order events implement `App\Domain\Shared\Contracts\UserNotifiableEvent` with `eventId()`, `eventKey()`, `subjectUser(): User`, `subject(): ?Model`, `actor(): ?User`, `payload(): array`, `occurredAt()`.

Required `payload()` keys (all scalar or arrays of scalars; IDs are ULID strings):

| Event | Payload keys |
|---|---|
| `order.submitted` | `itemCount` |
| `order.assigned` | `assigneeId`, `previousAssigneeId` (nullable) |
| `order.changes_proposed` | `proposalId`, `itemCount` |
| `order.changes_resolved` | `proposalId`, `approved`, `rejected` |
| `order.changes_withdrawn` | `proposalId` |
| `order.items_changed` | `changes` (array of `{itemName, from, to}`) |
| `quote.sent` | `quoteId` |
| `quote.negotiation_opened` | `quoteId`, `negotiationId`, `targetTotalMinor` (nullable) |
| `quote.negotiation_answered` | `quoteId`, `negotiationId`, `status` (`answered_keep_price` \| `answered_with_revision`) |
| `quote.accepted` / `quote.declined` / `quote.expired` / `quote.expiring_soon` | `quoteId` (+ `reason` for declined) |
| `order.reopened_after_call` | `callId`, `negotiationId` |
| `order.confirmed` | `expectedDeliveryOn` (Y-m-d) |
| `order.production_started` / `order.production_update` | `productionUpdateId` |
| `order.completed` | `productionUpdateId`, `photoCount` |
| `order.issue_raised` | `issueIds` (array) |
| `order.issue_resolved` | `issueId`, `status` (`resolved` \| `rejected`) |
| `order.delivery_scheduled` | `deliveryId`, `scheduledFor` (ISO-8601) |
| `order.delivered` | `deliveryId`, `deliveredAt` |
| `order.cancelled` | `reason` (enum `orders.cancel_reason`), `note` (nullable) |
| `order.on_hold` | `reason` |
| `message.posted` | `messageId`, `authorType` (`customer` \| `staff`) |
| `call.callback_due` | `callId`, `staffId`, `callbackAt` |
| `call.no_answer` | `callId`, `calledAt` |
| `reminder.action_required` | `action` (`proposal` \| `quote` \| `completion`), `targetId` (proposal/quote id, null for completion) |
| `import.*` | `importId`, `errorCode` (failed only) |
| `ai.credits_granted` | `credits`, `balance`, `ledgerEntryId` |
| `ai.credits_low` | `balance` |

### 3.5 Notification parameters

Each Notification subclass implements `protected function params(): array<string, string|int>` returning **already formatted** strings (business locale `business.locale`, recipient timezone `users.timezone`). Parameter dictionary (use these exact names):

| Param | Value |
|---|---|
| `appName` | `config('app.name')` (always present) |
| `businessName` | settings `business.name` (always present) |
| `number` | `orders.number` |
| `customerName` | order customer `name` |
| `customerFirstName` | first whitespace-delimited token of customer name, max 30 chars |
| `staffName` | actor's `name` (staff) |
| `itemCount` | integer |
| `approved`, `rejected` | integers |
| `quoteNumber` | `quotes.number` |
| `total` | quote `total_minor` formatted with `MoneyFormatter` (e.g. `₹1,25,000.00`) |
| `totalPlain` | same amount formatted **GSM-7 safe**: ISO code + space + grouped number, e.g. `INR 1,25,000` (used in SMS; `₹` is not GSM-7) |
| `targetTotal` | formatted or empty string |
| `validUntil` | quote `valid_until` formatted `d M Y` (e.g. `05 Nov 2026`) |
| `daysLeft` | integer days until `valid_until` (business TZ) |
| `expectedDelivery` | `d M Y` |
| `stage` | translated stage label (`workflow.production_stages[].label_key`) |
| `progress` | integer 0–100 |
| `updateTitle` | `production_updates.title`, max 80 chars |
| `photoCount` | integer |
| `issueCount` | integer |
| `date` | date/time formatted `d M Y, H:i` in recipient TZ |
| `reason` | translated label `orders.cancel_reason.{value}` (cancel) or free-text reason (hold/decline) truncated to 200 chars |
| `authorName` | message author name (staff names shown to customers as full name) |
| `excerpt` | message body: Markdown stripped, whitespace collapsed, first 120 chars + `…` if truncated |
| `callbackAt` | `d M Y, H:i` |
| `businessPhone` | settings `business.phone_e164` formatted INTERNATIONAL (libphonenumber), or empty |
| `businessEmail` | settings `business.email` |
| `inviterName`, `role` | staff invitation: inviting user's name; translated role label `roles.{role}` |
| `count` | digest: number of orders listed in sections 1–4 (§9) |
| `status` | payload `status` (negotiation answered, issue resolved) passed through for ICU `select` |
| `collapsed` | `NotificationContext.collapsedCount` (0 unless a collapsed summary, §6.1) |
| `code`, `domain` | OTP only: the 6-digit code; host of `APP_URL` |
| `fileName` | sanitized original filename (13 §11), max 60 chars |
| `errorReason` | translated `imports.errors.{errorCode}` |
| `credits`, `balance` | integers |
| `resetDate` | first day of next month, `d M Y` |
| `ctaPath` | CTA path **without leading slash** for the short-link route (e.g. `o/ORD-2026-00042`) — used as WhatsApp URL-button suffix |
| `shortUrl` | absolute URL of the short link (`route('links.order', $order->number)`) — used in SMS |

WhatsApp and SMS parameter values are sanitized by `App\Notifications\Support\ExternalTextSanitizer`: newlines/tabs → space, ≥ 4 consecutive spaces collapsed to 1, trimmed, max 60 chars per variable (Meta rejects newlines/tabs/4+ spaces in params; DLT variables are max 30 chars — the SMS driver truncates to 30 for `msg91`).

### 3.6 CTA resolution

`url` = `route($cta['route'], resolvedParams, absolute: false)` + optional `#fragment`. Param source names map to event data: `orderId` → `$order->id`, `quoteId` → payload `quoteId`, `proposalId` → payload `proposalId`, `importId` → payload `importId`.

`reminder.action_required` CTA by `payload.action`: `proposal` → `customer.orders.proposals.show {order, proposal: targetId}`, `quote` → `customer.orders.quotes.show {order, quote: targetId}`, `completion` → `customer.orders.completion {order}`.

Short link route `links.order` (`GET /o/{number}`, auth required, redirects to login with intended URL when logged out): customer who owns the order → the order's "primary action" page (proposal if `changes_proposed`, quote if `quoted`, completion if `completed`, else `customer.orders.show`); staff with `orders.view` → `admin.orders.show`; anyone else → 404. Used for WhatsApp buttons and SMS so links are short and never leak IDs of other entities.

### 3.7 English strings (`resources/lang/en/notifications.php`)

Key convention: `notifications.{eventKey}.{audience}.{field}` where `field` ∈ `title`, `body`, `subject` (optional; falls back to `title`), `sms` (only for events with an SMS cell other than `—`). Preference labels: `notifications.events.{eventKey}.label` and `.description`. CTA labels: `notifications.cta.{name}`. Since event keys contain dots, the PHP file is nested (`'order' => ['submitted' => ['customer' => [...]]]`).

| Key prefix | title | body |
|---|---|---|
| `order.submitted.customer` | `Order {number} received` | `Thanks! We received your order with {itemCount, plural, one {# item} other {# items}}. Our team will review it shortly.` |
| `order.submitted.staff` | `New order {number}` | `{customerName} submitted {itemCount, plural, one {# item} other {# items}} for review.` |
| `order.assigned.staff` | `Order {number} assigned to you` | `You are now responsible for {customerName}'s order {number}.` |
| `order.review_started.customer` | `We're reviewing order {number}` | `{staffName} started reviewing your designs.` |
| `order.reopened.staff` | `Order {number} reopened` | `{customerName} reopened the order to edit their designs.` |
| `order.changes_proposed.customer` | `Please review suggested changes` | `{staffName} proposed changes to {itemCount, plural, one {# item} other {# items}} in order {number}. Approve or reject them to continue.` |
| `order.changes_resolved.staff` | `Changes reviewed on {number}` | `{customerName} approved {approved} and rejected {rejected} change(s).` |
| `order.changes_withdrawn.customer` | `Suggested changes withdrawn` | `We withdrew the suggested changes for order {number}. No action is needed.` |
| `order.items_changed.customer` | `Order {number} updated` | `{staffName} adjusted item quantities in your order. See the order for details.` |
| `quote.sent.customer` | `Your quote {quoteNumber} is ready` | `Total {total}, valid until {validUntil}. Review it to accept, negotiate or decline.` |
| `quote.negotiation_opened.staff` | `Counter-offer on {quoteNumber}` | `{customerName} responded to the quote{targetTotal, select, other { (target {targetTotal})} empty {}}.` (the class passes `targetTotal = 'empty'` when null) |
| `quote.negotiation_answered.customer` | `We replied to your counter-offer` | `{status, select, answered_keep_price {We reviewed your response on quote {quoteNumber}. Please see our reply.} other {We sent you a revised quote.}}` |
| `quote.accepted.customer` | `Quote {quoteNumber} accepted` | `Thank you! We'll call you shortly to confirm the details of order {number}.` |
| `quote.accepted.staff` | `Quote {quoteNumber} accepted` | `{customerName} accepted {total}. Please call to confirm.` |
| `quote.declined.staff` | `Quote {quoteNumber} declined` | `{customerName} declined the quote: {reason}` |
| `quote.expiring_soon.customer` | `Your quote expires in {daysLeft, plural, one {# day} other {# days}}` | `Quote {quoteNumber} ({total}) is valid until {validUntil}.` |
| `quote.expired.customer` | `Quote {quoteNumber} expired` | `We're preparing an updated quote for order {number}.` |
| `quote.expired.staff` | `Quote {quoteNumber} expired` | `Order {number} is back in review and needs a new quote.` |
| `order.reopened_after_call.customer` | `Let's revisit your quote` | `Following our call, we reopened negotiation on order {number}.` |
| `order.confirmed.customer` | `Order {number} confirmed` | `Your order is confirmed. Expected delivery: {expectedDelivery}.` |
| `order.confirmed.staff` | `Order {number} confirmed` | `Ready for production. Expected delivery {expectedDelivery}.` |
| `order.production_started.customer` | `Production has started` | `Work on order {number} has begun: {stage}.` |
| `order.production_update.customer` | `Progress on order {number}: {progress}%` | `{stage}: {updateTitle}` |
| `order.completed.customer` | `Your furniture is ready — please check` | `Order {number} is complete. Look at the {photoCount, plural, one {photo} other {# photos}} and confirm everything looks right.` |
| `order.customer_approved.staff` | `{number} approved by customer` | `{customerName} approved the completed work. Ready for delivery.` |
| `order.issue_raised.customer` | `Issue recorded on order {number}` | `We recorded an issue on your behalf and will fix it.` |
| `order.issue_raised.staff` | `Issue reported on {number}` | `{issueCount, plural, one {# issue} other {# issues}} reported by {customerName}.` |
| `order.issue_resolved.customer` | `Issue update on order {number}` | `{status, select, resolved {We resolved an issue you reported.} other {We reviewed an issue you reported. Please see our note.}}` |
| `order.delivery_scheduled.customer` | `Delivery scheduled` | `Order {number} will be delivered on {date}.` |
| `order.delivered.customer` | `Order {number} delivered` | `Delivered on {date}. Thank you for choosing {businessName}!` |
| `order.closed.customer` | `Order {number} closed` | `This order is now closed. Your designs are unlocked for new projects.` |
| `order.cancelled.customer` | `Order {number} cancelled` | `Your order was cancelled. Reason: {reason}.` |
| `order.cancelled.staff` | `Order {number} cancelled` | `Reason: {reason}.` |
| `order.on_hold.customer` | `Order {number} on hold` | `Your order is on hold: {reason}` |
| `order.on_hold.staff` | `Order {number} on hold` | `Reason: {reason}` |
| `order.resumed.customer` | `Order {number} resumed` | `Work on your order has resumed.` |
| `message.posted.customer` | `New message from {authorName}` | `{collapsed, plural, =0 {{excerpt}} other {{excerpt} (+# more)}}` |
| `message.posted.staff` | `{customerName} wrote on {number}` | same pattern as customer |
| `call.callback_due.staff` | `Call back {customerName}` | `Callback requested for {callbackAt} (order {number}).` |
| `call.no_answer.customer` | `We tried to call you` | `We tried to reach you on {date} about order {number}. Reply in the app or request a call back.` |
| `reminder.action_required.customer` | `Action needed on order {number}` | `{action, select, proposal {Suggested changes are waiting for your review.} quote {Your quote is waiting for your decision.} other {Please check the completion photos of your furniture.}}` |
| `import.ready_for_review.customer` / `.staff` | `Your plan is ready to review` | `We finished reading {fileName}. Check and correct the result.` |
| `import.failed.customer` / `.staff` | `We couldn't read your blueprint` | `{fileName}: {errorReason} Your AI credit was refunded.` |
| `ai.credits_granted.customer` | `You received {credits} AI credits` | `Your balance is now {balance}.` |
| `ai.credits_low.customer` | `You've used all your AI credits` | `New credits arrive on {resetDate}. You can still draw or trace your plan manually.` |
| `account.welcome.customer` | `Welcome to {appName}` | `Start by uploading your floor plan or drawing it yourself.` |
| `account.deletion_scheduled.customer` (mail only) | `Your account will be deleted` | `We received a request to delete your account. It will be permanently anonymised on {date}. If this wasn't you, contact us at {businessEmail} immediately.` |
| `staff.invited.staff` (mail only) | `You're invited to {appName}` | `{inviterName} invited you to join as {role}. The link expires on {date}.` |
| `staff.daily_digest.staff` (mail only) | `{count} order(s) need attention` | (structured, see §9) |

SMS strings (`notifications.{event}.customer.sms`, ≤ 160 GSM-7 characters after substitution with realistic values; **no `₹`, no curly quotes, no em dashes**):

| Event | SMS text | Ordered DLT vars (`vars`) |
|---|---|---|
| `order.changes_proposed` | `{appName}: We suggested changes to your order {number}. Please review and approve: {shortUrl}` | `appName, number, shortUrl` |
| `quote.sent` | `{appName}: Quote {quoteNumber} for {totalPlain} is ready, valid till {validUntil}. View: {shortUrl}` | `appName, quoteNumber, totalPlain, validUntil, shortUrl` |
| `quote.negotiation_answered` | `{appName}: We replied to your counter-offer on quote {quoteNumber}. View: {shortUrl}` | `appName, quoteNumber, shortUrl` |
| `quote.expiring_soon` | `{appName}: Your quote {quoteNumber} expires on {validUntil}. Review it: {shortUrl}` | `appName, quoteNumber, validUntil, shortUrl` |
| `order.confirmed` | `{appName}: Order {number} is confirmed. Expected delivery {expectedDelivery}. Details: {shortUrl}` | `appName, number, expectedDelivery, shortUrl` |
| `order.production_started` | `{appName}: Production of order {number} has started. Track it: {shortUrl}` | `appName, number, shortUrl` |
| `order.completed` | `{appName}: Your order {number} is complete. Please check the photos and confirm: {shortUrl}` | `appName, number, shortUrl` |
| `order.delivery_scheduled` | `{appName}: Delivery of order {number} is scheduled for {date}. Details: {shortUrl}` | `appName, number, date, shortUrl` |
| `order.cancelled` | `{appName}: Order {number} has been cancelled. Details: {shortUrl}` | `appName, number, shortUrl` |
| `call.no_answer` | `{appName}: We tried to call you about order {number}. Please reply in the app: {shortUrl}` | `appName, number, shortUrl` |
| `reminder.action_required` | `{appName}: Order {number} needs your action. Open: {shortUrl}` | `appName, number, shortUrl` |
| `auth.otp` (key `notifications.auth.otp.sms`) | `{code} is your {appName} verification code. It expires in 10 minutes. Do not share it.\n\n@{domain} #{code}` | `code, appName, domain, code` |

The last line of the OTP SMS is the **WebOTP / SMS Retriever** origin-bound format (`@host #code`, `domain` = host of `APP_URL`) so supporting browsers can auto-fill (`13 §4.4`).

`appName` used in SMS must be ≤ 20 characters (validated in `config/app.php` boot check `App\Providers\AppServiceProvider::boot` → logs a warning if longer; SMS then uses `businessName` truncated to 20).

---

## 4. Routing architecture

### 4.1 Classes and files

```
config/notification_events.php                         Catalogue (§5)
app/Domain/Shared/Contracts/NotifiableDomainEvent.php   (09) + eventId(), occurredAt()
app/Domain/Shared/Contracts/UserNotifiableEvent.php     non-order events
app/Notifications/
  EventNotification.php                                 abstract base (ShouldQueue)
  Data/NotificationPayloadData.php                      in-app payload DTO (spatie Data → TS)
  Data/NotificationContext.php                          serializable context passed to notifications
  Routing/RouteDomainEventToNotifications.php           queued listener (queue notify)
  Routing/RecipientResolver.php                         resolvers (§4.2)
  Routing/NotificationPlanner.php                       per-recipient channel planning (§5.2)
  Routing/ChannelAvailability.php
  Routing/PreferenceRepository.php                      reads notification_preferences (+ request cache)
  Routing/Throttle.php                                  collapse windows (§6.1)
  Routing/QuietHours.php                                (§6.2)
  Routing/EventCatalogue.php                            typed accessor over config/notification_events.php
  Orders/*.php  Imports/*.php  Ai/*.php  Account/*.php  Staff/*.php  Auth/*.php
  Channels/WhatsAppChannel.php  Channels/WhatsApp/{WhatsAppClient.php, MetaCloudClient.php, TwilioWhatsAppClient.php, FakeWhatsAppClient.php, WhatsAppMessage.php, WhatsAppSendException.php}
  Channels/SmsChannel.php  Channels/Sms/{SmsDriver.php, SmsManager.php, TwilioSmsDriver.php, Msg91SmsDriver.php, LogSmsDriver.php, ArraySmsDriver.php, SmsMessage.php, SmsSendException.php}
  Jobs/FlushCollapsedNotifications.php  Jobs/SendSmsFallback.php
  Support/ExternalTextSanitizer.php
app/Models/NotificationDelivery.php
app/Http/Controllers/Webhooks/{WhatsAppWebhookController.php, TwilioWebhookController.php, Msg91WebhookController.php}
app/Http/Controllers/Api/NotificationController.php
app/Http/Controllers/Customer/Account/NotificationPreferencesController.php
app/Http/Controllers/Admin/Account/NotificationPreferencesController.php
app/Http/Controllers/NotificationUnsubscribeController.php
app/Console/Commands/{SendStaffDigest.php, PruneNotifications.php}
resources/views/mail/notification.blade.php            generic markdown template
resources/views/mail/staff-digest.blade.php
resources/views/vendor/mail/**                          published + branded components
public/sw.js  public/manifest.webmanifest  public/icons/{notification-192.png, badge-72.png, icon-512.png}
resources/js/lib/push.ts  resources/js/components/notifications/{NotificationBell.vue, NotificationList.vue, NotificationItem.vue, PushOptIn.vue, PreferencesMatrix.vue}
resources/js/composables/{useNotifications.ts, usePushSubscription.ts}
resources/js/pages/Customer/Account/Notifications.vue  resources/js/pages/Admin/Account/Notifications.vue
resources/js/pages/Customer/Notifications/Index.vue    resources/js/pages/Admin/Notifications/Index.vue
```

### 4.2 Recipient resolvers (`RecipientResolver::resolve(string $resolver, EventEnvelope $e): Collection<User>`)

| Resolver | Returns |
|---|---|
| `customer` | `$order->customer` |
| `assignee` | `$order->assignee` (for `order.assigned`: `User::find(payload.assigneeId)`) |
| `production_assignee` | `$order->productionAssignee` |
| `permission:{perm}` | `User::query()->where('type','staff')->where('is_active',true)->permission($perm)->get()` (spatie scope; includes via roles) |
| `assignee_or_permission:{perm}` | assignee if non-null and active, else `permission:{perm}` |
| `assignee_and_permission:{perm}` | union of assignee and `permission:{perm}` (deduplicated) |
| `production_assignee_or_permission:{perm}` | production assignee if set and active, else `permission:{perm}` |
| `call_logger` | `User::find(payload.staffId)` |
| `subject_user` | `$event->subjectUser()` |

Rule `condition` values (evaluated before resolving): `author_is_staff` (payload `authorType = staff`), `author_is_customer`, `actor_is_staff` (actor non-null and `type = staff`), `actor_is_customer`. Rule 1 of `order.issue_raised` has condition `actor_is_staff`.

Exclusions applied after resolving, in order: users with `deleted_at` not null; `is_active = false`; the actor unless the rule has `include_actor: true`; staff without `orders.view` for order events; users already notified by an earlier rule of the same event (first matching rule wins — its audience and channel config apply).

### 4.3 `RouteDomainEventToNotifications` listener

`final class RouteDomainEventToNotifications implements ShouldQueue` with `public string $queue = 'notify'; public int $tries = 5; public array $backoff = [10, 30, 90, 270, 600]; public bool $afterCommit = true;`. Registered in `App\Providers\NotificationServiceProvider::boot()` by iterating `config('notification_events.events')` and calling `Event::listen($cfg['event'], RouteDomainEventToNotifications::class)` for every entry that has an `event` class (deterministic; no event discovery).

`handle(NotifiableDomainEvent|UserNotifiableEvent $event): void`:

1. `$cfg = EventCatalogue::get($event->eventKey())`; unknown key → `Log::error` + return (never throw; a missing catalogue entry must not break the queue).
2. **PDF wait for `quote.sent`** (`09` T9): if the quote has no `pdf` media and `now() < $event->occurredAt()->addSeconds(120)` → `$this->release(15)` and return. After 120 s proceed without attachment (mail shows a link to the quote page instead).
3. Build `EventEnvelope` (event key, eventId, order or subject, actor, payload, occurredAt).
4. For each rule in `$cfg['recipients']` (in order): skip if its `condition` is false; resolve users; apply exclusions (§4.2).
5. For each `(user, rule)`:
   1. **Idempotency**: `Cache::add("notify:sent:{eventId}:{userId}", 1, now()->addDay())` — if false, skip (already handled by a previous attempt).
   2. `$channels = NotificationPlanner::plan($user, $cfg, $rule, $envelope)` (§5.2). Empty → skip (still counts as handled).
   3. `$user->notify(new ($cfg['notification'])(NotificationContext::from($envelope, $rule), $channels))`. Because notifications implement `ShouldQueue`, Laravel queues **one job per channel** on `notify`, so a failing channel retries alone.
6. Exceptions inside a single recipient are caught, logged with `event_key`, `event_id`, `user_id`, and the loop continues; the idempotency key for that user is forgotten (`Cache::forget`) so a retry re-attempts only failed users. If any recipient failed, rethrow a `NotificationRoutingException` at the end to trigger the listener retry.

### 4.4 `EventNotification` (abstract base)

```php
abstract class EventNotification extends Notification implements ShouldQueue
{
    use Queueable;

    public int $tries = 5;
    public array $backoff = [10, 30, 90, 270, 600];

    /** @param list<string> $channels channel keys planned by NotificationPlanner */
    public function __construct(
        public readonly NotificationContext $context,
        public readonly array $channels,
    ) {
        $this->onQueue('notify');
        $this->afterCommit();
    }

    abstract public static function eventKey(): string;            // e.g. 'quote.sent'
    /** @return array<string, string|int> */
    abstract protected function params(): array;                    // §3.5

    public function via(object $notifiable): array;                 // maps $this->channels → channel classes, adds 'broadcast' when 'database' present
    public function withDelay(object $notifiable): array;            // §6 (quiet hours, read-suppression delay)
    public function shouldSend(object $notifiable, string $channel): bool; // read-suppression (§6.3), order still exists
    public function databaseType(object $notifiable): string;        // returns static::eventKey()
    public function toDatabase(object $notifiable): array;           // NotificationPayloadData minus id/createdAt/readAt
    public function toBroadcast(object $notifiable): BroadcastMessage; // full NotificationPayloadData, onQueue('notify')
    public function broadcastType(): string;                         // 'NotificationCreated' (01 §8)
    public function toMail(object $notifiable): MailMessage;          // §8
    public function toWhatsApp(object $notifiable): WhatsAppMessage;  // §7
    public function toSms(object $notifiable): SmsMessage;            // §7.8
    public function toWebPush(object $notifiable, mixed $notification): WebPushMessage; // §8.3
    protected function mailAttachments(): array { return []; }       // QuoteSent overrides
    protected function ctaUrl(): ?string;                             // §3.6
}
```

- `via()` mapping: `database` → `['database', 'broadcast']`, `mail` → `'mail'`, `whatsapp` → `WhatsAppChannel::class`, `sms` → `SmsChannel::class`, `webpush` → `WebPushChannel::class`.
- Locale: `User` implements `HasLocalePreference` (`preferredLocale()` returns `users.locale`), so Laravel renders each channel in the recipient's locale.
- `User::receivesBroadcastNotificationsOn()` returns `'users.'.$this->id` (01 §8 channel name).
- Every subclass is `final`, declares `eventKey()` and `params()`; only `QuoteSent` overrides `mailAttachments()`; `MessagePosted` overrides `shouldSend()` (read-suppression); `StaffDailyDigest` overrides `toMail()`.

`NotificationContext` (spatie Data, serialized into the job): `eventKey`, `eventId`, `audience` (`customer`|`staff`), `orderId` (nullable), `subjectType`/`subjectId` (nullable), `actorId` (nullable), `payload` (array), `occurredAt` (ISO), `collapsedCount` (int, default 0). Models are re-fetched by ID inside the job (`Order::withTrashed()->find()`); if the order no longer exists (hard-deleted draft) → `shouldSend` returns false for all channels.

### 4.5 `NotificationPayloadData` (shared in-app shape)

```php
namespace App\Notifications\Data;

#[TypeScript]
final class NotificationPayloadData extends Data
{
    public function __construct(
        public string $id,            // notifications.id (uuid)
        public string $eventKey,      // 'quote.sent'
        public string $titleKey,      // 'notifications.quote.sent.customer.title'
        public string $bodyKey,       // 'notifications.quote.sent.customer.body'
        /** @var array<string, string|int> */
        public array $params,
        public ?string $url,          // relative path, e.g. '/orders/01J…/quotes/01J…'
        public string $icon,          // lucide icon name, e.g. 'file-text'
        public string $createdAt,     // ISO-8601 UTC
        public ?string $readAt,       // ISO-8601 UTC or null
    ) {}

    public static function fromDatabaseNotification(DatabaseNotification $n): self; // data + id/created_at/read_at
}
```

`notifications.data` column stores `{eventKey, titleKey, bodyKey, params, url, icon}`. The broadcast payload is the full DTO (`id` = the notification's UUID, which Laravel shares across the database and broadcast channels of the same send; `readAt` null).

---

## 5. The catalogue file `config/notification_events.php`

### 5.1 Exact structure

The file returns `['categories' => [...], 'events' => [...]]`. It must be `config:cache`-safe: **no closures**; local array variables for presets are allowed. Excerpt with the presets, three complete event entries and the compact form required for all others:

```php
<?php

declare(strict_types=1);

use App\Domain\Orders\Events as OrderEvents;
use App\Domain\Imports\Events as ImportEvents;
use App\Domain\Ai\Events as AiEvents;
use App\Domain\Identity\Events as IdentityEvents;
use App\Notifications;

// Channel presets: ['default' => bool, 'locked' => bool, 'fallback_for' => ?string]
$LOCK = ['default' => true,  'locked' => true];
$ON   = ['default' => true,  'locked' => false];
$OFF  = ['default' => false, 'locked' => false];
$FB   = ['default' => false, 'locked' => false, 'fallback_for' => 'whatsapp'];

return [
    // Preference UI grouping (order of display). Labels: notifications.categories.{key}
    'categories' => [
        'orders'     => ['order.submitted', 'order.assigned', 'order.review_started', 'order.reopened', 'order.items_changed', 'order.on_hold', 'order.resumed', 'order.cancelled', 'order.closed', 'reminder.action_required'],
        'changes'    => ['order.changes_proposed', 'order.changes_resolved', 'order.changes_withdrawn'],
        'quotes'     => ['quote.sent', 'quote.negotiation_opened', 'quote.negotiation_answered', 'quote.accepted', 'quote.declined', 'quote.expiring_soon', 'quote.expired', 'order.reopened_after_call'],
        'production' => ['order.confirmed', 'order.production_started', 'order.production_update', 'order.completed', 'order.customer_approved', 'order.issue_raised', 'order.issue_resolved', 'order.delivery_scheduled', 'order.delivered'],
        'messages'   => ['message.posted', 'call.no_answer', 'call.callback_due'],
        'imports_ai' => ['import.ready_for_review', 'import.failed', 'ai.credits_granted', 'ai.credits_low'],
        'staff'      => ['staff.daily_digest'],
    ],

    'events' => [

        'quote.sent' => [
            'event'          => OrderEvents\QuoteSent::class,
            'notification'   => Notifications\Orders\QuoteSent::class,
            'transactional'  => false,          // true = bypass preferences, hidden from prefs UI
            'quiet_hours'    => true,           // applies to whatsapp + sms only
            'ensure_external'=> true,           // §5.3
            'collapse'       => null,           // or ['window' => 300, 'scope' => 'order', 'channels' => [...]]
            'read_suppression' => false,        // §6.3
            'recipients' => [
                [
                    'resolver'      => 'customer',
                    'audience'      => 'customer',
                    'include_actor' => false,
                    'condition'     => null,
                    'channels' => ['database' => $LOCK, 'mail' => $LOCK, 'whatsapp' => $ON, 'sms' => $FB, 'webpush' => $ON],
                ],
            ],
            'content' => [
                'customer' => [
                    'icon'     => 'file-text',
                    'cta'      => ['route' => 'customer.orders.quotes.show', 'params' => ['order' => 'orderId', 'quote' => 'quoteId'], 'fragment' => null, 'label' => 'notifications.cta.view_quote'],
                    'whatsapp' => ['template' => 'quote_sent_v1', 'body' => ['customerFirstName', 'quoteNumber', 'number', 'total', 'validUntil'], 'button' => 'ctaPath'],
                    'sms'      => ['vars' => ['appName', 'quoteNumber', 'totalPlain', 'validUntil', 'shortUrl']],
                    'webpush'  => ['tag' => 'order:{orderId}', 'renotify' => true, 'require_interaction' => true],
                ],
            ],
        ],

        'message.posted' => [
            'event'          => \App\Domain\Messaging\Events\MessagePosted::class,
            'notification'   => Notifications\Orders\MessagePosted::class,
            'transactional'  => false,
            'quiet_hours'    => true,
            'ensure_external'=> false,
            'collapse'       => ['window' => 300, 'scope' => 'order', 'channels' => ['mail', 'whatsapp', 'sms', 'webpush']],
            'read_suppression' => true,
            'recipients' => [
                ['resolver' => 'customer', 'audience' => 'customer', 'include_actor' => false, 'condition' => 'author_is_staff',
                 'channels' => ['database' => $LOCK, 'mail' => $ON, 'whatsapp' => $OFF, 'webpush' => $ON]],
                ['resolver' => 'assignee_or_permission:orders.review', 'audience' => 'staff', 'include_actor' => false, 'condition' => 'author_is_customer',
                 'channels' => ['database' => $LOCK, 'mail' => $ON, 'whatsapp' => $OFF, 'webpush' => $ON]],
            ],
            'content' => [
                'customer' => [
                    'icon' => 'message-square',
                    'cta'  => ['route' => 'customer.orders.show', 'params' => ['order' => 'orderId'], 'fragment' => 'messages', 'label' => 'notifications.cta.reply'],
                    'whatsapp' => ['template' => 'message_posted_v1', 'body' => ['customerFirstName', 'authorName', 'number'], 'button' => 'ctaPath'],
                    'webpush'  => ['tag' => 'messages:{orderId}', 'renotify' => true, 'require_interaction' => false],
                ],
                'staff' => [
                    'icon' => 'message-square',
                    'cta'  => ['route' => 'admin.orders.show', 'params' => ['order' => 'orderId'], 'fragment' => 'messages', 'label' => 'notifications.cta.reply'],
                    'whatsapp' => ['template' => 'staff_message_posted_v1', 'body' => ['customerName', 'number'], 'button' => 'ctaPath'],
                    'webpush'  => ['tag' => 'messages:{orderId}', 'renotify' => true, 'require_interaction' => false],
                ],
            ],
        ],

        'auth.otp' => [
            'event'          => null,                                  // sent directly by SendOtp (13 §4)
            'notification'   => Notifications\Auth\OtpCode::class,
            'transactional'  => true,
            'quiet_hours'    => false,
            'ensure_external'=> false,
            'collapse'       => null,
            'read_suppression' => false,
            'recipients'     => [],                                    // on-demand
            'content' => [
                'any' => [
                    'whatsapp' => ['template' => 'auth_otp', 'category' => 'AUTHENTICATION', 'body' => ['code'], 'button' => 'code'],
                    'sms'      => ['vars' => ['code', 'appName', 'domain', 'code']],
                ],
            ],
        ],

        // … every other key from §3.2 and §3.3 in the SAME shape …
    ],
];
```

Every other event entry is written out in full in the same shape, taking recipients/channels/flags from the §3.2/§3.3 tables (`LOCK`→`$LOCK`, `on`→`$ON`, `off`→`$OFF`, `fb`→`$FB`, `—`→ key omitted), `quiet_hours = true` where the table shows **Q**, `ensure_external = true` where it shows **X**, `collapse` for `message.posted` and `order.production_update` (`channels: ['mail','whatsapp','webpush']` for the latter), `read_suppression` only for `message.posted`. Icons (lucide): `order.submitted` `package`, `order.assigned` `user-check`, `order.review_started` `search`, `order.reopened` `rotate-ccw`, `order.changes_*` `git-compare`, `order.items_changed` `list-checks`, `quote.*` `file-text`, `order.reopened_after_call` `phone`, `order.confirmed` `badge-check`, `order.production_*` `hammer`, `order.completed` `camera`, `order.customer_approved` `thumbs-up`, `order.issue_*` `alert-triangle`, `order.delivery_scheduled` `calendar`, `order.delivered` `truck`, `order.closed` `archive`, `order.cancelled` `x-circle`, `order.on_hold` `pause-circle`, `order.resumed` `play-circle`, `message.posted` `message-square`, `call.*` `phone`, `reminder.action_required` `bell-ring`, `import.ready_for_review` `scan`, `import.failed` `file-warning`, `ai.*` `sparkles`, `account.welcome` `smile`. WhatsApp template names: `{event_key with dots→underscores}_v1` for customers (e.g. `order_changes_proposed_v1`) and `staff_{…}_v1` for staff; exceptions: `quote_sent_v1`, `message_posted_v1`, `auth_otp`. Body variable lists are given in §7.4.

A unit test (`tests/Unit/Notifications/EventCatalogueTest.php`) asserts: every key in `09 §11` plus every key in §3.3 is present; every `notification` class exists, extends `EventNotification` (or is a transactional class) and its `eventKey()` equals the array key; every non-transactional event has `database` = `$LOCK` in each rule; every `fb` entry has a `whatsapp` entry in the same rule; every translation key implied by §3.7 exists in `resources/lang/en/notifications.php`; every CTA route name exists (`Route::has`); every SMS text renders ≤ 160 chars and is GSM-7 with the fixture values in `tests/fixtures/notifications/params.php`.

### 5.2 `NotificationPlanner::plan(User $user, array $cfg, array $rule, EventEnvelope $e): list<string>`

```
wanted = []
whatsappWantedButUnavailable = false
for ch in ['database','mail','whatsapp','sms','webpush']:
    c = rule.channels[ch] ?? null;  if c === null: continue
    if cfg.transactional or c.locked: on = c.default
    else: on = PreferenceRepository.get(user, eventKey, ch) ?? c.default      // row wins over default
    if not on: continue
    if not ChannelAvailability.isAvailable(user, ch, eventKey):
        if ch === 'whatsapp': whatsappWantedButUnavailable = true
        continue
    wanted[] = ch

// SMS fallback
smsCfg = rule.channels['sms'] ?? null
if smsCfg?.fallback_for === 'whatsapp' and 'sms' not in wanted and whatsappWantedButUnavailable
   and PreferenceRepository.get(user, eventKey, 'sms') !== false                // explicit opt-out wins
   and ChannelAvailability.isAvailable(user, 'sms', eventKey):
    wanted[] = 'sms'

// negotiation answered with revision → in-app only (quote.sent covers external)
if eventKey === 'quote.negotiation_answered' and payload.status === 'answered_with_revision':
    wanted = intersect(wanted, ['database'])

// ensure_external (§5.3)
// collapse (§6.1) — removes throttled channels, may set collapsedCount
return wanted
```

### 5.3 `ensure_external`

For events flagged **X** (`quote.sent`, `order.confirmed`, `order.cancelled`, `order.delivery_scheduled`) the customer must receive at least one external message. If after planning none of `mail`, `whatsapp`, `sms` is in `wanted`, add the first of `['whatsapp', 'sms']` that is available **ignoring preferences**. If neither is available (no verified email and no reachable phone — impossible for a customer who submitted an order, because T2 requires a verified contact, unless they later lost it), log `notifications.no_external_channel` at `warning` with user id and event key. Rationale: these are contractual moments (price, commitment, cancellation, physical visit).

---

## 6. Throttling, quiet hours, read-suppression

### 6.1 Collapse (leading edge + trailing summary)

For events with `collapse` (`message.posted`, `order.production_update`), per recipient, per channel in `collapse.channels` (in-app is **never** collapsed: every message/update gets its own in-app entry):

1. Window key `notify:collapse:{eventKey}:{userId}:{orderId}:{channel}`. `Redis SET key 1 NX EX {window}`.
2. If SET succeeded → channel stays in `wanted` (leading notification, sent immediately subject to §6.2/§6.3).
3. If SET failed (window open) → remove the channel from `wanted`; `INCR notify:collapsed:{…same suffix}` (EXPIRE window+600). If the INCR result is `1`, dispatch `FlushCollapsedNotifications::dispatch($eventKey, $userId, $orderId, $channel, $contextOfLatestEvent)->delay(ttl(windowKey) + 1)` on queue `notify`.
4. `FlushCollapsedNotifications::handle()`: `$count = GETDEL notify:collapsed:{…}`; if `$count > 0`, re-check preference + availability for that single channel, then `$user->notify(new $class($context->withCollapsedCount($count), [$channel]))` — the body uses the ICU `collapsed` param (`(+N more)`). It does **not** open a new window.

Scope `order` means the window is per order; two different orders never collapse together.

### 6.2 Quiet hours

Setting `notifications.quiet_hours` = `{enabled: true, start: "21:00", end: "08:00"}` (business timezone `business.timezone`; proposed addition). For events with `quiet_hours = true`, `withDelay()` returns for `whatsapp` and `sms`: if the current business-local time is within `[start, end)` (window may cross midnight), a delay until the next `end` time **plus a deterministic jitter** of `crc32(userId) % 600` seconds (spreads the 08:00 burst). Mail, web push and in-app are never delayed by quiet hours. Transactional events never use quiet hours. If a delayed WhatsApp/SMS job runs and the order has since moved such that the message is obsolete, it is still sent (simplicity; content is factual and timestamped).

### 6.3 Read-suppression (`message.posted`)

- `withDelay()` returns `120` seconds for `mail`, `whatsapp`, `sms` (web push and in-app immediate). Quiet-hours delay is the max of both.
- `MessagePosted::shouldSend($notifiable, $channel)`: for `mail`/`whatsapp`/`sms`, returns `false` if `message_reads` for (order, user) has `last_read_at >= messages.created_at` of the message (the recipient already saw it in the app), or if the message is soft-deleted. Returns `true` otherwise.

### 6.4 Other limits

- Per-user global safety cap on external channels: max **20** WhatsApp + SMS messages per user per 24 h (Redis counter `notify:ext:{userId}:{Y-m-d}`); beyond, external channels are dropped with `Log::warning('notifications.user_cap_reached')`. Transactional `auth.otp` is excluded (has its own limits).
- `reminder.action_required` is throttled by `09 §13` (one per order per 48 h); no extra throttling here.

---

## 7. WhatsApp

### 7.1 Decision: drivers

`WHATSAPP_DRIVER=meta|twilio` (default `meta`). **Meta Cloud API is the default and recommended** (no intermediary markup, direct status webhooks with pricing info). **Twilio is supported as an optional driver** for owners who already use Twilio (single vendor for SMS + WhatsApp). Both implement `App\Notifications\Channels\WhatsApp\WhatsAppClient`:

```php
interface WhatsAppClient
{
    /** @throws WhatsAppSendException */
    public function sendTemplate(string $toE164, WhatsAppMessage $message): WhatsAppSendResult; // providerMessageId, rawStatus
    public function driverName(): string; // 'meta' | 'twilio'
}
```

Bound in `NotificationServiceProvider` by `config('services.whatsapp.driver')`. Tests bind `FakeWhatsAppClient` (records messages, can be primed to throw a given error code).

### 7.2 Configuration (`config/services.php` → `whatsapp`)

| Env | Meaning | Default |
|---|---|---|
| `WHATSAPP_DRIVER` | `meta` \| `twilio` | `meta` |
| `WHATSAPP_GRAPH_VERSION` | Graph API version | `v24.0` (verify the current supported version in Meta's changelog at deploy time; versions are supported ~2 years) |
| `WHATSAPP_PHONE_NUMBER_ID` | Cloud API phone number ID | — |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | WABA ID (used only for the template-sync command) | — |
| `WHATSAPP_ACCESS_TOKEN` | **System-user permanent token** with `whatsapp_business_messaging` + `whatsapp_business_management` | — |
| `WHATSAPP_APP_SECRET` | Meta app secret, for `X-Hub-Signature-256` | — |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | random ≥ 32 chars, for the GET verification handshake | — |
| `WHATSAPP_DEFAULT_LANGUAGE` | template language code | `en` |
| `WHATSAPP_TIMEOUT` | HTTP timeout seconds | `10` |
| `TWILIO_WHATSAPP_FROM` | e.g. `whatsapp:+14155238886` (twilio driver) | — |
| `FEATURE_WHATSAPP` | drives `features.whatsapp` | `false` |

`features.whatsapp` must be `false` when the driver's required envs are missing (computed in `config/features.php`: `env('FEATURE_WHATSAPP', false) && filled(env('WHATSAPP_ACCESS_TOKEN'))` for meta / `filled(env('TWILIO_WHATSAPP_FROM'))` for twilio).

### 7.3 Policy facts the implementation relies on (owner must verify with Meta)

- **Business-initiated messages must be pre-approved template messages.** Furny never sends free-form WhatsApp text in v1 (no session/service replies), so the 24-hour customer-service window is irrelevant to correctness.
- Templates are created by the owner in **WhatsApp Manager**, category **UTILITY** (transactional updates about an existing order) — except `auth_otp`, category **AUTHENTICATION** with a **copy-code** button. Marketing content must never be put in utility templates (Meta re-categorises or rejects).
- Template bodies may not start or end with a variable, may not contain newlines in parameters, and parameter values ≤ 60 chars here (§3.5).
- **Pricing**: since **2025-07-01** Meta charges **per delivered template message**, priced by template category (marketing, utility, authentication) and recipient country. Per the owner's brief, from **2026-10-01** *service (free-form) messages are billed beyond 1,000 free per month per business phone number, and utility templates delivered inside an open 24-hour window are now billed* (previously free). **The owner must verify current rates and rules in Meta's pricing page before enabling WhatsApp.** Consequence for v1: every WhatsApp notification costs money → defaults in §3 keep WhatsApp to action-needed/milestone events, quiet hours + collapse apply, and the delivery log stores `pricing_category` / `billable` from status webhooks so the owner can audit spend (admin settings page, `11`).

### 7.4 Template catalogue (owner submits these in WhatsApp Manager; suggested English text)

Language `en`. Footer for all utility templates: `Automated message. Please reply in the app.` URL button `{label}` with dynamic URL `https://{APP_HOST}/{{1}}` whose suffix is `ctaPath` (e.g. `o/ORD-2026-00042`). Bodies use positional variables `{{1}}…{{n}}` in the order given.

| Template name | Event | Body (suggested) | Body vars (in order) | Button label |
|---|---|---|---|---|
| `order_changes_proposed_v1` | `order.changes_proposed` | `Hello {{1}}, we have suggested some changes to the designs in your order {{2}}. Please review them so we can continue with your quote.` | `customerFirstName, number` | Review changes |
| `quote_sent_v1` | `quote.sent` | `Hello {{1}}, your quote {{2}} for order {{3}} is ready. Total: {{4}}, valid until {{5}}. Tap below to review it.` | `customerFirstName, quoteNumber, number, total, validUntil` | View quote |
| `quote_negotiation_answered_v1` | `quote.negotiation_answered` | `Hello {{1}}, we have replied to your response on quote {{2}}. Tap below to see our reply.` | `customerFirstName, quoteNumber` | View reply |
| `quote_expiring_soon_v1` | `quote.expiring_soon` | `Hello {{1}}, your quote {{2}} ({{3}}) is valid until {{4}}. Tap below to review it.` | `customerFirstName, quoteNumber, total, validUntil` | View quote |
| `order_confirmed_v1` | `order.confirmed` | `Hello {{1}}, your order {{2}} is confirmed. Expected delivery: {{3}}. We will keep you updated on production.` | `customerFirstName, number, expectedDelivery` | View order |
| `order_production_started_v1` | `order.production_started` | `Hello {{1}}, production of your order {{2}} has started. Current stage: {{3}}.` | `customerFirstName, number, stage` | Track progress |
| `order_completed_v1` | `order.completed` | `Hello {{1}}, your order {{2}} is complete. Please check the photos and confirm that everything looks right.` | `customerFirstName, number` | Check photos |
| `order_delivery_scheduled_v1` | `order.delivery_scheduled` | `Hello {{1}}, delivery of your order {{2}} is scheduled for {{3}}. Tap below for details.` | `customerFirstName, number, date` | View details |
| `order_cancelled_v1` | `order.cancelled` | `Hello {{1}}, your order {{2}} has been cancelled. Reason: {{3}}. Tap below for details.` | `customerFirstName, number, reason` | View order |
| `message_posted_v1` | `message.posted` (C) | `Hello {{1}}, {{2}} sent you a message about your order {{3}}. Tap below to read and reply.` | `customerFirstName, authorName, number` | Read message |
| `call_no_answer_v1` | `call.no_answer` | `Hello {{1}}, we tried to call you about your order {{2}} on {{3}}. Please reply in the app or request a call back.` | `customerFirstName, number, date` | Open order |
| `reminder_action_required_v1` | `reminder.action_required` | `Hello {{1}}, your order {{2}} is waiting for your action. Tap below to continue.` | `customerFirstName, number` | Open order |
| `staff_order_submitted_v1` | `order.submitted` (S) | `New order {{1}} from {{2}} is waiting for review.` | `number, customerName` | Open order |
| `staff_order_assigned_v1` | `order.assigned` | `Order {{1}} from {{2}} has been assigned to you.` | `number, customerName` | Open order |
| `staff_quote_negotiation_opened_v1` | `quote.negotiation_opened` | `{{1}} responded to quote {{2}}. Please review the counter-offer.` | `customerName, quoteNumber` | Open order |
| `staff_quote_accepted_v1` | `quote.accepted` (S) | `Quote {{1}} was accepted by {{2}}. Please call to confirm the order.` | `quoteNumber, customerName` | Open order |
| `staff_order_issue_raised_v1` | `order.issue_raised` (S) | `An issue was reported on order {{1}} by {{2}}. Please review it.` | `number, customerName` | Open order |
| `staff_message_posted_v1` | `message.posted` (S) | `{{1}} sent a message on order {{2}}.` | `customerName, number` | Read message |
| `staff_call_callback_due_v1` | `call.callback_due` | `Reminder: call back {{1}} about order {{2}} at {{3}}.` | `customerName, number, callbackAt` | Open order |
| `auth_otp` | `auth.otp` | Meta's fixed authentication body (`{{1}} is your verification code.`) + security recommendation + expiry 10 minutes | `code` | Copy code (button param = `code`) |

Staff templates beginning with a variable must be adjusted by prefixing a word if Meta rejects them (e.g. `Customer {{1}} responded…`); the setting stores whatever name the owner registered.

### 7.5 Settings mapping

`notifications.whatsapp_templates` (02 §13) — map `key → {name, language, components}` where `key` is the bare `event_key` for customer-audience templates and `event_key@staff` for staff-audience templates (proposed refinement; e.g. `message.posted` and `message.posted@staff`). Shape:

```json
{
  "quote.sent": {
    "name": "quote_sent_v1",
    "language": "en",
    "components": [
      {"type": "body", "params": ["customerFirstName", "quoteNumber", "number", "total", "validUntil"]},
      {"type": "button", "sub_type": "url", "index": 0, "param": "ctaPath"}
    ]
  }
}
```

Default: `{}` (WhatsApp unavailable per event until configured). The admin notification settings page (`11`) lists every event with a `whatsapp` cell, pre-fills `name`/`components` from the config `content.*.whatsapp` block, and has a **Test send** button (sends the template to the current staff user's verified phone with fixture params). For `WHATSAPP_DRIVER=twilio`, `name` holds the Twilio **Content SID** (`HX…`) and `components` order defines Twilio content variables `"1"…"n"`. An artisan command `whatsapp:templates:check` (meta only) calls `GET /{WABA_ID}/message_templates?fields=name,status,category,language` and prints, for each configured mapping, whether the template exists, is `APPROVED`, and is `UTILITY`/`AUTHENTICATION`; the admin page calls the same service and shows status chips.

### 7.6 Sending (`WhatsAppChannel::send($notifiable, EventNotification $n)`)

1. `$to` = `$notifiable->routeNotificationFor('whatsapp')` (User: `phone_e164`; on-demand: the routed number). Null → return.
2. `$msg = $n->toWhatsApp($notifiable)` → `WhatsAppMessage{templateName, languageCode, bodyParams: list<string>, buttonParam: ?string, eventKey}` built from the settings mapping and `params()`.
3. Create `notification_deliveries` row (`status = pending`, `channel = whatsapp`, `driver`, `event_key`, `notification_id = $n->id`, `user_id`, `to_masked`, `to_hash`, `template_name`, `context` = serialized `NotificationContext`).
4. `MetaCloudClient::sendTemplate()`:
   ```http
   POST https://graph.facebook.com/{WHATSAPP_GRAPH_VERSION}/{WHATSAPP_PHONE_NUMBER_ID}/messages
   Authorization: Bearer {WHATSAPP_ACCESS_TOKEN}
   Content-Type: application/json

   {"messaging_product":"whatsapp","recipient_type":"individual","to":"919876543210","type":"template",
    "template":{"name":"quote_sent_v1","language":{"code":"en"},
      "components":[
        {"type":"body","parameters":[{"type":"text","text":"Asha"},{"type":"text","text":"ORD-2026-00042-Q1"}, …]},
        {"type":"button","sub_type":"url","index":"0","parameters":[{"type":"text","text":"o/ORD-2026-00042"}]}]}}
   ```
   (`to` = E.164 without `+`.) Success: `messages[0].id` (`wamid.…`) → delivery `status = accepted`, `provider_message_id`, `accepted_at`.
   `TwilioWhatsAppClient` uses `Twilio\Rest\Client` (installed as a dependency of `laravel-notification-channels/twilio`) — `messages->create('whatsapp:+91…', ['from' => TWILIO_WHATSAPP_FROM, 'contentSid' => name, 'contentVariables' => json_encode(['1' => …]), 'statusCallback' => route('webhooks.twilio.status')])`. Rationale for not using the package's channel class: WhatsApp templates on Twilio require `contentSid`/`contentVariables`, which the package's message class does not model.
5. **Error handling** (Meta error object `error.code`; Twilio error codes mapped to the same classes):

| Meta code(s) | Meaning | Handling |
|---|---|---|
| `131026` | Message undeliverable (not a WhatsApp user, outdated app, etc.) | Permanent. Delivery `failed`. Mark phone unreachable (§7.7). Trigger SMS fallback (§7.8 rule). No retry. |
| `131047` | Re-engagement message (free-form outside 24 h window) | Should never happen (templates only) → `Log::error` (bug), delivery `failed`, SMS fallback, no retry. |
| `131051`, `100`, `132000`, `132001`, `132005`, `132007`, `132012`, `132015`, `132016` | Unsupported type / invalid parameter / template missing, param mismatch, paused or disabled | Permanent config error. Delivery `failed`. `Cache::put('health:whatsapp', {status:'template_error', code, template, at}, 7d)` (shown on admin dashboard). SMS fallback. No retry. |
| `130429`, `131056`, `131048`, `80007`, `4` | Throughput / pair rate / spam / WABA rate limits | Retryable: throw `WhatsAppSendException(retryable: true)`; job retries with backoff (10/30/90/270/600 s). `131056` (pair limit) additionally sets a 60 s release minimum. After final failure → `failed` + SMS fallback. |
| `190`, `10`, `200`, `131005` | Token expired/invalid, permission denied | Permanent. `Log::critical`; `health:whatsapp` = `auth_error`; SMS fallback. No retry. |
| `131000`, `1`, `2`, HTTP 5xx, connect timeout | Generic/transient | Retryable as above. |
| `131049` | Meta chose not to deliver (ecosystem engagement) | Permanent for this message; SMS fallback. |

`WhatsAppSendException` carries `code`, `title`, `retryable`. The channel catches non-retryable exceptions (does not rethrow, so the job completes); retryable exceptions are rethrown. `failed()` on the queued notification job (final attempt) also triggers the fallback rule.

### 7.7 Unreachable phones

A phone is "WhatsApp-unreachable" when its most recent WhatsApp delivery within 30 days has `error_code = 131026` and no later `delivered`/`read` delivery exists for the same `to_hash`. `ChannelAvailability` checks this with one indexed query, memoized in `Cache` key `wa:unreachable:{to_hash}` for 1 h. Changing a user's phone number naturally resets it (different hash).

### 7.8 SMS fallback rule

When a WhatsApp delivery fails permanently (sync error or `failed` status webhook received **within 60 minutes** of `accepted_at`), and the event's rule has `sms.fallback_for = whatsapp`, and the user has not explicitly disabled SMS for the event, and SMS is available, and no SMS delivery exists yet for the same `notification_id`: dispatch `SendSmsFallback($deliveryId)` on `notify`, which rebuilds the notification from `notification_deliveries.context` and sends it on the `sms` channel only (`Notification::sendNow($user, $notification, ['sms'])`). The SMS delivery row sets `fallback_of_id`. Quiet hours still apply to the fallback.

### 7.9 Webhook `GET|POST /webhooks/whatsapp` (`webhooks.whatsapp`)

- Excluded from CSRF; rate limiter `webhooks` (13). No session middleware (route in `routes/webhooks.php` loaded with the `api`-like stateless group; proposed addition).
- **GET** verification: if `hub_mode === 'subscribe'` and `hash_equals(WHATSAPP_WEBHOOK_VERIFY_TOKEN, hub_verify_token)` → `200` with `hub_challenge` as `text/plain`; else `403`. (PHP converts `hub.mode` query keys to `hub_mode`.)
- **POST**: read raw body; compute `'sha256='.hash_hmac('sha256', $raw, WHATSAPP_APP_SECRET)`; compare with header `X-Hub-Signature-256` via `hash_equals`; mismatch/missing → `403` and `Log::warning('webhooks.whatsapp.bad_signature')`. Then dispatch `ProcessWhatsAppWebhook($payload)` (queue `notify`) and return `200` immediately (Meta retries non-2xx).
- `ProcessWhatsAppWebhook`: iterate `entry[].changes[]` where `field = messages`; for each `value.statuses[]`: find delivery by (`driver = meta`, `provider_message_id = status.id`); unknown → ignore. Map `status`: `sent` → `sent_at`, `delivered` → `delivered_at`, `read` → `read_at`, `failed` → `failed_at` + `errors[0].code/title` (+ §7.6/§7.8 handling). Never move status backwards (`read` > `delivered` > `sent` > `accepted`; `failed` terminal unless a later `delivered` arrives). Store `pricing.category`, `pricing.billable` (and `pricing.type` if present) into `pricing_category`, `billable`. Inbound `value.messages[]` (customer replies) are **not processed in v1**: increment Redis counter `whatsapp:inbound:{Y-m-d}` (shown on admin settings page) and ignore; the template footer tells customers to reply in the app. Rationale: no free-form outbound in v1, and the in-app thread is the single conversation record.

---

## 8. SMS, email, web push, in-app

### 8.1 SMS (`SmsChannel`, driver-based)

`App\Notifications\Channels\Sms\SmsManager extends Illuminate\Support\Manager`; `getDefaultDriver()` = settings `notifications.sms_driver` (`log` default, 02 §13). Drivers implement:

```php
interface SmsDriver
{
    /** @throws SmsSendException */
    public function send(string $toE164, SmsMessage $message): SmsSendResult; // providerMessageId
    public function name(): string; // 'twilio' | 'msg91' | 'log' | 'array'
}
final class SmsMessage { public string $text; public ?string $dltTemplateId; public ?string $providerTemplateId; /** @var list<string> */ public array $vars; public string $eventKey; }
```

`toSms()` renders `text` = `Icu::trans("notifications.{event}.{aud}.sms", params)` and `vars` = values of `content.*.sms.vars` in order; `dltTemplateId`/`providerTemplateId` from settings `notifications.sms_templates[event_key]` = `{text_key, dlt_template_id, provider_template_id}`. `SmsChannel` writes a `notification_deliveries` row (`channel = sms`) like §7.6.

| Driver | Package / API | Env | Notes |
|---|---|---|---|
| `twilio` | `laravel-notification-channels/twilio ^4.2` — send via its `NotificationChannels\Twilio\Twilio` service with `TwilioSmsMessage::create($text)->statusCallback(route('webhooks.twilio.status'))` | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` (or `TWILIO_SMS_SERVICE_SID`) | For India, DLT registration is done in the Twilio console; `dlt_template_id` is informational. Error `21610` (unsubscribed), `21211`/`21614` (invalid/not mobile) → permanent; `20429`, 5xx → retryable. |
| `msg91` | Custom HTTP: `POST {MSG91_BASE_URL}/api/v5/flow` header `authkey: {MSG91_AUTH_KEY}`, JSON `{"template_id": provider_template_id, "short_url": "0", "realTimeResponse": "1", "recipients": [{"mobiles": "919876543210", "var1": "…", "var2": "…"}]}` | `MSG91_AUTH_KEY`, `MSG91_SENDER_ID` (6-char DLT header), `MSG91_DLT_ENTITY_ID` (PE ID), `MSG91_BASE_URL` (default `https://control.msg91.com`), `MSG91_WEBHOOK_TOKEN` | **India DLT**: every message must use a DLT-registered template whose text matches **exactly** (variables as `{#var#}`, each ≤ 30 chars); the owner registers each SMS text from §3.7 on the DLT portal (category: service-implicit / transactional for OTP), maps it to an MSG91 flow template with `##var1##…`, and stores both IDs in settings. **TRAI URL whitelisting**: the `APP_URL` domain must be whitelisted on the DLT portal or messages with links are blocked. Response `{"type":"success","message":"<requestId>"}` → `provider_message_id = requestId`; `type = error` → permanent unless message mentions rate/limit → retryable. Verify field names against current MSG91 docs at implementation; the driver must be covered by `Http::fake` tests either way. |
| `log` | writes `Log::channel('sms')->info()` with masked number + rendered text (dev) | — | default |
| `array` | tests only; stores sent messages in memory | — | bound in tests |

`features.sms` = `env('FEATURE_SMS', false)` and driver ≠ `log` in production (local may enable with `log`).

**Status webhooks**:
- `POST /webhooks/twilio/status` (`webhooks.twilio.status`): validate `X-Twilio-Signature` with `Twilio\Security\RequestValidator(TWILIO_AUTH_TOKEN)->validate($sig, $request->fullUrl(), $request->post())` → `403` on mismatch. Map `MessageStatus` `queued|accepted` → `accepted`, `sent` → `sent`, `delivered` → `delivered`, `read` → `read` (WhatsApp), `undelivered|failed` → `failed` with `ErrorCode`. Used for both Twilio SMS and Twilio WhatsApp.
- `POST /webhooks/msg91/{token}` (`webhooks.msg91`): `hash_equals(MSG91_WEBHOOK_TOKEN, $token)` else `403` (MSG91 DLR callbacks are not signed; the secret path token is the authentication — rotate by changing env + MSG91 panel). Accept JSON body or form fields; for each report find delivery by `requestId`; status `1` → `delivered`, `2`, `9`, `16`, `17`, `25`, `26` → `failed` (store numeric code), others → `sent`.

### 8.2 Email

- Transport via env `MAIL_MAILER` = `postmark` (recommended) \| `resend` \| `ses` \| `smtp` \| `log`. Install `symfony/postmark-mailer`, `symfony/http-client` and `resend/resend-php` so switching is env-only (`aws/aws-sdk-php` already present via S3). Envs: `POSTMARK_TOKEN` (+ `POSTMARK_MESSAGE_STREAM_ID=outbound`), `RESEND_KEY`, `AWS_*`/`SES_REGION`, `MAIL_HOST/PORT/USERNAME/PASSWORD/SCHEME`, `MAIL_FROM_ADDRESS`. From name = settings `business.name`; `Reply-To` = settings `business.email`.
- Template: every event uses `resources/views/mail/notification.blade.php` (Markdown, `<x-mail::message>`): heading = title, paragraph = body, optional detail table (event-specific `mailLines()` hook — `QuoteSent` shows quote number, total, valid until, items count; `DeliveryScheduled` shows date/time and site address city), button `<x-mail::button :url="$absoluteCtaUrl">` with CTA label, sign-off `notifications.mail.signoff` (`— The {businessName} team`). Markdown mail automatically produces the **plain-text alternative**; additionally publish `resources/views/vendor/mail/text/*` and verify text output in tests.
- Branding: publish mail components (`php artisan vendor:publish --tag=laravel-mail`); `header.blade.php` renders the business logo (public URL of the logo media, max-height 48 px, `alt` = business name) or the business name text; `footer.blade.php` renders `business.legal_name ?? business.name`, address one-liner, phone, `working_hours`, and for non-transactional mails: `notifications.mail.manage_preferences` link to the preferences page + `notifications.mail.unsubscribe_event` link. Theme CSS `resources/views/vendor/mail/html/themes/furny.css` (`config/mail.php` `markdown.theme = 'furny'`), colours from `15` tokens.
- **Unsubscribe** (non-transactional, non-locked mail only): link and headers point to `URL::signedRoute('notifications.unsubscribe', ['user' => $id, 'event' => $eventKey, 'channel' => 'mail'])`. Add headers `List-Unsubscribe: <{url}>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` via `withSymfonyMessage`. `GET` shows a confirmation page (`Auth/Unsubscribe.vue`, no login required) with a button; `POST` (also accepted directly for RFC 8058 one-click) upserts `notification_preferences(enabled=false)` for that event+mail and shows "Unsubscribed" with a link to all preferences. Invalid signature → 403 page.
- **Attachments**: `QuoteSent::mailAttachments()` returns `Attachment::fromStorageDisk('s3', $media->getPathRelativeToRoot())->as("Quote-{$quote->number}.pdf")->withMime('application/pdf')` when the quote PDF exists and is ≤ 10 MB; otherwise none (the body always contains the CTA link). No other event attaches files (photos are linked, never attached).
- Mail never contains OTP codes (OTP is phone-only), internal notes (`messages.kind = internal_note`), cost/margin data (`quotes.cost_snapshot`), or another customer's data.

### 8.3 Web push

- Package `laravel-notification-channels/webpush ^13`; `User` uses `NotificationChannels\WebPush\HasPushSubscriptions`. Generate keys with `php artisan webpush:vapid` → env `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`mailto:{business email}`). The public key is **not** part of the global shared props; it is passed only as the `vapidPublicKey` prop of the preferences pages and of the page that shows the `PushOptIn` card.
- `toWebPush()` → `(new WebPushMessage)->title($title)->body($body)->icon('/icons/notification-192.png')->badge('/icons/badge-72.png')->tag($tag)->renotify($renotify)->requireInteraction($ri)->data(['url' => $absoluteUrl, 'notificationId' => $this->id])->options(['TTL' => 86400, 'urgency' => 'normal'])`. Title/body rendered server-side in the recipient locale (max 80 / 160 chars, truncated with `…`). `tag` placeholders (`{orderId}`) replaced. Push text equals the in-app text, amounts included (lock-screen visibility is the user's choice when they opt in; decided against a redacted variant for simplicity).
- Expired subscriptions: the package deletes a subscription when the push service answers **404 or 410**; a feature test asserts this with a faked client. Other failures are logged.
- **Service worker** `public/sw.js` (plain JS, not bundled; served with `Service-Worker-Allowed: /` and `Cache-Control: no-cache`):
  ```js
  self.addEventListener('push', (event) => {
    const p = event.data ? event.data.json() : {};
    event.waitUntil(self.registration.showNotification(p.title ?? '', {
      body: p.body, icon: p.icon, badge: p.badge, tag: p.tag, renotify: !!p.renotify,
      requireInteraction: !!p.requireInteraction, data: p.data ?? {},
    }));
  });
  self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const url = new URL(event.notification.data?.url ?? '/', self.location.origin).href;
    event.waitUntil((async () => {
      const wins = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const w of wins) { if (new URL(w.url).origin === self.location.origin) { await w.focus(); return w.navigate(url); } }
      return clients.openWindow(url);
    })());
  });
  self.addEventListener('pushsubscriptionchange', (event) => { /* re-subscribe with stored applicationServerKey and POST to /api/push-subscriptions */ });
  ```
  The service worker does **no** fetch caching in v1 (no offline mode; avoids stale Inertia assets).
- **Manifest** `public/manifest.webmanifest`: `name`/`short_name` = app name (rendered by a route `GET /manifest.webmanifest` from config so it is not hard-coded), `display: "standalone"`, `start_url: "/"`, icons 192/512, theme colours from tokens. Linked from `app.blade.php`.
- **Subscription flow** (`usePushSubscription.ts`): feature-detect (`'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window`); `navigator.serviceWorker.register('/sw.js')`; on user click of **Enable notifications on this device** (must be inside the click handler — browsers, and iOS always, require a user gesture): `Notification.requestPermission()` → `granted` → `registration.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)})` → `POST /api/push-subscriptions` `{endpoint, keys: {p256dh, auth}, contentEncoding}` (controller calls `$user->updatePushSubscription(...)`). Disable: `subscription.unsubscribe()` + `DELETE /api/push-subscriptions` `{endpoint}`. Max **10** subscriptions per user (oldest deleted).
- **iOS/iPadOS**: web push works only on **iOS 16.4+** for a site **added to the Home Screen** and opened from there (standalone). `PushOptIn.vue` detects iOS Safari not in standalone mode (`navigator.standalone !== true && !matchMedia('(display-mode: standalone)').matches`) and instead shows instructions: "Tap Share → Add to Home Screen, then open the app from your Home Screen and enable notifications here" (keys `notifications.push.ios_instructions.*`). Denied permission → show "Notifications are blocked in your browser settings" with no further prompts. Never auto-prompt on page load; the opt-in card appears on the preferences page and once (dismissible, remembered in `localStorage` key `fs:push-card-dismissed`) on the customer order page after the first order is submitted.

### 8.4 In-app (database + broadcast)

- `notifications` table (Laravel, `ulidMorphs` per 02); `type` column = event key (`databaseType()`).
- Broadcast: `toBroadcast()` returns `new BroadcastMessage($payload->toArray())` `->onQueue('notify')`; event name `NotificationCreated` on private channel `users.{id}` (authorised in `routes/channels.php`: `(string) $user->id === $userId`). Frontend: `useNotifications()` subscribes via `useEcho('users.' + id, '.NotificationCreated', cb)`; on receipt: prepend to the loaded list (if loaded), increment `unreadCount`, show a `vue-sonner` toast (title + body, action "View" → `router.visit(url)`) unless the user is already on that URL.
- Shared Inertia prop `unreadNotifications` (int) = `$user->unreadNotifications()->count()` (index in appendix); for guests absent. Display `99+` above 99.
- **Bell dropdown** (`NotificationBell.vue`, in both layouts' top bar): badge with unread count; on open, lazy `GET /api/notifications?limit=10` (no Inertia partial reload). Each item: icon, translated title (bold if unread), body (2-line clamp), relative time (`Intl.RelativeTimeFormat`), unread dot. Click → `POST /api/notifications/{id}/read` (fire-and-forget) then `router.visit(url)`. Header actions: **Mark all as read** (`POST /api/notifications/read-all`, optimistic), **Preferences** link. Footer: **See all** → notification center. Empty state key `notifications.empty`. Keyboard accessible (reka-ui `DropdownMenu`).
- **Notification center** pages `customer.notifications.index` / `admin.notifications.index`: tabs **All** / **Unread**, cursor-paginated 25 per page (`GET /api/notifications?filter=unread&cursor=…` returns `{data: NotificationPayloadData[], nextCursor: string|null, unreadCount: int}`), "Load more" button, per-item "Mark as read/unread" (`POST /api/notifications/{id}/unread` sets `read_at = null`), "Mark all as read".
- Opening an order page does **not** auto-mark notifications read (explicit model; simpler and predictable).
- Retention: `notifications:prune` daily 03:30 deletes read notifications older than 180 days and all older than 365 days.

---

## 9. Staff daily digest (`staff.daily_digest`)

- Command `notifications:staff-digest`, scheduled **hourly at minute 5**; it runs only when the current hour in `business.timezone` equals setting `notifications.staff_digest_hour` (default 9), so changing the setting needs no redeploy.
- Recipients: active staff users who (a) are the assignee of at least one listed order or (b) hold `orders.review` and at least one listed order is unassigned. Lists per `09 §13`:
  1. `submitted` > 24 h and not picked up (`reviewed_at` null);
  2. `negotiating` > 24 h with an open negotiation;
  3. `accepted` > 24 h without any `confirmation_calls` row;
  4. callbacks due today (`confirmation_calls.callback_at` today, business TZ) for orders where the recipient logged the call or is assignee;
  5. counts of the recipient's assigned Active orders by state.
- Skip a recipient when lists 1–4 are all empty. Idempotency: `Cache::add("digest:{userId}:{Y-m-d}", 1, 36h)`.
- Delivered via the planner with event key `staff.daily_digest` (mail only, preference `on`, user may disable). `StaffDailyDigest::toMail()` uses `resources/views/mail/staff-digest.blade.php`: subject `notifications.staff.daily_digest.staff.subject` (`{count} order(s) need attention`), one table per non-empty list (order number linking to `admin.orders.show`, customer name, state, age in hours), and a button to `admin.dashboard`.

---

## 10. Preferences

### 10.1 Storage and defaults

- Table `notification_preferences` (02 §1.4). **Absence of a row = default** from the catalogue rule matching the user's audience. Saving writes rows only where the value **differs** from the default and deletes rows equal to the default (so later default changes propagate to users who never touched the cell).
- `PreferenceRepository::get(User, eventKey, channel): ?bool` loads all rows for the user once per job/request (`Cache::remember("prefs:{userId}", 1h)`, busted on save).
- Locked cells are never stored; transactional events never appear.

### 10.2 Preferences UI (`PreferencesMatrix.vue`)

Routes: `customer.account.notifications` / `admin.account.notifications` (GET page, PUT save). Page props:

```ts
type PreferencesPageProps = {
  categories: Array<{
    key: string;                              // 'quotes'
    labelKey: string;                         // 'notifications.categories.quotes'
    events: Array<{
      eventKey: string; labelKey: string; descriptionKey: string;
      cells: Record<'mail'|'whatsapp'|'sms'|'webpush', null | {
        enabled: boolean; locked: boolean; isDefault: boolean;
        available: boolean; unavailableReasonKey: string | null;   // e.g. 'notifications.unavailable.phone_unverified'
        fallback: boolean;                                         // sms 'fb' cell
      }>;
    }>;
  }>;
  channels: Record<'mail'|'whatsapp'|'sms'|'webpush', { available: boolean; unavailableReasonKey: string | null }>;
  vapidPublicKey: string | null;
  pushSubscriptionCount: number;
};
```

Rules:
- Rows = events whose rules include the user's audience, grouped by category, in catalogue order. The in-app column is **not shown** (always on); a note explains "You always see these in the app" (`notifications.prefs.in_app_note`).
- Columns: Email, WhatsApp, SMS, Push. A `null` cell (channel not offered) renders an em-dash, not a switch.
- **Locked** cells render a checked, disabled switch with a lock icon and tooltip `notifications.prefs.locked_tooltip` ("Required for this update").
- **Unavailable** channels render disabled switches showing the stored/default value, with the reason and a fix link: email unverified → resend verification; phone missing/unverified → `customer.account.profile#phone`; push → the `PushOptIn` card at the top of the page; WhatsApp/SMS disabled by business → reason only.
- SMS fallback cells show helper text `notifications.prefs.sms_fallback` ("Used only if WhatsApp can't reach you").
- Column header has a "toggle all" checkbox affecting only unlocked, available cells of that column.
- **Reset to defaults** button deletes all the user's rows (confirmation dialog).
- Save: `PUT` `{ preferences: Array<{eventKey: string, channel: 'mail'|'whatsapp'|'sms'|'webpush', enabled: boolean}> }` (FormRequest `UpdateNotificationPreferencesRequest`): each `eventKey` must be a non-transactional catalogue key whose rules include the user's audience; `channel` must be offered and **not locked** (else 422 `preference_locked`). Unavailable-but-offered channels may be saved (they take effect once available). Action `App\Domain\Identity\Actions\UpdatePreferences`. Success toast `notifications.prefs.saved`.
- Staff defaults vs customer defaults come straight from the per-audience rules in §3; staff typically get mail + push, WhatsApp off; customers get WhatsApp on for action-needed events.

---

## 11. Delivery log & health

- `notification_deliveries` (schema in appendix) records every WhatsApp and SMS send attempt (including `auth.otp`). Mail and web push are not recorded (provider dashboards / package events suffice; keeps PII footprint low).
- Admin settings → Notifications (`11`) shows: per-channel health (`Cache` keys `health:whatsapp`, `health:sms`), last 50 deliveries (masked numbers), 30-day counts by status and `pricing_category`, inbound WhatsApp counter.
- `notifications:prune` also deletes `notification_deliveries` older than 180 days.

---

## 12. Testing (Pest)

Required suites (files under `tests/Feature/Notifications/` and `tests/Unit/Notifications/`):

1. **Catalogue test** (§5.1).
2. **Routing per event**: for each event key, a dataset-driven test builds the domain event with factories, runs the listener synchronously (`(new RouteDomainEventToNotifications)->handle($event)`) under `Notification::fake()`, and asserts `Notification::assertSentTo($expectedUser, ExpectedClass::class, fn ($n, $channels) => $channels == $expectedChannels)` and `assertNotSentTo($actor)`.
3. **Preferences**: user disables `mail` for `order.review_started` → not in channels; cannot disable locked (`PUT` → 422 `preference_locked`); reset deletes rows; saving a default value deletes the row.
4. **Availability**: unverified phone → no WhatsApp/SMS; `features.whatsapp=false` → none; missing template mapping → none; no push subscriptions → no webpush.
5. **SMS fallback**: WhatsApp wanted but unavailable → `sms` planned; explicit SMS opt-out → not planned; `FakeWhatsAppClient` primed with `131026` → delivery `failed`, `SendSmsFallback` dispatched (`Queue::fake()`), and the `ArraySmsDriver` receives exactly one SMS when run.
6. **Collapse**: three `message.posted` within 5 min → in-app 3 times; mail/push once immediately; `FlushCollapsedNotifications` dispatched once with delay; when run, sends one notification with `collapsedCount = 2`. Uses Redis in tests (CI provides Redis) — not the array cache.
7. **Quiet hours**: `Carbon::setTestNow('2026-10-20 22:30', business TZ)` → `withDelay()['whatsapp']` = 08:00 next day + jitter; mail delay absent.
8. **Read-suppression**: message read before delay elapses → `shouldSend(..., 'mail')` false.
9. **Idempotency**: listener handled twice for the same `eventId` → each recipient notified once.
10. **`quote.sent` PDF wait**: no PDF and event 30 s old → job released; event 150 s old → sent without attachment; with PDF → `MailMessage` has attachment named `Quote-{number}.pdf`.
11. **Meta client**: `Http::fake()` asserts exact JSON body (template name, language, body params order, button suffix) and Authorization header; error code table mapping (retryable vs not).
12. **Webhooks**: WhatsApp GET handshake (good/bad token); POST with valid/invalid `X-Hub-Signature-256` (compute HMAC over fixture raw body); status progression never goes backwards; pricing stored. Twilio signature via `RequestValidator` with a test auth token; MSG91 token path.
13. **Web push**: `WebPushMessage` payload (title/body/data.url/tag); a 410 report deletes the subscription.
14. **Mail rendering**: snapshot of HTML + text parts for `QuoteSent`, `OrderCancelled`, `StaffDailyDigest`; unsubscribe headers present on non-transactional mail and absent on `auth.*` and locked-mail events; signed unsubscribe GET/POST.
15. **Broadcast**: `Event::fake([BroadcastNotificationCreated::class])` → channel `private-users.{id}`, `broadcastAs` `NotificationCreated`, payload matches `NotificationPayloadData`.
16. **API**: notifications index/pagination/unread filter, read, unread, read-all; users cannot mark others' notifications (404).
17. **Staff digest**: runs only at configured hour; skips empty; once per day.

Fakes: `FakeWhatsAppClient` and `ArraySmsDriver` are bound in `tests/Pest.php` `beforeEach` for the Feature suite; `Http::preventStrayRequests()` is enabled globally.

---

## 13. Acceptance criteria

1. Every event key in `09 §11` and §3.3 has a catalogue entry, a Notification class, English strings and passes the catalogue test.
2. A customer who never touched preferences receives, for `quote.sent`: in-app (real-time toast if online), email with PDF attachment, WhatsApp template (if configured and phone verified), web push (if subscribed); SMS only if WhatsApp is unavailable or fails permanently.
3. A staff user with `orders.review` sees `order.submitted` in-app within 2 s of submission when online (Reverb), and receives push/mail per preferences.
4. Locked channels cannot be disabled via UI or API; transactional messages never show in preferences and never contain unsubscribe links.
5. Five rapid staff messages to a customer yield 5 in-app entries but at most 2 emails (leading + collapsed summary) and no email at all if the customer reads the thread within 2 minutes.
6. No WhatsApp/SMS is delivered between 21:00 and 08:00 business time for non-transactional events.
7. WhatsApp and SMS deliveries are visible with status progression from webhooks; invalid webhook signatures are rejected with 403.
8. Clicking a web push notification focuses an open app tab (or opens one) at the CTA URL; on iOS outside Home Screen mode the UI shows install instructions instead of a broken prompt.

---

## Appendix: Proposed additions to other documents

### A. `02-data-model.md`

**A.1 New table `notification_deliveries`** (§1 Identity, migration group 2 after `notifications`)

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | ulid PK | | | |
| notification_id | uuid | yes | | Laravel notification id (shared across channels of one send); null for `auth.otp` |
| user_id | ulid FK users **N** | yes | | null for on-demand (OTP before signup) |
| event_key | string(64) | no | | |
| channel | string(16) | no | | `whatsapp` \| `sms` |
| driver | string(16) | no | | `meta` \| `twilio` \| `msg91` \| `log` \| `array` |
| to_masked | string(32) | no | | e.g. `+91******3210` |
| to_hash | char(64) | no | | `hash_hmac('sha256', phone_e164, APP_KEY)` |
| template_name | string(128) | yes | | Meta template name / Twilio content SID / MSG91 template id |
| provider_message_id | string(128) | yes | | `wamid…` / Twilio SID / MSG91 request id |
| status | string(16) | no | `'pending'` | `pending` \| `accepted` \| `sent` \| `delivered` \| `read` \| `failed` |
| error_code | string(32) | yes | | provider code |
| error_title | string(255) | yes | | |
| pricing_category | string(24) | yes | | from Meta status webhook `pricing.category` |
| billable | boolean | yes | | from Meta `pricing.billable` |
| fallback_of_id | ulid FK notification_deliveries **N** | yes | | SMS fallback of a failed WhatsApp delivery |
| context | jsonb | yes | | serialized `NotificationContext` (to rebuild for fallback) |
| attempts | smallint | no | 0 | |
| accepted_at, sent_at, delivered_at, read_at, failed_at | timestamptz | yes | | |
| timestamps | | | | |

Indexes: partial unique (`driver`, `provider_message_id`) where `provider_message_id` is not null; (`user_id`, `channel`, `created_at`); (`to_hash`, `channel`, `created_at`); (`event_key`, `created_at`); (`status`, `created_at`).

**A.2 `notifications` table index**: add index (`notifiable_id`, `read_at`) and (`notifiable_id`, `created_at`) for unread counts and the notification center.

**A.3 Settings group `notifications`** — add field `quiet_hours`: `{enabled: bool, start: "HH:MM", end: "HH:MM"}`, default `{enabled: true, start: "21:00", end: "08:00"}`. Refine `whatsapp_templates` value shape to `{name: string, language: string, components: Array<{type: 'body', params: string[]} | {type: 'button', sub_type: 'url', index: int, param: string}>}`, keyed by `event_key` (customer audience) or `event_key@staff` (staff audience). Refine `sms_templates` value shape to `{text_key: string, dlt_template_id: ?string, provider_template_id: ?string}`; default seeded entries (all with null IDs) for: `order.changes_proposed`, `quote.sent`, `quote.negotiation_answered`, `quote.expiring_soon`, `order.confirmed`, `order.production_started`, `order.completed`, `order.delivery_scheduled`, `order.cancelled`, `call.no_answer`, `reminder.action_required`, `auth.otp` with `text_key = notifications.{key}.customer.sms` (`notifications.auth.otp.sms` for OTP).

### B. `09-order-workflow.md` §11

`NotifiableDomainEvent` additionally declares `eventId(): string` (ULID generated in the event constructor, used for notification idempotency) and `occurredAt(): CarbonImmutable`. Event payload keys per `12 §3.4`. The "Log confirmation call" action, for `callback_requested`, dispatches job `DispatchCallbackDue` delayed until `callback_at`, which fires `call.callback_due` only if the order is still `accepted`/`confirmed` and no newer call was logged; for outcome `no_answer` the action dispatches `call.no_answer`.

### C. `01-architecture.md`

- §1.1 composer additions: `symfony/postmark-mailer ^7.3`, `symfony/http-client ^7.3`, `resend/resend-php ^0.x latest` (mail transports); `twilio/sdk` is used directly (already a transitive dependency of `laravel-notification-channels/twilio`; declare it explicitly `^8.0`).
- §3 layout: `routes/webhooks.php` (stateless group: no session, no CSRF, `throttle:webhooks`) for `/webhooks/*`.
- §7 scheduler: hourly at :05 `notifications:staff-digest`; daily 03:30 `notifications:prune`.
- §4: new event contract `App\Domain\Shared\Contracts\UserNotifiableEvent` (non-order events).

### D. Master §6.7 feature flags — env names

`features.whatsapp` ← `FEATURE_WHATSAPP` (and required WhatsApp envs present); `features.sms` ← `FEATURE_SMS`; `features.web_push` ← `FEATURE_WEB_PUSH` (default true; false if VAPID keys missing); `features.google_login` ← `FEATURE_GOOGLE_LOGIN` (and Google envs present).

### E. `14-routes-and-api.md` — routes this file depends on (exact names)

| Name | Method + path | Notes |
|---|---|---|
| `links.order` | GET `/o/{number}` | auth; redirect per §3.6 |
| `customer.orders.show` | GET `/orders/{order}` | |
| `customer.orders.quotes.show` | GET `/orders/{order}/quotes/{quote}` | |
| `customer.orders.proposals.show` | GET `/orders/{order}/proposals/{proposal}` | |
| `customer.orders.completion` | GET `/orders/{order}/completion` | |
| `customer.imports.show` | GET `/imports/{import}` | review page |
| `customer.account.ai-credits` | GET `/account/ai-credits` | |
| `customer.account.notifications` / `.update` | GET/PUT `/account/notifications` | |
| `customer.notifications.index` | GET `/notifications` | |
| `customer.dashboard` | GET `/dashboard` | |
| `admin.orders.show` | GET `/admin/orders/{order}` | `#messages` fragment for messages |
| `admin.imports.show` | GET `/admin/imports/{import}` | |
| `admin.account.notifications` / `.update` | GET/PUT `/admin/account/notifications` | |
| `admin.notifications.index` | GET `/admin/notifications` | |
| `admin.dashboard` | GET `/admin` | |
| `api.notifications.index` | GET `/api/notifications` | `?filter=unread&cursor=&limit=` (limit ≤ 50) |
| `api.notifications.read` / `.unread` | POST `/api/notifications/{id}/read` / `/unread` | |
| `api.notifications.read-all` | POST `/api/notifications/read-all` | |
| `api.push-subscriptions.store` / `.destroy` | POST/DELETE `/api/push-subscriptions` | |
| `notifications.unsubscribe` | GET/POST `/notifications/unsubscribe/{user}/{event}/{channel}` | signed, no auth |
| `manifest` | GET `/manifest.webmanifest` | |
| `webhooks.whatsapp` | GET/POST `/webhooks/whatsapp` | |
| `webhooks.twilio.status` | POST `/webhooks/twilio/status` | |
| `webhooks.msg91` | POST `/webhooks/msg91/{token}` | |

(`customer.orders.messages` / `admin.orders.messages` in §3.2 denote the order show route with fragment `messages`; no separate route.)

### F. `11-admin-app.md`

Settings → Notifications page: WhatsApp template mapping table per event (pre-filled from config, test-send button, status chips from `whatsapp:templates:check`), SMS driver select + template IDs per event, quiet hours, staff digest hour, delivery log (last 50), health banners.
