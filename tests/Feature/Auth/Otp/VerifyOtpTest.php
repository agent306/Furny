<?php

declare(strict_types=1);

use App\Domain\Identity\Actions\SendOtp;
use App\Domain\Identity\Actions\VerifyOtp;
use App\Domain\Identity\Enums\OtpPurpose;
use App\Domain\Identity\Models\OtpCode;
use App\Domain\Identity\Otp\OtpDelivery;
use App\Domain\Identity\Otp\OtpException;
use App\Domain\Identity\Otp\OtpLimits;
use Illuminate\Hashing\HashManager;
use Illuminate\Http\Exceptions\ThrottleRequestsException;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\RateLimiter;
use Spatie\Activitylog\Models\Activity;

const VERIFY_E164 = '+919876543210';
const VERIFY_IP = '203.0.113.45';

beforeEach(function (): void {
    $this->otp = OtpCode::factory()->forPhone(VERIFY_E164, '123456')->create();
    $this->verify = fn (string $code, OtpPurpose $purpose = OtpPurpose::Login, string $e164 = VERIFY_E164, ?string $ip = VERIFY_IP) => app(VerifyOtp::class)->handle($e164, $purpose, $code, $ip);
});

/** The refusal of a call, or a failed test when it went through. */
function verifyRefusal(Closure $call): OtpException
{
    try {
        $call();
    } catch (OtpException $exception) {
        return $exception;
    }

    throw new RuntimeException('Expected an OtpException.');
}

describe('the input', function (): void {
    it('answers otp_invalid without using up an attempt when it is not six digits', function (string $input): void {
        $refusal = verifyRefusal(fn () => ($this->verify)($input));

        expect($refusal->errorCode)->toBe('otp_invalid')->and($refusal->status)->toBe(422)
            ->and($refusal->context['attemptsLeft'])->toBe(5)
            ->and($this->otp->refresh()->attempts)->toBe(0);
    })->with(['12 34', '12345', '1234567', 'abcdef', '12345a', '', '１２３４５６']);

    it('ignores the spaces of a code typed in groups', function (): void {
        $otp = ($this->verify)(' 123 456 ');

        expect($otp->is($this->otp))->toBeTrue()->and($otp->consumed_at)->not->toBeNull();
    });

    it('tells the attempts left that a typo leaves untouched', function (): void {
        verifyRefusal(fn () => ($this->verify)('000000'));

        expect(verifyRefusal(fn () => ($this->verify)('12 34'))->context['attemptsLeft'])->toBe(4)
            ->and($this->otp->refresh()->attempts)->toBe(1);
    });
});

describe('a wrong code', function (): void {
    it('answers otp_invalid with the attempts left, and counts the attempt', function (): void {
        $refusal = verifyRefusal(fn () => ($this->verify)('654321'));

        expect($refusal->errorCode)->toBe('otp_invalid')->and($refusal->status)->toBe(422)
            ->and($refusal->context['attemptsLeft'])->toBe(4)
            ->and($this->otp->refresh()->attempts)->toBe(1)->and($this->otp->consumed_at)->toBeNull();
    });

    it('counts down to zero, and kills the code on the next attempt, the right code included', function (): void {
        foreach ([4, 3, 2, 1, 0] as $left) {
            expect(verifyRefusal(fn () => ($this->verify)('654321'))->context['attemptsLeft'])->toBe($left);
        }

        $refusal = verifyRefusal(fn () => ($this->verify)('123456'));
        $this->otp->refresh();

        expect($refusal->errorCode)->toBe('otp_too_many_attempts')->and($refusal->status)->toBe(422)
            ->and($this->otp->attempts)->toBe(5)
            ->and($this->otp->consumed_at)->toBeNull()
            ->and($this->otp->expires_at->lessThanOrEqualTo(now()))->toBeTrue();

        // The code is dead: the next try finds nothing.
        expect(verifyRefusal(fn () => ($this->verify)('123456'))->errorCode)->toBe('otp_expired');
    });

    it('audits the lock with the masked number and the purpose', function (): void {
        $this->otp->forceFill(['attempts' => 5])->save();

        verifyRefusal(fn () => ($this->verify)('654321'));

        $entry = Activity::query()->where('event', 'auth.otp_locked')->sole();
        expect($entry->log_name)->toBe('security')
            ->and($entry->properties->all())->toBe(['phone' => '+91******3210', 'purpose' => 'login'])
            ->and($entry->properties->toJson())->not->toContain('9876543210');
    });

    it('does not audit a lock before the attempts are used up', function (): void {
        foreach (range(1, 5) as $_) {
            verifyRefusal(fn () => ($this->verify)('654321'));
        }

        expect(Activity::query()->where('event', 'auth.otp_locked')->count())->toBe(0);
    });

    it('stops at five attempts however many tries come, the right code included (the real action)', function (): void {
        foreach (range(1, 8) as $try) {
            $refusal = verifyRefusal(fn () => ($this->verify)($try === 8 ? '123456' : '654321'));

            expect($refusal->errorCode)->toBe($try <= 5 ? 'otp_invalid' : ($try === 6 ? 'otp_too_many_attempts' : 'otp_expired'));
        }

        expect($this->otp->refresh()->attempts)->toBe(5)->and($this->otp->consumed_at)->toBeNull();
    });

    it('is in no frame of the exception that refuses it', function (): void {
        try {
            app(VerifyOtp::class)->handle(VERIFY_E164, OtpPurpose::Login, '246802', VERIFY_IP);
            $this->fail('Expected a refusal.');
        } catch (OtpException $exception) {
            expect($exception->getTraceAsString())->not->toContain('246802')
                ->and($exception->getTraceAsString())->toContain('VerifyOtp->handle(');
        }
    });
});

