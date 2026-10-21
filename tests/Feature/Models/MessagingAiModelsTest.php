<?php

declare(strict_types=1);

use App\Domain\Ai\Enums\AiFeature;
use App\Domain\Ai\Enums\AiProvider;
use App\Domain\Ai\Enums\AiUsageStatus;
use App\Domain\Ai\Enums\CreditLedgerKind;
use App\Domain\Ai\Models\AiCreditLedgerEntry;
use App\Domain\Ai\Models\AiUsageEvent;
use App\Domain\Identity\Models\User;
use App\Domain\Imports\Models\BlueprintImport;
use App\Domain\Messaging\Enums\MessageKind;
use App\Domain\Messaging\Models\Message;
use App\Domain\Messaging\Models\MessageRead;
use App\Domain\Orders\Models\Order;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\MassAssignmentException;
use Illuminate\Database\Eloquent\Relations\Relation;
use Illuminate\Support\Facades\DB;
use Spatie\MediaLibrary\MediaCollections\Models\Media;

/**
 * 02 §7, §9, §10 (Message attachments) and §11: the messaging and AI metering models.
 */
function messagingTinyPng(): string
{
    return (string) base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', true);
}

it('has the backed enum values of 02 §7 and §9', function (): void {
    $values = static fn (string $enum): array => array_map(static fn (BackedEnum $case): string|int => $case->value, $enum::cases());

    expect($values(MessageKind::class))->toBe(['text', 'system', 'internal_note'])
        ->and($values(CreditLedgerKind::class))->toBe([
            'monthly_grant', 'admin_grant', 'admin_revoke', 'reservation', 'reservation_release', 'consumption', 'refund', 'signup_grant',
        ])
        ->and($values(AiFeature::class))->toBe(['blueprint_recognition', 'provider_test'])
        ->and($values(AiUsageStatus::class))->toBe(['succeeded', 'failed'])
        ->and($values(AiProvider::class))->toBe(['anthropic', 'openai', 'openai_compatible', 'none']);
});

it('posts a text message by the customer of the order', function (): void {
    $message = Message::factory()->create()->fresh();

    expect($message->kind)->toBe(MessageKind::Text)
        ->and($message->author->is($message->order->customer))->toBeTrue()
        ->and($message->body)->not->toBeEmpty()
        ->and($message->system_event)->toBeNull()
        ->and($message->system_payload)->toBeNull()
        ->and($message->edited_at)->toBeNull()
        ->and($message->deleted_at)->toBeNull()
        ->and($message->created_at)->toBeInstanceOf(CarbonImmutable::class)
        ->and($message->updated_at)->toBeInstanceOf(CarbonImmutable::class);
});

it('builds a system message with no author and a translatable payload', function (): void {
    $payload = ['number' => 'ORD-2026-0001', 'count' => 3, 'nested' => ['a' => [1, 2], 'b' => null]];
    $message = Message::factory()->system('order.submitted', $payload)->create()->fresh();

    expect($message->kind)->toBe(MessageKind::System)
        ->and($message->author_id)->toBeNull()
        ->and($message->author)->toBeNull()
        ->and($message->system_event)->toBe('order.submitted')
        ->and($message->system_payload)->toEqual($payload);
});

it('builds an internal note by a staff member', function (): void {
    $note = Message::factory()->internalNote()->create()->fresh();

    expect($note->kind)->toBe(MessageKind::InternalNote)
        ->and($note->author->isStaff())->toBeTrue()
        ->and($note->system_event)->toBeNull();
});

it('records an edit and lets a chosen author write the message', function (): void {
    $author = User::factory()->staff()->create();
    $message = Message::factory()->by($author)->edited()->create()->fresh();

    expect($message->author->is($author))->toBeTrue()
        ->and($message->edited_at)->toBeInstanceOf(CarbonImmutable::class)
        ->and($message->edited_at->greaterThanOrEqualTo($message->created_at))->toBeTrue();
});

it('lets an author write only the body of a message, never the order, author, kind, system data or edit stamp', function (): void {
    $message = new Message;
    $message->fill([
        'body' => 'Hello',
        'order_id' => 'x',
        'author_id' => 'x',
        'kind' => 'system',
        'system_event' => 'order.closed',
        'system_payload' => ['a' => 1],
        'edited_at' => now(),
        'deleted_at' => now(),
    ]);

    expect(array_keys($message->getAttributes()))->toBe(['body']);
});

