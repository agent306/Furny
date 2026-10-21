<?php

declare(strict_types=1);

use App\Domain\Identity\Actions\SendOtp;
use App\Domain\Identity\Enums\OtpChannel;
use App\Domain\Identity\Enums\OtpPurpose;
use App\Domain\Identity\Models\OtpCode;
use App\Domain\Identity\Models\User;
use App\Domain\Identity\Otp\ArrayOtpDelivery;
use App\Domain\Identity\Otp\OtpChannelResolver;
use App\Domain\Identity\Otp\OtpDelivery;
use App\Domain\Identity\Otp\OtpException;
use App\Domain\Identity\Otp\OtpLimits;
use App\Rules\TurnstileToken;
use App\Support\Settings\Groups\WhatsAppTemplateData;
use App\Support\Settings\Settings;
use App\Support\Settings\SettingsGroup;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Session;
use Spatie\Activitylog\Models\Activity;

const OTP_PHONE = '98765 43210';
const OTP_E164 = '+919876543210';
const OTP_IP = '203.0.113.45';

beforeEach(function (): void {
    $this->delivery = app(OtpDelivery::class);
    // One send; a different number and address each time unless the test says otherwise.
    $this->send = fn (string $phone = OTP_PHONE, ?string $ip = OTP_IP, ?string $token = null, OtpPurpose $purpose = OtpPurpose::Login) => app(SendOtp::class)->handle($phone, $purpose, $ip, $token);
});

/** The refusal of a call, or a failed test when it went through. */
function otpRefusal(Closure $call): OtpException
{
    try {
        $call();
    } catch (OtpException $exception) {
        return $exception;
    }

    throw new RuntimeException('Expected an OtpException.');
}

/** The n-th valid Indian mobile number, written the way a user types it. */
function otpPhone(int $n): string
{
    return '98765 43'.str_pad((string) $n, 3, '0', STR_PAD_LEFT);
}

function otpEnableWhatsapp(): void
{
    $settings = app(Settings::class);
    $notifications = $settings->notifications();
    $notifications->whatsappTemplates['auth.otp'] = new WhatsAppTemplateData('auth_otp', 'en', []);
    $settings->put(SettingsGroup::Notifications, $notifications);
}

function otpEnableCaptcha(): void
{
    config(['services.turnstile.site_key' => '1x00000000000000000000AA', 'services.turnstile.secret_key' => 'secret-value']);
}

function otpCloudflare(array $answer = []): void
{
    $host = parse_url((string) config('app.url'), PHP_URL_HOST);

    Http::fake(['challenges.cloudflare.com/*' => Http::response(['success' => true, 'hostname' => $host, 'action' => 'otp_send', ...$answer])]);
}

/** Everything logged from now on: [level, message, json of the context]. */
function otpLogRecords(): ArrayObject
{
    $records = new ArrayObject;
    Event::listen(MessageLogged::class, function (MessageLogged $log) use ($records): void {
        $records[] = [$log->level, $log->message, json_encode($log->context)];
    });

    return $records;
}

describe('the code (13 section 4.1)', function (): void {
    it('is six digits, delivered to the parsed number, and stored only as a hash that matches', function (): void {
        $this->freezeTime();

        $result = ($this->send)();
        $code = $this->delivery->lastCode();
        $row = OtpCode::query()->sole();

        expect($code)->toMatch('/^\d{6}$/')
            ->and($this->delivery->sent())->toHaveCount(1)
            ->and($this->delivery->sent()[0]['e164'])->toBe(OTP_E164)
            ->and($this->delivery->sent()[0]['otpId'])->toBe($row->id)
            ->and(Hash::check($code, $row->code_hash))->toBeTrue()
            ->and($row->code_hash)->not->toContain($code)
            ->and($row->phone_e164)->toBe(OTP_E164)
            ->and($row->purpose)->toBe(OtpPurpose::Login)
            ->and($row->attempts)->toBe(0)
            ->and($row->consumed_at)->toBeNull()
            ->and($row->ip)->toBe(OTP_IP)
            ->and($row->expires_at->diffInSeconds(now()->addMinutes(10), true))->toBeLessThan(1)
            ->and($result->otpId)->toBe($row->id)
            ->and($result->e164)->toBe(OTP_E164)
            ->and($result->maskedPhone)->toBe('+91******3210')
            ->and($result->channel)->toBe(OtpChannel::Sms);
    });

    it('can be any six digits, leading zeros included', function (): void {
        $codes = [];

        foreach (range(1, 12) as $n) {
            ($this->send)(otpPhone($n), '198.51.100.'.$n);
            $codes[] = $this->delivery->lastCode();
        }

        expect($codes)->each->toMatch('/^\d{6}$/')
            ->and(array_unique($codes))->not->toHaveCount(1);
    });

    it('is carried by the SMS text of 12 section 3.7, ending in the WebOTP line', function (): void {
        config(['app.name' => 'Furny', 'app.url' => 'https://furny.example/']);

        ($this->send)();
        $message = $this->delivery->sent()[0]['message'];
        $code = $this->delivery->lastCode();

        expect($message)->toBe("{$code} is your Furny verification code. It expires in 10 minutes. Do not share it.\n\n@furny.example #{$code}");
    });

    it('uses the business name, cut to 20 characters, when the application name is too long for an SMS', function (): void {
        config(['app.name' => 'A name of the application that is much too long']);
        $settings = app(Settings::class);
        $business = $settings->business();
        $business->name = 'Rao Custom Furniture Works Pvt Ltd';
        $settings->put(SettingsGroup::Business, $business);

        ($this->send)();

        expect($this->delivery->sent()[0]['message'])->toContain('is your Rao Custom Furniture verification code.');
    });
});

