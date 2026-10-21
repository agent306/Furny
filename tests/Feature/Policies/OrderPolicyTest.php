<?php

declare(strict_types=1);

use App\Domain\Identity\Enums\PermissionName;
use App\Domain\Identity\Enums\UserType;
use App\Domain\Identity\Models\User;
use App\Domain\Orders\Models\Order;
use App\Domain\Orders\States\Cancelled;
use App\Domain\Orders\States\Draft;
use App\Domain\Orders\States\InProduction;
use App\Domain\Orders\States\Submitted;
use App\Domain\Projects\Models\Project;
use App\Policies\ChangeProposalPolicy;
use App\Policies\MessagePolicy;
use App\Policies\OrderPolicy;
use App\Policies\QuotePolicy;
use Illuminate\Support\Facades\Gate;
use Tests\Support\PolicyActors;

/** Dataset rows `[ability, actor, expected]` for every ability of a group, over the expectations of its permission. */
function orderAbilityRows(array $abilities, array $expectations): iterable
{
    foreach ($abilities as $ability) {
        foreach ($expectations as $actor => $expected) {
            yield "{$ability} / {$actor}" => [$ability, $actor, $expected];
        }
    }
}

it('is found by policy auto-discovery', function (): void {
    expect(Gate::getPolicyFor(Order::class))->toBeInstanceOf(OrderPolicy::class);
});

it('lists orders only for staff with orders.view; customers use their own scoped list', function (string $actor, bool|int|null $expected): void {
    $user = PolicyActors::resolve($actor, User::factory()->create());

    $response = Gate::forUser($user)->inspect('viewAny', Order::class);

    expect([$response->allowed(), $response->status()])->toBe(PolicyActors::outcome($expected));
})->with(fn (): array => PolicyActors::rows([
    'customer' => 403,
    'staff-owner' => true,
    'admin' => true,
    'estimator' => true,
    'production' => true,
    'support' => true,
    'inactive-admin' => null,
]));

it('lets the customer and staff with orders.view see an order', function (string $actor, bool|int|null $expected): void {
    $order = Order::factory()->inState(Submitted::class)->create();
    $user = PolicyActors::resolve($actor, $order->customer);

    $response = Gate::forUser($user)->inspect('view', $order);

    expect([$response->allowed(), $response->status()])->toBe(PolicyActors::outcome($expected));
})->with(fn (): array => PolicyActors::rows(PolicyActors::ownerOrStaff(PolicyActors::STAFF)));

it('hides another customer\'s order with 404 whatever its state', function (string $stateClass): void {
    $order = Order::factory()->inState($stateClass)->create();
    $stranger = User::factory()->create();

    foreach (['view', 'submit', 'cancelDraft', 'acceptQuote', 'review', 'cancelLate', 'viewInternal', 'close'] as $ability) {
        $response = Gate::forUser($stranger)->inspect($ability, $order);

        expect([$response->allowed(), $response->status()])->toBe([false, 404], $ability);
    }
})->with([
    'draft' => Draft::class,
    'submitted' => Submitted::class,
    'in production' => InProduction::class,
    'cancelled' => Cancelled::class,
]);

it('keeps internal notes, calls and cost data for staff with orders.view', function (string $actor, bool|int|null $expected): void {
    $order = Order::factory()->inState(Submitted::class)->create();
    $user = PolicyActors::resolve($actor, $order->customer);

    $response = Gate::forUser($user)->inspect('viewInternal', $order);

    expect([$response->allowed(), $response->status()])->toBe(PolicyActors::outcome($expected));
})->with(fn (): array => PolicyActors::rows(PolicyActors::staffOnly(PolicyActors::STAFF)));

describe('owner-only abilities', function (): void {
    it('are the owning customer\'s and nobody else\'s', function (string $ability, string $actor, bool|int|null $expected): void {
        $order = Order::factory()->inState(Submitted::class)->create();
        $user = PolicyActors::resolve($actor, $order->customer);

        $response = Gate::forUser($user)->inspect($ability, $order);

        expect([$response->allowed(), $response->status()])->toBe(PolicyActors::outcome($expected));
    })->with(fn (): iterable => orderAbilityRows(
        ['updateDraftItems', 'deleteDraft', 'submit', 'cancelDraft', 'reopen', 'acceptQuote', 'negotiate', 'declineQuote', 'approveCompletion', 'reportIssue', 'withdraw', 'requestCallback'],
        PolicyActors::ownerOrStaff([]),
    ));

    it('does not look at the order\'s state, which the state machine owns', function (string $stateClass): void {
        $order = Order::factory()->inState($stateClass)->create();

        foreach (['submit', 'acceptQuote', 'withdraw', 'approveCompletion'] as $ability) {
            expect(Gate::forUser($order->customer)->allows($ability, $order))->toBeTrue($ability);
        }
    })->with([
        'draft' => Draft::class,
        'in production' => InProduction::class,
        'cancelled' => Cancelled::class,
    ]);

    it('lets a customer create an order for their own project only', function (string $actor, bool|int|null $expected): void {
        $project = Project::factory()->create();
        $user = PolicyActors::resolve($actor, $project->owner);

        $response = Gate::forUser($user)->inspect('create', [Order::class, $project]);

        expect([$response->allowed(), $response->status()])->toBe(PolicyActors::outcome($expected));
    })->with(fn (): array => PolicyActors::rows(PolicyActors::ownerOrStaff([])));
});

