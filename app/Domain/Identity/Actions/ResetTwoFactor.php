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
 * Clears a staff member's two-factor authentication and signs them out everywhere (13 §5.10): they enrol again at their
 * next sign-in. `$actor` is the staff member who does it for someone else; the break-glass console command passes null
 * and `via` `console`. Nobody resets their own through here.
 */
final class ResetTwoFactor
{
    public function __construct(
        private readonly StaffAccess $access,
        private readonly RevokeSessions $sessions,
    ) {}

    /**
     * @throws AuthorizationException when the actor may not act on an owner
     * @throws CodedValidationException `staff.errors.self`
     */
    public function handle(?User $actor, User $user, string $via = 'web'): void
    {
        if (! $user->isStaff()) {
            throw new LogicException('Only staff have a second factor to reset here.');
        }

        if ($actor !== null) {
            $this->access->authorizeTarget($actor, $user);

            if ($actor->is($user)) {
                throw CodedValidationException::make('staff.errors.self', trans_icu('staff.errors.self'));
            }
        }

        DB::transaction(function () use ($actor, $user, $via): void {
            $user->forceFill([
                'two_factor_secret' => null,
                'two_factor_recovery_codes' => null,
                'two_factor_confirmed_at' => null,
            ])->save();

            $activity = activity('security')->performedOn($user);

            // Nobody is the cause of the break-glass command; it must not be pinned on whoever the session guard knows.
            $actor === null ? $activity->causedByAnonymous() : $activity->causedBy($actor);

            $activity
                ->event('auth.2fa_reset')
                ->withProperties(['via' => $via])
                ->log('auth.2fa_reset');
        });

        $this->sessions->all($user, RevokeSessions::REASON_TWO_FACTOR_RESET);
    }
}
