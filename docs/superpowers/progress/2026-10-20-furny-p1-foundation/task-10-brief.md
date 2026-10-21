### Task 10: Orders schema A (orders, items, change proposals) and order states

**Files:**
- Create: migrations `2026_10_20_080000_create_orders_table`, `_080100_create_order_items_table`, `_080200_create_change_proposals_table`, `_080300_create_change_proposal_items_table`; `app/Domain/Orders/Models/{Order,OrderItem,ChangeProposal,ChangeProposalItem}.php`; `app/Domain/Orders/States/{OrderState,Draft,Submitted,InReview,ChangesProposed,Quoted,Negotiating,Accepted,Confirmed,InProduction,Completed,Rework,ReadyForDelivery,Delivered,Closed,Cancelled,OnHold}.php`; `app/Domain/Orders/Enums/{OrderStateKey,CancelReason,ChangeProposalStatus,ProposalItemDecision}.php`; factories
- Modify: `User` (`orders()`), `Project` (`orders()`), `MorphMap`
- Test: `tests/Feature/Schema/OrdersSchemaATest.php`, `tests/Feature/Models/OrderTest.php`

**Spec refs:** `02 §8.1–§8.4`, `§11`, `§12`, `§15` group 8; `09 §1` (states, Active/terminal); master §6.3, D14; P1-D7

**Interfaces:**
- Consumes: Tasks 4–9, `OrderNumber`.
- Produces: `OrderState` (abstract spatie state, default `Draft`, no transitions) and 16 final state classes with `public static string $name` = `draft, submitted, in_review, changes_proposed, quoted, negotiating, accepted, confirmed, in_production, completed, rework, ready_for_delivery, delivered, closed, cancelled, on_hold`; `OrderState::isActive(): bool` (not draft/closed/cancelled), `isTerminal(): bool` (closed/cancelled); `OrderStateKey` backed enum with the same 16 values (`#[TypeScript]`, used by TS types and i18n patterns); `Order` (SoftDeletes, `HasStates`; casts `state: OrderState`, dates immutable, `needs_installation: bool`; `creating` sets `number = OrderNumber::draft($id)` when empty; `isDraftNumber(): bool`; relations `project, customer, assignee, productionAssignee, siteAddress, items, changeProposals`); `OrderItem`, `ChangeProposal`, `ChangeProposalItem` (`staff_draft_document` → `AsJsonDocument`, `changes` → array, `decision` enum); enums `CancelReason` (7 of `02 §8.1`), `ChangeProposalStatus` (`draft, sent, resolved, withdrawn`), `ProposalItemDecision` (`pending, approved, rejected`). `OrderFactory::inState(string $stateClass)` sets the state, `state_changed_at`, matching milestone timestamps and a real `ORD-` number for every state except never-submitted drafts; `OrderFactory::withItems(int $count = 1)`.

- [ ] **Step 1: Write the failing tests**
  - `OrdersSchemaATest`: columns per `02 §8.1–§8.4` (incl. `state_changed_at` default `now()`, `state` default `'draft'`, `production_progress` default 0, `needs_installation` default true); unique `orders.number`; indexes `(state, updated_at)`, `(state, state_changed_at)`, `(customer_id, created_at)`, `(assigned_to, state)`; unique `order_items(order_id, furniture_design_id)`, `change_proposals(order_id, number)`, `change_proposal_items(change_proposal_id, order_item_id)`; `accepted_quote_id`/`current_quote_id` columns exist without FKs yet.
  - `OrderTest`: dataset over the 16 state classes — `Order::factory()->inState($c)->create()->fresh()->state` is an instance of `$c` and `->getValue()` equals its `$name`; `isActive()` true for exactly the 13 non-draft/closed/cancelled states; a new order without number gets `DRAFT-` + last 8 chars of its id; `array_column(OrderStateKey::cases(), 'value')` equals the 16 `$name`s; deleting an order cascades items and proposals; deleting a furniture design referenced by an order item throws (R).
- [ ] **Step 2: Run, expect FAIL** — `vendor/bin/pest tests/Feature/Schema/OrdersSchemaATest.php tests/Feature/Models/OrderTest.php`
- [ ] **Step 3: Implement** — per Files/Interfaces.
- [ ] **Step 4: Run tests, expect PASS** — same as Step 2.
- [ ] **Step 5: Quality gates** — Gates-PHP, Gates-Gen.
- [ ] **Step 6: Commit** — `git add database/migrations app/Domain/Orders database/factories app/Domain/Identity/Models/User.php app/Domain/Projects/Models/Project.php app/Support/MorphMap.php tests resources/js` → `feat(orders): orders, items and change proposals schema with order states` + trailer.

