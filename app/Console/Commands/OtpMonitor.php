<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Domain\Identity\Models\OtpCode;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

/**
 * The SMS-pumping tripwire (13 §4.5 item 6), run every 5 minutes (01 §7). Pumped codes are sent and never entered, so
 * when at least 50 codes went out in the last hour and fewer than one in five was verified, every send needs a
 * captcha for the next hour (`auth:captcha_always`) and the admin dashboard shows a banner (`health:otp`).
 */
final class OtpMonitor extends Command
{
    private const int MIN_SENT = 50;

    /** Conversion below one in this many verified codes is suspicious. */
    private const int MIN_CONVERSION_DENOMINATOR = 5;

    protected $signature = 'otp:monitor';

    protected $description = 'Switch the captcha on for every OTP send when few of the codes sent in the last hour were verified';

    public function handle(): int
    {
        $since = now()->subHour();
        $sent = OtpCode::query()->where('created_at', '>=', $since)->count();
        $verified = OtpCode::query()->where('created_at', '>=', $since)->whereNotNull('consumed_at')->count();

        $this->line("OTP codes in the last hour: {$sent} sent, {$verified} verified.");

        // verified / sent < 0.2, in integers.
        if ($sent < self::MIN_SENT || $verified * self::MIN_CONVERSION_DENOMINATOR >= $sent) {
            return self::SUCCESS;
        }

        Cache::put('auth:captcha_always', true, now()->addHour());
        Cache::put('health:otp', ['status' => 'low_conversion', 'sent' => $sent, 'verified' => $verified, 'at' => now()->toIso8601String()], now()->addHour());
        Log::critical('otp.low_conversion', ['sent' => $sent, 'verified' => $verified]);

        $this->warn('Low OTP conversion: the captcha is required for every send for the next hour.');

        return self::SUCCESS;
    }
}
