<?php

declare(strict_types=1);

use Illuminate\Support\Facades\Route;
use Inertia\Inertia;

const SCRIPT_BREAKOUT = '</script><script>alert(1)</script>';

/** @return array<string, mixed> The page object the browser would read from `script[data-page=app]`. */
function dataPage(string $html): array
{
    preg_match('/<script data-page="app"[^>]*>(.*?)<\/script>/s', $html, $match);

    return json_decode($match[1] ?? '', true, flags: JSON_THROW_ON_ERROR);
}

beforeEach(function (): void {
    Route::middleware('web')->get('/_escape', fn () => Inertia::render('Welcome', [
        'note' => SCRIPT_BREAKOUT,
        'nested' => ['html' => '<!-- <script>', 'amp' => 'a&b'],
    ]));
    Route::middleware('web')->get('/_escape-flash', function () {
        Inertia::flash('info', SCRIPT_BREAKOUT);

        return redirect('/_escape');
    });
    Route::middleware('web')->get('/_binary', fn () => Inertia::render('Welcome', ['note' => "ok \xB1\x31 bad"]));
});

it('never lets a prop close the data block', function (): void {
    $html = (string) $this->get('/_escape')->assertOk()->getContent();

    // The block is read up to its first `</script>`; a raw one inside would truncate it, so the JSON would not parse.
    $page = dataPage($html);

    expect($page['props']['note'])->toBe(SCRIPT_BREAKOUT)
        ->and($page['props']['nested'])->toBe(['html' => '<!-- <script>', 'amp' => 'a&b'])
        ->and(substr_count($html, '</script>'))->toBe(substr_count($html, '<script'))
        ->and($html)->not->toContain('alert(1)</script>')
        ->and($html)->toContain('\\u003C\\/script\\u003E');
});

it('never lets a flash message close the data block', function (): void {
    $html = (string) $this->followingRedirects()->get('/_escape-flash')->assertOk()->getContent();

    $page = dataPage($html);

    expect($page['flash'])->toBe(['info' => SCRIPT_BREAKOUT])
        ->and(substr_count($html, '</script>'))->toBe(substr_count($html, '<script'));
});

it('still renders the page when a prop holds invalid UTF-8', function (): void {
    $html = (string) $this->get('/_binary')->assertOk()->getContent();

    $page = dataPage($html);

    expect($page['component'])->toBe('Welcome')
        ->and($page['props']['note'])->toBe("ok \u{FFFD}1 bad");
});
