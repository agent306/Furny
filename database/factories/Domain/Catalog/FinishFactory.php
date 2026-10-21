<?php

declare(strict_types=1);

namespace Database\Factories\Domain\Catalog;

use App\Domain\Catalog\Enums\BoardType;
use App\Domain\Catalog\Enums\FinishType;
use App\Domain\Catalog\Models\Finish;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * Default: an active matt PU paint for MDF at ₹1,100 per m².
 *
 * @extends Factory<Finish>
 */
final class FinishFactory extends Factory
{
    protected $model = Finish::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'code' => 'FIN-'.strtoupper(fake()->unique()->bothify('????####')),
            'name' => 'PU paint '.fake()->unique()->colorName(),
            'finish_type' => FinishType::Pu,
            'price_per_sqm_minor' => 110000,
            'applies_to' => [BoardType::Mdf->value],
            'color_hex' => null,
            'is_active' => true,
        ];
    }

    public function inactive(): static
    {
        return $this->state(['is_active' => false]);
    }
}
