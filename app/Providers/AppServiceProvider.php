<?php

declare(strict_types=1);

namespace App\Providers;

use App\Domain\Identity\Models\User;
use App\Support\MorphMap;
use App\Support\Settings\Settings;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Relations\Relation;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\URL;
use Illuminate\Support\ServiceProvider;
use Illuminate\Validation\Rules\Password;
use Laravel\Pulse\Facades\Pulse;

final class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        $this->app->singleton(Settings::class);

        // Telescope is kept out of package discovery (composer.json) and runs only where the
        // dev dependency is installed and TELESCOPE_ENABLED is on (17 §5.11 item 10).
        if (class_exists(\Laravel\Telescope\TelescopeServiceProvider::class) && config('telescope.enabled')) {
            $this->app->register(\Laravel\Telescope\TelescopeServiceProvider::class);
            $this->app->register(TelescopeServiceProvider::class);
        }
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        $this->configureDefaults();
        Relation::enforceMorphMap(MorphMap::MAP);
        $this->warnWhenAppNameIsTooLongForSms();
        $this->configureTransport();
        $this->warnWhenCspOriginsAreRejected();
        $this->configurePulseUsers();
    }

    /**
     * config/security.php drops AWS/Reverb origins that are not plain origins (they would be pasted into the
     * Content-Security-Policy); it cannot log, so the warning is given here, once per process.
     */
    private function warnWhenCspOriginsAreRejected(): void
    {
        $variables = (array) config('security.csp.rejected', []);

        if ($variables !== []) {
            Log::warning('Ignored environment values that are not plain origins; the CSP does not include them.', [
                'variables' => array_values($variables),
            ]);
        }
    }

    /** Behind Traefik the app is always reached over HTTPS in production (13 §12.8). */
    private function configureTransport(): void
    {
        if ($this->app->isProduction()) {
            URL::forceScheme('https');
        }
    }

    /**
     * Pulse shows staff by name and customers only as `Customer …` plus the last six characters of
     * their id: no customer e-mail address or name reaches the dashboard (13 §16 rule 5).
     */
    private function configurePulseUsers(): void
    {
        Pulse::user(fn (User $user): array => [
            'name' => $user->isStaff() ? $user->name : 'Customer …'.substr((string) $user->getKey(), -6),
            'extra' => '',
            'avatar' => null,
        ]);
    }

    /**
     * SMS texts use the application name, which must fit in 20 characters (12 §3.7).
     */
    private function warnWhenAppNameIsTooLongForSms(): void
    {
        $name = (string) config('app.name');

        if (mb_strlen($name) > 20) {
            Log::warning('app.name is longer than 20 characters; SMS will use the truncated business name.', [
                'length' => mb_strlen($name),
            ]);
        }
    }

    /**
     * Configure default behaviors for production-ready applications.
     */
    protected function configureDefaults(): void
    {
        Date::use(CarbonImmutable::class);

        DB::prohibitDestructiveCommands(
            app()->isProduction(),
        );

        Password::defaults(fn (): ?Password => app()->isProduction()
            ? Password::min(12)
                ->mixedCase()
                ->letters()
                ->numbers()
                ->symbols()
                ->uncompromised()
            : null,
        );
    }
}
