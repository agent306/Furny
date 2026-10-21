<?php

declare(strict_types=1);

namespace App\Domain\Orders\Enums;

use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/** `payments.gateway` (02 §8.12; phase 2, D16). */
#[TypeScript]
enum PaymentGateway: string
{
    case Razorpay = 'razorpay';
    case Stripe = 'stripe';
}
