<?php

declare(strict_types=1);

namespace Database\Factories\Domain\Catalog;

use App\Domain\Catalog\Models\TaxRate;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * Default: an active, non-default 18% rate (only one row may be the default, 02 §6.6).
 *
 * @extends Factory<TaxRate>
 */
final class TaxRateFactory extends Factory
{
    protected $model = TaxRate::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'name' => 'GST 18% '.fake()->unique()->numerify('#####'),
            'rate_bps' => 1800,
            'is_default' => false,
            'is_active' => true,
        ];
    }

    public function default(): static
    {
        return $this->state(['is_default' => true]);
    }

    public function inactive(): static
    {
        return $this->state(['is_active' => false]);
    }
}
