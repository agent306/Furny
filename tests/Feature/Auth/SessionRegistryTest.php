<?php

declare(strict_types=1);

use App\Domain\Identity\Models\User;
use App\Support\Auth\SessionEntry;
use App\Support\Auth\SessionKey;
use App\Support\Auth\SessionRegistry;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Redis\Connections\Connection;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Facades\Session;
use Illuminate\Support\Str;

const REGISTRY_CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const REGISTRY_FIREFOX = 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0';

/** A request from `$ip` with `$userAgent`, as the registry sees it at login. */
function registryRequest(string $ip = '203.0.113.45', string $userAgent = REGISTRY_CHROME): Request
{
    return Request::create('/', server: ['REMOTE_ADDR' => $ip, 'HTTP_USER_AGENT' => $userAgent]);
}

/** A session id that exists in the session handler, as a live session does. */
function liveSessionId(): string
{
    $id = Str::random(40);
    Session::getHandler()->write($id, 'payload');

    return $id;
}

function sessionsRedis(): Connection
{
    return Redis::connection('sessions');
}

beforeEach(function (): void {
    $this->registry = app(SessionRegistry::class);
    $this->user = User::factory()->create();
    $this->ids = [];
});

afterEach(function (): void {
    // Only the keys these tests created.
    sessionsRedis()->del('sess:user:'.$this->user->getKey());

    foreach ($this->ids as $id) {
        sessionsRedis()->del('sess:meta:'.$id);
    }
});

/** Registers a live session for the test user and remembers its id for the cleanup. */
function registerSession(object $test, string $ip = '203.0.113.45', string $userAgent = REGISTRY_CHROME, string $method = 'password', bool $remembered = false): string
{
    $id = liveSessionId();
    $test->ids[] = $id;
    $test->registry->register($test->user, $id, registryRequest($ip, $userAgent), $method, $remembered);

    return $id;
}

it('keeps its keys in a Redis database that is neither the cache nor the default one', function (): void {
    expect(config('session.connection'))->toBe('sessions')
        ->and(config('database.redis.sessions.database'))->not->toBe(config('database.redis.cache.database'))
        ->and(config('database.redis.sessions.database'))->not->toBe(config('database.redis.default.database'));
});

it('lists the registered sessions with masked address, device summary and the current one flagged', function (): void {
    $first = registerSession($this, '203.0.113.45', REGISTRY_CHROME, 'password');
    $second = registerSession($this, '198.51.100.7', REGISTRY_FIREFOX, 'google');

    $entries = $this->registry->list($this->user, $first);

    expect($entries)->toHaveCount(2)
        ->and($entries[0])->toBeInstanceOf(SessionEntry::class);

    $byKey = collect($entries)->keyBy(fn (SessionEntry $entry): string => $entry->key);

    expect($byKey[SessionKey::for($first)])
        ->ipMasked->toBe('203.0.113.0')
        ->uaSummary->toBe('Chrome on Windows')
        ->method->toBe('password')
        ->isCurrent->toBeTrue()
        ->and($byKey[SessionKey::for($second)])
        ->ipMasked->toBe('198.51.100.0')
        ->uaSummary->toBe('Firefox on Linux')
        ->method->toBe('google')
        ->isCurrent->toBeFalse();
});

it('never exposes a raw session id in the listing', function (): void {
    $id = registerSession($this);

    $json = json_encode($this->registry->list($this->user, $id), JSON_THROW_ON_ERROR);

    expect($json)->not->toContain($id)
        ->and(SessionKey::for($id))->toHaveLength(32)->toMatch('/^[0-9a-f]{32}$/')
        ->and(SessionKey::for($id))->toBe(substr(hash_hmac('sha256', $id, (string) config('app.key')), 0, 32))
        ->and(SessionKey::for($id))->not->toBe(SessionKey::for($id.'x'));
});

it('lists the most recently active session first', function (): void {
    CarbonImmutable::setTestNow('2026-10-20 10:00:00');
    $older = registerSession($this);
    CarbonImmutable::setTestNow('2026-10-20 10:05:00');
    $newer = registerSession($this);

    $keys = array_map(fn (SessionEntry $entry): string => $entry->key, $this->registry->list($this->user, null));

    expect($keys)->toBe([SessionKey::for($newer), SessionKey::for($older)]);
});