describe('earlier codes', function (): void {
    it('are expired by a new send for the same number and purpose, and a consumed one is left alone', function (): void {
        $this->freezeTime();
        $consumed = OtpCode::factory()->forPhone(OTP_E164)->consumed()->create(['expires_at' => now()->addMinutes(5)]);
        $first = ($this->send)();

        $this->travel(61)->seconds();
        $second = ($this->send)();

        expect(OtpCode::query()->findOrFail($first->otpId)->expires_at->lessThanOrEqualTo(now()))->toBeTrue()
            ->and(OtpCode::query()->findOrFail($second->otpId)->expires_at->greaterThan(now()))->toBeTrue()
            ->and($consumed->refresh()->expires_at->diffInSeconds(now()->subSeconds(61)->addMinutes(5), true))->toBeLessThan(1);
    });

    it('stay alive when the other number or the other purpose is sent a code', function (): void {
        $login = ($this->send)();
        $other = ($this->send)(otpPhone(1));
        $verify = ($this->send)(otpPhone(2), purpose: OtpPurpose::VerifyPhone);

        expect(OtpCode::query()->findOrFail($login->otpId)->expires_at->isFuture())->toBeTrue()
            ->and(OtpCode::query()->findOrFail($other->otpId)->expires_at->isFuture())->toBeTrue()
            ->and(OtpCode::query()->findOrFail($verify->otpId)->purpose)->toBe(OtpPurpose::VerifyPhone);
    });
});

describe('the numbers (13 section 4.2 step 1)', function (): void {
    it('refuses a number that is not valid, not mobile or not allowed, before anything is stored or sent', function (string $phone, string $code): void {
        $refusal = otpRefusal(fn () => ($this->send)($phone));

        expect($refusal->errorCode)->toBe($code)->and($refusal->status)->toBe(422)
            ->and(OtpCode::query()->count())->toBe(0)
            ->and($this->delivery->sent())->toBe([]);
    })->with([
        ['12ab', 'phone_invalid'],
        ['+91 80 2222 3333', 'phone_not_mobile'],
        ['+1 415 555 0100', 'phone_country_not_supported'],
    ]);

    it('reads a number typed without a country code in the country of the business, and allows the countries of the auth settings', function (): void {
        $settings = app(Settings::class);
        $business = $settings->business();
        $business->address = ['country_code' => 'ae'];
        $settings->put(SettingsGroup::Business, $business);
        $auth = $settings->auth();
        $auth->otpAllowedCountryCodes = ['AE'];
        $settings->put(SettingsGroup::Auth, $auth);

        $result = ($this->send)('050 123 4567');

        expect($result->e164)->toBe('+971501234567');
        expect(otpRefusal(fn () => ($this->send)('+91 98765 43210'))->errorCode)->toBe('phone_country_not_supported');
    });

    it('falls back to the first allowed country when the business has no address', function (): void {
        $settings = app(Settings::class);
        $auth = $settings->auth();
        $auth->otpAllowedCountryCodes = ['AE'];
        $settings->put(SettingsGroup::Auth, $auth);

        expect(($this->send)('050 123 4567')->e164)->toBe('+971501234567');
    });
});

