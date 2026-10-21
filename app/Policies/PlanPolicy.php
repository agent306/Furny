<?php

declare(strict_types=1);

namespace App\Policies;

use App\Domain\Identity\Enums\PermissionName;
use App\Domain\Identity\Models\User;
use App\Domain\Projects\Models\Plan;
use App\Domain\Projects\Models\Project;
use App\Policies\Concerns\AuthorizesStaff;
use App\Policies\Concerns\ChecksProjectOwnership;
use Illuminate\Auth\Access\Response;
use Illuminate\Support\Facades\Gate;

/**
 * 13 §8.2. A locked plan (D25) is still authorised for `update`: the save, restore and checkpoint
 * actions answer 423 `plan_locked` (03 §5).
 */
final class PlanPolicy
{
    use AuthorizesStaff, ChecksProjectOwnership;

    public function view(User $user, Plan $plan): Response
    {
        return Gate::forUser($user)->inspect('view', $this->projectOf($plan));
    }

    public function export(User $user, Plan $plan): Response
    {
        return $this->view($user, $plan);
    }

    public function create(User $user, Project $project): Response
    {
        $own = $this->ownsProject($user, $project);

        return $this->allowOrDeny($own || $this->staffCan($user, PermissionName::PlansEditAny), $user, $own);
    }

    public function duplicate(User $user, Plan $plan): Response
    {
        return $this->edit($user, $plan);
    }

    public function update(User $user, Plan $plan): Response
    {
        return $this->edit($user, $plan);
    }

    /** The owning customer only: staff never delete a customer's plan. */
    public function delete(User $user, Plan $plan): Response
    {
        $own = $this->ownsProjectOf($user, $plan);

        return $this->allowOrDeny($own && $user->isCustomer(), $user, $own);
    }

    public function lock(User $user, Plan $plan): Response
    {
        return $this->lockOrUnlock($user, $plan);
    }

    public function unlock(User $user, Plan $plan): Response
    {
        return $this->lockOrUnlock($user, $plan);
    }

    private function edit(User $user, Plan $plan): Response
    {
        $own = $this->ownsProjectOf($user, $plan);

        return $this->allowOrDeny($own || $this->staffCan($user, PermissionName::PlansEditAny), $user, $own);
    }

    private function lockOrUnlock(User $user, Plan $plan): Response
    {
        return $this->allowOrDeny($this->staffCan($user, PermissionName::PlansEditAny), $user, $this->ownsProjectOf($user, $plan));
    }
}
