<?php

declare(strict_types=1);

use App\Domain\Identity\Models\User;
use Inertia\Testing\AssertableInertia as Assert;

it('renders the customer profile with the user, the marketing choice and the channels a code can use', function (): void {
    expect(route('customer.account.profile', absolute: false))->toBe('/account/profile');

    $customer = User::factory()->create(['name' => 'Ada Lovelace', 'marketing_opt_in' => true]);

    $this->actingAs($customer)
        ->get(route('customer.account.profile'))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('Customer/Account/Profile')
            ->where('user.id', $customer->id)
            ->where('user.name', 'Ada Lovelace')
            ->where('marketingOptIn', true)
            // WhatsApp has no auth.otp template out of the box: SMS is the only channel.
            ->where('otpChannels', ['sms']));
});

it('offers no channel when none can carry a code', function (): void {
    config(['features.sms' => false, 'features.whatsapp' => false]);

    $this->actingAs(User::factory()->create())
        ->get(route('customer.account.profile'))
        ->assertInertia(fn (Assert $page) => $page->where('otpChannels', []));
});

it('renders the staff profile', function (): void {
    expect(route('admin.account.profile', absolute: false))->toBe('/admin/account/profile');

    $staff = User::factory()->estimator()->create();

    $this->actingAs($staff)
        ->get(route('admin.account.profile'))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('Admin/Account/Profile')
            ->where('user.id', $staff->id)
            ->where('otpChannels', ['sms']));
});

it('is not the other audience page', function (): void {
    $this->actingAs(User::factory()->create())->get(route('admin.account.profile'))->assertForbidden();
    $this->actingAs(User::factory()->estimator()->create())
        ->get(route('customer.account.profile'))
        ->assertRedirectToRoute('admin.dashboard');
});

it('sends guests to the login page', function (string $route): void {
    $this->get(route($route))->assertRedirectToRoute('login');
})->with(['customer.account.profile', 'admin.account.profile']);

it('stays open to a customer who has not finished onboarding', function (): void {
    $this->actingAs(User::factory()->notOnboarded()->create())
        ->get(route('customer.account.profile'))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->component('Customer/Account/Profile'));
});

it('sends an admin without a second factor to enrol first', function (): void {
    $this->actingAs(User::factory()->admin()->withoutTwoFactor()->create())
        ->get(route('admin.account.profile'))
        ->assertRedirectToRoute('admin.security.two-factor');
});
