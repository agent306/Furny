<?php

declare(strict_types=1);

namespace App\Domain\Orders\Enums;

use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/** `payments.method` (02 §8.12; phase 2, D16). */
#[TypeScript]
enum PaymentMethod: string
{
    case Cash = 'cash';
    case BankTransfer = 'bank_transfer';
    case Upi = 'upi';
    case Card = 'card';
    case Cheque = 'cheque';
    case OnlineGateway = 'online_gateway';
}
