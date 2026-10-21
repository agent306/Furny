<?php

declare(strict_types=1);

namespace App\Domain\Catalog\Models;

use App\Domain\Catalog\Enums\HardwareCategory;
use App\Domain\Catalog\Enums\HardwareUnit;
use App\Domain\Catalog\Observers\BumpCatalogVersion;
use Carbon\CarbonImmutable;
use Database\Factories\Domain\Catalog\HardwareItemFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\ObservedBy;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;
use Spatie\Image\Enums\Fit;
use Spatie\MediaLibrary\HasMedia;
use Spatie\MediaLibrary\InteractsWithMedia;
use Spatie\MediaLibrary\MediaCollections\Models\Media as BaseMedia;

/**
 * 02 §6.3: a hardware item. `specs` is the category-specific object of 08 §2.3 (a spec-less item
 * stores `{}`, never `[]`); `is_default_for` lists the role keys of 07 §6.11 this item is the
 * default for.
 *
 * @property string $id
 * @property string $code
 * @property string $name
 * @property HardwareCategory $category
 * @property array<string, mixed> $specs
 * @property HardwareUnit $unit
 * @property int $price_minor
 * @property list<string> $is_default_for
 * @property bool $is_active
 * @property int $sort_order
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 * @property CarbonImmutable|null $deleted_at
 */
#[Fillable(['code', 'name', 'category', 'specs', 'unit', 'price_minor', 'is_default_for', 'is_active', 'sort_order'])]
#[ObservedBy(BumpCatalogVersion::class)]
final class HardwareItem extends Model implements HasMedia
{
    /** @use HasFactory<HardwareItemFactory> */
    use HasFactory, HasUlids, InteractsWithMedia, SoftDeletes;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'category' => HardwareCategory::class,
            'unit' => HardwareUnit::class,
            'is_default_for' => 'array',
            'is_active' => 'boolean',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'deleted_at' => 'immutable_datetime',
        ];
    }

    /**
     * @return Attribute<array<string, mixed>, array<string, mixed>>
     */
    protected function specs(): Attribute
    {
        return Attribute::make(
            get: static fn (mixed $value): array => is_string($value) ? (json_decode($value, true, 512, JSON_THROW_ON_ERROR) ?? []) : [],
            set: static fn (array $value): string => json_encode($value === [] ? (object) [] : $value, JSON_PRESERVE_ZERO_FRACTION | JSON_THROW_ON_ERROR),
        );
    }

    /** 02 §10: one jpg/png/webp image on the public disk with a 256 px `thumb` conversion. */
    public function registerMediaCollections(): void
    {
        $this->addMediaCollection('image')
            ->useDisk('s3-public')
            ->singleFile()
            ->acceptsMimeTypes(['image/jpeg', 'image/png', 'image/webp']);
    }

    public function registerMediaConversions(?BaseMedia $media = null): void
    {
        $this->addMediaConversion('thumb')
            ->performOnCollections('image')
            ->fit(Fit::Crop, 256, 256);
    }

    protected static function newFactory(): HardwareItemFactory
    {
        return HardwareItemFactory::new();
    }
}
