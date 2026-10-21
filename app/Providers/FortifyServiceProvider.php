<?php

declare(strict_types=1);

namespace App\Providers;

use App\Actions\Fortify\ApplyRememberPolicy;
use App\Actions\Fortify\AuthenticateUser;
use App\Actions\Fortify\CreateNewUser;
use App\Actions\Fortify\ResetUserPassword;
use App\Actions\Fortify\UpdateUserPassword;
use App\Actions\Fortify\UpdateUserProfileInformation;
use App\Domain\Identity\Events\CustomerRegistered;
use App\Domain\Identity\Listeners\SendWelcomeNotification;
use App\Domain\Identity\Models\User;
use App\Http\Controllers\Auth\AuthenticatedSessionController;
use App\Http\Responses\EmailVerifiedResponse;
use App\Http\Responses\GenericPasswordResetLinkResponse;
use App\Http\Responses\LoginResponse;
use App\Http\Responses\LogoutResponse;
use App\Http\Responses\PasswordUpdatedResponse;
use App\Http\Responses\ProfileUpdatedResponse;
use App\Http\Responses\RegisterResponse;
use App\Http\Responses\TwoFactorLoginResponse;
use App\Support\Features;
use App\Support\Settings\Settings;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\ServiceProvider;
use Illuminate\Validation\Rules\Password;
use Inertia\Inertia;
use Laravel\Fortify\Actions\AttemptToAuthenticate;
use Laravel\Fortify\Actions\PrepareAuthenticatedSession;
use Laravel\Fortify\Actions\RedirectIfTwoFactorAuthenticatable;
use Laravel\Fortify\Contracts\FailedPasswordResetLinkRequestResponse as FailedPasswordResetLinkRequestResponseContract;
use Laravel\Fortify\Contracts\LoginResponse as LoginResponseContract;
use Laravel\Fortify\Contracts\LogoutResponse as LogoutResponseContract;
use Laravel\Fortify\Contracts\PasswordUpdateResponse as PasswordUpdateResponseContract;
use Laravel\Fortify\Contracts\ProfileInformationUpdatedResponse as ProfileInformationUpdatedResponseContract;
use Laravel\Fortify\Contracts\RegisterResponse as RegisterResponseContract;
use Laravel\Fortify\Contracts\SuccessfulPasswordResetLinkRequestResponse as SuccessfulPasswordResetLinkRequestResponseContract;
use Laravel\Fortify\Contracts\TwoFactorLoginResponse as TwoFactorLoginResponseContract;
use Laravel\Fortify\Contracts\VerifyEmailResponse as VerifyEmailResponseContract;
use Laravel\Fortify\Features as FortifyFeatures;
use Laravel\Fortify\Fortify;
use Laravel\Fortify\Http\Controllers\AuthenticatedSessionController as FortifyAuthenticatedSessionController;

