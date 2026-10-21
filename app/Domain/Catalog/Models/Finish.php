<?php

declare(strict_types=1);

namespace App\Domain\Catalog\Models;

use App\Domain\Catalog\Enums\FinishType;
use App\Domain\Catalog\Observers\BumpCatalogVersion;
use Carbon\CarbonImmutable;
use Database\Factories\Domain\Catalog\FinishFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\ObservedBy;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;
use Spatie\Image\Enums\Fit;
use Spatie\MediaLibrary\HasMedia;
use Spatie\MediaLibrary\InteractsWithMedia;
use Spatie\MediaLibrary\MediaCollections\Models\Media as BaseMedia;

/**
 * 02 §6.4: a surface finish priced per visible square metre. `applies_to` lists the board types
 * (`BoardType` values) it can be applied to.
 *
 * @property string $id
 * @property string $code
 * @property string $name
 * @property FinishType $finish_type
 * @property int $price_per_sqm_minor
 * @property list<string> $applies_to
 * @property string|null $color_hex
 * @property bool $is_active
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 * @property CarbonImmutable|null $deleted_at
 */
#[Fillable(['code', 'name', 'finish_type', 'price_per_sqm_minor', 'applies_to', 'color_hex', 'is_active'])]
#[ObservedBy(BumpCatalogVersion::class)]
final class Finish extends Model implements HasMedia
{
    /** @use HasFactory<FinishFactory> */
    use HasFactory, HasUlids, InteractsWithMedia, SoftDeletes;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'finish_type' => FinishType::class,
            'applies_to' => 'array',
            'is_active' => 'boolean',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'deleted_at' => 'immutable_datetime',
        ];
    }

    /** 02 §10: one jpg/webp texture on the public disk with a 256 px `small` conversion. */
    public function registerMediaCollections(): void
    {
        $this->addMediaCollection('texture')
            ->useDisk('s3-public')
            ->singleFile()
            ->acceptsMimeTypes(['image/jpeg', 'image/webp']);
    }

    public function registerMediaConversions(?BaseMedia $media = null): void
    {
        $this->addMediaConversion('small')
            ->performOnCollections('texture')
            ->fit(Fit::Crop, 256, 256);
    }

    protected static function newFactory(): FinishFactory
    {
        return FinishFactory::new();
    }
}
