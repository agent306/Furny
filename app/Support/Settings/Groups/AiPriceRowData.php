<?php

declare(strict_types=1);

namespace App\Support\Settings\Groups;

/**
 * One row of `ai.price_table` (18 §14): USD per million tokens as decimal strings.
 */
final class AiPriceRowData extends SettingsItemData
{
    public function __construct(
        public string $provider,
        public string $model,
        public string $inputPerMtokUsd,
        public string $outputPerMtokUsd,
    ) {}
}
