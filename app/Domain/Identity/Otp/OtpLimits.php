<?php

declare(strict_types=1);

namespace App\Domain\Identity\Otp;

use App\Support\Http\RateLimitKey;
use InvalidArgumentException;

/**
 * The OTP limiters of 13 §10 for an action that has no request: thresholds from `config('security.rate_limits')`,
 * counters in the `RateLimiter` under keys that carry a hash of the number and the normalised IP, never the number
 * itself (13 §16 rule 6).
 */
final class OtpLimits
{
    public const string COOLDOWN = 'otp-cooldown';

    public const string SEND = 'otp-send';

    public const string VERIFY = 'otp-verify';

    /** The send counter of the whole system for the current hour (`SendOtp` increments it, `OtpChannelResolver` reads it). */
    public static function globalKey(): string
    {
        return 'otp:global:'.now()->format('YmdH');
    }

    public static function key(string $limiter, string $kind, string $e164, ?string $ip): string
    {
        return match ($kind) {
            'phone' => "{$limiter}:phone:".hash('sha256', $e164),
            'ip' => "{$limiter}:ip:".RateLimitKey::forIp($ip),
            default => throw new InvalidArgumentException("Unknown OTP limit key kind [{$kind}]."),
        };
    }

    /**
     * The limit of a limiter that is counted per `$kind` (`phone` or `ip`).
     *
     * @return array{max: int, decay: int} decay in seconds
     */
    public static function limit(string $limiter, string $kind): array
    {
        /** @var array{per: string, max: int, key: string} $spec */
        foreach ((array) config("security.rate_limits.{$limiter}") as $spec) {
            if ($spec['key'] === $kind) {
                return ['max' => $spec['max'], 'decay' => self::seconds($spec['per'])];
            }
        }

        throw new InvalidArgumentException("No [{$kind}] limit configured for [{$limiter}].");
    }

    private static function seconds(string $per): int
    {
        return match (true) {
            $per === 'minute' => 60,
            $per === 'hour' => 3600,
            $per === 'day' => 86400,
            str_starts_with($per, 'seconds:') => (int) substr($per, 8),
            str_starts_with($per, 'minutes:') => 60 * (int) substr($per, 8),
            default => throw new InvalidArgumentException("Unknown rate limit window [{$per}]."),
        };
    }
}
