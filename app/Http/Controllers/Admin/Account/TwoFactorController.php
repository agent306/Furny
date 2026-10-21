<?php

declare(strict_types=1);

namespace App\Http\Controllers\Admin\Account;

use App\Domain\Identity\Data\TwoFactorPageProps;
use App\Domain\Identity\Models\User;
use App\Http\Controllers\Controller;
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
    public function show(Request $request): Response
    {
        $user = $request->user();
        abort_unless($user instanceof User, 403);

        return Inertia::render('Admin/Account/TwoFactor', TwoFactorPageProps::fromUser($user)->toArray());
    }
}
