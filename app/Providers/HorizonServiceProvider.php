<?php

declare(strict_types=1);

namespace App\Providers;

use Laravel\Horizon\HorizonApplicationServiceProvider;

/**
 * Horizon's authorization hook. `viewHorizon` (active staff with role owner or admin,
 * 17 §5.11 item 12) is defined by AuthServiceProvider next to the other dashboard gates, so the
 * package's placeholder gate (an empty email allowlist) is replaced with nothing here.
 */
final class HorizonServiceProvider extends HorizonApplicationServiceProvider
{
    protected function gate(): void
    {
        // Intentionally empty.
    }
}
