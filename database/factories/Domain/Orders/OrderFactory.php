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
    /**
     * The happy path of 09 §1: every state on it with the milestone it sets (02 §8.1), in the order
     * they are reached. This is the single source of the ranks and the milestones below.
     */
    private const array PATH = [
        'submitted' => 'submitted_at',
        'in_review' => 'reviewed_at',
        'quoted' => 'quoted_at',
        'accepted' => 'accepted_at',
        'confirmed' => 'confirmed_at',
        'in_production' => 'production_started_at',
        'completed' => 'completed_at',
        'ready_for_delivery' => 'customer_approved_at',
        'delivered' => 'delivered_at',
        'closed' => 'closed_at',
    ];

    /** The states that sit beside a path state, set no milestone of their own and return to it. */
    private const array BESIDE = [
        'changes_proposed' => 'in_review',
        'negotiating' => 'quoted',
        'rework' => 'completed',
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
        $key = self::keyOf($stateClass);

        // A hold needs a state to resume to: in review, unless onHoldFrom() says otherwise.
        $heldFrom = $key === OrderStateKey::OnHold ? OrderStateKey::InReview : null;

        return $this->state(fn (): array => self::attributesFor($key, $heldFrom));
    }

    /** On hold, as T26 leaves it: `state_before_hold` is `$stateClass` and its milestones are set. */
    public function onHoldFrom(string $stateClass): static
    {
        $before = self::keyOf($stateClass);

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
                'cancel_note' => 'Cancelled by staff on the customer\'s request.',
                'state_changed_at' => $now->subHour(),
            ];
        }

        $rank = self::rankOf($path);
        $changedAt = $now;

        foreach (array_slice(array_values(self::PATH), 0, $rank) as $index => $column) {
            $attributes[$column] = $changedAt = self::reachedAt($now, $index + 1);
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

    /** Milestone `$rank` was reached `(path length + 1) - $rank` hours ago, so later ones are always later and none is in the future. */
    private static function reachedAt(CarbonImmutable $now, int $rank): CarbonImmutable
    {
        return $now->subHours(count(self::PATH) + 1 - $rank);
    }

    /**
     * Position on the happy path (0 for a draft); a state beside a path state has that state's rank.
     */
    private static function rankOf(OrderStateKey $key): int
    {
        if ($key === OrderStateKey::Draft) {
            return 0;
        }

        $index = array_search(self::BESIDE[$key->value] ?? $key->value, array_keys(self::PATH), true);

        return $index === false
            ? throw new LogicException(sprintf('%s is off the happy path.', $key->value))
            : $index + 1;
    }

    /** The milestone column a state sets itself, if it has one. */
    private static function milestoneOf(OrderStateKey $key): ?string
    {
        return self::PATH[$key->value] ?? null;
    }

    /** The key of one of the 16 `OrderState` classes; anything else is refused. */
    private static function keyOf(string $stateClass): OrderStateKey
    {
        if (! is_subclass_of($stateClass, OrderState::class)) {
            throw new InvalidArgumentException(sprintf('%s is not an order state class.', $stateClass));
        }

        return OrderStateKey::from($stateClass::$name);
    }
}
