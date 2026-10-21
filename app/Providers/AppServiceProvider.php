<?php

declare(strict_types=1);

namespace App\Providers;

use App\Support\MorphMap;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Relations\Relation;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\ServiceProvider;
use Illuminate\Validation\Rules\Password;

final class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
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