it('soft deletes a message and hides it from the thread', function (): void {
    $order = Order::factory()->create();
    $kept = Message::factory()->for($order)->create();
    $gone = Message::factory()->for($order)->create();

    $gone->delete();

    expect(Message::query()->find($gone->id))->toBeNull()
        ->and(Message::withTrashed()->find($gone->id)->deleted_at)->toBeInstanceOf(CarbonImmutable::class)
        ->and($order->fresh()->messages->pluck('id')->all())->toBe([$kept->id]);
});

it('lists the thread of an order oldest first, and only that order', function (): void {
    $order = Order::factory()->create();
    $second = Message::factory()->for($order)->create(['created_at' => now()->subHour()]);
    $first = Message::factory()->for($order)->create(['created_at' => now()->subDay()]);
    $third = Message::factory()->for($order)->system('order.closed')->create(['created_at' => now()]);
    Message::factory()->create();

    expect($order->fresh()->messages->pluck('id')->all())->toBe([$first->id, $second->id, $third->id])
        ->and($first->order->is($order))->toBeTrue();
});

it('declares the attachments media collection of 02 §10', function (): void {
    $message = new Message;
    $message->registerMediaCollections();
    $attachments = collect($message->mediaCollections)->firstWhere('name', 'attachments');

    expect(collect($message->mediaCollections)->pluck('name')->all())->toBe(['attachments'])
        ->and($attachments->diskName)->toBe('s3')
        ->and($attachments->singleFile)->toBeFalse()
        ->and($attachments->acceptsMimeTypes)->toBe(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
});

it('registers a 400 px wide thumb conversion on attachments only', function (): void {
    $message = new Message;
    $message->registerMediaConversions();
    $conversions = collect($message->mediaConversions)->keyBy(static fn ($conversion): string => $conversion->getName());

    expect($conversions->keys()->all())->toBe(['thumb'])
        ->and($conversions['thumb']->shouldBePerformedOn('attachments'))->toBeTrue()
        ->and($conversions['thumb']->shouldBePerformedOn('other'))->toBeFalse()
        ->and($conversions['thumb']->getManipulations()->toArray()['width'])->toBe([400]);
});

it('attaches several files on the private disk', function (): void {
    $message = Message::factory()->create();

    $message->addMediaFromString(messagingTinyPng())->usingFileName('one.png')->toMediaCollection('attachments');
    $message->addMediaFromString(messagingTinyPng())->usingFileName('two.png')->toMediaCollection('attachments');

    expect($message->getMedia('attachments'))->toHaveCount(2)
        ->and($message->getFirstMedia('attachments'))->toBeInstanceOf(Media::class)
        ->and($message->getFirstMedia('attachments')->disk)->toBe('s3');
});

it('marks an order thread read for a user', function (): void {
    $read = MessageRead::factory()->create()->fresh();

    expect($read->order)->toBeInstanceOf(Order::class)
        ->and($read->user->is($read->order->customer))->toBeTrue()
        ->and($read->last_read_at)->toBeInstanceOf(CarbonImmutable::class)
        ->and($read->last_read_message_id)->toBeNull()
        ->and($read->getAttributes())->not->toHaveKeys(['created_at', 'updated_at', 'id']);
});

it('reloads a read mark by both of its key columns', function (): void {
    $order = Order::factory()->create();
    $mine = MessageRead::factory()->for($order)->create(['last_read_at' => now()->subDay()]);
    $theirs = MessageRead::factory()->for($order)->by(User::factory()->staff()->create())->create(['last_read_at' => now()->subHour()]);
    MessageRead::factory()->create();

    $stale = clone $mine;
    MessageRead::query()->where('order_id', $order->id)->where('user_id', $mine->user_id)->update(['last_read_message_id' => 'M'.str_repeat('0', 25)]);

    expect($mine->fresh()->user_id)->toBe($mine->user_id)
        ->and($theirs->fresh()->user_id)->toBe($theirs->user_id)
        ->and($stale->refresh()->last_read_message_id)->toBe('M'.str_repeat('0', 25))
        ->and($theirs->fresh()->last_read_message_id)->toBeNull();
});

it('points a read mark at the last message read', function (): void {
    $order = Order::factory()->create();
    $message = Message::factory()->for($order)->create();
    $read = MessageRead::factory()->for($order)->lastRead($message)->create()->fresh();

    expect($read->last_read_message_id)->toBe($message->id)
        ->and($read->last_read_at->greaterThanOrEqualTo($message->created_at))->toBeTrue();
});

it('keeps a read mark keyless in Eloquent and without timestamps', function (): void {
    $read = new MessageRead;

    expect($read->getIncrementing())->toBeFalse()
        ->and($read->usesTimestamps())->toBeFalse()
        ->and($read->getTable())->toBe('message_reads')
        ->and($read->getMorphClass())->toBe('message_read');
});

it('updates and deletes only the read mark of its own order and user', function (): void {
    $order = Order::factory()->create();
    $mine = MessageRead::factory()->for($order)->create(['last_read_at' => now()->subDay()]);
    $theirs = MessageRead::factory()->for($order)->by(User::factory()->staff()->create())->create(['last_read_at' => now()->subDay()]);
    $elsewhere = MessageRead::factory()->create(['user_id' => $mine->user_id, 'last_read_at' => now()->subDay()]);
    $before = $theirs->fresh()->last_read_at;

    $mine->last_read_at = now()->toImmutable();
    $mine->save();

    expect(MessageRead::query()->count())->toBe(3)
        ->and(MessageRead::query()->where('order_id', $order->id)->where('user_id', $mine->user_id)->first()->last_read_at->isToday())->toBeTrue()
        ->and(MessageRead::query()->where('order_id', $order->id)->where('user_id', $theirs->user_id)->first()->last_read_at->equalTo($before))->toBeTrue()
        ->and(MessageRead::query()->where('order_id', $elsewhere->order_id)->where('user_id', $elsewhere->user_id)->first()->last_read_at->isToday())->toBeFalse();

    $mine->delete();

    expect(MessageRead::query()->count())->toBe(2)
        ->and(MessageRead::query()->where('order_id', $order->id)->where('user_id', $theirs->user_id)->exists())->toBeTrue();
});

it('inserts a read mark with a composite key and updates it by saving again', function (): void {
    $order = Order::factory()->create();
    $user = User::factory()->create();

    $mark = new MessageRead;
    $mark->forceFill(['order_id' => $order->id, 'user_id' => $user->id, 'last_read_at' => now()->subDay()])->save();

    expect($mark->exists)->toBeTrue()
        ->and(MessageRead::query()->count())->toBe(1);

    $mark->forceFill(['last_read_at' => now()])->save();

    expect(MessageRead::query()->count())->toBe(1)
        ->and(MessageRead::query()->firstOrFail()->last_read_at->isToday())->toBeTrue();
});

it('lets a read mark be written only through the last read fields', function (): void {
    $read = new MessageRead;
    $read->fill(['last_read_at' => now(), 'last_read_message_id' => 'x', 'order_id' => 'x', 'user_id' => 'x']);

    expect(array_keys($read->getAttributes()))->toBe(['last_read_at', 'last_read_message_id']);
});

it('relates an order to its messages and a user to their credit ledger', function (): void {
    $order = Order::factory()->create();
    $user = User::factory()->create();
    $entry = AiCreditLedgerEntry::factory()->for($user)->create();
    AiCreditLedgerEntry::factory()->create();

    expect($order->messages)->toHaveCount(0)
        ->and($user->aiCreditLedgerEntries->pluck('id')->all())->toBe([$entry->id])
        ->and($entry->user->is($user))->toBeTrue();
});

it('writes a ledger entry with a signed delta and no update stamp', function (): void {
    $entry = AiCreditLedgerEntry::factory()->create()->fresh();

    expect($entry->kind)->toBeInstanceOf(CreditLedgerKind::class)
        ->and($entry->delta)->toBeInt()
        ->and($entry->period)->toBeNull()
        ->and($entry->reference_type)->toBeNull()
        ->and($entry->reference_id)->toBeNull()
        ->and($entry->reference)->toBeNull()
        ->and($entry->note)->toBeNull()
        ->and($entry->created_by)->toBeNull()
        ->and($entry->created_at)->toBeInstanceOf(CarbonImmutable::class)
        ->and($entry->getAttributes())->not->toHaveKey('updated_at')
        ->and($entry->usesTimestamps())->toBeTrue()
        ->and(AiCreditLedgerEntry::UPDATED_AT)->toBeNull();
});

it('builds a state for every ledger kind with the sign of 02 §7.1', function (): void {
    $kinds = [
        'monthlyGrant' => [CreditLedgerKind::MonthlyGrant, true],
        'signupGrant' => [CreditLedgerKind::SignupGrant, true],
        'adminGrant' => [CreditLedgerKind::AdminGrant, true],
        'adminRevoke' => [CreditLedgerKind::AdminRevoke, false],
        'reservation' => [CreditLedgerKind::Reservation, false],
        'reservationRelease' => [CreditLedgerKind::ReservationRelease, true],
        'consumption' => [CreditLedgerKind::Consumption, false],
        'refund' => [CreditLedgerKind::Refund, true],
    ];

    foreach ($kinds as $state => [$kind, $positive]) {
        $entry = AiCreditLedgerEntry::factory()->{$state}()->create()->fresh();

        expect($entry->kind)->toBe($kind, $state)
            ->and($positive ? $entry->delta > 0 : $entry->delta < 0)->toBeTrue("{$state} has the wrong sign");
    }

    expect(array_map(static fn (array $row): CreditLedgerKind => $row[0], array_values($kinds)))->toEqualCanonicalizing(CreditLedgerKind::cases());
});

it('writes the period of a monthly grant, which may carry a zero delta', function (): void {
    $grant = AiCreditLedgerEntry::factory()->monthlyGrant('2026-10')->create()->fresh();
    $marker = AiCreditLedgerEntry::factory()->monthlyGrant('2026-10', delta: 0)->create()->fresh();

    expect($grant->period)->toBe('2026-10')
        ->and($grant->delta)->toBeGreaterThan(0)
        ->and($marker->period)->toBe('2026-10')
        ->and($marker->delta)->toBe(0)
        ->and(AiCreditLedgerEntry::factory()->monthlyGrant()->create()->period)->toBe(now()->format('Y-m'));
});

it('records the admin and the reason of a manual adjustment', function (): void {
    $admin = User::factory()->admin()->create();
    $entry = AiCreditLedgerEntry::factory()->adminGrant()->by($admin, 'Goodwill after a failed run')->create()->fresh();

    expect($entry->created_by)->toBe($admin->id)
        ->and($entry->note)->toBe('Goodwill after a failed run');
});

it('refuses to update a ledger entry, which is append only', function (): void {
    $entry = AiCreditLedgerEntry::factory()->create();
    $delta = $entry->delta;

    expect(fn () => $entry->forceFill(['delta' => 99])->save())->toThrow(LogicException::class, "Ledger entry {$entry->id} is immutable")
        ->and(fn () => $entry->forceFill(['note' => 'edited'])->save())->toThrow(LogicException::class)
        ->and($entry->fresh()->delta)->toBe($delta)
        ->and($entry->fresh()->note)->toBeNull();
});

it('still saves a new ledger entry and an unchanged one', function (): void {
    $entry = AiCreditLedgerEntry::factory()->make();

    expect($entry->save())->toBeTrue()
        ->and($entry->exists)->toBeTrue()
        ->and($entry->save())->toBeTrue();
});

it('has nothing mass-assignable on the ledger and the usage events (written only by the credit and metering code)', function (string $class): void {
    expect(fn () => (new $class)->fill(['user_id' => 'x', 'delta' => 1, 'kind' => 'refund', 'status' => 'succeeded']))
        ->toThrow(MassAssignmentException::class);
})->with([AiCreditLedgerEntry::class, AiUsageEvent::class]);

it('links a ledger entry to a blueprint import through the reference morph', function (): void {
    $import = BlueprintImport::factory()->create();
    $entry = AiCreditLedgerEntry::factory()->consumption()->for($import, 'reference')->create()->fresh();
    $unrelated = AiCreditLedgerEntry::factory()->create();

    expect($entry->reference_type)->toBe('blueprint_import')
        ->and($entry->reference_id)->toBe($import->id)
        ->and($entry->reference)->toBeInstanceOf(BlueprintImport::class)
        ->and($entry->reference->is($import))->toBeTrue()
        ->and($import->ledgerEntries->pluck('id')->all())->toBe([$entry->id])
        ->and($unrelated->reference)->toBeNull();
});

it('lists the ledger entries of an import oldest first', function (): void {
    $import = BlueprintImport::factory()->create();
    $reserved = AiCreditLedgerEntry::factory()->reservation()->for($import, 'reference')->create(['created_at' => now()->subMinutes(2)]);
    $consumed = AiCreditLedgerEntry::factory()->consumption()->for($import, 'reference')->create(['created_at' => now()->subMinute()]);
    $released = AiCreditLedgerEntry::factory()->reservationRelease()->for($import, 'reference')->create(['created_at' => now()->subMinutes(3)]);
    AiCreditLedgerEntry::factory()->consumption()->for(BlueprintImport::factory()->create(), 'reference')->create();

    expect($import->fresh()->ledgerEntries->pluck('id')->all())->toBe([$released->id, $reserved->id, $consumed->id]);
});

it('records an AI run of a blueprint import with its cost and token counts', function (): void {
    $event = AiUsageEvent::factory()->create()->fresh();

    expect($event->feature)->toBe(AiFeature::BlueprintRecognition)
        ->and($event->provider)->toBe(AiProvider::Anthropic)
        ->and($event->status)->toBe(AiUsageStatus::Succeeded)
        ->and($event->model)->not->toBeNull()
        ->and($event->request_count)->toBeInt()->toBeGreaterThan(0)
        ->and($event->input_tokens)->toBeInt()
        ->and($event->output_tokens)->toBeInt()
        ->and($event->image_count)->toBeInt()
        ->and($event->cost_micro_usd)->toBeInt()->toBeGreaterThan(0)
        ->and($event->duration_ms)->toBeInt()
        ->and($event->reference)->toBeInstanceOf(BlueprintImport::class)
        ->and($event->reference->user_id)->toBe($event->user_id)
        ->and($event->user->is($event->reference->user))->toBeTrue()
        ->and($event->created_at)->toBeInstanceOf(CarbonImmutable::class)
        ->and($event->getAttributes())->not->toHaveKey('updated_at')
        ->and(AiUsageEvent::UPDATED_AT)->toBeNull();
});

it('lists the usage events of an import', function (): void {
    $event = AiUsageEvent::factory()->create();
    AiUsageEvent::factory()->create();

    expect($event->reference->usageEvents->pluck('id')->all())->toBe([$event->id])
        ->and($event->reference->ledgerEntries)->toHaveCount(0);
});

it('builds a provider test event with no reference and a failed run', function (): void {
    $test = AiUsageEvent::factory()->providerTest()->create()->fresh();
    $failed = AiUsageEvent::factory()->failed()->create()->fresh();

    expect($test->feature)->toBe(AiFeature::ProviderTest)
        ->and($test->reference_type)->toBeNull()
        ->and($test->reference_id)->toBeNull()
        ->and($test->reference)->toBeNull()
        ->and($failed->status)->toBe(AiUsageStatus::Failed)
        ->and($failed->feature)->toBe(AiFeature::BlueprintRecognition);
});

it('applies the zero defaults of token and image counts when the run does not report them', function (): void {
    $user = User::factory()->create();
    $id = (string) str()->ulid();

    DB::table('ai_usage_events')->insert([
        'id' => $id, 'user_id' => $user->id, 'feature' => 'provider_test', 'provider' => 'none', 'request_count' => 0,
        'cost_micro_usd' => 0, 'duration_ms' => 12, 'status' => 'succeeded', 'created_at' => now(),
    ]);
    $event = AiUsageEvent::query()->findOrFail($id);

    expect($event->input_tokens)->toBe(0)
        ->and($event->output_tokens)->toBe(0)
        ->and($event->image_count)->toBe(0)
        ->and($event->model)->toBeNull();
});

it('registers the morph aliases of the messaging and AI models', function (): void {
    expect((new Message)->getMorphClass())->toBe('message')
        ->and((new MessageRead)->getMorphClass())->toBe('message_read')
        ->and((new AiCreditLedgerEntry)->getMorphClass())->toBe('ai_credit_ledger_entry')
        ->and((new AiUsageEvent)->getMorphClass())->toBe('ai_usage_event')
        ->and(Relation::getMorphedModel('blueprint_import'))->toBe(BlueprintImport::class);
});
