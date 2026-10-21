<?php

declare(strict_types=1);

namespace App\Support\Settings\Groups;

use Spatie\LaravelData\Attributes\DataCollectionOf;

/**
 * `workflow` (02 §13).
 */
final class WorkflowSettings extends SettingsData
{
    /** Default stages of 09 §8: key => default progress. */
    private const array DEFAULT_STAGES = [
        'material_procurement' => 10,
        'cutting' => 25,
        'edge_banding' => 40,
        'drilling' => 50,
        'finishing' => 65,
        'assembly' => 80,
        'quality_check' => 90,
        'packing' => 95,
    ];

    /**
     * @param  list<ProductionStageData>  $productionStages
     */
    public function __construct(
        public int $quoteValidityDays,
        public int $autoCloseDays,
        public int $reminderAfterHours,
        #[DataCollectionOf(ProductionStageData::class)]
        public array $productionStages,
        public int $requireCompletionPhotos,
        public bool $allowCustomerCounterOffer,
        public int $maxNegotiationRounds,
        public int $minPreferredDeliveryDays,
    ) {}

    public static function defaults(): static
    {
        $stages = [];

        foreach (self::DEFAULT_STAGES as $key => $progress) {
            $stages[] = new ProductionStageData($key, "production.stages.{$key}", null, $progress);
        }

        return new self(
            quoteValidityDays: 15,
            autoCloseDays: 14,
            reminderAfterHours: 48,
            productionStages: $stages,
            requireCompletionPhotos: 1,
            allowCustomerCounterOffer: true,
            maxNegotiationRounds: 5,
            minPreferredDeliveryDays: 7,
        );
    }
}
