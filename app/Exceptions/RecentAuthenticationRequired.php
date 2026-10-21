<?php

declare(strict_types=1);

namespace App\Exceptions;

use App\Domain\Identity\Models\User;
use App\Support\Http\ErrorPage;
use Exception;
use Illuminate\Contracts\Debug\ShouldntReport;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Thrown by `recent.auth` (13 §6.4). Machines get `403 {code: 'recent_auth_required'}`. Browsers and Inertia
 * visits are sent to confirm the password (or, without a password, to re-authenticate by phone OTP or
 * Google) and come back to the page they wanted. The page to come back to is stored only when it is on this
 * site (13 §12.7): the URL of a GET, else the Referer as a relative path.
 */
final class RecentAuthenticationRequired extends Exception implements ShouldntReport
{
    public function render(Request $request): Response
    {
        if (ErrorPage::wantsMachineResponse($request)) {
            return response()->json(['code' => 'recent_auth_required'], 403);
        }

        $intended = $request->isMethod('GET') ? $request->fullUrl() : self::sameSitePath($request, $request->headers->get('Referer'));

        if ($intended !== null && $request->hasSession()) {
            $request->session()->put('url.intended', $intended);
        }

        $user = $request->user();

        return redirect()->to(route($user instanceof User && $user->hasPassword() ? 'password.confirm' : 'auth.reauthenticate'));
    }

    /** The path and query of `$url` when it points at this site (the request or `app.url`), else null. */
    private static function sameSitePath(Request $request, ?string $url): ?string
    {
        $parts = $url === null ? false : parse_url($url);

        if ($parts === false || ! isset($parts['scheme'], $parts['host'])) {
            return null;
        }

        $origin = self::origin($parts['scheme'], $parts['host'], $parts['port'] ?? null);
        $own = array_filter([
            self::origin($request->getScheme(), $request->getHost(), $request->getPort()),
            self::originOf((string) config('app.url')),
        ]);

        if (! in_array($origin, $own, true)) {
            return null;
        }

        // A single leading slash: `//host/path` would be read as another site.
        return '/'.ltrim(($parts['path'] ?? '/').(isset($parts['query']) ? '?'.$parts['query'] : ''), '/\\');
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
