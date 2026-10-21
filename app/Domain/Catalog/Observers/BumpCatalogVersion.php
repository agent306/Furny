<?php

declare(strict_types=1);

namespace App\Domain\Catalog\Observers;

use App\Support\Settings\CatalogVersion;
use Illuminate\Database\Eloquent\Model;
use WeakMap;

/**
 * 02 §6: every write to a catalog table increments `catalog.version` inside the surrounding
 * transaction, once per write. The observer only calls {@see CatalogVersion::bump()}; it never reads
 * the version, so nothing is cached inside a transaction that may still roll back.
 *
 * Eloquent fires two events for some writes, and exactly one of each pair bumps:
 * - `restore()` saves the model (`saved`) and then fires `restored`: `restored` bumps;
 * - `forceDelete()` fires `deleted` and then `forceDeleted`: `forceDeleted` bumps.
 */
final class BumpCatalogVersion
{
    private static int $mutedDepth = 0;

    /** @var WeakMap<Model, true>|null Models whose `saved` is the save of a `restore()`. */
    private static ?WeakMap $restoring = null;

    /**
     * Runs `$fn` without bumping per write. The caller bumps once afterwards (seeders, bulk imports).
     *
     * @template T
     *
     * @param  callable(): T  $fn
     * @return T
     */
    public static function muted(callable $fn): mixed
    {
        self::$mutedDepth++;

        try {
            return $fn();
        } finally {
            self::$mutedDepth--;
        }
    }

    public function saved(Model $model): void
    {
        if (isset(self::restoringModels()[$model])) {
            return;
        }

        $this->bump();
    }

    public function deleted(Model $model): void
    {
        if (method_exists($model, 'isForceDeleting') && $model->isForceDeleting()) {
            return;
        }

        $this->bump();
    }

    public function restoring(Model $model): void
    {
        self::restoringModels()[$model] = true;
    }

    public function restored(Model $model): void
    {
        unset(self::restoringModels()[$model]);

        $this->bump();
    }

    public function forceDeleted(Model $model): void
    {
        $this->bump();
    }

    private function bump(): void
    {
        if (self::$mutedDepth === 0) {
            CatalogVersion::bump();
        }
    }

    /**
     * @return WeakMap<Model, true>
     */
    private static function restoringModels(): WeakMap
    {
        return self::$restoring ??= new WeakMap;
    }
}
