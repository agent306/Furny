<?php

declare(strict_types=1);

namespace App\Http\Requests\Admin\Staff;

/** `admin.staff.deactivate` (14 §10): no fields; acting on an owner needs the owner gate. */
final class DeactivateStaffRequest extends StaffMemberRequest {}
