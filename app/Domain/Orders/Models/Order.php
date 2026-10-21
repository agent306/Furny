<?php

declare(strict_types=1);

namespace App\Domain\Orders\Models;

use App\Domain\Identity\Models\Address;
use App\Domain\Identity\Models\User;
use App\Domain\Messaging\Models\Message;
use App\Domain\Orders\Enums\CancelReason;
use App\Domain\Orders\Enums\OrderStateKey;
use App\Domain\Orders\States\OrderState;
use App\Domain\Projects\Models\Project;
use App\Support\Numbers\OrderNumber;
use Carbon\CarbonImmutable;
use Database\Factories\Domain\Orders\OrderFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Database\Eloquent\SoftDeletes;
use Spatie\ModelStates\HasStates;

/**
 * 02 §8.1. Only what the customer types in the submission form is mass-assignable. The number,
 * state, milestones, assignees, owner and project are written by the order actions and transitions
 * (09 §2), so they are not. The two quote ids are set by the quote actions.
 *
 * @property string $id
 * @property string $number
 * @property string $project_id
 * @property string $customer_id
 * @property OrderState $state
 * @property OrderStateKey|null $state_before_hold
 * @property string|null $assigned_to
 * @property string|null $production_assignee_id
 * @property string $title
 * @property string|null $customer_notes
 * @property string|null $site_address_id
 * @property bool $needs_installation
 * @property CarbonImmutable|null $preferred_delivery_on
 * @property CarbonImmutable|null $expected_delivery_on
 * @property string|null $accepted_quote_id
 * @property string|null $current_quote_id
 * @property int $production_progress
 * @property string|null $production_stage
 * @property CancelReason|null $cancel_reason
 * @property string|null $cancel_note
 * @property CarbonImmutable|null $submitted_at
 * @property CarbonImmutable|null $reviewed_at
 * @property CarbonImmutable|null $quoted_at
 * @property CarbonImmutable|null $accepted_at
 * @property CarbonImmutable|null $confirmed_at
 * @property CarbonImmutable|null $production_started_at
 * @property CarbonImmutable|null $completed_at
 * @property CarbonImmutable|null $customer_approved_at
 * @property CarbonImmutable|null $delivered_at
 * @property CarbonImmutable|null $closed_at
 * @property CarbonImmutable|null $cancelled_at
 * @property CarbonImmutable|null $last_customer_activity_at
 * @property CarbonImmutable|null $last_staff_activity_at
 * @property CarbonImmutable $state_changed_at
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 * @property CarbonImmutable|null $deleted_at
 */
#[Fillable(['title', 'customer_notes', 'needs_installation', 'preferred_delivery_on'])]
final class Order extends Model
{
    /** @use HasFactory<OrderFactory> */
    use HasFactory, HasStates, HasUlids, SoftDeletes;

    protected static function booted(): void
    {
        // Draft orders get a temporary number; `ORD-YYYY-NNNNN` is assigned at submission (master §6.3).
        self::creating(static function (self $order): void {
            if (blank($order->number)) {
                $order->number = OrderNumber::draft((string) $order->getKey());
            }
        });
    }

    /**
     * @return array<string, string|class-string>
     */
    protected function casts(): array
    {
        return [
            'state' => OrderState::class,
            'state_before_hold' => OrderStateKey::class,
            'cancel_reason' => CancelReason::class,
            'needs_installation' => 'boolean',
            'preferred_delivery_on' => 'immutable_date',
            'expected_delivery_on' => 'immutable_date',
            'production_progress' => 'integer',
            'submitted_at' => 'immutable_datetime',
            'reviewed_at' => 'immutable_datetime',
            'quoted_at' => 'immutable_datetime',
            'accepted_at' => 'immutable_datetime',
            'confirmed_at' => 'immutable_datetime',
            'production_started_at' => 'immutable_datetime',
            'completed_at' => 'immutable_datetime',
            'customer_approved_at' => 'immutable_datetime',
            'delivered_at' => 'immutable_datetime',
            'closed_at' => 'immutable_datetime',
            'cancelled_at' => 'immutable_datetime',
            'last_customer_activity_at' => 'immutable_datetime',
            'last_staff_activity_at' => 'immutable_datetime',
            'state_changed_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'deleted_at' => 'immutable_datetime',
        ];
    }

    /** True until submission assigns the real `ORD-` number (a reopened draft keeps its number, 09 T5). */
    public function isDraftNumber(): bool
    {
        return str_starts_with($this->number, 'DRAFT-');
    }

    /**
     * @return BelongsTo<Project, $this>
     */
    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class);
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function customer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'customer_id');
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function assignee(): BelongsTo
    {
        return $this->belongsTo(User::class, 'assigned_to');
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function productionAssignee(): BelongsTo
    {
        return $this->belongsTo(User::class, 'production_assignee_id');
    }

    /**
     * @return BelongsTo<Address, $this>
     */
    public function siteAddress(): BelongsTo
    {
        return $this->belongsTo(Address::class, 'site_address_id');
    }

    /**
     * @return HasMany<OrderItem, $this>
     */
    public function items(): HasMany
    {
        return $this->hasMany(OrderItem::class)->orderBy('sort_order');
    }

    /**
     * @return HasMany<ChangeProposal, $this>
     */
    public function changeProposals(): HasMany
    {
        return $this->hasMany(ChangeProposal::class)->orderBy('number');
    }

    /**
     * @return BelongsTo<Quote, $this>
     */
    public function acceptedQuote(): BelongsTo
    {
        return $this->belongsTo(Quote::class, 'accepted_quote_id');
    }

    /**
     * @return BelongsTo<Quote, $this>
     */
    public function currentQuote(): BelongsTo
    {
        return $this->belongsTo(Quote::class, 'current_quote_id');
    }

    /**
     * @return HasMany<Quote, $this>
     */
    public function quotes(): HasMany
    {
        return $this->hasMany(Quote::class)->orderBy('version');
    }

    /**
     * @return HasMany<QuoteNegotiation, $this>
     */
    public function negotiations(): HasMany
    {
        return $this->hasMany(QuoteNegotiation::class)->orderBy('created_at');
    }

    /**
     * @return HasMany<ConfirmationCall, $this>
     */
    public function confirmationCalls(): HasMany
    {
        return $this->hasMany(ConfirmationCall::class)->orderBy('called_at');
    }

    /**
     * @return HasMany<ProductionUpdate, $this>
     */
    public function productionUpdates(): HasMany
    {
        return $this->hasMany(ProductionUpdate::class)->orderBy('created_at');
    }

    /**
     * @return HasMany<OrderIssue, $this>
     */
    public function issues(): HasMany
    {
        return $this->hasMany(OrderIssue::class)->orderBy('created_at');
    }

    /**
     * @return HasOne<Delivery, $this>
     */
    public function delivery(): HasOne
    {
        return $this->hasOne(Delivery::class);
    }

    /**
     * The order's thread, oldest first (soft-deleted messages excluded).
     *
     * @return HasMany<Message, $this>
     */
    public function messages(): HasMany
    {
        return $this->hasMany(Message::class)->orderBy('created_at')->orderBy('id');
    }

    protected static function newFactory(): OrderFactory
    {
        return OrderFactory::new();
    }
}
