<?php

declare(strict_types=1);

namespace App\Domain\Identity\Enums;

/**
 * What a Google round trip is for (13 §5.3, 14 §3.2). It is chosen on the redirect and kept in the session under
 * `oauth.intent`; the callback never takes it from the query.
 */
enum GoogleIntent: string
{
    case Login = 'login';
    case Link = 'link';
    case Invitation = 'invitation';
    case Reauthenticate = 'reauthenticate';

    /** Intents that act on the signed-in user. */
    public function needsSignedInUser(): bool
    {
        return $this === self::Link || $this === self::Reauthenticate;
    }
}
