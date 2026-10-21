<?php

declare(strict_types=1);

use App\Providers\AppServiceProvider;
use Illuminate\Contracts\Foundation\MaintenanceMode;
use Illuminate\Foundation\Vite as ViteService;
use Illuminate\Support\Facades\Log;
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

describe('origins from the environment cannot inject CSP directives', function (): void {
    it('drops :name = :value', function (string $variable, string $value, string $key): void {
        $config = evaluateConfigFile('security', [
            'AWS_URL' => false,
            'AWS_ENDPOINT' => false,
            'AWS_PUBLIC_URL' => false,
            'REVERB_HOST' => false,
            'REVERB_PORT' => false,
            $variable => $value,
        ])['csp'];

        expect($config[$key])->toBeNull()
            ->and($config['rejected'])->toBe([$variable]);
    })->with([
        'private url, directive' => ['AWS_URL', ';script-src *', 's3_private_origin'],
        'private url, trailing wildcard source' => ['AWS_URL', 'https://files.example.com *', 's3_private_origin'],
        'private url, wildcard host' => ['AWS_URL', 'https://*', 's3_private_origin'],
        'private url, wildcard subdomain' => ['AWS_URL', 'https://*.example.com', 's3_private_origin'],
        'private url, scheme' => ['AWS_URL', 'javascript://files.example.com', 's3_private_origin'],
        'private url, data scheme' => ['AWS_URL', 'data:text/html,x', 's3_private_origin'],
        'private url, semicolon in host' => ['AWS_URL', 'https://files.example.com;script-src', 's3_private_origin'],
        'private url, port' => ['AWS_URL', 'https://files.example.com:80a', 's3_private_origin'],
        'endpoint fallback' => ['AWS_ENDPOINT', "https://files.example.com\nscript-src *", 's3_private_origin'],
        'public url' => ['AWS_PUBLIC_URL', 'https://pub.example.com; script-src *', 's3_public_origin'],
        'public url, wildcard' => ['AWS_PUBLIC_URL', 'https://*', 's3_public_origin'],
        'reverb host, directive' => ['REVERB_HOST', 'ws.example.com; script-src *', 'reverb_host'],
        'reverb host, wildcard' => ['REVERB_HOST', '*.example.com', 'reverb_host'],
        'reverb host, scheme' => ['REVERB_HOST', 'https://ws.example.com', 'reverb_host'],
        'reverb host, trailing newline' => ['REVERB_HOST', "ws.example.com\n", 'reverb_host'],
        'reverb host, leading newline' => ['REVERB_HOST', "\nws.example.com", 'reverb_host'],
        'reverb host, newline inside' => ['REVERB_HOST', "ws.example.com\nscript-src *", 'reverb_host'],
        'reverb port, trailing newline' => ['REVERB_PORT', "8080\n", 'reverb_port'],
        'private url, trailing newline' => ['AWS_URL', "https://files.example.com\n", 's3_private_origin'],
        'private url, newline after host' => ['AWS_URL', "https://files.example.com\nscript-src *", 's3_private_origin'],
        'public url, trailing newline' => ['AWS_PUBLIC_URL', "https://pub.example.com\n", 's3_public_origin'],
        'reverb host, space' => ['REVERB_HOST', 'ws.example.com *', 'reverb_host'],
        'reverb port, text' => ['REVERB_PORT', '443; script-src *', 'reverb_port'],
        'reverb port, out of range' => ['REVERB_PORT', '70000', 'reverb_port'],
    ]);

    it('keeps valid origins and rejects nothing', function (): void {
        $config = evaluateConfigFile('security', [
            'AWS_URL' => 'https://files.example.com',
            'AWS_ENDPOINT' => false,
            'AWS_PUBLIC_URL' => 'http://localhost:9000/furny-public',
            'REVERB_HOST' => 'ws-1.example.com',
            'REVERB_PORT' => '8080',
        ])['csp'];

        expect($config)->toMatchArray([
            's3_private_origin' => 'https://files.example.com',
            's3_public_origin' => 'http://localhost:9000',
            'reverb_host' => 'ws-1.example.com',
            'reverb_port' => 8080,
            'rejected' => [],
        ]);
    });

    it('puts nothing of a rejected value into the policy', function (): void {
        config([
            'security.csp.s3_private_origin' => null,
            'security.csp.s3_public_origin' => null,
            'security.csp.reverb_host' => null,
            'security.csp.reverb_port' => null,
        ]);

        $csp = cspHeader($this->get('/'));

        expect($csp)->not->toContain('*')->not->toContain('wss://')->and(substr_count($csp, 'script-src'))->toBe(1);
    });

    /** The warning is given once per PHP process; each test starts from a process that has not given it. */
    function resetCspWarning(): void
    {
        (new ReflectionProperty(AppServiceProvider::class, 'cspWarningGiven'))->setValue(null, false);
    }

    beforeEach(fn () => resetCspWarning());
    afterEach(fn () => resetCspWarning());

    it('warns once per process, naming the variables but not their values', function (): void {
        config(['security.csp.rejected' => ['AWS_URL', 'REVERB_HOST']]);
        Log::spy();

        // Boot runs again for every request in a php-fpm worker.
        (new AppServiceProvider($this->app))->boot();
        (new AppServiceProvider($this->app))->boot();

        Log::shouldHaveReceived('warning')->once()->withArgs(
            fn (string $message, array $context) => str_contains($message, 'CSP') && $context === ['variables' => ['AWS_URL', 'REVERB_HOST']],
        );
    });

    it('stays quiet when nothing was rejected', function (): void {
        config(['security.csp.rejected' => []]);
        Log::spy();

        (new AppServiceProvider($this->app))->boot();

        Log::shouldNotHaveReceived('warning');
    });
});

