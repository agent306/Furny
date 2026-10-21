<?php

declare(strict_types=1);

namespace Database\Factories\Domain\Furniture;

use App\Domain\Furniture\Enums\AuthorKind;
use App\Domain\Furniture\Enums\FurnitureRevisionReason;
use App\Domain\Furniture\Models\FurnitureDesign;
use App\Domain\Furniture\Models\FurnitureRevision;
use App\Domain\Projects\Models\Project;
use Database\Factories\Concerns\ProvidesTinyPng;
use Database\Factories\Support\Documents;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * Default: a placeholder 1800 x 2100 x 600 wardrobe in a new project, owned by that project's
 * customer (02 §5.1). The owner is resolved from the project, whichever state sets the project.
 *
 * @extends Factory<FurnitureDesign>
 */
final class FurnitureDesignFactory extends Factory
{
    use ProvidesTinyPng;

    protected $model = FurnitureDesign::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'project_id' => Project::factory(),
            'owner_id' => static fn (array $attributes): mixed => Project::withTrashed()->whereKey($attributes['project_id'])->value('owner_id'),
            'created_by' => static fn (array $attributes): mixed => $attributes['owner_id'],
            'name' => 'Bedroom wardrobe',
            'template_key' => 'wardrobe',
            'preset_id' => null,
            'working_document' => Documents::placeholderFurniture(),
            'working_version' => 1,
            'width_mm' => static fn (array $attributes): int => self::dimension($attributes, 'width'),
            'height_mm' => static fn (array $attributes): int => self::dimension($attributes, 'height'),
            'depth_mm' => static fn (array $attributes): int => self::dimension($attributes, 'depth'),
        ];
    }

    /** A placeholder document for another template key; the denormalised template and size follow it. */
    public function forTemplate(string $templateKey): static
    {
        return $this->state([
            'template_key' => $templateKey,
            'working_document' => Documents::placeholderFurniture($templateKey),
        ]);
    }

    /** The client estimate of 02 §5.1, computed against the current catalog. */
    public function withEstimate(): static
    {
        return $this->state(fn (): array => ['estimate' => self::estimate(catalogVersion: 1, computedAt: now()->toIso8601String())]);
    }

    /** An estimate computed against an older catalog, days ago. */
    public function staleEstimate(): static
    {
        return $this->state(fn (): array => ['estimate' => self::estimate(catalogVersion: 0, computedAt: now()->subDays(3)->toIso8601String())]);
    }

    /** `$count` manual checkpoints numbered 1..n by the owner, the last one is `current_revision_id`. */
    public function withRevisions(int $count): static
    {
        return $this->afterCreating(function (FurnitureDesign $design) use ($count): void {
            $last = null;

            for ($number = 1; $number <= $count; $number++) {
                $last = FurnitureRevision::factory()->for($design)->create([
                    'number' => $number,
                    'document' => $design->working_document,
                    'reason' => FurnitureRevisionReason::ManualCheckpoint,
                    'author_id' => $design->owner_id,
                    'author_kind' => AuthorKind::Customer,
                ]);
            }

            if ($last !== null) {
                $design->forceFill(['current_revision_id' => $last->id])->save();
            }
        });
    }

    public function withThumbnail(): static
    {
        return $this->afterCreating(static function (FurnitureDesign $design): void {
            $design->addMediaFromString(self::tinyPng())
                ->usingFileName('thumbnail.png')
                ->toMediaCollection('thumbnail');
        });
    }

    /**
     * @param  array<string, mixed>  $attributes
     */
    private static function dimension(array $attributes, string $axis): int
    {
        $document = $attributes['working_document'];

        return (int) (is_array($document) ? $document['dims'][$axis] : 0);
    }

    /**
     * @return array<string, mixed>
     */
    private static function estimate(int $catalogVersion, string $computedAt): array
    {
        return [
            'totalMinor' => 4_850_000,
            'currency' => 'INR',
            'partCount' => 42,
            'sheetCount' => 7,
            'catalogVersion' => $catalogVersion,
            'engineVersion' => '1.0.0',
            'computedAt' => $computedAt,
        ];
    }
}
