<?php

declare(strict_types=1);

namespace App\Support\Auth;

use App\Domain\Identity\Models\User;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Symfony\Component\HttpFoundation\Response;

/**
 * Where a user lands after signing in (13 §2, §12.7): the page they were sent away from when it is on this site,
 * else their dashboard. `url.intended` comes from the `auth` middleware (an absolute URL of this site) and from
 * `RecentAuthenticationRequired` (an absolute URL or a relative path), so both forms are accepted; anything that a
 * browser could read as another site is not.
 */
final class IntendedRedirect
{
    /** Session key the framework and `RecentAuthenticationRequired` store the page to return to under. */
    public const string SESSION_KEY = 'url.intended';

    private const int MAX_LENGTH = 2048;

    /** The absolute URL to send the signed-in user to. The intended URL is used up, whether or not it is accepted. */
    public static function resolve(Request $request, User $user): string
    {
        $intended = $request->hasSession() ? $request->session()->pull(self::SESSION_KEY) : null;
        $path = is_string($intended) ? self::sameSitePath($request, $intended) : null;

        if ($path !== null) {
            return url()->to($path);
        }

        return route($user->isStaff() ? 'admin.dashboard' : 'customer.dashboard');
    }

    /**
     * The response of a sign-in: a full page load of the destination (an Inertia visit gets `409` with the
     * location), because the destination may sit in the other layout.
     */
    public static function response(Request $request): Response
    {
        $user = $request->user();

        return Inertia::location($user instanceof User ? self::resolve($request, $user) : url('/'));
    }

    /**
     * The path and query of `$url` when it points at this site, else null. `$url` is a relative path (one
     * leading slash) or an absolute http(s) URL of this request's origin or of `app.url`.
     */
    public static function sameSitePath(Request $request, ?string $url): ?string
    {
        // A backslash and the control characters browsers drop or turn into slashes (`/\evil.test`, `/<TAB>/evil.test`).
        if ($url === null || $url === '' || strlen($url) > self::MAX_LENGTH || preg_match('/[\x00-\x1f\x7f\\\\]/', $url) === 1) {
            return null;
        }

        if (str_starts_with($url, '/')) {
            // `//host` is another site.
            return str_starts_with($url, '//') ? null : self::withoutFragment($url);
        }

        $parts = parse_url($url);

        if (
            $parts === false
            || ! in_array(strtolower($parts['scheme'] ?? ''), ['http', 'https'], true)
            || ! isset($parts['host'])
            || isset($parts['user']) || isset($parts['pass'])
        ) {
            return null;
        }

        $own = array_filter([
            self::origin($request->getScheme(), $request->getHost(), $request->getPort()),
            self::originOf((string) config('app.url')),
        ]);

        if (! in_array(self::origin($parts['scheme'], $parts['host'], $parts['port'] ?? null), $own, true)) {
            return null;
        }

        // A single leading slash: an absolute URL with the path `//host/x` must not become a protocol-relative one.
        return '/'.ltrim(($parts['path'] ?? '/').(isset($parts['query']) ? '?'.$parts['query'] : ''), '/');
    }

    private static function withoutFragment(string $path): string
    {
        $hash = strpos($path, '#');

        return $hash === false ? $path : substr($path, 0, $hash);
    }

    private static function originOf(string $url): ?string
    {
        $parts = parse_url($url);

        return $parts === false || ! isset($parts['scheme'], $parts['host'])
            ? null
            : self::origin($parts['scheme'], $parts['host'], $parts['port'] ?? null);
    }

    private static function origin(string $scheme, string $host, int|string|null $port): string
    {
        $scheme = strtolower($scheme);
        $port = $port === null || $port === '' ? ($scheme === 'https' ? 443 : 80) : (int) $port;

        return $scheme.'://'.strtolower($host).':'.$port;
    }
}
