<?php

declare(strict_types=1);

use App\Domain\Furniture\Models\FurnitureDesign;
use App\Domain\Furniture\Models\FurnitureRevision;
use App\Domain\Identity\Models\Address;
use App\Domain\Identity\Models\User;
use App\Domain\Orders\Enums\CancelReason;
use App\Domain\Orders\Enums\ChangeProposalStatus;
use App\Domain\Orders\Enums\OrderStateKey;
use App\Domain\Orders\Enums\ProposalItemDecision;
use App\Domain\Orders\Models\ChangeProposal;
use App\Domain\Orders\Models\ChangeProposalItem;
use App\Domain\Orders\Models\Order;
use App\Domain\Orders\Models\OrderItem;
use App\Domain\Orders\States\Accepted;
use App\Domain\Orders\States\Cancelled;
use App\Domain\Orders\States\ChangesProposed;
use App\Domain\Orders\States\Closed;
use App\Domain\Orders\States\Completed;
use App\Domain\Orders\States\Confirmed;
use App\Domain\Orders\States\Delivered;
use App\Domain\Orders\States\Draft;
use App\Domain\Orders\States\InProduction;
use App\Domain\Orders\States\InReview;
use App\Domain\Orders\States\Negotiating;
use App\Domain\Orders\States\OnHold;
use App\Domain\Orders\States\OrderState;
use App\Domain\Orders\States\Quoted;
use App\Domain\Orders\States\ReadyForDelivery;
use App\Domain\Orders\States\Rework;
use App\Domain\Orders\States\Submitted;
use App\Domain\Projects\Models\Project;
use Carbon\CarbonImmutable;
use Database\Factories\Support\Documents;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Spatie\ModelStates\Exceptions\CouldNotPerformTransition;

/**
 * 02 §8.1–§8.4, §11, §12 and 09 §1.
 */
const ORDER_STATE_NAMES = [
    'draft', 'submitted', 'in_review', 'changes_proposed', 'quoted', 'negotiating', 'accepted', 'confirmed',
    'in_production', 'completed', 'rework', 'ready_for_delivery', 'delivered', 'closed', 'cancelled', 'on_hold',
];

/**
 * @return array<string, array{class-string<OrderState>}>
 */
function orderStateClasses(): array
{
    $classes = [
        Draft::class, Submitted::class, InReview::class, ChangesProposed::class, Quoted::class, Negotiating::class,
        Accepted::class, Confirmed::class, InProduction::class, Completed::class, Rework::class,
        ReadyForDelivery::class, Delivered::class, Closed::class, Cancelled::class, OnHold::class,
    ];

    return array_combine(ORDER_STATE_NAMES, array_map(static fn (string $class): array => [$class], $classes));
}

it('has the backed enum values of 02 §8 and 09 §1', function (): void {
    $values = static fn (string $enum): array => array_map(static fn (BackedEnum $case): string|int => $case->value, $enum::cases());

    expect($values(OrderStateKey::class))->toBe(ORDER_STATE_NAMES)
        ->and($values(CancelReason::class))->toBe(['customer_withdrew', 'quote_declined', 'declined_on_call', 'unresponsive', 'staff_cancelled', 'duplicate', 'other'])
        ->and($values(ChangeProposalStatus::class))->toBe(['draft', 'sent', 'resolved', 'withdrawn'])
        ->and($values(ProposalItemDecision::class))->toBe(['pending', 'approved', 'rejected']);
});

it('names the 16 state classes after the OrderStateKey values', function (): void {
    $names = array_map(static fn (array $row): string => $row[0]::$name, array_values(orderStateClasses()));

    expect($names)->toBe(ORDER_STATE_NAMES)
        ->and(array_column(OrderStateKey::cases(), 'value'))->toBe($names)
        ->and(OrderState::getStateMapping()->keys()->sort()->values()->all())->toBe(collect(ORDER_STATE_NAMES)->sort()->values()->all());
});

it('round-trips every state class through the factory and the database', function (string $stateClass): void {
    $order = Order::factory()->inState($stateClass)->create()->fresh();

    expect($order->state)->toBeInstanceOf($stateClass)
        ->and($order->state->getValue())->toBe($stateClass::$name)
        ->and(DB::table('orders')->where('id', $order->id)->value('state'))->toBe($stateClass::$name);
})->with(orderStateClasses());

