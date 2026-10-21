<?php

declare(strict_types=1);

namespace App\Http\Controllers\Account;

use App\Domain\Identity\Actions\UnlinkGoogleAccount;
use App\Domain\Identity\Models\User;
use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Symfony\Component\HttpFoundation\Response;

/** Disconnects Google from the signed-in user's account (13 §5.3, 14 §3.3); the route needs `recent.auth`. */
final class GoogleLinkController extends Controller
{
    public function destroy(Request $request, UnlinkGoogleAccount $unlink): Response
    {
        $user = $request->user();
        abort_unless($user instanceof User, 403);

        $unlink->handle($user);

        if ($request->expectsJson()) {
            return response()->noContent();
        }

        Inertia::flash('success', trans_icu('account.toasts.google_unlinked'));

        return back();
    }
}
