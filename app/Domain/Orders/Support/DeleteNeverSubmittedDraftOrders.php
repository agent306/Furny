<?php

declare(strict_types=1);

namespace App\Domain\Orders\Support;

use App\Domain\Identity\Contracts\AccountDeletionStep;
use App\Domain\Identity\Models\User;
use App\Domain\Orders\Enums\OrderStateKey;
use App\Domain\Orders\Models\Order;

/**
 * Account deletion step of the foundation (13 §9.1 step 2.1, 09 §1): a `draft` order that was never submitted is deleted
 * outright, with its items. A draft that was submitted and reopened is cancelled instead (T3), which arrives with the
 * order workflow (P7) as its own step.
 */
final class DeleteNeverSubmittedDraftOrders implements AccountDeletionStep
{
    public function handle(User $user): void
    {
        Order::withTrashed()
            ->where('customer_id', $user->getKey())
            ->where('state', OrderStateKey::Draft->value)
            ->whereNull('submitted_at')
            ->forceDelete();
    }
}
