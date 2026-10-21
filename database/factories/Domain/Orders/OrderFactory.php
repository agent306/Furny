<?php

declare(strict_types=1);

namespace Database\Factories\Domain\Orders;

use App\Domain\Orders\Enums\CancelReason;
use App\Domain\Orders\Enums\OrderStateKey;
use App\Domain\Orders\Models\Order;
use App\Domain\Orders\Models\OrderItem;
use App\Domain\Orders\States\OrderState;
use App\Domain\Projects\Models\Project;
use App\Support\Numbers\OrderNumber;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Factories\Factory;
use InvalidArgumentException;
use LogicException;

/**
 * Default: a never-submitted draft order for a new project, placed by that project's customer
 * (02 §8.1), with the temporary `DRAFT-` number. The customer is resolved from the project,
 * whichever state sets the project.
 *
 * `inState()` builds the order as the transitions of 09 §2 would have left it: the milestone
 * timestamps of every state on the way (09 §1 order), a real `ORD-` number from submission on,
 * `state_changed_at`, the expected delivery date once confirmed and full progress once completed.
 * Quote ids, assignees and activity stamps are not set; the full scenario history stays with P7.
 *
 * @extends Factory<Order>
 */
final class OrderFactory extends Factory
{
    /** The milestone each rank sets (02 §8.1), reached in this order. */
    private const array MILESTONES = [
        1 => 'submitted_at', 2 => 'reviewed_at', 3 => 'quoted_at', 4 => 'accepted_at', 5 => 'confirmed_at',
        6 => 'production_started_at', 7 => 'completed_at', 8 => 'customer_approved_at', 9 => 'delivered_at', 10 => 'closed_at',
    ];

