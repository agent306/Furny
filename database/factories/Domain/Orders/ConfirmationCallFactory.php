<?php

declare(strict_types=1);

namespace Database\Factories\Domain\Orders;

use App\Domain\Identity\Enums\StaffRole;
use App\Domain\Identity\Models\User;
use App\Domain\Orders\Enums\CallOutcome;
use App\Domain\Orders\Models\ConfirmationCall;
use App\Domain\Orders\Models\Order;
use App\Domain\Orders\States\Accepted;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * Default: an estimator's call an hour ago, on an accepted order, to the customer's number, that
 * confirmed the order (02 §8.8).
 *
 * @extends Factory<ConfirmationCall>
 */
final class ConfirmationCallFactory extends Factory
{
    protected $model = ConfirmationCall::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'order_id' => Order::factory()->inState(Accepted::class),
            'staff_id' => User::factory()->staff(StaffRole::Estimator),
            'called_at' => now()->subHour()->toImmutable(),
            'phone_e164' => static fn (array $attributes): string => (string) (User::withTrashed()
                ->whereKey(Order::withTrashed()->whereKey($attributes['order_id'])->value('customer_id'))
                ->value('phone_e164') ?? '+919800000001'),
            'outcome' => CallOutcome::Confirmed,
        ];
    }

    /** The call ended with `$outcome`; a requested callback is scheduled a day after the call. */
    public function outcome(CallOutcome $outcome): static
    {
        return $this->state([
            'outcome' => $outcome,
            'callback_at' => static fn (array $attributes): ?CarbonImmutable => $outcome === CallOutcome::CallbackRequested
                ? CarbonImmutable::parse($attributes['called_at'])->addDay()
                : null,
        ]);
    }
}
