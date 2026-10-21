<?php

declare(strict_types=1);

use App\Domain\Identity\Enums\OtpChannel;
use App\Domain\Identity\Otp\ArrayOtpDelivery;
use App\Domain\Identity\Otp\LogOtpDelivery;
use App\Domain\Identity\Otp\OtpDelivery;
use App\Domain\Identity\Otp\OtpDeliveryException;
use App\Support\Logging\TapRedaction;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\File;

const DELIVERY_CODE = '482913';

const DELIVERY_MESSAGE = "482913 is your Furny verification code. It expires in 10 minutes. Do not share it.\n\n@furny.test #482913";

/** Everything logged from now on: [channel name, level, message, context]. */
function deliveryLog(): ArrayObject
{
    $records = new ArrayObject;
    Event::listen(MessageLogged::class, function (MessageLogged $log) use ($records): void {
        $records[] = [$log->level, $log->message, $log->context];
    });

    return $records;
}

describe('LogOtpDelivery', function (): void {
    it('logs the masked number and the channel, and not the message, outside a local environment', function (): void {
        $records = deliveryLog();
        expect(app()->environment())->toBe('testing');

        (new LogOtpDelivery)->send(OtpChannel::Sms, '+919876543210', DELIVERY_MESSAGE, DELIVERY_CODE, 'otp-id-1');

        expect($records)->toHaveCount(1);
        [$level, $message, $context] = $records[0];
        $everything = $message.json_encode($context);

        expect($level)->toBe('info')
            ->and($context['channel'])->toBe('sms')
            ->and($context['phone'])->toBe('+91******3210')
            ->and($everything)->not->toContain('482913')->not->toContain('9876543210')->not->toContain('verification code');
    });

    it('does not use the otp-dev channel outside a local environment, even when it exists', function (): void {
        config(['logging.channels.otp-dev' => ['driver' => 'single', 'path' => storage_path('logs/otp-dev-test.log')]]);
        File::delete(storage_path('logs/otp-dev-test.log'));

        (new LogOtpDelivery)->send(OtpChannel::Whatsapp, '+919876543210', DELIVERY_MESSAGE, DELIVERY_CODE, 'otp-id-1');

        expect(File::exists(storage_path('logs/otp-dev-test.log')))->toBeFalse();
    });

    describe('in a local environment', function (): void {
        beforeEach(function (): void {
            $this->path = storage_path('logs/otp-dev-test-'.bin2hex(random_bytes(4)).'.log');
            // The channel as config/logging.php defines it for APP_ENV=local, pointed at a file of this test.
            config(['logging.channels.otp-dev' => [...evaluateConfigFile('logging', ['APP_ENV' => 'local'])['channels']['otp-dev'], 'path' => $this->path]]);
            $this->app->detectEnvironment(fn (): string => 'local');
        });

        afterEach(function (): void {
            File::delete($this->path);
        });

        it('writes the full message to the otp-dev channel', function (): void {
            $records = deliveryLog();

            (new LogOtpDelivery)->send(OtpChannel::Sms, '+919876543210', DELIVERY_MESSAGE, DELIVERY_CODE, 'otp-id-1');

            $contents = File::get($this->path);

            expect($contents)->toContain('482913 is your Furny verification code')->toContain('@furny.test #482913')
                ->and($contents)->not->toContain('9876543210')->toContain('+91******3210')
                ->and($records)->toHaveCount(1);
        });

        it('still logs only masked metadata when there is no otp-dev channel', function (): void {
            config(['logging.channels.otp-dev' => null]);
            $records = deliveryLog();

            (new LogOtpDelivery)->send(OtpChannel::Sms, '+919876543210', DELIVERY_MESSAGE, DELIVERY_CODE, 'otp-id-1');

            expect(json_encode($records[0]))->not->toContain('482913');
        });
    });
});

describe('the otp-dev log channel', function (): void {
    it('exists only in a local environment, and is tapped like every other channel', function (): void {
        $local = evaluateConfigFile('logging', ['APP_ENV' => 'local'])['channels'];

        expect($local)->toHaveKey('otp-dev')
            ->and($local['otp-dev']['tap'])->toBe([TapRedaction::class]);

        foreach (['testing', 'production', 'staging'] as $environment) {
            expect(evaluateConfigFile('logging', ['APP_ENV' => $environment])['channels'])->not->toHaveKey('otp-dev');
        }

        expect(config('logging.channels'))->not->toHaveKey('otp-dev');
    });
});

describe('ArrayOtpDelivery', function (): void {
    it('keeps what was sent and reads the code back', function (): void {
        $delivery = new ArrayOtpDelivery;

        expect($delivery->sent())->toBe([])->and($delivery->lastCode())->toBeNull();

        $delivery->send(OtpChannel::Sms, '+919876543210', DELIVERY_MESSAGE, DELIVERY_CODE, 'otp-id-1');

        expect($delivery->sent())->toBe([['channel' => OtpChannel::Sms, 'e164' => '+919876543210', 'message' => DELIVERY_MESSAGE, 'code' => '482913', 'otpId' => 'otp-id-1']])
            ->and($delivery->lastCode())->toBe('482913');
    });

    it('throws for a channel it was told to fail on, and records nothing for it', function (): void {
        $delivery = (new ArrayOtpDelivery)->failOn(OtpChannel::Whatsapp);

        expect(fn () => $delivery->send(OtpChannel::Whatsapp, '+919876543210', DELIVERY_MESSAGE, DELIVERY_CODE, 'x'))->toThrow(OtpDeliveryException::class)
            ->and($delivery->sent())->toBe([]);

        $delivery->send(OtpChannel::Sms, '+919876543210', DELIVERY_MESSAGE, DELIVERY_CODE, 'x');

        expect($delivery->sent())->toHaveCount(1);
    });
});

it('binds the Feature suite to the array delivery', function (): void {
    expect(app(OtpDelivery::class))->toBeInstanceOf(ArrayOtpDelivery::class)->toBe(app(OtpDelivery::class));
});
