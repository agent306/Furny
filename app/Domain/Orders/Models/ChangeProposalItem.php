<?php

declare(strict_types=1);

namespace App\Domain\Orders\Models;

use App\Domain\Furniture\Models\FurnitureRevision;
use App\Domain\Orders\Enums\ProposalItemDecision;
use App\Support\Casts\AsJsonDocument;
use Carbon\CarbonImmutable;
use Database\Factories\Domain\Orders\ChangeProposalItemFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * 02 §8.4. Staff autosave `staff_draft_document` and the note while the proposal is a draft; the
 * proposed revision, the engine diff, the optimistic-lock counter and the customer's decision are
 * written by the proposal actions, so they are not mass-assignable.
 *
 * `changes` is the engine's `ChangeItem[]` list (07 §7.1), written once at send time: a plain
 * `array` cast is enough because it is never an empty map.
 *
 * @property string $id
 * @property string $change_proposal_id
 * @property string $order_item_id
 * @property string $from_revision_id
 * @property string|null $to_revision_id
 * @property array<array-key, mixed>|null $staff_draft_document
 * @property int $staff_draft_version
 * @property list<array<string, mixed>>|null $changes
 * @property string|null $staff_note
 * @property ProposalItemDecision $decision
 * @property string|null $customer_comment
 * @property CarbonImmutable|null $decided_at
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[Fillable(['staff_draft_document', 'staff_note'])]
final class ChangeProposalItem extends Model
{
    /** @use HasFactory<ChangeProposalItemFactory> */
    use HasFactory, HasUlids;

    /**
     * @return array<string, string|class-string>
     */
    protected function casts(): array
    {
        return [
            'staff_draft_document' => AsJsonDocument::class,
            'staff_draft_version' => 'integer',
            'changes' => 'array',
            'decision' => ProposalItemDecision::class,
            'decided_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }

    /**
     * @return BelongsTo<ChangeProposal, $this>
     */
    public function changeProposal(): BelongsTo
    {
        return $this->belongsTo(ChangeProposal::class);
    }

    /**
     * @return BelongsTo<OrderItem, $this>
     */
    public function orderItem(): BelongsTo
    {
        return $this->belongsTo(OrderItem::class);
    }

    /**
     * @return BelongsTo<FurnitureRevision, $this>
     */
    public function fromRevision(): BelongsTo
    {
        return $this->belongsTo(FurnitureRevision::class, 'from_revision_id');
    }

    /**
     * @return BelongsTo<FurnitureRevision, $this>
     */
    public function toRevision(): BelongsTo
    {
        return $this->belongsTo(FurnitureRevision::class, 'to_revision_id');
    }

    protected static function newFactory(): ChangeProposalItemFactory
    {
        return ChangeProposalItemFactory::new();
    }
}