describe('the right code', function (): void {
    it('consumes the row and returns it', function (): void {
        $this->freezeTime();

        $otp = ($this->verify)('123456');

        expect($otp)->toBeInstanceOf(OtpCode::class)->and($otp->is($this->otp))->toBeTrue()
            ->and($otp->consumed_at->diffInSeconds(now(), true))->toBeLessThan(1)
            ->and($otp->attempts)->toBe(1)
            ->and($this->otp->refresh()->consumed_at)->not->toBeNull();
    });

    it('works once: the same code again finds nothing', function (): void {
        ($this->verify)('123456');

        expect(verifyRefusal(fn () => ($this->verify)('123456'))->errorCode)->toBe('otp_expired');
    });

    it('is not consumed twice when another request consumes it first', function (): void {
        // A hasher that lets a second request win between the check and the consumption.
        $racing = new class(app()) extends HashManager
        {
            public function check($value, $hashedValue, array $options = []): bool
            {
                OtpCode::query()->update(['consumed_at' => now()]);

                return parent::check($value, $hashedValue, $options);
            }
        };
        Hash::swap($racing);

        expect(verifyRefusal(fn () => ($this->verify)('123456'))->errorCode)->toBe('otp_expired');
    });

    it('does not consume a code that a new send replaced while it was being checked', function (): void {
        $racing = new class(app()) extends HashManager
        {
            public function check($value, $hashedValue, array $options = []): bool
            {
                OtpCode::query()->update(['expires_at' => now()]);

                return parent::check($value, $hashedValue, $options);
            }
        };
        Hash::swap($racing);

        expect(verifyRefusal(fn () => ($this->verify)('123456'))->errorCode)->toBe('otp_expired')
            ->and($this->otp->refresh()->consumed_at)->toBeNull();
    });

    it('clears the hits on the number: its wrong guesses and its sends', function (): void {
        verifyRefusal(fn () => ($this->verify)('654321'));
        RateLimiter::hit(OtpLimits::key(OtpLimits::SEND, 'phone', VERIFY_E164, VERIFY_IP));
        $verifyPhone = OtpLimits::key(OtpLimits::VERIFY, 'phone', VERIFY_E164, VERIFY_IP);
        $sendPhone = OtpLimits::key(OtpLimits::SEND, 'phone', VERIFY_E164, VERIFY_IP);

        expect(RateLimiter::attempts($verifyPhone))->toBe(1)->and(RateLimiter::attempts($sendPhone))->toBe(1);

        ($this->verify)('123456');

        expect(RateLimiter::attempts($verifyPhone))->toBe(0)->and(RateLimiter::attempts($sendPhone))->toBe(0);
    });
});

describe('which code is checked', function (): void {
    it('is the latest live one of the number and purpose', function (): void {
        $this->travel(1)->seconds();
        $newer = OtpCode::factory()->forPhone(VERIFY_E164, '777777')->create();

        expect(verifyRefusal(fn () => ($this->verify)('123456'))->errorCode)->toBe('otp_invalid');

        $otp = ($this->verify)('777777');

        expect($otp->is($newer))->toBeTrue();
    });

    it('answers otp_expired after ten minutes', function (): void {
        $this->travel(10)->minutes();
        $this->travel(1)->seconds();

        $refusal = verifyRefusal(fn () => ($this->verify)('123456'));

        expect($refusal->errorCode)->toBe('otp_expired')->and($refusal->status)->toBe(422)
            ->and($this->otp->refresh()->attempts)->toBe(0);
    });

    it('still accepts the code just before ten minutes are over', function (): void {
        $this->travel(9)->minutes();

        expect(($this->verify)('123456')->is($this->otp))->toBeTrue();
    });

    it('answers otp_expired when there is no code for the number, or for the purpose', function (): void {
        expect(verifyRefusal(fn () => ($this->verify)('123456', e164: '+919876500000'))->errorCode)->toBe('otp_expired')
            ->and(verifyRefusal(fn () => ($this->verify)('123456', OtpPurpose::VerifyPhone))->errorCode)->toBe('otp_expired')
            ->and($this->otp->refresh()->attempts)->toBe(0);
    });

    it('answers otp_expired for a malformed input when there is no live code', function (): void {
        $this->otp->update(['expires_at' => now()->subMinute()]);

        expect(verifyRefusal(fn () => ($this->verify)('12 34'))->errorCode)->toBe('otp_expired');
    });

    it('verifies the code that a send made, end to end', function (): void {
        $otpId = app(SendOtp::class)->handle('98765 43211', OtpPurpose::VerifyPhone, VERIFY_IP, null)->otpId;
        $code = app(OtpDelivery::class)->lastCode();

        $otp = app(VerifyOtp::class)->handle('+919876543211', OtpPurpose::VerifyPhone, $code, VERIFY_IP);

        expect($otp->id)->toBe($otpId)->and($otp->consumed_at)->not->toBeNull();
    });
});

