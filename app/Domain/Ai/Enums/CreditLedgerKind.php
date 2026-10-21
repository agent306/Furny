<?php

declare(strict_types=1);

namespace App\Domain\Ai\Enums;

use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/** `ai_credit_ledger.kind` (02 §7.1, 18 §9.1): the sign of `delta` follows the kind. */
#[TypeScript]
enum CreditLedgerKind: string
{
    case MonthlyGrant = 'monthly_grant';
    case AdminGrant = 'admin_grant';
    case AdminRevoke = 'admin_revoke';
    case Reservation = 'reservation';
    case ReservationRelease = 'reservation_release';
    case Consumption = 'consumption';
    case Refund = 'refund';
    case SignupGrant = 'signup_grant';
}
