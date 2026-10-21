<?php

declare(strict_types=1);

namespace Database\Factories\Domain\Orders;

use App\Domain\Furniture\Models\FurnitureDesign;
use App\Domain\Furniture\Models\FurnitureRevision;
use App\Domain\Orders\Models\Order;
use App\Domain\Orders\Models\OrderItem;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * Default: one wardrobe of a new design in the order's project (so the design belongs to the
 * order's customer), not yet pinned to a revision as in a draft order (02 §8.2).
 *
 * @extends Factory<OrderItem>
 */
final class OrderItemFactory extends Factory
{
    protected $model = OrderItem::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'order_id' => Order::factory(),
            'furniture_design_id' => static fn (array $attributes): Factory => FurnitureDesign::factory()->state([
                'project_id' => Order::withTrashed()->whereKey($attributes['order_id'])->value('project_id'),
            ]),
            'furniture_revision_id' => null,
            'quantity' => 1,
            'sort_order' => 0,
        ];
    }

    /** Pinned to a new `order_submitted` revision of the item's design, as submission leaves it (09 T2). */
    public function pinned(): static
    {
        return $this->state([
            'furniture_revision_id' => static fn (array $attributes): Factory => self::submittedRevisionOf($attributes['furniture_design_id']),
        ]);
    }

    /**
     * The next `order_submitted` revision of a design, copied from its working document and authored by its owner.
     *
     * @return Factory<FurnitureRevision>
     */
    public static function submittedRevisionOf(string $designId): Factory
    {
        $design = FurnitureDesign::withTrashed()->findOrFail($designId);

        return FurnitureRevision::factory()->orderSubmitted()->state([
            'furniture_design_id' => $design->id,
            'number' => (int) FurnitureRevision::query()->where('furniture_design_id', $design->id)->max('number') + 1,
            'document' => $design->working_document,
            'author_id' => $design->owner_id,
        ]);
    }
}
