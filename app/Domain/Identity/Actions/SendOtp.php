<?php

declare(strict_types=1);

namespace App\Domain\Identity\Actions;

use App\Domain\Identity\Enums\OtpChannel;
use App\Domain\Identity\Enums\OtpPurpose;
use App\Domain\Identity\Models\OtpCode;
use App\Domain\Identity\Otp\OtpChannelResolver;
use App\Domain\Identity\Otp\OtpCodeGenerator;
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
use SensitiveParameter;
use Throwable;

/**
 * Sends a verification code to a phone (13 §4.2): parse, limits, captcha escalation, channel choice, store the hash,
 * deliver. Delivery is synchronous and the plain code lives in this method and in the delivered message only: it is
 * never stored, queued, logged or broadcast.
 *
 * The cooldown, the hourly limits and the global cap are reserved before any slow work (the captcha call, bcrypt,
 * the transaction): the cooldown with an atomic `Cache::add`, the counters by incrementing first and comparing the
 * count that came back. Parallel requests therefore cannot all pass a check that none of them has counted yet. A
 * send that is refused before it is tried gives its reservations back; one whose channels all failed (they threw
 * `OtpDeliveryException`: definitely not sent) gives back the number's and the system's counters, but keeps the
 * cooldown and the IP's count, so failures cannot be used to try without limit.
 *
 * Whether the number belongs to an account is not asked here, so the answer is the same for known and unknown numbers.
 * The caller keeps the session challenge (`otp.challenge`), which holds what only it knows (intent, name).
 */
final class SendOtp
{
    /** The send after this many earlier ones in a session, from a phone or from an IP needs a captcha (13 §4.1). */
    private const int CAPTCHA_AFTER_SENDS = 2;

    /** The window of the session's send count (13 §4.1: "within the hour"). */
    private const int SESSION_WINDOW_SECONDS = 3600;

    public function __construct(
        private readonly Settings $settings,
        private readonly OtpChannelResolver $channels,
        private readonly OtpDelivery $delivery,
        private readonly OtpCodeGenerator $codes,
    ) {}

    /**
     * @throws OtpException `phone_*` (422), `otp_cooldown`, `otp_rate_limited` (429), `captcha_required` (422),
     *                      `captcha_unavailable`, `otp_unavailable`, `otp_send_failed` (503)
     */
    public function handle(string $rawPhone, OtpPurpose $purpose, ?string $ip, ?string $captchaToken): OtpSendResult
    {
        $e164 = $this->parse($rawPhone)->e164;
        $ip = $ip !== null && filter_var($ip, FILTER_VALIDATE_IP) !== false ? $ip : null;

        $this->reserveCooldown($e164);

        // What is reserved from here on, to give back when this send does not happen. Keyed by what is counted.
        $counters = [];

        try {
            $phoneCount = $this->reserveHourly($e164, $ip, 'phone', $counters);
            $ipCount = $this->reserveHourly($e164, $ip, 'ip', $counters);
            $globalCount = $this->reserveGlobal($counters);

            $this->assertCaptcha($captchaToken, $phoneCount, $ipCount);

            $channels = $this->channels->available($e164, $globalCount);

            if ($channels === []) {
                Log::critical('otp.no_channel', ['phone' => Mask::phone($e164)]);

                throw new OtpException('otp_unavailable', 503);
            }

            $code = $this->codes->generate();
            $otp = $this->store($e164, $purpose, $channels[0], $code, $ip);
        } catch (Throwable $exception) {
            $this->release($counters);
            Cache::forget(OtpLimits::cooldownKey($e164));

            throw $exception;
        }

        $this->countSessionSend();

        try {
            $channel = $this->deliver($otp, $e164, $code, $channels);
        } catch (Throwable $exception) {
            // Nothing went out: the number and the system get their places back, the cooldown stays (13 §4.2). The
            // IP does not, so that forced failures cannot give one address unlimited tries: they count toward its
            // limit and its captcha like any send.
            unset($counters['ip']);
            $this->release($counters);

            throw $exception;
        }

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

        return PhoneNumberParser::parse($rawPhone, PhoneNumberParser::defaultRegion($this->settings), $allowed);
    }

    /** One winner among parallel sends to a number: the first to `add` the key holds the cooldown. */
    private function reserveCooldown(string $e164): void
    {
        $key = OtpLimits::cooldownKey($e164);
        $seconds = OtpLimits::limit(OtpLimits::COOLDOWN, 'phone')['decay'];
        $endsAt = now()->getTimestamp() + $seconds;

        if (! Cache::add($key, $endsAt, $seconds)) {
            $left = (int) Cache::get($key, $endsAt) - now()->getTimestamp();

            throw new OtpException('otp_cooldown', 429, ['retryAfter' => max(1, min($seconds, $left))]);
        }
    }

