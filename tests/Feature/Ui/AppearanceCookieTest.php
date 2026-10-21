<?php

declare(strict_types=1);

use App\Http\Middleware\HandleAppearance;
use Illuminate\Cookie\Middleware\EncryptCookies;

/** The inline script's appearance constant, however the string is quoted. */
const SYSTEM_APPEARANCE = '/const appearance = ([\'"])system\1/';

/**
 * 15 §11 / 13 §12.2: the unencrypted `appearance` cookie lets the Blade root
 * render the right theme before any CSS or JS runs.
 */
function renderedRoot(?string $cookie): string
{
    $test = test();

    if ($cookie !== null) {
        $test = $test->withUnencryptedCookie('appearance', $cookie);
    }

    return $test->get('/')->assertOk()->getContent();
}

/** The opening `<html …>` tag. */
function htmlTag(string $document): string
{
    preg_match('/<html\b[^>]*>/', $document, $match);

    return $match[0] ?? '';
}

it('renders the dark class and the dark theme-color for appearance=dark', function () {
    $document = renderedRoot('dark');

    expect(htmlTag($document))->toMatch('/class="[^"]*\bdark\b[^"]*"/')
        ->and($document)->toContain('<meta name="theme-color" content="#1d1a17">');
});

it('renders no dark class and the light theme-color for appearance=light', function () {
    $document = renderedRoot('light');

    expect(htmlTag($document))->not->toContain('dark')
        ->and($document)->toContain('<meta name="theme-color" content="#fbfaf7">');
});

it('leaves system to the inline script and defaults to system without a cookie', function (?string $cookie) {
    $document = renderedRoot($cookie);

    expect(htmlTag($document))->not->toContain('dark')
        ->and($document)->toMatch(SYSTEM_APPEARANCE)
        ->and($document)->toContain('<meta name="theme-color" content="#fbfaf7">');
})->with([[null], ['system']]);

it('reads the cookie unencrypted', function () {
    // An encrypted cookie jar would drop the plain value, so `dark` surviving proves it.
    $this->withUnencryptedCookie('appearance', 'dark')->get('/')
        ->assertOk()
        ->assertSee('content="#1d1a17"', false);
});

it('allow-lists the cookie before rendering it into the class or the inline script', function (string $payload) {
    $document = renderedRoot($payload);

    expect($document)->not->toContain($payload)
        ->and($document)->not->toContain('alert(1)')
        ->and(htmlTag($document))->not->toContain('dark')
        ->and($document)->toMatch(SYSTEM_APPEARANCE);
})->with([
    'script breakout' => ['</script><script>alert(1)</script>'],
    'attribute breakout' => ['"><img src=x onerror=alert(1)>'],
    'quote breakout' => ["';alert(1);//"],
    'unknown value' => ['sepia'],
    'wrong case' => ['DARK'],
]);

it('shares only light, dark or system with the views', function () {
    $this->withUnencryptedCookie('appearance', 'dark')->get('/');
    expect(view()->shared('appearance'))->toBe('dark');

    $this->withUnencryptedCookie('appearance', '<b>')->get('/');
    expect(view()->shared('appearance'))->toBe('system');

    $this->get('/', ['Cookie' => 'appearance[]=dark']);
    expect(view()->shared('appearance'))->toBe('system');
});

it('keeps the PHP theme-color constants in sync with lib/theme/meta.ts', function () {
    $meta = file_get_contents(base_path('resources/js/lib/theme/meta.ts'));

    preg_match("/light:\s*'(#[0-9a-f]{6})'/i", $meta, $light);
    preg_match("/dark:\s*'(#[0-9a-f]{6})'/i", $meta, $dark);

    expect(HandleAppearance::THEME_COLOR)->toBe(['light' => $light[1], 'dark' => $dark[1]]);
});

it('exempts the appearance cookie from encryption', function () {
    // The browser sets this cookie in plain text, so it must be on the exception list.
    $encrypter = app(EncryptCookies::class);

    expect($encrypter->isDisabled('appearance'))->toBeTrue()
        ->and($encrypter->isDisabled('laravel_session'))->toBeFalse();
});

it('gives the inline theme script the CSP nonce when one is shared, and none otherwise', function () {
    $inlineScript = fn (string $document): string => preg_match('/<script(?![^>]*\bsrc=)[^>]*>\s*\(function \(\) \{/', $document, $match) ? $match[0] : '';

    expect($inlineScript(renderedRoot(null)))->not->toContain('nonce');

    view()->share('csp_nonce', 'abc123');

    expect($inlineScript(renderedRoot(null)))->toContain('nonce="abc123"');
});
