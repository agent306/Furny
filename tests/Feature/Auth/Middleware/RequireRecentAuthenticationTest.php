<?php

declare(strict_types=1);

use App\Domain\Identity\Models\User;
use App\Support\Auth\RecentAuthentication;
use Illuminate\Http\Request;
use Illuminate\Session\ArraySessionHandler;
use Illuminate\Session\Store;
use Illuminate\Support\Facades\Exceptions;
use Illuminate\Support\Facades\Route;
use Tests\Support\InertiaRequest;
use Tests\Support\Routing\AccessStubs;

beforeEach(function (): void {
    AccessStubs::register();
    Route::middleware(['web', 'auth', 'recent.auth'])->match(['GET', 'DELETE'], '/_recent-stub', static fn () => response()->json(['ok' => true]));
});

it('passes with a password confirmation 5 minutes ago', function (): void {
    $this->withSession(['auth.password_confirmed_at' => now()->subMinutes(5)->getTimestamp()])
        ->actingAs(User::factory()->create())
        ->getJson('/_recent-stub')
        ->assertOk();
});

it('passes with a login 9 minutes ago', function (): void {
    $this->withSession(['auth.login_at' => now()->subMinutes(9)->getTimestamp()])
        ->actingAs(User::factory()->create())
        ->getJson('/_recent-stub')
        ->assertOk();
});

it('sends a user with a password to the password confirmation after 11 minutes', function (): void {
    $this->withSession(['auth.login_at' => now()->subMinutes(11)->getTimestamp()])
        ->actingAs(User::factory()->create())
        ->get('/_recent-stub')
        ->assertRedirectToRoute('password.confirm');
});

it('sends a passwordless user to re-authentication', function (): void {
    $this->withSession(['auth.login_at' => now()->subMinutes(11)->getTimestamp()])
        ->actingAs(User::factory()->phoneOnly()->create())
        ->get('/_recent-stub')
        ->assertRedirectToRoute('auth.reauthenticate');
});

it('sends a session with no stamp at all to confirm', function (): void {
    $this->actingAs(User::factory()->create())->get('/_recent-stub')->assertRedirectToRoute('password.confirm');
});

it('uses the later of the two stamps', function (): void {
    $this->withSession([
        'auth.login_at' => now()->subHours(3)->getTimestamp(),
        'auth.password_confirmed_at' => now()->subMinutes(2)->getTimestamp(),
    ])->actingAs(User::factory()->create())->getJson('/_recent-stub')->assertOk();
});

it('answers JSON with 403 recent_auth_required', function (): void {
    $this->actingAs(User::factory()->create())
        ->getJson('/_recent-stub')
        ->assertForbidden()
        ->assertExactJson(['code' => 'recent_auth_required']);
});

it('redirects an Inertia visit like a browser', function (): void {
    $this->actingAs(User::factory()->create())
        ->get('/_recent-stub', InertiaRequest::headers())
        ->assertRedirectToRoute('password.confirm');
});

it('remembers the page to come back to', function (): void {
    $this->actingAs(User::factory()->create())->get('/_recent-stub')->assertRedirectToRoute('password.confirm');

    expect(session('url.intended'))->toBe(url('/_recent-stub'));
});

it('comes back to the previous page after a write request', function (): void {
    $this->actingAs(User::factory()->create())
        ->withHeaders(['Referer' => url('/account/security')])
        ->delete('/_recent-stub')
        ->assertRedirectToRoute('password.confirm');

    expect(session('url.intended'))->toBe(url('/account/security'));
});

it('does not report the exception', function (): void {
    Exceptions::fake();

    $this->actingAs(User::factory()->create())->get('/_recent-stub')->assertRedirect();

    Exceptions::assertNothingReported();
});

describe('RecentAuthentication::passes', function (): void {
    function requestWithSession(array $data): Request
    {
        $request = Request::create('/');
        $session = new Store('test', new ArraySessionHandler(120));
        $session->put($data);
        $request->setLaravelSession($session);

        return $request;
    }

    it('reads unix timestamps, date strings and dates', function (mixed $value): void {
        expect(RecentAuthentication::passes(requestWithSession(['auth.login_at' => $value])))->toBeTrue();
    })->with([
        'timestamp' => fn () => now()->subMinutes(3)->getTimestamp(),
        'string' => fn () => now()->subMinutes(3)->toIso8601String(),
        'carbon' => fn () => now()->subMinutes(3),
    ]);

    it('refuses an old, missing or unreadable stamp', function (mixed $value): void {
        expect(RecentAuthentication::passes(requestWithSession(['auth.login_at' => $value])))->toBeFalse();
    })->with([
        'old' => fn () => now()->subMinutes(11)->getTimestamp(),
        'null' => null,
        'garbage' => 'not a date',
        'array' => fn () => ['x'],
    ]);

    it('refuses a request without a session', function (): void {
        expect(RecentAuthentication::passes(Request::create('/')))->toBeFalse();
    });
});
