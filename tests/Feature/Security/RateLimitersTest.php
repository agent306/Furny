<?php

declare(strict_types=1);

use App\Domain\Identity\Models\User;
use App\Http\Middleware\HandleInertiaRequests;
use Illuminate\Auth\GenericUser;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Route;

const LIMIT_MINUTE = 60;
const LIMIT_HOUR = 3600;
const LIMIT_DAY = 86400;

/**
 * 13 §10, written out independently of config/security.php: [decay seconds, max attempts] per limit, in order.
 *
 * @return array<string, list<array{int, int}>>
 */
function documentedLimits(): array
{
    return [
        'login' => [[LIMIT_MINUTE, 5], [LIMIT_MINUTE, 30]],
        'two-factor' => [[LIMIT_MINUTE, 5]],
        'register' => [[LIMIT_HOUR, 5]],
        'password-reset' => [[LIMIT_HOUR, 3], [LIMIT_HOUR, 10]],
        'verification-resend' => [[600, 3]],
        'otp-send' => [[LIMIT_HOUR, 5], [LIMIT_HOUR, 10]],
        'otp-cooldown' => [[60, 1]],
        'otp-verify' => [[LIMIT_MINUTE, 10], [LIMIT_HOUR, 20]],
        'oauth' => [[LIMIT_MINUTE, 20]],
        'uploads-presign' => [[LIMIT_MINUTE, 30], [LIMIT_DAY, 300]],
        'uploads-confirm' => [[LIMIT_MINUTE, 60]],
        'imports-start' => [[LIMIT_HOUR, 10]],
        'ai-provider-test' => [[LIMIT_MINUTE, 10]],
        'thumbnails' => [[LIMIT_MINUTE, 6]],
        'test-push' => [[LIMIT_MINUTE, 3]],
        'messages-post' => [[LIMIT_MINUTE, 20], [LIMIT_DAY, 300]],
        'autosave' => [[LIMIT_MINUTE, 60]],
        'api' => [[LIMIT_MINUTE, 120]],
        'exports' => [[LIMIT_HOUR, 20]],
        'data-export' => [[LIMIT_DAY, 3]],
        'invitations' => [[LIMIT_DAY, 20]],
        'broadcasting-auth' => [[LIMIT_MINUTE, 120]],
        'webhooks' => [[LIMIT_MINUTE, 600]],
        'client-errors' => [[LIMIT_MINUTE, 10]],
        'csp-report' => [[LIMIT_MINUTE, 30]],
    ];
}

/**
 * @param  array<string, mixed>  $input
 */
function limiterRequest(string $name, ?GenericUser $user = null, array $input = [], string $ip = '203.0.113.9', ?string $loginId = null): Request
{
    $request = Request::create('/_probe/'.$name, 'POST', $input, server: ['REMOTE_ADDR' => $ip]);
    $request->setUserResolver(fn () => $user);

    $session = app('session')->driver();

    if ($loginId !== null) {
        $session->put('login.id', $loginId);
    }

    $request->setLaravelSession($session);

    return $request;
}

/** @return list<Limit> */
function limitsFor(string $name, ?Request $request = null): array
{
    $limiter = RateLimiter::limiter($name);

    return array_values(Arr::wrap($limiter($request ?? limiterRequest($name, new GenericUser(['id' => '01HZ0000000000000000000001'])))));
}

/** @return array<string, string> */
function inertiaHeaders(): array
{
    return ['X-Inertia' => 'true', 'X-Inertia-Version' => (string) app(HandleInertiaRequests::class)->version(request())];
}

it('registers exactly the 25 named limiters of 13 §10', function (): void {
    expect(array_keys(documentedLimits()))->toHaveCount(25)
        ->and(array_keys(config('security.rate_limits')))->toEqualCanonicalizing(array_keys(documentedLimits()));
});

it('registers limiter :name with the documented limits', function (string $name): void {
    expect(RateLimiter::limiter($name))->not->toBeNull();

    $actual = array_map(fn (Limit $limit) => [$limit->decaySeconds, $limit->maxAttempts], limitsFor($name));

    expect($actual)->toBe(documentedLimits()[$name]);
})->with(array_keys(documentedLimits()));

