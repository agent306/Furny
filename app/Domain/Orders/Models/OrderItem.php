<?php

declare(strict_types=1);

namespace App\Domain\Orders\Models;

use App\Domain\Furniture\Models\FurnitureDesign;
use App\Domain\Furniture\Models\FurnitureRevision;
use Carbon\CarbonImmutable;
use Database\Factories\Domain\Orders\OrderItemFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * 02 §8.2. The customer chooses quantity, room and notes; the order, the design, the pinned
 * revision (set at submission, 09 T2), staff notes and ordering are written by the order actions.
 *
 * @property string $id
 * @property string $order_id
 * @property string $furniture_design_id
 * @property string|null $furniture_revision_id
 * @property int $quantity
 * @property string|null $room_label
 * @property string|null $customer_notes
 * @property string|null $staff_notes
 * @property int $sort_order
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[Fillable(['quantity', 'room_label', 'customer_notes'])]
final class OrderItem extends Model
{
    /** @use HasFactory<OrderItemFactory> */
    use HasFactory, HasUlids;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'quantity' => 'integer',
            'sort_order' => 'integer',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }

    /**
     * @return BelongsTo<Order, $this>
     */
    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }

    /**
     * @return BelongsTo<FurnitureDesign, $this>
     */
    public function furnitureDesign(): BelongsTo
    {
        return $this->belongsTo(FurnitureDesign::class, 'furniture_design_id');
    }

    /**
     * @return BelongsTo<FurnitureRevision, $this>
     */
    public function furnitureRevision(): BelongsTo
    {
        return $this->belongsTo(FurnitureRevision::class, 'furniture_revision_id');
    }

    protected static function newFactory(): OrderItemFactory
    {
        return OrderItemFactory::new();
    }
}
