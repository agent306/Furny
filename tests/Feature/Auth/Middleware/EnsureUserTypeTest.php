<?php

declare(strict_types=1);

use App\Domain\Identity\Models\User;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\Support\InertiaRequest;

it('sends staff away from the customer pages to the admin dashboard', function (): void {
    $this->actingAs(User::factory()->estimator()->create())
        ->get(route('customer.dashboard'))
        ->assertRedirectToRoute('admin.dashboard');

    $this->actingAs(User::factory()->owner()->create())
        ->get('/dashboard')
        ->assertRedirectToRoute('admin.dashboard');
});

it('refuses a customer on the admin dashboard with the Error page', function (): void {
    $this->actingAs(User::factory()->create())
        ->get(route('admin.dashboard'))
        ->assertForbidden()
        ->assertInertia(fn (Assert $page) => $page->component('Error')->where('status', 403));
});

it('refuses a customer on /admin by path too', function (): void {
    $this->actingAs(User::factory()->create())
        ->get('/admin')
        ->assertForbidden()
        ->assertInertia(fn (Assert $page) => $page->component('Error')->where('status', 403));
});

it('answers an Inertia visit of a customer to the admin area with the Error page as json', function (): void {
    $this->actingAs(User::factory()->create())
        ->get('/admin', InertiaRequest::headers())
        ->assertForbidden()
        ->assertJsonPath('component', 'Error')
        ->assertJsonPath('props.status', 403);
});

it('sends a guest on /admin to login', function (): void {
    $this->get('/admin')->assertRedirectToRoute('login');
    $this->get(route('admin.dashboard'))->assertRedirectToRoute('login');
});

it('lets each type into its own area', function (): void {
    $this->actingAs(User::factory()->create())->get(route('customer.dashboard'))->assertOk();
    $this->actingAs(User::factory()->estimator()->create())->get(route('admin.dashboard'))->assertOk();
});
