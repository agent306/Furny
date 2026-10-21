<?php

declare(strict_types=1);

use App\Domain\Identity\Models\User;
use App\Domain\Orders\Enums\ChangeProposalStatus;
use App\Domain\Orders\Models\ChangeProposal;
use App\Domain\Orders\Models\Order;
use App\Domain\Orders\States\InReview;
use App\Policies\ChangeProposalPolicy;
use Illuminate\Support\Facades\Gate;
use Tests\Support\PolicyActors;

it('is found by policy auto-discovery', function (): void {
    expect(Gate::getPolicyFor(ChangeProposal::class))->toBeInstanceOf(ChangeProposalPolicy::class);
});

describe('view', function (): void {
    it('shows a sent proposal to the order\'s customer and to staff with orders.view', function (string $actor, bool|int|null $expected): void {
        $proposal = ChangeProposal::factory()->sent()->create();
        $user = PolicyActors::resolve($actor, $proposal->order->customer);

        $response = Gate::forUser($user)->inspect('view', $proposal);

        expect([$response->allowed(), $response->status()])->toBe(PolicyActors::outcome($expected));
    })->with(fn (): array => PolicyActors::rows(PolicyActors::ownerOrStaff(PolicyActors::STAFF)));

    it('keeps a draft proposal from its customer, as if it did not exist, but shows it to staff', function (): void {
        $proposal = ChangeProposal::factory()->create();

        $response = Gate::forUser($proposal->order->customer)->inspect('view', $proposal);

        expect($proposal->status)->toBe(ChangeProposalStatus::Draft)
            ->and([$response->allowed(), $response->status()])->toBe([false, 404])
            ->and(Gate::forUser(User::factory()->support()->create())->allows('view', $proposal))->toBeTrue();
    });

    it('shows the customer a proposal in every status but draft', function (ChangeProposalStatus $status): void {
        $proposal = ChangeProposal::factory()->state(['status' => $status])->create();

        expect(Gate::forUser($proposal->order->customer)->allows('view', $proposal))->toBe($status !== ChangeProposalStatus::Draft);
    })->with(ChangeProposalStatus::cases());

    it('hides a proposal from another customer', function (): void {
        $proposal = ChangeProposal::factory()->sent()->create();

        $response = Gate::forUser(User::factory()->create())->inspect('view', $proposal);

        expect([$response->allowed(), $response->status()])->toBe([false, 404]);
    });
});

describe('staff abilities', function (): void {
    it('need orders.propose_changes', function (string $ability, string $actor, bool|int|null $expected): void {
        $proposal = ChangeProposal::factory()->create();
        $user = PolicyActors::resolve($actor, $proposal->order->customer);

        $response = Gate::forUser($user)->inspect($ability, $proposal);

        expect([$response->allowed(), $response->status()])->toBe(PolicyActors::outcome($expected));
    })->with(function (): iterable {
        foreach (['update', 'send', 'withdraw', 'addItem', 'removeItem', 'updateItemDraft'] as $ability) {
            foreach (PolicyActors::staffOnly(PolicyActors::ESTIMATORS) as $actor => $expected) {
                yield "{$ability} / {$actor}" => [$ability, $actor, $expected];
            }
        }
    });

    it('need orders.propose_changes to start a proposal on an order', function (string $actor, bool|int|null $expected): void {
        $order = Order::factory()->inState(InReview::class)->create();
        $user = PolicyActors::resolve($actor, $order->customer);

        $response = Gate::forUser($user)->inspect('create', [ChangeProposal::class, $order]);

        expect([$response->allowed(), $response->status()])->toBe(PolicyActors::outcome($expected));
    })->with(fn (): array => PolicyActors::rows(PolicyActors::staffOnly(PolicyActors::ESTIMATORS)));
});

it('leaves the decision to the order\'s customer, whatever the proposal status', function (string $actor, bool|int|null $expected): void {
    $proposal = ChangeProposal::factory()->sent()->create();
    $user = PolicyActors::resolve($actor, $proposal->order->customer);

    $response = Gate::forUser($user)->inspect('decide', $proposal);

    expect([$response->allowed(), $response->status()])->toBe(PolicyActors::outcome($expected));
})->with(fn (): array => PolicyActors::rows(PolicyActors::ownerOrStaff([])));

it('gives a customer holding a staff role no staff ability on any proposal', function (): void {
    $customer = User::factory()->create();
    $customer->assignRole('owner');
    $proposal = ChangeProposal::factory()->sent()->create();

    foreach (['update', 'send', 'withdraw', 'addItem', 'decide'] as $ability) {
        expect(Gate::forUser($customer)->inspect($ability, $proposal)->status())->toBe(404, $ability);
    }
});
