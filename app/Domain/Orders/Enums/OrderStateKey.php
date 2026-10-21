<?php

declare(strict_types=1);

namespace App\Domain\Orders\Enums;

use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/**
 * The 16 order state keys of 09 §1, in table order. Mirrors `OrderState::$name` of the state
 * classes; this enum is what TypeScript types, i18n key patterns and `state_before_hold` use.
 */
#[TypeScript]
enum OrderStateKey: string
{
    case Draft = 'draft';
    case Submitted = 'submitted';
    case InReview = 'in_review';
    case ChangesProposed = 'changes_proposed';
    case Quoted = 'quoted';
    case Negotiating = 'negotiating';
    case Accepted = 'accepted';
    case Confirmed = 'confirmed';
    case InProduction = 'in_production';
    case Completed = 'completed';
    case Rework = 'rework';
    case ReadyForDelivery = 'ready_for_delivery';
    case Delivered = 'delivered';
    case Closed = 'closed';
    case Cancelled = 'cancelled';
    case OnHold = 'on_hold';
}
