<?php

declare(strict_types=1);

namespace App\Providers;

use App\Domain\Identity\Models\User;
use App\Domain\Identity\Otp\LogOtpDelivery;
use App\Domain\Identity\Otp\OtpDelivery;
use App\Domain\Orders\Support\DeleteNeverSubmittedDraftOrders;
use App\Support\MorphMap;
use App\Support\Settings\Settings;
use App\Support\Uploads\HeicConverter;
use App\Support\Uploads\S3UploadPresigner;
use App\Support\Uploads\UploadPresigner;
use App\Support\Uploads\VisionHeicConverter;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Relations\Relation;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Storage;
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

        // Until the WhatsApp and SMS channels exist the codes are only logged (masked); the Feature suite binds the array one.
        $this->app->bind(OtpDelivery::class, LogOtpDelivery::class);

        // Browser uploads go to the private `s3` disk with a signed type and length, and HEIC photos are decoded by the
        // vision service (13 §11). The Feature suite binds stand-ins.
        $this->app->bind(UploadPresigner::class, static fn (): UploadPresigner => new S3UploadPresigner(Storage::disk('s3')));
        $this->app->bind(HeicConverter::class, VisionHeicConverter::class);

        // What must happen when a customer deletes their account (13 §9.1); P6 and P7 tag their own steps (imports, orders).
        $this->app->tag([DeleteNeverSubmittedDraftOrders::class], 'account.deletion_steps');

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
        $this->constrainRouteParameters();
    }

    /** A malformed id is a 404 before any query (14 §1.6): ULID parameters are matched by shape. */
    private function constrainRouteParameters(): void
    {
        foreach (['user', 'invitation', 'upload'] as $parameter) {
            Route::pattern($parameter, '[0-7][0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{25}');
        }
    }

    /** Set once the CSP warning has been given in this PHP process (boot runs again for every request under php-fpm workers). */
    private static bool $cspWarningGiven = false;

    /**
     * config/security.php drops AWS/Reverb origins that are not plain origins (they would be pasted into the
     * Content-Security-Policy); it cannot log, so the warning is given here, at most once per PHP process.
     * Under php-fpm that is once per worker, not once per request.
     */
    private function warnWhenCspOriginsAreRejected(): void
    {
        $variables = (array) config('security.csp.rejected', []);

        if ($variables === [] || self::$cspWarningGiven) {
            return;
        }

        self::$cspWarningGiven = true;

        Log::warning('Ignored environment values that are not plain origins; the CSP does not include them.', [
            'variables' => array_values($variables),
        ]);
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

        // NIST 800-63B: length and a breached-password check, no composition rules (13 §2). `uncompromised()` asks
        // the HIBP range API; when that cannot be reached Laravel treats the password as not compromised.
        Password::defaults(fn (): Password => app()->isProduction()
            ? Password::min(10)->max(128)->uncompromised()
            : Password::min(8)->max(128),
        );
    }
}
