<?php

declare(strict_types=1);

namespace App\Domain\Identity\Support;

use App\Domain\Identity\Models\User;

/**
 * What a verified phone number leads to (13 §5.2): an account to sign in, a refusal with the translation key that says
 * why, or a number that has no account yet and still needs a name to get one.
 */
final readonly class PhoneAccountOutcome
{
    private function __construct(
        public ?User $user,
        public ?string $refusal,
    ) {}

    public static function account(User $user): self
    {
        return new self($user, null);
    }

    /** @param  string  $messageKey  e.g. `auth.errors.staff_use_email` */
    public static function refused(string $messageKey): self
    {
        return new self(null, $messageKey);
    }

    public static function nameNeeded(): self
    {
        return new self(null, null);
    }

    public function asksForName(): bool
    {
        return $this->user === null && $this->refusal === null;
    }
}
