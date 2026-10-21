<?php

declare(strict_types=1);

use App\Domain\Identity\Enums\LengthUnit;
use App\Domain\Identity\Enums\UnitSystem;
use App\Domain\Identity\Enums\UserType;
use App\Domain\Identity\Events\CustomerRegistered;
use App\Domain\Identity\Models\User;
use App\Notifications\Account\Welcome;
use App\Support\Settings\Settings;
use App\Support\Settings\SettingsGroup;
use Illuminate\Auth\Events\Registered;
use Illuminate\Auth\Notifications\VerifyEmail;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rules\Password;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\Support\InertiaRequest;

/** A valid registration form; `$overrides` replace or (with null) remove fields. */
function registration(array $overrides = []): array
{
    return array_filter([
        'name' => 'Asha Kapoor',
        'email' => 'Asha.Kapoor@Example.com',
        'password' => 'a-long-enough-password',
        'password_confirmation' => 'a-long-enough-password',
        'terms' => 'on',
        ...$overrides,
    ], static fn (mixed $value): bool => $value !== null);
}

/** Opens or closes customer registration the way the owner does, in the settings. */
function allowRegistration(bool $open): void
{
    $settings = app(Settings::class);
    $auth = $settings->auth();
    $auth->allowCustomerRegistration = $open;
    $settings->put(SettingsGroup::Auth, $auth);
}

