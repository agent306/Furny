<?php

declare(strict_types=1);

namespace App\Domain\Identity\Actions;

use App\Domain\Identity\Enums\StaffRole;
use App\Domain\Identity\Models\StaffInvitation;
use App\Domain\Identity\Models\User;
use App\Domain\Identity\Support\StaffAccess;
use App\Notifications\Staff\StaffInvited;
use App\Support\Http\CodedValidationException;
use App\Support\Privacy\Mask;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;

/**
 * Invites someone to join the staff (13 §5.9 step 1): a row of `staff_invitations` that is good for 72 hours, and a
 * mail with a signed link to the address. Customers and staff are separate accounts, so an address that belongs to any
 * user, a deleted one included, cannot be invited; and an address has one open invitation at a time. One that ran out
 * is not pending any more: it is closed for good and replaced.
 */
final class InviteStaff
{
    public function __construct(private readonly StaffAccess $access) {}

    /**
     * @throws AuthorizationException when the actor may not invite, or not invite an owner
     * @throws CodedValidationException `staff.email_in_use` or `staff.invitation_pending`, on `email`
     */
    public function handle(User $actor, string $email, string $name, StaffRole $role): StaffInvitation
    {
        $this->access->authorizeGrant($actor, $role);

        $email = mb_strtolower(trim($email));

        $invitation = DB::transaction(function () use ($actor, $email, $name, $role): StaffInvitation {
            if (User::withTrashed()->where('email', $email)->exists()) {
                throw CodedValidationException::make('staff.email_in_use', trans_icu('staff.errors.email_in_use'), 'email');
            }

            $open = StaffInvitation::query()
                ->where('email', $email)
                ->whereNull('accepted_at')
                ->whereNull('revoked_at')
                ->lockForUpdate()
                ->first();

            if ($open !== null) {
                if (! $open->isExpired()) {
                    throw $this->pending();
                }

                $open->forceFill(['revoked_at' => now()])->save();
                $this->audit($actor, $open, 'staff.invitation_revoked', ['reason' => 'superseded']);
            }

            try {
                $invitation = StaffInvitation::query()->create([
                    'email' => $email,
                    'name' => trim($name),
                    'role' => $role,
                    'invited_by' => $actor->getKey(),
                    'expires_at' => now()->addHours(StaffInvitation::VALID_FOR_HOURS),
                ]);
            } catch (UniqueConstraintViolationException) {
                // Somebody else invited the same address at the same moment.
                throw $this->pending();
            }

            $this->audit($actor, $invitation, 'staff.invited');

            return $invitation;
        });

        Notification::route('mail', $invitation->email)->notify(new StaffInvited($invitation));

        return $invitation;
    }

    private function pending(): CodedValidationException
    {
        return CodedValidationException::make('staff.invitation_pending', trans_icu('staff.errors.invitation_pending'), 'email');
    }

    /** @param  array<string, string>  $extra */
    private function audit(User $actor, StaffInvitation $invitation, string $event, array $extra = []): void
    {
        activity('staff')
            ->performedOn($invitation)
            ->causedBy($actor)
            ->event($event)
            ->withProperties(['email' => Mask::email($invitation->email), 'role' => $invitation->role->value, ...$extra])
            ->log($event);
    }
}
