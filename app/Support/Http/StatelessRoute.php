<?php

declare(strict_types=1);

namespace App\Support\Http;

use App\Http\Middleware\TrackSession;
use Illuminate\Cookie\Middleware\AddQueuedCookiesToResponse;
use Illuminate\Cookie\Middleware\EncryptCookies;
use Illuminate\Foundation\Http\Middleware\PreventRequestForgery;
use Illuminate\Session\Middleware\StartSession;
use Illuminate\View\Middleware\ShareErrorsFromSession;

/**
 * The `web` group middleware that start or touch a session. A route that must not start a session or set a
 * cookie (the manifest, CSP reports) passes this list to `withoutMiddleware()`.
 */
final class StatelessRoute
{
    public const array WITHOUT = [
        EncryptCookies::class,
        AddQueuedCookiesToResponse::class,
        StartSession::class,
        ShareErrorsFromSession::class,
        PreventRequestForgery::class,
        TrackSession::class,
    ];
}
