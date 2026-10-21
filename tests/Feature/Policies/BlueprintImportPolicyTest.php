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

describe('the uploader of a staff-made import', function (): void {
    it('may act on it although the project belongs to a customer', function (string $ability): void {
        $production = User::factory()->production()->create();
        $import = BlueprintImport::factory()->state(['user_id' => $production->id])->create();

        expect(Gate::forUser($production)->inspect($ability, $import)->allowed())->toBeTrue();
    })->with(['view', 'update', 'cancel', 'retry', 'accept', 'convertToTrace']);

    it('does not extend to staff who did not upload it and hold no permission', function (string $ability): void {
        $import = BlueprintImport::factory()->create();

        $response = Gate::forUser(User::factory()->production()->create())->inspect($ability, $import);

        expect([$response->allowed(), $response->status()])->toBe([false, 403]);
    })->with(['update', 'cancel', 'retry', 'accept', 'convertToTrace', 'discard', 'rerun', 'refund']);

    it('may discard and rerun it but never refund it', function (): void {
        $production = User::factory()->production()->create();
        $import = BlueprintImport::factory()->state(['user_id' => $production->id])->create();
        $gate = Gate::forUser($production);

        expect($gate->inspect('discard', $import)->allowed())->toBeTrue()
            ->and($gate->inspect('rerun', $import)->allowed())->toBeTrue()
            ->and($gate->inspect('refund', $import)->allowed())->toBeFalse();
    });
});

it('denies inactive staff every import ability through the policy', function (): void {
    $import = BlueprintImport::factory()->create();
    $gate = Gate::forUser(User::factory()->owner()->inactive()->create());

    foreach (['view', 'viewDebug', 'update', 'cancel', 'retry', 'accept', 'convertToTrace', 'discard', 'rerun', 'refund'] as $ability) {
        expect($gate->inspect($ability, $import)->allowed())->toBeFalse("inactive staff passed {$ability}");
    }

    expect($gate->inspect('create', [BlueprintImport::class, $import->project, ImportMode::Trace])->allowed())->toBeFalse();
});
