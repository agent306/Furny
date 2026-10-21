<?php

declare(strict_types=1);

namespace App\Domain\Identity\Support;

use RuntimeException;

/**
 * A staff invitation cannot be accepted (13 §5.9): the page says why, with one of the reasons of
 * `Auth/InvitationInvalid` (14 §3.4).
 */
final class InvitationUnavailable extends RuntimeException
{
    public const string INVALID = 'invalid';

    public const string EXPIRED = 'expired';

    public const string ACCEPTED = 'accepted';

    public const string REVOKED = 'revoked';

    /** @param  self::INVALID|self::EXPIRED|self::ACCEPTED|self::REVOKED  $reason */
    public function __construct(public readonly string $reason)
    {
        parent::__construct("The staff invitation cannot be accepted: {$reason}.");
    }
}
