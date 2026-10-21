<?php

declare(strict_types=1);

use App\Domain\Identity\Models\User;
use App\Domain\Projects\Models\Plan;
use App\Policies\PlanPolicy;
use Illuminate\Support\Facades\Gate;
use Tests\Support\PolicyActors;

it('is found by policy auto-discovery', function (): void {
    expect(Gate::getPolicyFor(Plan::class))->toBeInstanceOf(PlanPolicy::class);
});

it('follows ProjectPolicy::view for view and export', function (string $ability, string $actor, bool|int|null $expected): void {
    $plan = Plan::factory()->create();
    $user = PolicyActors::resolve($actor, $plan->project->owner);

    $response = Gate::forUser($user)->inspect($ability, $plan);

    expect([$response->allowed(), $response->status()])->toBe(PolicyActors::outcome($expected));
})->with(function (): iterable {
    foreach (['view', 'export'] as $ability) {
        foreach (PolicyActors::ownerOrStaff(PolicyActors::STAFF) as $actor => $expected) {
            yield "{$ability} / {$actor}" => [$ability, $actor, $expected];
        }
    }
});

it('lets the owner and staff with plans.edit_any create, duplicate and update', function (string $ability, string $actor, bool|int|null $expected): void {
    $plan = Plan::factory()->create();
    $user = PolicyActors::resolve($actor, $plan->project->owner);

    $response = Gate::forUser($user)->inspect($ability, $ability === 'create' ? [Plan::class, $plan->project] : $plan);

    expect([$response->allowed(), $response->status()])->toBe(PolicyActors::outcome($expected));
})->with(function (): iterable {
    foreach (['create', 'duplicate', 'update'] as $ability) {
        foreach (PolicyActors::ownerOrStaff(PolicyActors::PLAN_EDITORS) as $actor => $expected) {
            yield "{$ability} / {$actor}" => [$ability, $actor, $expected];
        }
    }
});

it('lets an estimator update a plan but not production', function (): void {
    $plan = Plan::factory()->create();

    expect(Gate::forUser(User::factory()->estimator()->create())->inspect('update', $plan)->allowed())->toBeTrue()
        ->and(Gate::forUser(User::factory()->production()->create())->inspect('update', $plan)->allowed())->toBeFalse();
});

it('keeps update authorised while the plan is locked (the save action answers 423)', function (): void {
    $plan = Plan::factory()->locked()->create();

    expect(Gate::forUser($plan->project->owner)->inspect('update', $plan)->allowed())->toBeTrue()
        ->and(Gate::forUser(User::factory()->estimator()->create())->inspect('update', $plan)->allowed())->toBeTrue();
});

it('lets only the owning customer delete a plan', function (string $actor, bool|int|null $expected): void {
    $plan = Plan::factory()->create();
    $user = PolicyActors::resolve($actor, $plan->project->owner);

    $response = Gate::forUser($user)->inspect('delete', $plan);

    expect([$response->allowed(), $response->status()])->toBe(PolicyActors::outcome($expected));
})->with(fn (): array => PolicyActors::rows([
    'customer' => true,
    'other-customer' => 404,
    'staff-owner' => 403,
    'admin' => 403,
    'estimator' => 403,
    'production' => 403,
    'support' => 403,
    'inactive-admin' => null,
]));

it('lets staff with plans.edit_any lock and unlock a plan', function (string $ability, string $actor, bool|int|null $expected): void {
    $plan = Plan::factory()->create();
    $user = PolicyActors::resolve($actor, $plan->project->owner);

    $response = Gate::forUser($user)->inspect($ability, $plan);

    expect([$response->allowed(), $response->status()])->toBe(PolicyActors::outcome($expected));
})->with(function (): iterable {
    $expectations = [
        'customer' => 403, // owns the plan but holds no permission
        'other-customer' => 404,
        'staff-owner' => true,
        'admin' => true,
        'estimator' => true,
        'production' => 403,
        'support' => 403,
        'inactive-admin' => null,
    ];

    foreach (['lock', 'unlock'] as $ability) {
        foreach ($expectations as $actor => $expected) {
            yield "{$ability} / {$actor}" => [$ability, $actor, $expected];
        }
    }
});

it('finds the owner of a plan whose project was soft-deleted', function (): void {
    $plan = Plan::factory()->create();
    $owner = $plan->project->owner;
    $plan->project->delete();

    expect(Gate::forUser($owner)->inspect('view', Plan::query()->findOrFail($plan->id))->allowed())->toBeTrue()
        ->and(Gate::forUser(User::factory()->create())->inspect('view', $plan->fresh())->status())->toBe(404);
});

it('denies inactive staff every plan ability through the policy', function (): void {
    $plan = Plan::factory()->create();
    $gate = Gate::forUser(User::factory()->owner()->inactive()->create());

    foreach (['view', 'export', 'duplicate', 'update', 'delete', 'lock', 'unlock'] as $ability) {
        expect($gate->inspect($ability, $plan)->allowed())->toBeFalse("inactive staff passed {$ability}");
    }

    expect($gate->inspect('create', [Plan::class, $plan->project])->allowed())->toBeFalse();
});