beforeEach(function (): void {
    $this->register = fn (array $overrides = [], string $ip = '203.0.113.45') => $this
        ->withServerVariables(['REMOTE_ADDR' => $ip])
        ->post(route('register.store'), registration($overrides));
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

describe('a valid registration', function (): void {
    it('creates a customer with the business defaults and signs them in', function (): void {
        ($this->register)()->assertRedirect(route('customer.dashboard'));

        $user = User::query()->where('email', 'asha.kapoor@example.com')->sole();

        expect($user->type)->toBe(UserType::Customer)
            ->and($user->name)->toBe('Asha Kapoor')
            ->and($user->terms_accepted_at)->not->toBeNull()
            ->and($user->terms_accepted_at->diffInSeconds(now()))->toBeLessThan(5)
            ->and($user->timezone)->toBe('Asia/Kolkata')
            ->and($user->unit_system)->toBe(UnitSystem::Metric)
            ->and($user->length_unit)->toBe(LengthUnit::Mm)
            ->and($user->locale)->toBe('en')
            ->and($user->marketing_opt_in)->toBeFalse()
            ->and($user->is_active)->toBeTrue()
            ->and($user->email_verified_at)->toBeNull()
            ->and($user->onboarded_at)->toBeNull()
            ->and($user->password)->not->toBe('a-long-enough-password')
            ->and(password_verify('a-long-enough-password', $user->password))->toBeTrue()
            ->and($user->roles)->toHaveCount(0);

        $this->assertAuthenticatedAs($user);
    });

    it('takes the time zone, units and locale from the settings, not from constants', function (): void {
        $settings = app(Settings::class);
        $business = $settings->business();
        $business->timezone = 'Europe/Berlin';
        $settings->put(SettingsGroup::Business, $business);
        $units = $settings->units();
        $units->defaultSystem = 'imperial';
        $units->defaultLengthUnit = 'ftin';
        $settings->put(SettingsGroup::Units, $units);
        config(['app.locale' => 'hi']);

        ($this->register)()->assertRedirect();

        $user = User::query()->where('email', 'asha.kapoor@example.com')->sole();

        expect($user->timezone)->toBe('Europe/Berlin')
            ->and($user->unit_system)->toBe(UnitSystem::Imperial)
            ->and($user->length_unit)->toBe(LengthUnit::Ftin)
            ->and($user->locale)->toBe('hi');
    });

    it('stores the marketing choice, and trims and lower-cases the email', function (): void {
        ($this->register)(['marketing_opt_in' => 'on', 'email' => '  Asha.K@Example.COM ', 'name' => '  Asha  '])->assertRedirect();

        $user = User::query()->where('email', 'asha.k@example.com')->sole();

        expect($user->marketing_opt_in)->toBeTrue()
            ->and($user->name)->toBe('Asha');
    });

    it('dispatches Registered and CustomerRegistered', function (): void {
        Event::fake([Registered::class, CustomerRegistered::class]);

        ($this->register)()->assertRedirect();

        $user = User::query()->where('email', 'asha.kapoor@example.com')->sole();

        Event::assertDispatched(Registered::class, fn (Registered $event): bool => $event->user->is($user));
        Event::assertDispatched(CustomerRegistered::class, fn (CustomerRegistered $event): bool => $event->user->is($user)
            && $event->subjectUser()->is($user)
            && $event->eventKey() === 'account.welcome'
            && strlen($event->eventId()) === 26
            && $event->occurredAt()->diffInSeconds(now()) < 5);
    });

    it('sends the Welcome notification by database and mail, and the verification link', function (): void {
        Notification::fake();

        ($this->register)()->assertRedirect();

        $user = User::query()->where('email', 'asha.kapoor@example.com')->sole();

        Notification::assertSentTo($user, Welcome::class, fn (Welcome $welcome, array $channels): bool => $channels === ['database', 'mail']);
        Notification::assertSentTo($user, VerifyEmail::class);
    });

    it('greets the new customer in the app and by email, with the product name', function (): void {
        ($this->register)()->assertRedirect();

        $user = User::query()->where('email', 'asha.kapoor@example.com')->sole();
        $notification = $user->notifications()->sole();
        $mail = (new Welcome)->toMail($user);

        expect($notification->type)->toBe('account.welcome')
            ->and($notification->data)->toMatchArray([
                'eventKey' => 'account.welcome',
                'titleKey' => 'notifications.account.welcome.customer.title',
                'bodyKey' => 'notifications.account.welcome.customer.body',
                'params' => ['appName' => config('app.name')],
                'url' => '/dashboard',
                'icon' => 'smile',
            ])
            ->and($mail->subject)->toBe('Welcome to '.config('app.name'))
            ->and($mail->introLines)->toBe(['Start by uploading your floor plan or drawing it yourself.'])
            ->and($mail->actionUrl)->toBe(route('customer.dashboard'));
    });

    it('sends only the in-app greeting to a user without an email', function (): void {
        expect((new Welcome)->via(User::factory()->phoneOnly()->make()))->toBe(['database']);
    });

    it('stamps the session like a login and registers it', function (): void {
        ($this->register)()->assertRedirect();

        $user = User::query()->where('email', 'asha.kapoor@example.com')->sole();

        expect(session('auth.method'))->toBe('password')
            ->and(session('auth.login_at'))->toBeInt()
            ->and(Redis::connection('sessions')->zcard('sess:user:'.$user->getKey()))->toBe(1);
    });

    it('asks an Inertia visit to load the dashboard as a full page', function (): void {
        $this->withHeaders(InertiaRequest::headers())
            ->post(route('register.store'), registration())
            ->assertStatus(409)
            ->assertHeader('X-Inertia-Location', route('customer.dashboard'));
    });

    it('answers a JSON client with 201', function (): void {
        $this->postJson(route('register.store'), registration())->assertCreated();
    });
});

describe('an invalid registration', function (): void {
    it('rejects a name with a web address', function (string $name): void {
        ($this->register)(['name' => $name])->assertSessionHasErrors(['name' => __('auth.name_no_links')]);

        expect(User::query()->where('email', 'asha.kapoor@example.com')->exists())->toBeFalse();
    })->with([
        'https' => 'Visit https://x.test',
        'http in capitals' => 'HTTP://x.test',
        'www' => 'Buy at www.x.test',
    ]);

    it('rejects a name that is too short or too long', function (string $name): void {
        ($this->register)(['name' => $name])->assertSessionHasErrors('name');
    })->with(['one letter' => 'A', 'blank' => '   ', '121 letters' => str_repeat('a', 121)]);

    it('rejects an email that belongs to a soft-deleted user', function (): void {
        User::factory()->pendingDeletion()->create(['email' => 'asha.kapoor@example.com']);

        ($this->register)()->assertSessionHasErrors(['email' => __('auth.email_unavailable')]);

        $this->assertGuest();
    });

    it('rejects an email that is taken, however it is written', function (): void {
        User::factory()->create(['email' => 'asha.kapoor@example.com']);

        ($this->register)(['email' => ' ASHA.KAPOOR@example.com'])->assertSessionHasErrors(['email' => __('auth.email_unavailable')]);
    });

    it('rejects an email that is not one', function (string $email): void {
        ($this->register)(['email' => $email])->assertSessionHasErrors('email');
    })->with(['no domain' => 'asha@', 'words' => 'not an email', 'too long' => str_repeat('a', 250).'@x.test']);

    it('rejects a missing acceptance of the terms', function (): void {
        ($this->register)(['terms' => null])->assertSessionHasErrors(['terms' => __('auth.terms_required')]);
        ($this->register)(['terms' => '0'])->assertSessionHasErrors(['terms' => __('auth.terms_required')]);

        $this->assertGuest();
    });

    it('rejects a password that is too short, or not confirmed', function (): void {
        ($this->register)(['password' => 'short', 'password_confirmation' => 'short'])->assertSessionHasErrors('password');
        ($this->register)(['password_confirmation' => 'something else entirely'])->assertSessionHasErrors('password');
    });

    it('creates no user and sends nothing when the form is invalid', function (): void {
        Notification::fake();
        Event::fake([CustomerRegistered::class]);

        ($this->register)(['terms' => null]);

        expect(User::query()->where('email', 'asha.kapoor@example.com')->exists())->toBeFalse();
        Notification::assertNothingSent();
        Event::assertNotDispatched(CustomerRegistered::class);
    });

    it('does not take a password into the flash', function (): void {
        ($this->register)(['terms' => null])->assertSessionDoesntHaveErrors('password')->assertSessionMissing('_old_input.password');
    });
});

describe('closed registration', function (): void {
    it('shows canRegister false on the page and refuses the POST with 403', function (): void {
        allowRegistration(false);

        $this->get(route('register'))
            ->assertOk()
            ->assertInertia(fn (Assert $page) => $page->component('Auth/Register')->where('canRegister', false));

        ($this->register)()->assertForbidden();

        expect(User::query()->where('email', 'asha.kapoor@example.com')->exists())->toBeFalse();
        $this->assertGuest();
    });

    it('tells a JSON client why', function (): void {
        allowRegistration(false);

        $this->postJson(route('register.store'), registration())
            ->assertForbidden()
            ->assertJsonPath('message', __('auth.registration_closed'));
    });

    it('refuses before counting the attempt', function (): void {
        allowRegistration(false);

        foreach (range(1, 8) as $_) {
            ($this->register)()->assertForbidden();
        }

        allowRegistration(true);

        ($this->register)()->assertRedirect();
    });

    it('shows canRegister true on the page while it is open', function (): void {
        $this->get(route('register'))
            ->assertInertia(fn (Assert $page) => $page
                ->component('Auth/Register')
                ->where('canRegister', true)
                ->where('turnstileSiteKey', null)
                ->where('features.captcha', false)
                ->has('passwordRules'));
    });
});

describe('throttling', function (): void {
    it('throttles the 6th registration from one IP within an hour', function (): void {
        // Invalid forms count as well: the limiter sits in front of the validation.
        foreach (range(1, 5) as $_) {
            ($this->register)(['terms' => null])->assertSessionHasErrors('terms');
        }

        ($this->register)(['terms' => null])->assertStatus(429);
        ($this->register)()->assertStatus(429);

        expect(User::query()->where('email', 'asha.kapoor@example.com')->exists())->toBeFalse();
    });

    it('answers the 429 of a JSON client with the code and the wait', function (): void {
        foreach (range(1, 5) as $_) {
            $this->postJson(route('register.store'), registration(['terms' => null]))->assertStatus(422);
        }

        $this->postJson(route('register.store'), registration())
            ->assertStatus(429)
            ->assertJsonPath('code', 'rate_limited')
            ->assertHeader('Retry-After');
    });

    it('comes back to the form with the wait as an inline error and without a toast', function (): void {
        foreach (range(1, 5) as $_) {
            ($this->register)(['terms' => null]);
        }

        $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.45'])
            ->withHeaders([...InertiaRequest::headers(), 'Referer' => route('register')])
            ->post(route('register.store'), registration())
            ->assertRedirect(route('register'));

        $page = $this->withHeaders(InertiaRequest::headers())->get(route('register'))->assertOk();

        expect((int) $page->json('props.errors.rate_limited'))->toBeGreaterThan(0)->toBeLessThanOrEqual(3600)
            ->and($page->json())->not->toHaveKey('flash');
    });

    it('counts per IP', function (): void {
        foreach (range(1, 5) as $_) {
            ($this->register)(['terms' => null])->assertSessionHasErrors('terms');
        }

        ($this->register)([], '198.51.100.9')->assertRedirect(route('customer.dashboard'));
    });
});

describe('the Turnstile check', function (): void {
    beforeEach(function (): void {
        config(['services.turnstile.site_key' => '1x00000000000000000000AA', 'services.turnstile.secret_key' => 'secret-value']);
        $host = parse_url((string) config('app.url'), PHP_URL_HOST);
        $this->cloudflare = fn (array $answer) => Http::fake([
            'challenges.cloudflare.com/*' => Http::response(['success' => true, 'hostname' => $host, 'action' => 'register', ...$answer]),
        ]);
    });

    it('lets a verified token through', function (): void {
        ($this->cloudflare)([]);

        ($this->register)(['cf_turnstile_response' => 'token-from-widget'])->assertRedirect(route('customer.dashboard'));

        Http::assertSent(fn ($request): bool => $request->url() === 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
            && $request['response'] === 'token-from-widget'
            && $request['secret'] === 'secret-value'
            && $request['remoteip'] === '203.0.113.45'
            && ($request['idempotency_key'] ?? '') !== '');
    });

    it('refuses a token that Cloudflare does not confirm', function (): void {
        ($this->cloudflare)(['success' => false]);

        ($this->register)(['cf_turnstile_response' => 'bad'])->assertSessionHasErrors(['cf_turnstile_response' => __('auth.captcha_failed')]);

        $this->assertGuest();
    });

    it('refuses a missing token without asking Cloudflare', function (): void {
        Http::fake();

        ($this->register)()->assertSessionHasErrors(['cf_turnstile_response' => __('auth.captcha_failed')]);

        Http::assertNothingSent();
    });

    it('lets the registration through while Cloudflare cannot be reached (fail open)', function (): void {
        Http::fake(fn () => throw new ConnectionException('timeout'));

        ($this->register)(['cf_turnstile_response' => 'token'])->assertRedirect(route('customer.dashboard'));
    });

    it('adds the Cloudflare origin to the CSP of the page only while it is on', function (): void {
        expect($this->get(route('register'))->headers->get('Content-Security-Policy'))->toContain('https://challenges.cloudflare.com');

        config(['services.turnstile.site_key' => null]);

        expect($this->get(route('register'))->headers->get('Content-Security-Policy'))->not->toContain('cloudflare');
    });
});

describe('Password::defaults()', function (): void {
    /** Whether `$password` passes the application defaults. */
    function passesDefaults(string $password): bool
    {
        return Validator::make(['password' => $password], ['password' => Password::default()])->passes();
    }

    it('asks for 8 to 128 characters and no composition outside production', function (): void {
        expect(passesDefaults('1234567'))->toBeFalse()
            ->and(passesDefaults('12345678'))->toBeTrue()
            ->and(passesDefaults('alllowercaseletters'))->toBeTrue()
            ->and(passesDefaults(str_repeat('a', 128)))->toBeTrue()
            ->and(passesDefaults(str_repeat('a', 129)))->toBeFalse();
    });

    it('asks for 10 to 128 characters that are not in a breach in production', function (): void {
        $this->app['env'] = 'production';
        $hash = strtoupper(sha1('correct-horse-battery'));
        Http::fake([
            'api.pwnedpasswords.com/range/'.substr($hash, 0, 5) => Http::response(substr($hash, 5).":4210\r\n0000000000000000000000000000000000A:1"),
            'api.pwnedpasswords.com/*' => Http::response('0000000000000000000000000000000000A:1'),
        ]);

        expect(passesDefaults('123456789'))->toBeFalse()
            ->and(passesDefaults(str_repeat('a', 129)))->toBeFalse()
            ->and(passesDefaults('correct-horse-battery'))->toBeFalse()
            ->and(passesDefaults('a-long-enough-password'))->toBeTrue();
    });

    it('treats a password as safe when the breach service cannot be reached', function (): void {
        $this->app['env'] = 'production';
        Http::fake(fn () => throw new ConnectionException('down'));

        expect(passesDefaults('a-long-enough-password'))->toBeTrue();
    });
});
