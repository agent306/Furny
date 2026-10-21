<?php

declare(strict_types=1);

use App\Domain\Identity\Models\OtpCode;
use App\Domain\Identity\Otp\OtpLimits;
use App\Support\Settings\Groups\AuthSettings;
use Carbon\CarbonImmutable;
use Illuminate\Cache\RateLimiter;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Str;
use Symfony\Component\Process\PhpExecutableFinder;
use Symfony\Component\Process\Process;

/*
|--------------------------------------------------------------------------
| Parallel requests (13 §4.2, §4.3)
|--------------------------------------------------------------------------
|
| Each request is its own PHP process against the real Postgres test database and the real Redis cache (database 15
| in the test environment), started at the same instant. What the test process does in its own transaction is not
| visible to them, so what they write is committed and removed again by a separate connection.
*/

const OTP_FROZEN_AT = '2026-10-21 12:20:00';

beforeEach(function (): void {
    try {
        Redis::connection('cache')->ping();
    } catch (Throwable) {
        $this->markTestSkipped('Redis is not reachable.');
    }

    // The clock is pinned mid-hour, here and in the workers, so that the per-hour global counter has one key.
    $this->travelTo(CarbonImmutable::parse(OTP_FROZEN_AT, 'UTC'));

    // Migrate the test database (lazily) before the other processes use it.
    OtpCode::query()->count();

    // A connection of its own: the test's connection sits in a transaction that is rolled back and that the
    // workers cannot see into.
    $this->committed = DB::connectUsing('otp_parallel', config('database.connections.'.config('database.default')));
    $this->started = now()->subSecond();
    $this->phones = new ArrayObject;

    // Cache keys of this test only: a prefix of its own, which the workers get too, and which is all that is deleted.
    $this->prefix = 'otp-test-'.bin2hex(random_bytes(6));
    $this->cache = Cache::build(['driver' => 'redis', 'connection' => 'cache', 'prefix' => $this->prefix]);
    $this->limiter = new RateLimiter($this->cache);
});

afterEach(function (): void {
    $this->committed->table('otp_codes')->whereIn('phone_e164', $this->phones->getArrayCopy())->delete();
    $this->committed->table('activity_log')->where('created_at', '>=', $this->started)->whereIn('event', ['auth.otp_sent', 'auth.otp_locked'])->delete();
    $this->committed->disconnect();

    $redis = Redis::connection('cache');
    $client = (string) config('database.redis.options.prefix');

    // `keys` answers with the client's own prefix on the keys; `del` adds it again.
    foreach ($redis->keys($this->prefix.'*') as $key) {
        $redis->del(str_starts_with($key, $client) ? substr($key, strlen($client)) : $key);
    }
});

