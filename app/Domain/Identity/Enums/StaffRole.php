<?php

declare(strict_types=1);

namespace App\Domain\Identity\Enums;

use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/** Spatie role names for staff and `staff_invitations.role` (02 §1.5, 13 §7). */
#[TypeScript]
enum StaffRole: string
{
    case Owner = 'owner';
    case Admin = 'admin';
    case Estimator = 'estimator';
    case Production = 'production';
    case Support = 'support';

    /** TOTP two-factor authentication is mandatory for the highest-privilege roles (13 S4). */
    public function requiresTwoFactor(): bool
    {
        return $this === self::Owner || $this === self::Admin;
    }
}