it('is active in exactly the 13 states other than draft, closed and cancelled', function (): void {
    $active = [];
    $terminal = [];

    foreach (orderStateClasses() as [$class]) {
        $order = Order::factory()->inState($class)->make();

        if ($order->state->isActive()) {
            $active[] = $class::$name;
        }

        if ($order->state->isTerminal()) {
            $terminal[] = $class::$name;
        }
    }

    expect($active)->toHaveCount(13)
        ->and($active)->not->toContain('draft', 'closed', 'cancelled')
        ->and($terminal)->toBe(['closed', 'cancelled']);
});

it('has no transitions yet (P7 adds them)', function (): void {
    $order = Order::factory()->inState(Submitted::class)->create();

    expect($order->state->transitionableStates())->toBe([])
        ->and($order->state->canTransitionTo(InReview::class))->toBeFalse();

    $order->state->transitionTo(InReview::class);
})->throws(CouldNotPerformTransition::class);

it('starts a new order as a draft with the defaults of 02 §8.1', function (): void {
    $order = Order::factory()->create()->fresh();

    expect($order->state)->toBeInstanceOf(Draft::class)
        ->and($order->needs_installation)->toBeTrue()
        ->and($order->production_progress)->toBe(0)
        ->and($order->state_changed_at)->toBeInstanceOf(CarbonImmutable::class)
        ->and($order->state_changed_at->diffInSeconds(now(), absolute: true))->toBeLessThan(60)
        ->and($order->created_at)->toBeInstanceOf(CarbonImmutable::class)
        ->and($order->state_before_hold)->toBeNull()
        ->and($order->cancel_reason)->toBeNull()
        ->and($order->submitted_at)->toBeNull()
        ->and($order->deleted_at)->toBeNull();
});

it('gives a new order without a number DRAFT- and the last 8 characters of its id', function (): void {
    $order = Order::factory()->create(['number' => null])->fresh();

    expect($order->number)->toBe('DRAFT-'.substr($order->id, -8))
        ->and($order->isDraftNumber())->toBeTrue();
});

it('keeps an explicit number and recognises it as assigned', function (): void {
    $order = Order::factory()->create(['number' => 'ORD-2026-00042'])->fresh();

    expect($order->number)->toBe('ORD-2026-00042')
        ->and($order->isDraftNumber())->toBeFalse();
});

it('gives never-submitted drafts a draft number and every other state a real ORD- number', function (string $stateClass): void {
    $order = Order::factory()->inState($stateClass)->create()->fresh();

    if ($stateClass === Draft::class) {
        expect($order->isDraftNumber())->toBeTrue()->and($order->number)->toStartWith('DRAFT-');
    } else {
        expect($order->isDraftNumber())->toBeFalse()->and($order->number)->toMatch('/^ORD-\d{4}-\d{5}$/');
    }
})->with(orderStateClasses());

it('hands out distinct sequential numbers', function (): void {
    $numbers = Order::factory()->count(3)->inState(Submitted::class)->create()->pluck('number')->all();

    expect(array_unique($numbers))->toHaveCount(3);
});

