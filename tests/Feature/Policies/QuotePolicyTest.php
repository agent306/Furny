<?php

declare(strict_types=1);

use App\Domain\Identity\Models\User;
use App\Domain\Orders\Enums\QuoteStatus;
use App\Domain\Orders\Models\Order;
use App\Domain\Orders\Models\Quote;
use App\Domain\Orders\States\Quoted;
use App\Domain\Projects\Models\Project;
use App\Policies\QuotePolicy;
use Illuminate\Support\Facades\Gate;
use Tests\Support\PolicyActors;

it('is found by policy auto-discovery', function (): void {
    expect(Gate::getPolicyFor(Quote::class))->toBeInstanceOf(QuotePolicy::class);
});

/** Dataset rows `[ability, actor, expected]`. */
function quoteAbilityRows(array $abilities, array $expectations): iterable
{
    foreach ($abilities as $ability) {
        foreach ($expectations as $actor => $expected) {
            yield "{$ability} / {$actor}" => [$ability, $actor, $expected];
        }
    }
}

describe('view and downloadPdf', function (): void {
    it('show a sent quote to the order\'s customer and to staff with orders.view', function (string $ability, string $actor, bool|int|null $expected): void {
        $quote = Quote::factory()->sent()->create();
        $user = PolicyActors::resolve($actor, $quote->order->customer);

        $response = Gate::forUser($user)->inspect($ability, $quote);

        expect([$response->allowed(), $response->status()])->toBe(PolicyActors::outcome($expected));
    })->with(fn (): iterable => quoteAbilityRows(['view', 'downloadPdf'], PolicyActors::ownerOrStaff(PolicyActors::STAFF)));

    it('keep a draft quote from its customer, as if it did not exist, but show it to staff', function (string $ability): void {
        $quote = Quote::factory()->create();
        $customer = $quote->order->customer;

        $response = Gate::forUser($customer)->inspect($ability, $quote);

        expect($quote->status)->toBe(QuoteStatus::Draft)
            ->and([$response->allowed(), $response->status()])->toBe([false, 404])
            ->and(Gate::forUser(User::factory()->production()->create())->allows($ability, $quote))->toBeTrue();
    })->with(['view', 'downloadPdf']);

    it('show the customer a quote in every status but draft', function (QuoteStatus $status): void {
        $quote = Quote::factory()->state(['status' => $status])->create();

        expect(Gate::forUser($quote->order->customer)->allows('view', $quote))->toBe($status !== QuoteStatus::Draft);
    })->with(QuoteStatus::cases());

    it('hide any quote from another customer', function (): void {
        $quote = Quote::factory()->sent()->create();

        $response = Gate::forUser(User::factory()->create())->inspect('view', $quote);

        expect([$response->allowed(), $response->status()])->toBe([false, 404]);
    });

    it('follow the owner of a soft-deleted order', function (): void {
        $quote = Quote::factory()->sent()->create();
        $customer = $quote->order->customer;
        $quote->order->delete();

        expect(Gate::forUser($customer)->allows('view', $quote->fresh()))->toBeTrue();
    });
});

it('shows costs to staff with quotes.view_costs only, not even to the production viewer or the customer', function (string $actor, bool|int|null $expected): void {
    $quote = Quote::factory()->sent()->create();
    $user = PolicyActors::resolve($actor, $quote->order->customer);

    $response = Gate::forUser($user)->inspect('viewCosts', $quote);

    expect([$response->allowed(), $response->status()])->toBe(PolicyActors::outcome($expected));
})->with(fn (): array => PolicyActors::rows(PolicyActors::staffOnly(PolicyActors::ESTIMATORS)));

describe('create', function (): void {
    it('is for staff with quotes.create on an order', function (string $actor, bool|int|null $expected): void {
        $order = Order::factory()->inState(Quoted::class)->create();
        $user = PolicyActors::resolve($actor, $order->customer);

        $response = Gate::forUser($user)->inspect('create', [Quote::class, $order]);

        expect([$response->allowed(), $response->status()])->toBe(PolicyActors::outcome($expected));
    })->with(fn (): array => PolicyActors::rows(PolicyActors::staffOnly(PolicyActors::ESTIMATORS)));
});

describe('update and delete', function (): void {
    it('are for staff with quotes.create on a draft quote', function (string $ability, string $actor, bool|int|null $expected): void {
        $quote = Quote::factory()->create();
        $user = PolicyActors::resolve($actor, $quote->order->customer);

        $response = Gate::forUser($user)->inspect($ability, $quote);

        expect([$response->allowed(), $response->status()])->toBe(PolicyActors::outcome($expected));
    })->with(fn (): iterable => quoteAbilityRows(['update', 'delete'], PolicyActors::staffOnly(PolicyActors::ESTIMATORS)));

    it('refuse a quote that is no longer a draft, with the quote_not_draft code', function (string $ability, QuoteStatus $status): void {
        $quote = Quote::factory()->state(['status' => $status])->create();
        $estimator = User::factory()->estimator()->create();

        $response = Gate::forUser($estimator)->inspect($ability, $quote);

        expect([$response->allowed(), $response->status(), $response->code()])->toBe([false, 403, 'quote_not_draft'])
            ->and($response->message())->toBe(trans_icu('quotes.errors.not_draft'))
            ->and($response->message())->not->toBe('quotes.errors.not_draft');
    })->with(function (): iterable {
        foreach (['update', 'delete'] as $ability) {
            foreach ([QuoteStatus::Sent, QuoteStatus::Accepted, QuoteStatus::Superseded] as $status) {
                yield "{$ability} / {$status->value}" => [$ability, $status];
            }
        }
    });

    it('answer 403 without the code to staff lacking quotes.create on a sent quote', function (): void {
        $quote = Quote::factory()->sent()->create();

        $response = Gate::forUser(User::factory()->support()->create())->inspect('update', $quote);

        expect([$response->allowed(), $response->status(), $response->code()])->toBe([false, 403, null]);
    });
});

it('lets staff with quotes.send send a quote', function (string $actor, bool|int|null $expected): void {
    $quote = Quote::factory()->create();
    $user = PolicyActors::resolve($actor, $quote->order->customer);

    $response = Gate::forUser($user)->inspect('send', $quote);

    expect([$response->allowed(), $response->status()])->toBe(PolicyActors::outcome($expected));
})->with(fn (): array => PolicyActors::rows(PolicyActors::staffOnly(PolicyActors::ESTIMATORS)));

it('leaves accepting, negotiating and declining to the order\'s customer, whatever the quote or order state', function (string $ability, string $actor, bool|int|null $expected): void {
    $quote = Quote::factory()->sent()->create();
    $user = PolicyActors::resolve($actor, $quote->order->customer);

    $response = Gate::forUser($user)->inspect($ability, $quote);

    expect([$response->allowed(), $response->status()])->toBe(PolicyActors::outcome($expected));
})->with(fn (): iterable => quoteAbilityRows(['accept', 'negotiate', 'decline'], PolicyActors::ownerOrStaff([])));

it('gives a customer holding a staff role no staff ability on any quote', function (): void {
    $customer = User::factory()->create();
    $customer->assignRole('owner');
    $quote = Quote::factory()->sent()->create();
    $own = Quote::factory()->sent()->for(Order::factory()->for(Project::factory()->forCustomer($customer), 'project'), 'order')->create();

    foreach (['viewCosts', 'send', 'update', 'delete'] as $ability) {
        expect(Gate::forUser($customer)->inspect($ability, $quote)->status())->toBe(404, $ability)
            ->and(Gate::forUser($customer)->inspect($ability, $own)->status())->toBe(403, $ability);
    }
});
