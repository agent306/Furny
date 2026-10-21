<?php

declare(strict_types=1);

use App\Domain\Furniture\Models\FurnitureDesign;
use App\Domain\Identity\Models\User;
use App\Domain\Orders\Enums\CallOutcome;
use App\Domain\Orders\Enums\IssueStatus;
use App\Domain\Orders\Enums\PaymentGateway;
use App\Domain\Orders\Enums\PaymentKind;
use App\Domain\Orders\Enums\PaymentMethod;
use App\Domain\Orders\Enums\PaymentStatus;
use App\Domain\Orders\Enums\ProductionVisibility;
use App\Domain\Orders\Models\ConfirmationCall;
use App\Domain\Orders\Models\Delivery;
use App\Domain\Orders\Models\Order;
use App\Domain\Orders\Models\OrderIssue;
use App\Domain\Orders\Models\Payment;
use App\Domain\Orders\Models\ProductionUpdate;
use App\Domain\Orders\States\Accepted;
use App\Domain\Orders\States\Delivered;
use App\Domain\Orders\States\InProduction;
use App\Domain\Orders\States\ReadyForDelivery;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\MassAssignmentException;
use Spatie\MediaLibrary\MediaCollections\Models\Media;

/**
 * 02 §8.8–§8.12, §10, §11 and D16 (confirmation calls, production updates, issues, deliveries and payments).
 */
function recordsTinyPng(): string
{
    return (string) base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', true);
}

it('has the backed enum values of 02 §8.8–§8.12', function (): void {
    $values = static fn (string $enum): array => array_map(static fn (BackedEnum $case): string|int => $case->value, $enum::cases());

    expect($values(CallOutcome::class))->toBe(['confirmed', 'no_answer', 'callback_requested', 'wrong_number', 'customer_wants_changes', 'customer_declined'])
        ->and($values(ProductionVisibility::class))->toBe(['customer', 'internal'])
        ->and($values(IssueStatus::class))->toBe(['open', 'in_progress', 'resolved', 'rejected'])
        ->and($values(PaymentKind::class))->toBe(['advance', 'balance', 'refund', 'adjustment'])
        ->and($values(PaymentMethod::class))->toBe(['cash', 'bank_transfer', 'upi', 'card', 'cheque', 'online_gateway'])
        ->and($values(PaymentStatus::class))->toBe(['pending', 'succeeded', 'failed', 'refunded'])
        ->and($values(PaymentGateway::class))->toBe(['razorpay', 'stripe']);
});

it('logs a confirmation call by an estimator to the number of the customer', function (): void {
    $call = ConfirmationCall::factory()->create()->fresh();

    expect($call->order->state)->toBeInstanceOf(Accepted::class)
        ->and($call->staff->isStaff())->toBeTrue()
        ->and($call->outcome)->toBe(CallOutcome::Confirmed)
        ->and($call->called_at)->toBeInstanceOf(CarbonImmutable::class)
        ->and($call->phone_e164)->toMatch('/^\+\d{8,15}$/')
        ->and($call->notes)->toBeNull()
        ->and($call->callback_at)->toBeNull();
});

it('sets the outcome of a call and schedules a callback only when one is requested', function (): void {
    $answered = ConfirmationCall::factory()->outcome(CallOutcome::NoAnswer)->create()->fresh();
    $callback = ConfirmationCall::factory()->outcome(CallOutcome::CallbackRequested)->create()->fresh();

    expect($answered->outcome)->toBe(CallOutcome::NoAnswer)
        ->and($answered->callback_at)->toBeNull()
        ->and($callback->outcome)->toBe(CallOutcome::CallbackRequested)
        ->and($callback->callback_at)->toBeInstanceOf(CarbonImmutable::class)
        ->and($callback->callback_at->greaterThan($callback->called_at))->toBeTrue();
});

