<?php

declare(strict_types=1);

namespace App\Domain\Catalog\Enums;

use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/** `labour_rates.unit` (02 §6.5). */
#[TypeScript]
enum LabourUnit: string
{
    case Sheet = 'sheet';
    case Meter = 'meter';
    case Part = 'part';
    case Piece = 'piece';
    case Item = 'item';
    case Sqm = 'sqm';
    case Hour = 'hour';
}
