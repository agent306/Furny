<?php

declare(strict_types=1);

namespace App\Domain\Identity\Data;

use App\Domain\Identity\Models\User;
use Spatie\LaravelData\Data;
use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/** Props of `Admin/Account/TwoFactor` (14 §10, 13 §5.10). */
#[TypeScript]
final class TwoFactorPageProps extends Data
{
    public function __construct(
        /** A secret exists: the setup was started, or is done. */
        public bool $enabled,
        /** A code from the authenticator confirmed the secret. */
        public bool $confirmed,
        /** The user's role must have a confirmed second factor (owner, admin). */
        public bool $required,
        /** `2fa.enrolled` shuts the admin area for this user until they confirm: the page shows the reason. */
        public bool $enforced,
    ) {}

    public static function fromUser(User $user): self
    {
        $required = $user->requiresTwoFactor();
        $confirmed = $user->two_factor_confirmed_at !== null;

        return new self(
            enabled: $user->two_factor_secret !== null,
            confirmed: $confirmed,
            required: $required,
            enforced: $required && ! $confirmed,
        );
    }
}