it('keys every limit of a limiter apart, so a per-day count never shares a counter with a per-minute one', function (string $name): void {
    $keys = array_map(fn (Limit $limit) => $limit->key, limitsFor($name));

    expect(array_unique($keys))->toHaveCount(count($keys));
})->with(array_keys(documentedLimits()));

it('keys no limit by raw PII', function (): void {
    $request = limiterRequest('login', null, ['email' => 'Asha.K@Example.com', 'phone' => '+919876543210']);

    foreach (['login', 'password-reset', 'otp-send', 'otp-cooldown', 'otp-verify'] as $name) {
        foreach (limitsFor($name, $request) as $limit) {
            expect($limit->key)->not->toContain('@')->not->toContain('asha')->not->toContain('9876543210');
        }
    }
});

describe('api: 120/min per user, 60/min per IP for guests', function (): void {
    it('limits a signed-in user by id', function (): void {
        $limits = limitsFor('api', limiterRequest('api', new GenericUser(['id' => 'U1'])));

        expect($limits)->toHaveCount(1)
            ->and([$limits[0]->maxAttempts, $limits[0]->decaySeconds])->toBe([120, LIMIT_MINUTE])
            ->and($limits[0]->key)->toContain('U1');
    });

    it('limits a guest by IP at half the rate', function (): void {
        $limits = limitsFor('api', limiterRequest('api', null, ip: '198.51.100.4'));

        expect($limits)->toHaveCount(1)
            ->and([$limits[0]->maxAttempts, $limits[0]->decaySeconds])->toBe([60, LIMIT_MINUTE])
            ->and($limits[0]->key)->toContain('198.51.100.4');
    });
});

