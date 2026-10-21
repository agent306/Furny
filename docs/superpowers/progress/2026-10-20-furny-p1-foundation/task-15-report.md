# Task 15 report: Policies B (orders, quotes, change proposals, messages)

Status: DONE_WITH_CONCERNS (design decisions below for the reviewer). Commit: 161fdf5 `feat(auth): order, quote, change proposal and message policies` (base 0ac01d5).

## Implemented
- `app/Policies/OrderPolicy.php`, `QuotePolicy.php`, `ChangeProposalPolicy.php`, `MessagePolicy.php`, all per the brief's interface lists.
- New shared concern `app/Policies/Concerns/ChecksOrderOwnership.php` (mirrors `ChecksProjectOwnership`): `ownsOrder`, `orderOf` (soft-deleted order fallback), `ownerOrStaffCan`, `staffCanOnly`, `ownerOnly`, `ownerOnceVisibleOrStaffCan`.
- Ownership: 02 §8.1 and 13 §8 both say `orders.customer_id` (not through the project); used directly. `ownsOrder` requires `isCustomer()` so staff never get the "own" grant.
- Docblock on `ProjectPolicy` saying archiving and trashing are not checked by policies (P4/P5/P6 controllers refuse writes).
- Lang: `messages.errors.thread_closed`, `messages.errors.edit_window` (text from 10 §872), `quotes.errors.not_draft`; `contact_unverified` reuses `common.verify_required`. `i18n:export` output committed.
- Tests: `OrderPolicyTest`, `QuotePolicyTest`, `ChangeProposalPolicyTest`, `MessagePolicyTest` (new), `StaffChecksTest` extended (inactive staff called directly on the new policies), `PolicyActors` gained `ESTIMATORS` and `staffOnly()`.

## Decisions and spec readings (please check)
1. Denial codes: non-owner customer 404 decided first (before any state/status check); owner customer on staff-only ability 403; staff without permission 403; inactive staff null (Gate::before).
2. `OrderPolicy::viewAny`: customers get 403 (spec: only S[orders.view]; customers use their scoped list). ProjectPolicy::viewAny allows customers; this one deliberately does not.
3. `OrderPolicy::create(User, Project)`: no order exists yet, so ownership is the project's `owner_id` (customer only). Call as `inspect('create', [Order::class, $project])`.
4. `submit`: the `verified.contact` of 13 §8.5 is the route middleware (14 line 355), not checked in the policy (brief lists submit as plain owner-only).
5. Draft quote / draft change proposal viewed by its own customer: 404 (draft is staff-internal, existence hidden), not 403. Staff with orders.view see drafts. Brief only says "denied".
6. `QuotePolicy::update/delete` on a non-draft quote (staff holding quotes.create): 403 with code `quote_not_draft` (`quotes.errors.not_draft`). 14 has no such code (only 409 `proposal_not_draft`); 13 §8 preamble says policy denials are 403. P7 may map it to 409 if wanted.
7. `MessagePolicy::viewThread/create/createInternalNote` take `(User, Order)`, so they are called as `Gate::inspect('viewThread', [Message::class, $order])` (a bare `$order` would resolve OrderPolicy).
8. `create` check order: access (404/403) -> thread closed (422 `thread_closed`) -> unverified contact (403 `contact_unverified`). Thread-closed applies to staff `text` replies too (14 line 449) but not to internal notes. Verifying cannot reopen a closed thread, hence closed is told first.
9. `thread_closed`: state `cancelled`/`closed` and `cancelled_at`/`closed_at` strictly more than 90 days ago (exactly 90 days is still open; 90 days + 1 s closed). Null timestamp = open. Pinned with `travelTo(CarbonImmutable)` at 89, 90, 90d+1s, 91 days for both states.
10. Edit window: 13 §8.8 says `created_at > now() - 10 min`, so exactly 10:00 is DENIED (spec is explicit; not silent). Tested at 9:00, 9:59, 10:00, 11:00. Expired window answers 422 `edit_window` (14 lines 372/450; `messages.errors.edit_window`). Non-author / non-`text` kind (system, internal_note) / author who lost `messages.post` (staff) = 403; stranger 404. Delete uses the same rules.
11. Policy ability names: none equals a permission string; a test asserts this for all four policies.

