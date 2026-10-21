<?php

declare(strict_types=1);

namespace App\Support\Settings;

use Illuminate\Support\Facades\DB;

/**
 * The catalog version stamp (`app_settings['catalog.version']`, 02 §13). Every catalog write bumps
 * it once so estimates and caches keyed on it are invalidated (08 §7).
 */
final class CatalogVersion
{
    /**
     * Atomically increments the stored version and returns the new value. Runs on the current
     * connection, so inside a transaction a rollback also undoes the bump; the cache is busted
     * only after commit.
     */
    public static function bump(): int
    {
        // A missing row stands for the implicit default 1, so its first bump yields 2.
        $rows = DB::select(
            <<<'SQL'
            INSERT INTO app_settings (key, value, created_at, updated_at)
            VALUES (?, to_jsonb(2), now(), now())
            ON CONFLICT (key) DO UPDATE
                SET value = to_jsonb((app_settings.value #>> '{}')::bigint + 1), updated_at = now()
            RETURNING (value #>> '{}')::bigint AS version
            SQL,
            [Settings::CATALOG_VERSION_KEY],
        );

        Settings::forgetAfterCommit(Settings::CATALOG_VERSION_KEY);

        return (int) $rows[0]->version;
    }
}
