<?php

declare(strict_types=1);

namespace App\Domain\Furniture\Enums;

use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/** `furniture_presets.category` (02 §5.3). */
#[TypeScript]
enum PresetCategory: string
{
    case Wardrobe = 'wardrobe';
    case Kitchen = 'kitchen';
    case Storage = 'storage';
    case Shelving = 'shelving';
    case TvUnit = 'tv_unit';
    case Table = 'table';
    case Desk = 'desk';
    case Bed = 'bed';
    case Other = 'other';
}
