<?php

declare(strict_types=1);

namespace App\Domain\Identity\Actions;

use App\Domain\Identity\Models\StaffInvitation;
use App\Domain\Identity\Models\User;
use App\Domain\Identity\Support\StaffAccess;
use App\Support\Http\CodedValidationException;
use App\Support\Privacy\Mask;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;

/**
 * Withdraws an open invitation (13 §5.9 step 2). The row stays for the audit; its links stop working, and the address
 * can be invited again.
 */
final class RevokeStaffInvitation
{
    public function __construct(private readonly StaffAccess $access) {}

    /**
     * @throws AuthorizationException when the actor may not invite, or the invitation is for an owner and they are not one
     * @throws CodedValidationException `staff.invitation_closed`
     */
    public function handle(User $actor, StaffInvitation $invitation): StaffInvitation
    {
        $this->access->authorizeGrant($actor, $invitation->role);

        return DB::transaction(function () use ($actor, $invitation): StaffInvitation {
            $locked = StaffInvitation::query()->whereKey($invitation->getKey())->lockForUpdate()->firstOrFail();

            if (! $locked->isOpen()) {
                throw CodedValidationException::make('staff.invitation_closed', trans_icu('staff.errors.invitation_closed'), 'invitation');
            }

            $locked->forceFill(['revoked_at' => now()])->save();

            activity('staff')
                ->performedOn($locked)
                ->causedBy($actor)
                ->event('staff.invitation_revoked')
                ->withProperties(['email' => Mask::email($locked->email), 'role' => $locked->role->value])
                ->log('staff.invitation_revoked');

            return $locked;
        });
    }
}
