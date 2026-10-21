<?php

declare(strict_types=1);

namespace App\Support\Http;

use App\Support\Settings\Settings;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
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
            'email' => 'email:'.self::hash(self::email($request->input(Fortify::username()))),
            'email_ip' => 'email_ip:'.self::hash(self::email($request->input(Fortify::username()))).'|'.self::ip($request),
            'phone' => 'phone:'.self::hash(self::phone($request->input('phone'))),
            'session_login_id' => self::sessionLoginId($request),
            'user_doc' => self::userDocument($request),
            default => throw new \InvalidArgumentException("Unknown rate limit key kind [{$kind}]."),
        };
    }

    /** Lower-cased, trimmed, Unicode-folded (full-width letters and the like). */
    public static function email(mixed $value): string
    {
        if (! is_string($value)) {
            return '';
        }

        $value = Normalizer::normalize($value, Normalizer::FORM_KC);

        return mb_strtolower(trim($value === false ? '' : $value));
    }

    /** E.164 when the number parses (the business country is the default region), else its digits. */
    public static function phone(mixed $value): string
    {
        if (! is_string($value) || trim($value) === '') {
            return '';
        }

        try {
            $util = PhoneNumberUtil::getInstance();

            return $util->format($util->parse($value, self::defaultRegion()), PhoneNumberFormat::E164);
        } catch (NumberParseException) {
            return '+'.(preg_replace('/\D+/', '', $value) ?? '');
        }
    }

    private static function defaultRegion(): string
    {
        $country = app(Settings::class)->business()->address['country_code'] ?? null;

        return is_string($country) && preg_match('/^[A-Za-z]{2}$/', $country) === 1 ? strtoupper($country) : 'IN';
    }

    private static function ip(Request $request): string
    {
        return $request->ip() ?? 'unknown';
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
