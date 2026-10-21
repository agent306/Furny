<?php

declare(strict_types=1);

use App\Domain\Identity\Models\User;
use App\Http\Middleware\TrackSession;
use App\Support\Auth\SessionKey;
use App\Support\Auth\SessionRegistry;
use Carbon\CarbonImmutable;
use Illuminate\Routing\Router;
use Illuminate\Session\Middleware\AuthenticateSession;
use Illuminate\Support\Facades\Exceptions;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Facades\Session;

const TRACK_FIREFOX = 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0';

beforeEach(function (): void {
    $this->user = User::factory()->create();
    $this->redis = Redis::connection('sessions');
});

afterEach(function (): void {
    $key = 'sess:user:'.$this->user->getKey();

    foreach ($this->redis->zrange($key, 0, -1) as $id) {
        $this->redis->del('sess:meta:'.$id);
    }

    $this->redis->del($key);
});

/** What the user's registry holds: the meta of each session by its key. */
function trackedSessions(User $user): array
{
    return collect(app(SessionRegistry::class)->list($user, null))->keyBy('key')->all();
}

it('is the `track.session` alias, after AuthenticateSession in the web group', function (): void {
    $router = app(Router::class);
    $web = $router->getMiddlewareGroups()['web'];

    expect($router->getMiddleware()['track.session'])->toBe(TrackSession::class)
        ->and(array_search(AuthenticateSession::class, $web, true))->toBeInt()
        ->and(array_search(TrackSession::class, $web, true))->toBeGreaterThan(array_search(AuthenticateSession::class, $web, true));
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
    $before = $this->redis->dbsize();

    $this->get(route('welcome'))->assertOk();
    $this->get(route('login'));

    expect($this->redis->dbsize())->toBe($before);
});

it('writes nothing on the stateless routes, even for a signed-in user', function (): void {
    $before = $this->redis->dbsize();

    $this->actingAs($this->user)->get(route('manifest'))->assertOk();
    $this->actingAs($this->user)->get('/build/missing.js')->assertNotFound();

    expect($this->redis->dbsize())->toBe($before);
});

it('does not register a session that the request ended', function (): void {
    $this->user->forceFill(['is_active' => false])->save();

    $this->actingAs($this->user)->get(route('customer.dashboard'))->assertRedirectToRoute('login');

    expect($this->redis->exists('sess:user:'.$this->user->getKey()))->toBe(0);
});

it('does not fail the request when the registry cannot be written', function (): void {
    Exceptions::fake();
    Redis::shouldReceive('connection')->with('sessions')->andThrow(new RedisException('Connection refused'));

    $this->actingAs($this->user)->get(route('customer.dashboard'))->assertOk();

    Exceptions::assertReported(fn (RedisException $e): bool => $e->getMessage() === 'Connection refused');
});
