<?php

declare(strict_types=1);

namespace App\Http\Controllers\Admin\Account;

use App\Domain\Identity\Data\TwoFactorPageProps;
use App\Domain\Identity\Models\User;
use App\Http\Controllers\Controller;
use App\Support\Auth\IntendedRedirect;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * `admin.security.two-factor` (11 §18, 13 §5.10): the staff member's page for their second factor. It only shows the
 * state; the work is done by Fortify's routes (`two-factor.*`, behind `password.confirm`) that the page calls. It is
 * exempt from `2fa.enrolled`, or an owner who has not enrolled could never get here.
 */
final class TwoFactorController extends Controller
{
    /** Query parameter that sends the visitor through the password confirmation first, and back here. */
    public const string CONFIRM_PASSWORD_QUERY = 'confirm-password';

    public function show(Request $request): Response|RedirectResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 403);

        // The page needs the password confirmed for what Fortify does for it. A visit that asks for the confirmation
        // is sent to the form with this page as the place to return to, whoever the user is: a direct visit to the
        // form (as `password.confirm`'s own 423 gives) would return them to the dashboard.
        if ($request->query(self::CONFIRM_PASSWORD_QUERY) !== null && ! $this->passwordConfirmed($request)) {
            $request->session()->put(IntendedRedirect::SESSION_KEY, route('admin.security.two-factor'));

            return redirect()->route('password.confirm');
        }

        return Inertia::render('Admin/Account/TwoFactor', TwoFactorPageProps::fromUser($user)->toArray());
    }

    /** As `password.confirm` (Laravel's `RequirePassword`) judges it: confirmed within `auth.password_timeout`. */
    private function passwordConfirmed(Request $request): bool
    {
        return time() - (int) $request->session()->get('auth.password_confirmed_at', 0) < (int) config('auth.password_timeout', 10800);
    }
}