it('lets staff write only the details of a call, never the order or the caller', function (): void {
    $call = new ConfirmationCall;
    $call->fill([
        'called_at' => now(),
        'phone_e164' => '+919800000000',
        'outcome' => 'confirmed',
        'notes' => 'Happy to proceed',
        'callback_at' => now(),
        'order_id' => 'x',
        'staff_id' => 'x',
    ]);

    expect(array_keys($call->getAttributes()))->toBe(['called_at', 'phone_e164', 'outcome', 'notes', 'callback_at']);
});

it('posts a customer visible production update by production staff', function (): void {
    $update = ProductionUpdate::factory()->create()->fresh();

    expect($update->order->state)->toBeInstanceOf(InProduction::class)
        ->and($update->author->isStaff())->toBeTrue()
        ->and($update->stage)->toBe('cutting')
        ->and($update->progress)->toBe(25)
        ->and($update->title)->not->toBeEmpty()
        ->and($update->body)->toBeNull()
        ->and($update->visibility)->toBe(ProductionVisibility::Customer)
        ->and($update->is_completion)->toBeFalse();
});

it('builds internal and completion production updates', function (): void {
    $internal = ProductionUpdate::factory()->internal()->create()->fresh();
    $completion = ProductionUpdate::factory()->completion()->create()->fresh();

    expect($internal->visibility)->toBe(ProductionVisibility::Internal)
        ->and($internal->is_completion)->toBeFalse()
        ->and($completion->visibility)->toBe(ProductionVisibility::Customer)
        ->and($completion->is_completion)->toBeTrue()
        ->and($completion->stage)->toBe('completed')
        ->and($completion->progress)->toBe(100);
});

it('lets staff write the content of a production update, never the order, author or completion flag', function (): void {
    $update = new ProductionUpdate;
    $update->fill([
        'stage' => 'cutting',
        'progress' => 25,
        'title' => 'Cutting started',
        'body' => 'Sheets are cut',
        'visibility' => 'internal',
        'order_id' => 'x',
        'author_id' => 'x',
        'is_completion' => true,
    ]);

    expect(array_keys($update->getAttributes()))->toBe(['stage', 'progress', 'title', 'body', 'visibility']);
});

it('opens an issue raised by the customer of the order', function (): void {
    $issue = OrderIssue::factory()->create()->fresh();

    expect($issue->order->state)->toBeInstanceOf(Delivered::class)
        ->and($issue->raised_by)->toBe($issue->order->customer_id)
        ->and($issue->raisedBy->is($issue->order->customer))->toBeTrue()
        ->and($issue->status)->toBe(IssueStatus::Open)
        ->and($issue->description)->not->toBeEmpty()
        ->and($issue->order_item_id)->toBeNull()
        ->and($issue->resolution_note)->toBeNull()
        ->and($issue->resolved_by)->toBeNull()
        ->and($issue->resolved_at)->toBeNull();
});

it('round-trips the resolution of an issue', function (): void {
    $staff = User::factory()->staff()->create();

    $issue = OrderIssue::factory()->create([
        'status' => IssueStatus::Resolved,
        'resolution_note' => 'Hinge replaced',
        'resolved_by' => $staff->id,
        'resolved_at' => now(),
    ])->fresh();

    expect($issue->status)->toBe(IssueStatus::Resolved)
        ->and($issue->resolution_note)->toBe('Hinge replaced')
        ->and($issue->resolvedBy->is($staff))->toBeTrue()
        ->and($issue->resolved_at)->toBeInstanceOf(CarbonImmutable::class);
});

it('lets the customer write only the description of an issue', function (): void {
    $issue = new OrderIssue;
    $issue->fill(['description' => 'Door misaligned', 'order_id' => 'x', 'order_item_id' => 'x', 'raised_by' => 'x', 'status' => 'resolved', 'resolution_note' => 'x']);

    expect(array_keys($issue->getAttributes()))->toBe(['description']);
});

