<?php

declare(strict_types=1);

namespace App\Policies\Concerns;

use App\Domain\Identity\Enums\PermissionName;
use App\Domain\Identity\Models\User;
use App\Domain\Messaging\Models\Message;
use App\Domain\Orders\Models\ChangeProposal;
use App\Domain\Orders\Models\Order;
use App\Domain\Orders\Models\Quote;
use Illuminate\Auth\Access\Response;

/**
 * "Own" in 13 §8.5-§8.8 means `orders.customer_id` of the record's order, read live; quotes, change
 * proposals and messages have no owner of their own. Only a customer can own an order: staff rights come
 * from permissions alone, so a user who changed type keeps nothing.
 *
 * Denials follow `RespondsWithCodes`: a customer who does not own the order is told 404 before anything
 * else is looked at (state included), so the order's existence never leaks.
 */
trait ChecksOrderOwnership
{
    use AuthorizesStaff, RespondsWithCodes;

    protected function ownsOrder(User $user, Order $order): bool
    {
        return $user->isCustomer() && $order->customer_id === $user->id;
    }

    /**
     * The record's order, including a soft-deleted one (the customer keeps access to it). The fallback is
     * set on the relation so later checks on the same instance do not query again.
     */
    protected function orderOf(Quote|ChangeProposal|Message $record): Order
    {
        $order = $record->order;

        if ($order === null) {
            $order = $record->order()->withTrashed()->firstOrFail();
            $record->setRelation('order', $order);
        }

        return $order;
    }

    /** The owning customer, or active staff holding any of the permissions. */
    protected function ownerOrStaffCan(User $user, Order|Quote|ChangeProposal|Message $subject, PermissionName ...$permissions): Response
    {
        $own = $this->owns($user, $subject);

        return $this->allowOrDeny($own || $this->staffHoldsAny($user, array_values($permissions)), $user, $own);
    }

    /** Staff holding the permission only; the owning customer is told 403 and a stranger 404. */
    protected function staffCanOnly(User $user, Order|Quote|ChangeProposal|Message $subject, PermissionName $permission): Response
    {
        return $this->allowOrDeny($this->staffCan($user, $permission), $user, $this->owns($user, $subject));
    }

    /** The owning customer only; staff are told 403 and a stranger 404. */
    protected function ownerOnly(User $user, Order|Quote|ChangeProposal|Message $subject): Response
    {
        $own = $this->owns($user, $subject);

        return $this->allowOrDeny($own, $user, $own);
    }

    /**
     * Staff holding the permission, or the owning customer once the record is `$visibleToOwner` (not a
     * draft). A draft is staff-internal, so its own customer is told 404 as if it did not exist.
     */
    protected function ownerOnceVisibleOrStaffCan(User $user, Quote|ChangeProposal $record, bool $visibleToOwner, PermissionName $permission): Response
    {
        $own = $this->owns($user, $record);

        return match (true) {
            $this->staffCan($user, $permission), $own && $visibleToOwner => Response::allow(),
            $own => Response::denyAsNotFound(),
            default => $this->allowOrDeny(false, $user),
        };
    }

    private function owns(User $user, Order|Quote|ChangeProposal|Message $subject): bool
    {
        return $this->ownsOrder($user, $subject instanceof Order ? $subject : $this->orderOf($subject));
    }

    /** @param  list<PermissionName>  $permissions */
    private function staffHoldsAny(User $user, array $permissions): bool
    {
        foreach ($permissions as $permission) {
            if ($this->staffCan($user, $permission)) {
                return true;
            }
        }

        return false;
    }
}
