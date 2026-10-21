<?php

declare(strict_types=1);

namespace App\Support\Settings\Groups;

/**
 * One entry of `workflow.production_stages` (09 §8): a built-in stage has `labelKey`, a custom
 * stage has `label` (≤ 60); the key `completed` is reserved and keys are immutable once used.
 */
final class ProductionStageData extends SettingsItemData
{
    public function __construct(
        public string $key,
        public ?string $labelKey,
        public ?string $label,
        public int $defaultProgress,
    ) {}
}
