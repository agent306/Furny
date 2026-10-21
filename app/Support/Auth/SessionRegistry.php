<?php

declare(strict_types=1);

namespace App\Support\Auth;

use App\Domain\Identity\Models\User;
use App\Support\Privacy\Mask;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Redis\Connections\PhpRedisConnection;
use Illuminate\Session\SessionManager;
use Illuminate\Support\Facades\Redis as RedisFacade;
use Illuminate\Support\Str;
use LogicException;
use Redis;
use SessionHandlerInterface;

/**
 * Which sessions a user has open (13 §6.3), kept in the Redis connection `sessions` next to the session payloads:
 *
 *   sess:user:{userId}     ZSET  session id => last activity (unix seconds)
 *   sess:meta:{sessionId}  HASH  user_id, ip_masked, ua_summary, created_at, last_active_at, method, remembered
 *
 * The meta expires with the session (`SESSION_LIFETIME` minutes, 14 days more for a remembered customer). A
 * session id is a credential: it never leaves this class, the device list carries the `SessionKey` instead.
 */
final class SessionRegistry
{
    /** `touch()` writes at most this often per session. */
    public const int TOUCH_INTERVAL_SECONDS = 60;

    /** Extra lifetime of the meta of a remembered session: the remember cookie signs the user in again for this long. */
    private const int REMEMBERED_EXTRA_SECONDS = 14 * 86400;

    /** Length of the `remember_token` column's value, as Laravel's own `Str::random(60)` makes it. */
    private const int REMEMBER_TOKEN_LENGTH = 60;

    public function __construct(private readonly SessionManager $sessions) {}

    public function register(User $user, string $sessionId, Request $request, string $method, bool $remembered): void
    {
        $now = CarbonImmutable::now()->getTimestamp();
        $ttl = $this->ttl($remembered);

        $this->redis()->transaction(function (Redis $redis) use ($user, $sessionId, $request, $method, $remembered, $now, $ttl): void {
            $redis->hMSet($this->metaKey($sessionId), [
                'user_id' => (string) $user->getKey(),
                'ip_masked' => Mask::ip((string) $request->ip()),
                'ua_summary' => UserAgentSummary::from((string) $request->userAgent()),
                'created_at' => $now,
                'last_active_at' => $now,
                'method' => $method,
                'remembered' => $remembered ? '1' : '0',
            ]);
            $redis->expire($this->metaKey($sessionId), $ttl);
            $redis->zAdd($this->userKey($user), $now, $sessionId);
            $redis->expire($this->userKey($user), $ttl);
        });
    }

    /**
     * What `TrackSession` calls on every authenticated request: the first time the registry sees a session it
     * registers it, afterwards it records activity.
     */
    public function track(User $user, string $sessionId, Request $request, string $method, bool $remembered): void
    {
        if (! $this->touchIfKnown($sessionId)) {
            $this->register($user, $sessionId, $request, $method, $remembered);
        }
    }

    /** Records activity, at most once per `TOUCH_INTERVAL_SECONDS`. A session the registry does not know is ignored. */
    public function touch(string $sessionId): void
    {
        $this->touchIfKnown($sessionId);
    }

    /**
     * The user's open sessions, most recently active first. An entry whose meta has expired, or whose session the
     * session handler no longer has, is removed on the way. The current session is never judged by the handler:
     * on the request that created it, it has not been stored yet.
     *
     * @return list<SessionEntry>
     */
    public function list(User $user, ?string $currentSessionId): array
    {
        $ids = $this->sessionIds($user);

        if ($ids === []) {
            return [];
        }

        /** @var list<array<string, string>> $metas */
        $metas = $this->redis()->pipeline(function (Redis $pipe) use ($ids): void {
            foreach ($ids as $id) {
                $pipe->hGetAll($this->metaKey($id));
            }
        });

        $entries = [];
        $stale = [];

        foreach ($ids as $position => $id) {
            $meta = $metas[$position] ?? [];
            $current = $currentSessionId !== null && hash_equals($currentSessionId, $id);

            if (($meta['user_id'] ?? null) !== (string) $user->getKey() || (! $current && $this->handler()->read($id) === '')) {
                $stale[] = $id;

                continue;
            }

            $entries[] = new SessionEntry(
                key: SessionKey::for($id),
                uaSummary: $meta['ua_summary'] ?? '',
                ipMasked: $meta['ip_masked'] ?? '',
                lastActiveAt: CarbonImmutable::createFromTimestamp((int) ($meta['last_active_at'] ?? 0)),
                isCurrent: $current,
                method: $meta['method'] ?? '',
            );
        }

        $this->forget($user, $stale);

        return $entries;
    }