it('sets the milestones of 02 §8.1 up to and including the state, in 09 §1 order', function (string $stateClass, array $set): void {
    $order = Order::factory()->inState($stateClass)->create()->fresh();
    $milestones = [
        'submitted_at', 'reviewed_at', 'quoted_at', 'accepted_at', 'confirmed_at', 'production_started_at',
        'completed_at', 'customer_approved_at', 'delivered_at', 'closed_at', 'cancelled_at',
    ];

    foreach ($milestones as $column) {
        in_array($column, $set, true)
            ? expect($order->{$column})->toBeInstanceOf(CarbonImmutable::class, $column)
            : expect($order->{$column})->toBeNull($column);
    }

    $times = array_map(static fn (string $column): CarbonImmutable => $order->{$column}, $set);
    $sorted = $times;
    usort($sorted, static fn (CarbonImmutable $a, CarbonImmutable $b): int => $a <=> $b);

    expect($times)->toEqual($sorted)
        ->and($order->state_changed_at->greaterThanOrEqualTo($times === [] ? $order->created_at->subMinute() : end($times)))->toBeTrue()
        ->and($order->state_changed_at->lessThanOrEqualTo(now()->addSecond()))->toBeTrue();
})->with([
    'draft' => [Draft::class, []],
    'submitted' => [Submitted::class, ['submitted_at']],
    'in_review' => [InReview::class, ['submitted_at', 'reviewed_at']],
    'changes_proposed' => [ChangesProposed::class, ['submitted_at', 'reviewed_at']],
    'quoted' => [Quoted::class, ['submitted_at', 'reviewed_at', 'quoted_at']],
    'negotiating' => [Negotiating::class, ['submitted_at', 'reviewed_at', 'quoted_at']],
    'accepted' => [Accepted::class, ['submitted_at', 'reviewed_at', 'quoted_at', 'accepted_at']],
    'confirmed' => [Confirmed::class, ['submitted_at', 'reviewed_at', 'quoted_at', 'accepted_at', 'confirmed_at']],
    'in_production' => [InProduction::class, ['submitted_at', 'reviewed_at', 'quoted_at', 'accepted_at', 'confirmed_at', 'production_started_at']],
    'completed' => [Completed::class, ['submitted_at', 'reviewed_at', 'quoted_at', 'accepted_at', 'confirmed_at', 'production_started_at', 'completed_at']],
    'rework' => [Rework::class, ['submitted_at', 'reviewed_at', 'quoted_at', 'accepted_at', 'confirmed_at', 'production_started_at', 'completed_at']],
    'ready_for_delivery' => [ReadyForDelivery::class, ['submitted_at', 'reviewed_at', 'quoted_at', 'accepted_at', 'confirmed_at', 'production_started_at', 'completed_at', 'customer_approved_at']],
    'delivered' => [Delivered::class, ['submitted_at', 'reviewed_at', 'quoted_at', 'accepted_at', 'confirmed_at', 'production_started_at', 'completed_at', 'customer_approved_at', 'delivered_at']],
    'closed' => [Closed::class, ['submitted_at', 'reviewed_at', 'quoted_at', 'accepted_at', 'confirmed_at', 'production_started_at', 'completed_at', 'customer_approved_at', 'delivered_at', 'closed_at']],
    'cancelled' => [Cancelled::class, ['submitted_at', 'cancelled_at']],
    'on_hold' => [OnHold::class, ['submitted_at', 'reviewed_at']],
]);

it('records cancellation and hold details the way the transitions will', function (): void {
    $cancelled = Order::factory()->inState(Cancelled::class)->create()->fresh();
    $held = Order::factory()->inState(OnHold::class)->create()->fresh();
    $heldInProduction = Order::factory()->onHoldFrom(InProduction::class)->create()->fresh();

    expect($cancelled->cancel_reason)->toBe(CancelReason::StaffCancelled)
        ->and($cancelled->state_before_hold)->toBeNull()
        ->and($held->state)->toBeInstanceOf(OnHold::class)
        ->and($held->state_before_hold)->toBe(OrderStateKey::InReview)
        ->and($held->cancel_reason)->toBeNull()
        ->and($heldInProduction->state_before_hold)->toBe(OrderStateKey::InProduction)
        ->and($heldInProduction->production_started_at)->toBeInstanceOf(CarbonImmutable::class)
        ->and($heldInProduction->completed_at)->toBeNull();
});

it('sets the expected delivery date from confirmation on and full progress from completion on', function (): void {
    $accepted = Order::factory()->inState(Accepted::class)->create()->fresh();
    $confirmed = Order::factory()->inState(Confirmed::class)->create()->fresh();
    $inProduction = Order::factory()->inState(InProduction::class)->create()->fresh();
    $completed = Order::factory()->inState(Completed::class)->create()->fresh();
    $delivered = Order::factory()->inState(Delivered::class)->create()->fresh();

    expect($accepted->expected_delivery_on)->toBeNull()
        ->and($confirmed->expected_delivery_on)->toBeInstanceOf(CarbonImmutable::class)
        ->and([$accepted->production_progress, $confirmed->production_progress, $inProduction->production_progress])->toBe([0, 0, 0])
        ->and([$completed->production_progress, $delivered->production_progress])->toBe([100, 100]);
});

