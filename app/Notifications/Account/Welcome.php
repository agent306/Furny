<?php

declare(strict_types=1);

namespace App\Notifications\Account;

use App\Domain\Identity\Models\User;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/**
 * `account.welcome` (12 §3.3): the greeting a new customer gets, in the app and by email. It bypasses preferences
 * (there are none yet) and is sent to an unverified address as well: the customer has not had a chance to verify.
 */
final class Welcome extends Notification implements ShouldQueue
{
    use Queueable;

    public const string EVENT_KEY = 'account.welcome';

    private const string TITLE_KEY = 'notifications.account.welcome.customer.title';

    private const string BODY_KEY = 'notifications.account.welcome.customer.body';

    public function __construct()
    {
        $this->afterCommit();
    }

    /** @return list<string> */
    public function via(object $notifiable): array
    {
        return $notifiable instanceof User && $notifiable->email === null ? ['database'] : ['database', 'mail'];
    }

    public function databaseType(object $notifiable): string
    {
        return self::EVENT_KEY;
    }

    /** @return array{eventKey: string, titleKey: string, bodyKey: string, params: array<string, string>, url: string, icon: string} */
    public function toDatabase(object $notifiable): array
    {
        return [
            'eventKey' => self::EVENT_KEY,
            'titleKey' => self::TITLE_KEY,
            'bodyKey' => self::BODY_KEY,
            'params' => $this->params(),
            'url' => route('customer.dashboard', absolute: false),
            'icon' => 'smile',
        ];
    }

    public function toMail(object $notifiable): MailMessage
    {
        return (new MailMessage)
            ->subject(trans_icu(self::TITLE_KEY, $this->params()))
            ->greeting(trans_icu(self::TITLE_KEY, $this->params()))
            ->line(trans_icu(self::BODY_KEY, $this->params()))
            ->action(trans_icu('notifications.cta.open_dashboard'), route('customer.dashboard'));
    }

    /** @return array<string, string> */
    private function params(): array
    {
        return ['appName' => (string) config('app.name')];
    }
}
