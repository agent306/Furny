<?php

declare(strict_types=1);

namespace App\Http\Requests\Admin\Staff;

use App\Domain\Identity\Models\User;
use App\Domain\Identity\Support\StaffAccess;
use Illuminate\Foundation\Http\FormRequest;

/**
 * A request about one staff member, `{user}` of `admin.staff.*` (14 §1.6): a customer or anybody else is a 404, and
 * acting on an owner needs the `staff.manage_owners` gate (13 §7.3). `staff.manage` itself is route middleware.
 */
abstract class StaffMemberRequest extends FormRequest
{
    public function authorize(): bool
    {
        return app(StaffAccess::class)->canTarget($this->actor(), $this->member());
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [];
    }

    /** The staff member the request is about. */
    public function member(): User
    {
        $member = $this->route('user');

        abort_unless($member instanceof User && $member->isStaff(), 404);

        return $member;
    }

    /** The signed-in staff member; the route's middleware has seen to it that there is one. */
    public function actor(): User
    {
        $actor = $this->user();

        return $actor instanceof User ? $actor : abort(403);
    }
}
