<?php

declare(strict_types=1);

namespace App\Domain\Furniture\Models;

use App\Domain\Furniture\Enums\PresetCategory;
use App\Domain\Identity\Models\User;
use App\Support\Casts\AsJsonDocument;
use Carbon\CarbonImmutable;
use Database\Factories\Domain\Furniture\FurniturePresetFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;
use Spatie\MediaLibrary\HasMedia;
use Spatie\MediaLibrary\InteractsWithMedia;
use Spatie\MediaLibrary\MediaCollections\Models\Media as BaseMedia;

/**
 * 02 §5.3: a staff-curated starting point holding a full furniture document (07 §2.5).
 *
 * @property string $id
 * @property string $name
 * @property string $slug
 * @property string $template_key
 * @property PresetCategory $category
 * @property string|null $description
 * @property array<array-key, mixed> $document
 * @property bool $is_active
 * @property int $sort_order
 * @property string|null $created_by
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 * @property CarbonImmutable|null $deleted_at
 */
#[Fillable(['name', 'slug', 'template_key', 'category', 'description', 'document', 'is_active', 'sort_order', 'created_by'])]
final class FurniturePreset extends Model implements HasMedia
{
    /** @use HasFactory<FurniturePresetFactory> */
    use HasFactory, HasUlids, InteractsWithMedia, SoftDeletes;

    /**
     * @return array<string, string|class-string>
     */
    protected function casts(): array
    {
        return [
            'category' => PresetCategory::class,
            'document' => AsJsonDocument::class,
            'is_active' => 'boolean',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'deleted_at' => 'immutable_datetime',
        ];
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function createdBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    /** 02 §10: one PNG thumbnail on the public disk with a 320 px wide `small` conversion. */
    public function registerMediaCollections(): void
    {
        $this->addMediaCollection('thumbnail')
            ->useDisk('s3-public')
            ->singleFile()
            ->acceptsMimeTypes(['image/png']);
    }

    public function registerMediaConversions(?BaseMedia $media = null): void
    {
        $this->addMediaConversion('small')
            ->performOnCollections('thumbnail')
            ->width(320);
    }

    protected static function newFactory(): FurniturePresetFactory
    {
        return FurniturePresetFactory::new();
    }
}
