<?php

declare(strict_types=1);

namespace App\Domain\Furniture\Enums;

use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/** `furniture_revisions.bom_status` (02 §5.2): the server-side BOM job state. */
#[TypeScript]
enum BomStatus: string
{
    case Pending = 'pending';
    case Ready = 'ready';
    case Failed = 'failed';
}
