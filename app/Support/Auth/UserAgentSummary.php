<?php

declare(strict_types=1);

namespace App\Support\Auth;

/**
 * `"{Browser} on {OS}"` from a User-Agent header, for the device list (13 §6.3). A handful of regular expressions,
 * no package: the summary only has to let a person recognise their own device.
 */
final class UserAgentSummary
{
    /** User agents are attacker-controlled; only the start is read. */
    private const int MAX_LENGTH = 512;

    /**
     * Order matters: Edge, Opera and the iOS wrappers also say "Chrome" or "Safari", and Chrome says "Safari".
     *
     * @var array<string, string>
     */
    private const array BROWSERS = [
        'Edge' => '/\b(?:Edg|EdgA|EdgiOS|Edge)\//',
        'Opera' => '/\b(?:OPR|OPiOS)\//',
        'Firefox' => '/\b(?:Firefox|FxiOS)\//',
        'Chrome' => '/\b(?:Chrome|CriOS)\//',
        'Safari' => '/\bVersion\/[\d.]+.*\bSafari\//',
    ];

    /**
     * Order matters: an iPhone says "like Mac OS X", Android and ChromeOS say "Linux" or "X11".
     *
     * @var array<string, string>
     */
    private const array SYSTEMS = [
        'iOS' => '/\b(?:iPhone|iPad|iPod)\b/',
        'Android' => '/\bAndroid\b/',
        'ChromeOS' => '/\bCrOS\b/',
        'Windows' => '/\bWindows\b/',
        'macOS' => '/\bMacintosh\b|\bMac OS X\b/',
        'Linux' => '/\bLinux\b|\bX11\b/',
    ];

    public static function from(string $userAgent): string
    {
        $userAgent = substr($userAgent, 0, self::MAX_LENGTH);

        return (self::firstMatch(self::BROWSERS, $userAgent) ?? 'Unknown browser')
            .' on '
            .(self::firstMatch(self::SYSTEMS, $userAgent) ?? 'Unknown OS');
    }

    /** @param  array<string, string>  $patterns */
    private static function firstMatch(array $patterns, string $userAgent): ?string
    {
        foreach ($patterns as $name => $pattern) {
            if (preg_match($pattern, $userAgent) === 1) {
                return $name;
            }
        }

        return null;
    }
}
