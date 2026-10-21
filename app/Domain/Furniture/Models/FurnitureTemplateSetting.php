<?php

declare(strict_types=1);

namespace App\Domain\Furniture\Models;

use App\Support\Casts\AsJsonMap;
use Carbon\CarbonImmutable;
use Database\Factories\Domain\Furniture\FurnitureTemplateSettingFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

/**
 * 02 §5.4: admin toggle, order and default overrides for a code-defined template (07 §2). The
 * primary key is the template key itself.
 *
 * @property string $template_key
 * @property bool $is_enabled
 * @property int $sort_order
 * @property array<string, mixed> $default_overrides
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[Fillable(['template_key', 'is_enabled', 'sort_order', 'default_overrides'])]
final class FurnitureTemplateSetting extends Model
{
    /** @use HasFactory<FurnitureTemplateSettingFactory> */
    use HasFactory;

    protected $primaryKey = 'template_key';

    public $incrementing = false;

    protected $keyType = 'string';

    /**
     * @return array<string, string|class-string>
     */
    protected function casts(): array
    {
        return [
            'is_enabled' => 'boolean',
            'default_overrides' => AsJsonMap::class,
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }

    protected static function newFactory(): FurnitureTemplateSettingFactory
    {
        return FurnitureTemplateSettingFactory::new();
    }
}
