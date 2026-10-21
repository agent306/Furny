<?php

declare(strict_types=1);

use App\Actions\Fortify\ApplyRememberPolicy;
use App\Domain\Identity\Events\CustomerRegistered;
use App\Domain\Identity\Models\User;
use App\Http\Middleware\FortifyRouteGuards;
use App\Http\Middleware\TrackSession;
use App\Http\Responses\LoginResponse;
use App\Http\Responses\LogoutResponse;
use App\Http\Responses\RegisterResponse;
use App\Http\Responses\TwoFactorLoginResponse;
use Illuminate\Auth\Events\CurrentDeviceLogout;
use Illuminate\Auth\Events\Failed;
use Illuminate\Auth\Events\Lockout;
use Illuminate\Auth\Events\Login;
use Illuminate\Auth\Events\Logout;
use Illuminate\Http\Request;
use Illuminate\Routing\Router;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Route;
use Inertia\Testing\AssertableInertia as Assert;
use Laravel\Fortify\Actions\AttemptToAuthenticate;
use Laravel\Fortify\Actions\EnsureLoginIsNotThrottled;
use Laravel\Fortify\Actions\PrepareAuthenticatedSession;
use Laravel\Fortify\Actions\RedirectIfTwoFactorAuthenticatable;
use Laravel\Fortify\Contracts\LoginResponse as LoginResponseContract;
use Laravel\Fortify\Contracts\LogoutResponse as LogoutResponseContract;
use Laravel\Fortify\Contracts\RegisterResponse as RegisterResponseContract;
use Laravel\Fortify\Contracts\TwoFactorLoginResponse as TwoFactorLoginResponseContract;
use Laravel\Fortify\Features;
use Laravel\Fortify\Fortify;

it('configures Fortify as 13 section 2 says', function (): void {
    expect(config('fortify.guard'))->toBe('web')
        ->and(config('fortify.passwords'))->toBe('users')
        ->and(config('fortify.username'))->toBe('email')
        ->and(config('fortify.email'))->toBe('email')
        ->and(config('fortify.lowercase_usernames'))->toBeTrue()
        ->and(config('fortify.home'))->toBe('/dashboard')
        ->and(config('fortify.prefix'))->toBe('')
        ->and(config('fortify.domain'))->toBeNull()
        ->and(config('fortify.middleware'))->toBe(['web'])
        ->and(config('fortify.limiters'))->toBe(['login' => 'login', 'two-factor' => 'two-factor'])
        ->and(config('fortify.views'))->toBeTrue()
        ->and(config('fortify.features'))->toBe([
            Features::registration(),
            Features::resetPasswords(),
            Features::emailVerification(),
            Features::twoFactorAuthentication(['confirm' => true, 'confirmPassword' => true, 'window' => 1]),
        ]);
});

it('leaves the profile and password updates off until their Actions exist', function (): void {
    expect(Features::enabled(Features::updateProfileInformation()))->toBeFalse()
        ->and(Features::enabled(Features::updatePasswords()))->toBeFalse()
        ->and(Route::has('user-profile-information.update'))->toBeFalse()
        ->and(Route::has('user-password.update'))->toBeFalse();
});

it('runs the login pipeline of 13 section 2: the remember policy first, no throttle step of Fortify', function (): void {
    $steps = call_user_func(Fortify::$authenticateThroughCallback, Request::create('/login', 'POST'));

    expect($steps)->toBe([
        ApplyRememberPolicy::class,
        RedirectIfTwoFactorAuthenticatable::class,
        AttemptToAuthenticate::class,
        PrepareAuthenticatedSession::class,
    ])->not->toContain(EnsureLoginIsNotThrottled::class);
});

it('throttles the login and two-factor routes with their named limiters', function (): void {
    expect(Route::getRoutes()->getByName('login.store')->gatherMiddleware())->toContain('throttle:login')
        ->and(Route::getRoutes()->getByName('two-factor.login.store')->gatherMiddleware())->toContain('throttle:two-factor');
});

it('puts the Fortify route guards at the end of the web group, after the session registry', function (): void {
    $web = app(Router::class)->getMiddlewareGroups()['web'];

    expect(array_search(FortifyRouteGuards::class, $web, true))->toBeGreaterThan(array_search(TrackSession::class, $web, true))
        ->and(app(Router::class)->gatherRouteMiddleware(Route::getRoutes()->getByName('register.store')))->toContain(FortifyRouteGuards::class);
});

it('answers with the responses of the app', function (): void {
    expect(app(LoginResponseContract::class))->toBeInstanceOf(LoginResponse::class)
        ->and(app(TwoFactorLoginResponseContract::class))->toBeInstanceOf(TwoFactorLoginResponse::class)
        ->and(app(RegisterResponseContract::class))->toBeInstanceOf(RegisterResponse::class)
        ->and(app(LogoutResponseContract::class))->toBeInstanceOf(LogoutResponse::class);
});

it('listens once for each event: no listener is registered twice', function (string $event): void {
    expect(Event::getListeners($event))->toHaveCount(1);
})->with([Login::class, Logout::class, CurrentDeviceLogout::class, Failed::class, Lockout::class, CustomerRegistered::class]);

it('hands every auth page the flags, the Turnstile key and canRegister', function (string $route, string $component, bool $signedIn): void {
    if ($signedIn) {
        $this->actingAs(User::factory()->unverified()->create());
    }

    $this->get(route($route))
        ->assertInertia(fn (Assert $page) => $page
            ->component($component)
            ->has('features')
            ->where('turnstileSiteKey', null)
            ->where('canRegister', true));
})->with([
    ['login', 'Auth/Login', false],
    ['register', 'Auth/Register', false],
    ['password.request', 'Auth/ForgotPassword', false],
    ['password.confirm', 'Auth/ConfirmPassword', true],
    ['verification.notice', 'Auth/VerifyEmail', true],
]);
