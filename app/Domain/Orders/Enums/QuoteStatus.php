<?php

declare(strict_types=1);

namespace App\Domain\Orders\Enums;

use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/** `quotes.status` (02 §8.5); moved by the quote actions of 08 §6 and the transitions of 09 §2. */
#[TypeScript]
enum QuoteStatus: string
{
    case Draft = 'draft';
    case Sent = 'sent';
    case Accepted = 'accepted';
    case Declined = 'declined';
    case Superseded = 'superseded';
    case Expired = 'expired';
    case Withdrawn = 'withdrawn';
}
