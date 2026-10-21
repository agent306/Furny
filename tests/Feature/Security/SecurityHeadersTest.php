<?php

declare(strict_types=1);

use Illuminate\Foundation\Vite as ViteService;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Vite;
use Illuminate\Testing\TestResponse;

/** The CSP header of the response, whichever of the two names carries it. */
function cspHeader(TestResponse $response): string
{
    return (string) ($response->headers->get('Content-Security-Policy') ?? $response->headers->get('Content-Security-Policy-Report-Only'));
}

/** The nonce the CSP announces. */
function cspNonce(TestResponse $response): string
{
    preg_match("/'nonce-([^']+)'/", cspHeader($response), $match);

    return $match[1] ?? '';
}

/** The source list of one CSP directive, e.g. `script-src`. */
function cspDirective(TestResponse $response, string $name): string
{
    foreach (explode(';', cspHeader($response)) as $directive) {
        $directive = trim($directive);

        if ($directive === $name || str_starts_with($directive, $name.' ')) {
            return $directive;
        }
    }

    return '';
}

/** Serves the Vite dev server (hot file) instead of the manifest, so `@vite` renders real tags. */
function useViteHotFile(string $origin = 'http://localhost:5173'): string
{
    $hot = tempnam(sys_get_temp_dir(), 'vite-hot-');
    file_put_contents($hot, $origin);

    // Feature tests swap Vite for a no-op (Pest.php); this puts a real one back.
    app()->instance(ViteService::class, (new ViteService)->useHotFile($hot));
    Vite::clearResolvedInstance();

    return $hot;
}

it('sends the CSP of 13 §12.1', function (): void {
    $response = $this->get('/')->assertOk();
    $nonce = cspNonce($response);

    expect($nonce)->not->toBe('')
        ->and(cspDirective($response, 'default-src'))->toBe("default-src 'self'")
        ->and(cspDirective($response, 'script-src'))->toBe("script-src 'self' 'nonce-{$nonce}' 'strict-dynamic' https://challenges.cloudflare.com")
        ->and(cspDirective($response, 'style-src'))->toBe("style-src 'self' 'unsafe-inline'")
        ->and(cspDirective($response, 'font-src'))->toBe("font-src 'self' data:")
        ->and(cspDirective($response, 'worker-src'))->toBe("worker-src 'self' blob:")
        ->and(cspDirective($response, 'frame-src'))->toBe('frame-src https://challenges.cloudflare.com')
        ->and(cspDirective($response, 'frame-ancestors'))->toBe("frame-ancestors 'none'")
        ->and(cspDirective($response, 'form-action'))->toBe("form-action 'self' https://accounts.google.com")
        ->and(cspDirective($response, 'base-uri'))->toBe("base-uri 'self'")
        ->and(cspDirective($response, 'object-src'))->toBe("object-src 'none'")
        ->and(cspDirective($response, 'manifest-src'))->toBe("manifest-src 'self'")
        ->and(cspDirective($response, 'upgrade-insecure-requests'))->toBe('upgrade-insecure-requests')
        ->and(cspDirective($response, 'report-uri'))->toBe('report-uri /csp-report')
        ->and(cspHeader($response))->not->toContain('unsafe-eval');
});

it('uses a fresh 128-bit nonce per request', function (): void {
    $first = cspNonce($this->get('/'));
    $second = cspNonce($this->get('/'));

    expect(strlen((string) base64_decode($first, true)))->toBe(16)
        ->and($second)->not->toBe($first);
});

it('puts the nonce on every script tag of the first-load HTML, the Vite ones included', function (): void {
    useViteHotFile();

    $response = $this->get('/')->assertOk();
    $nonce = cspNonce($response);
    preg_match_all('/<script\b[^>]*>/i', (string) $response->getContent(), $tags);

    expect($tags[0])->not->toBeEmpty()
        ->and(implode("\n", $tags[0]))->toContain('type="module"')->toContain('@vite/client')->toContain('data-page="app"');

    foreach ($tags[0] as $tag) {
        expect($tag)->toContain('nonce="'.$nonce.'"');
    }
});