it('stores the meta with a time to live of the session lifetime plus a margin, and 14 days more when remembered', function (): void {
    $plain = registerSession($this);
    $remembered = registerSession($this, remembered: true);
    $lifetime = (int) config('session.lifetime') * 60 + SessionRegistry::TOUCH_INTERVAL_SECONDS;

    expect(sessionsRedis()->ttl('sess:meta:'.$plain))->toBeBetween($lifetime - 5, $lifetime)
        ->and(sessionsRedis()->ttl('sess:meta:'.$remembered))->toBeBetween($lifetime + 14 * 86400 - 5, $lifetime + 14 * 86400);
});

it('lets the meta outlive the session by at least the touch throttle', function (): void {
    $id = registerSession($this);

    expect(sessionsRedis()->ttl('sess:meta:'.$id))->toBeGreaterThanOrEqual((int) config('session.lifetime') * 60 + SessionRegistry::TOUCH_INTERVAL_SECONDS - 5);
});

it('never shortens the time to live of the user\'s list of sessions', function (): void {
    $key = 'sess:user:'.$this->user->getKey();
    registerSession($this, remembered: true);
    $remembered = sessionsRedis()->ttl($key);

    registerSession($this);
    $id = registerSession($this, '198.51.100.7');
    CarbonImmutable::setTestNow(CarbonImmutable::now()->addMinutes(5));
    $this->registry->touch($id);

    expect($remembered)->toBeGreaterThan(14 * 86400)
        ->and(sessionsRedis()->ttl($key))->toBeGreaterThanOrEqual($remembered - 5);
});

it('removes the sessions that cannot be alive any more when it registers a new one', function (): void {
    CarbonImmutable::setTestNow('2026-10-20 10:00:00');
    $old = registerSession($this);
    $metaOfOld = 'sess:meta:'.$old;

    CarbonImmutable::setTestNow('2026-10-20 12:05:00');
    $new = registerSession($this, '198.51.100.7');

    expect(sessionsRedis()->zscore('sess:user:'.$this->user->getKey(), $old))->toBeFalsy()
        ->and(sessionsRedis()->zscore('sess:user:'.$this->user->getKey(), $new))->toBeTruthy()
        ->and(sessionsRedis()->exists($metaOfOld))->toBe(0);
});

it('drops the entry of a session that was destroyed in the handler', function (): void {
    $kept = registerSession($this);
    $gone = registerSession($this, '198.51.100.7');

    Session::getHandler()->destroy($gone);

    $entries = $this->registry->list($this->user, $kept);

    expect($entries)->toHaveCount(1)
        ->and($entries[0]->key)->toBe(SessionKey::for($kept))
        ->and(sessionsRedis()->zscore('sess:user:'.$this->user->getKey(), $gone))->toBeFalsy()
        ->and(sessionsRedis()->exists('sess:meta:'.$gone))->toBe(0);
});

it('drops the entry whose meta has expired', function (): void {
    $kept = registerSession($this);
    $expired = registerSession($this, '198.51.100.7');

    sessionsRedis()->del('sess:meta:'.$expired);

    expect($this->registry->list($this->user, $kept))->toHaveCount(1)
        ->and(sessionsRedis()->zscore('sess:user:'.$this->user->getKey(), $expired))->toBeFalsy();
});

it('does not prune the current session even before the handler has stored it', function (): void {
    $current = Str::random(40);
    $this->ids[] = $current;
    $this->registry->register($this->user, $current, registryRequest(), 'password', false);

    expect($this->registry->list($this->user, $current))->toHaveCount(1);
});

it('lists nothing for a user without sessions', function (): void {
    expect($this->registry->list($this->user, null))->toBe([]);
});

it('does not list the sessions of another user', function (): void {
    registerSession($this);

    expect($this->registry->list(User::factory()->create(), null))->toBe([]);
});

