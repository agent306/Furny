<?php

declare(strict_types=1);

use App\Domain\Identity\Enums\LengthUnit;
use App\Domain\Identity\Enums\UnitSystem;
use App\Domain\Identity\Enums\UserType;
use App\Domain\Identity\Events\ContactVerified;
use App\Domain\Identity\Events\CustomerRegistered;
use App\Domain\Identity\Models\StaffInvitation;
use App\Domain\Identity\Models\User;
use App\Http\Requests\Account\UnlinkGoogleRequest;
use App\Listeners\ApplyPendingGoogleLink;
use App\Listeners\RecordSuccessfulLogin;
use App\Support\Auth\RecentAuthentication;
use App\Support\Auth\SessionRegistry;
use App\Support\Settings\Settings;
use App\Support\Settings\SettingsGroup;
use Illuminate\Cookie\CookieValuePrefix;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Inertia\Inertia;
use Laravel\Socialite\Contracts\Provider;
use Laravel\Socialite\Facades\Socialite;
use Laravel\Socialite\Two\GoogleProvider;
use Laravel\Socialite\Two\InvalidStateException;
use Laravel\Socialite\Two\User as SocialiteUser;
use Spatie\Activitylog\Models\Activity;
use Symfony\Component\HttpFoundation\Cookie;
use Tests\Support\InertiaRequest;
use Tests\Support\RegistryFixtures;

/** What Google tells about the person who signed in; `email_verified` is the claim the callback relies on. */
function googleProfile(string $id = '1000000000000000001', string $email = 'asha@example.com', ?string $name = 'Asha Kapoor', mixed $emailVerified = true): SocialiteUser
{
    $profile = new SocialiteUser;
    $profile->map(['id' => $id, 'nickname' => null, 'name' => $name, 'email' => $email, 'avatar' => 'https://lh3.googleusercontent.com/a/x']);
    $profile->setRaw(['sub' => $id, 'email' => $email, 'name' => $name, 'email_verified' => $emailVerified]);

    return $profile;
}

/**
 * Socialite's Google driver answers the callback with `$result`: the profile, or the exception it throws.
 * `$whenAsked` runs at the moment the callback asks Google, before the sign-in.
 */
function googleAnswers(SocialiteUser|Throwable $result, ?Closure $whenAsked = null): void
{
    $provider = Mockery::mock(GoogleProvider::class);
    $expectation = $provider->shouldReceive('user');

    if ($result instanceof Throwable) {
        $expectation->andThrow($result);
    } else {
        $expectation->andReturnUsing(static function () use ($result, $whenAsked): SocialiteUser {
            if ($whenAsked !== null) {
                $whenAsked();
            }

            return $result;
        });
    }

    Socialite::shouldReceive('driver')->with('google')->andReturn($provider);
}

/** The callback is never allowed to ask Google anything. */
function googleIsNotAsked(): void
{
    Socialite::shouldReceive('driver')->never();
}

function googleRecaller(TestResponse $response): ?Cookie
{
    $name = Auth::guard('web')->getRecallerName();

    return collect($response->headers->getCookies())->first(fn ($cookie): bool => $cookie->getName() === $name);
}

/** Whether the session registry lists the session (its meta exists and it is in the user's set). */
function googleSessionIsRegistered(string $sessionId): bool
{
    return (bool) Redis::connection('sessions')->exists('sess:meta:'.$sessionId);
}

function allowGoogleRegistration(bool $open): void
{
    $settings = app(Settings::class);
    $auth = $settings->auth();
    $auth->allowCustomerRegistration = $open;
    $settings->put(SettingsGroup::Auth, $auth);
}

