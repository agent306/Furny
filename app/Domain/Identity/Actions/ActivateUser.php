<?php

declare(strict_types=1);

namespace App\Domain\Identity\Actions;

use App\Domain\Identity\Models\User;
use App\Domain\Identity\Support\StaffAccess;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use LogicException;

/** Lets a deactivated staff member sign in again (13 §5.9). Owners only by the owner gate. */
final class ActivateUser
{
    public function __construct(private readonly StaffAccess $access) {}

    /** @throws AuthorizationException when the actor may not act on an owner */
    public function handle(User $actor, User $user): User
    {
        if (! $user->isStaff()) {
            throw new LogicException('Only staff are reactivated here; customers have their own action.');
        }

        $this->access->authorizeTarget($actor, $user);

        DB::transaction(function () use ($actor, $user): void {
            $user->refresh();

            if ($user->is_active) {
                return;
            }

            $user->forceFill(['is_active' => true])->save();

            activity('staff')
                ->performedOn($user)
                ->causedBy($actor)
                ->event('staff.reactivated')
                ->withProperties(['fields' => ['is_active']])
                ->log('staff.reactivated');
        });

        return $user;
    }
}
