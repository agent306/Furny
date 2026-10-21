# Task 10 report: orders schema A and order states

Status: DONE_WITH_CONCERNS (two small notes below, neither blocks)

## Implemented
- Migrations `2026_10_20_080000_create_orders_table`, `_080100_create_order_items_table`, `_080200_create_change_proposals_table`, `_080300_create_change_proposal_items_table`, exactly per 02 §8.1-§8.4 (columns, lengths, defaults, indexes, uniques, FK actions).
  - `orders.state_changed_at` default `now()`; `accepted_quote_id` / `current_quote_id` are plain `char(26)` columns without FKs (Task 11).
  - FK actions: orders project R, customer R, assigned_to N, production_assignee_id N, site_address_id N; order_items order C, design R, revision R; change_proposals order C, created_by R; change_proposal_items proposal C, order_item C, from_revision R, to_revision R.
- Models `Order` (SoftDeletes, HasStates, `creating` hook sets `DRAFT-` + last 8 id chars when number blank, `isDraftNumber()`, 7 relations), `OrderItem`, `ChangeProposal`, `ChangeProposalItem`. Fillable lists contain only customer/staff-typed fields (Order: title, customer_notes, needs_installation, preferred_delivery_on; OrderItem: quantity, room_label, customer_notes; ChangeProposal: message; ChangeProposalItem: staff_draft_document, staff_note). Owner, project, number, state, milestones, assignees, decisions are not mass-assignable (tested).
- `OrderState` (abstract, default `Draft`, no transitions; `key()`, `isActive()`, `isTerminal()`) + 16 final state classes with `$name`; enums `OrderStateKey` (16, `#[TypeScript]`), `CancelReason` (7), `ChangeProposalStatus`, `ProposalItemDecision` (all `#[TypeScript]`). `generated.d.ts` regenerated and committed.
- `User::orders()` (customer_id), `Project::orders()`, `MorphMap` aliases `order`, `order_item`, `change_proposal`, `change_proposal_item`.
- Factories (in `database/factories/Domain/Orders/`): `OrderFactory` (`inState`, `onHoldFrom`, `withItems`), `OrderItemFactory` (`pinned`), `ChangeProposalFactory` (`sent/resolved/withdrawn`, auto number per order), `ChangeProposalItemFactory` (`withStaffDraft/proposed/approved/rejected`). Owners resolve through callables so `for($project)` works (customer from project; item design in the order's project; from_revision from the item's pinned revision).

## Choices to note
- Casts: `changes` is a plain `array` cast (brief; same as `furniture_revisions.change_summary`). `staff_draft_document` uses `AsJsonDocument`. No `AsJsonMap` needed: no jsonb column here has a `'{}'` default. Parallel to the P6 ruling: ChangeItem.params is a Record that can be empty, so `{}` inside `changes` becomes `[]` on a round trip. Harmless for display; if P5 wants it lossless, switch the one cast to `AsJsonDocument`.
- Extra casts beyond the brief, per 02 §12 "enum columns to backed enums": `orders.cancel_reason` -> `CancelReason`, `orders.state_before_hold` -> `OrderStateKey`, `*_on` columns -> `immutable_date`.
- `inState` timestamps: milestone n is set `11 - n` hours before now (strictly increasing, none in the future). `state_changed_at` = the state's own milestone, or +30 min for the in-between states (changes_proposed, negotiating, rework) and the hold. Real `ORD-YYYY-NNNNN` (via `OrderNumber::next`) for every state except `Draft`. cancelled: submitted_at + cancelled_at + `cancel_reason = staff_cancelled`. `inState(OnHold)` holds from `in_review`; `onHoldFrom($class)` holds from any other active state and sets `state_before_hold`. confirmed+ states get `expected_delivery_on` (+30 days, per T16); completed+ states get `production_progress = 100` (T20).
- `withItems` pins an `order_submitted` revision on each item once the order has `submitted_at`; it does not set `furniture_designs.locked_by_order_id` or `current_revision_id` (the lock FK and the actions belong to Task 11 / P5).
- No DB CHECK for `production_progress` 0-100 or `quantity` 1-99: 02 lists them as notes, not constraints; validation belongs to the actions.

## Tests
- `tests/Feature/Schema/OrdersSchemaATest.php`: columns/types/nullability for all 4 tables, defaults, 5 order indexes, 3 unique indexes, no FK on the two quote ids, all 14 FK actions plus referenced tables via pg_constraint.
- `tests/Feature/Models/OrderTest.php`: 16-state dataset round trip (`fresh()->state` instance of class, `getValue()` equals `$name`, DB value), exactly 13 active and terminal = closed/cancelled, no-transition behaviour (`CouldNotPerformTransition`), enum values vs the 16 names, DRAFT- number, ORD- for every non-draft state, milestone set and ordering per state (16 rows), hold/cancel details, expected delivery/progress, `for($project)` customer resolution, relations, fillable exclusions, withItems, proposal numbering/states/items, JSON round trips, uniques, cascades (forceDelete order cascades items, proposals, proposal items; soft delete keeps them), all R FKs, all N FKs, morph aliases.
- R-FK isolation: every R test asserts the constraint name in the exception message (`order_items_furniture_design_id_foreign`, `order_items_furniture_revision_id_foreign`, `change_proposal_items_from_revision_id_foreign`, `..._to_revision_id_foreign`, `orders_project_id_foreign`, `orders_customer_id_foreign`, `change_proposals_created_by_foreign`), so no other FK can satisfy them by accident. The design delete uses an unpinned item (otherwise the cascade to the design's revisions would also hit the revision FK); the customer test gives the order to a customer who owns no project; the from/to revision tests use unpinned items and standalone revisions. The design test runs in a savepoint to assert state after the refusal.

### TDD evidence
- RED: `vendor/bin/pest tests/Feature/Schema/OrdersSchemaATest.php tests/Feature/Models/OrderTest.php` before any implementation: `Tests: 111 failed (24 assertions)`, e.g. `Class "App\Domain\Orders\Models\Order" not found` (models, tables and states did not exist, as expected).
- GREEN: after implementation, same command: 111 passed; after adding the hold-guard test: OrderTest 91 passed, schema 24 passed.
- Full gates: `vendor/bin/pint --test` passed; `vendor/bin/phpstan analyse` 0 errors (level 8); `vendor/bin/pest tests/Unit tests/Feature` -> `Tests: 545 passed (3461 assertions)` before the last added test (+4 datasets since, OrderTest re-run green); Gates-Gen: `typescript:transform` + `i18n:export` run, only `resources/js/types/generated.d.ts` changed (committed), `resources/js/lang/generated` unchanged.

## Files
Created: 4 migrations; `app/Domain/Orders/Models/{Order,OrderItem,ChangeProposal,ChangeProposalItem}.php`; `app/Domain/Orders/States/` (OrderState + 16); `app/Domain/Orders/Enums/{OrderStateKey,CancelReason,ChangeProposalStatus,ProposalItemDecision}.php`; `database/factories/Domain/Orders/{Order,OrderItem,ChangeProposal,ChangeProposalItem}Factory.php`; the two test files.
Modified: `User.php`, `Project.php`, `MorphMap.php`, `resources/js/types/generated.d.ts`.

## Self-review
- Reread the diff against 02 §8 column by column; checked no extra/missing columns via the exact column-list assertions.
- `OrderState` directory scan finds only subclasses (tested: mapping keys equal the 16 names). `.gitkeep` files left in place like other domains.
- Notes: the migrations' comment points to Task 11 for the quote FKs; `OrderState::key()` is an addition beyond the brief (used by `isActive`/`isTerminal`).
