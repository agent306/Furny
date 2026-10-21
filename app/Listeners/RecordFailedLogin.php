<?php

declare(strict_types=1);

namespace App\Listeners;

use App\Support\Privacy\Mask;
use Illuminate\Auth\Events\Failed;
use Laravel\Fortify\Fortify;

/**
 * `auth.login_failed` (13 §5.4 step 4, §17): no causer, the email and the IP masked. The event carries the
 * submitted password in its credentials; only the email is read.
 */
final class RecordFailedLogin
{
    public function handle(Failed $event): void
    {
        $email = $event->credentials[Fortify::username()] ?? null;
        $email = is_string($email) ? mb_strtolower(trim($email)) : '';

        activity('security')
            ->causedByAnonymous()
            ->event('auth.login_failed')
            ->withProperties([
                'email' => Mask::email($email),
                'ip' => Mask::ip((string) request()->ip()),
            ])
            ->log('auth.login_failed');
    }
}
