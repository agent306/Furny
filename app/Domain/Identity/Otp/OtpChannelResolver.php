<?php

declare(strict_types=1);

namespace App\Domain\Identity\Otp;

use App\Domain\Identity\Enums\OtpChannel;
use App\Support\Features;
use App\Support\Settings\Settings;
use Illuminate\Support\Facades\Cache;

/**
 * The channels a code may go out on, in the order to try them (13 §4.2 step 4): `notifications.otp_channel_order`
 * filtered by what is configured. WhatsApp needs its feature flag and an `auth.otp` template. SMS needs its flag, an
 * `auth.otp` text and room under the global hourly cap, which is what keeps an SMS-pumping attack from running up the
 * bill (13 §4.5): beyond the cap codes go out on WhatsApp only.
 */
final class OtpChannelResolver
{
    private const string TEMPLATE_KEY = 'auth.otp';

    public function __construct(private readonly Settings $settings) {}

    /**
     * `$e164` is for the checks that depend on the number (WhatsApp-unreachable phones, 12 §7.7), which come with the
     * notification channels. `$reservedCount` is the place the sender reserved in the global counter for the send
     * being decided (it reserves first, so parallel sends cannot all slip under the cap): SMS is allowed while that
     * place is within the cap. Without one the counter is read, and SMS is allowed while there is room for one more.
     *
     * @return list<OtpChannel>
     */
    public function available(string $e164, ?int $reservedCount = null): array
    {
        $available = [];

        foreach ($this->settings->notifications()->otpChannelOrder as $name) {
            $channel = OtpChannel::tryFrom($name);

            if ($channel !== null && ! in_array($channel, $available, true) && $this->usable($channel, $reservedCount)) {
                $available[] = $channel;
            }
        }

        return $available;
    }

    private function usable(OtpChannel $channel, ?int $reservedCount): bool
    {
        $notifications = $this->settings->notifications();
        $cap = $this->settings->auth()->otpGlobalHourlyCap;

        return match ($channel) {
            OtpChannel::Whatsapp => Features::enabled('whatsapp')
                && isset($notifications->whatsappTemplates[self::TEMPLATE_KEY]),
            OtpChannel::Sms => Features::enabled('sms')
                && isset($notifications->smsTemplates[self::TEMPLATE_KEY])
                && ($reservedCount !== null ? $reservedCount <= $cap : (int) Cache::get(OtpLimits::globalKey(), 0) < $cap),
        };
    }
}
