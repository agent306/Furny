<?php

declare(strict_types=1);

use App\Domain\Furniture\Models\FurnitureDesign;
use App\Domain\Identity\Models\User;
use App\Domain\Orders\Enums\CallOutcome;
use App\Domain\Orders\Enums\IssueStatus;
use App\Domain\Orders\Enums\NegotiationStatus;
use App\Domain\Orders\Enums\PaymentGateway;
use App\Domain\Orders\Enums\PaymentKind;
use App\Domain\Orders\Enums\PaymentMethod;
use App\Domain\Orders\Enums\PaymentStatus;
use App\Domain\Orders\Enums\ProductionVisibility;
use App\Domain\Orders\Enums\QuoteLineKind;
use App\Domain\Orders\Enums\QuoteStatus;
use App\Domain\Orders\Models\ConfirmationCall;
use App\Domain\Orders\Models\Delivery;
use App\Domain\Orders\Models\Order;
use App\Domain\Orders\Models\OrderIssue;
use App\Domain\Orders\Models\OrderItem;
use App\Domain\Orders\Models\Payment;
use App\Domain\Orders\Models\ProductionUpdate;
use App\Domain\Orders\Models\Quote;
use App\Domain\Orders\Models\QuoteLine;
use App\Domain\Orders\Models\QuoteNegotiation;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Tests\Support\PgSchema;

/**
 * 02 §8.5–§8.12 and §15 group 8: quotes, quote lines, negotiations, confirmation calls, production
 * updates, issues, deliveries and payments, plus the foreign keys added after them.
 */
const SCHEMA_B_TABLES = [
    'quotes', 'quote_lines', 'quote_negotiations', 'confirmation_calls', 'production_updates', 'order_issues', 'deliveries', 'payments',
];

/** @return array{data_type: string, character_maximum_length: int, is_nullable: string} */
function schemaBUlid(bool $nullable = false): array
{
    return ['data_type' => 'character', 'character_maximum_length' => 26, 'is_nullable' => $nullable ? 'YES' : 'NO'];
}

/** @return array{data_type: string, character_maximum_length: int, is_nullable: string} */
function schemaBVarchar(int $length, bool $nullable = false): array
{
    return ['data_type' => 'character varying', 'character_maximum_length' => $length, 'is_nullable' => $nullable ? 'YES' : 'NO'];
}

/** @return array{data_type: string, is_nullable: string} */
function schemaBType(string $dataType, bool $nullable = false): array
{
    return ['data_type' => $dataType, 'is_nullable' => $nullable ? 'YES' : 'NO'];
}

/** @return array{data_type: string, udt_name: string, is_nullable: string} */
function schemaBTimestamptz(bool $nullable = true): array
{
    return ['data_type' => 'timestamp with time zone', 'udt_name' => 'timestamptz', 'is_nullable' => $nullable ? 'YES' : 'NO'];
}

/**
 * Compares the exact column set of a table and, per column, the type, length, precision and
 * nullability that the spec fixes.
 *
 * @param  array<string, array<string, mixed>>  $expected
 */
function schemaBExpectColumns(string $table, array $expected): void
{
    $actual = [];

    foreach ($expected as $column => $pin) {
        $actual[$column] = array_intersect_key(PgSchema::column($table, $column), $pin);
    }

    expect(PgSchema::columns($table))->toBe(PgSchema::sorted(array_keys($expected)))
        ->and($actual)->toEqual($expected);
}

/** Runs a delete that the database must refuse, inside a savepoint so the test transaction stays usable. */
function schemaBRefuses(Closure $delete, string $constraint): void
{
    expect(fn () => DB::transaction($delete))->toThrow(QueryException::class, $constraint);
}

