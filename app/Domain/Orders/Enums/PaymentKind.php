<?php

declare(strict_types=1);

namespace App\Domain\Orders\Enums;

use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/** `payments.kind` (02 §8.12; phase 2, D16). */
#[TypeScript]
enum PaymentKind: string
{
    case Advance = 'advance';
    case Balance = 'balance';
    case Refund = 'refund';
    case Adjustment = 'adjustment';
}