final class FortifyServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        $this->app->singleton(LoginResponseContract::class, LoginResponse::class);
        $this->app->singleton(TwoFactorLoginResponseContract::class, TwoFactorLoginResponse::class);
        $this->app->singleton(RegisterResponseContract::class, RegisterResponse::class);
        $this->app->singleton(LogoutResponseContract::class, LogoutResponse::class);
        $this->app->singleton(PasswordUpdateResponseContract::class, PasswordUpdatedResponse::class);
        $this->app->singleton(ProfileInformationUpdatedResponseContract::class, ProfileUpdatedResponse::class);
        $this->app->singleton(VerifyEmailResponseContract::class, EmailVerifiedResponse::class);
        // The same answer whether the link was sent or not (13 §5.5): Fortify's two responses differ in what they say.
        $this->app->bind(SuccessfulPasswordResetLinkRequestResponseContract::class, GenericPasswordResetLinkResponse::class);
        $this->app->bind(FailedPasswordResetLinkRequestResponseContract::class, GenericPasswordResetLinkResponse::class);
        $this->app->bind(FortifyAuthenticatedSessionController::class, AuthenticatedSessionController::class);
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        $this->configureActions();
        $this->configureAuthentication();
        $this->configureViews();

        // The listeners of `app/Listeners` are found by event discovery; this one lives with its domain.
        Event::listen(CustomerRegistered::class, SendWelcomeNotification::class);
    }

    /**
     * Configure Fortify actions.
     */
    private function configureActions(): void
    {
        Fortify::resetUserPasswordsUsing(ResetUserPassword::class);
        Fortify::updateUserPasswordsUsing(UpdateUserPassword::class);
        Fortify::updateUserProfileInformationUsing(UpdateUserProfileInformation::class);
        Fortify::createUsersUsing(CreateNewUser::class);
    }

    /**
     * The login pipeline of 13 §2. The throttle is the route middleware of the `login` limiter
     * (`fortify.limiters.login`), so Fortify's own throttle step is not part of it; staff never get a remember
     * cookie.
     */
    private function configureAuthentication(): void
    {
        Fortify::authenticateUsing(AuthenticateUser::handle(...));

        Fortify::authenticateThrough(static fn (): array => [
            ApplyRememberPolicy::class,
            RedirectIfTwoFactorAuthenticatable::class,
            AttemptToAuthenticate::class,
            PrepareAuthenticatedSession::class,
        ]);
    }

    /**
     * Configure Fortify views. Every page gets the props of `AuthPageProps` (13 §2, 14 §3.1).
     */
    private function configureViews(): void
    {
        Fortify::loginView(fn (Request $request) => Inertia::render('Auth/Login', [
            ...$this->pageProps(),
            'canResetPassword' => FortifyFeatures::enabled(FortifyFeatures::resetPasswords()),
            'status' => $request->session()->get('status'),
        ]));

        Fortify::resetPasswordView(fn (Request $request) => Inertia::render('Auth/ResetPassword', [
            ...$this->pageProps(),
            'email' => $request->email,
            'token' => $request->route('token'),
            'passwordRules' => Password::defaults()->toPasswordRulesString(),
        ]));

        Fortify::requestPasswordResetLinkView(fn (Request $request) => Inertia::render('Auth/ForgotPassword', [
            ...$this->pageProps(),
            'status' => $request->session()->get('status'),
        ]));

        Fortify::verifyEmailView(function (Request $request) {
            $user = $request->user();

            // A phone-only customer has no address to verify; the app is theirs already.
            if (! $user instanceof User || $user->email === null) {
                return redirect()->route($user instanceof User && $user->isStaff() ? 'admin.dashboard' : 'customer.dashboard');
            }

            return Inertia::render('Auth/VerifyEmail', [
                ...$this->pageProps(),
                'status' => $request->session()->get('status'),
                'email' => $user->email,
            ]);
        });

        Fortify::registerView(fn () => Inertia::render('Auth/Register', [
            ...$this->pageProps(),
            'passwordRules' => Password::defaults()->toPasswordRulesString(),
        ]));

        Fortify::twoFactorChallengeView(fn () => Inertia::render('Auth/TwoFactorChallenge', $this->pageProps()));

        Fortify::confirmPasswordView(fn () => Inertia::render('Auth/ConfirmPassword', $this->pageProps()));
    }

    /**
     * `AuthPageProps`: the feature flags, the public Turnstile key (only while the captcha is on) and whether new
     * customers may register.
     *
     * @return array{features: array<string, bool>, turnstileSiteKey: string|null, canRegister: bool}
     */
    private function pageProps(): array
    {
        $siteKey = config('services.turnstile.site_key');

        return [
            'features' => Features::all(),
            'turnstileSiteKey' => Features::enabled('captcha') && is_string($siteKey) ? $siteKey : null,
            'canRegister' => FortifyFeatures::enabled(FortifyFeatures::registration())
                && $this->app->make(Settings::class)->auth()->allowCustomerRegistration,
        ];
    }
}