describe('keys are normalised so variants cannot bypass a limit', function (): void {
    it('lower-cases and trims emails', function (string $name): void {
        $a = limitsFor($name, limiterRequest($name, null, ['email' => 'Asha.K@Example.COM']));
        $b = limitsFor($name, limiterRequest($name, null, ['email' => '  asha.k@example.com ']));

        expect(array_map(fn (Limit $l) => $l->key, $a))->toBe(array_map(fn (Limit $l) => $l->key, $b));
    })->with(['login', 'password-reset']);

    it('keeps different emails apart', function (): void {
        $a = limitsFor('login', limiterRequest('login', null, ['email' => 'a@example.com']));
        $b = limitsFor('login', limiterRequest('login', null, ['email' => 'b@example.com']));

        expect($a[0]->key)->not->toBe($b[0]->key)
            ->and($a[1]->key)->toBe($b[1]->key);
    });

    it('counts an empty or unparseable :name identifier per IP instead of in one shared bucket', function (string $name, mixed $value, string $field): void {
        $limits = limitsFor($name, limiterRequest($name, null, [$field => $value], ip: '198.51.100.4'));
        $other = limitsFor($name, limiterRequest($name, null, [$field => $value], ip: '198.51.100.5'));

        foreach ($limits as $index => $limit) {
            expect($limit->key)->toContain('198.51.100.4')->and($limit->key)->not->toBe($other[$index]->key);
        }
    })->with([
        'login, array' => ['login', ['x@example.com'], 'email'],
        'login, missing' => ['login', null, 'email'],
        'login, number' => ['login', 123, 'email'],
        'login, blank' => ['login', '   ', 'email'],
        'login, not an email' => ['login', 'not-an-email', 'email'],
        'password-reset, not an email' => ['password-reset', 'a b c', 'email'],
        'otp-send, missing' => ['otp-send', null, 'phone'],
        'otp-send, letters' => ['otp-send', 'call me', 'phone'],
        'otp-cooldown, array' => ['otp-cooldown', ['+919876543210'], 'phone'],
        'otp-verify, punctuation' => ['otp-verify', '+-() ', 'phone'],
    ]);

    it('keeps real email addresses and phones apart from the guest bucket', function (): void {
        $email = limitsFor('password-reset', limiterRequest('password-reset', null, ['email' => 'a@example.com'], ip: '198.51.100.4'));
        $phone = limitsFor('otp-cooldown', limiterRequest('otp-cooldown', null, ['phone' => '+919876543210'], ip: '198.51.100.4'));

        expect($email[0]->key)->not->toContain('guest:')->and($phone[0]->key)->not->toContain('guest:');
    });

    it('uses one key for every address of an IPv6 /64 and keeps IPv4 exact', function (): void {
        $key = fn (string $ip) => limitsFor('oauth', limiterRequest('oauth', null, ip: $ip))[0]->key;

        expect($key('2001:db8:abcd:12::1'))->toBe($key('2001:db8:abcd:12:ffff:ffff:ffff:ffff'))
            ->and($key('2001:db8:abcd:12::1'))->not->toBe($key('2001:db8:abcd:13::1'))
            ->and($key('203.0.113.9'))->toContain('203.0.113.9')->not->toBe($key('203.0.113.10'));
    });

    it('applies the /64 to the login limiter\'s IP part as well', function (): void {
        $keys = fn (string $ip) => array_map(
            fn (Limit $l) => $l->key,
            limitsFor('login', limiterRequest('login', null, ['email' => 'a@example.com'], ip: $ip)),
        );

        expect($keys('2001:db8::1'))->toBe($keys('2001:db8::2'));
    });

    it('reduces phone numbers to E.164', function (string $name): void {
        $variants = ['+919876543210', '+91 98765 43210', '+91-98765-43210', '098765 43210', '(+91) 98765 43210', ' 9876543210 '];
        $keys = array_map(
            fn (string $phone) => array_map(fn (Limit $l) => $l->key, limitsFor($name, limiterRequest($name, null, ['phone' => $phone]))),
            $variants,
        );

        expect(array_unique($keys, SORT_REGULAR))->toHaveCount(1);
    })->with(['otp-send', 'otp-cooldown', 'otp-verify']);

    it('separates different phones', function (): void {
        $a = limitsFor('otp-cooldown', limiterRequest('otp-cooldown', null, ['phone' => '+919876543210']));
        $b = limitsFor('otp-cooldown', limiterRequest('otp-cooldown', null, ['phone' => '+919876543211']));

        expect($a[0]->key)->not->toBe($b[0]->key);
    });

    it('keys two-factor by the login id in the session', function (): void {
        $a = limitsFor('two-factor', limiterRequest('two-factor', null, loginId: '17'));
        $b = limitsFor('two-factor', limiterRequest('two-factor', null, loginId: '18'));

        expect($a[0]->key)->not->toBe($b[0]->key);
    });

    it('keys autosave by user and document', function (): void {
        $user = new GenericUser(['id' => 'U1']);

        $make = function (string $plan) use ($user): Limit {
            $request = Request::create("/api/plans/{$plan}/working-copy", 'PUT', server: ['REMOTE_ADDR' => '203.0.113.9']);
            $request->setUserResolver(fn () => $user);
            $route = new Illuminate\Routing\Route('PUT', 'api/plans/{plan}/working-copy', fn () => null);
            $route->name('api.plans.working-copy.update')->bind($request);
            $request->setRouteResolver(fn () => $route);

            return limitsFor('autosave', $request)[0];
        };

        expect($make('P1')->key)->toBe($make('P1')->key)
            ->and($make('P1')->key)->not->toBe($make('P2')->key);
    });
});

