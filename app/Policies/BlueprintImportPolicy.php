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
use App\Policies\Concerns\RespondsWithCodes;
use Illuminate\Auth\Access\Response;

/**
 * 13 §8.4, 06 §11. Rights come from owning the import's project (customers) or from the ability's
 * permission (staff). The uploader (`user_id`) grants nothing by itself; this deliberately departs from
 * the literal "`user_id` = user" of 13 §8.4 (recorded in 19): a customer cannot reach an import of a
 * project they do not own, and staff who lost a permission lose the import with it.
 */
final class BlueprintImportPolicy
{
    use AuthorizesStaff, ChecksProjectOwnership, RespondsWithCodes;

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
        return $this->ownerOrStaffCan($user, $import, PermissionName::CustomersView);
    }

    /** Debug media, `error_message` and `result_meta` timings. */
    public function viewDebug(User $user, BlueprintImport $import): Response
    {
        return $this->staffCanOnly($user, $import, PermissionName::CustomersView);
    }

    public function update(User $user, BlueprintImport $import): Response
    {
        return $this->ownerOrStaffCan($user, $import, PermissionName::PlansEditAny);
    }

    public function cancel(User $user, BlueprintImport $import): Response
    {
        return $this->update($user, $import);
    }

    public function retry(User $user, BlueprintImport $import): Response
    {
        return $this->update($user, $import);
    }

    public function accept(User $user, BlueprintImport $import): Response
    {
        return $this->update($user, $import);
    }

    public function convertToTrace(User $user, BlueprintImport $import): Response
    {
        return $this->update($user, $import);
    }

    public function discard(User $user, BlueprintImport $import): Response
    {
        return $this->ownerOrStaffCan($user, $import, PermissionName::AiManage);
    }

    /** Charged to the customer; free for staff with `ai.manage` while `ai.staff_unlimited` is on (06 §11.7). */
    public function rerun(User $user, BlueprintImport $import): Response
    {
        return $this->discard($user, $import);
    }

    public function refund(User $user, BlueprintImport $import): Response
    {
        return $this->staffCanOnly($user, $import, PermissionName::AiManage);
    }
}
