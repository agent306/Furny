<?php

declare(strict_types=1);

namespace App\Domain\Identity\Enums;

use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/** `otp_codes.purpose` (02 §1.3). */
#[TypeScript]
enum OtpPurpose: string
{
    case Login = 'login';
    case VerifyPhone = 'verify_phone';
}
