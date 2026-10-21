<?php

declare(strict_types=1);

namespace App\Support\Privacy;

use libphonenumber\NumberParseException;
use libphonenumber\PhoneNumberUtil;

/**
 * Masking for logs, audit properties and admin delivery logs (13 §16 rule 1). Masked values keep enough
 * shape to tell two records apart while debugging, and never enough to contact or locate the person.
 */
final class Mask
{
    /** `asha.k@example.com` becomes `a****k@e******.com`. */
    public static function email(string $email): string
    {
        $at = strrpos($email, '@');

        if ($at === false) {
            return self::keepFirst($email);
        }

        $local = substr($email, 0, $at);
        $domain = substr($email, $at + 1);
        $dot = strrpos($domain, '.');
        $name = $dot === false ? $domain : substr($domain, 0, $dot);
        $suffix = $dot === false ? '' : substr($domain, $dot);

        return self::keepEnds($local).'@'.self::keepFirst($name).$suffix;
    }

    /** `+919876543210` becomes `+91******3210`: country code and last four digits stay. */
    public static function phone(string $phone): string
    {
        $phone = trim($phone);
        $compact = preg_replace('/[^\d+]/', '', $phone) ?? '';

        if ($compact === '') {
            return '';
        }

        $prefix = '';
        $digits = ltrim($compact, '+');

        if (str_starts_with($compact, '+')) {
            $code = self::countryCode($compact);

            if ($code !== null && strlen($digits) > strlen($code)) {
                $prefix = '+'.$code;
                $digits = substr($digits, strlen($code));
            }
        }

        if (strlen($digits) <= 4) {
            return $prefix.str_repeat('*', strlen($digits));
        }

        return $prefix.str_repeat('*', strlen($digits) - 4).substr($digits, -4);
    }

    /** The network of an address: IPv4 /24, IPv6 /48. Anything that is not an IP address gives an empty string. */
    public static function ip(string $ip): string
    {
        $packed = filter_var($ip, FILTER_VALIDATE_IP) === false ? false : inet_pton($ip);

        if ($packed === false) {
            return '';
        }

        $keep = strlen($packed) === 4 ? 3 : 6;
        $masked = inet_ntop(substr($packed, 0, $keep).str_repeat("\0", strlen($packed) - $keep));

        return $masked === false ? '' : $masked;
    }

    /** First and last character stay: `asha.k` becomes `a****k`. */
    private static function keepEnds(string $value): string
    {
        $length = mb_strlen($value);

        return match (true) {
            $length <= 1 => str_repeat('*', $length),
            $length === 2 => mb_substr($value, 0, 1).'*',
            default => mb_substr($value, 0, 1).str_repeat('*', $length - 2).mb_substr($value, -1),
        };
    }

    private static function keepFirst(string $value): string
    {
        $length = mb_strlen($value);

        return $length === 0 ? '' : mb_substr($value, 0, 1).str_repeat('*', $length - 1);
    }

    private static function countryCode(string $e164): ?string
    {
        try {
            return (string) PhoneNumberUtil::getInstance()->parse($e164)->getCountryCode();
        } catch (NumberParseException) {
            return null;
        }
    }
}