it('gives an Inertia error page the same nonce discipline', function (): void {
    useViteHotFile();

    $response = $this->get('/definitely-missing')->assertNotFound();
    $nonce = cspNonce($response);
    preg_match_all('/<script\b[^>]*>/i', (string) $response->getContent(), $tags);

    expect($nonce)->not->toBe('')->and($tags[0])->not->toBeEmpty();

    foreach ($tags[0] as $tag) {
        expect($tag)->toContain('nonce="'.$nonce.'"');
    }
});

it('sends the other security headers', function (): void {
    $this->get('/')->assertOk()
        ->assertHeader('X-Frame-Options', 'DENY')
        ->assertHeader('X-Content-Type-Options', 'nosniff')
        ->assertHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
        ->assertHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), fullscreen=(self)')
        ->assertHeader('Cross-Origin-Opener-Policy', 'same-origin')
        ->assertHeaderMissing('Strict-Transport-Security');
});

it('sends HSTS only in production, only over HTTPS', function (): void {
    $this->app['env'] = 'production';

    $this->get('https://localhost/')->assertOk()
        ->assertHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
        ->assertHeaderMissing('X-Robots-Tag');

    $this->get('http://localhost/')->assertHeaderMissing('Strict-Transport-Security');
});

it('marks every non-production environment noindex', function (string $environment): void {
    $this->app['env'] = $environment;

    $this->get('/')->assertHeader('X-Robots-Tag', 'noindex, nofollow');
})->with(['testing', 'staging', 'local']);

it('sends Content-Security-Policy-Report-Only instead when configured', function (): void {
    config(['security.csp.report_only' => true]);

    $response = $this->get('/')->assertOk();

    expect($response->headers->has('Content-Security-Policy'))->toBeFalse()
        ->and($response->headers->get('Content-Security-Policy-Report-Only'))->toContain("default-src 'self'")->toContain('report-uri /csp-report');
});

it('adds the object-storage and Reverb origins from config', function (): void {
    config([
        'security.csp.s3_private_origin' => 'https://files.example.com',
        'security.csp.s3_public_origin' => 'https://pub.example.com',
        'security.csp.reverb_host' => 'ws.example.com',
        'security.csp.reverb_port' => 443,
    ]);

    $response = $this->get('/');

    expect(cspDirective($response, 'img-src'))->toBe("img-src 'self' data: blob: https://files.example.com https://pub.example.com")
        ->and(cspDirective($response, 'media-src'))->toBe("media-src 'self' blob: https://files.example.com")
        ->and(cspDirective($response, 'connect-src'))->toBe("connect-src 'self' wss://ws.example.com https://ws.example.com https://files.example.com https://pub.example.com https://challenges.cloudflare.com blob:");
});

it('includes a non-default Reverb port and leaves out unset origins', function (): void {
    config([
        'security.csp.s3_private_origin' => null,
        'security.csp.s3_public_origin' => null,
        'security.csp.reverb_host' => 'localhost',
        'security.csp.reverb_port' => 8080,
    ]);

    $response = $this->get('/');

    expect(cspDirective($response, 'img-src'))->toBe("img-src 'self' data: blob:")
        ->and(cspDirective($response, 'media-src'))->toBe("media-src 'self' blob:")
        ->and(cspDirective($response, 'connect-src'))->toBe("connect-src 'self' wss://localhost:8080 https://localhost:8080 https://challenges.cloudflare.com blob:")
        ->and(cspHeader($response))->not->toContain('null')->not->toContain('  ');
});

it('allows the Vite dev server only locally and only while it is running', function (): void {
    $this->app['env'] = 'local';
    $hot = useViteHotFile('http://localhost:5173');

    $response = $this->get('/');

    expect(cspDirective($response, 'script-src'))->toContain('http://localhost:5173')
        ->and(cspDirective($response, 'style-src'))->toContain('http://localhost:5173')
        ->and(cspDirective($response, 'connect-src'))->toContain('http://localhost:5173')->toContain('ws://localhost:5173');

    unlink($hot);
    expect(cspHeader($this->get('/')))->not->toContain('5173');
});

