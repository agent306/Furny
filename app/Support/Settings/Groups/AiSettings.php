<?php

declare(strict_types=1);

namespace App\Support\Settings\Groups;

use Spatie\LaravelData\Attributes\DataCollectionOf;

/**
 * `ai` (02 §13, owner-only). `provider` is `anthropic|openai|openai_compatible|none`, `effort`
 * `low|medium|high`, `budgetExhaustedBehavior` `fallback_none|block`; `globalMonthlyBudgetUsd` is a
 * decimal string (`0` = unlimited).
 */
final class AiSettings extends SettingsData
{
    /**
     * @param  list<AiPriceRowData>  $priceTable
     */
    public function __construct(
        public string $provider,
        public string $model,
        public string $effort,
        public bool $agenticCrops,
        public bool $fallbackToNoneOnError,
        public int $signupCredits,
        public int $monthlyCredits,
        public int $creditsPerRecognition,
        public int $creditsPerRecognitionNone,
        public int $maxRecognitionsPerDay,
        public string $globalMonthlyBudgetUsd,
        public string $budgetExhaustedBehavior,
        #[DataCollectionOf(AiPriceRowData::class)]
        public array $priceTable,
        public bool $staffUnlimited,
    ) {}

    public static function defaults(): static
    {
        return new self(
            provider: 'anthropic',
            model: 'claude-opus-5-5',
            effort: 'high',
            agenticCrops: true,
            fallbackToNoneOnError: true,
            signupCredits: 3,
            monthlyCredits: 3,
            creditsPerRecognition: 1,
            creditsPerRecognitionNone: 0,
            maxRecognitionsPerDay: 5,
            globalMonthlyBudgetUsd: '50.00',
            budgetExhaustedBehavior: 'fallback_none',
            priceTable: [
                new AiPriceRowData('anthropic', 'claude-opus-5-5', '4.00', '20.00'),
                new AiPriceRowData('anthropic', 'claude-sonnet-5-5', '2.00', '10.00'),
                new AiPriceRowData('anthropic', 'claude-haiku-5-5', '0.10', '0.50'),
            ],
            staffUnlimited: true,
        );
    }
}