it('schedules a delivery window for an order that is ready', function (): void {
    $delivery = Delivery::factory()->create()->fresh();

    expect($delivery->order->state)->toBeInstanceOf(ReadyForDelivery::class)
        ->and($delivery->scheduled_for)->toBeInstanceOf(CarbonImmutable::class)
        ->and($delivery->scheduled_until)->toBeInstanceOf(CarbonImmutable::class)
        ->and($delivery->scheduled_until->greaterThan($delivery->scheduled_for))->toBeTrue()
        ->and($delivery->delivered_at)->toBeNull()
        ->and($delivery->installed)->toBeFalse()
        ->and($delivery->recipient_name)->toBeNull()
        ->and($delivery->recorded_by)->toBeNull()
        ->and($delivery->recordedBy)->toBeNull();
});

it('lets staff write the window, installation, recipient and notes of a delivery', function (): void {
    $delivery = new Delivery;
    $delivery->fill([
        'scheduled_for' => now(),
        'scheduled_until' => now()->addHours(4),
        'installed' => true,
        'recipient_name' => 'Asha',
        'notes' => 'Lift is small',
        'order_id' => 'x',
        'delivered_at' => now(),
        'recorded_by' => 'x',
    ]);

    expect(array_keys($delivery->getAttributes()))->toBe(['scheduled_for', 'scheduled_until', 'installed', 'recipient_name', 'notes']);
});

it('round-trips a payment through its casts', function (): void {
    $payment = Payment::factory()->create()->fresh();

    expect(Order::query()->findOrFail($payment->order_id)->state)->toBeInstanceOf(Accepted::class)
        ->and($payment->kind)->toBe(PaymentKind::Advance)
        ->and($payment->amount_minor)->toBeInt()->toBeGreaterThan(0)
        ->and($payment->currency)->toBe('INR')
        ->and($payment->method)->toBe(PaymentMethod::BankTransfer)
        ->and($payment->status)->toBe(PaymentStatus::Succeeded)
        ->and($payment->gateway)->toBeNull()
        ->and($payment->gateway_reference)->toBeNull()
        ->and($payment->paid_at)->toBeInstanceOf(CarbonImmutable::class)
        ->and($payment->quote_id)->toBeNull()
        ->and($payment->created_at)->toBeInstanceOf(CarbonImmutable::class);

    $online = Payment::factory()->create([
        'kind' => PaymentKind::Balance,
        'method' => PaymentMethod::OnlineGateway,
        'status' => PaymentStatus::Pending,
        'gateway' => PaymentGateway::Razorpay,
        'gateway_reference' => 'pay_Nx1234',
        'paid_at' => null,
    ])->fresh();

    expect($online->kind)->toBe(PaymentKind::Balance)
        ->and($online->method)->toBe(PaymentMethod::OnlineGateway)
        ->and($online->status)->toBe(PaymentStatus::Pending)
        ->and($online->gateway)->toBe(PaymentGateway::Razorpay)
        ->and($online->gateway_reference)->toBe('pay_Nx1234')
        ->and($online->paid_at)->toBeNull();
});

it('has casts only on a payment and nothing mass-assignable in v1 (D16)', function (): void {
    expect(fn () => (new Payment)->fill(['order_id' => 'x', 'kind' => 'advance', 'amount_minor' => 1, 'status' => 'succeeded']))
        ->toThrow(MassAssignmentException::class)
        ->and((new Payment)->getMorphClass())->toBe('payment');
});

