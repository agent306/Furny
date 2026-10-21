<?php

declare(strict_types=1);

namespace App\Support\Auth;

/**
 * The public handle of a session (13 §6.3): the page and the revoke routes name a device by this key, never by the
 * session id, which is the credential. A keyed hash, so the key reveals nothing about the id and cannot be
 * computed without `app.key`.
 */
final class SessionKey
{
    public const int LENGTH = 32;

    public static function for(string $sessionId): string
    {
        return substr(hash_hmac('sha256', $sessionId, (string) config('app.key')), 0, self::LENGTH);
    }
}
