<?php

declare(strict_types=1);

namespace App\Domain\Identity\Actions;

use App\Domain\Identity\Enums\StaffRole;
use App\Domain\Identity\Models\User;
use App\Domain\Identity\Support\StaffAccess;
use App\Support\Http\CodedValidationException;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use LogicException;

/**
 * Changes a staff member's name and role (13 §5.9, §7.3). A member has exactly one role (`syncRoles([$role])`), and the
 * new role applies at once: promoting someone to admin sends them to enrol in two-factor authentication on their next
 * request.
 */
final class UpdateStaffMember
{
    public function __construct(private readonly StaffAccess $access) {}

    /**
     * @throws AuthorizationException when the actor may not act on an owner, or give the owner role
     * @throws CodedValidationException `staff.last_owner` or `staff.errors.self`, on `role`
     */
    public function handle(User $actor, User $staff, string $name, StaffRole $role): User
    {
        if (! $staff->isStaff()) {
            throw new LogicException('Only staff have a role to change.');
        }

        $this->access->authorizeTarget($actor, $staff);
        $this->access->authorizeGrant($actor, $role);

        return DB::transaction(function () use ($actor, $staff, $name, $role): User {
            $this->access->lockOwners();
            $staff->refresh();

            $from = $this->access->roleOf($staff);
            $changesRole = $from !== $role;

            if ($changesRole) {
                // The more helpful refusal first: the only owner left is also oneself.
                if ($this->access->isLastActiveOwner($staff)) {
                    throw CodedValidationException::make('staff.last_owner', trans_icu('staff.errors.last_owner'), 'role');
                }

                if ($actor->is($staff)) {
                    throw CodedValidationException::make('staff.errors.self', trans_icu('staff.errors.self'), 'role');
                }
            }

            $staff->forceFill(['name' => trim($name)])->save();

            // Exactly one role, even when a stray second one was attached some other way.
            if ($staff->roles->pluck('name')->all() !== [$role->value]) {
                $staff->syncRoles([$role->value]);
            }

            if ($changesRole) {
                activity('staff')
                    ->performedOn($staff)
                    ->causedBy($actor)
                    ->event('staff.role_changed')
                    ->withProperties(['from' => $from?->value, 'to' => $role->value])
                    ->log('staff.role_changed');
            }

            return $staff;
        });
    }
}
