<?php

declare(strict_types=1);

/*
|--------------------------------------------------------------------------
| One OTP request in its own PHP process (tests/Feature/Auth/Otp/OtpConcurrencyTest.php)
|--------------------------------------------------------------------------
|
| Boots the application like a web worker would (own PHP process, own session, real database and Redis cache) and
| waits for a start time so that several workers fire at the same instant.
|
|   php otp-worker.php send   <start epoch> <phone> <ip>
|   php otp-worker.php verify <start epoch> <e164> <ip> <code>
|
| Prints one JSON line: {"result": "ok"|<error code>, "delivered": int}.
*/

use App\Domain\Identity\Actions\SendOtp;
use App\Domain\Identity\Actions\VerifyOtp;
use App\Domain\Identity\Enums\OtpPurpose;
use App\Domain\Identity\Otp\ArrayOtpDelivery;
use App\Domain\Identity\Otp\OtpDelivery;
use App\Domain\Identity\Otp\OtpException;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Http\Exceptions\ThrottleRequestsException;

require __DIR__.'/../../vendor/autoload.php';

$app = require __DIR__.'/../../bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
$app->singleton(OtpDelivery::class, ArrayOtpDelivery::class);

[, $mode, $start] = $argv;

while (microtime(true) < (float) $start) {
    usleep(500);
}

try {
    if ($mode === 'send') {
        $app->make(SendOtp::class)->handle($argv[3], OtpPurpose::Login, $argv[4], null);
    } else {
        $app->make(VerifyOtp::class)->handle($argv[3], OtpPurpose::Login, $argv[5], $argv[4]);
    }

    $result = 'ok';
} catch (OtpException $exception) {
    $result = $exception->errorCode;
} catch (ThrottleRequestsException) {
    $result = 'throttled';
}

echo json_encode(['result' => $result, 'delivered' => count($app->make(OtpDelivery::class)->sent())]), "\n";