    /** Signs out one of the user's sessions, named by its key. False when the user has no such session. */
    public function destroy(User $user, string $sessionKey): bool
    {
        foreach ($this->sessionIds($user) as $id) {
            if (hash_equals(SessionKey::for($id), $sessionKey)) {
                $this->revoke($user, [$id]);

                return true;
            }
        }

        return false;
    }

    /** Signs out every session of the user except the current one and rotates the remember token. Returns how many were open. */
    public function destroyOthers(User $user, string $currentSessionId): int
    {
        $others = array_values(array_filter(
            $this->sessionIds($user),
            static fn (string $id): bool => ! hash_equals($currentSessionId, $id),
        ));

        $revoked = $this->revoke($user, $others);
        $this->rotateRememberToken($user);

        return $revoked;
    }

    /** Signs out every session of the user, the current one included, and rotates the remember token. Returns how many were open. */
    public function destroyAll(User $user): int
    {
        $revoked = $this->revoke($user, $this->sessionIds($user));
        $this->rotateRememberToken($user);

        return $revoked;
    }

    /** @return bool whether the registry knows the session */
    private function touchIfKnown(string $sessionId): bool
    {
        $meta = $this->redis()->hmget($this->metaKey($sessionId), ['user_id', 'last_active_at', 'remembered']);

        if (! is_string($meta[0] ?? false)) {
            return false;
        }

        $now = CarbonImmutable::now()->getTimestamp();

        if (is_numeric($meta[1] ?? null) && $now - (int) $meta[1] < self::TOUCH_INTERVAL_SECONDS) {
            return true;
        }

        $ttl = $this->ttl(($meta[2] ?? '0') === '1');
        $userKey = $this->userKeyFor($meta[0]);

        $this->redis()->transaction(function (Redis $redis) use ($sessionId, $userKey, $now, $ttl): void {
            $redis->hSet($this->metaKey($sessionId), 'last_active_at', (string) $now);
            $redis->expire($this->metaKey($sessionId), $ttl);
            $redis->zAdd($userKey, $now, $sessionId);
            $redis->expire($userKey, $ttl);
        });

        return true;
    }

    /**
     * Destroys the sessions in the handler and forgets them.
     *
     * @param  list<string>  $ids
     * @return int how many the handler still had
     */
    private function revoke(User $user, array $ids): int
    {
        $open = 0;

        foreach ($ids as $id) {
            if ($this->handler()->read($id) !== '') {
                $open++;
            }

            $this->handler()->destroy($id);
        }

        $this->forget($user, $ids);

        return $open;
    }

    /** @param  list<string>  $ids */
    private function forget(User $user, array $ids): void
    {
        if ($ids === []) {
            return;
        }

        $this->redis()->transaction(function (Redis $redis) use ($user, $ids): void {
            foreach ($ids as $id) {
                $redis->del($this->metaKey($id));
                $redis->zRem($this->userKey($user), $id);
            }
        });
    }

    /** A remember cookie of a revoked device must not sign the user in again. */
    private function rotateRememberToken(User $user): void
    {
        $user->setRememberToken(Str::random(self::REMEMBER_TOKEN_LENGTH));
        $user->save();
    }

    /** @return list<string> */
    private function sessionIds(User $user): array
    {
        $ids = $this->redis()->zrevrange($this->userKey($user), 0, -1);

        return array_map(strval(...), array_values($ids));
    }

    private function ttl(bool $remembered): int
    {
        return (int) config('session.lifetime') * 60 + ($remembered ? self::REMEMBERED_EXTRA_SECONDS : 0);
    }

    private function userKey(User $user): string
    {
        return $this->userKeyFor((string) $user->getKey());
    }

    private function userKeyFor(string $userId): string
    {
        return 'sess:user:'.$userId;
    }

    private function metaKey(string $sessionId): string
    {
        return 'sess:meta:'.$sessionId;
    }

    private function handler(): SessionHandlerInterface
    {
        return $this->sessions->driver()->getHandler();
    }

    /** The registry uses phpredis' MULTI and pipelines, which is the client of every environment (`REDIS_CLIENT`). */
    private function redis(): PhpRedisConnection
    {
        $connection = RedisFacade::connection('sessions');

        if (! $connection instanceof PhpRedisConnection) {
            throw new LogicException('The session registry needs the phpredis client.');
        }

        return $connection;
    }
}
