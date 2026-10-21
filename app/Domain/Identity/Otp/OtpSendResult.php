<?php

declare(strict_types=1);

namespace App\Domain\Identity\Otp;

use App\Domain\Identity\Enums\OtpChannel;

/** What `SendOtp` tells its caller: the channel that carried the code and the number as it may be shown. Never the code. */
final readonly class OtpSendResult
{
    public function __construct(
        public OtpChannel $channel,
        public string $maskedPhone,
        public string $otpId,
        public string $e164,
    ) {}
}
