<?php

declare(strict_types=1);

namespace Database\Factories\Domain\Catalog;

use App\Domain\Catalog\Models\EdgeBand;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * Default: an active 0.8 × 22 mm white tape at ₹6 per metre.
 *
 * @extends Factory<EdgeBand>
 */
final class EdgeBandFactory extends Factory
{
    protected $model = EdgeBand::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'code' => 'EB-'.strtoupper(fake()->unique()->bothify('????####')),
            'name' => '0.8 × 22 '.fake()->unique()->colorName(),
            'thickness_mm' => '0.80',
            'width_mm' => 22,
            'color_hex' => '#F4F4F2',
            'price_per_meter_minor' => 600,
            'is_active' => true,
        ];
    }

    public function inactive(): static
    {
        return $this->state(['is_active' => false]);
    }
}
