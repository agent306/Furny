<?php

declare(strict_types=1);

use App\Domain\Identity\Models\User;
use App\Support\Settings\Settings;
use App\Support\Settings\SettingsGroup;

/** @return array<string, mixed> */
function manifest(): array
{
    return test()->get(route('manifest'))->assertOk()->json();
}

it('serves the web app manifest as application/manifest+json', function (): void {
    $response = $this->get(route('manifest'))->assertOk();

    expect($response->headers->get('Content-Type'))->toStartWith('application/manifest+json')
        ->and($response->headers->get('Cache-Control'))->toContain('public')->toContain('max-age=3600');
});

it('lives at /manifest.webmanifest', function (): void {
    expect(route('manifest', absolute: false))->toBe('/manifest.webmanifest');
});

it('builds the identity from the settings and the config', function (): void {
    $settings = app(Settings::class);
    $business = $settings->business();
    $business->name = 'Acme Woodworks Pvt Ltd';
    $settings->put(SettingsGroup::Business, $business);
    config(['app.name' => 'Furny']);

    expect(manifest())->toMatchArray([
        'name' => 'Acme Woodworks Pvt Ltd',
        'short_name' => 'Furny',
        'id' => '/',
        'start_url' => '/',
        'scope' => '/',
        'display' => 'standalone',
        'background_color' => '#fbfaf7',
        'theme_color' => '#fbfaf7',
    ]);
});

it('truncates the short name to 12 characters, by characters not bytes', function (string $name, string $short): void {
    config(['app.name' => $name]);

    expect(manifest()['short_name'])->toBe($short);
})->with([
    ['A Very Long Application Name', 'A Very Long '],
    ['Exactly12chr', 'Exactly12chr'],
    ['Möbelwerkstätten Süd', 'Möbelwerkstä'],
]);

it('lists the three icons and every file exists', function (): void {
    $icons = manifest()['icons'];

    expect($icons)->toHaveCount(3)
        ->and($icons[0])->toMatchArray(['src' => '/icons/app-192.png', 'sizes' => '192x192', 'type' => 'image/png'])
        ->and($icons[1])->toMatchArray(['src' => '/icons/app-512.png', 'sizes' => '512x512', 'type' => 'image/png'])
        ->and($icons[2])->toMatchArray(['src' => '/icons/app-maskable-512.png', 'sizes' => '512x512', 'type' => 'image/png', 'purpose' => 'maskable']);

    foreach ($icons as $icon) {
        expect(public_path($icon['src']))->toBeFile();
    }
});

it('ships every committed icon at its documented size', function (string $file, int $size): void {
    $info = getimagesize(public_path("icons/{$file}"));

    expect($info)->not->toBeFalse()
        ->and([$info[0], $info[1]])->toBe([$size, $size])
        ->and($info['mime'])->toBe('image/png');
})->with([
    ['app-192.png', 192],
    ['app-512.png', 512],
    ['app-maskable-512.png', 512],
    ['apple-touch-icon-180.png', 180],
    ['notification-192.png', 192],
    ['badge-72.png', 72],
]);

it('is public and does not depend on the session user', function (): void {
    $guest = $this->get(route('manifest'))->json();
    $customer = $this->actingAs(User::factory()->create())->get(route('manifest'))->json();

    expect($customer)->toBe($guest);
});

it('links the manifest and the touch icon from the page head', function (): void {
    $html = $this->get(route('welcome'))->getContent();

    expect($html)->toContain('<link rel="manifest" href="/manifest.webmanifest">')
        ->and($html)->toContain('<link rel="apple-touch-icon" href="/icons/apple-touch-icon-180.png">')
        ->and($html)->toContain('<meta name="apple-mobile-web-app-capable" content="yes">');
});