## TDD evidence
- RED: `vendor/bin/pest tests/Feature/Policies` before the policies existed: `Tests: 466 failed, 390 passed` (new abilities denied by default, "Failed asserting that two arrays are identical" for the expected allow/status pairs).
- GREEN: first run after implementation had 9 failures, all my test calling `viewThread` with a bare Order (resolves OrderPolicy); fixed the test to `[Message::class, $order]`. Then `Tests: 856 passed (1089 assertions)`.
- Mutation check: flipping `lte`->`lt` (edit window) and `lt`->`lte` (thread closed) makes 3 MessagePolicyTest cases fail; restored.

## Gates
- `vendor/bin/pint --test`: passed. `vendor/bin/phpstan analyse` level 8: No errors.
- `vendor/bin/pest tests/Unit tests/Feature`: 1653 passed (5886 assertions), output pristine.
- Gates-Gen: `typescript:transform` + `i18n:export` run; only `resources/js/lang/generated/{en,manifest}.json` changed (committed); `generated.d.ts` unchanged.
- Gates-JS not run (no JS touched).

## Files
app/Policies/{OrderPolicy,QuotePolicy,ChangeProposalPolicy,MessagePolicy}.php, app/Policies/Concerns/ChecksOrderOwnership.php, app/Policies/ProjectPolicy.php (docblock), resources/lang/en/{messages,quotes}.php, resources/js/lang/generated/{en,manifest}.json, tests/Feature/Policies/{Order,Quote,ChangeProposal,Message}PolicyTest.php, tests/Feature/Policies/StaffChecksTest.php, tests/Support/PolicyActors.php.

## Self-review
- Public policy methods on the 4 classes are exactly the brief's abilities; `editItems`, `withdrawProposal`, etc. delegate to one permission check.
- Test helper functions `orderAbilityRows`/`quoteAbilityRows` are global Pest-file functions (unique names, no collisions).
- Carry for P7: ownership-reassign (not applicable to orders) none; controllers must still do 409 state checks; customer routes for quote/proposal show should treat the 404 for drafts as the canonical response.

## Fix round 1 (5497c23 fix(auth): hide draft quotes and proposals from owners on every ability, fail closed on missing close dates)
Worked in /home/user/furny-p1 (branch build/p1-foundation) where commit 161fdf5 lives; /home/user/furny-p2 is another branch (build/p2-engine) and was not touched.

Changes:
0. `QuotePolicy` update/delete on a non-draft quote: 422 `quote_not_draft` (was 403). Test updated.
1. Draft hiding for every ability: `ChecksOrderOwnership::hiddenFromOwner()` runs first in `ownerOrStaffCan`, `staffCanOnly` and `ownerOnly`; the owner of a draft Quote/ChangeProposal gets 404 for view, downloadPdf, viewCosts, send, update, delete, accept/negotiate/decline, all proposal staff abilities and decide. Staff unchanged. `ownerOnceVisibleOrStaffCan` removed (now redundant). New datasets via `PolicyActors::staffOnlyDraft()` / `hiddenDraft()`; plus tests that a non-draft keeps 403 for the owner on staff abilities.
2. Staff never own: tests flip the order's customer to `type=staff` and assert denial for Order (view, viewInternal, acceptQuote, submit, withdraw), Quote (accept, view), ChangeProposal (decide, view), Message (viewThread, create, update). Mutation check: dropping `isCustomer()` from `ownsOrder` makes 4 tests fail (killed); restored.
3. Soft-deleted order: new tests for Message viewThread/update/delete and ChangeProposal view/decide (customer allowed, stranger 404). `orderOf` docblock now says route-model binding must keep excluding trashed orders because owner abilities still pass on a trashed order.
4. `OrderPolicy::create(User, ?Project = null)`: null project denies (403 for everyone); test covers `inspect` and `$user->can('create', Order::class)` for a customer and staff, no exception.
5. `MessagePolicy` thread-closed: a closed/cancelled order with null `closed_at`/`cancelled_at` now fails closed (422 `thread_closed`); test for both states.

Verification: `vendor/bin/pest tests/Unit tests/Feature`: 1714 passed (5967 assertions), pristine; policies suite 918 passed. `vendor/bin/pint --test` passed; `vendor/bin/phpstan analyse` No errors; `i18n:export` produced no diff.