it('refuses to hold an order from a state T26 does not allow', function (string $stateClass): void {
    Order::factory()->onHoldFrom($stateClass);
})->with([
    'draft' => [Draft::class],
    'closed' => [Closed::class],
    'cancelled' => [Cancelled::class],
    'on_hold' => [OnHold::class],
])->throws(InvalidArgumentException::class);

it('rejects a class that is not an order state', function (): void {
    Order::factory()->inState(stdClass::class);
})->throws(InvalidArgumentException::class);

it('resolves the customer from the project and follows an explicit project through for()', function (): void {
    $project = Project::factory()->create();
    $order = Order::factory()->for($project)->create();
    $stray = Order::factory()->create();

    expect($order->customer_id)->toBe($project->owner_id)
        ->and($order->project->is($project))->toBeTrue()
        ->and($order->customer->is($project->owner))->toBeTrue()
        ->and($stray->customer_id)->toBe($stray->project->owner_id)
        ->and($project->orders)->toHaveCount(1)
        ->and($project->owner->orders)->toHaveCount(1)
        ->and(User::query()->count())->toBe(2);
});

it('builds the relations of 02 §11', function (): void {
    $staff = User::factory()->staff()->create();
    $project = Project::factory()->withSiteAddress()->create();
    $order = Order::factory()->for($project)->create([
        'assigned_to' => $staff->id,
        'production_assignee_id' => $staff->id,
        'site_address_id' => $project->site_address_id,
    ])->fresh();

    expect($order->assignee->is($staff))->toBeTrue()
        ->and($order->productionAssignee->is($staff))->toBeTrue()
        ->and($order->siteAddress)->toBeInstanceOf(Address::class)
        ->and($order->siteAddress->id)->toBe($project->site_address_id)
        ->and($order->items)->toHaveCount(0)
        ->and($order->changeProposals)->toHaveCount(0);
});

it('does not mass-assign lifecycle, owner or staff columns', function (): void {
    $other = User::factory()->create();
    $order = new Order;
    $order->fill([
        'title' => 'Bedroom set',
        'customer_notes' => 'Please call first',
        'needs_installation' => false,
        'preferred_delivery_on' => '2026-12-01',
        'state' => 'delivered',
        'number' => 'ORD-2026-00001',
        'customer_id' => $other->id,
        'project_id' => 'x',
        'assigned_to' => $other->id,
        'submitted_at' => now(),
        'cancel_reason' => 'other',
        'production_progress' => 80,
    ]);

    expect($order->getAttributes())->toHaveKeys(['title', 'customer_notes', 'needs_installation', 'preferred_delivery_on'])
        ->and(array_keys($order->getAttributes()))->not->toContain('state', 'number', 'customer_id', 'project_id', 'assigned_to', 'submitted_at', 'cancel_reason', 'production_progress');
});

it('builds items with withItems(), pinning revisions once the order has been submitted', function (): void {
    $draft = Order::factory()->withItems(2)->create()->fresh();
    $submitted = Order::factory()->inState(Submitted::class)->withItems()->create()->fresh();

    expect($draft->items)->toHaveCount(2)
        ->and($draft->items->pluck('furniture_revision_id')->filter()->all())->toBe([])
        ->and($draft->items->pluck('sort_order')->all())->toBe([0, 1])
        ->and($draft->items->every(fn (OrderItem $item): bool => $item->furnitureDesign->project_id === $draft->project_id && $item->furnitureDesign->owner_id === $draft->customer_id))->toBeTrue()
        ->and($submitted->items)->toHaveCount(1)
        ->and($submitted->items[0]->furnitureRevision)->toBeInstanceOf(FurnitureRevision::class)
        ->and($submitted->items[0]->furnitureRevision->furniture_design_id)->toBe($submitted->items[0]->furniture_design_id);
});