it('builds the order relations of 02 §11', function (): void {
    $order = Order::factory()->create();
    $call = ConfirmationCall::factory()->for($order)->create(['called_at' => now()->subHour()]);
    $earlier = ConfirmationCall::factory()->for($order)->create(['called_at' => now()->subDay()]);
    $first = ProductionUpdate::factory()->for($order)->create(['created_at' => now()->subDay()]);
    $second = ProductionUpdate::factory()->for($order)->create(['created_at' => now()->subHour()]);
    $issue = OrderIssue::factory()->for($order)->create();
    $delivery = Delivery::factory()->for($order)->create();
    $order = $order->fresh();

    expect($order->confirmationCalls->pluck('id')->all())->toBe([$earlier->id, $call->id])
        ->and($order->productionUpdates->pluck('id')->all())->toBe([$first->id, $second->id])
        ->and($order->issues->pluck('id')->all())->toBe([$issue->id])
        ->and($order->delivery->is($delivery))->toBeTrue()
        ->and($order->quotes)->toHaveCount(0)
        ->and($order->negotiations)->toHaveCount(0)
        ->and(Order::factory()->create()->delivery)->toBeNull()
        ->and($delivery->order->is($order))->toBeTrue()
        ->and($issue->order->is($order))->toBeTrue()
        ->and($call->order->is($order))->toBeTrue()
        ->and($first->order->is($order))->toBeTrue();
});

it('relates a design to the order that locks it', function (): void {
    $order = Order::factory()->create();
    $design = FurnitureDesign::factory()->for($order->project)->create();
    $locked = FurnitureDesign::factory()->for($order->project)->create();
    $locked->forceFill(['locked_by_order_id' => $order->id])->save();

    expect($design->lockedByOrder)->toBeNull()
        ->and($design->isLocked())->toBeFalse()
        ->and($locked->fresh()->lockedByOrder->is($order))->toBeTrue()
        ->and($locked->fresh()->isLocked())->toBeTrue();
});

it('declares the photos media collections of 02 §10', function (string $class): void {
    $model = new $class;
    $model->registerMediaCollections();
    $photos = collect($model->mediaCollections)->firstWhere('name', 'photos');

    expect($photos->diskName)->toBe('s3')
        ->and($photos->singleFile)->toBeFalse()
        ->and($photos->acceptsMimeTypes)->toBe(['image/jpeg', 'image/png', 'image/webp']);
})->with([ProductionUpdate::class, OrderIssue::class, Delivery::class]);

it('registers thumb 400 px and large 1600 px conversions on photos', function (string $class): void {
    $model = new $class;
    $model->registerMediaConversions();
    $conversions = collect($model->mediaConversions)->keyBy(static fn ($conversion): string => $conversion->getName());

    expect($conversions->keys()->all())->toBe(['thumb', 'large'])
        ->and($conversions['thumb']->shouldBePerformedOn('photos'))->toBeTrue()
        ->and($conversions['thumb']->shouldBePerformedOn('other'))->toBeFalse()
        ->and($conversions['thumb']->getManipulations()->toArray()['width'])->toBe([400])
        ->and($conversions['large']->shouldBePerformedOn('photos'))->toBeTrue()
        ->and($conversions['large']->getManipulations()->toArray()['width'])->toBe([1600]);
})->with([ProductionUpdate::class, OrderIssue::class, Delivery::class]);

it('attaches several photos on the private disk', function (string $class): void {
    $record = $class::factory()->create();

    $record->addMediaFromString(recordsTinyPng())->usingFileName('one.png')->toMediaCollection('photos');
    $record->addMediaFromString(recordsTinyPng())->usingFileName('two.png')->toMediaCollection('photos');

    expect($record->getMedia('photos'))->toHaveCount(2)
        ->and($record->getFirstMedia('photos'))->toBeInstanceOf(Media::class)
        ->and($record->getFirstMedia('photos')->disk)->toBe('s3');
})->with([ProductionUpdate::class, OrderIssue::class, Delivery::class]);

it('registers the morph aliases of the order records', function (): void {
    expect((new ConfirmationCall)->getMorphClass())->toBe('confirmation_call')
        ->and((new ProductionUpdate)->getMorphClass())->toBe('production_update')
        ->and((new OrderIssue)->getMorphClass())->toBe('order_issue')
        ->and((new Delivery)->getMorphClass())->toBe('delivery');
});
