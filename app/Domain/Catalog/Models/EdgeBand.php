<?php

declare(strict_types=1);

namespace App\Domain\Catalog\Models;

use App\Domain\Catalog\Observers\BumpCatalogVersion;
use Carbon\CarbonImmutable;
use Database\Factories\Domain\Catalog\EdgeBandFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\ObservedBy;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * 02 §6.2: edge banding tape priced per metre. `thickness_mm` is a decimal string (`'0.80'`).
 *
 * @property string $id
 * @property string $code
 * @property string $name
 * @property string $thickness_mm
 * @property int $width_mm
 * @property string|null $color_hex
 * @property int $price_per_meter_minor
 * @property bool $is_active
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 * @property CarbonImmutable|null $deleted_at
 */
#[Fillable(['code', 'name', 'thickness_mm', 'width_mm', 'color_hex', 'price_per_meter_minor', 'is_active'])]
#[ObservedBy(BumpCatalogVersion::class)]
final class EdgeBand extends Model
{
    /** @use HasFactory<EdgeBandFactory> */
    use HasFactory, HasUlids, SoftDeletes;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'thickness_mm' => 'decimal:2',
            'is_active' => 'boolean',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'deleted_at' => 'immutable_datetime',
        ];
    }

    protected static function newFactory(): EdgeBandFactory
    {
        return EdgeBandFactory::new();
    }
}
