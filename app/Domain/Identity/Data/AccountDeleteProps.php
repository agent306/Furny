<?php

declare(strict_types=1);

namespace App\Domain\Identity\Data;

use App\Domain\Identity\Models\User;
use App\Domain\Orders\Models\Order;
use Spatie\LaravelData\Data;
use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/** Props of `Customer/Account/Delete` (10 §13.7, 14 §9). */
#[TypeScript]
final class AccountDeleteProps extends Data
{
    /**
     * @param  list<ActiveOrderRefData>  $activeOrders  Orders to finish or cancel first; the deletion is refused while there are any.
     * @param  bool  $canExport  Whether the data download is open: the customer has a verified email or phone.
     */
    public function __construct(
        public array $activeOrders,
        public bool $canExport,
    ) {}

    public static function fromUser(User $user): self
    {
        return new self(
            activeOrders: array_values($user->activeOrders()->orderBy('created_at')->get(['id', 'number'])
                ->map(static fn (Order $order): ActiveOrderRefData => new ActiveOrderRefData($order->id, $order->number))
                ->all()),
            canExport: $user->hasVerifiedContact(),
        );
    }
}
