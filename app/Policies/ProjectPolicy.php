<?php

declare(strict_types=1);

namespace App\Policies;

use App\Domain\Identity\Enums\OwnerGate;
use App\Domain\Identity\Enums\PermissionName;
use App\Domain\Identity\Models\User;
use App\Domain\Orders\States\Draft;
use App\Domain\Projects\Models\Project;
use App\Policies\Concerns\AuthorizesStaff;
use App\Policies\Concerns\ChecksProjectOwnership;
use Illuminate\Auth\Access\Response;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\Gate;

/** 13 §8.1. */
final class ProjectPolicy
{
    use AuthorizesStaff, ChecksProjectOwnership;

    public function viewAny(User $user): Response
    {
        return $this->allowOrDeny($user->isCustomer() || $this->staffCan($user, PermissionName::CustomersView), $user, ownsRecord: true);
    }

    public function view(User $user, Project $project): Response
    {
        $own = $this->ownsProject($user, $project);

        return $this->allowOrDeny($own || $this->staffCan($user, PermissionName::CustomersView), $user, $own);
    }

    /** A customer creates their own projects; staff create one for a customer with `customers.manage` (`owner_id` = that customer). */
    public function create(User $user, ?User $forCustomer = null): Response
    {
        if ($user->isCustomer()) {
            return $this->allowOrDeny($forCustomer === null || $forCustomer->is($user), $user, ownsRecord: true);
        }

        return $this->allowOrDeny($forCustomer?->isCustomer() === true && $this->staffCan($user, PermissionName::CustomersManage), $user);
    }

    public function update(User $user, Project $project): Response
    {
        return $this->manage($user, $project);
    }

    public function archive(User $user, Project $project): Response
    {
        return $this->manage($user, $project);
    }

    public function restore(User $user, Project $project): Response
    {
        return $this->manage($user, $project);
    }

    /**
     * The owner, or staff through the owner-only `data.delete` gate. Nobody may delete a project that has
     * orders other than never-submitted drafts: 422 `project_has_orders`.
     */
    public function delete(User $user, Project $project): Response
    {
        $own = $this->ownsProject($user, $project);

        if (! $own && ! Gate::forUser($user)->allows(OwnerGate::DataDelete->value)) {
            return $this->allowOrDeny(false, $user);
        }

        if ($this->hasOrdersBeyondNeverSubmittedDrafts($project)) {
            return Response::denyWithStatus(422, trans_icu('projects.errors.has_orders'), 'project_has_orders');
        }

        return Response::allow();
    }

    private function manage(User $user, Project $project): Response
    {
        $own = $this->ownsProject($user, $project);

        return $this->allowOrDeny($own || $this->staffCan($user, PermissionName::CustomersManage), $user, $own);
    }

    /** A never-submitted draft is in state `draft` with `submitted_at` null; soft-deleted orders still count. */
    private function hasOrdersBeyondNeverSubmittedDrafts(Project $project): bool
    {
        return $project->orders()
            ->withTrashed()
            ->where(static fn (Builder $query): Builder => $query->where('state', '!=', Draft::$name)->orWhereNotNull('submitted_at'))
            ->exists();
    }
}
