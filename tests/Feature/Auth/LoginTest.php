<?php

declare(strict_types=1);

use App\Domain\Identity\Models\User;
use App\Support\Auth\RecentAuthentication;
use App\Support\Auth\SessionKey;
use App\Support\Auth\SessionRegistry;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Inertia\Testing\AssertableInertia as Assert;
use Spatie\Activitylog\Models\Activity;
use Symfony\Component\HttpFoundation\Cookie;
use Tests\Support\InertiaRequest;
use Tests\Support\SessionStamp;

const LOGIN_FIREFOX = 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0';

beforeEach(function (): void {
    $this->customer = User::factory()->create(['email' => 'asha@example.com']);
    $this->staff = User::factory()->estimator()->create(['email' => 'ravi@example.com']);
    // Where the visitor comes from, and which browser they use.
    $this->from = fn (string $ip = '203.0.113.45') => $this
        ->withServerVariables(['REMOTE_ADDR' => $ip])
        ->withHeader('User-Agent', LOGIN_FIREFOX);
    $this->login = fn (string $email, string $password = 'password', array $extra = []) => $this->post(
        route('login.store'),
        ['email' => $email, 'password' => $password, ...$extra],
    );
});

afterEach(function (): void {
    $redis = Redis::connection('sessions');

    foreach (User::withTrashed()->get() as $user) {
        $key = 'sess:user:'.$user->getKey();

        foreach ($redis->zrange($key, 0, -1) as $id) {
            $redis->del('sess:meta:'.$id, 'sess:revoked:'.$id);
        }

        $redis->del($key);
    }
});

/** The recaller cookie of a response, or null. */
function recallerOf(TestResponse $response): ?Cookie
{
    $name = Auth::guard('web')->getRecallerName();

    return collect($response->headers->getCookies())->first(fn ($cookie): bool => $cookie->getName() === $name);
}

/** The recaller cookie value of `$user`, as the guard writes it. */
function recallerValue(User $user): string
{
    return $user->getKey().'|'.$user->getRememberToken().'|'.Auth::guard('web')->hashPasswordForCookie($user->getAuthPassword());
}

describe('where a login leads', function (): void {
    it('sends a customer to the customer dashboard', function (): void {
        ($this->login)('asha@example.com')->assertRedirect(route('customer.dashboard'));

        $this->assertAuthenticatedAs($this->customer);
    });

    it('sends staff to the admin dashboard', function (): void {
        ($this->login)('ravi@example.com')->assertRedirect(route('admin.dashboard'));

        $this->assertAuthenticatedAs($this->staff);
    });

    it('asks an Inertia visit to load the destination as a full page', function (): void {
        $this->withHeaders(InertiaRequest::headers())
            ->post(route('login.store'), ['email' => 'asha@example.com', 'password' => 'password'])
            ->assertStatus(409)
            ->assertHeader('X-Inertia-Location', route('customer.dashboard'));
    });

    it('answers a JSON client without a redirect', function (): void {
        $this->postJson(route('login.store'), ['email' => 'asha@example.com', 'password' => 'password'])
            ->assertOk()
            ->assertExactJson(['two_factor' => false]);
    });

    it('honours an intended page of this site', function (string|Closure $intended, string $expected): void {
        $this->withSession(['url.intended' => $intended instanceof Closure ? $intended() : $intended]);

        ($this->login)('asha@example.com')->assertRedirect(url($expected));
    })->with([
        'relative path' => ['/projects', '/projects'],
        'relative path with a query' => ['/projects?tab=open', '/projects?tab=open'],
        'absolute URL of this site' => [fn (): string => url('/projects/42'), '/projects/42'],
        'absolute URL with a query' => [fn (): string => url('/projects/42?x=1'), '/projects/42?x=1'],
        'absolute URL with a double slash path' => [fn (): string => url('/').'//projects', '/projects'],
    ]);

    it('ignores an intended page that is not on this site', function (string $intended): void {
        $this->withSession(['url.intended' => $intended]);

        ($this->login)('asha@example.com')->assertRedirect(route('customer.dashboard'));
    })->with([
        'another host' => 'https://evil.test/x',
        'our host on another port' => 'http://localhost:9999/x',
        'our host over another scheme' => 'https://localhost:8000/x',
        'a host that starts like ours' => 'http://localhost.evil.test/x',
        'userinfo that looks like our host' => 'http://localhost@evil.test/x',
        'protocol-relative' => '//evil.test/x',
        'backslashes' => '/\\evil.test/x',
        'a tab inside the slashes' => "/\t/evil.test",
        'javascript' => 'javascript:alert(1)',
        'data' => 'data:text/html,hi',
        'a path without the leading slash' => 'projects',
        'another scheme on our host' => 'ftp://localhost/x',
    ]);

    it('uses an intended page once', function (): void {
        $this->withSession(['url.intended' => '/projects']);
        ($this->login)('asha@example.com')->assertRedirect(url('/projects'));

        expect(session()->has('url.intended'))->toBeFalse();
    });
});