/** A live code for a number, committed so that the workers see it. */
function otpCommit(string $e164, string $code): string
{
    $id = (string) Str::ulid();
    test()->phones[] = $e164;
    test()->committed->table('otp_codes')->insert([
        'id' => $id,
        'phone_e164' => $e164,
        'purpose' => 'login',
        'channel' => 'sms',
        'code_hash' => Hash::make($code),
        'attempts' => 0,
        'expires_at' => now()->addMinutes(10),
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    return $id;
}

/**
 * Starts the workers together and returns what each printed.
 *
 * @param  list<list<string>>  $jobs  arguments after the mode: [mode, ...args]
 * @return list<array{result: string, delivered: int}>
 */
function otpParallel(array $jobs): array
{
    $prefix = test()->prefix;
    $connection = config('database.connections.'.config('database.default'));
    $start = microtime(true) + 2.5 + 0.15 * count($jobs);

    $processes = array_map(fn (array $job): Process => new Process(
        [(new PhpExecutableFinder)->find(), base_path('tests/Support/otp-worker.php'), $job[0], (string) $start, ...array_slice($job, 1)],
        base_path(),
        [
            'APP_ENV' => 'testing',
            'CACHE_STORE' => 'redis',
            'CACHE_PREFIX' => $prefix,
            'OTP_WORKER_NOW' => OTP_FROZEN_AT,
            'REDIS_CACHE_DB' => (string) config('database.redis.cache.database'),
            'DB_CONNECTION' => (string) config('database.default'),
            'DB_HOST' => (string) $connection['host'],
            'DB_PORT' => (string) $connection['port'],
            'DB_DATABASE' => (string) $connection['database'],
            'DB_USERNAME' => (string) $connection['username'],
            'DB_PASSWORD' => (string) $connection['password'],
            'BCRYPT_ROUNDS' => '10',
            'FEATURE_SMS' => 'true',
            'FEATURE_WHATSAPP' => 'true',
            'TURNSTILE_SITE_KEY' => '',
            'TURNSTILE_SECRET_KEY' => '',
        ],
        timeout: 60,
    ), $jobs);

    foreach ($processes as $process) {
        $process->start();
    }

    return array_map(function (Process $process): array {
        $process->wait();

        $line = trim($process->getOutput());
        expect($line)->not->toBe('', $process->getErrorOutput());

        return json_decode($line, true, flags: JSON_THROW_ON_ERROR);
    }, $processes);
}

/** @param  list<array{result: string, delivered: int}>  $results */
function otpTally(array $results): array
{
    $tally = array_count_values(array_column($results, 'result'));
    ksort($tally);

    return $tally;
}

describe('sends', function (): void {
    it('delivers exactly one code when ten requests send to one number at once, and refuses the other nine with the cooldown', function (): void {
        $phone = '98765 43'.random_int(100, 999);
        $this->phones[] = '+91'.str_replace(' ', '', $phone);

        $results = otpParallel(array_map(fn (int $n): array => ['send', $phone, '203.0.113.'.$n], range(1, 10)));

        expect(otpTally($results))->toEqual(['otp_cooldown' => 9, 'ok' => 1])
            ->and(array_sum(array_column($results, 'delivered')))->toBe(1)
            ->and(OtpCode::query()->where('phone_e164', $this->phones[0])->count())->toBe(1);
    });

    it('never goes past the ten sends an hour of one IP when fifteen requests for fifteen numbers arrive at once', function (): void {
        $base = random_int(100, 800);
        $phones = array_map(fn (int $n): string => '98765 4'.str_pad((string) ($base + $n), 4, '0', STR_PAD_LEFT), range(1, 15));
        foreach ($phones as $phone) {
            $this->phones[] = '+91'.str_replace(' ', '', $phone);
        }

        $results = otpParallel(array_map(fn (string $phone): array => ['send', $phone, '203.0.113.77'], $phones));

        $tally = otpTally($results);

        expect($tally['ok'])->toBe(10)
            ->and($tally['otp_rate_limited'])->toBe(5)
            ->and(array_sum(array_column($results, 'delivered')))->toBe(10)
            ->and(OtpCode::query()->whereIn('phone_e164', $this->phones->getArrayCopy())->count())->toBe(10);

        // The refused sends gave their count back: the IP has used ten, not fifteen.
        expect((int) $this->limiter->attempts(OtpLimits::key(OtpLimits::SEND, 'ip', $this->phones[0], '203.0.113.77')))->toBe(10);
    });

    it('never goes past the global hourly cap when requests from many IPs arrive at once', function (): void {
        // Settings live in the test transaction, which the workers cannot see: they use the default cap, so the
        // counter is put three places below it.
        $this->cache->put(OtpLimits::globalKey(), AuthSettings::defaults()->otpGlobalHourlyCap - 3, 7200);

        $base = random_int(100, 800);
        $phones = array_map(fn (int $n): string => '98765 6'.str_pad((string) ($base + $n), 4, '0', STR_PAD_LEFT), range(1, 8));
        foreach ($phones as $phone) {
            $this->phones[] = '+91'.str_replace(' ', '', $phone);
        }

        $results = otpParallel(array_map(fn (string $phone, int $n): array => ['send', $phone, '203.0.113.'.(100 + $n)], $phones, array_keys($phones)));

        // SMS is the only channel: three places were left under the cap.
        expect(otpTally($results))->toEqual(['ok' => 3, 'otp_unavailable' => 5])
            ->and(array_sum(array_column($results, 'delivered')))->toBe(3);
    });
});

describe('the verify limiters (13 section 4.3 step 1)', function (): void {
    // Laravel's `RateLimiter::hit` creates a window with `add` and then `increment`, and when the increment answers 1
    // for a window that already existed it puts 1 back. Parallel requests that open a window together can therefore
    // lose one count, once per window, however the limit is checked. The windows are opened here with one try, so that
    // what is tested is that the count that comes back is compared, not that creating a window is race-free.
    it('lets ten of fifteen requests from one IP through, counting first and then comparing', function (): void {
        // Fifteen numbers with no live code: each request that passes the limiter ends as `otp_expired`.
        $base = random_int(100, 800);
        $phones = array_map(fn (int $n): string => '+9198770'.str_pad((string) ($base + $n), 5, '0', STR_PAD_LEFT), range(1, 15));
        $this->limiter->hit(OtpLimits::key(OtpLimits::VERIFY, 'ip', $phones[0], '203.0.113.88'), 60);

        $results = otpParallel(array_map(fn (string $phone): array => ['verify', $phone, '203.0.113.88', '123456'], $phones));

        // The one try that opened the window used one of the ten.
        expect(otpTally($results))->toEqual(['otp_expired' => 9, 'throttled' => 6]);
    });

    it('lets twenty of twenty-five requests for one number through, from as many addresses', function (): void {
        $phone = '+91987719'.random_int(1000, 9999);
        $this->limiter->hit(OtpLimits::key(OtpLimits::VERIFY, 'phone', $phone, null), 3600);

        $results = otpParallel(array_map(fn (int $n): array => ['verify', $phone, '203.0.113.'.(100 + $n), '123456'], range(1, 25)));

        // The one try that opened the window used one of the twenty.
        expect(otpTally($results))->toEqual(['otp_expired' => 19, 'throttled' => 6]);
    });
});

describe('verifications', function (): void {
    it('consumes a code once when five requests carry the right code at once', function (): void {
        $phone = '+91987650'.random_int(1000, 9999);
        $id = otpCommit($phone, '123456');

        $results = otpParallel(array_map(fn (int $n): array => ['verify', $phone, '203.0.113.'.$n, '123456'], range(1, 5)));

        expect(otpTally($results))->toEqual(['ok' => 1, 'otp_expired' => 4])
            ->and($this->committed->table('otp_codes')->where('id', $id)->value('consumed_at'))->not->toBeNull();
    });

    it('never lets a code take more than five wrong attempts when twelve requests guess at once', function (): void {
        $phone = '+91987651'.random_int(1000, 9999);
        $id = otpCommit($phone, '123456');

        $results = otpParallel(array_map(fn (int $n): array => ['verify', $phone, '203.0.113.'.$n, '654321'], range(1, 12)));

        $row = $this->committed->table('otp_codes')->where('id', $id)->first();

        expect(otpTally($results)['otp_invalid'])->toBe(5)
            ->and($row->attempts)->toBe(5)
            ->and($row->consumed_at)->toBeNull()
            ->and(array_diff(array_keys(otpTally($results)), ['otp_invalid', 'otp_too_many_attempts', 'otp_expired']))->toBe([]);
    });
});
