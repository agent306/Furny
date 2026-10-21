<?php

declare(strict_types=1);

namespace App\Domain\Catalog\Enums;

use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/** `finishes.finish_type` (02 §6.4). */
#[TypeScript]
enum FinishType: string
{
    case None = 'none';
    case Laminate = 'laminate';
    case Veneer = 'veneer';
    case Paint = 'paint';
    case Pu = 'pu';
    case Lacquer = 'lacquer';
    case Duco = 'duco';
    case Membrane = 'membrane';
}
