<?php

declare(strict_types=1);

namespace App\Domain\Identity\Otp;

use App\Domain\Identity\Enums\OtpChannel;
use SensitiveParameter;

/**
 * Carries one verification message to a phone. Called synchronously by `SendOtp`, never from a queue: the message
 * holds the plain code, which must not reach Redis (13 §4.1).
 */
interface OtpDelivery
{
    /**
     * @param  string  $message  the finished text, code included (for SMS)
     * @param  string  $code  the bare code (for a WhatsApp authentication template, whose parameter it is)
     * @param  string  $otpId  `otp_codes.id`, for the delivery log
     *
     * @throws OtpDeliveryException only when the message was DEFINITELY NOT sent (refused before it left, provider
     *                              rejected it, nothing billed). `SendOtp` then tries the next channel and gives the
     *                              send's hourly counters back. An outcome that is unsure, such as a timeout after the
     *                              request went out, must be treated as sent: return normally, do not throw.
     */
    public function send(
        OtpChannel $channel,
        string $e164,
        #[SensitiveParameter] string $message,
        #[SensitiveParameter] string $code,
        string $otpId,
    ): void;
}
