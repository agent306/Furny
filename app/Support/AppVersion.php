<?php

declare(strict_types=1);

namespace App\Support;

/**
 * Resolves the deployed version shown in `app.version` (17 §5.11 item 9).
 */
final class AppVersion
{
    /**
     * An explicit APP_VERSION wins; otherwise the short source commit that Coolify
     * provides as SOURCE_COMMIT; otherwise `dev`.
     */
    public static function resolve(?string $appVersion, ?string $sourceCommit): string
    {
        if (filled($appVersion)) {
            return $appVersion;
        }

        if (filled($sourceCommit)) {
            return substr($sourceCommit, 0, 7);
        }

        return 'dev';
    }
}
