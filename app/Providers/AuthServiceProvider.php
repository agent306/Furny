<?php

declare(strict_types=1);

namespace App\Providers;

use App\Domain\Identity\Enums\OwnerGate;
use App\Domain\Identity\Enums\PermissionName;
use App\Domain\Identity\Enums\StaffRole;
use App\Domain\Identity\Models\User;
use Illuminate\Contracts\Auth\Access\Gate as GateContract;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\ServiceProvider;
use Spatie\Permission\PermissionRegistrar;

/**
 * Authorization gates (13 §7.3): the inactive-staff deny, spatie's permission check, the owner-only
 * abilities and the dashboard gates. There is deliberately no blanket bypass for owners: an owner
 * must not pass customer-ownership checks such as accepting a quote.
 */
final class AuthServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        // Must precede spatie's Gate::before (disabled in config/permission.php): the first non-null result wins.
        // Inactive staff are denied everything; customers never pass a staff permission check, even if a
        // role or permission was attached to them by mistake.
        Gate::before(static fn (User $user, string $ability): ?bool => match (true) {
            $user->isStaff() => $user->is_active ? null : false,
            PermissionName::tryFrom($ability) !== null => false,
            default => null,
        });
        app(PermissionRegistrar::class)->registerPermissions(app(GateContract::class));

        Gate::define(OwnerGate::OWNER, static fn (User $user): bool => self::isActiveStaffWith($user, StaffRole::Owner));

        foreach (OwnerGate::cases() as $ability) {
            Gate::define($ability->value, static fn (User $user): bool => Gate::forUser($user)->allows(OwnerGate::OWNER));
        }

        // 17 §5.11 item 12. Pulse defines a local-only default while it registers; this replaces it.
        // Horizon's and Telescope's providers check only these gates (no local-environment bypass).
        foreach (['viewHorizon', 'viewPulse', 'viewTelescope'] as $dashboard) {
            Gate::define($dashboard, static fn (User $user): bool => self::isActiveStaffWith($user, StaffRole::Owner, StaffRole::Admin));
        }
    }

    private static function isActiveStaffWith(User $user, StaffRole ...$roles): bool
    {
        return $user->isStaff()
            && $user->is_active
            && $user->hasAnyRole(array_map(static fn (StaffRole $role): string => $role->value, $roles));
    }
}
