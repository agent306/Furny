<?php

declare(strict_types=1);

namespace App\Policies;

use App\Domain\Identity\Enums\PermissionName;
use App\Domain\Identity\Models\User;
use App\Domain\Imports\Enums\ImportMode;
use App\Domain\Imports\Models\BlueprintImport;
use App\Domain\Projects\Models\Project;
use App\Policies\Concerns\AuthorizesStaff;
use App\Policies\Concerns\ChecksProjectOwnership;
use Illuminate\Auth\Access\Response;

/**
 * 13 §8.4, 06 §11. "Owner" below is the owner of the import's project; the uploader is `user_id`
 * (a staff member acting for a customer stays the uploader).
 */
final class BlueprintImportPolicy
{
    use AuthorizesStaff, ChecksProjectOwnership;

    /**
     * The project's owner may start a trace import and, with a verified contact (email or phone,
     * `User::hasVerifiedContact()`), any mode. Staff with `plans.edit_any` may start any import.
     */
    public function create(User $user, Project $project, ImportMode $mode): Response
    {
        if ($this->staffCan($user, PermissionName::PlansEditAny)) {
            return Response::allow();
        }

        $own = $this->ownsProject($user, $project);

        if ($own && $mode !== ImportMode::Trace && ! $user->hasVerifiedContact()) {
            return Response::denyWithStatus(403, trans_icu('common.verify_required'), 'contact_unverified');
        }

        return $this->allowOrDeny($own, $user, $own);
    }

    public function view(User $user, BlueprintImport $import): Response
    {
        $involved = $this->isUploaderOrOwner($user, $import);

        return $this->allowOrDeny($involved || $this->staffCan($user, PermissionName::CustomersView), $user, $involved);
    }

    /** Debug media, `error_message` and `result_meta` timings. */
    public function viewDebug(User $user, BlueprintImport $import): Response
    {
        return $this->allowOrDeny($this->staffCan($user, PermissionName::CustomersView), $user, $this->isUploaderOrOwner($user, $import));
    }

    public function update(User $user, BlueprintImport $import): Response
    {
        return $this->involvedOr($user, $import, PermissionName::PlansEditAny);
    }

    public function cancel(User $user, BlueprintImport $import): Response
    {
        return $this->involvedOr($user, $import, PermissionName::PlansEditAny);
    }

    public function retry(User $user, BlueprintImport $import): Response
    {
        return $this->involvedOr($user, $import, PermissionName::PlansEditAny);
    }

    public function accept(User $user, BlueprintImport $import): Response
    {
        return $this->involvedOr($user, $import, PermissionName::PlansEditAny);
    }

    public function convertToTrace(User $user, BlueprintImport $import): Response
    {
        return $this->involvedOr($user, $import, PermissionName::PlansEditAny);
    }

    public function discard(User $user, BlueprintImport $import): Response
    {
        return $this->involvedOr($user, $import, PermissionName::AiManage);
    }

    /** Charged to the customer; free for staff with `ai.manage` while `ai.staff_unlimited` is on (06 §11.7). */
    public function rerun(User $user, BlueprintImport $import): Response
    {
        return $this->involvedOr($user, $import, PermissionName::AiManage);
    }

    public function refund(User $user, BlueprintImport $import): Response
    {
        return $this->allowOrDeny($this->staffCan($user, PermissionName::AiManage), $user, $this->isUploaderOrOwner($user, $import));
    }

    private function involvedOr(User $user, BlueprintImport $import, PermissionName $permission): Response
    {
        $involved = $this->isUploaderOrOwner($user, $import);

        return $this->allowOrDeny($involved || $this->staffCan($user, $permission), $user, $involved);
    }

    private function isUploaderOrOwner(User $user, BlueprintImport $import): bool
    {
        return $import->user_id === $user->id || $this->ownsProjectOf($user, $import);
    }
}
