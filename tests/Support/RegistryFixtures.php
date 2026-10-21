<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Domain\Identity\Models\User;
use App\Support\Auth\SessionRegistry;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Facades\Session;
use Illuminate\Support\Str;

/** Sessions that are open in the session handler and in the registry, for tests of automatic revocation. */
final class RegistryFixtures
{
    /** @var list<string> */
    private static array $ids = [];

    /** Opens a session for `$user` and returns its id. */
    public static function open(User $user): string
    {
        $id = Str::random(40);
        self::$ids[] = $id;
        Session::getHandler()->write($id, '[]');
        app(SessionRegistry::class)->register($user, $id, Request::create('/'), 'password', false);

        return $id;
    }

    /** Whether the session handler still holds the session. */
    public static function alive(string $id): bool
    {
        return Session::getHandler()->read($id) !== '';
    }

    /** Removes the registry keys of the users and of every session opened here (also those their requests made). */
    public static function clean(User ...$users): void
    {
        $redis = Redis::connection('sessions');

        foreach ($users as $user) {
            $key = 'sess:user:'.$user->getKey();

            foreach ($redis->zrange($key, 0, -1) as $id) {
                $redis->del('sess:meta:'.$id, 'sess:revoked:'.$id);
            }

            $redis->del($key);
        }

        foreach (self::$ids as $id) {
            $redis->del('sess:meta:'.$id, 'sess:revoked:'.$id);
        }

        self::$ids = [];
    }
}
