<?php

declare(strict_types=1);

namespace App\Domain\Catalog\Enums;

use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/** `hardware_items.unit` (02 §6.3). */
#[TypeScript]
enum HardwareUnit: string
{
    case Piece = 'piece';
    case Pair = 'pair';
    case Set = 'set';
    case Meter = 'meter';
    case Pack = 'pack';
}
