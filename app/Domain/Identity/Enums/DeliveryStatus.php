<?php

declare(strict_types=1);

namespace App\Domain\Identity\Enums;

use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/** `notification_deliveries.status` (02 §1.7). */
#[TypeScript]
enum DeliveryStatus: string
{
    case Pending = 'pending';
    case Accepted = 'accepted';
    case Sent = 'sent';
    case Delivered = 'delivered';
    case Read = 'read';
    case Failed = 'failed';
}
