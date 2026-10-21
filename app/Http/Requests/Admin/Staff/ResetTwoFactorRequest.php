<?php

declare(strict_types=1);

namespace App\Http\Requests\Admin\Staff;

/** `admin.staff.two-factor.reset` (14 §10): no fields; resetting an owner's second factor needs the owner gate. */
final class ResetTwoFactorRequest extends StaffMemberRequest {}
