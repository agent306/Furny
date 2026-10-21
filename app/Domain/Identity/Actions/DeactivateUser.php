<?php

declare(strict_types=1);

namespace App\Domain\Identity\Actions;

use App\Domain\Identity\Models\User;
use App\Domain\Identity\Support\StaffAccess;
use App\Support\Http\CodedValidationException;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use LogicException;

/**
 * Deactivates a staff member (13 §5.9): they can no longer sign in, every session of theirs is destroyed and the
 * remember token is rotated. Staff are never deleted (audit integrity). The last active owner cannot be deactivated,
 * and nobody can deactivate themselves.
 */
final class DeactivateUser
{
    public function __construct(
        private readonly StaffAccess $access,
        private readonly RevokeSessions $sessions,
    ) {}

    /**
     * @throws AuthorizationException when the actor may not act on an owner
     * @throws CodedValidationException `staff.last_owner` or `staff.errors.self`
     */
    public function handle(User $actor, User $user): User
    {
        if (! $user->isStaff()) {
            throw new LogicException('Only staff are deactivated here; customers have their own action.');
        }

        $this->access->authorizeTarget($actor, $user);

        $changed = DB::transaction(function () use ($actor, $user): bool {
            $this->access->lockOwners();
            $user->refresh();

            if (! $user->is_active) {
                return false;
            }

            // The more helpful refusal first: the only owner left is also oneself.
            if ($this->access->isLastActiveOwner($user)) {
                throw CodedValidationException::make('staff.last_owner', trans_icu('staff.errors.last_owner'));
            }

            if ($actor->is($user)) {
                throw CodedValidationException::make('staff.errors.self', trans_icu('staff.errors.self'));
            }

            $user->forceFill(['is_active' => false])->save();

            activity('staff')
                ->performedOn($user)
                ->causedBy($actor)
                ->event('staff.deactivated')
                ->withProperties(['fields' => ['is_active']])
                ->log('staff.deactivated');

            return true;
        });

        // After the commit: what sits in Redis cannot be rolled back.
        if ($changed) {
            $this->sessions->all($user, RevokeSessions::REASON_DEACTIVATED);
        }

        return $user;
    }
}
