<?php

declare(strict_types=1);

use App\Domain\Identity\Enums\LengthUnit;
use App\Domain\Identity\Enums\UnitSystem;
use App\Domain\Identity\Models\User;
use Inertia\Testing\AssertableInertia as Assert;

it('renders the preferences with every time zone to choose from', function (): void {
    expect(route('customer.account.preferences', absolute: false))->toBe('/account/preferences');

    $user = User::factory()->create(['unit_system' => 'metric', 'length_unit' => 'cm', 'timezone' => 'Asia/Kolkata']);

    $this->actingAs($user)
        ->get(route('customer.account.preferences'))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('Customer/Account/Preferences')
            ->where('unitSystem', 'metric')
            ->where('lengthUnit', 'cm')
            ->where('timezone', 'Asia/Kolkata')
            ->where('timezones', DateTimeZone::listIdentifiers()));
});

it('renders the staff preferences', function (): void {
    $this->actingAs(User::factory()->estimator()->create())
        ->get(route('admin.account.preferences'))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->component('Admin/Account/Preferences')->has('timezones'));
});

it('saves the units and the time zone, with camelCase keys', function (): void {
    $user = User::factory()->create();

    $this->actingAs($user)
        ->from('/account/preferences')
        ->put(route('customer.account.preferences.update'), ['unitSystem' => 'imperial', 'lengthUnit' => 'ftin', 'timezone' => 'Europe/London'])
        ->assertRedirect('/account/preferences')
        ->assertSessionHasNoErrors();

    $user->refresh();
    expect($user->unit_system)->toBe(UnitSystem::Imperial)
        ->and($user->length_unit)->toBe(LengthUnit::Ftin)
        ->and($user->timezone)->toBe('Europe/London');
});

it('lets staff save their own', function (): void {
    $staff = User::factory()->estimator()->create();

    $this->actingAs($staff)
        ->from('/admin/account/preferences')
        ->put(route('admin.account.preferences.update'), ['unitSystem' => 'metric', 'lengthUnit' => 'm', 'timezone' => 'UTC'])
        ->assertRedirect('/admin/account/preferences')
        ->assertSessionHasNoErrors();

    expect($staff->refresh()->length_unit)->toBe(LengthUnit::M)->and($staff->timezone)->toBe('UTC');
});

it('refuses a length unit that does not belong to the system', function (string $system, string $unit): void {
    $user = User::factory()->create(['unit_system' => 'metric', 'length_unit' => 'mm']);

    $this->actingAs($user)
        ->put(route('customer.account.preferences.update'), ['unitSystem' => $system, 'lengthUnit' => $unit, 'timezone' => 'UTC'])
        ->assertSessionHasErrors(['lengthUnit' => trans_icu('account.errors.length_unit')]);

    expect($user->refresh()->unit_system)->toBe(UnitSystem::Metric)->and($user->length_unit)->toBe(LengthUnit::Mm);
})->with([['metric', 'ftin'], ['metric', 'in'], ['imperial', 'mm'], ['imperial', 'cm'], ['imperial', 'm']]);

it('answers a refused length unit with a 422 to a JSON client', function (): void {
    $this->actingAs(User::factory()->create())
        ->putJson(route('customer.account.preferences.update'), ['unitSystem' => 'metric', 'lengthUnit' => 'ftin', 'timezone' => 'UTC'])
        ->assertUnprocessable()
        ->assertJsonValidationErrors(['lengthUnit']);
});

it('refuses a time zone that does not exist', function (string $timezone): void {
    $user = User::factory()->create(['timezone' => 'Asia/Kolkata']);

    $this->actingAs($user)
        ->put(route('customer.account.preferences.update'), ['unitSystem' => 'metric', 'lengthUnit' => 'mm', 'timezone' => $timezone])
        ->assertSessionHasErrors(['timezone' => trans_icu('account.errors.timezone')]);

    expect($user->refresh()->timezone)->toBe('Asia/Kolkata');
})->with(['Mars/Base', 'india', 'GMT+5']);

it('refuses what is missing or unknown, and the snake_case spelling', function (): void {
    $this->actingAs(User::factory()->create())
        ->put(route('customer.account.preferences.update'), ['unit_system' => 'metric', 'length_unit' => 'mm', 'timezone' => 'UTC'])
        ->assertSessionHasErrors(['unitSystem', 'lengthUnit']);

    $this->actingAs(User::factory()->create())
        ->put(route('customer.account.preferences.update'), ['unitSystem' => 'furlongs', 'lengthUnit' => 'mm', 'timezone' => 'UTC'])
        ->assertSessionHasErrors(['unitSystem']);

    $this->actingAs(User::factory()->create())
        ->put(route('customer.account.preferences.update'), ['unitSystem' => 'metric', 'lengthUnit' => 'mm', 'timezone' => ''])
        ->assertSessionHasErrors(['timezone']);
});

it('flashes a confirmation', function (): void {
    $this->actingAs(User::factory()->create())
        ->from('/account/preferences')
        ->put(route('customer.account.preferences.update'), ['unitSystem' => 'metric', 'lengthUnit' => 'mm', 'timezone' => 'UTC'])
        ->assertInertiaFlash('success', trans_icu('account.toasts.preferences_saved'));
});

it('keeps each audience to its own route', function (): void {
    $body = ['unitSystem' => 'metric', 'lengthUnit' => 'mm', 'timezone' => 'UTC'];

    $this->actingAs(User::factory()->create())->put(route('admin.account.preferences.update'), $body)->assertForbidden();
    $this->actingAs(User::factory()->estimator()->create())
        ->put(route('customer.account.preferences.update'), $body)
        ->assertRedirectToRoute('admin.dashboard');
});