it('creates quotes with the columns of 02 §8.5', function (): void {
    schemaBExpectColumns('quotes', [
        'id' => schemaBUlid(),
        'order_id' => schemaBUlid(),
        'version' => schemaBType('smallint'),
        'number' => schemaBVarchar(24),
        'status' => schemaBVarchar(16),
        'currency' => ['data_type' => 'character', 'character_maximum_length' => 3, 'is_nullable' => 'NO'],
        'prices_include_tax' => schemaBType('boolean'),
        'subtotal_minor' => schemaBType('bigint'),
        'discount_minor' => schemaBType('bigint'),
        'tax_minor' => schemaBType('bigint'),
        'total_minor' => schemaBType('bigint'),
        'tax_breakdown' => ['udt_name' => 'jsonb', 'is_nullable' => 'NO'],
        'valid_until' => schemaBType('date'),
        'lead_time_days' => schemaBType('smallint', nullable: true),
        'notes_to_customer' => schemaBType('text', nullable: true),
        'terms' => schemaBType('text'),
        'internal_notes' => schemaBType('text', nullable: true),
        'cost_snapshot' => ['udt_name' => 'jsonb', 'is_nullable' => 'NO'],
        'catalog_version' => schemaBType('integer'),
        'engine_version' => schemaBVarchar(16),
        'created_by' => schemaBUlid(),
        'sent_at' => schemaBTimestamptz(),
        'accepted_at' => schemaBTimestamptz(),
        'declined_at' => schemaBTimestamptz(),
        'expired_at' => schemaBTimestamptz(),
        'superseded_at' => schemaBTimestamptz(),
        'withdrawn_at' => schemaBTimestamptz(),
        'decline_reason' => schemaBType('text', nullable: true),
        'accepted_by_ip' => ['data_type' => 'inet', 'udt_name' => 'inet', 'is_nullable' => 'YES'],
        'created_at' => schemaBTimestamptz(),
        'updated_at' => schemaBTimestamptz(),
    ]);
});

it('creates quote_lines with the columns of 02 §8.6', function (): void {
    schemaBExpectColumns('quote_lines', [
        'id' => schemaBUlid(),
        'quote_id' => schemaBUlid(),
        'order_item_id' => schemaBUlid(nullable: true),
        'kind' => schemaBVarchar(16),
        'description' => schemaBVarchar(255),
        'details' => ['udt_name' => 'jsonb', 'is_nullable' => 'YES'],
        'quantity' => ['data_type' => 'numeric', 'numeric_precision' => 12, 'numeric_scale' => 3, 'is_nullable' => 'NO'],
        'unit' => schemaBVarchar(16),
        'unit_price_minor' => schemaBType('bigint'),
        'amount_minor' => schemaBType('bigint'),
        'tax_rate_id' => schemaBUlid(nullable: true),
        'is_visible_to_customer' => schemaBType('boolean'),
        'sort_order' => schemaBType('smallint'),
        'created_at' => schemaBTimestamptz(),
        'updated_at' => schemaBTimestamptz(),
    ]);
});

it('creates quote_negotiations with the columns of 02 §8.7', function (): void {
    schemaBExpectColumns('quote_negotiations', [
        'id' => schemaBUlid(),
        'quote_id' => schemaBUlid(),
        'order_id' => schemaBUlid(),
        'customer_id' => schemaBUlid(),
        'proposed_total_minor' => schemaBType('bigint', nullable: true),
        'message' => schemaBType('text'),
        'item_comments' => ['udt_name' => 'jsonb', 'is_nullable' => 'NO'],
        // 02 §8.7 says string(16), but `answered_with_revision` has 22 characters: the column takes the 32 of 02 §0.
        'status' => schemaBVarchar(32),
        'answered_by' => schemaBUlid(nullable: true),
        'answer_message' => schemaBType('text', nullable: true),
        'answered_at' => schemaBTimestamptz(),
        'resulting_quote_id' => schemaBUlid(nullable: true),
        'created_at' => schemaBTimestamptz(),
        'updated_at' => schemaBTimestamptz(),
    ]);
});

it('creates confirmation_calls with the columns of 02 §8.8', function (): void {
    schemaBExpectColumns('confirmation_calls', [
        'id' => schemaBUlid(),
        'order_id' => schemaBUlid(),
        'staff_id' => schemaBUlid(),
        'called_at' => schemaBTimestamptz(nullable: false),
        'phone_e164' => schemaBVarchar(20),
        'outcome' => schemaBVarchar(24),
        'notes' => schemaBType('text', nullable: true),
        'callback_at' => schemaBTimestamptz(),
        'created_at' => schemaBTimestamptz(),
        'updated_at' => schemaBTimestamptz(),
    ]);
});

