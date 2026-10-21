<?php

declare(strict_types=1);

namespace App\Http\Controllers\Account;

use App\Domain\Identity\Actions\UnlinkGoogleAccount;
use App\Http\Controllers\Controller;
use App\Http\Requests\Account\UnlinkGoogleRequest;
use Inertia\Inertia;
use Symfony\Component\HttpFoundation\Response;

/** Disconnects Google from the signed-in user's account (13 §5.3, 14 §3.3); the route needs `recent.auth`. */
final class GoogleLinkController extends Controller
{
    public function destroy(UnlinkGoogleRequest $request, UnlinkGoogleAccount $unlink): Response
    {
        $unlink->handle($request->userOrFail());

        if ($request->expectsJson()) {
            return response()->noContent();
        }

        Inertia::flash('success', trans_icu('account.toasts.google_unlinked'));

        return back();
    }
}
