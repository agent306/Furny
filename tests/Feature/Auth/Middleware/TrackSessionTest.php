<?php

declare(strict_types=1);

use App\Domain\Identity\Actions\RevokeSessions;
use App\Domain\Identity\Models\User;
use App\Http\Middleware\TrackSession;
use App\Support\Auth\SessionKey;
use App\Support\Auth\SessionRegistry;
use App\Support\Http\StatelessRoute;
use Carbon\CarbonImmutable;
use Illuminate\Routing\Router;
use Illuminate\Session\Middleware\AuthenticateSession;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Exceptions;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Session;
use Illuminate\Support\Str;

const TRACK_FIREFOX = 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0';

beforeEach(function (): void {
    $this->user = User::factory()->create();
    $this->redis = Redis::connection('sessions');
    $this->ids = [];
});

afterEach(function (): void {
    $key = 'sess:user:'.$this->user->getKey();

    foreach ([...$this->redis->zrange($key, 0, -1), ...$this->ids] as $id) {
        $this->redis->del('sess:meta:'.$id, 'sess:revoked:'.$id);
    }

    $this->redis->del($key);
});

/** What the user's registry holds: the entries by their keys. */
function trackedSessions(User $user): array
{
    return collect(app(SessionRegistry::class)->list($user, null))->keyBy('key')->all();
}

/** The user's registry keys: the list of their sessions. */
function userKeyOf(User $user): string
{
    return 'sess:user:'.$user->getKey();
}

it('is the `track.session` alias, after AuthenticateSession in the web group', function (): void {
    $router = app(Router::class);
    $web = $router->getMiddlewareGroups()['web'];

    expect($router->getMiddleware()['track.session'])->toBe(TrackSession::class)
        ->and(array_search(AuthenticateSession::class, $web, true))->toBeInt()
        ->and(array_search(TrackSession::class, $web, true))->toBeGreaterThan(array_search(AuthenticateSession::class, $web, true));
});

it('reads the sign-in method and the remember choice from the keys of 13 section 5', function (): void {
    expect(TrackSession::METHOD_KEY)->toBe('auth.method')
        ->and(TrackSession::REMEMBER_KEY)->toBe('auth.remember');
});

it('registers the session of an authenticated request', function (): void {
    $this->actingAs($this->user)
        ->withHeader('User-Agent', TRACK_FIREFOX)
        ->withServerVariables(['REMOTE_ADDR' => '203.0.113.45'])
        ->get(route('customer.dashboard'))
        ->assertOk();

    $id = Session::getId();
    $entries = trackedSessions($this->user);

    expect($entries)->toHaveCount(1)->toHaveKey(SessionKey::for($id))
        ->and($entries[SessionKey::for($id)])
        ->uaSummary->toBe('Firefox on Linux')
        ->ipMasked->toBe('203.0.113.0')
        ->method->toBe('unknown');
});

it('records the sign-in method a login flow put in the session', function (): void {
    $this->actingAs($this->user)
        ->withSession([TrackSession::METHOD_KEY => 'google'])
        ->get(route('customer.dashboard'))
        ->assertOk();

    expect(array_values(trackedSessions($this->user))[0]->method)->toBe('google');
});

it('keeps the meta 14 days longer when the user ticked remember or carries the remember cookie', function (string $how): void {
    $request = $this->actingAs($this->user);

    if ($how === 'session') {
        $request = $request->withSession([TrackSession::REMEMBER_KEY => true]);
    } else {
        $request = $request->withCookie(Auth::guard('web')->getRecallerName(), 'unused');
    }

    $request->get(route('customer.dashboard'))->assertOk();

    expect($this->redis->ttl('sess:meta:'.Session::getId()))->toBeGreaterThan(14 * 86400);
})->with(['ticked at login' => ['session'], 'carries the cookie' => ['cookie']]);

it('keeps the plain lifetime for a session that is not remembered', function (): void {
    $this->actingAs($this->user)->get(route('customer.dashboard'))->assertOk();

    expect($this->redis->ttl('sess:meta:'.Session::getId()))->toBeLessThan(86400);
});

it('touches an already registered session instead of registering it again', function (): void {
    CarbonImmutable::setTestNow('2026-10-20 10:00:00');
    $this->actingAs($this->user)->get(route('customer.dashboard'))->assertOk();
    $id = Session::getId();
    $created = $this->redis->hget('sess:meta:'.$id, 'created_at');

    CarbonImmutable::setTestNow('2026-10-20 10:05:00');
    $this->actingAs($this->user)->withCookie((string) config('session.cookie'), $id)->get(route('customer.dashboard'))->assertOk();

    expect(Session::getId())->toBe($id)
        ->and($this->redis->hget('sess:meta:'.$id, 'created_at'))->toBe($created)
        ->and((int) $this->redis->hget('sess:meta:'.$id, 'last_active_at'))->toBe(CarbonImmutable::now()->getTimestamp());
});