it('creates production_updates with the columns of 02 §8.9', function (): void {
    schemaBExpectColumns('production_updates', [
        'id' => schemaBUlid(),
        'order_id' => schemaBUlid(),
        'author_id' => schemaBUlid(),
        'stage' => schemaBVarchar(32),
        'progress' => schemaBType('smallint'),
        'title' => schemaBVarchar(160),
        'body' => schemaBType('text', nullable: true),
        'visibility' => schemaBVarchar(16),
        'is_completion' => schemaBType('boolean'),
        'created_at' => schemaBTimestamptz(),
        'updated_at' => schemaBTimestamptz(),
    ]);
});

it('creates order_issues with the columns of 02 §8.10', function (): void {
    schemaBExpectColumns('order_issues', [
        'id' => schemaBUlid(),
        'order_id' => schemaBUlid(),
        'order_item_id' => schemaBUlid(nullable: true),
        'raised_by' => schemaBUlid(),
        'description' => schemaBType('text'),
        'status' => schemaBVarchar(16),
        'resolution_note' => schemaBType('text', nullable: true),
        'resolved_by' => schemaBUlid(nullable: true),
        'resolved_at' => schemaBTimestamptz(),
        'created_at' => schemaBTimestamptz(),
        'updated_at' => schemaBTimestamptz(),
    ]);
});

it('creates deliveries with the columns of 02 §8.11', function (): void {
    schemaBExpectColumns('deliveries', [
        'id' => schemaBUlid(),
        'order_id' => schemaBUlid(),
        'scheduled_for' => schemaBTimestamptz(),
        'scheduled_until' => schemaBTimestamptz(),
        'delivered_at' => schemaBTimestamptz(),
        'installed' => schemaBType('boolean'),
        'recipient_name' => schemaBVarchar(120, nullable: true),
        'notes' => schemaBType('text', nullable: true),
        'recorded_by' => schemaBUlid(nullable: true),
        'created_at' => schemaBTimestamptz(),
        'updated_at' => schemaBTimestamptz(),
    ]);
});

it('creates payments with the columns of 02 §8.12', function (): void {
    schemaBExpectColumns('payments', [
        'id' => schemaBUlid(),
        'order_id' => schemaBUlid(),
        'quote_id' => schemaBUlid(nullable: true),
        'kind' => schemaBVarchar(16),
        'amount_minor' => schemaBType('bigint'),
        'currency' => ['data_type' => 'character', 'character_maximum_length' => 3, 'is_nullable' => 'NO'],
        'method' => schemaBVarchar(24),
        'status' => schemaBVarchar(16),
        'gateway' => schemaBVarchar(24, nullable: true),
        'gateway_reference' => schemaBVarchar(120, nullable: true),
        'paid_at' => schemaBTimestamptz(),
        'recorded_by' => schemaBUlid(nullable: true),
        'notes' => schemaBType('text', nullable: true),
        'created_at' => schemaBTimestamptz(),
        'updated_at' => schemaBTimestamptz(),
    ]);
});

it('gives only the columns with a spec default a database default, and exactly that default', function (): void {
    $expected = [
        'quotes.status' => "/^'draft'::character varying$/",
        'quotes.subtotal_minor' => "/^'?0'?(::\\w+)?$/",
        'quotes.discount_minor' => "/^'?0'?(::\\w+)?$/",
        'quotes.tax_minor' => "/^'?0'?(::\\w+)?$/",
        'quotes.total_minor' => "/^'?0'?(::\\w+)?$/",
        'quotes.tax_breakdown' => "/^'\\[\\]'::jsonb$/",
        'quotes.cost_snapshot' => "/^'\\{\\}'::jsonb$/",
        'quote_lines.quantity' => "/^'?1'?(::\\w+)?$/",
        'quote_lines.unit' => "/^'item'::character varying$/",
        'quote_lines.is_visible_to_customer' => '/^true$/',
        'quote_lines.sort_order' => "/^'?0'?(::\\w+)?$/",
        'quote_negotiations.item_comments' => "/^'\\[\\]'::jsonb$/",
        'quote_negotiations.status' => "/^'open'::character varying$/",
        'production_updates.visibility' => "/^'customer'::character varying$/",
        'production_updates.is_completion' => '/^false$/',
        'order_issues.status' => "/^'open'::character varying$/",
        'deliveries.installed' => '/^false$/',
    ];

    foreach ($expected as $name => $pattern) {
        [$table, $column] = explode('.', $name);

        expect(PgSchema::column($table, $column)['column_default'])->toMatch($pattern, $name);
    }

    // Every other column has no default (column_default IS NULL).
    expect(PgSchema::defaultedColumns(SCHEMA_B_TABLES))->toBe(PgSchema::sorted(array_keys($expected)));
});