    /**
     * Counts this send against the hourly limit of a number or an IP, and refuses it when the count that came back is
     * over the limit. The count is the place in line, so it stays valid however many requests run in parallel.
     *
     * @param  array<string, array{string, int}>  $counters  reserved so far, as [key, window]; this one is added
     */
    private function reserveHourly(string $e164, ?string $ip, string $kind, array &$counters): int
    {
        $key = OtpLimits::key(OtpLimits::SEND, $kind, $e164, $ip);
        ['max' => $max, 'decay' => $decay] = OtpLimits::limit(OtpLimits::SEND, $kind);

        $count = RateLimiter::hit($key, $decay);
        $counters[$kind] = [$key, $decay];

        if ($count > $max) {
            throw new OtpException('otp_rate_limited', 429, ['retryAfter' => max(1, RateLimiter::availableIn($key))]);
        }

        return $count;
    }

    /**
     * The system-wide count of sends this hour; the channels decide from the place this send got in it.
     *
     * @param  array<string, array{string, int}>  $counters
     */
    private function reserveGlobal(array &$counters): int
    {
        $key = OtpLimits::globalKey();

        Cache::add($key, 0, now()->addHours(2));
        $counters['global'] = [$key, 0];

        return (int) Cache::increment($key);
    }

    /** @param  array<string, array{string, int}>  $counters */
    private function release(array $counters): void
    {
        foreach ($counters as [$key, $decay]) {
            if ($decay === 0) {
                Cache::decrement($key);

                continue;
            }

            if (RateLimiter::decrement($key, $decay) < 0) {
                RateLimiter::clear($key);
            }
        }
    }

    /**
     * From the third send on (session, phone or IP), or while the conversion monitor has the captcha switched on for
     * everyone. The phone and IP counts are the reserved ones, which include this send.
     */
    private function assertCaptcha(?string $token, int $phoneCount, int $ipCount): void
    {
        if (! Features::enabled('captcha')) {
            return;
        }

        $required = $this->sessionSends() >= self::CAPTCHA_AFTER_SENDS
            || $phoneCount > self::CAPTCHA_AFTER_SENDS
            || $ipCount > self::CAPTCHA_AFTER_SENDS
            || Cache::has('auth:captcha_always');

        if (! $required) {
            return;
        }

        if ($token === null || $token === '') {
            throw new OtpException('captcha_required', 422);
        }

        // Fail closed: an SMS costs money, so a check that cannot be made is a failed check (13 §3).
        $rule = new TurnstileToken('otp_send', failOpen: false);

        if (Validator::make(['cf_turnstile_response' => $token], ['cf_turnstile_response' => [$rule]])->fails()) {
            throw $rule->unavailable
                ? new OtpException('captcha_unavailable', 503)
                : new OtpException('captcha_required', 422);
        }
    }

    /** Sends of this session in the last hour; the count restarts when its first send is older than that. */
    private function sessionSends(): int
    {
        $since = (int) Session::get('otp.sends_since', 0);

        return now()->getTimestamp() - $since >= self::SESSION_WINDOW_SECONDS ? 0 : (int) Session::get('otp.sends', 0);
    }

    private function countSessionSend(): void
    {
        $sends = $this->sessionSends();

        Session::put('otp.sends', $sends + 1);

        if ($sends === 0) {
            Session::put('otp.sends_since', now()->getTimestamp());
        }
    }

    /** The new code replaces every unconsumed one for the same number and purpose (13 §4.1). */
    private function store(string $e164, OtpPurpose $purpose, OtpChannel $channel, #[SensitiveParameter] string $code, ?string $ip): OtpCode
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

    /**
     * Tries the channels in order; the first that takes the message is the one the row records. When none does the
     * code is dead on arrival, so it is expired.
     *
     * @param  non-empty-list<OtpChannel>  $channels
     */
    private function deliver(OtpCode $otp, string $e164, #[SensitiveParameter] string $code, array $channels): OtpChannel
    {
        $message = trans_icu('notifications.auth.otp.sms', [
            'code' => $code,
            'appName' => $this->appName(),
            'domain' => (string) parse_url((string) config('app.url'), PHP_URL_HOST),
        ]);

        try {
            foreach ($channels as $channel) {
                try {
                    $this->delivery->send($channel, $e164, $message, $code, $otp->id);
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
