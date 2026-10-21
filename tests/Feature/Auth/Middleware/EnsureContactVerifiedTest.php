<?php

declare(strict_types=1);

use App\Domain\Identity\Models\User;
use Illuminate\Support\Facades\Route;
use Tests\Support\InertiaRequest;

beforeEach(function (): void {
    Route::middleware(['web', 'auth', 'verified.contact'])->match(['GET', 'POST'], '/_verified-stub', static fn () => response()->json(['ok' => true]));
});

it('answers a JSON request of an unverified user with 403 contact_unverified', function (): void {
    $this->actingAs(User::factory()->unverified()->create())
        ->postJson('/_verified-stub')
        ->assertForbidden()
        ->assertExactJson(['code' => 'contact_unverified']);
});

it('redirects an unverified Inertia visit back with the error flash', function (): void {
    $this->actingAs(User::factory()->unverified()->create())
        ->withHeaders(InertiaRequest::headers() + ['Referer' => url('/somewhere')])
        ->post('/_verified-stub')
        ->assertRedirect(url('/somewhere'));

    $page = $this->get(route('customer.dashboard'), InertiaRequest::headers())->assertOk();

    expect($page->json('flash.error'))->toBe(trans_icu('common.verify_required'))
        ->and($page->json('flash.error'))->not->toBe('common.verify_required')
        ->and($page->json('props'))->not->toHaveKey('flash');
});

it('also redirects back for a plain browser request', function (): void {
    $this->actingAs(User::factory()->unverified()->create())
        ->withHeaders(['Referer' => url('/somewhere')])
        ->post('/_verified-stub')
        ->assertRedirect(url('/somewhere'));
});

it('passes a user with a verified email', function (): void {
    $this->actingAs(User::factory()->create())->postJson('/_verified-stub')->assertOk();
});

it('passes a user with only a verified phone', function (): void {
    $this->actingAs(User::factory()->phoneOnly()->create())->postJson('/_verified-stub')->assertOk();
    $this->actingAs(User::factory()->unverified()->phoneVerified()->create())->postJson('/_verified-stub')->assertOk();
});