describe('who is let in', function (): void {
    it('logs in with the email in any case and with spaces around it', function (): void {
        ($this->login)('  ASHA@Example.com ')->assertRedirect(route('customer.dashboard'));

        $this->assertAuthenticatedAs($this->customer);
    });

    it('refuses a wrong password with the generic message', function (): void {
        ($this->login)('asha@example.com', 'wrong')->assertSessionHasErrors(['email' => __('auth.failed')]);

        $this->assertGuest();
    });

    it('refuses an unknown email with the same message', function (): void {
        ($this->login)('nobody@example.com')->assertSessionHasErrors(['email' => __('auth.failed')]);

        $this->assertGuest();
    });

    it('refuses an email that is not text', function (): void {
        $this->postJson(route('login.store'), ['email' => ['asha@example.com'], 'password' => 'password'])
            ->assertStatus(422)
            ->assertJsonValidationErrors('email');
    });

    it('refuses a user without a password', function (): void {
        User::factory()->passwordless()->create(['email' => 'nopass@example.com']);

        ($this->login)('nopass@example.com', 'anything')->assertSessionHasErrors(['email' => __('auth.failed')]);
        ($this->login)('nopass@example.com', '')->assertSessionHasErrors();
    });

    it('does not say that an inactive account is inactive until the password is right', function (): void {
        User::factory()->inactive()->create(['email' => 'gone@example.com']);

        ($this->login)('gone@example.com', 'wrong')->assertSessionHasErrors(['email' => __('auth.failed')]);
    });

    it('tells a correct password on an inactive account that it is inactive', function (): void {
        User::factory()->inactive()->create(['email' => 'gone@example.com']);

        ($this->login)('gone@example.com')->assertSessionHasErrors(['email' => __('auth.inactive')]);

        $this->assertGuest();
    });

    it('treats a soft-deleted user as unknown, whatever the password', function (): void {
        User::factory()->pendingDeletion()->create(['email' => 'deleted@example.com']);

        ($this->login)('deleted@example.com')->assertSessionHasErrors(['email' => __('auth.failed')]);

        $this->assertGuest();
    });
});

describe('the remember policy', function (): void {
    it('gives a customer who ticked the box a remember cookie of 14 days', function (): void {
        $cookie = recallerOf(($this->login)('asha@example.com', extra: ['remember' => 'on']));

        expect($cookie)->not->toBeNull()
            ->and($cookie->getExpiresTime())->toBeBetween(now()->addMinutes(20159)->getTimestamp(), now()->addMinutes(20161)->getTimestamp());
    });

    it('gives a customer who did not tick it no remember cookie', function (): void {
        expect(recallerOf(($this->login)('asha@example.com')))->toBeNull();
    });

    it('never gives staff a remember cookie', function (): void {
        $response = ($this->login)('ravi@example.com', extra: ['remember' => 'on'])->assertRedirect(route('admin.dashboard'));

        expect(recallerOf($response))->toBeNull()
            ->and(session('auth.remember'))->toBeFalse();
    });

    it('applies the policy to the email however it is written', function (): void {
        expect(recallerOf(($this->login)(' RAVI@example.com ', extra: ['remember' => 'on'])))->toBeNull();
    });

    it('carries "no remember" through the two-factor challenge for staff', function (): void {
        $owner = User::factory()->owner()->create(['email' => 'owner@example.com']);

        ($this->login)('owner@example.com', extra: ['remember' => 'on'])->assertRedirect(route('two-factor.login'));

        expect(session('login.id'))->toBe($owner->getKey())
            ->and(session('login.remember'))->toBeFalse();
        $this->assertGuest();
    });
});

