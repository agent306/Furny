<?php

declare(strict_types=1);

namespace App\Domain\Identity\Actions;

use App\Domain\Identity\Enums\UserType;
use App\Domain\Identity\Models\StaffInvitation;
use App\Domain\Identity\Models\User;
use App\Domain\Identity\Support\AccountDefaults;
use App\Domain\Identity\Support\ContactVerification;
use App\Domain\Identity\Support\InvitationUnavailable;
use App\Support\Http\CodedValidationException;
use App\Support\Privacy\Mask;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use SensitiveParameter;

/**
 * The invitee sets a password and becomes a staff member (13 §5.9 step 5). Everything happens under a lock on the
 * invitation row, and its state is checked again after the lock is taken: of two requests that arrive together (a
 * double click, a link opened in two browsers) exactly one creates the user, the other finds the invitation accepted.
 *
 * The address must still belong to nobody, soft-deleted accounts included: a customer may have registered with it
 * since the invitation went out. The signed-in method of the new member is the caller's to record.
 */
final class AcceptStaffInvitation
{
    public function __construct(
        private readonly AccountDefaults $defaults,
        private readonly ContactVerification $contacts,
    ) {}

    /**
     * @param  ?string  $googleId  the Google account the invitee chose; left out when another account has it
     *
     * @throws InvitationUnavailable when the invitation is not open any more
     * @throws CodedValidationException `staff.email_in_use`, on `email`
     */
    public function handle(StaffInvitation $invitation, string $name, #[SensitiveParameter] string $password, ?string $googleId): User
    {
        return DB::transaction(function () use ($invitation, $name, $password, $googleId): User {
            $locked = StaffInvitation::query()->whereKey($invitation->getKey())->lockForUpdate()->first();

            if ($locked === null) {
                throw new InvitationUnavailable(InvitationUnavailable::INVALID);
            }

            match (true) {
                $locked->accepted_at !== null => throw new InvitationUnavailable(InvitationUnavailable::ACCEPTED),
                $locked->revoked_at !== null => throw new InvitationUnavailable(InvitationUnavailable::REVOKED),
                $locked->isExpired() => throw new InvitationUnavailable(InvitationUnavailable::EXPIRED),
                default => null,
            };

            if ($this->emailInUse($locked->email)) {
                throw $this->emailTaken();
            }

            if ($googleId !== null && User::withTrashed()->where('google_id', $googleId)->exists()) {
                $googleId = null;
            }

            $user = $this->create($locked, trim($name), $password, $googleId);

            // Owners and admins enrol in two-factor authentication when they first reach the admin area (13 §5.10).
            $this->contacts->markEmailVerified($user);
            $user->assignRole($locked->role->value);

            $locked->forceFill(['accepted_at' => now(), 'user_id' => $user->getKey()])->save();

            activity('staff')
                ->performedOn($locked)
                ->causedBy($user)
                ->event('staff.invitation_accepted')
                ->withProperties(['email' => Mask::email($locked->email), 'role' => $locked->role->value])
                ->log('staff.invitation_accepted');

            return $user;
        });
    }

    private function create(StaffInvitation $invitation, string $name, #[SensitiveParameter] string $password, ?string $googleId): User
    {
        $user = new User([
            'name' => $name,
            'email' => $invitation->email,
            'password' => $password,
            ...$this->defaults->attributes(),
        ]);
        $user->type = UserType::Staff;
        $user->is_active = true;
        $user->google_id = $googleId;
        $user->terms_accepted_at = now();

        try {
            // A savepoint of its own: a unique violation must not poison the transaction we are in.
            DB::transaction(static fn (): bool => $user->save());
        } catch (UniqueConstraintViolationException) {
            // Somebody took the address, or the Google account, between the checks and the insert.
            if ($this->emailInUse($invitation->email)) {
                throw $this->emailTaken();
            }

            $user->google_id = null;
            $user->save();
        }

        return $user;
    }

    private function emailInUse(string $email): bool
    {
        return User::withTrashed()->where('email', $email)->exists();
    }

    private function emailTaken(): CodedValidationException
    {
        return CodedValidationException::make('staff.email_in_use', trans_icu('staff.errors.email_in_use'), 'email');
    }
}
