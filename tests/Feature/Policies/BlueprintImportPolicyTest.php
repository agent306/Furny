<?php

declare(strict_types=1);

use App\Domain\Identity\Models\User;
use App\Domain\Imports\Enums\ImportMode;
use App\Domain\Imports\Models\BlueprintImport;
use App\Domain\Projects\Models\Project;
use App\Policies\BlueprintImportPolicy;
use Illuminate\Support\Facades\Gate;
use Tests\Support\PolicyActors;

it('is found by policy auto-discovery', function (): void {
    expect(Gate::getPolicyFor(BlueprintImport::class))->toBeInstanceOf(BlueprintImportPolicy::class);
});

describe('create', function (): void {
    it('lets the owner start a trace import and staff with plans.edit_any start any import', function (string $actor, ImportMode $mode, bool|int|null $expected): void {
        $project = Project::factory()->create();
        $user = PolicyActors::resolve($actor, $project->owner);

        $response = Gate::forUser($user)->inspect('create', [BlueprintImport::class, $project, $mode]);

        expect([$response->allowed(), $response->status()])->toBe(PolicyActors::outcome($expected));
    })->with(function (): iterable {
        $expectations = PolicyActors::ownerOrStaff(PolicyActors::PLAN_EDITORS);

        foreach ([ImportMode::Auto, ImportMode::Trace] as $mode) {
            foreach ($expectations as $actor => $expected) {
                yield "{$mode->value} / {$actor}" => [$actor, $mode, $expected];
            }
        }
    });

    it('denies an unverified customer in auto mode with 403 contact_unverified but allows trace', function (): void {
        $customer = User::factory()->unverified()->create();
        $project = Project::factory()->forCustomer($customer)->create();

        $auto = Gate::forUser($customer)->inspect('create', [BlueprintImport::class, $project, ImportMode::Auto]);
        $trace = Gate::forUser($customer)->inspect('create', [BlueprintImport::class, $project, ImportMode::Trace]);

        expect($auto->allowed())->toBeFalse()
            ->and($auto->status())->toBe(403)
            ->and($auto->code())->toBe('contact_unverified')
            ->and($auto->message())->toBe(trans_icu('common.verify_required'))
            ->and($auto->message())->not->toBe('common.verify_required')
            ->and($trace->allowed())->toBeTrue();
    });

    it('accepts a verified email or a verified phone as a verified contact', function (): void {
        $emailOnly = User::factory()->create();
        $phoneOnly = User::factory()->phoneOnly()->phoneVerified()->create();

        foreach ([$emailOnly, $phoneOnly] as $customer) {
            $project = Project::factory()->forCustomer($customer)->create();

            expect($customer->hasVerifiedContact())->toBeTrue()
                ->and(Gate::forUser($customer)->inspect('create', [BlueprintImport::class, $project, ImportMode::Auto])->allowed())->toBeTrue();
        }
    });

    it('hides another customer\'s project from an unverified customer even in trace mode', function (): void {
        $project = Project::factory()->create();

        $response = Gate::forUser(User::factory()->unverified()->create())->inspect('create', [BlueprintImport::class, $project, ImportMode::Trace]);

        expect([$response->allowed(), $response->status()])->toBe([false, 404]);
    });

    it('does not let an unverified customer use staff rights they do not have', function (): void {
        $customer = User::factory()->unverified()->create();
        $project = Project::factory()->forCustomer($customer)->create();
        $customer->assignRole('estimator');

        $response = Gate::forUser($customer)->inspect('create', [BlueprintImport::class, $project, ImportMode::Auto]);

        expect([$response->allowed(), $response->code()])->toBe([false, 'contact_unverified']);
    });
});

it('lets the uploader, the project owner and staff with customers.view see an import', function (string $actor, bool|int|null $expected): void {
    $import = BlueprintImport::factory()->create();
    $user = PolicyActors::resolve($actor, $import->project->owner);

    $response = Gate::forUser($user)->inspect('view', $import);

    expect([$response->allowed(), $response->status()])->toBe(PolicyActors::outcome($expected));
})->with(fn (): array => PolicyActors::rows(PolicyActors::ownerOrStaff(PolicyActors::STAFF)));

it('keeps the debug view for staff with customers.view', function (string $actor, bool|int|null $expected): void {
    $import = BlueprintImport::factory()->create();
    $user = PolicyActors::resolve($actor, $import->project->owner);

    $response = Gate::forUser($user)->inspect('viewDebug', $import);

    expect([$response->allowed(), $response->status()])->toBe(PolicyActors::outcome($expected));
})->with(fn (): array => PolicyActors::rows([
    'customer' => 403, // sees the import but not its debug data
    'other-customer' => 404,
    'staff-owner' => true,
    'admin' => true,
    'estimator' => true,
    'production' => true,
    'support' => true,
    'inactive-admin' => null,
]));

it('lets the owner and staff with plans.edit_any drive the review of an import', function (string $ability, string $actor, bool|int|null $expected): void {
    $import = BlueprintImport::factory()->create();
    $user = PolicyActors::resolve($actor, $import->project->owner);

    $response = Gate::forUser($user)->inspect($ability, $import);

    expect([$response->allowed(), $response->status()])->toBe(PolicyActors::outcome($expected));
})->with(function (): iterable {
    foreach (['update', 'cancel', 'retry', 'accept', 'convertToTrace'] as $ability) {
        foreach (PolicyActors::ownerOrStaff(PolicyActors::PLAN_EDITORS) as $actor => $expected) {
            yield "{$ability} / {$actor}" => [$ability, $actor, $expected];
        }
    }
});

