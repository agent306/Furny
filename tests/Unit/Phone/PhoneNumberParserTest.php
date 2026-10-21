<?php

declare(strict_types=1);

use App\Domain\Identity\Otp\OtpException;
use App\Support\Phone\PhoneNumberParser;

/** The refusal of a parse, or null when the number passes. */
function parseRefusal(string $raw, string $region = 'IN', array $allowed = ['IN']): ?OtpException
{
    try {
        PhoneNumberParser::parse($raw, $region, $allowed);
    } catch (OtpException $exception) {
        return $exception;
    }

    return null;
}

describe('a mobile number of an allowed country', function (): void {
    it('is normalised to E.164 whatever the way it is typed', function (string $raw): void {
        $parsed = PhoneNumberParser::parse($raw, 'IN', ['IN']);

        expect($parsed->e164)->toBe('+919876543210')->and($parsed->region)->toBe('IN');
    })->with([
        'national with a trunk zero' => '09876 543 210',
        'international with hyphens' => '+91-98765-43210',
        'international with spaces' => '+91 98765 43210',
        'bare national' => '9876543210',
        'padded' => '  98765 43210 ',
    ]);

    it('is read in the default region when it has no country code, and checked against the allowed regions', function (): void {
        $parsed = PhoneNumberParser::parse('050 123 4567', 'AE', ['AE', 'IN']);

        expect($parsed->e164)->toBe('+971501234567')->and($parsed->region)->toBe('AE');
    });

    it('accepts a lower-case region', function (): void {
        expect(PhoneNumberParser::parse('9876543210', 'in', ['in'])->e164)->toBe('+919876543210');
    });
});

describe('refusals (422)', function (): void {
    it('refuses a landline as phone_not_mobile', function (): void {
        $refusal = parseRefusal('+91 80 2222 3333');

        expect($refusal?->errorCode)->toBe('phone_not_mobile')->and($refusal->status)->toBe(422);
    });

    it('refuses a toll-free number as phone_not_mobile', function (): void {
        expect(parseRefusal('+91 1800 123 4567')?->errorCode)->toBe('phone_not_mobile');
    });

    it('refuses a number of a country that is not allowed as phone_country_not_supported', function (): void {
        $refusal = parseRefusal('+1 415 555 0100');

        expect($refusal?->errorCode)->toBe('phone_country_not_supported')->and($refusal->status)->toBe(422);
    });

    it('refuses a Gulf mobile number while only India is allowed', function (): void {
        expect(parseRefusal('+971 50 123 4567')?->errorCode)->toBe('phone_country_not_supported');
    });

    it('refuses what is not a number as phone_invalid', function (string $raw): void {
        $refusal = parseRefusal($raw);

        expect($refusal?->errorCode)->toBe('phone_invalid')->and($refusal->status)->toBe(422);
    })->with([
        'letters' => '12ab',
        'empty' => '',
        'blank' => '   ',
        'too short' => '98765 4321',
        'text' => 'call me',
    ]);

    it('refuses everything when no country is allowed', function (): void {
        expect(parseRefusal('9876543210', 'IN', [])?->errorCode)->toBe('phone_country_not_supported');
    });

    it('refuses a number typed without a country code when the default region is unknown', function (): void {
        expect(parseRefusal('9876543210', 'ZZ', ['IN'])?->errorCode)->toBe('phone_invalid');
    });
});
