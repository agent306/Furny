<?php

declare(strict_types=1);

use App\Domain\Identity\Enums\OtpChannel;
use App\Domain\Identity\Enums\OtpPurpose;
use App\Domain\Identity\Enums\UserType;
use App\Domain\Identity\Events\ContactVerified;
use App\Domain\Identity\Events\CustomerRegistered;
use App\Domain\Identity\Models\OtpCode;
use App\Domain\Identity\Models\User;
use App\Domain\Identity\Otp\OtpDelivery;
use App\Notifications\Account\Welcome;
use App\Support\Settings\Groups\WhatsAppTemplateData;
use App\Support\Settings\Settings;
use App\Support\Settings\SettingsGroup;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Str;
use Illuminate\Testing\Fluent\AssertableJson;
use Illuminate\Testing\TestResponse;
use Inertia\Testing\AssertableInertia as Assert;
use Spatie\Activitylog\Models\Activity;
use Symfony\Component\HttpFoundation\Cookie;
use Tests\Support\InertiaRequest;

const FLOW_PHONE = '98765 43210';
const FLOW_E164 = '+919876543210';

beforeEach(function (): void {
    // The global send counter is per clock hour: the clock is pinned mid-hour.
    $this->travelTo(CarbonImmutable::parse('2026-10-21 12:20:00', 'UTC'));
    $this->delivery = app(OtpDelivery::class);

    $this->send = fn (array $body = [], string $phone = FLOW_PHONE): TestResponse => $this
        ->post(route('auth.otp.send'), ['phone' => $phone, 'intent' => 'login', ...$body]);
    $this->verify = fn (?string $code = null): TestResponse => $this
        ->from(route('auth.otp.verify.show'))
        ->post(route('auth.otp.verify'), ['code' => $code ?? $this->delivery->lastCode()]);
    // The flash of the page a visitor lands on next.
    $this->flashOf = fn (string $route = 'login', string $type = 'error'): ?string => $this
        ->get(route($route), InertiaRequest::headers())->json("flash.{$type}");
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

function flowRecaller(TestResponse $response): ?Cookie
{
    $name = Auth::guard('web')->getRecallerName();

    return collect($response->headers->getCookies())->first(fn ($cookie): bool => $cookie->getName() === $name);
}

function flowCloseRegistration(): void
{
    $settings = app(Settings::class);
    $auth = $settings->auth();
    $auth->allowCustomerRegistration = false;
    $settings->put(SettingsGroup::Auth, $auth);
}

/** An existing customer who signed up with this number. */
function flowCustomer(array $attributes = []): User
{
    return User::factory()->phoneOnly()->create(['phone_e164' => FLOW_E164, ...$attributes]);
}

describe('the sign-in page (13 section 5.2, 10 section 4.4)', function (): void {
    it('is the first step, for the intent in the query', function (string $query, string $intent): void {
        $this->get(route('auth.otp.create').$query)
            ->assertInertia(fn (Assert $page) => $page
                ->component('Auth/PhoneLogin')
                ->where('intent', $intent)
                ->has('features')
                ->has('turnstileSiteKey')
                ->has('canRegister'));
    })->with([
        'login by default' => ['', 'login'],
        'register' => ['?intent=register', 'register'],
        'anything else is login' => ['?intent=admin', 'login'],
    ]);

    it('is for guests only', function (): void {
        $this->actingAs(User::factory()->create())->get(route('auth.otp.create'))->assertRedirect();
        $this->actingAs(User::factory()->create())->post(route('auth.otp.send'), ['phone' => FLOW_PHONE, 'intent' => 'login'])->assertRedirect();
        expect($this->delivery->sent())->toBe([]);
    });
});

describe('sending the code', function (): void {
    it('answers the same for a number that has an account and one that has none', function (): void {
        flowCustomer();
        $known = ($this->send)()
            ->assertRedirectToRoute('auth.otp.verify.show')
            ->assertSessionHas('inertia.flash_data.channel', 'sms')
            ->assertSessionHas('inertia.flash_data.maskedPhone', '+91******3210');
        $knownFlash = session('inertia.flash_data');
        $knownChallenge = session('otp.challenge');

        $this->flushSession();
        $unknown = ($this->send)(phone: '98765 43211')
            ->assertRedirectToRoute('auth.otp.verify.show')
            ->assertSessionHas('inertia.flash_data.channel', 'sms')
            ->assertSessionHas('inertia.flash_data.maskedPhone', '+91******3211');

        expect($unknown->headers->get('Location'))->toBe($known->headers->get('Location'))
            ->and(array_keys(session('inertia.flash_data')))->toBe(array_keys($knownFlash))
            ->and(array_keys(session('otp.challenge')))->toBe(array_keys($knownChallenge))
            // A code went out to both.
            ->and($this->delivery->sent())->toHaveCount(2);
    });

    it('does not look the number up, so that the work is the same for both', function (): void {
        flowCustomer();
        DB::enableQueryLog();

        ($this->send)();

        $users = collect(DB::getQueryLog())->filter(fn (array $query): bool => str_contains($query['query'], '"users"'));
        expect($users)->toHaveCount(0);
    });

    it('keeps the challenge of the code that went out in the session', function (): void {
        ($this->send)();
        $otp = OtpCode::query()->sole();

        expect(session('otp.challenge'))->toBe([
            'e164' => FLOW_E164,
            'purpose' => 'login',
            'intent' => 'login',
            'channel' => 'sms',
            'otpId' => $otp->id,
            'expiresAt' => $otp->expires_at->getTimestamp(),
        ]);
    });

    it('keeps the name of a sign-up in the challenge', function (): void {
        ($this->send)(['intent' => 'register', 'name' => '  Maya Rao ', 'terms' => '1'])->assertRedirectToRoute('auth.otp.verify.show');

        expect(session('otp.challenge.intent'))->toBe('register')
            ->and(session('otp.challenge.name'))->toBe('Maya Rao');
    });

    it('asks a sign-up for a name and for the terms', function (array $body, array $invalid): void {
        ($this->send)($body)->assertSessionHasErrors($invalid);

        expect($this->delivery->sent())->toBe([])->and(session('otp.challenge'))->toBeNull();
    })->with([
        'no name' => [['intent' => 'register', 'terms' => '1'], ['name']],
        'one letter' => [['intent' => 'register', 'name' => 'M', 'terms' => '1'], ['name']],
        'a link' => [['intent' => 'register', 'name' => 'visit https://spam.example', 'terms' => '1'], ['name']],
        'no terms' => [['intent' => 'register', 'name' => 'Maya Rao'], ['terms']],
        'an unknown intent' => [['intent' => 'admin'], ['intent']],
        'no number' => [['phone' => ''], ['phone']],
    ]);

    it('needs neither name nor terms to sign in', function (): void {
        ($this->send)()->assertRedirectToRoute('auth.otp.verify.show');
    });

    it('says why a number is refused, on the phone field, with the code and no challenge', function (string $phone, string $code, int $status): void {
        $response = ($this->send)(phone: $phone)->assertSessionHasErrors(['phone', 'code']);

        expect(session('errors')->get('phone')[0])->toBe(__('auth.errors.'.$code))
            ->and(session('errors')->get('code')[0])->toBe($code)
            ->and(session('otp.challenge'))->toBeNull()
            ->and($this->delivery->sent())->toBe([]);
        $response->assertRedirect();
    })->with([
        'not a number' => ['abc', 'phone_invalid', 422],
        'a landline' => ['011 2345 6789', 'phone_not_mobile', 422],
        'another country' => ['+14155552671', 'phone_country_not_supported', 422],
    ]);

    it('answers a second send inside the cooldown with the wait, as an inline error', function (): void {
        ($this->send)();

        ($this->send)()->assertSessionHasErrors(['phone', 'code', 'retryAfter', 'rate_limited']);

        expect(session('errors')->get('code')[0])->toBe('otp_cooldown')
            ->and((int) session('errors')->get('retryAfter')[0])->toBeBetween(1, 60)
            ->and(session('errors')->get('rate_limited')[0])->toBe(session('errors')->get('retryAfter')[0]);
    });

    it('answers machines with the code, its context and its status', function (): void {
        ($this->send)();

        $this->postJson(route('auth.otp.send'), ['phone' => FLOW_PHONE, 'intent' => 'login'])
            ->assertStatus(429)
            ->assertJson(fn (AssertableJson $json) => $json->where('code', 'otp_cooldown')->whereType('retryAfter', 'integer')->etc());
        $this->postJson(route('auth.otp.send'), ['phone' => 'abc', 'intent' => 'login'])
            ->assertStatus(422)
            ->assertExactJson(['code' => 'phone_invalid']);
    });

    it('asks for the captcha after two sends, on the captcha field', function (): void {
        config(['services.turnstile.site_key' => '1x00000000000000000000AA', 'services.turnstile.secret_key' => 'secret-value']);
        ($this->send)(phone: '98765 43211');
        ($this->send)(phone: '98765 43212');

        ($this->send)(phone: '98765 43213')->assertSessionHasErrors(['cf_turnstile_response', 'code']);

        expect(session('errors')->get('code')[0])->toBe('captcha_required');
    });
});

describe('the verification page', function (): void {
    it('sends a visitor without a challenge back to the start', function (): void {
        $this->get(route('auth.otp.verify.show'))->assertRedirectToRoute('auth.otp.create');
        $this->post(route('auth.otp.verify'), ['code' => '123456'])->assertRedirectToRoute('auth.otp.create');
        $this->post(route('auth.otp.resend'))->assertRedirectToRoute('auth.otp.create');
    });

    it('hands the page the channel, the masked number, the wait and the channels', function (): void {
        ($this->send)();

        $this->get(route('auth.otp.verify.show'))
            ->assertInertia(fn (Assert $page) => $page
                ->component('Auth/PhoneVerify')
                ->where('channel', 'sms')
                ->where('maskedPhone', '+91******3210')
                ->where('resendAvailableIn', 60)
                ->where('expiresAt', now()->addMinutes(10)->getTimestamp())
                ->where('channels', ['sms'])
                ->has('features')
                ->has('turnstileSiteKey'));
    });

    it('counts the wait down to zero', function (): void {
        ($this->send)();

        $this->travel(45)->seconds();
        $this->get(route('auth.otp.verify.show'))->assertInertia(fn (Assert $page) => $page->where('resendAvailableIn', 15));

        $this->travel(20)->seconds();
        $this->get(route('auth.otp.verify.show'))->assertInertia(fn (Assert $page) => $page->where('resendAvailableIn', 0));
    });

    it('does not show the challenge of a number being added to an account', function (): void {
        $this->withSession(['otp.challenge' => [
            'e164' => FLOW_E164, 'purpose' => 'verify_phone', 'intent' => 'verify_phone', 'channel' => 'sms',
            'otpId' => Str::ulid()->toBase32(), 'expiresAt' => now()->addMinutes(10)->getTimestamp(),
        ]])->get(route('auth.otp.verify.show'))->assertRedirectToRoute('auth.otp.create');
    });

    it('keeps the page after the code expired, and says so when it is tried', function (): void {
        ($this->send)();
        $code = $this->delivery->lastCode();

        $this->travel(11)->minutes();

        $this->get(route('auth.otp.verify.show'))->assertInertia(fn (Assert $page) => $page->component('Auth/PhoneVerify')->where('resendAvailableIn', 0));
        ($this->verify)($code)->assertSessionHasErrors('code');
        expect(session('errors')->get('code')[0])->toBe(__('auth.errors.otp_expired'))->and(session('otp.challenge'))->not->toBeNull();
        $this->assertGuest();
    });
});

describe('too many tries (13 section 4.3 step 1, 10 section 4)', function (): void {
    it('comes back to the verify page with the wait as an inline error and without a toast', function (): void {
        ($this->send)();
        // Ten tries a minute from one address; a code that is not six digits costs no attempt of the code itself.
        foreach (range(1, 10) as $_) {
            ($this->verify)('12 34');
        }

        $headers = [...InertiaRequest::headers(), 'Referer' => route('auth.otp.verify.show')];
        $this->withHeaders($headers)->post(route('auth.otp.verify'), ['code' => '123456'])->assertRedirect(route('auth.otp.verify.show'));

        $page = $this->withHeaders(InertiaRequest::headers())->get(route('auth.otp.verify.show'))->assertOk();

        // The only flash is the one of the send that started the flow (channel and masked number): no toast.
        expect((int) $page->json('props.errors.rate_limited'))->toBeGreaterThan(0)->toBeLessThanOrEqual(60)
            ->and($page->json('flash.error'))->toBeNull()
            ->and($page->json('flash.channel'))->toBe('sms');
        $this->assertGuest();
    });

    it('answers machines with 429 and the wait', function (): void {
        ($this->send)();
        foreach (range(1, 10) as $_) {
            ($this->verify)('12 34');
        }

        $this->postJson(route('auth.otp.verify'), ['code' => '123456'])->assertStatus(429)->assertJsonPath('code', 'rate_limited');
    });
});

describe('verifying for an existing customer', function (): void {
    it('signs them in with the remember cookie, as customers are, by the method otp', function (): void {
        $user = flowCustomer();
        ($this->send)();
        $before = Str::random(40);

        $this->withCookie((string) config('session.cookie'), $before);
        $response = ($this->verify)();

        $this->assertAuthenticatedAs($user);
        expect($response->isRedirect() || $response->getStatusCode() === 302)->toBeTrue()
            ->and(flowRecaller($response))->not->toBeNull()
            ->and(session()->getId())->not->toBe($before)->toHaveLength(40)
            ->and(session('auth.method'))->toBe('otp')
            ->and(session('auth.remember'))->toBeTrue()
            ->and(session('auth.login_at'))->toBeInt()
            ->and(session('otp.challenge'))->toBeNull()
            ->and(session('auth.pending_method'))->toBeNull()
            ->and(Activity::query()->where('event', 'auth.login')->sole()->properties['method'])->toBe('otp');
    });

    it('lands on the dashboard', function (): void {
        flowCustomer();
        ($this->send)();

        ($this->verify)()->assertRedirect(route('customer.dashboard'));
    });

    it('lands on the page they were sent away from', function (): void {
        flowCustomer();
        $this->withSession(['url.intended' => url('/projects/abc')]);
        ($this->send)();

        ($this->verify)()->assertRedirect(url('/projects/abc'));
    });

    it('sets phone_verified_at when it was empty and announces the first verified contact', function (): void {
        Event::fake([ContactVerified::class]);
        $user = flowCustomer(['phone_verified_at' => null, 'first_contact_verified_at' => null]);
        ($this->send)();

        ($this->verify)();

        expect($user->refresh()->phone_verified_at)->not->toBeNull()
            ->and($user->first_contact_verified_at)->not->toBeNull();
        Event::assertDispatchedTimes(ContactVerified::class, 1);
    });

    it('leaves the time a number was verified at alone, and announces nothing again', function (): void {
        Event::fake([ContactVerified::class]);
        $user = flowCustomer(['phone_verified_at' => now()->subYear()]);
        $verifiedAt = $user->phone_verified_at;
        ($this->send)();

        ($this->verify)();

        expect($user->refresh()->phone_verified_at->equalTo($verifiedAt))->toBeTrue();
        Event::assertNotDispatched(ContactVerified::class);
    });

    it('does not let in a staff member, whose sign-in is the email form', function (): void {
        $staff = User::factory()->support()->create(['phone_e164' => FLOW_E164, 'phone_verified_at' => now()]);
        ($this->send)();

        ($this->verify)()->assertRedirectToRoute('login');

        $this->assertGuest();
        expect(($this->flashOf)())->toBe(trans_icu('auth.errors.staff_use_email'))
            ->and(session('otp.challenge'))->toBeNull()
            ->and($staff->refresh()->last_login_at)->toBeNull();
    });

    it('does not let in an account that is scheduled for deletion', function (): void {
        flowCustomer(['deleted_at' => now()->subDays(3)]);
        ($this->send)();

        ($this->verify)()->assertRedirectToRoute('login');

        $this->assertGuest();
        expect(($this->flashOf)())->toBe(trans_icu('auth.errors.account_pending_deletion'))
            ->and(User::withTrashed()->count())->toBe(1);
    });

    it('does not let in a deactivated account', function (): void {
        flowCustomer(['is_active' => false]);
        ($this->send)();

        ($this->verify)()->assertRedirectToRoute('login');

        $this->assertGuest();
        expect(($this->flashOf)())->toBe(trans_icu('auth.inactive'));
    });

    it('is not told apart from a wrong code by who owns the number', function (): void {
        flowCustomer();
        ($this->send)();

        ($this->verify)('000000')->assertSessionHasErrors('code');

        expect(session('errors')->get('code')[0])->toBe(trans_choice('auth.errors.otp_invalid', 4, ['attemptsLeft' => 4]))
            ->and(session('otp.challenge'))->not->toBeNull();
        $this->assertGuest();
    });
});

describe('verifying a number that has no account', function (): void {
    it('registers a customer who gave their name and accepted the terms, and signs them in', function (): void {
        Event::fake([CustomerRegistered::class, ContactVerified::class]);
        Notification::fake();
        ($this->send)(['intent' => 'register', 'name' => 'Maya Rao', 'terms' => '1']);

        $response = ($this->verify)();

        $user = User::query()->where('phone_e164', FLOW_E164)->sole();
        $this->assertAuthenticatedAs($user);
        $units = app(Settings::class)->units();
        expect($user->name)->toBe('Maya Rao')
            ->and($user->type)->toBe(UserType::Customer)
            ->and($user->email)->toBeNull()
            ->and($user->password)->toBeNull()
            ->and($user->phone_verified_at)->not->toBeNull()
            ->and($user->first_contact_verified_at)->not->toBeNull()
            ->and($user->terms_accepted_at)->not->toBeNull()
            ->and($user->email_verified_at)->toBeNull()
            ->and($user->onboarded_at)->toBeNull()
            ->and($user->is_active)->toBeTrue()
            ->and($user->timezone)->toBe(app(Settings::class)->business()->timezone)
            ->and($user->unit_system->value)->toBe($units->defaultSystem)
            ->and($user->length_unit->value)->toBe($units->defaultLengthUnit)
            ->and($user->locale)->toBe(config('app.locale'))
            ->and(flowRecaller($response))->not->toBeNull()
            ->and(session('otp.challenge'))->toBeNull()
            ->and(Activity::query()->where('event', 'auth.login')->sole()->properties['method'])->toBe('otp');
        Event::assertDispatchedTimes(CustomerRegistered::class, 1);
        Event::assertDispatched(CustomerRegistered::class, fn (CustomerRegistered $event): bool => $event->user->is($user));
        Event::assertDispatchedTimes(ContactVerified::class, 1);
    });

    it('greets them in the app only: there is no email to send to', function (): void {
        Notification::fake();
        ($this->send)(['intent' => 'register', 'name' => 'Maya Rao', 'terms' => '1']);

        ($this->verify)();

        $user = User::query()->where('phone_e164', FLOW_E164)->sole();
        Notification::assertSentTo($user, Welcome::class, fn (Welcome $notification, array $channels): bool => $channels === ['database']);
    });

    it('asks for a name when sign-in found no account', function (): void {
        ($this->send)();

        ($this->verify)()->assertRedirectToRoute('auth.otp.complete.show');

        $this->assertGuest();
        expect(User::query()->count())->toBe(0)
            ->and(session('otp.verified_phone.phone'))->toBe(FLOW_E164)
            ->and(session('otp.verified_phone.at'))->toBe(now()->getTimestamp())
            ->and(session('otp.challenge'))->toBeNull();
    });

    it('refuses while registration is closed', function (string $intent): void {
        flowCloseRegistration();
        ($this->send)($intent === 'register' ? ['intent' => 'register', 'name' => 'Maya Rao', 'terms' => '1'] : []);

        ($this->verify)()->assertRedirectToRoute('login');

        $this->assertGuest();
        expect(($this->flashOf)())->toBe(trans_icu('auth.registration_closed'))
            ->and(User::query()->count())->toBe(0)
            ->and(session('otp.verified_phone'))->toBeNull()
            ->and(session('otp.challenge'))->toBeNull();
    })->with(['register' => 'register', 'login' => 'login']);

    it('still signs an existing customer in while registration is closed', function (): void {
        flowCloseRegistration();
        flowCustomer();
        ($this->send)();

        ($this->verify)();

        $this->assertAuthenticated();
    });

    it('signs the existing customer in when a sign-up was asked for with the number of one', function (): void {
        $user = flowCustomer();
        ($this->send)(['intent' => 'register', 'name' => 'Somebody Else', 'terms' => '1']);

        ($this->verify)();

        $this->assertAuthenticatedAs($user);
        expect($user->refresh()->name)->not->toBe('Somebody Else')->and(User::query()->count())->toBe(1);
    });
});

describe('completing a sign-up (13 section 5.2)', function (): void {
    beforeEach(function (): void {
        $this->verifiedNumber = function (): void {
            ($this->send)();
            ($this->verify)();
        };
        $this->complete = fn (array $body = []): TestResponse => $this
            ->from(route('auth.otp.complete.show'))
            ->post(route('auth.otp.complete'), ['name' => 'Maya Rao', 'terms' => '1', ...$body]);
    });

    it('shows the name form for the masked number', function (): void {
        ($this->verifiedNumber)();

        $this->get(route('auth.otp.complete.show'))
            ->assertInertia(fn (Assert $page) => $page->component('Auth/PhoneComplete')->where('maskedPhone', '+91******3210')->has('features'));
    });

    it('creates the account and signs the customer in within fifteen minutes', function (): void {
        Event::fake([CustomerRegistered::class, ContactVerified::class]);
        ($this->verifiedNumber)();
        $this->travel(15)->minutes();

        $response = ($this->complete)()->assertRedirect(route('customer.dashboard'));

        $user = User::query()->where('phone_e164', FLOW_E164)->sole();
        $this->assertAuthenticatedAs($user);
        expect($user->name)->toBe('Maya Rao')
            ->and($user->email)->toBeNull()
            ->and($user->phone_verified_at)->not->toBeNull()
            ->and($user->terms_accepted_at)->not->toBeNull()
            ->and(flowRecaller($response))->not->toBeNull()
            ->and(session('otp.verified_phone'))->toBeNull()
            ->and(Activity::query()->where('event', 'auth.login')->sole()->properties['method'])->toBe('otp');
        Event::assertDispatchedTimes(CustomerRegistered::class, 1);
        Event::assertDispatchedTimes(ContactVerified::class, 1);
    });

    it('sends them back to the start with otp_expired after sixteen minutes', function (): void {
        ($this->verifiedNumber)();
        $this->travel(16)->minutes();

        ($this->complete)()->assertRedirectToRoute('auth.otp.create')->assertSessionHasErrors(['phone', 'code']);

        $this->assertGuest();
        expect(session('errors')->get('phone')[0])->toBe(__('auth.errors.otp_expired'))
            ->and(session('errors')->get('code')[0])->toBe('otp_expired')
            ->and(User::query()->count())->toBe(0)
            ->and(session('otp.verified_phone'))->toBeNull();
    });

    it('needs a number that was verified', function (): void {
        $this->get(route('auth.otp.complete.show'))->assertRedirectToRoute('auth.otp.create');
        ($this->complete)()->assertRedirectToRoute('auth.otp.create')->assertSessionHasErrors('code');
        $this->assertGuest();
    });

    it('asks for the name and the terms', function (array $body, string $field): void {
        ($this->verifiedNumber)();

        ($this->complete)($body)->assertRedirect(route('auth.otp.complete.show'))->assertSessionHasErrors($field);

        $this->assertGuest();
        expect(session('otp.verified_phone'))->not->toBeNull();
    })->with([
        'no name' => [['name' => ''], 'name'],
        'a short name' => [['name' => 'M'], 'name'],
        'a link in the name' => [['name' => 'www.spam.example'], 'name'],
        'no terms' => [['terms' => ''], 'terms'],
    ]);

    it('refuses while registration is closed', function (): void {
        ($this->verifiedNumber)();
        flowCloseRegistration();

        ($this->complete)()->assertRedirectToRoute('login');

        $this->assertGuest();
        expect(User::query()->count())->toBe(0)->and(($this->flashOf)())->toBe(trans_icu('auth.registration_closed'));
    });

    it('signs in the customer who got the number first, rather than failing on the duplicate', function (): void {
        ($this->verifiedNumber)();
        $first = flowCustomer();

        ($this->complete)()->assertRedirect(route('customer.dashboard'));

        $this->assertAuthenticatedAs($first);
        expect(User::query()->count())->toBe(1);
    });

    it('throttles like a registration', function (): void {
        foreach (range(1, 5) as $_) {
            ($this->complete)();
        }

        $this->postJson(route('auth.otp.complete'), ['name' => 'Maya Rao', 'terms' => '1'])->assertStatus(429);
    });
});

describe('sending again (13 section 4.4)', function (): void {
    it('sends a new code to the number of the challenge once the wait is over', function (): void {
        ($this->send)(['intent' => 'register', 'name' => 'Maya Rao', 'terms' => '1']);
        $first = $this->delivery->lastCode();
        $this->travel(61)->seconds();

        $this->from(route('auth.otp.verify.show'))->post(route('auth.otp.resend'))->assertRedirect(route('auth.otp.verify.show'));

        expect($this->delivery->sent())->toHaveCount(2)
            ->and($this->delivery->sent()[1]['e164'])->toBe(FLOW_E164)
            ->and(OtpCode::query()->whereNull('consumed_at')->where('expires_at', '>', now())->count())->toBe(1)
            ->and(session('otp.challenge.name'))->toBe('Maya Rao')
            ->and(session('otp.challenge.otpId'))->toBe(OtpCode::query()->latest('created_at')->latest('id')->value('id'));
        // The new code is the one that counts.
        ($this->verify)($first === $this->delivery->lastCode() ? '000000' : $first)->assertSessionHasErrors('code');
    });

    it('answers inside the wait with the cooldown', function (): void {
        ($this->send)();

        $this->from(route('auth.otp.verify.show'))->post(route('auth.otp.resend'))
            ->assertRedirect(route('auth.otp.verify.show'))
            ->assertSessionHasErrors(['phone', 'code', 'retryAfter', 'rate_limited']);

        expect(session('errors')->get('code')[0])->toBe('otp_cooldown')->and($this->delivery->sent())->toHaveCount(1);
    });

    it('sends on the channel asked for when it is available, and keeps to the default when it is not', function (): void {
        config(['features.sms' => true, 'features.whatsapp' => true]);
        $settings = app(Settings::class);
        $notifications = $settings->notifications();
        $notifications->whatsappTemplates['auth.otp'] = new WhatsAppTemplateData('auth_otp', 'en', []);
        $settings->put(SettingsGroup::Notifications, $notifications);

        ($this->send)();
        expect($this->delivery->sent()[0]['channel'])->toBe(OtpChannel::Whatsapp);
        $this->travel(61)->seconds();

        $this->from(route('auth.otp.verify.show'))->post(route('auth.otp.resend'), ['channel' => 'sms']);
        expect($this->delivery->sent()[1]['channel'])->toBe(OtpChannel::Sms)
            ->and(session('otp.challenge.channel'))->toBe('sms')
            ->and(OtpCode::query()->latest('created_at')->latest('id')->first()->channel)->toBe(OtpChannel::Sms);
        $this->travel(61)->seconds();

        $this->from(route('auth.otp.verify.show'))->post(route('auth.otp.resend'), ['channel' => 'whatsapp']);
        expect($this->delivery->sent()[2]['channel'])->toBe(OtpChannel::Whatsapp);
        $this->travel(61)->seconds();

        config(['features.whatsapp' => false]);
        $this->from(route('auth.otp.verify.show'))->post(route('auth.otp.resend'), ['channel' => 'whatsapp'])->assertSessionHasNoErrors();
        expect($this->delivery->sent()[3]['channel'])->toBe(OtpChannel::Sms);
    });

    it('refuses a channel that does not exist', function (): void {
        ($this->send)();
        $this->travel(61)->seconds();

        $this->from(route('auth.otp.verify.show'))->post(route('auth.otp.resend'), ['channel' => 'telegram'])->assertSessionHasErrors('channel');
    });
});

describe('the status of the code (13 section 4.2)', function (): void {
    it('is limited, as the poll of a page is no reason to be asked without end', function (): void {
        ($this->send)();

        foreach (range(1, 60) as $_) {
            $this->getJson(route('auth.otp.status'))->assertOk();
        }

        $this->getJson(route('auth.otp.status'))->assertStatus(429);
    });

    it('says the channel the code went by, and that no fallback happened', function (): void {
        ($this->send)();

        $this->getJson(route('auth.otp.status'))->assertOk()->assertExactJson(['channel' => 'sms', 'fallbackSent' => false]);
    });

    it('is a 404 without a challenge', function (): void {
        $this->getJson(route('auth.otp.status'))->assertNotFound()->assertExactJson(['code' => 'no_challenge']);
    });

    it('answers for the challenge of a number being added to an account too', function (): void {
        $this->withSession(['otp.challenge' => [
            'e164' => FLOW_E164, 'purpose' => 'verify_phone', 'intent' => 'verify_phone', 'channel' => 'whatsapp',
            'otpId' => Str::ulid()->toBase32(), 'expiresAt' => now()->addMinutes(10)->getTimestamp(),
        ]])->getJson(route('auth.otp.status'))->assertOk()->assertExactJson(['channel' => 'whatsapp', 'fallbackSent' => false]);
    });

    it('is a 404 for a challenge it cannot read', function (): void {
        $this->withSession(['otp.challenge' => ['e164' => FLOW_E164]])->getJson(route('auth.otp.status'))->assertNotFound();
    });
});

describe('a challenge of another intent', function (): void {
    it('is not one to show, verify or resend in the guest flow: a re-authentication cannot be swapped into a sign-in', function (): void {
        $this->withSession(['otp.challenge' => [
            'e164' => FLOW_E164, 'purpose' => 'login', 'intent' => 'reauthenticate', 'channel' => 'sms',
            'otpId' => Str::ulid()->toBase32(), 'expiresAt' => now()->addMinutes(10)->getTimestamp(),
        ]]);

        $this->get(route('auth.otp.verify.show'))->assertRedirectToRoute('auth.otp.create');
        $this->post(route('auth.otp.verify'), ['code' => '123456'])->assertRedirectToRoute('auth.otp.create');
        $this->post(route('auth.otp.resend'))->assertRedirectToRoute('auth.otp.create');
        $this->assertGuest();
    });
});

describe('a challenge of another purpose', function (): void {
    it('is not one to verify or resend in the guest flow', function (): void {
        $this->withSession(['otp.challenge' => [
            'e164' => FLOW_E164, 'purpose' => OtpPurpose::VerifyPhone->value, 'intent' => 'verify_phone', 'channel' => 'sms',
            'otpId' => Str::ulid()->toBase32(), 'expiresAt' => now()->addMinutes(10)->getTimestamp(),
        ]]);

        $this->post(route('auth.otp.verify'), ['code' => '123456'])->assertRedirectToRoute('auth.otp.create');
        $this->post(route('auth.otp.resend'))->assertRedirectToRoute('auth.otp.create');
        $this->assertGuest();
    });
});