it('sizes every enum column to hold the longest value of its backed enum', function (): void {
    $columns = [
        'quotes.status' => QuoteStatus::class,
        'quote_lines.kind' => QuoteLineKind::class,
        'quote_negotiations.status' => NegotiationStatus::class,
        'confirmation_calls.outcome' => CallOutcome::class,
        'production_updates.visibility' => ProductionVisibility::class,
        'order_issues.status' => IssueStatus::class,
        'payments.kind' => PaymentKind::class,
        'payments.method' => PaymentMethod::class,
        'payments.status' => PaymentStatus::class,
        'payments.gateway' => PaymentGateway::class,
    ];

    foreach ($columns as $name => $enum) {
        [$table, $column] = explode('.', $name);
        $longest = max(array_map(static fn (BackedEnum $case): int => strlen((string) $case->value), $enum::cases()));

        expect(PgSchema::column($table, $column)['character_maximum_length'])->toBeGreaterThanOrEqual($longest, $name);
    }
});

it('indexes quotes, deliveries and production updates as listed in 02 §8', function (): void {
    expect(PgSchema::indexDefinition('quotes', 'quotes_order_id_version_unique'))->toContain('UNIQUE')->toContain('(order_id, version)')
        ->and(PgSchema::indexDefinition('quotes', 'quotes_number_unique'))->toContain('UNIQUE')->toContain('(number)')
        ->and(PgSchema::indexDefinition('deliveries', 'deliveries_order_id_unique'))->toContain('UNIQUE')->toContain('(order_id)')
        ->and(PgSchema::indexDefinition('production_updates', 'production_updates_order_id_created_at_index'))
        ->not->toContain('UNIQUE')->toContain('(order_id, created_at)');
});

it('has exactly the indexes of 02 §8.5-§8.12 plus a plain index on every foreign key', function (): void {
    // Complete lists per table: the primary key, the indexes of 02, and the plain foreign key indexes added by
    // the controller rulings (logged in 19). The whole-schema check is ForeignKeyIndexTest.
    expect(PgSchema::indexNames('quotes'))->toBe([
        'quotes_created_by_index', 'quotes_number_unique', 'quotes_one_sent_per_order', 'quotes_order_id_version_unique', 'quotes_pkey',
    ])
        ->and(PgSchema::indexNames('quote_lines'))->toBe([
            'quote_lines_order_item_id_index', 'quote_lines_pkey', 'quote_lines_quote_id_index', 'quote_lines_tax_rate_id_index',
        ])
        ->and(PgSchema::indexNames('quote_negotiations'))->toBe([
            'quote_negotiations_answered_by_index', 'quote_negotiations_customer_id_index', 'quote_negotiations_order_id_index',
            'quote_negotiations_pkey', 'quote_negotiations_quote_id_index', 'quote_negotiations_resulting_quote_id_index',
        ])
        ->and(PgSchema::indexNames('confirmation_calls'))->toBe([
            'confirmation_calls_order_id_index', 'confirmation_calls_pkey', 'confirmation_calls_staff_id_index',
        ])
        ->and(PgSchema::indexNames('production_updates'))->toBe([
            'production_updates_author_id_index', 'production_updates_order_id_created_at_index', 'production_updates_pkey',
        ])
        ->and(PgSchema::indexNames('order_issues'))->toBe([
            'order_issues_order_id_index', 'order_issues_order_item_id_index', 'order_issues_pkey', 'order_issues_raised_by_index', 'order_issues_resolved_by_index',
        ])
        ->and(PgSchema::indexNames('deliveries'))->toBe([
            'deliveries_order_id_unique', 'deliveries_pkey', 'deliveries_recorded_by_index',
        ])
        ->and(PgSchema::indexNames('payments'))->toBe([
            'payments_order_id_index', 'payments_pkey', 'payments_quote_id_index', 'payments_recorded_by_index',
        ]);
});

