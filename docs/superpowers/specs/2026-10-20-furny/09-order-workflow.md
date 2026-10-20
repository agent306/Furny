# 09 — Order Workflow

Read the master document, `01`, `02`, `03` first. This file is normative for **order states, transitions, who may perform them, preconditions, side effects, notifications and system messages**. Notification channel behaviour is in `12`; UI in `10`/`11`; routes in `14`.

Implementation: `spatie/laravel-model-states`. Abstract `App\Domain\Orders\States\OrderState` with one class per state (`Draft`, `Submitted`, …) registered via `OrderState::config()->default(Draft::class)->allowTransition(...)` for **every** transition in §2 (and no others). Each transition is a custom `Transition` class in `App\Domain\Orders\Transitions` that performs side effects; controllers call Actions which call `$order->state->transitionTo(…)` inside `DB::transaction`. Transitions not allowed by the config throw `CouldNotPerformTransition` → HTTP 409 with `code: 'invalid_transition'`.

---

## 1. States

| State key | Label (en) | Customer can edit designs? | Customer sees as |
|---|---|---|---|
| `draft` | Draft | yes | "Draft — not sent yet" |
| `submitted` | Submitted | no | "Waiting for review" |
| `in_review` | In review | no | "Our team is reviewing your designs" |
| `changes_proposed` | Changes proposed | no (approve/reject only) | "Action needed: review our suggested changes" |
| `quoted` | Quote sent | no | "Action needed: review your quote" |
| `negotiating` | Negotiating | no | "We're reviewing your response" |
| `accepted` | Quote accepted | no | "Accepted — we'll call you to confirm" |
| `confirmed` | Confirmed | no | "Confirmed — production will start soon" |
| `in_production` | In production | no | "In production" (+ stage, %) |
| `completed` | Completed — awaiting your check | no | "Action needed: check the photos of your furniture" |
| `rework` | Rework | no | "We're fixing the issue you reported" |
| `ready_for_delivery` | Ready for delivery | no | "Ready for delivery" |
| `delivered` | Delivered | no | "Delivered" |
| `closed` | Closed | no (designs unlocked) | "Closed" |
| `cancelled` | Cancelled | no (designs unlocked) | "Cancelled" |
| `on_hold` | On hold | no | "On hold" (+ reason) |

**Terminal**: `closed`, `cancelled`. **Active** = every state except `draft`, `closed`, `cancelled`.

A `draft` order that was **never submitted** (`submitted_at` null) is not cancelled but **deleted** by the customer (`DeleteDraftOrder` action: hard delete of order + items). A `draft` order that was submitted before and reopened (T5) is cancelled with T3. `completed` orders are **never auto-approved**; the scheduler only sends reminders (48 h and 7 days, §13).

Transition number T23 is intentionally unused.

## 2. Transition table

Legend — Actor: **C** customer (owner of order), **S** staff with permission (in brackets), **Sys** system/scheduler. "Event" = domain event dispatched after commit; notification routing per `12`. "Msg" = system message posted in the order thread (`messages.kind = system`, `system_event` = the event key).