it('denies create without a project instead of throwing', function (string $actor): void {
    $user = PolicyActors::resolve($actor, User::factory()->create());

    $response = Gate::forUser($user)->inspect('create', Order::class);

    expect($response->allowed())->toBeFalse()
        ->and($user->can('create', Order::class))->toBeFalse();
})->with(['customer', 'staff-owner', 'support']);

it('never lets a user whose type is staff own an order, whatever the order\'s customer_id says', function (): void {
    $order = Order::factory()->inState(Submitted::class)->create();
    $formerCustomer = $order->customer;
    $formerCustomer->forceFill(['type' => UserType::Staff])->save();
    $gate = Gate::forUser($formerCustomer->fresh());

    foreach (['view', 'viewInternal', 'acceptQuote', 'submit', 'withdraw'] as $ability) {
        expect($gate->inspect($ability, $order)->allowed())->toBeFalse($ability);
    }
});

describe('staff abilities', function (): void {
    it('follow the permission of the matrix and are 403 for the order\'s own customer', function (string $ability, string $actor, bool|int|null $expected): void {
        $order = Order::factory()->inState(Submitted::class)->create();
        $user = PolicyActors::resolve($actor, $order->customer);

        $response = Gate::forUser($user)->inspect($ability, $order);

        expect([$response->allowed(), $response->status()])->toBe(PolicyActors::outcome($expected));
    })->with(function (): iterable {
        $estimating = PolicyActors::staffOnly(PolicyActors::ESTIMATORS);

        yield from orderAbilityRows(['review', 'editItems', 'assign', 'proposeChanges', 'withdrawProposal', 'createQuote', 'sendQuote', 'answerNegotiation', 'cancel'], $estimating);
        yield from orderAbilityRows(['logCall', 'confirm', 'reopenAfterCall'], PolicyActors::staffOnly([...PolicyActors::ESTIMATORS, 'support']));
        yield from orderAbilityRows(['hold', 'resume'], PolicyActors::staffOnly([...PolicyActors::ESTIMATORS, 'production']));
        yield from orderAbilityRows(['manageProduction'], PolicyActors::staffOnly([...PolicyActors::MANAGERS, 'production']));
        yield from orderAbilityRows(['close', 'raiseIssueOnBehalf'], PolicyActors::staffOnly(PolicyActors::MANAGERS));
    });

    it('lets production manage production and hold but not cancel, and support confirm but not quote', function (): void {
        $order = Order::factory()->inState(Submitted::class)->create();
        $production = Gate::forUser(User::factory()->production()->create());
        $support = Gate::forUser(User::factory()->support()->create());

        expect($production->allows('manageProduction', $order))->toBeTrue()
            ->and($production->allows('hold', $order))->toBeTrue()
            ->and($production->allows('cancel', $order))->toBeFalse()
            ->and($support->allows('logCall', $order))->toBeTrue()
            ->and($support->allows('confirm', $order))->toBeTrue()
            ->and($support->allows('createQuote', $order))->toBeFalse();
    });
});

describe('cancelLate', function (): void {
    it('is for the owner role only, through the orders.cancel_late gate', function (string $actor, bool|int|null $expected): void {
        $order = Order::factory()->inState(InProduction::class)->create();
        $user = PolicyActors::resolve($actor, $order->customer);

        $response = Gate::forUser($user)->inspect('cancelLate', $order);

        expect([$response->allowed(), $response->status()])->toBe(PolicyActors::outcome($expected));
    })->with(fn (): array => PolicyActors::rows(PolicyActors::staffOnly(['staff-owner'])));
});

it('gives a customer holding a staff role no staff ability and no ability on other customers\' orders', function (): void {
    $customer = User::factory()->create();
    $customer->assignRole('owner');
    $strangers = Order::factory()->inState(InProduction::class)->create();
    $own = Order::factory()->inState(InProduction::class)->for(Project::factory()->forCustomer($customer), 'project')->create();
    $gate = Gate::forUser($customer);

    foreach (['view', 'viewInternal', 'review', 'cancel', 'cancelLate', 'close', 'manageProduction', 'createQuote', 'sendQuote'] as $ability) {
        $response = $gate->inspect($ability, $strangers);

        expect([$response->allowed(), $response->status()])->toBe([false, 404], $ability);
    }

    foreach (['viewInternal', 'review', 'cancel', 'cancelLate', 'close', 'manageProduction', 'createQuote', 'sendQuote'] as $ability) {
        $response = $gate->inspect($ability, $own);

        expect([$response->allowed(), $response->status()])->toBe([false, 403], $ability);
    }

    expect($gate->allows('viewAny', Order::class))->toBeFalse();
});

it('names no ability of the order policies after a permission, because spatie\'s before-callback would bypass the policy', function (string $policy): void {
    $permissions = array_column(PermissionName::cases(), 'value');
    $abilities = array_map(static fn (ReflectionMethod $method): string => $method->getName(), (new ReflectionClass($policy))->getMethods(ReflectionMethod::IS_PUBLIC));

    expect(array_intersect($abilities, $permissions))->toBe([]);
})->with([OrderPolicy::class, QuotePolicy::class, ChangeProposalPolicy::class, MessagePolicy::class]);
