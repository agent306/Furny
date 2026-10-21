<?php

declare(strict_types=1);

namespace App\Listeners;

use App\Actions\Fortify\AuthenticateUser;
use App\Support\Privacy\Mask;
use Illuminate\Auth\Events\Lockout;
use Illuminate\Support\Facades\Log;

/** `auth.lockout` (13 §5.4 step 4): a sign-in was refused because the visitor made too many attempts. */
final class RecordLockout
{
    public function handle(Lockout $event): void
    {
        Log::warning('auth.lockout', [
            'email' => Mask::email((string) AuthenticateUser::email($event->request)),
            'ip' => Mask::ip((string) $event->request->ip()),
        ]);
    }
}
