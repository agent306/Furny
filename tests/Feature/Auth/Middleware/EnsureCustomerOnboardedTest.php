<?php

declare(strict_types=1);

use App\Domain\Identity\Models\User;
use App\Http\Middleware\EnsureCustomerOnboarded;
use Illuminate\Support\Facades\Route;
use Tests\Support\Routing\AccessStubs;

beforeEach(function (): void {
    AccessStubs::register();
});

it('redirects a customer who has not onboarded from a page to the wizard', function (): void {
    $this->actingAs(User::factory()->notOnboarded()->create())
        ->get(route('customer.dashboard'))
        ->assertRedirect('/onboarding')
        ->assertRedirectToRoute('customer.onboarding.show');
});

it('does not redirect a write request', function (): void {
    Route::middleware(AccessStubs::CUSTOMER)->post('/_projects-stub', static fn (): string => 'created')->name('customer.projects.store');

    $this->actingAs(User::factory()->notOnboarded()->create())
        ->post('/_projects-stub')
        ->assertOk();
});

it('lets the exempt routes through', function (string $name): void {
    Route::middleware(AccessStubs::CUSTOMER)->get('/_exempt-stub', static fn (): string => 'stub')->name($name);
    AccessStubs::refresh();

    $this->actingAs(User::factory()->notOnboarded()->create())->get('/_exempt-stub')->assertOk();
})->with([
    'customer.onboarding.store',
    'customer.onboarding.skip',
    'customer.account.security',
    'customer.account.notifications.reset',
    'customer.help',
    'customer.notifications.index',
]);

it('redirects every other customer route', function (): void {
    Route::middleware(AccessStubs::CUSTOMER)->get('/_other-stub', static fn (): string => 'stub')->name('customer.notifications.show');
    AccessStubs::refresh();

    $this->actingAs(User::factory()->notOnboarded()->create())->get('/_other-stub')->assertRedirectToRoute('customer.onboarding.show');
});

it('lets an onboarded customer through', function (): void {
    $this->actingAs(User::factory()->create())->get(route('customer.dashboard'))->assertOk();
});

it('does not affect staff', function (): void {
    Route::middleware(['web', 'auth', 'onboarded'])->get('/_staff-onboarded-stub', static fn (): string => 'stub');

    $this->actingAs(User::factory()->estimator()->state(['onboarded_at' => null])->create())
        ->get('/_staff-onboarded-stub')
        ->assertOk();
});

it('exempts exactly the routes of 10 section 5.1', function (): void {
    expect(EnsureCustomerOnboarded::EXEMPT)->toBe([
        'customer.onboarding.*',
        'customer.account.*',
        'customer.help',
        'customer.notifications.index',
    ]);
});
