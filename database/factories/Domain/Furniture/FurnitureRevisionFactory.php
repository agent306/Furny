<?php

declare(strict_types=1);

namespace Database\Factories\Domain\Furniture;

use App\Domain\Furniture\Enums\AuthorKind;
use App\Domain\Furniture\Enums\BomStatus;
use App\Domain\Furniture\Enums\FurnitureRevisionReason;
use App\Domain\Furniture\Models\FurnitureDesign;
use App\Domain\Furniture\Models\FurnitureRevision;
use Database\Factories\Support\Documents;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * Default: checkpoint number 1 of a new design by its customer, BOM still pending (02 §5.2). The
 * BOM and price of `bomReady` are empty but structurally valid; P5 switches them to the engine
 * CLI fixtures.
 *
 * @extends Factory<FurnitureRevision>
 */
final class FurnitureRevisionFactory extends Factory
{
    private const string ENGINE_VERSION = '1.0.0';

    protected $model = FurnitureRevision::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'furniture_design_id' => FurnitureDesign::factory(),
            'number' => 1,
            'document' => Documents::placeholderFurniture(),
            'schema_version' => 1,
            'bom_status' => BomStatus::Pending,
            'reason' => FurnitureRevisionReason::ManualCheckpoint,
            'author_id' => null,
            'author_kind' => AuthorKind::Customer,
        ];
    }

    public function reason(FurnitureRevisionReason $reason): static
    {
        return $this->state(['reason' => $reason]);
    }

    public function manualCheckpoint(): static
    {
        return $this->reason(FurnitureRevisionReason::ManualCheckpoint);
    }

    public function orderSubmitted(): static
    {
        return $this->reason(FurnitureRevisionReason::OrderSubmitted);
    }

    public function staffProposal(): static
    {
        return $this->reason(FurnitureRevisionReason::StaffProposal)->state(['author_kind' => AuthorKind::Staff]);
    }

    public function proposalApplied(): static
    {
        return $this->reason(FurnitureRevisionReason::ProposalApplied);
    }

    public function beforeRestore(): static
    {
        return $this->reason(FurnitureRevisionReason::BeforeRestore);
    }

    public function bomPending(): static
    {
        return $this->state([
            'bom_status' => BomStatus::Pending,
            'bom' => null,
            'price' => null,
            'engine_version' => null,
            'catalog_version' => null,
        ]);
    }

    /** Computed by the current engine against catalog version 1. */
    public function bomReady(): static
    {
        return $this->computed(catalogVersion: 1, engineVersion: self::ENGINE_VERSION);
    }

    public function bomFailed(): static
    {
        return $this->state(['bom_status' => BomStatus::Failed, 'bom' => null, 'price' => null]);
    }

    /** Computed against an older catalog than {@see bomReady()}. */
    public function staleCatalog(): static
    {
        return $this->computed(catalogVersion: 0, engineVersion: self::ENGINE_VERSION);
    }

    /** Computed by an older engine than {@see bomReady()}. */
    public function staleEngine(): static
    {
        return $this->computed(catalogVersion: 1, engineVersion: '0.9.0');
    }

    private function computed(int $catalogVersion, string $engineVersion): static
    {
        return $this->state([
            'bom_status' => BomStatus::Ready,
            'bom' => self::bom($catalogVersion, $engineVersion),
            'price' => self::price(),
            'engine_version' => $engineVersion,
            'catalog_version' => $catalogVersion,
        ]);
    }

    /**
     * @return array<string, mixed>
     */
    private static function bom(int $catalogVersion, string $engineVersion): array
    {
        return [
            'engineVersion' => $engineVersion,
            'catalogVersion' => $catalogVersion,
            'cutList' => [],
            'materials' => [],
            'edgeBanding' => [],
            'hardware' => [],
            'finishing' => [],
            'operations' => ['hingeCups' => 0, 'shelfPinHoles' => 0, 'dowels' => 0, 'camLocks' => 0, 'slideScrewSets' => 0, 'handleHoles' => 0],
            'nesting' => null,
            'issues' => [],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private static function price(): array
    {
        return [
            'currency' => 'INR',
            'lines' => [],
            'materialCostMinor' => 0,
            'edgeBandCostMinor' => 0,
            'hardwareCostMinor' => 0,
            'finishingCostMinor' => 0,
            'labourCostMinor' => 0,
            'directCostMinor' => 0,
            'overheadMinor' => 0,
            'marginMinor' => 0,
            'unitPriceMinor' => 0,
            'installationMinor' => 0,
            'quantity' => 1,
            'totalBeforeTaxMinor' => 0,
        ];
    }
}
