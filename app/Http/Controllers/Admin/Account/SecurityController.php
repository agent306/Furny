<?php

declare(strict_types=1);

namespace App\Http\Controllers\Admin\Account;

use App\Domain\Identity\Data\AccountSecurityProps;
use App\Domain\Identity\Models\User;
use App\Http\Controllers\Controller;
use App\Support\Auth\SessionRegistry;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/** `admin.account.security` (11 §18): password, Google and the devices; the second factor has its own page (`admin.security.two-factor`). */
final class SecurityController extends Controller
{
    public function show(Request $request, SessionRegistry $registry): Response
    {
        $user = $request->user();
        abort_unless($user instanceof User, 403);

        return Inertia::render(
            'Admin/Account/Security',
            AccountSecurityProps::fromUser($user, $registry, $request->session()->getId())->toArray(),
        );
    }
}
