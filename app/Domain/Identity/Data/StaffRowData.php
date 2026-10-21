<?php

declare(strict_types=1);

namespace App\Domain\Identity\Data;

use App\Domain\Identity\Enums\StaffRole;
use App\Domain\Identity\Models\User;
use Spatie\LaravelData\Data;
use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/** A row of the members table of the staff page (11 §7). */
#[TypeScript]
final class StaffRowData extends Data
{
    public function __construct(
        public string $id,
        public string $name,
        public string $email,
        public string $role,
        public bool $twoFactorEnabled,
        public bool $twoFactorRequired,
        public bool $isActive,
        public ?string $lastLoginAt,
        public bool $googleLinked,
        public StaffRowAbilitiesData $can,
    ) {}

    /**
     * @param  bool  $canManageOwners  whether the viewer passes the `staff.manage_owners` gate (asked once for the page)
     */
    public static function fromUser(User $staff, User $viewer, bool $canManageOwners): self
    {
        $role = StaffRole::tryFrom((string) $staff->roles->pluck('name')->first());
        $isSelf = $viewer->is($staff);
        // An owner's row is the viewer's to act on only with the owner gate; nobody acts on their own row here.
        $manageable = ! $isSelf && ($role !== StaffRole::Owner || $canManageOwners);
        $twoFactorEnabled = $staff->two_factor_confirmed_at !== null;

        return new self(
            id: $staff->id,
            name: $staff->name,
            email: (string) $staff->email,
            role: $role->value ?? '',
            twoFactorEnabled: $twoFactorEnabled,
            twoFactorRequired: $role?->requiresTwoFactor() ?? false,
            isActive: $staff->is_active,
            lastLoginAt: $staff->last_login_at?->toIso8601String(),
            googleLinked: $staff->google_id !== null,
            can: new StaffRowAbilitiesData(
                edit: $manageable,
                deactivate: $manageable && $staff->is_active,
                activate: $manageable && ! $staff->is_active,
                resetTwoFactor: $manageable && $twoFactorEnabled,
            ),
        );
    }
}
