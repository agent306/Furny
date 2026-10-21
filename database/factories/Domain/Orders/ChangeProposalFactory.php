<?php

declare(strict_types=1);

namespace Database\Factories\Domain\Orders;

use App\Domain\Identity\Enums\StaffRole;
use App\Domain\Identity\Models\User;
use App\Domain\Orders\Enums\ChangeProposalStatus;
use App\Domain\Orders\Models\ChangeProposal;
use App\Domain\Orders\Models\Order;
use App\Domain\Orders\States\InReview;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * Default: the next draft proposal (number 1..n per order) of an order in review, written by an
 * estimator (02 §8.3). The states set the stamps of the proposal only; the order's own state is
 * left to the caller.
 *
 * @extends Factory<ChangeProposal>
 */
final class ChangeProposalFactory extends Factory
{
    protected $model = ChangeProposal::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'order_id' => Order::factory()->inState(InReview::class),
            'number' => static fn (array $attributes): int => (int) ChangeProposal::query()->where('order_id', $attributes['order_id'])->max('number') + 1,
            'status' => ChangeProposalStatus::Draft,
            'message' => 'We suggest a few changes before we quote.',
            'created_by' => User::factory()->staff(StaffRole::Estimator),
        ];
    }

    public function sent(): static
    {
        return $this->state([
            'status' => ChangeProposalStatus::Sent,
            'sent_at' => static fn (): mixed => now()->subHour()->toImmutable(),
        ]);
    }

    public function resolved(): static
    {
        return $this->state([
            'status' => ChangeProposalStatus::Resolved,
            'sent_at' => static fn (): mixed => now()->subHours(2)->toImmutable(),
            'resolved_at' => static fn (): mixed => now()->subHour()->toImmutable(),
        ]);
    }

    public function withdrawn(): static
    {
        return $this->state([
            'status' => ChangeProposalStatus::Withdrawn,
            'withdrawn_at' => static fn (): mixed => now()->subHour()->toImmutable(),
        ]);
    }
}
