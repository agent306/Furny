<?php

declare(strict_types=1);

namespace Database\Factories\Domain\Orders;

use App\Domain\Furniture\Models\FurnitureRevision;
use App\Domain\Orders\Enums\ProposalItemDecision;
use App\Domain\Orders\Models\ChangeProposal;
use App\Domain\Orders\Models\ChangeProposalItem;
use App\Domain\Orders\Models\OrderItem;
use Database\Factories\Support\Documents;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * Default: a pending item for a new pinned item of the proposal's order, with `from_revision_id`
 * taken from the revision pinned on that item and no staff draft yet (02 §8.4). Both follow
 * whichever proposal or order item the caller sets.
 *
 * @extends Factory<ChangeProposalItem>
 */
final class ChangeProposalItemFactory extends Factory
{
    private const int PROPOSED_WIDTH_MM = 2000;

    protected $model = ChangeProposalItem::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'change_proposal_id' => ChangeProposal::factory(),
            'order_item_id' => static fn (array $attributes): Factory => OrderItem::factory()->pinned()->state([
                'order_id' => ChangeProposal::query()->whereKey($attributes['change_proposal_id'])->value('order_id'),
            ]),
            'from_revision_id' => static function (array $attributes): mixed {
                $item = OrderItem::query()->whereKey($attributes['order_item_id'])->firstOrFail();

                return $item->furniture_revision_id ?? OrderItemFactory::submittedRevisionOf($item->furniture_design_id);
            },
            'decision' => ProposalItemDecision::Pending,
        ];
    }

    /** Staff are still editing: an autosaved working copy that is wider than the placeholder, no revision yet. */
    public function withStaffDraft(): static
    {
        return $this->state(['staff_draft_document' => self::proposedDocument()]);
    }

    /** Sent: the working copy became a `staff_proposal` revision and the engine diff was stored. */
    public function proposed(): static
    {
        return $this->withStaffDraft()->state([
            'to_revision_id' => static function (array $attributes): Factory {
                $item = OrderItem::query()->whereKey($attributes['order_item_id'])->firstOrFail();

                return FurnitureRevision::factory()->staffProposal()->state([
                    'furniture_design_id' => $item->furniture_design_id,
                    'number' => (int) FurnitureRevision::query()->where('furniture_design_id', $item->furniture_design_id)->max('number') + 1,
                    'document' => self::proposedDocument(),
                    'author_id' => ChangeProposal::query()->whereKey($attributes['change_proposal_id'])->value('created_by'),
                ]);
            },
            'changes' => [[
                'kind' => 'dims_changed',
                'messageKey' => 'changes.dims_changed',
                'params' => ['beforeMm' => 1800, 'afterMm' => self::PROPOSED_WIDTH_MM],
                'entityId' => null,
                'before' => ['width' => 1800],
                'after' => ['width' => self::PROPOSED_WIDTH_MM],
                'significance' => 'major',
            ]],
        ]);
    }

    public function approved(): static
    {
        return $this->proposed()->state([
            'decision' => ProposalItemDecision::Approved,
            'decided_at' => static fn (): mixed => now()->toImmutable(),
        ]);
    }

    /** Rejections carry the customer's required comment (09 T7). */
    public function rejected(): static
    {
        return $this->proposed()->state([
            'decision' => ProposalItemDecision::Rejected,
            'customer_comment' => 'Please keep the original width.',
            'decided_at' => static fn (): mixed => now()->toImmutable(),
        ]);
    }

    /**
     * @return array<array-key, mixed>
     */
    private static function proposedDocument(): array
    {
        $document = Documents::placeholderFurniture();
        $document['dims']['width'] = self::PROPOSED_WIDTH_MM;

        return $document;
    }
}
