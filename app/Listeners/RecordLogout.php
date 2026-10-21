<?php

declare(strict_types=1);

namespace App\Listeners;

use App\Domain\Identity\Models\User;
use App\Support\Auth\SessionKey;
use App\Support\Auth\SessionRegistry;
use Illuminate\Auth\Events\CurrentDeviceLogout;
use Illuminate\Auth\Events\Logout;
use Throwable;

/**
 * `auth.logout` (13 §5.4 step 5, §17): takes the session out of the registry and writes the audit entry. The
 * browser history is cleared by `LogoutResponse`, after the session has been invalidated. `CurrentDeviceLogout` is
 * what signing out one device fires; `Logout` is fired by the other ends of a session.
 */
final class RecordLogout
{
    public function __construct(private readonly SessionRegistry $registry) {}

    public function handle(Logout|CurrentDeviceLogout $event): void
    {
        $user = $event->user;

        if (! $user instanceof User) {
            return;
        }

        $request = request();

        if ($request->hasSession()) {
            try {
                $this->registry->destroy($user, SessionKey::for($request->session()->getId()));
            } catch (Throwable $e) {
                // The registry is a convenience for the user: signing out must not fail because Redis is down.
                report($e);
            }
        }

        activity('security')
            ->performedOn($user)
            ->causedBy($user)
            ->event('auth.logout')
            ->log('auth.logout');
    }
}
