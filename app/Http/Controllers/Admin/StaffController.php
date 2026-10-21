<?php

declare(strict_types=1);

namespace App\Http\Controllers\Admin;

use App\Domain\Identity\Actions\ActivateUser;
use App\Domain\Identity\Actions\DeactivateUser;
use App\Domain\Identity\Actions\ResetTwoFactor;
use App\Domain\Identity\Actions\UpdateStaffMember;
use App\Domain\Identity\Data\StaffInvitationRowData;
use App\Domain\Identity\Data\StaffRowData;
use App\Domain\Identity\Enums\StaffRole;
use App\Domain\Identity\Enums\UserType;
use App\Domain\Identity\Models\StaffInvitation;
use App\Domain\Identity\Models\User;
use App\Domain\Identity\Support\StaffAccess;
use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\Staff\ActivateStaffRequest;
use App\Http\Requests\Admin\Staff\DeactivateStaffRequest;
use App\Http\Requests\Admin\Staff\ResetTwoFactorRequest;
use App\Http\Requests\Admin\Staff\UpdateStaffRequest;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * The staff page and the actions on its members (11 §7, 14 §10); `staff.manage` is route middleware. Acting on an owner
 * also needs the `staff.manage_owners` gate, which the requests and the actions both ask.
 */
final class StaffController extends Controller
{
    /** Invitations that ran out stay on the page this long (11 §7). */
    private const int EXPIRED_VISIBLE_DAYS = 30;

    public function index(Request $request, StaffAccess $access): Response
    {
        $viewer = $request->user();
        abort_unless($viewer instanceof User, 403);

        $canManageOwners = $access->canManageOwners($viewer);

        return Inertia::render('Admin/Staff/Index', [
            'staff' => User::query()
                ->where('type', UserType::Staff)
                ->with('roles')
                ->orderByRaw('lower(name)')
                ->orderBy('id')
                ->get()
                ->map(static fn (User $staff): StaffRowData => StaffRowData::fromUser($staff, $viewer, $canManageOwners))
                ->all(),
            'invitations' => StaffInvitation::query()
                ->whereNull('accepted_at')
                ->whereNull('revoked_at')
                ->where('expires_at', '>', now()->subDays(self::EXPIRED_VISIBLE_DAYS))
                ->with('invitedBy.media')
                ->latest('created_at')
                ->latest('id')
                ->get()
                ->map(static fn (StaffInvitation $invitation): StaffInvitationRowData => StaffInvitationRowData::fromInvitation($invitation))
                ->all(),
            'roles' => array_map(
                static fn (StaffRole $role): array => [
                    'name' => $role->value,
                    'label' => trans_icu('roles.names.'.$role->value),
                    'description' => trans_icu('roles.descriptions.'.$role->value),
                    'assignable' => $role !== StaffRole::Owner || $canManageOwners,
                ],
                StaffRole::cases(),
            ),
            'currentUserId' => $viewer->id,
        ]);
    }

    public function update(UpdateStaffRequest $request, User $user, UpdateStaffMember $update): RedirectResponse
    {
        $member = $update->handle($request->actor(), $user, $request->string('name')->toString(), $request->staffRole());

        Inertia::flash('success', trans_icu('staff.toasts.updated', ['name' => $member->name]));

        return back();
    }

    public function deactivate(DeactivateStaffRequest $request, User $user, DeactivateUser $deactivate): RedirectResponse
    {
        $member = $deactivate->handle($request->actor(), $user);

        Inertia::flash('success', trans_icu('staff.toasts.deactivated', ['name' => $member->name]));

        return back();
    }

    public function activate(ActivateStaffRequest $request, User $user, ActivateUser $activate): RedirectResponse
    {
        $member = $activate->handle($request->actor(), $user);

        Inertia::flash('success', trans_icu('staff.toasts.activated', ['name' => $member->name]));

        return back();
    }

    public function resetTwoFactor(ResetTwoFactorRequest $request, User $user, ResetTwoFactor $reset): RedirectResponse
    {
        $reset->handle($request->actor(), $user);

        Inertia::flash('success', trans_icu('staff.toasts.two_factor_reset', ['name' => $user->name]));

        return back();
    }
}
