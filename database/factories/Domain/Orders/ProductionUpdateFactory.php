<?php

declare(strict_types=1);

namespace Database\Factories\Domain\Orders;

use App\Domain\Identity\Enums\StaffRole;
use App\Domain\Identity\Models\User;
use App\Domain\Orders\Enums\ProductionVisibility;
use App\Domain\Orders\Models\Order;
use App\Domain\Orders\Models\ProductionUpdate;
use App\Domain\Orders\States\InProduction;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * Default: a customer-visible "cutting" update at 25% by production staff on an order in
 * production, with the default stage and progress of 09 §8 (02 §8.9).
 *
 * @extends Factory<ProductionUpdate>
 */
final class ProductionUpdateFactory extends Factory
{
    protected $model = ProductionUpdate::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'order_id' => Order::factory()->inState(InProduction::class),
            'author_id' => User::factory()->staff(StaffRole::Production),
            'stage' => 'cutting',
            'progress' => 25,
            'title' => 'Cutting started',
            'visibility' => ProductionVisibility::Customer,
            'is_completion' => false,
        ];
    }

    /** Staff-only: never shown to the customer. */
    public function internal(): static
    {
        return $this->state(['visibility' => ProductionVisibility::Internal]);
    }

    /** The "completed" post of T20: pseudo-stage `completed` at 100%, customer-visible (09 §8). */
    public function completion(): static
    {
        return $this->state([
            'stage' => 'completed',
            'progress' => 100,
            'title' => 'Production completed',
            'visibility' => ProductionVisibility::Customer,
            'is_completion' => true,
        ]);
    }
}
