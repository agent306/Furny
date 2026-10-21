<?php

declare(strict_types=1);

namespace App\Policies\Concerns;

use App\Domain\Furniture\Models\FurnitureDesign;
use App\Domain\Identity\Models\User;
use App\Domain\Imports\Models\BlueprintImport;
use App\Domain\Projects\Models\Plan;
use App\Domain\Projects\Models\Project;

/**
 * "Own" in 13 §8 means `projects.owner_id`. Plans, furniture designs and imports are owned through
 * their project, never through a column of their own (`furniture_designs.owner_id` is a copy of it).
 */
trait ChecksProjectOwnership
{
    protected function ownsProject(User $user, Project $project): bool
    {
        return $project->owner_id === $user->id;
    }

    protected function ownsProjectOf(User $user, Plan|FurnitureDesign|BlueprintImport $record): bool
    {
        return $this->ownsProject($user, $this->projectOf($record));
    }

    /** The record's project, including a soft-deleted one (the owner keeps access while it can be restored). */
    protected function projectOf(Plan|FurnitureDesign|BlueprintImport $record): Project
    {
        return $record->project ?? $record->project()->withTrashed()->firstOrFail();
    }
}
