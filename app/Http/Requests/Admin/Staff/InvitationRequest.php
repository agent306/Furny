<?php

declare(strict_types=1);

namespace App\Http\Requests\Admin\Staff;

use App\Domain\Identity\Models\StaffInvitation;
use App\Domain\Identity\Models\User;
use App\Domain\Identity\Support\StaffAccess;
use Illuminate\Foundation\Http\FormRequest;

/**
 * A request about one invitation, `{invitation}` of `admin.staff.invitations.*`: no fields. An invitation to an owner
 * is the owner gate's to resend or revoke, like inviting one (13 §7.3). Whether it is still open is the action's to say.
 */
abstract class InvitationRequest extends FormRequest
{
    public function authorize(): bool
    {
        $actor = $this->user();

        return $actor instanceof User && app(StaffAccess::class)->canGrant($actor, $this->invitation()->role);
    }

    /** @return array<string, never> */
    public function rules(): array
    {
        return [];
    }

    public function invitation(): StaffInvitation
    {
        $invitation = $this->route('invitation');

        return $invitation instanceof StaffInvitation ? $invitation : abort(404);
    }

    public function actor(): User
    {
        $actor = $this->user();

        return $actor instanceof User ? $actor : abort(403);
    }
}
