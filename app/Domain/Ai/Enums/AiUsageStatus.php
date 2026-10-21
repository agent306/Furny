<?php

declare(strict_types=1);

namespace App\Domain\Ai\Enums;

use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/** `ai_usage_events.status` (02 §7.2). */
#[TypeScript]
enum AiUsageStatus: string
{
    case Succeeded = 'succeeded';
    case Failed = 'failed';
}