it('destroys one session by its key', function (): void {
    $kept = registerSession($this);
    $target = registerSession($this, '198.51.100.7');

    expect($this->registry->destroy($this->user, SessionKey::for($target)))->toBeTrue()
        ->and(Session::getHandler()->read($target))->toBe('')
        ->and(Session::getHandler()->read($kept))->not->toBe('')
        ->and(sessionsRedis()->exists('sess:meta:'.$target))->toBe(0)
        ->and($this->registry->list($this->user, $kept))->toHaveCount(1);
});

it('refuses a key that is not one of the user\'s sessions', function (): void {
    $mine = registerSession($this);
    $other = User::factory()->create();

    expect($this->registry->destroy($other, SessionKey::for($mine)))->toBeFalse()
        ->and($this->registry->destroy($this->user, str_repeat('0', 32)))->toBeFalse()
        ->and(Session::getHandler()->read($mine))->not->toBe('');
});

it('destroys every other session, returns how many, and rotates the remember token', function (): void {
    $current = registerSession($this);
    $other = registerSession($this, '198.51.100.7');
    $this->user->forceFill(['remember_token' => 'old-token'])->save();

    expect($this->registry->destroyOthers($this->user, $current))->toBe(1)
        ->and(Session::getHandler()->read($other))->toBe('')
        ->and(Session::getHandler()->read($current))->not->toBe('')
        ->and($this->user->fresh()->remember_token)->not->toBe('old-token')->toHaveLength(60)
        ->and($this->registry->list($this->user, $current))->toHaveCount(1);
});

it('does not count a stale entry as a revoked session', function (): void {
    $current = registerSession($this);
    $stale = registerSession($this, '198.51.100.7');
    Session::getHandler()->destroy($stale);

    expect($this->registry->destroyOthers($this->user, $current))->toBe(0)
        ->and(sessionsRedis()->zscore('sess:user:'.$this->user->getKey(), $stale))->toBeFalsy();
});

it('destroys all sessions including the current one, and rotates the remember token', function (): void {
    $first = registerSession($this);
    $second = registerSession($this, '198.51.100.7');
    $this->user->forceFill(['remember_token' => 'old-token'])->save();

    expect($this->registry->destroyAll($this->user))->toBe(2)
        ->and(Session::getHandler()->read($first))->toBe('')
        ->and(Session::getHandler()->read($second))->toBe('')
        ->and($this->user->fresh()->remember_token)->not->toBe('old-token')
        ->and($this->registry->list($this->user, null))->toBe([])
        ->and(sessionsRedis()->exists('sess:user:'.$this->user->getKey()))->toBe(0);
});

it('touches the last activity at most once per 60 seconds', function (): void {
    CarbonImmutable::setTestNow('2026-10-20 10:00:00');
    $id = registerSession($this);
    $key = 'sess:meta:'.$id;
    $started = CarbonImmutable::now()->getTimestamp();

    expect((int) sessionsRedis()->hget($key, 'last_active_at'))->toBe($started);

    CarbonImmutable::setTestNow('2026-10-20 10:00:59');
    $this->registry->touch($id);
    expect((int) sessionsRedis()->hget($key, 'last_active_at'))->toBe($started);

    CarbonImmutable::setTestNow('2026-10-20 10:01:00');
    $this->registry->touch($id);
    $touched = CarbonImmutable::now()->getTimestamp();
    expect((int) sessionsRedis()->hget($key, 'last_active_at'))->toBe($touched)
        ->and((int) sessionsRedis()->zscore('sess:user:'.$this->user->getKey(), $id))->toBe($touched)
        ->and($this->registry->list($this->user, $id)[0]->lastActiveAt->getTimestamp())->toBe($touched);

    CarbonImmutable::setTestNow('2026-10-20 10:01:30');
    $this->registry->touch($id);
    expect((int) sessionsRedis()->hget($key, 'last_active_at'))->toBe($touched);
});

it('keeps the created time when touching', function (): void {
    CarbonImmutable::setTestNow('2026-10-20 10:00:00');
    $id = registerSession($this);
    $created = sessionsRedis()->hget('sess:meta:'.$id, 'created_at');

    CarbonImmutable::setTestNow('2026-10-20 11:00:00');
    $this->registry->touch($id);

    expect(sessionsRedis()->hget('sess:meta:'.$id, 'created_at'))->toBe($created);
});

