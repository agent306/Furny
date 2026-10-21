<?php

declare(strict_types=1);

namespace App\Policies\Concerns;

use App\Domain\Identity\Enums\PermissionName;
use App\Domain\Identity\Models\User;
use Illuminate\Auth\Access\Response;

/**
 * Staff checks shared by the policies (13 §8). `Gate::before` already denies inactive staff every
 * ability, so `staffCan()` repeats that check only to stay correct when a policy is called directly.
 */
trait AuthorizesStaff
{
    /** Active staff holding the permission. Customers never do, even with a stray role. */
    protected function staffCan(User $user, PermissionName $permission): bool
    {
        return $user->isStaff() && $user->is_active && $user->checkPermissionTo($permission->value);
    }

    /**
     * Allow, or deny the way 13 §8 prescribes: a customer who does not own the record gets 404 so the
     * record's existence is not revealed; staff and the record's own customer get 403.
     */
    protected function allowOrDeny(bool $allowed, User $user, bool $ownsRecord = false): Response
    {
        return match (true) {
            $allowed => Response::allow(),
            $user->isCustomer() && ! $ownsRecord => Response::denyAsNotFound(),
            default => Response::denyWithStatus(403),
        };
    }
}
