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
     * silent (13 §5.5), so it never answers 429. The resend button is the verification page's own form. The phone
     * sign-in pages (`auth.otp.*`) and the re-authentication page each count their wait down; the dialog that adds a
     * phone number to an account (`account.phone.*`) shows the wait inside the dialog. A refusal that came back as a
     * toast would look like a success to the dialog (a redirect without errors), so it gets the error. The two-factor
     * challenge counts its wait down on its own page, too (13 §5.10).
     */
    public const array INLINE_ROUTES = [
        'login.store',
        'two-factor.login.store',
        'register.store',
        'verification.send',
        'auth.otp.send',
        'auth.otp.verify',
        'auth.otp.resend',
        'auth.otp.complete',
        'auth.reauthenticate.store',
        'account.phone.send',
        'account.phone.verify',
    ];

    /**
     * Request header of a form that sits on a page of its own and wants the wait as a toast even though its route is
     * inline: the verify-contact banner posts to `verification.send` from every customer page, where there is no
     * countdown to show the wait in. The verify page's own resend form does not send it and keeps its countdown.
     */
    public const string TOAST_HEADER = 'X-Throttle-Toast';

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
        if ($request->routeIs(...self::INLINE_ROUTES) && ! $request->headers->has(self::TOAST_HEADER)) {
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
