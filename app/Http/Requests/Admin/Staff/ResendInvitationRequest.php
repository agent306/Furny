<?php

declare(strict_types=1);

namespace App\Http\Requests\Admin\Staff;

/** `admin.staff.invitations.resend` (14 §10): no fields; the invitation must still be open (the action says `staff.invitation_closed`). */
final class ResendInvitationRequest extends InvitationRequest {}
