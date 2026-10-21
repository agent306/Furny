<?php

declare(strict_types=1);

use App\Domain\Furniture\Models\FurnitureDesign;
use App\Domain\Identity\Models\User;
use App\Domain\Orders\Models\Order;
use App\Domain\Orders\Models\OrderItem;
use App\Policies\FurnitureDesignPolicy;
use Illuminate\Support\Facades\Gate;
use Tests\Support\PolicyActors;

/** Locks the design for an order, as the submit action does (09 T2). */
$lock = static function (FurnitureDesign $design): FurnitureDesign {
    $order = Order::factory()->state(['project_id' => $design->project_id])->create();

    $design->forceFill(['locked_by_order_id' => $order->id])->save();

    return $design;
};

it('is found by policy auto-discovery', function (): void {
    expect(Gate::getPolicyFor(FurnitureDesign::class))->toBeInstanceOf(FurnitureDesignPolicy::class);
});

it('lets the owner and staff with customers.view or orders.view see a design', function (string $actor, bool|int|null $expected): void {
    $design = FurnitureDesign::factory()->create();
    $user = PolicyActors::resolve($actor, $design->project->owner);

    $response = Gate::forUser($user)->inspect('view', $design);

    expect([$response->allowed(), $response->status()])->toBe(PolicyActors::outcome($expected));
})->with(fn (): array => PolicyActors::rows(PolicyActors::ownerOrStaff(PolicyActors::STAFF)));

it('lets the owner and staff with plans.edit_any create, update and duplicate', function (string $ability, string $actor, bool|int|null $expected): void {
    $design = FurnitureDesign::factory()->create();
    $user = PolicyActors::resolve($actor, $design->project->owner);

    $response = Gate::forUser($user)->inspect($ability, $ability === 'create' ? [FurnitureDesign::class, $design->project] : $design);

    expect([$response->allowed(), $response->status()])->toBe(PolicyActors::outcome($expected));
})->with(function (): iterable {
    foreach (['create', 'update', 'duplicate'] as $ability) {
        foreach (PolicyActors::ownerOrStaff(PolicyActors::PLAN_EDITORS) as $actor => $expected) {
            yield "{$ability} / {$actor}" => [$ability, $actor, $expected];
        }
    }
});

describe('update on a locked design', function () use ($lock): void {
    it('answers 423 locked to everybody who may otherwise edit it', function (string $actor) use ($lock): void {
        $design = $lock(FurnitureDesign::factory()->create());
        $user = PolicyActors::resolve($actor, $design->project->owner);

        $response = Gate::forUser($user)->inspect('update', $design);

        expect($response->allowed())->toBeFalse()
            ->and($response->status())->toBe(423)
            ->and($response->code())->toBe('locked')
            ->and($response->message())->toBe(trans_icu('designs.errors.locked'))
            ->and($response->message())->not->toBe('designs.errors.locked');
    })->with(['customer', 'admin', 'staff-owner', 'estimator']);

    it('does not reveal the lock to anybody who may not edit the design', function (string $actor, int $status) use ($lock): void {
        $design = $lock(FurnitureDesign::factory()->create());
        $user = PolicyActors::resolve($actor, $design->project->owner);

        $response = Gate::forUser($user)->inspect('update', $design);

        expect([$response->status(), $response->code()])->toBe([$status, null]);
    })->with([
        'other customer' => ['other-customer', 404],
        'production' => ['production', 403],
        'support' => ['support', 403],
    ]);

    it('still lets the owner duplicate a locked design', function () use ($lock): void {
        $design = $lock(FurnitureDesign::factory()->create());

        expect(Gate::forUser($design->project->owner)->inspect('duplicate', $design)->allowed())->toBeTrue();
    });
});

describe('delete', function () use ($lock): void {
    it('allows only the owning customer', function (string $actor, bool|int|null $expected): void {
        $design = FurnitureDesign::factory()->create();
        $user = PolicyActors::resolve($actor, $design->project->owner);

        $response = Gate::forUser($user)->inspect('delete', $design);

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

    it('answers 422 design_in_order for a design referenced by an order item', function (): void {
        $design = FurnitureDesign::factory()->create();
        OrderItem::factory()->state([
            'order_id' => Order::factory()->state(['project_id' => $design->project_id]),
            'furniture_design_id' => $design->id,
        ])->create();

        $response = Gate::forUser($design->project->owner)->inspect('delete', $design);

        expect($response->allowed())->toBeFalse()
            ->and($response->status())->toBe(422)
            ->and($response->code())->toBe('design_in_order')
            ->and($response->message())->toBe(trans_icu('designs.errors.in_order'))
            ->and($response->message())->not->toBe('designs.errors.in_order');
    });

    it('answers 422 design_in_order for a locked design', function () use ($lock): void {
        $design = $lock(FurnitureDesign::factory()->create());

        $response = Gate::forUser($design->project->owner)->inspect('delete', $design);

        expect([$response->status(), $response->code()])->toBe([422, 'design_in_order']);
    });

    it('hides a referenced design from another customer', function (): void {
        $design = FurnitureDesign::factory()->create();
        OrderItem::factory()->state([
            'order_id' => Order::factory()->state(['project_id' => $design->project_id]),
            'furniture_design_id' => $design->id,
        ])->create();

        $response = Gate::forUser(User::factory()->create())->inspect('delete', $design);

        expect([$response->status(), $response->code()])->toBe([404, null]);
    });
});

it('lets only staff with presets.manage save a design as a preset', function (string $actor, bool|int|null $expected): void {
    $design = FurnitureDesign::factory()->create();
    $user = PolicyActors::resolve($actor, $design->project->owner);

    $response = Gate::forUser($user)->inspect('saveAsPreset', $design);

    expect([$response->allowed(), $response->status()])->toBe(PolicyActors::outcome($expected));
})->with(fn (): array => PolicyActors::rows([
    'customer' => 403, // owns the design but holds no permission
    'other-customer' => 404,
    'staff-owner' => true,
    'admin' => true,
    'estimator' => true,
    'production' => 403,
    'support' => 403,
    'inactive-admin' => null,
]));

it('denies inactive staff every design ability through the policy', function (): void {
    $design = FurnitureDesign::factory()->create();
    $gate = Gate::forUser(User::factory()->owner()->inactive()->create());

    foreach (['view', 'update', 'duplicate', 'delete', 'saveAsPreset'] as $ability) {
        expect($gate->inspect($ability, $design)->allowed())->toBeFalse("inactive staff passed {$ability}");
    }

    expect($gate->inspect('create', [FurnitureDesign::class, $design->project])->allowed())->toBeFalse();
});
