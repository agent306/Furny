<?php

declare(strict_types=1);

namespace App\Domain\Orders\Enums;

use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/** `orders.cancel_reason` (02 §8.1). */
#[TypeScript]
enum CancelReason: string
{
    case CustomerWithdrew = 'customer_withdrew';
    case QuoteDeclined = 'quote_declined';
    case DeclinedOnCall = 'declined_on_call';
    case Unresponsive = 'unresponsive';
    case StaffCancelled = 'staff_cancelled';
    case Duplicate = 'duplicate';
    case Other = 'other';
}
