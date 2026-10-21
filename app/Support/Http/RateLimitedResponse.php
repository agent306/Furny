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
 *
 * The forms of the auth pages are the exception (10 §4): their page shows the wait inline, as a countdown, so
 * the visit comes back with the seconds as the validation error `rate_limited` and no toast.
 */
final class RateLimitedResponse
{
    /**
     * Route names of forms that show the wait on the page itself. The password reset form is not here: its limit is
     * silent (13 §5.5), so it never answers 429. The resend button is the verification page's own form.
     */
    public const array INLINE_ROUTES = ['login.store', 'register.store', 'verification.send'];

    /** The validation error that carries the wait, in seconds, to the page. */
    public const string INLINE_ERROR = 'rate_limited';

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

        // Without a session there is nowhere to keep the message.
        if (! $request->hasSession()) {
            return null;
        }

        // A form posts to the URL of its own page, so for it going back is not a loop.
        if ($request->routeIs(...self::INLINE_ROUTES)) {
            return redirect()->to($previous)->withErrors([self::INLINE_ERROR => (string) $seconds]);
        }

        // Going back to the page that was throttled would only be throttled again.
        if ($previous === $request->fullUrl()) {
            return null;
        }

        Inertia::flash('error', trans_icu('errors.rate_limited', ['seconds' => $seconds]));

        return redirect()->to($previous);
    }
}
