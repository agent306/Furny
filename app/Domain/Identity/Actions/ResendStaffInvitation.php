<?php

declare(strict_types=1);

namespace App\Domain\Identity\Actions;

use App\Domain\Identity\Models\StaffInvitation;
use App\Domain\Identity\Models\User;
use App\Domain\Identity\Support\StaffAccess;
use App\Notifications\Staff\StaffInvited;
use App\Support\Http\CodedValidationException;
use App\Support\Privacy\Mask;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;

/**
 * Sends an open invitation again (13 §5.9 step 2): another 72 hours from now, and a new signed link. An invitation that
 * ran out can be revived this way; one that was accepted or revoked cannot. Links sent earlier keep working until their
 * own signature expires, as long as the invitation itself is open.
 */
final class ResendStaffInvitation
{
    public function __construct(private readonly StaffAccess $access) {}

    /**
     * @throws AuthorizationException when the actor may not invite, or the invitation is for an owner and they are not one
     * @throws CodedValidationException `staff.invitation_closed` or `staff.email_in_use`
     */
    public function handle(User $actor, StaffInvitation $invitation): StaffInvitation
    {
        $this->access->authorizeGrant($actor, $invitation->role);

        $invitation = DB::transaction(function () use ($actor, $invitation): StaffInvitation {
            $locked = StaffInvitation::query()->whereKey($invitation->getKey())->lockForUpdate()->firstOrFail();

            if (! $locked->isOpen()) {
                throw CodedValidationException::make('staff.invitation_closed', trans_icu('staff.errors.invitation_closed'), 'invitation');
            }

            if (User::withTrashed()->where('email', $locked->email)->exists()) {
                throw CodedValidationException::make('staff.email_in_use', trans_icu('staff.errors.email_in_use'), 'email');
            }

            $locked->forceFill(['expires_at' => now()->addHours(StaffInvitation::VALID_FOR_HOURS)])->save();

            activity('staff')
                ->performedOn($locked)
                ->causedBy($actor)
                ->event('staff.invitation_resent')
                ->withProperties(['email' => Mask::email($locked->email), 'role' => $locked->role->value])
                ->log('staff.invitation_resent');

            return $locked;
        });

        Notification::route('mail', $invitation->email)->notify(new StaffInvited($invitation));

        return $invitation;
    }
}
