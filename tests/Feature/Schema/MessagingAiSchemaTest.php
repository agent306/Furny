<?php

declare(strict_types=1);

use App\Domain\Ai\Enums\AiFeature;
use App\Domain\Ai\Enums\AiProvider;
use App\Domain\Ai\Enums\AiUsageStatus;
use App\Domain\Ai\Enums\CreditLedgerKind;
use App\Domain\Ai\Models\AiCreditLedgerEntry;
use App\Domain\Ai\Models\AiUsageEvent;
use App\Domain\Identity\Models\User;
use App\Domain\Messaging\Enums\MessageKind;
use App\Domain\Messaging\Models\Message;
use App\Domain\Messaging\Models\MessageRead;
use App\Domain\Orders\Models\Order;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Tests\Support\PgSchema;

/**
 * 02 §7 (AI metering), §9 (messaging) and §15 groups 9 and 10: messages, message reads, the AI credit
 * ledger and the AI usage events.
 */
const MESSAGING_AI_TABLES = ['messages', 'message_reads', 'ai_credit_ledger', 'ai_usage_events'];

/** @return array{data_type: string, character_maximum_length: int, is_nullable: string} */
function messagingAiUlid(bool $nullable = false): array
{
    return ['data_type' => 'character', 'character_maximum_length' => 26, 'is_nullable' => $nullable ? 'YES' : 'NO'];
}

/** @return array{data_type: string, character_maximum_length: int, is_nullable: string} */
function messagingAiVarchar(int $length, bool $nullable = false): array
{
    return ['data_type' => 'character varying', 'character_maximum_length' => $length, 'is_nullable' => $nullable ? 'YES' : 'NO'];
}

/** @return array{data_type: string, is_nullable: string} */
function messagingAiType(string $dataType, bool $nullable = false): array
{
    return ['data_type' => $dataType, 'is_nullable' => $nullable ? 'YES' : 'NO'];
}

/** @return array{data_type: string, udt_name: string, is_nullable: string} */
function messagingAiTimestamptz(bool $nullable = true): array
{
    return ['data_type' => 'timestamp with time zone', 'udt_name' => 'timestamptz', 'is_nullable' => $nullable ? 'YES' : 'NO'];
}

/**
 * Compares the exact column set of a table and, per column, the type, length and nullability that
 * the spec fixes.
 *
 * @param  array<string, array<string, mixed>>  $expected
 */
function messagingAiExpectColumns(string $table, array $expected): void
{
    $actual = [];

    foreach ($expected as $column => $pin) {
        $actual[$column] = array_intersect_key(PgSchema::column($table, $column), $pin);
    }

    expect(PgSchema::columns($table))->toBe(PgSchema::sorted(array_keys($expected)))
        ->and($actual)->toEqual($expected);
}

/** A ledger row written straight to the table, so the constraint itself is exercised (not the model). */
function messagingAiLedgerRow(string $userId, string $kind, ?string $period): void
{
    DB::table('ai_credit_ledger')->insert([
        'id' => (string) str()->ulid(),
        'user_id' => $userId,
        'delta' => 0,
        'kind' => $kind,
        'period' => $period,
        'created_at' => now(),
    ]);
}

it('creates messages with the columns of 02 §9.1', function (): void {
    messagingAiExpectColumns('messages', [
        'id' => messagingAiUlid(),
        'order_id' => messagingAiUlid(),
        'author_id' => messagingAiUlid(nullable: true),
        'kind' => messagingAiVarchar(24),
        'body' => messagingAiType('text'),
        'system_event' => messagingAiVarchar(64, nullable: true),
        'system_payload' => ['udt_name' => 'jsonb', 'is_nullable' => 'YES'],
        'edited_at' => messagingAiTimestamptz(),
        'created_at' => messagingAiTimestamptz(),
        'updated_at' => messagingAiTimestamptz(),
        'deleted_at' => messagingAiTimestamptz(),
    ]);
});

it('creates message_reads with the columns of 02 §9.2', function (): void {
    messagingAiExpectColumns('message_reads', [
        'order_id' => messagingAiUlid(),
        'user_id' => messagingAiUlid(),
        'last_read_at' => messagingAiTimestamptz(nullable: false),
        'last_read_message_id' => messagingAiUlid(nullable: true),
    ]);
});

