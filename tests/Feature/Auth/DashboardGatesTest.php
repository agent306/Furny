<?php

declare(strict_types=1);

use App\Domain\Identity\Models\User;
use App\Providers\TelescopeServiceProvider;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Laravel\Telescope\Telescope;

afterEach(function (): void {
    Telescope::$authUsing = null;
});

dataset('dashboard gates', ['viewHorizon', 'viewPulse', 'viewTelescope']);

it('lets active owners and admins view the dashboards', function (string $gate): void {
    expect(Gate::forUser(User::factory()->owner()->create())->allows($gate))->toBeTrue()
        ->and(Gate::forUser(User::factory()->admin()->create())->allows($gate))->toBeTrue();
})->with('dashboard gates');

it('keeps every other role, inactive staff, customers and guests out', function (string $gate): void {
    expect(Gate::forUser(User::factory()->estimator()->create())->allows($gate))->toBeFalse()
        ->and(Gate::forUser(User::factory()->production()->create())->allows($gate))->toBeFalse()
        ->and(Gate::forUser(User::factory()->support()->create())->allows($gate))->toBeFalse()
        ->and(Gate::forUser(User::factory()->admin()->inactive()->create())->allows($gate))->toBeFalse()
        ->and(Gate::forUser(User::factory()->create())->allows($gate))->toBeFalse()
        ->and(Gate::allows($gate))->toBeFalse();
})->with('dashboard gates');

it('serves /horizon to an owner and refuses an estimator', function (): void {
    $this->actingAs(User::factory()->estimator()->create())->get('/horizon')->assertForbidden();
    $this->actingAs(User::factory()->owner()->create())->get('/horizon')->assertOk();
});

it('serves /pulse to an owner and an admin and refuses everybody else', function (): void {
    $this->actingAs(User::factory()->owner()->create())->get('/pulse')->assertOk();
    $this->actingAs(User::factory()->admin()->create())->get('/pulse')->assertOk();
    $this->actingAs(User::factory()->estimator()->create())->get('/pulse')->assertForbidden();
    $this->actingAs(User::factory()->create())->get('/pulse')->assertForbidden();
});

it('refuses guests on all dashboards', function (): void {
    $this->get('/horizon')->assertForbidden();
    $this->get('/pulse')->assertForbidden();
});

it('has no local-environment bypass on /horizon or /pulse (17 §5.11 item 12)', function (): void {
    app()->detectEnvironment(static fn (): string => 'local');
    expect(app()->environment('local'))->toBeTrue();

    $this->get('/horizon')->assertForbidden();
    $this->actingAs(User::factory()->estimator()->create())->get('/horizon')->assertForbidden();
    $this->actingAs(User::factory()->estimator()->create())->get('/pulse')->assertForbidden();
    $this->actingAs(User::factory()->admin()->create())->get('/horizon')->assertOk();
});

it('has no local-environment bypass on Telescope', function (): void {
    // Telescope is not registered in the testing environment (TELESCOPE_ENABLED=false), so boot its provider by hand.
    app()->register(TelescopeServiceProvider::class);
    app()->detectEnvironment(static fn (): string => 'local');

    $request = static fn (?User $user): Request => tap(Request::create('/telescope'), static fn (Request $r) => $r->setUserResolver(static fn () => $user));

    expect(Telescope::check($request(null)))->toBeFalse()
        ->and(Telescope::check($request(User::factory()->estimator()->create())))->toBeFalse()
        ->and(Telescope::check($request(User::factory()->owner()->create())))->toBeTrue()
        ->and(Telescope::check($request(User::factory()->admin()->create())))->toBeTrue();
});
