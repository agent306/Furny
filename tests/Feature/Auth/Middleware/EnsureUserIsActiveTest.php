<?php

declare(strict_types=1);

use App\Domain\Identity\Models\User;
use Illuminate\Support\Facades\Route;
use Tests\Support\InertiaRequest;

it('logs an inactive customer out and sends them to login with the inactive message', function (): void {
    $this->actingAs(User::factory()->inactive()->create())
        ->get(route('customer.dashboard'))
        ->assertRedirectToRoute('login');

    $this->assertGuest();

    expect($this->get(route('login'), InertiaRequest::headers())->assertOk()->json('flash.error'))
        ->toBe(trans('auth.inactive'))
        ->not->toBe('auth.inactive');
});

it('does the same for a soft-deleted user', function (): void {
    $this->actingAs(User::factory()->pendingDeletion()->create())
        ->get(route('customer.dashboard'))
        ->assertRedirectToRoute('login');

    $this->assertGuest();
});

it('does the same for inactive staff', function (): void {
    $this->actingAs(User::factory()->admin()->inactive()->create())
        ->get(route('admin.dashboard'))
        ->assertRedirectToRoute('login');

    $this->assertGuest();
});

it('destroys the session of the inactive user', function (): void {
    $this->withSession(['cart' => 'kept?', 'auth.login_at' => now()->getTimestamp()])
        ->actingAs(User::factory()->inactive()->create())
        ->get(route('customer.dashboard'))
        ->assertRedirectToRoute('login')
        ->assertSessionMissing('cart')
        ->assertSessionMissing('auth.login_at');
});

it('lets an active user through', function (): void {
    $this->actingAs(User::factory()->create())->get(route('customer.dashboard'))->assertOk();
});

it('leaves guests to the auth middleware', function (): void {
    Route::middleware(['web', 'active'])->get('/_active-guest', static fn (): string => 'open');

    $this->get('/_active-guest')->assertOk();
});

it('answers a JSON client with 401 inactive instead of a redirect', function (): void {
    Route::middleware(['web', 'auth', 'active'])->get('/_active-json-stub', static fn (): string => 'stub');

    $this->actingAs(User::factory()->inactive()->create())
        ->getJson('/_active-json-stub')
        ->assertUnauthorized()
        ->assertExactJson(['code' => 'inactive']);

    $this->assertGuest();
});

it('answers a machine path with 401 inactive without asking for JSON', function (): void {
    Route::middleware(['web', 'auth', 'active'])->get('/webhooks/_active-stub', static fn (): string => 'stub');

    $this->actingAs(User::factory()->inactive()->create())
        ->get('/webhooks/_active-stub')
        ->assertUnauthorized()
        ->assertExactJson(['code' => 'inactive']);
});
