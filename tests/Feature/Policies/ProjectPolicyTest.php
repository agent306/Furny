<?php

declare(strict_types=1);

use App\Domain\Identity\Models\User;
use App\Domain\Orders\Models\Order;
use App\Domain\Orders\States\Submitted;
use App\Domain\Projects\Models\Project;
use App\Policies\ProjectPolicy;
use Illuminate\Support\Facades\Gate;
use Tests\Support\PolicyActors;

it('is found by policy auto-discovery', function (): void {
    expect(Gate::getPolicyFor(Project::class))->toBeInstanceOf(ProjectPolicy::class);
});

it('lists projects for customers and for staff with customers.view', function (string $actor, bool|int|null $expected): void {
    $user = PolicyActors::resolve($actor, User::factory()->create());

    $response = Gate::forUser($user)->inspect('viewAny', Project::class);

    expect([$response->allowed(), $response->status()])->toBe(PolicyActors::outcome($expected));
})->with(fn (): array => PolicyActors::rows([
    'customer' => true,
    'staff-owner' => true,
    'admin' => true,
    'estimator' => true,
    'production' => true,
    'support' => true,
    'inactive-admin' => null,
]));

it('lets the owner and staff with customers.view see a project', function (string $actor, bool|int|null $expected): void {
    $project = Project::factory()->create();
    $user = PolicyActors::resolve($actor, $project->owner);

    $response = Gate::forUser($user)->inspect('view', $project);

    expect([$response->allowed(), $response->status()])->toBe(PolicyActors::outcome($expected));
})->with(fn (): array => PolicyActors::rows(PolicyActors::ownerOrStaff(PolicyActors::STAFF)));

it('lets the owner and staff with customers.manage change a project', function (string $ability, string $actor, bool|int|null $expected): void {
    $project = Project::factory()->create();
    $user = PolicyActors::resolve($actor, $project->owner);

    $response = Gate::forUser($user)->inspect($ability, $project);

    expect([$response->allowed(), $response->status()])->toBe(PolicyActors::outcome($expected));
})->with(function (): iterable {
    foreach (['update', 'archive', 'restore'] as $ability) {
        foreach (PolicyActors::ownerOrStaff(PolicyActors::MANAGERS) as $actor => $expected) {
            yield "{$ability} / {$actor}" => [$ability, $actor, $expected];
        }
    }
});

it('lets support view a project but not update it', function (): void {
    $project = Project::factory()->create();
    $support = User::factory()->support()->create();

    expect(Gate::forUser($support)->inspect('view', $project)->allowed())->toBeTrue()
        ->and(Gate::forUser($support)->inspect('update', $project)->allowed())->toBeFalse()
        ->and(Gate::forUser($support)->inspect('update', $project)->status())->toBe(403);
});

describe('create', function (): void {
    it('lets a customer create a project for themselves', function (): void {
        $customer = User::factory()->create();

        expect(Gate::forUser($customer)->inspect('create', Project::class)->allowed())->toBeTrue()
            ->and(Gate::forUser($customer)->inspect('create', [Project::class, $customer])->allowed())->toBeTrue();
    });

    it('does not let a customer create a project for somebody else', function (): void {
        $response = Gate::forUser(User::factory()->create())->inspect('create', [Project::class, User::factory()->create()]);

        expect([$response->allowed(), $response->status()])->toBe([false, 403]);
    });

    it('lets staff with customers.manage create a project for a customer', function (string $actor, bool|int|null $expected): void {
        $customer = User::factory()->create();
        $user = PolicyActors::resolve($actor, $customer);

        $response = Gate::forUser($user)->inspect('create', [Project::class, $customer]);

        expect([$response->allowed(), $response->status()])->toBe(PolicyActors::outcome($expected));
    })->with(fn (): array => PolicyActors::rows([
        'staff-owner' => true,
        'admin' => true,
        'estimator' => 403,
        'production' => 403,
        'support' => 403,
        'inactive-admin' => null,
    ]));

    it('does not let staff create a project without naming the customer, or for another staff user', function (): void {
        $admin = User::factory()->admin()->create();

        expect(Gate::forUser($admin)->inspect('create', Project::class)->status())->toBe(403)
            ->and(Gate::forUser($admin)->inspect('create', [Project::class, User::factory()->support()->create()])->status())->toBe(403);
    });
});

