<?php

declare(strict_types=1);

namespace App\Domain\Shared\Enums;

use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/** Delivery channel of a notification (02 §1.4, 12). */
#[TypeScript]
enum NotificationChannel: string
{
    case Database = 'database';
    case Mail = 'mail';
    case Whatsapp = 'whatsapp';
    case Sms = 'sms';
    case Webpush = 'webpush';
}