it('defaults an order item to quantity 1 and keeps the room label and notes', function (): void {
    $item = OrderItem::factory()->create(['room_label' => 'Master bedroom', 'customer_notes' => 'Left door opens out'])->fresh();

    expect($item->quantity)->toBe(1)
        ->and($item->sort_order)->toBe(0)
        ->and($item->room_label)->toBe('Master bedroom')
        ->and($item->customer_notes)->toBe('Left door opens out')
        ->and($item->staff_notes)->toBeNull()
        ->and($item->furniture_revision_id)->toBeNull()
        ->and($item->order)->toBeInstanceOf(Order::class)
        ->and($item->furnitureDesign->project_id)->toBe($item->order->project_id)
        ->and($item->created_at)->toBeInstanceOf(CarbonImmutable::class);
});

it('allows a design only once per order', function (): void {
    $order = Order::factory()->create();
    $design = FurnitureDesign::factory()->for($order->project)->create();
    OrderItem::factory()->for($order)->for($design)->create();

    OrderItem::factory()->for($order)->for($design)->create();
})->throws(QueryException::class);

it('allows the same design on different orders', function (): void {
    $project = Project::factory()->create();
    $design = FurnitureDesign::factory()->for($project)->create();
    OrderItem::factory()->for(Order::factory()->for($project))->for($design)->create();
    OrderItem::factory()->for(Order::factory()->for($project))->for($design)->create();

    expect(OrderItem::query()->count())->toBe(2);
});

it('numbers change proposals per order and builds their items', function (): void {
    $order = Order::factory()->inState(InReview::class)->create();
    $first = ChangeProposal::factory()->for($order)->create()->fresh();
    $second = ChangeProposal::factory()->for($order)->create()->fresh();
    $elsewhere = ChangeProposal::factory()->create()->fresh();

    expect([$first->number, $second->number, $elsewhere->number])->toBe([1, 2, 1])
        ->and($first->status)->toBe(ChangeProposalStatus::Draft)
        ->and($first->created_by)->not->toBeNull()
        ->and($first->createdBy->isStaff())->toBeTrue()
        ->and($first->sent_at)->toBeNull()
        ->and($first->order->is($order))->toBeTrue()
        ->and($order->changeProposals)->toHaveCount(2);
});

it('enforces unique (order_id, number) on change proposals', function (): void {
    $order = Order::factory()->create();
    ChangeProposal::factory()->for($order)->create(['number' => 1]);

    ChangeProposal::factory()->for($order)->create(['number' => 1]);
})->throws(QueryException::class);

it('builds change proposal states with their timestamps', function (): void {
    $sent = ChangeProposal::factory()->sent()->create()->fresh();
    $resolved = ChangeProposal::factory()->resolved()->create()->fresh();
    $withdrawn = ChangeProposal::factory()->withdrawn()->create()->fresh();

    expect($sent->status)->toBe(ChangeProposalStatus::Sent)
        ->and($sent->sent_at)->toBeInstanceOf(CarbonImmutable::class)
        ->and($sent->resolved_at)->toBeNull()
        ->and($resolved->status)->toBe(ChangeProposalStatus::Resolved)
        ->and($resolved->sent_at)->toBeInstanceOf(CarbonImmutable::class)
        ->and($resolved->resolved_at)->toBeInstanceOf(CarbonImmutable::class)
        ->and($withdrawn->status)->toBe(ChangeProposalStatus::Withdrawn)
        ->and($withdrawn->withdrawn_at)->toBeInstanceOf(CarbonImmutable::class)
        ->and($withdrawn->resolved_at)->toBeNull();
});

it('creates a pending proposal item on the proposal order, pinned from the item revision', function (): void {
    $item = ChangeProposalItem::factory()->create()->fresh();

    expect($item->decision)->toBe(ProposalItemDecision::Pending)
        ->and($item->staff_draft_version)->toBe(1)
        ->and($item->staff_draft_document)->toBeNull()
        ->and($item->changes)->toBeNull()
        ->and($item->to_revision_id)->toBeNull()
        ->and($item->decided_at)->toBeNull()
        ->and($item->orderItem->order_id)->toBe($item->changeProposal->order_id)
        ->and($item->from_revision_id)->toBe($item->orderItem->furniture_revision_id)
        ->and($item->fromRevision)->toBeInstanceOf(FurnitureRevision::class)
        ->and($item->toRevision)->toBeNull()
        ->and($item->changeProposal->items)->toHaveCount(1);
});

