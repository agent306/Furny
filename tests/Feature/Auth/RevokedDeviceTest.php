<?php

declare(strict_types=1);

use App\Domain\Identity\Actions\RevokeSessions;
use App\Domain\Identity\Models\User;
use App\Support\Auth\SessionKey;
use App\Support\Auth\SessionRegistry;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Facades\Session;
use Illuminate\Support\Str;
use Tests\Support\SessionStamp;

beforeEach(function (): void {
    $this->token = Str::random(60);
    $this->user = User::factory()->create(['remember_token' => $this->token]);
    // Device A: a browser session in the registry.
    $this->deviceA = Str::random(40);
    Session::getHandler()->write($this->deviceA, '[]');
    app(SessionRegistry::class)->register($this->user, $this->deviceA, Request::create('/'), 'password', true);
    app(RevokeSessions::class)->device($this->user, SessionKey::for($this->deviceA));
    // Device B: signed in by its remember cookie alone.
    $this->recaller = $this->user->getKey().'|'.$this->token.'|'.Auth::guard('web')->hashPasswordForCookie($this->user->getAuthPassword());
});

afterEach(function (): void {
    $redis = Redis::connection('sessions');

    foreach ($redis->zrange('sess:user:'.$this->user->getKey(), 0, -1) as $id) {
        $redis->del('sess:meta:'.$id, 'sess:revoked:'.$id);
    }

    $redis->del('sess:user:'.$this->user->getKey(), 'sess:revoked:'.$this->deviceA, 'sess:meta:'.$this->deviceA);
});

it('signs out the revoked device and leaves the remember cookie of another device working', function (): void {
    $this->actingAs($this->user)
        ->withCookie((string) config('session.cookie'), $this->deviceA)
        ->withSession(SessionStamp::loginHoursAgo(0))
        ->get(route('customer.dashboard'))
        ->assertRedirectToRoute('login');

    $this->assertGuest();
    expect($this->user->fresh()->remember_token)->toBe($this->token);

    // Another browser, with nothing but the recaller cookie.
    Auth::forgetGuards();

    $this->withCookie(Auth::guard('web')->getRecallerName(), $this->recaller)
        ->get(route('customer.dashboard'))
        ->assertOk();

    $this->assertAuthenticatedAs($this->user);
    expect(session('auth.method'))->toBe('remember');
});

it('does the same for a JSON client, answering 401 session_revoked', function (): void {
    $this->actingAs($this->user)
        ->withCredentials()
        ->withCookie((string) config('session.cookie'), $this->deviceA)
        ->getJson(route('customer.dashboard'))
        ->assertUnauthorized()
        ->assertExactJson(['code' => 'session_revoked']);

    expect($this->user->fresh()->remember_token)->toBe($this->token);
});

it('shows the reason once on the login page and clears the history of the browser', function (): void {
    $this->actingAs($this->user)
        ->withCookie((string) config('session.cookie'), $this->deviceA)
        ->get(route('customer.dashboard'))
        ->assertRedirectToRoute('login')
        ->assertInertiaFlash('error', trans_icu('auth.session_revoked'));

    expect(session('inertia.clear_history'))->toBeTrue();
});

it('still cycles the remember token when a deactivated user is signed out', function (): void {
    $this->user->forceFill(['is_active' => false])->save();

    $this->actingAs($this->user)->get(route('customer.dashboard'))->assertRedirectToRoute('login');

    expect($this->user->fresh()->remember_token)->not->toBe($this->token);
});

it('keeps the remember cookies of other devices when a user signs out the device in use from the device list', function (): void {
    $current = Str::random(40);
    Session::getHandler()->write($current, '[]');
    app(SessionRegistry::class)->register($this->user, $current, Request::create('/'), 'password', true);

    $this->actingAs($this->user)
        ->withCookie((string) config('session.cookie'), $current)
        ->withCookie(Auth::guard('web')->getRecallerName(), $this->recaller)
        ->withSession(SessionStamp::loginHoursAgo(0))
        ->delete(route('account.sessions.destroy', SessionKey::for($current)))
        ->assertRedirectToRoute('login');

    $this->assertGuest();
    expect($this->user->fresh()->remember_token)->toBe($this->token);

    Auth::forgetGuards();

    $this->withCookie(Auth::guard('web')->getRecallerName(), $this->recaller)->get(route('customer.dashboard'))->assertOk();

    $this->assertAuthenticatedAs($this->user);

    Redis::connection('sessions')->del('sess:revoked:'.$current, 'sess:meta:'.$current);
});
