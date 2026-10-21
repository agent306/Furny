<?php

declare(strict_types=1);

namespace App\Policies;

use App\Domain\Identity\Enums\OwnerGate;
use App\Domain\Identity\Enums\PermissionName;
use App\Domain\Identity\Models\User;
use App\Domain\Orders\Models\Order;
use App\Domain\Projects\Models\Project;
use App\Policies\Concerns\ChecksOrderOwnership;
use Illuminate\Auth\Access\Response;
use Illuminate\Support\Facades\Gate;

/**
 * 13 §8.5: "may this user attempt it". The state of the order is not looked at; the state machine
 * answers 409 `invalid_transition` (09, P7). Customers act on their own orders (`orders.customer_id`),
 * staff through permissions; there is no blanket owner pass (13 §7.3).
 */
final class OrderPolicy
{
    use ChecksOrderOwnership;

    /** Staff list; customers have their own scoped list and no use for this ability. */
    public function viewAny(User $user): Response
    {
        return $this->allowOrDeny($this->staffCan($user, PermissionName::OrdersView), $user, ownsRecord: true);
    }

    public function view(User $user, Order $order): Response
    {
        return $this->ownerOrStaffCan($user, $order, PermissionName::OrdersView);
    }

    /** Internal notes, internal production updates, confirmation calls and cost data. */
    public function viewInternal(User $user, Order $order): Response
    {
        return $this->staffCanOnly($user, $order, PermissionName::OrdersView);
    }

    /** T1: a customer orders from a project of their own. */
    public function create(User $user, Project $project): Response
    {
        $own = $user->isCustomer() && $project->owner_id === $user->id;

        return $this->allowOrDeny($own, $user, $own);
    }

    public function updateDraftItems(User $user, Order $order): Response
    {
        return $this->ownerOnly($user, $order);
    }

    public function deleteDraft(User $user, Order $order): Response
    {
        return $this->ownerOnly($user, $order);
    }

    /** T2. The verified contact is required by the route's `verified.contact` middleware (14). */
    public function submit(User $user, Order $order): Response
    {
        return $this->ownerOnly($user, $order);
    }

    public function cancelDraft(User $user, Order $order): Response
    {
        return $this->ownerOnly($user, $order);
    }

    public function reopen(User $user, Order $order): Response
    {
        return $this->ownerOnly($user, $order);
    }

    public function acceptQuote(User $user, Order $order): Response
    {
        return $this->ownerOnly($user, $order);
    }

    public function negotiate(User $user, Order $order): Response
    {
        return $this->ownerOnly($user, $order);
    }

    public function declineQuote(User $user, Order $order): Response
    {
        return $this->ownerOnly($user, $order);
    }

    public function approveCompletion(User $user, Order $order): Response
    {
        return $this->ownerOnly($user, $order);
    }

    public function reportIssue(User $user, Order $order): Response
    {
        return $this->ownerOnly($user, $order);
    }

    public function withdraw(User $user, Order $order): Response
    {
        return $this->ownerOnly($user, $order);
    }

    public function requestCallback(User $user, Order $order): Response
    {
        return $this->ownerOnly($user, $order);
    }

    public function review(User $user, Order $order): Response
    {
        return $this->staffCanOnly($user, $order, PermissionName::OrdersReview);
    }

    public function editItems(User $user, Order $order): Response
    {
        return $this->review($user, $order);
    }

    public function assign(User $user, Order $order): Response
    {
        return $this->staffCanOnly($user, $order, PermissionName::OrdersAssign);
    }

    public function proposeChanges(User $user, Order $order): Response
    {
        return $this->staffCanOnly($user, $order, PermissionName::OrdersProposeChanges);
    }

    public function withdrawProposal(User $user, Order $order): Response
    {
        return $this->proposeChanges($user, $order);
    }

    public function createQuote(User $user, Order $order): Response
    {
        return $this->staffCanOnly($user, $order, PermissionName::QuotesCreate);
    }

    public function sendQuote(User $user, Order $order): Response
    {
        return $this->staffCanOnly($user, $order, PermissionName::QuotesSend);
    }

    public function answerNegotiation(User $user, Order $order): Response
    {
        return $this->sendQuote($user, $order);
    }

    public function logCall(User $user, Order $order): Response
    {
        return $this->staffCanOnly($user, $order, PermissionName::OrdersConfirm);
    }

    public function confirm(User $user, Order $order): Response
    {
        return $this->logCall($user, $order);
    }

    public function reopenAfterCall(User $user, Order $order): Response
    {
        return $this->logCall($user, $order);
    }

    public function cancel(User $user, Order $order): Response
    {
        return $this->staffCanOnly($user, $order, PermissionName::OrdersCancel);
    }

    /** T30: cancelling an order that is in production or later is for the `owner` role only (13 §7.3). */
    public function cancelLate(User $user, Order $order): Response
    {
        return $this->allowOrDeny(Gate::forUser($user)->allows(OwnerGate::OrdersCancelLate->value), $user, $this->ownsOrder($user, $order));
    }

    public function hold(User $user, Order $order): Response
    {
        return $this->staffCanOnly($user, $order, PermissionName::OrdersHold);
    }

    public function resume(User $user, Order $order): Response
    {
        return $this->hold($user, $order);
    }

    /** Start and finish production, production updates, issue resolution, delivery scheduling and delivery. */
    public function manageProduction(User $user, Order $order): Response
    {
        return $this->staffCanOnly($user, $order, PermissionName::ProductionManage);
    }

    public function close(User $user, Order $order): Response
    {
        return $this->staffCanOnly($user, $order, PermissionName::OrdersClose);
    }

    public function raiseIssueOnBehalf(User $user, Order $order): Response
    {
        return $this->close($user, $order);
    }
}
