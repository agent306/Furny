<?php

declare(strict_types=1);

namespace App\Policies\Concerns;

use App\Domain\Identity\Enums\PermissionName;
use App\Domain\Identity\Models\User;

/**
 * Staff check shared by the policies (13 §8). `Gate::before` already denies inactive staff every
 * ability, so `staffCan()` repeats that check only to stay correct when a policy is called directly.
 */
trait AuthorizesStaff
{
    /** Active staff holding the permission. Customers never do, even with a stray role. */
    protected function staffCan(User $user, PermissionName $permission): bool
    {
        return $user->isStaff() && $user->is_active && $user->checkPermissionTo($permission->value);
    }
}
