<?php

declare(strict_types=1);

namespace Database\Factories\Domain\Furniture;

use App\Domain\Furniture\Models\FurnitureTemplateSetting;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * Default: an enabled template with no default overrides (02 §5.4). The key is generated because it
 * is the primary key; pass `template_key` for a real template.
 *
 * @extends Factory<FurnitureTemplateSetting>
 */
final class FurnitureTemplateSettingFactory extends Factory
{
    protected $model = FurnitureTemplateSetting::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'template_key' => 'template_'.Str::lower(Str::random(10)),
            'is_enabled' => true,
            'sort_order' => 0,
        ];
    }

    public function disabled(): static
    {
        return $this->state(['is_enabled' => false]);
    }

    /**
     * @param  array<string, mixed>  $overrides
     */
    public function withDefaultOverrides(array $overrides): static
    {
        return $this->state(['default_overrides' => $overrides]);
    }
}
