<?php

declare(strict_types=1);

namespace App\Domain\Catalog\Models;

use App\Domain\Catalog\Enums\BoardType;
use App\Domain\Catalog\Enums\MaterialSurface;
use App\Domain\Catalog\Observers\BumpCatalogVersion;
use Carbon\CarbonImmutable;
use Database\Factories\Domain\Catalog\MaterialFactory;
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
 * 02 §6.1: a sheet good or solid stock. `code` is the stable key documents refer to; prices are
 * integer minor units. `thickness_mm` and `waste_factor` are decimal strings (`'18.0'`, `'0.100'`).
 *
 * @property string $id
 * @property string $code
 * @property string $name
 * @property BoardType $board_type
 * @property string $thickness_mm
 * @property int $sheet_length_mm
 * @property int $sheet_width_mm
 * @property bool $has_grain
 * @property string|null $decor_name
 * @property string|null $color_hex
 * @property MaterialSurface $surface
 * @property int $price_per_sheet_minor
 * @property string $waste_factor
 * @property int|null $density_kg_m3
 * @property list<string> $usage
 * @property string|null $default_edge_band_code
 * @property bool $is_active
 * @property int $sort_order
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 * @property CarbonImmutable|null $deleted_at
 */
#[Fillable([
    'code', 'name', 'board_type', 'thickness_mm', 'sheet_length_mm', 'sheet_width_mm', 'has_grain', 'decor_name',
    'color_hex', 'surface', 'price_per_sheet_minor', 'waste_factor', 'density_kg_m3', 'usage',
    'default_edge_band_code', 'is_active', 'sort_order',
])]
#[ObservedBy(BumpCatalogVersion::class)]
final class Material extends Model implements HasMedia
{
    /** @use HasFactory<MaterialFactory> */
    use HasFactory, HasUlids, InteractsWithMedia, SoftDeletes;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'board_type' => BoardType::class,
            'surface' => MaterialSurface::class,
            'thickness_mm' => 'decimal:1',
            'waste_factor' => 'decimal:3',
            'has_grain' => 'boolean',
            'is_active' => 'boolean',
            'usage' => 'array',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'deleted_at' => 'immutable_datetime',
        ];
    }

    /** 02 §10: one seamless jpg/webp texture on the public disk with a 256 px `small` conversion. */
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

    protected static function newFactory(): MaterialFactory
    {
        return MaterialFactory::new();
    }
}
