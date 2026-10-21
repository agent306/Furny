<?php

declare(strict_types=1);

namespace App\Domain\Identity\Support;

use RuntimeException;

/** Linking Google to an account was refused. `$reason` is the key under `auth.errors.*` that tells the user why. */
final class GoogleAccountException extends RuntimeException
{
    public function __construct(public readonly string $reason)
    {
        parent::__construct("Google account refused: {$reason}.");
    }

    public function messageKey(): string
    {
        return 'auth.errors.'.$this->reason;
    }
}
