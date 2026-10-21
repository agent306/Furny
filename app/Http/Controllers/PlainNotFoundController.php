<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * A missing asset or API path: a bare 404 with no session, no cookie and no Inertia page. Crawlers,
 * `<img>` tags and API clients get nothing to render and nothing to track.
 */
final class PlainNotFoundController extends Controller
{
    public function __invoke(Request $request): Response|JsonResponse
    {
        if ($request->is('api/*')) {
            return response()->json(['message' => 'Not Found'], 404);
        }

        return response('Not Found', 404, ['Content-Type' => 'text/plain; charset=UTF-8']);
    }
}