it('creates ai_credit_ledger with the columns of 02 §7.1', function (): void {
    messagingAiExpectColumns('ai_credit_ledger', [
        'id' => messagingAiUlid(),
        'user_id' => messagingAiUlid(),
        'delta' => messagingAiType('integer'),
        'kind' => messagingAiVarchar(24),
        'period' => ['data_type' => 'character', 'character_maximum_length' => 7, 'is_nullable' => 'YES'],
        'reference_type' => messagingAiVarchar(255, nullable: true),
        'reference_id' => messagingAiUlid(nullable: true),
        'note' => messagingAiVarchar(255, nullable: true),
        'created_by' => messagingAiUlid(nullable: true),
        'created_at' => messagingAiTimestamptz(nullable: false),
    ]);
});

it('creates ai_usage_events with the columns of 02 §7.2', function (): void {
    messagingAiExpectColumns('ai_usage_events', [
        'id' => messagingAiUlid(),
        'user_id' => messagingAiUlid(nullable: true),
        'feature' => messagingAiVarchar(32),
        'provider' => messagingAiVarchar(24),
        'model' => messagingAiVarchar(100, nullable: true),
        'request_count' => messagingAiType('integer'),
        'input_tokens' => messagingAiType('integer'),
        'output_tokens' => messagingAiType('integer'),
        'image_count' => messagingAiType('integer'),
        'cost_micro_usd' => messagingAiType('bigint'),
        'duration_ms' => messagingAiType('integer'),
        'status' => messagingAiVarchar(16),
        'reference_type' => messagingAiVarchar(255, nullable: true),
        'reference_id' => messagingAiUlid(nullable: true),
        'created_at' => messagingAiTimestamptz(nullable: false),
    ]);
});

it('gives only the columns with a spec default a database default, and exactly that default', function (): void {
    $expected = [
        'messages.kind' => "/^'text'::character varying$/",
        'ai_usage_events.input_tokens' => "/^'?0'?(::\\w+)?$/",
        'ai_usage_events.output_tokens' => "/^'?0'?(::\\w+)?$/",
        'ai_usage_events.image_count' => "/^'?0'?(::\\w+)?$/",
    ];

    foreach ($expected as $name => $pattern) {
        [$table, $column] = explode('.', $name);

        expect(PgSchema::column($table, $column)['column_default'])->toMatch($pattern, $name);
    }

    // Every other column has no default (column_default IS NULL): not even created_at, which Eloquent writes.
    expect(PgSchema::defaultedColumns(MESSAGING_AI_TABLES))->toBe(PgSchema::sorted(array_keys($expected)));
});

it('sizes every enum column to hold the longest value of its backed enum', function (): void {
    $columns = [
        'messages.kind' => MessageKind::class,
        'ai_credit_ledger.kind' => CreditLedgerKind::class,
        'ai_usage_events.feature' => AiFeature::class,
        'ai_usage_events.provider' => AiProvider::class,
        'ai_usage_events.status' => AiUsageStatus::class,
    ];

    foreach ($columns as $name => $enum) {
        [$table, $column] = explode('.', $name);
        $longest = max(array_map(static fn (BackedEnum $case): int => strlen((string) $case->value), $enum::cases()));

        expect(PgSchema::column($table, $column)['character_maximum_length'])->toBeGreaterThanOrEqual($longest, $name);
    }
});

it('has exactly the indexes of 02 §7 and §9, plus the plain indexes on the foreign keys 02 leaves bare', function (): void {
    // Complete lists per table: primary key, the indexes of 02, and the join-key indexes added by the controller ruling.
    expect(PgSchema::indexNames('messages'))->toBe([
        'messages_author_id_index',
        'messages_order_id_created_at_index',
        'messages_pkey',
    ])
        ->and(PgSchema::indexNames('message_reads'))->toBe([
            'message_reads_pkey',
            'message_reads_user_id_index',
        ])
        ->and(PgSchema::indexNames('ai_credit_ledger'))->toBe([
            'ai_credit_ledger_created_by_index',
            'ai_credit_ledger_one_monthly_grant_per_period',
            'ai_credit_ledger_pkey',
            'ai_credit_ledger_reference_type_reference_id_index',
            'ai_credit_ledger_user_id_created_at_index',
        ])
        ->and(PgSchema::indexNames('ai_usage_events'))->toBe([
            'ai_usage_events_created_at_index',
            'ai_usage_events_pkey',
            'ai_usage_events_provider_created_at_index',
            'ai_usage_events_reference_type_reference_id_index',
            'ai_usage_events_user_id_created_at_index',
        ]);

    expect(PgSchema::indexDefinition('messages', 'messages_order_id_created_at_index'))->not->toContain('UNIQUE')->toContain('(order_id, created_at)')
        ->and(PgSchema::indexDefinition('messages', 'messages_author_id_index'))->not->toContain('UNIQUE')->toContain('(author_id)')
        ->and(PgSchema::indexDefinition('message_reads', 'message_reads_user_id_index'))->not->toContain('UNIQUE')->toContain('(user_id)')
        ->and(PgSchema::indexDefinition('ai_credit_ledger', 'ai_credit_ledger_user_id_created_at_index'))->not->toContain('UNIQUE')->toContain('(user_id, created_at)')
        ->and(PgSchema::indexDefinition('ai_credit_ledger', 'ai_credit_ledger_created_by_index'))->not->toContain('UNIQUE')->toContain('(created_by)')
        ->and(PgSchema::indexDefinition('ai_usage_events', 'ai_usage_events_created_at_index'))->not->toContain('UNIQUE')->toContain('(created_at)')
        ->and(PgSchema::indexDefinition('ai_usage_events', 'ai_usage_events_user_id_created_at_index'))->not->toContain('UNIQUE')->toContain('(user_id, created_at)')
        ->and(PgSchema::indexDefinition('ai_usage_events', 'ai_usage_events_provider_created_at_index'))->not->toContain('UNIQUE')->toContain('(provider, created_at)')
        // The morph reference of both AI tables (BlueprintImport::ledgerEntries() / usageEvents()).
        ->and(PgSchema::indexDefinition('ai_credit_ledger', 'ai_credit_ledger_reference_type_reference_id_index'))->not->toContain('UNIQUE')->toContain('(reference_type, reference_id)')
        ->and(PgSchema::indexDefinition('ai_usage_events', 'ai_usage_events_reference_type_reference_id_index'))->not->toContain('UNIQUE')->toContain('(reference_type, reference_id)');
});

