<?php

declare(strict_types=1);

namespace App\Notifications\Auth;

use App\Domain\Identity\Models\User;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldBeEncrypted;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;
use LogicException;

/**
 * `auth.password_reset` (12 §3.3): the mail with the link to choose a new password (13 §5.5). Transactional: it
 * bypasses preferences and has no unsubscribe link. It is queued, so the request does not wait for the mail (nor
 * learn that it failed), and encrypted, so the token (the secret of the link) is not readable in the queue payload.
 * The link carries the broker's token and the address.
 */
final class ResetPassword extends Notification implements ShouldBeEncrypted, ShouldQueue
{
    use Queueable;

    public const string EVENT_KEY = 'auth.password_reset';

    public function __construct(private readonly string $token) {}

    /** @return list<string> */
    public function via(object $notifiable): array
    {
        return ['mail'];
    }

    public function toMail(object $notifiable): MailMessage
    {
        $params = [
            'appName' => (string) config('app.name'),
            'minutes' => (int) config('auth.passwords.'.config('auth.defaults.passwords').'.expire'),
        ];

        return (new MailMessage)
            ->subject(trans_icu('notifications.auth.password_reset.subject', $params))
            ->greeting(trans_icu('notifications.auth.password_reset.title', $params))
            ->line(trans_icu('notifications.auth.password_reset.body', $params))
            ->action(trans_icu('notifications.auth.password_reset.action', $params), $this->url($notifiable));
    }

    private function url(object $notifiable): string
    {
        if (! $notifiable instanceof User) {
            throw new LogicException('A password reset link is for a user.');
        }

        return route('password.reset', ['token' => $this->token, 'email' => $notifiable->getEmailForPasswordReset()]);
    }
}
