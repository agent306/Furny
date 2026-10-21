### Task 15: Policies B (orders, quotes, change proposals, messages)

**Files:**
- Create: `app/Policies/{OrderPolicy,QuotePolicy,ChangeProposalPolicy,MessagePolicy}.php`
- Test: `tests/Feature/Policies/OrderPolicyTest.php`, `QuotePolicyTest.php`, `ChangeProposalPolicyTest.php`, `MessagePolicyTest.php`

**Spec refs:** `13 §8.5–§8.8`; `09 §1` (state names); master D18

**Interfaces:**
- Consumes: Task 14 `AuthorizesStaff`; order models (Tasks 10–12).
- Produces:
  - `OrderPolicy`: `viewAny` (`orders.view`), `view` (own or `orders.view`), `viewInternal` (`orders.view`); owner-only abilities `create, updateDraftItems, deleteDraft, submit, cancelDraft, reopen, acceptQuote, negotiate, declineQuote, approveCompletion, reportIssue, withdraw, requestCallback`; staff abilities `review, editItems` (`orders.review`), `assign` (`orders.assign`), `proposeChanges, withdrawProposal` (`orders.propose_changes`), `createQuote` (`quotes.create`), `sendQuote, answerNegotiation` (`quotes.send`), `logCall, confirm, reopenAfterCall` (`orders.confirm`), `cancel` (`orders.cancel`), `cancelLate` (gate `orders.cancel_late`), `hold, resume` (`orders.hold`), `manageProduction` (`production.manage`), `close, raiseIssueOnBehalf` (`orders.close`). State rules are **not** checked here (P7 state machine).
  - `QuotePolicy`: `view|downloadPdf` ((own order AND status ≠ draft) or `orders.view`), `viewCosts` (`quotes.view_costs`), `create|update|delete` (`quotes.create`; update/delete only drafts), `send` (`quotes.send`), `accept|negotiate|decline` (own order).
  - `ChangeProposalPolicy`: `view` ((own AND status ≠ draft) or `orders.view`), `create|update|send|withdraw|addItem|removeItem|updateItemDraft` (`orders.propose_changes`), `decide` (own order).
  - `MessagePolicy`: `viewThread(User, Order)`, `create(User, Order)` ((own AND verified contact) or `messages.post`; 422 code `thread_closed` when the order is `cancelled`/`closed` and `cancelled_at`/`closed_at` is more than 90 days ago), `createInternalNote(User, Order)` (`messages.post`), `update|delete(User, Message)` (author AND kind `text` AND created < 10 min ago).

- [ ] **Step 1: Write the failing tests** — datasets as in Task 14: production may `manageProduction` and `hold` but not `cancel`; support may `logCall`/`confirm` but not `createQuote`; only owner passes `cancelLate`; customer A gets 404 on customer B's order `view`; customer may `view` a `sent` quote of own order but not a `draft` one; production `view` on quote allowed (orders.view) but `viewCosts` denied; estimator `viewCosts` allowed; `ChangeProposalPolicy::view` draft denied for owner-customer; `MessagePolicy::create` denied for unverified customer, allowed for verified, 422 `thread_closed` for an order closed 91 days ago and allowed for one closed 89 days ago; `update` of own text message allowed at 9 min, denied at 11 min, denied for a `system` message.
- [ ] **Step 2: Run, expect FAIL** — `vendor/bin/pest tests/Feature/Policies`
- [ ] **Step 3: Implement** — per Interfaces.
- [ ] **Step 4: Run tests, expect PASS** — `vendor/bin/pest tests/Feature/Policies`
- [ ] **Step 5: Quality gates** — Gates-PHP.
- [ ] **Step 6: Commit** — `git add app/Policies tests/Feature/Policies` → `feat(auth): order, quote, change proposal and message policies` + trailer.