it('allows only one sent quote per order, through a partial unique index', function (): void {
    expect(PgSchema::indexDefinition('quotes', 'quotes_one_sent_per_order'))
        ->toContain('UNIQUE')->toContain('(order_id)')->toContain("WHERE ((status)::text = 'sent'::text)");

    $order = Order::factory()->create();
    Quote::factory()->for($order)->sent()->create(['version' => 1]);

    // Drafts, accepted and superseded quotes are not limited.
    Quote::factory()->for($order)->create(['version' => 2]);
    Quote::factory()->for($order)->accepted()->create(['version' => 3]);
    Quote::factory()->for($order)->create(['version' => 4, 'status' => 'superseded']);
    Quote::factory()->sent()->create();

    expect(Quote::query()->where('order_id', $order->id)->count())->toBe(4);

    expect(fn () => DB::transaction(fn () => Quote::factory()->for($order)->sent()->create(['version' => 5])))
        ->toThrow(QueryException::class, 'quotes_one_sent_per_order');
});

it('lets a new quote be sent once the sent one has moved on', function (): void {
    $order = Order::factory()->create();
    $first = Quote::factory()->for($order)->sent()->create(['version' => 1]);

    $first->forceFill(['status' => 'superseded'])->save();
    Quote::factory()->for($order)->sent()->create(['version' => 2]);

    expect(Quote::query()->where('order_id', $order->id)->where('status', 'sent')->count())->toBe(1);
});

it('makes (order_id, version) and number unique on quotes', function (): void {
    $order = Order::factory()->create();
    Quote::factory()->for($order)->create(['version' => 1]);

    expect(fn () => DB::transaction(fn () => Quote::factory()->for($order)->create(['version' => 1])))
        ->toThrow(QueryException::class, 'quotes_order_id_version_unique')
        ->and(fn () => DB::transaction(fn () => Quote::factory()->for($order)->create(['version' => 2, 'number' => $order->number.'-Q1'])))
        ->toThrow(QueryException::class, 'quotes_number_unique');
});

it('allows one delivery record per order', function (): void {
    $order = Order::factory()->create();
    Delivery::factory()->for($order)->create();

    expect(fn () => DB::transaction(fn () => Delivery::factory()->for($order)->create()))
        ->toThrow(QueryException::class, 'deliveries_order_id_unique');
});

it('declares the foreign key actions of 02 §8.5–§8.12 and the deferred keys of §15 group 8', function (): void {
    $tables = implode(', ', array_map(static fn (string $table): string => "'{$table}'", SCHEMA_B_TABLES));
    $actions = collect(DB::select(
        "select conrelid::regclass::text as tbl, a.attname as col, c.confdeltype as action, c.confrelid::regclass::text as ref
         from pg_constraint c
         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
         where c.contype = 'f' and (
             c.conrelid::regclass::text in ({$tables})
             or (c.conrelid = 'orders'::regclass and a.attname in ('accepted_quote_id', 'current_quote_id'))
             or (c.conrelid = 'furniture_designs'::regclass and a.attname = 'locked_by_order_id')
         )",
    ))->mapWithKeys(static fn (object $row): array => ["{$row->tbl}.{$row->col}" => "{$row->action}:{$row->ref}"]);

    // r = restrict (R), c = cascade (C), n = set null (N).
    expect($actions->all())->toEqual([
        'quotes.order_id' => 'c:orders',
        'quotes.created_by' => 'r:users',
        'quote_lines.quote_id' => 'c:quotes',
        'quote_lines.order_item_id' => 'n:order_items',
        'quote_lines.tax_rate_id' => 'n:tax_rates',
        'quote_negotiations.quote_id' => 'c:quotes',
        'quote_negotiations.order_id' => 'c:orders',
        'quote_negotiations.customer_id' => 'r:users',
        'quote_negotiations.answered_by' => 'n:users',
        'quote_negotiations.resulting_quote_id' => 'n:quotes',
        'confirmation_calls.order_id' => 'c:orders',
        'confirmation_calls.staff_id' => 'r:users',
        'production_updates.order_id' => 'c:orders',
        'production_updates.author_id' => 'r:users',
        'order_issues.order_id' => 'c:orders',
        'order_issues.order_item_id' => 'n:order_items',
        'order_issues.raised_by' => 'r:users',
        'order_issues.resolved_by' => 'n:users',
        'deliveries.order_id' => 'c:orders',
        'deliveries.recorded_by' => 'n:users',
        'payments.order_id' => 'r:orders',
        'payments.quote_id' => 'n:quotes',
        'payments.recorded_by' => 'n:users',
        'orders.accepted_quote_id' => 'n:quotes',
        'orders.current_quote_id' => 'n:quotes',
        'furniture_designs.locked_by_order_id' => 'n:orders',
    ]);
});

