<?php

declare(strict_types=1);

namespace App\Http\Controllers\Customer\Account;

use App\Domain\Identity\Actions\RequestAccountDeletion;
use App\Domain\Identity\Data\AccountDeleteProps;
use App\Domain\Identity\Models\User;
use App\Http\Controllers\Controller;
use App\Http\Requests\Account\RequestAccountDeletionRequest;
use App\Support\Settings\Settings;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Inertia\Inertia;
use Inertia\Response;

/** `customer.account.delete` and `customer.account.destroy` (10 §13.7, 13 §9.1): the page, and the request to delete the account. */
final class DeletionController extends Controller
{
    public function show(Request $request): Response
    {
        $user = $request->user();
        abort_unless($user instanceof User, 403);

        return Inertia::render('Customer/Account/Delete', AccountDeleteProps::fromUser($user)->toArray());
    }

    public function destroy(RequestAccountDeletionRequest $request, RequestAccountDeletion $deletion, Settings $settings): RedirectResponse
    {
        $user = $request->userOrFail();

        $deletion->handle($user, (string) $request->input('confirmation'));

        // Every session is gone; this request's is ended too. The flag lands in the new session, which the next page reads.
        Auth::guard('web')->logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();
        Inertia::clearHistory();

        // The date the account is anonymised, in the business's time zone: 30 days after the request.
        $on = $user->deleted_at?->setTimezone($settings->business()->timezone)->addDays(RequestAccountDeletion::GRACE_DAYS);

        return redirect()->route('account.deletion-scheduled')->with('anonymiseOn', $on?->toDateString());
    }
}
