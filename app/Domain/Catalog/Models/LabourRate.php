<?php

declare(strict_types=1);

namespace App\Domain\Catalog\Models;

use App\Domain\Catalog\Enums\LabourUnit;
use App\Domain\Catalog\Observers\BumpCatalogVersion;
use Carbon\CarbonImmutable;
use Database\Factories\Domain\Catalog\LabourRateFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\ObservedBy;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

/**
 * 02 §6.5: a labour rate addressed by its stable `key` (08 §4.3 lists all 14).
 *
 * @property string $id
 * @property string $key
 * @property string $name
 * @property LabourUnit $unit
 * @property int $rate_minor
 * @property bool $is_active
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[Fillable(['key', 'name', 'unit', 'rate_minor', 'is_active'])]
#[ObservedBy(BumpCatalogVersion::class)]
final class LabourRate extends Model
{
    /** @use HasFactory<LabourRateFactory> */
    use HasFactory, HasUlids;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'unit' => LabourUnit::class,
            'is_active' => 'boolean',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }

    protected static function newFactory(): LabourRateFactory
    {
        return LabourRateFactory::new();
    }
}