describe('limits (13 section 4.2 step 2)', function (): void {
    it('refuses a second send within 60 seconds as otp_cooldown with the wait, and sends again after 61', function (): void {
        ($this->send)();

        $refusal = otpRefusal(fn () => ($this->send)());

        expect($refusal->errorCode)->toBe('otp_cooldown')->and($refusal->status)->toBe(429)
            ->and($refusal->context['retryAfter'])->toBeInt()->toBeBetween(1, 60)
            ->and($this->delivery->sent())->toHaveCount(1);

        $this->travel(61)->seconds();
        ($this->send)();

        expect($this->delivery->sent())->toHaveCount(2);
    });

    it('counts the wait down', function (): void {
        ($this->send)();
        $this->travel(45)->seconds();

        expect(otpRefusal(fn () => ($this->send)())->context['retryAfter'])->toBeBetween(1, 15);
    });

    it('allows five sends an hour to one number and refuses the sixth as otp_rate_limited', function (): void {
        foreach (range(1, 5) as $_) {
            ($this->send)();
            $this->travel(61)->seconds();
        }

        $refusal = otpRefusal(fn () => ($this->send)());

        expect($refusal->errorCode)->toBe('otp_rate_limited')->and($refusal->status)->toBe(429)
            ->and($refusal->context['retryAfter'])->toBeGreaterThan(0)
            ->and($this->delivery->sent())->toHaveCount(5);

        $this->travel(61)->minutes();
        ($this->send)();

        expect($this->delivery->sent())->toHaveCount(6);
    });

    it('allows ten sends an hour from one IP across numbers and refuses the eleventh', function (): void {
        foreach (range(1, 10) as $n) {
            ($this->send)(otpPhone($n));
        }

        $refusal = otpRefusal(fn () => ($this->send)(otpPhone(11)));

        expect($refusal->errorCode)->toBe('otp_rate_limited')->and($refusal->status)->toBe(429)
            ->and($this->delivery->sent())->toHaveCount(10);

        // Another address is not limited.
        ($this->send)(otpPhone(11), '198.51.100.7');

        expect($this->delivery->sent())->toHaveCount(11);
    });

    it('counts the addresses of one IPv6 /64 as one IP', function (): void {
        foreach (range(1, 10) as $n) {
            ($this->send)(otpPhone($n), "2001:db8:1:2::{$n}");
        }

        expect(otpRefusal(fn () => ($this->send)(otpPhone(11), '2001:db8:1:2:aaaa::1'))->errorCode)->toBe('otp_rate_limited');

        ($this->send)(otpPhone(11), '2001:db8:1:3::1');

        expect($this->delivery->sent())->toHaveCount(11);
    });

    it('keeps no number in the keys of the counters', function (): void {
        ($this->send)();

        $keys = array_keys((new ReflectionProperty(Cache::store()->getStore(), 'storage'))->getValue(Cache::store()->getStore()));

        expect(implode(' ', $keys))->not->toContain('9876543210')->and(implode(' ', $keys))->toContain('otp-send:phone:');
    });

    it('does not count a refused send', function (): void {
        otpRefusal(fn () => ($this->send)('12ab'));
        otpRefusal(fn () => ($this->send)('+1 415 555 0100'));

        expect(RateLimiter::attempts(OtpLimits::key(OtpLimits::SEND, 'ip', OTP_E164, OTP_IP)))->toBe(0)
            ->and(Session::get('otp.sends'))->toBeNull();
    });
});

