<?php

declare(strict_types=1);

namespace App\Http\Requests\Admin\Staff;

use App\Domain\Identity\Enums\StaffRole;
use App\Domain\Identity\Support\StaffAccess;
use Illuminate\Validation\Rule;

/** `admin.staff.update` (14 §10): the name and the one role. Giving the owner role needs the owner gate (13 §7.3). */
final class UpdateStaffRequest extends StaffMemberRequest
{
    public function authorize(): bool
    {
        $role = StaffRole::tryFrom((string) $this->input('role'));

        return parent::authorize()
            && ($role === null || app(StaffAccess::class)->canGrant($this->actor(), $role));
    }

    /** @return array<string, list<mixed>> */
    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'min:2', 'max:120'],
            'role' => ['required', 'string', Rule::enum(StaffRole::class)],
        ];
    }

    public function staffRole(): StaffRole
    {
        return StaffRole::from($this->string('role')->toString());
    }
}