beforeEach(function (): void {
    config(['features.google_login' => true]);

    // The callback of a round trip `$as` started (a signed-in user), or a guest's.
    $this->callback = function (string $intent = 'login', array $session = [], string $query = '', ?User $as = null) {
        $test = $as === null ? $this : $this->actingAs($as);

        return $test->withSession(['oauth.intent' => $intent, 'oauth.user' => $as?->getKey(), ...$session])
            ->get(route('auth.google.callback').$query);
    };
    // The flash of the page the visitor lands on.
    $this->flashOf = fn (string $route = 'login'): ?string => $this->get(route($route), InertiaRequest::headers())->json('flash.error');
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

describe('the redirect to Google', function (): void {
    it('keeps the intent in the session and sends the visitor to Google with the right scopes and prompt', function (): void {
        $provider = Mockery::mock(GoogleProvider::class);
        $provider->shouldReceive('scopes')->once()->with(['openid', 'profile', 'email'])->andReturnSelf();
        $provider->shouldReceive('with')->once()->with(['prompt' => 'select_account'])->andReturnSelf();
        $provider->shouldReceive('redirect')->once()->andReturn(redirect('https://accounts.google.com/o/oauth2/auth'));
        Socialite::shouldReceive('driver')->once()->with('google')->andReturn($provider);

        $this->get(route('auth.google.redirect', ['intent' => 'login']))
            ->assertRedirect('https://accounts.google.com/o/oauth2/auth')
            ->assertSessionHas('oauth.intent', 'login');
    });

    it('is the stateful flow: the real driver puts its state in the session and asks for select_account', function (): void {
        config(['services.google' => ['client_id' => 'client-id', 'client_secret' => 'secret', 'redirect' => 'http://localhost/auth/google/callback']]);

        $response = $this->get(route('auth.google.redirect', ['intent' => 'login']))->assertRedirectContains('https://accounts.google.com/');
        parse_str((string) parse_url((string) $response->headers->get('Location'), PHP_URL_QUERY), $query);

        expect($query['prompt'])->toBe('select_account')
            ->and($query['scope'])->toBe('openid profile email')
            ->and($query['state'])->toBe(session('state'))->not->toBeEmpty();
    });

    it('does not start with a driver that cannot do OAuth 2', function (): void {
        $this->withoutExceptionHandling();
        Socialite::shouldReceive('driver')->with('google')->andReturn(Mockery::mock(Provider::class));

        expect(fn () => $this->get(route('auth.google.redirect', ['intent' => 'login'])))->toThrow(LogicException::class);
    });

    it('is a 404 while features.google_login is off', function (): void {
        config(['features.google_login' => false]);
        googleIsNotAsked();

        $this->get(route('auth.google.redirect', ['intent' => 'login']))->assertNotFound();
        $this->get(route('auth.google.callback'))->assertNotFound();
    });

    it('needs a known intent', function (string $intent): void {
        googleIsNotAsked();

        $this->get(route('auth.google.redirect', $intent === '' ? [] : ['intent' => $intent]))->assertSessionHasErrors('intent');
        expect(session('oauth.intent'))->toBeNull();
    })->with(['missing' => '', 'unknown' => 'admin']);

    it('sends a signed-in user who asks to log in on to their dashboard', function (): void {
        googleIsNotAsked();

        $this->actingAs(User::factory()->create())
            ->get(route('auth.google.redirect', ['intent' => 'login']))
            ->assertRedirect(route('customer.dashboard'));
    });

    it('sends a guest who asks to link or to re-authenticate to login', function (string $intent): void {
        googleIsNotAsked();

        $this->get(route('auth.google.redirect', ['intent' => $intent]))->assertRedirect(route('login'));
        expect(session('oauth.intent'))->toBeNull();
    })->with(['link', 'reauthenticate']);

    it('remembers who started a link or a re-authentication', function (string $intent): void {
        $provider = Mockery::mock(GoogleProvider::class);
        $provider->shouldReceive('scopes')->andReturnSelf();
        $provider->shouldReceive('with')->andReturnSelf();
        $provider->shouldReceive('redirect')->andReturn(redirect('https://accounts.google.com/o/oauth2/auth'));
        Socialite::shouldReceive('driver')->andReturn($provider);
        $user = User::factory()->create();

        $this->actingAs($user)->get(route('auth.google.redirect', ['intent' => $intent]))->assertRedirect('https://accounts.google.com/o/oauth2/auth');

        expect(session('oauth.intent'))->toBe($intent)->and(session('oauth.user'))->toBe($user->getKey());
    })->with(['link', 'reauthenticate']);

    it('is throttled by the oauth limiter, 20 a minute', function (): void {
        googleIsNotAsked();

        for ($i = 0; $i < 20; $i++) {
            $this->get(route('auth.google.redirect'))->assertStatus(302);
        }

        $this->get(route('auth.google.redirect'))->assertStatus(429);
    });
});

describe('a callback that cannot be used', function (): void {
    it('sends someone who cancelled at Google back to login', function (): void {
        googleIsNotAsked();

        ($this->callback)(query: '?error=access_denied')->assertRedirect(route('login'));

        expect(($this->flashOf)())->toBe(trans_icu('auth.errors.oauth_cancelled'))->not->toBe('auth.errors.oauth_cancelled');
        $this->assertGuest();
    });

    it('treats a cancel without any session the same way', function (): void {
        googleIsNotAsked();

        $this->get(route('auth.google.callback', ['error' => 'access_denied']))->assertRedirect(route('login'));

        expect(($this->flashOf)())->toBe(trans_icu('auth.errors.oauth_cancelled'));
    });

    it('rejects a state that does not match', function (): void {
        googleAnswers(new InvalidStateException);

        ($this->callback)()->assertRedirect(route('login'));

        expect(($this->flashOf)())->toBe(trans_icu('auth.errors.oauth_state_invalid'));
        $this->assertGuest();
    });

    it('rejects a state that does not match the one Socialite keeps in the session (the real driver)', function (): void {
        config(['services.google' => ['client_id' => 'client-id', 'client_secret' => 'secret', 'redirect' => 'http://localhost/auth/google/callback']]);

        $this->withSession(['oauth.intent' => 'login', 'oauth.user' => null, 'state' => 'the-state-we-sent'])
            ->get(route('auth.google.callback', ['code' => 'a-code', 'state' => 'a-forged-state']))
            ->assertRedirect(route('login'));

        expect(($this->flashOf)())->toBe(trans_icu('auth.errors.oauth_state_invalid'));
        $this->assertGuest();
    });

    it('logs any other failure as a warning and says it failed', function (): void {
        Log::spy();
        googleAnswers(new RuntimeException('Google was unreachable'));

        ($this->callback)()->assertRedirect(route('login'));

        Log::shouldHaveReceived('warning')->once()->with('auth.google_failed', Mockery::on(fn (array $context): bool => $context['exception'] === RuntimeException::class));
        expect(($this->flashOf)())->toBe(trans_icu('auth.errors.oauth_failed'));
        $this->assertGuest();
    });

    it('refuses an address Google has not verified', function (mixed $claim): void {
        googleAnswers(googleProfile(emailVerified: $claim));

        ($this->callback)()->assertRedirect(route('login'));

        expect(($this->flashOf)())->toBe(trans_icu('auth.errors.google_email_unverified'));
        $this->assertGuest();
        expect(User::query()->count())->toBe(0);
    })->with(['false' => false, 'the string "true"' => 'true', 'absent' => null]);

    it('refuses an unverified address for every intent, whatever the round trip would have done', function (string $intent): void {
        $user = User::factory()->googleLinked()->create(['email' => 'asha@example.com']);
        $invitation = StaffInvitation::factory()->pending()->create(['email' => 'new.hire@example.com']);
        $email = $intent === 'invitation' ? 'new.hire@example.com' : 'asha@example.com';
        $originalGoogleId = $user->google_id;
        $id = $intent === 'link' ? 'another-google-id' : $user->google_id;
        googleAnswers(googleProfile(id: $id, email: $email, emailVerified: false));
        $url = url('/staff/invitations/'.$invitation->id);

        $response = ($this->callback)($intent, $intent === 'invitation' ? ['invitation.id' => $invitation->id, 'invitation.url' => $url] : [], as: in_array($intent, ['link', 'reauthenticate'], true) ? $user : null);

        $response->assertRedirect(match ($intent) {
            'login' => route('login'),
            'invitation' => $url,
            default => route('customer.dashboard'),
        });
        $page = match ($intent) {
            'invitation' => $url,
            'login' => route('login'),
            default => route('customer.dashboard'),
        };
        expect($this->get($page, InertiaRequest::headers())->json('flash.error'))->toBe(trans_icu('auth.errors.google_email_unverified'))
            ->and(session('invitation.google'))->toBeNull()
            ->and(session(RecentAuthentication::CONFIRMED_KEY))->toBeNull()
            ->and($user->refresh()->google_id)->toBe($originalGoogleId);
        if ($intent !== 'link' && $intent !== 'reauthenticate') {
            $this->assertGuest();
        }
    })->with(['login', 'link', 'invitation', 'reauthenticate']);

    it('refuses a profile without an address', function (): void {
        googleAnswers(googleProfile(email: ''));

        ($this->callback)()->assertRedirect(route('login'));

        expect(($this->flashOf)())->toBe(trans_icu('auth.errors.google_email_unverified'));
    });

    it('refuses a callback that was not started by a redirect', function (): void {
        googleIsNotAsked();

        $this->get(route('auth.google.callback', ['code' => 'a-code', 'state' => 'x']))->assertRedirect(route('login'));

        expect(($this->flashOf)())->toBe(trans_icu('auth.errors.oauth_state_invalid'));
    });

    it('uses a round trip once', function (): void {
        googleAnswers(googleProfile());
        User::factory()->create(['email' => 'asha@example.com']);

        ($this->callback)()->assertRedirect(route('customer.dashboard'));
        expect(session('oauth.intent'))->toBeNull();

        Auth::forgetGuards();
        $this->flushSession();
        $this->get(route('auth.google.callback'))->assertRedirect(route('login'));
    });

    it('refuses an intent in the query that is not the one in the session', function (): void {
        googleIsNotAsked();

        ($this->callback)('login', query: '?intent=link')->assertRedirect(route('login'));

        expect(($this->flashOf)())->toBe(trans_icu('auth.errors.oauth_state_invalid'));
    });

    it('refuses an unknown intent in the session', function (): void {
        googleIsNotAsked();

        ($this->callback)('superuser')->assertRedirect(route('login'));

        expect(($this->flashOf)())->toBe(trans_icu('auth.errors.oauth_state_invalid'));
    });
});

describe('intent login', function (): void {
    it('signs in the user whose Google account it is, as a customer with the remember cookie', function (): void {
        $user = User::factory()->googleLinked()->create(['email' => 'someone.else@example.com']);
        googleAnswers(googleProfile(id: $user->google_id, email: 'asha@example.com'));

        $response = ($this->callback)()->assertRedirect(route('customer.dashboard'));

        $this->assertAuthenticatedAs($user);
        expect(googleRecaller($response))->not->toBeNull()
            ->and(session('auth.remember'))->toBeTrue()
            ->and(session('auth.method'))->toBe('google')
            ->and(session('auth.login_at'))->toBeInt()
            ->and($user->refresh()->last_login_at)->not->toBeNull();
        // Nothing about the user changed: not the address, and no new link.
        expect($user->email)->toBe('someone.else@example.com')
            ->and(Activity::query()->where('event', 'auth.google_linked')->count())->toBe(0);
    });

    it('records the login in the audit trail as a Google login', function (): void {
        $user = User::factory()->googleLinked()->create();
        googleAnswers(googleProfile(id: $user->google_id));

        ($this->callback)();

        $audit = Activity::query()->where('event', 'auth.login')->sole();
        expect($audit->properties['method'])->toBe('google')
            ->and($audit->causer_id)->toBe($user->getKey());
    });

    it('goes to the page the visitor was sent away from', function (): void {
        $user = User::factory()->googleLinked()->create();
        googleAnswers(googleProfile(id: $user->google_id));

        ($this->callback)(session: ['url.intended' => url('/projects/abc')])->assertRedirect(url('/projects/abc'));
    });

    it('gives the session a new id', function (): void {
        $user = User::factory()->googleLinked()->create();
        googleAnswers(googleProfile(id: $user->google_id), function () use (&$before): void {
            $before = session()->getId();
        });

        ($this->callback)()->assertRedirect();

        expect(session()->getId())->not->toBe($before)->toHaveLength(40);
        $this->assertAuthenticatedAs($user);
    });

    it('links Google to the account with that address, whatever its case, and verifies the address', function (): void {
        Event::fake([ContactVerified::class]);
        $user = User::factory()->unverified()->create(['email' => 'asha@example.com']);
        googleAnswers(googleProfile(id: '777', email: 'Asha@Example.com'));

        ($this->callback)()->assertRedirect(route('customer.dashboard'));

        $this->assertAuthenticatedAs($user);
        expect($user->refresh()->google_id)->toBe('777')
            ->and($user->email_verified_at)->not->toBeNull()
            ->and($user->email)->toBe('asha@example.com');
        Event::assertDispatchedTimes(ContactVerified::class, 1);

        $link = Activity::query()->where('event', 'auth.google_linked')->sole();
        expect($link->subject_id)->toBe($user->getKey())->and($link->causer_id)->toBe($user->getKey())
            ->and($link->log_name)->toBe('security')
            ->and($link->properties->all())->toBe(['replaced' => false, 'reason' => 'google_link_unverified']);
        expect(Activity::query()->where('event', 'auth.login')->sole()->properties['method'])->toBe('google');
    });

    it('keeps the time the address was verified at when it already was', function (): void {
        Event::fake([ContactVerified::class]);
        $user = User::factory()->create(['email' => 'asha@example.com', 'email_verified_at' => now()->subYear()]);
        googleAnswers(googleProfile(id: '777'));

        ($this->callback)();

        expect($user->refresh()->google_id)->toBe('777')
            ->and($user->email_verified_at->isBefore(now()->subMonth()))->toBeTrue();
        Event::assertNotDispatched(ContactVerified::class);
    });

    it('says in the audit when the link took the place of another Google account', function (): void {
        $user = User::factory()->create(['email' => 'asha@example.com', 'google_id' => 'the-old-google-id']);
        googleAnswers(googleProfile(id: 'the-new-google-id'));

        ($this->callback)()->assertRedirect(route('customer.dashboard'));

        expect($user->refresh()->google_id)->toBe('the-new-google-id')
            ->and(Activity::query()->where('event', 'auth.google_linked')->sole()->properties->all())->toBe(['replaced' => true]);
    });

    it('leaves the password, the sessions and the remember token of a verified account alone', function (): void {
        $user = User::factory()->create(['email' => 'asha@example.com']);
        $hash = $user->password;
        $token = $user->remember_token;
        $session = RegistryFixtures::open($user);
        googleAnswers(googleProfile(id: '777'));

        ($this->callback)()->assertRedirect(route('customer.dashboard'));

        expect($user->refresh()->password)->toBe($hash)
            ->and($user->remember_token)->toBe($token)
            ->and(RegistryFixtures::alive($session))->toBeTrue()
            ->and(Activity::query()->where('event', 'auth.sessions_revoked')->count())->toBe(0);
    });

    describe('an address nobody verified (pre-hijacking)', function (): void {
        it('takes the account from whoever registered it first: no password, no sessions, a new remember token', function (): void {
            // The attacker registers the victim's address with a password of their own and never verifies it.
            $attacker = User::factory()->unverified()->create(['email' => 'victim@example.com']);
            $token = $attacker->remember_token;
            $sessions = [RegistryFixtures::open($attacker), RegistryFixtures::open($attacker)];
            googleAnswers(googleProfile(id: 'victim-google', email: 'victim@example.com'));

            // The victim signs in with Google and lands in the account.
            ($this->callback)()->assertRedirect(route('customer.dashboard'));
            $this->assertAuthenticatedAs($attacker);

            $account = $attacker->refresh();
            expect($account->google_id)->toBe('victim-google')
                ->and($account->email_verified_at)->not->toBeNull()
                ->and($account->password)->toBeNull()
                ->and($account->remember_token)->not->toBe($token)->toHaveLength(60)
                ->and(RegistryFixtures::alive($sessions[0]))->toBeFalse()
                ->and(RegistryFixtures::alive($sessions[1]))->toBeFalse();

            $revoked = Activity::query()->where('event', 'auth.sessions_revoked')->sole();
            expect($revoked->properties->all())->toBe(['count' => 2, 'reason' => 'google_link_unverified']);
            $linked = Activity::query()->where('event', 'auth.google_linked')->sole();
            expect($linked->properties->all())->toBe(['replaced' => false, 'reason' => 'google_link_unverified']);

            // The attacker's password does not work any more, and the old sessions are not signed in.
            Auth::forgetGuards();
            $this->flushSession();
            $this->post(route('login.store'), ['email' => 'victim@example.com', 'password' => 'password'])->assertSessionHasErrors();
            $this->assertGuest();
        });

        it('treats a staff account the same way', function (): void {
            $staff = User::factory()->support()->create(['email' => 'ravi@example.com', 'email_verified_at' => null]);
            $session = RegistryFixtures::open($staff);
            googleAnswers(googleProfile(id: '888', email: 'ravi@example.com'));

            ($this->callback)()->assertRedirect(route('admin.dashboard'));

            expect($staff->refresh()->password)->toBeNull()
                ->and($staff->google_id)->toBe('888')
                ->and(RegistryFixtures::alive($session))->toBeFalse();
        });

        it('also applies when a signed-in user links Google, and keeps the session in use', function (): void {
            $user = User::factory()->unverified()->create(['email' => 'asha@example.com']);
            $token = $user->remember_token;
            $other = RegistryFixtures::open($user);
            // The session in use is registered first, the way TrackSession registers it on the user's first
            // request: the link must leave it alone while it signs the other one out.
            $current = Str::random(40);
            $this->withCookie((string) config('session.cookie'), $current);
            $this->actingAs($user)->get(route('customer.dashboard'))->assertOk();
            expect(googleSessionIsRegistered($current))->toBeTrue();
            googleAnswers(googleProfile(id: '444', email: 'asha@example.com'));

            ($this->callback)('link', as: $user)->assertRedirect(route('customer.dashboard'));

            $this->assertAuthenticatedAs($user);
            expect($user->refresh()->google_id)->toBe('444')
                ->and($user->password)->toBeNull()
                ->and($user->remember_token)->not->toBe($token)
                ->and(RegistryFixtures::alive($other))->toBeFalse()
                ->and(googleSessionIsRegistered($other))->toBeFalse()
                // The session in use is still registered, and is not tombstoned.
                ->and(googleSessionIsRegistered($current))->toBeTrue()
                ->and(app(SessionRegistry::class)->isRevoked($current))->toBeFalse()
                ->and(Activity::query()->where('event', 'auth.sessions_revoked')->sole()->properties['reason'])->toBe('google_link_unverified')
                ->and(Activity::query()->where('event', 'auth.sessions_revoked')->sole()->properties['count'])->toBe(1)
                ->and(Activity::query()->where('event', 'auth.google_linked')->sole()->properties['reason'])->toBe('google_link_unverified');
            // The session in use goes on working.
            $this->get(route('customer.dashboard'))->assertSuccessful();
        });

        it('does not apply to a phone-only user who gets the address from Google', function (): void {
            $user = User::factory()->phoneOnly()->create();
            $other = RegistryFixtures::open($user);
            googleAnswers(googleProfile(id: '444', email: 'maya@example.com'));

            ($this->callback)('link', as: $user);

            expect($user->refresh()->email)->toBe('maya@example.com')
                ->and(RegistryFixtures::alive($other))->toBeTrue()
                ->and(Activity::query()->where('event', 'auth.google_linked')->sole()->properties->all())->toBe(['replaced' => false]);
        });
    });

    it('links staff by their address too, and signs them in without a remember cookie', function (): void {
        $staff = User::factory()->estimator()->create(['email' => 'ravi@example.com']);
        googleAnswers(googleProfile(id: '888', email: 'ravi@example.com'));

        $response = ($this->callback)()->assertRedirect(route('admin.dashboard'));

        $this->assertAuthenticatedAs($staff);
        expect($staff->refresh()->google_id)->toBe('888')
            ->and(googleRecaller($response))->toBeNull()
            ->and(session('auth.remember'))->toBeFalse();
    });

    it('does not let in an account that is scheduled for deletion', function (string $how): void {
        $user = User::factory()->pendingDeletion()->create(['email' => 'asha@example.com', 'google_id' => $how === 'id' ? '555' : null]);
        googleAnswers(googleProfile(id: '555'));

        ($this->callback)()->assertRedirect(route('login'));

        expect(($this->flashOf)())->toBe(trans_icu('auth.errors.account_pending_deletion'));
        $this->assertGuest();
        expect($user->refresh()->google_id)->toBe($how === 'id' ? '555' : null)
            ->and(User::withTrashed()->count())->toBe(1);
    })->with(['found by Google id' => 'id', 'found by address' => 'email']);

    it('does not let in a deactivated account', function (string $how): void {
        $user = User::factory()->inactive()->create(['email' => 'asha@example.com', 'google_id' => $how === 'id' ? '555' : null]);
        googleAnswers(googleProfile(id: '555'));

        ($this->callback)()->assertRedirect(route('login'));

        expect(($this->flashOf)())->toBe(trans_icu('auth.inactive'));
        $this->assertGuest();
        expect($user->refresh()->google_id)->toBe($how === 'id' ? '555' : null);
    })->with(['found by Google id' => 'id', 'found by address' => 'email']);

    it('does not make a customer of an address with a pending staff invitation', function (): void {
        StaffInvitation::factory()->pending()->create(['email' => 'new.hire@example.com']);
        googleAnswers(googleProfile(email: 'New.Hire@example.com'));

        ($this->callback)()->assertRedirect(route('login'));

        expect(($this->flashOf)())->toBe(trans_icu('auth.errors.pending_staff_invitation'));
        $this->assertGuest();
        expect(User::query()->where('email', 'new.hire@example.com')->exists())->toBeFalse();
    });

    it('does not make a customer of an address whose invitation expired but was not revoked', function (): void {
        StaffInvitation::factory()->expired()->create(['email' => 'new.hire@example.com']);
        googleAnswers(googleProfile(email: 'new.hire@example.com'));

        ($this->callback)()->assertRedirect(route('login'));

        expect(User::query()->where('email', 'new.hire@example.com')->exists())->toBeFalse();
    });

    it('registers a customer when the invitation was revoked', function (): void {
        StaffInvitation::factory()->revoked()->create(['email' => 'new.hire@example.com']);
        googleAnswers(googleProfile(email: 'new.hire@example.com'));

        ($this->callback)()->assertRedirect(route('customer.dashboard'));

        expect(User::query()->where('email', 'new.hire@example.com')->count())->toBe(1);
    });

    it('registers a new customer and signs them in', function (): void {
        Event::fake([CustomerRegistered::class, ContactVerified::class]);
        googleAnswers(googleProfile(id: '999', email: 'Maya@Example.com', name: 'Maya Rao'));

        $response = ($this->callback)()->assertRedirect(route('customer.dashboard'));

        $user = User::query()->where('email', 'maya@example.com')->sole();
        $this->assertAuthenticatedAs($user);
        $units = app(Settings::class)->units();
        expect($user->name)->toBe('Maya Rao')
            ->and($user->type)->toBe(UserType::Customer)
            ->and($user->google_id)->toBe('999')
            ->and($user->password)->toBeNull()
            ->and($user->email_verified_at)->not->toBeNull()
            ->and($user->first_contact_verified_at)->not->toBeNull()
            ->and($user->terms_accepted_at)->not->toBeNull()
            ->and($user->onboarded_at)->toBeNull()
            ->and($user->is_active)->toBeTrue()
            ->and($user->marketing_opt_in)->toBeFalse()
            ->and($user->timezone)->toBe(app(Settings::class)->business()->timezone)
            ->and($user->unit_system)->toBe(UnitSystem::from($units->defaultSystem))
            ->and($user->length_unit)->toBe(LengthUnit::from($units->defaultLengthUnit))
            ->and($user->locale)->toBe(config('app.locale'))
            ->and(googleRecaller($response))->not->toBeNull()
            ->and($user->getMedia('avatar'))->toHaveCount(0);
        Event::assertDispatchedTimes(CustomerRegistered::class, 1);
        Event::assertDispatched(CustomerRegistered::class, fn (CustomerRegistered $event): bool => $event->user->is($user));
        Event::assertDispatchedTimes(ContactVerified::class, 1);
        expect(Activity::query()->where('event', 'auth.login')->sole()->properties['method'])->toBe('google');
    });

    it('names a customer after the part of the address before the @ when Google gives no name', function (?string $name): void {
        googleAnswers(googleProfile(email: 'maya.rao@example.com', name: $name));

        ($this->callback)();

        expect(User::query()->where('email', 'maya.rao@example.com')->sole()->name)->toBe('maya.rao');
    })->with(['null' => null, 'empty' => '', 'blank' => '   ']);

    it('does not take a name with a web address in it', function (string $name): void {
        googleAnswers(googleProfile(email: 'maya.rao@example.com', name: $name));

        ($this->callback)();

        expect(User::query()->where('email', 'maya.rao@example.com')->sole()->name)->toBe('maya.rao');
    })->with(['a link' => 'Visit https://spam.example now', 'a www address' => 'WWW.spam.example', 'inside the name' => 'Maya www.spam.example']);

    it('cuts a name at 120 characters, not at 120 columns of width', function (): void {
        googleAnswers(googleProfile(name: str_repeat('山', 200)));

        ($this->callback)();

        expect(mb_strlen(User::query()->sole()->name))->toBe(120);
    });

    it('cuts a very long name at 120 characters', function (): void {
        googleAnswers(googleProfile(name: str_repeat('é', 200)));

        ($this->callback)();

        expect(mb_strlen(User::query()->sole()->name))->toBe(120);
    });

    it('does not register anyone while registration is closed', function (): void {
        allowGoogleRegistration(false);
        googleAnswers(googleProfile());

        ($this->callback)()->assertRedirect(route('login'));

        expect(($this->flashOf)())->toBe(trans_icu('auth.registration_closed'));
        $this->assertGuest();
        expect(User::query()->count())->toBe(0);
    });

    it('still signs in existing users while registration is closed', function (): void {
        allowGoogleRegistration(false);
        $user = User::factory()->googleLinked()->create();
        googleAnswers(googleProfile(id: $user->google_id));

        ($this->callback)()->assertRedirect(route('customer.dashboard'));

        $this->assertAuthenticatedAs($user);
    });

    it('sends a signed-in user on to their dashboard instead of signing in again', function (): void {
        $user = User::factory()->create();
        googleIsNotAsked();

        $this->actingAs($user)->withSession(['oauth.intent' => 'login', 'oauth.user' => null])
            ->get(route('auth.google.callback'))
            ->assertRedirect(route('customer.dashboard'));
    });

    it('sends a staff member without two-factor in, with no remember cookie', function (): void {
        $staff = User::factory()->support()->create(['email' => 'ravi@example.com', 'google_id' => '321']);
        googleAnswers(googleProfile(id: '321'));

        $response = ($this->callback)()->assertRedirect(route('admin.dashboard'));

        $this->assertAuthenticatedAs($staff);
        expect(googleRecaller($response))->toBeNull()
            ->and(session('auth.remember'))->toBeFalse();
    });

    it('hands staff with a confirmed second factor to the two-factor challenge, as Fortify does', function (): void {
        $owner = User::factory()->owner()->create(['email' => 'owner@example.com', 'google_id' => '321']);
        googleAnswers(googleProfile(id: '321', email: 'owner@example.com'), function () use (&$before): void {
            $before = session()->getId();
        });

        $response = ($this->callback)()->assertRedirect(route('two-factor.login'));

        $this->assertGuest();
        expect(session('login.id'))->toBe($owner->getKey())
            ->and(session('login.remember'))->toBeFalse()
            ->and(googleRecaller($response))->toBeNull()
            ->and(session()->getId())->not->toBe($before);
        expect(Activity::query()->where('event', 'auth.login')->count())->toBe(0);
    });

    it('is a Google login still after the two-factor challenge', function (): void {
        $owner = User::factory()->owner()->create(['email' => 'owner@example.com', 'google_id' => '321']);
        $owner->forceFill(['two_factor_recovery_codes' => encrypt(json_encode(['aaaaaaaaaa-bbbbbbbbbb']))])->save();
        googleAnswers(googleProfile(id: '321', email: 'owner@example.com'));
        ($this->callback)()->assertRedirect(route('two-factor.login'));

        $this->post(route('two-factor.login.store'), ['recovery_code' => 'aaaaaaaaaa-bbbbbbbbbb'])->assertRedirect(route('admin.dashboard'));

        $this->assertAuthenticatedAs($owner);
        expect(session('auth.method'))->toBe('google')
            ->and(Activity::query()->where('event', 'auth.login')->sole()->properties['method'])->toBe('google');
    });

    it('does not leave a password login of the same visitor labelled as Google', function (): void {
        $owner = User::factory()->owner()->create(['email' => 'owner@example.com', 'google_id' => '321']);
        googleAnswers(googleProfile(id: '321', email: 'owner@example.com'));
        ($this->callback)()->assertRedirect(route('two-factor.login'));
        $this->flushSession();
        Auth::forgetGuards();
        // The challenge was abandoned; the visitor logs in with a password in the same session.
        $customer = User::factory()->create(['email' => 'asha@example.com']);

        $this->withSession([RecordSuccessfulLogin::PENDING_METHOD_KEY => ['method' => 'google', 'user' => $owner->getKey()]])
            ->post(route('login.store'), ['email' => 'asha@example.com', 'password' => 'password'])
            ->assertRedirect(route('customer.dashboard'));

        $this->assertAuthenticatedAs($customer);
        expect(Activity::query()->where('event', 'auth.login')->sole()->properties['method'])->toBe('password');
    });

    it('does not give the pending method to somebody else who signs in in the same session', function (): void {
        $owner = User::factory()->owner()->create(['email' => 'owner@example.com']);

        // The owner's Google sign-in stopped at the two-factor challenge; a new customer registers in that session.
        $this->withSession([RecordSuccessfulLogin::PENDING_METHOD_KEY => ['method' => 'google', 'user' => $owner->getKey()]])
            ->post(route('register.store'), [
                'name' => 'Asha Kapoor', 'email' => 'asha@example.com', 'password' => 'a-long-enough-password',
                'password_confirmation' => 'a-long-enough-password', 'terms' => 'on',
            ])->assertRedirect();

        expect(Activity::query()->where('event', 'auth.login')->sole()->properties['method'])->toBe('password')
            ->and(session('auth.method'))->toBe('password')
            ->and(session()->has(RecordSuccessfulLogin::PENDING_METHOD_KEY))->toBeFalse();
    });

    it('does not give the pending method to a sign-in by the remember cookie', function (): void {
        $user = User::factory()->create(['remember_token' => Str::random(60)]);
        $recaller = $user->getKey().'|'.$user->remember_token.'|'.Auth::guard('web')->hashPasswordForCookie($user->getAuthPassword());

        $this->withCookie(Auth::guard('web')->getRecallerName(), $recaller)
            ->withSession([RecordSuccessfulLogin::PENDING_METHOD_KEY => ['method' => 'google', 'user' => $user->getKey()]])
            ->get(route('customer.dashboard'))
            ->assertOk();

        expect(session('auth.method'))->toBe('remember')
            ->and(Activity::query()->where('event', 'auth.login')->sole()->properties['method'])->toBe('remember');
    });

    it('can be used afterwards: a signed-in Google user has a working session', function (): void {
        $user = User::factory()->googleLinked()->passwordless()->create();
        googleAnswers(googleProfile(id: $user->google_id));

        ($this->callback)()->assertRedirect(route('customer.dashboard'));

        $this->get(route('customer.dashboard'))->assertSuccessful();
        $this->assertAuthenticatedAs($user);
    });

    it('survives the same person signing up twice at once', function (): void {
        // The address was taken between the lookup and the insert: the unique index says so.
        User::creating(static function (): never {
            throw new UniqueConstraintViolationException('pgsql', 'insert into "users"', [], new Exception);
        });
        googleAnswers(googleProfile(email: 'maya@example.com'));

        ($this->callback)()->assertRedirect(route('login'));

        expect(($this->flashOf)())->toBe(trans_icu('auth.errors.oauth_failed'));
        $this->assertGuest();
    });
});

describe('intent link', function (): void {
    it('links Google to the signed-in user and returns to the app with a toast', function (): void {
        $user = User::factory()->create(['email' => 'asha@example.com']);
        googleAnswers(googleProfile(id: '444', email: 'Asha@example.com'));

        ($this->callback)('link', as: $user)->assertRedirect(route('customer.dashboard'));

        expect($user->refresh()->google_id)->toBe('444');
        $audit = Activity::query()->where('event', 'auth.google_linked')->sole();
        expect($audit->subject_id)->toBe($user->getKey())->and($audit->causer_id)->toBe($user->getKey());
    });

    it('flashes the success toast', function (): void {
        $user = User::factory()->create(['email' => 'asha@example.com']);
        googleAnswers(googleProfile(id: '444'));

        $this->actingAs($user)->withSession(['oauth.intent' => 'link', 'oauth.user' => $user->getKey()])->get(route('auth.google.callback'));

        expect($this->get(route('customer.dashboard'), InertiaRequest::headers())->json('flash.success'))->toBe(trans_icu('account.toasts.google_linked'));
    });

    it('does nothing for a user who already has this Google account', function (): void {
        $user = User::factory()->create(['email' => 'asha@example.com', 'google_id' => '444']);
        googleAnswers(googleProfile(id: '444'));

        ($this->callback)('link', as: $user)->assertRedirect(route('customer.dashboard'));

        expect($user->refresh()->google_id)->toBe('444')
            ->and(Activity::query()->where('event', 'auth.google_linked')->count())->toBe(0);
    });

    it('refuses a Google account that belongs to another user', function (): void {
        User::factory()->create(['google_id' => '444']);
        $user = User::factory()->create(['email' => 'asha@example.com']);
        googleAnswers(googleProfile(id: '444'));

        ($this->callback)('link', as: $user)->assertRedirect(route('customer.dashboard'));

        expect($user->refresh()->google_id)->toBeNull()
            ->and(($this->flashOf)('customer.dashboard'))->toBe(trans_icu('auth.errors.google_in_use'));
    });

    it('refuses a Google account that belongs to a user scheduled for deletion', function (): void {
        User::factory()->pendingDeletion()->create(['google_id' => '444']);
        $user = User::factory()->create(['email' => 'asha@example.com']);
        googleAnswers(googleProfile(id: '444'));

        ($this->callback)('link', as: $user);

        expect($user->refresh()->google_id)->toBeNull()
            ->and(($this->flashOf)('customer.dashboard'))->toBe(trans_icu('auth.errors.google_in_use'));
    });

    it('refuses a Google address that is not the user\'s own', function (): void {
        $user = User::factory()->create(['email' => 'asha@example.com']);
        googleAnswers(googleProfile(id: '444', email: 'someone.else@example.com'));

        ($this->callback)('link', as: $user);

        expect($user->refresh()->google_id)->toBeNull()
            ->and($user->email)->toBe('asha@example.com')
            ->and(($this->flashOf)('customer.dashboard'))->toBe(trans_icu('auth.errors.google_email_mismatch'));
    });

    it('gives a phone-only user the verified address of their Google account', function (): void {
        Event::fake([ContactVerified::class]);
        $user = User::factory()->phoneOnly()->create();
        googleAnswers(googleProfile(id: '444', email: 'Maya@Example.com'));

        ($this->callback)('link', as: $user)->assertRedirect(route('customer.dashboard'));

        expect($user->refresh()->email)->toBe('maya@example.com')
            ->and($user->email_verified_at)->not->toBeNull()
            ->and($user->google_id)->toBe('444');
        // They had a verified phone already: this is not their first verified contact.
        Event::assertNotDispatched(ContactVerified::class);
    });

    it('does not give a phone-only user an address somebody else holds', function (string $holder): void {
        $user = User::factory()->phoneOnly()->create();
        User::factory()->{$holder}()->create(['email' => 'maya@example.com']);
        googleAnswers(googleProfile(id: '444', email: 'maya@example.com'));

        ($this->callback)('link', as: $user);

        expect($user->refresh()->email)->toBeNull()
            ->and($user->google_id)->toBeNull()
            ->and(($this->flashOf)('customer.dashboard'))->toBe(trans_icu('auth.errors.email_unavailable'));
    })->with(['an active user' => 'customer', 'a user scheduled for deletion' => 'pendingDeletion']);

    it('sends staff back to their dashboard', function (): void {
        $staff = User::factory()->support()->create(['email' => 'ravi@example.com']);
        googleAnswers(googleProfile(id: '444', email: 'ravi@example.com'));

        ($this->callback)('link', as: $staff)->assertRedirect(route('admin.dashboard'));

        expect($staff->refresh()->google_id)->toBe('444');
    });

    it('is not for somebody else than the user who started it', function (): void {
        $starter = User::factory()->create();
        $other = User::factory()->create(['email' => 'asha@example.com']);
        googleIsNotAsked();

        $this->actingAs($other)->withSession(['oauth.intent' => 'link', 'oauth.user' => $starter->getKey()])
            ->get(route('auth.google.callback'))
            ->assertRedirect(route('customer.dashboard'));

        expect($other->refresh()->google_id)->toBeNull()
            ->and($this->get(route('customer.dashboard'), InertiaRequest::headers())->json('flash.error'))->toBe(trans_icu('auth.errors.oauth_state_invalid'));
    });

    it('needs somebody signed in', function (): void {
        googleIsNotAsked();

        $this->withSession(['oauth.intent' => 'link', 'oauth.user' => '01HZZZZZZZZZZZZZZZZZZZZZZZ'])
            ->get(route('auth.google.callback'))
            ->assertRedirect(route('login'));
    });

    it('says why when Google cancelled, on the page the user came from', function (): void {
        $user = User::factory()->create();
        googleIsNotAsked();

        $this->actingAs($user)->withSession(['oauth.intent' => 'link', 'oauth.user' => $user->getKey()])
            ->get(route('auth.google.callback', ['error' => 'access_denied']))
            ->assertRedirect(route('customer.dashboard'));

        expect($this->get(route('customer.dashboard'), InertiaRequest::headers())->json('flash.error'))->toBe(trans_icu('auth.errors.oauth_cancelled'));
    });

    it('does not ask for a recent authentication', function (): void {
        $user = User::factory()->create(['email' => 'asha@example.com']);
        googleAnswers(googleProfile(id: '444'));

        $this->actingAs($user)->withSession([
            'oauth.intent' => 'link', 'oauth.user' => $user->getKey(), 'auth.login_at' => now()->subHours(5)->getTimestamp(),
        ])->get(route('auth.google.callback'))->assertRedirect(route('customer.dashboard'));

        expect($user->refresh()->google_id)->toBe('444');
    });
});

describe('intent invitation', function (): void {
    beforeEach(function (): void {
        $this->invitation = StaffInvitation::factory()->pending()->create(['email' => 'new.hire@example.com']);
        $this->invitationUrl = url('/staff/invitations/'.$this->invitation->id.'?signature=abc');
        $this->invited = ['invitation.id' => $this->invitation->id, 'invitation.url' => $this->invitationUrl];
    });

    it('needs the invitation in the session to start', function (): void {
        googleIsNotAsked();

        $this->get(route('auth.google.redirect', ['intent' => 'invitation']))->assertForbidden();

        expect(session('oauth.intent'))->toBeNull();
    });

    it('needs an invitation that can still be accepted', function (string $state): void {
        $invitation = StaffInvitation::factory()->{$state}()->create();
        googleIsNotAsked();

        $this->withSession(['invitation.id' => $invitation->id])
            ->get(route('auth.google.redirect', ['intent' => 'invitation']))
            ->assertForbidden();
    })->with(['accepted', 'revoked', 'expired']);

    it('is not for somebody who is signed in', function (): void {
        googleIsNotAsked();

        $this->actingAs(User::factory()->create())->withSession($this->invited)
            ->get(route('auth.google.redirect', ['intent' => 'invitation']))
            ->assertForbidden();
    });

    it('starts the round trip when the session holds the invitation', function (): void {
        $provider = Mockery::mock(GoogleProvider::class);
        $provider->shouldReceive('scopes')->andReturnSelf();
        $provider->shouldReceive('with')->andReturnSelf();
        $provider->shouldReceive('redirect')->andReturn(redirect('https://accounts.google.com/o/oauth2/auth'));
        Socialite::shouldReceive('driver')->andReturn($provider);

        $this->withSession($this->invited)
            ->get(route('auth.google.redirect', ['intent' => 'invitation']))
            ->assertRedirect('https://accounts.google.com/o/oauth2/auth')
            ->assertSessionHas('oauth.intent', 'invitation');
    });

    it('keeps the Google id and the name for the invitation page when the address is the invited one', function (): void {
        googleAnswers(googleProfile(id: '616', email: 'New.Hire@Example.com', name: ' Nina Hire '));

        ($this->callback)('invitation', $this->invited)->assertRedirect($this->invitationUrl);

        expect(session('invitation.google.'.$this->invitation->id))->toBe(['id' => '616', 'name' => 'Nina Hire']);
        $this->assertGuest();
        expect(User::query()->where('email', 'new.hire@example.com')->exists())->toBeFalse();
    });

    it('ties the Google choice to its invitation: another invitation does not get it', function (): void {
        $second = StaffInvitation::factory()->pending()->create(['email' => 'second.hire@example.com']);
        googleAnswers(googleProfile(id: '616', email: 'new.hire@example.com', name: 'Nina Hire'));

        ($this->callback)('invitation', $this->invited)->assertRedirect($this->invitationUrl);

        // The same browser opens the second invitation: what Google said about the first is not about this one.
        expect(session('invitation.google.'.$this->invitation->id))->toBe(['id' => '616', 'name' => 'Nina Hire'])
            ->and(session('invitation.google.'.$second->id))->toBeNull();
    });

    it('replaces the Google choice for one invitation with the choice for the next', function (): void {
        $second = StaffInvitation::factory()->pending()->create(['email' => 'second.hire@example.com']);
        googleAnswers(googleProfile(id: '717', email: 'second.hire@example.com', name: 'Sam Hire'));

        ($this->callback)('invitation', [
            'invitation.id' => $second->id,
            'invitation.url' => url('/staff/invitations/'.$second->id),
            'invitation.google' => [$this->invitation->id => ['id' => '616', 'name' => 'Nina Hire']],
        ])->assertRedirect(url('/staff/invitations/'.$second->id));

        expect(session('invitation.google'))->toBe([$second->id => ['id' => '717', 'name' => 'Sam Hire']]);
    });

    it('refuses another address and says so on the invitation page', function (): void {
        googleAnswers(googleProfile(id: '616', email: 'someone.else@example.com'));

        ($this->callback)('invitation', $this->invited)->assertRedirect($this->invitationUrl);

        expect(session('invitation.google'))->toBeNull();
        $this->assertGuest();
    });

    it('flashes the mismatch to the page it returns to', function (): void {
        googleAnswers(googleProfile(id: '616', email: 'someone.else@example.com'));
        Route::middleware('web')->get('/staff/invitations/{invitation}', static fn () => Inertia::render('Error', ['status' => 200]));

        ($this->callback)('invitation', $this->invited)->assertRedirect($this->invitationUrl);

        expect($this->get($this->invitationUrl, InertiaRequest::headers())->json('flash.error'))->toBe(trans_icu('auth.errors.google_email_mismatch'));
    });

    it('does not return to a URL of another site', function (): void {
        googleAnswers(googleProfile(id: '616', email: 'new.hire@example.com'));

        ($this->callback)('invitation', ['invitation.id' => $this->invitation->id, 'invitation.url' => 'https://evil.example/steal'])
            ->assertRedirect(route('login'));
    });

    it('needs the invitation to be in the session still', function (): void {
        googleIsNotAsked();

        ($this->callback)('invitation')->assertRedirect(route('login'));

        expect(($this->flashOf)())->toBe(trans_icu('auth.errors.oauth_state_invalid'));
    });

    it('returns to the invitation page when Google was cancelled', function (): void {
        googleIsNotAsked();

        ($this->callback)('invitation', $this->invited, '?error=access_denied')->assertRedirect($this->invitationUrl);
    });
});

describe('intent reauthenticate', function (): void {
    it('confirms the identity of the user whose Google account it is', function (): void {
        $user = User::factory()->googleLinked()->create();
        googleAnswers(googleProfile(id: $user->google_id, email: 'not.the.address@example.com'));

        ($this->callback)('reauthenticate', ['auth.login_at' => now()->subHours(3)->getTimestamp(), 'url.intended' => url('/account/security')], as: $user)
            ->assertRedirect(url('/account/security'));

        $stamp = session(RecentAuthentication::CONFIRMED_KEY);
        expect($stamp)->toBeInt()->toBeBetween(now()->subMinute()->getTimestamp(), now()->addMinute()->getTimestamp())
            ->and(session('url.intended'))->toBeNull();
    });

    it('passes recent.auth afterwards, however long ago the user signed in', function (): void {
        $user = User::factory()->googleLinked()->create(['google_id' => '444']);
        $old = ['auth.login_at' => now()->subHours(3)->getTimestamp()];
        googleAnswers(googleProfile(id: '444'));
        ($this->callback)('reauthenticate', $old, as: $user);
        $stamp = session(RecentAuthentication::CONFIRMED_KEY);

        $this->actingAs($user)->withSession([...$old, RecentAuthentication::CONFIRMED_KEY => $stamp])
            ->delete(route('account.google.unlink'))
            ->assertRedirect();

        expect($user->refresh()->google_id)->toBeNull();
    });

    it('goes to the dashboard when nothing was intended', function (): void {
        $user = User::factory()->googleLinked()->create();
        googleAnswers(googleProfile(id: $user->google_id));

        ($this->callback)('reauthenticate', as: $user)->assertRedirect(route('customer.dashboard'));
    });

    it('refuses a different Google account', function (): void {
        $user = User::factory()->googleLinked()->create();
        googleAnswers(googleProfile(id: 'another-google-id'));

        ($this->callback)('reauthenticate', ['auth.login_at' => now()->subHours(3)->getTimestamp()], as: $user)
            ->assertRedirect(route('customer.dashboard'));

        expect(session(RecentAuthentication::CONFIRMED_KEY))->toBeNull()
            ->and(($this->flashOf)('customer.dashboard'))->toBe(trans_icu('auth.errors.google_email_mismatch'));
    });

    it('refuses a user with no Google account linked', function (): void {
        $user = User::factory()->create(['email' => 'asha@example.com']);
        googleAnswers(googleProfile(id: '1000', email: 'asha@example.com'));

        ($this->callback)('reauthenticate', as: $user);

        expect(session(RecentAuthentication::CONFIRMED_KEY))->toBeNull()
            ->and($user->refresh()->google_id)->toBeNull();
    });

    it('needs the user who started it', function (): void {
        $starter = User::factory()->googleLinked()->create();
        $other = User::factory()->googleLinked()->create();
        googleIsNotAsked();

        $this->actingAs($other)->withSession(['oauth.intent' => 'reauthenticate', 'oauth.user' => $starter->getKey()])
            ->get(route('auth.google.callback'))
            ->assertRedirect(route('customer.dashboard'));

        expect(session(RecentAuthentication::CONFIRMED_KEY))->toBeNull();
    });
});

describe('unlinking Google', function (): void {
    beforeEach(function (): void {
        // Signed in a moment ago, which is what `recent.auth` asks for.
        $this->justNow = ['auth.login_at' => now()->getTimestamp()];
    });

    it('asks for a recent authentication first', function (): void {
        $user = User::factory()->create(['google_id' => '444']);

        $this->actingAs($user)->withSession(['auth.login_at' => now()->subHours(3)->getTimestamp()])
            ->delete(route('account.google.unlink'))
            ->assertRedirect(route('password.confirm'));

        expect($user->refresh()->google_id)->toBe('444');
    });

    it('answers a machine with 403 recent_auth_required', function (): void {
        $user = User::factory()->create(['google_id' => '444']);

        $this->actingAs($user)->withSession(['auth.login_at' => now()->subHours(3)->getTimestamp()])
            ->deleteJson(route('account.google.unlink'))
            ->assertForbidden()
            ->assertExactJson(['code' => 'recent_auth_required']);
    });

    it('unlinks a user who has a password, with a toast and an audit entry', function (): void {
        $user = User::factory()->create(['google_id' => '444']);

        $this->actingAs($user)->withSession($this->justNow)->withHeader('Referer', url('/account/security'))
            ->delete(route('account.google.unlink'))
            ->assertRedirect(url('/account/security'));

        expect($user->refresh()->google_id)->toBeNull()
            ->and($this->get(route('customer.dashboard'), InertiaRequest::headers())->json('flash.success'))->toBe(trans_icu('account.toasts.google_unlinked'));
        $audit = Activity::query()->where('event', 'auth.google_unlinked')->sole();
        expect($audit->subject_id)->toBe($user->getKey())->and($audit->causer_id)->toBe($user->getKey())
            ->and($audit->log_name)->toBe('security');
    });

    it('unlinks a user with a verified phone and no password', function (): void {
        $user = User::factory()->passwordless()->withPhone()->create(['google_id' => '444']);

        $this->actingAs($user)->withSession($this->justNow)->deleteJson(route('account.google.unlink'))->assertNoContent();

        expect($user->refresh()->google_id)->toBeNull();
    });

    it('refuses to remove the only way to sign in', function (string $kind): void {
        $user = match ($kind) {
            'google only' => User::factory()->passwordless()->create(['google_id' => '444']),
            'an unverified phone' => User::factory()->passwordless()->create(['google_id' => '444', 'phone_e164' => '+919876543210', 'phone_verified_at' => null]),
        };

        $this->actingAs($user)->withSession($this->justNow)->deleteJson(route('account.google.unlink'))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['google' => __('auth.errors.last_login_method')]);

        expect($user->refresh()->google_id)->toBe('444')
            ->and(Activity::query()->where('event', 'auth.google_unlinked')->count())->toBe(0);
    })->with(['google only', 'an unverified phone']);

    it('shows the refusal as a form error to a browser', function (): void {
        $user = User::factory()->passwordless()->create(['google_id' => '444']);

        $this->actingAs($user)->withSession($this->justNow)->withHeader('Referer', url('/account/security'))
            ->delete(route('account.google.unlink'))
            ->assertRedirect(url('/account/security'))
            ->assertSessionHasErrors(['google' => __('auth.errors.last_login_method')]);
    });

    it('does not count a password as a way in when the user has no email to sign in with', function (): void {
        // A phone that is not verified, a password and Google: the email was cleared while Google was linked.
        $user = User::factory()->create(['email' => null, 'google_id' => '444', 'phone_e164' => '+919876543210', 'phone_verified_at' => null]);
        expect($user->hasPassword())->toBeTrue();

        $this->actingAs($user)->withSession($this->justNow)->deleteJson(route('account.google.unlink'))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['google' => __('auth.errors.last_login_method')]);

        expect($user->refresh()->google_id)->toBe('444');
    });

    it('does nothing for a user without a Google link', function (): void {
        $user = User::factory()->passwordless()->create();

        $this->actingAs($user)->withSession($this->justNow)->deleteJson(route('account.google.unlink'))->assertNoContent();

        expect(Activity::query()->where('event', 'auth.google_unlinked')->count())->toBe(0);
    });

    it('is for signed-in users only', function (): void {
        $this->delete(route('account.google.unlink'))->assertRedirect(route('login'));
    });

    it('works for staff, who have a password', function (): void {
        $staff = User::factory()->support()->create(['google_id' => '444']);

        $this->actingAs($staff)->withSession($this->justNow)->deleteJson(route('account.google.unlink'))->assertNoContent();

        expect($staff->refresh()->google_id)->toBeNull();
    });
});

