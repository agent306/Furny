<?php

declare(strict_types=1);

use App\Domain\Identity\Otp\LogOtpDelivery;
use App\Domain\Identity\Otp\OtpDelivery;

it('binds the log delivery in the application, until the WhatsApp and SMS channels exist', function (): void {
    expect(app(OtpDelivery::class))->toBeInstanceOf(LogOtpDelivery::class);
});