| # | From | To | Actor | Pre-conditions | Side effects | Event |
|---|---|---|---|---|---|---|
| T1 | — | `draft` | C | Project owned by C; ≥ 1 furniture design selected; no design in another **active** order (else 422 `design_in_active_order`) | Create order (temp number), items with `furniture_revision_id = null` | — |
| T2 | `draft` | `submitted` | C | ≥ 1 item; every item's design validates with **no error issues** (engine CLI); site address set; `needs_installation` chosen; customer has verified email **or** phone | Assign `number` (`ORD-YYYY-NNNNN`); for each item create furniture revision `reason=order_submitted` from working copy and pin it; set `furniture_designs.locked_by_order_id`; dispatch `ComputeRevisionBom` per revision; `submitted_at` | `order.submitted` + Msg |
| T3 | `draft` | `cancelled` | C ("Cancel order") | `submitted_at` not null (order was submitted before) | `cancel_reason = customer_withdrew`; `cancelled_at` | `order.cancelled` + Msg |
| T4 | `submitted` | `in_review` | S [`orders.review`] | — | `assigned_to` = actor if null; `reviewed_at` | `order.review_started` + Msg |
| T5 | `submitted`, `in_review`, `changes_proposed`, `quoted`, `negotiating` | `draft` | C ("Edit my designs") | No proposal in `sent` status will be lost silently: UI confirms; quotes in `sent` → `withdrawn`; proposals `sent`/`draft` → `withdrawn` | Unlock designs; keep items (unpin revisions: set `furniture_revision_id = null`); keep number (number assigned at first submission is reused on resubmission) | `order.reopened` + Msg |
| T6 | `in_review` | `changes_proposed` | S [`orders.propose_changes`] | Proposal in `draft` with ≥ 1 item having `to_revision_id` (staff draft saved and differing from `from_revision`) | Proposal → `sent` (`sent_at`); for each item: create furniture revision `reason=staff_proposal`, author_kind staff, from `staff_draft_document`; compute `changes` via engine diff; dispatch BOM jobs | `order.changes_proposed` + Msg |
| T7 | `changes_proposed` | `in_review` | C (resolve proposal) | Every proposal item has `decision ≠ pending`; rejected items require `customer_comment` | Proposal → `resolved`; for **approved** items: `order_items.furniture_revision_id = to_revision_id`, design `working_document = to_revision.document`, `working_version + 1`, `current_revision_id = to_revision_id`, create revision `reason=proposal_applied` **not** needed (to_revision becomes current); rejected items unchanged | `order.changes_resolved` + Msg (lists approved/rejected counts) |
| T8 | `changes_proposed` | `in_review` | S [`orders.propose_changes`] | — | Proposal → `withdrawn` | `order.changes_withdrawn` + Msg |
| T9 | `in_review`, `negotiating` | `quoted` | S [`quotes.send`] | A quote in `draft` exists; every item's pinned revision has `bom_status = ready`; quote lines ≥ 1; total ≥ `pricing.minimum_order_minor`; no proposal in `sent` | Previous `sent` quote → `superseded`; new quote → `sent` (`sent_at`), `orders.current_quote_id`; render PDF job (`RenderQuotePdf`) — notification waits for PDF (job chain) with 2-minute fallback to send without attachment link; `quoted_at` (first time only) | `quote.sent` + Msg |
| T10 | `quoted` | `accepted` | C | Current quote `sent`, `valid_until ≥ today` (business TZ); customer ticks "I accept the quote and terms" | Quote → `accepted` (`accepted_at`, `accepted_by_ip`); `orders.accepted_quote_id`; `accepted_at`; open negotiations → `closed` | `quote.accepted` + Msg |
| T11 | `quoted` | `negotiating` | C | `workflow.allow_customer_counter_offer`; open negotiation rounds < `workflow.max_negotiation_rounds`; message required; `proposed_total_minor` optional, must be > 0 and < quote total | Create `quote_negotiations` (status `open`) | `quote.negotiation_opened` + Msg |
| T12 | `negotiating` | `quoted` | S [`quotes.send`] ("Keep current price") | Open negotiation exists; answer message required | Negotiation → `answered_keep_price`; quote stays `sent`; optionally extend `valid_until` (field in form) | `quote.negotiation_answered` + Msg |
| T13 | `negotiating` | `quoted` | S [`quotes.send`] ("Send revised quote") | = T9 preconditions | = T9 + negotiation → `answered_with_revision`, `resulting_quote_id` | `quote.sent` + `quote.negotiation_answered` + Msg |
| T14 | `quoted`, `negotiating` | `cancelled` | C ("Decline quote") | Reason text required | Quote → `declined` (`decline_reason`); `cancel_reason = quote_declined`; unlock designs; `cancelled_at` | `quote.declined` + `order.cancelled` + Msg |
| T15 | `quoted` | `in_review` | Sys (`orders:expire-quotes`) | `valid_until < today` | Quote → `expired`; Msg "Quote expired — we'll prepare an updated one" | `quote.expired` |
| T16 | `accepted` | `confirmed` | S [`orders.confirm`] | ≥ 1 `confirmation_calls` row with `outcome = confirmed` logged by any staff (the confirm dialog creates it in the same transaction if not yet logged); `expected_delivery_on` set | `confirmed_at`; `production_assignee_id` optional | `order.confirmed` + Msg |
| T17 | `accepted` | `negotiating` | S [`orders.confirm`] (call outcome `customer_wants_changes` → "Back to negotiation") | Call logged | Quote `accepted` → `superseded`; `accepted_quote_id = null`; new negotiation created by staff on behalf of customer with call notes | `order.reopened_after_call` + Msg |
| T18 | `accepted` | `cancelled` | S [`orders.cancel`] | Call logged with outcome `customer_declined`, or reason `unresponsive` after ≥ 3 logged `no_answer` calls | `cancel_reason`; unlock designs | `order.cancelled` + Msg |
| T19 | `confirmed` | `in_production` | S [`production.manage`] | Phase 2: if `features.payments`, an `advance` payment `succeeded` (NOT enforced in v1) | `production_started_at`; first automatic production update (stage = first stage, progress = its default, visibility customer, title from translation) | `order.production_started` + Msg |
| T20 | `in_production`, `rework` | `completed` | S [`production.manage`] | Completion post with ≥ `workflow.require_completion_photos` photos (created in the same dialog: `production_updates.is_completion = true`, progress 100); all `order_issues` `open`/`in_progress` resolved or rejected (rework only) | `completed_at`; `production_progress = 100` | `order.completed` + Msg |
| T21 | `completed` | `ready_for_delivery` | C ("Looks good") | — | `customer_approved_at` | `order.customer_approved` + Msg |
| T22 | `completed` | `rework` | C ("Report an issue") | ≥ 1 issue created in the same request (description required, photos optional, item optional) | Issues `open` | `order.issue_raised` + Msg |
| T24 | `ready_for_delivery` | `delivered` | S [`production.manage`] | Delivery record: `delivered_at` required; `installed` flag; photos optional | `delivered_at` on order + delivery | `order.delivered` + Msg |
| T25 | `delivered` | `closed` | S [`orders.close`] or Sys after `workflow.auto_close_days` | No open issues | `closed_at`; unlock designs (`locked_by_order_id = null`) | `order.closed` + Msg |
| T26 | any Active except `on_hold` | `on_hold` | S [`orders.hold`] | Reason required | `state_before_hold = current`; Msg with reason | `order.on_hold` |
| T27 | `on_hold` | `state_before_hold` | S [`orders.hold`] | — | Clear `state_before_hold` | `order.resumed` + Msg |
| T28 | `submitted`, `in_review`, `changes_proposed`, `quoted`, `negotiating`, `accepted`, `confirmed`, `on_hold` | `cancelled` | S [`orders.cancel`] | Reason (enum) + note required | Sent quote → `withdrawn`; proposal sent/draft → `withdrawn`; unlock designs | `order.cancelled` + Msg |
| T29 | `submitted`, `in_review` | `cancelled` | C ("Withdraw request") | Reason optional | as T28 with `cancel_reason = customer_withdrew` | `order.cancelled` + Msg |
| T30 | `in_production`, `rework`, `completed`, `ready_for_delivery`, `delivered` | `cancelled` | S with role `owner` only | Reason + note | as T28 | `order.cancelled` + Msg |

