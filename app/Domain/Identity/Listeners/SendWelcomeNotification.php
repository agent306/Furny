<?php

declare(strict_types=1);

namespace App\Domain\Identity\Listeners;

use App\Domain\Identity\Events\CustomerRegistered;
use App\Notifications\Account\Welcome;

/** `account.welcome` (12 §3.3): greets the customer who just registered, in the app and by email. */
final class SendWelcomeNotification
{
    public function handle(CustomerRegistered $event): void
    {
        $event->user->notify(new Welcome);
    }
}
