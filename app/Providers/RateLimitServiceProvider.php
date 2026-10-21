<?php

declare(strict_types=1);

namespace App\Providers;

use App\Support\Http\RateLimitKey;
use Illuminate\Auth\Events\Lockout;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Exceptions\ThrottleRequestsException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use InvalidArgumentException;

/**
 * Registers the named limiters of 13 §10 from `config('security.rate_limits')`, including the `login` and
 * `two-factor` limiters Fortify applies through `config('fortify.limiters')`.
 */
final class RateLimitServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        foreach (array_keys((array) config('security.rate_limits')) as $name) {
            RateLimiter::for($name, fn (Request $request): array => $this->limits($request, (string) $name));
        }
    }

    /** @return list<Limit> */
    private function limits(Request $request, string $name): array
    {
        $limits = [];

        /** @var array{per: string, max: int, key: string, guest?: array{max: int, key: string}} $spec */
        foreach ((array) config("security.rate_limits.{$name}") as $spec) {
            if (isset($spec['guest']) && $request->user() === null) {
                $spec = [...$spec, ...$spec['guest']];
            }

            // Every limit gets its own counter: two limits of one limiter may count the same thing
            // (per minute and per day by user) and must not share a hit count.
            $limit = $this->limit($spec['per'], $spec['max'])->by($spec['per'].'|'.RateLimitKey::resolve($request, $spec['key']));

            $limits[] = $name === 'login' ? $limit->response($this->lockout(...)) : $limit;
        }

        return $limits;
    }

    /**
     * Fortify fires `Lockout` only from its own throttle step, which a named `login` limiter replaces (13 §2), so
     * the limiter fires it when it refuses a sign-in. The response is the same 429 the `throttle` middleware gives.
     *
     * @param  array<string, mixed>  $headers
     */
    private function lockout(Request $request, array $headers): never
    {
        event(new Lockout($request));

        throw new ThrottleRequestsException('Too Many Attempts.', headers: $headers);
    }

    private function limit(string $per, int $max): Limit
    {
        return match (true) {
            $per === 'minute' => Limit::perMinute($max),
            $per === 'hour' => Limit::perHour($max),
            $per === 'day' => Limit::perDay($max),
            str_starts_with($per, 'seconds:') => new Limit('', $max, (int) substr($per, 8)),
            str_starts_with($per, 'minutes:') => Limit::perMinutes((int) substr($per, 8), $max),
            default => throw new InvalidArgumentException("Unknown rate limit window [{$per}]."),
        };
    }
}
