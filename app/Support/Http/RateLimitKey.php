<?php

declare(strict_types=1);

namespace App\Support\Http;

use App\Support\Settings\Settings;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use InvalidArgumentException;
use Laravel\Fortify\Fortify;
use libphonenumber\NumberParseException;
use libphonenumber\PhoneNumberFormat;
use libphonenumber\PhoneNumberUtil;
use Normalizer;

/**
 * What a named rate limiter counts per (13 §10). Identifiers a visitor controls are normalised first so
 * `Asha@Example.com`, ` asha@example.com` and `+91 98765 43210` / `098765 43210` cannot dodge a limit by
 * spelling, and are hashed so no e-mail address or phone number ends up in a cache key (13 §16 rule 6).
 */
final class RateLimitKey
{
    public static function resolve(Request $request, string $kind): string
    {
        return match ($kind) {
            'ip' => 'ip:'.self::ip($request),
            'user' => self::user($request),
            'email' => self::identifier($request, 'email', self::email($request->input(Fortify::username()))),
            'email_ip' => self::identifier($request, 'email_ip', self::email($request->input(Fortify::username())), '|'.self::ip($request)),
            'phone' => self::identifier($request, 'phone', self::phone($request->input('phone'))),
            'session_login_id' => self::sessionLoginId($request),
            'user_doc' => self::userDocument($request),
            default => throw new InvalidArgumentException("Unknown rate limit key kind [{$kind}]."),
        };
    }

    /**
     * A hashed identifier, or the visitor's IP when there is none: an empty or unparseable value must not put
     * every such request into one shared bucket, nor let garbage create fresh buckets.
     */
    private static function identifier(Request $request, string $kind, ?string $value, string $suffix = ''): string
    {
        return $value === null ? 'guest:'.self::ip($request) : $kind.':'.self::hash($value).$suffix;
    }

    /** Lower-cased, trimmed, Unicode-folded (full-width letters and the like); null when it is not an address. */
    public static function email(mixed $value): ?string
    {
        if (! is_string($value)) {
            return null;
        }

        $folded = Normalizer::normalize($value, Normalizer::FORM_KC);
        $email = mb_strtolower(trim($folded === false ? '' : $folded));

        return filter_var($email, FILTER_VALIDATE_EMAIL, FILTER_FLAG_EMAIL_UNICODE) === false ? null : $email;
    }

    /** E.164 (the business country is the default region); null when the number does not parse. */
    public static function phone(mixed $value): ?string
    {
        if (! is_string($value) || trim($value) === '') {
            return null;
        }

        try {
            $util = PhoneNumberUtil::getInstance();

            return $util->format($util->parse($value, self::defaultRegion()), PhoneNumberFormat::E164);
        } catch (NumberParseException) {
            return null;
        }
    }

    private static function defaultRegion(): string
    {
        $country = app(Settings::class)->business()->address['country_code'] ?? null;

        return is_string($country) && preg_match('/^[A-Za-z]{2}$/', $country) === 1 ? strtoupper($country) : 'IN';
    }

    /** IPv4 as it is; IPv6 as its /64, since one subscriber holds a whole /64 and could otherwise rotate addresses. */
    private static function ip(Request $request): string
    {
        $ip = $request->ip() ?? 'unknown';
        $packed = filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6) === false ? false : inet_pton($ip);

        if ($packed === false) {
            return $ip;
        }

        return (inet_ntop(substr($packed, 0, 8).str_repeat("\0", 8)) ?: $ip).'/64';
    }

    private static function user(Request $request): string
    {
        $id = $request->user()?->getAuthIdentifier();

        return $id === null ? 'guest:'.self::ip($request) : 'user:'.$id;
    }

    /** Fortify's two-factor challenge; a request without a pending login is counted per IP instead. */
    private static function sessionLoginId(Request $request): string
    {
        $id = $request->hasSession() ? $request->session()->get('login.id') : null;

        return is_scalar($id) && $id !== '' ? 'login:'.$id : 'guest:'.self::ip($request);
    }

    /** `user | route name | route parameters`: one counter per user per document. */
    private static function userDocument(Request $request): string
    {
        $parameters = collect($request->route()?->parameters() ?? [])
            ->map(fn (mixed $value): string => is_object($value) && method_exists($value, 'getRouteKey') ? (string) $value->getRouteKey() : (is_scalar($value) ? (string) $value : ''))
            ->implode('|');

        return self::user($request).'|'.Str::lower((string) $request->route()?->getName()).'|'.$parameters;
    }

    private static function hash(string $value): string
    {
        return hash('sha256', $value);
    }
}
