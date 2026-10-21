<?php

declare(strict_types=1);

use App\Domain\Identity\Models\User;
use Inertia\Testing\AssertableInertia as Assert;

it('serves the customer dashboard placeholder at /dashboard', function (): void {
    expect(route('customer.dashboard', absolute: false))->toBe('/dashboard');

    $this->actingAs(User::factory()->create())
        ->get(route('customer.dashboard'))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->component('Customer/Dashboard'));
});

it('serves the admin dashboard placeholder at /admin', function (): void {
    expect(route('admin.dashboard', absolute: false))->toBe('/admin');

    $this->actingAs(User::factory()->admin()->create())
        ->get(route('admin.dashboard'))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->component('Admin/Dashboard'));
});

it('sends guests of either dashboard to the login page', function (string $route): void {
    $this->get(route($route))->assertRedirect(route('login'));
})->with(['customer.dashboard', 'admin.dashboard']);