describe('the unlink request (14 section 3.3)', function (): void {
    it('has no fields', function (): void {
        expect((new UnlinkGoogleRequest)->rules())->toBe([]);
    });

    it('is for a signed-in user only', function (): void {
        $request = UnlinkGoogleRequest::create('/account/google', 'DELETE');
        expect($request->authorize())->toBeFalse();

        $request->setUserResolver(static fn (): User => User::factory()->create());
        expect($request->authorize())->toBeTrue();
    });
});

describe('staff with a second factor and an address nobody verified (13 section 5.3 step 5)', function (): void {
    // Linking by address takes the account over: the password goes, the remember token is rotated and the sessions are
    // revoked. For staff with a confirmed second factor none of it may happen before the challenge is passed, or
    // whoever owns the Google account for that address could lock the staff member out without the authenticator.
    beforeEach(function (): void {
        $this->owner = User::factory()->owner()->create(['email' => 'owner@example.com', 'email_verified_at' => null]);
        $this->owner->forceFill(['two_factor_recovery_codes' => encrypt(json_encode(['aaaaaaaaaa-bbbbbbbbbb', 'cccccccccc-dddddddddd']))])->save();
        $this->hash = $this->owner->password;
        $this->token = $this->owner->remember_token;
        $this->open = RegistryFixtures::open($this->owner);
        googleAnswers(googleProfile(id: '321', email: 'owner@example.com'));
        $this->challenge = fn (string $code = 'aaaaaaaaaa-bbbbbbbbbb') => $this->post(route('two-factor.login.store'), ['recovery_code' => $code]);
    });

    it('leaves the account untouched until the challenge is passed', function (): void {
        ($this->callback)()->assertRedirect(route('two-factor.login'));

        $this->assertGuest();
        $owner = $this->owner->refresh();
        expect($owner->password)->toBe($this->hash)
            ->and($owner->remember_token)->toBe($this->token)
            ->and($owner->google_id)->toBeNull()
            ->and($owner->email_verified_at)->toBeNull()
            ->and(RegistryFixtures::alive($this->open))->toBeTrue()
            ->and(Activity::query()->whereIn('event', ['auth.google_linked', 'auth.sessions_revoked'])->count())->toBe(0)
            ->and(session(ApplyPendingGoogleLink::KEY))->toBe(['user' => $this->owner->getKey(), 'googleId' => '321']);
    });

    it('does the clean-up when the challenge is passed, and only then', function (): void {
        ($this->callback)()->assertRedirect(route('two-factor.login'));

        ($this->challenge)()->assertRedirect(route('admin.dashboard'));

        $this->assertAuthenticatedAs($this->owner);
        $owner = $this->owner->refresh();
        expect($owner->google_id)->toBe('321')
            ->and($owner->email_verified_at)->not->toBeNull()
            ->and($owner->password)->toBeNull()
            ->and($owner->remember_token)->not->toBe($this->token)->toHaveLength(60)
            ->and(RegistryFixtures::alive($this->open))->toBeFalse()
            ->and(session()->has(ApplyPendingGoogleLink::KEY))->toBeFalse()
            ->and(session('auth.method'))->toBe('google')
            ->and(Activity::query()->where('event', 'auth.sessions_revoked')->sole()->properties->all())->toBe(['count' => 1, 'reason' => 'google_link_unverified'])
            ->and(Activity::query()->where('event', 'auth.google_linked')->sole()->properties->all())->toBe(['replaced' => false, 'reason' => 'google_link_unverified'])
            // The sign-in that passed the challenge is the one session left, and it is registered.
            ->and(googleSessionIsRegistered(session()->getId()))->toBeTrue()
            ->and(app(SessionRegistry::class)->isRevoked(session()->getId()))->toBeFalse();
    });

    it('does nothing when the challenge is failed or abandoned', function (): void {
        ($this->callback)()->assertRedirect(route('two-factor.login'));

        ($this->challenge)('wrong-wrong-wr')->assertSessionHasErrors();

        $this->assertGuest();
        $owner = $this->owner->refresh();
        expect($owner->password)->toBe($this->hash)
            ->and($owner->google_id)->toBeNull()
            ->and(RegistryFixtures::alive($this->open))->toBeTrue()
            ->and(Activity::query()->where('event', 'auth.sessions_revoked')->count())->toBe(0);
    });

    it('is bound to the user: somebody else who passes a challenge in the same session does not trigger it', function (): void {
        // The stash is the owner's; the one who signs in through a second factor is another staff member. A password
        // sign-in would drop the stash before the event, so the other one comes in by a challenge of their own.
        $other = User::factory()->admin()->create(['email' => 'admin@example.com']);
        $other->forceFill(['two_factor_recovery_codes' => encrypt(json_encode(['eeeeeeeeee-ffffffffff']))])->save();
        $otherHash = $other->password;
        $this->withSession([
            ApplyPendingGoogleLink::KEY => ['user' => $this->owner->getKey(), 'googleId' => '321'],
            'login.id' => $other->getKey(),
            'login.remember' => false,
        ])->post(route('two-factor.login.store'), ['recovery_code' => 'eeeeeeeeee-ffffffffff'])->assertRedirect(route('admin.dashboard'));

        $this->assertAuthenticatedAs($other);
        expect($other->refresh()->google_id)->toBeNull()->and($other->password)->toBe($otherHash)
            ->and($this->owner->refresh()->password)->toBe($this->hash)
            ->and($this->owner->google_id)->toBeNull()
            ->and(RegistryFixtures::alive($this->open))->toBeTrue()
            // The stash is spent either way.
            ->and(session()->has(ApplyPendingGoogleLink::KEY))->toBeFalse();
    });

    it('is forgotten by a password sign-in, so that the same owner signing in with the password later is not taken over', function (): void {
        ($this->callback)()->assertRedirect(route('two-factor.login'));
        Auth::forgetGuards();

        // The challenge was abandoned; the owner signs in with the password in the same session and passes a challenge.
        $this->post(route('login.store'), ['email' => 'owner@example.com', 'password' => 'password'])->assertRedirect(route('two-factor.login'));
        ($this->challenge)()->assertRedirect(route('admin.dashboard'));

        $this->assertAuthenticatedAs($this->owner);
        expect($this->owner->refresh()->password)->toBe($this->hash)
            ->and($this->owner->google_id)->toBeNull()
            ->and(session('auth.method'))->toBe('password')
            ->and(RegistryFixtures::alive($this->open))->toBeTrue();
    });

    it('does not do it for a sign-in by the remember cookie', function (): void {
        $recaller = $this->owner->getKey().'|'.$this->token.'|'.Auth::guard('web')->hashPasswordForCookie($this->hash);

        $this->withCookie(Auth::guard('web')->getRecallerName(), $recaller)
            ->withSession([ApplyPendingGoogleLink::KEY => ['user' => $this->owner->getKey(), 'googleId' => '321']])
            ->get(route('admin.dashboard'));

        expect($this->owner->refresh()->google_id)->toBeNull()->and($this->owner->password)->toBe($this->hash);
    });

    it('links at once when the address was verified, as before', function (): void {
        $this->owner->forceFill(['email_verified_at' => now()])->save();

        ($this->callback)()->assertRedirect(route('two-factor.login'));

        expect($this->owner->refresh()->google_id)->toBe('321')->and($this->owner->password)->toBe($this->hash)
            ->and(session()->has(ApplyPendingGoogleLink::KEY))->toBeFalse();
    });

    it('does not wait for staff without a second factor', function (): void {
        $this->owner->forceFill(['two_factor_secret' => null, 'two_factor_recovery_codes' => null, 'two_factor_confirmed_at' => null])->save();

        ($this->callback)()->assertRedirect(route('admin.dashboard'));

        expect($this->owner->refresh()->password)->toBeNull()->and($this->owner->google_id)->toBe('321');
    });

    it('finishes the sign-in even when the link has become impossible meanwhile', function (): void {
        ($this->callback)()->assertRedirect(route('two-factor.login'));
        // Somebody else linked that Google account in the meantime.
        User::factory()->create(['google_id' => '321']);

        ($this->challenge)()->assertRedirect(route('admin.dashboard'));

        $this->assertAuthenticatedAs($this->owner);
        expect($this->owner->refresh()->google_id)->toBeNull()->and($this->owner->password)->toBe($this->hash);
    });
});

