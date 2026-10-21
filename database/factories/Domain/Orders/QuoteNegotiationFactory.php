<?php

declare(strict_types=1);

namespace Database\Factories\Domain\Orders;

use App\Domain\Orders\Enums\NegotiationStatus;
use App\Domain\Orders\Models\Order;
use App\Domain\Orders\Models\Quote;
use App\Domain\Orders\Models\QuoteNegotiation;
use App\Domain\Orders\States\Negotiating;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * Default: an open negotiation on a sent quote of an order in negotiation, raised by that order's
 * customer with no counter price (02 §8.7). The order and the customer follow whichever quote or
 * order the caller sets.
 *
 * @extends Factory<QuoteNegotiation>
 */
final class QuoteNegotiationFactory extends Factory
{
    protected $model = QuoteNegotiation::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'quote_id' => Quote::factory()->sent()->for(Order::factory()->inState(Negotiating::class)),
            'order_id' => static fn (array $attributes): mixed => Quote::query()->whereKey($attributes['quote_id'])->value('order_id'),
            'customer_id' => static fn (array $attributes): mixed => Order::withTrashed()->whereKey($attributes['order_id'])->value('customer_id'),
            'message' => 'Could you do better on the price?',
            'status' => NegotiationStatus::Open,
        ];
    }
}
