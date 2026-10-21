<?php

declare(strict_types=1);

namespace App\Domain\Identity\Otp;

use RuntimeException;

/**
 * A refusal of the phone OTP flow (13 §4, 14 §1.9): `$errorCode` is the machine code the client switches on
 * (`otp_cooldown`, `otp_invalid`, `phone_invalid`, ...), `$status` the HTTP status, `$context` the extra values that
 * go with it (`retryAfter`, `attemptsLeft`).
 */
final class OtpException extends RuntimeException
{
    /**
     * @param  array<string, int|string>  $context
     */
    public function __construct(
        public readonly string $errorCode,
        public readonly int $status,
        public readonly array $context = [],
    ) {
        parent::__construct($errorCode);
    }
}
