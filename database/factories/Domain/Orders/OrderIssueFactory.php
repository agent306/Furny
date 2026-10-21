<?php

declare(strict_types=1);

namespace Database\Factories\Domain\Orders;

use App\Domain\Orders\Enums\IssueStatus;
use App\Domain\Orders\Models\Order;
use App\Domain\Orders\Models\OrderIssue;
use App\Domain\Orders\States\Delivered;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * Default: an open issue raised by the customer of a delivered order, not tied to an item (02 §8.10).
 *
 * @extends Factory<OrderIssue>
 */
final class OrderIssueFactory extends Factory
{
    protected $model = OrderIssue::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'order_id' => Order::factory()->inState(Delivered::class),
            'raised_by' => static fn (array $attributes): mixed => Order::withTrashed()->whereKey($attributes['order_id'])->value('customer_id'),
            'description' => 'The left door does not close flush.',
            'status' => IssueStatus::Open,
        ];
    }
}
