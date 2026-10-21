<?php

declare(strict_types=1);

namespace App\Http\Controllers\Customer\Account;

use App\Domain\Identity\Data\AccountProfileProps;
use App\Domain\Identity\Models\User;
use App\Domain\Identity\Otp\OtpChannelResolver;
use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/** `customer.account.profile` (10 §13.2): the details form is Fortify's, the photo and the phone have their own routes. */
final class ProfileController extends Controller
{
    public function show(Request $request, OtpChannelResolver $channels): Response
    {
        $user = $request->user();
        abort_unless($user instanceof User, 403);

        return Inertia::render('Customer/Account/Profile', AccountProfileProps::fromUser($user, $channels)->toArray());
    }
}
