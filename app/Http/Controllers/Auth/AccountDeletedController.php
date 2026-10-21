<?php

declare(strict_types=1);

namespace App\Http\Controllers\Auth;

use App\Domain\Identity\Data\AccountDeletionScheduledProps;
use App\Http\Controllers\Controller;
use App\Support\Settings\Settings;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/** `account.deletion-scheduled` (13 §9.1, 14 §2): where a customer lands after asking to delete the account. Public: they are signed out by now. */
final class AccountDeletedController extends Controller
{
    public function __invoke(Request $request, Settings $settings): Response
    {
        $date = $request->session()->get('anonymiseOn');

        return Inertia::render('Auth/AccountDeletionScheduled', (new AccountDeletionScheduledProps(
            anonymiseOn: is_string($date) ? $date : null,
            supportEmail: $settings->business()->email,
        ))->toArray());
    }
}
