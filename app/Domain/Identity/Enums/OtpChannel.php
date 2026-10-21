<?php

declare(strict_types=1);

namespace App\Domain\Identity\Enums;

use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/** `otp_codes.channel` (02 §1.3). */
#[TypeScript]
enum OtpChannel: string
{
    case Whatsapp = 'whatsapp';
    case Sms = 'sms';
}
