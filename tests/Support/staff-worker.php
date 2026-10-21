<?php

declare(strict_types=1);

/*
|--------------------------------------------------------------------------
| One staff action in its own PHP process (tests/Feature/Staff/StaffConcurrencyTest.php)
|--------------------------------------------------------------------------
|
| Boots the application like a web worker would (own PHP process, own database connection) and waits for a start time
| so that several workers fire at the same instant.
|
|   php staff-worker.php accept     <start epoch> <invitation id> <password>
|   php staff-worker.php demote     <start epoch> <actor id> <target id>
|   php staff-worker.php deactivate <start epoch> <actor id> <target id>
|
| Prints one JSON line: {"result": "ok"|<reason or error code>}.
*/

use App\Domain\Identity\Actions\AcceptStaffInvitation;
use App\Domain\Identity\Actions\DeactivateUser;
use App\Domain\Identity\Actions\UpdateStaffMember;
use App\Domain\Identity\Enums\StaffRole;
use App\Domain\Identity\Models\StaffInvitation;
use App\Domain\Identity\Models\User;
use App\Domain\Identity\Support\InvitationUnavailable;
use App\Support\Http\CodedValidationException;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Contracts\Console\Kernel;

require __DIR__.'/../../vendor/autoload.php';

$app = require __DIR__.'/../../bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

[, $mode, $start, $first, $second] = $argv;

while (microtime(true) < (float) $start) {
    usleep(500);
}

try {
    match ($mode) {
        'accept' => $app->make(AcceptStaffInvitation::class)->handle(StaffInvitation::query()->findOrFail($first), 'Nina Hire', $second, null),
        'demote' => $app->make(UpdateStaffMember::class)->handle(User::query()->findOrFail($first), $target = User::query()->findOrFail($second), $target->name, StaffRole::Admin),
        'deactivate' => $app->make(DeactivateUser::class)->handle(User::query()->findOrFail($first), User::query()->findOrFail($second)),
        default => throw new InvalidArgumentException("Unknown mode [{$mode}]."),
    };

    $result = 'ok';
} catch (InvitationUnavailable $unavailable) {
    $result = $unavailable->reason;
} catch (CodedValidationException $refused) {
    $result = $refused->errorCode;
} catch (AuthorizationException) {
    $result = 'forbidden';
}

echo json_encode(['result' => $result]), "\n";