it('lets the owner and staff with ai.manage discard and rerun an import', function (string $ability, string $actor, bool|int|null $expected): void {
    $import = BlueprintImport::factory()->create();
    $user = PolicyActors::resolve($actor, $import->project->owner);

    $response = Gate::forUser($user)->inspect($ability, $import);

    expect([$response->allowed(), $response->status()])->toBe(PolicyActors::outcome($expected));
})->with(function (): iterable {
    foreach (['discard', 'rerun'] as $ability) {
        foreach (PolicyActors::ownerOrStaff(PolicyActors::MANAGERS) as $actor => $expected) {
            yield "{$ability} / {$actor}" => [$ability, $actor, $expected];
        }
    }
});

it('lets only owner and admin staff refund an import', function (string $actor, bool|int|null $expected): void {
    $import = BlueprintImport::factory()->create();
    $user = PolicyActors::resolve($actor, $import->project->owner);

    $response = Gate::forUser($user)->inspect('refund', $import);

    expect([$response->allowed(), $response->status()])->toBe(PolicyActors::outcome($expected));
})->with(fn (): array => PolicyActors::rows([
    'customer' => 403,
    'other-customer' => 404,
    'staff-owner' => true,
    'admin' => true,
    'estimator' => 403,
    'production' => 403,
    'support' => 403,
    'inactive-admin' => null,
]));

describe('the uploader (user_id) grants nothing by itself', function (): void {
    it('hides an import from a customer who uploaded it to a project they do not own', function (string $ability): void {
        $uploader = User::factory()->create();
        $import = BlueprintImport::factory()->state(['user_id' => $uploader->id])->create();

        $response = Gate::forUser($uploader)->inspect($ability, $import);

        expect([$response->allowed(), $response->status()])->toBe([false, 404]);
    })->with(['view', 'viewDebug', 'update', 'cancel', 'retry', 'accept', 'convertToTrace', 'discard', 'rerun', 'refund']);

    it('denies a staff uploader who has since lost the permission, with 403', function (string $ability): void {
        $uploader = User::factory()->estimator()->create();
        $import = BlueprintImport::factory()->state(['user_id' => $uploader->id])->create();
        $uploader->syncRoles('production');

        $response = Gate::forUser($uploader->fresh())->inspect($ability, $import);

        expect([$response->allowed(), $response->status()])->toBe([false, 403]);
    })->with(['update', 'cancel', 'retry', 'accept', 'convertToTrace', 'discard', 'rerun', 'refund']);

    it('still lets that staff uploader see the import through customers.view, not through the upload', function (): void {
        $uploader = User::factory()->estimator()->create();
        $import = BlueprintImport::factory()->state(['user_id' => $uploader->id])->create();
        $uploader->syncRoles('production');
        $uploader = $uploader->fresh();

        expect(Gate::forUser($uploader)->inspect('view', $import)->allowed())->toBeTrue();
    });

    it('keeps a staff uploader\'s rights exactly those of the ability\'s permission', function (): void {
        $estimator = User::factory()->estimator()->create();
        $import = BlueprintImport::factory()->state(['user_id' => $estimator->id])->create();
        $gate = Gate::forUser($estimator);

        expect($gate->inspect('update', $import)->allowed())->toBeTrue() // plans.edit_any
            ->and($gate->inspect('discard', $import)->status())->toBe(403) // no ai.manage
            ->and($gate->inspect('refund', $import)->status())->toBe(403);
    });
});

it('follows the live owner of the project when it changes', function (): void {
    $import = BlueprintImport::factory()->create();
    $formerOwner = $import->project->owner;
    $newOwner = User::factory()->create();
    $import->project->forceFill(['owner_id' => $newOwner->id])->save();
    $import = BlueprintImport::query()->findOrFail($import->id);

    expect(Gate::forUser($newOwner)->inspect('update', $import)->allowed())->toBeTrue()
        ->and(Gate::forUser($formerOwner)->inspect('update', $import)->status())->toBe(404)
        ->and(Gate::forUser($formerOwner)->inspect('view', $import)->status())->toBe(404);
});

it('lets the owner of an archived project keep using its imports (archiving is not checked here)', function (): void {
    $project = Project::factory()->archived()->create();
    $import = BlueprintImport::factory()->state(['project_id' => $project->id])->create();

    expect(Gate::forUser($project->owner)->inspect('view', $import)->allowed())->toBeTrue()
        ->and(Gate::forUser($project->owner)->inspect('create', [BlueprintImport::class, $project, ImportMode::Trace])->allowed())->toBeTrue();
});

it('denies inactive staff every import ability through the policy', function (): void {
    $import = BlueprintImport::factory()->create();
    $gate = Gate::forUser(User::factory()->owner()->inactive()->create());

    foreach (['view', 'viewDebug', 'update', 'cancel', 'retry', 'accept', 'convertToTrace', 'discard', 'rerun', 'refund'] as $ability) {
        expect($gate->inspect($ability, $import)->allowed())->toBeFalse("inactive staff passed {$ability}");
    }

    expect($gate->inspect('create', [BlueprintImport::class, $import->project, ImportMode::Trace])->allowed())->toBeFalse();
});
