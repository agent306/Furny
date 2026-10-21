<?php

declare(strict_types=1);

use Illuminate\Cookie\Middleware\EncryptCookies;
use Illuminate\Support\Facades\Route;
use Illuminate\Testing\TestResponse;
use Symfony\Component\HttpFoundation\Cookie;

/** 13 §6.1, §12.2: production values, applied through config as the deployment env does. */
beforeEach(function (): void {
    config([
        'session.secure' => true,
        'session.cookie' => '__Host-session',
        'session.http_only' => true,
        'session.same_site' => 'lax',
        'session.domain' => null,
        'session.path' => '/',
    ]);
});

function cookieNamed(TestResponse $response, string $name): ?Cookie
{
    foreach ($response->headers->getCookies() as $cookie) {
        if ($cookie->getName() === $name) {
            return $cookie;
        }
    }

    return null;
}

it('sets the session cookie Secure, HttpOnly, SameSite=Lax, Path=/ and without Domain', function (): void {
    $cookie = cookieNamed($this->get('/'), '__Host-session');

    expect($cookie)->not->toBeNull()
        ->and($cookie->isSecure())->toBeTrue()
        ->and($cookie->isHttpOnly())->toBeTrue()
        ->and($cookie->getSameSite())->toBe('lax')
        ->and($cookie->getPath())->toBe('/')
        ->and($cookie->getDomain())->toBeNull();
});

it('meets the __Host- prefix rules in the raw header', function (): void {
    $raw = collect($this->get('/')->headers->all('set-cookie'))->first(fn (string $line) => str_starts_with($line, '__Host-session='));

    expect($raw)->toContain('; secure')->toContain('; httponly')->toContain('samesite=lax')->toContain('path=/')->not->toContain('domain=');
});

it('sets XSRF-TOKEN readable by the frontend', function (): void {
    Route::middleware('web')->get('/_xsrf', fn () => response('ok'));

    $cookie = cookieNamed($this->get('/_xsrf'), 'XSRF-TOKEN');

    expect($cookie)->not->toBeNull()
        ->and($cookie->isHttpOnly())->toBeFalse()
        ->and($cookie->isSecure())->toBeTrue()
        ->and($cookie->getSameSite())->toBe('lax');
});

it('leaves the appearance cookie unencrypted and encrypts the others', function (): void {
    $middleware = app(EncryptCookies::class);

    expect($middleware->isDisabled('appearance'))->toBeTrue()
        ->and($middleware->isDisabled('__Host-session'))->toBeFalse()
        ->and($middleware->isDisabled('sidebar_state'))->toBeFalse();
});

it('encrypts the history state of every page (13 §12.4)', function (): void {
    expect(config('inertia.history.encrypt'))->toBeTrue();
});

it('does not set a cookie on the stateless routes', function (): void {
    expect($this->get(route('manifest'))->headers->getCookies())->toBe([])
        ->and($this->get('/build/missing.js')->headers->getCookies())->toBe([]);
});