describe('delete', function (): void {
    it('allows the owner when the project has no orders', function (): void {
        $project = Project::factory()->create();

        expect(Gate::forUser($project->owner)->inspect('delete', $project)->allowed())->toBeTrue();
    });

    it('allows the owner when the only order is a never-submitted draft', function (): void {
        $project = Project::factory()->create();
        Order::factory()->state(['project_id' => $project->id])->create();

        expect(Gate::forUser($project->owner)->inspect('delete', $project)->allowed())->toBeTrue();
    });

    it('denies the owner with 422 project_has_orders when an order was submitted', function (): void {
        $project = Project::factory()->create();
        Order::factory()->state(['project_id' => $project->id])->inState(Submitted::class)->create();

        $response = Gate::forUser($project->owner)->inspect('delete', $project);

        expect($response->allowed())->toBeFalse()
            ->and($response->status())->toBe(422)
            ->and($response->code())->toBe('project_has_orders')
            ->and($response->message())->toBe(trans_icu('projects.errors.has_orders'))
            ->and($response->message())->not->toBe('projects.errors.has_orders');
    });

    it('denies the owner when a draft was submitted before (submitted_at is set)', function (): void {
        $project = Project::factory()->create();
        Order::factory()->state(['project_id' => $project->id, 'submitted_at' => now()->subDay()])->create();

        $response = Gate::forUser($project->owner)->inspect('delete', $project);

        expect([$response->status(), $response->code()])->toBe([422, 'project_has_orders']);
    });

    it('still counts a submitted order that was soft-deleted', function (): void {
        $project = Project::factory()->create();
        Order::factory()->state(['project_id' => $project->id])->inState(Submitted::class)->create()->delete();

        expect(Gate::forUser($project->owner)->inspect('delete', $project)->code())->toBe('project_has_orders');
    });

    it('hides the project from another customer before looking at its orders', function (): void {
        $project = Project::factory()->create();
        Order::factory()->state(['project_id' => $project->id])->inState(Submitted::class)->create();

        $response = Gate::forUser(User::factory()->create())->inspect('delete', $project);

        expect([$response->status(), $response->code()])->toBe([404, null]);
    });

    it('lets staff delete only through the data.delete gate (owner role)', function (string $actor, bool|int|null $expected): void {
        $project = Project::factory()->create();
        $user = PolicyActors::resolve($actor, $project->owner);

        $response = Gate::forUser($user)->inspect('delete', $project);

        expect([$response->allowed(), $response->status()])->toBe(PolicyActors::outcome($expected));
    })->with(fn (): array => PolicyActors::rows([
        'staff-owner' => true,
        'admin' => 403,
        'estimator' => 403,
        'production' => 403,
        'support' => 403,
        'inactive-admin' => null,
    ]));

    it('applies the order guard to staff with data.delete too', function (): void {
        $project = Project::factory()->create();
        Order::factory()->state(['project_id' => $project->id])->inState(Submitted::class)->create();

        $response = Gate::forUser(User::factory()->owner()->create())->inspect('delete', $project);

        expect([$response->status(), $response->code()])->toBe([422, 'project_has_orders']);
    });
});

it('denies inactive staff every project ability through the policy', function (): void {
    $project = Project::factory()->create();
    $inactiveOwner = User::factory()->owner()->inactive()->create();
    $gate = Gate::forUser($inactiveOwner);

    foreach (['view', 'update', 'archive', 'restore', 'delete'] as $ability) {
        expect($gate->inspect($ability, $project)->allowed())->toBeFalse("inactive staff passed {$ability}");
    }

    expect($gate->inspect('viewAny', Project::class)->allowed())->toBeFalse()
        ->and($gate->inspect('create', [Project::class, $project->owner])->allowed())->toBeFalse();
});
