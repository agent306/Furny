<?php

declare(strict_types=1);

namespace App\Domain\Orders\Enums;

use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/** `confirmation_calls.outcome` (02 §8.8). */
#[TypeScript]
enum CallOutcome: string
{
    case Confirmed = 'confirmed';
    case NoAnswer = 'no_answer';
    case CallbackRequested = 'callback_requested';
    case WrongNumber = 'wrong_number';
    case CustomerWantsChanges = 'customer_wants_changes';
    case CustomerDeclined = 'customer_declined';
}
