<?php

declare(strict_types=1);

namespace App\Domain\Orders\Enums;

use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/** `order_issues.status` (02 §8.10). */
#[TypeScript]
enum IssueStatus: string
{
    case Open = 'open';
    case InProgress = 'in_progress';
    case Resolved = 'resolved';
    case Rejected = 'rejected';
}
