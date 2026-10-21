<?php

declare(strict_types=1);

use App\Domain\Identity\Models\User;
use App\Support\Auth\RecentAuthentication;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Exceptions;
use Illuminate\Support\Facades\Route;
use Tests\Support\InertiaRequest;
use Tests\Support\Routing\AccessStubs;
use Tests\Support\SessionStamp;

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

it('does not report the exception', function (): void {
    Exceptions::fake();

    $this->actingAs(User::factory()->create())->get('/_recent-stub')->assertRedirect();

    Exceptions::assertNothingReported();
});

describe('the intended URL', function (): void {
    it('keeps a same-origin Referer as a relative path', function (string $referer, string $expected): void {
        $this->actingAs(User::factory()->create())
            ->withHeaders(['Referer' => $referer])
            ->delete('/_recent-stub')
            ->assertRedirectToRoute('password.confirm');

        expect(session('url.intended'))->toBe($expected);
    })->with([
        'request origin' => [fn () => url('/account/security?tab=devices'), '/account/security?tab=devices'],
        'app.url origin' => [fn () => rtrim((string) config('app.url'), '/').'/account/security', '/account/security'],
        'bare host' => [fn () => url('/'), '/'],
    ]);

    it('drops a Referer from another site', function (string $referer): void {
        $this->actingAs(User::factory()->create())
            ->withHeaders(['Referer' => $referer])
            ->delete('/_recent-stub')
            ->assertRedirectToRoute('password.confirm');

        expect(session('url.intended'))->toBeNull();
    })->with([
        'other host' => 'https://evil.example/x',
        'protocol-relative' => '//evil.example/x',
        'protocol-relative path only' => '//evil',
        'other scheme' => 'javascript:alert(1)',
        'userinfo trick' => 'https://localhost@evil.example/x',
        'other port' => 'http://localhost:9999/x',
        'relative' => '/just/a/path',
        'garbage' => 'http://',
    ]);

    it('never stores a path that reads as another site', function (): void {
        $this->actingAs(User::factory()->create())
            ->withHeaders(['Referer' => rtrim(url('/'), '/').'//evil.example/x'])
            ->delete('/_recent-stub')
            ->assertRedirectToRoute('password.confirm');

        expect(session('url.intended'))->toBe('/evil.example/x')->not->toStartWith('//');
    });

    it('stores nothing without a Referer', function (): void {
        $this->actingAs(User::factory()->create())->delete('/_recent-stub')->assertRedirectToRoute('password.confirm');

        expect(session('url.intended'))->toBeNull();
    });
});

it('refuses a stamp that is not a positive integer or lies in the future', function (mixed $stamp): void {
    $this->withSession(['auth.login_at' => $stamp, 'auth.password_confirmed_at' => $stamp])
        ->actingAs(User::factory()->create())
        ->get('/_recent-stub')
        ->assertRedirectToRoute('password.confirm');
})->with([
    'future' => fn () => now()->addHour()->getTimestamp(),
    'future by 2 minutes' => fn () => now()->addMinutes(2)->getTimestamp(),
    'string' => fn () => (string) now()->getTimestamp(),
    'iso string' => fn () => now()->toIso8601String(),
    'carbon' => fn () => now(),
    'float' => fn () => (float) now()->getTimestamp(),
    'zero' => 0,
    'negative' => -1,
    'true' => true,
]);

it('tolerates 30 seconds of clock skew', function (): void {
    $this->withSession(['auth.login_at' => now()->addSeconds(30)->getTimestamp()])
        ->actingAs(User::factory()->create())
        ->getJson('/_recent-stub')
        ->assertOk();
});

describe('RecentAuthentication::passes', function (): void {
    it('reads positive integer timestamps', function (): void {
        expect(RecentAuthentication::passes(SessionStamp::requestWith(['auth.login_at' => SessionStamp::minutesAgo(3)])))->toBeTrue()
            ->and(RecentAuthentication::passes(SessionStamp::requestWith(['auth.password_confirmed_at' => SessionStamp::minutesAgo(3)])))->toBeTrue();
    });

    it('refuses an old, missing or unreadable stamp', function (mixed $value): void {
        expect(RecentAuthentication::passes(SessionStamp::requestWith(['auth.login_at' => $value])))->toBeFalse();
    })->with([
        'old' => fn () => SessionStamp::minutesAgo(11),
        'null' => null,
        'garbage' => 'not a date',
        'array' => fn () => ['x'],
    ]);

    it('refuses a request without a session', function (): void {
        expect(RecentAuthentication::passes(Request::create('/')))->toBeFalse();
    });
});
