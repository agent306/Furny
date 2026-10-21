<?php

declare(strict_types=1);

use App\Domain\Identity\Models\User;
use App\Support\Settings\Groups\AuthSettings;
use App\Support\Settings\Settings;
use App\Support\Settings\SettingsGroup;
use Illuminate\Support\Facades\Route;
use Tests\Support\InertiaRequest;
use Tests\Support\SessionStamp;

it('logs staff out after 12 hours and sends them to login with the expiry message', function (): void {
    $this->withSession(SessionStamp::loginHoursAgo(13))
        ->actingAs(User::factory()->estimator()->create())
        ->get(route('admin.dashboard'))
        ->assertRedirectToRoute('login');

    $this->assertGuest();

    expect($this->get(route('login'), InertiaRequest::headers())->assertOk()->json('flash.error'))
        ->toBe(trans('auth.session_expired'))
        ->not->toBe('auth.session_expired');
});

it('lets staff through at 11 hours', function (): void {
    $this->withSession(SessionStamp::loginHoursAgo(11))
        ->actingAs(User::factory()->estimator()->create())
        ->get(route('admin.dashboard'))
        ->assertOk();
});

it('takes the lifetime from the auth.staff_session_absolute_hours setting', function (): void {
    $defaults = AuthSettings::defaults();
    app(Settings::class)->put(SettingsGroup::Auth, new AuthSettings(
        allowCustomerRegistration: $defaults->allowCustomerRegistration,
        otpAllowedCountryCodes: $defaults->otpAllowedCountryCodes,
        otpGlobalHourlyCap: $defaults->otpGlobalHourlyCap,
        staffSessionAbsoluteHours: 1,
    ));

    $this->withSession(SessionStamp::loginHoursAgo(2))
        ->actingAs(User::factory()->estimator()->create())
        ->get(route('admin.dashboard'))
        ->assertRedirectToRoute('login');
});

it('starts the clock for a staff session that has no login stamp instead of failing open', function (): void {
    $this->actingAs(User::factory()->estimator()->create())->get(route('admin.dashboard'))->assertOk();

    expect(session('auth.login_at'))->toBeInt()->toBeGreaterThan(now()->subMinute()->getTimestamp());
});

it('does not touch customers', function (): void {
    Route::middleware(['web', 'auth', 'session.absolute'])->get('/_absolute-stub', static fn (): string => 'stub');

    $this->withSession(SessionStamp::loginHoursAgo(13))
        ->actingAs(User::factory()->create())
        ->get('/_absolute-stub')
        ->assertOk();
});

it('expires a staff session whose login stamp is there but unreadable', function (mixed $stamp): void {
    $this->withSession(['auth.login_at' => $stamp])
        ->actingAs(User::factory()->estimator()->create())
        ->get(route('admin.dashboard'))
        ->assertRedirectToRoute('login');

    $this->assertGuest();
})->with([
    'zero' => 0,
    'negative' => -5,
    'string' => 'yesterday',
    'numeric string' => '1700000000',
    'float' => 1700000000.5,
    'array' => fn () => ['x'],
    'false' => false,
    'far in the future' => fn () => now()->addDays(30)->getTimestamp(),
]);

it('tolerates a minute of clock skew', function (): void {
    $this->withSession(['auth.login_at' => now()->addSeconds(30)->getTimestamp()])
        ->actingAs(User::factory()->estimator()->create())
        ->get(route('admin.dashboard'))
        ->assertOk();
});

it('answers a JSON client with 401 session_expired instead of a redirect', function (): void {
    Route::middleware(['web', 'auth', 'session.absolute'])->get('/_absolute-json-stub', static fn (): string => 'stub');

    $this->withSession(SessionStamp::loginHoursAgo(13))
        ->actingAs(User::factory()->estimator()->create())
        ->getJson('/_absolute-json-stub')
        ->assertUnauthorized()
        ->assertExactJson(['code' => 'session_expired']);

    $this->assertGuest();
});
