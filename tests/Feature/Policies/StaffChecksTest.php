<?php

declare(strict_types=1);

use App\Domain\Furniture\Models\FurnitureDesign;
use App\Domain\Identity\Models\User;
use App\Domain\Imports\Enums\ImportMode;
use App\Domain\Imports\Models\BlueprintImport;
use App\Domain\Messaging\Models\Message;
use App\Domain\Orders\Models\ChangeProposal;
use App\Domain\Orders\Models\Quote;
use App\Domain\Projects\Models\Plan;
use App\Domain\Projects\Models\Project;
use App\Policies\BlueprintImportPolicy;
use App\Policies\ChangeProposalPolicy;
use App\Policies\FurnitureDesignPolicy;
use App\Policies\MessagePolicy;
use App\Policies\OrderPolicy;
use App\Policies\PlanPolicy;
use App\Policies\ProjectPolicy;
use App\Policies\QuotePolicy;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\Gate;

/**
 * A customer who somehow holds a staff role (`owner` has every permission) must not pass any staff-only
 * check: `AuthorizesStaff::staffCan()` requires staff AND active AND the permission.
 */
describe('a customer holding a staff role', function (): void {
    beforeEach(function (): void {
        $this->customer = User::factory()->create();
        $this->customer->assignRole('owner');
        $this->strangersProject = Project::factory()->create();
        $this->ownProject = Project::factory()->forCustomer($this->customer)->create();
    });

    it('passes no plans.edit_any, customers.manage, ai.manage or presets.manage ability on other customers\' records', function (): void {
        $gate = Gate::forUser($this->customer);
        $plan = Plan::factory()->state(['project_id' => $this->strangersProject->id])->create();
        $design = FurnitureDesign::factory()->state(['project_id' => $this->strangersProject->id])->create();
        $import = BlueprintImport::factory()->state(['project_id' => $this->strangersProject->id])->create();

        $attempts = [
            ['update', $this->strangersProject], ['archive', $this->strangersProject], ['view', $this->strangersProject],
            ['create', [Plan::class, $this->strangersProject]], ['update', $plan], ['duplicate', $plan], ['lock', $plan], ['unlock', $plan],
            ['create', [FurnitureDesign::class, $this->strangersProject]], ['update', $design], ['duplicate', $design], ['saveAsPreset', $design],
            ['create', [BlueprintImport::class, $this->strangersProject, ImportMode::Auto]], ['update', $import], ['discard', $import],
            ['rerun', $import], ['viewDebug', $import], ['refund', $import], ['view', $import],
        ];

        foreach ($attempts as [$ability, $arguments]) {
            $response = $gate->inspect($ability, $arguments);

            expect([$response->allowed(), $response->status()])->toBe([false, 404], "{$ability} should be hidden");
        }
    });

    it('passes no staff-only ability even on its own records', function (): void {
        $gate = Gate::forUser($this->customer);
        $plan = Plan::factory()->state(['project_id' => $this->ownProject->id])->create();
        $design = FurnitureDesign::factory()->state(['project_id' => $this->ownProject->id])->create();
        $import = BlueprintImport::factory()->state(['project_id' => $this->ownProject->id])->create();

        foreach ([['lock', $plan], ['unlock', $plan], ['saveAsPreset', $design], ['viewDebug', $import], ['refund', $import]] as [$ability, $record]) {
            $response = $gate->inspect($ability, $record);

            expect([$response->allowed(), $response->status()])->toBe([false, 403], "{$ability} is staff-only");
        }

        expect($gate->inspect('create', [Project::class, User::factory()->create()])->status())->toBe(403);
    });

    it('is not saved by staff-level data.delete either', function (): void {
        expect(Gate::forUser($this->customer)->inspect('delete', $this->strangersProject)->status())->toBe(404);
    });
});

describe('inactive staff, with Gate::before out of the way (policies called directly)', function (): void {
    it('are denied by the policy itself', function (): void {
        $inactive = User::factory()->owner()->inactive()->create();
        $project = Project::factory()->create();
        $plan = Plan::factory()->state(['project_id' => $project->id])->create();
        $design = FurnitureDesign::factory()->state(['project_id' => $project->id])->create();
        $import = BlueprintImport::factory()->state(['project_id' => $project->id])->create();

        $denials = [
            (new ProjectPolicy)->view($inactive, $project),
            (new ProjectPolicy)->update($inactive, $project),
            (new PlanPolicy)->lock($inactive, $plan),
            (new PlanPolicy)->update($inactive, $plan),
            (new FurnitureDesignPolicy)->saveAsPreset($inactive, $design),
            (new FurnitureDesignPolicy)->view($inactive, $design),
            (new BlueprintImportPolicy)->refund($inactive, $import),
            (new BlueprintImportPolicy)->create($inactive, $project, ImportMode::Trace),
        ];

        foreach ($denials as $response) {
            expect($response->allowed())->toBeFalse();
        }
    });
});

describe('inactive staff on orders, quotes, proposals and messages, with Gate::before out of the way', function (): void {
    it('are denied by the policy itself', function (): void {
        $inactive = User::factory()->owner()->inactive()->create();
        $quote = Quote::factory()->sent()->create();
        $order = $quote->order;
        $proposal = ChangeProposal::factory()->sent()->for($order)->create();
        $message = Message::factory()->by($inactive)->for($order)->create();

        $denials = [
            (new OrderPolicy)->view($inactive, $order),
            (new OrderPolicy)->review($inactive, $order),
            (new OrderPolicy)->close($inactive, $order),
            (new QuotePolicy)->view($inactive, $quote),
            (new QuotePolicy)->viewCosts($inactive, $quote),
            (new ChangeProposalPolicy)->view($inactive, $proposal),
            (new ChangeProposalPolicy)->send($inactive, $proposal),
            (new MessagePolicy)->viewThread($inactive, $order),
            (new MessagePolicy)->create($inactive, $order),
            (new MessagePolicy)->createInternalNote($inactive, $order),
            (new MessagePolicy)->update($inactive, $message),
        ];

        foreach ($denials as $response) {
            expect($response->allowed())->toBeFalse();
        }
    });
});

it('denies inactive staff through the gate with a null status, which the HTTP layer renders as 403', function (): void {
    $inactive = User::factory()->admin()->inactive()->create();
    $project = Project::factory()->create();

    $response = Gate::forUser($inactive)->inspect('view', $project);

    // Gate::before returns plain false, so there is no explicit status; AuthorizationException has none
    // either and Laravel's exception handler renders a status-less authorization failure as 403.
    expect($response->allowed())->toBeFalse()
        ->and($response->status())->toBeNull()
        ->and(fn () => $response->authorize())->toThrow(AuthorizationException::class);
});
