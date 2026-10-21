<?php

declare(strict_types=1);

namespace App\Providers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Laravel\Telescope\IncomingEntry;
use Laravel\Telescope\Telescope;
use Laravel\Telescope\TelescopeApplicationServiceProvider;

/**
 * Telescope is a dev/staging tool (17 §5.10 item 10): composer.json keeps it out of package
 * discovery and AppServiceProvider registers this provider only when TELESCOPE_ENABLED is on
 * and the package is installed. It is therefore not listed in bootstrap/providers.php.
 */
final class TelescopeServiceProvider extends TelescopeApplicationServiceProvider
{
    public function register(): void
    {
        $this->hideSensitiveRequestDetails();

        $isLocal = $this->app->environment('local');

        Telescope::filter(fn (IncomingEntry $entry): bool => $isLocal
            || $entry->isReportableException()
            || $entry->isFailedRequest()
            || $entry->isFailedJob()
            || $entry->isScheduledTask()
            || $entry->hasMonitoredTag());
    }

    /** Prevent sensitive request details from being recorded outside local development. */
    protected function hideSensitiveRequestDetails(): void
    {
        if ($this->app->environment('local')) {
            return;
        }

        Telescope::hideRequestParameters(['_token']);

        Telescope::hideRequestHeaders([
            'cookie',
            'set-cookie',
            'x-csrf-token',
            'x-xsrf-token',
        ]);
    }

    /**
     * The package lets everybody in on a local environment; 17 §5.11 item 12 allows only active staff
     * with role owner or admin everywhere, so the check is the `viewTelescope` gate alone (defined in
     * AuthServiceProvider).
     */
    protected function authorization(): void
    {
        Telescope::auth(static fn (Request $request): bool => $request->user() !== null
            && Gate::forUser($request->user())->allows('viewTelescope'));
    }
}
