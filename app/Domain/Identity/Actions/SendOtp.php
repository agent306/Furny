<?php

declare(strict_types=1);

namespace App\Domain\Identity\Actions;

use App\Domain\Identity\Enums\OtpChannel;
use App\Domain\Identity\Enums\OtpPurpose;
use App\Domain\Identity\Models\OtpCode;
use App\Domain\Identity\Otp\OtpChannelResolver;
use App\Domain\Identity\Otp\OtpDelivery;
use App\Domain\Identity\Otp\OtpDeliveryException;
use App\Domain\Identity\Otp\OtpException;
use App\Domain\Identity\Otp\OtpLimits;
use App\Domain\Identity\Otp\OtpSendResult;
use App\Rules\TurnstileToken;
use App\Support\Features;
use App\Support\Phone\ParsedPhone;
use App\Support\Phone\PhoneNumberParser;
use App\Support\Privacy\Mask;
use App\Support\Settings\Settings;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Session;
use Illuminate\Support\Facades\Validator;
use Throwable;

/**
 * Sends a verification code to a phone (13 §4.2): parse, limits, captcha escalation, channel choice, store the hash,
 * deliver. Delivery is synchronous and the plain code lives in this method and in the delivered message only: it is
 * never stored, queued, logged or broadcast.
 *
 * Whether the number belongs to an account is not asked here, so the answer is the same for known and unknown numbers.
 * The caller keeps the session challenge (`otp.challenge`), which holds what only it knows (intent, name).
 */
final class SendOtp
{
    /** The send after this many earlier ones in a session, from a phone or from an IP needs a captcha (13 §4.1). */
    private const int CAPTCHA_AFTER_SENDS = 2;

    public function __construct(
        private readonly Settings $settings,
        private readonly OtpChannelResolver $channels,
        private readonly OtpDelivery $delivery,
    ) {}

    /**
     * @throws OtpException `phone_*` (422), `otp_cooldown`, `otp_rate_limited` (429), `captcha_required` (422),
     *                      `otp_unavailable`, `otp_send_failed` (503)
     */
    public function handle(string $rawPhone, OtpPurpose $purpose, ?string $ip, ?string $captchaToken): OtpSendResult
    {
        $e164 = $this->parse($rawPhone)->e164;
        $ip = $ip !== null && filter_var($ip, FILTER_VALIDATE_IP) !== false ? $ip : null;

        $this->assertWithinLimits($e164, $ip);
        $this->assertCaptcha($e164, $ip, $captchaToken);

        $channels = $this->channels->available($e164);

        if ($channels === []) {
            Log::critical('otp.no_channel', ['phone' => Mask::phone($e164)]);

            throw new OtpException('otp_unavailable', 503);
        }

        $code = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
        $otp = $this->store($e164, $purpose, $channels[0], $code, $ip);

        $this->countSend($e164, $ip);

        $channel = $this->deliver($otp, $e164, $code, $channels);

        activity('security')
            ->causedBy(Auth::user())
            ->event('auth.otp_sent')
            ->withProperties([
                'phone' => Mask::phone($e164),
                'channel' => $channel->value,
                'purpose' => $purpose->value,
                'ip' => Mask::ip((string) $ip),
            ])
            ->log('auth.otp_sent');

        return new OtpSendResult($channel, Mask::phone($e164), $otp->id, $e164);
    }

    private function parse(string $rawPhone): ParsedPhone
    {
        $allowed = $this->settings->auth()->otpAllowedCountryCodes;
        $country = $this->settings->business()->address['country_code'] ?? null;

        // The business country is the region of numbers typed without a country code; without one, the first
        // allowed country is. With no allowed country every number is refused anyway.
        $default = is_string($country) && preg_match('/^[A-Za-z]{2}$/', $country) === 1 ? $country : (reset($allowed) ?: 'ZZ');

        return PhoneNumberParser::parse($rawPhone, $default, $allowed);
    }

    private function assertWithinLimits(string $e164, ?string $ip): void
    {
        $cooldown = OtpLimits::key(OtpLimits::COOLDOWN, 'phone', $e164, $ip);

        if (RateLimiter::tooManyAttempts($cooldown, OtpLimits::limit(OtpLimits::COOLDOWN, 'phone')['max'])) {
            throw new OtpException('otp_cooldown', 429, ['retryAfter' => $this->retryAfter($cooldown)]);
        }

        foreach (['phone', 'ip'] as $kind) {
            $key = OtpLimits::key(OtpLimits::SEND, $kind, $e164, $ip);

            if (RateLimiter::tooManyAttempts($key, OtpLimits::limit(OtpLimits::SEND, $kind)['max'])) {
                throw new OtpException('otp_rate_limited', 429, ['retryAfter' => $this->retryAfter($key)]);
            }
        }
    }