it('nulls the accepted and current quote of an order when the quote is deleted', function (): void {
    $order = Order::factory()->create();
    $accepted = Quote::factory()->for($order)->accepted()->create(['version' => 1]);
    $current = Quote::factory()->for($order)->sent()->create(['version' => 2]);
    $order->forceFill(['accepted_quote_id' => $accepted->id, 'current_quote_id' => $current->id])->save();

    $accepted->delete();

    expect($order->fresh()->accepted_quote_id)->toBeNull()
        ->and($order->fresh()->current_quote_id)->toBe($current->id);

    $current->delete();

    expect($order->fresh()->current_quote_id)->toBeNull();
});

it('refuses an accepted or current quote that does not exist', function (string $column): void {
    $order = Order::factory()->create();

    expect(fn () => DB::transaction(fn () => $order->forceFill([$column => '01ARZ3NDEKTSV4RRFFQ69G5FAV'])->save()))
        ->toThrow(QueryException::class, "orders_{$column}_foreign");
})->with(['accepted_quote_id', 'current_quote_id']);

it('nulls the design lock when the locking order is deleted', function (): void {
    $order = Order::factory()->create();
    $design = FurnitureDesign::factory()->for($order->project)->create();
    $design->forceFill(['locked_by_order_id' => $order->id])->save();

    $order->forceDelete();

    expect($design->fresh()->locked_by_order_id)->toBeNull()
        ->and(FurnitureDesign::query()->count())->toBe(1);
});

it('refuses a design lock by an order that does not exist', function (): void {
    $design = FurnitureDesign::factory()->create();

    expect(fn () => DB::transaction(fn () => $design->forceFill(['locked_by_order_id' => '01ARZ3NDEKTSV4RRFFQ69G5FAV'])->save()))
        ->toThrow(QueryException::class, 'furniture_designs_locked_by_order_id_foreign');
});

it('refuses to delete an order that has payments', function (): void {
    $payment = Payment::factory()->create();

    schemaBRefuses(fn () => Order::query()->findOrFail($payment->order_id)->forceDelete(), 'payments_order_id_foreign');

    expect(Order::query()->whereKey($payment->order_id)->exists())->toBeTrue()
        ->and(Payment::query()->count())->toBe(1);
});

it('refuses to delete the staff member who created a quote', function (): void {
    $staff = User::factory()->staff()->create();
    Quote::factory()->create(['created_by' => $staff->id]);

    schemaBRefuses(fn () => $staff->forceDelete(), 'quotes_created_by_foreign');
});

it('refuses to delete a customer who negotiated a quote of an order that is not theirs', function (): void {
    $customer = User::factory()->create();
    QuoteNegotiation::factory()->create(['customer_id' => $customer->id]);

    schemaBRefuses(fn () => $customer->forceDelete(), 'quote_negotiations_customer_id_foreign');
});

