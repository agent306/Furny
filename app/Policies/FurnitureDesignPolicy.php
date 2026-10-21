<?php

declare(strict_types=1);

namespace App\Policies;

use App\Domain\Furniture\Models\FurnitureDesign;
use App\Domain\Identity\Enums\PermissionName;
use App\Domain\Identity\Models\User;
use App\Domain\Orders\Models\OrderItem;
use App\Domain\Projects\Models\Project;
use App\Policies\Concerns\AuthorizesStaff;
use App\Policies\Concerns\ChecksProjectOwnership;
use App\Policies\Concerns\RespondsWithCodes;
use Illuminate\Auth\Access\Response;

/**
 * 13 §8.3. A design is owned by its project's customer. Staff edits of a locked design go only through
 * `ChangeProposalPolicy::updateItemDraft`.
 */
final class FurnitureDesignPolicy
{
    use AuthorizesStaff, ChecksProjectOwnership, RespondsWithCodes;

    public function view(User $user, FurnitureDesign $design): Response
    {
        return $this->ownerOrStaffCan($user, $design, PermissionName::CustomersView, PermissionName::OrdersView);
    }

    public function create(User $user, Project $project): Response
    {
        return $this->ownerOrStaffCan($user, $project, PermissionName::PlansEditAny);
    }

    /** Whoever may edit it, unless an order locks it: 423 `locked`. */
    public function update(User $user, FurnitureDesign $design): Response
    {
        $access = $this->ownerOrStaffCan($user, $design, PermissionName::PlansEditAny);

        if ($access->denied()) {
            return $access;
        }

        return $design->isLocked()
            ? Response::denyWithStatus(423, trans_icu('designs.errors.locked'), 'locked')
            : $access;
    }

    public function duplicate(User $user, FurnitureDesign $design): Response
    {
        $view = $this->view($user, $design);

        return $view->denied() ? $view : $this->ownerOrStaffCan($user, $design, PermissionName::PlansEditAny);
    }

    /** The owning customer only, and not while an order holds or lists the design: 422 `design_in_order`. */
    public function delete(User $user, FurnitureDesign $design): Response
    {
        $own = $this->ownsProjectOf($user, $design);

        if (! $own || ! $user->isCustomer()) {
            return $this->allowOrDeny(false, $user, $own);
        }

        if ($design->isLocked() || OrderItem::query()->where('furniture_design_id', $design->id)->exists()) {
            return Response::denyWithStatus(422, trans_icu('designs.errors.in_order'), 'design_in_order');
        }

        return Response::allow();
    }

    public function saveAsPreset(User $user, FurnitureDesign $design): Response
    {
        return $this->staffCanOnly($user, $design, PermissionName::PresetsManage);
    }
}
