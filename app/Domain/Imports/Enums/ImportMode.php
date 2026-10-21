<?php

declare(strict_types=1);

namespace App\Domain\Imports\Enums;

use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/** `blueprint_imports.mode` (02 §4.1): recognition, or background-only tracing without credits. */
#[TypeScript]
enum ImportMode: string
{
    case Auto = 'auto';
    case Trace = 'trace';
}