it('keys message_reads on (order_id, user_id)', function (): void {
    expect(PgSchema::indexDefinition('message_reads', 'message_reads_pkey'))->toContain('UNIQUE')->toContain('(order_id, user_id)');

    $read = MessageRead::factory()->create();

    expect(fn () => DB::transaction(fn () => MessageRead::factory()->create(['order_id' => $read->order_id, 'user_id' => $read->user_id])))
        ->toThrow(QueryException::class, 'message_reads_pkey');

    // The same user on another order, or another user on the same order, is a separate row.
    MessageRead::factory()->create(['user_id' => $read->user_id]);
    MessageRead::factory()->for($read->order)->by(User::factory()->staff()->create())->create();

    expect(MessageRead::query()->count())->toBe(3);
});

it('allows only one monthly grant per user and period, through a partial unique index', function (): void {
    expect(PgSchema::indexDefinition('ai_credit_ledger', 'ai_credit_ledger_one_monthly_grant_per_period'))
        ->toContain('UNIQUE')->toContain('(user_id, period)')->toContain("WHERE ((kind)::text = 'monthly_grant'::text)");

    $user = User::factory()->create();
    AiCreditLedgerEntry::factory()->for($user)->monthlyGrant('2026-10')->create();

    // Another period, another user, and the zero-delta period marker of 18 §10.2 all count as separate grants.
    AiCreditLedgerEntry::factory()->for($user)->monthlyGrant('2026-11')->create();
    AiCreditLedgerEntry::factory()->monthlyGrant('2026-10')->create();

    expect(AiCreditLedgerEntry::query()->count())->toBe(3);

    expect(fn () => DB::transaction(fn () => AiCreditLedgerEntry::factory()->for($user)->monthlyGrant('2026-10', delta: 0)->create()))
        ->toThrow(QueryException::class, 'ai_credit_ledger_one_monthly_grant_per_period');
});

it('does not limit the other ledger kinds in a period', function (): void {
    $user = User::factory()->create();

    // Two admin grants, a grant and a revoke, and rows without a period never collide with each other or with a monthly grant.
    messagingAiLedgerRow($user->id, 'admin_grant', '2026-10');
    messagingAiLedgerRow($user->id, 'admin_grant', '2026-10');
    messagingAiLedgerRow($user->id, 'admin_revoke', '2026-10');
    messagingAiLedgerRow($user->id, 'monthly_grant', '2026-10');
    messagingAiLedgerRow($user->id, 'consumption', null);
    messagingAiLedgerRow($user->id, 'consumption', null);
    messagingAiLedgerRow($user->id, 'monthly_grant', null);
    messagingAiLedgerRow($user->id, 'monthly_grant', null);

    expect(AiCreditLedgerEntry::query()->where('user_id', $user->id)->count())->toBe(8);
});

it('lets a monthly grant be written again once the earlier one of the period is gone from the table', function (): void {
    $user = User::factory()->create();
    $first = AiCreditLedgerEntry::factory()->for($user)->monthlyGrant('2026-10')->create();

    // The model refuses to delete (append only); this is the row going away at the database level, as a cascade would.
    DB::table('ai_credit_ledger')->where('id', $first->id)->delete();
    AiCreditLedgerEntry::factory()->for($user)->monthlyGrant('2026-10')->create();

    expect(AiCreditLedgerEntry::query()->where('user_id', $user->id)->count())->toBe(1);
});

