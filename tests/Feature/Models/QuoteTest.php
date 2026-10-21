<?php

declare(strict_types=1);

use App\Domain\Identity\Models\User;
use App\Domain\Orders\Enums\NegotiationStatus;
use App\Domain\Orders\Enums\QuoteLineKind;
use App\Domain\Orders\Enums\QuoteStatus;
use App\Domain\Orders\Models\Order;
use App\Domain\Orders\Models\OrderItem;
use App\Domain\Orders\Models\Quote;
use App\Domain\Orders\Models\QuoteLine;
use App\Domain\Orders\Models\QuoteNegotiation;
use App\Domain\Orders\States\InReview;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * 02 §8.5–§8.7, §10, §11, §12 and master §6.3 (quote number).
 */
it('has the backed enum values of 02 §8.5–§8.7', function (): void {
    $values = static fn (string $enum): array => array_map(static fn (BackedEnum $case): string|int => $case->value, $enum::cases());

    expect($values(QuoteStatus::class))->toBe(['draft', 'sent', 'accepted', 'declined', 'superseded', 'expired', 'withdrawn'])
        ->and($values(QuoteLineKind::class))->toBe(['furniture', 'materials', 'hardware', 'labour', 'finishing', 'installation', 'delivery', 'discount', 'custom'])
        ->and($values(NegotiationStatus::class))->toBe(['open', 'answered_with_revision', 'answered_keep_price', 'closed']);
});

it('numbers a quote {order number}-Q{version}', function (): void {
    $order = Order::factory()->create(['number' => 'ORD-2026-00042']);

    $quote = Quote::factory()->for($order)->create(['version' => 2]);

    expect($quote->number)->toBe($order->number.'-Q2')
        ->and($quote->fresh()->number)->toBe('ORD-2026-00042-Q2');
});

it('numbers the next quote of an order one higher and the first of another order Q1', function (): void {
    $order = Order::factory()->create(['number' => 'ORD-2026-00042']);

    $first = Quote::factory()->for($order)->create();
    $second = Quote::factory()->for($order)->create();
    $elsewhere = Quote::factory()->create();

    expect([$first->version, $second->version, $elsewhere->version])->toBe([1, 2, 1])
        ->and([$first->number, $second->number])->toBe(['ORD-2026-00042-Q1', 'ORD-2026-00042-Q2'])
        ->and($elsewhere->number)->toBe($elsewhere->order->number.'-Q1');
});

it('numbers a quote of a soft-deleted order and keeps an explicit number', function (): void {
    $order = Order::factory()->create(['number' => 'ORD-2026-00043']);
    $order->delete();

    $numbered = Quote::factory()->for($order)->create(['version' => 3]);
    $explicit = Quote::factory()->for($order)->create(['version' => 4, 'number' => 'ORD-2026-00043-QX']);

    expect($numbered->number)->toBe('ORD-2026-00043-Q3')
        ->and($explicit->number)->toBe('ORD-2026-00043-QX');
});

it('starts a quote as a draft with the defaults of 02 §8.5', function (): void {
    $quote = Quote::factory()->create()->fresh();

    expect($quote->status)->toBe(QuoteStatus::Draft)
        ->and($quote->order)->toBeInstanceOf(Order::class)
        ->and($quote->order->state)->toBeInstanceOf(InReview::class)
        ->and($quote->createdBy->isStaff())->toBeTrue()
        ->and($quote->currency)->toBe('INR')
        ->and($quote->prices_include_tax)->toBeFalse()
        ->and([$quote->subtotal_minor, $quote->discount_minor, $quote->tax_minor, $quote->total_minor])->toBe([0, 0, 0, 0])
        ->and($quote->tax_breakdown)->toBe([])
        ->and($quote->cost_snapshot)->toBe([])
        ->and($quote->valid_until)->toBeInstanceOf(CarbonImmutable::class)
        ->and($quote->valid_until->isFuture())->toBeTrue()
        ->and($quote->lead_time_days)->toBeNull()
        ->and($quote->terms)->not->toBeEmpty()
        ->and($quote->catalog_version)->toBeInt()
        ->and($quote->engine_version)->not->toBeEmpty()
        ->and([$quote->sent_at, $quote->accepted_at, $quote->declined_at, $quote->expired_at, $quote->superseded_at, $quote->withdrawn_at])->each->toBeNull()
        ->and([$quote->decline_reason, $quote->accepted_by_ip, $quote->notes_to_customer, $quote->internal_notes])->each->toBeNull()
        ->and($quote->created_at)->toBeInstanceOf(CarbonImmutable::class);
});

