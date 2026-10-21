<?php

declare(strict_types=1);

namespace App\Providers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Laravel\Horizon\Horizon;
use Laravel\Horizon\HorizonApplicationServiceProvider;

/**
 * Horizon's authorization hook. The package lets everybody in on a local environment; 17 §5.11 item 12
 * allows only active staff with role owner or admin everywhere, so the check is the `viewHorizon`
 * gate alone (defined in AuthServiceProvider).
 */
final class HorizonServiceProvider extends HorizonApplicationServiceProvider
{
    protected function authorization(): void
    {
        Horizon::auth(static fn (Request $request): bool => $request->user() !== null
            && Gate::forUser($request->user())->allows('viewHorizon'));
    }
}
