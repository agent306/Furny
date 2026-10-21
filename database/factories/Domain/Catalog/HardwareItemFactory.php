<?php

declare(strict_types=1);

namespace Database\Factories\Domain\Catalog;

use App\Domain\Catalog\Enums\HardwareCategory;
use App\Domain\Catalog\Enums\HardwareUnit;
use App\Domain\Catalog\Models\HardwareItem;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * Default: an active bar handle priced per piece, default for no role.
 *
 * @extends Factory<HardwareItem>
 */
final class HardwareItemFactory extends Factory
{
    protected $model = HardwareItem::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'code' => 'HW-'.strtoupper(fake()->unique()->bothify('????####')),
            'name' => 'Bar handle '.fake()->unique()->numerify('### mm'),
            'category' => HardwareCategory::Handle,
            'specs' => ['lengthMm' => 160, 'holeSpacingMm' => 128, 'holeCount' => 2],
            'unit' => HardwareUnit::Piece,
            'price_minor' => 18000,
            'is_default_for' => [],
            'is_active' => true,
            'sort_order' => 0,
        ];
    }

    public function inactive(): static
    {
        return $this->state(['is_active' => false]);
    }

    /**
     * @param  list<string>  $roleKeys
     */
    public function defaultFor(array $roleKeys): static
    {
        return $this->state(['is_default_for' => $roleKeys]);
    }
}