it('builds the sent and accepted states with their stamps', function (): void {
    $sent = Quote::factory()->sent()->create()->fresh();
    $accepted = Quote::factory()->accepted()->create()->fresh();

    expect($sent->status)->toBe(QuoteStatus::Sent)
        ->and($sent->sent_at)->toBeInstanceOf(CarbonImmutable::class)
        ->and($sent->accepted_at)->toBeNull()
        ->and($sent->accepted_by_ip)->toBeNull()
        ->and($accepted->status)->toBe(QuoteStatus::Accepted)
        ->and($accepted->sent_at)->toBeInstanceOf(CarbonImmutable::class)
        ->and($accepted->accepted_at)->toBeInstanceOf(CarbonImmutable::class)
        ->and($accepted->accepted_at->greaterThan($accepted->sent_at))->toBeTrue()
        ->and($accepted->accepted_by_ip)->toBeString()->toMatch('/^\d{1,3}(\.\d{1,3}){3}$/');
});

it('round-trips the quote casts', function (): void {
    $breakdown = [['taxRateId' => '01ARZ3NDEKTSV4RRFFQ69G5FAV', 'name' => 'GST 18%', 'rateBps' => 1800, 'taxableMinor' => 5_000_000, 'taxMinor' => 900_000]];
    $costs = ['items' => [['orderItemId' => '01ARZ3NDEKTSV4RRFFQ69G5FAV', 'materialMinor' => 2_000_000, 'marginBps' => 2500]], 'totals' => ['materialMinor' => 2_000_000]];

    $quote = Quote::factory()->accepted()->create([
        'subtotal_minor' => 5_000_000,
        'discount_minor' => 250_000,
        'tax_minor' => 900_000,
        'total_minor' => 5_650_000,
        'prices_include_tax' => true,
        'lead_time_days' => 30,
        'tax_breakdown' => $breakdown,
        'cost_snapshot' => $costs,
        'valid_until' => '2026-12-31',
        'accepted_by_ip' => '203.0.113.7',
    ])->fresh();

    expect($quote->subtotal_minor)->toBe(5_000_000)
        ->and($quote->discount_minor)->toBe(250_000)
        ->and($quote->tax_minor)->toBe(900_000)
        ->and($quote->total_minor)->toBe(5_650_000)
        ->and($quote->prices_include_tax)->toBeTrue()
        ->and($quote->lead_time_days)->toBe(30)
        ->and($quote->version)->toBeInt()
        ->and($quote->tax_breakdown)->toEqual($breakdown)
        ->and($quote->cost_snapshot)->toEqual($costs)
        ->and($quote->valid_until)->toBeInstanceOf(CarbonImmutable::class)
        ->and($quote->valid_until->toDateString())->toBe('2026-12-31')
        ->and($quote->accepted_by_ip)->toBe('203.0.113.7')
        ->and($quote->accepted_at)->toBeInstanceOf(CarbonImmutable::class);
});

it('stores an empty cost snapshot as {} and an empty tax breakdown as []', function (): void {
    $quote = Quote::factory()->create(['cost_snapshot' => ['a' => 1]]);

    $quote->cost_snapshot = [];
    $quote->tax_breakdown = [];
    $quote->save();

    $row = DB::table('quotes')->where('id', $quote->id)->first();

    expect($row->cost_snapshot)->toBe('{}')
        ->and($row->tax_breakdown)->toBe('[]')
        ->and($quote->fresh()->cost_snapshot)->toBe([]);
});

it('does not mass-assign derived, lifecycle, owner or snapshot columns of a quote', function (): void {
    $quote = new Quote;
    $quote->fill([
        'valid_until' => '2026-12-31',
        'lead_time_days' => 21,
        'notes_to_customer' => 'Thank you',
        'terms' => 'Net 7',
        'internal_notes' => 'Tight margin',
        'order_id' => 'x',
        'version' => 9,
        'number' => 'ORD-2026-00001-Q9',
        'status' => 'accepted',
        'currency' => 'USD',
        'prices_include_tax' => true,
        'subtotal_minor' => 1,
        'discount_minor' => 1,
        'tax_minor' => 1,
        'total_minor' => 1,
        'tax_breakdown' => [],
        'cost_snapshot' => [],
        'catalog_version' => 9,
        'engine_version' => '9.9.9',
        'created_by' => 'x',
        'sent_at' => now(),
        'accepted_at' => now(),
        'decline_reason' => 'x',
        'accepted_by_ip' => '203.0.113.7',
    ]);

    expect(array_keys($quote->getAttributes()))->toBe(['valid_until', 'lead_time_days', 'notes_to_customer', 'terms', 'internal_notes']);
});