it('declares the foreign key actions of 02 §7 and §9', function (): void {
    $tables = implode(', ', array_map(static fn (string $table): string => "'{$table}'", MESSAGING_AI_TABLES));
    $actions = collect(DB::select(
        "select conrelid::regclass::text as tbl, a.attname as col, c.confdeltype as action, c.confrelid::regclass::text as ref
         from pg_constraint c
         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
         where c.contype = 'f' and c.conrelid::regclass::text in ({$tables})",
    ))->mapWithKeys(static fn (object $row): array => ["{$row->tbl}.{$row->col}" => "{$row->action}:{$row->ref}"]);

    // r = restrict (R), c = cascade (C), n = set null (N). `last_read_message_id` and the morph reference have no key.
    expect($actions->all())->toEqual([
        'messages.order_id' => 'c:orders',
        'messages.author_id' => 'n:users',
        'message_reads.order_id' => 'c:orders',
        'message_reads.user_id' => 'c:users',
        'ai_credit_ledger.user_id' => 'c:users',
        'ai_credit_ledger.created_by' => 'n:users',
        'ai_usage_events.user_id' => 'n:users',
    ]);
});

it('cascades from an order to its messages and read marks', function (): void {
    $order = Order::factory()->create();
    Message::factory()->for($order)->create();
    Message::factory()->for($order)->system('quote.sent')->create();
    MessageRead::factory()->for($order)->create();
    Message::factory()->create();
    MessageRead::factory()->create();

    $order->forceDelete();

    expect(Message::query()->withTrashed()->count())->toBe(1)
        ->and(MessageRead::query()->count())->toBe(1);
});

it('keeps the messages of an order that is only soft deleted', function (): void {
    $message = Message::factory()->create();

    $message->order->delete();

    expect(Message::query()->whereKey($message->id)->exists())->toBeTrue();
});

it('keeps a message but forgets its author when the user is deleted', function (): void {
    $author = User::factory()->staff()->create();
    $message = Message::factory()->by($author)->create();

    $author->forceDelete();

    expect($message->fresh()->author_id)->toBeNull()
        ->and($message->fresh()->body)->toBe($message->body);
});

it('refuses a message of an order or by an author that does not exist', function (): void {
    expect(fn () => DB::transaction(fn () => Message::factory()->create(['order_id' => '01ARZ3NDEKTSV4RRFFQ69G5FAV'])))
        ->toThrow(QueryException::class, 'messages_order_id_foreign')
        ->and(fn () => DB::transaction(fn () => Message::factory()->create(['author_id' => '01ARZ3NDEKTSV4RRFFQ69G5FAV'])))
        ->toThrow(QueryException::class, 'messages_author_id_foreign');
});

it('drops the read marks and ledger rows of a deleted user and nulls their usage events and audit stamps', function (): void {
    $user = User::factory()->create();
    $staff = User::factory()->staff()->create();
    MessageRead::factory()->create(['user_id' => $user->id]);
    $granted = AiCreditLedgerEntry::factory()->adminGrant()->create(['created_by' => $staff->id]);
    AiCreditLedgerEntry::factory()->for($user)->create();
    $event = AiUsageEvent::factory()->providerTest()->create(['user_id' => $user->id]);
    $other = AiUsageEvent::factory()->providerTest()->create();

    $user->forceDelete();

    expect(MessageRead::query()->count())->toBe(0)
        ->and(AiCreditLedgerEntry::query()->count())->toBe(1)
        ->and($event->fresh()->user_id)->toBeNull()
        ->and($other->fresh()->user_id)->toBe($other->user_id);

    $staff->forceDelete();

    expect($granted->fresh()->created_by)->toBeNull()
        ->and(AiCreditLedgerEntry::query()->count())->toBe(1);
});

it('refuses ledger rows and usage events of a user that does not exist', function (): void {
    expect(fn () => DB::transaction(fn () => AiCreditLedgerEntry::factory()->create(['user_id' => '01ARZ3NDEKTSV4RRFFQ69G5FAV'])))
        ->toThrow(QueryException::class, 'ai_credit_ledger_user_id_foreign')
        ->and(fn () => DB::transaction(fn () => AiUsageEvent::factory()->providerTest()->create(['user_id' => '01ARZ3NDEKTSV4RRFFQ69G5FAV'])))
        ->toThrow(QueryException::class, 'ai_usage_events_user_id_foreign');
});