it('refuses to delete the staff member who made a confirmation call', function (): void {
    $staff = User::factory()->staff()->create();
    ConfirmationCall::factory()->create(['staff_id' => $staff->id]);

    schemaBRefuses(fn () => $staff->forceDelete(), 'confirmation_calls_staff_id_foreign');
});

it('refuses to delete the author of a production update', function (): void {
    $staff = User::factory()->staff()->create();
    ProductionUpdate::factory()->create(['author_id' => $staff->id]);

    schemaBRefuses(fn () => $staff->forceDelete(), 'production_updates_author_id_foreign');
});

it('refuses to delete a customer who raised an issue on an order that is not theirs', function (): void {
    $customer = User::factory()->create();
    OrderIssue::factory()->create(['raised_by' => $customer->id]);

    schemaBRefuses(fn () => $customer->forceDelete(), 'order_issues_raised_by_foreign');
});

it('cascades from an order to its quotes, negotiations, calls, updates, issues and delivery', function (): void {
    $order = Order::factory()->create();
    $quote = Quote::factory()->for($order)->sent()->create();
    QuoteLine::factory()->for($quote)->create();
    QuoteNegotiation::factory()->for($quote)->create();
    ConfirmationCall::factory()->for($order)->create();
    ProductionUpdate::factory()->for($order)->create();
    OrderIssue::factory()->for($order)->create();
    Delivery::factory()->for($order)->create();
    Quote::factory()->create();

    $order->forceDelete();

    expect(Quote::query()->count())->toBe(1)
        ->and(QuoteLine::query()->count())->toBe(0)
        ->and(QuoteNegotiation::query()->count())->toBe(0)
        ->and(ConfirmationCall::query()->count())->toBe(0)
        ->and(ProductionUpdate::query()->count())->toBe(0)
        ->and(OrderIssue::query()->count())->toBe(0)
        ->and(Delivery::query()->count())->toBe(0);
});

it('keeps a negotiation when the revised quote it led to is deleted', function (): void {
    $negotiation = QuoteNegotiation::factory()->create();
    $revised = Quote::factory()->for($negotiation->order)->create(['version' => 2]);
    $negotiation->forceFill(['resulting_quote_id' => $revised->id])->save();

    $revised->delete();

    expect($negotiation->fresh()->resulting_quote_id)->toBeNull();
});

it('nulls the optional links of quote lines and issues when the order item or tax rate goes', function (): void {
    $order = Order::factory()->create();
    $item = OrderItem::factory()->for($order)->create();
    $line = QuoteLine::factory()->for(Quote::factory()->for($order))->create(['order_item_id' => $item->id]);
    $issue = OrderIssue::factory()->for($order)->create(['order_item_id' => $item->id]);
    $taxRateId = $line->tax_rate_id;

    $item->delete();
    $line->taxRate->delete();

    expect($taxRateId)->not->toBeNull()
        ->and($line->fresh()->order_item_id)->toBeNull()
        ->and($line->fresh()->tax_rate_id)->toBeNull()
        ->and($issue->fresh()->order_item_id)->toBeNull();
});

it('nulls the staff links of answers, resolutions, deliveries and payments when the staff member goes', function (): void {
    $staff = User::factory()->staff()->create();
    $negotiation = QuoteNegotiation::factory()->create(['answered_by' => $staff->id]);
    $issue = OrderIssue::factory()->create(['resolved_by' => $staff->id]);
    $delivery = Delivery::factory()->create(['recorded_by' => $staff->id]);
    $payment = Payment::factory()->create(['recorded_by' => $staff->id]);

    $staff->forceDelete();

    expect($negotiation->fresh()->answered_by)->toBeNull()
        ->and($issue->fresh()->resolved_by)->toBeNull()
        ->and($delivery->fresh()->recorded_by)->toBeNull()
        ->and($payment->fresh()->recorded_by)->toBeNull();
});

it('nulls the quote of a payment when the quote is deleted', function (): void {
    $order = Order::factory()->create();
    $quote = Quote::factory()->for($order)->accepted()->create();
    $payment = Payment::factory()->create(['order_id' => $order->id, 'quote_id' => $quote->id]);

    $quote->delete();

    expect($payment->fresh()->quote_id)->toBeNull();
});
