<?php

declare(strict_types=1);

namespace App\Domain\Projects\Enums;

use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/** `projects.status` (02 §3.1). */
#[TypeScript]
enum ProjectStatus: string
{
    case Active = 'active';
    case Archived = 'archived';
}