describe('the challenge for staff with two-factor', function (): void {
    it('lets a recovery code in and leads to the admin dashboard', function (): void {
        $owner = User::factory()->owner()->create(['email' => 'owner@example.com']);
        $owner->forceFill(['two_factor_recovery_codes' => encrypt(json_encode(['aaaaaaaaaa-bbbbbbbbbb', 'cccccccccc-dddddddddd']))])->save();

        $this->withSession(['login.id' => $owner->getKey(), 'login.remember' => false, 'url.intended' => '/admin/orders'])
            ->post(route('two-factor.login.store'), ['recovery_code' => 'aaaaaaaaaa-bbbbbbbbbb'])
            ->assertRedirect(url('/admin/orders'));

        $this->assertAuthenticatedAs($owner);
        expect(session('auth.method'))->toBe('password')
            ->and(session('auth.login_at'))->toBeInt();
    });

    it('leads to the dashboard when nothing was intended', function (): void {
        $owner = User::factory()->owner()->create(['email' => 'owner@example.com']);
        $owner->forceFill(['two_factor_recovery_codes' => encrypt(json_encode(['aaaaaaaaaa-bbbbbbbbbb']))])->save();

        $this->withSession(['login.id' => $owner->getKey(), 'login.remember' => false])
            ->post(route('two-factor.login.store'), ['recovery_code' => 'aaaaaaaaaa-bbbbbbbbbb'])
            ->assertRedirect(route('admin.dashboard'));
    });
});

describe('the session', function (): void {
    it('gets a new id on login', function (): void {
        $before = Str::random(40);

        $this->withCookie((string) config('session.cookie'), $before);
        ($this->login)('asha@example.com')->assertRedirect();

        expect(session()->getId())->not->toBe($before)->toHaveLength(40);
    });

    it('is stamped with the login time, the method and the remember choice', function (): void {
        ($this->login)('asha@example.com', extra: ['remember' => 'on']);

        expect(session('auth.login_at'))->toBeInt()->toBeBetween(now()->subMinute()->getTimestamp(), now()->addMinute()->getTimestamp())
            ->and(session('auth.method'))->toBe('password')
            ->and(session('auth.remember'))->toBeTrue();

        ($this->login)('ravi@example.com');
    });

    it('counts as a recent authentication', function (): void {
        ($this->login)('asha@example.com');

        expect(RecentAuthentication::passes(SessionStamp::requestWith(session()->all())))->toBeTrue();
    });

    it('records the last login', function (): void {
        $this->customer->forceFill(['last_login_at' => null])->save();
        $updatedAt = $this->customer->fresh()->updated_at;
        $this->travel(2)->minutes();

        ($this->login)('asha@example.com');

        $fresh = $this->customer->fresh();

        expect($fresh->last_login_at)->not->toBeNull()
            ->and($fresh->last_login_at->diffInSeconds(now()))->toBeLessThan(5)
            ->and($fresh->updated_at->equalTo($updatedAt))->toBeTrue();
    });

    it('is registered once, under the key of the new session id, with the method and the remember choice', function (): void {
        $old = Str::random(40);
        $this->withCookie((string) config('session.cookie'), $old);

        ($this->from)()->post(route('login.store'), ['email' => 'asha@example.com', 'password' => 'password', 'remember' => 'on']);

        $new = session()->getId();
        $redis = Redis::connection('sessions');
        $entries = app(SessionRegistry::class)->list($this->customer, $new);

        expect($new)->not->toBe($old)
            ->and($redis->zcard('sess:user:'.$this->customer->getKey()))->toBe(1)
            ->and($entries)->toHaveCount(1)
            ->and($entries[0]->key)->toBe(SessionKey::for($new))
            ->and($entries[0]->isCurrent)->toBeTrue()
            ->and($entries[0]->method)->toBe('password')
            ->and($entries[0]->uaSummary)->toBe('Firefox on Linux')
            ->and($entries[0]->ipMasked)->toBe('203.0.113.0')
            ->and($redis->hget('sess:meta:'.$new, 'remembered'))->toBe('1')
            ->and($redis->exists('sess:meta:'.$old))->toBe(0);
    });

    it('is registered as not remembered when the box was not ticked, and for staff', function (string $email, array $extra): void {
        ($this->login)($email, extra: $extra);

        expect(Redis::connection('sessions')->hget('sess:meta:'.session()->getId(), 'remembered'))->toBe('0');
    })->with([
        'customer without the box' => ['asha@example.com', []],
        'staff with the box' => ['ravi@example.com', ['remember' => 'on']],
    ]);

    it('registers nothing for a failed login', function (): void {
        ($this->login)('asha@example.com', 'wrong');

        expect(Redis::connection('sessions')->zcard('sess:user:'.$this->customer->getKey()))->toBe(0);
    });
});

