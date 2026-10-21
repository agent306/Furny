<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Support\Auth\RecentAuthentication;
use Illuminate\Http\Request;
use Illuminate\Session\ArraySessionHandler;
use Illuminate\Session\Store;

/** Session stamps (`auth.login_at`, `auth.password_confirmed_at`) as the app stores them: unix timestamps. */
final class SessionStamp
{
    public static function hoursAgo(int $hours): int
    {
        return now()->subHours($hours)->getTimestamp();
    }

    public static function minutesAgo(int $minutes): int
    {
        return now()->subMinutes($minutes)->getTimestamp();
    }

    /** @return array<string, int> */
    public static function loginHoursAgo(int $hours): array
    {
        return [RecentAuthentication::LOGIN_KEY => self::hoursAgo($hours)];
    }

    /**
     * A request with a started in-memory session holding `$data`.
     *
     * @param  array<string, mixed>  $data
     */
    public static function requestWith(array $data): Request
    {
        $request = Request::create('/');
        $session = new Store('test', new ArraySessionHandler(120));
        $session->put($data);
        $request->setLaravelSession($session);

        return $request;
    }
}
