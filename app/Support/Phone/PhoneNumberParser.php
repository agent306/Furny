<?php

declare(strict_types=1);

namespace App\Support\Phone;

use App\Domain\Identity\Otp\OtpException;
use App\Support\Settings\Settings;
use libphonenumber\NumberParseException;
use libphonenumber\PhoneNumberFormat;
use libphonenumber\PhoneNumberType;
use libphonenumber\PhoneNumberUtil;

/**
 * What a typed phone number must be to receive a verification code (13 §4.1, §4.2 step 1): a valid number, of a type
 * that can receive an SMS (mobile, or a range that is fixed line or mobile), in a country the business allows.
 * Anything else is a 422 `OtpException` with the code the form shows.
 */
final class PhoneNumberParser
{
    /**
     * The region a number typed without a country code is read in: the country of the business address; without
     * one, the first country the auth settings allow (the business is global and configurable, so no country is
     * assumed); with none allowed, an unknown region, which makes every such number invalid.
     */
    public static function defaultRegion(Settings $settings): string
    {
        $country = $settings->business()->address['country_code'] ?? null;

        if (is_string($country) && preg_match('/^[A-Za-z]{2}$/', $country) === 1) {
            return strtoupper($country);
        }

        $allowed = $settings->auth()->otpAllowedCountryCodes;

        return strtoupper((string) ($allowed[array_key_first($allowed)] ?? 'ZZ'));
    }

    /**
     * @param  list<string>  $allowedRegions  ISO 3166-1 alpha-2, upper case
     *
     * @throws OtpException `phone_invalid`, `phone_not_mobile` or `phone_country_not_supported` (422)
     */
    public static function parse(string $raw, string $defaultRegion, array $allowedRegions): ParsedPhone
    {
        $util = PhoneNumberUtil::getInstance();

        try {
            $number = $util->parse(trim($raw), strtoupper($defaultRegion));
        } catch (NumberParseException) {
            throw new OtpException('phone_invalid', 422);
        }

        if (! $util->isValidNumber($number)) {
            throw new OtpException('phone_invalid', 422);
        }

        if (! in_array($util->getNumberType($number), [PhoneNumberType::MOBILE, PhoneNumberType::FIXED_LINE_OR_MOBILE], true)) {
            throw new OtpException('phone_not_mobile', 422);
        }

        $region = $util->getRegionCodeForNumber($number);
        $allowed = array_map(strtoupper(...), $allowedRegions);

        if ($region === null || ! in_array($region, $allowed, true)) {
            throw new OtpException('phone_country_not_supported', 422);
        }

        return new ParsedPhone($util->format($number, PhoneNumberFormat::E164), $region);
    }
}