describe('dashboards get a relaxed script policy', function (): void {
    it('allows inline scripts and styles on :path, without nonce or strict-dynamic', function (string $path): void {
        $response = $this->get($path);

        expect(cspDirective($response, 'script-src'))->toContain("'unsafe-inline'")->toContain("'self'")
            ->not->toContain('nonce-')->not->toContain('strict-dynamic')
            ->and(cspDirective($response, 'style-src'))->toContain("'unsafe-inline'")
            ->and(cspDirective($response, 'frame-ancestors'))->toBe("frame-ancestors 'none'")
            ->and(cspDirective($response, 'object-src'))->toBe("object-src 'none'")
            ->and(cspDirective($response, 'base-uri'))->toBe("base-uri 'self'")
            ->and(cspDirective($response, 'default-src'))->toBe("default-src 'self'");
    })->with(['/horizon', '/horizon/dashboard', '/horizon/api/stats', '/pulse', '/pulse/anything', '/telescope', '/telescope/requests']);

    it('leaves :path with the strict nonce policy', function (string $path): void {
        $response = $this->get($path);
        $nonce = cspNonce($response);

        expect($nonce)->not->toBe('')
            ->and(cspDirective($response, 'script-src'))->toBe("script-src 'self' 'nonce-{$nonce}' 'strict-dynamic' https://challenges.cloudflare.com");
    })->with(['/', '/terms', '/horizons', '/horizon-x', '/pulsed', '/admin', '/telescoped', '/definitely-missing', '/x/horizon']);

    it('also relaxes the report-only header', function (): void {
        config(['security.csp.report_only' => true]);

        expect(cspDirective($this->get('/horizon'), 'script-src'))->toContain("'unsafe-inline'")->not->toContain('nonce-');
    });

    it('follows the configured dashboard paths', function (): void {
        config(['pulse.path' => 'ops/pulse', 'telescope.path' => 'ops/telescope', 'horizon.path' => 'ops/horizon']);

        foreach (['/ops/pulse', '/ops/telescope/requests', '/ops/horizon'] as $path) {
            expect(cspDirective($this->get($path), 'script-src'))->toContain("'unsafe-inline'");
        }

        expect(cspDirective($this->get('/pulse'), 'script-src'))->toContain('nonce-');
    });
});

describe('maintenance mode', function (): void {
    beforeEach(function (): void {
        // A fake driver, as in MaintenanceModeTest: nothing is written to storage/framework/down.
        $this->app->instance(MaintenanceMode::class, new class implements MaintenanceMode
        {
            public function activate(array $payload): void {}

            public function deactivate(): void {}

            public function active(): bool
            {
                return true;
            }

            public function data(): array
            {
                return ['except' => [], 'redirect' => null, 'retry' => null, 'refresh' => null, 'secret' => null, 'status' => 503, 'template' => null];
            }
        });
    });

    it('sends the security headers on the 503', function (): void {
        $this->get('/')->assertStatus(503)
            ->assertHeader('X-Frame-Options', 'DENY')
            ->assertHeader('X-Content-Type-Options', 'nosniff')
            ->assertHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
            ->assertHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), fullscreen=(self)')
            ->assertHeader('Cross-Origin-Opener-Policy', 'same-origin')
            ->assertHeader('X-Robots-Tag', 'noindex, nofollow');
    });

    it('sends the CSP on the 503 page too, with a nonce for its HTML', function (): void {
        $response = $this->get('/')->assertStatus(503);

        expect(cspNonce($response))->not->toBe('')
            ->and(cspDirective($response, 'frame-ancestors'))->toBe("frame-ancestors 'none'");
    });

    it('sends HSTS on the 503 in production over HTTPS', function (): void {
        $this->app['env'] = 'production';

        $this->get('https://localhost/')->assertStatus(503)->assertHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    });
});
