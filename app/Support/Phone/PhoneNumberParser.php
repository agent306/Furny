<?php

declare(strict_types=1);

namespace App\Support\Phone;

use App\Domain\Identity\Otp\OtpException;
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
