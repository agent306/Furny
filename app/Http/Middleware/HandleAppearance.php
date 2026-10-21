<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\View;
use Symfony\Component\HttpFoundation\Response;

/**
 * Shares the visitor's saved appearance with the Blade root (15 §11, 13 §12.2).
 *
 * The `appearance` cookie is deliberately unencrypted and written by the
 * browser, so it is untrusted input: it is allow-listed here before it can
 * reach the `<html>` class, the inline theme script or the theme-color meta.
 */
final class HandleAppearance
{
    public const COOKIE = 'appearance';

    /** Allowed cookie values; `system` follows `prefers-color-scheme`. */
    public const APPEARANCES = ['light', 'dark', 'system'];

    /** Resolved `--background` per theme; twin of `lib/theme/meta.ts` `THEME_COLOR`. */
    public const THEME_COLOR = ['light' => '#fbfaf7', 'dark' => '#1d1a17'];

    /**
     * Handle an incoming request.
     *
     * @param  Closure(Request): (Response)  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        $cookie = $request->cookie(self::COOKIE);
        $appearance = is_string($cookie) && in_array($cookie, self::APPEARANCES, true) ? $cookie : 'system';

        View::share('appearance', $appearance);
        View::share('themeColor', self::THEME_COLOR[$appearance === 'dark' ? 'dark' : 'light']);
        View::share('themeColors', self::THEME_COLOR);

        return $next($request);
    }
}
