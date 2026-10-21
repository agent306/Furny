<?php

declare(strict_types=1);

namespace App\Http\Requests\Admin\Staff;

use App\Domain\Identity\Enums\StaffRole;
use App\Domain\Identity\Models\User;
use App\Domain\Identity\Support\StaffAccess;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * `admin.staff.invitations.store` (14 §10). Whether the address is free and not invited already is the action's to
 * say (`staff.email_in_use`, `staff.invitation_pending`); inviting an owner needs the owner gate (403).
 */
final class InviteStaffRequest extends FormRequest
{
    public function authorize(): bool
    {
        $actor = $this->user();
        $role = StaffRole::tryFrom((string) $this->input('role'));

        return $actor instanceof User && ($role === null || app(StaffAccess::class)->canGrant($actor, $role));
    }

    /** @return array<string, list<mixed>> */
    public function rules(): array
    {
        return [
            'email' => ['required', 'string', 'email:rfc', 'max:254'],
            'name' => ['required', 'string', 'min:2', 'max:120'],
            'role' => ['required', 'string', Rule::enum(StaffRole::class)],
        ];
    }

    /** The signed-in staff member; the route's middleware has seen to it that there is one. */
    public function actor(): User
    {
        $actor = $this->user();

        return $actor instanceof User ? $actor : abort(403);
    }

    public function staffRole(): StaffRole
    {
        return StaffRole::from($this->string('role')->toString());
    }
}
