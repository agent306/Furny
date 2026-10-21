<?php

declare(strict_types=1);

use App\Domain\Identity\Models\User;
use App\Http\Middleware\EnsureTwoFactorEnrolled;
use Illuminate\Support\Facades\Route;
use Inertia\Inertia;
use Tests\Support\InertiaRequest;
use Tests\Support\Routing\AccessStubs;

beforeEach(function (): void {
    AccessStubs::register();
});

it('sends an admin without a confirmed 2FA to the enrolment page with the banner', function (): void {
    $this->actingAs(User::factory()->admin()->withoutTwoFactor()->create())
        ->get(route('admin.dashboard'))
        ->assertRedirectToRoute('admin.security.two-factor');
});

it('answers a JSON client with 403 and the code two_factor_required, not a redirect (14 section 1.2)', function (): void {
    $this->actingAs(User::factory()->owner()->withoutTwoFactor()->create())
        ->getJson(route('admin.dashboard'))
        ->assertForbidden()
        ->assertExactJson(['code' => 'two_factor_required']);

    $this->postJson(route('admin.staff.invitations.store'))->assertForbidden()->assertExactJson(['code' => 'two_factor_required']);
});

it('keeps the redirect for an Inertia visit, which also accepts JSON', function (): void {
    $this->actingAs(User::factory()->owner()->withoutTwoFactor()->create())
        ->get(route('admin.dashboard'), ['Accept' => 'text/html, application/json', ...InertiaRequest::headers()])
        ->assertRedirectToRoute('admin.security.two-factor');
});

it('lets a JSON client through the exempt routes', function (): void {
    $this->actingAs(User::factory()->owner()->withoutTwoFactor()->create())
        ->getJson(route('admin.security.two-factor'))
        ->assertOk();
});

it('carries the 2FA banner as the flash of the next page', function (): void {
    $this->actingAs(User::factory()->owner()->withoutTwoFactor()->create())
        ->get(route('admin.dashboard'))
        ->assertRedirectToRoute('admin.security.two-factor');

    Route::middleware('web')->get('/_flash-after', static fn () => Inertia::render('Error', ['status' => 200]));

    $page = $this->get('/_flash-after', InertiaRequest::headers())->assertOk();

    expect($page->json('flash.error'))->toBe(trans('auth.2fa_required'))->not->toBe('auth.2fa_required');
});

it('redirects an owner without a confirmed 2FA too', function (): void {
    $this->actingAs(User::factory()->owner()->withoutTwoFactor()->create())
        ->get(route('admin.dashboard'))
        ->assertRedirectToRoute('admin.security.two-factor');
});

it('lets an admin with a confirmed 2FA through', function (): void {
    $this->actingAs(User::factory()->admin()->create())->get(route('admin.dashboard'))->assertOk();
});

it('lets an estimator through without 2FA (optional for the other roles)', function (): void {
    $this->actingAs(User::factory()->estimator()->withoutTwoFactor()->create())->get(route('admin.dashboard'))->assertOk();
    $this->actingAs(User::factory()->support()->withoutTwoFactor()->create())->get(route('admin.dashboard'))->assertOk();
});

it('applies as soon as a role change makes 2FA required', function (): void {
    $user = User::factory()->estimator()->withoutTwoFactor()->create();
    $this->actingAs($user)->get(route('admin.dashboard'))->assertOk();

    $user->syncRoles('admin');

    $this->actingAs($user->fresh())->get(route('admin.dashboard'))->assertRedirectToRoute('admin.security.two-factor');
});

it('lets the exempt routes through for an unenrolled admin', function (string $name): void {
    Route::middleware(AccessStubs::ADMIN)->get('/admin/_exempt-stub', static fn (): string => 'stub')->name($name);
    AccessStubs::refresh();

    $this->actingAs(User::factory()->admin()->withoutTwoFactor()->create())->get('/admin/_exempt-stub')->assertOk();
})->with([
    'admin.security.two-factor',
    'two-factor.qr-code',
    'two-factor.recovery-codes',
    'password.confirm',
    'password.confirm.store',
    'password.confirmation',
]);

it('redirects every other admin route for an unenrolled admin', function (): void {
    Route::middleware(AccessStubs::ADMIN)->get('/admin/_other-stub', static fn (): string => 'stub')->name('admin.account.security');
    AccessStubs::refresh();

    $this->actingAs(User::factory()->admin()->withoutTwoFactor()->create())
        ->get('/admin/_other-stub')
        ->assertRedirectToRoute('admin.security.two-factor');
});

it('does not exempt near-miss route names', function (string $name): void {
    Route::middleware(AccessStubs::ADMIN)->get('/admin/_near-miss-stub', static fn (): string => 'stub')->name($name);
    AccessStubs::refresh();

    $this->actingAs(User::factory()->admin()->withoutTwoFactor()->create())
        ->get('/admin/_near-miss-stub')
        ->assertRedirectToRoute('admin.security.two-factor');
})->with([
    'admin.security.two-factor-x',
    'admin.security.two-factor.x',
    'admin.two-factor.x',
    'two-factorx',
    'logout.other',
    'xlogout',
    'my.password.confirm',
]);

it('exempts exactly the routes of 13 section 5.10', function (): void {
    expect(EnsureTwoFactorEnrolled::EXEMPT)->toBe(['admin.security.two-factor', 'two-factor.*', 'password.confirm*', 'logout']);
});
