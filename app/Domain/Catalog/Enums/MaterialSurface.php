<?php

declare(strict_types=1);

namespace App\Domain\Catalog\Enums;

use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/** `materials.surface` (02 §6.1). */
#[TypeScript]
enum MaterialSurface: string
{
    case Raw = 'raw';
    case Melamine = 'melamine';
    case Laminate = 'laminate';
    case Veneer = 'veneer';
    case Painted = 'painted';
    case Lacquered = 'lacquered';
    case PreLaminated = 'pre_laminated';
}
