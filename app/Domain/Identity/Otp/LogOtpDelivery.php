<?php

declare(strict_types=1);

namespace App\Domain\Identity\Otp;

use App\Domain\Identity\Enums\OtpChannel;
use App\Support\Privacy\Mask;
use Illuminate\Support\Facades\Log;
use SensitiveParameter;

/**
 * The delivery bound until the WhatsApp and SMS channels exist. It sends nothing: it logs the masked number and the
 * channel, and never the message. Only a local environment with the `otp-dev` channel (config/logging.php, local
 * only) gets the full message, so a developer can read the code from `storage/logs/otp-dev.log`.
 */
final class LogOtpDelivery implements OtpDelivery
{
    public function send(
        OtpChannel $channel,
        string $e164,
        #[SensitiveParameter] string $message,
        #[SensitiveParameter] string $code,
        string $otpId,
    ): void {
        $context = ['channel' => $channel->value, 'phone' => Mask::phone($e164), 'reference' => $otpId];

        if (app()->environment('local') && config('logging.channels.otp-dev') !== null) {
            Log::channel('otp-dev')->info($message, $context);

            return;
        }

        Log::info('otp.delivery', $context);
    }
}
