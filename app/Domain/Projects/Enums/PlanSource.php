<?php

declare(strict_types=1);

namespace App\Domain\Projects\Enums;

use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/** `plans.source` (02 §3.2). */
#[TypeScript]
enum PlanSource: string
{
    case Drawn = 'drawn';
    case Imported = 'imported';
    case Traced = 'traced';
    case Duplicated = 'duplicated';
}
