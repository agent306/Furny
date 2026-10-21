<?php

declare(strict_types=1);

use App\Domain\Identity\Events\CustomerRegistered;
use App\Domain\Identity\Models\User;
use App\Notifications\Account\Welcome;
use Illuminate\Contracts\Events\ShouldDispatchAfterCommit;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;

/**
 * The OTP sign-up registers a customer inside a transaction (13 section 5.2): the welcome must not go out before
 * the customer exists for good, and not at all when the transaction rolls back.
 */
it('dispatches CustomerRegistered after the transaction commits, and not on a rollback', function (): void {
    Notification::fake();
    $user = User::factory()->create();

    DB::transaction(function () use ($user): void {
        CustomerRegistered::dispatch($user);

        Notification::assertNothingSent();
    });

    Notification::assertSentToTimes($user, Welcome::class, 1);

    Notification::fake();

    try {
        DB::transaction(function () use ($user): void {
            CustomerRegistered::dispatch($user);

            throw new RuntimeException('rolled back');
        });
    } catch (RuntimeException) {
        // expected
    }

    Notification::assertNothingSent();
});

it('sends the Welcome notification after the transaction commits, and not on a rollback', function (): void {
    $user = User::factory()->create();

    DB::transaction(function () use ($user): void {
        $user->notify(new Welcome);

        expect($user->notifications()->count())->toBe(0);
    });

    expect($user->notifications()->count())->toBe(1);

    try {
        DB::transaction(function () use ($user): void {
            $user->notify(new Welcome);

            throw new RuntimeException('rolled back');
        });
    } catch (RuntimeException) {
        // expected
    }

    expect($user->notifications()->count())->toBe(1);
});

it('is built to be sent after commit', function (): void {
    expect((new Welcome)->afterCommit)->toBeTrue()
        ->and(CustomerRegistered::class)->toImplement(ShouldDispatchAfterCommit::class);
});
