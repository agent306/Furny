<?php

declare(strict_types=1);

namespace Database\Factories\Domain\Catalog;

use App\Domain\Catalog\Enums\LabourUnit;
use App\Domain\Catalog\Models\LabourRate;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * Default: an active hourly rate of ₹300 under a unique key.
 *
 * @extends Factory<LabourRate>
 */
final class LabourRateFactory extends Factory
{
    protected $model = LabourRate::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'key' => 'rate_'.fake()->unique()->bothify('????####'),
            'name' => 'General labour',
            'unit' => LabourUnit::Hour,
            'rate_minor' => 30000,
            'is_active' => true,
        ];
    }

    public function inactive(): static
    {
        return $this->state(['is_active' => false]);
    }
}
