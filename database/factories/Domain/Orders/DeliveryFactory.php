<?php

declare(strict_types=1);

namespace Database\Factories\Domain\Orders;

use App\Domain\Orders\Models\Delivery;
use App\Domain\Orders\Models\Order;
use App\Domain\Orders\States\ReadyForDelivery;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * Default: a four hour window tomorrow for an order that is ready for delivery, not yet delivered
 * or installed (02 §8.11). The window end follows whichever start the caller sets.
 *
 * @extends Factory<Delivery>
 */
final class DeliveryFactory extends Factory
{
    protected $model = Delivery::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'order_id' => Order::factory()->inState(ReadyForDelivery::class),
            'scheduled_for' => now()->addDay()->toImmutable(),
            'scheduled_until' => static fn (array $attributes): CarbonImmutable => CarbonImmutable::parse($attributes['scheduled_for'])->addHours(4),
            'installed' => false,
        ];
    }
}
