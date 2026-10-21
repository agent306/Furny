### Task 11: Orders schema B (quotes … payments, deferred FKs)

**Files:**
- Create: migrations `2026_10_20_080400_create_quotes_table`, `_080500_create_quote_lines_table`, `_080600_create_quote_negotiations_table`, `_080700_create_confirmation_calls_table`, `_080800_create_production_updates_table`, `_080900_create_order_issues_table`, `_081000_create_deliveries_table`, `_081100_create_payments_table`, `_081200_add_order_foreign_keys`; `app/Domain/Orders/Models/{Quote,QuoteLine,QuoteNegotiation,ConfirmationCall,ProductionUpdate,OrderIssue,Delivery,Payment}.php`; `app/Domain/Orders/Enums/{QuoteStatus,QuoteLineKind,NegotiationStatus,CallOutcome,ProductionVisibility,IssueStatus,PaymentKind,PaymentMethod,PaymentStatus,PaymentGateway}.php`; factories
- Modify: `Order` (relations `quotes, negotiations, confirmationCalls, productionUpdates, issues, delivery, acceptedQuote, currentQuote, messages` — `messages` in Task 12), `FurnitureDesign` (`lockedByOrder()`), `MorphMap`
- Test: `tests/Feature/Schema/OrdersSchemaBTest.php`, `tests/Feature/Models/QuoteTest.php`

**Spec refs:** `02 §8.5–§8.12`, `§10`, `§11`, `§15` group 8 (deferred FKs); master §6.3 (quote number), D16

**Interfaces:**
- Consumes: Task 10.
- Produces: models with casts (money `int`, `quantity` decimal string, `tax_breakdown`/`cost_snapshot`/`details`/`item_comments` array, `accepted_by_ip` string, enums, dates); `Quote::creating` sets `number = QuoteNumber::for($order->number, $version)` when empty; media `Quote.pdf` (s3 single pdf), `ProductionUpdate.photos`/`OrderIssue.photos`/`Delivery.photos` (s3, conversions `thumb` 400w and `large` 1600w); `Payment` with casts only; enums `QuoteStatus` (`draft, sent, accepted, declined, superseded, expired, withdrawn`), `QuoteLineKind` (9), `NegotiationStatus` (4), `CallOutcome` (6), `ProductionVisibility` (`customer, internal`), `IssueStatus` (4), `PaymentKind` (4), `PaymentMethod` (6), `PaymentStatus` (4), `PaymentGateway` (`razorpay, stripe`). Factory states: `Quote::sent()`, `accepted()`; `QuoteLine::discount()`; `ProductionUpdate::internal()`, `completion()`; `ConfirmationCall::outcome(CallOutcome)`.

- [ ] **Step 1: Write the failing tests**
  - `OrdersSchemaBTest`: columns per `02 §8.5–§8.12`; uniques `quotes(order_id, version)`, `quotes(number)`, `deliveries(order_id)`; partial unique `quotes(order_id) WHERE status = 'sent'` (a second sent quote for the same order throws); index `production_updates(order_id, created_at)`; `quotes.accepted_by_ip` is `inet`; FKs from `_081200`: deleting a quote nulls `orders.accepted_quote_id`/`current_quote_id`; deleting an order nulls `furniture_designs.locked_by_order_id`; deleting an order that has payments throws (R).
  - `QuoteTest`: `Quote::factory()->for($order)->create(['version' => 2])->number === $order->number.'-Q2'`; `QuoteLine` discount state has `unit_price_minor <= 0` and `tax_rate_id null`; `Payment::factory()->create()` round-trips casts.
- [ ] **Step 2: Run, expect FAIL** — `vendor/bin/pest tests/Feature/Schema/OrdersSchemaBTest.php tests/Feature/Models/QuoteTest.php`
- [ ] **Step 3: Implement** — per Files/Interfaces.
- [ ] **Step 4: Run tests, expect PASS** — same as Step 2.
- [ ] **Step 5: Quality gates** — Gates-PHP, Gates-Gen.
- [ ] **Step 6: Commit** — `git add database/migrations app/Domain/Orders app/Domain/Furniture/Models/FurnitureDesign.php database/factories app/Support/MorphMap.php tests resources/js` → `feat(orders): quotes, negotiations, calls, production, issues, deliveries and payments schema` + trailer.

