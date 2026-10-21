<?php

declare(strict_types=1);

namespace App\Domain\Identity\Actions;

use App\Domain\Identity\Models\User;
use App\Domain\Identity\Support\StaffAccess;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use LogicException;

/**
 * Lets a deactivated staff member sign in again (13 §5.9). Owners only by the owner gate. Like deactivation it destroys
 * the member's sessions and rotates the remember token: nothing that was issued before the member was away comes back.
 */
final class ActivateUser
{
    public function __construct(
        private readonly StaffAccess $access,
        private readonly RevokeSessions $sessions,
    ) {}

    /** @throws AuthorizationException when the actor may not act on an owner */
    public function handle(User $actor, User $user): User
    {
        if (! $user->isStaff()) {
            throw new LogicException('Only staff are reactivated here; customers have their own action.');
        }

        $this->access->authorizeTarget($actor, $user);

        $changed = DB::transaction(function () use ($actor, $user): bool {
            // The owners lock, so that a promotion to owner that is under way is over before the gate is asked again.
            $this->access->lockOwners();
            $user->refresh();

            $actor = $this->access->reload($actor);
            $this->access->authorizeTarget($actor, $user);

            if ($user->is_active) {
                return false;
            }

            $user->forceFill(['is_active' => true])->save();

            activity('staff')
                ->performedOn($user)
                ->causedBy($actor)
                ->event('staff.reactivated')
                ->withProperties(['fields' => ['is_active']])
                ->log('staff.reactivated');

            return true;
        });

        // After the commit: what sits in Redis cannot be rolled back.
        if ($changed) {
            $this->sessions->all($user, RevokeSessions::REASON_REACTIVATED);
        }

        return $user;
    }
}
