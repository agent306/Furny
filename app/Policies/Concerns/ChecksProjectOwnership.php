<?php

declare(strict_types=1);

namespace App\Policies\Concerns;

use App\Domain\Furniture\Models\FurnitureDesign;
use App\Domain\Identity\Enums\PermissionName;
use App\Domain\Identity\Models\User;
use App\Domain\Imports\Models\BlueprintImport;
use App\Domain\Projects\Models\Plan;
use App\Domain\Projects\Models\Project;
use Illuminate\Auth\Access\Response;

/**
 * "Own" in 13 §8 means `projects.owner_id` of the record's project, read live: plans, furniture designs
 * and imports have no owner of their own (`furniture_designs.owner_id` is a copy that is never consulted,
 * and neither is `blueprint_imports.user_id`, the uploader).
 */
trait ChecksProjectOwnership
{
    use AuthorizesStaff, RespondsWithCodes;

    protected function ownsProject(User $user, Project $project): bool
    {
        return $project->owner_id === $user->id;
    }

    protected function ownsProjectOf(User $user, Plan|FurnitureDesign|BlueprintImport $record): bool
    {
        return $this->ownsProject($user, $this->projectOf($record));
    }

    /**
     * The record's project, including a soft-deleted one (the owner keeps access while it can be restored).
     * The fallback is set on the relation so later checks on the same instance do not query again.
     */
    protected function projectOf(Plan|FurnitureDesign|BlueprintImport $record): Project
    {
        $project = $record->project;

        if ($project === null) {
            $project = $record->project()->withTrashed()->firstOrFail();
            $record->setRelation('project', $project);
        }

        return $project;
    }

    /** The owning customer, or active staff holding any of the permissions. */
    protected function ownerOrStaffCan(User $user, Project|Plan|FurnitureDesign|BlueprintImport $subject, PermissionName ...$permissions): Response
    {
        $own = $this->owns($user, $subject);

        return $this->allowOrDeny($own || $this->staffHoldsAny($user, array_values($permissions)), $user, $own);
    }

    /** Staff holding the permission only; the owning customer is told 403 and a stranger 404. */
    protected function staffCanOnly(User $user, Plan|FurnitureDesign|BlueprintImport $subject, PermissionName $permission): Response
    {
        return $this->allowOrDeny($this->staffCan($user, $permission), $user, $this->owns($user, $subject));
    }

    private function owns(User $user, Project|Plan|FurnitureDesign|BlueprintImport $subject): bool
    {
        return $subject instanceof Project ? $this->ownsProject($user, $subject) : $this->ownsProjectOf($user, $subject);
    }

    /** @param  list<PermissionName>  $permissions */
    private function staffHoldsAny(User $user, array $permissions): bool
    {
        foreach ($permissions as $permission) {
            if ($this->staffCan($user, $permission)) {
                return true;
            }
        }

        return false;
    }
}
