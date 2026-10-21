<?php

declare(strict_types=1);

namespace App\Domain\Identity\Actions;

use App\Domain\Identity\Models\User;
use App\Support\Auth\SessionRegistry;
use Illuminate\Support\Facades\Auth;
use Inertia\Inertia;

/**
 * Signs a user out of some or all of their devices (13 §6.3). Whoever revokes sessions (the device list, and later
 * a password change, a deactivation, a 2FA reset or an account deletion request) goes through here, so each
 * revocation is audited as `auth.sessions_revoked {count, reason}` with the number of sessions that were really
 * open, and the browser history of the session that is signed out or kept is cleared (13 §12.4).
 */
final class RevokeSessions
{
    public const string REASON_DEVICE = 'signed_out_device';

    public const string REASON_OTHERS = 'signed_out_others';

    public const string REASON_PASSWORD_CHANGED = 'password_changed';

    /** A staff member was deactivated (13 §5.9). */
    public const string REASON_DEACTIVATED = 'deactivated';

    /** A staff member was reactivated (13 §5.9). */
    public const string REASON_REACTIVATED = 'reactivated';

    /** A staff member's two-factor authentication was reset (13 §5.10). */
    public const string REASON_TWO_FACTOR_RESET = '2fa_reset';

    public const string REASON_PASSWORD_RESET = 'password_reset';

    /** Google was linked to an account whose address nobody had verified: whatever its earlier holder could use is cleared. */
    public const string REASON_GOOGLE_LINK_UNVERIFIED = 'google_link_unverified';

    public function __construct(private readonly SessionRegistry $registry) {}

    /**
     * Signs out one device, named by its key. When it is the device in use (`$isCurrent`) the user is logged out of
     * this request's session too.
     *
     * @return int|null how many sessions that closed: 1, or 0 for an entry that was already dead and is only
     *                  removed from the list; null when the user has no such device
     */
    public function device(User $user, string $sessionKey, bool $isCurrent = false): ?int
    {
        $open = $this->registry->destroyDevice($user, $sessionKey);

        if ($open === null) {
            return null;
        }

        $this->audit($user, $open, self::REASON_DEVICE);

        if ($isCurrent) {
            // This device only: `logout()` would cycle the remember token and end every other device's cookie.
            Auth::guard('web')->logoutCurrentDevice();
            session()->invalidate();
            session()->regenerateToken();

            // After the invalidation, so the flag lands in the new session, which is the one the login page uses.
            Inertia::clearHistory();
        }

        return $open;
    }

    /**
     * Signs out every device but the one in use and rotates the remember token. Returns how many were open.
     */
    public function others(User $user, string $currentSessionId, string $reason = self::REASON_OTHERS): int
    {
        $count = $this->registry->destroyOthers($user, $currentSessionId);

        $this->audit($user, $count, $reason);
        Inertia::clearHistory();

        return $count;
    }

    /**
     * Signs out every device, the current one included, and rotates the remember token. Returns how many were open.
     * When the user is the one making this request their history is cleared as well.
     */
    public function all(User $user, string $reason): int
    {
        $count = $this->registry->destroyAll($user);

        $this->audit($user, $count, $reason);

        if (Auth::id() === $user->getKey()) {
            Inertia::clearHistory();
        }

        return $count;
    }

    private function audit(User $user, int $count, string $reason): void
    {
        if ($count === 0) {
            return;
        }

        activity('security')
            ->performedOn($user)
            ->causedBy(Auth::user() ?? $user)
            ->event('auth.sessions_revoked')
            ->withProperties(['count' => $count, 'reason' => $reason])
            ->log('auth.sessions_revoked');
    }
}