it('ignores a touch for a session it does not know', function (): void {
    $unknown = Str::random(40);

    $this->registry->touch($unknown);

    expect(sessionsRedis()->exists('sess:meta:'.$unknown))->toBe(0);
});

it('registers a session the first time it tracks it and only touches it afterwards', function (): void {
    CarbonImmutable::setTestNow('2026-10-20 10:00:00');
    $id = Str::random(40);
    $this->ids[] = $id;
    $first = registryRequest('203.0.113.45', REGISTRY_CHROME);
    $second = registryRequest('198.51.100.7', REGISTRY_FIREFOX);

    $this->registry->track($this->user, $id, $first, 'google', false);
    CarbonImmutable::setTestNow('2026-10-20 10:05:00');
    $this->registry->track($this->user, $id, $second, 'password', false);

    $meta = sessionsRedis()->hgetall('sess:meta:'.$id);

    expect($meta)->toMatchArray(['ip_masked' => '203.0.113.0', 'ua_summary' => 'Chrome on Windows', 'method' => 'google'])
        ->and((int) $meta['last_active_at'])->toBe(CarbonImmutable::now()->getTimestamp())
        ->and((int) $meta['created_at'])->toBe(CarbonImmutable::now()->subMinutes(5)->getTimestamp());
});

it('leaves a tombstone for a revoked session, as long as its payload could live', function (): void {
    $kept = registerSession($this);
    $target = registerSession($this, '198.51.100.7');

    $this->registry->destroy($this->user, SessionKey::for($target));

    expect($this->registry->isRevoked($target))->toBeTrue()
        ->and($this->registry->isRevoked($kept))->toBeFalse()
        ->and(sessionsRedis()->ttl('sess:revoked:'.$target))->toBeGreaterThanOrEqual((int) config('session.lifetime') * 60);

    sessionsRedis()->del('sess:revoked:'.$target);
});

it('leaves tombstones for the sessions destroyOthers and destroyAll close', function (): void {
    $current = registerSession($this);
    $other = registerSession($this, '198.51.100.7');

    $this->registry->destroyOthers($this->user, $current);
    expect($this->registry->isRevoked($other))->toBeTrue()->and($this->registry->isRevoked($current))->toBeFalse();

    $this->registry->destroyAll($this->user);
    expect($this->registry->isRevoked($current))->toBeTrue();

    sessionsRedis()->del('sess:revoked:'.$other, 'sess:revoked:'.$current);
});

it('does not register a revoked session again when it is tracked', function (): void {
    $id = registerSession($this);
    $this->registry->destroyAll($this->user);

    $this->registry->track($this->user, $id, registryRequest(), 'password', false);

    expect(sessionsRedis()->exists('sess:meta:'.$id))->toBe(0)
        ->and(sessionsRedis()->exists('sess:user:'.$this->user->getKey()))->toBe(0);

    sessionsRedis()->del('sess:revoked:'.$id);
});

it('does not bring back the meta of a session that is revoked while it is touched', function (): void {
    CarbonImmutable::setTestNow('2026-10-20 10:00:00');
    $id = registerSession($this);
    sessionsRedis()->del('sess:meta:'.$id);

    CarbonImmutable::setTestNow('2026-10-20 10:10:00');
    $this->registry->touch($id);

    expect(sessionsRedis()->exists('sess:meta:'.$id))->toBe(0);
});

it('reports how many sessions closing a device really closed', function (): void {
    $live = registerSession($this);
    $dead = registerSession($this, '198.51.100.7');
    Session::getHandler()->destroy($dead);

    expect($this->registry->destroyDevice($this->user, SessionKey::for($dead)))->toBe(0)
        ->and($this->registry->destroyDevice($this->user, SessionKey::for($live)))->toBe(1)
        ->and($this->registry->destroyDevice($this->user, SessionKey::for($live)))->toBeNull();

    sessionsRedis()->del('sess:revoked:'.$dead, 'sess:revoked:'.$live);
});

it('rotates the remember token without firing model events', function (): void {
    $current = registerSession($this);
    $fired = false;
    User::updated(function () use (&$fired): void {
        $fired = true;
    });

    $this->registry->destroyOthers($this->user, $current);

    expect($fired)->toBeFalse();
});
