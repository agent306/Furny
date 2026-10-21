<?php

declare(strict_types=1);

namespace App\Policies;

use App\Domain\Identity\Enums\PermissionName;
use App\Domain\Identity\Models\User;
use App\Domain\Orders\Enums\ChangeProposalStatus;
use App\Domain\Orders\Models\ChangeProposal;
use App\Domain\Orders\Models\Order;
use App\Policies\Concerns\ChecksOrderOwnership;
use Illuminate\Auth\Access\Response;

/**
 * 13 §8.7. A customer owns a proposal through its order; a draft proposal is staff-internal, so the
 * customer is told 404 for it. Whether the proposal is still open is the state machine's call (09, P7).
 */
final class ChangeProposalPolicy
{
    use ChecksOrderOwnership;

    public function view(User $user, ChangeProposal $proposal): Response
    {
        return $this->ownerOnceVisibleOrStaffCan($user, $proposal, $proposal->status !== ChangeProposalStatus::Draft, PermissionName::OrdersView);
    }

    public function create(User $user, Order $order): Response
    {
        return $this->staffCanOnly($user, $order, PermissionName::OrdersProposeChanges);
    }

    public function update(User $user, ChangeProposal $proposal): Response
    {
        return $this->staffCanOnly($user, $proposal, PermissionName::OrdersProposeChanges);
    }

    public function send(User $user, ChangeProposal $proposal): Response
    {
        return $this->update($user, $proposal);
    }

    public function withdraw(User $user, ChangeProposal $proposal): Response
    {
        return $this->update($user, $proposal);
    }

    public function addItem(User $user, ChangeProposal $proposal): Response
    {
        return $this->update($user, $proposal);
    }

    public function removeItem(User $user, ChangeProposal $proposal): Response
    {
        return $this->update($user, $proposal);
    }

    public function updateItemDraft(User $user, ChangeProposal $proposal): Response
    {
        return $this->update($user, $proposal);
    }

    /** T7: the customer accepts or rejects the proposed changes item by item. */
    public function decide(User $user, ChangeProposal $proposal): Response
    {
        return $this->ownerOnly($user, $proposal);
    }
}
