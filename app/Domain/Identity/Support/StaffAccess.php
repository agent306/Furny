<?php

declare(strict_types=1);

namespace App\Domain\Identity\Support;

use App\Domain\Identity\Enums\OwnerGate;
use App\Domain\Identity\Enums\PermissionName;
use App\Domain\Identity\Enums\StaffRole;
use App\Domain\Identity\Models\User;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * Who may manage whom among the staff (13 §5.9, §7.3), and the owner invariants.
 *
 * `staff.manage` is the permission for all of it; everything that concerns an owner (inviting one, giving or taking
 * the role, editing, deactivating, reactivating or resetting the two-factor authentication of one) also needs the
 * `staff.manage_owners` gate. The actions call this as well as the requests, so no caller can skip the gate.
 *
 * The last active owner can be neither demoted nor deactivated. Whoever reduces the owners takes the owners lock first
 * and counts afterwards: two owners who demote each other at the same moment cannot both succeed. Everything that can
 * change who is an owner takes the same lock, so an action asks `authorizeTarget` / `authorizeGrant` once more after
 * it holds the lock, on the actor and the target as they are then (`reload`, `refresh`): a promotion or a demotion
 * that was committed while the request waited cannot slip past the gate.
 */
final class StaffAccess
{
    /** Key of the transaction-scoped advisory lock that serialises everything that can reduce the active owners. */
    private const int OWNERS_LOCK = 7_301_100_001;

    /** @throws AuthorizationException */
    public function authorizeManage(User $actor): void
    {
        if (! $this->canManage($actor)) {
            throw new AuthorizationException;
        }
    }

    /** Whether the actor may invite someone as `$role`, give them the role, or act on an invitation for it. */
    public function canGrant(User $actor, StaffRole $role): bool
    {
        return $this->canManage($actor) && ($role !== StaffRole::Owner || $this->canManageOwners($actor));
    }

    /** @throws AuthorizationException */
    public function authorizeGrant(User $actor, StaffRole $role): void
    {
        if (! $this->canGrant($actor, $role)) {
            throw new AuthorizationException;
        }
    }

    /** Whether the actor may edit, deactivate, reactivate or reset the two-factor authentication of `$target`. */
    public function canTarget(User $actor, User $target): bool
    {
        return $this->canManage($actor) && ($target->hasRole(StaffRole::Owner->value) ? $this->canManageOwners($actor) : true);
    }

    /** @throws AuthorizationException */
    public function authorizeTarget(User $actor, User $target): void
    {
        if (! $this->canTarget($actor, $target)) {
            throw new AuthorizationException;
        }
    }

    public function canManageOwners(User $actor): bool
    {
        return Gate::forUser($actor)->allows(OwnerGate::StaffManageOwners->value);
    }

    /** The staff member's one role, or null for a user without any. */
    public function roleOf(User $staff): ?StaffRole
    {
        $name = $staff->roles->pluck('name')->first();

        return is_string($name) ? StaffRole::tryFrom($name) : null;
    }

    /**
     * The actor as the database has them now. An action asks its authorization a second time once it holds the owners
     * lock, and the request's own copy of the actor may be older than what a request that held the lock before has
     * committed (a demotion, a deactivation).
     *
     * @throws AuthorizationException when the actor is gone
     */
    public function reload(User $actor): User
    {
        return User::query()->whereKey($actor->getKey())->first() ?? throw new AuthorizationException;
    }

    /** Takes the owners lock for the rest of the surrounding transaction. */
    public function lockOwners(): void
    {
        DB::select('select pg_advisory_xact_lock(?)', [self::OWNERS_LOCK]);
    }

    /**
     * Whether `$staff` is an active owner and the only one. Counts afresh, so call it after `lockOwners()` in the
     * same transaction.
     */
    public function isLastActiveOwner(User $staff): bool
    {
        if (! $staff->is_active || ! $staff->hasRole(StaffRole::Owner->value)) {
            return false;
        }

        return User::query()
            ->where('is_active', true)
            ->role(StaffRole::Owner->value)
            ->count() <= 1;
    }

    private function canManage(User $actor): bool
    {
        return Gate::forUser($actor)->allows(PermissionName::StaffManage->value);
    }
}