describe('captcha escalation (13 section 4.2 step 3)', function (): void {
    beforeEach(function (): void {
        otpEnableCaptcha();
    });

    it('is not asked for before the third send, and is asked for on the third', function (): void {
        ($this->send)();
        $this->travel(61)->seconds();
        ($this->send)();
        $this->travel(61)->seconds();

        $refusal = otpRefusal(fn () => ($this->send)());

        expect($refusal->errorCode)->toBe('captcha_required')->and($refusal->status)->toBe(422)
            ->and($this->delivery->sent())->toHaveCount(2)
            ->and(OtpCode::query()->count())->toBe(2);
    });

    it('lets the third send through with a token Cloudflare confirms for the otp_send form', function (): void {
        foreach (range(1, 2) as $_) {
            ($this->send)();
            $this->travel(61)->seconds();
        }

        otpCloudflare();
        ($this->send)(token: 'a-token');

        expect($this->delivery->sent())->toHaveCount(3);
        Http::assertSent(fn ($request): bool => $request->url() === TurnstileToken::VERIFY_URL && $request['response'] === 'a-token');
    });

    it('keeps refusing a token for another form, a token Cloudflare rejects, and a missing or empty token', function (array $answer, ?string $token): void {
        foreach (range(1, 2) as $_) {
            ($this->send)();
            $this->travel(61)->seconds();
        }
        otpCloudflare($answer);

        expect(otpRefusal(fn () => ($this->send)(token: $token))->errorCode)->toBe('captcha_required')
            ->and($this->delivery->sent())->toHaveCount(2);
    })->with([
        'another form' => [['action' => 'register'], 'a-token'],
        'rejected' => [['success' => false], 'a-token'],
        'another site' => [['hostname' => 'evil.example'], 'a-token'],
        'no token' => [[], null],
        'empty token' => [[], ''],
    ]);

    it('fails closed when Cloudflare cannot be reached', function (): void {
        foreach (range(1, 2) as $_) {
            ($this->send)();
            $this->travel(61)->seconds();
        }
        Http::fake(fn () => throw new ConnectionException('timeout'));

        expect(otpRefusal(fn () => ($this->send)(token: 'a-token'))->errorCode)->toBe('captcha_required')
            ->and($this->delivery->sent())->toHaveCount(2);
    });

    it('is asked for on the first send while auth:captcha_always is set', function (): void {
        Cache::put('auth:captcha_always', true, now()->addHour());

        expect(otpRefusal(fn () => ($this->send)())->errorCode)->toBe('captcha_required');

        otpCloudflare();
        ($this->send)(token: 'a-token');

        expect($this->delivery->sent())->toHaveCount(1);
    });

    it('is asked for after two sends in one session, whatever the numbers and addresses', function (): void {
        ($this->send)(otpPhone(1), '198.51.100.1');
        ($this->send)(otpPhone(2), '198.51.100.2');

        expect(otpRefusal(fn () => ($this->send)(otpPhone(3), '198.51.100.3'))->errorCode)->toBe('captcha_required');
    });

    it('is asked for after two sends to one number, in a new session from another address', function (): void {
        ($this->send)(OTP_PHONE, '198.51.100.1');
        $this->travel(61)->seconds();
        ($this->send)(OTP_PHONE, '198.51.100.2');
        $this->travel(61)->seconds();
        Session::flush();

        expect(otpRefusal(fn () => ($this->send)(OTP_PHONE, '198.51.100.3'))->errorCode)->toBe('captcha_required');
    });

    it('is asked for after two sends from one IP, in a new session to another number', function (): void {
        ($this->send)(otpPhone(1));
        ($this->send)(otpPhone(2));
        Session::flush();

        expect(otpRefusal(fn () => ($this->send)(otpPhone(3)))->errorCode)->toBe('captcha_required');
    });

    it('is never asked for while the captcha feature is off', function (): void {
        config(['services.turnstile.site_key' => '', 'services.turnstile.secret_key' => '']);
        Http::fake();
        Cache::put('auth:captcha_always', true, now()->addHour());

        foreach (range(1, 4) as $_) {
            ($this->send)();
            $this->travel(61)->seconds();
        }

        expect($this->delivery->sent())->toHaveCount(4);
        Http::assertNothingSent();
    });
});