describe('Fortify keeps working with the limiters', function (): void {
    it('logs a user in', function (): void {
        $user = User::factory()->create(['email' => 'asha@example.com']);

        $this->post('/login', ['email' => 'asha@example.com', 'password' => 'password'])->assertRedirect();

        $this->assertAuthenticatedAs($user);
    });

    it('throttles the 6th login attempt however the email is cased', function (): void {
        User::factory()->create(['email' => 'asha@example.com']);
        $variants = ['asha@example.com', 'ASHA@example.com', 'Asha@Example.com', ' asha@example.com', 'aSHA@EXAMPLE.COM'];

        foreach ($variants as $email) {
            $this->postJson('/login', ['email' => $email, 'password' => 'wrong'])->assertStatus(422);
        }

        $this->postJson('/login', ['email' => 'AshA@example.COM', 'password' => 'wrong'])
            ->assertStatus(429)
            ->assertHeader('Retry-After')
            ->assertJsonPath('code', 'rate_limited');

        // Even the right password is refused while throttled, and nobody is signed in.
        $this->postJson('/login', ['email' => 'asha@example.com', 'password' => 'password'])->assertStatus(429);
        $this->assertGuest();

        // Another address is unaffected.
        $this->postJson('/login', ['email' => 'other@example.com', 'password' => 'wrong'])->assertStatus(422);
    });

    it('throttles the two-factor challenge per login id', function (): void {
        foreach (range(1, 5) as $_) {
            expect($this->withSession(['login.id' => 'u-1'])->postJson('/two-factor-challenge', ['code' => '000000'])->status())->not->toBe(429);
        }

        $this->withSession(['login.id' => 'u-1'])->postJson('/two-factor-challenge', ['code' => '000000'])
            ->assertStatus(429)
            ->assertJsonPath('code', 'rate_limited');

        expect($this->withSession(['login.id' => 'u-2'])->postJson('/two-factor-challenge', ['code' => '000000'])->status())->not->toBe(429);
    });

    it('defines the Fortify limiters in RateLimitServiceProvider, not in FortifyServiceProvider', function (): void {
        expect(file_get_contents(app_path('Providers/FortifyServiceProvider.php')))->not->toContain('RateLimiter::for')
            ->and(config('fortify.limiters'))->toBe(['login' => 'login', 'two-factor' => 'two-factor']);
    });
});

describe('429 rendering', function (): void {
    beforeEach(function (): void {
        RateLimiter::for('probe', fn () => Limit::perMinute(1)->by('probe'));
        Route::middleware(['web', 'throttle:probe'])->match(['GET', 'POST'], '/_throttled', fn () => response('ok'));
    });

    it('answers JSON requests with the code, the wait and a Retry-After header', function (): void {
        $this->postJson('/_throttled')->assertOk();

        $response = $this->postJson('/_throttled')->assertStatus(429)->assertJsonPath('code', 'rate_limited');

        expect($response->json('retryAfter'))->toBeInt()->toBeGreaterThan(0)->toBeLessThanOrEqual(60)
            ->and((int) $response->headers->get('Retry-After'))->toBe($response->json('retryAfter'));
    });

    it('answers XHR requests the same way', function (): void {
        $this->post('/_throttled')->assertOk();

        $this->post('/_throttled', [], ['X-Requested-With' => 'XMLHttpRequest', 'Accept' => '*/*'])->assertStatus(429)->assertJsonPath('code', 'rate_limited');
    });

    it('redirects an Inertia request back with the Inertia flash error', function (): void {
        $this->post('/_throttled')->assertOk();

        $this->withHeaders(inertiaHeaders() + ['Referer' => url('/')])
            ->post('/_throttled')
            ->assertStatus(302)
            ->assertRedirect(url('/'));

        // The next Inertia visit carries it as the top-level flash, once; the shared props have no flash.
        $page = $this->withHeaders(inertiaHeaders())->get('/')->assertOk();

        expect($page->json('flash.error'))->toMatch('/^Too many attempts\. Try again in \d+ seconds?\.$/')
            ->and($page->json('props'))->not->toHaveKey('flash')
            ->and($this->withHeaders(inertiaHeaders())->get('/')->json())->not->toHaveKey('flash');
    });

    it('does not put the flash in the session under a plain key', function (): void {
        $this->post('/_throttled')->assertOk();

        $this->withHeaders(inertiaHeaders() + ['Referer' => url('/')])->post('/_throttled')->assertSessionMissing('error');
    });

    it('renders the Error page for a throttled browser navigation', function (): void {
        $this->get('/_throttled')->assertOk();

        $this->get('/_throttled')->assertStatus(429)->assertHeader('Retry-After')->assertInertia(fn ($page) => $page->component('Error')->where('status', 429));
    });
});
