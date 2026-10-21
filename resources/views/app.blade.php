@php
    // Normally shared by HandleAppearance (web group). Defaults keep the root view
    // renderable where that middleware did not run (error pages, bare routes).
    $appearance ??= 'system';
    $themeColors ??= \App\Http\Middleware\HandleAppearance::THEME_COLOR;
    $themeColor ??= $themeColors[$appearance === 'dark' ? 'dark' : 'light'];
@endphp
<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}" @class(['dark' => $appearance === 'dark'])>
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <meta name="theme-color" content="{{ $themeColor }}">

        {{-- Applies `system` before first paint (15 §11). $appearance is allow-listed to light|dark|system by HandleAppearance, so it is safe in the class above and in this script. --}}
        <script @isset($csp_nonce) nonce="{{ $csp_nonce }}" @endisset>
            (function () {
                const appearance = @js($appearance);

                if (appearance === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
                    document.documentElement.classList.add('dark');
                    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', @js($themeColors['dark']));
                }
            })();
        </script>

        {{-- Page background before the stylesheet loads: the --background token of each theme (app.css). --}}
        <style>
            html {
                background-color: oklch(0.985 0.004 85);
            }

            html.dark {
                background-color: oklch(0.18 0.008 60);
            }
        </style>

        <link rel="icon" href="/favicon.ico" sizes="any">
        <link rel="icon" href="/favicon.svg" type="image/svg+xml">
        <link rel="manifest" href="/manifest.webmanifest">
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon-180.png">
        <meta name="apple-mobile-web-app-capable" content="yes">

        @vite(['resources/css/app.css', 'resources/js/app.ts', "resources/js/pages/{$page['component']}.vue"])
        <x-inertia::head>
            <title>{{ config('app.name', 'Laravel') }}</title>
        </x-inertia::head>
    </head>
    <body class="font-sans antialiased">
        {{-- <x-inertia::app /> without SSR (not used in v1, 01 §3), written out so the page data block carries
             the CSP nonce like every other script of the document (13 §12.1). --}}
        <script data-page="app" type="application/json" @isset($csp_nonce) nonce="{{ $csp_nonce }}" @endisset>{!! json_encode($page, JSON_HEX_TAG) !!}</script>
        <div id="app"></div>
    </body>
</html>