it('builds the relations of 02 §11 for quotes', function (): void {
    $quote = Quote::factory()->sent()->create();
    $order = $quote->order;
    $line = QuoteLine::factory()->for($quote)->create(['sort_order' => 2]);
    $first = QuoteLine::factory()->for($quote)->create(['sort_order' => 1]);
    $negotiation = QuoteNegotiation::factory()->for($quote)->create();
    $order->forceFill(['accepted_quote_id' => $quote->id, 'current_quote_id' => $quote->id])->save();

    expect($quote->lines->pluck('id')->all())->toBe([$first->id, $line->id])
        ->and($quote->negotiations->pluck('id')->all())->toBe([$negotiation->id])
        ->and($order->fresh()->quotes->pluck('id')->all())->toBe([$quote->id])
        ->and($order->fresh()->acceptedQuote->is($quote))->toBeTrue()
        ->and($order->fresh()->currentQuote->is($quote))->toBeTrue()
        ->and($order->fresh()->negotiations->pluck('id')->all())->toBe([$negotiation->id])
        ->and(Order::factory()->create()->acceptedQuote)->toBeNull();
});

it('orders an order\'s quotes by version', function (): void {
    $order = Order::factory()->create();
    $second = Quote::factory()->for($order)->create(['version' => 2]);
    $first = Quote::factory()->for($order)->create(['version' => 1]);

    expect($order->quotes->pluck('id')->all())->toBe([$first->id, $second->id]);
});

it('declares the pdf media collection of 02 §10', function (): void {
    $quote = new Quote;
    $quote->registerMediaCollections();
    $pdf = collect($quote->mediaCollections)->firstWhere('name', 'pdf');

    expect($pdf->diskName)->toBe('s3')
        ->and($pdf->singleFile)->toBeTrue()
        ->and($pdf->acceptsMimeTypes)->toBe(['application/pdf']);
});

it('attaches a pdf to the private disk and replaces it', function (): void {
    $quote = Quote::factory()->create();

    $quote->addMediaFromString("%PDF-1.4\n%%EOF")->usingFileName('quote.pdf')->toMediaCollection('pdf');
    $quote->addMediaFromString("%PDF-1.4\n%%EOF")->usingFileName('quote-2.pdf')->toMediaCollection('pdf');

    expect($quote->getMedia('pdf'))->toHaveCount(1)
        ->and($quote->getFirstMedia('pdf')->disk)->toBe('s3')
        ->and($quote->getFirstMedia('pdf')->file_name)->toBe('quote-2.pdf');
});

it('creates a quote line with the defaults of 02 §8.6 and a tax rate', function (): void {
    $line = QuoteLine::factory()->create()->fresh();

    expect($line->kind)->toBe(QuoteLineKind::Furniture)
        ->and($line->quantity)->toBe('1.000')
        ->and($line->unit)->toBe('item')
        ->and($line->unit_price_minor)->toBeInt()->toBeGreaterThan(0)
        ->and($line->amount_minor)->toBe($line->unit_price_minor)
        ->and($line->tax_rate_id)->not->toBeNull()
        ->and($line->taxRate->rate_bps)->toBe(1800)
        ->and($line->is_visible_to_customer)->toBeTrue()
        ->and($line->sort_order)->toBe(0)
        ->and($line->details)->toBeNull()
        ->and($line->order_item_id)->toBeNull()
        ->and($line->quote)->toBeInstanceOf(Quote::class);
});

it('derives the line amount from quantity and unit price', function (): void {
    $line = QuoteLine::factory()->create(['quantity' => '2.500', 'unit_price_minor' => 1_000_001, 'unit' => 'm'])->fresh();

    expect($line->quantity)->toBe('2.500')
        ->and($line->unit)->toBe('m')
        ->and($line->amount_minor)->toBe(2_500_003);
});

it('builds a discount line with a non-positive price and no tax rate', function (): void {
    $line = QuoteLine::factory()->discount()->create()->fresh();

    expect($line->kind)->toBe(QuoteLineKind::Discount)
        ->and($line->unit_price_minor)->toBeLessThanOrEqual(0)
        ->and($line->amount_minor)->toBeLessThanOrEqual(0)
        ->and($line->amount_minor)->toBe($line->unit_price_minor)
        ->and($line->tax_rate_id)->toBeNull()
        ->and($line->taxRate)->toBeNull();
});

