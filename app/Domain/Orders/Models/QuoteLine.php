<?php

declare(strict_types=1);

namespace App\Domain\Orders\Models;

use App\Domain\Catalog\Models\TaxRate;
use App\Domain\Orders\Enums\QuoteLineKind;
use Carbon\CarbonImmutable;
use Database\Factories\Domain\Orders\QuoteLineFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * 02 §8.6. The estimator writes the priced content of a line; the quote, the item it prices and the
 * amount (`round(quantity × unit price)`, computed by `QuoteCalculator`, 08 §6.3) are not
 * mass-assignable. A discount line has a unit price of at most 0 and no tax rate.
 *
 * @property string $id
 * @property string $quote_id
 * @property string|null $order_item_id
 * @property QuoteLineKind $kind
 * @property string $description
 * @property array<array-key, mixed>|null $details
 * @property string $quantity
 * @property string $unit
 * @property int $unit_price_minor
 * @property int $amount_minor
 * @property string|null $tax_rate_id
 * @property bool $is_visible_to_customer
 * @property int $sort_order
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[Fillable(['kind', 'description', 'details', 'quantity', 'unit', 'unit_price_minor', 'tax_rate_id', 'is_visible_to_customer', 'sort_order'])]
final class QuoteLine extends Model
{
    /** @use HasFactory<QuoteLineFactory> */
    use HasFactory, HasUlids;

    /**
     * @return array<string, string|class-string>
     */
    protected function casts(): array
    {
        return [
            'kind' => QuoteLineKind::class,
            'details' => 'array',
            'quantity' => 'decimal:3',
            'unit_price_minor' => 'integer',
            'amount_minor' => 'integer',
            'is_visible_to_customer' => 'boolean',
            'sort_order' => 'integer',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }

    /**
     * @return BelongsTo<Quote, $this>
     */
    public function quote(): BelongsTo
    {
        return $this->belongsTo(Quote::class);
    }

    /**
     * @return BelongsTo<OrderItem, $this>
     */
    public function orderItem(): BelongsTo
    {
        return $this->belongsTo(OrderItem::class);
    }

    /**
     * @return BelongsTo<TaxRate, $this>
     */
    public function taxRate(): BelongsTo
    {
        return $this->belongsTo(TaxRate::class);
    }

    protected static function newFactory(): QuoteLineFactory
    {
        return QuoteLineFactory::new();
    }
}