    protected $model = Order::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'project_id' => Project::factory(),
            'customer_id' => static fn (array $attributes): mixed => Project::withTrashed()->whereKey($attributes['project_id'])->value('owner_id'),
            'title' => 'Bedroom furniture',
            'needs_installation' => true,
            'state_changed_at' => static fn (): CarbonImmutable => now()->toImmutable(),
        ];
    }

    /**
     * The order as it is after the transition into `$stateClass` (one of the 16 `OrderState`
     * classes); `OnHold` is held from `InReview`, see {@see onHoldFrom()} for another state.
     */
    public function inState(string $stateClass): static
    {
        if (! is_subclass_of($stateClass, OrderState::class)) {
            throw new InvalidArgumentException(sprintf('%s is not an order state class.', $stateClass));
        }

        $key = OrderStateKey::from($stateClass::$name);

        // A hold needs a state to resume to: in review, unless onHoldFrom() says otherwise.
        $heldFrom = $key === OrderStateKey::OnHold ? OrderStateKey::InReview : null;

        return $this->state(fn (): array => self::attributesFor($key, $heldFrom));
    }

    /** On hold, as T26 leaves it: `state_before_hold` is `$stateClass` and its milestones are set. */
    public function onHoldFrom(string $stateClass): static
    {
        if (! is_subclass_of($stateClass, OrderState::class)) {
            throw new InvalidArgumentException(sprintf('%s is not an order state class.', $stateClass));
        }

        $before = OrderStateKey::from($stateClass::$name);

        if (in_array($before, [OrderStateKey::Draft, OrderStateKey::Closed, OrderStateKey::Cancelled, OrderStateKey::OnHold], true)) {
            throw new InvalidArgumentException(sprintf('An order cannot be put on hold from %s (09 T26).', $before->value));
        }

        return $this->state(fn (): array => self::attributesFor(OrderStateKey::OnHold, heldFrom: $before));
    }

    /**
     * `$count` items on distinct designs of the order's project. Once the order has been submitted
     * each item pins an `order_submitted` revision of its design (09 T2).
     */
    public function withItems(int $count = 1): static
    {
        return $this->afterCreating(static function (Order $order) use ($count): void {
            for ($index = 0; $index < $count; $index++) {
                $item = OrderItem::factory()->for($order)->state(['sort_order' => $index]);

                ($order->submitted_at === null ? $item : $item->pinned())->create();
            }

            $order->unsetRelation('items');
        });
    }

    /**
     * @return array<string, mixed>
     */
    private static function attributesFor(OrderStateKey $key, ?OrderStateKey $heldFrom): array
    {
        $now = now()->toImmutable();
        $path = $heldFrom ?? $key;
        $attributes = ['state' => $key->value, 'state_changed_at' => $now];

        if ($path === OrderStateKey::Draft) {
            return $attributes;
        }

        if ($path === OrderStateKey::Cancelled) {
            $submittedAt = self::reachedAt($now, 1);

            return $attributes + [
                'number' => OrderNumber::next($submittedAt),
                'submitted_at' => $submittedAt,
                'cancelled_at' => $now->subHour(),
                'cancel_reason' => CancelReason::StaffCancelled,
                'state_changed_at' => $now->subHour(),
            ];
        }

        $rank = self::rankOf($path);
        $changedAt = $now;

        foreach (self::MILESTONES as $reached => $column) {
            if ($reached <= $rank) {
                $attributes[$column] = $changedAt = self::reachedAt($now, $reached);
            }
        }

        // The states between two milestones (changes proposed, negotiating, rework) and the hold itself happen later.
        if (self::milestoneOf($path) === null) {
            $changedAt = $changedAt->addMinutes(30);
        }

        if ($heldFrom !== null) {
            $changedAt = $changedAt->addMinutes(30);
            $attributes['state_before_hold'] = $heldFrom;
        }

        $attributes['number'] = OrderNumber::next(self::reachedAt($now, 1));
        $attributes['state_changed_at'] = $changedAt;

        if ($rank >= self::rankOf(OrderStateKey::Confirmed)) {
            $attributes['expected_delivery_on'] = $now->addDays(30)->toDateString();
        }

        if ($rank >= self::rankOf(OrderStateKey::Completed)) {
            $attributes['production_progress'] = 100;
        }

        return $attributes;
    }

    /** Milestone `$rank` was reached `11 - $rank` hours ago, so later ones are always later and none is in the future. */
    private static function reachedAt(CarbonImmutable $now, int $rank): CarbonImmutable
    {
        return $now->subHours(11 - $rank);
    }

    /**
     * Position on the happy path of 09 §1; changes proposed and negotiating sit beside the state
     * they return to (in review, quoted), rework beside completed.
     */
    private static function rankOf(OrderStateKey $key): int
    {
        return match ($key) {
            OrderStateKey::Draft => 0,
            OrderStateKey::Submitted => 1,
            OrderStateKey::InReview, OrderStateKey::ChangesProposed => 2,
            OrderStateKey::Quoted, OrderStateKey::Negotiating => 3,
            OrderStateKey::Accepted => 4,
            OrderStateKey::Confirmed => 5,
            OrderStateKey::InProduction => 6,
            OrderStateKey::Completed, OrderStateKey::Rework => 7,
            OrderStateKey::ReadyForDelivery => 8,
            OrderStateKey::Delivered => 9,
            OrderStateKey::Closed => 10,
            OrderStateKey::Cancelled, OrderStateKey::OnHold => throw new LogicException(sprintf('%s is off the happy path.', $key->value)),
        };
    }

    /** The milestone column a state sets itself, if it has one. */
    private static function milestoneOf(OrderStateKey $key): ?string
    {
        return match ($key) {
            OrderStateKey::Submitted => 'submitted_at',
            OrderStateKey::InReview => 'reviewed_at',
            OrderStateKey::Quoted => 'quoted_at',
            OrderStateKey::Accepted => 'accepted_at',
            OrderStateKey::Confirmed => 'confirmed_at',
            OrderStateKey::InProduction => 'production_started_at',
            OrderStateKey::Completed => 'completed_at',
            OrderStateKey::ReadyForDelivery => 'customer_approved_at',
            OrderStateKey::Delivered => 'delivered_at',
            OrderStateKey::Closed => 'closed_at',
            default => null,
        };
    }
}