it('round-trips the staff draft document and the engine diff', function (): void {
    $document = Documents::placeholderFurniture();
    $changes = [[
        'kind' => 'dims_changed', 'messageKey' => 'changes.dims_changed', 'params' => ['beforeMm' => 1800, 'afterMm' => 2000],
        'entityId' => null, 'before' => ['width' => 1800], 'after' => ['width' => 2000], 'significance' => 'major',
    ]];

    $item = ChangeProposalItem::factory()->create(['staff_draft_document' => $document, 'changes' => $changes])->fresh();

    expect($item->staff_draft_document)->toEqual($document)
        ->and($item->staff_draft_document['overrides']['parts'])->toBeInstanceOf(stdClass::class)
        ->and($item->changes)->toEqual($changes)
        ->and(DB::table('change_proposal_items')->where('id', $item->id)->value('staff_draft_document'))->toContain('"parts": {}');
});

it('builds proposal item states', function (): void {
    $draft = ChangeProposalItem::factory()->withStaffDraft()->create()->fresh();
    $proposed = ChangeProposalItem::factory()->proposed()->create()->fresh();
    $approved = ChangeProposalItem::factory()->approved()->create()->fresh();
    $rejected = ChangeProposalItem::factory()->rejected()->create()->fresh();

    expect($draft->staff_draft_document['dims']['width'])->not->toBe(Documents::placeholderFurniture()['dims']['width'])
        ->and($draft->to_revision_id)->toBeNull()
        ->and($proposed->toRevision)->toBeInstanceOf(FurnitureRevision::class)
        ->and($proposed->toRevision->furniture_design_id)->toBe($proposed->orderItem->furniture_design_id)
        ->and($proposed->changes)->not->toBeEmpty()
        ->and($approved->decision)->toBe(ProposalItemDecision::Approved)
        ->and($approved->decided_at)->toBeInstanceOf(CarbonImmutable::class)
        ->and($rejected->decision)->toBe(ProposalItemDecision::Rejected)
        ->and($rejected->customer_comment)->not->toBeEmpty()
        ->and($rejected->decided_at)->toBeInstanceOf(CarbonImmutable::class);
});

it('allows an order item once per proposal', function (): void {
    $proposal = ChangeProposal::factory()->create();
    $first = ChangeProposalItem::factory()->for($proposal)->create();

    ChangeProposalItem::factory()->for($proposal)->create(['order_item_id' => $first->order_item_id]);
})->throws(QueryException::class);

it('cascades from an order to its items, proposals and proposal items', function (): void {
    $item = ChangeProposalItem::factory()->create();
    $order = $item->changeProposal->order;
    $other = ChangeProposalItem::factory()->create();

    $order->forceDelete();

    expect(Order::withTrashed()->count())->toBe(1)
        ->and(OrderItem::query()->count())->toBe(1)
        ->and(ChangeProposal::query()->count())->toBe(1)
        ->and(ChangeProposalItem::query()->count())->toBe(1)
        ->and(ChangeProposalItem::query()->value('id'))->toBe($other->id);
});

it('cascades proposal items when their order item is deleted', function (): void {
    $item = ChangeProposalItem::factory()->create();

    $item->orderItem->delete();

    expect(ChangeProposalItem::query()->count())->toBe(0)
        ->and(ChangeProposal::query()->count())->toBe(1);
});

it('keeps items and proposals when an order is soft-deleted', function (): void {
    $item = ChangeProposalItem::factory()->create();

    $item->changeProposal->order->delete();

    expect(Order::query()->count())->toBe(0)
        ->and(Order::withTrashed()->count())->toBe(1)
        ->and(OrderItem::query()->count())->toBe(1)
        ->and(ChangeProposalItem::query()->count())->toBe(1);
});

it('refuses to delete a furniture design that an order item references', function (): void {
    // The item is unpinned (draft), so only order_items.furniture_design_id can refuse.
    $item = OrderItem::factory()->create();

    // A savepoint keeps the test transaction usable after the refused delete.
    expect(fn () => DB::transaction(fn () => $item->furnitureDesign->forceDelete()))->toThrow(QueryException::class, 'order_items_furniture_design_id_foreign')
        ->and(OrderItem::query()->count())->toBe(1)
        ->and(FurnitureDesign::query()->count())->toBe(1);
});

