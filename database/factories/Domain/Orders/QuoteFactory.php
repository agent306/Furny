<?php

declare(strict_types=1);

namespace Database\Factories\Domain\Orders;

use App\Domain\Identity\Enums\StaffRole;
use App\Domain\Identity\Models\User;
use App\Domain\Orders\Enums\QuoteStatus;
use App\Domain\Orders\Models\Order;
use App\Domain\Orders\Models\Quote;
use App\Domain\Orders\States\InReview;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * Default: the next draft quote (version 1..n per order) of an order in review, written by an
 * estimator, valid for 14 days with empty totals (02 §8.5). The number is left to the model, which
 * sets `{order number}-Q{version}`. The states set the stamps of the quote only; the order's own
 * state and its quote ids are left to the caller.
 *
 * @extends Factory<Quote>
 */
final class QuoteFactory extends Factory
{
    protected $model = Quote::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'order_id' => Order::factory()->inState(InReview::class),
            'version' => static fn (array $attributes): int => (int) Quote::query()->where('order_id', $attributes['order_id'])->max('version') + 1,
            'status' => QuoteStatus::Draft,
            'currency' => 'INR',
            'prices_include_tax' => false,
            'valid_until' => now()->addDays(14)->toDateString(),
            'terms' => 'Prices are valid until the date shown. A 50% advance confirms the order; the balance is due on delivery.',
            'catalog_version' => 1,
            'engine_version' => '1.0.0',
            'created_by' => User::factory()->staff(StaffRole::Estimator),
        ];
    }

    public function sent(): static
    {
        return $this->state([
            'status' => QuoteStatus::Sent,
            'sent_at' => static fn (): mixed => now()->subHour()->toImmutable(),
        ]);
    }

    public function accepted(): static
    {
        return $this->state([
            'status' => QuoteStatus::Accepted,
            'sent_at' => static fn (): mixed => now()->subHours(2)->toImmutable(),
            'accepted_at' => static fn (): mixed => now()->subHour()->toImmutable(),
            'accepted_by_ip' => '203.0.113.7',
        ]);
    }
}
