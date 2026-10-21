<?php

declare(strict_types=1);

namespace App\Http\Controllers\Admin\Account;

use App\Domain\Identity\Data\AccountProfileProps;
use App\Domain\Identity\Models\User;
use App\Domain\Identity\Otp\OtpChannelResolver;
use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/** `admin.account.profile` (11 §18): the same page as the customer one; staff have an email, and their phone receives WhatsApp notices. */
final class ProfileController extends Controller
{
    public function show(Request $request, OtpChannelResolver $channels): Response
    {
        $user = $request->user();
        abort_unless($user instanceof User, 403);

        return Inertia::render('Admin/Account/Profile', AccountProfileProps::fromUser($user, $channels)->toArray());
    }
}
