<?php

declare(strict_types=1);

namespace App\Domain\Identity\Enums;

use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/** `users.unit_system` (02 §1.1, master §6.1). */
#[TypeScript]
enum UnitSystem: string
{
    case Metric = 'metric';
    case Imperial = 'imperial';
}
