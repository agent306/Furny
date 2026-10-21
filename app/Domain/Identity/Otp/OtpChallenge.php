<?php

declare(strict_types=1);

namespace App\Domain\Identity\Otp;

use App\Domain\Identity\Enums\OtpChannel;
use App\Domain\Identity\Enums\OtpPurpose;
use App\Domain\Identity\Models\OtpCode;
use App\Support\Privacy\Mask;
use Illuminate\Support\Facades\Session;

/**
 * The code a visitor has been sent and is expected to type (13 §4.2 step 8, §4.3 step 1): what the verify, resend and
 * status routes need to know without being told the number again. It lives in the session under `otp.challenge`, from
 * the send until the code is verified, and holds no code: `{e164, purpose, intent, name?, channel, otpId, expiresAt}`.
 *
 * `intent` says which flow the code is for, so one flow cannot take over the challenge of another that shares the
 * session: `login` and `register` (the guest pages), `reauthenticate` (13 §6.4), `verify_phone` (13 §5.7). A flow reads
 * the challenge with the purposes and intents it serves.
 *
 * It outlives the code: a code that has expired is answered by `otp_expired` on the verify page, where the visitor
 * asks for another, rather than by losing the page.
 */
final readonly class OtpChallenge
{
    public const string KEY = 'otp.challenge';

    /** Session key of a number that was verified without an account behind it: `{phone: E.164, at: unix seconds}` (13 §5.2). */
    public const string VERIFIED_PHONE_KEY = 'otp.verified_phone';

    /** How long a verified number may wait for the name that completes the sign-up. */
    public const int VERIFIED_PHONE_MINUTES = 15;

    public const string LOGIN = 'login';

    public const string REGISTER = 'register';

    public const string REAUTHENTICATE = 'reauthenticate';

    public const string VERIFY_PHONE = 'verify_phone';

    public function __construct(
        public string $e164,
        public OtpPurpose $purpose,
        public string $intent,
        public OtpChannel $channel,
        public string $otpId,
        public int $expiresAt,
        public ?string $name = null,
    ) {}

    /** Stores the challenge of a code that was just sent, in place of any other. */
    public static function start(OtpSendResult $sent, OtpPurpose $purpose, string $intent, ?string $name = null): self
    {
        $challenge = new self($sent->e164, $purpose, $intent, $sent->channel, $sent->otpId, $sent->expiresAt->getTimestamp(), $name);
        $challenge->store();

        return $challenge;
    }

    /**
     * The challenge of the session, when there is a readable one for this purpose and, if given, one of these intents.
     *
     * @param  list<string>|null  $intents
     */
    public static function current(OtpPurpose $purpose, ?array $intents = null): ?self
    {
        $raw = Session::get(self::KEY);

        if (! is_array($raw)) {
            return null;
        }

        $channel = OtpChannel::tryFrom((string) ($raw['channel'] ?? ''));
        $rawPurpose = OtpPurpose::tryFrom((string) ($raw['purpose'] ?? ''));

        if (
            $channel === null
            || $rawPurpose !== $purpose
            || ! is_string($raw['e164'] ?? null)
            || ! is_string($raw['intent'] ?? null)
            || ! is_string($raw['otpId'] ?? null)
            || ! is_int($raw['expiresAt'] ?? null)
            || ($intents !== null && ! in_array($raw['intent'], $intents, true))
        ) {
            return null;
        }

        return new self($raw['e164'], $rawPurpose, $raw['intent'], $channel, $raw['otpId'], $raw['expiresAt'], is_string($raw['name'] ?? null) ? $raw['name'] : null);
    }

    public static function forget(): void
    {
        Session::forget(self::KEY);
    }

    /** The same challenge for the code that was sent after it (a resend, a fallback). */
    public function followedBy(OtpSendResult $sent): self
    {
        $next = new self($this->e164, $this->purpose, $this->intent, $sent->channel, $sent->otpId, $sent->expiresAt->getTimestamp(), $this->name);
        $next->store();

        return $next;
    }

    /** The same challenge for a code that replaced the one it knew (the SMS fallback of 13 §4.2). */
    public function following(OtpCode $code): self
    {
        $next = new self($this->e164, $this->purpose, $this->intent, $code->channel, $code->id, $code->expires_at->getTimestamp(), $this->name);
        $next->store();

        return $next;
    }

    public function maskedPhone(): string
    {
        return self::mask($this->e164);
    }

    public static function mask(string $e164): string
    {
        return Mask::phone($e164);
    }

    /** Seconds until another code may be asked for (the 60 s cooldown of 13 §4.1). */
    public function resendAvailableIn(): int
    {
        return OtpLimits::cooldownRemaining($this->e164);
    }

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return [
            'e164' => $this->e164,
            'purpose' => $this->purpose->value,
            'intent' => $this->intent,
            'channel' => $this->channel->value,
            'otpId' => $this->otpId,
            'expiresAt' => $this->expiresAt,
            ...($this->name === null ? [] : ['name' => $this->name]),
        ];
    }

    private function store(): void
    {
        Session::put(self::KEY, $this->toArray());
    }
}