describe('the remember cookie', function (): void {
    it('signs the user in again, as "remember", without a recent authentication', function (): void {
        $this->customer->forceFill(['remember_token' => Str::random(60)])->save();

        ($this->from)()
            ->withCookie(Auth::guard('web')->getRecallerName(), recallerValue($this->customer->fresh()))
            ->get(route('customer.dashboard'))
            ->assertOk();

        $this->assertAuthenticatedAs($this->customer);

        $id = session()->getId();
        $audit = Activity::query()->where('event', 'auth.login')->sole();
        $meta = Redis::connection('sessions')->hgetall('sess:meta:'.$id);

        expect(session('auth.method'))->toBe('remember')
            ->and(session()->has('auth.login_at'))->toBeFalse()
            ->and($audit->properties['method'])->toBe('remember')
            ->and($meta['method'])->toBe('remember')
            ->and($meta['remembered'])->toBe('1')
            ->and($this->customer->fresh()->last_login_at)->not->toBeNull();
    });
});

describe('the audit trail', function (): void {
    it('writes auth.login with the method and the masked IP and device', function (): void {
        ($this->from)()->post(route('login.store'), ['email' => 'asha@example.com', 'password' => 'password']);

        $activity = Activity::query()->where('event', 'auth.login')->sole();

        expect($activity->log_name)->toBe('security')
            ->and($activity->subject_id)->toBe($this->customer->getKey())
            ->and($activity->causer_id)->toBe($this->customer->getKey())
            ->and($activity->properties->all())->toBe([
                'method' => 'password',
                'ip' => '203.0.113.0',
                'ua' => 'Firefox on Linux',
            ]);
    });

    it('writes auth.login_failed without a causer, with the email and IP masked and nothing else', function (): void {
        ($this->from)()->post(route('login.store'), ['email' => '  Asha@Example.com ', 'password' => 'my-secret-guess']);

        $activity = Activity::query()->where('event', 'auth.login_failed')->sole();

        expect($activity->log_name)->toBe('security')
            ->and($activity->causer_id)->toBeNull()
            ->and($activity->subject_id)->toBeNull()
            ->and($activity->properties->all())->toBe(['email' => 'a**a@e******.com', 'ip' => '203.0.113.0'])
            ->and(json_encode($activity->properties))->not->toContain('my-secret-guess')->not->toContain('asha@example.com');
    });

    it('writes auth.login_failed for an unknown email as well', function (): void {
        ($this->from)()->post(route('login.store'), ['email' => 'nobody@example.com', 'password' => 'password']);

        expect(Activity::query()->where('event', 'auth.login_failed')->sole()->properties['email'])->toBe('n****y@e******.com');
    });

    it('writes no login entry when the password is right but the account is inactive', function (): void {
        User::factory()->inactive()->create(['email' => 'gone@example.com']);

        ($this->login)('gone@example.com');

        expect(Activity::query()->where('event', 'like', 'auth.login%')->count())->toBe(0);
    });
});