describe('channels (13 section 4.2 steps 4 and 7)', function (): void {
    it('answers otp_unavailable (503) and logs a critical record when no channel is available', function (): void {
        config(['features.sms' => false, 'features.whatsapp' => false]);
        $records = otpLogRecords();

        $refusal = otpRefusal(fn () => ($this->send)());

        expect($refusal->errorCode)->toBe('otp_unavailable')->and($refusal->status)->toBe(503)
            ->and(OtpCode::query()->count())->toBe(0)
            ->and(collect($records)->contains(fn (array $record): bool => $record[0] === 'critical' && $record[1] === 'otp.no_channel'))->toBeTrue();
    });

    it('tries WhatsApp first when it is configured', function (): void {
        otpEnableWhatsapp();

        $result = ($this->send)();

        expect($result->channel)->toBe(OtpChannel::Whatsapp)
            ->and($this->delivery->sent())->toHaveCount(1)
            ->and($this->delivery->sent()[0]['channel'])->toBe(OtpChannel::Whatsapp)
            ->and(OtpCode::query()->sole()->channel)->toBe(OtpChannel::Whatsapp);
    });

    it('falls back to SMS when WhatsApp refuses, and records the channel that carried the code', function (): void {
        otpEnableWhatsapp();
        $this->delivery->failOn(OtpChannel::Whatsapp);

        $result = ($this->send)();

        expect($result->channel)->toBe(OtpChannel::Sms)
            ->and($this->delivery->sent())->toHaveCount(1)
            ->and($this->delivery->sent()[0]['channel'])->toBe(OtpChannel::Sms)
            ->and(OtpCode::query()->sole()->channel)->toBe(OtpChannel::Sms)
            ->and(Hash::check($this->delivery->lastCode(), OtpCode::query()->sole()->code_hash))->toBeTrue();
    });

    it('answers otp_send_failed (503) and expires the code when every channel refuses', function (): void {
        otpEnableWhatsapp();
        $this->delivery->failOn(OtpChannel::Whatsapp, OtpChannel::Sms);

        $refusal = otpRefusal(fn () => ($this->send)());
        $row = OtpCode::query()->sole();

        expect($refusal->errorCode)->toBe('otp_send_failed')->and($refusal->status)->toBe(503)
            ->and($row->expires_at->lessThanOrEqualTo(now()))->toBeTrue()
            ->and($this->delivery->sent())->toBe([]);
    });

    it('expires the code and lets the error through when a channel fails in an unexpected way', function (): void {
        $this->app->instance(OtpDelivery::class, new class implements OtpDelivery
        {
            public function send(OtpChannel $channel, string $e164, string $message, string $otpId): void
            {
                throw new LogicException('driver bug');
            }
        });

        expect(fn () => app(SendOtp::class)->handle(OTP_PHONE, OtpPurpose::Login, OTP_IP, null))->toThrow(LogicException::class, 'driver bug');
        expect(OtpCode::query()->sole()->expires_at->lessThanOrEqualTo(now()))->toBeTrue();
    });

    it('leaves SMS out once the global hourly cap is reached, so the code goes by WhatsApp', function (): void {
        otpEnableWhatsapp();
        Cache::put(OtpLimits::globalKey(), 200, now()->addHour());

        expect(app(OtpChannelResolver::class)->available(OTP_E164))->toBe([OtpChannel::Whatsapp])
            ->and(($this->send)()->channel)->toBe(OtpChannel::Whatsapp);
    });

    it('answers otp_unavailable when the cap is reached and SMS is all there is', function (): void {
        Cache::put(OtpLimits::globalKey(), 200, now()->addHour());

        expect(otpRefusal(fn () => ($this->send)())->errorCode)->toBe('otp_unavailable');
    });

    it('takes the cap from the auth settings and counts every send against it', function (): void {
        $settings = app(Settings::class);
        $auth = $settings->auth();
        $auth->otpGlobalHourlyCap = 2;
        $settings->put(SettingsGroup::Auth, $auth);

        ($this->send)(otpPhone(1));
        ($this->send)(otpPhone(2));

        expect(Cache::get(OtpLimits::globalKey()))->toBe(2)
            ->and(otpRefusal(fn () => ($this->send)(otpPhone(3)))->errorCode)->toBe('otp_unavailable');

        $this->travel(61)->minutes();

        expect(($this->send)(otpPhone(3))->channel)->toBe(OtpChannel::Sms);
    });
});

describe('what is configured (OtpChannelResolver)', function (): void {
    it('lists SMS alone by default, as WhatsApp has no auth.otp template', function (): void {
        expect(app(OtpChannelResolver::class)->available(OTP_E164))->toBe([OtpChannel::Sms]);
    });

    it('follows notifications.otp_channel_order', function (): void {
        otpEnableWhatsapp();
        $settings = app(Settings::class);
        $notifications = $settings->notifications();
        $notifications->otpChannelOrder = ['sms', 'whatsapp'];
        $settings->put(SettingsGroup::Notifications, $notifications);

        expect(app(OtpChannelResolver::class)->available(OTP_E164))->toBe([OtpChannel::Sms, OtpChannel::Whatsapp]);
    });

    it('leaves out a channel whose feature flag is off, or that has no auth.otp template', function (): void {
        otpEnableWhatsapp();
        config(['features.whatsapp' => false]);

        expect(app(OtpChannelResolver::class)->available(OTP_E164))->toBe([OtpChannel::Sms]);

        config(['features.whatsapp' => true, 'features.sms' => false]);

        expect(app(OtpChannelResolver::class)->available(OTP_E164))->toBe([OtpChannel::Whatsapp]);

        config(['features.sms' => true]);
        $settings = app(Settings::class);
        $notifications = $settings->notifications();
        unset($notifications->smsTemplates['auth.otp']);
        $settings->put(SettingsGroup::Notifications, $notifications);

        expect(app(OtpChannelResolver::class)->available(OTP_E164))->toBe([OtpChannel::Whatsapp]);
    });

    it('ignores channel names it does not know and lists a channel once', function (): void {
        $settings = app(Settings::class);
        $notifications = $settings->notifications();
        $notifications->otpChannelOrder = ['carrier-pigeon', 'sms', 'sms'];
        $settings->put(SettingsGroup::Notifications, $notifications);

        expect(app(OtpChannelResolver::class)->available(OTP_E164))->toBe([OtpChannel::Sms]);
    });
});