it('round-trips the line breakdown and links a line to an order item of the same order', function (): void {
    $details = ['dimensionsMm' => ['width' => 1800, 'height' => 2100, 'depth' => 600], 'materials' => ['Plywood 18 mm']];
    $order = Order::factory()->create();
    $item = OrderItem::factory()->for($order)->create();
    $line = QuoteLine::factory()->for(Quote::factory()->for($order))->create(['order_item_id' => $item->id, 'details' => $details])->fresh();

    expect($line->details)->toEqual($details)
        ->and($line->orderItem->is($item))->toBeTrue();
});

it('does not mass-assign the quote, the order item or the derived amount of a line', function (): void {
    $line = new QuoteLine;
    $line->fill([
        'kind' => 'labour',
        'description' => 'Carpentry',
        'details' => ['hours' => 12],
        'quantity' => '12.000',
        'unit' => 'h',
        'unit_price_minor' => 50_000,
        'tax_rate_id' => 'x',
        'is_visible_to_customer' => false,
        'sort_order' => 3,
        'quote_id' => 'x',
        'order_item_id' => 'x',
        'amount_minor' => 1,
    ]);

    expect(array_keys($line->getAttributes()))->toBe(['kind', 'description', 'details', 'quantity', 'unit', 'unit_price_minor', 'tax_rate_id', 'is_visible_to_customer', 'sort_order']);
});

it('opens a negotiation on a sent quote from the quote customer', function (): void {
    $negotiation = QuoteNegotiation::factory()->create()->fresh();

    expect($negotiation->status)->toBe(NegotiationStatus::Open)
        ->and($negotiation->quote->status)->toBe(QuoteStatus::Sent)
        ->and($negotiation->order_id)->toBe($negotiation->quote->order_id)
        ->and($negotiation->customer_id)->toBe($negotiation->order->customer_id)
        ->and($negotiation->customer)->toBeInstanceOf(User::class)
        ->and($negotiation->message)->not->toBeEmpty()
        ->and($negotiation->proposed_total_minor)->toBeNull()
        ->and($negotiation->item_comments)->toBe([])
        ->and($negotiation->answered_by)->toBeNull()
        ->and($negotiation->answered_at)->toBeNull()
        ->and($negotiation->resulting_quote_id)->toBeNull()
        ->and($negotiation->resultingQuote)->toBeNull();
});

it('round-trips the counter price and the per item comments of a negotiation', function (): void {
    $item = OrderItem::factory()->create();
    $comments = [['order_item_id' => $item->id, 'comment' => 'Can the doors be laminate?']];
    $staff = User::factory()->staff()->create();
    $revised = Quote::factory()->create();

    $negotiation = QuoteNegotiation::factory()->create([
        'proposed_total_minor' => 4_200_000,
        'item_comments' => $comments,
        'status' => NegotiationStatus::AnsweredWithRevision,
        'answered_by' => $staff->id,
        'answer_message' => 'Revised quote attached.',
        'answered_at' => now(),
        'resulting_quote_id' => $revised->id,
    ])->fresh();

    expect($negotiation->proposed_total_minor)->toBe(4_200_000)
        ->and($negotiation->item_comments)->toEqual($comments)
        ->and($negotiation->status)->toBe(NegotiationStatus::AnsweredWithRevision)
        ->and($negotiation->answeredBy->is($staff))->toBeTrue()
        ->and($negotiation->answered_at)->toBeInstanceOf(CarbonImmutable::class)
        ->and($negotiation->resultingQuote->is($revised))->toBeTrue();
});

it('lets the customer write only the price, message and comments of a negotiation', function (): void {
    $negotiation = new QuoteNegotiation;
    $negotiation->fill([
        'proposed_total_minor' => 100,
        'message' => 'Please reduce',
        'item_comments' => [],
        'quote_id' => 'x',
        'order_id' => 'x',
        'customer_id' => 'x',
        'status' => 'closed',
        'answered_by' => 'x',
        'answer_message' => 'x',
        'answered_at' => now(),
        'resulting_quote_id' => 'x',
    ]);

    expect(array_keys($negotiation->getAttributes()))->toBe(['proposed_total_minor', 'message', 'item_comments']);
});

it('registers the morph aliases of the quote models', function (): void {
    expect((new Quote)->getMorphClass())->toBe('quote')
        ->and((new QuoteLine)->getMorphClass())->toBe('quote_line')
        ->and((new QuoteNegotiation)->getMorphClass())->toBe('quote_negotiation');
});
