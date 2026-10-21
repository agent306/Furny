<?php

declare(strict_types=1);

use App\Domain\Identity\Models\User;
use Illuminate\Support\Facades\Gate;

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