Additional non-transition actions (allowed only in listed states):

| Action | States | Actor | Effect | Event |
|---|---|---|---|---|
| Assign / reassign estimator | any Active | S [`orders.assign`] | `assigned_to` | `order.assigned` (to new assignee) |
| Post production update | `confirmed`, `in_production`, `rework` | S [`production.manage`] | `production_updates` row; if visibility customer: update `production_progress`, `production_stage` | `order.production_update` (customer visibility only) |
| Log confirmation call | `accepted`, `confirmed` | S [`orders.confirm`] | `confirmation_calls` row; if `callback_requested`, schedule `CallbackReminder` notification to the staff at `callback_at` | `call.callback_due` (delayed) |
| Resolve issue | `rework` | S [`production.manage`] | issue `resolved`/`rejected` + note | `order.issue_resolved` |
| Schedule delivery | `ready_for_delivery` | S [`production.manage`] | `deliveries.scheduled_for` | `order.delivery_scheduled` |
| Create/edit quote draft | `in_review`, `negotiating` | S [`quotes.create`] | quote `draft` (only one draft per order at a time) | — |
| Create/edit proposal draft | `in_review` | S [`orders.propose_changes`] | proposal `draft` (one at a time) | — |
| Edit order items (add/remove/qty) | `draft` | C | — | — |
| Edit item quantity / staff notes | `in_review` | S [`orders.review`] | quantity change recorded in activity log + Msg to customer | `order.items_changed` |
| Post message | any except `cancelled` > 90 days, `closed` > 90 days | C, S [`messages.post`] | `messages` row | `message.posted` |
| Internal note | any | S [`messages.post`] | `messages.kind = internal_note` | — (staff in-app only) |

