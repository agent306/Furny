<?php

declare(strict_types=1);

namespace App\Domain\Identity\Otp;

use App\Domain\Identity\Enums\OtpChannel;
use Carbon\CarbonImmutable;

/**
 * What `SendOtp` tells its caller: the channel that carried the code, the number as it may be shown, the code's row and
 * when that row expires. Never the code.
 */
final readonly class OtpSendResult
{
    public function __construct(
        public OtpChannel $channel,
        public string $maskedPhone,
        public string $otpId,
        public string $e164,
        public CarbonImmutable $expiresAt,
    ) {}
}
