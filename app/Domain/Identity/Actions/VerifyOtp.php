<?php

declare(strict_types=1);

namespace App\Domain\Identity\Actions;

use App\Domain\Identity\Enums\OtpPurpose;
use App\Domain\Identity\Models\OtpCode;
use App\Domain\Identity\Otp\OtpException;
use App\Domain\Identity\Otp\OtpLimits;
use App\Support\Privacy\Mask;
use Illuminate\Http\Exceptions\ThrottleRequestsException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\RateLimiter;

/**
 * Checks a typed code against the latest live code for a number and purpose (13 §4.3). The attempt counter and the
 * consumption are single SQL statements, so concurrent guesses cannot exceed the five attempts and one code is
 * consumed once however many requests carry it.
 *
 * What a verified number means (sign-in, sign-up, phone change) is the caller's business.
 */
final class VerifyOtp
{
    /**
     * @throws ThrottleRequestsException 429 when the IP or the number has been tried too often
     * @throws OtpException `otp_invalid` (+`attemptsLeft`), `otp_expired`, `otp_too_many_attempts` (422)
     */
    public function handle(string $e164, OtpPurpose $purpose, string $code, ?string $ip): OtpCode
    {
        $this->countAttempt($e164, $ip);

        $otp = OtpCode::query()
            ->where('phone_e164', $e164)
            ->where('purpose', $purpose)
            ->whereNull('consumed_at')
            ->where('expires_at', '>', now())
            ->latest('created_at')
            ->latest('id')
            ->first();

        if ($otp === null) {
            throw new OtpException('otp_expired', 422);
        }

        // A code that is not six digits is a typo, not a guess: it does not cost an attempt.
        $normalised = preg_replace('/\s+/', '', $code) ?? '';

        if (preg_match('/^\d{6}$/', $normalised) !== 1) {
            throw new OtpException('otp_invalid', 422, ['attemptsLeft' => max(0, OtpCode::MAX_ATTEMPTS - $otp->attempts)]);
        }

        $attempts = $this->takeAttempt($otp);

        if ($attempts === null) {
            $otp->update(['expires_at' => now()]);

            activity('security')
                ->event('auth.otp_locked')
                ->withProperties(['phone' => Mask::phone($e164), 'purpose' => $purpose->value])
                ->log('auth.otp_locked');

            throw new OtpException('otp_too_many_attempts', 422);
        }

        if (! Hash::check($normalised, $otp->code_hash)) {
            throw new OtpException('otp_invalid', 422, ['attemptsLeft' => max(0, OtpCode::MAX_ATTEMPTS - $attempts)]);
        }

        $this->consume($otp);

        // The number has proved to be the visitor's: its wrong guesses and its sends stop counting against it.
        RateLimiter::clear(OtpLimits::key(OtpLimits::VERIFY, 'phone', $e164, $ip));
        RateLimiter::clear(OtpLimits::key(OtpLimits::SEND, 'phone', $e164, $ip));

        return $otp->refresh();
    }

    /** Every try counts against the IP (10 a minute) and the number (20 an hour), typos included. */
    private function countAttempt(string $e164, ?string $ip): void
    {
        $keys = [];

        foreach (['ip', 'phone'] as $kind) {
            $key = OtpLimits::key(OtpLimits::VERIFY, $kind, $e164, $ip);

            if (RateLimiter::tooManyAttempts($key, OtpLimits::limit(OtpLimits::VERIFY, $kind)['max'])) {
                throw new ThrottleRequestsException('Too Many Attempts.', headers: ['Retry-After' => max(1, RateLimiter::availableIn($key))]);
            }

            $keys[$kind] = $key;
        }

        foreach ($keys as $kind => $key) {
            RateLimiter::hit($key, OtpLimits::limit(OtpLimits::VERIFY, $kind)['decay']);
        }
    }

    /** The attempts used including this one, or null when the code had none left. */
    private function takeAttempt(OtpCode $otp): ?int
    {
        $rows = DB::select(
            'UPDATE otp_codes SET attempts = attempts + 1, updated_at = ? WHERE id = ? AND attempts < ? RETURNING attempts',
            [now(), $otp->id, OtpCode::MAX_ATTEMPTS],
        );

        return $rows === [] ? null : (int) $rows[0]->attempts;
    }

    /** A code that was consumed or replaced by a new one meanwhile (a double submit, a resend) is expired, not verified. */
    private function consume(OtpCode $otp): void
    {
        $rows = DB::select(
            'UPDATE otp_codes SET consumed_at = ?, updated_at = ? WHERE id = ? AND consumed_at IS NULL AND expires_at > ? RETURNING id',
            [now(), now(), $otp->id, now()],
        );

        if ($rows === []) {
            throw new OtpException('otp_expired', 422);
        }
    }
}
