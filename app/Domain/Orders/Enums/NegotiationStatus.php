<?php

declare(strict_types=1);

namespace App\Domain\Orders\Enums;

use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/** `quote_negotiations.status` (02 §8.7). */
#[TypeScript]
enum NegotiationStatus: string
{
    case Open = 'open';
    case AnsweredWithRevision = 'answered_with_revision';
    case AnsweredKeepPrice = 'answered_keep_price';
    case Closed = 'closed';
}