## 3. Design locking rules

- A furniture design may belong to **at most one Active order** at a time (enforced in T1/T2 with a `SELECT … FOR UPDATE` on the design rows).
- From T2 until the order reaches `draft` (T5), `closed` or `cancelled`, `furniture_designs.locked_by_order_id = order.id`. While locked:
  - Customer working-copy saves → 423.
  - Customer may **duplicate** the design (new design, unlocked, `working_document` copied from the pinned revision) to explore variants.
  - Staff change designs **only** through change-proposal drafts (`change_proposal_items.staff_draft_document`). There is no way for staff to silently edit a locked design. Pricing-only adjustments are made on the quote, not on the design.
- Placements of locked designs in plans remain movable (placements are plan data).

## 4. Change proposals in detail

1. Staff opens order in `in_review` → "Propose changes" → creates proposal `draft` (number n).
2. For each item staff wants to change: "Edit design in proposal" opens the furniture builder in **proposal mode** (route `admin.orders.proposals.items.edit`) loading `staff_draft_document ?? from_revision.document`. Autosave → `PUT /api/change-proposal-items/{item}/draft` (protocol 03 §5 with `staff_draft_version`). Builder shows a persistent banner "Proposal mode — the customer will review these changes".
3. Staff writes `staff_note` per item and an overall `message`.
4. Staff clicks **Preview** → server runs `diff-furniture` (engine CLI) for each item and returns `ChangeItem[]`; staff sees exactly what the customer will see (customer UI component rendered in preview).
5. **Send** (T6). Items with no actual changes (empty diff) are dropped from the proposal automatically; if none remain → 422 `proposal_empty`.
6. Customer view: per item, side-by-side 3D/elevation viewer (before | after toggle + "show differences" highlighting changed parts in amber, added in green, removed as red ghost), change list (major first), price impact (`price_changed` from server BOMs once ready; "calculating…" until both BOMs `ready`), staff note. Buttons: **Approve** / **Reject** (comment required). "Approve all" convenience button. Submitting decisions = T7 (all must be decided).
7. Rejected items: estimator sees comments, may create a new proposal (n+1).

## 5. Quotes in detail

- Built by `BuildQuoteDraft` action from the pinned revisions' server BOM/price (see `08` §6 for line generation rules). Staff can then edit lines (add/remove/reorder, change description, quantity, unit price, tax rate, visibility), set discount, `valid_until`, `lead_time_days`, notes, terms.
- Totals recomputed server-side on every save (`QuoteCalculator`); client shows live totals using the same formula (TS port in `resources/js/lib/quoteTotals.ts`, unit-tested against PHP with shared fixtures `tests/fixtures/quotes/*.json`).
- Sending (T9/T13) renders the PDF (`resources/views/pdf/quote.blade.php` via Gotenberg): business header + logo, customer + site address, quote number/date/validity, per-item section (thumbnail, name, dimensions, key materials, quantity, price), order-level lines, discount, tax breakdown, total, notes, terms, acceptance instructions + link. File name `Quote-{number}.pdf`.
- A `sent` quote is immutable. Any change = new version (`draft` → send → previous becomes `superseded`).
- Customer quote page: summary, line items, download PDF, history of versions (superseded shown collapsed with total delta), actions Accept (T10) / Negotiate (T11) / Decline (T14), countdown "Valid until … (n days left)". Expired: actions hidden, banner "This quote has expired; we're preparing an updated one".
- Reminder: `quote.expiring_soon` 2 days before `valid_until` (09:00 business TZ) if still `sent`.