it('refuses to delete a revision pinned on an order item', function (): void {
    $order = Order::factory()->inState(Submitted::class)->withItems()->create();
    $revision = $order->items->firstOrFail()->furnitureRevision;

    expect(fn () => $revision->delete())->toThrow(QueryException::class, 'order_items_furniture_revision_id_foreign');
});

it('refuses to delete the from revision of a proposal item', function (): void {
    // The order item is unpinned, so only change_proposal_items.from_revision_id can refuse.
    $order = Order::factory()->create();
    $orderItem = OrderItem::factory()->for($order)->create();
    $from = FurnitureRevision::factory()->for($orderItem->furnitureDesign)->create(['number' => 1]);
    ChangeProposalItem::factory()->create([
        'change_proposal_id' => ChangeProposal::factory()->for($order),
        'order_item_id' => $orderItem->id,
        'from_revision_id' => $from->id,
    ]);

    expect(fn () => $from->delete())->toThrow(QueryException::class, 'change_proposal_items_from_revision_id_foreign');
});

it('refuses to delete the to revision of a proposal item', function (): void {
    // The to revision is neither pinned on an order item nor a from revision.
    $order = Order::factory()->create();
    $orderItem = OrderItem::factory()->for($order)->create();
    $from = FurnitureRevision::factory()->for($orderItem->furnitureDesign)->create(['number' => 1]);
    $to = FurnitureRevision::factory()->for($orderItem->furnitureDesign)->staffProposal()->create(['number' => 2]);
    ChangeProposalItem::factory()->create([
        'change_proposal_id' => ChangeProposal::factory()->for($order),
        'order_item_id' => $orderItem->id,
        'from_revision_id' => $from->id,
        'to_revision_id' => $to->id,
    ]);

    expect(fn () => $to->delete())->toThrow(QueryException::class, 'change_proposal_items_to_revision_id_foreign');
});

it('refuses to delete a project that has orders', function (): void {
    $order = Order::factory()->create();

    expect(fn () => $order->project->forceDelete())->toThrow(QueryException::class, 'orders_project_id_foreign');
});

it('refuses to delete a customer who has orders on a project they do not own', function (): void {
    $customer = User::factory()->create();
    Order::factory()->create(['customer_id' => $customer->id]);

    expect(fn () => $customer->forceDelete())->toThrow(QueryException::class, 'orders_customer_id_foreign');
});

it('refuses to delete the staff member who created a change proposal', function (): void {
    $staff = User::factory()->staff()->create();
    ChangeProposal::factory()->create(['created_by' => $staff->id]);

    expect(fn () => $staff->forceDelete())->toThrow(QueryException::class, 'change_proposals_created_by_foreign');
});

it('nulls the assignees and the site address when those rows go', function (): void {
    $staff = User::factory()->staff()->create();
    $address = Address::factory()->create();
    $order = Order::factory()->create([
        'assigned_to' => $staff->id,
        'production_assignee_id' => $staff->id,
        'site_address_id' => $address->id,
    ]);

    $address->delete();
    $staff->forceDelete();

    expect($order->fresh()->assigned_to)->toBeNull()
        ->and($order->fresh()->production_assignee_id)->toBeNull()
        ->and($order->fresh()->site_address_id)->toBeNull();
});

it('enforces a unique order number', function (): void {
    Order::factory()->create(['number' => 'ORD-2026-00007']);

    Order::factory()->create(['number' => 'ORD-2026-00007']);
})->throws(QueryException::class);

it('registers the morph aliases', function (): void {
    expect((new Order)->getMorphClass())->toBe('order')
        ->and((new OrderItem)->getMorphClass())->toBe('order_item')
        ->and((new ChangeProposal)->getMorphClass())->toBe('change_proposal')
        ->and((new ChangeProposalItem)->getMorphClass())->toBe('change_proposal_item');
});

it('soft-deletes orders', function (): void {
    $order = Order::factory()->create();

    $order->delete();

    expect(Order::query()->count())->toBe(0)
        ->and(Order::withTrashed()->count())->toBe(1);
});
