<?php

declare(strict_types=1);

namespace App\Domain\Identity\Enums;

use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/** `notification_deliveries.driver` (02 §1.7). */
#[TypeScript]
enum DeliveryDriver: string
{
    case Meta = 'meta';
    case Twilio = 'twilio';
    case Msg91 = 'msg91';
    case Log = 'log';
    case Array = 'array';
}