## 6. Negotiation

- Customer counter-offer form: message (required, ≤ 2000 chars) + optional target total (currency input) + optional per-item comments (free text list).
- Only one `open` negotiation per quote at a time.
- Staff options: **Keep price** (T12, message required, optional new validity date) or **Revise quote** (opens quote builder pre-filled from current quote; send = T13).
- Round counter: number of negotiations on the order; when `max_negotiation_rounds` reached the customer's Negotiate button is replaced by "Contact us" (opens message thread).

## 7. Confirmation calls

- After T10 the order appears in the admin "To call" queue (dashboard widget + filter), sorted by `accepted_at`.
- Call dialog shows customer name, phone (click-to-call `tel:` link), preferred language/time notes, accepted quote total, items list.
- Staff logs outcome (§`confirmation_calls.outcome`). Outcome `confirmed` enables the **Mark confirmed** button (T16) — which requires `expected_delivery_on`. `customer_wants_changes` → T17. `customer_declined` → T18 (dialog pre-filled). `no_answer` increments a visible counter; after 3, "Cancel as unresponsive" becomes available (T18).
- Customer sees in their order timeline: "We tried to reach you on {date}" for `no_answer` (system message, with "Request a call back" button that posts a message `I'd like a call back at …` with a time picker).

## 8. Production

Default `workflow.production_stages` (admin-editable list; keys immutable once used):

| Key | Default progress | Label |
|---|---|---|
| `material_procurement` | 10 | Material procurement |
| `cutting` | 25 | Cutting |
| `edge_banding` | 40 | Edge banding |
| `drilling` | 50 | Drilling & machining |
| `finishing` | 65 | Finishing |
| `assembly` | 80 | Assembly |
| `quality_check` | 90 | Quality check |
| `packing` | 95 | Packing |

- Update form: stage (select, defaults to next stage), progress (slider, defaults to stage default, must be ≥ last customer-visible progress, ≤ 99 — 100 only via completion), title (default stage label), body, photos (≤ 20), visibility.
- Customer timeline shows customer-visible updates with photo galleries (lightbox), progress bar and current stage chip.
- Completion (T20): dialog "Mark as completed" with photos (≥ required), message; creates update with `is_completion = true`, stage `completed` (pseudo-stage), progress 100.

## 9. Completion review, rework, delivery, closing

- Customer completion page: completion photos gallery (large), per-item list with thumbnails of the design for comparison (design 3D thumbnail beside photos), buttons **Looks good** (T21) / **Report an issue** (T22: modal with description, item select, up to 10 photos).
- Rework: staff sees issues, posts production updates (stage free choice), resolves each issue (resolution note), then T20 again (new completion photos required).
- Delivery: staff schedules (`order.delivery_scheduled` notification with date/time window), then records delivery (T24).
- Problems reported after delivery: the customer writes in the message thread (there is no customer "report issue" button after `delivered`). Staff with `orders.close` may move the order `delivered` → `rework` by creating an issue on the customer's behalf (T31 below).
- Closing: T25.

| # | From | To | Actor | Pre-conditions | Side effects | Event |
|---|---|---|---|---|---|---|
| T31 | `delivered` | `rework` | S [`orders.close`] | Issue created by staff on behalf of customer (description required) | Issue `open` | `order.issue_raised` + Msg |

## 10. System message texts

