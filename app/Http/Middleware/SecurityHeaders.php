<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\View;
use Illuminate\Support\Facades\Vite;
use Symfony\Component\HttpFoundation\Response;

/**
 * Owns every security header on responses produced by Laravel (13 §12.1, master D28).
 *
 * It is a global middleware rather than part of the `web` group so that the bare 404s, the health check,
 * the stateless routes, 405s and the maintenance page get the headers too. Each request gets a CSP nonce:
 * `@vite` tags carry it (`Vite::useCspNonce`) and Blade sees it as `$csp_nonce`, which every inline script
 * must repeat. With `strict-dynamic`, scripts those load are trusted transitively.
 */
final class SecurityHeaders
{
    private const string PERMISSIONS_POLICY = 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), fullscreen=(self)';

    private const string HSTS = 'max-age=31536000; includeSubDomains';

    private const string TURNSTILE = 'https://challenges.cloudflare.com';

    /**
     * Handle an incoming request.
     *
     * @param  Closure(Request): (Response)  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        $nonce = base64_encode(random_bytes(16));

        Vite::useCspNonce($nonce);
        View::share('csp_nonce', $nonce);

        $response = $next($request);
        $headers = $response->headers;

        $headers->set('X-Frame-Options', 'DENY');
        $headers->set('X-Content-Type-Options', 'nosniff');
        $headers->set('Referrer-Policy', 'strict-origin-when-cross-origin');
        $headers->set('Permissions-Policy', self::PERMISSIONS_POLICY);
        $headers->set('Cross-Origin-Opener-Policy', 'same-origin');

        if (app()->isProduction()) {
            if ($request->isSecure()) {
                $headers->set('Strict-Transport-Security', self::HSTS);
            }
        } else {
            $headers->set('X-Robots-Tag', 'noindex, nofollow');
        }

        if ($this->isHtml($response)) {
            $headers->set(
                config('security.csp.report_only') ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy',
                $this->policy($nonce, $this->isDashboard($request)),
            );
        }

        return $response;
    }

    /** A CSP governs documents only; JSON, plain text and downloads do not need one. */
    private function isHtml(Response $response): bool
    {
        if ($response->getStatusCode() === 204 || $response->getStatusCode() === 304) {
            return false;
        }

        $type = $response->headers->get('Content-Type');

        return $type === null || str_contains(strtolower($type), 'text/html');
    }

    /**
     * Horizon, Pulse and Telescope ship inline scripts and styles of their own that cannot carry our nonce
     * (ruling, log in 19), so they get a relaxed script policy at their configured paths.
     */
    private function isDashboard(Request $request): bool
    {
        foreach (['horizon.path' => 'horizon', 'pulse.path' => 'pulse', 'telescope.path' => 'telescope'] as $key => $default) {
            $path = trim((string) config($key, $default), '/');

            if ($path !== '' && $request->is($path, $path.'/*')) {
                return true;
            }
        }

        return false;
    }

    private function policy(string $nonce, bool $relaxed): string
    {
        $storage = $this->origins('s3_private_origin', 's3_public_origin');
        $private = $this->origins('s3_private_origin');
        $reverb = $this->reverbOrigins();
        $vite = $this->viteDevOrigins();

        $directives = [
            'default-src' => ["'self'"],
            // A nonce or strict-dynamic would make browsers ignore 'unsafe-inline', so the dashboards get neither.
            'script-src' => $relaxed
                ? ["'self'", "'unsafe-inline'", ...$vite['http']]
                : ["'self'", "'nonce-{$nonce}'", "'strict-dynamic'", self::TURNSTILE, ...$vite['http']],
            'style-src' => ["'self'", "'unsafe-inline'", ...$vite['http']],
            'img-src' => ["'self'", 'data:', 'blob:', ...$storage],
            'media-src' => ["'self'", 'blob:', ...$private],
            'font-src' => ["'self'", 'data:'],
            'connect-src' => ["'self'", ...$reverb['secure'], ...$storage, self::TURNSTILE, 'blob:', ...$reverb['local'], ...$vite['http'], ...$vite['ws']],
            'worker-src' => ["'self'", 'blob:'],
            'frame-src' => [self::TURNSTILE],
            'frame-ancestors' => ["'none'"],
            'form-action' => ["'self'", 'https://accounts.google.com'],
            'base-uri' => ["'self'"],
            'object-src' => ["'none'"],
            'manifest-src' => ["'self'"],
            'upgrade-insecure-requests' => [],
            'report-uri' => ['/csp-report'],
        ];

        return collect($directives)
            ->map(fn (array $sources, string $name): string => trim($name.' '.implode(' ', $sources)))
            ->implode('; ');
    }

    /**
     * The configured origins among the given `security.csp` keys; unset ones are left out.
     *
     * @return list<string>
     */
    private function origins(string ...$keys): array
    {
        $origins = [];

        foreach ($keys as $key) {
            $origin = config("security.csp.{$key}");

            if (is_string($origin) && $origin !== '') {
                $origins[] = $origin;
            }
        }

        return $origins;
    }

    /** @return array{secure: list<string>, local: list<string>} */
    private function reverbOrigins(): array
    {
        $host = config('security.csp.reverb_host');

        if (! is_string($host) || $host === '') {
            return ['secure' => [], 'local' => []];
        }

        $port = config('security.csp.reverb_port');
        $authority = is_int($port) && ! in_array($port, [80, 443], true) ? "{$host}:{$port}" : $host;

        // Local Reverb runs without TLS.
        return [
            'secure' => ["wss://{$authority}", "https://{$authority}"],
            'local' => app()->isLocal() ? ["ws://{$authority}", "http://{$authority}"] : [],
        ];
    }

    /**
     * The Vite dev server, only on a local machine while it is running (its hot file exists).
     *
     * @return array{http: list<string>, ws: list<string>}
     */
    private function viteDevOrigins(): array
    {
        $none = ['http' => [], 'ws' => []];

        if (! app()->isLocal() || ! is_file(Vite::hotFile())) {
            return $none;
        }

        $parts = parse_url(trim((string) file_get_contents(Vite::hotFile())));

        if (! isset($parts['scheme'], $parts['host'])) {
            return $none;
        }

        $authority = $parts['host'].(isset($parts['port']) ? ':'.$parts['port'] : '');

        return [
            'http' => ["{$parts['scheme']}://{$authority}"],
            'ws' => [($parts['scheme'] === 'https' ? 'wss' : 'ws')."://{$authority}"],
        ];
    }
}
