<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Http\Middleware\HandleInertiaRequests;

/** The headers of an Inertia visit (XHR navigation), for tests that read the page JSON instead of the HTML. */
final class InertiaRequest
{
    /** @return array<string, string> */
    public static function headers(): array
    {
        return [
            'X-Inertia' => 'true',
            'X-Inertia-Version' => (string) app(HandleInertiaRequests::class)->version(request()),
        ];
    }
}