System messages store `system_event` + `system_payload`; the UI renders `t('messages.system.' + system_event, payload)`. Required translation keys (en values in `resources/lang/en/messages.php` → `system` array), one per event in the tables above, e.g.:

- `order.submitted`: "Order {number} submitted with {count} item(s)."
- `order.review_started`: "{staff} started reviewing your order."
- `order.changes_proposed`: "{staff} proposed changes to {count} item(s). Please review."
- `order.changes_resolved`: "Changes reviewed: {approved} approved, {rejected} rejected."
- `quote.sent`: "Quote {quoteNumber} sent: {total}, valid until {validUntil}."
- `quote.negotiation_opened`: "Counter-offer received{targetTotal, select, null{} other{ (target {targetTotal})}}."
- `quote.accepted`: "Quote {quoteNumber} accepted."
- `order.confirmed`: "Order confirmed. Expected delivery: {date}."
- `order.production_started` / `order.production_update` / `order.completed` / `order.customer_approved` / `order.issue_raised` / `order.issue_resolved` / `order.delivery_scheduled` / `order.delivered` / `order.closed` / `order.cancelled` ("Order cancelled: {reason}") / `order.on_hold` ("Order on hold: {reason}") / `order.resumed` / `order.reopened` ("Order reopened for editing by the customer.") / `order.reopened_after_call` / `order.items_changed` / `order.changes_withdrawn` / `quote.declined` / `quote.expired` / `quote.negotiation_answered` / `call.no_answer` ("We tried to reach you on {date}.").

ICU message format is supported by the i18n library chosen in `15`.

## 11. Domain events (PHP classes in `App\Domain\Orders\Events`)

One event class per event key, all implementing `App\Domain\Shared\Contracts\NotifiableDomainEvent` with `eventKey(): string`, `order(): Order`, `actor(): ?User`, `payload(): array`. A single listener `RouteDomainEventToNotifications` (queued on `notify`) resolves recipients and dispatches the corresponding Notification class (`12`). A second listener `PostSystemMessage` (sync, after commit) writes the thread message. A third `BroadcastOrderStateChanged` broadcasts on `orders.{id}`.

Event keys (exhaustive for orders): `order.submitted`, `order.assigned`, `order.review_started`, `order.reopened`, `order.changes_proposed`, `order.changes_resolved`, `order.changes_withdrawn`, `order.items_changed`, `quote.sent`, `quote.negotiation_opened`, `quote.negotiation_answered`, `quote.accepted`, `quote.declined`, `quote.expiring_soon`, `quote.expired`, `order.reopened_after_call`, `order.confirmed`, `order.production_started`, `order.production_update`, `order.completed`, `order.customer_approved`, `order.issue_raised`, `order.issue_resolved`, `order.delivery_scheduled`, `order.delivered`, `order.closed`, `order.cancelled`, `order.on_hold`, `order.resumed`, `message.posted`, `call.callback_due`, `call.no_answer`, `reminder.action_required`.

## 12. Timeline (customer and staff)

Order page shows a vertical timeline merged from: state transitions (activity log, `event` = `order.*`), proposals, quotes, negotiations, calls (staff only; customer sees only `call.no_answer` system messages), production updates (internal ones staff only), issues, delivery. Implemented by `OrderTimelineQuery` returning a typed list of `TimelineEntryData` (kind, at, actor, title key, params, links) — customer variant filters internal entries.

## 13. SLA & reminders

- `orders:remind-pending` daily 09:00 business TZ:
  - Customer: proposals `sent` and quotes `sent` older than `workflow.reminder_after_hours`, and `completed` orders without review (48 h, 7 d) → `reminder.action_required` (max one reminder per order per 48 h, tracked in `cache` key `reminder:{order}:{date}`).
  - Staff (assignee, or all `orders.review` holders if unassigned): `submitted` > 24 h not picked up, `negotiating` > 24 h unanswered, `accepted` > 24 h without a call log → included in daily staff digest email (`notifications.staff_digest_hour`).
- Admin dashboard shows the same "Needs attention" lists live.
