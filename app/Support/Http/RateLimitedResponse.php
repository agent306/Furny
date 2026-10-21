<?php

declare(strict_types=1);

namespace App\Support\Http;

use Illuminate\Http\Exceptions\ThrottleRequestsException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;

/**
 * Renders `ThrottleRequestsException` (13 §10): JSON and XHR clients get `429 {code, retryAfter}`; an
 * Inertia visit is sent back with the wait as a native Inertia flash (the toast); anything else falls
 * through to the Error page.
 */
final class RateLimitedResponse
{
    public static function render(ThrottleRequestsException $exception, Request $request): JsonResponse|RedirectResponse|null
    {
        $seconds = max(1, (int) ($exception->getHeaders()['Retry-After'] ?? 60));

        if ($request->header('X-Inertia')) {
            return self::flashBack($request, $seconds);
        }

        if ($request->expectsJson() || $request->isJson() || $request->is(...ErrorPage::MACHINE_PATHS)) {
            return response()->json(['code' => 'rate_limited', 'retryAfter' => $seconds], 429, $exception->getHeaders());
        }

        return null;
    }

    private static function flashBack(Request $request, int $seconds): ?RedirectResponse
    {
        $previous = url()->previous();

        // Without a session there is nowhere to keep the message; going back to the page that was
        // throttled would only be throttled again.
        if (! $request->hasSession() || $previous === $request->fullUrl()) {
            return null;
        }

        Inertia::flash('error', trans_icu('errors.rate_limited', ['seconds' => $seconds]));

        return redirect()->to($previous);
    }
}