describe('linking Google rotates the remember token (13 section 6.3)', function (): void {
    // The unverified address makes the link a take-over, which rotates the token and with it the cookie of every
    // device. The device in use gets the new one at once, as "sign out other devices" does.
    beforeEach(function (): void {
        $this->user = User::factory()->unverified()->create(['email' => 'asha@example.com', 'remember_token' => Str::random(60)]);
        $this->token = $this->user->remember_token;
    });

    it('re-issues the recaller cookie of the current device with the new token', function (): void {
        googleAnswers(googleProfile(id: '444', email: 'asha@example.com'));
        $old = $this->user->getKey().'|'.$this->token.'|'.Auth::guard('web')->hashPasswordForCookie($this->user->password);

        $response = $this->withCookie(Auth::guard('web')->getRecallerName(), $old)
            ->actingAs($this->user)
            ->withSession(['oauth.intent' => 'link', 'oauth.user' => $this->user->getKey()])
            ->get(route('auth.google.callback'));

        $user = $this->user->refresh();
        $recaller = googleRecaller($response);
        expect($user->remember_token)->not->toBe($this->token)
            ->and($recaller)->not->toBeNull()
            ->and(CookieValuePrefix::remove(decrypt($recaller->getValue(), false)))->toBe($user->getKey().'|'.$user->remember_token.'|'.Auth::guard('web')->hashPasswordForCookie(null))
            ->and($recaller->getExpiresTime())->toBeGreaterThan(time());
    });

    it('sets no cookie on a device that had none', function (): void {
        googleAnswers(googleProfile(id: '444', email: 'asha@example.com'));
        $response = ($this->callback)('link', as: $this->user);

        expect($this->user->refresh()->remember_token)->not->toBe($this->token)->and(googleRecaller($response))->toBeNull();
    });

    it('sets no cookie when the token was not rotated', function (): void {
        $verified = User::factory()->create(['email' => 'maya@example.com', 'remember_token' => Str::random(60)]);
        googleAnswers(googleProfile(id: '555', email: 'maya@example.com'));
        $old = $verified->getKey().'|'.$verified->remember_token.'|'.Auth::guard('web')->hashPasswordForCookie($verified->password);

        $response = $this->withCookie(Auth::guard('web')->getRecallerName(), $old)
            ->actingAs($verified)
            ->withSession(['oauth.intent' => 'link', 'oauth.user' => $verified->getKey()])
            ->get(route('auth.google.callback'));

        expect($verified->refresh()->google_id)->toBe('555')->and(googleRecaller($response))->toBeNull();
    });
});
