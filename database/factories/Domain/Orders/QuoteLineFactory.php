<?php

declare(strict_types=1);

namespace Database\Factories\Domain\Orders;

use App\Domain\Catalog\Models\TaxRate;
use App\Domain\Orders\Enums\QuoteLineKind;
use App\Domain\Orders\Models\Quote;
use App\Domain\Orders\Models\QuoteLine;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * Default: one taxed, customer-visible furniture line of a new quote, not tied to an order item
 * (02 §8.6). The amount follows quantity and unit price, whichever state sets them.
 *
 * @extends Factory<QuoteLine>
 */
final class QuoteLineFactory extends Factory
{
    protected $model = QuoteLine::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'quote_id' => Quote::factory(),
            'order_item_id' => null,
            'kind' => QuoteLineKind::Furniture,
            'description' => 'Bedroom wardrobe, 1800 x 2100 x 600 mm',
            'quantity' => '1.000',
            'unit' => 'item',
            'unit_price_minor' => 4_500_000,
            'amount_minor' => static fn (array $attributes): int => (int) round((float) $attributes['quantity'] * (int) $attributes['unit_price_minor']),
            'tax_rate_id' => TaxRate::factory(),
            'is_visible_to_customer' => true,
            'sort_order' => 0,
        ];
    }

    /** A negative amount that reduces the subtotal; discounts carry no tax rate (02 §8.6). */
    public function discount(): static
    {
        return $this->state([
            'kind' => QuoteLineKind::Discount,
            'description' => 'Festive discount',
            'unit_price_minor' => -500_000,
            'tax_rate_id' => null,
        ]);
    }
}
