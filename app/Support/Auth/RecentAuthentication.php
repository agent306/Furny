<?php

declare(strict_types=1);

namespace App\Support\Auth;

use Carbon\CarbonImmutable;
use DateTimeInterface;
use Illuminate\Http\Request;
use Throwable;

/**
 * "Recent authentication" (13 §6.4): the user signed in, or confirmed their password or identity, in the last
 * 10 minutes. The two session stamps are unix timestamps; dates and date strings are read as well.
 */
final class RecentAuthentication
{
    /** Session key: when this session's user signed in. */
    public const string LOGIN_KEY = 'auth.login_at';

    /** Session key: when the user last confirmed their password (or re-authenticated by OTP or Google). */
    public const string CONFIRMED_KEY = 'auth.password_confirmed_at';

    public const int WINDOW_MINUTES = 10;

    public static function passes(Request $request): bool
    {
        if (! $request->hasSession()) {
            return false;
        }

        $since = CarbonImmutable::now()->subMinutes(self::WINDOW_MINUTES);

        foreach ([self::CONFIRMED_KEY, self::LOGIN_KEY] as $key) {
            $at = self::timeOf($request->session()->get($key));

            if ($at !== null && $at->greaterThan($since)) {
                return true;
            }
        }

        return false;
    }

    /** The moment a session stamp stands for, or null when it is missing or unreadable. */
    public static function timeOf(mixed $stamp): ?CarbonImmutable
    {
        try {
            return match (true) {
                is_int($stamp), is_float($stamp) => CarbonImmutable::createFromTimestamp($stamp),
                $stamp instanceof DateTimeInterface => CarbonImmutable::instance($stamp),
                is_string($stamp) && $stamp !== '' => CarbonImmutable::parse($stamp),
                default => null,
            };
        } catch (Throwable) {
            return null;
        }
    }
}
