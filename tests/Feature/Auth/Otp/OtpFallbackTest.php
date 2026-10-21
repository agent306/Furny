<?php

declare(strict_types=1);

use App\Domain\Identity\Actions\SendOtp;
use App\Domain\Identity\Actions\VerifyOtp;
use App\Domain\Identity\Enums\OtpChannel;
use App\Domain\Identity\Enums\OtpPurpose;
use App\Domain\Identity\Models\OtpCode;
use App\Domain\Identity\Otp\OtpCodeGenerator;
use App\Domain\Identity\Otp\OtpDelivery;
use App\Domain\Identity\Otp\OtpException;
use App\Domain\Identity\Otp\OtpLimits;
use App\Support\Settings\Groups\WhatsAppTemplateData;
use App\Support\Settings\Settings;
use App\Support\Settings\SettingsGroup;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\RateLimiter;

/*
|--------------------------------------------------------------------------
| The asynchronous WhatsApp failure (13 section 4.2)
|--------------------------------------------------------------------------
|
| A status webhook that says a WhatsApp code was not delivered calls `SendOtp::fallBackToSms` with the id of the code.
| Delivery statuses arrive with the notification channels; these tests are the webhook.
*/

const FALLBACK_PHONE = '98765 43210';
const FALLBACK_E164 = '+919876543210';

beforeEach(function (): void {
    $this->travelTo(CarbonImmutable::parse('2026-10-21 12:20:00', 'UTC'));
    $this->delivery = app(OtpDelivery::class);

    $settings = app(Settings::class);
    $notifications = $settings->notifications();
    $notifications->whatsappTemplates['auth.otp'] = new WhatsAppTemplateData('auth_otp', 'en', []);
    $settings->put(SettingsGroup::Notifications, $notifications);

    // Codes 111111, 222222, ...: the first is the WhatsApp code, the next the one the fallback sends.
    $drawn = 0;
    $this->app->instance(OtpCodeGenerator::class, new OtpCodeGenerator(function () use (&$drawn): int {
        return 111111 * ++$drawn;
    }));

    // A code that went out on WhatsApp, as the login page sent it.
    $this->post(route('auth.otp.send'), ['phone' => FALLBACK_PHONE, 'intent' => 'login']);
    $this->otp = OtpCode::query()->sole();
    $this->fallBack = fn (?string $id = null): bool => app(SendOtp::class)->fallBackToSms($id ?? $this->otp->id);
});

it('starts on WhatsApp', function (): void {
    expect($this->otp->channel)->toBe(OtpChannel::Whatsapp)
        ->and($this->delivery->sent()[0]['channel'])->toBe(OtpChannel::Whatsapp);
    $this->getJson(route('auth.otp.status'))->assertExactJson(['channel' => 'whatsapp', 'fallbackSent' => false]);
});

it('sends a new code by SMS, expires the old one, and tells the page', function (): void {
    expect(($this->fallBack)())->toBeTrue();

    $new = OtpCode::query()->latest('created_at')->latest('id')->first();
    expect($this->delivery->sent())->toHaveCount(2)
        ->and($this->delivery->sent()[1]['channel'])->toBe(OtpChannel::Sms)
        ->and($this->delivery->sent()[1]['e164'])->toBe(FALLBACK_E164)
        ->and($this->delivery->sent()[1]['otpId'])->toBe($new->id)
        ->and($new->id)->not->toBe($this->otp->id)
        ->and($new->channel)->toBe(OtpChannel::Sms)
        ->and($this->otp->refresh()->expires_at->lessThanOrEqualTo(now()))->toBeTrue()
        ->and(Cache::get('otp:fallback:'.hash('sha256', FALLBACK_E164)))->toBe('sms');

    $this->getJson(route('auth.otp.status'))->assertExactJson(['channel' => 'sms', 'fallbackSent' => true]);
    // The challenge now follows the new code.
    expect(session('otp.challenge.channel'))->toBe('sms')->and(session('otp.challenge.otpId'))->toBe($new->id);

    // Only the new code verifies.
    $verify = fn (string $code) => app(VerifyOtp::class)->handle(FALLBACK_E164, OtpPurpose::Login, $code, '203.0.113.5');
    expect($this->delivery->lastCode())->toBe('222222')
        ->and(fn () => $verify('111111'))->toThrow(OtpException::class)
        ->and($verify('222222')->is($new))->toBeTrue();
});