describe('logging out', function (): void {
    it('writes auth.logout, takes the session out of the registry and clears the browser history', function (): void {
        ($this->from)()->post(route('login.store'), ['email' => 'asha@example.com', 'password' => 'password']);

        $id = session()->getId();
        $key = 'sess:user:'.$this->customer->getKey();

        expect(Redis::connection('sessions')->zcard($key))->toBe(1);

        $this->withCookie((string) config('session.cookie'), $id)
            ->post(route('logout'))
            ->assertRedirect('/');

        $activity = Activity::query()->where('event', 'auth.logout')->sole();

        expect(Redis::connection('sessions')->zcard($key))->toBe(0)
            ->and(Redis::connection('sessions')->exists('sess:meta:'.$id))->toBe(0)
            ->and(app(SessionRegistry::class)->list($this->customer, null))->toBe([])
            ->and($activity->log_name)->toBe('security')
            ->and($activity->subject_id)->toBe($this->customer->getKey())
            ->and($activity->causer_id)->toBe($this->customer->getKey())
            ->and(session()->getId())->not->toBe($id)
            ->and(session('inertia.clear_history'))->toBeTrue();

        $this->assertGuest();
    });

    it('answers a JSON client with 204', function (): void {
        $this->actingAs($this->customer)->postJson(route('logout'))->assertNoContent();
    });

    it('keeps the other sessions of the user', function (): void {
        ($this->from)()->post(route('login.store'), ['email' => 'asha@example.com', 'password' => 'password']);
        $first = session()->getId();
        Auth::forgetGuards();
        $this->app['session']->driver()->flush();

        ($this->from)('198.51.100.7')->post(route('login.store'), ['email' => 'asha@example.com', 'password' => 'password']);
        $second = session()->getId();

        $this->withCookie((string) config('session.cookie'), $second)->post(route('logout'));

        $left = app(SessionRegistry::class)->list($this->customer, null);

        expect($first)->not->toBe($second)
            ->and($left)->toHaveCount(1)
            ->and($left[0]->key)->toBe(SessionKey::for($first));
    });
});

describe('throttling', function (): void {
    it('throttles the 6th attempt within a minute for the same email and IP, and logs the lockout', function (): void {
        Log::spy();

        foreach (range(1, 5) as $_) {
            ($this->from)()->postJson(route('login.store'), ['email' => 'asha@example.com', 'password' => 'wrong'])->assertStatus(422);
        }

        ($this->from)()->postJson(route('login.store'), ['email' => ' Asha@example.com', 'password' => 'wrong'])
            ->assertStatus(429)
            ->assertJsonPath('code', 'rate_limited')
            ->assertHeader('Retry-After');

        Log::shouldHaveReceived('warning')->with('auth.lockout', ['email' => 'a**a@e******.com', 'ip' => '203.0.113.0'])->once();
    });

    it('does not throttle the same email from another address, nor another email from the same one', function (): void {
        foreach (range(1, 5) as $_) {
            ($this->from)()->postJson(route('login.store'), ['email' => 'asha@example.com', 'password' => 'wrong']);
        }

        ($this->from)('198.51.100.9')->postJson(route('login.store'), ['email' => 'asha@example.com', 'password' => 'wrong'])->assertStatus(422);
        ($this->from)()->postJson(route('login.store'), ['email' => 'ravi@example.com', 'password' => 'wrong'])->assertStatus(422);
    });
});

describe('the login page', function (): void {
    it('renders Auth/Login with the props of every auth page', function (): void {
        $this->get(route('login'))
            ->assertOk()
            ->assertInertia(fn (Assert $page) => $page
                ->component('Auth/Login')
                ->where('canRegister', true)
                ->where('canResetPassword', true)
                ->where('turnstileSiteKey', null)
                ->where('features.captcha', false)
                ->where('features.google_login', true)
                ->where('status', null));
    });

    it('sends the public Turnstile key, and only it, while the captcha is on', function (): void {
        config(['services.turnstile.site_key' => '1x00000000000000000000AA', 'services.turnstile.secret_key' => 'secret-value']);

        $this->get(route('login'))
            ->assertInertia(fn (Assert $page) => $page->where('turnstileSiteKey', '1x00000000000000000000AA')->where('features.captcha', true))
            ->assertDontSee('secret-value');
    });

    it('keeps a signed-in user away from the page', function (): void {
        $this->actingAs($this->customer)->get(route('login'))->assertRedirect();
    });
});