    private function retryAfter(string $key): int
    {
        return max(1, RateLimiter::availableIn($key));
    }

    /** From the third send on (session, phone or IP), or while the conversion monitor has the captcha switched on for everyone. */
    private function assertCaptcha(string $e164, ?string $ip, ?string $token): void
    {
        if (! Features::enabled('captcha') || ! $this->captchaRequired($e164, $ip)) {
            return;
        }

        // Fail closed: an SMS costs money, so a check that cannot be made is a failed check (13 §3).
        $valid = $token !== null && $token !== '' && Validator::make(
            ['cf_turnstile_response' => $token],
            ['cf_turnstile_response' => [new TurnstileToken('otp_send', failOpen: false)]],
        )->passes();

        if (! $valid) {
            throw new OtpException('captcha_required', 422);
        }
    }

    private function captchaRequired(string $e164, ?string $ip): bool
    {
        return (int) Session::get('otp.sends', 0) >= self::CAPTCHA_AFTER_SENDS
            || RateLimiter::attempts(OtpLimits::key(OtpLimits::SEND, 'phone', $e164, $ip)) >= self::CAPTCHA_AFTER_SENDS
            || RateLimiter::attempts(OtpLimits::key(OtpLimits::SEND, 'ip', $e164, $ip)) >= self::CAPTCHA_AFTER_SENDS
            || Cache::has('auth:captcha_always');
    }

    /** The new code replaces every unconsumed one for the same number and purpose (13 §4.1). */
    private function store(string $e164, OtpPurpose $purpose, OtpChannel $channel, string $code, ?string $ip): OtpCode
    {
        $hash = Hash::make($code);

        return DB::transaction(function () use ($e164, $purpose, $channel, $hash, $ip): OtpCode {
            OtpCode::query()
                ->where('phone_e164', $e164)
                ->where('purpose', $purpose)
                ->whereNull('consumed_at')
                ->where('expires_at', '>', now())
                ->update(['expires_at' => now()]);

            return OtpCode::query()->create([
                'phone_e164' => $e164,
                'purpose' => $purpose,
                'channel' => $channel,
                'code_hash' => $hash,
                'attempts' => 0,
                'expires_at' => now()->addMinutes(OtpCode::LIFETIME_MINUTES),
                'ip' => $ip,
            ]);
        });
    }

    private function countSend(string $e164, ?string $ip): void
    {
        RateLimiter::hit(OtpLimits::key(OtpLimits::COOLDOWN, 'phone', $e164, $ip), OtpLimits::limit(OtpLimits::COOLDOWN, 'phone')['decay']);

        foreach (['phone', 'ip'] as $kind) {
            RateLimiter::hit(OtpLimits::key(OtpLimits::SEND, $kind, $e164, $ip), OtpLimits::limit(OtpLimits::SEND, $kind)['decay']);
        }

        Cache::add(OtpLimits::globalKey(), 0, now()->addHours(2));
        Cache::increment(OtpLimits::globalKey());
        Session::increment('otp.sends');
    }

    /**
     * Tries the channels in order; the first that takes the message is the one the row records. When none does the
     * code is dead on arrival, so it is expired.
     *
     * @param  non-empty-list<OtpChannel>  $channels
     */
    private function deliver(OtpCode $otp, string $e164, string $code, array $channels): OtpChannel
    {
        $message = trans_icu('notifications.auth.otp.sms', [
            'code' => $code,
            'appName' => $this->appName(),
            'domain' => (string) parse_url((string) config('app.url'), PHP_URL_HOST),
        ]);

        try {
            foreach ($channels as $channel) {
                try {
                    $this->delivery->send($channel, $e164, $message, $otp->id);
                } catch (OtpDeliveryException $exception) {
                    // The class only: a provider's error text may repeat the message, and the message holds the code.
                    Log::warning('otp.delivery_failed', ['channel' => $channel->value, 'exception' => $exception::class]);

                    continue;
                }

                if ($channel !== $otp->channel) {
                    $otp->update(['channel' => $channel]);
                }

                return $channel;
            }
        } catch (Throwable $exception) {
            $this->expire($otp);

            throw $exception;
        }

        $this->expire($otp);

        throw new OtpException('otp_send_failed', 503);
    }

    private function expire(OtpCode $otp): void
    {
        $otp->update(['expires_at' => now()]);
    }

    /** SMS texts carry the application name, which must fit in 20 characters (12 §3.7); a longer one gives way to the business name. */
    private function appName(): string
    {
        $name = (string) config('app.name');

        return mb_strlen($name) > 20 ? mb_substr($this->settings->business()->name, 0, 20) : $name;
    }
}
