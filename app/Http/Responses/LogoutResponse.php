<?php

declare(strict_types=1);

namespace App\Http\Responses;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Laravel\Fortify\Contracts\LogoutResponse as LogoutResponseContract;
use Symfony\Component\HttpFoundation\Response;

/**
 * After logging out (14 §3.1): the history of the browser is cleared (13 §12.4), so the back button of a shared
 * device cannot show pages of the account. Fortify has invalidated the session by now, so the flag lands in the
 * new one, which is the session the next page is rendered with.
 */
final class LogoutResponse implements LogoutResponseContract
{
    /** @param  Request  $request */
    public function toResponse($request): Response
    {
        Inertia::clearHistory();

        return $request->wantsJson()
            ? new JsonResponse('', 204)
            : redirect('/');
    }
}
