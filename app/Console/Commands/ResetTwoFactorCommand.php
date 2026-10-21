<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Domain\Identity\Actions\ResetTwoFactor;
use App\Domain\Identity\Models\User;
use Illuminate\Console\Command;

/**
 * Break-glass for a sole owner who lost the authenticator and every recovery code (13 §5.10): clears the second factor
 * of a staff member and signs them out everywhere, from the server. It needs no staff member to ask for it, so it is
 * audited with no causer and `via: console`. The address is the only argument; deactivated staff are reset as well.
 */
final class ResetTwoFactorCommand extends Command
{
    protected $signature = 'furny:reset-two-factor {email : Email address of the staff member}';

    protected $description = 'Clear the two-factor authentication of a staff member (break-glass for a locked-out owner)';

    public function handle(ResetTwoFactor $reset): int
    {
        $email = $this->argument('email');
        $email = is_string($email) ? mb_strtolower(trim($email)) : '';
        $user = User::query()->where('email', $email)->first();

        if (! $user instanceof User) {
            $this->error('No user has that email address.');

            return self::FAILURE;
        }

        if (! $user->isStaff()) {
            $this->error('That user is not a staff member: only staff have two-factor authentication.');

            return self::FAILURE;
        }

        $reset->handle(null, $user, 'console');

        $this->info('Two-factor authentication is cleared and every session of that user is signed out. They set it up again at their next sign-in.');

        return self::SUCCESS;
    }
}
