<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Http\Middleware\HandleAppearance;
use App\Support\Settings\Settings;
use Illuminate\Http\JsonResponse;

/**
 * `manifest` (10 §15, 12 §8.3, 14 §2): the web app manifest, built per request from the settings and the
 * config so a renamed business or app needs no file edit. The icons are the committed files in `public/icons`.
 */
final class ManifestController extends Controller
{
    /** Home-screen labels are cut off by the OS beyond roughly this length. */
    private const int SHORT_NAME_LENGTH = 12;

    public function __invoke(Settings $settings): JsonResponse
    {
        $background = HandleAppearance::THEME_COLOR['light'];

        return response()->json([
            'name' => $settings->business()->name,
            'short_name' => mb_substr((string) config('app.name'), 0, self::SHORT_NAME_LENGTH),
            'id' => '/',
            'start_url' => '/',
            'scope' => '/',
            'display' => 'standalone',
            'background_color' => $background,
            'theme_color' => $background,
            'icons' => [
                ['src' => '/icons/app-192.png', 'sizes' => '192x192', 'type' => 'image/png', 'purpose' => 'any'],
                ['src' => '/icons/app-512.png', 'sizes' => '512x512', 'type' => 'image/png', 'purpose' => 'any'],
                ['src' => '/icons/app-maskable-512.png', 'sizes' => '512x512', 'type' => 'image/png', 'purpose' => 'maskable'],
            ],
        ], 200, [
            'Content-Type' => 'application/manifest+json',
            'Cache-Control' => 'public, max-age=3600',
        ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    }
}
