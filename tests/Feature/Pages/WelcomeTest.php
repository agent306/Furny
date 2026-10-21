<?php

declare(strict_types=1);

use App\Domain\Identity\Models\User;
use App\Support\Settings\Settings;
use App\Support\Settings\SettingsGroup;
use Illuminate\Support\Facades\Route;
use Inertia\Testing\AssertableInertia as Assert;

function setRegistrationOpen(bool $open): void
{
    $settings = app(Settings::class);
    $auth = $settings->auth();
    $auth->allowCustomerRegistration = $open;
    $settings->put(SettingsGroup::Auth, $auth);
}

it('shows the welcome page to guests with registration open', function (): void {
    $this->get(route('welcome'))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('Welcome')
            ->where('canRegister', true));
});

it('hides registration when the owner closed it', function (): void {
    setRegistrationOpen(false);

    $this->get(route('welcome'))
        ->assertInertia(fn (Assert $page) => $page->component('Welcome')->where('canRegister', false));
});

it('keeps the welcome route at the root with its one name', function (): void {
    expect(route('welcome', absolute: false))->toBe('/')
        ->and(Route::has('home'))->toBeFalse();
});

it('sends a signed-in customer to the customer dashboard', function (): void {
    $this->actingAs(User::factory()->create())
        ->get(route('welcome'))
        ->assertRedirect(route('customer.dashboard'));
});

it('sends signed-in staff to the admin dashboard', function (): void {
    $this->actingAs(User::factory()->admin()->create())
        ->get(route('welcome'))
        ->assertRedirect(route('admin.dashboard'));
});

it('ships the welcome props without any user data', function (): void {
    $this->get(route('welcome'))
        ->assertInertia(fn (Assert $page) => $page
            ->component('Welcome')
            ->where('auth.user', null)
            ->has('business.name')
            ->has('app.name'));
});