describe('limits (13 section 4.3 step 1)', function (): void {
    it('refuses the eleventh try in a minute from one IP with a 429, whatever the number', function (): void {
        foreach (range(1, 10) as $n) {
            verifyRefusal(fn () => ($this->verify)('000000', e164: '+9198765'.str_pad((string) $n, 5, '0', STR_PAD_LEFT)));
        }

        try {
            ($this->verify)('123456');
            $this->fail('Expected a throttle.');
        } catch (ThrottleRequestsException $exception) {
            expect($exception->getStatusCode())->toBe(429)
                ->and($exception->getHeaders()['Retry-After'])->toBeBetween(1, 60);
        }

        expect($this->otp->refresh()->consumed_at)->toBeNull();

        // Another address, or a minute later, is fine.
        expect(($this->verify)('123456', ip: '198.51.100.7')->consumed_at)->not->toBeNull();
    });

    it('lets the try through a minute later', function (): void {
        foreach (range(1, 10) as $_) {
            verifyRefusal(fn () => ($this->verify)('12 34'));
        }
        $this->travel(61)->seconds();

        expect(($this->verify)('123456')->consumed_at)->not->toBeNull();
    });

    it('refuses the twenty-first try in an hour at one number, from whatever address', function (): void {
        foreach (range(1, 20) as $n) {
            verifyRefusal(fn () => ($this->verify)('12 34', ip: '198.51.100.'.$n));
        }

        expect(fn () => ($this->verify)('123456', ip: '198.51.100.99'))->toThrow(ThrottleRequestsException::class);

        // An hour later; the code of the beforeEach has expired by then, so a new one is asked for.
        $this->travel(61)->minutes();
        OtpCode::factory()->forPhone(VERIFY_E164, '123456')->create();

        expect(($this->verify)('123456')->consumed_at)->not->toBeNull();
    });

    it('counts a try before it is looked at: no code, no limit-free guessing', function (): void {
        foreach (range(1, 10) as $_) {
            verifyRefusal(fn () => ($this->verify)('123456', e164: '+919876500000'));
        }

        expect(fn () => ($this->verify)('123456', e164: '+919876500000'))->toThrow(ThrottleRequestsException::class);
    });

    it('counts first and compares the count that came back, so the eleventh is refused whatever else counted meanwhile', function (): void {
        // Ten tries are already counted for the address, as parallel requests would have counted them between
        // another request's look at the counter and its own count.
        $key = OtpLimits::key(OtpLimits::VERIFY, 'ip', VERIFY_E164, VERIFY_IP);
        foreach (range(1, 10) as $_) {
            RateLimiter::hit($key, 60);
        }

        expect(fn () => ($this->verify)('123456'))->toThrow(ThrottleRequestsException::class)
            // The refused try is counted too: the count is the place in line.
            ->and(RateLimiter::attempts($key))->toBe(11)
            ->and($this->otp->refresh()->consumed_at)->toBeNull();
    });

    it('does not count against the number a try that the address was refused', function (): void {
        $ip = OtpLimits::key(OtpLimits::VERIFY, 'ip', VERIFY_E164, VERIFY_IP);
        $phone = OtpLimits::key(OtpLimits::VERIFY, 'phone', VERIFY_E164, VERIFY_IP);
        foreach (range(1, 10) as $_) {
            RateLimiter::hit($ip, 60);
        }

        foreach (range(1, 3) as $_) {
            expect(fn () => ($this->verify)('000000'))->toThrow(ThrottleRequestsException::class);
        }

        // Somebody hammering from a blocked address cannot use up the number's hour for its owner.
        expect(RateLimiter::attempts($phone))->toBe(0);
    });

    it('refuses the try that makes the twenty-first for the number when the count comes back over the limit', function (): void {
        $phone = OtpLimits::key(OtpLimits::VERIFY, 'phone', VERIFY_E164, VERIFY_IP);
        foreach (range(1, 20) as $_) {
            RateLimiter::hit($phone, 3600);
        }

        expect(fn () => ($this->verify)('123456'))->toThrow(ThrottleRequestsException::class)
            ->and(RateLimiter::attempts($phone))->toBe(21)
            ->and($this->otp->refresh()->consumed_at)->toBeNull();
    });
});