it('never allows the Vite dev server outside local', function (): void {
    $this->app['env'] = 'production';
    useViteHotFile('http://localhost:5173');

    expect(cspHeader($this->get('https://localhost/')))->not->toContain('5173');
});

describe('responses outside the web group still get the headers', function (): void {
    $expected = [
        'X-Frame-Options' => 'DENY',
        'X-Content-Type-Options' => 'nosniff',
        'Referrer-Policy' => 'strict-origin-when-cross-origin',
        'Cross-Origin-Opener-Policy' => 'same-origin',
    ];

    it('covers the stateless manifest (no CSP: it is not HTML)', function () use ($expected): void {
        $response = $this->get(route('manifest'))->assertOk();

        foreach ($expected as $name => $value) {
            $response->assertHeader($name, $value);
        }

        expect($response->headers->has('Content-Security-Policy'))->toBeFalse()
            ->and($response->headers->getCookies())->toBe([]);
    });

    it('covers the bare 404 for missing assets', function (string $path) use ($expected): void {
        $response = $this->get($path)->assertNotFound();

        foreach ($expected as $name => $value) {
            $response->assertHeader($name, $value);
        }

        expect($response->headers->getCookies())->toBe([]);
    })->with(['/build/assets/missing.js', '/missing-image.png', '/api/missing']);

    it('covers the health check', function () use ($expected): void {
        $response = $this->get('/up')->assertOk();

        foreach ($expected as $name => $value) {
            $response->assertHeader($name, $value);
        }
    });

    it('covers a 405 raised by the router', function () use ($expected): void {
        $response = $this->delete('/')->assertStatus(405);

        foreach ($expected as $name => $value) {
            $response->assertHeader($name, $value);
        }
    });

    it('covers a stateless JSON route', function () use ($expected): void {
        Route::get('/_json', fn () => response()->json(['ok' => true]));

        $response = $this->getJson('/_json')->assertOk();

        foreach ($expected as $name => $value) {
            $response->assertHeader($name, $value);
        }
    });
});

it('leaves non-HTML responses without a CSP', function (): void {
    Route::get('/_json', fn () => response()->json(['ok' => true]));

    expect($this->getJson('/_json')->headers->has('Content-Security-Policy'))->toBeFalse();
});

describe('config/security.php', function (): void {
    it('derives the origins with parse_url only', function (): void {
        $csp = evaluateConfigFile('security', [
            'AWS_URL' => 'https://files.example.com/furny-private/path?x=1',
            'AWS_ENDPOINT' => 'https://account.r2.example.com',
            'AWS_PUBLIC_URL' => 'https://pub.example.com:8443/furny-public',
            'REVERB_HOST' => 'ws.example.com',
            'REVERB_PORT' => '443',
            'CSP_REPORT_ONLY' => 'true',
        ])['csp'];

        expect($csp)->toMatchArray([
            's3_private_origin' => 'https://files.example.com',
            's3_public_origin' => 'https://pub.example.com:8443',
            'reverb_host' => 'ws.example.com',
            'reverb_port' => 443,
            'report_only' => true,
        ]);
    });

    it('falls back to the endpoint and has safe defaults', function (): void {
        $csp = evaluateConfigFile('security', [
            'AWS_URL' => false,
            'AWS_ENDPOINT' => 'http://localhost:9000',
            'AWS_PUBLIC_URL' => false,
            'REVERB_HOST' => false,
            'REVERB_PORT' => false,
            'CSP_REPORT_ONLY' => false,
        ])['csp'];

        expect($csp)->toMatchArray([
            's3_private_origin' => 'http://localhost:9000',
            's3_public_origin' => null,
            'reverb_host' => null,
            'report_only' => false,
        ]);
    });
});