it('writes nothing for a guest', function (): void {
    $this->get(route('welcome'))->assertOk();
    $this->get(route('login'));

    // A guest has no user whose keys could be written; the keys of this test's user stay empty.
    expect($this->redis->exists(userKeyOf($this->user)))->toBe(0)
        ->and($this->redis->exists('sess:meta:'.Session::getId()))->toBe(0);
});

it('is not in the middleware of the stateless routes', function (): void {
    $stack = fn (string $name): array => array_filter(
        app(Router::class)->gatherRouteMiddleware(Route::getRoutes()->getByName($name)),
        'is_string',
    );

    expect($stack('customer.dashboard'))->toContain(TrackSession::class)
        ->and($stack('manifest'))->not->toContain(TrackSession::class)
        ->and($stack('csp.report'))->not->toContain(TrackSession::class)
        ->and(StatelessRoute::WITHOUT)->toContain(TrackSession::class);
});

it('writes nothing on a stateless route, even for a signed-in user', function (): void {
    $this->actingAs($this->user)->get(route('manifest'))->assertOk();

    expect($this->redis->exists(userKeyOf($this->user)))->toBe(0)
        ->and($this->redis->exists('sess:meta:'.Session::getId()))->toBe(0);
});

it('does not register a session that the request ended', function (): void {
    $this->user->forceFill(['is_active' => false])->save();

    $this->actingAs($this->user)->get(route('customer.dashboard'))->assertRedirectToRoute('login');

    expect($this->redis->exists(userKeyOf($this->user)))->toBe(0);
});

it('does not fail the request when the registry cannot be written', function (): void {
    Exceptions::fake();
    Redis::shouldReceive('connection')->with('sessions')->andThrow(new RedisException('Connection refused'));

    $this->actingAs($this->user)->get(route('customer.dashboard'))->assertOk();

    Exceptions::assertReported(fn (RedisException $e): bool => $e->getMessage() === 'Connection refused');
});

describe('a session revoked while a request on it was running', function (): void {
    it('stays signed out and is not registered again', function (): void {
        $registry = app(SessionRegistry::class);
        $session = Str::random(40);
        $this->ids[] = $session;
        Session::getHandler()->write($session, '[]');
        $registry->register($this->user, $session, request(), 'password', false);
        $cookie = (string) config('session.cookie');

        // Request A is running on the session when another device signs it out; it saves its payload at the end.
        Route::middleware(['web', 'auth'])->get('/_in-flight', function () use ($session): string {
            app(RevokeSessions::class)->device(
                $this->user,
                SessionKey::for($session),
            );

            return 'done';
        });

        $this->withCookie($cookie, $session)
            ->withSession([Auth::guard('web')->getName() => $this->user->getKey()])
            ->get('/_in-flight')
            ->assertOk();

        // The payload is back (the in-flight request saved it), and the registry does not list the session.
        expect(Session::getHandler()->read($session))->not->toBe('')
            ->and($registry->isRevoked($session))->toBeTrue()
            ->and($this->redis->exists('sess:meta:'.$session))->toBe(0)
            ->and($this->redis->zscore(userKeyOf($this->user), $session))->toBeFalsy();

        // The next request on it is signed out, however alive the payload is, and does not register anything.
        $this->withCookie($cookie, $session)
            ->get(route('customer.dashboard'))
            ->assertRedirectToRoute('login');

        $this->assertGuest();

        expect($this->redis->exists('sess:meta:'.$session))->toBe(0)
            ->and($this->redis->zscore(userKeyOf($this->user), $session))->toBeFalsy()
            ->and(Session::getHandler()->read($session))->toBe('');
    });

    it('is answered with 401 {code: session_revoked} for a machine client', function (): void {
        $registry = app(SessionRegistry::class);
        $session = Str::random(40);
        $this->ids[] = $session;
        Session::getHandler()->write($session, '[]');
        $registry->register($this->user, $session, request(), 'password', false);
        $registry->destroyDevice($this->user, SessionKey::for($session));

        $this->actingAs($this->user)
            ->withCookie((string) config('session.cookie'), $session)
            ->withHeader('Accept', 'application/json')->get(route('customer.dashboard'))
            ->assertUnauthorized()
            ->assertJson(['code' => 'session_revoked']);
    });
});

describe('through real sign-in and sign-out requests', function (): void {
    it('lists the device after sign-in and no longer after sign-out', function (): void {
        $this->post(route('login.store'), ['email' => $this->user->email, 'password' => 'password'])
            ->assertRedirect();

        $session = Session::getId();
        $registry = app(SessionRegistry::class);
        $this->ids[] = $session;

        expect($registry->list($this->user, $session))->toHaveCount(1)
            ->and($registry->list($this->user, $session)[0]->isCurrent)->toBeTrue();

        $this->withCookie((string) config('session.cookie'), $session)
            ->post(route('logout'))
            ->assertRedirect();

        $this->assertGuest();

        expect($registry->list($this->user, null))->toBe([]);
    });
});
