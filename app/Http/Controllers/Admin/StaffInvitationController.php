<?php

declare(strict_types=1);

namespace App\Http\Controllers\Admin;

use App\Domain\Identity\Actions\InviteStaff;
use App\Domain\Identity\Actions\ResendStaffInvitation;
use App\Domain\Identity\Actions\RevokeStaffInvitation;
use App\Domain\Identity\Models\StaffInvitation;
use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\Staff\InviteStaffRequest;
use App\Http\Requests\Admin\Staff\ResendInvitationRequest;
use App\Http\Requests\Admin\Staff\RevokeInvitationRequest;
use Illuminate\Http\RedirectResponse;
use Inertia\Inertia;

/** Inviting staff and managing the invitations that are out (13 §5.9, 14 §10); `staff.manage` is route middleware. */
final class StaffInvitationController extends Controller
{
    public function store(InviteStaffRequest $request, InviteStaff $invite): RedirectResponse
    {
        $invitation = $invite->handle(
            $request->actor(),
            $request->string('email')->toString(),
            $request->string('name')->toString(),
            $request->staffRole(),
        );

        Inertia::flash('success', trans_icu('staff.toasts.invited', ['email' => $invitation->email]));

        return back();
    }

    public function resend(ResendInvitationRequest $request, StaffInvitation $invitation, ResendStaffInvitation $resend): RedirectResponse
    {
        $invitation = $resend->handle($request->actor(), $invitation);

        Inertia::flash('success', trans_icu('staff.toasts.resent', ['email' => $invitation->email]));

        return back();
    }

    public function revoke(RevokeInvitationRequest $request, StaffInvitation $invitation, RevokeStaffInvitation $revoke): RedirectResponse
    {
        $invitation = $revoke->handle($request->actor(), $invitation);

        Inertia::flash('success', trans_icu('staff.toasts.revoked', ['email' => $invitation->email]));

        return back();
    }
}