describe('the code stays secret (13 section 4.1)', function (): void {
    it('is never queued', function (): void {
        Queue::fake();
        otpEnableWhatsapp();
        $this->delivery->failOn(OtpChannel::Whatsapp);

        ($this->send)();

        Queue::assertNothingPushed();
    });

    it('is in no log record, on success or on failure', function (): void {
        $records = otpLogRecords();
        otpEnableWhatsapp();
        $this->delivery->failOn(OtpChannel::Whatsapp);

        ($this->send)();
        $code = $this->delivery->lastCode();
        $this->travel(61)->seconds();
        $this->delivery->failOn(OtpChannel::Whatsapp, OtpChannel::Sms);
        otpRefusal(fn () => ($this->send)());
        $this->travel(61)->seconds();
        config(['features.sms' => false, 'features.whatsapp' => false]);
        otpRefusal(fn () => ($this->send)());

        expect($records)->not->toBeEmpty();
        foreach ($records as [$level, $message, $context]) {
            expect($message.$context)->not->toContain($code)->not->toContain('9876543210');
        }
    });

    it('is not in the audit entry', function (): void {
        ($this->send)();

        expect(Activity::query()->sole()->properties->toJson())->not->toContain($this->delivery->lastCode());
    });
});

describe('the session and the audit (13 section 17)', function (): void {
    it('counts the sends of the session', function (): void {
        expect(Session::get('otp.sends'))->toBeNull();

        ($this->send)(otpPhone(1));
        expect(Session::get('otp.sends'))->toBe(1);

        ($this->send)(otpPhone(2));
        expect(Session::get('otp.sends'))->toBe(2);
    });

    it('records auth.otp_sent with the masked number, the channel, the purpose and the masked address', function (): void {
        ($this->send)(OTP_PHONE, OTP_IP, null, OtpPurpose::VerifyPhone);

        $entry = Activity::query()->where('event', 'auth.otp_sent')->sole();

        expect($entry->log_name)->toBe('security')
            ->and($entry->causer)->toBeNull()
            ->and($entry->properties->all())->toBe([
                'phone' => '+91******3210',
                'channel' => 'sms',
                'purpose' => 'verify_phone',
                'ip' => '203.0.113.0',
            ])
            ->and($entry->properties->toJson())->not->toContain('9876543210')->not->toContain('203.0.113.45');
    });

    it('names the signed-in user as the causer, and the channel that carried the code', function (): void {
        otpEnableWhatsapp();
        $this->delivery->failOn(OtpChannel::Whatsapp);
        $user = User::factory()->create();
        $this->actingAs($user);

        ($this->send)();

        $entry = Activity::query()->where('event', 'auth.otp_sent')->sole();
        expect($entry->causer?->is($user))->toBeTrue()->and($entry->properties['channel'])->toBe('sms');
    });

    it('records nothing for a send that failed', function (): void {
        $this->delivery->failOn(OtpChannel::Sms);

        otpRefusal(fn () => ($this->send)());

        expect(Activity::query()->where('event', 'auth.otp_sent')->count())->toBe(0);
    });

    it('stores no address when none is given, and one that is not an address is dropped', function (): void {
        ($this->send)(otpPhone(1), null);
        ($this->send)(otpPhone(2), 'not-an-ip');

        expect(OtpCode::query()->pluck('ip')->all())->toBe([null, null]);
    });
});

it('has the array delivery in the Feature suite', function (): void {
    expect($this->delivery)->toBeInstanceOf(ArrayOtpDelivery::class)->toBe(app(OtpDelivery::class));
});
