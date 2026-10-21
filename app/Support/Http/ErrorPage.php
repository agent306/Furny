<?php

declare(strict_types=1);

namespace App\Support\Http;

use App\Http\Middleware\HandleInertiaRequests;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Symfony\Component\HttpFoundation\Response;
use Throwable;

/**
 * Turns framework error responses into the Inertia `Error` page (10 §4.10, 15 §14). The page gets the
 * status and nothing else: no exception message, class, file or trace ever reaches the props.
 */
final class ErrorPage
{
    /** Statuses that always render the page. 500 joins them only when `app.debug` is off. */
    private const array STATUSES = [403, 404, 405, 419, 429, 503];

    /** Paths whose clients are machines (editor API, browser CSP reports, webhooks): errors are JSON or bare, never a page. */
    public const array MACHINE_PATHS = ['api/*', 'csp-report', 'webhooks/*'];

    /** Headers a client or proxy acts on; everything else of the original response is dropped. */
    private const array KEPT_HEADERS = ['Retry-After', 'Allow', 'X-RateLimit-Limit', 'X-RateLimit-Remaining'];

    /**
     * The response to send: the Error page for a handled status, else `$response` untouched. The
     * exception is deliberately unused: the page must not be able to show anything about it.
     */
    public static function render(Response $response, Throwable $exception, Request $request): Response
    {
        $status = $response->getStatusCode();

        if (! self::handles($status, $request)) {
            return $response;
        }

        try {
            // A URL that matches no route never entered the `web` group, which shares the props.
            if (Inertia::getShared('auth') === null) {
                Inertia::share(app(HandleInertiaRequests::class)->share($request));
            }

            $page = Inertia::render('Error', ['status' => $status])->toResponse($request);
        } catch (Throwable $failure) {
            // Rendering the page failed too (e.g. the view): report it and fall back to the original response.
            report($failure);

            return $response;
        }

        $page->setStatusCode($status);

        foreach (self::KEPT_HEADERS as $header) {
            if ($response->headers->has($header)) {
                $page->headers->set($header, $response->headers->get($header));
            }
        }

        return $page;
    }

    /** A client that gets JSON or a bare response, never a page or a redirect: XHR/JSON callers and the machine paths. */
    public static function wantsMachineResponse(Request $request): bool
    {
        return ! $request->header('X-Inertia') && ($request->expectsJson() || $request->is(...self::MACHINE_PATHS));
    }

    private static function handles(int $status, Request $request): bool
    {
        if (self::wantsMachineResponse($request)) {
            return false;
        }

        return in_array($status, self::STATUSES, true) || ($status === 500 && ! config('app.debug'));
    }
}
