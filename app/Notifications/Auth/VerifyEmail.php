<?php

declare(strict_types=1);

namespace App\Notifications\Auth;

use App\Domain\Identity\Models\User;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldBeEncrypted;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;
use Illuminate\Support\Facades\URL;
use LogicException;

/**
 * `auth.email_verification` (12 §3.3): the mail with the link that verifies an address (13 §5.6). Transactional:
 * it bypasses preferences and is sent to an address that is not verified yet, which is the point of it. The link
 * is the temporary signed `verification.verify` route and works for `auth.verification.expire` minutes. Queued, and
 * encrypted like the reset mail: the signed link is a credential too.
 */
final class VerifyEmail extends Notification implements ShouldBeEncrypted, ShouldQueue
{
    use Queueable;

    public const string EVENT_KEY = 'auth.email_verification';

    /** @return list<string> */
    public function via(object $notifiable): array
    {
        return ['mail'];
    }

    public function toMail(object $notifiable): MailMessage
    {
        $params = [
            'appName' => (string) config('app.name'),
            'minutes' => $this->minutes(),
        ];

        return (new MailMessage)
            ->subject(trans_icu('notifications.auth.email_verification.subject', $params))
            ->greeting(trans_icu('notifications.auth.email_verification.title', $params))
            ->line(trans_icu('notifications.auth.email_verification.body', $params))
            ->action(trans_icu('notifications.auth.email_verification.action', $params), $this->url($notifiable));
    }

    private function url(object $notifiable): string
    {
        if (! $notifiable instanceof User) {
            throw new LogicException('A verification link is for a user.');
        }

        return URL::temporarySignedRoute('verification.verify', now()->addMinutes($this->minutes()), [
            'id' => $notifiable->getKey(),
            'hash' => sha1($notifiable->getEmailForVerification()),
        ]);
    }

    private function minutes(): int
    {
        return (int) config('auth.verification.expire', 60);
    }
}
