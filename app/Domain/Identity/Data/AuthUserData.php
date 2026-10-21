<?php

declare(strict_types=1);

namespace App\Domain\Identity\Data;

use App\Domain\Identity\Enums\LengthUnit;
use App\Domain\Identity\Enums\UnitSystem;
use App\Domain\Identity\Enums\UserType;
use App\Domain\Identity\Models\User;
use Spatie\LaravelData\Data;
use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/**
 * The shared prop `auth.user` (15 §8, 13 §7.4): exactly these 18 fields, built field by field so that
 * nothing else of the model (password hash, 2FA secrets, remember token, Google id, internal notes)
 * can reach the browser. `permissions` and `abilities` are display hints only; policies decide.
 */
#[TypeScript]
final class AuthUserData extends Data
{
    /**
     * @param  list<string>  $roles  Staff role names; `[]` for customers and inactive staff.
     * @param  list<string>  $permissions  Flattened permission names (13 §7.4); `[]` unless the user is active staff.
     * @param  list<string>  $abilities  Owner gates the user passes (13 §7.3).
     */
    public function __construct(
        public string $id,
        public UserType $type,
        public string $name,
        public ?string $email,
        public bool $emailVerified,
        public ?string $phoneE164,
        public bool $phoneVerified,
        public ?string $avatarUrl,
        public array $roles,
        public array $permissions,
        public array $abilities,
        public UnitSystem $unitSystem,
        public LengthUnit $lengthUnit,
        public string $timezone,
        public string $locale,
        public bool $onboarded,
        public bool $hasPassword,
        public bool $twoFactorEnabled,
    ) {}

    /**
     * Inactive staff are denied everything by `Gate::before`, and customers never pass a staff permission
     * check, so only active staff carry roles, permissions and abilities: what the UI shows matches what
     * the server allows. Roles, role permissions and direct permissions are eager-loaded (three queries).
     */
    public static function fromUser(User $user): self
    {
        $isActiveStaff = $user->isStaff() && $user->is_active;

        if ($isActiveStaff) {
            $user->loadMissing(['roles.permissions', 'permissions']);
        }

        return new self(
            id: $user->id,
            type: $user->type,
            name: $user->name,
            email: $user->email,
            emailVerified: $user->email_verified_at !== null,
            phoneE164: $user->phone_e164,
            phoneVerified: $user->phone_verified_at !== null,
            avatarUrl: self::avatarUrl($user),
            roles: $isActiveStaff ? array_values($user->roles->pluck('name')->sort()->all()) : [],
            permissions: $isActiveStaff ? $user->permissionNames() : [],
            abilities: $isActiveStaff ? $user->abilities() : [],
            unitSystem: $user->unit_system,
            lengthUnit: $user->length_unit,
            timezone: $user->timezone,
            locale: $user->locale,
            // Staff have no onboarding (02 §1.1); customers finish it once.
            onboarded: $user->isStaff() || $user->onboarded_at !== null,
            hasPassword: $user->hasPassword(),
            twoFactorEnabled: $user->hasEnabledTwoFactorAuthentication(),
        );
    }

    private static function avatarUrl(User $user): ?string
    {
        $url = $user->getFirstMediaUrl('avatar', 'thumb');

        return $url === '' ? null : $url;
    }
}
