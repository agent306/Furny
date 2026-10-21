<?php

declare(strict_types=1);

namespace Database\Factories\Domain\Furniture;

use App\Domain\Furniture\Enums\PresetCategory;
use App\Domain\Furniture\Models\FurniturePreset;
use Database\Factories\Support\Documents;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * Default: an active wardrobe preset around the placeholder document (02 §5.3). The slug follows
 * the generated name, so both stay unique.
 *
 * @extends Factory<FurniturePreset>
 */
final class FurniturePresetFactory extends Factory
{
    /** A 1 x 1 transparent PNG, enough for the `thumbnail` collection (png only). */
    private const string PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

    protected $model = FurniturePreset::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'name' => 'Preset '.Str::lower((string) Str::ulid()),
            'slug' => static fn (array $attributes): string => Str::slug((string) $attributes['name']),
            'template_key' => 'wardrobe',
            'category' => PresetCategory::Wardrobe,
            'description' => null,
            'document' => Documents::placeholderFurniture(),
            'is_active' => true,
            'sort_order' => 0,
        ];
    }

    public function category(PresetCategory $category): static
    {
        return $this->state(['category' => $category]);
    }

    public function inactive(): static
    {
        return $this->state(['is_active' => false]);
    }

    /** A placeholder document for another template key. */
    public function forTemplate(string $templateKey): static
    {
        return $this->state([
            'template_key' => $templateKey,
            'document' => Documents::placeholderFurniture($templateKey),
        ]);
    }

    public function withThumbnail(): static
    {
        return $this->afterCreating(static function (FurniturePreset $preset): void {
            $preset->addMediaFromString((string) base64_decode(self::PNG, true))
                ->usingFileName('thumbnail.png')
                ->toMediaCollection('thumbnail');
        });
    }
}
