<?php

declare(strict_types=1);

namespace App\Support\Auth;

use App\Domain\Identity\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Throwable;

/**
 * "Recent authentication" (13 §6.4): the user signed in, or confirmed their password or identity, in the last
 * 10 minutes. The two session stamps are positive integer unix timestamps; anything else is unreadable.
 */
final class RecentAuthentication
{
    /** Session key: when this session's user signed in. */
    public const string LOGIN_KEY = 'auth.login_at';

    /** Session key: when the user last confirmed their password (or re-authenticated by OTP or Google). */
    public const string CONFIRMED_KEY = 'auth.password_confirmed_at';

    public const int WINDOW_MINUTES = 10;

    /** Clock skew tolerated for a stamp that lies ahead of now; a stamp further ahead is treated as unreadable. */
    public const int SKEW_SECONDS = 60;

    /**
     * Whether a sensitive change to the user's sign-in methods (a phone number, a Google link) has to wait for a recent
     * authentication: the user has a way to prove who they are (a password, a verified phone, a linked Google account)
     * and has not done so in the last 10 minutes. A user with none is adding their first and is not asked. Without this
     * a stolen session could swap in its own phone or Google account and confirm itself with that (13 §6.4).
     */
    public static function missingFor(User $user, Request $request): bool
    {
        return $user->hasSignInCredential() && ! self::passes($request);
    }

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

    /**
     * The moment a session stamp stands for, or null when it is missing or unreadable: not a positive integer, or
     * more than `SKEW_SECONDS` in the future.
     */
    public static function timeOf(mixed $stamp): ?CarbonImmutable
    {
        if (! is_int($stamp) || $stamp <= 0) {
            return null;
        }

        try {
            $at = CarbonImmutable::createFromTimestamp($stamp);
        } catch (Throwable) {
            return null;
        }

        return $at->greaterThan(CarbonImmutable::now()->addSeconds(self::SKEW_SECONDS)) ? null : $at;
    }
}
