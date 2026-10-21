<?php

declare(strict_types=1);

namespace Database\Factories\Domain\Catalog;

use App\Domain\Catalog\Enums\BoardType;
use App\Domain\Catalog\Enums\MaterialSurface;
use App\Domain\Catalog\Models\Material;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * Default: an active 18 mm particle board sheet (2440 × 1220, no grain) with the table defaults of 02 §6.1.
 *
 * @extends Factory<Material>
 */
final class MaterialFactory extends Factory
{
    protected $model = Material::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'code' => 'MAT-'.strtoupper(fake()->unique()->bothify('????####')),
            'name' => 'PB 18 mm '.fake()->unique()->colorName(),
            'board_type' => BoardType::ParticleBoard,
            'thickness_mm' => '18.0',
            'sheet_length_mm' => 2440,
            'sheet_width_mm' => 1220,
            'has_grain' => false,
            'decor_name' => null,
            'color_hex' => '#F4F4F2',
            'surface' => MaterialSurface::Melamine,
            'price_per_sheet_minor' => 215000,
            'waste_factor' => '0.100',
            'density_kg_m3' => 650,
            'usage' => ['carcass', 'shelf', 'front', 'back', 'top'],
            'default_edge_band_code' => null,
            'is_active' => true,
            'sort_order' => 0,
        ];
    }

    public function inactive(): static
    {
        return $this->state(['is_active' => false]);
    }

    public function withGrain(): static
    {
        return $this->state(['has_grain' => true]);
    }

    public function glass(): static
    {
        return $this->state([
            'board_type' => BoardType::Glass,
            'thickness_mm' => '5.0',
            'sheet_length_mm' => 2440,
            'sheet_width_mm' => 1830,
            'surface' => MaterialSurface::Raw,
            'waste_factor' => '0.050',
            'usage' => ['glass'],
        ]);
    }
}