it('keeps the fallback flag for ten minutes', function (): void {
    ($this->fallBack)();

    $this->travel(9)->minutes();
    expect(Cache::has('otp:fallback:'.hash('sha256', FALLBACK_E164)))->toBeTrue();

    $this->travel(2)->minutes();
    expect(Cache::has('otp:fallback:'.hash('sha256', FALLBACK_E164)))->toBeFalse();
});

it('goes through the cooldown that a new send would not', function (): void {
    expect(Cache::has(OtpLimits::cooldownKey(FALLBACK_E164)))->toBeTrue();

    expect(($this->fallBack)())->toBeTrue();
});

it('counts toward the hourly limits', function (): void {
    $key = OtpLimits::key(OtpLimits::SEND, 'phone', FALLBACK_E164, null);
    $before = RateLimiter::attempts($key);

    ($this->fallBack)();

    expect(RateLimiter::attempts($key))->toBe($before + 1);
});

it('does nothing when the phone has used its hourly sends', function (): void {
    $key = OtpLimits::key(OtpLimits::SEND, 'phone', FALLBACK_E164, null);
    foreach (range(1, 4) as $_) {
        RateLimiter::hit($key, 3600);
    }

    expect(($this->fallBack)())->toBeFalse()
        ->and($this->delivery->sent())->toHaveCount(1)
        ->and(RateLimiter::attempts($key))->toBe(5)
        ->and(Cache::has('otp:fallback:'.hash('sha256', FALLBACK_E164)))->toBeFalse()
        ->and($this->otp->refresh()->expires_at->isFuture())->toBeTrue();
    $this->getJson(route('auth.otp.status'))->assertExactJson(['channel' => 'whatsapp', 'fallbackSent' => false]);
});

it('does nothing when SMS is not available', function (string $how): void {
    match ($how) {
        'feature' => config(['features.sms' => false]),
        'cap' => Cache::put(OtpLimits::globalKey(), 200, 7200),
    };

    expect(($this->fallBack)())->toBeFalse()->and($this->delivery->sent())->toHaveCount(1);
})->with(['the feature is off' => 'feature', 'the global cap is reached' => 'cap']);

it('does nothing for a code that was used, has expired, went by SMS, or does not exist', function (string $case): void {
    match ($case) {
        'consumed' => $this->otp->update(['consumed_at' => now()]),
        'expired' => $this->otp->update(['expires_at' => now()->subSecond()]),
        'sms' => $this->otp->update(['channel' => OtpChannel::Sms]),
        'unknown' => null,
    };

    expect(($this->fallBack)($case === 'unknown' ? '01JA0000000000000000000000' : null))->toBeFalse()
        ->and($this->delivery->sent())->toHaveCount(1);
})->with(['consumed' => 'consumed', 'expired' => 'expired', 'by SMS' => 'sms', 'unknown' => 'unknown']);

it('does nothing for a second failure report of the same code', function (): void {
    expect(($this->fallBack)())->toBeTrue();

    expect(($this->fallBack)())->toBeFalse()->and($this->delivery->sent())->toHaveCount(2);
});

it('tells the page nothing of a fallback that belongs to another number', function (): void {
    Cache::put('otp:fallback:'.hash('sha256', '+919876543299'), 'sms', 600);

    $this->getJson(route('auth.otp.status'))->assertExactJson(['channel' => 'whatsapp', 'fallbackSent' => false]);
});
